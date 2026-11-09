// @source backend/vetting/persistence.ts
// @source backend/projects/handler.ts
// @source backend/projects/cloudflare-persistence.ts
// @source backend/projects/skill-publication.ts
// @source migrations/0075_vetting_grandfathered_projects.sql
// @source migrations/0102_owner_admission_exemptions.sql
// @source migrations/0031_project_vetting_reinstatements.sql
// Admission clearance of one project and the activation that depends on it
// (PRD section 8). `kind` is fixed at initialization: an ordinary project, a
// member of the frozen migration-0075 set, or an owner-approved exemption.
// Assessments are abstracted to the latest one's state; an owner exemption
// covers only the assessments that existed when it was granted, so any later
// assessment (`uncovered`) returns the project to ordinary admission.
// Unwaived malice bans regardless of kind; a moderator reinstatement after a
// fresh clean scan requested after the ban waives it (the reviewed ids in
// project_vetting_reinstatements), which restores the frozen exemption.
//
// Activation fence: handler appendRevision reads the clearance generation,
// checks clearance, then writes guarded on that generation (and on the
// enforcement generation). The generation is a function of append-only rows
// whose states only advance, so it never returns to an earlier value; the
// model therefore abstracts "generation unchanged" as `changed == false`,
// set by every clearance-input change while a check is in flight.
//
// An active project that later loses clearance stays active: the PRD gates
// activation and executable revisions on clearance and requires no automatic
// pause. Skill publication and discovery withhold its skills instead
// (`skillServed`), so no contributor executes uncleared work.
module vetting_admission_clearance {
  type S = { kind: str, revoked: bool, uncovered: bool, latest: str,
    latestAfterBan: bool, malicious: bool, banned: bool, status: str,
    checking: bool, checkedCleared: bool, changed: bool, activatedUncleared: bool }
  var s: S
  def clearedIn(x: S): bool =
    if (x.malicious) false
    else if (x.kind == "grandfathered") true
    else if (x.kind == "exempt" and not(x.revoked) and not(x.uncovered)) true
    else x.latest == "clean"
  val cleared = clearedIn(s)
  val skillServed = s.status == "active" and not(s.banned) and cleared
  action initKind(kind: str): bool = all {
    s' = { kind: kind, revoked: false, uncovered: false, latest: "none",
      latestAfterBan: false, malicious: false, banned: false, status: "paused",
      checking: false, checkedCleared: false, changed: false, activatedUncleared: false },
  }
  action init = {
    nondet kind = Set("ordinary", "grandfathered", "exempt").oneOf()
    initKind(kind)
  }
  def touched(x: S): S = x.with("changed", x.checking)
  // An admission scan or an explicit investigation; one pending at a time.
  action requestScan = all { s.latest != "pending",
    s' = touched(s).with("latest", "pending").with("uncovered", true)
      .with("latestAfterBan", s.banned) }
  action completeClean = all { s.latest == "pending", s' = touched(s).with("latest", "clean") }
  action completeIncomplete = all { s.latest == "pending",
    s' = touched(s).with("latest", "incomplete") }
  // The malicious result records the ban in the same batch; the paused,
  // retired revision follows.
  action completeMalicious = all { s.latest == "pending",
    s' = touched(s).with("latest", "malicious").with("malicious", true).with("banned", true)
      .with("status", "paused") }
  action revokeExemption = all { s.kind == "exempt", not(s.revoked),
    s' = touched(s).with("revoked", true) }
  action moderatorReinstate = all { s.banned, s.latest == "clean", s.latestAfterBan,
    s' = touched(s).with("banned", false).with("malicious", false) }
  action beginActivation = all { s.status == "paused", not(s.banned), not(s.checking),
    s' = s.with("checking", true).with("checkedCleared", cleared).with("changed", false) }
  action writeActivation = all { s.checking, s.checkedCleared, not(s.changed),
    s' = s.with("status", "active").with("checking", false)
      .with("activatedUncleared", s.activatedUncleared or not(cleared)) }
  action abandonActivation = all { s.checking, s' = s.with("checking", false) }
  action step = any { requestScan, completeClean, completeIncomplete, completeMalicious,
    revokeExemption, moderatorReinstate, beginActivation, writeActivation, abandonActivation }
  val invariant = all {
    not(s.activatedUncleared),
    s.malicious implies (s.banned and not(cleared) and not(skillServed)),
    s.banned implies s.status == "paused",
    skillServed implies cleared,
    // The frozen set needs no scan; an ordinary project needs a clean latest one.
    (s.kind == "ordinary" and cleared) implies s.latest == "clean",
    (s.kind == "exempt" and s.revoked and cleared) implies s.latest == "clean",
  }
  run ordinaryActivationTest = initKind("ordinary").then(requestScan)
    .then(completeClean).then(beginActivation).then(writeActivation)
    .expect(s.status == "active" and skillServed)
  run investigationDuringActivationFencedTest = initKind("ordinary").then(requestScan)
    .then(completeClean).then(beginActivation).then(requestScan).then(writeActivation.fail())
  run revocationDuringActivationFencedTest = initKind("exempt").then(beginActivation)
    .then(revokeExemption).then(writeActivation.fail())
  run revocationRestoresOrdinaryAdmissionTest = initKind("exempt").then(revokeExemption)
    .expect(not(cleared))
  run laterAssessmentUncoversExemptionTest = initKind("exempt").then(requestScan)
    .then(completeIncomplete).expect(not(cleared))
  run lostClearanceWithholdsSkillsTest = initKind("ordinary").then(requestScan)
    .then(completeClean).then(beginActivation).then(writeActivation).then(requestScan)
    .then(completeIncomplete).expect(s.status == "active" and not(skillServed))
  run grandfatheredIgnoresInvestigationTest = initKind("grandfathered").then(requestScan)
    .then(completeIncomplete).expect(cleared)
  run maliceOverridesGrandfatheredTest = initKind("grandfathered").then(requestScan)
    .then(completeMalicious).expect(s.banned and not(cleared))
  run waiverRestoresGrandfatheredTest = initKind("grandfathered").then(requestScan)
    .then(completeMalicious).then(requestScan).then(completeClean).then(moderatorReinstate)
    .then(requestScan).expect(cleared and not(s.banned))
  run staleCleanCannotWaiveTest = initKind("ordinary").then(requestScan)
    .then(completeMalicious).then(moderatorReinstate.fail())
}
