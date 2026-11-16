# Slopbot provider budget blocks and resume

PRD section 5 makes every Orbio failure, including exhausted credits, go
directly to Surplus, and keeps a failed provider attempt distinct from an
item blocked until a budget reset. Source is
`workers/slopbot/budget-blocks.ts`, `workers/slopbot/review.ts`
(`activeBudgetBlock`, `recordBudgetBlock`) and
`migrations/0048_slopbot_budget_blocks.sql` at the pinned development
revision. The retained `bot_budget_resume` model covers the same resume.

This unit owns one review key's budget blocks, their single dispatch
records and the review row's status and claim as they bear on a block.
[Review claims](./reviewLease.md) own the full claim lifecycle and
[review](./review.md) owns the provider route. The
[installation](./installation.md) state is held here so that resume reads
it directly.

## Story: Block a review on a Surplus spending denial and resume it once

### Only the current claim owner records an immutable block

A block needs a recognized Surplus spending denial with a reset time later
than now. An Orbio failure never blocks: the route goes on to Surplus. The
database trigger requires the same running claim with a live lease and the
same installation, repository and item as the stored job. Recording the
block finishes the review as failed with the reason
`blocked: provider budget exhausted`, and clears its lease. One block exists
per review key and claim, and a new claim of the key makes the earlier block
history: only the current claim's block can resume. A block row and its
dispatch row are never updated, replaced or deleted. While the current claim's block is not yet
due, a new review job for the key returns `blocked` without a claim.

```quint
import installation as I from "./installation"
type RowStatus = NoRow | Running | Completed | Failed | Skipped
type DenialSource = OrbioFailure | SurplusSpendingDenial | SurplusOtherFailure
type Denial = { source: DenialSource, resetAt: int }
type Block = { id: int, token: int, retryAt: int, dispatched: bool }
type BudgetState = { now: int, status: RowStatus, token: int, leaseUntil: int, current: Block, blockCount: int,
  sends: int, install: I::Installation }
pure val noBlock: Block = { id: 0, token: 0, retryAt: 0, dispatched: false }
pure val initial: BudgetState = { now: 1, status: NoRow, token: 0, leaseUntil: 0, current: noBlock, blockCount: 0,
  sends: 0, install: I::initial }
pure def heldBack(s: BudgetState): bool = s.status == Failed and s.current.id > 0 and s.current.retryAt > s.now
pure def canElapse(s: BudgetState, seconds: int): bool = seconds > 0
pure def elapse(s: BudgetState, seconds: int): BudgetState = { ...s, now: s.now + seconds }
pure def canApplyInstallation(s: BudgetState, e: I::InstallEvent): bool = I::canDeliver(s.install, e)
pure def applyInstallation(s: BudgetState, e: I::InstallEvent): BudgetState = { ...s, install: I::deliver(s.install, e) }
pure def canClaim(s: BudgetState, token: int, leaseUntil: int): bool =
  token > s.token and leaseUntil > s.now and I::active(s.install) and not(heldBack(s))
    and (s.status == NoRow or s.status == Failed or s.status == Skipped or (s.status == Running and s.leaseUntil <= s.now))
pure def claim(s: BudgetState, token: int, leaseUntil: int): BudgetState =
  { ...s, status: Running, token: token, leaseUntil: leaseUntil, current: noBlock }
pure def owns(s: BudgetState, token: int): bool = s.status == Running and token == s.token and s.leaseUntil > s.now
pure def canFinish(s: BudgetState, token: int, status: RowStatus): bool =
  owns(s, token) and (status == Completed or status == Failed or status == Skipped)
pure def finish(s: BudgetState, token: int, status: RowStatus): BudgetState = { ...s, status: status, leaseUntil: 0 }
pure def blocksRoute(d: Denial): bool = d.source == SurplusSpendingDenial
pure def canRecordBlock(s: BudgetState, token: int, d: Denial): bool =
  owns(s, token) and blocksRoute(d) and d.resetAt > s.now and s.current.id == 0
pure def recordBlock(s: BudgetState, token: int, d: Denial): BudgetState =
  { ...s, status: Failed, leaseUntil: 0, blockCount: s.blockCount + 1,
    current: { id: s.blockCount + 1, token: token, retryAt: d.resetAt, dispatched: false } }
pure def lawOrbioFailureNeverBlocks(d: Denial): bool = d.source == OrbioFailure implies not(blocksRoute(d))
```

### A due block is sent once while its claim is still the failed current one

Every five-minute run selects at most 100 due blocks whose review is still
failed under the block's own claim, whose installation is active and that
have no dispatch record. It sends the stored identifier-only job first and
then writes the dispatch record. A lost record lets a later run send the
job again; the review claim and completed-revision check absorb the
duplicate. A later claim of the same key makes an older block obsolete.
Once a block is due and its installation active, the run eventually
records its dispatch unless a newer claim or a lost installation
intervenes.

```quint
pure def resumable(s: BudgetState): bool =
  s.current.id > 0 and not(s.current.dispatched) and s.current.retryAt <= s.now and s.status == Failed
    and s.current.token == s.token and I::active(s.install)
pure def canSendResume(s: BudgetState): bool = resumable(s)
pure def sendResume(s: BudgetState): BudgetState = { ...s, sends: s.sends + 1 }
pure def canRecordDispatch(s: BudgetState): bool = resumable(s)
pure def recordDispatch(s: BudgetState): BudgetState = { ...s, current: { ...s.current, dispatched: true } }
pure def alwaysClockAndClaims(s: BudgetState): bool = s.now >= 1 and s.token >= 0 and s.blockCount >= 0 and s.sends >= 0
pure def alwaysRunningHasLease(s: BudgetState): bool =
  (s.status == Running implies s.leaseUntil > 0 and s.token > 0) and (s.status != Running implies s.leaseUntil == 0)
pure def alwaysCurrentBlockFailedTheReview(s: BudgetState): bool =
  s.current.id > 0 implies (s.status == Failed and s.current.token == s.token and s.current.token > 0
    and s.current.retryAt > 0 and s.current.id == s.blockCount)
pure def stepBlocksImmutable(before: BudgetState, after: BudgetState): bool =
  after.blockCount >= before.blockCount and ((before.current.id > 0 and after.current.id == before.current.id) implies
    (after.current.token == before.current.token and after.current.retryAt == before.current.retryAt
      and (before.current.dispatched implies after.current.dispatched)))
pure def stepSendNeedsActiveInstallation(before: BudgetState, after: BudgetState): bool =
  after.sends > before.sends implies (I::active(before.install) and before.status == Failed and before.current.id > 0)
pure def stepNewClaimRetiresBlock(before: BudgetState, after: BudgetState): bool =
  after.token > before.token implies after.current.id == 0
pure def leadsToDueBlockIsDispatched(s: BudgetState, later: BudgetState): bool =
  resumable(s) implies (later.current.dispatched or later.token > s.token or not(I::active(later.install)))
pure val fair_recordDispatch = "weak"
pure def sometimesBlocked(s: BudgetState): bool = heldBack(s)
pure def sometimesResumed(s: BudgetState): bool = s.blockCount > 0 and s.sends > 0 and s.status == Running
pure def sometimesSuspendedBlockWaits(s: BudgetState): bool =
  s.current.id > 0 and not(s.current.dispatched) and s.current.retryAt <= s.now and s.install.suspended
pure def sometimesResentAfterLostRecord(s: BudgetState): bool = s.sends > 1
pure val dValues = Set({ source: SurplusSpendingDenial, resetAt: 100 }, { source: OrbioFailure, resetAt: 100 },
  { source: SurplusOtherFailure, resetAt: 100 })
pure val eValues = Set(
  { delivery: 1, kind: I::Created, sourceTime: 1, hasAccount: true, validTime: true },
  { delivery: 2, kind: I::Suspend, sourceTime: 2, hasAccount: true, validTime: true },
  { delivery: 3, kind: I::Unsuspend, sourceTime: 3, hasAccount: true, validTime: true })
pure val tokenValues = Set(1, 2, 3)
pure val leaseUntilValues = Set(50, 1300)
pure val secondsValues = Set(10, 100)
pure val statusValues = Set(Completed, Failed, Skipped)
pure val weight_claim = 4
pure val weight_recordBlock = 4
pure val weight_sendResume = 3
```
