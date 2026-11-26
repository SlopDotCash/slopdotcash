// @source src/lib/maintainer-share.mjs
// @source src/lib/payments/maintainer-share.ts
// @source scripts/maintainer-decisions.ts
// @source migrations/0137_monthly_maintainer_shares.sql
// @source migrations/0156_monthly_maintainer_share_parts.sql
// Maintainer share of a project month (PRD section 6, operator decision of
// 18 November 2026).
//
// Setting: the owner changes the share during an open month. The open month
// keeps the share it started with; the new share starts with the next month
// (prospectiveMaintainerShare, maintainerShareBasisPoints).
//
// Read: after the month closes, the monthly workflow reads who decided each
// outside pull request. A failed read proposes nothing and may be retried; a
// month with a share is proposed only from a complete read
// (collectMaintainerDecisions, prepareMonthlyBases). A month without a share
// needs no read.
//
// Split: the share is a part of the monthly amount, taken out before the
// points split. It is divided between the deciding accounts by their counted
// decisions with largest remainder, ties to the lower account (a). An
// excluded account's decisions are not counted. With no counted decision the
// share is zero and contributors keep the whole amount (maintainerShare).
//
// Store: the proposal writes the exact record once beside the month. The
// import stages a large record in parts and joins them in the statement that
// stores the share; a missing part stores nothing (monthlyBasesSql).
//
// Bounds: two deciding accounts with 0..2 decisions each, account a possibly
// excluded, shares of 0%, 10%, 20% and 30%, and monthly amounts 0, 10 and 15.
module maintainer_share {
  type S = {
    setting: int, monthShare: int, startShare: int,
    phase: str, read: str,
    a: int, b: int, aExcluded: bool, cap: int,
    pool: int, aAmount: int, bAmount: int, contributors: int
  }
  var s: S
  val shares = Set(0, 1000, 2000, 3000)
  action init = s' = {
    setting: 0, monthShare: 0, startShare: 0, phase: "open", read: "none",
    a: 0, b: 0, aExcluded: false, cap: 0,
    pool: 0, aAmount: 0, bAmount: 0, contributors: 0
  }
  // The owner's revision changes only the share of later months.
  action setShare(points: int): bool = all { s.phase == "open", shares.contains(points),
    s' = s.with("setting", points) }
  action closeMonth(cap: int, aExcluded: bool): bool = all { s.phase == "open",
    s' = s.with("phase", "closed").with("cap", cap).with("aExcluded", aExcluded) }
  action readFails = all { s.phase == "closed", s.monthShare > 0, s.read != "complete",
    s' = s.with("read", "failed") }
  action readCompletes(a: int, b: int): bool = all { s.phase == "closed", s.monthShare > 0, s.read != "complete",
    s' = s.with("read", "complete").with("a", a).with("b", b) }
  action propose = all { s.phase == "closed", s.monthShare == 0 or s.read == "complete",
    val countA = if (s.aExcluded) 0 else s.a
    val counted = countA + s.b
    val pool = if (s.monthShare == 0 or counted == 0) 0 else (s.cap * s.monthShare) / 10000
    val floorA = if (counted == 0) 0 else (pool * countA) / counted
    val floorB = if (counted == 0) 0 else (pool * s.b) / counted
    val left = pool - floorA - floorB
    val toA = counted > 0 and (pool * countA) % counted >= (pool * s.b) % counted
    s' = s.with("phase", "proposed").with("pool", pool)
      .with("aAmount", if (toA) floorA + left else floorA)
      .with("bAmount", if (toA) floorB else floorB + left)
      .with("contributors", s.cap - pool) }
  action nextMonth = all { s.phase == "proposed",
    s' = { setting: s.setting, monthShare: s.setting, startShare: s.setting, phase: "open", read: "none",
      a: 0, b: 0, aExcluded: false, cap: 0, pool: 0, aAmount: 0, bAmount: 0, contributors: 0 } }
  action setAny = { nondet points = shares.oneOf() setShare(points) }
  action closeAny = { nondet cap = Set(0, 10, 15).oneOf() nondet excluded = Set(true, false).oneOf() closeMonth(cap, excluded) }
  action readAny = { nondet a = 0.to(2).oneOf() nondet b = 0.to(2).oneOf() readCompletes(a, b) }
  action step = any { setAny, closeAny, readFails, readAny, propose, nextMonth, s' = s }
  val proposed = s.phase == "proposed"
  val invariant = all {
    // A change never reaches the month in which it was made.
    s.monthShare == s.startShare,
    s.pool >= 0, s.aAmount >= 0, s.bAmount >= 0, s.contributors >= 0,
    // The month never distributes more than its amount, and the share never
    // exceeds its published part.
    proposed implies s.pool + s.contributors == s.cap,
    proposed implies s.aAmount + s.bAmount == s.pool,
    proposed implies s.pool * 10000 <= s.cap * s.monthShare,
    // A month with a share is split only from a complete read.
    (proposed and s.monthShare > 0) implies s.read == "complete",
    // No counted decision, no share; an excluded account receives none.
    (proposed and (if (s.aExcluded) 0 else s.a) + s.b == 0) implies s.pool == 0,
    (proposed and s.aExcluded) implies s.aAmount == 0,
    (proposed and s.b == 0) implies s.bAmount == 0
  }
  run prospectiveTest = init.then(setShare(2000)).then(closeMonth(10, false)).then(propose)
    .expect(s.pool == 0 and s.contributors == 10 and invariant)
    .then(nextMonth).expect(s.monthShare == 2000)
    .then(setShare(3000)).then(closeMonth(10, false)).then(readCompletes(1, 1)).then(propose)
    .expect(s.pool == 2 and s.aAmount == 1 and s.bAmount == 1 and s.contributors == 8 and invariant)
  run remainderTest = init.then(setShare(3000)).then(closeMonth(0, false)).then(propose).then(nextMonth)
    .then(closeMonth(15, false)).then(readCompletes(1, 2)).then(propose)
    .expect(s.pool == 4 and s.aAmount == 1 and s.bAmount == 3 and s.contributors == 11 and invariant)
  run tieTest = init.then(setShare(2000)).then(closeMonth(0, false)).then(propose).then(nextMonth)
    .then(closeMonth(15, false)).then(readCompletes(1, 1)).then(propose)
    .expect(s.pool == 3 and s.aAmount == 2 and s.bAmount == 1 and s.contributors == 12 and invariant)
  run excludedTest = init.then(setShare(2000)).then(closeMonth(0, false)).then(propose).then(nextMonth)
    .then(closeMonth(10, true)).then(readCompletes(2, 1)).then(propose)
    .expect(s.pool == 2 and s.aAmount == 0 and s.bAmount == 2 and invariant)
  run noDecisionTest = init.then(setShare(3000)).then(closeMonth(0, false)).then(propose).then(nextMonth)
    .then(closeMonth(15, true)).then(readFails).then(readCompletes(2, 0)).then(propose)
    .expect(s.pool == 0 and s.contributors == 15 and invariant)
  run failedReadHoldsTest = init.then(setShare(1000)).then(closeMonth(0, false)).then(propose).then(nextMonth)
    .then(closeMonth(10, false)).then(readFails).then(propose).fail()
}
