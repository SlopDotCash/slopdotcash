// @source scripts/evidence-process.mjs
// @source scripts/record-evidence.mjs
// @evidence scripts/evidence-process.test.ts
// One directly spawned child, one command waiter or one preview-stop call.
// A successful spawn has a PID. Pinned Node records a negative spawn-error
// exitCode before error and close, without emitting exit. Child close follows
// exit for a successful spawn. Each stop has at
// most two abstract timeout events; event-loop progress and native signal
// delivery are assumptions, not a liveness theorem. No process-tree model.
module evidence_process {
  var s: { kind: str, child: bool, pid: bool, exited: bool, closed: bool,
    exitKind: str, primary: str, commandPhase: str, commandResult: str,
    commandError: str, commandSettlements: int, stopPhase: str, stopResult: str,
    stopError: str, stopSettlements: int, termRequests: int, killRequests: int,
    signalErrors: Set[str], reportedErrors: Set[str] }

  action init = s' = { kind: "none", child: false, pid: false, exited: false,
    closed: false, exitKind: "unknown", primary: "none", commandPhase: "idle",
    commandResult: "not-called", commandError: "none", commandSettlements: 0,
    stopPhase: "idle", stopResult: "not-called", stopError: "none",
    stopSettlements: 0, termRequests: 0, killRequests: 0,
    signalErrors: Set(), reportedErrors: Set() }

  action observe(kind: str, spawned: bool): bool = all {
    not(s.child), s.stopPhase == "idle", Set("command", "preview").contains(kind),
    s' = s.with("kind", kind).with("child", true).with("pid", spawned) }
  action processError(error: str): bool = all {
    s.child, Set("spawn", "runtime", "later").contains(error),
    error != "spawn" or not(s.pid),
    s.pid or error == "spawn" or s.primary != "none",
    s' = s.with("primary", if (s.primary == "none") error else s.primary)
      .with("exitKind", if (error == "spawn") "spawn-error" else s.exitKind) }
  action exitProcess(kind: str): bool = all {
    s.pid, not(s.exited), not(s.closed), Set("zero", "nonzero", "signal").contains(kind),
    s' = s.with("exited", true).with("exitKind", kind) }
  action closeProcess = all {
    s.child, not(s.closed), s.exited or (not(s.pid) and s.exitKind == "spawn-error"),
    s' = s.with("closed", true) }

  action beginCommand = all {
    s.kind == "command", s.commandPhase == "idle",
    s' = s.with("commandPhase", "waiting").with("commandResult", "pending") }
  action completeCommand = all {
    s.commandPhase == "waiting", s.closed,
    s' = s.with("commandPhase", "done").with("commandSettlements", 1)
      .with("commandResult", if (s.primary == "none" and s.exitKind == "zero") "success" else "failure")
      .with("commandError", if (s.primary != "none") s.primary
        else if (s.exitKind != "zero") "exit" else "none") }

  action beginStop = all {
    Set("none", "preview").contains(s.kind), s.stopPhase == "idle",
    s' = if (not(s.child) or s.closed)
      s.with("stopPhase", "done").with("stopResult", "success").with("stopSettlements", 1)
      else s.with("stopPhase", "term-request").with("stopResult", "pending") }
  action requestTerm(outcome: str): bool = {
    val running = s.pid and not(s.exited)
    all {
      s.stopPhase == "term-request", Set("sent", "false", "throw").contains(outcome),
      s' = s.with("stopPhase", "term-wait")
        .with("termRequests", if (running) 1 else 0)
        .with("signalErrors", if (running and outcome == "throw") s.signalErrors.union(Set("term")) else s.signalErrors) }
  }
  action termClosed = all {
    s.stopPhase == "term-wait", s.closed,
    s' = s.with("stopPhase", "done").with("stopResult", "success").with("stopSettlements", 1) }
  action termTimeout = all {
    s.stopPhase == "term-wait", not(s.closed), s' = s.with("stopPhase", "kill-request") }
  action requestKill(outcome: str): bool = {
    val running = s.pid and not(s.exited)
    all {
      s.stopPhase == "kill-request", Set("sent", "false", "throw").contains(outcome),
      s' = s.with("stopPhase", "kill-wait")
        .with("killRequests", if (running) 1 else 0)
        .with("signalErrors", if (running and outcome == "throw") s.signalErrors.union(Set("kill")) else s.signalErrors) }
  }
  action killClosed = all {
    s.stopPhase == "kill-wait", s.closed,
    s' = s.with("stopPhase", "done").with("stopResult", "success").with("stopSettlements", 1) }
  action killTimeout = {
    val errors = if (s.primary == "none") s.signalErrors else s.signalErrors.union(Set(s.primary))
    all {
      s.stopPhase == "kill-wait", not(s.closed),
      s' = s.with("stopPhase", "done").with("stopResult", "failure").with("stopSettlements", 1)
        .with("reportedErrors", errors.union(Set("unconfirmed-close")))
        .with("stopError", if (errors == Set()) "unconfirmed-close" else "aggregate") }
  }

  action step = {
    nondet kind = Set("command", "preview").oneOf()
    nondet spawned = Set(false, true).oneOf()
    nondet error = Set("spawn", "runtime", "later").oneOf()
    nondet exitKind = Set("zero", "nonzero", "signal").oneOf()
    nondet signalResult = Set("sent", "false", "throw").oneOf()
    any { observe(kind, spawned), processError(error), exitProcess(exitKind), closeProcess,
      beginCommand, completeCommand, beginStop, requestTerm(signalResult), termClosed,
      termTimeout, requestKill(signalResult), killClosed, killTimeout, s' = s }
  }
  val invariant = all {
    s.commandSettlements <= 1, s.stopSettlements <= 1,
    s.termRequests <= 1, s.killRequests <= 1,
    s.exited implies s.pid,
    s.closed implies s.exited or (not(s.pid) and s.primary != "none" and s.exitKind == "spawn-error"),
    s.commandResult == "success" implies s.closed and s.exitKind == "zero" and s.commandError == "none",
    s.commandResult == "failure" implies s.closed and s.commandError != "none",
    s.stopResult == "success" implies not(s.child) or s.closed,
    s.stopResult == "failure" implies s.reportedErrors.contains("unconfirmed-close"),
    s.stopError == "aggregate" implies s.reportedErrors.size() > 1,
    s.killRequests == 1 implies s.termRequests == 1,
    not(s.pid) implies s.termRequests == 0 and s.killRequests == 0 }

  run commandExitAloneRemainsPendingTest = init.then(observe("command", true)).then(beginCommand)
    .then(exitProcess("zero")).expect(s.commandResult == "pending" and not(s.closed) and invariant)
  run commandZeroCloseSucceedsTest = init.then(observe("command", true)).then(beginCommand)
    .then(exitProcess("zero")).then(closeProcess).then(completeCommand)
    .expect(s.commandResult == "success" and invariant)
  run commandNonzeroCloseRefusesTest = init.then(observe("command", true)).then(beginCommand)
    .then(exitProcess("nonzero")).then(closeProcess).then(completeCommand)
    .expect(s.commandResult == "failure" and s.commandError == "exit" and invariant)
  run commandSignalCloseRefusesTest = init.then(observe("command", true)).then(beginCommand)
    .then(exitProcess("signal")).then(closeProcess).then(completeCommand)
    .expect(s.commandResult == "failure" and invariant)
  run failedSpawnCommandClosesWithoutExitTest = init.then(observe("command", false)).then(beginCommand)
    .then(processError("spawn")).expect(s.commandResult == "pending").then(closeProcess).then(completeCommand)
    .expect(s.commandError == "spawn" and s.exitKind == "spawn-error" and not(s.exited) and invariant)
  run commandPreservesFirstErrorTest = init.then(observe("command", true)).then(beginCommand)
    .then(processError("runtime")).then(processError("later")).then(exitProcess("zero"))
    .then(closeProcess).then(completeCommand).expect(s.commandError == "runtime" and invariant)
  run commandWaitAfterCloseSettlesTest = init.then(observe("command", true)).then(exitProcess("zero"))
    .then(closeProcess).then(beginCommand).then(completeCommand).expect(s.commandResult == "success" and invariant)
  run failedSpawnPreviewClosesWithoutSignalTest = init.then(observe("preview", false)).then(processError("spawn"))
    .then(beginStop).then(requestTerm("sent")).then(closeProcess).then(termClosed)
    .expect(s.stopResult == "success" and s.termRequests == 0 and s.killRequests == 0 and invariant)
  run failedSpawnMissingCloseRefusesTest = init.then(observe("preview", false)).then(processError("spawn"))
    .then(beginStop).then(requestTerm("sent")).then(termTimeout).then(requestKill("sent")).then(killTimeout)
    .expect(s.stopError == "aggregate" and s.reportedErrors.contains("spawn") and not(s.closed) and invariant)
  run exitedPreviewWaitsForCloseTest = init.then(observe("preview", true)).then(exitProcess("zero"))
    .then(beginStop).then(requestTerm("sent")).expect(s.stopResult == "pending" and s.termRequests == 0)
    .then(closeProcess).then(termClosed).expect(s.stopResult == "success" and invariant)
  run terminationRequestAloneDoesNotProveCloseTest = init.then(observe("preview", true)).then(beginStop)
    .then(requestTerm("sent")).expect(s.stopResult == "pending" and not(s.closed) and invariant)
  run rejectedTermRequestMayStillCloseTest = init.then(observe("preview", true)).then(beginStop)
    .then(requestTerm("false")).then(exitProcess("zero")).then(closeProcess).then(termClosed)
    .expect(s.stopResult == "success" and invariant)
  run graceTimeoutEscalatesToKillTest = init.then(observe("preview", true)).then(beginStop)
    .then(requestTerm("sent")).then(termTimeout).then(requestKill("sent"))
    .then(exitProcess("signal")).then(closeProcess).then(killClosed)
    .expect(s.stopResult == "success" and s.killRequests == 1 and invariant)
  run failedSignalRequestsWithoutCloseRefuseTest = init.then(observe("preview", true)).then(beginStop)
    .then(requestTerm("false")).then(termTimeout).then(requestKill("false")).then(killTimeout)
    .expect(s.stopError == "unconfirmed-close" and not(s.closed) and invariant)
  run signalThrowDoesNotPreventObservedCleanupTest = init.then(observe("preview", true)).then(beginStop)
    .then(requestTerm("throw")).then(exitProcess("zero")).then(closeProcess).then(termClosed)
    .expect(s.stopResult == "success" and s.signalErrors == Set("term") and invariant)
  run termExceptionStillFallsBackToKillTest = init.then(observe("preview", true)).then(beginStop)
    .then(requestTerm("throw")).then(termTimeout).then(requestKill("sent"))
    .then(exitProcess("signal")).then(closeProcess).then(killClosed)
    .expect(s.stopResult == "success" and s.killRequests == 1 and s.signalErrors == Set("term") and invariant)
  run unconfirmedClosePreservesSignalErrorsTest = init.then(observe("preview", true)).then(beginStop)
    .then(requestTerm("throw")).then(termTimeout).then(requestKill("throw")).then(killTimeout)
    .expect(s.reportedErrors == Set("term", "kill", "unconfirmed-close") and invariant)
  run unconfirmedClosePreservesAsyncPrimaryTest = init.then(observe("preview", true)).then(beginStop)
    .then(requestTerm("sent")).then(processError("runtime")).then(termTimeout)
    .then(requestKill("sent")).then(killTimeout)
    .expect(s.stopError == "aggregate" and s.reportedErrors.contains("runtime") and invariant)
  run lateCloseCannotConvertTimedOutStopTest = init.then(observe("preview", true)).then(beginStop)
    .then(requestTerm("sent")).then(termTimeout).then(requestKill("sent")).then(killTimeout)
    .then(exitProcess("signal")).then(closeProcess)
    .expect(s.stopResult == "failure" and s.closed and s.stopSettlements == 1 and invariant)
  run alreadyClosedPreviewCleanupIsNoopTest = init.then(observe("preview", true)).then(exitProcess("zero"))
    .then(closeProcess).then(beginStop)
    .expect(s.stopResult == "success" and s.termRequests == 0 and s.killRequests == 0 and invariant)
  run absentPreviewCleanupIsNoopTest = init.then(beginStop)
    .expect(s.stopResult == "success" and not(s.child) and invariant)
  run exitDuringGraceSkipsKillTest = init.then(observe("preview", true)).then(beginStop)
    .then(requestTerm("sent")).then(exitProcess("zero")).then(termTimeout).then(requestKill("sent"))
    .then(closeProcess).then(killClosed)
    .expect(s.stopResult == "success" and s.killRequests == 0 and invariant)
  run exitedWithoutCloseStillRefusesTest = init.then(observe("preview", true)).then(exitProcess("zero"))
    .then(beginStop).then(requestTerm("sent")).then(termTimeout).then(requestKill("sent")).then(killTimeout)
    .expect(s.stopResult == "failure" and s.termRequests == 0 and s.killRequests == 0 and invariant)
}
