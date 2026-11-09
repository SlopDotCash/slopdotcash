// @source migrations/0108_private_direct_payments.sql
// @source migrations/0109_direct_payment_transfer_receipts.sql
// @source migrations/0112_direct_payment_recovery.sql
// @source migrations/0113_direct_unpaid_leg_recovery.sql
// @source backend/security/direct-payments.ts
// @source backend/security/verified-direct-recovery.ts
// Direct private-bounty payment: a researcher leg (0) and a fee leg (1), each a
// separate EVM transfer at its own reserved payer nonce. Paid requires a
// verified receipt for both legs (0109). A successor generation (0113) may
// replace one unpaid leg's nonce, and only the researcher leg's recipient,
// after a finalized cancellation consumed that leg's current nonce
// (direct-payments.ts retirement). A paid leg is never reissued, and the fee
// transfer (`transfers[1]`) is fixed. Payer nonces are consumed in order, so a
// higher nonce waits for every lower one (`lowerConsumed`). The initial
// preparation reserves base and base+1 and passes them reversed
// (direct-payments.ts `[nonces[1], nonces[0]]`), so the researcher leg
// (transactions[0], leg_index 0) holds base+1 and the fee leg holds base: the
// researcher transfer waits for the fee nonce.
//
// Ghost state: `issued` holds every signed request ever released as
// (nonce, leg, recipient); `consumed` records how the chain used each nonce as
// (nonce, kind) with kind 0/1 for a leg transfer and 2 for a cancellation;
// `transfers` records (leg, recipient) for every executed transfer.
// Bounds: one case, researcher wallets 1 and 2, fee wallet 0, two successor
// generations, so at most four reserved nonces.
module bounty_payment {
  type S = { approved: bool, wallet: bool, prepared: bool, generation: int,
    nonce0: int, nonce1: int, next: int, issued: Set[(int, int, int)],
    consumed: Set[(int, int)], transfers: Set[(int, int)], receipts: Set[int], paid: bool }
  var s: S
  action init = s' = { approved: false, wallet: false, prepared: false, generation: 0,
    nonce0: 0, nonce1: 0, next: 1, issued: Set(), consumed: Set(), transfers: Set(),
    receipts: Set(), paid: false }

  def isConsumed(n: int): bool = s.consumed.exists(c => c._1 == n)
  def lowerConsumed(n: int): bool = 1.to(n - 1).forall(m => isConsumed(m))
  def nonceOf(leg: int): int = if (leg == 0) s.nonce0 else s.nonce1

  action approve = all { not(s.approved), s' = s.with("approved", true) }
  action bindWallet = all { not(s.wallet), s' = s.with("wallet", true) }
  // 0108/0112: the intent and both nonce reservations are inserted together.
  action prepare = all { s.approved, s.wallet, not(s.prepared),
    s' = s.with("prepared", true).with("nonce0", 2).with("nonce1", 1).with("next", 3)
      .with("issued", Set((2, 0, 1), (1, 1, 0))) }
  // Chain: any released request may execute at its unconsumed nonce, in order.
  action execute(n: int, leg: int, recipient: int): bool = all {
    s.issued.contains((n, leg, recipient)), not(isConsumed(n)), lowerConsumed(n),
    s' = s.with("consumed", s.consumed.union(Set((n, leg))))
      .with("transfers", s.transfers.union(Set((leg, recipient)))) }
  // The original payer cancels a reserved nonce with a self-transfer.
  action cancel(n: int): bool = all { n >= 1, n < s.next, not(isConsumed(n)), lowerConsumed(n),
    s' = s.with("consumed", s.consumed.union(Set((n, 2)))) }
  // Receipt verification binds the transfer to the leg's current nonce.
  action verify(leg: int): bool = all { s.prepared, not(s.receipts.contains(leg)),
    s.consumed.contains((nonceOf(leg), leg)),
    s' = s.with("receipts", s.receipts.union(Set(leg))) }
  action reconcile = all { s.receipts == Set(0, 1), not(s.paid), s' = s.with("paid", true) }
  // 0113 successor: unpaid award, unpaid leg, finalized cancellation of that
  // leg's nonce. The fee leg keeps its recipient.
  action successor(leg: int, recipient: int): bool = all {
    s.prepared, not(s.paid), s.generation < 2, not(s.receipts.contains(leg)),
    s.consumed.contains((nonceOf(leg), 2)),
    if (leg == 1) recipient == 0 else recipient != 0,
    s' = s.with("generation", s.generation + 1).with("next", s.next + 1)
      .with("nonce0", if (leg == 0) s.next else s.nonce0)
      .with("nonce1", if (leg == 1) s.next else s.nonce1)
      .with("issued", s.issued.union(Set((s.next, leg, recipient)))) }

  action step = any { approve, bindWallet, prepare, reconcile,
    nondet n = 1.to(4).oneOf()
    any { cancel(n), execute(n, 0, 1), execute(n, 0, 2), execute(n, 1, 0) },
    verify(0), verify(1),
    successor(0, 1), successor(0, 2), successor(1, 0), s' = s }

  val invariant = all {
    // Each leg is paid at most once, whatever request executed.
    s.transfers.filter(t => t._1 == 0).size() <= 1,
    s.transfers.filter(t => t._1 == 1).size() <= 1,
    s.transfers.forall(t => t._1 == 1 implies t._2 == 0),
    s.consumed.forall(a => s.consumed.forall(b => a._1 == b._1 implies a == b)),
    s.receipts.forall(leg => s.consumed.contains((nonceOf(leg), leg))),
    s.paid implies s.receipts == Set(0, 1),
    s.prepared implies s.approved and s.wallet,
    s.generation <= 2, s.next <= 5 }

  run preparedRun = init.then(approve).then(bindWallet).then(prepare)
  // The fee leg holds the lower nonce, so the fee transfer lands first.
  run partialRemainsUnpaidTest = preparedRun.then(execute(1, 1, 0)).then(verify(1))
    .then(reconcile.fail())
  run researcherWaitsForFeeNonceTest = preparedRun.then(execute(2, 0, 1).fail())
  run completeTest = preparedRun.then(execute(1, 1, 0)).then(execute(2, 0, 1)).then(verify(0))
    .then(verify(1)).then(reconcile).expect(s.paid and invariant)
  run noResendAfterPaidTest = preparedRun.then(execute(1, 1, 0)).then(execute(2, 0, 1)).then(verify(0))
    .then(verify(1)).then(reconcile).then(cancel(3).fail())
  run successorWithoutCancellationRefusedTest = preparedRun.then(successor(0, 2).fail())
  run researcherSuccessorAfterCancellationTest = preparedRun.then(execute(1, 1, 0)).then(verify(1))
    .then(cancel(2)).then(successor(0, 2)).then(execute(2, 0, 1).fail())
  run cancelledResearcherRequestPaysNewWalletOnceTest = preparedRun.then(execute(1, 1, 0)).then(verify(1))
    .then(cancel(2)).then(successor(0, 2)).then(execute(3, 0, 2)).then(verify(0)).then(reconcile)
    .expect(s.paid and s.transfers == Set((0, 2), (1, 0)) and invariant)
  run paidResearcherLegNotReissuedTest = preparedRun.then(execute(1, 1, 0)).then(execute(2, 0, 1))
    .then(verify(0)).then(successor(0, 2).fail())
  run unpaidFeeLegSuccessorTest = preparedRun.then(cancel(1)).then(successor(1, 0))
    .then(execute(2, 0, 1)).then(execute(3, 1, 0)).then(verify(0)).then(verify(1)).then(reconcile)
    .expect(s.paid and s.generation == 1 and invariant)
  run feeLegCannotRedirectTest = preparedRun.then(cancel(1)).then(successor(1, 2).fail())
  run lowerNonceBlocksResearcherCancellationTest = preparedRun.then(cancel(2).fail())
  run unverifiedLandedLegBlocksSuccessorTest = preparedRun.then(execute(1, 1, 0))
    .then(successor(1, 0).fail())
}
