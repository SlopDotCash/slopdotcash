// @source src/lib/project-revision-changes.ts
// @evidence scripts/project-policy-state.test.ts
// Nine lexically ordered representative top-level fields, values 0..2.
// Zero represents nullish equality; other values represent distinct canonical
// JSON values. Canonical JSON/object/array behavior is delegated, not re-proved.
// Classification is not schema validation or owner authorization. Restricted
// id/repository/skill fields still participate in executable content digests.
// The projection returns original nested references, not a deep-frozen copy.
// Arbitrary prototypes/getters and concurrent input mutation are outside this
// plain validated-manifest model. New scenarios are unexecuted.
// The default graph selects representative complete profiles; named runs also
// exercise explicit field combinations without a Cartesian input generator.
module project_revision_classification {
  val fieldIds = Set(1, 2, 3, 4, 5, 6, 7, 8, 9)
  val order = List(1, 2, 3, 4, 5, 6, 7, 8, 9)
  // contribution, funding, id, links, name, repositories, reviewSkill, skill, unknown
  val executableOrder = List(3, 6, 8, 7, 1)
  val zeros = Map(1 -> 0, 2 -> 0, 3 -> 0, 4 -> 0, 5 -> 0, 6 -> 0, 7 -> 0, 8 -> 0, 9 -> 0)
  type State = { phase: str, before: int -> int, after: int -> int,
    ownBefore: Set[int], ownAfter: Set[int], cursor: int, changed: Set[int],
    presentation: List[int], executable: List[int], financial: List[int], restricted: List[int] }
  var s: State
  val initial: State = { phase: "input", before: zeros, after: zeros,
    ownBefore: Set(), ownAfter: Set(), cursor: 0, changed: Set(),
    presentation: List(), executable: List(), financial: List(), restricted: List() }
  action init = s' = initial
  action field(id: int, before: int, after: int, ownBefore: bool, ownAfter: bool): bool = all {
    s.phase == "input", fieldIds.contains(id), 0.to(2).contains(before), 0.to(2).contains(after),
    s' = s.with("before", s.before.set(id, before)).with("after", s.after.set(id, after))
      .with("ownBefore", if (ownBefore) s.ownBefore.union(Set(id)) else s.ownBefore.exclude(Set(id)))
      .with("ownAfter", if (ownAfter) s.ownAfter.union(Set(id)) else s.ownAfter.exclude(Set(id))) }
  action begin = all { s.phase == "input", s' = s.with("phase", "scan") }
  action inspect = {
    val id = if (s.cursor < order.length()) order.nth(s.cursor) else 1
    val altered = s.ownBefore.union(s.ownAfter).contains(id) and s.before.get(id) != s.after.get(id)
    val advanced = s.with("cursor", s.cursor + 1).with("changed", if (altered) s.changed.union(Set(id)) else s.changed)
    all { s.phase == "scan", s' =
      if (s.cursor == order.length()) s.with("phase", "done")
      else if (not(altered)) advanced
      else if (Set(4, 5).contains(id)) advanced.with("presentation", s.presentation.append(id))
      else if (id == 1) advanced.with("executable", s.executable.append(id))
      else if (id == 2) advanced.with("financial", s.financial.append(id))
      else advanced.with("restricted", s.restricted.append(id)) }
  }
  val projected = executableOrder.select(id => s.ownAfter.contains(id))
  action profile(kind: int): bool = {
    val selected = if (kind == 1) Set(4, 5) else if (kind == 2) Set(1)
      else if (kind == 3) Set(2) else if (kind == 4) Set(3, 6, 7, 8)
      else if (kind == 5) Set(9) else if (kind == 6) Set(4)
      else if (kind == 7) Set(1, 2, 5, 9) else if (kind == 8) Set(2)
      else if (kind == 9) Set(1, 3, 6, 7, 8) else Set()
    val values = selected.fold(zeros, (result, id) => result.set(id, if (kind == 6) 0 else 1))
    all { s.phase == "input", 0.to(9).contains(kind), s' =
      if (kind == 8) initial.with("before", values).with("ownBefore", selected)
      else initial.with("after", values).with("ownAfter", selected) }
  }
  action step = {
    nondet kind = 0.to(9).oneOf()
    any { profile(kind), begin, inspect, s' = s }
  }
  val invariant = all { s.cursor <= 9,
    s.phase == "done" implies s.presentation.length() + s.executable.length() + s.financial.length() + s.restricted.length() == s.changed.size(),
    s.presentation == order.select(id => s.changed.contains(id) and Set(4, 5).contains(id)),
    s.executable == order.select(id => s.changed.contains(id) and id == 1),
    s.financial == order.select(id => s.changed.contains(id) and id == 2),
    s.restricted == order.select(id => s.changed.contains(id) and Set(3, 6, 7, 8, 9).contains(id)),
    projected.indices().forall(i => s.ownAfter.contains(projected.nth(i))) }
  action finish = begin.then(inspect).then(inspect).then(inspect).then(inspect).then(inspect)
    .then(inspect).then(inspect).then(inspect).then(inspect).then(inspect)
  run unchangedHasNoClassesTest = init.then(finish).expect(s.changed == Set() and invariant)
  run presentationSortedByFieldTest = init.then(field(5, 0, 1, false, true)).then(field(4, 0, 1, false, true))
    .then(finish).expect(s.presentation == List(4, 5) and invariant)
  run contributionIsExecutableTest = init.then(field(1, 1, 2, true, true)).then(finish).expect(s.executable == List(1) and invariant)
  run fundingIsFinancialTest = init.then(field(2, 1, 2, true, true)).then(finish).expect(s.financial == List(2) and invariant)
  run identityIsRestrictedButInContentTest = init.then(field(3, 1, 2, true, true)).then(finish).expect(s.restricted == List(3) and projected == List(3) and invariant)
  run repositoryAndSkillsAreRestrictedTest = init.then(field(6, 1, 2, true, true)).then(field(7, 1, 2, true, true)).then(field(8, 1, 2, true, true))
    .then(finish).expect(s.restricted == List(6, 7, 8) and s.executable == List() and projected == List(6, 8, 7) and invariant)
  run unknownFieldIsRestrictedTest = init.then(field(9, 0, 1, false, true)).then(finish).expect(s.restricted == List(9) and projected == List() and invariant)
  run nullishAdditionIsNotChangeTest = init.then(field(4, 0, 0, false, true)).then(finish).expect(s.changed == Set() and invariant)
  run deletedFinancialFieldIsChangeTest = init.then(field(2, 1, 0, true, false)).then(finish).expect(s.financial == List(2) and invariant)
  run projectionOmitsNonOwnedFieldsTest = init.then(field(3, 0, 1, false, false)).then(field(1, 0, 2, false, true))
    .then(finish).expect(projected == List(1) and invariant)
  run arrayOrderCanChangeClassTest = init.then(field(1, 1, 2, true, true)).then(finish).expect(s.executable == List(1) and invariant)
  run oneRevisionCanChangeEveryClassTest = init.then(field(1, 0, 1, false, true)).then(field(2, 0, 1, false, true))
    .then(field(5, 0, 1, false, true)).then(field(9, 0, 1, false, true)).then(finish)
    .expect(s.changed == Set(1, 2, 5, 9) and invariant)
}
