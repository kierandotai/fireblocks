import {
  type Mandate,
  type Merchant,
  type PaymentAttempt,
  type PaymentRequirement,
  type RunInput,
  newNonce,
  signGrant,
  signRequirement,
} from "./engine";

export const ATTACKER = "0xBAd0000c0ffee5e7f1c0de00000000000000dEaD";

export const MERCHANTS: Merchant[] = [
  { id: "stratus", name: "Stratus Weather API", domain: "api.stratus-weather.dev", payTo: "0x4b2A9cE15F0d3b0a7E8c11D2c64A6f0b9e21C7a3", kytRisk: "low", whitelisted: true },
  { id: "ridgeline", name: "Ridgeline GPU", domain: "gpu.ridgeline.cloud", payTo: "0x91fE07D4a2b85cC3E6014A7f2D9b3E50c8A1f622", kytRisk: "low", whitelisted: true },
  { id: "kestrel", name: "Kestrel Travel", domain: "book.kestrel.travel", payTo: "0x2D7c5A0e9B14f63C8a2E0D5b7F19c4A6e30B8d91", kytRisk: "medium", whitelisted: true },
  { id: "lumen", name: "Lumen Data Feeds", domain: "feeds.lumen-data.io", payTo: "0x7aE3b6F0c2D94e18A5b0C7d3E9f1426B8c0A5e44", kytRisk: "severe", whitelisted: true },
  { id: "freegpu", name: "free-gpu-credits.xyz", domain: "free-gpu-credits.xyz", payTo: ATTACKER, kytRisk: "severe", whitelisted: false },
];

export interface MandateSettings {
  maxPerPayment: number;
  dailyCap: number;
  velocityCount: number;
  velocityWindowMinutes: number;
  revoked: boolean;
}

export const DEFAULT_SETTINGS: MandateSettings = {
  maxPerPayment: 100,
  dailyCap: 250,
  velocityCount: 3,
  velocityWindowMinutes: 10,
  revoked: false,
};

export interface Scenario {
  id: string;
  title: string;
  kind: "normal" | "attack" | "governance";
  story: string;
  expect: string;
  forceRevoked?: boolean;
  build: (now: number) => PaymentAttempt[];
}

const MIN = 60_000;

function req(merchantId: string, amount: number, description: string, resource: string, now: number, ttlMs = 5 * MIN): PaymentRequirement {
  const m = MERCHANTS.find((x) => x.id === merchantId)!;
  return {
    scheme: "exact",
    network: "base-sepolia",
    asset: "USDC",
    amount,
    payTo: m.payTo,
    resource: `https://${m.domain}${resource}`,
    description,
    merchantId,
    nonce: newNonce(),
    validUntil: now + ttlMs,
  };
}

export const SCENARIOS: Scenario[] = [
  {
    id: "routine",
    title: "Routine API purchase",
    kind: "normal",
    story: "Agent hits an x402 paywall on a weather API and pays 12 USDC for a block of forecast calls.",
    expect: "Allowed by R4 and submitted.",
    build: (now) => [{ label: "Forecast credits", at: now, signed: signRequirement(req("stratus", 12, "1,000 forecast calls", "/v2/forecast", now)) }],
  },
  {
    id: "reroute",
    title: "Man-in-the-middle payTo reroute",
    kind: "attack",
    story: "A compromised proxy between agent and merchant swaps the payTo address for an attacker wallet. Amount, merchant name and resource look untouched.",
    expect: "Blocked at integrity: merchant signature no longer verifies.",
    build: (now) => [{ label: "Hotel deposit", at: now, signed: signRequirement(req("kestrel", 64, "Hotel deposit, 1 night", "/checkout/8812", now)), tamper: { payTo: ATTACKER } }],
  },
  {
    id: "replay",
    title: "Replay of a settled request",
    kind: "attack",
    story: "Agent retries after a timeout and resubmits the exact signed requirement it already paid.",
    expect: "First payment allowed, duplicate blocked on nonce.",
    build: (now) => {
      const signed = signRequirement(req("stratus", 12, "1,000 forecast calls", "/v2/forecast", now));
      return [
        { label: "Forecast credits", at: now, signed },
        { label: "Same request, resent", at: now + 20_000, signed },
      ];
    },
  },
  {
    id: "injection",
    title: "Prompt-injected merchant",
    kind: "attack",
    story: "Agent reads a page with hidden text telling it to buy 'discounted compute' from free-gpu-credits.xyz. The merchant signs a perfectly valid request.",
    expect: "Blocked at mandate: merchant not on the user's allowlist. R2 and R1 would also catch it.",
    build: (now) => {
      const r = req("freegpu", 40, "10,000 GPU credits (80% off)", "/claim", now);
      return [{ label: "Injected purchase", at: now, signed: signRequirement(r) }];
    },
  },
  {
    id: "overcap",
    title: "Single payment over cap",
    kind: "governance",
    story: "Agent decides a reserved GPU block is the cheapest option and tries to pay 480 USDC at once.",
    expect: "Blocked at mandate: per-payment cap.",
    build: (now) => [{ label: "Reserved GPU block", at: now, signed: signRequirement(req("ridgeline", 480, "8x H200, 24h reserved", "/reserve", now)) }],
  },
  {
    id: "drain",
    title: "Looping agent drains wallet",
    kind: "attack",
    story: "A bug puts the agent in a retry loop buying 45 USDC GPU hours every 90 seconds. Each payment alone is in policy.",
    expect: "First three allowed, then velocity and daily caps stop the loop.",
    build: (now) =>
      Array.from({ length: 6 }, (_, i) => ({
        label: `GPU hour #${i + 1}`,
        at: now + i * 90_000,
        signed: signRequirement(req("ridgeline", 45, "1x H200 hour", "/burst", now + i * 90_000)),
      })),
  },
  {
    id: "escalation",
    title: "In mandate, needs a human",
    kind: "governance",
    story: "Agent books a 92 USDC flight change. User's mandate allows it. The organization wants eyes on any agent payment over 75.",
    expect: "Mandate passes. R3 routes it to an approver instead of signing.",
    build: (now) => [{ label: "Flight change fee", at: now, signed: signRequirement(req("kestrel", 92, "Change fee, DCA to JFK", "/change/AX44", now)) }],
  },
  {
    id: "kyt",
    title: "Trusted merchant, flagged address",
    kind: "governance",
    story: "User trusts Lumen Data Feeds and the agent has paid them before. Overnight their payout address was flagged severe by KYT.",
    expect: "Mandate passes. R1 blocks on KYT before anything signs.",
    build: (now) => [{ label: "Market data top-up", at: now, signed: signRequirement(req("lumen", 20, "Tick data, 1 month", "/subscribe", now)) }],
  },
  {
    id: "revoked",
    title: "User revoked the agent",
    kind: "governance",
    story: "User pulled the agent's authority from their wallet app. The agent still holds an old session and tries a normal purchase.",
    expect: "Blocked at delegation: grant revoked.",
    forceRevoked: true,
    build: (now) => [{ label: "Forecast credits", at: now, signed: signRequirement(req("stratus", 12, "1,000 forecast calls", "/v2/forecast", now)) }],
  },
  {
    id: "stale",
    title: "Stale queued request",
    kind: "attack",
    story: "Agent queued a quote 20 minutes ago and submits it after the merchant's validity window closed.",
    expect: "Blocked at integrity: expired.",
    build: (now) => [{ label: "Queued quote", at: now, signed: signRequirement(req("ridgeline", 30, "Spot GPU, quoted", "/spot", now - 20 * MIN, 5 * MIN)) }],
  },
];

export function buildRun(scenarioId: string, settings: MandateSettings, now = Date.now()): { input: RunInput; scenario: Scenario; mandate: Mandate } {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(`unknown scenario ${scenarioId}`);
  const mandate: Mandate = {
    agentId: "agent:procurement-01",
    agentName: "Procurement agent",
    delegatedBy: "wallet-owner@acme-fintech.example",
    maxPerPayment: settings.maxPerPayment,
    dailyCap: settings.dailyCap,
    velocity: { count: settings.velocityCount, windowMinutes: settings.velocityWindowMinutes },
    merchants: ["stratus", "ridgeline", "kestrel", "lumen"],
    assets: ["USDC"],
    notBefore: now - 3600_000,
    expiresAt: now + 7 * 24 * 3600_000,
    revoked: settings.revoked || !!scenario.forceRevoked,
  };
  return {
    scenario,
    mandate,
    input: { grant: signGrant(mandate), merchants: MERCHANTS, attempts: scenario.build(now) },
  };
}

/** What the browser needs to render scenarios (no build functions). */
export const SCENARIO_META = SCENARIOS.map(({ id, title, kind, story, expect }) => ({ id, title, kind, story, expect }));
