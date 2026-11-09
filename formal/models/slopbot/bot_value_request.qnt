// @source migrations/0097_slopbot_value_historical.sql
// @source migrations/0098_slopbot_value_queue_indexes.sql
// @source migrations/0050_slopbot_value_requests.sql
// @source migrations/0052_slopbot_value_processing.sql
// @source migrations/0103_slopbot_value_retry_attempts.sql
// @source migrations/0105_slopbot_value_terminal_states.sql
// @source migrations/0106_slopbot_value_parked_checks.sql
// @source workers/slopbot/value-processing.ts
// workers/slopbot/value-processing.ts: claimValueRequest, finishValueRequest,
// nextValueRetryAt, resumeParkedValueRequests. Hours are normalized to ticks.
// `now` is the database execution clock. `capturedAt` is the timestamp bound
// by the caller before the finish statement executes; it may be older or
// ahead of that clock. Both must precede the current owner's lease expiry.
// Bounds: two lease generations, at most two counted blocked finishes,
// execution/captured clocks 0..8 (nine instants). No bound is enlarged here.
module bot_value_request {
  var s: { state: str, outcome: str, token: int, now: int, until: int,
    retryAt: int, blockedAttempts: int, terminal: bool, activeProject: bool }
  action init = s' = { state: "unread", outcome: "none", token: 0, now: 0,
    until: 0, retryAt: 0, blockedAttempts: 0, terminal: false, activeProject: true }
  action claim = all {
    s.token < 2, s.now < 7,
    any { s.state == "unread", s.state == "running" and s.until <= s.now,
      s.state == "waiting" and s.retryAt > 0 and s.retryAt <= s.now },
    s' = s.with("state", "running").with("token", s.token + 1)
      .with("until", s.now + 1).with("retryAt", 0).with("outcome", "none"),
  }
  action finishAt(t, outcome, capturedAt) = all {
    s.state == "running", t == s.token,
    capturedAt < s.until, s.now < s.until,
    outcome.in(Set("published", "current", "open", "historical", "missing", "attempts-exhausted", "source-incomplete", "authority", "budget", "retry", "parked")),
    val done = outcome.in(Set("published", "current", "open", "historical", "missing", "attempts-exhausted"))
    val blocked = outcome.in(Set("source-incomplete", "authority", "budget"))
    s' = s.with("state", if (done) "completed" else "waiting")
      .with("outcome", outcome).with("terminal", done)
      .with("blockedAttempts", s.blockedAttempts + (if (blocked) 1 else 0))
      .with("retryAt", if (done or outcome == "parked") 0 else capturedAt + 1),
  }
  // Existing scenarios finish immediately, so their captured and execution
  // clocks agree. Queued-finish scenarios below pass the captured time apart.
  action finish(t, outcome) = finishAt(t, outcome, s.now)
  action resumeParked = all {
    s.state == "waiting", s.outcome == "parked", s.activeProject, s.now < 7,
    s' = s.with("retryAt", s.now + 1),
  }
  action projectActive(active) = s' = s.with("activeProject", active)
  action obsoleteAt(t, capturedAt) = all {
    any { s.state != "running", t != s.token,
      capturedAt >= s.until, s.now >= s.until },
    s' = s,
  }
  action obsolete(t) = obsoleteAt(t, s.now)
  action tick = all { s.now < 8, s' = s.with("now", s.now + 1) }
  action step = {
    nondet t = Set(0, 1, 2).oneOf()
    nondet capturedAt = Set(0, 1, 2, 3, 4, 5, 6, 7, 8).oneOf()
    nondet active = Set(false, true).oneOf()
    nondet result = Set("published", "current", "open", "historical", "missing", "attempts-exhausted", "source-incomplete", "authority", "budget", "retry", "parked").oneOf()
    any { claim, finishAt(t, result, capturedAt), resumeParked,
      projectActive(active), obsoleteAt(t, capturedAt), tick }
  }
  val invariant = all {
    s.terminal iff s.state == "completed",
    s.terminal implies s.retryAt == 0,
    s.state == "running" implies s.retryAt == 0,
    s.blockedAttempts <= s.token,
    (s.state == "completed" and s.outcome == "attempts-exhausted") implies s.terminal,
  }
  run transientRetryDoesNotAdvanceBlockedCountTest = init.then(claim)
    .then(finish(1, "retry")).then(tick).then(claim)
    .then(finish(2, "published")).expect(s.blockedAttempts == 0 and s.terminal)
  run parkedWaitsForActivationTest = init.then(claim).then(finish(1, "parked"))
    .then(projectActive(false)).then(tick).expect(s.retryAt == 0 and not(s.terminal))
    .then(projectActive(true)).then(resumeParked).then(tick).then(claim)
    .expect(s.state == "running")
  run oldLeaseCannotCompleteTest = init.then(claim).then(tick).then(claim)
    .then(obsolete(1)).expect(s.state == "running" and s.token == 2)
  // The caller captures 0 while generation 1 is live (until 1), then the
  // statement executes at expiry. A captured-clock-only guard would finish.
  run queuedFinishAfterExpiryIsRefusedTest = init.then(claim)
    .expect(s.now == 0 and s.until == 1).then(tick)
    .then(obsoleteAt(1, 0)).expect(s.state == "running" and s.token == 1
      and s.outcome == "none" and s.blockedAttempts == 0 and s.retryAt == 0)
    .then(finishAt(1, "published", 0).fail())
  run capturedClockAtExpiryIsRefusedTest = init.then(claim)
    .then(obsoleteAt(1, 1)).expect(s.state == "running" and s.now == 0)
    .then(finishAt(1, "published", 1).fail())
  run staleQueuedTokenCannotCompleteCurrentLeaseTest = init.then(claim)
    .then(tick).then(claim).then(obsoleteAt(1, 0))
    .expect(s.state == "running" and s.token == 2 and s.until == 2)
    .then(finishAt(1, "published", 0).fail())
  run waitingHasNoCurrentLeaseTest = init.then(claim)
    .then(finish(1, "source-incomplete")).then(obsoleteAt(1, 0))
    .expect(s.state == "waiting" and s.blockedAttempts == 1 and s.retryAt == 1)
    .then(finishAt(1, "published", 0).fail())
  run completedHasNoCurrentLeaseTest = init.then(claim)
    .then(finish(1, "published")).then(obsoleteAt(1, 0))
    .expect(s.terminal and s.outcome == "published" and s.retryAt == 0)
    .then(finishAt(1, "published", 0).fail())
  run unclaimedHasNoCurrentLeaseTest = init.then(obsoleteAt(0, 0))
    .expect(s.state == "unread" and s.token == 0 and not(s.terminal))
    .then(finishAt(0, "published", 0).fail())
}
