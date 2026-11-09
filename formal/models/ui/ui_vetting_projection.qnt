// @source src/AdminVetting.tsx
// @source src/lib/vetting-contracts.ts
// @evidence tests/e2e/admin-evidence-layout.spec.ts
// One selected project, one other project, three history rows and two flags /
// exemptions; two loads. This is the accepted overview's display projection,
// not backend authorization, scan correctness or grant/revocation authority.
// Loader identity/departure and mutations live in ui_admin_vetting_requests.
// History order is supplied by the API and is not sorted in this component.
// Only the first matching history row determines queue suppression. Clearance,
// service health and queue registration availability are separate inputs.
// A displayed flag count does not itself change a project restriction. All
// scenarios and regression definitions are source-only and unexecuted.
module ui_vetting_projection {
  type Assessment = { project: int, revision: int, state: str }
  type Flag = { project: int, id: int }
  type Exemption = { project: int, id: int, revoked: bool }
  type Overview = { projectPresent: bool, revision: int, clearance: str,
    assessmentPresent: bool, admission: bool, ownerExemption: bool,
    serviceAvailable: bool, queueAvailable: bool, history: List[Assessment],
    flags: List[Flag], exemptions: List[Exemption] }
  type State = { phase: str, loads: int, sourceChanged: bool, source: Overview, shown: Overview }
  var s: State
  val prior: Assessment = { project: 1, revision: 1, state: "incomplete" }
  val pending: Assessment = { project: 1, revision: 2, state: "pending" }
  val other: Assessment = { project: 2, revision: 2, state: "pending" }
  val base: Overview = { projectPresent: true, revision: 2, clearance: "quarantined",
    assessmentPresent: true, admission: false, ownerExemption: false,
    serviceAvailable: true, queueAvailable: true, history: List(prior),
    flags: List({ project: 1, id: 1 }, { project: 2, id: 2 }), exemptions: List() }
  action init = s' = { phase: "input", loads: 0, sourceChanged: false, source: base, shown: base }
  action profile(kind: int): bool = {
    val value = if (kind == 1) base.with("history", List(pending, prior))
      else if (kind == 2) base.with("history", List(prior.with("state", "pending")))
      else if (kind == 3) base.with("history", List(prior, pending))
      else if (kind == 4) base.with("history", List(other, prior))
      else if (kind == 5) base.with("projectPresent", false)
      else if (kind == 6) base.with("queueAvailable", false)
      else if (kind == 7) base.with("serviceAvailable", false)
      else if (kind == 8) base.with("clearance", "cleared").with("assessmentPresent", false)
      else if (kind == 9) base.with("clearance", "cleared").with("assessmentPresent", false).with("ownerExemption", true)
      else if (kind == 10) base.with("clearance", "cleared").with("admission", true)
      else if (kind == 11) base.with("clearance", "cleared")
      else if (kind == 12) base.with("clearance", "banned")
      else if (kind == 13) base.with("clearance", "cleared").with("flags", List({ project: 1, id: 1 }, { project: 1, id: 2 }))
      else if (kind == 14) base.with("exemptions", List({ project: 1, id: 1, revoked: true }, { project: 1, id: 2, revoked: false }))
      else if (kind == 15) base.with("exemptions", List({ project: 1, id: 1, revoked: false }, { project: 1, id: 2, revoked: false }))
      else if (kind == 16) base.with("history", List())
      else if (kind == 17) base.with("clearance", "queued").with("history", List())
      else if (kind == 18) base.with("exemptions", List({ project: 2, id: 1, revoked: false }, { project: 1, id: 2, revoked: true }))
      else base
    all { s.phase == "input", 0.to(18).contains(kind), s' = s.with("source", value) }
  }
  action load = all { Set("input", "ready", "error").contains(s.phase), s.loads < 2,
    s' = s.with("phase", "loading").with("loads", s.loads + 1) }
  action receive = all { s.phase == "loading", s' = s.with("phase", "ready").with("shown", s.source) }
  action failed = all { s.phase == "loading", s' = s.with("phase", "error") }
  action sourceAdvance = all { not(s.sourceChanged),
    s' = s.with("sourceChanged", true).with("source", s.source.with("revision", 3)
      .with("history", List(pending.with("revision", 3))).with("clearance", "queued")) }
  val visible = s.phase == "ready" and s.shown.projectPresent
  val history = s.shown.history.select(row => row.project == 1)
  val queued = if (history.length() > 0) history.nth(0).state == "pending" and history.nth(0).revision == s.shown.revision else false
  val queueVisible = visible and s.shown.queueAvailable and not(queued)
  val flagCount = if (visible) s.shown.flags.select(row => row.project == 1).length() else 0
  val exemptions = s.shown.exemptions.select(row => row.project == 1)
  val liveExemptions = exemptions.select(row => not(row.revoked))
  val selectedExemption = if (visible and liveExemptions.length() > 0) liveExemptions.nth(0).id else 0
  val normalLabels = Map("unscanned" -> "Unscanned", "unverified" -> "Unverified",
    "stale" -> "Stale", "queued" -> "Queued", "quarantined" -> "Quarantined",
    "cleared" -> "Cleared", "banned" -> "Banned")
  val label = if (not(visible)) "none"
    else if (s.shown.clearance == "cleared" and not(s.shown.assessmentPresent))
      (if (s.shown.ownerExemption) "Owner-approved exemption" else "Existing-project exemption")
    else if (s.shown.clearance == "cleared" and s.shown.admission) "Admitted"
    else normalLabels.get(s.shown.clearance)
  val serviceWarning = s.phase == "ready" and not(s.shown.serviceAvailable)
  action step = {
    nondet kind = 0.to(18).oneOf()
    any { profile(kind), load, receive, failed, sourceAdvance, s' = s }
  }
  val invariant = all { s.loads <= 2, flagCount >= 0 and flagCount <= 2,
    queueVisible implies visible and s.shown.queueAvailable and not(queued),
    not(visible) implies label == "none" and flagCount == 0 and selectedExemption == 0,
    label == "Admitted" implies s.shown.assessmentPresent and s.shown.admission,
    Set("Owner-approved exemption", "Existing-project exemption").contains(label) implies not(s.shown.assessmentPresent) }
  action show = load.then(receive)
  run oldRevisionDoesNotOccupyQueueTest = init.then(profile(2)).then(show).expect(queueVisible and invariant)
  run newestMatchingPendingBlocksQueueTest = init.then(profile(1)).then(show).expect(not(queueVisible) and queued and invariant)
  run olderPendingBehindCompletedDoesNotBlockTest = init.then(profile(3)).then(show).expect(queueVisible and invariant)
  run otherProjectHistoryIsExcludedTest = init.then(profile(4)).then(show).expect(history == List(prior) and queueVisible and invariant)
  run missingProjectShowsNoCardTest = init.then(profile(5)).then(show).expect(not(visible) and label == "none" and invariant)
  run noQueueRegistrationHidesControlTest = init.then(profile(6)).then(show).expect(visible and not(queueVisible) and invariant)
  run serviceWarningDoesNotReplaceRegistrationCapabilityTest = init.then(profile(7)).then(show).expect(serviceWarning and queueVisible and invariant)
  run fixedExemptionIsNotPassedScanTest = init.then(profile(8)).then(show).expect(label == "Existing-project exemption" and invariant)
  run ownerExemptionIsDistinctTest = init.then(profile(9)).then(show).expect(label == "Owner-approved exemption" and invariant)
  run normalAdmissionIsDistinctFromCurrentScanTest = init.then(profile(10)).then(show).expect(label == "Admitted" and invariant)
  run normalClearedAssessmentKeepsClearedLabelTest = init.then(profile(11)).then(show).expect(label == "Cleared" and invariant)
  run banIsNotReplacedByQueueAvailabilityTest = init.then(profile(12)).then(show).expect(label == "Banned" and queueVisible and invariant)
  run onlySelectedProjectFlagsDisplayTest = init.then(show).expect(flagCount == 1 and invariant)
  run twoFlagsDoNotLocallyChangeClearanceTest = init.then(profile(13)).then(show).expect(flagCount == 2 and label == "Cleared" and invariant)
  run firstNonrevokedExemptionIsSelectedTest = init.then(profile(14)).then(show).expect(selectedExemption == 2 and exemptions.length() == 2 and invariant)
  run sourceOrderControlsExemptionSelectionTest = init.then(profile(15)).then(show).expect(selectedExemption == 1 and invariant)
  run otherProjectOrRevokedExemptionIsNotSelectedTest = init.then(profile(18)).then(show).expect(selectedExemption == 0 and invariant)
  run noHistoryStillAllowsQueueTest = init.then(profile(16)).then(show).expect(history == List() and queueVisible and invariant)
  run queuedClearanceAloneDoesNotSuppressControlTest = init.then(profile(17)).then(show).expect(label == "Queued" and queueVisible and invariant)
  run acceptedSnapshotDoesNotReadLaterSourceTest = init.then(show).then(sourceAdvance).expect(s.shown.revision == 2 and queueVisible and invariant)
  run laterLoadAcceptsCurrentSnapshotTest = init.then(show).then(sourceAdvance).then(show).expect(s.shown.revision == 3 and not(queueVisible) and invariant)
  run pendingRefreshHidesPriorCardTest = init.then(show).then(load).expect(not(visible) and invariant)
  run failedRefreshDoesNotInventEmptySuccessTest = init.then(show).then(load).then(failed).expect(s.phase == "error" and not(visible) and invariant)
}
