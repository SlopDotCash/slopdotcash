// @source src/lib/implementation-allocation.ts
// @source src/lib/implementation-lines.ts
// @source src/lib/score-units.ts
// @source src/lib/commit-credit.ts
// @source src/lib/leaderboard.ts
// @source src/lib/points.ts
// @evidence scripts/implementation-score-shares.test.ts
// @evidence scripts/points-implementation-attribution.test.ts
// @evidence scripts/score-units.test.ts
// Two canonical recipients ordered by immutable actor ID. The bounded model
// checks proportional rounding and preservation of the prior source pool.
// GitHub authorship, completeness and frozen financial state are external
// predicates; their collectors and import gate have separate evidence.
module implementation_allocation {
  var s: { phase: str, total: int, first: int, second: int,
    a: int, b: int, complete: bool, frozen: bool, written: bool }
  action init = s' = { phase: "choose", total: 0, first: 0, second: 0,
    a: 0, b: 0, complete: false, frozen: false, written: false }
  action choose(total: int, first: int, second: int, complete: bool, frozen: bool): bool = all {
    s.phase == "choose", 0.to(6).contains(total), 0.to(3).contains(first), 0.to(3).contains(second),
    s' = s.with("phase", "ready").with("total", total).with("first", first)
      .with("second", second).with("complete", complete).with("frozen", frozen)
  }
  pure def aWeight(first: int, second: int): int = if (first + second == 0) 1 else first
  pure def bWeight(first: int, second: int): int = if (first + second == 0) 1 else second
  action allocate = all {
    s.phase == "ready", s.complete, not(s.frozen),
    val aw = aWeight(s.first, s.second)
    val bw = bWeight(s.first, s.second)
    val denominator = aw + bw
    val aFloor = (s.total * aw) / denominator
    val bFloor = (s.total * bw) / denominator
    val left = s.total - aFloor - bFloor
    val aFirst = (s.total * aw) % denominator >= (s.total * bw) % denominator
    s' = s.with("phase", "done").with("written", true)
      .with("a", aFloor + (if (aFirst) left else 0))
      .with("b", bFloor + (if (aFirst) 0 else left))
  }
  action retry = s' = s
  action chooseAny = {
    nondet total = 0.to(6).oneOf()
    nondet first = 0.to(3).oneOf()
    nondet second = 0.to(3).oneOf()
    nondet complete = Set(false, true).oneOf()
    nondet frozen = Set(false, true).oneOf()
    choose(total, first, second, complete, frozen)
  }
  action step = any { chooseAny, allocate, retry }
  val invariant = all {
    s.a >= 0, s.b >= 0,
    s.written implies s.complete and not(s.frozen) and s.a + s.b == s.total,
    (s.written and s.first + s.second > 0 and s.first == 0) implies s.a == 0,
    (s.written and s.first + s.second > 0 and s.second == 0) implies s.b == 0,
    s.written implies s.a >= (s.total * aWeight(s.first, s.second)) / (aWeight(s.first, s.second) + bWeight(s.first, s.second)),
    s.written implies s.a <= (s.total * aWeight(s.first, s.second)) / (aWeight(s.first, s.second) + bWeight(s.first, s.second)) + 1
  }
  run proportionalTest = init.then(choose(6, 1, 3, true, false)).then(allocate)
    .expect(s.a == 2 and s.b == 4 and invariant)
  run actorIdTieTest = init.then(choose(1, 1, 1, true, false)).then(allocate)
    .expect(s.a == 1 and s.b == 0 and invariant)
  run zeroLineFallbackTest = init.then(choose(3, 0, 0, true, false)).then(allocate)
    .expect(s.a == 2 and s.b == 1 and invariant)
  run missingEvidenceHeldTest = init.then(choose(6, 1, 3, false, false)).expect(invariant).then(allocate.fail())
  run frozenAwardHeldTest = init.then(choose(6, 1, 3, true, true)).expect(invariant).then(allocate.fail())
  run retryIdempotentTest = init.then(choose(6, 1, 3, true, false)).then(allocate).then(retry)
    .expect(s.a + s.b == 6 and invariant)
}
