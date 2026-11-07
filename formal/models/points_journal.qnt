// @source src/lib/points.ts
// @source src/lib/payout-points.ts
// @source src/lib/score-penalties.ts
// @source src/lib/score-records.ts
// @source scripts/generate-points.ts
// One actor/month. Immutable successor revisions, bounded debit, frozen payout.
module points_journal {
  type S = { revision: int, earned: int, debit: int, funded: bool, frozenAward: int,
    paidRecognition: int }
  var s: S
  action init = s' = { revision: 0, earned: 0, debit: 0, funded: false, frozenAward: 0, paidRecognition: 0 }
  val effective = s.earned - s.debit
  action earn = all { s.revision < 4, s' = s.with("revision", s.revision+1).with("earned", s.earned+10) }
  action penalize = all { effective >= 10, s.revision < 4,
    s' = s.with("revision", s.revision+1).with("debit", s.debit+10) }
  action reverse = all { s.debit >= 10, s.revision < 4,
    s' = s.with("revision", s.revision+1).with("debit", s.debit-10) }
  action freeze = all { not(s.funded), effective > 0, s' = s.with("funded", true).with("frozenAward", effective) }
  action recognizePayment = s' = s.with("paidRecognition", 10)
  action step = any { earn, penalize, reverse, freeze, recognizePayment, s' = s }
  val invariant = all { effective >= 0, s.funded implies s.frozenAward > 0, s.revision <= 4 }
  run penaltyKeepsFundedTest = init.then(earn).then(freeze).then(penalize).expect(s.frozenAward == 10 and effective == 0 and invariant)
  run recognitionNotRewardTest = init.then(recognizePayment).expect(effective == 0 and invariant)
  run reverseDebitTest = init.then(earn).then(penalize).then(reverse).expect(effective == 10 and invariant)
}
