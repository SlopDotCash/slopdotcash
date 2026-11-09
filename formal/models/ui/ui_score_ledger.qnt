// @source src/lib/leaderboard.ts
// addScore/appendScore: current-v2 actor+project+UTC-month+work-unit dedupe,
// source ownership shared across co-authors, ban boundary, integer thirds.
// Legacy diminishing score and external value assessment are not abstracted here.
module ui_score_ledger {
  type Event = { actor: int, project: int, month: int, unit: int, source: int, thirds: int, time: int }
  var events: Set[Event]
  var banned: bool
  var time: int
  pure def sameUnit(a: Event, b: Event): bool =
    a.project == b.project and a.month == b.month and a.unit == b.unit
  pure def creditKey(e: Event): int = e.actor * 1000 + e.project * 100 + e.month * 10 + e.unit
  action init = all { events' = Set(), banned' = false, time' = 1 }
  action credit(actor: int, project: int, month: int, unit: int, source: int): bool = {
    val event = { actor: actor, project: project, month: month, unit: unit,
      source: source, thirds: 1, time: time }
    all {
      not(banned and actor == 2 and time == 2),
      not(events.exists(e => creditKey(e) == creditKey(event))),
      events.forall(e => sameUnit(e, event) implies e.source == source),
      // Two events cover each pairwise duplicate/co-author/isolation invariant.
      events.size() < 2,
      events' = events.union(Set(event)), banned' = banned, time' = time
    }
  }
  action accept = {
    nondet actor = Set(1, 2).oneOf()
    nondet project = Set(1, 2).oneOf()
    nondet month = Set(1, 2).oneOf()
    nondet unit = Set(1, 2).oneOf()
    nondet source = Set(1, 2).oneOf()
    credit(actor, project, month, unit, source)
  }
  action advance = all { time' = 2, events' = events, banned' = banned }
  action ban = all { banned' = true, events' = events, time' = time }
  action step = any { accept, advance, ban }
  val invariant = all {
    events.map(e => creditKey(e)).size() == events.size(),
    events.forall(a => events.forall(b => sameUnit(a, b) implies a.source == b.source)),
    events.forall(e => e.thirds == 1), events.size() <= 2
  }
  run acceptedTest = init.then(credit(1, 1, 1, 1, 1)).expect(events.size() == 1)
  run coAuthorTest = init.then(credit(1, 1, 1, 1, 1)).then(credit(2, 1, 1, 1, 1)).expect(events.size() == 2)
  run monthIsolationTest = init.then(credit(1, 1, 1, 1, 1)).then(credit(1, 1, 2, 1, 2)).expect(events.size() == 2)
  run projectIsolationTest = init.then(credit(1, 1, 1, 1, 1)).then(credit(1, 2, 1, 1, 2)).expect(events.size() == 2)
  run existingCreditSurvivesBanTest = init.then(credit(2, 1, 1, 1, 1)).then(ban).then(advance).expect(events.size() == 1)
}
