// @source migrations/0086_referral_accruals.sql
// @source workers/referral-accrual/core.ts
// @source workers/referral-accrual/store.ts
// @source workers/referral-accrual/config.ts
// @source backend/referrals/handler.ts
// referral-accrual/core.ts/store.ts. Program remains off until separate approval.
module referral_accrual {
  type S = { mode: str, lease: bool, filed: bool, seen: Set[int], accrued: int, pinnedWallet: int }
  var s: S
  action init = s' = { mode: "off", lease: false, filed: false, seen: Set(), accrued: 0, pinnedWallet: 0 }
  action configure(mode: str): bool = all { not(s.filed), s' = s.with("mode", mode) }
  action acquire = all { s.mode != "off", s' = s.with("lease", true) }
  action accrue(id: int, eligible: bool): bool = all { s.lease, not(s.filed), not(s.seen.contains(id)),
    s' = s.with("seen", s.seen.union(Set(id))).with("accrued", if (eligible and s.accrued < 2) s.accrued + 1 else s.accrued) }
  action file(wallet: int): bool = all { s.lease, not(s.filed), s.mode != "off",
    s' = s.with("filed", true).with("pinnedWallet", wallet) }
  action step = any { configure("off"), configure("dry_run"), configure("live"), acquire,
    accrue(1, true), accrue(2, true), accrue(3, false), file(0), file(1), s' = s }
  val invariant = all { s.accrued <= 2, s.accrued <= s.seen.size(), s.filed implies s.mode != "off" }
  run offRefusedTest = init.then(acquire.fail())
  run duplicateAccrualTest = init.then(configure("dry_run")).then(acquire).then(accrue(1, true)).then(accrue(1, true).fail())
  run holdNoCreditTest = init.then(configure("dry_run")).then(acquire).then(accrue(3, false)).then(file(0)).expect(s.accrued == 0 and invariant)
}
// @source workers/referral-accrual/dry-run.ts
