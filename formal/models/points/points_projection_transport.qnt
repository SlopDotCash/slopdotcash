// @source scripts/generate-points.ts
// @evidence scripts/points-history-retry.test.ts
// Starts inside the projection loader, after any caller availability probe.
// Two shards and two index generations. Shard reads commute; here they
// complete in order and the assembly gate sees both identities together.
module points_projection_transport {
  var s: { phase: str, attempt: int, index: int, first: int, second: int,
    rollover: bool, verified: int }

  pure def reading(phase) = Set("index", "first", "second").contains(phase)

  action init = s' = { phase: "index", attempt: 1, index: 0, first: 0,
    second: 0, rollover: false, verified: 0 }

  action reset = all {
    reading(s.phase),
    s' = if (s.attempt < 3) s.with("attempt", s.attempt + 1)
         else s.with("phase", "refused"),
  }

  action invalid = all { reading(s.phase), s' = s.with("phase", "refused") }

  action readIndex(generation) = all {
    s.phase == "index",
    s' = if (s.rollover and generation == s.index) s.with("phase", "refused")
         else s.with("phase", "first").with("index", generation).with("attempt", 1),
  }

  action readFirst(generation) = all {
    s.phase == "first",
    s' = s.with("phase", "second").with("first", generation).with("attempt", 1),
  }

  action readSecond(generation) = all {
    s.phase == "second",
    s' = s.with("phase", "assemble").with("second", generation),
  }

  action assemble = all {
    s.phase == "assemble",
    s' = if (s.first == s.index and s.second == s.index)
           s.with("phase", "verified").with("verified", s.index)
         else if (s.rollover) s.with("phase", "refused")
         else s.with("phase", "index").with("rollover", true)
           .with("first", 0).with("second", 0).with("attempt", 1),
  }

  action step = {
    nondet generation = Set(1, 2).oneOf()
    any { reset, invalid, readIndex(generation), readFirst(generation),
      readSecond(generation), assemble }
  }

  val invariant = all {
    s.attempt >= 1 and s.attempt <= 3,
    s.verified > 0 implies (s.phase == "verified" and
      s.index == s.verified and s.first == s.verified and s.second == s.verified),
  }

  run resetResumesSameReadTest = init.then(reset).then(reset).then(readIndex(1))
    .then(readFirst(1)).then(reset).then(readSecond(1)).then(assemble)
    .expect(s.verified == 1 and not(s.rollover))
  run thirdResetRefusesTest = init.then(readIndex(1)).then(reset).then(reset).then(reset)
    .expect(s.phase == "refused" and s.attempt == 3 and not(s.rollover))
  run invalidReadNeverRetriesTest = init.then(readIndex(1)).then(invalid)
    .expect(s.phase == "refused" and s.attempt == 1 and not(s.rollover))
  run unchangedIndexCannotRepairMismatchTest = init.then(readIndex(1))
    .then(readFirst(2)).then(readSecond(1)).then(assemble).then(reset).then(readIndex(1))
    .expect(s.phase == "refused" and s.verified == 0)
  run oneChangedIndexCanRepairMismatchTest = init.then(readIndex(1))
    .then(readFirst(1)).then(readSecond(2)).then(assemble).then(readIndex(2))
    .then(readFirst(2)).then(readSecond(2)).then(assemble).expect(s.verified == 2)
  run secondMismatchRefusesTest = init.then(readIndex(1))
    .then(readFirst(1)).then(readSecond(2)).then(assemble).then(readIndex(2))
    .then(readFirst(2)).then(readSecond(1)).then(assemble)
    .expect(s.phase == "refused" and s.verified == 0)
}
