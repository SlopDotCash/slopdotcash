// @source src/lib/global-leaderboard.ts
// @source src/lib/verified-global-joins.ts
// @source src/lib/reviewer-leaders.ts
// @source src/lib/who-builds.ts
// A closed cycle record replaces rolling events only for the actors it lists
// for that project/month. A closed record carries no score for an actor it
// does not list, so that actor's events stay open. Tokens remain
// analysis-only; reviewer points are a filtered view of the same ledger.
module ui_history_projection {
  type Event = { actor: int, month: int, project: int, review: bool }
  var events: Set[Event]
  var closed: Set[int]
  var tokens: int
  pure def actorCycleKey(e: Event): int = e.project * 100 + e.month * 10 + e.actor
  val openEvents = events.filter(e => not(closed.contains(actorCycleKey(e))))
  // Each closed (project, month, actor) scope contributes one score unit
  // from the cycle record for that actor.
  val total = openEvents.size() + closed.size()
  val reviewers = openEvents.filter(e => e.review)
  action init = all { events' = Set(), closed' = Set(), tokens' = 0 }
  action observeEvent(actor: int, month: int, project: int, review: bool): bool = all {
    events.size() < 2,
    events' = events.union(Set({actor: actor, month: month, project: project, review: review})),
    closed' = closed, tokens' = tokens }
  action observe = {
    nondet actor = Set(1, 2).oneOf()
    nondet month = Set(1, 2).oneOf()
    nondet project = Set(1, 2).oneOf()
    nondet review = Set(false, true).oneOf()
    all { events.size() < 2,
      events' = events.union(Set({actor: actor, month: month, project: project, review: review})),
      closed' = closed, tokens' = tokens }
  }
  action close(project: int, month: int, actor: int): bool = all {
    closed' = closed.union(Set(project * 100 + month * 10 + actor)), events' = events, tokens' = tokens }
  action archive = {
    nondet project = Set(1, 2).oneOf()
    nondet month = Set(1, 2).oneOf()
    nondet actor = Set(1, 2).oneOf()
    close(project, month, actor)
  }
  action usage = all { tokens' = 1, events' = events, closed' = closed }
  action step = any { observe, archive, usage }
  val invariant = all {
    openEvents.forall(e => not(closed.contains(actorCycleKey(e)))),
    reviewers.forall(e => e.review),
    total == events.filter(e => not(closed.contains(actorCycleKey(e)))).size() + closed.size(),
    events.size() <= 2, tokens >= 0, tokens <= 1
  }
  run emptyTest = init.expect(total == 0)
  run archiveTest = init.then(observe).then(close(1, 1, 1)).expect(closed.contains(111))
  run diagnosticUsageTest = init.then(usage).expect(total == 0 and tokens == 1)
  run immutableArchiveTest = init.then(close(1, 1, 1)).then(close(1, 1, 1)).expect(total == 1)
  run perActorArchiveTest = init.then(close(1, 1, 1)).then(close(1, 1, 2)).expect(total == 2 and closed.size() == 2)
  run unlistedActorStaysOpenTest = init.then(observeEvent(1, 1, 1, false)).then(observeEvent(2, 1, 1, false)).then(close(1, 1, 1)).expect(total == 2 and openEvents.size() == 1)
  run closedNoAwardsMonthTest = init.then(observeEvent(1, 1, 1, false)).then(observeEvent(2, 1, 1, false)).expect(total == 2 and openEvents.size() == 2)
}
