// @source backend/projects/handler.ts
// @source backend/projects/cloudflare-persistence.ts
// @evidence scripts/project-self-service.test.ts
// One first publication and one later revision. Setup may fail after the
// first transaction committed; neither the API error nor a retry erases it.
// Authority, registry constraints and D1 atomicity are external predicates.
// Scan success/failure and activation eligibility are bounded input branches.
// Authored without executing model scenarios or implementation tests.
module api_project_creation_completion {
  var s: { head: int, captured: int, phase: str, application: str,
    stored: bool, queueRevision: int, scan: str, response: int,
    receipt: int, activation: bool }

  action init = s' = { head: 0, captured: 0, phase: "ready",
    application: "pending", stored: false, queueRevision: 0,
    scan: "unrequested", response: 0, receipt: 0, activation: false }
  action storedApplication = all { s.phase == "ready",
    s' = s.with("stored", true) }
  action commit = all { s.phase == "ready", s.head == 0,
    s' = s.with("head", 1).with("captured", 1).with("phase", "committed")
      .with("application", if (s.stored) "approved" else "pending") }
  action laterRevision = all { s.head == 1,
    s' = s.with("head", 2) }
  action queueSetup(available: bool): bool = all { s.phase == "committed",
    s' = s.with("queueRevision", s.captured).with("phase", "setup")
      .with("scan", if (available) "queued" else "unavailable") }
  action noActivationNeeded = all { s.phase == "setup",
    s' = s.with("response", 201).with("receipt", s.captured).with("phase", "done") }
  action activate = all { s.phase == "setup",
    s' = if (s.head == s.captured)
      s.with("head", 2).with("response", 201).with("receipt", s.captured)
        .with("activation", true).with("phase", "done")
      else s.with("response", 409).with("phase", "error") }
  // A new POST cannot undo or duplicate an accepted initial publication.
  // A saved application reports already_decided; a new creation conflicts.
  action retry = all { s.phase == "error", s.head > 0,
    s' = s.with("response", 409) }
  action step = any { storedApplication, commit, laterRevision,
    queueSetup(true), queueSetup(false), noActivationNeeded, activate, retry, s' = s }
  val invariant = all { s.head >= 0, s.head <= 2,
    s.captured == 0 or s.captured == 1,
    s.queueRevision > 0 implies s.queueRevision == s.captured,
    s.receipt > 0 implies s.receipt == s.captured,
    s.stored and s.captured == 1 implies s.application == "approved" }

  run laterHeadDoesNotChangeQueuedRevisionTest = init.then(commit)
    .then(laterRevision).then(queueSetup(true)).then(noActivationNeeded)
    .expect(s.head == 2 and s.queueRevision == 1 and s.receipt == 1 and s.response == 201)
  run postCommitActivationConflictKeepsProjectTest = init.then(commit)
    .then(laterRevision).then(queueSetup(true)).then(activate).then(retry)
    .expect(s.head == 2 and s.response == 409 and not(s.activation))
  run approvedApplicationSurvivesSetupConflictTest = init.then(storedApplication)
    .then(commit).then(laterRevision).then(queueSetup(true)).then(activate)
    .expect(s.application == "approved" and s.response == 409 and s.captured == 1)
  run unchangedProjectCanActivateTest = init.then(commit)
    .then(queueSetup(true)).then(activate)
    .expect(s.activation and s.head == 2 and s.receipt == 1 and s.response == 201)
  run queueFailureDoesNotUndoCreationTest = init.then(commit)
    .then(queueSetup(false)).then(noActivationNeeded)
    .expect(s.head == 1 and s.scan == "unavailable" and s.response == 201 and s.receipt == 1)
}
