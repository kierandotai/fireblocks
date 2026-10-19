import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/engine";
import { buildRun, DEFAULT_SETTINGS, type MandateSettings } from "@/lib/scenarios";
import { liveConfigured, submit } from "@/lib/fireblocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clamp(n: unknown, lo: number, hi: number, fallback: number) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

export async function POST(req: Request) {
  let body: { scenarioId?: string; settings?: Partial<MandateSettings>; live?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const s = body.settings ?? {};
  const settings: MandateSettings = {
    maxPerPayment: clamp(s.maxPerPayment, 1, 10_000, DEFAULT_SETTINGS.maxPerPayment),
    dailyCap: clamp(s.dailyCap, 1, 100_000, DEFAULT_SETTINGS.dailyCap),
    velocityCount: clamp(s.velocityCount, 1, 100, DEFAULT_SETTINGS.velocityCount),
    velocityWindowMinutes: clamp(s.velocityWindowMinutes, 1, 1440, DEFAULT_SETTINGS.velocityWindowMinutes),
    revoked: !!s.revoked,
  };

  let built;
  try {
    built = buildRun(String(body.scenarioId ?? "routine"), settings);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const results = runPipeline(built.input);
  const withSubmit = await Promise.all(
    results.map(async (r) => ({ ...r, submit: r.decision === "ALLOW" ? await submit(r, !!body.live) : null })),
  );

  return NextResponse.json({
    scenario: built.scenario.id,
    mandate: built.mandate,
    grantSignature: built.input.grant.signature,
    liveAvailable: liveConfigured(),
    results: withSubmit,
  });
}

export async function GET() {
  return NextResponse.json({ liveAvailable: liveConfigured() });
}
