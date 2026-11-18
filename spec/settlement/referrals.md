# Deferred referral program

PRD section 11 preserves the referral program and its recorded reactivation approval. Launch leaves accrual off and posting disabled. Reactivation permits dry-run only until token, funding, watcher and owner posting activation are established. Source models include `referral_control_plane`, `referral_accrual`, `referral_posting`, `referral_root_history` and `referral_distribution`. These specifications retain deferred behavior without authorizing live operations.

## Story: Require every activation prerequisite

### Program configuration starts off and posting requires independent activation

The funding line is the passed governance proposal's finalized transfer of
exactly 2,000,000 program tokens, the whole-root growth limit; each project
has a lifetime cap of 250,000 program tokens. Both limits are defined here
once and used by accrual, publication and the distributor. The funding
evidence names the proposal, its outcome and the finalized transaction. The root watcher must be operated by
someone other than the root poster. The owner can return the program to off
at any time; that stops accrual and posting and preserves history.

```quint
type ReferralMode = Off | DryRun | Posting
type ProposalOutcome = ProposalPassed | ProposalFailed | ProposalPending
type FundingEvidence = { amount: int, proposal: str, outcome: ProposalOutcome, transaction: str, finalizedBlock: int }
type WatcherEvidence = { operator: str, heartbeatBlock: int }
pure val referralPoolTokens = 2000000
pure val referralProjectTokens = 250000
type Referral = { mode: ReferralMode, reactivationApproved: bool, tokenExists: bool,
  fundingFinalized: bool, watcherOperating: bool, poster: str, watcher: str, activations: int }
pure val initial: Referral = { mode: Off, reactivationApproved: true, tokenExists: true,
  fundingFinalized: false, watcherOperating: false, poster: "poster", watcher: "", activations: 0 }
pure def canDryRun(r: Referral, by: str): bool = r.mode == Off and r.reactivationApproved and by == "owner"
pure def dryRun(r: Referral, by: str): Referral = { ...r, mode: DryRun }
pure def canRecordFunding(r: Referral, funding: FundingEvidence, by: str): bool =
  by == "owner" and r.mode != Posting and not(r.fundingFinalized) and funding.amount == referralPoolTokens and funding.proposal != ""
    and funding.outcome == ProposalPassed and funding.transaction != "" and funding.finalizedBlock > 0
pure def recordFunding(r: Referral, funding: FundingEvidence, by: str): Referral = { ...r, fundingFinalized: true }
pure def canStartWatcher(r: Referral, watcher: WatcherEvidence, by: str): bool =
  by == "owner" and r.mode != Posting and watcher.operator != "" and watcher.operator != r.poster and watcher.heartbeatBlock > 0
pure def startWatcher(r: Referral, watcher: WatcherEvidence, by: str): Referral = { ...r, watcherOperating: true, watcher: watcher.operator }
pure def canActivate(r: Referral, by: str): bool = r.mode == DryRun and by == "owner"
  and r.reactivationApproved and r.tokenExists and r.fundingFinalized and r.watcherOperating
pure def activate(r: Referral, by: str): Referral = { ...r, mode: Posting, activations: r.activations + 1 }
pure def canDeactivate(r: Referral, by: str): bool = r.mode != Off and by == "owner"
pure def deactivate(r: Referral, by: str): Referral = { ...r, mode: Off }
pure val byValues = Set("owner", "wrong")
pure val fundingValues = Set({ amount: 2000000, proposal: "p1", outcome: ProposalPassed, transaction: "t", finalizedBlock: 5 },
  { amount: 2000000, proposal: "p1", outcome: ProposalPending, transaction: "t", finalizedBlock: 5 },
  { amount: 3, proposal: "p1", outcome: ProposalPassed, transaction: "t", finalizedBlock: 5 },
  { amount: 2000000, proposal: "p1", outcome: ProposalPassed, transaction: "t", finalizedBlock: 0 })
pure val watcherValues = Set({ operator: "watcher", heartbeatBlock: 3 }, { operator: "poster", heartbeatBlock: 3 })
```

### Posting requires every recorded activation fact

Accrual records live in [the accrual ledger](./referralAccrual.md). Root history,
claims and uncertain posting attempts live in [root publication](./referralPublication.md).
This control machine owns activation only and cannot itself issue a root or payment.
Nothing posts on any network outside Posting: a dry run files and posts
nothing (development `workers/referral-accrual/index.ts`: `dry_run` never
loads the poster key), and Posting uses the one configured network,
`REFERRAL_POST_NETWORK`, Robinhood Chain mainnet in the production
configuration.

```quint
pure def alwaysActivationReady(r: Referral): bool = r.mode == Posting implies
  r.reactivationApproved and r.tokenExists and r.fundingFinalized and r.watcherOperating and r.watcher != r.poster
type PostingNetwork = RobinhoodTestnet | RobinhoodMainnet
pure def mayPostOn(r: Referral, network: PostingNetwork): bool = r.mode == Posting
pure def alwaysWatcherIndependent(r: Referral): bool = r.watcherOperating implies r.watcher != "" and r.watcher != r.poster
pure def alwaysMainnetOnlyWhenPosting(r: Referral): bool = mayPostOn(r, RobinhoodMainnet) implies r.mode == Posting
pure def sometimesDeactivatedAfterPosting(r: Referral): bool = r.mode == Off and r.activations > 0
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
