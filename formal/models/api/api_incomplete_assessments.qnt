// @source backend/notifications/incomplete-assessments.ts
// @source workers/slopbot/value-processing.ts
// @source migrations/0115_incomplete_value_inbox.sql
// The durable gap survives running, retry and attempt exhaustion. Completion
// of this PR removes it; a newer gap after completion remains visible.
module api_incomplete_assessments {
  var s: { now: int, gapAt: int, resolvedAt: int, phase: str, allowed: bool, displayed: bool }
  action init = s' = {now: 0, gapAt: -1, resolvedAt: -1, phase: "running", allowed: false, displayed: false}
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1) }
  action incomplete = s' = s.with("gapAt", if (s.gapAt == -1) s.now else s.gapAt).with("phase", "waiting")
  action retry = all { s.phase == "waiting", s' = s.with("phase", "running") }
  action exhausted = all { s.phase == "running", s' = s.with("phase", "attempts-exhausted") }
  action complete = s' = s.with("resolvedAt", s.now).with("phase", "completed").with("gapAt", -1).with("displayed", false)
  action authorize = s' = s.with("allowed", true)
  action revoke = s' = s.with("allowed", false).with("displayed", false)
  action read = s' = s.with("displayed", s.allowed and s.gapAt > s.resolvedAt)
  action step = any { tick, incomplete, retry, exhausted, complete, authorize, revoke, read, s' = s }
  val invariant = s.displayed implies s.allowed
  run gapSurvivesExhaustionTest = init.then(incomplete).then(retry).then(exhausted).then(authorize).then(read)
    .expect(s.displayed and s.gapAt == 0)
  run completedSourceHiddenTest = init.then(incomplete).then(authorize).then(complete).then(read).expect(not(s.displayed))
  run laterGapRemainsTest = init.then(complete).then(tick).then(incomplete).then(authorize).then(read).expect(s.displayed)
}
