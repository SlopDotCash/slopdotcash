// @source contracts/solana/programs/slop-escrow/src/lib.rs
// @source contracts/solana/month-pledge.ts
// @source contracts/solana/integration/pledge-preload.mjs
// Month pledges of slop-escrow (operator decision, 15 November 2026):
// `pledge_month`, `expire_pledge`, `close_month_pledge`, the pledge checks in `withdraw`,
// `withdraw_native` and the owner's hand `commit`, and `commit_monthly` with
// its optional `month_pledge` account. A pledge holds free funds to one UTC
// period. It opens for the current period or a later one within the bound,
// fits in free balance minus the other open pledges, and only rises. While
// open it lets that period commit with the monthly switch off (up to the pledge
// alone) or a cap below it (up to the pledge), and closes when the period commits
// naming it. The owner then deletes the closed account for its rent; the period is
// past by then, so it can never be pledged again. A commit that leaves the
// account off counts every open pledge, its own included; anyone then closes
// that pledge at once. An uncommitted pledge lapses only after the period's
// window closes. Withdrawals and hand commits never take free balance below
// the open total.
//
// Abstractions: periods are indices; the window of period p is open while
// now == p + 1 and closed from now == p + 2; pledges reach one period ahead
// (the program allows 11). Withdrawals and hand commits are one "spend" that
// lowers free balance. Fees, the vault token balance, attestation and the
// 332-byte migration are out of scope (the e2e suite covers them).
// Bounds: periods 0..2, now 0..3, deposits up to 4, amounts 1..2, cap 0..2.
module solana_month_pledge {
  type S = { free: int, deposited: int, amount: int -> int, open: int -> bool,
    closed: Set[int], deleted: Set[int], committed: Set[int], pledgedOpen: int, enabled: bool,
    cap: int, now: int }
  var s: S
  pure val Periods = Set(0, 1, 2)
  pure val MaxDeposit = 4
  pure def max(a: int, b: int): int = if (a > b) a else b

  action init = s' = { free: 0, deposited: 0, amount: Periods.mapBy(p => 0),
    open: Periods.mapBy(p => false), closed: Set(), deleted: Set(), committed: Set(),
    pledgedOpen: 0, enabled: false, cap: 0, now: 0 }

  def openSum: int = Periods.fold(0, (acc, p) => if (s.open.get(p)) acc + s.amount.get(p) else acc)
  def own(p: int, named: bool): int = if (named and s.open.get(p)) s.amount.get(p) else 0
  def limit(mine: int): int = if (s.enabled) max(s.cap, mine) else mine
  // A closed account refuses a new pledge; a deleted one no longer exists on chain.
  def refused(p: int): bool = s.closed.contains(p) and not(s.deleted.contains(p))

  action deposit(a: int): bool = all { s.deposited + a <= MaxDeposit,
    s' = s.with("free", s.free + a).with("deposited", s.deposited + a) }
  action pledge(p: int, a: int): bool = {
    val previous = if (s.open.get(p)) s.amount.get(p) else 0
    all { a > 0, p >= s.now, p <= s.now + 1, not(refused(p)), a >= previous,
      s.free >= s.pledgedOpen + a - previous,
      s' = s.with("amount", s.amount.set(p, a)).with("open", s.open.set(p, true))
        .with("pledgedOpen", s.pledgedOpen + a - previous) } }
  action spend(g: int): bool = all { g > 0, s.free >= g, s.free - g >= s.pledgedOpen,
    s' = s.with("free", s.free - g) }
  action setMonthly(c: int, e: bool): bool = all { not(e) or c > 0,
    s' = s.with("cap", c).with("enabled", e) }
  action commitMonthly(p: int, total: int, named: bool): bool = {
    val mine = own(p, named)
    all { s.now == p + 1, not(s.committed.contains(p)), total > 0,
      s.enabled or mine > 0, total <= limit(mine), s.free >= total,
      s.free - total >= s.pledgedOpen - mine,
      s' = s.with("free", s.free - total).with("committed", s.committed.union(Set(p)))
        .with("open", if (mine > 0) s.open.set(p, false) else s.open)
        .with("closed", if (mine > 0) s.closed.union(Set(p)) else s.closed)
        .with("pledgedOpen", s.pledgedOpen - mine) } }
  action expire(p: int): bool = all { s.open.get(p),
    s.committed.contains(p) or s.now >= p + 2,
    s' = s.with("open", s.open.set(p, false)).with("closed", s.closed.union(Set(p)))
      .with("pledgedOpen", s.pledgedOpen - s.amount.get(p)) }
  action close(p: int): bool = all { refused(p),
    s' = s.with("deleted", s.deleted.union(Set(p))) }
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1) }

  action step = any {
    nondet a = Set(1, 2).oneOf()
    nondet p = Periods.oneOf()
    any { deposit(a), pledge(p, a), spend(a), expire(p), close(p) },
    nondet c = 0.to(2).oneOf()
    nondet e = Set(true, false).oneOf()
    setMonthly(c, e),
    nondet p = Periods.oneOf()
    nondet t = Set(1, 2).oneOf()
    nondet named = Set(true, false).oneOf()
    commitMonthly(p, t, named),
    tick, s' = s }

  val invariant = all {
    s.free >= 0, s.pledgedOpen >= 0,
    s.free >= s.pledgedOpen,
    s.pledgedOpen == openSum,
    Periods.forall(p => s.open.get(p) implies not(s.closed.contains(p))),
    // A pledge closed by its commit never reopens or counts again.
    Periods.forall(p => s.closed.contains(p) implies not(s.open.get(p))),
    // Every closed period is past, so deleting its account cannot reopen it.
    Periods.forall(p => s.closed.contains(p) implies p < s.now),
    s.deleted.subseteq(s.closed) }

  run funded = init.then(deposit(2)).then(deposit(2))
  run pledgeMustFitTest = funded.then(pledge(0, 2)).then(pledge(1, 3).fail())
  run pledgeBlocksSpendTest = funded.then(pledge(0, 2)).then(spend(2)).then(spend(1).fail())
  run raiseOnlyTest = funded.then(pledge(0, 2)).then(pledge(0, 1).fail())
  run pastPeriodRefusedTest = funded.then(tick).then(pledge(0, 1).fail())
  run switchOffStillCommitsTest = funded.then(pledge(0, 2)).then(setMonthly(0, false)).then(tick)
    .then(commitMonthly(0, 2, true))
    .expect(s.pledgedOpen == 0 and s.committed.contains(0) and not(s.open.get(0)) and invariant)
  run switchOffWithoutPledgeRefusedTest = funded.then(pledge(0, 2)).then(tick)
    .then(commitMonthly(0, 1, false).fail())
  run switchOffCapsAtPledgeTest = funded.then(pledge(0, 1)).then(setMonthly(2, false)).then(tick)
    .then(commitMonthly(0, 2, true).fail())
  run capAbovePledgeRefusedTest = funded.then(pledge(0, 1)).then(tick)
    .then(commitMonthly(0, 2, true).fail())
  run otherPledgeProtectedTest = funded.then(setMonthly(2, true)).then(pledge(1, 3))
    .then(pledge(0, 1)).then(tick).then(commitMonthly(0, 2, true).fail())
  run unnamedCommitClosesByExpireTest = funded.then(pledge(0, 1)).then(setMonthly(1, true)).then(tick)
    .then(commitMonthly(0, 1, false)).expect(s.open.get(0))
    .then(expire(0)).expect(s.pledgedOpen == 0 and invariant)
  run noLapseInsideWindowTest = funded.then(pledge(0, 2)).then(tick).then(expire(0).fail())
  run lapseAfterWindowTest = funded.then(pledge(0, 2)).then(tick).then(tick).then(expire(0))
    .expect(s.pledgedOpen == 0 and s.free == 4 and invariant)
  run openPledgeNotDeletedTest = funded.then(pledge(0, 2)).then(close(0).fail())
  run lapsedAndDeleted = funded.then(pledge(0, 2)).then(tick).then(tick).then(expire(0)).then(close(0))
  run deletedPledgeNeverReopensTest = lapsedAndDeleted.then(pledge(0, 1).fail())
  run deletedPledgeDeletesOnceTest = lapsedAndDeleted.then(close(0).fail())
  run lapsedPledgeClosesOnceTest = funded.then(pledge(0, 2)).then(tick).then(tick).then(expire(0))
    .then(expire(0).fail())
}
