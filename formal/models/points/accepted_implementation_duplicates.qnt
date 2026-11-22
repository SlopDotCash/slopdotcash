// @source scripts/accepted-implementation-digests.ts
// @source scripts/accepted-implementation-history.ts
// @source scripts/generate-leaderboard.ts
// @source src/lib/leaderboard.ts
// Ordinary scoring uses complete native acceptance evidence and earlier positive
// credit at the collection cutoff. Existing journal entries retain their value.
module accepted_implementation_duplicates {
  type S = {
    observed: bool,
    sameRepository: bool,
    exactChange: bool,
    creditedEarlier: bool,
    unresolvedComparison: bool,
    ordinaryFallback: bool,
    decided: bool,
    hold: bool,
  }
  var s: S

  action init = s' = {
    observed: false,
    sameRepository: false,
    exactChange: false,
    creditedEarlier: false,
    unresolvedComparison: false,
    ordinaryFallback: false,
    decided: false,
    hold: false,
  }
  action observe(repository: bool, change: bool, earlier: bool, unresolved: bool, fallback: bool): bool = all {
    not(s.observed),
    s' = s.with("observed", true)
      .with("sameRepository", repository)
      .with("exactChange", change)
      .with("creditedEarlier", earlier)
      .with("unresolvedComparison", unresolved)
      .with("ordinaryFallback", fallback),
  }
  val eligibleHold = s.sameRepository and s.ordinaryFallback and
    (s.unresolvedComparison or (s.exactChange and s.creditedEarlier))
  action decide = all {
    s.observed,
    not(s.decided),
    s' = s.with("decided", true).with("hold", eligibleHold),
  }
  action step = any {
    observe(true, true, true, false, true),
    observe(false, true, true, false, true),
    observe(true, false, true, false, true),
    observe(true, true, false, false, true),
    observe(true, true, true, false, false),
    observe(true, false, false, true, true),
    observe(true, false, false, true, false),
    decide,
    s' = s,
  }
  val invariant = s.decided implies s.hold == eligibleHold

  run earlierExactCreditHoldsFallbackTest = init
    .then(observe(true, true, true, false, true)).then(decide).expect(s.hold and invariant)
  run sameSizeDifferentContentKeepsFallbackTest = init
    .then(observe(true, false, true, false, true)).then(decide).expect(not(s.hold) and invariant)
  run independentRepositoryKeepsFallbackTest = init
    .then(observe(false, true, true, false, true)).then(decide).expect(not(s.hold) and invariant)
  run retiredOrLatePriorKeepsFallbackTest = init
    .then(observe(true, true, false, false, true)).then(decide).expect(not(s.hold) and invariant)
  run reviewedDecisionKeepsAuthorityTest = init
    .then(observe(true, true, true, false, false)).then(decide).expect(not(s.hold) and invariant)
  run unavailableComparisonHoldsOrdinaryFallbackTest = init
    .then(observe(true, false, false, true, true)).then(decide).expect(s.hold and invariant)
  run unavailableComparisonPreservesReviewedDecisionTest = init
    .then(observe(true, false, false, true, false)).then(decide).expect(not(s.hold) and invariant)
}
