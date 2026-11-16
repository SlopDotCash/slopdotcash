// @source workers/slopbot/value-producer.ts
// @source workers/slopbot/value-review.ts
// @source workers/slopbot/value-model-source.ts
// @source workers/slopbot/models.ts
// @source src/lib/model-identity.ts
// Successful API output binds an exact served route; a subscription declaration
// is a different provenance kind and cannot fabricate API billing evidence.
// Three entries are Surplus Sonnet, Surplus Terra and Orbio Sonnet.
// A structured Surplus spending denial skips the remaining Surplus entry and
// may still reach the Orbio backstop. Ordinary failures move to the next entry.
// Missing Surplus credentials skip both Surplus entries without an API receipt.
// step is the consumed route position, not a provider request count.
// Historical API producer metadata stays readable after its route retires;
// reading it does not mint a new API receipt or authorize a new call.
// External transport and receipt truth remain separate integration obligations.
module bot_producer_provenance {
  var s: { kind: str, step: int, allowed: bool, failed: bool, budgetDenied: bool,
    exact: bool, receipt: bool, retained: bool }
  action init = s' = {kind: "none", step: 0, allowed: true, failed: false,
    budgetDenied: false, exact: false, receipt: false, retained: false}
  action missingSurplus = all { s.kind == "none", s.step == 0,
    s' = s.with("step", 2).with("failed", true) }
  action apiCall = all { s.kind == "none", s.allowed, s.step < 3,
    (s.step == 0 or s.failed), s' = s.with("step", s.step + 1).with("failed", false) }
  action apiFailure = all { s.step > 0, s.kind == "none", s' = s.with("failed", true) }
  // Only a Surplus answer (positions 1 and 2) can be a spending denial. It
  // consumes the remaining Surplus position, so the next call is Orbio.
  action spendingDenied = all { s.step > 0, s.step <= 2, not(s.failed), s.kind == "none",
    s' = s.with("budgetDenied", true).with("failed", true).with("step", 2) }
  action authorityLost = s' = s.with("allowed", false)
  action apiSuccess = all { s.step > 0, not(s.failed), s.kind == "none",
    s' = s.with("kind", "api").with("exact", true).with("receipt", true) }
  action historicalMetadata = all { s.kind == "none", s.step == 0,
    s' = s.with("kind", "historical").with("exact", true).with("receipt", false) }
  action subscription = all { s.kind == "none", s.step == 0,
    s' = s.with("kind", "subscription").with("exact", true).with("receipt", false) }
  action retain = all { s.kind != "none", s.exact, s' = s.with("retained", true) }
  action step = any { missingSurplus, apiCall, apiFailure, spendingDenied, authorityLost,
    apiSuccess, historicalMetadata, subscription, retain, s' = s }
  val invariant = all { Set("subscription", "historical").contains(s.kind) implies not(s.receipt) and s.step == 0,
    s.retained implies s.exact and s.kind != "none", s.step <= 3,
    s.budgetDenied implies s.step >= 2,
    (s.kind == "api" and s.budgetDenied) implies s.step == 3 }
  run retiredProducerHistoryStillReadsTest = init.then(historicalMetadata).then(retain)
    .expect(s.kind == "historical" and s.retained and not(s.receipt) and invariant)
    .then(apiCall.fail())
  run missingSurplusDoesNotCreateReceiptTest = init.then(missingSurplus)
    .expect(s.step == 2 and not(s.receipt)).then(apiCall).then(apiSuccess).then(retain)
    .expect(s.step == 3 and s.retained and s.receipt and invariant)
  run fallbackHasIndependentAdmissionTest = init.then(apiCall).then(apiFailure).then(authorityLost)
    .expect(s.step == 1 and not(s.allowed))
  run subscriptionNeverClaimsApiReceiptTest = init.then(subscription).then(retain)
    .expect(s.retained and not(s.receipt))
  run budgetDenialSkipsTerraAndReachesOrbioTest = init.then(apiCall).then(spendingDenied)
    .expect(s.step == 2 and s.budgetDenied).then(apiCall).then(apiSuccess).then(retain)
    .expect(s.step == 3 and s.kind == "api" and s.retained and invariant)
  run budgetDenialThenOrbioFailureEndsRouteTest = init.then(apiCall).then(spendingDenied)
    .then(apiCall).then(apiFailure)
    .expect(s.step == 3 and s.budgetDenied and s.kind == "none" and invariant).then(apiCall.fail())
  run terraDenialStillReachesOrbioTest = init.then(apiCall).then(apiFailure)
    .then(apiCall).then(spendingDenied).then(apiCall).then(apiSuccess)
    .expect(s.step == 3 and s.kind == "api" and invariant)
  run orbioFailureIsNeverASpendingDenialTest = init.then(apiCall).then(apiFailure)
    .then(apiCall).then(apiFailure).then(apiCall).then(spendingDenied.fail())
  run surplusFailureReachesTerraTest = init.then(apiCall).then(apiFailure)
    .then(apiCall).then(apiSuccess).then(retain)
    .expect(s.step == 2 and s.retained and s.kind == "api" and invariant)
  run allThreeFailuresExhaustRouteTest = init.then(apiCall).then(apiFailure)
    .then(apiCall).then(apiFailure).then(apiCall).then(apiFailure)
    .expect(s.step == 3 and s.kind == "none" and invariant).then(apiCall.fail())
}
