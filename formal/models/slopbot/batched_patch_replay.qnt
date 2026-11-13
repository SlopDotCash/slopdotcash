// @source workers/slopbot/value-patch-replay.ts
// @evidence scripts/accepted-patch-replay.test.ts
// Two deterministic path batches. Each proof boolean abstracts the existing
// exact-blob/hunk replay kernel; it does not prove GitHub identity or hashing.
// A complete result is returned only after all batches have verified.
module batched_patch_replay {
  var s: { cursor: int, verified: Set[int], failed: bool, returned: bool }
  action init = s' = { cursor: 0, verified: Set(), failed: false, returned: false }
  action prove(ok: bool): bool = all { s.cursor < 2, not(s.failed), not(s.returned),
    s' = if (ok) s.with("verified", s.verified.union(Set(s.cursor))).with("cursor", s.cursor + 1)
      else s.with("failed", true) }
  action returnComplete = all { s.cursor == 2, not(s.failed), s' = s.with("returned", true) }
  action step = if (s.cursor < 2 and not(s.failed)) any { prove(true), prove(false), s' = s }
    else any { returnComplete, s' = s }
  val invariant = all { s.cursor >= 0, s.cursor <= 2,
    s.verified.size() == s.cursor,
    s.returned implies s.verified == Set(0, 1) and not(s.failed),
    s.failed implies not(s.returned) }
  run completeBatchesReturnTest = init.then(prove(true)).then(prove(true)).then(returnComplete)
    .expect(s.returned and invariant)
  run firstBatchIsNotCompleteProofTest = init.then(prove(true)).expect(not(s.returned) and invariant)
    .then(returnComplete.fail())
  run laterFailureDiscardsProofTest = init.then(prove(true)).then(prove(false))
    .expect(s.failed and not(s.returned) and invariant).then(returnComplete.fail())
}
