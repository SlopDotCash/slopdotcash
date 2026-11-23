// @source scripts/historical-assessment-catalog.ts
// @source scripts/historical-assessment-reconciliation.ts
// @source scripts/historical-assessment-transport.ts
// @source scripts/historical-closed-review-source.ts
// @source scripts/historical-merged-replay.ts
// @source scripts/historical-replay-review.ts
// @source scripts/historical-value-replay.ts
// @evidence scripts/historical-assessment-reconciliation.test.ts
// @evidence scripts/historical-assessment-transport.test.ts
// @evidence scripts/historical-leaderboard-scope.test.ts
// @evidence scripts/historical-merged-replay.test.ts
// @evidence scripts/historical-replay-review.test.ts
// @evidence scripts/historical-value-replay.test.ts
// @source scripts/run-reviewed-historical-points.ts
// @source .github/workflows/reviewed-historical-points.yml
// The read-only path reports a conclusion at a fixed journal cut. Completeness
// requires both catalogs and exact records. Scope with an active assessment
// moves to value replay before owner review.
module historical_assessment_audit {
  type State = {
    phase: str,
    jointExpected: int,
    legacyExpected: int,
    jointRead: int,
    legacyRead: int,
    invalid: bool,
    relevant: bool,
    current: bool,
    status: str,
    reviewAvailable: bool,
    boundClosureReview: bool,
    retainedRemovedMerge: bool,
    rejectedRemovedMerge: bool,
    rejectedClosureReview: bool,
  }
  var s: State

  action init = s' = {
    phase: "idle",
    jointExpected: 0,
    legacyExpected: 0,
    jointRead: 0,
    legacyRead: 0,
    invalid: false,
    relevant: false,
    current: true,
    status: "unsealed",
    reviewAvailable: false,
    boundClosureReview: false,
    retainedRemovedMerge: false,
    rejectedRemovedMerge: false,
    rejectedClosureReview: false,
  }

  action capture(trusted: bool, scoped: bool, apply: bool, joint: int, legacy: int): bool = all {
    s.phase == "idle",
    trusted,
    scoped,
    not(apply),
    s' = s.with("phase", "reading").with("jointExpected", joint).with("legacyExpected", legacy),
  }

  action observe(joint: bool, valid: bool, activeInScope: bool): bool = all {
    s.phase == "reading",
    if (joint) s.jointRead < s.jointExpected else s.legacyRead < s.legacyExpected,
    s' = (if (joint) s.with("jointRead", s.jointRead + 1) else s.with("legacyRead", s.legacyRead + 1))
      .with("invalid", s.invalid or not(valid)).with("relevant", s.relevant or activeInScope),
  }

  action observeEmptyLegacyClosure(
    exactClosure: bool, emptyAssessment: bool, noFormalReviews: bool, noPriorAward: bool,
  ): bool = observe(false, exactClosure and emptyAssessment and noFormalReviews and noPriorAward, false)

  val complete = not(s.invalid) and s.jointRead == s.jointExpected and s.legacyRead == s.legacyExpected
  action changeCheckpoint(affectsScope: bool): bool = all {
    s.phase == "reading" or s.phase == "staged",
    s' = s.with("current", s.current and not(affectsScope)),
  }
  action bindClosureReview(
    matchingLifecycle: bool,
    auditedMergedAnchor: bool,
    standaloneReviewOnlyRecord: bool,
    exactSource: bool,
    sameAssessedReviewAndActor: bool,
    beforeClose: bool,
    reviewOnly: bool,
  ): bool = {
    val matches = matchingLifecycle and (auditedMergedAnchor or standaloneReviewOnlyRecord)
      and exactSource and sameAssessedReviewAndActor and beforeClose and reviewOnly
    all {
      s.phase == "reading",
      complete,
      s.relevant,
      s' = s.with("boundClosureReview", s.boundClosureReview or matches)
        .with("rejectedClosureReview", s.rejectedClosureReview or not(matches)),
    }
  }
  action bindRemovedMerge(
    nativeAcceptance: bool,
    exactPriorAward: bool,
    wholeGroupHeld: bool,
    preservedAwards: bool,
  ): bool = {
    val matches = nativeAcceptance and exactPriorAward and wholeGroupHeld and preservedAwards
    all {
      s.phase == "reading",
      complete,
      s.relevant,
      s' = s.with("retainedRemovedMerge", s.retainedRemovedMerge or matches)
        .with("rejectedRemovedMerge", s.rejectedRemovedMerge or not(matches)),
    }
  }
  action stageReview(explicit: bool, qualified: bool, verifiedReadback: bool): bool = all {
    s.phase == "reading",
    s.current,
    complete,
    not(s.rejectedClosureReview),
    not(s.rejectedRemovedMerge),
    explicit,
    qualified,
    verifiedReadback,
    s' = s.with("phase", "staged"),
  }
  action seal = all {
    s.phase == "reading" or s.phase == "staged",
    s.current,
    s' = s.with("phase", "sealed").with("reviewAvailable", s.phase == "staged").with(
      "status",
      if (complete and not(s.rejectedClosureReview) and not(s.rejectedRemovedMerge))
        (if (s.relevant) "requires-value-replay" else "no-scoped-active-assessments")
      else "incomplete"
    ),
  }

  action step = any {
    capture(true, true, false, 0, 0),
    capture(true, true, false, 1, 1),
    observe(true, true, true),
    observe(true, true, false),
    observe(true, false, false),
    observe(false, true, true),
    observe(false, true, false),
    observe(false, false, false),
    changeCheckpoint(true),
    changeCheckpoint(false),
    bindClosureReview(true, true, false, true, true, true, true),
    bindClosureReview(false, true, false, true, true, true, true),
    bindClosureReview(true, false, false, true, true, true, true),
    bindClosureReview(true, true, false, true, false, true, true),
    bindClosureReview(true, true, false, true, true, false, true),
    bindClosureReview(true, true, false, true, true, true, false),
    bindClosureReview(true, false, true, true, true, true, true),
    bindClosureReview(true, false, true, false, true, true, true),
    bindRemovedMerge(true, true, true, true),
    bindRemovedMerge(false, true, true, true),
    bindRemovedMerge(true, false, true, true),
    bindRemovedMerge(true, true, false, true),
    bindRemovedMerge(true, true, true, false),
    stageReview(true, true, true),
    seal,
    s' = s,
  }

  val invariant = all {
    s.status == "no-scoped-active-assessments" implies (complete and not(s.relevant)),
    s.status == "requires-value-replay" implies (complete and s.relevant),
    s.phase == "sealed" implies (s.status != "unsealed" and s.current),
    s.reviewAvailable implies (s.phase == "sealed" and complete and s.current and not(s.rejectedClosureReview)),
    s.boundClosureReview implies (complete and s.relevant),
    s.rejectedClosureReview implies (not(s.reviewAvailable) and s.status != "requires-value-replay"),
    s.rejectedRemovedMerge implies (not(s.reviewAvailable) and s.status != "requires-value-replay"),
    s.retainedRemovedMerge implies (complete and s.relevant),
  }

  run verifiedEmptyCutTest = init.then(capture(true, true, false, 0, 0))
    .then(seal).expect(s.status == "no-scoped-active-assessments" and invariant)
  run bothCatalogsRequiredTest = init.then(capture(true, true, false, 1, 1))
    .then(observe(true, true, false)).then(seal).expect(s.status == "incomplete" and invariant)
  run matchedActiveRecordRequiresReplayTest = init.then(capture(true, true, false, 1, 1))
    .then(observe(true, true, true)).then(observe(false, true, false))
    .then(seal).expect(s.status == "requires-value-replay" and invariant)
  run invalidRecordRemainsIncompleteTest = init.then(capture(true, true, false, 1, 1))
    .then(observe(true, false, false)).then(observe(false, true, false))
    .then(seal).expect(s.status == "incomplete" and invariant)
  run applyCannotEnterAuditTest = init.then(capture(true, true, true, 1, 1).fail())
  run changedScopeCannotEnterAuditTest = init.then(capture(true, false, false, 1, 1).fail())
  run changedCheckpointRefusesReceiptTest = init
    .then(capture(true, true, false, 0, 0)).then(changeCheckpoint(true)).then(seal.fail())
  run exactEmptyLegacyClosureDoesNotRequireValueReplayTest = init
    .then(capture(true, true, false, 0, 1)).then(observeEmptyLegacyClosure(true, true, true, true))
    .then(seal).expect(s.status == "no-scoped-active-assessments" and invariant)
  run emptyLegacyClosureWithFormalReviewRefusesReceiptTest = init
    .then(capture(true, true, false, 0, 1)).then(observeEmptyLegacyClosure(true, true, false, true))
    .then(seal).expect(s.status == "incomplete" and invariant)
  run emptyLegacyClosureWithPriorAwardRefusesReceiptTest = init
    .then(capture(true, true, false, 0, 1)).then(observeEmptyLegacyClosure(true, true, true, false))
    .then(seal).expect(s.status == "incomplete" and invariant)
  run unrelatedAppendAllowsReceiptTest = init
    .then(capture(true, true, false, 0, 0)).then(changeCheckpoint(false))
    .then(seal).expect(s.status == "no-scoped-active-assessments" and invariant)
  run privateReviewNeedsOptInTest = init
    .then(capture(true, true, false, 0, 0)).then(stageReview(false, true, true).fail())
  run privateReviewNeedsExactReadbackTest = init
    .then(capture(true, true, false, 0, 0)).then(stageReview(true, true, false).fail())
  run scopeChangeAfterPrivateStagingRefusesReceiptTest = init
    .then(capture(true, true, false, 0, 0)).then(stageReview(true, true, true))
    .then(changeCheckpoint(true)).then(seal.fail())
  run qualifiedPrivateReviewCanBeRetrievedTest = init
    .then(capture(true, true, false, 0, 0)).then(stageReview(true, true, true))
    .then(seal).expect(s.reviewAvailable and invariant)
  action relevantCut = capture(true, true, false, 1, 0).then(observe(true, true, true))
  run verifiedClosureReviewCanBeStagedTest = init.then(relevantCut)
    .then(bindClosureReview(true, true, false, true, true, true, true))
    .then(stageReview(true, true, true)).then(seal)
    .expect(s.reviewAvailable and s.boundClosureReview and invariant)
  run exactStandaloneClosureReviewCanBeStagedTest = init.then(relevantCut)
    .then(bindClosureReview(true, false, true, true, true, true, true))
    .then(stageReview(true, true, true)).then(seal)
    .expect(s.reviewAvailable and s.boundClosureReview and invariant)
  run missingStandaloneSourceDigestRefusesClosureReviewTest = init.then(relevantCut)
    .then(bindClosureReview(true, false, true, false, true, true, true))
    .then(stageReview(true, true, true).fail())
  run missingAnchorRefusesClosureReviewTest = init.then(relevantCut)
    .then(bindClosureReview(true, false, false, true, true, true, true))
    .then(stageReview(true, true, true).fail())
  run changedReviewIdentityRefusesClosureReviewTest = init.then(relevantCut)
    .then(bindClosureReview(true, true, false, true, false, true, true))
    .then(stageReview(true, true, true).fail())
  run closureImplementationCannotBeStagedTest = init.then(relevantCut)
    .then(bindClosureReview(true, true, false, true, true, true, false))
    .then(stageReview(true, true, true).fail())
  run postCloseReviewCannotBeStagedTest = init.then(relevantCut)
    .then(bindClosureReview(true, true, false, true, true, false, true))
    .then(stageReview(true, true, true).fail())
  run verifiedRemovedMergeKeepsPriorAwardsTest = init.then(relevantCut)
    .then(bindRemovedMerge(true, true, true, true)).then(stageReview(true, true, true)).then(seal)
    .expect(s.reviewAvailable and s.retainedRemovedMerge and invariant)
  run missingNativeAcceptanceRefusesHistoricalReviewTest = init.then(relevantCut)
    .then(bindRemovedMerge(false, true, true, true)).then(seal)
    .expect(s.status == "incomplete" and not(s.reviewAvailable) and invariant)
  run partialRemovedMergeHoldRefusesHistoricalReviewTest = init.then(relevantCut)
    .then(bindRemovedMerge(true, true, false, true)).then(stageReview(true, true, true).fail())
  run changeToHeldMergeRefusesHistoricalReviewTest = init.then(relevantCut)
    .then(bindRemovedMerge(true, true, true, false)).then(stageReview(true, true, true).fail())
}
