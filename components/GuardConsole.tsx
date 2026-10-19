"use client";

import { useCallback, useEffect, useState } from "react";
import { runPipeline, type AttemptResult, type Decision, type Merchant, type Step } from "@/lib/engine";
import { buildRun, type MandateSettings } from "@/lib/scenarios";
import { buildTransactionRequest } from "@/lib/txRequest";

interface ScenarioMeta {
  id: string;
  title: string;
  kind: "normal" | "attack" | "governance";
  story: string;
  expect: string;
}

type Result = AttemptResult & { submit: { request: ReturnType<typeof buildTransactionRequest> } | null };

interface RunResponse {
  scenario: string;
  results: Result[];
}

const KIND_LABEL = { normal: "Baseline", attack: "Attacks", governance: "Governance" } as const;

const DECISION_STYLE: Record<Decision, string> = {
  ALLOW: "bg-teal/15 text-teal border-teal/40",
  BLOCK: "bg-pink/15 text-pink border-pink/40",
  REQUIRE_APPROVAL: "bg-gold/15 text-gold border-gold/40",
};

const DECISION_TEXT: Record<Decision, string> = { ALLOW: "Allowed", BLOCK: "Blocked", REQUIRE_APPROVAL: "Needs approval" };

const STEP_STYLE: Record<Step["status"], string> = {
  pass: "border-teal/50 text-teal",
  fail: "border-pink/60 text-pink",
  warn: "border-gold/60 text-gold",
  skip: "border-navy-400 text-genesis-500",
};

const STEP_ICON: Record<Step["status"], string> = { pass: "✓", fail: "✕", warn: "!", skip: "–" };

function short(addr: string) {
  return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export default function GuardConsole({
  scenarios,
  defaults,
  merchants,
  policy,
}: {
  scenarios: ScenarioMeta[];
  defaults: MandateSettings;
  merchants: Merchant[];
  policy: { id: string; name: string; action: Decision }[];
}) {
  const [active, setActive] = useState("reroute");
  const [settings, setSettings] = useState<MandateSettings>(defaults);
  const [data, setData] = useState<RunResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(0);

  // Runs entirely in the browser: real Ed25519 signing and verification, real rule evaluation.
  const run = useCallback((id: string, s: MandateSettings) => {
    setLoading(true);
    setError(null);
    try {
      const { input } = buildRun(id, s);
      const results: Result[] = runPipeline(input).map((r) => ({
        ...r,
        submit: r.decision === "ALLOW" ? { request: buildTransactionRequest(r.requirement) } : null,
      }));
      setData({ scenario: id, results });
      const firstStop = results.findIndex((r) => r.decision !== "ALLOW");
      setOpen(firstStop === -1 ? 0 : firstStop);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTimeout(() => setLoading(false), 150);
    }
  }, []);

  useEffect(() => {
    run(active, settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const scenario = scenarios.find((s) => s.id === active)!;
  const groups = (["normal", "attack", "governance"] as const).map((k) => ({ k, items: scenarios.filter((s) => s.kind === k) }));
  const counts = data?.results.reduce(
    (a, r) => ({ ...a, [r.decision]: (a[r.decision] ?? 0) + 1 }),
    {} as Partial<Record<Decision, number>>,
  );

  const field = (key: keyof Omit<MandateSettings, "revoked">, label: string, suffix: string) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-genesis-400">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          min={1}
          value={settings[key]}
          onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
          className="w-20 rounded border border-navy-400 bg-navy-900 px-2 py-1 text-right font-mono text-white focus:border-bandwidth focus:outline-none"
        />
        <span className="w-10 font-mono text-xs text-genesis-500">{suffix}</span>
      </span>
    </label>
  );

  return (
    <section className="mt-8 grid gap-6 lg:grid-cols-12">
      {/* left rail */}
      <aside className="order-2 min-w-0 space-y-5 lg:order-1 lg:col-span-4">
        <div className="rounded-lg border border-navy-500 bg-navy/80 p-4">
          {groups.map(({ k, items }) => (
            <div key={k} className="mb-4 last:mb-0">
              <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-genesis-500">{KIND_LABEL[k]}</p>
              <ul className="space-y-1">
                {items.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setActive(s.id)}
                      className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                        active === s.id ? "bg-bandwidth-500 text-white" : "text-genesis-200 hover:bg-navy-500"
                      }`}
                    >
                      {s.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-navy-500 bg-navy/80 p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium text-white">Delegated mandate</p>
            <span className="font-mono text-[11px] text-genesis-500">signed by wallet owner</span>
          </div>
          <div className="mt-3 space-y-2">
            {field("maxPerPayment", "Per-payment cap", "USDC")}
            {field("dailyCap", "Rolling 24h cap", "USDC")}
            {field("velocityCount", "Max payments", "")}
            {field("velocityWindowMinutes", "per window", "min")}
            <label className="flex items-center justify-between pt-1 text-sm">
              <span className="text-genesis-400">Revoke agent</span>
              <input
                type="checkbox"
                checked={settings.revoked}
                onChange={(e) => setSettings({ ...settings, revoked: e.target.checked })}
                className="h-4 w-4 accent-pink"
              />
            </label>
          </div>
          <p className="mt-3 text-xs text-genesis-500">
            Merchants: {merchants.filter((m) => m.id !== "freegpu").map((m) => m.name).join(", ")}. Asset: USDC.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => run(active, settings)}
              className="rounded-md bg-bandwidth-500 px-4 py-2 text-sm font-medium text-white hover:bg-bandwidth-600 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? "Running…" : "Re-run with mandate"}
            </button>
            <button onClick={() => setSettings(defaults)} className="text-xs text-genesis-500 hover:text-white">
              Reset
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-navy-500 bg-navy/80 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-white">Fireblocks submit</span>
            <span className="rounded border border-navy-400 px-2 py-0.5 font-mono text-[11px] text-genesis-500">dry run</span>
          </div>
          <p className="mt-2 text-xs text-genesis-500">
            Allowed payments show the exact createTransaction request the agent runtime sends. Run <code className="font-mono text-genesis-200">npm run sandbox</code> from the repo to send them to a sandbox workspace.
          </p>
        </div>

        <div className="rounded-lg border border-navy-500 bg-navy/80 p-4">
          <p className="font-medium text-white">Workspace policy</p>
          <ol className="mt-3 space-y-1.5">
            {policy.map((r) => (
              <li key={r.id} className="flex gap-2 text-xs">
                <span className="w-6 shrink-0 font-mono text-genesis-500">{r.id}</span>
                <span className={`w-16 shrink-0 font-mono ${r.action === "ALLOW" ? "text-teal" : r.action === "BLOCK" ? "text-pink" : "text-gold"}`}>
                  {r.action === "REQUIRE_APPROVAL" ? "APPROVE" : r.action}
                </span>
                <span className="text-genesis-400">{r.name}</span>
              </li>
            ))}
          </ol>
        </div>
      </aside>

      {/* main */}
      <div className="order-1 min-w-0 space-y-4 lg:order-2 lg:col-span-8">
        <div className="rounded-lg border border-navy-500 bg-navy/80 p-5">
          <label className="mb-4 block lg:hidden">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-genesis-500">Scenario</span>
            <select
              value={active}
              onChange={(e) => setActive(e.target.value)}
              className="w-full rounded-md border border-navy-400 bg-navy-900 px-3 py-2 text-sm text-white focus:border-bandwidth focus:outline-none"
            >
              {groups.map(({ k, items }) => (
                <optgroup key={k} label={KIND_LABEL[k]}>
                  {items.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <p className="font-mono text-[11px] uppercase tracking-widest text-bandwidth">{KIND_LABEL[scenario.kind]}</p>
          <h2 className="mt-1 text-xl font-semibold text-white">{scenario.title}</h2>
          <p className="mt-2 text-genesis-400">{scenario.story}</p>
          <p className="mt-3 text-sm">
            <span className="text-genesis-500">Expected: </span>
            <span className="text-genesis-200">{scenario.expect}</span>
          </p>
          {counts && (
            <div className="mt-4 flex flex-wrap gap-2">
              {(Object.keys(counts) as Decision[]).map((d) => (
                <span key={d} className={`rounded border px-2 py-0.5 font-mono text-xs ${DECISION_STYLE[d]}`}>
                  {counts[d]} {DECISION_TEXT[d].toLowerCase()}
                </span>
              ))}
            </div>
          )}
        </div>

        {error && <div className="rounded-lg border border-pink/50 bg-pink/10 p-4 text-sm text-pink">Run failed: {error}</div>}

        <div className={`space-y-3 transition-opacity ${loading ? "opacity-50" : ""}`}>
          {data?.results.map((r, i) => (
            <AttemptCard key={`${data.scenario}-${i}`} r={r} open={open === i} onToggle={() => setOpen(open === i ? -1 : i)} />
          ))}
        </div>
      </div>
    </section>
  );
}

function AttemptCard({ r, open, onToggle }: { r: Result; open: boolean; onToggle: () => void }) {
  return (
    <article className="overflow-hidden rounded-lg border border-navy-500 bg-navy/80">
      <button onClick={onToggle} className="flex w-full flex-col gap-3 p-4 text-left sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-genesis-500">#{r.index + 1}</span>
            <span className="font-medium text-white">{r.label}</span>
            {r.tampered && <span className="rounded bg-pink/15 px-1.5 py-0.5 font-mono text-[10px] text-pink">tampered in transit</span>}
          </div>
          <p className="mt-1 truncate text-sm text-genesis-400">
            {r.requirement.amount} {r.requirement.asset} to {r.merchant?.domain ?? r.requirement.merchantId} · payTo{" "}
            <span className={`font-mono ${r.tampered ? "text-pink" : ""}`}>{short(r.requirement.payTo)}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {r.steps.map((s) => (
              <span key={s.id} title={`${s.label}: ${s.summary}`} className={`flex h-6 w-6 items-center justify-center rounded border font-mono text-xs ${STEP_STYLE[s.status]}`}>
                {STEP_ICON[s.status]}
              </span>
            ))}
          </div>
          <span className={`whitespace-nowrap rounded border px-2 py-1 text-xs font-medium ${DECISION_STYLE[r.decision]}`}>{DECISION_TEXT[r.decision]}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-navy-500 px-4 pb-4 pt-3">
          <p className="mb-3 text-sm text-genesis-200">
            <span className="text-genesis-500">Reason: </span>
            {r.reason}
          </p>
          <div className="space-y-3">
            {r.steps.map((s, i) => (
              <div key={s.id} className={`rounded-md border-l-2 bg-navy-900/60 p-3 ${STEP_STYLE[s.status].split(" ")[0]}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">
                    {i + 1}. {s.label}
                  </span>
                  <span className={`font-mono text-xs ${STEP_STYLE[s.status].split(" ")[1]}`}>{s.status.toUpperCase()}</span>
                </div>
                <p className="mt-1 text-xs text-genesis-400">{s.summary}</p>
                {s.checks.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {s.checks.map((c) => (
                      <li key={c.name} className="flex gap-2 text-xs">
                        <span className={c.ok ? "text-teal" : "text-pink"}>{c.ok ? "✓" : "✕"}</span>
                        <span className="w-32 shrink-0 text-genesis-200">{c.name}</span>
                        <span className="text-genesis-400">{c.note}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {s.rules && (
                  <div className="mt-2 overflow-x-auto">
                    <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-genesis-500">Policy inspector</p>
                    <table className="w-full text-left text-xs">
                      <tbody>
                        {s.rules.map((rule) => (
                          <tr key={rule.id} className={`border-t border-navy-500 ${rule.matched ? "bg-bandwidth-500/10" : ""}`}>
                            <td className="py-1.5 pr-2 font-mono text-genesis-500">{rule.id}</td>
                            <td className="whitespace-nowrap py-1.5 pr-2 font-mono">
                              {!rule.evaluated ? (
                                <span className="text-genesis-500">skipped</span>
                              ) : rule.matched ? (
                                <span className="text-bandwidth">MATCH</span>
                              ) : (
                                <span className="text-genesis-400">no match</span>
                              )}
                            </td>
                            <td className="py-1.5 pr-2 text-genesis-200">{rule.name}</td>
                            <td className="py-1.5 text-genesis-500">{rule.reasons.join("; ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>

          {r.submit && (
            <div className="mt-3 rounded-md border border-teal/30 bg-navy-900/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">Fireblocks createTransaction</span>
                <span className="font-mono text-xs text-teal">
                  dry run · not sent
                </span>
              </div>
              <pre className="mt-2 overflow-x-auto rounded bg-navy-900 p-2 font-mono text-[11px] leading-relaxed text-genesis-200">
                {JSON.stringify(r.submit.request, null, 2)}
              </pre>
            </div>
          )}
          {r.decision === "REQUIRE_APPROVAL" && (
            <p className="mt-3 text-xs text-gold">Held for a human approver. In a live workspace this lands in the approval queue; nothing signs until it is approved.</p>
          )}
        </div>
      )}
    </article>
  );
}
