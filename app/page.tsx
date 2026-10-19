import GuardConsole from "@/components/GuardConsole";
import { DEFAULT_SETTINGS, MERCHANTS, SCENARIO_META } from "@/lib/scenarios";
import { WORKSPACE_POLICY } from "@/lib/engine";
import { liveConfigured } from "@/lib/fireblocks";

export const dynamic = "force-dynamic";

const REPO = "https://github.com/kierandotai/fireblocks";

const GATES = [
  { n: "1", t: "Request integrity", d: "Merchant-signed x402 requirement. Signature, expiry, nonce." },
  { n: "2", t: "Delegation grant", d: "User-signed grant to the agent. Validity window, revocation." },
  { n: "3", t: "Mandate scope", d: "Per-payment cap, 24h cap, velocity, merchant and asset allowlists." },
  { n: "4", t: "Workspace policy", d: "Ordered first-match rules, Inspector-style trace, then createTransaction." },
];

export default function Page() {
  const policy = WORKSPACE_POLICY.map(({ id, name, action }) => ({ id, name, action }));
  return (
    <main className="grid-bg overflow-x-hidden">
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
        <header className="flex flex-col gap-4 border-b border-navy-500 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-bandwidth">Agentic payments · reference integration</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Agent Spend Guard</h1>
            <p className="mt-2 max-w-2xl text-genesis-400">
              An AI agent pays merchants in USDC from a Fireblocks vault. Every payment has to clear four gates before anything signs.
              Pick a scenario and watch where it stops.
            </p>
          </div>
          <a href={REPO} className="inline-flex w-fit items-center gap-2 rounded-md border border-navy-400 px-3 py-2 text-sm text-genesis-200 hover:border-bandwidth hover:text-white">
            Source on GitHub
          </a>
        </header>

        <ol className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {GATES.map((g) => (
            <li key={g.n} className="rounded-lg border border-navy-500 bg-navy/70 p-3 sm:p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-bandwidth-500 font-mono text-xs text-white">{g.n}</span>
                <span className="text-sm font-medium text-white sm:text-base">{g.t}</span>
              </div>
              <p className="mt-2 hidden text-sm text-genesis-400 sm:block">{g.d}</p>
            </li>
          ))}
        </ol>

        <GuardConsole scenarios={SCENARIO_META} defaults={DEFAULT_SETTINGS} merchants={MERCHANTS} policy={policy} liveAvailable={liveConfigured()} />

        <section className="mt-14 grid gap-8 border-t border-navy-500 pt-10 md:grid-cols-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Two authorities, both required</h2>
            <p className="mt-2 text-sm leading-relaxed text-genesis-400">
              Gates 2 and 3 are what the user delegated to the agent. Gate 4 is what the organization allows anyone to do. The KYT and
              escalation scenarios show a payment the user authorized that the workspace still stops. The injection scenario shows the
              reverse: the workspace would catch it, but the mandate catches it first.
            </p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Integrity before authority</h2>
            <p className="mt-2 text-sm leading-relaxed text-genesis-400">
              Policy evaluates the destination it is shown. If a proxy swaps payTo in transit, a correct policy approves the wrong
              address. Verifying the merchant&apos;s signature over the full requirement closes that gap before any rule runs. The nonce is
              reused as the Fireblocks idempotency key, so a replay is stopped twice.
            </p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">What is real here</h2>
            <p className="mt-2 text-sm leading-relaxed text-genesis-400">
              Ed25519 signing and verification, the gate logic and the rule engine run for real on every click. Merchants, wallets and
              the policy are fixtures. The final step builds a real <code className="font-mono text-genesis-200">createTransaction</code> request with
              the official TypeScript SDK and sends it to a sandbox workspace when keys are set; otherwise it shows the payload.
            </p>
          </div>
        </section>
      </div>

      <footer className="border-t border-navy-500 bg-navy-900/90">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-genesis-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>Unofficial demo by Kieran Sweeney. Not affiliated with or endorsed by Fireblocks.</span>
          <span className="flex gap-4">
            <a className="hover:text-white" href="https://kieran.ai">kieran.ai</a>
            <a className="hover:text-white" href={REPO}>Repo</a>
          </span>
        </div>
      </footer>
    </main>
  );
}
