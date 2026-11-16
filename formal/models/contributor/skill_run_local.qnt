// @source skills/project-contributor-template/scripts/run-receipt.mjs
// @source src/lib/run-receipts.ts
// One local run, two finish candidates, two trace digests and two PR event
// times. The opened command owns a different server run from optional trace.
// contributor_session_exchange refines the authentication and create-run
// shorthand, including lost replies, reauthentication and actor/key identity.
// Byte/signature/identity validation are predicates; this is not crypto proof.
module skill_run_local {
  var s: { active: bool, started: bool, consent: bool, usage: str,
    finish: str, candidateValid: bool, clock: int, completed: int,
    completedValid: bool, completedClock: int, result: str, temporary: bool, completion: int,
    tracePhase: str, selectedHash: int, server: str, serverHash: int,
    openedServer: bool, openedEvents: Set[int] }
  action init = s' = { active: false, started: false, consent: false, usage: "unavailable",
    finish: "idle", candidateValid: false, clock: 0, completed: 0,
    completedValid: false, completedClock: 0, result: "none", temporary: false, completion: 0,
    tracePhase: "idle", selectedHash: 0, server: "absent", serverHash: 0,
    openedServer: false, openedEvents: Set() }
  action start(consent, available) = all { not(s.started),
    s' = s.with("started", true).with("active", true).with("consent", consent)
      .with("usage", if (consent and available) "capturing" else "unavailable") }
  action prepareFinish(clock, valid) = all { s.active, s.completed == 0, s.finish == "idle",
    Set(-1, 0, 1).contains(clock),
    s' = s.with("finish", "preparing").with("clock", clock)
      .with("candidateValid", valid).with("result", "running") }
  // Clock regression and invalid signed/schema candidates are refused before
  // the immutable hard-link publication, regardless of a former skew allowance.
  action validateCandidate = all { s.finish == "preparing", s.clock >= 0, s.candidateValid,
    s' = s.with("finish", "validated") }
  action rejectCandidate = all { s.finish == "preparing", s.clock < 0 or not(s.candidateValid),
    s' = s.with("finish", "idle").with("result", "failure") }
  action stage = all { s.finish == "validated",
    s' = s.with("finish", "staged").with("temporary", true) }
  action publish = all { s.finish == "staged", s.completed == 0,
    s' = s.with("finish", "published").with("completed", 1)
      .with("completedValid", true).with("completedClock", s.clock).with("completion", 1) }
  action competingFinishWins = all { Set("validated", "staged").contains(s.finish), s.completed == 0,
    s' = s.with("completed", 2).with("completedValid", true).with("completedClock", 1).with("completion", 2) }
  action removeTemporary(succeeds) = all { s.temporary,
    s' = if (succeeds) s.with("temporary", false)
      else s.with("finish", "idle").with("result", "failure") }
  action removeActive(succeeds) = all { s.finish == "published", not(s.temporary),
    s' = s.with("finish", "idle").with("result", if (succeeds) "success" else "failure")
      .with("active", if (succeeds) false else s.active) }
  action precommitFailure = all { Set("preparing", "validated", "staged").contains(s.finish),
    s.completed == 0, s' = s.with("finish", "idle").with("result", "failure") }
  action replayCompleted(matches, cleanupWorks) = all { s.completed != 0, s.finish != "published",
    s' = if (s.completedValid and matches)
      s.with("active", if (cleanupWorks) false else s.active).with("finish", "idle")
        .with("result", if (cleanupWorks) "success" else "failure")
      else s.with("finish", "idle").with("result", "failure") }
  // Represents already-invalid historical files; runtime never repairs or
  // silently replaces them. New publish can produce only completedValid=true.
  action observeInvalidHistoricalRecord = all { s.active, s.completed == 0, s.finish == "idle",
    s' = s.with("completed", 2).with("completedValid", false).with("completedClock", -1).with("completion", 2) }

  action selectTrace(hash) = all { s.active, Set("idle", "finished").contains(s.tracePhase), Set(1, 2).contains(hash),
    s' = s.with("selectedHash", hash).with("tracePhase", "selected") }
  action register = all { s.tracePhase == "selected",
    s' = s.with("tracePhase", "ready").with("server", if (s.server == "absent") "awaiting-trace" else s.server) }
  action upload = all { s.tracePhase == "ready", s.server == "awaiting-trace",
    s' = s.with("tracePhase", "uploaded").with("server", "trace-uploaded").with("serverHash", s.selectedHash) }
  action reuseUploaded = all { s.tracePhase == "ready", Set("trace-uploaded", "finalized").contains(s.server),
    s.serverHash == s.selectedHash, s' = s.with("tracePhase", "uploaded") }
  action finalizeTrace = all { s.tracePhase == "uploaded", s.serverHash == s.selectedHash,
    s' = s.with("server", "finalized").with("tracePhase", "finished") }
  action lostTraceResponse = all { Set("ready", "uploaded", "finished").contains(s.tracePhase),
    s' = s.with("tracePhase", "idle") }
  action refuseChangedTrace = all { s.tracePhase == "ready", s.serverHash != 0, s.serverHash != s.selectedHash,
    // The source skips PUT for an already uploaded trace, finalizes it, then
    // rejects the response's mismatch with the newly selected local bytes.
    s' = s.with("server", "finalized").with("tracePhase", "idle").with("result", "failure") }
  // Ordinary opened uses pr_opened_<PR-node-id>, with no local run required.
  // Same timestamp/body retries use the same key; a later invocation's timestamp
  // may create a second event. No exactly-one-event claim is made here.
  action registerOpened = all { not(s.openedServer), s' = s.with("openedServer", true) }
  action recordPullRequest(time) = all { s.openedServer, Set(1, 2).contains(time),
    s' = s.with("openedEvents", s.openedEvents.union(Set(time))) }
  action step = {
    nondet flag = Set(false, true).oneOf()
    nondet available = Set(false, true).oneOf()
    nondet cleanupWorks = Set(false, true).oneOf()
    nondet clock = Set(-1, 0, 1).oneOf()
    nondet n = Set(1, 2).oneOf()
    any { start(flag, available), prepareFinish(clock, flag), validateCandidate, rejectCandidate,
      stage, publish, competingFinishWins, removeTemporary(flag), removeActive(flag),
      precommitFailure, replayCompleted(flag, cleanupWorks), observeInvalidHistoricalRecord,
      selectTrace(n), register, upload, reuseUploaded, finalizeTrace, lostTraceResponse,
      refuseChangedTrace, registerOpened, recordPullRequest(n) }
  }
  val invariant = all {
    not(s.consent) implies s.usage == "unavailable",
    s.completed == 1 implies s.completedValid and s.completedClock >= 0,
    s.finish == "published" implies s.completedValid and s.completed != 0,
    s.server == "finalized" implies s.serverHash != 0,
    not(s.active) and s.started implies s.completedValid,
    s.openedEvents.size() <= 2,
    s.openedEvents.size() > 0 implies s.openedServer,
  }
  run optionalEvidenceDoesNotBlockReceiptTest = init.then(start(false, false))
    .then(prepareFinish(1, true)).then(validateCandidate).then(stage).then(publish)
    .then(removeTemporary(true)).then(removeActive(true)).then(replayCompleted(true, true))
    .expect(not(s.active) and s.server == "absent" and s.usage == "unavailable")
  run recordBeforeFinalizationTest = init.then(start(true, true)).then(selectTrace(1)).then(register)
    .then(registerOpened).then(recordPullRequest(1)).then(upload).then(finalizeTrace)
    .expect(s.openedServer and s.openedEvents == Set(1) and s.server == "finalized")
  run openedDoesNotNeedMeasuredRunTest = init.then(registerOpened).then(recordPullRequest(1))
    .expect(not(s.started) and s.server == "absent" and s.openedEvents == Set(1))
  run backwardClockCannotPoisonCompletedRecordTest = init.then(start(false, false))
    .then(prepareFinish(-1, true)).then(rejectCandidate)
    .then(prepareFinish(1, true)).then(validateCandidate).then(stage).then(publish)
    .then(removeTemporary(true)).then(removeActive(true)).expect(s.completedValid and not(s.active))
  run invalidCandidateCannotPublishTest = init.then(start(false, false)).then(prepareFinish(1, false))
    .then(validateCandidate.fail())
  run cleanupFailureLeavesValidReplayTest = init.then(start(false, false))
    .then(prepareFinish(1, true)).then(validateCandidate).then(stage).then(publish)
    .then(removeTemporary(false)).then(replayCompleted(true, true))
    .expect(s.completed == 1 and s.completedValid and not(s.active) and s.temporary)
  run activeRemovalFailureCanReplayTest = init.then(start(false, false))
    .then(prepareFinish(1, true)).then(validateCandidate).then(stage).then(publish)
    .then(removeTemporary(true)).then(removeActive(false)).then(replayCompleted(true, true))
    .expect(not(s.active) and s.completed == 1)
  run concurrentFinishPreservesFirstWinnerTest = init.then(start(false, false))
    .then(prepareFinish(1, true)).then(validateCandidate).then(stage).then(competingFinishWins)
    .then(removeTemporary(true)).then(replayCompleted(true, true)).expect(s.completed == 2)
  run invalidExistingRecordRemainsExplicitErrorTest = init.then(start(false, false))
    .then(observeInvalidHistoricalRecord).then(replayCompleted(true, true))
    .expect(s.completed == 2 and not(s.completedValid) and s.active and s.result == "failure")
  run traceRetryUsesStoredDigestTest = init.then(start(false, false)).then(selectTrace(1)).then(register)
    .then(upload).then(lostTraceResponse).then(selectTrace(1)).then(register).then(reuseUploaded)
    .then(finalizeTrace).expect(s.server == "finalized" and s.serverHash == 1)
  run changedTraceCannotReplaceUploadTest = init.then(start(false, false)).then(selectTrace(1)).then(register)
    .then(upload).then(lostTraceResponse).then(selectTrace(2)).then(register).then(refuseChangedTrace)
    .expect(s.serverHash == 1 and s.server == "finalized")
  run openedRetryIdentityIsSeparateTest = init.then(registerOpened).then(recordPullRequest(1))
    .then(recordPullRequest(1)).then(recordPullRequest(2))
    .expect(s.openedEvents == Set(1, 2) and s.server == "absent")
}
