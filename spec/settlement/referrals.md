# Deferred referral program

PRD section 11 preserves the referral program and its recorded reactivation approval. Launch leaves accrual off and posting disabled. Reactivation permits dry-run only until token, funding, watcher and owner posting activation are established. Source models include `referral_control_plane`, `referral_accrual`, `referral_posting`, `referral_root_history` and `referral_distribution`. These specifications retain deferred behavior without authorizing live operations.

## Story: Require every activation prerequisite

### Program configuration starts off and posting requires independent activation

The funding line is the passed governance proposal's finalized transfer of
exactly 2,000,000 program tokens; its evidence names the proposal, its
outcome and the finalized transaction. The root watcher must be operated by
someone other than the root poster. The owner can return the program to off
at any time; that stops accrual and posting and preserves history.

```quint
import money as M from "./money"
type ReferralMode = Off | DryRun | Posting
type ProposalOutcome = ProposalPassed | ProposalFailed | ProposalPending
type FundingEvidence = { amount: M::Amount, proposal: str, outcome: ProposalOutcome, transaction: str, finalizedBlock: int }
type WatcherEvidence = { operator: str, heartbeatBlock: int }
type Referral = { mode: ReferralMode, reactivationApproved: bool, tokenExists: bool, tokenUnit: M::Amount,
  fundingFinalized: bool, watcherOperating: bool, poster: str, watcher: str, activations: int }
pure val initial: Referral = { mode: Off, reactivationApproved: true, tokenExists: true, tokenUnit: verifiedTokenUnit,
  fundingFinalized: false, watcherOperating: false, poster: "poster", watcher: "", activations: 0 }
pure def canDryRun(r: Referral, by: str): bool = r.mode == Off and r.reactivationApproved and by == "owner"
pure def dryRun(r: Referral, by: str): Referral = { ...r, mode: DryRun }
pure def canRecordFunding(r: Referral, funding: FundingEvidence): bool =
  r.mode != Posting and not(r.fundingFinalized) and fundingLineMet(funding.amount, r.tokenUnit) and funding.proposal != ""
    and funding.outcome == ProposalPassed and funding.transaction != "" and funding.finalizedBlock > 0
pure def recordFunding(r: Referral, funding: FundingEvidence): Referral = { ...r, fundingFinalized: true }
pure def canStartWatcher(r: Referral, watcher: WatcherEvidence): bool =
  r.mode != Posting and watcher.operator != "" and watcher.operator != r.poster and watcher.heartbeatBlock > 0
pure def startWatcher(r: Referral, watcher: WatcherEvidence): Referral = { ...r, watcherOperating: true, watcher: watcher.operator }
pure def canActivate(r: Referral, by: str): bool = r.mode == DryRun and by == "owner"
  and r.reactivationApproved and r.tokenExists and r.fundingFinalized and r.watcherOperating
pure def activate(r: Referral, by: str): Referral = { ...r, mode: Posting, activations: r.activations + 1 }
pure def canDeactivate(r: Referral, by: str): bool = r.mode != Off and by == "owner"
pure def deactivate(r: Referral, by: str): Referral = { ...r, mode: Off }
pure val byValues = Set("owner", "wrong")
pure val fullFunding: M::Amount = List(0, 0, 0, 0, 0, 0, 0, 0, 2)
pure val fundingValues = Set({ amount: fullFunding, proposal: "p1", outcome: ProposalPassed, transaction: "t", finalizedBlock: 5 },
  { amount: fullFunding, proposal: "p1", outcome: ProposalPending, transaction: "t", finalizedBlock: 5 },
  { amount: List(0, 0, 2), proposal: "p1", outcome: ProposalPassed, transaction: "t", finalizedBlock: 5 },
  { amount: List(0, 0, 0, 0, 2), proposal: "p1", outcome: ProposalPassed, transaction: "t", finalizedBlock: 5 },
  { amount: fullFunding, proposal: "p1", outcome: ProposalPassed, transaction: "t", finalizedBlock: 0 })
pure val watcherValues = Set({ operator: "watcher", heartbeatBlock: 3 }, { operator: "poster", heartbeatBlock: 3 })
```

### Recorded funding is exactly 2,000,000 program tokens in the verified token's base units

One program token is `tokenUnit` base units. The control state pins it,
never the funding evidence: the program token is configured with 18 decimals
(`workers/referral-accrual/wrangler.toml`, `REFERRAL_TOKEN_DECIMALS`), so the
unit is 10^18, the same unit the [accrual ledger](./referralAccrual.md)
configures from the verified token. That figure is a configuration value;
confirming it against the deployed token contract's `decimals()` is part of
the acceptance evidence. The finalized transfer must move exactly 2,000,000
whole tokens, which is `tokenUnit × 2,000,000` = 2 × 10^24 base units, the
same pool cap that [root publication](./referralPublication.md) enforces. A
transfer of 2,000,000 base units, or of any other amount, is refused, and a
base-unit amount is never compared with a count of whole tokens.

```quint
pure val fundingTokens = 2000000
pure val verifiedTokenUnit: M::Amount = List(0, 0, 0, 0, 0, 0, 1)
pure def fundingLineMet(amount: M::Amount, tokenUnit: M::Amount): bool =
  M::validAmount(amount) and M::validAmount(tokenUnit) and M::positiveAmount(tokenUnit)
    and M::equalAmounts(amount, M::multiplyAmounts(tokenUnit, M::smallAmount(fundingTokens)))
pure def alwaysTokenUnitPinned(r: Referral): bool = M::equalAmounts(r.tokenUnit, verifiedTokenUnit)
```

### Posting requires every recorded activation fact

Accrual records live in [the accrual ledger](./referralAccrual.md). Root history,
claims and uncertain posting attempts live in [root publication](./referralPublication.md).
This control machine owns activation only and cannot itself issue a root or payment.

```quint
pure def alwaysActivationReady(r: Referral): bool = r.mode == Posting implies
  r.reactivationApproved and r.tokenExists and r.fundingFinalized and r.watcherOperating and r.watcher != r.poster
type PostingNetwork = RobinhoodTestnet | RobinhoodMainnet
pure def mayPostOn(r: Referral, network: PostingNetwork): bool =
  if (network == RobinhoodTestnet) r.mode != Off else r.mode == Posting
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

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val dayWeiValues = Set(0, 1, 2)
pure val transactionWeiValues = Set(0, 1, 2)
```
