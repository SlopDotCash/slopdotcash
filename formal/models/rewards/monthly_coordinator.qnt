// @source migrations/0062_monthly_allocations.sql
// @source migrations/0071_monthly_ban_exclusions.sql
// @source migrations/0081_monthly_asset_amount_range.sql
// @source src/lib/payments/monthly-allocation.ts
// @source backend/payments/monthly.ts
// @source backend/payments/monthly-publication.ts
// @source backend/payments/monthly-attestation.ts
// @source scripts/prepare-monthly-rewards.ts
// Automatic freeze at configured cutoff, CAS against settings/revision, funding later.
module monthly_coordinator {
  type S = { phase: str, enabled: bool, active: bool, cutoff: bool, revision: int,
    loadedRevision: int, free: int, obligations: bool, excluded: bool, funded: bool, banned: bool }
  var s: S
  action init = s' = { phase: "editable", enabled: true, active: true, cutoff: false,
    revision: 0, loadedRevision: -1, free: 0, obligations: false, excluded: false, funded: false, banned: false }
  action load = s' = s.with("loadedRevision", s.revision)
  action cutoff = s' = s.with("cutoff", true)
  action disable = s' = s.with("enabled", false)
  action pause = s' = s.with("active", false).with("revision", 1)
  action freeze = all { s.phase == "editable", s.enabled, s.active, s.cutoff, s.loadedRevision == s.revision,
    s' = s.with("phase", "frozen") }
  action fund = s' = s.with("free", 4)
  action ban = s' = s.with("banned", true).with("excluded", not(s.funded))
  action create = all { s.phase == "frozen", not(s.obligations), not(s.excluded), s.free >= 4,
    s' = s.with("obligations", true).with("funded", true).with("free", 0) }
  action step = any { load, cutoff, disable, pause, freeze, fund, ban, create, s' = s }
  val invariant = all { s.obligations implies (s.funded and s.phase == "frozen"),
    s.funded implies not(s.excluded) }
  run underfundedWaitTest = init.then(load).then(cutoff).then(freeze).then(create.fail())
  run settingsRaceTest = init.then(load).then(cutoff).then(disable).then(freeze.fail())
  run registryRaceTest = init.then(load).then(cutoff).then(pause).then(freeze.fail())
  run fundedBanDoesNotEraseTest = init.then(load).then(cutoff).then(freeze).then(fund).then(create).then(ban).expect(s.funded and s.banned and not(s.excluded) and invariant)
}
