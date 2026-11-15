// @source backend/projects/pool-funding.ts
// @source src/lib/pool-funding.ts
// @source migrations/0127_vault_month_starts.sql
// Only money in a vault is shown (operator decision, 15 November 2026). A
// monthly amount is shown only after the cached vault balances load and the
// vault covers what is owed now; from December it must also have covered the
// month and the previous month at the first read of the 1st. Loading, a
// failed read, no vault or a short vault show points only. A month funded on
// the 1st that a withdrawal left short is shown as withdrawn, never as money.
module ui_pool_funding {
  type S = {owed: int, free: int, startFree: int, startOwed: int, fromDecember: bool, withdrew: bool, loaded: bool, shownMoney: bool, shownWithdrawn: bool}
  var s: S
  action init = s' = {owed: 2, free: 0, startFree: 0, startOwed: 4, fromDecember: false, withdrew: false, loaded: false, shownMoney: false, shownWithdrawn: false}
  pure def startOk(t: S): bool = not(t.fromDecember) or t.startFree >= t.startOwed
  pure def funded(t: S): bool = t.loaded and t.free >= t.owed and startOk(t)
  pure def withdrawn(t: S): bool = t.loaded and t.fromDecember and t.startFree >= t.startOwed and t.free < t.owed and t.withdrew
  pure def shown(t: S): S = t.with("shownMoney", funded(t)).with("shownWithdrawn", withdrawn(t))
  // React re-renders on every change of the read, so what is shown follows it.
  action load(f: int, sf: int, dec: bool, w: bool): bool =
    s' = shown(s.with("free", f).with("startFree", sf).with("fromDecember", dec).with("withdrew", w).with("loaded", true))
  action readFailed = s' = shown(s.with("loaded", false))
  action step = any {
    nondet f = 0.to(5).oneOf()
    nondet sf = 0.to(5).oneOf()
    nondet dec = Bool.oneOf()
    nondet w = Bool.oneOf()
    load(f, sf, dec, w),
    readFailed,
  }
  val invariant = all {
    s.shownMoney implies (s.loaded and s.free >= s.owed),
    (s.shownMoney and s.fromDecember) implies s.startFree >= s.startOwed,
    not(s.shownMoney and s.shownWithdrawn),
  }
  run loadingShowsNoMoneyTest = init.then(readFailed).expect(not(s.shownMoney) and invariant)
  run shortVaultShowsNoMoneyTest = init.then(load(1, 0, false, false)).expect(not(s.shownMoney) and invariant)
  run novemberLiveRuleTest = init.then(load(2, 0, false, false)).expect(s.shownMoney and invariant)
  run decemberNeedsTheFirstTest = init.then(load(5, 3, true, false)).expect(not(s.shownMoney) and invariant)
  run decemberFundedOnTheFirstTest = init.then(load(2, 4, true, false)).expect(s.shownMoney and invariant)
  run withdrawalIsShownTest = init.then(load(1, 4, true, true)).expect(s.shownWithdrawn and not(s.shownMoney) and invariant)
}
