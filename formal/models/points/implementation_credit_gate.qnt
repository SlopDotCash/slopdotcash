// @source src/lib/leaderboard.ts
// @source scripts/value-ingestion.ts
// @source scripts/retained-commit-credit.ts
// @evidence scripts/retained-attribution-hold.test.ts
// @evidence scripts/commit-credit.test.ts
// Finite selection gate for one accepted source. A complete first-owner proof
// can show all ordinary commits already credited. An attribution proof gap is
// distinct from transport/identity failure and never revokes retained Points.
module implementation_credit_gate {
  var s: { selected: bool, complete: bool, duplicate: bool, held: bool,
    fatal: bool, credited: bool, retained: int }
  action init = s' = { selected: false, complete: false, duplicate: false,
    held: false, fatal: false, credited: false, retained: 10 }
  action selectSource(complete: bool, duplicate: bool, held: bool, fatal: bool): bool = all {
    not(s.selected), s' = s.with("selected", true).with("complete", complete)
      .with("duplicate", duplicate).with("held", held).with("fatal", fatal)
  }
  action credit = all { s.selected, not(s.fatal), not(s.held),
    not(s.complete and s.duplicate), s' = s.with("credited", true) }
  action retry = s' = s
  action step = if (s.selected) any { credit, retry } else {
    nondet complete = Set(false, true).oneOf()
    nondet duplicate = Set(false, true).oneOf()
    nondet held = Set(false, true).oneOf()
    nondet fatal = Set(false, true).oneOf()
    selectSource(complete, duplicate, held, fatal)
  }
  val invariant = all { s.retained == 10,
    s.credited implies s.selected and not(s.fatal) and not(s.held) and not(s.complete and s.duplicate) }
  run heldSourceKeepsPriorPointsTest = init.then(selectSource(true, false, true, false))
    .expect(s.retained == 10 and invariant).then(credit.fail())
  run completeDuplicateGetsNoNewCreditTest = init.then(selectSource(true, true, false, false))
    .expect(invariant).then(credit.fail())
  run missingOwnershipIsNotDuplicateProofTest = init.then(selectSource(false, true, false, false))
    .then(credit).expect(s.credited and invariant)
  run transportFailureDoesNotBecomeCreditTest = init.then(selectSource(false, false, false, true))
    .expect(invariant).then(credit.fail())
}
