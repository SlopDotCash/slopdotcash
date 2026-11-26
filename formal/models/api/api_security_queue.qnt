// @source backend/security/operator-queue.ts
// @source backend/security/analysis.ts
// @source functions/api/v1/[[path]].ts
// @evidence backend/security/operator-queue.test.ts
// The private security queue route (operator decision, 24 November 2026; PRD
// section 8). The route answers only a request whose bearer token equals the
// configured Pages secret `OPERATOR_FEED_TOKEN`; an unset secret, a missing
// token and a wrong token fall through to the API's ordinary not-found answer.
// One report stands for every report. A read returns counts and changes
// nothing. A retry starts at most one analysis attempt, and only on an open
// report that does not wait for its deposit, that the owner's Analyze would
// accept (screened legitimate or forwarded, and no attempt yet or the last one
// failed, was unavailable or was lost), with fewer than four attempts for the
// current report version, at least 30 minutes after the last attempt started,
// and while fewer than 150 attempts started in the current UTC day.
// `elapsed` abstracts the time since the last attempt started: 0 is under 15
// minutes, 1 is 15 to 30 minutes (a running attempt is lost), 2 is over 30.
module api_security_queue {
  pure val RETRY_LIMIT = 4
  type S = {
    secret: bool,
    // The report: open (received or triaging), held for its deposit,
    // analyzable (screened legitimate or forwarded, or linked from GitHub).
    open: bool, held: bool, analyzable: bool,
    // Attempts for the current report version and the latest one's state:
    // none, running, complete, failed, unavailable.
    attempts: int, latest: str, elapsed: int,
    // The day's attempts reached the ceiling.
    dayFull: bool,
    // The last answer: none, not_found, queue, ran, daily_limit,
    // none_eligible.
    answer: str,
  }
  var s: S
  pure def ended(t: S): bool =
    t.latest == "failed" or t.latest == "unavailable" or (t.latest == "running" and t.elapsed >= 1)
  // The owner's Analyze rule (`analysisMayStart`).
  pure def mayStart(t: S): bool = t.analyzable and (t.latest == "none" or ended(t))
  pure def eligible(t: S): bool = all {
    t.open, not(t.held), mayStart(t), t.attempts < RETRY_LIMIT,
    t.latest == "none" or t.elapsed == 2,
  }
  action init = s' = {
    secret: false, open: true, held: false, analyzable: true,
    attempts: 0, latest: "none", elapsed: 0, dayFull: false, answer: "none",
  }
  action configure(on: bool): bool = s' = s.with("secret", on)
  // GET: counts only, no state change.
  action read(token: str): bool =
    s' = s.with("answer", if (s.secret and token == "right") "queue" else "not_found")
  // POST: at most one attempt, inside the request with the full time limit,
  // so it ends complete, failed or unavailable before the answer.
  action retry(token: str, outcome: str): bool =
    if (not(s.secret and token == "right")) s' = s.with("answer", "not_found")
    else if (s.dayFull) s' = s.with("answer", "daily_limit")
    else if (eligible(s))
      s' = s.with("attempts", s.attempts + 1).with("latest", outcome)
        .with("elapsed", 0).with("answer", "ran")
    else s' = s.with("answer", "none_eligible")
  // Outside this route: the owner's Analyze, the background attempt at
  // filing, time, the day's other attempts, the owner's decision, deposits.
  action ownerAnalyze(outcome: str): bool = all {
    mayStart(s), s.attempts < 6,
    s' = s.with("attempts", s.attempts + 1).with("latest", outcome).with("elapsed", 0).with("answer", "none"),
  }
  action backgroundStarts = all {
    s.latest == "none", s.analyzable,
    s' = s.with("attempts", 1).with("latest", "running").with("elapsed", 0).with("answer", "none"),
  }
  action timePasses = all { s.elapsed < 2, s' = s.with("elapsed", s.elapsed + 1).with("answer", "none") }
  action dayFills(full: bool): bool = s' = s.with("dayFull", full).with("answer", "none")
  action decide = s' = s.with("open", false).with("answer", "none")
  action hold(on: bool): bool = s' = s.with("held", on).with("answer", "none")
  action screen(legitimate: bool): bool = s' = s.with("analyzable", legitimate).with("answer", "none")
  action step = {
    nondet on = Bool.oneOf()
    nondet token = Set("none", "wrong", "right").oneOf()
    nondet outcome = Set("complete", "failed", "unavailable").oneOf()
    any {
      configure(on),
      read(token),
      retry(token, outcome),
      ownerAnalyze(outcome),
      backgroundStarts,
      timePasses,
      dayFills(on),
      decide,
      hold(on),
      screen(on),
    }
  }
  val invariant = all {
    // The operator never runs a fifth attempt, nor one on a held, decided
    // or unscreened report, nor one past the day's ceiling.
    s.answer == "ran" implies (s.attempts <= RETRY_LIMIT and s.open and not(s.held) and s.analyzable and not(s.dayFull)),
    // An attempt run by the route has ended before the answer.
    s.answer == "ran" implies s.latest != "running",
    s.attempts >= 0,
  }
  run wrongOrMissingTokenIsNotFoundTest = init.then(configure(true)).then(retry("wrong", "complete"))
    .expect(s.answer == "not_found" and s.attempts == 0).then(read("none"))
    .expect(s.answer == "not_found" and invariant)
  run unsetSecretIsNotFoundTest = init.then(retry("right", "complete"))
    .expect(s.answer == "not_found" and s.attempts == 0 and invariant)
  run readChangesNothingTest = init.then(configure(true)).then(read("right"))
    .expect(s.answer == "queue" and s.attempts == 0 and s.latest == "none" and invariant)
  run missingAnalysisRunsTest = init.then(configure(true)).then(retry("right", "complete"))
    .expect(s.answer == "ran" and s.attempts == 1 and s.latest == "complete" and invariant)
  run completeIsNeverRetriedTest = init.then(configure(true)).then(retry("right", "complete"))
    .then(timePasses).then(timePasses).then(retry("right", "complete"))
    .expect(s.answer == "none_eligible" and s.attempts == 1 and invariant)
  run failedWaitsThirtyMinutesTest = init.then(configure(true)).then(retry("right", "failed"))
    .then(timePasses).then(retry("right", "complete"))
    .expect(s.answer == "none_eligible" and s.attempts == 1)
    .then(timePasses).then(retry("right", "complete"))
    .expect(s.answer == "ran" and s.attempts == 2 and invariant)
  run lostBackgroundAttemptIsRetriedTest = init.then(configure(true)).then(backgroundStarts)
    .then(retry("right", "complete")).expect(s.answer == "none_eligible")
    .then(timePasses).then(timePasses).then(retry("right", "complete"))
    .expect(s.answer == "ran" and s.attempts == 2 and s.latest == "complete" and invariant)
  run fourAttemptsStopTheJobTest = init.then(configure(true))
    .then(retry("right", "failed")).then(timePasses).then(timePasses)
    .then(retry("right", "failed")).then(timePasses).then(timePasses)
    .then(retry("right", "failed")).then(timePasses).then(timePasses)
    .then(retry("right", "failed")).then(timePasses).then(timePasses)
    .then(retry("right", "complete"))
    .expect(s.answer == "none_eligible" and s.attempts == 4)
    // The owner may still analyze it.
    .then(ownerAnalyze("complete")).expect(s.attempts == 5 and s.latest == "complete" and invariant)
  run heldReportIsSkippedTest = init.then(configure(true)).then(hold(true)).then(retry("right", "complete"))
    .expect(s.answer == "none_eligible" and s.attempts == 0 and invariant)
  run decidedReportIsSkippedTest = init.then(configure(true)).then(decide).then(retry("right", "complete"))
    .expect(s.answer == "none_eligible" and s.attempts == 0 and invariant)
  run unscreenedReportIsSkippedTest = init.then(configure(true)).then(screen(false)).then(retry("right", "complete"))
    .expect(s.answer == "none_eligible" and s.attempts == 0 and invariant)
  run dailyCeilingRefusesTest = init.then(configure(true)).then(dayFills(true)).then(retry("right", "complete"))
    .expect(s.answer == "daily_limit" and s.attempts == 0)
    .then(dayFills(false)).then(retry("right", "complete"))
    .expect(s.answer == "ran" and s.attempts == 1 and invariant)
}
