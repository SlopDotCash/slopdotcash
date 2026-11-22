// @source scripts/generate-points.ts
// @source src/lib/leaderboard.ts
// @evidence scripts/points-protected-history.test.ts
// @evidence scripts/points-protected-hold.test.ts
// One original award and one cross-period replacement for the same reviewed
// unit. The original financial scope can freeze before or after preparation.
// The separate unit shares assessment provenance and can still publish.
// Source tests establish the exact membership and SQLite binding. This model
// treats their verified facts as inputs and checks the publication ordering.
module points_financial_preservation {
  type S = { candidate: bool, changes: bool, protected: bool, imported: bool,
    preserved: bool, batchCount: int, linked: bool, replacement: bool,
    replacementPublished: bool, independentPublished: bool }
  var s: S

  action init = s' = { candidate: false, changes: false, protected: false,
    imported: false, preserved: true, batchCount: 1, linked: false,
    replacement: false, replacementPublished: false, independentPublished: false }
  action prepare(changes: bool): bool = all { not(s.candidate),
    s' = s.with("candidate", true).with("changes", changes) }
  action prepareLinked = all { not(s.candidate),
    s' = s.with("candidate", true).with("changes", true)
      .with("linked", true).with("replacement", true) }
  action freeze = all { not(s.imported), s' = s.with("protected", true) }
  action holdProtected = all { s.candidate, s.protected, s.changes, not(s.imported),
    s' = s.with("changes", false).with("replacement", false) }
  action accept = all { s.candidate, not(s.imported),
    not(s.protected and s.changes),
    s' = s.with("imported", true).with("batchCount", 2)
      .with("preserved", not(s.changes))
      .with("replacementPublished", s.replacement)
      .with("independentPublished", s.linked) }
  action replay = s' = s
  action oldUnprotectedImport = all { s.candidate,
    s' = s.with("imported", true).with("preserved", not(s.changes)) }
  action oldSingleRowHold = all { s.linked, s.protected, s.changes, not(s.imported),
    s' = s.with("changes", false) }
  action step = any { prepare(true), prepare(false), prepareLinked, freeze,
    holdProtected, accept, replay }

  val invariant = all { Set(1, 2).contains(s.batchCount),
    s.protected implies s.preserved,
    s.imported implies s.candidate and s.batchCount == 2,
    s.linked implies (s.preserved != s.replacementPublished),
    s.imported and s.linked implies s.independentPublished,
    s.replacementPublished implies s.imported and s.linked }

  run frozenChangeRefusedTest = init.then(freeze).then(prepare(true))
    .expect(invariant and s.batchCount == 1).then(accept.fail())
  run concurrentFreezeRefusesChangeTest = init.then(prepare(true)).then(freeze)
    .expect(invariant and s.batchCount == 1).then(accept.fail())
  run exactReplayAfterFreezeAllowedTest = init.then(prepare(false)).then(freeze)
    .then(accept).then(replay).expect(invariant and s.batchCount == 2)
  run unprotectedCorrectionAllowedTest = init.then(prepare(true)).then(accept)
    .expect(invariant and s.batchCount == 2)
  run frozenLinkedCorrectionRefusesUnfilteredImportTest = init.then(prepareLinked)
    .then(freeze).expect(invariant and s.batchCount == 1).then(accept.fail())
  run frozenLinkedCorrectionHoldsBothLegsTest = init.then(prepareLinked)
    .then(freeze).then(holdProtected).then(accept).then(replay)
    .expect(invariant and s.preserved and not(s.replacementPublished) and s.independentPublished)
  run openLinkedCorrectionPublishesBothLegsTest = init.then(prepareLinked).then(accept)
    .expect(invariant and not(s.preserved) and s.replacementPublished and s.independentPublished)
  run oldImportNegativeControlTest = init.then(freeze).then(prepare(true))
    .then(oldUnprotectedImport).expect(not(invariant))
  run oldSingleRowHoldNegativeControlTest = init.then(freeze).then(prepareLinked)
    .then(oldSingleRowHold).then(accept).expect(not(invariant))
}
