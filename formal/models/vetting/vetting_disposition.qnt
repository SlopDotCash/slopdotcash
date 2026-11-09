// @source backend/vetting/result.ts
// @source backend/vetting/scan-result.ts
// @source workers/vetting/bounded-scan.ts
// @source workers/vetting/publication.ts
// v1 requires both legacy reviews; v2 requires its primary and conditionally
// a specialist for ambiguous/high-risk findings, flagged checks or quarantine.
// Legacy v1 consistency still needs both reviews, but current retained evidence
// validation refuses v1 clean publication. V2 is the current admission route.
module vetting_disposition {
  var s: { stage: str, inventory: bool, reviewers: Set[int], gaps: bool,
    suspected: bool, confirmed: bool, released: bool, result: str,
    legacy: bool, escalated: bool }
  action init = s' = { stage: "pending", inventory: false, reviewers: Set(),
    gaps: true, suspected: false, confirmed: false, released: false, result: "none",
    legacy: false, escalated: false }
  action legacySchema = all { s.stage == "pending", s' = s.with("legacy", true) }
  action acquire(complete) = all { s.stage == "pending",
    s' = s.with("stage", "reviewing").with("inventory", true).with("gaps", not(complete)) }
  action review(reviewer, suspected) = all { s.stage == "reviewing", reviewer.in(Set(1, 2)),
    s' = s.with("reviewers", s.reviewers.union(Set(reviewer)))
      .with("suspected", s.suspected or suspected) }
  action requireSpecialist = all { s.stage == "reviewing", s' = s.with("escalated", true) }
  action confirm = all { s.stage == "reviewing", s.suspected, s' = s.with("confirmed", true) }
  action releaseArtifacts = all { s.stage == "reviewing", not(s.suspected),
    s' = s.with("released", true) }
  val reviewed = 1.in(s.reviewers) and ((s.legacy or s.escalated) implies 2.in(s.reviewers))
  action publishClean = all {
    s.stage == "reviewing", not(s.legacy), s.inventory, not(s.gaps), reviewed,
    not(s.suspected), not(s.confirmed), s.released,
    s' = s.with("stage", "recorded").with("result", "clean"),
  }
  action publishIncomplete = all { s.stage == "reviewing", not(s.confirmed),
    s' = s.with("stage", "recorded").with("result", "incomplete") }
  action publishMalicious = all { s.stage == "reviewing", s.confirmed,
    s' = s.with("stage", "recorded").with("result", "malicious") }
  action exemption = all { s.stage == "pending", s' = s.with("stage", "exempt") }
  action step = {
    nondet complete = Set(false, true).oneOf()
    nondet suspected = Set(false, true).oneOf()
    nondet reviewer = Set(1, 2).oneOf()
    any { legacySchema, acquire(complete), review(reviewer, suspected), requireSpecialist, confirm,
      releaseArtifacts, publishClean, publishIncomplete, publishMalicious, exemption, s' = s }
  }
  val invariant = all {
    s.result == "clean" implies all { s.inventory, not(s.gaps), not(s.suspected),
      not(s.confirmed), s.released, reviewed },
    s.result == "malicious" implies s.confirmed,
    s.stage == "exempt" implies s.result == "none",
  }
  run completeReviewTest = init.then(acquire(true)).then(review(1, false))
    .then(releaseArtifacts).then(publishClean).expect(s.result == "clean" and s.reviewers == Set(1))
  run escalatedReviewNeedsSpecialistTest = init.then(acquire(true)).then(review(1, false))
    .then(requireSpecialist).then(releaseArtifacts).expect(not(reviewed))
    .then(review(2, false)).then(publishClean).expect(s.result == "clean")
  run legacyNeedsBothReviewsTest = init.then(legacySchema).then(acquire(true)).then(review(1, false))
    .then(releaseArtifacts).expect(not(reviewed)).then(review(2, false))
    .expect(reviewed and s.result == "none").then(publishIncomplete).expect(s.result == "incomplete")
  run suspectedIsNotConfirmedTest = init.then(acquire(true)).then(review(1, true))
    .then(publishIncomplete).expect(s.result == "incomplete")
  run confirmedMaliceTest = init.then(acquire(true)).then(review(1, true)).then(confirm)
    .then(publishMalicious).expect(s.result == "malicious")
  run exemptionIsNotPassedScanTest = init.then(exemption).expect(s.result == "none")
}
