// @source workers/slopbot/value-accepted-commit-census.ts
// @source workers/slopbot/value-group-collection.ts
// A paginated census pins count and unique immutable PR IDs. Recursive search
// partitions must not overlap and must conserve the parent result count.
module bot_accepted_census {
  var s: { left: Set[int], right: Set[int], expected: int, valid: bool,
    leftDone: bool, rightDone: bool, complete: bool }
  action init = s' = {left: Set(), right: Set(), expected: 3, valid: true,
    leftDone: false, rightDone: false, complete: false}
  action addLeft(id: int): bool = all { not(s.leftDone), not(id.in(s.left)),
    s' = s.with("left", s.left.union(Set(id))) }
  action addRight(id: int): bool = all { not(s.rightDone), not(id.in(s.right)),
    s' = s.with("right", s.right.union(Set(id))) }
  action finishLeft = s' = s.with("leftDone", true)
  action finishRight = s' = s.with("rightDone", true)
  action movingCount = all { not(s.complete), s' = s.with("valid", false) }
  action combine = all { s.leftDone, s.rightDone, s.valid,
    s.left.intersect(s.right).size() == 0, s.left.size() + s.right.size() == s.expected,
    s' = s.with("complete", true) }
  action step = { nondet id = Set(1, 2, 3).oneOf()
    any { addLeft(id), addRight(id), finishLeft, finishRight, movingCount, combine, s' = s } }
  val invariant = s.complete implies s.valid and s.left.union(s.right).size() == s.expected
  run completePartitionTest = init.then(addLeft(1)).then(addRight(2)).then(addRight(3))
    .then(finishLeft).then(finishRight).then(combine).expect(s.complete and invariant)
  run overlapIsNotCoverageTest = init.then(addLeft(1)).then(addRight(1)).then(addRight(2))
    .then(finishLeft).then(finishRight).expect(s.left.intersect(s.right).size() > 0 and not(s.complete))
}
