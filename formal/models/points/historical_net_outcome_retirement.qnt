// @source scripts/historical-net-outcome.ts
// @source scripts/reviewed-historical-points.ts
// @source scripts/run-reviewed-historical-points.ts
// @evidence scripts/historical-net-outcome.test.ts
// Reviewed native retirement covers all final first-parent path changes and
// can retire only an existing ordinary pool in an unprotected project month.
module historical_net_outcome_retirement {
  type Scope = {
    allPaths: bool,
    submittedRange: bool,
    earlierOrdinaryAwards: bool,
    chronological: bool,
    trustedVerification: bool,
    exactReview: bool,
    protectedMonth: bool,
  }

  var scope: Scope
  var observed: bool
  var retired: bool
  var otherBalance: int

  action init = all {
    scope' = {allPaths: false, submittedRange: false, earlierOrdinaryAwards: false,
      chronological: false, trustedVerification: false, exactReview: false,
      protectedMonth: true},
    observed' = false,
    retired' = false,
    otherBalance' = 30,
  }

  action observe(paths: bool, submission: bool, earlier: bool, chronology: bool,
    trusted: bool, review: bool, protection: bool): bool = all {
    not(observed),
    scope' = {allPaths: paths, submittedRange: submission, earlierOrdinaryAwards: earlier,
      chronological: chronology, trustedVerification: trusted, exactReview: review,
      protectedMonth: protection},
    observed' = true,
    retired' = retired,
    otherBalance' = otherBalance,
  }

  val allowed = observed and scope.allPaths and scope.submittedRange and
    scope.earlierOrdinaryAwards and scope.chronological and scope.trustedVerification
    and scope.exactReview and not(scope.protectedMonth)

  action record = all {
    allowed,
    scope' = scope,
    observed' = observed,
    retired' = true,
    otherBalance' = otherBalance,
  }

  action step = any {
    observe(true, true, true, true, true, true, false),
    observe(false, true, true, true, true, true, false),
    observe(true, false, true, true, true, true, false),
    observe(true, true, false, true, true, true, false),
    observe(true, true, true, false, true, true, false),
    observe(true, true, true, true, false, true, false),
    observe(true, true, true, true, true, false, false),
    observe(true, true, true, true, true, true, true),
    record,
    all { scope' = scope, observed' = observed, retired' = retired, otherBalance' = otherBalance },
  }
  val invariant = (retired implies allowed) and otherBalance == 30

  run verifiedDuplicateOnlyTest = init
    .then(observe(true, true, true, true, true, true, false)).then(record)
    .expect(retired and invariant)
  run missingPathRefusesTest = init
    .then(observe(false, true, true, true, true, true, false)).then(record.fail())
  run partialSubmittedRangeRefusesTest = init
    .then(observe(true, false, true, true, true, true, false)).then(record.fail())
  run missingEarlierAwardRefusesTest = init
    .then(observe(true, true, false, true, true, true, false)).then(record.fail())
  run reverseChronologyRefusesTest = init
    .then(observe(true, true, true, false, true, true, false)).then(record.fail())
  run unverifiedObjectsRefuseTest = init
    .then(observe(true, true, true, true, false, true, false)).then(record.fail())
  run unreviewedRetirementRefusesTest = init
    .then(observe(true, true, true, true, true, false, false)).then(record.fail())
  run protectedMonthRefusesTest = init
    .then(observe(true, true, true, true, true, true, true)).then(record.fail())
}
