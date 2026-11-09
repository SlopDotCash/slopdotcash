// @source scripts/generate-leaderboard.ts
// @source src/lib/leaderboard-types.ts
// @evidence scripts/evaluated-window.test.ts
// selectEvaluatedContributionsForWindow only; file loading/duplicate admission
// and downstream scoring/journal publication have separate models. Two input
// events, two calls, half-second time classes 0..10. Window/actual Date inputs
// are floored to seconds; event timestamps retain their exact half-second.
// Native Date validity and canonical UTC spelling are supplied predicates.
// The synchronous filter keeps input order and duplicate objects. It validates
// every event, including ones outside the window. An accepted local prefix is
// never returned if a later event throws. No event or award is mutated here.
module evaluated_award_window {
  val slots = Set(1, 2)
  val times = 0.to(10)
  type Event = { identity: int, category: bool, exact: bool, at: int }
  type State = { phase: str, call: int, rawFrom: int, rawTo: int, rawNow: int, validDates: bool,
    from: int, to: int, now: int, count: int, cursor: int, events: int -> Event,
    accepted: List[int], returned: List[int], error: str }
  var s: State
  pure def floorSecond(time: int): int = if (time < 2) 0 else if (time < 4) 2
    else if (time < 6) 4 else if (time < 8) 6 else if (time < 10) 8 else 10
  action init = s' = { phase: "input", call: 1, rawFrom: 2, rawTo: 6, rawNow: 8, validDates: true,
    from: 0, to: 0, now: 0, count: 2, cursor: 1,
    events: Map(1 -> { identity: 1, category: true, exact: true, at: 2 },
      2 -> { identity: 2, category: true, exact: true, at: 6 }),
    accepted: List(), returned: List(), error: "none" }
  action configure(from: int, to: int, now: int, datesValid: bool, count: int): bool = all {
    s.phase == "input", times.contains(from), times.contains(to), times.contains(now), Set(0, 1, 2).contains(count),
    s' = s.with("rawFrom", from).with("rawTo", to).with("rawNow", now).with("validDates", datesValid).with("count", count) }
  action event(slot: int, identity: int, category: bool, exact: bool, at: int): bool = all {
    s.phase == "input", slots.contains(slot), slots.contains(identity), times.contains(at),
    s' = s.with("events", s.events.set(slot, { identity: identity, category: category, exact: exact, at: at })) }
  action begin = all { s.phase == "input",
    s' = if (not(s.validDates)) s.with("phase", "failed").with("error", "invalid-date")
      else s.with("phase", "bounds").with("from", floorSecond(s.rawFrom))
        .with("to", floorSecond(s.rawTo)).with("now", floorSecond(s.rawNow)) }
  action bounds = all { s.phase == "bounds",
    s' = if (s.from >= s.to) s.with("phase", "failed").with("error", "empty-window")
      else if (s.to > s.now) s.with("phase", "failed").with("error", "future-window")
      else s.with("phase", "filter") }
  action filterOne = {
    val event = s.events.get(if (slots.contains(s.cursor)) s.cursor else 1)
    all { s.phase == "filter",
      s' = if (s.cursor > s.count) s.with("phase", "done").with("returned", s.accepted)
        else if (not(event.category)) s.with("phase", "failed").with("error", "category")
        else if (not(event.exact)) s.with("phase", "failed").with("error", "timestamp")
        else if (event.at > s.now) s.with("phase", "failed").with("error", "future-event")
        else s.with("cursor", s.cursor + 1).with("accepted",
          if (event.at >= s.from and event.at < s.to) s.accepted.append(event.identity) else s.accepted) }
  }
  action retry = all { Set("done", "failed").contains(s.phase), s.call == 1,
    s' = s.with("phase", "input").with("call", 2).with("cursor", 1)
      .with("accepted", List()).with("returned", List()).with("error", "none") }
  action step = {
    nondet from = times.oneOf() nondet to = times.oneOf() nondet now = times.oneOf()
    nondet slot = slots.oneOf() nondet identity = slots.oneOf() nondet count = Set(0, 1, 2).oneOf()
    nondet yes = Set(false, true).oneOf() nondet other = Set(false, true).oneOf()
    any { configure(from, to, now, yes, count), event(slot, identity, yes, other, now), begin, bounds, filterOne, retry, s' = s }
  }
  val expected = List(1, 2).foldl(List(), (result, index) => {
    val event = s.events.get(index)
    if (index <= s.count and event.at >= s.from and event.at < s.to) result.append(event.identity) else result
  })
  val invariant = all { s.call <= 2, s.cursor >= 1, s.cursor <= 3,
    s.returned.length() <= s.count,
    s.phase == "failed" implies s.returned == List(),
    s.phase == "done" implies s.returned == expected and s.from < s.to and s.to <= s.now,
    s.phase == "done" implies 1.to(s.count).forall(index => {
      val event = s.events.get(index)
      event.category and event.exact and event.at <= s.now
    }) }
  action runWindow = begin.then(bounds).then(filterOne).then(filterOne).then(filterOne)
  run inclusiveStartExclusiveEndTest = init.then(runWindow).expect(s.returned == List(1) and invariant)
  run inputOrderAndDuplicateIdentitiesArePreservedTest = init.then(event(1, 2, true, true, 4))
    .then(event(2, 2, true, true, 2)).then(runWindow).expect(s.returned == List(2, 2) and invariant)
  run fractionalEventInsideWindowIsRetainedTest = init.then(event(2, 2, true, true, 5)).then(runWindow)
    .expect(s.returned == List(1, 2) and invariant)
  run invalidOutsideWindowEventStillRefusesBatchTest = init.then(event(2, 2, false, true, 0))
    .then(begin).then(bounds).then(filterOne).then(filterOne)
    .expect(s.error == "category" and s.accepted == List(1) and s.returned == List() and invariant)
  run malformedTimestampOutsideWindowStillRefusesTest = init.then(event(2, 2, true, false, 0))
    .then(begin).then(bounds).then(filterOne).then(filterOne).expect(s.error == "timestamp" and invariant)
  run futureEventOutsideWindowStillRefusesTest = init.then(event(2, 2, true, true, 9))
    .then(begin).then(bounds).then(filterOne).then(filterOne).expect(s.error == "future-event" and invariant)
  run actualClockFloorsBeforeFutureCheckTest = init.then(configure(2, 6, 9, true, 2)).then(event(2, 2, true, true, 9))
    .then(begin).then(bounds).then(filterOne).then(filterOne).expect(s.now == 8 and s.error == "future-event" and invariant)
  run equalFlooredBoundsAreEmptyTest = init.then(configure(2, 3, 8, true, 2)).then(begin).then(bounds)
    .expect(s.error == "empty-window" and invariant)
  run futureWindowRefusesBeforeEventsTest = init.then(configure(2, 10, 8, true, 2)).then(begin).then(bounds)
    .expect(s.error == "future-window" and s.accepted == List() and invariant)
  run invalidDateRefusesBeforeRangeCheckTest = init.then(configure(4, 2, 8, false, 2)).then(begin)
    .expect(s.error == "invalid-date" and invariant)
  run correctedRetryDoesNotRetainAcceptedPrefixTest = init.then(event(2, 2, true, false, 4))
    .then(begin).then(bounds).then(filterOne).then(filterOne).then(retry).then(event(2, 2, true, true, 4))
    .then(runWindow).expect(s.returned == List(1, 2) and s.call == 2 and invariant)
  run emptyValidWindowReturnsEmptyTest = init.then(configure(2, 6, 8, true, 0)).then(begin).then(bounds).then(filterOne)
    .expect(s.phase == "done" and s.returned == List() and invariant)
}
