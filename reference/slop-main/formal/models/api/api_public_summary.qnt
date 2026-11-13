// @source backend/slopbot/summary.ts
// Read-only aggregate projection uses distinct immutable items. Unavailable
// storage is a failure response and cannot masquerade as an empty leaderboard.
module api_public_summary {
  var s: { completed: Set[int], closed: Set[int], observed: Set[int], phase: str, failed: bool }
  action init = s' = {completed: Set(), closed: Set(), observed: Set(), phase: "loading", failed: false}
  action complete(id: int): bool = s' = s.with("completed", s.completed.union(Set(id)))
  action close(id: int): bool = s' = s.with("closed", s.closed.union(Set(id)))
  action read = all { s.phase == "loading", s' = s.with("observed", s.completed).with("phase", "ready") }
  action unavailable = all { s.phase == "loading", s' = s.with("failed", true).with("phase", "unavailable") }
  action step = { nondet id = Set(1, 2).oneOf()
    any { complete(id), close(id), read, unavailable, s' = s } }
  val invariant = all { s.observed.subseteq(s.completed), s.failed implies s.phase == "unavailable" }
  run duplicateItemCountsOnceTest = init.then(complete(1)).then(complete(1)).then(read).expect(s.observed.size() == 1)
  run failureNotEmptySuccessTest = init.then(unavailable).expect(s.failed and s.phase != "ready")
}
