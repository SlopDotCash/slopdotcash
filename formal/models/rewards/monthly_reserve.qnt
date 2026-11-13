// @source backend/payments/monthly.ts
// @source backend/payments/monthly-attestation.ts
// @source backend/payments/monthly-publication.ts
// @source contracts/evm/monthly-reserve.ts
// @source contracts/solana/monthly-reserve.ts
// @source contracts/solana/monthly-commitment.ts
// @source workers/payment-executor/monthly.ts
// @source workers/payment-executor/solana-monthly.ts
// @source workers/payments/index.ts
// @source scripts/prepare-monthly-rewards.ts
// ProjectEscrow.reserveMonthly/commitMonthlyLeaf; backend/payments/monthly.ts.
// Full funding precedes admission; leaf materialization survives later owner opt-out.
module monthly_reserve {
  type S = { free: int, pending: int, awardReserved: int, paid: int,
    enabled: bool, window: bool, admitted: bool, leaves: Set[int] }
  var s: S
  action init = s' = { free: 4, pending: 0, awardReserved: 0, paid: 0,
    enabled: true, window: true, admitted: false, leaves: Set() }
  action admit = all { s.enabled, s.window, not(s.admitted), s.free >= 4,
    s' = s.with("free", s.free - 4).with("pending", 4).with("admitted", true) }
  action leaf(id: int): bool = all { s.admitted, not(s.leaves.contains(id)), s.pending >= 2,
    s' = s.with("pending", s.pending - 2).with("awardReserved", s.awardReserved + 2).with("leaves", s.leaves.union(Set(id))) }
  action pay = all { s.awardReserved >= 2,
    s' = s.with("awardReserved", s.awardReserved - 2).with("paid", s.paid + 2) }
  action disable = s' = s.with("enabled", false)
  action closeWindow = s' = s.with("window", false)
  action step = any { admit, leaf(1), leaf(2), pay, disable, closeWindow, s' = s }
  val invariant = all { s.free >= 0, s.pending >= 0, s.awardReserved >= 0,
    s.free + s.pending + s.awardReserved + s.paid == 4,
    s.leaves.size() <= 2, not(s.admitted) implies s.pending == 0 }
  run optOutPreservesFundedTest = init.then(admit).then(disable).then(closeWindow).then(leaf(1)).then(leaf(2)).then(pay).then(pay).expect(s.paid == 4 and invariant)
  run duplicateLeafTest = init.then(admit).then(leaf(1)).then(leaf(1).fail())
  run closedAdmissionTest = init.then(closeWindow).then(admit.fail())
}
