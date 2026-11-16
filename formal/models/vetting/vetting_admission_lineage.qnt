// @source migrations/0102_owner_admission_exemptions.sql
// @source migrations/0099_vetting_queue_current_pin.sql
// @source migrations/0103_vetting_template_replacements.sql
// @source backend/vetting/persistence.ts
// @source backend/vetting/handler.ts
// @source backend/vetting/live-pin.ts
// Admission survives routine source updates, but not a break in immutable
// repository identity. An explicit later investigation controls the same repo.
module vetting_admission_lineage {
  var s: { identity: int, head: int, scanIdentity: int, scan: str, retained: bool,
    exemption: bool, steward: int, exemptSteward: int, answer: str }
  action init = s' = {identity: 1, head: 0, scanIdentity: 0, scan: "none", retained: false,
    exemption: false, steward: 1, exemptSteward: 0, answer: "unscanned"}
  action queue = s' = s.with("scanIdentity", s.identity).with("scan", "pending")
    .with("exemption", false).with("answer", "queued")
  action replacePendingTemplate = all { s.scan == "pending", s' = s }
  action recordClean = all { s.scan == "pending", s.scanIdentity == s.identity,
    s' = s.with("scan", "clean").with("retained", true) }
  action sourceUpdate = all { s.head < 2, s' = s.with("head", s.head + 1) }
  action replaceRepository = all { s.identity < 2,
    s' = s.with("identity", 2).with("scanIdentity", 0).with("scan", "none")
      .with("exemption", false).with("answer", "unscanned") }
  action loseEvidence = s' = s.with("retained", false).with("answer", "unverified")
  action ownerExemption = s' = s.with("exemption", true).with("exemptSteward", s.steward)
  action changeSteward = all { s.steward == 1,
    s' = s.with("steward", 2).with("exemption", false).with("answer", "unscanned") }
  action read = s' = s.with("answer", if (s.exemption and s.steward == s.exemptSteward) "exempt"
    else if (s.scan == "pending") "queued" else if (s.scanIdentity == s.identity and s.scan == "clean" and s.retained) "cleared"
    else if (s.scan == "clean") "unverified" else "unscanned")
  action step = any { queue, replacePendingTemplate, recordClean, sourceUpdate, replaceRepository, loseEvidence,
    ownerExemption, changeSteward, read, s' = s }
  val invariant = all { s.answer == "cleared" implies s.scanIdentity == s.identity and s.scan == "clean" and s.retained,
    s.answer == "exempt" implies s.exemption and s.steward == s.exemptSteward }
  run ordinaryHeadKeepsAdmissionTest = init.then(queue).then(recordClean).then(sourceUpdate).then(read)
    .expect(s.answer == "cleared" and s.head == 1)
  run newInvestigationBlocksOldClearanceTest = init.then(queue).then(recordClean).then(read).then(queue)
    .expect(s.answer == "queued")
  run replacementCannotInheritTest = init.then(queue).then(recordClean).then(replaceRepository).then(read)
    .expect(s.answer == "unscanned")
  run laterInvestigationOverridesExemptionTest = init.then(ownerExemption).then(queue).then(read)
    .expect(s.answer == "queued" and not(s.exemption))
  run coveredTemplateReplacementKeepsExemptionTest = init.then(queue).then(ownerExemption)
    .then(replacePendingTemplate).then(read).expect(s.answer == "exempt")
}
