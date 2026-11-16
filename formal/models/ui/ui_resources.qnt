// @source src/lib/use-public-resource.ts
// @source src/lib/use-snapshot.ts
// @source src/lib/use-cycle-index.ts
// @source src/lib/use-direct-transfers.ts
// @source src/lib/use-vault-payments.ts
// @source src/lib/paged-history.ts
// @source src/Profiles.tsx
// @source src/ProfilePage.tsx
// @source src/EscrowFunding.tsx
// @source src/HomeStandings.tsx
// use-public-resource/use-snapshot/use-cycle-index/use-direct-transfers/use-vault-payments.
// A publication requires complete validated pages; transient refresh may retain old data.
module ui_resources {
  var s: { phase: str, generation: int, dataGeneration: int, complete: bool, valid: bool, enabled: bool, retained: bool, stale: bool }
  action init = s' = { phase: "loading", generation: 1, dataGeneration: 0, complete: false, valid: false, enabled: true, retained: false, stale: false }
  action completeRead = all { s.phase == "loading", s.enabled, s' = s.with("complete", true).with("valid", true) }
  action publish = all { s.phase == "loading", s.complete, s.valid, s.enabled,
    s' = s.with("phase", "ready").with("dataGeneration", s.generation).with("stale", false) }
  action refresh = all { s.phase == "ready", s.generation == 1,
    s' = s.with("generation", 2).with("phase", "loading").with("retained", true).with("complete", false).with("valid", false) }
  action transientFailure = all { s.phase == "loading",
    s' = if(s.retained) s.with("phase", "ready").with("stale", true) else s.with("phase", "error") }
  action authoritativeFailure = all { s.phase == "loading", s' = s.with("phase", "error").with("dataGeneration", 0).with("retained", false) }
  action cancel = s' = s.with("enabled", false)
  action lateReply = all { not(s.enabled), s' = s }
  action age = all { s.phase == "ready", s' = s.with("stale", true) }
  action retry = all { s.phase == "error", s.generation == 1,
    s' = s.with("generation", 2).with("phase", "loading").with("complete", false).with("valid", false) }
  action step = any { completeRead, publish, refresh, transientFailure, authoritativeFailure, cancel, lateReply, age, retry, s' = s }
  val invariant = all { s.phase == "ready" implies s.dataGeneration > 0, s.dataGeneration <= s.generation,
    s.phase == "ready" and s.dataGeneration == s.generation implies s.complete and s.valid }
  run refreshFailureTest = init.then(completeRead).then(publish).then(refresh).then(transientFailure).expect(s.stale and s.dataGeneration == 1)
  run accessLossTest = init.then(completeRead).then(publish).then(refresh).then(authoritativeFailure).expect(s.dataGeneration == 0)
  run partialTest = init.then(transientFailure).expect(s.phase == "error" and s.dataGeneration == 0)
  run cancellationTest = init.then(cancel).then(lateReply).expect(s.dataGeneration == 0)
  run staleTest = init.then(completeRead).then(publish).then(age).expect(s.stale)
}
