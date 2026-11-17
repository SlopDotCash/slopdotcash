// @source backend/projects/pool-funding.ts
// @source src/lib/pool-funding.ts
// @source migrations/0127_vault_month_starts.sql
// @source migrations/0128_vault_month_pledges.sql
// Vault-backed money is shown only after the cached vault balances load and the
// vault covers what is owed now; from December it must also have covered the
// month and the previous month at the first read of the 1st. Loading, a
// failed read, no vault or a short vault show points only by default. A month
// funded on the 1st that a withdrawal left short is never shown as backed.
// An explicit owner promise can show a positive amount with a warning, but
// missing evidence never shows either verified backing or a definitive shortfall.
// A vault whose contract supports month pledges is judged only by the amount
// the owner pledged on chain for this month; its free funds and the first
// read of the 1st do not count, and it is never shown as withdrawn, because
// the contract refuses a withdrawal of pledged funds.
module ui_pool_funding {
  type S = {owed: int, cap: int, free: int, startFree: int, startOwed: int, fromDecember: bool, withdrew: bool, supported: bool, pledged: int, loaded: bool, optedIn: bool, unreadVault: bool, shownMoney: bool, shownWithdrawn: bool, shownLocked: bool, promiseWarning: str}
  var s: S
  action init = s' = {owed: 2, cap: 2, free: 0, startFree: 0, startOwed: 4, fromDecember: false, withdrew: false, supported: false, pledged: 0, loaded: false, optedIn: false, unreadVault: true, shownMoney: false, shownWithdrawn: false, shownLocked: false, promiseWarning: "none"}
  pure def startOk(t: S): bool = not(t.fromDecember) or t.startFree >= t.startOwed
  pure def locked(t: S): bool = t.loaded and t.supported and t.pledged >= t.cap
  pure def legacyFunded(t: S): bool = t.loaded and not(t.supported) and t.free >= t.owed and startOk(t)
  pure def funded(t: S): bool = locked(t) or legacyFunded(t)
  pure def withdrawn(t: S): bool = t.loaded and not(t.supported) and t.fromDecember and t.startFree >= t.startOwed and t.free < t.owed and t.withdrew
  pure def warning(t: S): str =
    if (not(t.optedIn) or t.cap <= 0 or funded(t)) "none"
    else if (t.unreadVault) "unverified"
    else "not-vaulted"
  pure def shown(t: S): S = t.with("shownMoney", funded(t)).with("shownWithdrawn", withdrawn(t)).with("shownLocked", locked(t)).with("promiseWarning", warning(t))
  // React re-renders on every change of the read, so what is shown follows it.
  action load(f: int, sf: int, dec: bool, w: bool, sup: bool, p: int): bool =
    s' = shown(s.with("free", f).with("startFree", sf).with("fromDecember", dec).with("withdrew", w).with("supported", sup).with("pledged", p).with("loaded", true).with("unreadVault", false))
  action readFailed = s' = shown(s.with("loaded", false).with("unreadVault", true))
  action choosePromise(choice: bool): bool = s' = shown(s.with("optedIn", choice))
  action step = any {
    nondet f = 0.to(5).oneOf()
    nondet sf = 0.to(5).oneOf()
    nondet dec = Bool.oneOf()
    nondet w = Bool.oneOf()
    nondet sup = Bool.oneOf()
    nondet p = 0.to(3).oneOf()
    load(f, sf, dec, w, sup, p),
    readFailed,
    nondet choice = Bool.oneOf()
    choosePromise(choice),
  }
  val invariant = all {
    s.shownMoney implies s.loaded,
    (s.shownMoney and not(s.supported)) implies s.free >= s.owed,
    (s.shownMoney and not(s.supported) and s.fromDecember) implies s.startFree >= s.startOwed,
    (s.shownMoney and s.supported) implies s.pledged >= s.cap,
    s.shownLocked implies (s.shownMoney and s.supported),
    not(s.shownMoney and s.shownWithdrawn),
    s.shownWithdrawn implies not(s.supported),
    (s.promiseWarning != "none") == (s.optedIn and s.cap > 0 and not(s.shownMoney)),
    (s.promiseWarning == "not-vaulted") implies not(s.unreadVault),
    (s.promiseWarning == "unverified") implies s.unreadVault,
  }
  run loadingShowsNoMoneyTest = init.then(readFailed).expect(not(s.shownMoney) and invariant)
  run shortVaultShowsNoMoneyTest = init.then(load(1, 0, false, false, false, 0)).expect(not(s.shownMoney) and invariant)
  run novemberLiveRuleTest = init.then(load(2, 0, false, false, false, 0)).expect(s.shownMoney and invariant)
  run decemberNeedsTheFirstTest = init.then(load(5, 3, true, false, false, 0)).expect(not(s.shownMoney) and invariant)
  run decemberFundedOnTheFirstTest = init.then(load(2, 4, true, false, false, 0)).expect(s.shownMoney and invariant)
  run withdrawalIsShownTest = init.then(load(1, 4, true, true, false, 0)).expect(s.shownWithdrawn and not(s.shownMoney) and invariant)
  run pledgedMonthIsLockedTest = init.then(load(0, 0, true, true, true, 2)).expect(s.shownMoney and s.shownLocked and not(s.shownWithdrawn) and invariant)
  run freeFundsWithoutPledgeShowNoMoneyTest = init.then(load(5, 5, true, false, true, 0)).expect(not(s.shownMoney) and invariant)
  run shortPledgeShowsNoMoneyTest = init.then(load(5, 5, false, false, true, 1)).expect(not(s.shownMoney) and invariant)
  run ownerPromiseIsNotVerifiedMoneyTest = init.then(choosePromise(true)).expect(s.promiseWarning == "unverified" and not(s.shownMoney) and invariant)
  run shortReadShowsPromiseWarningTest = init.then(choosePromise(true)).then(load(1, 0, false, false, false, 0)).expect(s.promiseWarning == "not-vaulted" and invariant)
  run fundedReadReplacesPromiseWarningTest = init.then(choosePromise(true)).then(load(2, 0, false, false, false, 0)).expect(s.promiseWarning == "none" and s.shownMoney and invariant)
  run optOutRemovesPromiseTest = init.then(choosePromise(true)).then(choosePromise(false)).expect(s.promiseWarning == "none" and invariant)
}
