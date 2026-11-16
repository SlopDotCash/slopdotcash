// @source scripts/generate-points.ts
// @evidence scripts/points-protected-history.test.ts
// One candidate changes the amount or recipient in a protected financial
// scope. Protection represents the authoritative settlement-table predicate;
// this model does not infer which real rows are approved or prove SQL binding.
// The candidate and a concurrent financial freeze precede atomic acceptance.
module points_financial_preservation {
  var s: { candidate: bool, changes: bool, protected: bool, imported: bool,
    preserved: bool, batchCount: int }
  action init = s' = { candidate: false, changes: false, protected: false,
    imported: false, preserved: true, batchCount: 1 }
  action prepare(changes: bool): bool = all { not(s.candidate),
    s' = s.with("candidate", true).with("changes", changes) }
  action freeze = all { not(s.imported), s' = s.with("protected", true) }
  action accept = all { s.candidate, not(s.imported),
    not(s.protected and s.changes),
    s' = s.with("imported", true).with("batchCount", 2)
      .with("preserved", not(s.changes)) }
  action replay = s' = s
  action oldUnprotectedImport = all { s.candidate,
    s' = s.with("imported", true).with("preserved", not(s.changes)) }
  action step = any { prepare(true), prepare(false), freeze, accept, replay }
  val invariant = all { Set(1, 2).contains(s.batchCount),
    s.protected implies s.preserved,
    s.imported implies s.candidate and s.batchCount == 2 }
  run frozenChangeRefusedTest = init.then(freeze).then(prepare(true))
    .expect(invariant and s.batchCount == 1).then(accept.fail())
  run concurrentFreezeRefusesChangeTest = init.then(prepare(true)).then(freeze)
    .expect(invariant and s.batchCount == 1).then(accept.fail())
  run exactReplayAfterFreezeAllowedTest = init.then(prepare(false)).then(freeze)
    .then(accept).then(replay).expect(invariant and s.batchCount == 2)
  run unprotectedCorrectionAllowedTest = init.then(prepare(true)).then(accept)
    .expect(invariant and s.batchCount == 2)
  run oldImportNegativeControlTest = init.then(freeze).then(prepare(true))
    .then(oldUnprotectedImport).expect(not(invariant))
}
