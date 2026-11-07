// @source migrations/0087_fee_send_replacements.sql
// @source workers/payment-executor/core.ts
// @source workers/payment-executor/binding-recovery.ts
// @source workers/fee-converter/core.ts
// @source workers/fee-converter/evm.ts
// @source workers/referral-accrual/poster.ts
// payment-executor/core.ts, binding-recovery.ts, fee-converter/core.ts.
// All replacements keep one nonce/content. Missing receipts retain the send.
module signed_send {
  type S = { phase: str, journaled: Set[int], broadcast: Set[int], winner: int,
    nonce: int, replacements: int, gas: int, originalGas: int }
  var s: S
  action init = s' = { phase: "empty", journaled: Set(), broadcast: Set(), winner: 0,
    nonce: 1, replacements: 0, gas: 2, originalGas: 2 }
  action sign = all { s.phase == "empty", s' = s.with("phase", "signed").with("journaled", Set(1)) }
  action send(id: int): bool = all { s.journaled.contains(id), s.winner == 0,
    s' = s.with("phase", "unknown").with("broadcast", s.broadcast.union(Set(id))) }
  action replacement = all { s.phase == "unknown", s.replacements < 2, s.gas + 1 <= 3 * s.originalGas,
    s' = s.with("replacements", s.replacements + 1).with("gas", s.gas + 1)
      .with("journaled", s.journaled.union(Set(s.replacements + 2))) }
  action finalize(id: int): bool = all { s.winner == 0, s.broadcast.contains(id),
    s' = s.with("phase", "finalized").with("winner", id) }
  action revert(id: int): bool = all { s.winner == 0, s.broadcast.contains(id),
    s' = s.with("phase", "failed").with("winner", id) }
  action step = any { sign, send(1), send(2), send(3), replacement, finalize(1), finalize(2), finalize(3), revert(1), revert(2), revert(3), s' = s }
  val invariant = all { s.nonce == 1, s.broadcast.subseteq(s.journaled), s.gas <= 3*s.originalGas,
    s.winner != 0 implies s.broadcast.contains(s.winner) }
  run originalCanWinTest = init.then(sign).then(send(1)).then(replacement).then(send(2)).then(finalize(1)).expect(s.winner == 1 and invariant)
  run replacementWinsTest = init.then(sign).then(send(1)).then(replacement).then(send(2)).then(finalize(2)).expect(invariant)
  run beforeJournalRefusedTest = init.then(send(1).fail())
  run missingReceiptKeepsBytesTest = init.then(sign).then(send(1)).then(send(1)).expect(s.journaled == Set(1) and s.phase == "unknown" and invariant)
}
