// @source workers/slopbot/value-producer.ts
// @source workers/slopbot/value-review.ts
// @source workers/slopbot/value-model-source.ts
// @source workers/slopbot/models.ts
// @source src/lib/model-identity.ts
// Successful API output binds an exact served route; a subscription declaration
// is a different provenance kind and cannot fabricate API billing evidence.
module bot_producer_provenance {
  var s: { kind: str, step: int, allowed: bool, failed: bool, budgetDenied: bool,
    exact: bool, receipt: bool, retained: bool }
  action init = s' = {kind: "none", step: 0, allowed: true, failed: false,
    budgetDenied: false, exact: false, receipt: false, retained: false}
  action apiCall = all { s.kind == "none", s.allowed, not(s.budgetDenied), s.step < 2,
    (s.step == 0 or s.failed), s' = s.with("step", s.step + 1).with("failed", false) }
  action apiFailure = all { s.step > 0, s.kind == "none", s' = s.with("failed", true) }
  action spendingDenied = all { s.step > 0, s' = s.with("budgetDenied", true).with("failed", true) }
  action authorityLost = s' = s.with("allowed", false)
  action apiSuccess = all { s.step > 0, not(s.failed), s.kind == "none",
    s' = s.with("kind", "api").with("exact", true).with("receipt", true) }
  action subscription = all { s.kind == "none", s.step == 0,
    s' = s.with("kind", "subscription").with("exact", true).with("receipt", false) }
  action retain = all { s.kind != "none", s.exact, s' = s.with("retained", true) }
  action step = any { apiCall, apiFailure, spendingDenied, authorityLost,
    apiSuccess, subscription, retain, s' = s }
  val invariant = all { s.kind == "subscription" implies not(s.receipt) and s.step == 0,
    s.retained implies s.exact and s.kind != "none", s.step <= 2 }
  run fallbackHasIndependentAdmissionTest = init.then(apiCall).then(apiFailure).then(authorityLost)
    .expect(s.step == 1 and not(s.allowed))
  run subscriptionNeverClaimsApiReceiptTest = init.then(subscription).then(retain)
    .expect(s.retained and not(s.receipt))
  run budgetDenialStopsRouteTest = init.then(apiCall).then(spendingDenied)
    .expect(s.step == 1 and s.budgetDenied)
}
