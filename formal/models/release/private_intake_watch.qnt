// @source .github/workflows/private-intake-watch.yml
// @evidence backend/trace/PRIVATE_INTAKE_RECOVERY.md
// One read-only watch invocation; the event router and curl/Node runtimes are
// external boundaries. Main schedule/manual dispatch executes; other events
// represent no admitted job. Curl does not follow redirects, requires HTTP200,
// and bounds body/time before Node. A curl failure stops the shell before Node.
// JSON parsing is abstracted by its actual observable shape/source/boolean
// classes. The timestamp validator accepts UTC whole seconds or three decimal
// digits only after canonical roundtrip. Date parsing, actual bytes, TLS and
// successful deployment/renewal are not proved by this finite model.
// Age is milliseconds sampled once after file parsing and timestamp validation.
// The representative domain retains both inclusive boundaries and 1ms outside.
// A healthy watch is evidence of an observation, never a write or renewal.
module private_intake_watch {
  var s: { branch: str, eventName: str, phase: str, outcome: str,
    transport: str, payload: str, stamp: str, ageMs: int,
    finiteClock: bool, clockReads: int }

  val branches = Set("main", "development", "feature")
  val events = Set("schedule", "workflow_dispatch", "pull_request")
  val transports = Set("ok", "redirect", "non200", "timeout", "oversize", "network")
  val payloads = Set("enabled", "disabled", "wrong-source", "shape", "invalid-json", "file-failure")
  val stamps = Set("milliseconds", "whole-seconds", "missing", "noncanonical", "impossible")
  val ages = Set(-300001, -300000, 0, 10800000, 10800001)
  def inWindow(age) = age >= -300000 and age <= 10800000

  action init = s' = { branch: "none", eventName: "none", phase: "queued",
    outcome: "pending", transport: "none", payload: "none", stamp: "none",
    ageMs: 0, finiteClock: false, clockReads: 0 }

  action dispatch(branch, eventName) = all {
    s.phase == "queued", branch.in(branches), eventName.in(events),
    s' = s.with("branch", branch).with("eventName", eventName)
      .with("phase", if (branch == "main" and eventName.in(Set("schedule", "workflow_dispatch"))) "fetch" else "done")
      .with("outcome", if (branch == "main" and eventName.in(Set("schedule", "workflow_dispatch"))) "pending" else "skipped"),
  }

  action receive(kind) = all {
    s.phase == "fetch", kind.in(transports),
    s' = s.with("transport", kind)
      .with("phase", if (kind == "ok") "body" else "done")
      .with("outcome", if (kind == "ok") "pending" else "failed"),
  }

  action parseBody(kind, stamp) = all {
    s.phase == "body", kind.in(payloads), stamp.in(stamps),
    s' = s.with("payload", kind).with("stamp", stamp)
      .with("phase", if (kind == "enabled") "timestamp" else "done")
      .with("outcome", if (kind == "enabled") "pending" else "failed"),
  }

  action validateTimestamp = all {
    s.phase == "timestamp",
    s' = s.with("phase", if (s.stamp.in(Set("milliseconds", "whole-seconds"))) "clock" else "done")
      .with("outcome", if (s.stamp.in(Set("milliseconds", "whole-seconds"))) "pending" else "failed"),
  }

  action captureAge(age, finiteClock) = all {
    s.phase == "clock", age.in(ages),
    s' = s.with("ageMs", age).with("finiteClock", finiteClock)
      .with("clockReads", s.clockReads + 1)
      .with("phase", if (finiteClock) "freshness" else "done")
      .with("outcome", if (finiteClock) "pending" else "failed"),
  }

  action judge = all {
    s.phase == "freshness",
    s' = s.with("phase", "done")
      .with("outcome", if (inWindow(s.ageMs)) "healthy" else "failed"),
  }

  // Excluded from step: the previous upper-bound-only check accepted an
  // arbitrarily future timestamp as healthy. Its witness violates invariant.
  action oldUpperBoundOnly = all {
    s.phase == "freshness",
    s' = s.with("phase", "done")
      .with("outcome", if (s.ageMs <= 10800000) "healthy" else "failed"),
  }

  action step = {
    nondet branch = branches.oneOf()
    nondet eventName = events.oneOf()
    nondet transport = transports.oneOf()
    nondet payload = payloads.oneOf()
    nondet stamp = stamps.oneOf()
    nondet age = ages.oneOf()
    nondet finiteClock = Set(false, true).oneOf()
    any { dispatch(branch, eventName), receive(transport), parseBody(payload, stamp),
      validateTimestamp, captureAge(age, finiteClock), judge }
  }

  val invariant = all {
    s.clockReads >= 0 and s.clockReads <= 1,
    s.clockReads == 1 implies s.payload == "enabled" and s.stamp.in(Set("milliseconds", "whole-seconds")),
    s.outcome == "healthy" implies all {
      s.branch == "main", s.eventName.in(Set("schedule", "workflow_dispatch")),
      s.transport == "ok", s.payload == "enabled",
      s.stamp.in(Set("milliseconds", "whole-seconds")),
      s.finiteClock, s.clockReads == 1, inWindow(s.ageMs),
    },
    s.phase == "done" implies s.outcome.in(Set("healthy", "failed", "skipped")),
    s.transport != "ok" implies s.clockReads == 0,
  }

  run scheduleFreshObservationTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("enabled", "milliseconds"))
    .then(validateTimestamp).then(captureAge(0, true)).then(judge)
    .expect(s.outcome == "healthy" and invariant)
  run manualWholeSecondObservationTest = init.then(dispatch("main", "workflow_dispatch"))
    .then(receive("ok")).then(parseBody("enabled", "whole-seconds"))
    .then(validateTimestamp).then(captureAge(0, true)).then(judge)
    .expect(s.outcome == "healthy" and invariant)
  run developmentNotAdmittedTest = init.then(dispatch("development", "schedule"))
    .expect(s.outcome == "skipped" and s.clockReads == 0)
  run pullRequestNotAdmittedTest = init.then(dispatch("main", "pull_request"))
    .expect(s.outcome == "skipped" and s.clockReads == 0)
  run featureManualNotAdmittedTest = init.then(dispatch("feature", "workflow_dispatch"))
    .expect(s.outcome == "skipped" and s.clockReads == 0)
  run redirectsNeverReachDecoderTest = init.then(dispatch("main", "schedule"))
    .then(receive("redirect")).expect(s.outcome == "failed" and s.payload == "none")
  run non200NeverReachesDecoderTest = init.then(dispatch("main", "schedule"))
    .then(receive("non200")).expect(s.outcome == "failed" and s.payload == "none")
  run timeoutNeverReachesDecoderTest = init.then(dispatch("main", "schedule"))
    .then(receive("timeout")).expect(s.outcome == "failed" and s.payload == "none")
  run oversizeNeverReachesDecoderTest = init.then(dispatch("main", "schedule"))
    .then(receive("oversize")).expect(s.outcome == "failed" and s.payload == "none")
  run networkFailureNeverReachesDecoderTest = init.then(dispatch("main", "schedule"))
    .then(receive("network")).expect(s.outcome == "failed" and s.payload == "none")
  run fileReadFailureTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("file-failure", "missing"))
    .expect(s.outcome == "failed" and s.clockReads == 0)
  run malformedJsonTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("invalid-json", "missing"))
    .expect(s.outcome == "failed" and s.clockReads == 0)
  run nonRecordPayloadTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("shape", "missing"))
    .expect(s.outcome == "failed" and s.clockReads == 0)
  run disabledObservationTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("disabled", "milliseconds"))
    .expect(s.outcome == "failed" and s.clockReads == 0)
  run wrongSourceRefusedTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("wrong-source", "milliseconds"))
    .expect(s.outcome == "failed" and s.clockReads == 0)
  run missingTimestampRefusedTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("enabled", "missing"))
    .then(validateTimestamp).expect(s.outcome == "failed" and s.clockReads == 0)
  run noncanonicalTimestampRefusedTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("enabled", "noncanonical"))
    .then(validateTimestamp).expect(s.outcome == "failed" and s.clockReads == 0)
  run impossibleDateRefusedTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("enabled", "impossible"))
    .then(validateTimestamp).expect(s.outcome == "failed" and s.clockReads == 0)
  run timestampValidationDoesNotReadClockTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("enabled", "milliseconds"))
    .then(validateTimestamp).expect(s.phase == "clock" and s.clockReads == 0)
  run exactThreeHoursIsHealthyTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("enabled", "milliseconds"))
    .then(validateTimestamp).then(captureAge(10800000, true)).then(judge)
    .expect(s.outcome == "healthy" and invariant)
  run oneMillisecondTooOldTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("enabled", "milliseconds"))
    .then(validateTimestamp).then(captureAge(10800001, true)).then(judge)
    .expect(s.outcome == "failed" and invariant)
  run exactFutureToleranceIsHealthyTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("enabled", "milliseconds"))
    .then(validateTimestamp).then(captureAge(-300000, true)).then(judge)
    .expect(s.outcome == "healthy" and invariant)
  run oneMillisecondTooFarFutureTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("enabled", "milliseconds"))
    .then(validateTimestamp).then(captureAge(-300001, true)).then(judge)
    .expect(s.outcome == "failed" and invariant)
  run invalidLocalClockTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("enabled", "milliseconds"))
    .then(validateTimestamp).then(captureAge(0, false))
    .expect(s.outcome == "failed" and invariant)
  run oldFutureObservationFalsePassTest = init.then(dispatch("main", "schedule"))
    .then(receive("ok")).then(parseBody("enabled", "milliseconds"))
    .then(validateTimestamp).then(captureAge(-300001, true)).then(oldUpperBoundOnly)
    .expect(s.outcome == "healthy" and not(invariant))
}
