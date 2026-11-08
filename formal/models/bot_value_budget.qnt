// @source migrations/0051_slopbot_value_budget.sql
// @source migrations/0077_slopbot_alerts_only.sql
// @source migrations/0084_slopbot_attempt_accounting.sql
// @source workers/slopbot/value-budget.ts
// @source workers/slopbot/value-inference.ts
// @source workers/slopbot/value-consumption.ts
// Two attempts, cap six units. Unknown or excess provider charges remain
// unreconciled; this model does not pretend a reservation binds the provider.
module bot_value_budget {
  var s: { used: int, held: int, unknown: bool, priorUnknown: bool, attempts: Set[int],
    current: int, mode: str, reserved: int, calls: int, knownCalls: int, cost: int }
  action init = s' = { used: 0, held: 0, unknown: false, priorUnknown: false, attempts: Set(),
    current: 0, mode: "none", reserved: 0, calls: 0, knownCalls: 0, cost: 0 }
  action reserve(id, alerts, amount) = all {
    id.in(Set(1, 2)), not(id.in(s.attempts)), s.current == 0,
    amount.in(Set(1, 2, 3)),
    alerts or (not(s.unknown) and s.used + s.held + amount <= 6),
    s' = s.with("current", id).with("attempts", s.attempts.union(Set(id)))
      .with("mode", if (alerts) "alerts" else "capped")
      .with("reserved", if (alerts) 0 else amount)
      .with("held", s.held + (if (alerts) 0 else amount))
      .with("priorUnknown", s.unknown).with("unknown", s.unknown or alerts),
  }
  // cost is the ledger's COALESCE(actual, versioned estimate); an unknown
  // provider amount still consumes its recorded estimate and keeps its hold.
  action provider(known, cost) = all {
    s.current != 0, s.calls == 0, cost.in(Set(0, 1, 3, 7)),
    s' = s.with("calls", 1).with("knownCalls", if (known) 1 else 0)
      .with("cost", if (known) cost else 0).with("used", s.used + cost),
  }
  action reconcile = all {
    s.current != 0, s.calls == 1, s.knownCalls == 1,
    s.mode == "alerts" or s.cost <= s.reserved,
    s' = s.with("current", 0).with("held", s.held - s.reserved)
      .with("unknown", s.priorUnknown).with("mode", "none").with("reserved", 0)
      .with("calls", 0).with("knownCalls", 0).with("cost", 0),
  }
  action abandonUncertain = all {
    s.current != 0, s.calls == 1,
    s.knownCalls == 0 or (s.mode == "capped" and s.cost > s.reserved),
    s' = s.with("current", 0).with("mode", "none")
      .with("reserved", 0).with("calls", 0).with("knownCalls", 0).with("cost", 0),
  }
  action step = {
    nondet id = Set(1, 2).oneOf()
    nondet alerts = Set(false, true).oneOf()
    nondet amount = Set(1, 2, 3).oneOf()
    nondet cost = Set(0, 1, 3, 7).oneOf()
    nondet known = Set(false, true).oneOf()
    any { reserve(id, alerts, amount), provider(known, cost), reconcile, abandonUncertain }
  }
  val invariant = all {
    s.used >= 0, s.held >= 0,
    s.current != 0 implies s.current.in(s.attempts),
    s.attempts.size() <= 2,
    s.knownCalls <= s.calls,
  }
  run providerOverchargeRemainsHeldTest = init.then(reserve(1, false, 2))
    .then(provider(true, 7)).then(abandonUncertain)
    .expect(s.held == 2 and s.used == 7)
  run unknownAlertsBlockCappedModeTest = init.then(reserve(1, true, 1))
    .then(provider(false, 0)).then(abandonUncertain).expect(s.unknown)
  run unknownCappedCallRetainsEstimateAndHoldTest = init.then(reserve(1, false, 2))
    .then(provider(false, 3)).then(abandonUncertain)
    .expect(s.used == 3 and s.held == 2).then(reserve(2, false, 2).fail())
  run exactReconciliationReleasesCapacityTest = init.then(reserve(1, false, 3))
    .then(provider(true, 1)).then(reconcile).then(reserve(2, false, 3))
    .expect(s.used == 1 and s.held == 3)
}
