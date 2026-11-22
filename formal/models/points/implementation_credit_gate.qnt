// @source src/lib/leaderboard.ts
// @source src/lib/commit-credit.ts
// @source src/lib/points.ts
// @source scripts/value-ingestion.ts
// @source scripts/retained-commit-credit.ts
// @source scripts/generate-leaderboard.ts
// @source scripts/accepted-implementation-memo.ts
// @evidence scripts/retained-attribution-hold.test.ts
// @evidence scripts/commit-credit.test.ts
// @evidence scripts/implementation-line-scoring.test.ts
// @evidence scripts/value-review-eligibility.test.ts
// @evidence scripts/leaderboard-source-recovery.test.ts
// Finite selection gate for one accepted source. A complete first-owner proof
// can show all ordinary commits already credited. An attribution proof gap is
// distinct from transport/identity failure and never revokes retained Points.
// The acceptance identity is an authenticated input, separate from the author
// and changed-line weight. The model abstracts transport and Git tree evidence.
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
  action selectPreviousAcceptance(rollingFallback: bool, earlierPositive: bool, exactAcceptance: bool,
    sameRepository: bool, independentWork: bool): bool =
    selectPromotedAcceptance(rollingFallback and earlierPositive and exactAcceptance, sameRepository, independentWork)
  action selectPreviousSubmission(rollingFallback: bool, earlierExactCandidate: bool, nativeProof: str,
    independentWork: bool): bool = {
    val compare = rollingFallback and earlierExactCandidate
    selectSource(true, compare and nativeProof == "equal" and not(independentWork),
      compare and nativeProof == "unavailable", false)
  }
  action selectStandaloneAssessment(rolling: bool, earlierAcceptedOverlap: bool): bool =
    selectSource(true, false, rolling and earlierAcceptedOverlap, false)
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
  run previouslyRewardedSquashCannotScoreAgainTest =
    init.then(selectPreviousAcceptance(true, true, true, true, false))
      .expect(s.duplicate and invariant).then(credit.fail())
  run previousSquashDoesNotReplaceRatifiedOrIndependentlyAcceptedWorkTest =
    init.then(selectPreviousAcceptance(false, true, true, true, false)).then(credit)
      .expect(s.credited and invariant)
    .then(init).then(selectPreviousAcceptance(true, true, true, true, true)).then(credit)
      .expect(s.credited and invariant)
  run onlyExactEarlierPositiveSquashCanWithholdCreditTest =
    init.then(selectPreviousAcceptance(true, false, true, true, false)).then(credit)
      .expect(s.credited and invariant)
  run previousSubmittedCommitRequiresNativeAcceptanceTest =
    init.then(selectPreviousSubmission(true, true, "equal", false))
      .expect(s.duplicate and invariant).then(credit.fail())
    .then(init).then(selectPreviousSubmission(true, true, "different", false))
      .then(credit).expect(s.credited and invariant)
    .then(init).then(selectPreviousSubmission(true, true, "unavailable", true))
      .expect(s.held and invariant).then(credit.fail())
  run previousSubmittedCommitKeepsIndependentAndRatifiedWorkTest =
    init.then(selectPreviousSubmission(true, true, "equal", true))
      .then(credit).expect(s.credited and invariant)
    .then(init).then(selectPreviousSubmission(false, true, "unavailable", false))
      .then(credit).expect(s.credited and invariant)
    .then(init).then(selectPreviousAcceptance(true, true, false, true, false)).then(credit)
      .expect(s.credited and invariant)
  run standaloneAssessmentWithEarlierAcceptanceNeedsJointReviewTest =
    init.then(selectStandaloneAssessment(true, true))
      .expect(s.retained == 10 and s.held and invariant).then(credit.fail())
    .then(init).then(selectStandaloneAssessment(true, false))
      .then(credit).expect(s.credited and invariant)
    .then(init).then(selectStandaloneAssessment(false, true))
      .then(credit).expect(s.credited and invariant)
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
