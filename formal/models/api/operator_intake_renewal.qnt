// @source scripts/renew-private-intake.mjs
// @source backend/trace/cloudflare-persistence.ts
// @evidence scripts/renew-private-intake.test.ts
// One invocation, one provider request and one Wrangler command at a time.
// Clock ranks 0..3, two booleans and one concurrent writer are finite bounds.
// Provider truth, redirect refusal, bounded JSON parsing, canonical ISO order
// and correct remote SQL execution are assumptions. Scenarios are unexecuted.
// A command failure may follow a committed write; scratch cleanup cannot undo
// it. Logged output is the provider sample, not a readback of the current row.
// A disabled sample is written and logged before failure even if its timestamp
// loses to a newer row. Reader freshness is abstracted to one clock rank here;
// its exact age/skew policy belongs to the separate reader model.
// sqlFile means a complete prepared payload; failed writes may leave partial
// bytes inside the still-owned scratch directory until cleanup succeeds.
module operator_intake_renewal {
  var s: { now: int, storedAt: int, enabled: bool, observedAt: int,
    observation: bool, phase: str, body: str, directory: bool, sqlFile: bool,
    fetches: int, commands: int, commandExecuted: bool, failed: bool,
    logged: bool, error: str }
  action init = s' = { now: 0, storedAt: -1, enabled: false, observedAt: -1,
    observation: false, phase: "credentials", body: "none", directory: false,
    sqlFile: false, fetches: 0, commands: 0, commandExecuted: false,
    failed: false, logged: false, error: "none" }
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1) }
  action externalObservation(enabled: bool): bool = all { s.now > s.storedAt,
    s' = s.with("storedAt", s.now).with("enabled", enabled) }
  action credentials(present: bool): bool = all { s.phase == "credentials",
    s' = s.with("phase", if (present) "fetch" else "failed")
      .with("fetches", if (present) 1 else 0).with("failed", not(present))
      .with("error", if (present) "none" else "credentials") }
  action fetchFailure = all { s.phase == "fetch",
    s' = s.with("phase", "failed").with("failed", true).with("error", "transport") }
  action response(ok: bool): bool = all { s.phase == "fetch",
    s' = s.with("body", "owned").with("phase", if (ok) "read" else "cancel") }
  action cancelRefusal(succeeds: bool): bool = all { s.phase == "cancel",
    s' = s.with("body", if (succeeds) "cancelled" else "cancel-failed")
      .with("phase", "failed").with("failed", true).with("error", "http") }
  action readBody(valid: bool, enabled: bool): bool = all { s.phase == "read",
    s' = s.with("body", if (valid) "consumed" else "invalid-or-interrupted")
      .with("observation", enabled).with("phase", if (valid) "clock" else "failed")
      .with("failed", not(valid)).with("error", if (valid) "none" else "body") }
  action readClock(valid: bool): bool = all { s.phase == "clock",
    s' = s.with("observedAt", if (valid) s.now else -1)
      .with("phase", if (valid) "create" else "failed")
      .with("failed", not(valid)).with("error", if (valid) "none" else "clock") }
  action createScratch(success: bool): bool = all { s.phase == "create",
    s' = s.with("directory", success).with("phase", if (success) "write" else "failed")
      .with("failed", not(success)).with("error", if (success) "none" else "directory") }
  action writeSql(success: bool): bool = all { s.phase == "write",
    s' = s.with("sqlFile", success).with("phase", if (success) "command" else "cleanup")
      .with("failed", not(success)).with("error", if (success) "none" else "file") }
  action startCommand = all { s.phase == "command", s.commands == 0,
    s' = s.with("commands", 1).with("phase", "remote") }
  action remoteOutcome(executed: bool): bool = all { s.phase == "remote",
    s' = s.with("commandExecuted", executed).with("phase", "reply")
      .with("storedAt", if (executed and s.observedAt > s.storedAt) s.observedAt else s.storedAt)
      .with("enabled", if (executed and s.observedAt > s.storedAt) s.observation else s.enabled) }
  action commandReply(success: bool): bool = all { s.phase == "reply", not(success) or s.commandExecuted,
    s' = s.with("phase", "cleanup").with("failed", not(success))
      .with("error", if (success) "none" else "command") }
  action cleanup(success: bool): bool = all { s.phase == "cleanup", s.directory,
    s' = s.with("directory", not(success)).with("sqlFile", s.sqlFile and not(success))
      .with("phase", if (success and not(s.failed)) "log" else "failed")
      .with("failed", s.failed or not(success))
      // The existing finally block's cleanup error supersedes an earlier error.
      .with("error", if (success) s.error else "cleanup") }
  action emitLog = all { s.phase == "log",
    s' = s.with("logged", true).with("phase", if (s.observation) "complete" else "failed")
      .with("failed", not(s.observation)).with("error", if (s.observation) "none" else "disabled") }
  action logFailure = all { s.phase == "log",
    s' = s.with("phase", "failed").with("failed", true).with("error", "log") }
  action nextInvocation = all { Set("failed", "complete").contains(s.phase), not(s.directory),
    s' = s.with("observedAt", -1).with("observation", false).with("phase", "credentials")
      .with("body", "none").with("sqlFile", false).with("fetches", 0).with("commands", 0)
      .with("commandExecuted", false).with("failed", false).with("logged", false).with("error", "none") }
  val uploadEnabled = s.enabled and s.storedAt >= 0 and s.now - s.storedAt <= 1
  action step = any { tick, externalObservation(true), externalObservation(false),
    credentials(true), credentials(false), fetchFailure, response(true), response(false),
    cancelRefusal(true), cancelRefusal(false), readBody(true, true), readBody(true, false), readBody(false, false),
    readClock(true), readClock(false), createScratch(true), createScratch(false), writeSql(true), writeSql(false),
    startCommand, remoteOutcome(true), remoteOutcome(false), commandReply(true), commandReply(false),
    cleanup(true), cleanup(false), emitLog, logFailure, nextInvocation, s' = s }
  val invariant = all {
    s.storedAt <= s.now, s.fetches >= 0 and s.fetches <= 1, s.commands >= 0 and s.commands <= 1,
    s.commands == 1 implies s.fetches == 1 and s.observedAt >= 0,
    s.logged implies s.commandExecuted and not(s.directory),
    s.phase == "complete" implies s.logged and s.observation and not(s.failed),
    not(s.directory) implies not(s.sqlFile),
    Set("failed", "complete").contains(s.phase) implies s.body != "owned"
  }
  action observed(enabled: bool): bool = credentials(true).then(response(true))
    .then(readBody(true, enabled)).then(readClock(true))
  action prepared(enabled: bool): bool = observed(enabled).then(createScratch(true))
    .then(writeSql(true)).then(startCommand)
  action persisted(enabled: bool): bool = prepared(enabled).then(remoteOutcome(true))
    .then(commandReply(true)).then(cleanup(true)).then(emitLog)

  run missingCredentialStopsBeforeRequestTest = init.then(credentials(false))
    .expect(s.fetches == 0 and s.commands == 0 and s.error == "credentials")
  run transportFailureWritesNothingTest = init.then(credentials(true)).then(fetchFailure)
    .expect(s.storedAt == -1 and not(s.directory) and not(s.logged))
  run httpRefusalDisposesBeforeFailureTest = init.then(credentials(true)).then(response(false)).then(cancelRefusal(true))
    .expect(s.body == "cancelled" and s.commands == 0 and s.error == "http")
  run cancellationFailurePreservesHttpRefusalTest = init.then(credentials(true)).then(response(false)).then(cancelRefusal(false))
    .expect(s.body == "cancel-failed" and s.error == "http" and s.commands == 0)
  run malformedOrOversizedBodyWritesNothingTest = init.then(credentials(true)).then(response(true)).then(readBody(false, false))
    .expect(not(s.directory) and s.commands == 0 and s.error == "body")
  run invalidClockCreatesNoSqlTest = init.then(credentials(true)).then(response(true)).then(readBody(true, true)).then(readClock(false))
    .expect(not(s.directory) and not(s.sqlFile) and s.commands == 0)
  run scratchCreationFailureWritesNothingTest = init.then(observed(true)).then(createScratch(false))
    .expect(s.storedAt == -1 and s.commands == 0)
  run sqlWriteFailureAttemptsCleanupTest = init.then(observed(true)).then(createScratch(true)).then(writeSql(false)).then(cleanup(true))
    .expect(s.phase == "failed" and not(s.directory) and s.commands == 0)
  run commandFailureBeforeCommitPreservesPriorStateTest = init.then(prepared(true)).then(remoteOutcome(false))
    .then(commandReply(false)).then(cleanup(true)).expect(s.storedAt == -1 and s.commands == 1 and not(s.logged))
  run commandFailureAfterCommitKeepsObservationTest = init.then(prepared(true)).then(remoteOutcome(true))
    .then(commandReply(false)).then(cleanup(true)).expect(s.storedAt == 0 and s.enabled and not(s.logged) and s.phase == "failed")
  run enabledObservationCompletesAfterCleanupTest = init.then(persisted(true))
    .expect(s.phase == "complete" and s.storedAt == 0 and uploadEnabled and invariant)
  run disabledObservationStoredBeforeFailureTest = init.then(persisted(false))
    .expect(s.phase == "failed" and s.storedAt == 0 and s.logged and not(uploadEnabled))
  run oldTimestampDoesNotReplaceTest = init.then(externalObservation(true)).then(persisted(false))
    .expect(s.enabled and s.storedAt == 0 and s.logged and s.error == "disabled")
  run concurrentNewerObservationWinsTest = init.then(prepared(false)).then(tick).then(externalObservation(true))
    .then(remoteOutcome(true)).then(commandReply(true)).then(cleanup(true)).then(emitLog)
    .expect(s.storedAt == 1 and s.enabled and not(s.observation) and s.error == "disabled")
  run cleanupFailureAfterCommitDoesNotRollbackTest = init.then(prepared(true)).then(remoteOutcome(true))
    .then(commandReply(true)).then(cleanup(false)).expect(s.enabled and s.directory and not(s.logged) and s.error == "cleanup")
  run cleanupFailureCanMaskEarlierCommandFailureTest = init.then(prepared(true)).then(remoteOutcome(false))
    .then(commandReply(false)).then(cleanup(false)).expect(s.error == "cleanup" and s.directory and not(s.logged))
  run outageDoesNotRefreshHealthTest = init.then(persisted(true)).then(nextInvocation).then(tick).then(tick)
    .then(credentials(true)).then(fetchFailure).expect(s.storedAt == 0 and not(uploadEnabled))
  run completedInvocationDoesNotRepeatWranglerTest = init.then(persisted(true)).then(startCommand.fail())
  run outputFailureCannotRollbackCommittedObservationTest = init.then(prepared(true)).then(remoteOutcome(true))
    .then(commandReply(true)).then(cleanup(true)).then(logFailure)
    .expect(s.storedAt == 0 and s.enabled and not(s.directory) and s.error == "log")
}
