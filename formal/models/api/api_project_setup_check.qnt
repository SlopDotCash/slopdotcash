// @source backend/projects/handler.ts
// @source backend/projects/setup.ts
// @source backend/projects/verified-setup.ts
// @source src/ProjectSetupStatus.tsx
// @evidence scripts/project-self-service.test.ts
// @evidence tests/e2e/project-access-retry.spec.ts
// One setup check, one project, two revisions and one concurrent restriction.
// Access, identity, clearance and queue replies are separate observations.
// The status describes the captured/committed revision, not an atomic current
// snapshot of all providers. Identity changes, DB atomicity, actual GitHub and
// scanner evidence, and unbounded retries are outside this finite model.
// A pre-supplied creation/edit queue outcome is outside this check-only model;
// first-publication completion is modeled in api_project_creation_completion.
// Activation rechecks clearance, then uses the revision/enforcement DB guard.
// Post-commit publication/readback failure retains the committed revision;
// the response is not evidence that the database write was rolled back.
// No funding is needed. The named-scenario decide helper takes the successful
// continuation; step exposes every intermediate activation boundary.
// These source-authored scenarios have not been executed.
module api_project_setup_check {
  type Projection = { state: str, next: str }
  type State = { phase: str, head: int, captured: int, active: bool,
    capturedActive: bool, restricted: bool, capturedRestricted: bool,
    retired: bool, skills: bool, funded: bool, allowActivation: bool,
    requestScan: bool, access: str, authority: str, identity: str,
    clearance: str, queue: str, projection: Projection,
    secondClearance: str, committedRevision: int, activatedRevision: int,
    writes: int, writeResponse: int }
  var s: State
  pure val clearances = Set("unscanned", "stale", "queued", "quarantined",
    "banned", "cleared", "exempt", "unverified", "unavailable")
  pure def clear(value: str): bool = value == "cleared" or value == "exempt"
  pure def projectedScan(clearance: str, queue: str): str =
    if (queue == "queued" and not(clear(clearance)) and clearance != "banned") "queued"
    else if (queue == "unavailable") "unavailable"
    else if (clear(clearance)) "cleared"
    else clearance
  pure def projection(restricted: bool, retired: bool, active: bool,
    access: str, authority: str, scan: str): Projection =
    if (restricted or retired or scan == "banned") { state: "restricted", next: "restricted" }
    else if (access == "retry") { state: "retry", next: "retry_installation" }
    else if (access != "installed") { state: "action_required", next: "install_slopbot" }
    else if (authority == "retry") { state: "retry", next: "retry_authority" }
    else if (authority == "denied") { state: "action_required", next: "ask_maintainer" }
    else if (scan == "cleared" and active) { state: "ready", next: "none" }
    else if (scan == "queued") { state: "waiting", next: "wait_for_scan" }
    else if (scan == "quarantined") { state: "action_required", next: "request_scan" }
    else { state: "retry", next: "retry_scan" }
  val open = not(s.capturedRestricted) and not(s.retired) and s.clearance != "banned"
  val needsQueue = open and s.authority == "verified" and
    (Set("unscanned", "stale").contains(s.clearance) or
      (s.requestScan and s.clearance == "quarantined"))
  val activationCandidate = open and s.allowActivation and not(s.capturedActive)
    and s.authority == "verified" and s.access == "installed"
    and clear(s.clearance) and s.skills
  val displayedScan = if (s.clearance == "exempt" and s.queue != "unavailable") "exempt"
    else projectedScan(s.clearance, s.queue)

  action init = s' = { phase: "idle", head: 1, captured: 0, active: false,
    capturedActive: false, restricted: false, capturedRestricted: false,
    retired: false, skills: true, funded: false, allowActivation: true,
    requestScan: false, access: "unknown", authority: "unknown", identity: "unknown",
    clearance: "unknown", queue: "none", projection: { state: "none", next: "none" },
    secondClearance: "unread", committedRevision: 0,
    activatedRevision: 0, writes: 0, writeResponse: 0 }
  action initialActive = all { s.phase == "idle", s' = s.with("active", true) }
  action retire = all { s.phase == "idle", s' = s.with("retired", true) }
  action omitSkills = all { s.phase == "idle", s' = s.with("skills", false) }
  action fund = s' = s.with("funded", true)
  action restrict = all { not(s.restricted), s' = s.with("restricted", true) }
  action begin(allow: bool, request: bool): bool = all { s.phase == "idle",
    s' = s.with("phase", "access").with("captured", s.head)
      .with("capturedActive", s.active).with("capturedRestricted", s.restricted)
      .with("allowActivation", allow).with("requestScan", request) }
  action accessReply(access: str, permission: str): bool = all {
    s.phase == "access", Set("installed", "missing", "suspended", "retry").contains(access),
    Set("write", "read").contains(permission),
    s' = s.with("access", access)
      .with("authority", if (access == "retry") "retry"
        else if (access == "installed" and permission == "write") "pending" else "denied")
      .with("phase", if (access == "installed" and permission == "write") "identity" else "scan") }
  action identityReply(identity: str): bool = all {
    s.phase == "identity", Set("matched", "mismatch", "unavailable").contains(identity),
    s' = s.with("identity", identity).with("phase", "scan")
      .with("access", if (identity == "unavailable") "retry" else s.access)
      .with("authority", if (identity == "matched") "verified"
        else if (identity == "mismatch") "denied" else "retry") }
  // The status-only denial mode does not change mutation-route error handling.
  action attemptOrdinaryWrite = all { s.identity == "mismatch", s.writes == 0,
    s' = s.with("writeResponse", 422) }
  action scanReply(clearance: str): bool = all { s.phase == "scan", clearances.contains(clearance),
    s' = s.with("clearance", clearance).with("phase", "decision") }
  action queueReply(outcome: str): bool = all {
    s.phase == "decision", needsQueue, s.queue == "none", Set("queued", "unavailable").contains(outcome),
    s' = s.with("queue", outcome) }
  action concurrentRevision = all { s.head == 1, s.phase != "idle",
    s' = s.with("head", 2).with("active", false) }
  action prepareDecision = {
    all { s.phase == "decision", not(needsQueue) or s.queue != "none",
      s' = if (activationCandidate) s.with("phase", "activation-clearance")
      else s.with("phase", "done")
        .with("projection", projection(s.capturedRestricted, s.retired, s.capturedActive,
          s.access, s.authority, projectedScan(s.clearance, s.queue))) }
  }
  action recheckClearance(outcome: str): bool = all {
    s.phase == "activation-clearance", Set("cleared", "refused", "throw").contains(outcome),
    s' = s.with("secondClearance", outcome)
      .with("phase", if (outcome == "cleared") "activation-commit" else "error")
      .with("projection", if (outcome == "cleared") s.projection else { state: "error", next: "retry_scan" }) }
  action commitActivation = {
    val conflict = s.head != s.captured or s.restricted
    all { s.phase == "activation-commit", s.secondClearance == "cleared",
      s' = if (conflict) s.with("phase", "conflict")
        .with("projection", { state: "error", next: "reload" })
      else s.with("phase", "post-commit").with("head", s.head + 1)
        .with("active", true).with("writes", 1).with("committedRevision", s.head + 1) }
  }
  // A failure before the INSERT commits is distinct from losing its reply.
  action activationWriteFailure = all { s.phase == "activation-commit",
    s' = s.with("phase", "error").with("projection", { state: "error", next: "retry" }) }
  action finishActivation(outcome: str): bool = all {
    s.phase == "post-commit", Set("ok", "error").contains(outcome),
    s' = if (outcome == "error") s.with("phase", "error")
      .with("projection", { state: "error", next: "retry" })
    else s.with("phase", "done").with("captured", s.committedRevision)
      .with("capturedActive", true).with("activatedRevision", s.committedRevision)
      .with("projection", projection(s.capturedRestricted, s.retired, true,
        s.access, s.authority, projectedScan(s.clearance, s.queue))) }
  // Preserve concise existing scenarios without hiding boundaries from step.
  action defaultPostCommit = if (s.phase == "post-commit") finishActivation("ok") else s' = s
  action defaultActivation = recheckClearance("cleared").then(commitActivation).then(defaultPostCommit)
  action defaultDecision = if (s.phase == "activation-clearance") defaultActivation else s' = s
  action decide = prepareDecision.then(defaultDecision)
  action step = {
    nondet allow = Set(false, true).oneOf()
    nondet request = Set(false, true).oneOf()
    nondet access = Set("installed", "missing", "suspended", "retry").oneOf()
    nondet permission = Set("write", "read").oneOf()
    nondet identity = Set("matched", "mismatch", "unavailable").oneOf()
    nondet clearance = clearances.oneOf()
    nondet outcome = Set("queued", "unavailable").oneOf()
    nondet second = Set("cleared", "refused", "throw").oneOf()
    nondet response = Set("ok", "error").oneOf()
    any { initialActive, retire, omitSkills, fund, restrict, begin(allow, request),
      accessReply(access, permission), identityReply(identity), attemptOrdinaryWrite,
      scanReply(clearance), queueReply(outcome), concurrentRevision, prepareDecision,
      recheckClearance(second), commitActivation, activationWriteFailure, finishActivation(response), s' = s }
  }
  val invariant = all {
    s.head >= 1, s.head <= 2, s.writes >= 0, s.writes <= 1,
    s.activatedRevision > 0 implies (s.writes == 1 and s.activatedRevision == s.captured and clear(s.clearance)
      and s.authority == "verified" and s.access == "installed" and s.skills and s.allowActivation),
    s.committedRevision > 0 implies (s.writes == 1 and s.committedRevision == s.head
      and s.secondClearance == "cleared" and s.active),
    s.activatedRevision > 0 implies s.activatedRevision == s.committedRevision,
    s.projection.state == "ready" implies (s.capturedActive and s.authority == "verified"
      and s.access == "installed" and not(s.capturedRestricted) and not(s.retired)
      and projectedScan(s.clearance, s.queue) == "cleared"),
    s.identity == "mismatch" implies (s.authority == "denied" and s.access == "installed"),
    s.writeResponse == 422 implies s.identity == "mismatch"
  }
  // Old catch path discarded known installation facts; kept outside step.
  val oldMismatchProjection = projection(false, false, false, "retry", "denied", "cleared")

  action verified = begin(true, false).then(accessReply("installed", "write")).then(identityReply("matched"))
  run unfundedActivationTest = init.then(verified).then(scanReply("cleared")).then(decide)
    .expect(s.projection.state == "ready" and s.writes == 1 and not(s.funded) and s.activatedRevision == 2)
  run alreadyActiveNeedsNoRevisionTest = init.then(initialActive).then(verified).then(scanReply("cleared")).then(decide)
    .expect(s.projection.state == "ready" and s.writes == 0 and s.captured == 1)
  run exemptionIsNotAPassedScanTest = init.then(verified).then(scanReply("exempt")).then(decide)
    .expect(s.projection.state == "ready" and displayedScan == "exempt")
  run missingInstallationTest = init.then(begin(true, false)).then(accessReply("missing", "write"))
    .then(scanReply("cleared")).then(decide).expect(s.projection.next == "install_slopbot" and s.writes == 0)
  run suspendedInstallationTest = init.then(begin(true, false)).then(accessReply("suspended", "write"))
    .then(scanReply("cleared")).then(decide).expect(s.projection.next == "install_slopbot" and s.writes == 0)
  run unavailableInstallationTest = init.then(begin(true, false)).then(accessReply("retry", "write"))
    .then(scanReply("cleared")).then(decide).expect(s.projection.state == "retry" and s.projection.next == "retry_installation")
  run readPermissionIsDeniedTest = init.then(begin(true, false)).then(accessReply("installed", "read"))
    .then(scanReply("cleared")).then(decide).expect(s.projection.next == "ask_maintainer" and s.writes == 0)
  run knownIdentityMismatchKeepsInstallationTest = init.then(begin(true, false)).then(accessReply("installed", "write"))
    .then(identityReply("mismatch")).then(scanReply("cleared")).then(decide)
    .expect(s.access == "installed" and s.projection.state == "action_required" and s.projection.next == "ask_maintainer")
  run mutationMismatchStillRefuses422Test = init.then(begin(true, false)).then(accessReply("installed", "write"))
    .then(identityReply("mismatch")).then(attemptOrdinaryWrite).expect(s.writeResponse == 422 and s.writes == 0)
  run identityProviderFailureRemainsRetryTest = init.then(begin(true, false)).then(accessReply("installed", "write"))
    .then(identityReply("unavailable")).then(scanReply("cleared")).then(decide)
    .expect(s.access == "retry" and s.projection.state == "retry" and s.writes == 0)
  run oldMismatchOutageNegativeControlTest = init.expect(oldMismatchProjection.state == "retry"
    and oldMismatchProjection.next == "retry_installation")
  run unscannedQueuesTest = init.then(verified).then(scanReply("unscanned")).then(queueReply("queued")).then(decide)
    .expect(s.projection.state == "waiting" and s.projection.next == "wait_for_scan" and s.writes == 0)
  run staleQueuesTest = init.then(verified).then(scanReply("stale")).then(queueReply("queued")).then(decide)
    .expect(s.projection.state == "waiting")
  run queueOutageStaysRetryTest = init.then(verified).then(scanReply("unscanned")).then(queueReply("unavailable")).then(decide)
    .expect(s.projection.next == "retry_scan" and s.writes == 0)
  run queuedCheckDoesNotQueueAgainTest = init.then(verified).then(scanReply("queued")).then(decide)
    .expect(s.queue == "none" and s.projection.state == "waiting")
  run incompleteScanNeedsExplicitRequestTest = init.then(verified).then(scanReply("quarantined")).then(decide)
    .expect(s.queue == "none" and s.projection.next == "request_scan")
  run explicitIncompleteScanRequestQueuesTest = init.then(begin(true, true)).then(accessReply("installed", "write"))
    .then(identityReply("matched")).then(scanReply("quarantined")).then(queueReply("queued")).then(decide)
    .expect(s.projection.state == "waiting")
  run maliciousResultOverridesInstalledAccessTest = init.then(verified).then(scanReply("banned")).then(decide)
    .expect(s.projection.state == "restricted" and s.writes == 0)
  run restrictionOverridesProviderFailureTest = init.then(restrict).then(begin(true, false)).then(accessReply("retry", "read"))
    .then(scanReply("cleared")).then(decide).expect(s.projection.state == "restricted")
  run retiredProjectNeverActivatesTest = init.then(retire).then(verified).then(scanReply("cleared")).then(decide)
    .expect(s.projection.state == "restricted" and s.writes == 0)
  run ownerEditDoesNotResumePausedProjectTest = init.then(begin(false, false)).then(accessReply("installed", "write"))
    .then(identityReply("matched")).then(scanReply("cleared")).then(decide)
    .expect(not(s.active) and s.writes == 0 and s.projection.next == "retry_scan")
  run incompleteSkillsDoNotActivateTest = init.then(omitSkills).then(verified).then(scanReply("cleared")).then(decide)
    .expect(s.writes == 0 and not(s.active))
  run changedRevisionRefusesActivationTest = init.then(verified).then(scanReply("cleared")).then(concurrentRevision).then(decide)
    .expect(s.phase == "conflict" and s.head == 2 and s.writes == 0)
  run restrictionBeforeActivationRefusesTest = init.then(verified).then(scanReply("cleared")).then(restrict).then(decide)
    .expect(s.phase == "conflict" and s.writes == 0)
  run historicalStatusDoesNotRebaseOntoLaterRevisionTest = init.then(initialActive).then(verified).then(scanReply("cleared"))
    .then(concurrentRevision).then(decide).expect(s.head == 2 and s.captured == 1 and s.writes == 0 and s.projection.state == "ready")
  run firstClearanceDoesNotCommitActivationTest = init.then(verified).then(scanReply("cleared")).then(prepareDecision)
    .expect(s.phase == "activation-clearance" and s.head == 1 and s.writes == 0 and not(s.active))
  run secondClearanceRefusalDoesNotActivateTest = init.then(verified).then(scanReply("cleared")).then(prepareDecision)
    .then(recheckClearance("refused")).expect(s.phase == "error" and s.head == 1 and s.writes == 0)
  run secondClearanceThrowDoesNotActivateTest = init.then(verified).then(scanReply("cleared")).then(prepareDecision)
    .then(recheckClearance("throw")).expect(s.phase == "error" and s.committedRevision == 0 and not(s.active))
  run revisionAfterSecondClearanceConflictsTest = init.then(verified).then(scanReply("cleared")).then(prepareDecision)
    .then(recheckClearance("cleared")).then(concurrentRevision).then(commitActivation)
    .expect(s.phase == "conflict" and s.head == 2 and s.writes == 0)
  run restrictionAfterSecondClearanceConflictsTest = init.then(verified).then(scanReply("cleared")).then(prepareDecision)
    .then(recheckClearance("cleared")).then(restrict).then(commitActivation)
    .expect(s.phase == "conflict" and s.head == 1 and s.writes == 0)
  run failedWriteBeforeCommitKeepsPausedRevisionTest = init.then(verified).then(scanReply("cleared")).then(prepareDecision)
    .then(recheckClearance("cleared")).then(activationWriteFailure)
    .expect(s.phase == "error" and s.head == 1 and s.writes == 0 and s.committedRevision == 0 and not(s.active))
  run postCommitFailureRetainsActivationTest = init.then(verified).then(scanReply("cleared")).then(prepareDecision)
    .then(recheckClearance("cleared")).then(commitActivation).then(finishActivation("error"))
    .expect(s.phase == "error" and s.head == 2 and s.active and s.writes == 1 and s.committedRevision == 2
      and s.captured == 1 and s.activatedRevision == 0 and invariant)
  run confirmedActivationReturnsItsCommittedRevisionTest = init.then(verified).then(scanReply("cleared")).then(prepareDecision)
    .then(recheckClearance("cleared")).then(commitActivation)
    .expect(s.committedRevision == 2 and s.captured == 1 and s.activatedRevision == 0)
    .then(finishActivation("ok")).expect(s.captured == 2 and s.activatedRevision == 2 and s.projection.state == "ready" and invariant)
}
