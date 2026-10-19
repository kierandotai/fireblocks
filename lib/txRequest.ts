import type { PaymentRequirement } from "./engine";

/**
 * The createTransaction request the agent runtime sends for an allowed payment.
 * The x402 nonce doubles as externalTxId and the Fireblocks idempotency key, so a replay
 * that slipped past the integrity gate still could not create a second transaction
 * within the 24h idempotency window.
 */
export function buildTransactionRequest(r: PaymentRequirement, opts: { assetId?: string; vaultId?: string } = {}) {
  return {
    transactionRequest: {
      assetId: opts.assetId ?? "USDC_TEST",
      source: { type: "VAULT_ACCOUNT", id: opts.vaultId ?? "<agent-ops vault id>" },
      destination: { type: "ONE_TIME_ADDRESS", oneTimeAddress: { address: r.payTo } },
      amount: String(r.amount),
      note: `x402 ${r.merchantId} ${r.resource}`.slice(0, 200),
      externalTxId: r.nonce,
    },
    idempotencyKey: r.nonce,
  };
}
