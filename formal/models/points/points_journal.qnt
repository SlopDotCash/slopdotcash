// @source src/lib/points.ts
// @source src/lib/verified-aggregation.ts
// @source src/lib/payout-points.ts
// @source src/lib/verified-global-joins.ts
// @source src/lib/score-penalties.ts
// @source src/lib/score-records.ts
// @source scripts/generate-points.ts
// @source scripts/vault-payout-points.ts
// One actor/month. Immutable successor revisions, bounded debit, frozen payout.
module points_journal {
  type S = { revision: int, earned: int, debit: int, funded: bool, frozenAward: int,
    paidRecognition: int, paymentKind: int, visible: bool }
  var s: S
  action init = s' = { revision: 0, earned: 0, debit: 0, funded: false, frozenAward: 0, paidRecognition: 0, paymentKind: 0, visible: true }
  val effective = s.earned - s.debit
  action earn = all { s.revision < 4, s' = s.with("revision", s.revision+1).with("earned", s.earned+10) }
  action penalize = all { effective >= 10, s.revision < 4,
    s' = s.with("revision", s.revision+1).with("debit", s.debit+10) }
  action reverse = all { s.debit >= 10, s.revision < 4,
    s' = s.with("revision", s.revision+1).with("debit", s.debit-10) }
  action freeze = all { not(s.funded), effective > 0, s' = s.with("funded", true).with("frozenAward", effective) }
  // 1 is finalized ordinary mainnet evidence with a proven month; the other
  // finite cases are none, reserved, bounty, testnet and an unproven month.
  // Retries and other networks share this same actor/project/month slot.
  action observePayment(kind: int): bool = s' = s.with("paymentKind", kind)
  action close = s' = s.with("visible", false)
  action recognizePayment = if (s.paymentKind == 1 and s.visible)
    s' = s.with("paidRecognition", 25) else s' = s
  action step = any { earn, penalize, reverse, freeze, recognizePayment, close,
    { nondet kind = Set(0,1,2,3,4,5).oneOf()
      observePayment(kind) }, s' = s }
  val invariant = all { effective >= 0, s.funded implies s.frozenAward > 0, s.revision <= 4,
    Set(0,25).contains(s.paidRecognition) }
  run penaltyKeepsFundedTest = init.then(earn).then(freeze).then(penalize).expect(s.frozenAward == 10 and effective == 0 and invariant)
  run recognitionNotRewardTest = init.then(observePayment(1)).then(recognizePayment).expect(s.paidRecognition == 25 and effective == 0 and invariant)
  run repeatedTransferTest = init.then(observePayment(1)).then(recognizePayment).then(recognizePayment).expect(s.paidRecognition == 25 and invariant)
  run retainedAfterClosureTest = init.then(observePayment(1)).then(recognizePayment).then(close).then(recognizePayment).expect(s.paidRecognition == 25 and invariant)
  run closedAccountTest = init.then(observePayment(1)).then(close).then(recognizePayment).expect(s.paidRecognition == 0 and invariant)
  run unprovenPaymentTest = init.then(observePayment(5)).then(recognizePayment).expect(s.paidRecognition == 0 and invariant)
  run reservedPaymentTest = init.then(observePayment(2)).then(recognizePayment).expect(s.paidRecognition == 0 and invariant)
  run bountyPaymentTest = init.then(observePayment(3)).then(recognizePayment).expect(s.paidRecognition == 0 and invariant)
  run testnetPaymentTest = init.then(observePayment(4)).then(recognizePayment).expect(s.paidRecognition == 0 and invariant)
  run reverseDebitTest = init.then(earn).then(penalize).then(reverse).expect(effective == 10 and invariant)
}
