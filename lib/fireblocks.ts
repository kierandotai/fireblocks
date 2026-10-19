// Server-side only. Used by scripts/sandbox.ts, never bundled into the static site.
import { Fireblocks, BasePath } from "@fireblocks/ts-sdk";
import type { AttemptResult } from "./engine";
import { buildTransactionRequest } from "./txRequest";

export interface SubmitResult {
  status: string;
  txId?: string;
  error?: string;
  request: ReturnType<typeof buildTransactionRequest>;
}

export function liveConfigured(): boolean {
  return !!(process.env.FIREBLOCKS_API_KEY && process.env.FIREBLOCKS_SECRET_KEY && process.env.FIREBLOCKS_AGENT_VAULT_ID);
}

export async function submit(result: AttemptResult): Promise<SubmitResult> {
  const request = buildTransactionRequest(result.requirement, {
    assetId: process.env.FIREBLOCKS_ASSET_ID,
    vaultId: process.env.FIREBLOCKS_AGENT_VAULT_ID,
  });
  try {
    const fb = new Fireblocks({
      apiKey: process.env.FIREBLOCKS_API_KEY!,
      secretKey: (process.env.FIREBLOCKS_SECRET_KEY ?? "").replace(/\\n/g, "\n"),
      basePath: process.env.FIREBLOCKS_BASE_PATH ?? BasePath.Sandbox,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await fb.transactions.createTransaction(request as any);
    return { status: res.data?.status ?? "SUBMITTED", txId: res.data?.id, request };
  } catch (e) {
    return { status: "ERROR", error: (e instanceof Error ? e.message : String(e)).slice(0, 300), request };
  }
}
