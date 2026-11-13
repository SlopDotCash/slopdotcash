# Deferred referral program

PRD section 11 preserves the referral program and its recorded reactivation approval. Launch leaves accrual off and posting disabled. Reactivation permits dry-run only until token, funding, watcher and owner posting activation are established. Source models include `referral_control_plane`, `referral_accrual`, `referral_posting`, `referral_root_history` and `referral_distribution`. These specifications retain deferred behavior without authorizing live operations.

## Story: Require every activation prerequisite

### Program configuration starts off and posting requires independent activation

```quint
type ReferralMode = Off | DryRun | Posting
 type Referral = { mode: ReferralMode, reactivationApproved: bool, tokenExists: bool,
  fundingFinalized: bool, watcherOperating: bool, root: int, rootTotal: int,
  projectTotal: int, claimed: int, sealed: bool, voided: bool }
pure val initial: Referral = { mode: Off, reactivationApproved: true, tokenExists: true,
  fundingFinalized: false, watcherOperating: false, root: 0, rootTotal: 0,
  projectTotal: 0, claimed: 0, sealed: false, voided: false }
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

### Cumulative roots obey both pool caps and never reduce a paid total

This model represents one referred project and one recipient. Whole-program aggregation must compose independent project totals into the same two-million-token cap. Accrual eligibility is independently checked below. A root with a successful claim is sealed immediately.

```quint
pure def canPostRoot(r: Referral, root: int, amount: int): bool =
  r.mode == Posting and root > r.root and amount > 0
    and r.rootTotal + amount <= 2000000 and r.projectTotal + amount <= 250000
pure def postRoot(r: Referral, root: int, amount: int): Referral =
  { ...r, root: root, rootTotal: r.rootTotal + amount, projectTotal: r.projectTotal + amount,
    sealed: false, voided: false }
pure def canClaim(r: Referral, root: int, cumulative: int, walletMatches: bool): bool =
  r.mode == Posting and root == r.root and not(r.voided) and walletMatches
    and cumulative > r.claimed and cumulative <= r.rootTotal
pure def claim(r: Referral, root: int, cumulative: int, walletMatches: bool): Referral =
  { ...r, claimed: cumulative, sealed: true }
pure def canVoidRoot(r: Referral, root: int, by: str): bool =
  r.mode == Posting and root == r.root and r.root > 0 and not(r.sealed) and not(r.voided) and by == "owner"
pure def voidRoot(r: Referral, root: int, by: str): Referral = { ...r, voided: true }
pure def alwaysClaimBounded(r: Referral): bool = r.claimed >= 0 and r.claimed <= r.rootTotal
  and r.rootTotal <= 2000000 and r.projectTotal <= 250000
pure def alwaysActivationReady(r: Referral): bool = r.mode == Posting implies
  r.reactivationApproved and r.tokenExists and r.fundingFinalized and r.watcherOperating
pure def stepClaimsPermanent(before: Referral, after: Referral): bool = after.claimed >= before.claimed
pure def sometimesDryRun(r: Referral): bool = r.mode == DryRun
pure def sometimesClaimed(r: Referral): bool = r.claimed > 0
pure def sometimesVoided(r: Referral): bool = r.voided
```

### Eligibility uses finalized stablecoin payouts and immutable captured referrers

Team roles, bans, public holds, self-referrals and stale identity evidence refuse accrual. The first paid month begins a twelve-month eligibility window. The applied rate is retained with each filed record. Dry-run records never post roots.

```quint
pure def eligiblePayout(paid: bool, stablecoin: bool, month: int, firstPaidMonth: int,
  team: bool, banned: bool, held: bool, selfReferral: bool): bool =
  paid and stablecoin and month >= 0 and firstPaidMonth >= 0 and month >= firstPaidMonth
    and month - firstPaidMonth < 12 and not(team) and not(banned) and not(held) and not(selfReferral)
pure def posterGasAllowed(transactionWei: int, dayWei: int): bool =
  transactionWei >= 0 and transactionWei <= 200000000000000
    and dayWei >= 0 and dayWei <= 2000000000000000
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val cumulativeValues = Set(0, 1, 2)
pure val dayWeiValues = Set(0, 1, 2)
pure val firstPaidMonthValues = Set(0, 1, 2)
pure val monthValues = Set(0, 1, 2)
pure val rootValues = Set(0, 1, 2)
pure val transactionWeiValues = Set(0, 1, 2)
```
