/**
 * Run a scenario through the gates and submit every allowed payment to a Fireblocks
 * sandbox workspace with the official SDK.
 *
 *   cp .env.example .env.local   # fill in sandbox credentials
 *   npm run sandbox -- routine
 *   npm run sandbox -- drain
 */
import { readFileSync, existsSync } from "node:fs";
import { runPipeline } from "../lib/engine";
import { buildRun, DEFAULT_SETTINGS, SCENARIOS } from "../lib/scenarios";
import { liveConfigured, submit } from "../lib/fireblocks";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const id = process.argv[2] ?? "routine";
if (!SCENARIOS.find((s) => s.id === id)) {
  console.error(`Unknown scenario "${id}". Options: ${SCENARIOS.map((s) => s.id).join(", ")}`);
  process.exit(1);
}
if (!liveConfigured()) {
  console.error("Set FIREBLOCKS_API_KEY, FIREBLOCKS_SECRET_KEY and FIREBLOCKS_AGENT_VAULT_ID in .env.local");
  process.exit(1);
}

async function main() {
  const results = runPipeline(buildRun(id, DEFAULT_SETTINGS).input);
  for (const r of results) {
    const line = `#${r.index + 1} ${r.label}: ${r.decision} (${r.reason})`;
    if (r.decision !== "ALLOW") {
      console.log(line);
      continue;
    }
    const s = await submit(r);
    console.log(`${line} -> Fireblocks ${s.status}${s.txId ? ` ${s.txId}` : ""}${s.error ? ` ${s.error}` : ""}`);
  }
}

main();
