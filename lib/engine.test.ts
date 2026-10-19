import { test } from "node:test";
import assert from "node:assert/strict";
import { runPipeline } from "./engine";
import { buildRun, DEFAULT_SETTINGS, SCENARIOS } from "./scenarios";

const run = (id: string, settings = DEFAULT_SETTINGS) => runPipeline(buildRun(id, settings).input);

test("routine purchase is allowed by R4", () => {
  const [r] = run("routine");
  assert.equal(r.decision, "ALLOW");
  assert.match(r.reason, /^R4/);
});

test("payTo reroute fails merchant signature", () => {
  const [r] = run("reroute");
  assert.equal(r.decision, "BLOCK");
  assert.equal(r.stoppedAt, "integrity");
  assert.ok(r.tampered);
});

test("replay is blocked on nonce", () => {
  const [a, b] = run("replay");
  assert.equal(a.decision, "ALLOW");
  assert.equal(b.decision, "BLOCK");
  assert.match(b.reason, /Nonce/);
});

test("prompt-injected merchant blocked by mandate allowlist", () => {
  const [r] = run("injection");
  assert.equal(r.stoppedAt, "mandate");
  assert.match(r.reason, /allowlist/);
});

test("over-cap blocked by per-payment cap", () => {
  const [r] = run("overcap");
  assert.match(r.reason, /Per-payment cap/);
});

test("drain loop: three allowed then velocity stops it", () => {
  const rs = run("drain");
  assert.deepEqual(rs.map((r) => r.decision), ["ALLOW", "ALLOW", "ALLOW", "BLOCK", "BLOCK", "BLOCK"]);
  assert.match(rs[3].reason, /Velocity|24h/);
});

test("escalation routes to approval via R3", () => {
  const [r] = run("escalation");
  assert.equal(r.decision, "REQUIRE_APPROVAL");
  assert.match(r.reason, /^R3/);
});

test("KYT-flagged address blocked by R1 even though mandate passes", () => {
  const [r] = run("kyt");
  assert.equal(r.steps.find((s) => s.id === "mandate")?.status, "pass");
  assert.match(r.reason, /^R1/);
});

test("revoked grant blocked at delegation", () => {
  const [r] = run("revoked");
  assert.equal(r.stoppedAt, "delegation");
});

test("stale request blocked as expired", () => {
  const [r] = run("stale");
  assert.match(r.reason, /expired/);
});

test("raising the cap lets the over-cap payment through to policy", () => {
  const [r] = run("overcap", { ...DEFAULT_SETTINGS, maxPerPayment: 500, dailyCap: 1000 });
  assert.equal(r.steps.find((s) => s.id === "mandate")?.status, "pass");
  assert.equal(r.decision, "REQUIRE_APPROVAL");
});

test("every scenario produces four steps per attempt", () => {
  for (const s of SCENARIOS) for (const r of run(s.id)) assert.equal(r.steps.length, 4, s.id);
});
