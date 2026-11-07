import { securityPaymentDatabase } from "../../backend/security/payment-database";
import payments, { type PaymentsWorkerEnvironment } from "../payments";

/** Same recovery engine and approved executors; a separate private ledger and
 * private notifications. No fetch route and no public payment database binding. */
function privateEnvironment(
  env: PaymentsWorkerEnvironment,
): PaymentsWorkerEnvironment {
  return {
    ...env,
    PAYMENT_SCOPE: "security-bounty",
    PAYMENTS_DB: securityPaymentDatabase(env.REGISTRY_DB),
  };
}
export default {
  async scheduled(controller: unknown, env: PaymentsWorkerEnvironment) {
    const isolated = privateEnvironment(env);
    // A newly authorized wallet can arrive after the reserve was indexed.
    // A hold the dispatcher parked under an uncertain attempt on a prior
    // claim stays held until that attempt is reconciled: freeing it here
    // would let the next dispatch re-park it, and the reporter would see
    // the hold flicker back to uncertain in between.
    await isolated.PAYMENTS_DB.prepare(`INSERT INTO payment_outbox(obligation_id,state,updated_at)
      SELECT o.id,'ready',? FROM payment_obligations o JOIN effective_payment_wallet_claims w
      ON w.github_user_id=o.github_user_id AND w.chain=o.chain
      JOIN payment_wallet_authorizations a ON a.claim_id=w.id
      WHERE o.state='reserved'
      AND NOT EXISTS(SELECT 1 FROM payment_attempts attempt WHERE attempt.obligation_id=o.id AND attempt.state IN ('prepared','unknown','submitted') AND attempt.claim_id<>w.id)
      ON CONFLICT(obligation_id) DO UPDATE SET state='ready',updated_at=excluded.updated_at WHERE payment_outbox.state='held'`)
      .bind(new Date().toISOString())
      .run();
    return payments.scheduled(controller, isolated);
  },
};
