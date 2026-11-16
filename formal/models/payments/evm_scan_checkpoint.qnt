// @source workers/payments/scanner.ts
// EVM range completion is monotonic even when an older overlapping request
// returns last. Two workers, three pages and one finalized six-block boundary.
// @evidence workers/payments/scanner-progress.workflow.mjs
// Every scan authenticates the configured network before reading the cursor.
module evm_scan_checkpoint {
  type S = { chainMatches: bool, cursor: int, completed: Set[int], aStart: int, bStart: int,
    aVerified: bool, bVerified: bool }
  var s: S
  action init = s' = { chainMatches: true, cursor: 0, completed: Set(), aStart: -1, bStart: -1,
    aVerified: false, bVerified: false }
  action startA = all { s.chainMatches, s.cursor < 6, s' = s.with("aStart", s.cursor).with("aVerified", false) }
  action startB = all { s.chainMatches, s.cursor < 6, s' = s.with("bStart", s.cursor).with("bVerified", false) }
  action verifyA = all { s.aStart >= 0, s' = s.with("aVerified", true) }
  action verifyB = all { s.bStart >= 0, s' = s.with("bVerified", true) }
  action completeA = all { s.aVerified,
    s' = s.with("cursor", if(s.aStart + 2 > s.cursor) s.aStart + 2 else s.cursor)
      .with("completed", s.completed.union((s.aStart + 1).to(s.aStart + 2)))
      .with("aVerified", false).with("aStart", -1) }
  action completeB = all { s.bVerified,
    s' = s.with("cursor", if(s.bStart + 2 > s.cursor) s.bStart + 2 else s.cursor)
      .with("completed", s.completed.union((s.bStart + 1).to(s.bStart + 2)))
      .with("bVerified", false).with("bStart", -1) }
  action failedA = s' = s.with("aStart", -1).with("aVerified", false)
  action failedB = s' = s.with("bStart", -1).with("bVerified", false)
  action wrongChain = s' = s.with("chainMatches", false)
  action correctChain = s' = s.with("chainMatches", true)
  action refuseWrongChain = all { not(s.chainMatches), s' = s }
  action step = any { wrongChain, correctChain, refuseWrongChain, startA, startB, verifyA, verifyB, completeA, completeB, failedA, failedB, s' = s }
  val invariant = all { s.cursor >= 0 and s.cursor <= 6, s.cursor % 2 == 0,
    s.completed.size() == s.cursor,
    s.cursor > 0 implies s.completed == 1.to(s.cursor) }
  run wrongChainCannotAdvanceTest = init.then(wrongChain).then(refuseWrongChain)
    .expect(s.cursor == 0 and s.completed == Set())
    .then(correctChain).then(startA).then(verifyA).then(completeA)
    .expect(s.cursor == 2 and invariant)
  run oldCompletionCannotRewindTest = init.then(startA).then(startB).then(verifyB).then(completeB)
    .then(startB).then(verifyB).then(completeB).then(verifyA).then(completeA)
    .expect(s.cursor == 4 and invariant)
  run failedPageCannotAdvanceTest = init.then(startA).then(failedA).expect(s.cursor == 0)
    .then(startA).then(verifyA).then(completeA).expect(s.cursor == 2 and invariant)
}
