// @source src/VaultMonthLock.tsx
// @source src/lib/evm-month-lock.ts
// @source src/EscrowFunding.tsx
// @source src/VaultActions.tsx
// @source src/lib/solana-month-lock.ts
// @source src/lib/month-lock.ts
// @evidence src/lib/evm-month-lock.test.ts
// The owner's month lock on an upgraded EVM vault (operator decision,
// 15 November 2026). The form shows only for a vault whose cached read says
// it supports pledges. A review refuses a non-owner wallet, an amount below
// the monthly amount, a lock below an existing one, locked funds the free
// balance cannot cover, and a deposit with a wallet that cannot batch it.
// A sent lock is checked automatically: a failed transaction locks nothing,
// a successful one waits for the finalized read to show the locked months.
// A withdrawal into locked funds is refused before the wallet is asked; the
// page's own guard applies only to a vault without pledge support. A lock
// whose month was never reserved and whose window closed stays locked and
// listed until a release is sent; any connected wallet may send it.
module ui_vault_month_lock {
  var s: { supported: bool, owner: bool, amount: int, minimum: int,
    existing: int, free: int, locked: int, deposit: int, batches: bool,
    phase: str, shownLocked: int, refused: str, lapsed: int }
  action start(supported: bool, owner: bool, amount: int, existing: int,
    free: int, deposit: int, batches: bool): bool = s' = { supported: supported,
    owner: owner, amount: amount, minimum: 2, existing: existing, free: free,
    locked: existing, deposit: deposit, batches: batches, phase: "idle",
    shownLocked: existing, refused: "none", lapsed: 0 }
  action init = {
    nondet sup = Bool.oneOf()
    nondet own = Bool.oneOf()
    nondet amount = 0.to(4).oneOf()
    nondet existing = 0.to(3).oneOf()
    nondet free = 0.to(6).oneOf()
    nondet deposit = 0.to(2).oneOf()
    nondet batches = Bool.oneOf()
    start(sup, own, amount, existing, free, deposit, batches)
  }
  pure def added(amount: int, existing: int): int = if (amount > existing) amount - existing else 0
  action review = all {
    s.supported, s.phase == "idle",
    if (not(s.owner)) s' = s.with("refused", "owner")
    else if (s.amount < s.minimum) s' = s.with("refused", "minimum")
    else if (s.existing > s.amount) s' = s.with("refused", "lower")
    else if (s.free + s.deposit < s.locked + added(s.amount, s.existing)) s' = s.with("refused", "funds")
    else if (s.deposit > 0 and not(s.batches)) s' = s.with("refused", "batch")
    else s' = s.with("phase", "reviewed").with("refused", "none"),
  }
  action send = all { s.phase == "reviewed", s' = s.with("phase", "sent") }
  action chainFails = all { s.phase == "sent", s' = s.with("phase", "idle") }
  action chainIncludes = all { s.phase == "sent",
    s' = s.with("phase", "included")
      .with("locked", s.locked + added(s.amount, s.existing))
      .with("existing", if (s.amount > s.existing) s.amount else s.existing)
      .with("free", s.free + s.deposit).with("deposit", 0) }
  action finalizedRead = all { s.phase == "included",
    s' = s.with("phase", "idle").with("shownLocked", s.locked) }
  // Part of the locked funds belongs to a month whose window closed unpaid.
  action lapse(n: int): bool = all { s.phase == "idle", n <= s.locked - s.lapsed,
    s' = s.with("lapsed", s.lapsed + n) }
  action release = all { s.supported, s.phase == "idle", s.lapsed > 0,
    s' = s.with("locked", s.locked - s.lapsed).with("lapsed", 0)
      .with("shownLocked", s.locked - s.lapsed) }
  action step = any { review, send, chainFails, chainIncludes, finalizedRead,
    release, nondet n = 1.to(2).oneOf() lapse(n) }
  val invariant = all {
    s.locked <= s.free or s.phase == "idle" or s.phase == "reviewed" or s.phase == "sent",
    (s.phase != "idle") implies (s.supported and s.owner and s.amount >= s.minimum),
    s.shownLocked <= s.locked,
    s.lapsed <= s.locked,
  }
  run unsupportedVaultHasNoFormTest = start(false, true, 2, 0, 4, 0, true).then(review.fail())
  run ownerLocksTheMonthTest = start(true, true, 2, 0, 4, 0, true)
    .then(review).then(send).then(chainIncludes).then(finalizedRead)
    .expect(s.shownLocked == 2 and invariant)
  run belowTheMonthlyAmountIsRefusedTest = start(true, true, 1, 0, 4, 0, true)
    .then(review).expect(s.refused == "minimum" and s.phase == "idle")
  run aLockIsNeverLoweredTest = start(true, true, 2, 3, 6, 0, true)
    .then(review).expect(s.refused == "lower")
  run depositWithoutBatchIsRefusedTest = start(true, true, 2, 0, 0, 2, false)
    .then(review).expect(s.refused == "batch")
  run depositAndLockTogetherTest = start(true, true, 2, 0, 0, 2, true)
    .then(review).then(send).then(chainIncludes)
    .expect(s.locked == 2 and s.free == 2 and invariant)
  run lapsedLockIsReleasedTest = start(true, true, 2, 0, 4, 0, true)
    .then(review).then(send).then(chainIncludes).then(finalizedRead)
    .then(lapse(2)).then(release)
    .expect(s.locked == 0 and s.shownLocked == 0 and invariant)
  run failedLockLocksNothingTest = start(true, true, 2, 0, 4, 0, true)
    .then(review).then(send).then(chainFails)
    .expect(s.locked == 0 and invariant)
}
