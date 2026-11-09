// @source migrations/0034_vetting_private_evidence.sql
// @source migrations/0035_vetting_evidence_chunks.sql
// @source migrations/0036_vetting_evidence_assembly.sql
// @source backend/vetting/evidence.ts
// @source backend/vetting/evidence-chunks.ts
// Two ordered chunks represent an arbitrary finite content-addressed object.
// Shared bytes do not supply another run's whole-object completion receipt.
module vetting_evidence_upload {
  var s: { registered: Set[int], parts: Set[int], verified: Set[int],
    completed: Set[int], wholeMatches: bool, repaired: bool, readable: Set[int] }
  action init = s' = {registered: Set(), parts: Set(), verified: Set(),
    completed: Set(), wholeMatches: true, repaired: false, readable: Set()}
  action register(scope: int): bool = s' = s.with("registered", s.registered.union(Set(scope)))
  action upload(part: int): bool = all { s.registered.size() > 0,
    s' = s.with("parts", s.parts.union(Set(part))).with("verified", s.verified.union(Set(part))) }
  action corrupt(part: int): bool =
    s' = s.with("verified", s.verified.exclude(Set(part))).with("readable", Set())
  action repair(part: int): bool = all { part.in(s.parts), not(part.in(s.verified)),
    s' = s.with("verified", s.verified.union(Set(part))).with("repaired", true) }
  action wrongWhole = s' = s.with("wholeMatches", false).with("readable", Set())
  action finalize(scope: int): bool = all { scope.in(s.registered), s.verified == Set(1, 2), s.wholeMatches,
    s' = s.with("completed", s.completed.union(Set(scope))) }
  action verifyForRead(scope: int): bool = all { scope.in(s.completed),
    s.verified == Set(1, 2), s.wholeMatches,
    s' = s.with("readable", s.readable.union(Set(scope))) }
  action step = { nondet scope = Set(1, 2).oneOf(); nondet part = Set(1, 2).oneOf()
    any { register(scope), upload(part), corrupt(part), repair(part), wrongWhole,
      finalize(scope), verifyForRead(scope), s' = s } }
  val invariant = all { s.completed.subseteq(s.registered),
    s.readable.subseteq(s.completed),
    s.readable.size() > 0 implies s.verified == Set(1, 2) and s.wholeMatches }
  run sharedBytesNeedOwnCompletionTest = init.then(register(1)).then(upload(1)).then(upload(2))
    .then(finalize(1)).then(register(2)).expect(s.completed == Set(1))
  run partHashesDoNotProveWholeTest = init.then(register(1)).then(upload(1)).then(upload(2))
    .then(wrongWhole).expect(s.completed.size() == 0 and s.verified == Set(1, 2))
  run corruptContentRepairTest = init.then(register(1)).then(upload(1)).then(corrupt(1))
    .then(repair(1)).then(upload(2)).then(finalize(1)).expect(s.repaired and s.completed == Set(1))
  run completionIsNotCurrentIntegrityTest = init.then(register(1)).then(upload(1)).then(upload(2))
    .then(finalize(1)).then(corrupt(1)).expect(s.completed == Set(1) and s.readable.size() == 0)
    .then(verifyForRead(1).fail())
}
