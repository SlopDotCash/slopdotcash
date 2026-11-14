# Deferred referral program

PRD section 11 preserves the referral program and its recorded reactivation approval. Launch leaves accrual off and posting disabled. Reactivation permits dry-run only until token, funding, watcher and owner posting activation are established. Source models include `referral_control_plane`, `referral_accrual`, `referral_posting`, `referral_root_history` and `referral_distribution`. These specifications retain deferred behavior without authorizing live operations.

## Story: Require every activation prerequisite

### Program configuration starts off and posting requires independent activation

```quint
type ReferralMode = Off | DryRun | Posting
 type Referral = { mode: ReferralMode, reactivationApproved: bool, tokenExists: bool,
  fundingFinalized: bool, watcherOperating: bool }
pure val initial: Referral = { mode: Off, reactivationApproved: true, tokenExists: true,
  fundingFinalized: false, watcherOperating: false }
pure def canDryRun(r: Referral, by: str): bool = r.mode == Off and r.reactivationApproved and by == "owner"
pure def dryRun(r: Referral, by: str): Referral = { ...r, mode: DryRun }
pure def canRecordFunding(r: Referral, amount: int, proposalPassed: bool, finalized: bool): bool =
  r.mode != Posting and amount == 2000000 and proposalPassed and finalized
pure def recordFunding(r: Referral, amount: int, proposalPassed: bool, finalized: bool): Referral =
  { ...r, fundingFinalized: true }
pure def canStartWatcher(r: Referral, independent: bool): bool = r.mode != Posting and independent
pure def startWatcher(r: Referral, independent: bool): Referral = { ...r, watcherOperating: true }
pure def canActivate(r: Referral, by: str): bool = r.mode == DryRun and by == "owner"
  and r.reactivationApproved and r.tokenExists and r.fundingFinalized and r.watcherOperating
pure def activate(r: Referral, by: str): Referral = { ...r, mode: Posting }
pure val byValues = Set("owner", "wrong")
pure val amountValues = Set(1, 3, 2000000)
```

### Posting requires every recorded activation fact

Accrual records live in [the accrual ledger](./referralAccrual.md). Root history,
claims and uncertain posting attempts live in [root publication](./referralPublication.md).
This control machine owns activation only and cannot itself issue a root or payment.

```quint
pure def alwaysActivationReady(r: Referral): bool = r.mode == Posting implies
  r.reactivationApproved and r.tokenExists and r.fundingFinalized and r.watcherOperating
pure def sometimesDryRun(r: Referral): bool = r.mode == DryRun
pure def sometimesPosting(r: Referral): bool = r.mode == Posting
```

### Poster gas has transaction and UTC-day ceilings

The exact payout eligibility and calendar-anniversary rules live in the
[accrual ledger](./referralAccrual.md). Posting reserves no more than the
approved 0.0002 ETH per send and 0.002 ETH per UTC day.

```quint
pure def posterGasAllowed(transactionWei: int, dayWei: int): bool =
  transactionWei >= 0 and transactionWei <= 200000000000000
    and dayWei >= 0 and dayWei <= 2000000000000000
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val dayWeiValues = Set(0, 1, 2)
pure val transactionWeiValues = Set(0, 1, 2)
```
