// @source workers/vetting/review-plan.ts
// @source workers/vetting/scanners.ts
// Three batches and a synthesis; two attempts abstract the actual maximum
// three. Complete batches resume from cache only for identical profile/input.
// An unknown failed-call cost keeps the aggregate unknown after recovery.
module vetting_review_batches {
  var s: { done: Set[int], attempts: int, budget: int, active: int,
    unknown: bool, synthesized: bool, knownTotal: bool, generation: int }
  action init = s' = {done: Set(), attempts: 0, budget: 2, active: 0,
    unknown: false, synthesized: false, knownTotal: false, generation: 1}
  action call(batch: int): bool = all { s.budget > 0, s.active == 0, not(batch.in(s.done)),
    s.attempts < 2, s' = s.with("active", batch).with("budget", s.budget - 1).with("attempts", s.attempts + 1) }
  action failUnknown = all { s.active > 0, s' = s.with("active", 0).with("unknown", true) }
  action completeBatch = all { s.active > 0,
    s' = s.with("done", s.done.union(Set(s.active))).with("active", 0).with("attempts", 0) }
  action nextPass = all { s.active == 0, s.budget == 0, not(s.synthesized),
    s' = s.with("budget", 2).with("attempts", 0) }
  action changedInput = all { s.generation == 1, s.active == 0, not(s.synthesized),
    s' = s.with("generation", 2).with("done", Set()).with("attempts", 0) }
  action synthesize = all { s.done == Set(1, 2, 3), s.active == 0,
    s' = s.with("synthesized", true).with("knownTotal", not(s.unknown)) }
  action step = { nondet batch = Set(1, 2, 3).oneOf()
    any { call(batch), failUnknown, completeBatch, nextPass, changedInput, synthesize, s' = s } }
  val invariant = all { s.synthesized implies s.done == Set(1, 2, 3),
    s.knownTotal implies not(s.unknown), s.attempts <= 2, s.budget >= 0 }
  run unknownRetryStaysUnknownTest = init.then(call(1)).then(failUnknown).then(call(1)).then(completeBatch)
    .then(nextPass).then(call(2)).then(completeBatch).then(call(3)).then(completeBatch)
    .then(synthesize).expect(s.synthesized and not(s.knownTotal))
  run newInputCannotReuseCompletedBatchTest = init.then(call(1)).then(completeBatch).then(changedInput)
    .expect(s.done.size() == 0 and s.generation == 2)
}
