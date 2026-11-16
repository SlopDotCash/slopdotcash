// @source src/lib/leaderboard-transport.mjs
// @source scripts/leaderboard-files.mjs
// @source scripts/prepare-leaderboard-transport.mjs
// @source scripts/download-leaderboard.ts
// Two parts and two deployments. A missing old part may restart only from a
// changed index; digest failures cannot be repaired by silently mixing parts.
module leaderboard_transport {
  var s: { source: int, index: int, first: int, second: int,
    restarts: int, phase: str, rendered: int }
  action init = s' = { source: 1, index: 1, first: 0, second: 0,
    restarts: 0, phase: "reading", rendered: 0 }
  action deployNew = all { s.source == 1, s' = s.with("source", 2) }
  action first = all { s.phase == "reading", s.index == s.source,
    s' = s.with("first", s.index) }
  action second = all { s.phase == "reading", s.index == s.source,
    s' = s.with("second", s.index) }
  action missingPart = all { s.phase == "reading", s.index != s.source,
    s' = s.with("phase", "missing") }
  action restart = all { s.phase == "missing", s.restarts == 0, s.source != s.index,
    s' = s.with("index", s.source).with("first", 0).with("second", 0)
      .with("phase", "reading").with("restarts", 1) }
  action corrupt = all { s.phase == "reading", s' = s.with("phase", "error") }
  action reconstruct = all { s.phase == "reading", s.first == s.index, s.second == s.index,
    s' = s.with("phase", "complete").with("rendered", s.index) }
  action step = any { deployNew, first, second, missingPart, restart, corrupt, reconstruct }
  val invariant = all {
    s.rendered > 0 implies (s.first == s.rendered and s.second == s.rendered),
    s.phase == "error" implies s.rendered == 0,
    s.restarts <= 1,
  }
  run oneConsistentGenerationTest = init.then(first).then(second).then(reconstruct)
    .expect(s.rendered == 1)
  run deploymentBetweenPartsTest = init.then(first).then(deployNew).then(missingPart)
    .then(restart).then(first).then(second).then(reconstruct).expect(s.rendered == 2)
  run digestFailureDoesNotFallbackTest = init.then(first).then(corrupt)
    .expect(s.rendered == 0 and s.phase == "error")
}
