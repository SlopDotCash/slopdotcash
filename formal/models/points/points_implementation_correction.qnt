// @source src/lib/points.ts
// @source src/lib/leaderboard.ts
// @source src/lib/leaderboard-types.ts
// @evidence scripts/points-implementation-attribution.test.ts
// One existing ten-Point award and one complete-snapshot correction. A proof
// is abstracted as complete/current source-bound primary-author evidence.
// External GitHub identity and snapshot integrity remain separate boundaries.
module points_implementation_correction {
  var s: { configured: bool, proof: bool, provisional: bool, decided: bool,
    recipient: bool, amount: int, revisions: int, corrected: bool }
  action init = s' = { configured: false, proof: false, provisional: true,
    decided: false, recipient: true, amount: 10, revisions: 1, corrected: false }
  action configure(proof: bool, provisional: bool, decided: bool, recipient: bool): bool = all {
    not(s.configured), s' = s.with("configured", true).with("proof", proof)
      .with("provisional", provisional).with("decided", decided).with("recipient", recipient)
  }
  action correct = all { s.configured, s.proof, s.provisional, not(s.decided),
    not(s.recipient), not(s.corrected),
    s' = s.with("amount", 0).with("revisions", 2).with("corrected", true) }
  action retry = s' = s
  action oldMissingValueReplacement = all { s.configured, s.recipient,
    s' = s.with("amount", 0) }
  action step = if (s.configured) any { correct, retry } else any {
    { nondet proof = Set(false, true).oneOf()
      nondet provisional = Set(false, true).oneOf()
      nondet decided = Set(false, true).oneOf()
      nondet recipient = Set(false, true).oneOf()
      configure(proof, provisional, decided, recipient) }, retry
  }
  val invariant = all {
    Set(1, 2).contains(s.revisions),
    s.corrected implies s.configured and s.proof and s.provisional and not(s.decided) and not(s.recipient),
    (not(s.corrected) implies s.amount == 10),
    s.corrected implies s.amount == 0 and s.revisions == 2,
    (s.recipient or s.decided or not(s.provisional)) implies s.amount == 10
  }
  run phantomCarrierCorrectionIsAppendedOnceTest = init.then(configure(true, true, false, false))
    .then(correct).then(retry).expect(s.revisions == 2 and s.amount == 0 and invariant)
  run retainedContributorValueIsNotReplacedTest = init.then(configure(true, true, false, true))
    .expect(s.amount == 10 and invariant).then(correct.fail())
  run sourceBoundAwardIsRetainedTest = init.then(configure(true, true, true, false))
    .expect(s.amount == 10 and invariant).then(correct.fail())
  run finalAwardIsRetainedTest = init.then(configure(true, false, false, false))
    .expect(s.amount == 10 and invariant).then(correct.fail())
  run missingOrIncompleteProofCannotRemoveTest = init.then(configure(false, true, false, false))
    .expect(s.amount == 10 and invariant).then(correct.fail())
  run oldReplacementNegativeControlTest = init.then(configure(true, true, false, true))
    .then(oldMissingValueReplacement).expect(not(invariant))
}
