// @source workers/slopbot/value-import.ts
// @source workers/slopbot/value-import-service.ts
// @source workers/slopbot/value-settings.ts
// @source workers/slopbot/value-merge-resolution.ts
// Private import binds a deployed producer, subscription provenance and every
// source before cutoff. Optional Git reconstruction binds the exact input set.
module bot_historical_import {
  var s: { phase: str, legacy: bool, subscription: bool, producer: bool,
    bound: bool, reconstructed: bool, needsGit: bool, published: bool }
  action init = s' = {phase: "empty", legacy: false, subscription: false,
    producer: false, bound: false, reconstructed: false, needsGit: false, published: false}
  action admit(allLegacy: bool, isSubscription: bool): bool = all { s.phase == "empty",
    s' = s.with("phase", "input").with("legacy", allLegacy)
      .with("subscription", isSubscription).with("producer", true) }
  action collect(needsGit: bool): bool = all { s.phase == "input", s.legacy, s.subscription, s.producer,
    s' = s.with("phase", "collected").with("bound", true).with("needsGit", needsGit) }
  action reconstruct = all { s.phase == "collected", s.needsGit,
    s' = s.with("reconstructed", true) }
  action publish = all { s.phase == "collected", s.bound,
    not(s.needsGit) or s.reconstructed,
    s' = s.with("published", true).with("phase", "published") }
  action step = { nondet legacy = Set(false, true).oneOf()
    nondet subscriptionKind = Set(false, true).oneOf()
    any { admit(legacy, subscriptionKind), collect(true), collect(false), reconstruct, publish, s' = s } }
  val invariant = s.published implies s.legacy and s.subscription and s.producer and s.bound
    and (not(s.needsGit) or s.reconstructed)
  run apiEraWorkRejectedTest = init.then(admit(false, true)).expect(not(s.legacy) and not(s.published))
  run privateHistoricalImportTest = init.then(admit(true, true)).then(collect(true))
    .then(reconstruct).then(publish).expect(s.published and invariant)
}
