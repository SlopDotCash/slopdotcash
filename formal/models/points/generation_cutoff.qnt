// @source scripts/generate-leaderboard.ts
// @evidence scripts/evaluated-window.test.ts
// parseGenerationArguments only. Zero arguments or one exact --cutoff pair;
// canonical UTC/date parsing are predicates. Half-second classes 0..10 retain
// the explicit cutoff while the current clock is floored to whole seconds.
// No arguments returns {} before reading/validating currentTime. CLI parsing
// does not itself collect GitHub, select a window or publish a snapshot.
module generation_cutoff {
  val times = 0.to(10)
  var s: { phase: str, shape: str, cutoff: int, canonical: bool, valid: bool,
    now: int, currentValid: bool, returned: int, error: str }
  pure def floorSecond(time: int): int = if (time < 2) 0 else if (time < 4) 2
    else if (time < 6) 4 else if (time < 8) 6 else if (time < 10) 8 else 10
  action init = s' = { phase: "input", shape: "empty", cutoff: 0, canonical: true, valid: true,
    now: 8, currentValid: true, returned: -1, error: "none" }
  action arguments(shape: str, cutoff: int, canonical: bool, valid: bool): bool = all {
    s.phase == "input", Set("empty", "pair", "invalid").contains(shape), times.contains(cutoff),
    s' = s.with("shape", shape).with("cutoff", cutoff).with("canonical", canonical).with("valid", valid) }
  action clock(now: int, valid: bool): bool = all { s.phase == "input", times.contains(now),
    s' = s.with("now", now).with("currentValid", valid) }
  action begin = all { s.phase == "input",
    s' = if (s.shape == "empty") s.with("phase", "done")
      else if (s.shape == "invalid") s.with("phase", "failed").with("error", "usage")
      else s.with("phase", "cutoff") }
  action cutoffCheck = all { s.phase == "cutoff",
    s' = if (not(s.canonical) or not(s.valid)) s.with("phase", "failed").with("error", "canonical-utc")
      else s.with("phase", "clock") }
  action clockCheck = all { s.phase == "clock",
    s' = if (not(s.currentValid)) s.with("phase", "failed").with("error", "current-date")
      else if (s.cutoff > floorSecond(s.now)) s.with("phase", "failed").with("error", "future")
      else s.with("phase", "done").with("returned", s.cutoff) }
  action step = {
    nondet shape = Set("empty", "pair", "invalid").oneOf()
    nondet cutoff = times.oneOf() nondet now = times.oneOf()
    nondet canonical = Set(false, true).oneOf() nondet valid = Set(false, true).oneOf()
    any { arguments(shape, cutoff, canonical, valid), clock(now, valid), begin, cutoffCheck, clockCheck, s' = s }
  }
  val invariant = all { s.phase == "failed" implies s.returned == -1,
    s.returned >= 0 implies s.phase == "done" and s.shape == "pair" and s.canonical and s.valid
      and s.currentValid and s.returned <= floorSecond(s.now),
    s.phase == "done" and s.shape == "empty" implies s.returned == -1 }
  action parse = begin.then(cutoffCheck).then(clockCheck)
  run noArgumentsDoNotInventCutoffTest = init.then(begin).expect(s.returned == -1 and s.phase == "done" and invariant)
  run noArgumentsDoNotInspectInvalidClockTest = init.then(clock(8, false)).then(begin)
    .expect(s.phase == "done" and s.error == "none" and invariant)
  run extraOrUnsupportedArgumentsRefusedTest = init.then(arguments("invalid", 0, true, true)).then(begin)
    .expect(s.error == "usage" and invariant)
  run noncanonicalTimestampRefusedBeforeClockTest = init.then(arguments("pair", 2, false, true)).then(clock(8, false)).then(begin).then(cutoffCheck)
    .expect(s.error == "canonical-utc" and invariant)
  run invalidCalendarTimestampRefusedTest = init.then(arguments("pair", 2, true, false)).then(begin).then(cutoffCheck)
    .expect(s.error == "canonical-utc" and invariant)
  run validCutoffNeedsValidClockTest = init.then(arguments("pair", 2, true, true)).then(clock(8, false)).then(parse)
    .expect(s.error == "current-date" and invariant)
  run exactCurrentSecondAcceptedTest = init.then(arguments("pair", 8, true, true)).then(parse)
    .expect(s.returned == 8 and invariant)
  run fractionalCurrentSecondDoesNotPermitLaterCutoffTest = init.then(arguments("pair", 9, true, true)).then(clock(9, true)).then(parse)
    .expect(s.error == "future" and invariant)
  run pastFractionalCutoffReturnedUnchangedTest = init.then(arguments("pair", 7, true, true)).then(parse)
    .expect(s.returned == 7 and invariant)
}
