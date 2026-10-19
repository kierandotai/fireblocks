/**
 * Agent Spend Guard engine.
 *
 * Every agent payment passes four gates, in order. The first gate that fails stops the payment.
 *
 *   1. Request integrity  - the merchant's x402-style payment requirement must carry a valid
 *                           Ed25519 signature from the merchant's registered key, be unexpired,
 *                           and use a nonce not seen before. Catches payTo rerouting and replay.
 *   2. Delegation grant   - the user's signed grant to the agent must verify, be in its validity
 *                           window, and not be revoked.
 *   3. Mandate            - the grant's scope: per-payment cap, rolling daily cap, velocity,
 *                           merchant allowlist, asset allowlist.
 *   4. Workspace policy   - ordered, first-match rules modeled on the Fireblocks Policy Engine,
 *                           with an Inspector-style trace of every rule evaluated.
 *
 * Gates 2-3 are the agent's own authority (what the user delegated). Gate 4 is the
 * organization's authority (what the workspace allows anyone to do). An agent payment needs both.
 */
import { generateKeyPairSync, sign, verify, randomUUID, type KeyObject } from "node:crypto";

export type Decision = "ALLOW" | "BLOCK" | "REQUIRE_APPROVAL";
export type StepStatus = "pass" | "fail" | "warn" | "skip";
export type StepId = "integrity" | "delegation" | "mandate" | "policy";

export interface Check {
  name: string;
  ok: boolean;
  note: string;
}

export interface RuleEval {
  id: string;
  name: string;
  action: Decision;
  matched: boolean;
  evaluated: boolean;
  reasons: string[];
}

export interface Step {
  id: StepId;
  label: string;
  status: StepStatus;
  summary: string;
  checks: Check[];
  rules?: RuleEval[];
}

/** Modeled on x402 PaymentRequirements, trimmed to the fields that matter for governance. */
export interface PaymentRequirement {
  scheme: "exact";
  network: string;
  asset: string;
  amount: number; // whole units of the asset, e.g. 12.5 USDC
  payTo: string;
  resource: string;
  description: string;
  merchantId: string;
  nonce: string;
  validUntil: number; // epoch ms
}

export interface SignedRequirement {
  requirement: PaymentRequirement;
  signature: string; // base64 Ed25519 over canonical JSON of requirement
}

export interface Merchant {
  id: string;
  name: string;
  domain: string;
  payTo: string;
  kytRisk: "low" | "medium" | "severe";
  whitelisted: boolean; // registered as an external wallet in the workspace
}

export interface Mandate {
  agentId: string;
  agentName: string;
  delegatedBy: string;
  maxPerPayment: number;
  dailyCap: number;
  velocity: { count: number; windowMinutes: number };
  merchants: string[];
  assets: string[];
  notBefore: number;
  expiresAt: number;
  revoked: boolean;
}

export interface SignedGrant {
  mandate: Mandate;
  signature: string;
}

export interface PaymentAttempt {
  label: string;
  at: number; // epoch ms the agent submits
  signed: SignedRequirement;
  tamper?: { payTo?: string }; // what an attacker changed in transit, if anything
}

export interface AttemptResult {
  index: number;
  label: string;
  at: number;
  requirement: PaymentRequirement;
  merchant?: Merchant;
  tampered: boolean;
  steps: Step[];
  decision: Decision;
  stoppedAt?: StepId;
  reason: string;
}

// ---------- keys and signing ----------

interface KeyPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
}

const keyring = new Map<string, KeyPair>();

export function keyFor(id: string): KeyPair {
  let kp = keyring.get(id);
  if (!kp) {
    kp = generateKeyPairSync("ed25519");
    keyring.set(id, kp);
  }
  return kp;
}

/** Deterministic JSON: sorted keys at every level. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function signPayload(signerId: string, payload: unknown): string {
  return sign(null, Buffer.from(canonical(payload)), keyFor(signerId).privateKey).toString("base64");
}

export function verifyPayload(signerId: string, payload: unknown, signature: string): boolean {
  const kp = keyring.get(signerId);
  if (!kp) return false;
  try {
    return verify(null, Buffer.from(canonical(payload)), kp.publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export function signRequirement(req: PaymentRequirement): SignedRequirement {
  return { requirement: req, signature: signPayload(`merchant:${req.merchantId}`, req) };
}

export function signGrant(mandate: Mandate): SignedGrant {
  return { mandate, signature: signPayload(`user:${mandate.delegatedBy}`, mandate) };
}

// ---------- workspace policy (modeled on Fireblocks Policy Engine semantics) ----------

export interface PolicyContext {
  initiator: string; // API user that submits
  sourceVault: string;
  asset: string;
  amount: number;
  merchant?: Merchant;
}

export interface PolicyRule {
  id: string;
  name: string;
  action: Decision;
  test: (ctx: PolicyContext) => { matched: boolean; reasons: string[] };
}

export const AGENT_API_USER = "api-user:agent-runtime";
export const AGENT_VAULT = "vault:agent-ops";

export const WORKSPACE_POLICY: PolicyRule[] = [
  {
    id: "R1",
    name: "Block any payout to a severe-risk address (KYT)",
    action: "BLOCK",
    test: (c) => {
      const risk = c.merchant?.kytRisk ?? "severe";
      return {
        matched: risk === "severe",
        reasons: [risk === "severe" ? `destination KYT risk is severe` : `destination KYT risk is ${risk}`],
      };
    },
  },
  {
    id: "R2",
    name: "Agent runtime may only pay whitelisted external wallets",
    action: "BLOCK",
    test: (c) => {
      const isAgent = c.initiator === AGENT_API_USER;
      const wl = !!c.merchant?.whitelisted;
      return {
        matched: isAgent && !wl,
        reasons: [
          isAgent ? "initiator is agent runtime" : "initiator is not agent runtime",
          wl ? "destination is a whitelisted external wallet" : "destination is not whitelisted",
        ],
      };
    },
  },
  {
    id: "R3",
    name: "Agent payments over 75 USDC need one human approver",
    action: "REQUIRE_APPROVAL",
    test: (c) => {
      const isAgent = c.initiator === AGENT_API_USER;
      return {
        matched: isAgent && c.amount > 75,
        reasons: [
          isAgent ? "initiator is agent runtime" : "initiator is not agent runtime",
          c.amount > 75 ? `amount ${fmt(c.amount)} > 75` : `amount ${fmt(c.amount)} <= 75`,
        ],
      };
    },
  },
  {
    id: "R4",
    name: "Allow agent runtime: USDC from agent-ops vault, up to 500",
    action: "ALLOW",
    test: (c) => {
      const conds: [boolean, string][] = [
        [c.initiator === AGENT_API_USER, "initiator is agent runtime"],
        [c.sourceVault === AGENT_VAULT, "source is vault agent-ops"],
        [c.asset === "USDC", `asset is ${c.asset}`],
        [c.amount <= 500, `amount ${fmt(c.amount)} <= 500`],
      ];
      return { matched: conds.every(([ok]) => ok), reasons: conds.map(([ok, r]) => (ok ? r : `not: ${r}`)) };
    },
  },
  {
    id: "R0",
    name: "Default: block everything not matched above",
    action: "BLOCK",
    test: () => ({ matched: true, reasons: ["no earlier rule matched"] }),
  },
];

export function evaluatePolicy(ctx: PolicyContext, rules: PolicyRule[] = WORKSPACE_POLICY) {
  const trace: RuleEval[] = [];
  let decision: Decision = "BLOCK";
  let hit: RuleEval | undefined;
  for (const rule of rules) {
    if (hit) {
      trace.push({ id: rule.id, name: rule.name, action: rule.action, matched: false, evaluated: false, reasons: ["not evaluated: earlier rule matched"] });
      continue;
    }
    const { matched, reasons } = rule.test(ctx);
    const ev: RuleEval = { id: rule.id, name: rule.name, action: rule.action, matched, evaluated: true, reasons };
    trace.push(ev);
    if (matched) {
      hit = ev;
      decision = rule.action;
    }
  }
  return { decision, hit, trace };
}

// ---------- the pipeline ----------

export interface RunInput {
  grant: SignedGrant;
  merchants: Merchant[];
  attempts: PaymentAttempt[];
  ledger?: { at: number; amount: number }[]; // prior settled agent spend
}

export function runPipeline(input: RunInput): AttemptResult[] {
  const seenNonces = new Set<string>();
  const ledger = [...(input.ledger ?? [])];
  const merchants = new Map(input.merchants.map((m) => [m.id, m]));
  const results: AttemptResult[] = [];

  input.attempts.forEach((attempt, index) => {
    const original = attempt.signed.requirement;
    const received: PaymentRequirement = { ...original, ...(attempt.tamper ?? {}) };
    const tampered = !!attempt.tamper;
    const merchant = merchants.get(received.merchantId);
    const steps: Step[] = [];
    const now = attempt.at;

    const finish = (decision: Decision, stoppedAt: StepId | undefined, reason: string) => {
      const order: StepId[] = ["integrity", "delegation", "mandate", "policy"];
      const labels: Record<StepId, string> = {
        integrity: "Request integrity",
        delegation: "Delegation grant",
        mandate: "Mandate scope",
        policy: "Workspace policy",
      };
      for (const id of order) {
        if (!steps.find((s) => s.id === id)) {
          steps.push({ id, label: labels[id], status: "skip", summary: "Not reached", checks: [] });
        }
      }
      if (decision === "ALLOW") ledger.push({ at: now, amount: received.amount });
      results.push({ index, label: attempt.label, at: now, requirement: received, merchant, tampered, steps, decision, stoppedAt, reason });
    };

    // 1. integrity
    const sigOk = verifyPayload(`merchant:${received.merchantId}`, received, attempt.signed.signature);
    const fresh = received.validUntil > now;
    const unseen = !seenNonces.has(received.nonce);
    const integrityChecks: Check[] = [
      { name: "Merchant signature", ok: sigOk, note: sigOk ? `Ed25519 signature verifies against ${merchant?.domain ?? received.merchantId} key` : "Signature does not match payload. Requirement was altered after the merchant signed it." },
      { name: "Not expired", ok: fresh, note: fresh ? `valid ${Math.round((received.validUntil - now) / 1000)}s more` : `expired ${Math.round((now - received.validUntil) / 1000)}s ago` },
      { name: "Nonce unused", ok: unseen, note: unseen ? `nonce ${received.nonce.slice(0, 8)} is new` : `nonce ${received.nonce.slice(0, 8)} already settled. Replay.` },
    ];
    seenNonces.add(received.nonce);
    const integrityOk = sigOk && fresh && unseen;
    steps.push({
      id: "integrity",
      label: "Request integrity",
      status: integrityOk ? "pass" : "fail",
      summary: integrityOk ? "Payment requirement is authentic, fresh and unique" : integrityChecks.filter((c) => !c.ok).map((c) => c.name).join(", ") + " failed",
      checks: integrityChecks,
    });
    if (!integrityOk) {
      const failed = integrityChecks.find((c) => !c.ok)!;
      return finish("BLOCK", "integrity", `${failed.name}: ${failed.note}`);
    }

    // 2. delegation grant
    const g = input.grant;
    const grantSigOk = verifyPayload(`user:${g.mandate.delegatedBy}`, g.mandate, g.signature);
    const inWindow = now >= g.mandate.notBefore && now < g.mandate.expiresAt;
    const live = !g.mandate.revoked;
    const grantChecks: Check[] = [
      { name: "Grant signature", ok: grantSigOk, note: grantSigOk ? `signed by ${g.mandate.delegatedBy}` : "grant was modified after the user signed it" },
      { name: "Validity window", ok: inWindow, note: inWindow ? `expires in ${Math.round((g.mandate.expiresAt - now) / 3600000)}h` : "outside grant validity window" },
      { name: "Not revoked", ok: live, note: live ? "grant is active" : "user revoked this delegation" },
    ];
    const grantOk = grantSigOk && inWindow && live;
    steps.push({
      id: "delegation",
      label: "Delegation grant",
      status: grantOk ? "pass" : "fail",
      summary: grantOk ? `${g.mandate.agentName} acts for ${g.mandate.delegatedBy}` : grantChecks.filter((c) => !c.ok).map((c) => c.name).join(", ") + " failed",
      checks: grantChecks,
    });
    if (!grantOk) {
      const failed = grantChecks.find((c) => !c.ok)!;
      return finish("BLOCK", "delegation", `${failed.name}: ${failed.note}`);
    }

    // 3. mandate scope
    const m = g.mandate;
    const dayAgo = now - 24 * 3600 * 1000;
    const winStart = now - m.velocity.windowMinutes * 60 * 1000;
    const spent24 = ledger.filter((l) => l.at > dayAgo).reduce((a, l) => a + l.amount, 0);
    const recent = ledger.filter((l) => l.at > winStart).length;
    const mandateChecks: Check[] = [
      { name: "Merchant allowlist", ok: m.merchants.includes(received.merchantId), note: m.merchants.includes(received.merchantId) ? `${merchant?.domain ?? received.merchantId} is on the user's list` : `${merchant?.domain ?? received.merchantId} is not on the user's list` },
      { name: "Asset", ok: m.assets.includes(received.asset), note: `${received.asset} ${m.assets.includes(received.asset) ? "allowed" : "not allowed"}` },
      { name: "Per-payment cap", ok: received.amount <= m.maxPerPayment, note: `${fmt(received.amount)} vs cap ${fmt(m.maxPerPayment)}` },
      { name: "Rolling 24h cap", ok: spent24 + received.amount <= m.dailyCap, note: `${fmt(spent24)} spent + ${fmt(received.amount)} vs cap ${fmt(m.dailyCap)}` },
      { name: "Velocity", ok: recent < m.velocity.count, note: `${recent} payments in last ${m.velocity.windowMinutes}m, limit ${m.velocity.count}` },
    ];
    const mandateOk = mandateChecks.every((c) => c.ok);
    steps.push({
      id: "mandate",
      label: "Mandate scope",
      status: mandateOk ? "pass" : "fail",
      summary: mandateOk ? "Inside the authority the user delegated" : mandateChecks.filter((c) => !c.ok).map((c) => c.name).join(", ") + " exceeded",
      checks: mandateChecks,
    });
    if (!mandateOk) {
      const failed = mandateChecks.find((c) => !c.ok)!;
      return finish("BLOCK", "mandate", `${failed.name}: ${failed.note}`);
    }

    // 4. workspace policy
    const pol = evaluatePolicy({ initiator: AGENT_API_USER, sourceVault: AGENT_VAULT, asset: received.asset, amount: received.amount, merchant });
    steps.push({
      id: "policy",
      label: "Workspace policy",
      status: pol.decision === "ALLOW" ? "pass" : pol.decision === "REQUIRE_APPROVAL" ? "warn" : "fail",
      summary: `${pol.hit?.id} matched: ${pol.hit?.name}`,
      checks: [],
      rules: pol.trace,
    });
    finish(pol.decision, pol.decision === "ALLOW" ? undefined : "policy", `${pol.hit?.id}: ${pol.hit?.name}`);
  });

  return results;
}

export function fmt(n: number) {
  return Number.isInteger(n) ? `${n}` : n.toFixed(2);
}

export function newNonce() {
  return randomUUID();
}
