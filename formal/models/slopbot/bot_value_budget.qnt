// @source migrations/0051_slopbot_value_budget.sql
// @source migrations/0077_slopbot_alerts_only.sql
// @source migrations/0084_slopbot_attempt_accounting.sql
// @source workers/slopbot/value-budget.ts
// @source workers/slopbot/value-inference.ts
// @source workers/slopbot/value-consumption.ts
// @source workers/slopbot/models.ts
// @source migrations/0118_slopbot_zero_call_reconciliation.sql
// Two attempts, cap six units. Unknown or excess provider charges remain
// unreconciled; this model does not pretend a reservation binds the provider.
// The route rechecks authority before its first request. A refusal or failed
// check there returns with no call; that attempt reconciles with zero calls and
// zero cost (migration 0118). Before that change such an attempt ended with
// its hold intact and no call; `holdsAccounted` rejects that state.
module bot_value_budget {
  var s: { used: int, held: int, unknown: bool, priorUnknown: bool, attempts: Set[int],
    current: int, mode: str, reserved: int, calls: int, knownCalls: int, cost: int,
    uncertainHeld: int, completedNoCall: bool }
  action init = s' = { used: 0, held: 0, unknown: false, priorUnknown: false, attempts: Set(),
    current: 0, mode: "none", reserved: 0, calls: 0, knownCalls: 0, cost: 0,
    uncertainHeld: 0, completedNoCall: false }
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
    s.current != 0, s.calls == 0, not(s.completedNoCall), cost.in(Set(0, 1, 3, 7)),
    s' = s.with("calls", 1).with("knownCalls", if (known) 1 else 0)
      .with("cost", if (known) cost else 0).with("used", s.used + cost),
  }
  action completeNoCall = all { s.current != 0, s.calls == 0,
    s' = s.with("completedNoCall", true) }
  action reconcile = all {
    s.current != 0, (s.calls == 1 and s.knownCalls == 1) or s.completedNoCall,
    s.mode == "alerts" or s.cost <= s.reserved,
    s' = s.with("current", 0).with("held", s.held - s.reserved)
      .with("unknown", s.priorUnknown).with("mode", "none").with("reserved", 0)
      .with("calls", 0).with("knownCalls", 0).with("cost", 0).with("completedNoCall", false),
  }
  action abandonUncertain = all {
    s.current != 0, s.calls == 1,
    s.knownCalls == 0 or (s.mode == "capped" and s.cost > s.reserved),
    s' = s.with("current", 0).with("mode", "none")
      .with("uncertainHeld", s.uncertainHeld + s.reserved)
      .with("reserved", 0).with("calls", 0).with("knownCalls", 0).with("cost", 0).with("completedNoCall", false),
  }
  action step = {
    nondet id = Set(1, 2).oneOf()
    nondet alerts = Set(false, true).oneOf()
    nondet amount = Set(1, 2, 3).oneOf()
    nondet cost = Set(0, 1, 3, 7).oneOf()
    nondet known = Set(false, true).oneOf()
    any { reserve(id, alerts, amount), provider(known, cost), completeNoCall, reconcile,
      abandonUncertain }
  }
  // Every hold belongs to the live attempt or to one that made a call whose
  // charge is unknown or excessive. A no-call hold stays until its explicit
  // completion and zero reconciliation have both been recorded.
  val holdsAccounted = s.held == s.reserved + s.uncertainHeld
  val invariant = all {
    s.used >= 0, s.held >= 0,
    s.current != 0 implies s.current.in(s.attempts),
    s.attempts.size() <= 2,
    s.knownCalls <= s.calls,
    holdsAccounted,
    s.completedNoCall implies (s.current != 0 and s.calls == 0),
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
  run authorityRefusalBeforeCallReleasesHoldTest = init.then(reserve(1, false, 3))
    .then(completeNoCall).then(reconcile).expect(s.held == 0 and s.used == 0 and s.current == 0)
    .then(reserve(2, false, 3)).expect(s.held == 3)
  run alertsRefusalBeforeCallRestoresCappedModeTest = init.then(reserve(1, true, 1))
    .then(completeNoCall).then(reconcile).expect(not(s.unknown)).then(reserve(2, false, 3))
    .expect(s.mode == "capped" and s.held == 3)
  run completedNoCallReleasesCapacityTest = init.then(reserve(1, false, 3))
    .then(completeNoCall).then(reconcile).then(reserve(2, false, 3))
    .expect(s.used == 0 and s.held == 3)
  run unfinishedNoCallRemainsHeldTest = init.then(reserve(1, false, 3))
    .then(reconcile.fail())
}
