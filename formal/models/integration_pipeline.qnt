// @source scripts/run-integration.mjs
// @source scripts/runner-cancellation.mjs
// @source scripts/run-e2e-phase.mjs
// Three representative sequential drivers, with cancellation between or during
// them. runE2ePhase owns process-group cleanup; failure never certifies cleanup.
module integration_pipeline {
  var s: { started: int, finished: int, active: bool, canceled: bool,
    cancelStarted: int, failed: bool, first: int, cleanup: str, result: str }
  action init = s' = { started: 0, finished: 0, active: false, canceled: false,
    cancelStarted: 0, failed: false, first: 0, cleanup: "none", result: "running" }
  action start = all {
    s.result == "running", not(s.canceled), not(s.active), s.finished < 3,
    s' = s.with("started", s.started + 1).with("active", true).with("cleanup", "pending")
  }
  action settle(ok: bool): bool = all {
    s.active, not(s.canceled),
    s' = s.with("finished", s.finished + 1).with("active", false)
      .with("failed", s.failed or not(ok)).with("first", if (not(ok) and s.first == 0) 1 else s.first).with("cleanup", "done")
  }
  action interrupt = all {
    s.result == "running",
    s' = s.with("canceled", true)
      .with("cancelStarted", if(s.canceled) s.cancelStarted else s.started)
      .with("first", if (s.first == 0) 143 else s.first)
  }
  action reap(clean: bool): bool = all {
    s.canceled, s.active,
    s' = s.with("finished", s.finished + 1).with("active", false)
      .with("failed", s.failed or not(clean))
      .with("first", if (not(clean) and s.first == 0) 1 else s.first)
      .with("cleanup", if(clean) "done" else "failed")
  }
  action close = all {
    s.result == "running", not(s.active), s.canceled or s.finished == 3,
    s' = s.with("result", if(s.first == 143) "interrupted" else if(s.first != 0) "failed" else "passed")
  }
  action step = any { start, settle(true), settle(false), interrupt,
    reap(true), reap(false), close, s' = s }
  val invariant = all {
    s.started >= 0, s.started <= 3, s.finished >= 0,
    s.started == s.finished + (if(s.active) 1 else 0),
    s.canceled implies s.started == s.cancelStarted,
    s.result != "running" implies not(s.active),
    s.result == "passed" implies (s.finished == 3 and not(s.failed) and not(s.canceled)),
    s.cleanup == "failed" implies s.failed,
    s.canceled implies s.first != 0,
    s.result == "passed" implies s.first == 0,
  }
  run startAfterCancellationRefusedTest = init.then(interrupt).then(start.fail())
  run canceledBeforeFirstDriverTest = init.then(interrupt).then(close)
    .expect(s.result == "interrupted" and s.started == 0)
  run successorAfterCancellationRefusedTest = init.then(start).then(interrupt)
    .then(reap(true)).then(start.fail())
  run canceledDriverCannotStartSuccessorTest = init.then(start).then(interrupt)
    .then(reap(true)).then(close)
    .expect(s.result == "interrupted" and s.started == 1)
  run repeatedSignalsKeepCancellationTest = init.then(start).then(interrupt).then(interrupt)
    .then(reap(true)).then(close).expect(s.cancelStarted == 1 and s.result == "interrupted")
  run cleanupFailureIsNotSuccessTest = init.then(start).then(interrupt).then(reap(false))
    .then(close).expect(s.failed and s.cleanup == "failed" and s.result == "interrupted")
  run ordinaryFailureStillCollectsOtherDriversTest = init.then(start).then(settle(false))
    .then(start).then(settle(true)).then(start).then(settle(true)).then(close)
    .expect(s.result == "failed" and s.finished == 3)
  run earlierFailureSurvivesLaterSignalTest = init.then(start).then(settle(false)).then(interrupt)
    .then(close).expect(s.first == 1 and s.result == "failed")
  run allDriversCompleteTest = init.then(start).then(settle(true)).then(start).then(settle(true))
    .then(start).then(settle(true)).then(close).expect(s.result == "passed")
}
