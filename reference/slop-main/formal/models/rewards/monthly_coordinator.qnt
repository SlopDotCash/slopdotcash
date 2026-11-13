// @source src/lib/verified-monthly-replacement.ts
// @source src/lib/verified-allocation.ts
// @source migrations/0062_monthly_allocations.sql
// @source migrations/0071_monthly_ban_exclusions.sql
// @source migrations/0081_monthly_asset_amount_range.sql
// @source src/lib/payments/monthly-allocation.ts
// @source src/lib/verified-money.ts
// @source backend/payments/monthly.ts
// @source backend/payments/chain-awards.ts
// @source backend/payments/vault-snapshots.ts
// @source backend/payments/monthly-publication.ts
// @source backend/payments/monthly-attestation.ts
// @source scripts/prepare-monthly-rewards.ts
// Monthly freeze and obligation creation for two months that share one vault.
//
// Freeze (freezeMonthlyPeriod): one execution snapshot per month, written by
// whichever trigger comes first. Both triggers need the closed month, the
// loaded allocation/registry revision and an active project. Only the
// automatic trigger reads the automatic-payment setting: an owner may finalize
// a month after turning the automatic default off (the SQL guard is
// `?='owner' OR automatic=1`). That is the PRD policy, not a defect.
//
// Funding (createMonthlyObligations): a month needs its eligible awards plus
// every earlier monthly obligation of the same vault that has no finalized
// chain obligation yet. The check reads the vault snapshot; the write is a
// compare-and-set on the monthly-obligation count, the chain-obligation count
// and the exact snapshot row. A concurrent month or a refreshed snapshot makes
// the write miss, and the caller reports stale funding and retries later.
//
// Snapshot lag: vault snapshots and chain obligations are refreshed by
// independent jobs, and the write does not compare their blocks. After a
// month's chain reservation is recorded, a snapshot observed before that
// reservation (within VAULT_SNAPSHOT_STALE_MS) still counts the reserved
// funds as free, while the reserved month no longer counts as outstanding.
// The ghost `overcommitted` records a creation admitted in that window. The
// contract still refuses the later reservation (`InsufficientFreeBalance`),
// so funds are never over-reserved; only the off-chain obligation is
// premature. The invariant states exactly this boundary.
//
// Bounds: one award per month of 2 base units, deposits of 2 up to 6, at most
// three snapshot versions. Bans exclude a month's award only before creation.
module monthly_coordinator {
  type Read = { ok: bool, mc: int, cc: int, ver: int }
  type S = { phase: int -> str, read: int -> Read, excluded: int -> bool,
    enabled: bool, active: bool, cutoff: bool, revision: int, loadedRevision: int,
    banned: bool, chainFree: int, snapFree: int, snapVer: int, snapLagging: bool,
    outstanding: int, monthlyCount: int, chainCount: int, overcommitted: bool }
  var s: S
  pure val Months = Set(1, 2)
  pure val Need = 2
  pure val NoRead = { ok: false, mc: 0, cc: 0, ver: 0 }
  action init = s' = { phase: Months.mapBy(_ => "editable"), read: Months.mapBy(_ => NoRead),
    excluded: Months.mapBy(_ => false), enabled: true, active: true, cutoff: false,
    revision: 0, loadedRevision: -1, banned: false, chainFree: 0, snapFree: 0, snapVer: 0,
    snapLagging: false, outstanding: 0, monthlyCount: 0, chainCount: 0, overcommitted: false }
  action load = s' = s.with("loadedRevision", s.revision)
  action cutoff = s' = s.with("cutoff", true)
  action disable = s' = s.with("enabled", false)
  action pause = all { s.revision < 1, s' = s.with("active", false).with("revision", 1) }
  // trigger: "owner" or "automatic"; the primary key admits one freeze.
  action freeze(m: int, trigger: str): bool = all { s.phase.get(m) == "editable", s.cutoff,
    s.active, s.loadedRevision == s.revision, trigger == "owner" or s.enabled,
    s' = s.with("phase", s.phase.set(m, "frozen")) }
  action ban = s' = s.with("banned", true)
  action deposit = all { s.chainFree + 2 <= 6, s' = s.with("chainFree", s.chainFree + 2) }
  // Background snapshot job: observes the finalized free counter.
  action refresh = all { s.snapVer < 3,
    s' = s.with("snapFree", s.chainFree).with("snapVer", s.snapVer + 1).with("snapLagging", false) }
  // Chain reservation of every outstanding monthly obligation (reserveMonthly
  // charges freeBalance; the per-award leaves are then recorded as chain
  // obligations). The contract refuses an amount above freeBalance.
  action reserve = all { s.outstanding > 0, s.outstanding <= s.chainFree, s.chainCount < 2,
    s' = s.with("chainFree", s.chainFree - s.outstanding).with("outstanding", 0)
      .with("chainCount", s.chainCount + 1).with("snapLagging", true) }
  pure def needOf(st: S, m: int): int = (if (st.banned) 0 else Need) + st.outstanding
  // Read phase of createMonthlyObligations. Underfunded leaves no state.
  action check(m: int): bool = all { s.phase.get(m) == "frozen", needOf(s, m) <= s.snapFree,
    s' = s.with("read", s.read.set(m, { ok: true, mc: s.monthlyCount, cc: s.chainCount, ver: s.snapVer }))
      .with("excluded", s.excluded.set(m, s.banned)) }
  // Guarded batch write. A miss leaves the month frozen for a later retry.
  action write(m: int): bool = {
    val r = s.read.get(m)
    all { r.ok, s.phase.get(m) == "frozen",
      s' = if (r.mc == s.monthlyCount and r.cc == s.chainCount and r.ver == s.snapVer) {
        val amount = if (s.excluded.get(m)) 0 else Need
        s.with("phase", s.phase.set(m, "created")).with("read", s.read.set(m, NoRead))
          .with("outstanding", s.outstanding + amount)
          .with("monthlyCount", s.monthlyCount + (if (amount > 0) 1 else 0))
          .with("overcommitted", s.overcommitted or (s.snapLagging and amount > 0))
      } else s.with("read", s.read.set(m, NoRead)) } }
  action step = any { load, cutoff, disable, pause, ban, deposit, refresh, reserve,
    nondet m = Months.oneOf()
    nondet t = Set("owner", "automatic").oneOf()
    any { freeze(m, t), check(m), write(m) }, s' = s }
  val invariant = all {
    Months.forall(m => s.read.get(m).ok implies s.phase.get(m) == "frozen"),
    s.chainFree >= 0, s.outstanding <= 2 * Need,
    s.monthlyCount <= 2,
    // Obligations exist only for created months.
    s.outstanding + s.chainCount * Need >= s.monthlyCount * Need - s.chainCount * Need,
    s.monthlyCount <= Months.filter(m => s.phase.get(m) == "created").size(),
    // Every unreserved promise is fundable, unless a creation used a
    // snapshot older than a recorded reservation (contract still refuses).
    s.outstanding <= s.chainFree or s.overcommitted }
  run underfundedWaitTest = init.then(load).then(cutoff).then(freeze(1, "automatic")).then(check(1).fail())
  run settingsRaceTest = init.then(load).then(cutoff).then(disable).then(freeze(1, "automatic").fail())
  run ownerFreezeIgnoresAutomaticTest = init.then(load).then(cutoff).then(disable).then(freeze(1, "owner"))
    .expect(s.phase.get(1) == "frozen" and invariant)
  run openMonthRefusedTest = init.then(load).then(freeze(1, "owner").fail())
  run registryRaceTest = init.then(load).then(cutoff).then(pause).then(freeze(1, "owner").fail())
  run fundedBanDoesNotEraseTest = init.then(load).then(cutoff).then(freeze(1, "automatic")).then(deposit)
    .then(refresh).then(check(1)).then(write(1)).then(ban)
    .expect(s.phase.get(1) == "created" and s.outstanding == Need and s.banned and invariant)
  run bannedBeforeCreationExcludedTest = init.then(load).then(cutoff).then(freeze(1, "owner")).then(ban)
    .then(check(1)).then(write(1)).expect(s.phase.get(1) == "created" and s.outstanding == 0 and invariant)
  // Two months read the same snapshot; the second write misses the count CAS.
  run concurrentMonthsFencedTest = init.then(load).then(cutoff).then(freeze(1, "owner"))
    .then(freeze(2, "automatic")).then(deposit).then(refresh).then(check(1)).then(check(2))
    .then(write(1)).then(write(2))
    .expect(s.phase.get(1) == "created" and s.phase.get(2) == "frozen" and s.outstanding == Need and invariant)
  // The retry counts month 1 as outstanding and waits for more funds.
  run secondMonthNeedsBothTest = init.then(load).then(cutoff).then(freeze(1, "owner"))
    .then(freeze(2, "owner")).then(deposit).then(refresh).then(check(1)).then(write(1))
    .expect(needOf(s, 2) > s.snapFree).then(deposit).then(refresh).then(check(2)).then(write(2))
    .expect(s.outstanding == 2 * Need and s.chainFree == 4 and not(s.overcommitted) and invariant)
  // A refresh between check and write misses the snapshot CAS.
  run refreshedSnapshotMissesTest = init.then(load).then(cutoff).then(freeze(1, "owner")).then(deposit)
    .then(refresh).then(check(1)).then(deposit).then(refresh).then(write(1))
    .expect(s.phase.get(1) == "frozen" and s.outstanding == 0 and invariant)
  // Snapshot lag: month 1 is reserved on chain, the snapshot still shows its
  // funds, and month 2 is admitted. The chain refuses the reservation.
  run staleSnapshotOvercommitTest = init.then(load).then(cutoff).then(freeze(1, "owner"))
    .then(freeze(2, "owner")).then(deposit).then(refresh).then(check(1)).then(write(1))
    .then(reserve).then(check(2)).then(write(2))
    .expect(s.overcommitted and s.outstanding == Need and s.chainFree == 0 and invariant)
    .then(reserve.fail())
}
