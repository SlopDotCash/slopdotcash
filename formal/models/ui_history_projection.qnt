// @source src/lib/global-leaderboard.ts
// @source src/lib/reviewer-leaders.ts
// @source src/lib/who-builds.ts
// Closed cycle records replace rolling events for that project/month. Tokens
// remain analysis-only; reviewer points are a filtered view of the same ledger.
module ui_history_projection {
  type Event = { actor: int, month: int, project: int, review: bool }
  var events: Set[Event]
  var closed: Set[int]
  var tokens: int
  pure def cycleKey(e: Event): int = e.project * 10 + e.month
  val openEvents = events.filter(e => not(closed.contains(cycleKey(e))))
  // A bounded archive contains one score unit for each of its two actors.
  val total = openEvents.size() + closed.size() * 2
  val reviewers = openEvents.filter(e => e.review)
  action init = all { events' = Set(), closed' = Set(), tokens' = 0 }
  action observe = {
    nondet actor = Set(1, 2).oneOf()
    nondet month = Set(1, 2).oneOf()
    nondet project = Set(1, 2).oneOf()
    nondet review = Set(false, true).oneOf()
    all { events.size() < 2,
      events' = events.union(Set({actor: actor, month: month, project: project, review: review})),
      closed' = closed, tokens' = tokens }
  }
  action close(project: int, month: int): bool = all {
    closed' = closed.union(Set(project * 10 + month)), events' = events, tokens' = tokens }
  action archive = {
    nondet project = Set(1, 2).oneOf()
    nondet month = Set(1, 2).oneOf()
    close(project, month)
  }
  action usage = all { tokens' = 1, events' = events, closed' = closed }
  action step = any { observe, archive, usage }
  val invariant = all {
    openEvents.forall(e => not(closed.contains(cycleKey(e)))),
    reviewers.forall(e => e.review),
    total == events.filter(e => not(closed.contains(cycleKey(e)))).size() + closed.size() * 2,
    events.size() <= 2, tokens >= 0, tokens <= 1
  }
  run emptyTest = init.expect(total == 0)
  run archiveTest = init.then(observe).then(close(1, 1)).expect(closed.contains(11))
  run diagnosticUsageTest = init.then(usage).expect(total == 0 and tokens == 1)
  run immutableArchiveTest = init.then(close(1, 1)).then(close(1, 1)).expect(total == 2)
}
