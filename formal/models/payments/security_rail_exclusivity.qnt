// @source migrations/0026_private_security_cases.sql
// @source migrations/0057_private_security_payments.sql
// @source migrations/0108_private_direct_payments.sql
// @source migrations/0109_direct_payment_transfer_receipts.sql
// @source migrations/0014_direct_payments.sql
// @source backend/security/handler.ts
// @source backend/security/payments.ts
// Vault and direct private-bounty rails are exclusive, and one public transfer
// is credited by at most one ledger.
//
// Database layer only: approval inserts are guarded by the schema, not by the
// handler's award-state and revision checks, and a case's root-cause key may
// change at any time. This over-approximates the handler, so the payment-level
// invariants hold even if the handler's approve-once check were bypassed.
// - 0026 UNIQUE(project_id,root_cause_key) and 0108 cross-table triggers: one
//   root cause has at most one award across both tables.
// - 0108 `security_direct_payments_no_vault` / `security_vault_payment_no_direct`:
//   one case has a vault settlement or a direct payment, never both.
// - handler.ts: vault preparation requires the case's reservation; direct
//   preparation requires the case's direct award.
// - 0109 UNIQUE(network,transaction_id) and the two replay triggers: a
//   transaction is one direct leg receipt or one ordinary disclosed transfer.
//   EVM proofs store lowercase hashes and the triggers compare with lower(),
//   so transactions are modeled as canonical values.
// Bounds: one project, two cases, two root causes, two transactions.
module security_rail_exclusivity {
  type S = { rootCause: int -> int, reservations: Set[(int, int)], directAwards: Set[(int, int)],
    settlements: Set[int], directPayments: Set[int], receipts: Set[(int, int, int)], ordinary: Set[int] }
  var s: S
  pure val Cases = Set(1, 2)
  pure val Txs = Set(1, 2)
  action init = s' = { rootCause: Cases.mapBy(c => c), reservations: Set(), directAwards: Set(),
    settlements: Set(), directPayments: Set(), receipts: Set(), ordinary: Set() }

  def rcTaken(r: int): bool = s.reservations.exists(a => a._2 == r) or s.directAwards.exists(a => a._2 == r)
  def hasReservation(c: int): bool = s.reservations.exists(a => a._1 == c)
  def hasDirectAward(c: int): bool = s.directAwards.exists(a => a._1 == c)
  def txUsed(tx: int): bool = s.receipts.exists(a => a._1 == tx)

  action setRootCause(c: int, r: int): bool = s' = s.with("rootCause", s.rootCause.set(c, r))
  action approveVault(c: int): bool = all { not(hasReservation(c)), not(rcTaken(s.rootCause.get(c))),
    s' = s.with("reservations", s.reservations.union(Set((c, s.rootCause.get(c))))) }
  action approveDirect(c: int): bool = all { not(hasDirectAward(c)), not(rcTaken(s.rootCause.get(c))),
    s' = s.with("directAwards", s.directAwards.union(Set((c, s.rootCause.get(c))))) }
  action prepareVault(c: int): bool = all { hasReservation(c), not(s.settlements.contains(c)),
    not(s.directPayments.contains(c)), s' = s.with("settlements", s.settlements.union(Set(c))) }
  action prepareDirect(c: int): bool = all { hasDirectAward(c), not(s.directPayments.contains(c)),
    not(s.settlements.contains(c)), s' = s.with("directPayments", s.directPayments.union(Set(c))) }
  action receipt(c: int, leg: int, tx: int): bool = all { s.directPayments.contains(c),
    not(txUsed(tx)), not(s.ordinary.contains(tx)),
    not(s.receipts.exists(a => a._2 == c and a._3 == leg)),
    s' = s.with("receipts", s.receipts.union(Set((tx, c, leg)))) }
  action importOrdinary(tx: int): bool = all { not(txUsed(tx)), not(s.ordinary.contains(tx)),
    s' = s.with("ordinary", s.ordinary.union(Set(tx))) }

  action step = any {
    nondet c = Cases.oneOf()
    nondet r = Set(1, 2).oneOf()
    nondet tx = Txs.oneOf()
    nondet leg = Set(0, 1).oneOf()
    any { setRootCause(c, r), approveVault(c), approveDirect(c), prepareVault(c), prepareDirect(c),
      receipt(c, leg, tx), importOrdinary(tx) },
    s' = s }

  val invariant = all {
    // One award per root cause across both rails.
    Set(1, 2).forall(r => s.reservations.filter(a => a._2 == r).size()
      + s.directAwards.filter(a => a._2 == r).size() <= 1),
    // One payment rail per case.
    s.settlements.intersect(s.directPayments) == Set(),
    s.settlements.forall(c => hasReservation(c)),
    s.directPayments.forall(c => hasDirectAward(c)),
    // One ledger and one leg per public transaction.
    s.receipts.forall(a => not(s.ordinary.contains(a._1))),
    s.receipts.forall(a => s.receipts.forall(b => a._1 == b._1 implies a == b)),
    s.receipts.forall(a => s.directPayments.contains(a._2)) }

  run vaultBlocksDirectForRootCauseTest = init.then(setRootCause(2, 1)).then(approveVault(1))
    .then(approveDirect(2).fail())
  run directBlocksVaultForRootCauseTest = init.then(setRootCause(2, 1)).then(approveDirect(1))
    .then(approveVault(2).fail())
  run settlementBlocksDirectPaymentTest = init.then(approveVault(1)).then(setRootCause(1, 2))
    .then(approveDirect(1)).then(prepareVault(1)).then(prepareDirect(1).fail())
  run directPaymentBlocksSettlementTest = init.then(approveDirect(1)).then(setRootCause(1, 2))
    .then(approveVault(1)).then(prepareDirect(1)).then(prepareVault(1).fail())
  run ordinaryTransferCannotBeReceiptTest = init.then(approveDirect(1)).then(prepareDirect(1))
    .then(importOrdinary(1)).then(receipt(1, 0, 1).fail())
  run receiptCannotBeOrdinaryTest = init.then(approveDirect(1)).then(prepareDirect(1))
    .then(receipt(1, 0, 1)).then(importOrdinary(1).fail())
  run oneTransactionOneLegTest = init.then(approveDirect(1)).then(approveDirect(2)).then(prepareDirect(1))
    .then(prepareDirect(2)).then(receipt(1, 0, 1)).then(receipt(2, 0, 1).fail())
  run bothLegsPaidTest = init.then(approveDirect(1)).then(prepareDirect(1)).then(receipt(1, 0, 1))
    .then(receipt(1, 1, 2)).expect(s.receipts.size() == 2 and invariant)
}
