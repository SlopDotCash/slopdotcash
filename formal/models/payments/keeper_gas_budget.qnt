// @source scripts/payment-keeper/budget.ts
// @source workers/fee-converter/verified-native-liability.ts
// @source workers/payment-executor/core.ts
// Payment-keeper native gas budget (budget.ts `reserve`, `budgetEvmSigner`,
// `budgetSolanaSigner`, `reconcileGas`). Each signature first inserts a gas
// row at its worst-case maximum with transaction_id 'unsigned', then signs and
// records the hash. The daily liability (verified `nativeDailyLiability`) is:
// finalized actuals settled today, plus expiry-evidenced maxima observed
// today, plus one largest maximum per unresolved same-nonce group. A second
// row in an EVM nonce group (`:rN`) exists only as a stated replacement of the
// journaled original's signed hash. An 'unsigned' row makes reconcileGas
// throw, so no receipt is recorded while one exists. A finalized EVM receipt
// zeroes every unresolved sibling of its nonce group with same-nonce evidence.
// A Solana message has no nonce group; finalized expiry charges its maximum on
// the observation day. Reserve refuses while any actual exceeds both its
// maximum and the per-transaction budget. The executor (core.ts) signs a fee
// replacement only while the signer's mined nonce has not passed the
// original's, so no replacement row is added after a receipt used the nonce;
// a replacement signed then could never land and would stay reserved.
//
// Abstractions and bounds: perTx = 2, perDay = 4. EVM nonce groups 1 and 2,
// Solana message 3. Maxima 1..2, actual fees 0..3 (3 exceeds perTx), at most
// two replacements, days 0..1. A finalized receipt's settlement day is the
// current or previous day; the model does not bind it to the reservation day,
// which only moves charges to an earlier day. Chain receipts, fee quotes and
// signer failures beyond a crash before signing are trust boundaries.
module keeper_gas_budget {
  type Row = { group: int, idx: int, max: int, actual: int, settledDay: int,
    expiry: bool, signed: bool, named: bool }
  type S = { rows: Set[Row], day: int, lastCommitted: int }
  var s: S
  pure val PerTx = 2
  pure val PerDay = 4
  pure val EvmGroups = Set(1, 2)
  pure val Groups = Set(1, 2, 3)
  pure val MaxReplacements = 2

  action init = s' = { rows: Set(), day: 0, lastCommitted: 0 }

  def inGroup(rows: Set[Row], g: int): Set[Row] = rows.filter(r => r.group == g)
  def groupCharge(rows: Set[Row], g: int): int =
    inGroup(rows, g).filter(r => r.actual < 0 and not(r.expiry))
      .fold(0, (m, r) => if (r.max > m) r.max else m)
  def committed(rows: Set[Row], d: int): int =
    rows.fold(0, (acc, r) => acc + (
      if (r.actual >= 0 and r.settledDay == d) r.actual
      else if (r.actual < 0 and r.expiry and r.settledDay == d) r.max
      else 0))
    + Groups.fold(0, (acc, g) => acc + groupCharge(rows, g))
  def overrun(rows: Set[Row]): int =
    rows.fold(0, (acc, r) => acc + (if (r.actual > r.max) r.actual - r.max else 0))
  def allSigned: bool = s.rows.forall(r => r.signed)
  def stuck: bool = s.rows.exists(r => r.actual > r.max and r.actual > PerTx)
  def replacements: int = s.rows.filter(r => r.idx > 0).size()
  // A chain receipt (not same-nonce evidence) used this group's nonce.
  def nonceUsed(g: int): bool = inGroup(s.rows, g).exists(r => r.actual >= 0 and not(r.expiry))

  // One reservation; `sign` false is a crash after the durable insert and
  // before the signer returned, which leaves transaction_id 'unsigned'.
  action reserve(g: int, m: int, named: bool, sign: bool): bool = {
    val prior = inGroup(s.rows, g)
    val n = prior.size()
    val row = { group: g, idx: n, max: m, actual: -1, settledDay: -1,
      expiry: false, signed: sign, named: named }
    val c = committed(s.rows.union(Set(row)), s.day)
    all {
      m >= 1, m <= PerTx, not(stuck),
      n == 0 or all { EvmGroups.contains(g), named, replacements < MaxReplacements,
        prior.exists(r => r.idx == 0 and r.signed), not(nonceUsed(g)) },
      c <= PerDay,
      s' = s.with("rows", s.rows.union(Set(row))).with("lastCommitted", c) } }
  action signOriginal(g: int, m: int): bool = all { inGroup(s.rows, g).size() == 0, reserve(g, m, false, true) }
  action signReplacement(g: int, m: int, statesOriginal: bool): bool =
    all { inGroup(s.rows, g).size() > 0, reserve(g, m, statesOriginal, true) }
  action crashBeforeSign(g: int, m: int, statesOriginal: bool): bool = reserve(g, m, statesOriginal, false)

  // reconcileGas: a finalized receipt records the actual fee on its block's
  // day; an EVM receipt also zeroes the unresolved same-nonce siblings.
  action finalize(g: int, i: int, a: int, d: int): bool = all {
    allSigned, d >= 0, d <= s.day, not(nonceUsed(g)),
    s.rows.exists(r => r.group == g and r.idx == i and r.actual < 0 and not(r.expiry)),
    s' = s.with("rows", s.rows.map(r =>
      if (r.group == g and r.idx == i) r.with("actual", a).with("settledDay", d)
      else if (r.group == g and r.actual < 0 and EvmGroups.contains(g))
        r.with("actual", 0).with("settledDay", d).with("expiry", true)
      else r)) }
  action solanaExpire = all {
    allSigned,
    s.rows.exists(r => r.group == 3 and r.actual < 0 and not(r.expiry)),
    s' = s.with("rows", s.rows.map(r =>
      if (r.group == 3 and r.actual < 0 and not(r.expiry))
        r.with("expiry", true).with("settledDay", s.day)
      else r)) }
  action midnight = all { s.day < 1, s' = s.with("day", s.day + 1) }

  // One nondeterministic index per choice family keeps simulation fast: a
  // reservation decodes (group 1..3, maximum 1..2, statesOriginal) and a
  // receipt decodes (group 1..3, row 0..2, actual 0..3, settlement day 0..1).
  // signReplacement with statesOriginal false is always refused, as
  // replacementMustNameOriginalTest checks.
  action step = any {
    nondet k = 0.to(11).oneOf()
    val g = k % 3 + 1
    val m = (k / 3) % 2 + 1
    val named = k >= 6
    any { signOriginal(g, m), signReplacement(g, m, named), crashBeforeSign(g, m, named) },
    nondet k = 0.to(71).oneOf()
    finalize(k % 3 + 1, (k / 3) % 3, (k / 9) % 4, k / 36),
    solanaExpire, midnight, s' = s }

  val invariant = all {
    // Each successful reserve left the day's committed liability within perDay.
    s.lastCommitted <= PerDay,
    // Today's liability exceeds perDay only by fees above their own reserve.
    committed(s.rows, s.day) <= PerDay + overrun(s.rows),
    s.rows.forall(a => s.rows.forall(b => a.group == b.group and a.idx == b.idx implies a == b)),
    // Only one transaction can use a nonce: one nonzero actual per group.
    Groups.forall(g => inGroup(s.rows, g).filter(r => r.actual > 0).size() <= 1),
    // A replacement row exists only for a request that named the original.
    s.rows.forall(r => r.idx > 0 implies r.named and EvmGroups.contains(r.group)),
    s.rows.forall(r => r.idx > 0 implies s.rows.exists(o => o.group == r.group and o.idx == 0 and o.signed)),
    s.rows.forall(r => r.actual >= 0 implies r.signed),
    replacements <= MaxReplacements }

  run replacementSharesLiabilityTest = init.then(signOriginal(1, 2)).then(signReplacement(1, 2, true))
    .then(signOriginal(2, 2)).expect(s.lastCommitted == 4 and invariant)
    .then(signOriginal(3, 1).fail())
  run replacementMustNameOriginalTest = init.then(signOriginal(1, 1)).then(signReplacement(1, 1, false).fail())
  run solanaHasNoReplacementTest = init.then(signOriginal(3, 1)).then(signReplacement(3, 1, true).fail())
  run unsignedOriginalCannotBeReplacedTest = init.then(crashBeforeSign(1, 1, false))
    .then(signReplacement(1, 1, true).fail())
  run unsignedBlocksReconcileTest = init.then(crashBeforeSign(1, 1, false)).then(signOriginal(2, 1))
    .then(finalize(2, 0, 1, 0).fail())
  run finalizeZeroesSiblingsTest = init.then(signOriginal(1, 2)).then(signReplacement(1, 2, true))
    .then(finalize(1, 1, 1, 0))
    .expect(committed(s.rows, 0) == 1 and s.rows.exists(r => r.idx == 0 and r.actual == 0) and invariant)
    .then(finalize(1, 0, 1, 0).fail())
  run solanaExpiryChargedOnObservationDayTest = init.then(signOriginal(3, 2)).then(solanaExpire)
    .expect(committed(s.rows, 0) == 2).then(midnight).expect(committed(s.rows, 1) == 0 and invariant)
  run unknownCarriesAcrossMidnightTest = init.then(signOriginal(1, 2)).then(signOriginal(2, 2))
    .then(midnight).then(signOriginal(3, 1).fail())
  run settledYesterdayFreesTodayTest = init.then(signOriginal(1, 2)).then(signOriginal(2, 2))
    .then(midnight).then(finalize(1, 0, 2, 0)).then(signOriginal(3, 2))
    .expect(s.lastCommitted == 4 and invariant)
  run overrunStopsSigningTest = init.then(signOriginal(1, 1)).then(finalize(1, 0, 3, 0))
    .then(signOriginal(2, 1).fail())
  run overrunWithinTransactionBudgetTest = init.then(signOriginal(1, 1)).then(finalize(1, 0, 2, 0))
    .then(signOriginal(2, 2)).expect(committed(s.rows, 0) == 4 and invariant)
}
