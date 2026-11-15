// @source backend/projects/pool-funding.ts
// @source src/lib/pool-funding.ts
// Only money in a vault is shown (operator decision, 15 November 2026). A
// monthly amount is shown only after the cached vault balances load and the
// project's recorded vaults on paying networks hold at least this month's
// amount; loading, a failed read, no vault or a short vault show points only.
module ui_pool_funding {
  var s: {cap: int, free: int, paying: bool, loaded: bool, failed: bool, shownMoney: bool}
  action init = s' = {cap: 2, free: 0, paying: true, loaded: false, failed: false, shownMoney: false}
  pure def funded(t: {cap: int, free: int, paying: bool, loaded: bool, failed: bool, shownMoney: bool}): bool =
    t.loaded and not(t.failed) and t.paying and t.cap > 0 and t.free >= t.cap
  // React re-renders on every change of the read, so what is shown follows it.
  action load(f: int): bool = {
    val t = s.with("free", f).with("loaded", true).with("failed", false)
    s' = t.with("shownMoney", funded(t))
  }
  action readFailed = {
    val t = s.with("loaded", false).with("failed", true)
    s' = t.with("shownMoney", funded(t))
  }
  action render = s' = s.with("shownMoney", funded(s))
  action step = any { nondet f = 0.to(3).oneOf() load(f), readFailed, render }
  val invariant = s.shownMoney implies (s.loaded and s.paying and s.free >= s.cap and s.cap > 0)
  run loadingShowsNoMoneyTest = init.then(render).expect(not(s.shownMoney) and invariant)
  run shortVaultShowsNoMoneyTest = init.then(load(1)).then(render).expect(not(s.shownMoney) and invariant)
  run fundedVaultShowsMoneyTest = init.then(load(2)).then(render).expect(s.shownMoney and invariant)
  run failedReadShowsNoMoneyTest = init.then(load(3)).then(readFailed).then(render).expect(not(s.shownMoney) and invariant)
}
