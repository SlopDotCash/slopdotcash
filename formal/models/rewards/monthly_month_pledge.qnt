// @source backend/payments/month-pledges.ts
// @source backend/payments/month-pledge-readers.ts
// @source backend/payments/monthly.ts
// @source backend/payments/monthly-attestation.ts
// @source backend/payments/monthly-publication.ts
// @source backend/payments/vault-snapshots.ts
// @source workers/payments/index.ts
// @source workers/payment-executor/solana-monthly.ts
// @source migrations/0128_vault_month_pledges.sql
// @source backend/payments/solana-month-lock.ts
// @source workers/fee-converter/solana.ts
// @evidence backend/payments/monthly.test.ts
// @evidence backend/payments/vault-month-starts.test.ts
// @evidence backend/payments/month-pledges.test.ts
// An owner's on-chain pledge for a month is consent to reserve it (operator
// decision, 15 November 2026). The Worker stores what it read; a failed read
// keeps the stored pledge. After the cutoff a month freezes when the stored
// pledge exists, whatever the automatic default, a pause or a restriction
// says; without a pledge the old consent rules hold. A pledge can be made
// only while its month is open and never removed. Obligations are created
// only when free funds, less every other month's open pledge, cover the
// month. Only a pledge in the vault that pays the month counts, and a
// retired project never freezes on a pledge. A refresh reads every stored
// open pledge again, so a lapsed one is closed once a release is sent. One
// project, one month and one other month's pledge are modeled.
module monthly_month_pledge {
  var s: { pledgedOnChain: bool, pledgedStored: bool, automatic: bool,
    active: bool, restricted: bool, monthClosed: bool, cutoffPassed: bool,
    frozen: bool, frozenWithConsent: bool, free: int, otherPledge: int,
    needed: int, obligations: bool, retired: bool, otherVaultPledge: bool }
  action init = s' = { pledgedOnChain: false, pledgedStored: false,
    automatic: true, active: true, restricted: false, monthClosed: false,
    cutoffPassed: false, frozen: false, frozenWithConsent: true, free: 2,
    otherPledge: 0, needed: 2, obligations: false, retired: false,
    otherVaultPledge: false }
  pure def consent(t: { pledgedOnChain: bool, pledgedStored: bool, automatic: bool,
    active: bool, restricted: bool, monthClosed: bool, cutoffPassed: bool,
    frozen: bool, frozenWithConsent: bool, free: int, otherPledge: int,
    needed: int, obligations: bool, retired: bool, otherVaultPledge: bool }): bool =
    (t.pledgedStored and not(t.retired)) or (t.automatic and t.active and not(t.restricted))
  action pledge = all { not(s.monthClosed), s' = s.with("pledgedOnChain", true) }
  // A refresh stores the latest read; a failed read changes nothing.
  action refresh = s' = s.with("pledgedStored", s.pledgedOnChain or s.pledgedStored)
  action refreshFailed = s' = s
  action setAutomatic(on: bool): bool = s' = s.with("automatic", on)
  action pause = s' = s.with("active", false)
  action retire = s' = s.with("active", false).with("retired", true)
  // A pledge left in a replaced vault of the project is stored but gives no consent.
  action pledgeInOtherVault = s' = s.with("otherVaultPledge", true)
  action restrict = s' = s.with("restricted", true)
  action closeMonth = all { not(s.monthClosed), s' = s.with("monthClosed", true) }
  action passCutoff = all { s.monthClosed, not(s.cutoffPassed), s' = s.with("cutoffPassed", true) }
  action setFunds(free: int, other: int): bool = s' = s.with("free", free).with("otherPledge", other)
  action coordinate = all {
    s.cutoffPassed, not(s.frozen),
    if (consent(s))
      s' = s.with("frozen", true).with("frozenWithConsent", true)
    else s' = s,
  }
  action createObligations = all {
    s.frozen, not(s.obligations),
    if (s.free - s.otherPledge >= s.needed) s' = s.with("obligations", true) else s' = s,
  }
  action step = any {
    pledge, refresh, refreshFailed, pause, restrict, retire, pledgeInOtherVault,
    closeMonth, passCutoff,
    coordinate, createObligations,
    nondet on = Bool.oneOf()
    setAutomatic(on),
    nondet f = 0.to(4).oneOf()
    nondet o = 0.to(2).oneOf()
    setFunds(f, o),
  }
  val invariant = all {
    s.frozen implies s.cutoffPassed,
    s.frozen implies s.frozenWithConsent,
    s.pledgedStored implies s.pledgedOnChain,
    s.obligations implies s.frozen,
  }
  run pledgedMonthFreezesWithDefaultOffTest = init.then(pledge).then(refresh)
    .then(setAutomatic(false)).then(closeMonth).then(passCutoff).then(coordinate)
    .expect(s.frozen and invariant)
  run pledgedMonthFreezesWhilePausedAndRestrictedTest = init.then(pledge).then(refresh)
    .then(pause).then(restrict).then(closeMonth).then(passCutoff).then(coordinate)
    .expect(s.frozen and invariant)
  run unpledgedMonthWaitsWithDefaultOffTest = init.then(setAutomatic(false))
    .then(closeMonth).then(passCutoff).then(coordinate)
    .expect(not(s.frozen) and invariant)
  run unreadPledgeWaitsUntilStoredTest = init.then(pledge).then(refreshFailed)
    .then(setAutomatic(false)).then(closeMonth).then(passCutoff).then(coordinate)
    .expect(not(s.frozen) and invariant)
  run otherPledgeIsHeldBackTest = init.then(closeMonth).then(passCutoff)
    .then(setFunds(3, 2)).then(coordinate).then(createObligations)
    .expect(s.frozen and not(s.obligations) and invariant)
  run retiredProjectDoesNotFreezeTest = init.then(pledge).then(refresh)
    .then(setAutomatic(false)).then(retire).then(closeMonth).then(passCutoff)
    .then(coordinate).expect(not(s.frozen) and invariant)
  run otherVaultPledgeGivesNoConsentTest = init.then(pledgeInOtherVault)
    .then(setAutomatic(false)).then(closeMonth).then(passCutoff).then(coordinate)
    .expect(not(s.frozen) and invariant)
  run noPledgeAfterTheMonthClosesTest = init.then(closeMonth).then(pledge.fail())
}
