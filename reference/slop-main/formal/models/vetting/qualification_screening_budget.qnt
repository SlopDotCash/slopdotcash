// @source scripts/qualify-security-screening.ts
// @source scripts/protected-main-release.ts
// Three attempts, one scaled worst-case unit per call. Unknown transport or
// receipt outcomes charge the full bound before a retry; missing/over-budget
// receipts and wrong decisions stop immediately. Provider overcharge may
// exceed the estimate, but cannot be hidden or authorize a further call.
module qualification_screening_budget {
  var s: { phase: str, calls: int, spent: int, qualified: bool }
  action init = s' = {phase: "ready", calls: 0, spent: 0, qualified: false}
  action send = all { s.phase == "ready", s.calls < 3, s.spent + 1 <= 3,
    s' = s.with("phase", "pending").with("calls", s.calls + 1) }
  action outcome(cost: int, retryable: bool, legitimate: bool): bool = all { s.phase == "pending",
    val total = s.spent + cost
    val success = legitimate and cost <= 1 and total <= 3
    val retry = not(success) and retryable and cost <= 1 and total + 1 <= 3 and s.calls < 3
    s' = s.with("spent", total).with("qualified", success)
      .with("phase", if (success) "done" else if (retry) "ready" else "failed") }
  action unknownTransport = outcome(1, true, false)
  action dryRun = all { s.calls == 0, s.phase == "ready", s' = s.with("phase", "done") }
  action step = any { send, unknownTransport, outcome(0, false, true), outcome(1, false, true),
    outcome(1, false, false), outcome(2, false, false), dryRun, s' = s }
  val invariant = all { s.calls <= 3, s.qualified implies s.phase == "done" and s.calls > 0,
    s.spent > 3 implies s.phase == "failed" }
  // Given a continuing event loop and the production fetch timeout, enabled
  // request/outcome work progresses. This does not assume provider success.
  temporal terminationProperty = step.weakFair(s).implies(eventually(s.phase.in(Set("done", "failed"))))
  run unknownAttemptsExhaustTest = init.then(send).then(unknownTransport).then(send).then(unknownTransport)
    .then(send).then(unknownTransport).expect(s.phase == "failed" and s.spent == 3 and not(s.qualified))
  run validWrongDecisionStopsTest = init.then(send).then(outcome(0, false, false)).expect(s.phase == "failed")
  run dryRunIsNotProviderQualificationTest = init.then(dryRun).expect(s.calls == 0 and not(s.qualified))
}
