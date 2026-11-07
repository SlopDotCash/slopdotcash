// @source scripts/renew-private-intake.mjs
// @source backend/trace/cloudflare-persistence.ts
// A verified disabled observation is persisted before the command fails.
// Transport failure writes nothing; only a newer observation replaces state.
module operator_intake_renewal {
  var s: { now: int, storedAt: int, enabled: bool, observedAt: int, observation: bool, phase: str }
  action init = s' = {now: 0, storedAt: -1, enabled: false, observedAt: -1, observation: false, phase: "ready"}
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1) }
  action observe(isEnabled: bool): bool = all { s.phase == "ready",
    s' = s.with("observedAt", s.now).with("observation", isEnabled).with("phase", "verified") }
  action unavailable = all { s.phase == "ready", s' = s.with("phase", "failed") }
  action persist = all { s.phase == "verified",
    s' = s.with("storedAt", if (s.observedAt > s.storedAt) s.observedAt else s.storedAt)
      .with("enabled", if (s.observedAt > s.storedAt) s.observation else s.enabled)
      .with("phase", if (s.observation) "complete" else "failed") }
  action nextInvocation = all { s.phase.in(Set("failed", "complete")), s' = s.with("phase", "ready") }
  val uploadEnabled = s.enabled and s.storedAt >= 0 and s.now - s.storedAt <= 1
  action step = any { tick, observe(true), observe(false), unavailable, persist, nextInvocation, s' = s }
  val invariant = s.storedAt <= s.now
  run disabledObservationStoredBeforeFailureTest = init.then(observe(false)).then(persist)
    .expect(s.phase == "failed" and s.storedAt == 0 and not(uploadEnabled))
  run outageDoesNotRefreshHealthTest = init.then(observe(true)).then(persist).then(nextInvocation).then(tick).then(tick)
    .then(unavailable).expect(s.storedAt == 0 and not(uploadEnabled))
  run oldTimestampDoesNotReplaceTest = init.then(observe(true)).then(persist).then(nextInvocation).then(observe(false))
    .then(persist).expect(s.enabled and s.storedAt == 0)
}
