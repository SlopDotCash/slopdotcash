// @source scripts/run-vetting-controller.ts
// @source workers/vetting/controller.ts
// @source workers/vetting/run.ts
// @evidence workers/vetting/controller.test.ts
// @evidence scripts/vetting-scan-service.test.ts
// @evidence scripts/vetting-release-dispatch.test.ts
// Source-only composition; all scenarios below are unexecuted. One protected
// job, at most two queued assessments, one competing reservation per item and
// one result post per item. Crypto, Git checkout identity, rate-card parsing,
// bounded health parsing, scan internals and durable journal guarantees are
// delegated to their implementations/models. Controller bridge bounds apply
// only to readiness metadata, never repository or retained evidence bytes.
// Parent scratch cleanup removes local files, not the service-backed journal.
// A refused/uncertain reservation or completion aborts this pass; a later pass
// sees the retained reservation and reports journaled instead of posting again.
module vetting_controller_pass {
  val ids = Set(1, 2)
  var s: { phase: str, root: bool, work: Set[int], held: Set[int],
    posts: int -> int, committed: Set[int], queueSize: int, current: int,
    outcomes: List[str], attemptOutcome: str, refreshed: bool,
    failure: bool, exitCode: int, cleanupAttempted: bool,
    bridgeBody: str, runnerReady: bool }
  action init = s' = { phase: "checkout", root: false, work: Set(), held: Set(),
    posts: ids.mapBy(_ => 0), committed: Set(), queueSize: 0, current: 1,
    outcomes: List(), attemptOutcome: "unknown", refreshed: false,
    failure: false, exitCode: -1, cleanupAttempted: false,
    bridgeBody: "none", runnerReady: false }
  action seedReservation(id: int): bool = all { s.phase == "checkout", ids.contains(id),
    s' = s.with("held", s.held.union(Set(id))) }
  action checkout(valid: bool): bool = all { s.phase == "checkout",
    s' = s.with("phase", if (valid) "rates" else "done")
      .with("failure", not(valid)).with("exitCode", if (valid) -1 else 1) }
  action rates(valid: bool): bool = all { s.phase == "rates",
    s' = s.with("phase", if (valid) "createRoot" else "done")
      .with("failure", not(valid)).with("exitCode", if (valid) -1 else 1) }
  action createRoot(success: bool): bool = all { s.phase == "createRoot",
    s' = s.with("root", success).with("phase", if (success) "config" else "done")
      .with("failure", not(success)).with("exitCode", if (success) -1 else 1) }
  action configure(valid: bool): bool = all { s.phase == "config",
    s' = s.with("phase", if (valid) "journalProbe" else "cleanup").with("failure", not(valid)) }
  // The readiness has("controller-readiness") result may be true or false;
  // it is a read probe and never reserves an assessment.
  action journalProbe(readable: bool): bool = all { s.phase == "journalProbe",
    s' = s.with("phase", if (readable) "bridge" else "cleanup").with("failure", not(readable)) }
  action bridgeHeaders(ok: bool): bool = all { s.phase == "bridge",
    s' = s.with("bridgeBody", "owned").with("phase", if (ok) "bridgeRead" else "bridgeCancel") }
  action bridgeRequestFailure = all { s.phase == "bridge",
    s' = s.with("failure", true).with("phase", "cleanup") }
  action cancelBridge = all { s.phase == "bridgeCancel",
    s' = s.with("bridgeBody", "cancelAttempted").with("phase", "cleanup").with("failure", true) }
  action bridgeRead(valid: bool): bool = all { s.phase == "bridgeRead",
    s' = s.with("bridgeBody", if (valid) "consumed" else "refusedOrInterrupted")
      .with("phase", if (valid) "runner" else "cleanup").with("failure", not(valid)) }
  action runner(matches: bool): bool = all { s.phase == "runner",
    s' = s.with("runnerReady", matches).with("phase", if (matches) "refresh" else "cleanup")
      .with("failure", not(matches)) }
  action refreshReply(refreshed: bool): bool = all { s.phase == "refresh",
    s' = s.with("refreshed", refreshed).with("phase", "queue") }
  action queueReply(count: int): bool = all { s.phase == "queue", Set(0, 2).contains(count),
    s' = s.with("queueSize", count).with("phase", if (count == 0) "report" else "has") }
  action hasReply(readable: bool): bool = all { s.phase == "has",
    s' = if (not(readable)) s.with("failure", true).with("phase", "cleanup")
      else if (s.held.contains(s.current))
        s.with("outcomes", s.outcomes.append("journaled"))
          .with("current", if (s.current == s.queueSize) s.current else s.current + 1)
          .with("phase", if (s.current == s.queueSize) "report" else "has")
      else s.with("phase", "acquire") }
  action acquireWork = all { s.phase == "acquire",
    s' = s.with("work", s.work.union(Set(s.current))).with("phase", "scan") }
  action retryScan = all { Set("acquire", "scan").contains(s.phase),
    s' = s.with("outcomes", s.outcomes.append("retry")).with("phase", "assessmentCleanup") }
  action beginReservation = all { s.phase == "scan", s' = s.with("phase", "reserve") }
  // A bounded acquisition refusal can publish an incomplete result without
  // returning an acquired directory to scanOne.
  action publishAcquisitionRefusal = all { s.phase == "acquire", s' = s.with("phase", "reserve") }
  action competingReservation = all { s.phase == "reserve",
    s' = s.with("held", s.held.union(Set(s.current))) }
  action reserveSuccess = all { s.phase == "reserve", not(s.held.contains(s.current)),
    s' = s.with("held", s.held.union(Set(s.current))).with("phase", "publish") }
  action reserveFailure(persisted: bool): bool = all { s.phase == "reserve",
    s' = s.with("held", if (persisted) s.held.union(Set(s.current)) else s.held)
      .with("failure", true).with("phase", "cleanup") }
  action sendResult = all { s.phase == "publish", s.posts.get(s.current) == 0,
    s' = s.with("posts", s.posts.set(s.current, 1)).with("phase", "result") }
  action resultReply(outcome: str, committed: bool): bool = all { s.phase == "result",
    Set("accepted", "rejected", "unknown").contains(outcome),
    outcome != "accepted" or committed, outcome != "rejected" or not(committed),
    s' = s.with("committed", if (committed) s.committed.union(Set(s.current)) else s.committed)
      .with("attemptOutcome", outcome).with("phase", "complete") }
  action completionReply(recorded: bool): bool = all { s.phase == "complete",
    s' = if (recorded) s.with("outcomes", s.outcomes.append(s.attemptOutcome))
        .with("phase", "assessmentCleanup")
      else s.with("failure", true).with("phase", "cleanup") }
  action assessmentCleanup(success: bool): bool = all { s.phase == "assessmentCleanup",
    success or s.work.contains(s.current),
    s' = if (success) s.with("work", s.work.exclude(Set(s.current)))
        .with("current", if (s.current == s.queueSize) s.current else s.current + 1)
        .with("phase", if (s.current == s.queueSize) "report" else "has")
      else s.with("failure", true).with("phase", "cleanup") }
  action fatalScanFailure = all { Set("refresh", "queue", "scan").contains(s.phase),
    s' = s.with("failure", true).with("phase", "cleanup") }
  action report = all { s.phase == "report",
    s' = s.with("failure", not(s.refreshed and
      s.outcomes.foldl(true, (accepted, outcome) => accepted and outcome == "accepted")))
      .with("phase", "cleanup") }
  action cleanup(success: bool): bool = all { s.phase == "cleanup", s.root,
    s' = s.with("cleanupAttempted", true).with("root", not(success))
      .with("work", if (success) Set() else s.work).with("phase", "done")
      .with("exitCode", if (s.failure or not(success)) 1 else 0) }
  action step = {
    nondet id = ids.oneOf()
    nondet outcome = Set("accepted", "rejected", "unknown").oneOf()
    nondet committed = Set(false, true).oneOf()
    any { seedReservation(id), checkout(true), checkout(false), rates(true), rates(false),
      createRoot(true), createRoot(false), configure(true), configure(false),
      journalProbe(true), journalProbe(false), bridgeHeaders(true), bridgeHeaders(false), bridgeRequestFailure,
      cancelBridge, bridgeRead(true), bridgeRead(false), runner(true), runner(false),
      refreshReply(true), refreshReply(false), queueReply(0), queueReply(2),
      hasReply(true), hasReply(false), acquireWork, retryScan, beginReservation, publishAcquisitionRefusal,
      competingReservation, reserveSuccess, reserveFailure(true), reserveFailure(false),
      sendResult, resultReply(outcome, committed), completionReply(true), completionReply(false),
      assessmentCleanup(true), assessmentCleanup(false), fatalScanFailure,
      report, cleanup(true), cleanup(false), s' = s }
  }
  val invariant = all {
    ids.contains(s.current),
    ids.forall(id => s.posts.get(id) >= 0 and s.posts.get(id) <= 1),
    ids.forall(id => s.posts.get(id) == 1 implies s.held.contains(id) and s.runnerReady),
    s.committed.subseteq(s.held), s.outcomes.length() <= s.queueSize,
    s.exitCode == 0 implies s.phase == "done" and not(s.root) and s.cleanupAttempted
      and s.refreshed and s.outcomes.foldl(true, (accepted, outcome) => accepted and outcome == "accepted"),
    s.cleanupAttempted and not(s.root) implies s.work.size() == 0,
    not(s.runnerReady) implies s.posts.get(1) == 0 and s.posts.get(2) == 0
  }
  action preflight = checkout(true).then(rates(true)).then(createRoot(true))
    .then(configure(true)).then(journalProbe(true)).then(bridgeHeaders(true))
    .then(bridgeRead(true)).then(runner(true))
  action queued = preflight.then(refreshReply(true)).then(queueReply(2))
  action reservedFirst = queued.then(hasReply(true)).then(acquireWork)
    .then(beginReservation).then(reserveSuccess)
  action postedFirst = reservedFirst.then(sendResult)

  run wrongCheckoutStopsBeforeScratchOrServiceTest = init.then(checkout(false))
    .expect(s.exitCode == 1 and not(s.root) and not(s.cleanupAttempted))
  run invalidRatesStopBeforeScratchOrServiceTest = init.then(checkout(true)).then(rates(false))
    .expect(s.exitCode == 1 and not(s.root))
  run journalProbeFailureCleansScratchTest = init.then(checkout(true)).then(rates(true))
    .then(createRoot(true)).then(configure(true)).then(journalProbe(false)).then(cleanup(true))
    .expect(s.exitCode == 1 and s.held.size() == 0 and not(s.root))
  run refusedBridgeAttemptsBodyCancellationTest = init.then(checkout(true)).then(rates(true))
    .then(createRoot(true)).then(configure(true)).then(journalProbe(true)).then(bridgeHeaders(false))
    .then(cancelBridge).then(cleanup(true)).expect(s.bridgeBody == "cancelAttempted" and s.exitCode == 1)
  run failedSigningOrTransportHasNoResponseBodyTest = init.then(checkout(true)).then(rates(true))
    .then(createRoot(true)).then(configure(true)).then(journalProbe(true)).then(bridgeRequestFailure)
    .then(cleanup(true)).expect(s.bridgeBody == "none" and s.exitCode == 1 and not(s.runnerReady))
  run malformedHealthCannotReachScanTest = init.then(checkout(true)).then(rates(true))
    .then(createRoot(true)).then(configure(true)).then(journalProbe(true)).then(bridgeHeaders(true))
    .then(bridgeRead(false)).then(cleanup(true)).expect(not(s.runnerReady) and s.posts.get(1) == 0)
  run mismatchedRunnerCannotReachScanTest = init.then(checkout(true)).then(rates(true))
    .then(createRoot(true)).then(configure(true)).then(journalProbe(true)).then(bridgeHeaders(true))
    .then(bridgeRead(true)).then(runner(false)).then(cleanup(true)).expect(s.exitCode == 1)
  run emptyRefreshedQueueSucceedsTest = init.then(preflight).then(refreshReply(true)).then(queueReply(0))
    .then(report).then(cleanup(true)).expect(s.exitCode == 0 and s.outcomes == List())
  run failedRefreshDoesNotBecomeSuccessFromEmptyQueueTest = init.then(preflight).then(refreshReply(false))
    .then(queueReply(0)).then(report).then(cleanup(true)).expect(s.exitCode == 1)
  run journaledItemsNeverAcquireOrPostTest = init.then(seedReservation(1)).then(seedReservation(2))
    .then(queued).then(hasReply(true)).then(hasReply(true)).then(report).then(cleanup(true))
    .expect(s.exitCode == 1 and s.outcomes == List("journaled", "journaled") and s.held == ids)
  run unreadableJournalStopsBeforeAcquisitionTest = init.then(queued).then(hasReply(false)).then(cleanup(true))
    .expect(s.work.size() == 0 and s.posts.get(1) == 0 and s.outcomes == List())
  run retryableScanDoesNotReserveTest = init.then(queued).then(hasReply(true)).then(acquireWork)
    .then(retryScan).then(assessmentCleanup(true)).expect(s.held.size() == 0 and s.outcomes == List("retry"))
  run acceptedQueueReportsSuccessOnlyAfterBothItemsTest = init.then(postedFirst)
    .then(resultReply("accepted", true)).then(completionReply(true)).then(assessmentCleanup(true))
    .then(hasReply(true)).then(acquireWork).then(beginReservation).then(reserveSuccess).then(sendResult)
    .then(resultReply("accepted", true)).then(completionReply(true)).then(assessmentCleanup(true))
    .then(report).then(cleanup(true)).expect(s.exitCode == 0 and s.outcomes == List("accepted", "accepted"))
  run rejectedItemMakesOtherwiseAcceptedPassFailTest = init.then(postedFirst)
    .then(resultReply("rejected", false)).then(completionReply(true)).then(assessmentCleanup(true))
    .then(hasReply(true)).then(acquireWork).then(beginReservation).then(reserveSuccess).then(sendResult)
    .then(resultReply("accepted", true)).then(completionReply(true)).then(assessmentCleanup(true))
    .then(report).then(cleanup(true)).expect(s.exitCode == 1 and s.outcomes == List("rejected", "accepted"))
  run acquisitionRefusalPublishesWithoutOwningDirectoryTest = init.then(queued).then(hasReply(true))
    .then(publishAcquisitionRefusal).then(reserveSuccess).then(sendResult).then(resultReply("accepted", true))
    .then(completionReply(true)).then(assessmentCleanup(true))
    .expect(s.work.size() == 0 and s.held.contains(1) and s.outcomes == List("accepted"))
  run lostReservationResponsePreservesNoSecondPostTest = init.then(queued).then(hasReply(true)).then(acquireWork)
    .then(beginReservation).then(reserveFailure(true)).then(cleanup(true))
    .expect(s.held.contains(1) and s.posts.get(1) == 0 and s.current == 1 and s.exitCode == 1)
  run competingReservationStopsThisPublicationTest = init.then(queued).then(hasReply(true)).then(acquireWork)
    .then(beginReservation).then(competingReservation).then(reserveFailure(false)).then(cleanup(true))
    .expect(s.held.contains(1) and s.posts.get(1) == 0)
  run lostCommittedResultRemainsJournaledAfterScratchRemovalTest = init.then(postedFirst)
    .then(resultReply("unknown", true)).then(completionReply(true)).then(assessmentCleanup(true))
    .then(hasReply(false)).then(cleanup(true))
    .expect(s.held.contains(1) and s.committed.contains(1) and s.outcomes == List("unknown") and not(s.root))
  run failedCompletionAbortsBeforeSecondAssessmentTest = init.then(postedFirst)
    .then(resultReply("accepted", true)).then(completionReply(false)).then(cleanup(true))
    .expect(s.held.contains(1) and s.posts.get(1) == 1 and s.posts.get(2) == 0 and s.outcomes == List())
  run parentCleanupCoversFailedAssessmentCleanupTest = init.then(postedFirst)
    .then(resultReply("accepted", true)).then(completionReply(true)).then(assessmentCleanup(false))
    .then(cleanup(true)).expect(s.work.size() == 0 and s.held.contains(1) and s.exitCode == 1)
  run cleanupFailureCannotEraseJournalOrReportSuccessTest = init.then(postedFirst)
    .then(resultReply("unknown", true)).then(completionReply(false)).then(cleanup(false))
    .expect(s.root and s.work.contains(1) and s.held.contains(1) and s.exitCode == 1)
}
