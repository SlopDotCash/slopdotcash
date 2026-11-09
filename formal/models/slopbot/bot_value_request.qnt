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
// Bounds: three attempts, two lease generations, eight instants.
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
  action finish(t, outcome) = all {
    s.state == "running", t == s.token, s.now < s.until,
    outcome.in(Set("published", "current", "open", "historical", "missing", "attempts-exhausted", "source-incomplete", "authority", "budget", "retry", "parked")),
    val done = outcome.in(Set("published", "current", "open", "historical", "missing", "attempts-exhausted"))
    val blocked = outcome.in(Set("source-incomplete", "authority", "budget"))
    s' = s.with("state", if (done) "completed" else "waiting")
      .with("outcome", outcome).with("terminal", done)
      .with("blockedAttempts", s.blockedAttempts + (if (blocked) 1 else 0))
      .with("retryAt", if (done or outcome == "parked") 0 else s.now + 1),
  }
  action resumeParked = all {
    s.state == "waiting", s.outcome == "parked", s.activeProject, s.now < 7,
    s' = s.with("retryAt", s.now + 1),
  }
  action projectActive(active) = s' = s.with("activeProject", active)
  action obsolete(t) = all { t != s.token or s.now >= s.until, s' = s }
  action tick = all { s.now < 8, s' = s.with("now", s.now + 1) }
  action step = {
    nondet t = Set(0, 1, 2).oneOf()
    nondet active = Set(false, true).oneOf()
    nondet result = Set("published", "current", "open", "historical", "missing", "attempts-exhausted", "source-incomplete", "authority", "budget", "retry", "parked").oneOf()
    any { claim, finish(t, result), resumeParked, projectActive(active), obsolete(t), tick }
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
}
