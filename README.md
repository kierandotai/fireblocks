# Agent Spend Guard

A reference integration for agent-initiated stablecoin payments on Fireblocks: an AI agent pays merchants in USDC from a Fireblocks vault, and every payment has to clear four gates before anything signs.

**Live demo:** _link added after deploy_

Unofficial demo by Kieran Sweeney. Not affiliated with or endorsed by Fireblocks.

## Why I built this

Fireblocks launched the Agentic Payments Suite and joined the x402 Foundation with a security extension for request integrity and spend governance. The product pages describe the controls (spend limits, merchant allowlists, time windows, per-delegation rules, protection from man-in-the-middle rerouting) but there is no agent-specific developer guide yet showing how those pieces fit together in an integration.

This is the integration I would build in week one with a PSP or fintech customer adopting the suite: the reference flow their engineers can read, run, and argue with. I work on agent credential delegation in the IETF (WIMSE and OAuth working groups), so the delegation and mandate layer is the part I care most about getting right.

## How it works

Each payment attempt passes through four gates in order. The first failure stops it.

1. **Request integrity.** The merchant's x402-style payment requirement is signed with the merchant's Ed25519 key over canonical JSON. The gate checks the signature, the validity window, and that the nonce has not been used. A proxy that swaps `payTo` breaks the signature, so the payment stops before any policy evaluates a destination that was never the merchant's.
2. **Delegation grant.** The wallet owner's signed grant to the agent must verify, be inside its validity window, and not be revoked.
3. **Mandate scope.** The grant's scope: per-payment cap, rolling 24h cap, velocity limit, merchant allowlist, asset allowlist.
4. **Workspace policy.** Ordered first-match rules modeled on Fireblocks Policy Engine semantics (KYT block, whitelisted destinations only, human approval above a threshold, an allow rule, default block), with an Inspector-style trace of every rule and why it did or did not match.

Gates 2 and 3 are the user's authority over the agent. Gate 4 is the organization's authority over everyone. A payment needs both.

```
agent ──x402 request──▶ [1 integrity] ─▶ [2 grant] ─▶ [3 mandate] ─▶ [4 policy] ─▶ createTransaction
                          merchant sig     user sig     caps, lists     first-match     sandbox or dry run
```

Allowed payments are turned into a Fireblocks `createTransaction` request built with the official TypeScript SDK (`@fireblocks/ts-sdk`). The x402 nonce is used as both `externalTxId` and the request idempotency key, so a replay that somehow passed gate 1 still could not create a second transaction.

### Scenarios

| Scenario | Stops at | Why |
| --- | --- | --- |
| Routine API purchase | allowed | R4 |
| Man-in-the-middle payTo reroute | integrity | merchant signature fails |
| Replay of a settled request | integrity | nonce reused |
| Prompt-injected merchant | mandate | not on user allowlist |
| Looping agent drains wallet | mandate | velocity after 3 payments |
| Stale queued request | integrity | expired |
| Single payment over cap | mandate | per-payment cap |
| In mandate, needs a human | policy | R3 approval above 75 USDC |
| Trusted merchant, flagged address | policy | R1 KYT severe |
| User revoked the agent | delegation | grant revoked |

The mandate is editable in the UI, so you can raise caps and watch payments move from a mandate block to a policy decision.

## What is real and what is not

Real: Ed25519 signing and verification, the gate logic, the rule engine, and the `createTransaction` request shape. These run on every click and are covered by tests (`npm test`).

Fixtures: merchants, addresses, KYT ratings, the workspace policy, and the delegation grant format. The policy is modeled on Policy Engine behavior, not loaded from a workspace. The public deployment runs in dry-run mode and shows the request it would send.

## What I would do next with access

- Load the real workspace policy through the policy API and evaluate against it instead of the local model, so the Inspector trace matches the console exactly.
- Replace the demo grant with Agent Wallets delegations from the embedded wallet stack, and the local integrity check with the x402 security extension once its spec is public.
- Feed blocked attempts into Security Posture Management as signals: an agent repeatedly hitting the same gate is worth an alert.
- Express the delegation grant as an OAuth token exchange (RFC 8693) with an actor claim, so the agent's authority is a standard token any facilitator can verify.

## Run locally

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # engine tests
```

To submit allowed payments to a Fireblocks sandbox workspace, copy `.env.example` to `.env.local` and set `FIREBLOCKS_API_KEY`, `FIREBLOCKS_SECRET_KEY`, `FIREBLOCKS_AGENT_VAULT_ID`, and `FIREBLOCKS_ASSET_ID`. A toggle appears in the UI. Give the API user the minimum role it needs.

## Layout

- `lib/engine.ts` gates, signing, policy evaluation
- `lib/scenarios.ts` merchants, mandate, attack scenarios
- `lib/fireblocks.ts` `createTransaction` request and sandbox submit
- `app/api/run/route.ts` runs a scenario
- `components/GuardConsole.tsx` the UI

Built by [Kieran Sweeney](https://kieran.ai).
