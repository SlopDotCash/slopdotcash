// @source migrations/0057_private_security_payments.sql
// @source migrations/0108_private_direct_payments.sql
// @source migrations/0109_direct_payment_transfer_receipts.sql
// @source backend/security/payments.ts
// @source backend/security/direct-payments.ts
// @source backend/security/payment-database.ts
// Separate researcher and fee transfers; finality of both is required for paid.
module bounty_payment {
  type S = { approved: bool, wallet: bool, prepared: bool, researcher: bool, fee: bool,
    paid: bool, superseded: bool, attempts: int }
  var s: S
  action init = s' = { approved: false, wallet: false, prepared: false, researcher: false,
    fee: false, paid: false, superseded: false, attempts: 0 }
  action approve = s' = s.with("approved", true)
  action bindWallet = s' = s.with("wallet", true)
  action prepare = all { s.approved, s.wallet, not(s.superseded), not(s.paid), s.attempts < 2,
    s' = s.with("prepared", true).with("attempts", s.attempts + 1) }
  action researcherFinal = all { s.prepared, not(s.researcher), s' = s.with("researcher", true) }
  action feeFinal = all { s.prepared, not(s.fee), s' = s.with("fee", true) }
  action reconcile = all { s.researcher, s.fee, s' = s.with("paid", true) }
  action successor = all { not(s.researcher), not(s.fee), not(s.paid), s' = s.with("superseded", true).with("prepared", false) }
  action step = any { approve, bindWallet, prepare, researcherFinal, feeFinal, reconcile, successor, s' = s }
  val invariant = all { s.paid implies (s.researcher and s.fee),
    (s.researcher or s.fee) implies s.approved }
  run partialRemainsUnpaidTest = init.then(approve).then(bindWallet).then(prepare).then(researcherFinal).expect(not(s.paid) and invariant)
  run completeTest = init.then(approve).then(bindWallet).then(prepare).then(researcherFinal).then(feeFinal).then(reconcile).expect(s.paid and invariant)
  run noResendAfterPaidTest = init.then(approve).then(bindWallet).then(prepare).then(researcherFinal).then(feeFinal).then(reconcile).then(prepare.fail())
}
