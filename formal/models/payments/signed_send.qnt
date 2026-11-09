// @source migrations/0087_fee_send_replacements.sql
// @source workers/payment-executor/core.ts
// @source workers/fee-converter/core.ts
// @source workers/fee-converter/evm.ts
// @source workers/payment-executor/binding-shared.ts
// @source workers/verified-fee-replacement.ts
// @source workers/fee-converter/verified-arithmetic.ts
// Same-nonce EVM fee replacement: payment-executor nextReplacementFees and
// fee-converter evm.ts replace(). Every attempt keeps the original nonce,
// recipient, calldata, value and gas; only the fee fields change. Those
// carried fields are not modelled: the shared nonce appears only as the
// rule that at most one broadcast attempt can be mined (finalize, revert). Each
// replacement is journaled before broadcast, and a missing receipt keeps the
// bytes. Binding cancellation (a different, zero-value transfer) is modelled
// in binding_cancellation; the referral poster never replaces a send.
//
// Fee policy (owner decision of 25 October 2026): next = min(ceil(last *
// 125%), cap) with cap = 3 x original (the payment executor also applies an
// absolute ceiling, `ceiling`). A step below ceil(last * 110%), the minimum a
// node accepts, is the cap: the code returns a wait or null and signs nothing.
// From 8 the sequence is 8, 10, 13, 17, 22; the next step 28 is capped to 24,
// which is below ceil(22 * 110%) = 25, so the fifth replacement is refused and
// 24 is never signed. One fee field is modelled; both fields use the same rule.
//
// Bounds: the original fee is 8 or 3, the ceiling 1000 (none) or 20. Fees grow
// geometrically below a fixed cap, so the attempt list is finite.
module signed_send {
  type S = { phase: str, fees: List[int], broadcast: Set[int], winner: int,
    ceiling: int, refused: bool }
  var s: S
  pure def ceilPercent(v: int, p: int): int = (v * p + 99) / 100
  pure def capOf(st: S): int = {
    val triple = 3 * st.fees[0]
    if (triple < st.ceiling) triple else st.ceiling }
  pure def nextFee(st: S): int = {
    val raised = ceilPercent(st.fees[st.fees.length() - 1], 125)
    if (raised < capOf(st)) raised else capOf(st) }
  pure def admissible(st: S): bool =
    nextFee(st) >= ceilPercent(st.fees[st.fees.length() - 1], 110)
  action initWith(original: int, ceiling: int): bool = s' = { phase: "empty", fees: [original],
    broadcast: Set(), winner: -1, ceiling: ceiling, refused: false }
  action init = { nondet o = Set(8, 3).oneOf()
    nondet c = Set(1000, 20).oneOf()
    initWith(o, c) }
  action sign = all { s.phase == "empty", s' = s.with("phase", "signed") }
  // Broadcast an already journaled attempt (original 0 or a replacement).
  action send(i: int): bool = all { s.phase != "empty", i < s.fees.length(), s.winner < 0,
    s' = s.with("phase", "unknown").with("broadcast", s.broadcast.union(Set(i))) }
  // Journal the next replacement; the node must not have mined any attempt.
  action replace = all { s.phase == "unknown", s.winner < 0, admissible(s),
    s' = s.with("fees", s.fees.append(nextFee(s))) }
  action refuseAtCap = all { s.phase == "unknown", s.winner < 0, not(admissible(s)),
    s' = s.with("refused", true) }
  // One nonce: at most one broadcast attempt can be mined.
  action finalize(i: int): bool = all { s.winner < 0, s.broadcast.contains(i),
    s' = s.with("phase", "finalized").with("winner", i) }
  action revert(i: int): bool = all { s.winner < 0, s.broadcast.contains(i),
    s' = s.with("phase", "failed").with("winner", i) }
  action step = any { sign, replace, refuseAtCap,
    nondet i = 0.to(6).oneOf()
    any { send(i), finalize(i), revert(i) }, s' = s }
  val invariant = all {
    s.broadcast.forall(i => i < s.fees.length()),
    s.winner >= 0 implies s.broadcast.contains(s.winner),
    s.refused implies not(admissible(s)),
    1.to(s.fees.length() - 1).forall(i => all {
      s.fees[i] <= capOf(s), s.fees[i] >= ceilPercent(s.fees[i - 1], 110) }) }
  run originalCanWinTest = initWith(8, 1000).then(sign).then(send(0)).then(replace).then(send(1))
    .then(finalize(0)).expect(s.winner == 0 and invariant)
  run replacementWinsTest = initWith(8, 1000).then(sign).then(send(0)).then(replace).then(send(1))
    .then(finalize(1)).expect(s.winner == 1 and invariant)
  run beforeJournalRefusedTest = initWith(8, 1000).then(send(0).fail())
  run missingReceiptKeepsBytesTest = initWith(8, 1000).then(sign).then(send(0)).then(send(0))
    .expect(s.fees == [8] and s.phase == "unknown" and invariant)
  // 8 -> 10 -> 13 -> 17 -> 22, then 24 would be under the 10% minimum.
  run escalationRefusedAtCapTest = initWith(8, 1000).then(sign).then(send(0)).then(replace)
    .then(replace).then(replace).then(replace)
    .expect(s.fees == [8, 10, 13, 17, 22] and not(admissible(s)) and nextFee(s) == 24)
    .then(refuseAtCap).expect(s.refused and s.fees.length() == 5 and invariant)
    .then(replace.fail())
  // The payment executor's absolute ceiling stops at 20 after 17.
  run executorCeilingTest = initWith(8, 20).then(sign).then(send(0)).then(replace).then(replace)
    .then(replace).then(replace).expect(s.fees == [8, 10, 13, 17, 20] and not(admissible(s)) and invariant)
  // A small original: 3 -> 4 -> 5 -> 7 -> 9 (cap 9), then refused.
  run smallOriginalCapTest = initWith(3, 1000).then(sign).then(send(0)).then(replace).then(replace)
    .then(replace).then(replace).expect(s.fees == [3, 4, 5, 7, 9] and not(admissible(s)) and invariant)
  run minedAttemptStopsReplacementTest = initWith(8, 1000).then(sign).then(send(0)).then(finalize(0))
    .then(replace.fail())
}
