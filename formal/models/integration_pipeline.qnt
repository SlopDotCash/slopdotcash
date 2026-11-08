// @source scripts/run-integration.mjs
// @source scripts/run-e2e-phase.mjs
// Three representative sequential drivers, with cancellation between or during
// them. runE2ePhase owns process-group cleanup; failure never certifies cleanup.
module integration_pipeline {
  var s: { started: int, finished: int, active: bool, canceled: bool,
    cancelStarted: int, failed: bool, cleanup: str, result: str }
  action init = s' = { started: 0, finished: 0, active: false, canceled: false,
    cancelStarted: 0, failed: false, cleanup: "none", result: "running" }
  action start = all {
    s.result == "running", not(s.canceled), not(s.active), s.finished < 3,
    s' = s.with("started", s.started + 1).with("active", true).with("cleanup", "pending")
  }
  action settle(ok: bool): bool = all {
    s.active, not(s.canceled),
    s' = s.with("finished", s.finished + 1).with("active", false)
      .with("failed", s.failed or not(ok)).with("cleanup", "done")
  }
  action interrupt = all {
    s.result == "running",
    s' = s.with("canceled", true)
      .with("cancelStarted", if(s.canceled) s.cancelStarted else s.started)
  }
  action reap(clean: bool): bool = all {
    s.canceled, s.active,
    s' = s.with("finished", s.finished + 1).with("active", false)
      .with("failed", s.failed or not(clean))
      .with("cleanup", if(clean) "done" else "failed")
  }
  action close = all {
    s.result == "running", not(s.active), s.canceled or s.finished == 3,
    s' = s.with("result", if(s.canceled) "interrupted" else if(s.failed) "failed" else "passed")
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
  }
  run canceledBeforeFirstDriverTest = init.then(interrupt).then(start.fail()).then(close)
    .expect(s.result == "interrupted" and s.started == 0)
  run canceledDriverCannotStartSuccessorTest = init.then(start).then(interrupt)
    .then(reap(true)).then(start.fail()).then(close)
    .expect(s.result == "interrupted" and s.started == 1)
  run repeatedSignalsKeepCancellationTest = init.then(start).then(interrupt).then(interrupt)
    .then(reap(true)).then(close).expect(s.cancelStarted == 1 and s.result == "interrupted")
  run cleanupFailureIsNotSuccessTest = init.then(start).then(interrupt).then(reap(false))
    .then(close).expect(s.failed and s.cleanup == "failed" and s.result == "interrupted")
  run ordinaryFailureStillCollectsOtherDriversTest = init.then(start).then(settle(false))
    .then(start).then(settle(true)).then(start).then(settle(true)).then(close)
    .expect(s.result == "failed" and s.finished == 3)
  run allDriversCompleteTest = init.then(start).then(settle(true)).then(start).then(settle(true))
    .then(start).then(settle(true)).then(close).expect(s.result == "passed")
}
