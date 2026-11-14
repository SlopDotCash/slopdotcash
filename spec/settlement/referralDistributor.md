# Referral distributor contract

This specification owns the on-chain state separately from the publication
Worker. It follows the pinned
[`ReferralDistributor.sol`](https://github.com/SlopDotCash/slopdotcash/blob/6b3b9d0b979f0608d87941f1146056a98513ffcf/contracts/evm/src/ReferralDistributor.sol)
(lines 103–118, 151–166, 202–239, 251–319) and PRD section 11. It does not
activate the deferred program. Token balances use arbitrary-length base units.
The token adapter must prove exact transfers and the fixed canonical token;
the Merkle adapter verifies the double-hashed account/cumulative leaf with
sorted-pair proofs. A boolean supplied by a request is never such evidence.

## Story: Keep owner and poster authority separate

### Deployment fixes token, growth cap and spacing, with distinct owner and poster

The contract permits a positive deployment growth cap. Production admission
separately requires the approved cap of 2,000,000 tokens and the reviewed
spacing. Configuration here represents immutable constructor arguments.
Times are block timestamps in seconds. The rescue delay is 365 days; a root
has no claim delay.

```quint
import money as M from "./money"
type SequenceCheck = { next: int, valid: bool }
pure val emptySequenceCheck: SequenceCheck = { next: 0, valid: true }
type Epoch = { index: int, root: str, total: M::Amount, postedAt: int, voided: bool }
type AddressClaim = { wallet: str, cumulative: M::Amount }
type Distributor = { configured: bool, token: str, tokenUnit: M::Amount, epochCap: M::Amount,
  postSpacing: int, owner: str, pendingOwner: str, poster: str, paused: bool,
  now: int, deployedAt: int, lastUnpausedAt: int, epochs: List[Epoch], latestRootClaimed: bool,
  claims: List[AddressClaim], balance: M::Amount, deposited: M::Amount, paid: M::Amount,
  rescued: M::Amount, depositReceipts: List[int] }
pure val rescueDelay = 365 * 24 * 60 * 60
pure val emptyEpoch: Epoch = { index: -1, root: "", total: M::zero, postedAt: 0, voided: true }
pure val initial: Distributor = { configured: false, token: "", tokenUnit: M::zero, epochCap: M::zero,
  postSpacing: 0, owner: "", pendingOwner: "", poster: "", paused: false,
  now: 0, deployedAt: 0, lastUnpausedAt: 0, epochs: List(), latestRootClaimed: false,
  claims: List(), balance: M::zero, deposited: M::zero, paid: M::zero, rescued: M::zero, depositReceipts: List() }
pure def canDeploy(d: Distributor, token: str, tokenUnit: M::Amount, cap: M::Amount,
  spacing: int, owner: str, poster: str, timestamp: int): bool = not(d.configured)
    and token != "" and owner != "" and poster != "" and owner != poster
    and M::validAmount(tokenUnit) and M::positiveAmount(tokenUnit) and M::validAmount(cap) and M::positiveAmount(cap)
    and spacing >= 0 and spacing <= rescueDelay and timestamp > 0
pure def deploy(d: Distributor, token: str, tokenUnit: M::Amount, cap: M::Amount,
  spacing: int, owner: str, poster: str, timestamp: int): Distributor =
  { ...d, configured: true, token: token, tokenUnit: tokenUnit, epochCap: cap, postSpacing: spacing,
    owner: owner, poster: poster, now: timestamp, deployedAt: timestamp, lastUnpausedAt: timestamp }
pure def approvedGrowthCap(d: Distributor): bool = M::equalAmounts(d.epochCap, M::multiplyAmounts(d.tokenUnit, M::smallAmount(2000000)))
pure def canTick(d: Distributor, timestamp: int): bool = d.configured and timestamp > d.now
pure def tick(d: Distributor, timestamp: int): Distributor = { ...d, now: timestamp }
```

### Ownership transfer is accepted by the pending owner and never merges signer roles

A zero pending owner cancels a transfer. A new poster is neither the owner nor
the pending owner. Rotating the poster does not change roots, paid claims,
spacing or the rescue clock.

```quint
pure def canTransferOwnership(d: Distributor, newOwner: str, by: str): bool = d.configured and by == d.owner and newOwner != d.poster
pure def transferOwnership(d: Distributor, newOwner: str, by: str): Distributor = { ...d, pendingOwner: newOwner }
pure def canAcceptOwnership(d: Distributor, by: str): bool = d.configured and d.pendingOwner != "" and by == d.pendingOwner
pure def acceptOwnership(d: Distributor, by: str): Distributor = { ...d, owner: by, pendingOwner: "" }
pure def canSetPoster(d: Distributor, newPoster: str, by: str): bool = d.configured and by == d.owner
  and newPoster != "" and newPoster != d.owner and newPoster != d.pendingOwner
pure def setPoster(d: Distributor, newPoster: str, by: str): Distributor = { ...d, poster: newPoster }
pure def canPause(d: Distributor, by: str): bool = d.configured and by == d.owner and not(d.paused)
pure def pause(d: Distributor, by: str): Distributor = { ...d, paused: true }
pure def canUnpause(d: Distributor, by: str): bool = d.configured and by == d.owner and d.paused
pure def unpause(d: Distributor, by: str): Distributor = { ...d, paused: false, lastUnpausedAt: d.now }
```

## Story: Admit funded roots at sequential epochs

### Only exact token deposits increase the balance

This observation represents finalized token transfers to the distributor,
including deposits made outside its own interface. The adapter deduplicates
the exact transfer log, verifies token identity and observes the complete
balance change. A pledge or mismatched asset adds nothing.

```quint
pure def canDeposit(d: Distributor, amount: M::Amount, token: str, receipt: int, finalized: bool): bool =
  d.configured and token == d.token and receipt > 0 and not(d.depositReceipts.includes(receipt))
    and finalized and M::validAmount(amount) and M::positiveAmount(amount)
pure def deposit(d: Distributor, amount: M::Amount, token: str, receipt: int, finalized: bool): Distributor =
  { ...d, balance: M::addAmounts(d.balance, amount), deposited: M::addAmounts(d.deposited, amount), depositReceipts: d.depositReceipts.append(receipt) }
pure def liveRoot(d: Distributor): Epoch = d.epochs.foldl(emptyEpoch,
  (selected, epoch) => if (not(epoch.voided)) epoch else selected)
pure def highWater(d: Distributor): M::Amount = d.epochs.foldl(M::zero,
  (highest, epoch) => if (not(epoch.voided) and M::compareAmounts(epoch.total, highest) > 0) epoch.total else highest)
pure def canPostRoot(d: Distributor, index: int, root: str, total: M::Amount, by: str): bool =
  d.configured and not(d.paused) and by == d.poster and index == d.epochs.length() and root != ""
    and M::validAmount(total) and M::compareAmounts(total, d.paid) >= 0
    and M::compareAmounts(total, M::addAmounts(highWater(d), d.epochCap)) <= 0
    and M::compareAmounts(M::addAmounts(d.balance, d.paid), total) >= 0
    and (liveRoot(d).index < 0 or d.now >= liveRoot(d).postedAt + d.postSpacing)
pure def postRoot(d: Distributor, index: int, root: str, total: M::Amount, by: str): Distributor =
  { ...d, epochs: d.epochs.append({ index: index, root: root, total: total, postedAt: d.now, voided: false }), latestRootClaimed: false }
```

### Voiding the latest unclaimed epoch restores prior live spacing and high water

Only the owner may void, and only the latest epoch before any successful
claim after its posting. Voided epochs retain their original indices and
posting timestamps. Views select the latest nonvoided epoch. The next index
is the complete history length, including voided slots.

```quint
pure def canVoidLast(d: Distributor, index: int, by: str): bool = d.configured and by == d.owner
  and d.epochs.length() > 0 and index == d.epochs.length() - 1
  and not(d.epochs.nthOr(index, emptyEpoch).voided) and not(d.latestRootClaimed)
pure def voidLast(d: Distributor, index: int, by: str): Distributor =
  { ...d, epochs: d.epochs.listMap(epoch => if (epoch.index == index) { ...epoch, voided: true } else epoch) }
```

## Story: Claim only the unpaid cumulative difference

### The wallet signs a valid active-root claim and receives its exact difference

The caller address is the Merkle leaf address. Transfers and state changes
are atomic: a failed, false-returning or inexact token transfer reverts. The
sum of claims cannot exceed the active declared total. The token's balance
must cover the transfer. Already paid cumulative amounts survive roots,
voids, pauses and key rotation.

```quint
pure def claimedBy(d: Distributor, wallet: str): M::Amount = d.claims.foldl(M::zero,
  (selected, claim) => if (claim.wallet == wallet) claim.cumulative else selected)
pure def claimDifference(d: Distributor, wallet: str, cumulative: M::Amount): M::Amount =
  M::subtractAmounts(cumulative, claimedBy(d, wallet))
pure def rawClaimable(d: Distributor, wallet: str, cumulative: M::Amount, proofRoot: str, verified: bool): M::Amount =
  if (liveRoot(d).index >= 0 and liveRoot(d).root == proofRoot and verified
    and M::validAmount(cumulative) and M::compareAmounts(cumulative, claimedBy(d, wallet)) > 0
    and M::compareAmounts(M::addAmounts(d.paid, claimDifference(d, wallet, cumulative)), liveRoot(d).total) <= 0)
    claimDifference(d, wallet, cumulative) else M::zero
pure def canClaim(d: Distributor, wallet: str, cumulative: M::Amount, proofRoot: str,
  verified: bool, transferExact: bool, by: str): bool = d.configured and not(d.paused)
    and wallet != "" and by == wallet and M::validAmount(cumulative)
    and M::positiveAmount(rawClaimable(d, wallet, cumulative, proofRoot, verified))
    and M::compareAmounts(d.balance, claimDifference(d, wallet, cumulative)) >= 0 and transferExact
pure def claim(d: Distributor, wallet: str, cumulative: M::Amount, proofRoot: str,
  verified: bool, transferExact: bool, by: str): Distributor =
  val amount = claimDifference(d, wallet, cumulative)
  { ...d, balance: M::subtractAmounts(d.balance, amount), paid: M::addAmounts(d.paid, amount), latestRootClaimed: true,
    claims: d.claims.select(old => old.wallet != wallet).append({ wallet: wallet, cumulative: cumulative }) }
```

### Rescue waits a full year after every post and unpause, even after a void

The owner may rescue the entire remaining balance to a nonzero destination
only when the contract is unpaused and the rescue timestamp has arrived.
Voiding a recent root cannot shorten the delay. A zero balance needs no token
transfer. A failed transfer reverts. Rescue does not erase claims or roots;
later claim execution can fail for lack of balance. The raw contract
`claimable` view checks proof and declared total, not pause or token balance,
so the product must distinguish that estimate from present execution readiness.

```quint
pure def rescueAvailableAt(d: Distributor): int =
  val latestPost = d.epochs.foldl(d.deployedAt, (latest, epoch) => if (epoch.postedAt > latest) epoch.postedAt else latest)
  (if (latestPost > d.lastUnpausedAt) latestPost else d.lastUnpausedAt) + rescueDelay
pure def canRescue(d: Distributor, destination: str, transferExact: bool, by: str): bool =
  d.configured and not(d.paused) and by == d.owner and destination != "" and d.now >= rescueAvailableAt(d)
    and (not(M::positiveAmount(d.balance)) or transferExact)
pure def rescue(d: Distributor, destination: str, transferExact: bool, by: str): Distributor =
  { ...d, rescued: M::addAmounts(d.rescued, d.balance), balance: M::zero }
```

### Configuration, retained claims and complete balance accounting never change retroactively

```quint
pure def alwaysUnconfiguredEmpty(d: Distributor): bool = not(d.configured) implies
  d.owner == "" and d.pendingOwner == "" and d.poster == "" and d.token == ""
    and d.epochs.length() == 0 and d.claims.length() == 0 and d.depositReceipts.length() == 0
    and d.balance == M::zero and d.deposited == M::zero and d.paid == M::zero and d.rescued == M::zero
pure def alwaysTimeValid(d: Distributor): bool = d.configured implies d.deployedAt > 0
  and d.now >= d.deployedAt and d.lastUnpausedAt >= d.deployedAt and d.lastUnpausedAt <= d.now
    and d.postSpacing >= 0 and d.postSpacing <= rescueDelay
pure def alwaysEpochRecords(d: Distributor): bool = d.epochs.every(epoch => epoch.root != "" and M::validAmount(epoch.total))
pure def alwaysRolesSeparate(d: Distributor): bool = d.configured implies d.owner != "" and d.poster != ""
  and d.owner != d.poster and (d.pendingOwner == "" or d.pendingOwner != d.poster)
pure def alwaysMoneyValid(d: Distributor): bool = M::validAmount(d.balance) and M::validAmount(d.deposited)
  and M::validAmount(d.paid) and M::validAmount(d.rescued) and M::validAmount(d.epochCap)
  and d.claims.every(c => c.wallet != "" and M::validAmount(c.cumulative))
pure def alwaysConserved(d: Distributor): bool = M::equalAmounts(d.deposited,
  M::addAmounts(M::addAmounts(d.balance, d.paid), d.rescued))
pure def alwaysPaidMatchesClaims(d: Distributor): bool = M::equalAmounts(d.paid,
  d.claims.foldl(M::zero, (total, c) => M::addAmounts(total, c.cumulative)))
pure def alwaysUniqueClaims(d: Distributor): bool = d.claims.every(c => d.claims.select(other => other.wallet == c.wallet).length() == 1)
pure def alwaysSequentialEpochs(d: Distributor): bool =
  val checked = d.epochs.foldl(emptySequenceCheck, (acc, epoch) =>
    { next: acc.next + 1, valid: acc.valid and epoch.index == acc.next })
  checked.valid
pure def alwaysEpochTimes(d: Distributor): bool = d.epochs.every(epoch => epoch.postedAt >= d.deployedAt and epoch.postedAt <= d.now)
pure def stepConfigurationFixed(before: Distributor, after: Distributor): bool = before.configured implies
  after.configured and after.token == before.token and after.tokenUnit == before.tokenUnit
    and after.epochCap == before.epochCap and after.postSpacing == before.postSpacing and after.deployedAt == before.deployedAt
pure def stepClaimsRetained(before: Distributor, after: Distributor): bool = before.claims.every(c =>
  M::compareAmounts(claimedBy(after, c.wallet), c.cumulative) >= 0)
pure def sometimesClaimed(d: Distributor): bool = M::positiveAmount(d.paid)
pure def sometimesVoided(d: Distributor): bool = d.epochs.some(epoch => epoch.voided)
pure def sometimesRescued(d: Distributor): bool = M::positiveAmount(d.rescued)
```

### Simulation includes distinct roles, zero-based epochs and exact amounts

```quint
pure val tokenValues = Set("token", "wrong")
pure val tokenUnitValues = Set(List(1))
pure val capValues = Set(List(10), List(0, 0, 2))
pure val spacingValues = Set(0, 1)
pure val ownerValues = Set("owner", "poster", "")
pure val posterValues = Set("poster", "owner", "")
pure val newOwnerValues = Set("successor", "poster", "")
pure val newPosterValues = Set("nextPoster", "owner", "successor", "")
pure val byValues = Set("owner", "poster", "successor", "wallet", "wrong")
pure val timestampValues = Set(1, 2, 3, 31536001, 31536003)
pure val amountValues = Set(List(1), List(10))
pure val totalValues = Set(List(0), List(3), List(10), List(11))
pure val cumulativeValues = Set(List(0), List(3), List(10))
pure val indexValues = Set(0, 1, 2)
pure val receiptValues = Set(1, 2)
pure val rootValues = Set("root", "later", "")
pure val proofRootValues = Set("root", "later", "wrong")
pure val walletValues = Set("wallet", "wrong")
pure val destinationValues = Set("owner", "")
// These weights prioritize complete paths; all invalid values remain in the input sets.
pure val weight_deploy = 15
pure val weight_deposit = 20
pure val weight_postRoot = 25
pure val weight_claim = 30
pure val weight_voidLast = 15
pure val weight_tick = 15
pure val weight_rescue = 15
```
