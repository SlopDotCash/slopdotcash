// @source workers/payments/deposits.ts
// @source backend/payments/vault-deposits.ts
// @source migrations/0138_vault_deposits.sql
// @evidence workers/payments/deposits.test.ts
// @evidence backend/payments/vault-deposits.test.ts
// The "Funded by" record of one EVM vault (operator decision, 18 November
// 2026). The scan has its own cursor and starts at the vault's creation
// block. A run authenticates the chain, then reads pages of the vault's
// deposit event up to the finalized block. One page's deposits and its
// cursor are a single atomic write, and the cursor only moves forward, so an
// older overlapping run cannot rewind it and a failed page changes nothing.
// A private bounty vault is never read. Bounds: two workers, pages of two
// blocks, a finalized head of at most six blocks, creation at block 1 and
// deposits in blocks 2 and 5. Abstracted: the event, depositor, amount and
// block-time checks come from the real scanner, and an insert that repeats a
// stored event is a no-op by the table's primary key.
module vault_deposit_evm_record {
  type S = { chainMatches: bool, bounty: bool, final: int, cursor: int, recorded: Set[int],
    aFrom: int, aTo: int, bFrom: int, bTo: int }
  var s: S
  pure val deposits = Set(2, 5)
  action start(bounty: bool): bool = s' = { chainMatches: true, bounty: bounty, final: 1,
    cursor: 0, recorded: Set(), aFrom: 0, aTo: 0, bFrom: 0, bTo: 0 }
  action init = any { start(false), start(true) }
  action finalize = all { s.final < 6, s' = s.with("final", s.final + 1) }
  action wrongChain = s' = s.with("chainMatches", false)
  action correctChain = s' = s.with("chainMatches", true)
  // A run reads the cursor once; the first page starts at the creation block.
  val readable = s.chainMatches and not(s.bounty) and s.cursor < s.final
  val pageEnd = if (s.cursor + 2 < s.final) s.cursor + 2 else s.final
  action startA = all { readable, s.aFrom == 0,
    s' = s.with("aFrom", s.cursor + 1).with("aTo", pageEnd) }
  action startB = all { readable, s.bFrom == 0,
    s' = s.with("bFrom", s.cursor + 1).with("bTo", pageEnd) }
  // The page's deposits and its cursor are stored together or not at all.
  action completeA = all { s.aFrom > 0,
    s' = s.with("recorded", s.recorded.union(deposits.filter(b => b >= s.aFrom and b <= s.aTo)))
      .with("cursor", if (s.aTo > s.cursor) s.aTo else s.cursor)
      .with("aFrom", 0).with("aTo", 0) }
  action completeB = all { s.bFrom > 0,
    s' = s.with("recorded", s.recorded.union(deposits.filter(b => b >= s.bFrom and b <= s.bTo)))
      .with("cursor", if (s.bTo > s.cursor) s.bTo else s.cursor)
      .with("bFrom", 0).with("bTo", 0) }
  // An RPC failure, an unexpected event or an unreadable block ends the run.
  action failA = all { s.aFrom > 0, s' = s.with("aFrom", 0).with("aTo", 0) }
  action failB = all { s.bFrom > 0, s' = s.with("bFrom", 0).with("bTo", 0) }
  action step = any { finalize, wrongChain, correctChain, startA, startB,
    completeA, completeB, failA, failB, s' = s }
  val invariant = all {
    s.cursor >= 0 and s.cursor <= s.final,
    // Every deposit at or below the cursor is on record, and nothing else is.
    s.recorded == deposits.filter(b => b <= s.cursor),
    s.bounty implies (s.cursor == 0 and s.recorded == Set()),
  }
  run historyFromCreationTest = start(false).then(finalize).then(finalize)
    .then(startA).then(completeA).expect(s.cursor == 2 and s.recorded == Set(2))
    .then(finalize).then(finalize).then(finalize)
    .then(startA).then(completeA).then(startA).then(completeA)
    .expect(s.cursor == 6 and s.recorded == Set(2, 5) and invariant)
  run failedPageKeepsCursorTest = start(false).then(finalize).then(startA).then(failA)
    .expect(s.cursor == 0 and s.recorded == Set())
    .then(startA).then(completeA).expect(s.cursor == 2 and s.recorded == Set(2) and invariant)
  run wrongChainCannotReadTest = start(false).then(finalize).then(wrongChain)
    .then(startA.fail())
  run olderRunCannotRewindTest = start(false).then(finalize).then(startA).then(startB)
    .then(completeB).then(finalize).then(finalize).then(startB).then(completeB)
    .expect(s.cursor == 4)
    .then(completeA).expect(s.cursor == 4 and s.recorded == Set(2) and invariant)
  run bountyVaultIsNeverReadTest = start(true).then(finalize).then(startA.fail())
}
