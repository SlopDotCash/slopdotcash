/**
 * Reviewed per-network switch for mainnet payout execution. A mainnet network
 * executes payouts only when its value here is exactly `true`. A value
 * changes only through a reviewed pull request that records that network's
 * production activation: signer custody, verified deployment and monitoring.
 * Test networks do not use this switch. A network that is not listed is
 * rejected.
 *
 * base-mainnet activation (owner Shaw, 24 October 2026: "Yes, build the Base
 * mainnet payment activation PR: production attester Worker and deploy job,
 * dispatcher, Pages payment bindings, and base-mainnet execution on. I'll
 * install the attester key and RPC secret myself."):
 * - Signer custody: the owner installs the attester key for the identity
 *   authority 0x31B87d13f9091bC3b8A5cb6F45C8b3cB99Ed6d70 as the
 *   SIGNER_PRIVATE_KEY secret of slop-payments-base-mainnet-attester only.
 *   Slop holds no relayer key (PRD section 6).
 * - Verified deployment: factory proxy
 *   0xe51AbF8c6Dbb3Ca6E9AD09F2dc6EF141d7364aAb on Base 8453, recorded in
 *   contracts/DEPLOY-MAINNET.md. The attester signs only for vaults pinned
 *   from the reviewed registry snapshot, and verifies the factory code on
 *   every request.
 * - Monitoring: the attester's cron run fails loudly in the Cloudflare
 *   Worker logs, and `bun run payments:readiness` reports the stack. No
 *   alerting service exists.
 * Every other mainnet stays off.
 */
export const MAINNET_EXECUTION = Object.freeze({
  "base-mainnet": true,
  ethereum: false,
  "robinhood-mainnet": false,
  "solana-mainnet": false,
});

export function mainnetExecutionEnabled(network) {
  return (
    Object.hasOwn(MAINNET_EXECUTION, network) &&
    MAINNET_EXECUTION[network] === true
  );
}
