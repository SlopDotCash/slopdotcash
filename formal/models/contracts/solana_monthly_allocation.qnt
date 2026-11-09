// @source contracts/solana/programs/slop-escrow/src/lib.rs
// @source contracts/solana/monthly-commitment.ts
// @source contracts/solana/monthly-reserve.ts
// Contract-level Solana monthly allocation lifecycle of slop-escrow:
// `commit_monthly`, `commit_monthly_award`, `release_monthly_award`,
// `release_monthly_reserve`, the owner's hand `commit` and `pay`.
// `commit_monthly` reserves the whole signed total from free balance and adds
// it to `monthly_outstanding`; `frozen_at` lies in [opens_at, now].
// `settle_leaf`, shared by commit_monthly_award and release_monthly_award,
// requires the per-(month, source) `settled` marker to be new and
// committed + gross <= total; it lowers `reserved` and, unless the month is a
// legacy `expired` account, `monthly_outstanding`. commit_monthly_award then
// reserves the gross again for a new obligation (the global origin PDA
// consumes the source once). release_monthly_award frees a leaf only for actor
// zero, or when the consumed obligation pays the same actor at least the gross
// and principal, or was committed before `frozen_at`. A smaller or
// other-actor obligation committed at or after the freeze leaves the gross
// reserved, so selective consumption is never a refund. The owner's hand
// `commit` is refused while `monthly_outstanding` is nonzero.
// `release_monthly_reserve` frees part or all of `total - committed` for the
// exact expected value and counts it as committed and released.
//
// The attester is not trusted here: a recorded allocation may list any leaves,
// including sources already consumed, and any frozen_at <= now.
// Abstractions: Merkle proofs are membership of (source, actor, gross) in the
// recorded leaves; the window is open throughout; fee_for(g) = ceil(g / 50)
// is 1 for every bounded gross. `migrated` hand obligations carry one unit
// less principal. Bounds: one month, sources 1 and 2, leaf actors 0..1,
// obligation actors 1..2, gross 1..2, time 0..2, deposits up to 4,
// `expired` only through a legacy toggle chosen at initialization.
module solana_monthly_allocation {
  type Leaf = { src: int, actor: int, gross: int }
  type Ob = { present: bool, actor: int, gross: int, principal: int, committedAt: int, paid: bool }
  type Month = { recorded: bool, total: int, committed: int, released: int, frozenAt: int,
    expired: bool, leaves: Set[Leaf] }
  type S = { free: int, reserved: int, outstanding: int, paid: int, fees: int, deposited: int,
    month: Month, settled: Set[int], obligations: int -> Ob, now: int, legacy: bool,
    freed: Set[Leaf] }
  var s: S
  pure val Sources = Set(1, 2)
  pure val MaxDeposit = 4
  pure val Cap = 4
  pure val NoOb = { present: false, actor: 0, gross: 0, principal: 0, committedAt: 0, paid: false }
  pure val NoMonth = { recorded: false, total: 0, committed: 0, released: 0, frozenAt: 0,
    expired: false, leaves: Set() }
  pure def feeFor(g: int): int = (g + 49) / 50
  pure val LeafChoices = tuples(Sources, Set(0, 1), Set(1, 2)).map(t => { src: t._1, actor: t._2, gross: t._3 })
  pure val LeafSets = LeafChoices.map(l => Set(l)).union(
    tuples(LeafChoices, LeafChoices).filter(t => t._1.src == 1 and t._2.src == 2).map(t => Set(t._1, t._2)))

  action initWith(legacy: bool): bool =
    s' = { free: 0, reserved: 0, outstanding: 0, paid: 0, fees: 0, deposited: 0,
      month: NoMonth, settled: Set(), obligations: Sources.mapBy(x => NoOb), now: 0,
      legacy: legacy, freed: Set() }
  action init = any { initWith(false), initWith(true) }

  def sum(leaves: Set[Leaf]): int = leaves.fold(0, (acc, l) => acc + l.gross)
  def unsettled: int = s.month.total - s.month.committed
  def openObligations: int = Sources.fold(0, (acc, x) => {
    val o = s.obligations.get(x)
    acc + (if (o.present and not(o.paid)) o.gross else 0) })
  def paysActor(o: Ob, l: Leaf): bool =
    o.actor == l.actor and o.gross >= l.gross and o.principal >= l.gross - feeFor(l.gross)
  def releasable(l: Leaf): bool = {
    val o = s.obligations.get(l.src)
    l.actor == 0 or (o.present and (paysActor(o, l) or o.committedAt < s.month.frozenAt)) }

  action deposit(a: int): bool = all { s.deposited + a <= MaxDeposit,
    s' = s.with("free", s.free + a).with("deposited", s.deposited + a) }
  // Owner `commit`: only while no admitted monthly gross is outstanding.
  // Principal is a u64 in the program: a migrated obligation needs gross
  // large enough to carry its one-unit-smaller principal.
  action handConsume(src: int, actor: int, g: int, migrated: bool): bool = {
    val principal = g - feeFor(g) - (if (migrated) 1 else 0)
    all { s.outstanding == 0, not(s.obligations.get(src).present), g <= s.free, principal >= 0,
      s' = s.with("free", s.free - g).with("reserved", s.reserved + g)
        .with("obligations", s.obligations.set(src, { present: true, actor: actor, gross: g,
          principal: principal, committedAt: s.now, paid: false })) } }
  action commitMonthly(leaves: Set[Leaf], frozenAt: int): bool = {
    val total = sum(leaves)
    all { not(s.month.recorded), frozenAt >= 0, frozenAt <= s.now, total > 0, total <= Cap,
      total <= s.free,
      s' = s.with("free", s.free - total).with("reserved", s.reserved + total)
        .with("outstanding", s.outstanding + total)
        .with("month", { recorded: true, total: total, committed: 0, released: 0,
          frozenAt: frozenAt, expired: false, leaves: leaves }) } }
  // Before any later instruction: an old account already expired, so its
  // unsettled gross left the outstanding count (lib.rs compatibility).
  action legacyExpire = all { s.legacy, s.month.recorded, not(s.month.expired),
    s' = s.with("outstanding", s.outstanding - unsettled)
      .with("month", s.month.with("expired", true)).with("legacy", false) }
  def settle(l: Leaf): S = s.with("settled", s.settled.union(Set(l.src)))
    .with("reserved", s.reserved - l.gross)
    .with("outstanding", if (s.month.expired) s.outstanding else s.outstanding - l.gross)
    .with("month", s.month.with("committed", s.month.committed + l.gross))
  def canSettle(l: Leaf): bool = all { s.month.recorded, s.month.leaves.contains(l),
    not(s.settled.contains(l.src)), s.month.committed + l.gross <= s.month.total }
  action commitAward(l: Leaf): bool = {
    val settledState = settle(l)
    all { canSettle(l), l.actor > 0, not(s.obligations.get(l.src).present),
      s' = settledState.with("reserved", settledState.reserved + l.gross)
        .with("obligations", s.obligations.set(l.src, { present: true, actor: l.actor,
          gross: l.gross, principal: l.gross - feeFor(l.gross), committedAt: s.now, paid: false })) } }
  action releaseAward(l: Leaf): bool = {
    val settledState = settle(l)
    all { canSettle(l), releasable(l),
      s' = settledState.with("free", s.free + l.gross)
        .with("month", settledState.month.with("released", s.month.released + l.gross))
        .with("freed", s.freed.union(Set(l))) } }
  action releaseReserve(expected: int, amt: int): bool = all { s.month.recorded,
    expected == unsettled, amt > 0, amt <= expected,
    s' = s.with("free", s.free + amt).with("reserved", s.reserved - amt)
      .with("outstanding", if (s.month.expired) s.outstanding else s.outstanding - amt)
      .with("month", s.month.with("committed", s.month.committed + amt)
        .with("released", s.month.released + amt)) }
  action pay(src: int): bool = {
    val o = s.obligations.get(src)
    all { o.present, not(o.paid),
      s' = s.with("reserved", s.reserved - o.gross).with("paid", s.paid + o.principal)
        .with("fees", s.fees + o.gross - o.principal)
        .with("obligations", s.obligations.set(src, o.with("paid", true))) } }
  action tick = all { s.now < 2, s' = s.with("now", s.now + 1) }

  action step = any {
    nondet a = Set(1, 2).oneOf()
    deposit(a),
    nondet k = 0.to(15).oneOf()
    handConsume(k % 2 + 1, (k / 2) % 2 + 1, (k / 4) % 2 + 1, k >= 8),
    nondet leaves = LeafSets.oneOf()
    nondet frozenAt = 0.to(2).oneOf()
    commitMonthly(leaves, frozenAt),
    nondet l = LeafChoices.oneOf()
    any { commitAward(l), releaseAward(l) },
    nondet amt = 1.to(Cap).oneOf()
    releaseReserve(unsettled, amt),
    nondet src = Sources.oneOf()
    pay(src),
    legacyExpire, tick, s' = s }

  val invariant = all {
    s.free >= 0, s.reserved >= 0, s.outstanding >= 0, s.paid >= 0,
    Sources.forall(x => s.obligations.get(x).principal >= 0),
    s.month.committed <= s.month.total, s.month.released <= s.month.committed,
    s.free + s.reserved + s.paid + s.fees == s.deposited,
    s.reserved == openObligations + unsettled,
    s.month.recorded and not(s.month.expired) implies s.outstanding == unsettled,
    s.month.expired implies s.outstanding == 0,
    s.settled.forall(x => s.month.leaves.exists(l => l.src == x)),
    // No refund gap: a freed leaf with an actor was either paid by the
    // consumed obligation in full or consumed before the freeze.
    s.freed.forall(l => l.actor == 0 or {
      val o = s.obligations.get(l.src)
      o.present and (paysActor(o, l) or o.committedAt < s.month.frozenAt) }) }

  pure val L11 = { src: 1, actor: 1, gross: 1 }
  pure val L12 = { src: 1, actor: 1, gross: 2 }
  pure val L21 = { src: 2, actor: 1, gross: 1 }
  pure val L20 = { src: 2, actor: 0, gross: 1 }
  run fundedRun = initWith(false).then(deposit(2)).then(deposit(2))
  run commitThenPayTest = fundedRun.then(commitMonthly(Set(L11, L21), 0)).then(commitAward(L11))
    .then(commitAward(L21)).then(pay(1))
    .expect(s.outstanding == 0 and s.month.committed == 2 and invariant)
  run outstandingBlocksHandCommitTest = fundedRun.then(commitMonthly(Set(L11), 0))
    .then(handConsume(2, 1, 1, false).fail())
  run eachSourceSettlesOnceTest = fundedRun.then(commitMonthly(Set(L11, L21), 0)).then(commitAward(L11))
    .then(releaseAward(L11).fail())
  run actorZeroReleasesTest = fundedRun.then(commitMonthly(Set(L11, L20), 0)).then(releaseAward(L20))
    .expect(s.free == 3 and s.month.released == 1 and invariant)
  // The owner consumed source 1 by hand for another actor after the freeze
  // but before the allocation landed: the leaf stays reserved.
  run otherActorAfterFreezeStaysReservedTest = fundedRun.then(tick).then(handConsume(1, 2, 1, false))
    .then(commitMonthly(Set(L11), 0)).then(releaseAward(L11).fail())
  run otherActorBeforeFreezeReleasesTest = fundedRun.then(handConsume(1, 2, 1, false)).then(tick)
    .then(commitMonthly(Set(L11), 1)).then(releaseAward(L11))
    .expect(s.free == 3 and invariant)
  run smallerAwardAfterFreezeStaysReservedTest = fundedRun.then(handConsume(1, 1, 1, false))
    .then(commitMonthly(Set(L12), 0)).then(releaseAward(L12).fail())
  run migratedGrossOneRefusedTest = fundedRun.then(handConsume(1, 1, 1, true).fail())
  run migratedPrincipalStaysReservedTest = fundedRun.then(handConsume(1, 1, 2, true))
    .then(commitMonthly(Set(L12), 0)).then(releaseAward(L12).fail())
  run sameAwardReleasesTest = fundedRun.then(handConsume(1, 1, 2, false))
    .then(commitMonthly(Set(L12), 0)).then(releaseAward(L12)).expect(s.free == 2 and invariant)
  run partialReserveReleaseThenFittingLeafTest = fundedRun.then(commitMonthly(Set(L11, L21), 0))
    .then(releaseReserve(2, 1)).then(commitAward(L11))
    .expect(s.month.committed == 2 and s.outstanding == 0 and invariant)
    .then(commitAward(L21).fail())
  run staleExpectedReserveReleaseTest = fundedRun.then(commitMonthly(Set(L11, L21), 0))
    .then(commitAward(L11)).then(releaseReserve(2, 1).fail())
  run legacyExpiredMonthKeepsOutstandingTest = initWith(true).then(deposit(2)).then(commitMonthly(Set(L11), 0))
    .then(legacyExpire).then(commitAward(L11))
    .expect(s.outstanding == 0 and s.reserved == 1 and invariant)
}
