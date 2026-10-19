import type { AttemptResult } from "./engine";

export interface SubmitResult {
  mode: "live" | "dry-run";
  status: string;
  txId?: string;
  error?: string;
  request: Record<string, unknown>;
}

export function liveConfigured(): boolean {
  return !!(process.env.FIREBLOCKS_API_KEY && process.env.FIREBLOCKS_SECRET_KEY && process.env.FIREBLOCKS_AGENT_VAULT_ID);
}

function secretKey(): string {
  // Vercel env vars often store PEM with literal \n
  return (process.env.FIREBLOCKS_SECRET_KEY ?? "").replace(/\\n/g, "\n");
}

/**
 * Builds the exact createTransaction request the agent runtime would send, and sends it
 * to the Fireblocks sandbox when keys are configured. The x402 nonce doubles as the
 * Fireblocks idempotency key, so a replay that slipped past our gate still could not
 * create a second transaction within the 24h idempotency window.
 */
export async function submit(result: AttemptResult, live: boolean): Promise<SubmitResult> {
  const r = result.requirement;
  const request = {
    transactionRequest: {
      assetId: process.env.FIREBLOCKS_ASSET_ID ?? "USDC_TEST",
      source: { type: "VAULT_ACCOUNT", id: process.env.FIREBLOCKS_AGENT_VAULT_ID ?? "<agent-ops vault id>" },
      destination: { type: "ONE_TIME_ADDRESS", oneTimeAddress: { address: r.payTo } },
      amount: String(r.amount),
      note: `x402 ${r.merchantId} ${r.resource}`.slice(0, 200),
      externalTxId: r.nonce,
    },
    idempotencyKey: r.nonce,
  };

  if (!live || !liveConfigured()) {
    return { mode: "dry-run", status: "NOT_SENT", request };
  }

  try {
    const { Fireblocks, BasePath } = await import("@fireblocks/ts-sdk");
    const fb = new Fireblocks({
      apiKey: process.env.FIREBLOCKS_API_KEY!,
      secretKey: secretKey(),
      basePath: process.env.FIREBLOCKS_BASE_PATH ?? BasePath.Sandbox,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await fb.transactions.createTransaction(request as any);
    return { mode: "live", status: res.data?.status ?? "SUBMITTED", txId: res.data?.id, request };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { mode: "live", status: "ERROR", error: msg.slice(0, 300), request };
  }
}
