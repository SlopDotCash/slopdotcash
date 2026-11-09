// @source workers/slopbot/persistence.ts
// @source migrations/0039_slopbot_provider_cost.sql
// @source migrations/0041_slopbot_immutable_ledger.sql
// @source migrations/0043_slopbot_provider_request.sql
// @source migrations/0047_slopbot_review_billing.sql
// Append-only provider attempts preserve unknown actual cost separately from
// local estimate. New billing rules never rewrite historical call-v1 rows.
module bot_provider_cost_history {
  var s: { actual: List[int], estimates: List[int], billing: List[int], rules: List[int] }
  action init = s' = {actual: [-1], estimates: [1], billing: [0], rules: [1]}
  action record(actual: int): bool = all { s.actual.length() < 3,
    s' = s.with("actual", s.actual.append(actual)).with("estimates", s.estimates.append(1))
      .with("billing", s.billing.append(1)).with("rules", s.rules.append(2)) }
  action step = { nondet actual = Set(-1, 0, 1).oneOf()
    any { record(actual), s' = s } }
  val invariant = all { s.actual.nth(0) == -1, s.estimates.nth(0) == 1, s.billing.nth(0) == 0, s.rules.nth(0) == 1,
    s.actual.length() == s.estimates.length(), s.actual.length() == s.rules.length() }
  run noInferredHistoricalReceiptTest = init.then(record(0)).then(record(1))
    .expect(s.actual == [-1, 0, 1] and s.rules == [1, 2, 2] and invariant)
}
