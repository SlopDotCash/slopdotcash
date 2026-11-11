// @source scripts/qualify-value-models.ts
// @source scripts/protected-main-release.ts
// Two value-route requests (one for general review); two scaled budget units.
// Sending makes the outcome uncertain until a bounded cost receipt arrives.
// A provider amount above the budget is reported as failure, never clamped.
module qualification_value_budget {
  var s: { calls: int, limit: int, spent: int, uncertain: bool, failed: bool, dryRun: bool }
  action init = s' = {calls: 0, limit: 2, spent: 0, uncertain: false, failed: false, dryRun: false}
  action generalReview = all { s.calls == 0, s' = s.with("limit", 1) }
  action dry = all { s.calls == 0, s' = s.with("dryRun", true) }
  action send = all { not(s.dryRun), not(s.failed), not(s.uncertain), s.calls < s.limit, s.spent + 1 <= 2,
    s' = s.with("calls", s.calls + 1).with("uncertain", true) }
  action receipt(cost: int): bool = all { s.uncertain, not(s.failed),
    s' = s.with("spent", s.spent + cost).with("failed", s.spent + cost > 2)
      .with("uncertain", s.spent + cost > 2) }
  action missingReceipt = all { s.uncertain, s' = s.with("failed", true) }
  action step = { nondet cost = Set(0, 1, 2, 3).oneOf()
    any { generalReview, dry, send, receipt(cost), missingReceipt, s' = s } }
  val invariant = all { s.calls <= s.limit, s.dryRun implies s.calls == 0,
    s.spent > 2 implies s.failed and s.uncertain }
  run unknownOutcomeStopsCallsTest = init.then(send).then(missingReceipt).expect(s.failed and s.uncertain)
    .then(send.fail())
  run zeroCostStillHasRequestLimitTest = init.then(send).then(receipt(0)).then(send).then(receipt(0)).then(send.fail())
  run overBudgetReportedTest = init.then(send).then(receipt(3)).expect(s.spent == 3 and s.failed)
}
