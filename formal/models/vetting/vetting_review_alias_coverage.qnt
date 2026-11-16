// @source workers/vetting/review-plan.ts
// One canonical item, one identical alias and one genuinely missing surface
// abstract arbitrary path groups. Digest equality is an explicit assumption
// established by the planner over actual item bytes; no hash collision proof
// is claimed. A source's batch must be reviewed before its alias is covered.
// Exposing alias provenance adds no review, erases no finding/visibility gap,
// and grants no artifact release or admission. Bounded model-input layout and
// concrete path/digest serialization require the implementation regressions.
module vetting_review_alias_coverage {
  var s: { phase: str, equalDigest: bool, aliasPlanned: bool, batch: int,
    reviewed: Set[int], mappingShown: bool, aliasCovered: bool,
    genuineGap: bool, finding: bool, synthesized: bool, outputGap: bool, outputFinding: bool }

  action init = s' = { phase: "plan", equalDigest: false, aliasPlanned: false,
    batch: 0, reviewed: Set(), mappingShown: false, aliasCovered: false,
    genuineGap: false, finding: false, synthesized: false, outputGap: false, outputFinding: false }

  action observeEqualBytes = all { s.phase == "plan", not(s.aliasPlanned),
    s' = s.with("equalDigest", true) }

  action flagAlias = all { not(s.synthesized), s' = s.with("finding", true) }

  action missingSurface = all { not(s.synthesized),
    s' = s.with("genuineGap", true) }

  action planAlias(batch: int): bool = all {
    s.phase == "plan", s.equalDigest, not(s.aliasPlanned), batch.in(Set(1, 2)),
    s' = s.with("aliasPlanned", true).with("batch", batch),
  }

  action reviewBatch(batch: int): bool = all { batch.in(Set(1, 2)), not(s.synthesized),
    s' = s.with("reviewed", s.reviewed.union(Set(batch))) }

  action exposeMapping = all { s.aliasPlanned, not(s.synthesized),
    s' = s.with("mappingShown", true) }

  action coverAlias = all { not(s.synthesized), s.equalDigest, s.aliasPlanned,
    s.mappingShown, s.reviewed.contains(s.batch),
    s' = s.with("aliasCovered", true) }

  action synthesize = all { s.aliasCovered, not(s.synthesized),
    s' = s.with("phase", "synthesized").with("synthesized", true)
      .with("outputGap", s.genuineGap).with("outputFinding", s.finding) }


  action step = {
    nondet batch = Set(1, 2).oneOf()
    any { observeEqualBytes, flagAlias, missingSurface, planAlias(batch),
      reviewBatch(batch), exposeMapping, coverAlias, synthesize,
      s' = s }
  }

  val invariant = all {
    s.aliasCovered implies all { s.equalDigest, s.aliasPlanned, s.mappingShown,
      s.reviewed.contains(s.batch) },
    s.synthesized implies all { s.aliasCovered, s.outputGap == s.genuineGap,
      s.outputFinding == s.finding },
  }

  run aliasProvenanceNamesReviewedBatchTest = init.then(observeEqualBytes)
    .then(planAlias(2)).then(reviewBatch(2)).then(exposeMapping).then(coverAlias)
    .then(synthesize).expect(s.aliasCovered and not(s.outputGap) and not(s.outputFinding) and invariant)

  run mappingAloneIsNotReviewTest = init.then(observeEqualBytes).then(planAlias(1))
    .then(exposeMapping).expect(not(s.aliasCovered) and not(s.synthesized) and invariant)

  run differentBatchCannotCoverAliasTest = init.then(observeEqualBytes)
    .then(planAlias(2)).then(reviewBatch(1)).then(exposeMapping)
    .expect(not(s.aliasCovered) and not(s.synthesized) and invariant)

  run genuineGapSurvivesAliasMappingTest = init.then(missingSurface)
    .then(observeEqualBytes).then(planAlias(1)).then(reviewBatch(1))
    .then(exposeMapping).then(coverAlias).then(synthesize)
    .expect(s.genuineGap and s.outputGap and invariant)

  run flaggedAliasFindingIsPreservedTest = init.then(flagAlias)
    .then(observeEqualBytes).then(planAlias(1)).then(reviewBatch(1))
    .then(exposeMapping).then(coverAlias).then(synthesize)
    .expect(s.finding and s.outputFinding and invariant)
}
