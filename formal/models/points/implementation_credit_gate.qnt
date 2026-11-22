// @source src/lib/leaderboard.ts
// @source src/lib/commit-credit.ts
// @source scripts/value-ingestion.ts
// @source scripts/retained-commit-credit.ts
// @source scripts/generate-leaderboard.ts
// @evidence scripts/retained-attribution-hold.test.ts
// @evidence scripts/commit-credit.test.ts
// Finite selection gate for one accepted source. A complete first-owner proof
// can show all ordinary commits already credited. An attribution proof gap is
// distinct from transport/identity failure and never revokes retained Points.
// The single-parent acceptance identity is an authenticated input, not an author
// or a changed-line weight. The model abstracts transport and Git tree evidence.
module implementation_credit_gate {
  var s: { selected: bool, complete: bool, duplicate: bool, held: bool,
    fatal: bool, credited: bool, retained: int }
  action init = s' = { selected: false, complete: false, duplicate: false,
    held: false, fatal: false, credited: false, retained: 10 }
  action selectSource(complete: bool, duplicate: bool, held: bool, fatal: bool): bool = all {
    not(s.selected), s' = s.with("selected", true).with("complete", complete)
      .with("duplicate", duplicate).with("held", held).with("fatal", fatal)
  }
  action selectZeroLineWork(carriesEarlierWork: bool, hasIndependentPaths: bool): bool =
    selectSource(true, false, carriesEarlierWork and not(hasIndependentPaths), false)
  action selectCommitCensus(rollingFallback: bool, hasCommitRows: bool): bool =
    selectSource(hasCommitRows, false, rollingFallback and not(hasCommitRows), false)
  action selectPromotedAcceptance(earlierAcceptance: bool, sameRepository: bool, independentWork: bool): bool =
    selectSource(true, earlierAcceptance and sameRepository and not(independentWork), false, false)
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
  run carriedSquashAcceptanceGetsNoNewCreditTest = init.then(selectPromotedAcceptance(true, true, false))
    .expect(invariant).then(credit.fail())
  run acceptedSquashDoesNotSuppressIndependentWorkTest = init.then(selectPromotedAcceptance(true, true, true))
    .then(credit).expect(s.credited and invariant)
  run missingOrCrossRepositorySquashIdentityCanScoreTest =
    init.then(selectPromotedAcceptance(false, true, false)).then(credit)
      .expect(s.credited and invariant)
    .then(init).then(selectPromotedAcceptance(true, false, false)).then(credit)
      .expect(s.credited and invariant)
  run emptyPromotionKeepsPriorPointsTest = init.then(selectZeroLineWork(true, false))
    .expect(s.retained == 10 and invariant).then(credit.fail())
  run noCommitRowsHoldFreshCreditTest = init.then(selectCommitCensus(true, false))
    .expect(s.held and s.retained == 10 and invariant).then(credit.fail())
  run nonemptyCommitCensusCanScoreTest = init.then(selectCommitCensus(true, true))
    .then(credit).expect(s.credited and invariant)
  run noRowsInHistoricalReplayKeepsFallbackTest = init.then(selectCommitCensus(false, false))
    .then(credit).expect(s.credited and invariant)
  run zeroLineWorkWithIndependentPathsCanScoreTest = init.then(selectZeroLineWork(true, true))
    .then(credit).expect(s.credited and invariant)
  run missingOwnershipIsNotDuplicateProofTest = init.then(selectSource(false, true, false, false))
    .then(credit).expect(s.credited and invariant)
  run transportFailureDoesNotBecomeCreditTest = init.then(selectSource(false, false, false, true))
    .expect(invariant).then(credit.fail())
}
