// @source scripts/qualify-security-routine.ts
// Release qualification of the routine-decision call: three synthetic reports
// in turn, at most five provider calls, one scaled worst-case unit per call.
// An unknown transport or receipt outcome charges the full bound before a
// retry; a wrong answer, a missing or over-budget receipt and a refused
// request stop at once. A report qualifies only on a required answer, and the
// release qualifies only when all three did. A dry run sends nothing and
// qualifies nothing.
module qualification_routine_budget {
  var s: { phase: str, report: int, calls: int, spent: int, qualified: bool }
  pure val REPORTS = 3
  pure val CALLS = 5
  action init = s' = {phase: "ready", report: 0, calls: 0, spent: 0, qualified: false}
  action send = all { s.phase == "ready", s.calls < CALLS, s.spent + 1 <= CALLS,
    s' = s.with("phase", "pending").with("calls", s.calls + 1) }
  action outcome(cost: int, retryable: bool, right: bool): bool = all { s.phase == "pending",
    val total = s.spent + cost
    val success = right and cost <= 1 and total <= CALLS
    val last = s.report + 1 == REPORTS
    val retry = not(success) and retryable and cost <= 1 and total + 1 <= CALLS and s.calls < CALLS
    s' = s.with("spent", total)
      .with("report", if (success) s.report + 1 else s.report)
      .with("qualified", success and last)
      .with("phase", if (success) (if (last) "done" else "ready") else if (retry) "ready" else "failed") }
  // A later report with no call or budget left is refused before it is sent.
  action exhausted = all { s.phase == "ready", s.calls >= CALLS or s.spent + 1 > CALLS,
    s' = s.with("phase", "failed") }
  action unknownTransport = outcome(1, true, false)
  action dryRun = all { s.calls == 0, s.phase == "ready", s' = s.with("phase", "done") }
  action step = any { send, exhausted, unknownTransport, outcome(0, false, true), outcome(1, false, true),
    outcome(1, false, false), outcome(2, false, false), dryRun, s' = s }
  val invariant = all { s.calls <= CALLS, s.report <= REPORTS,
    s.qualified implies (s.phase == "done" and s.report == REPORTS and s.calls >= REPORTS),
    s.spent > CALLS implies s.phase == "failed" }
  // Given a continuing event loop and the production fetch timeout, enabled
  // request/outcome work progresses. This does not assume provider success.
  temporal terminationProperty = step.weakFair(s).implies(eventually(s.phase.in(Set("done", "failed"))))
  run threeRightAnswersQualifyTest = init.then(send).then(outcome(0, false, true)).then(send)
    .then(outcome(1, false, true)).then(send).then(outcome(0, false, true))
    .expect(s.phase == "done" and s.qualified and s.calls == 3)
  run wrongAnswerStopsTest = init.then(send).then(outcome(0, false, true)).then(send)
    .then(outcome(0, false, false)).expect(s.phase == "failed" and not(s.qualified))
  run unknownAttemptsExhaustTest = init.then(send).then(unknownTransport).then(send).then(unknownTransport)
    .then(send).then(unknownTransport).then(send).then(unknownTransport).then(send).then(unknownTransport)
    .expect(s.phase == "failed" and s.spent == 5 and not(s.qualified))
  run spentBudgetRefusesLaterReportTest = init.then(send).then(outcome(1, false, true)).then(send)
    .then(unknownTransport).then(send).then(unknownTransport).then(send).then(unknownTransport)
    .then(send).then(outcome(1, false, true)).expect(s.phase == "ready" and s.report == 2)
    .then(exhausted).expect(s.phase == "failed" and not(s.qualified))
  run dryRunIsNotProviderQualificationTest = init.then(dryRun).expect(s.calls == 0 and not(s.qualified))
}
