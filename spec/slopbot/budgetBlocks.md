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
per review key and claim. A block row and its dispatch row are never
updated, replaced or deleted. While the current claim's block is not yet
due, a new review job for the key returns `blocked` without a claim.

```quint
import installation as I from "./installation"
type RowStatus = NoRow | Running | Completed | Failed | Skipped
type DenialSource = OrbioFailure | SurplusSpendingDenial | SurplusOtherFailure
type Denial = { source: DenialSource, resetAt: int }
type Block = { id: int, token: int, retryAt: int, dispatched: bool }
type BudgetState = { now: int, status: RowStatus, token: int, leaseUntil: int, blocks: List[Block],
  sends: int, install: I::Installation }
pure val initial: BudgetState = { now: 1, status: NoRow, token: 0, leaseUntil: 0, blocks: List(), sends: 0,
  install: I::initial }
pure val noBlock: Block = { id: 0, token: 0, retryAt: 0, dispatched: false }
pure def blockOf(s: BudgetState, blockId: int): Block = s.blocks.select(b => b.id == blockId).nthOr(0, noBlock)
pure def currentBlock(s: BudgetState): Block = s.blocks.select(b => b.token == s.token).nthOr(0, noBlock)
pure def heldBack(s: BudgetState): bool =
  s.status == Failed and currentBlock(s).id > 0 and currentBlock(s).retryAt > s.now
pure def canElapse(s: BudgetState, seconds: int): bool = seconds > 0
pure def elapse(s: BudgetState, seconds: int): BudgetState = { ...s, now: s.now + seconds }
pure def canApplyInstallation(s: BudgetState, e: I::InstallEvent): bool = I::canDeliver(s.install, e)
pure def applyInstallation(s: BudgetState, e: I::InstallEvent): BudgetState = { ...s, install: I::deliver(s.install, e) }
pure def canClaim(s: BudgetState, token: int, leaseUntil: int): bool =
  token > s.token and leaseUntil > s.now and I::active(s.install) and not(heldBack(s))
    and (s.status == NoRow or s.status == Failed or s.status == Skipped or (s.status == Running and s.leaseUntil <= s.now))
pure def claim(s: BudgetState, token: int, leaseUntil: int): BudgetState =
  { ...s, status: Running, token: token, leaseUntil: leaseUntil }
pure def owns(s: BudgetState, token: int): bool = s.status == Running and token == s.token and s.leaseUntil > s.now
pure def canFinish(s: BudgetState, token: int, status: RowStatus): bool =
  owns(s, token) and (status == Completed or status == Failed or status == Skipped)
pure def finish(s: BudgetState, token: int, status: RowStatus): BudgetState = { ...s, status: status, leaseUntil: 0 }
pure def blocksRoute(d: Denial): bool = d.source == SurplusSpendingDenial
pure def canRecordBlock(s: BudgetState, token: int, d: Denial): bool =
  owns(s, token) and blocksRoute(d) and d.resetAt > s.now and currentBlock(s).id == 0
pure def recordBlock(s: BudgetState, token: int, d: Denial): BudgetState =
  { ...s, status: Failed, leaseUntil: 0,
    blocks: s.blocks.append({ id: s.blocks.length() + 1, token: token, retryAt: d.resetAt, dispatched: false }) }
pure def lawOrbioFailureNeverBlocks(d: Denial): bool = d.source == OrbioFailure implies not(blocksRoute(d))
```

### A due block is sent once while its claim is still the failed current one

Every five-minute run selects at most 100 due blocks whose review is still
failed under the block's own claim, whose installation is active and that
have no dispatch record. It sends the stored identifier-only job first and
then writes the dispatch record. A lost record lets a later run send the
job again; the review claim and completed-revision check absorb the
duplicate. A later claim of the same key makes an older block obsolete.

```quint
pure def resumable(s: BudgetState, b: Block): bool =
  b.id > 0 and not(b.dispatched) and b.retryAt <= s.now and s.status == Failed and b.token == s.token
    and I::active(s.install)
pure def canSendResume(s: BudgetState, blockId: int): bool = resumable(s, blockOf(s, blockId))
pure def sendResume(s: BudgetState, blockId: int): BudgetState = { ...s, sends: s.sends + 1 }
pure def canRecordDispatch(s: BudgetState, blockId: int): bool = resumable(s, blockOf(s, blockId))
pure def recordDispatch(s: BudgetState, blockId: int): BudgetState =
  { ...s, blocks: s.blocks.listMap(b => if (b.id == blockId) { ...b, dispatched: true } else b) }
pure def alwaysBlocksAreOrdered(s: BudgetState): bool =
  s.blocks.every(b => b.id > 0 and b.id <= s.blocks.length() and b.token > 0 and b.token <= s.token and b.retryAt > 0)
pure def alwaysOneBlockPerClaim(s: BudgetState): bool =
  s.blocks.every(b => s.blocks.select(o => o.token == b.token).length() == 1)
pure def alwaysRunningHasLease(s: BudgetState): bool =
  (s.status == Running implies s.leaseUntil > 0 and s.token > 0) and (s.status != Running implies s.leaseUntil == 0)
pure def alwaysCurrentBlockFailedTheReview(s: BudgetState): bool =
  currentBlock(s).id > 0 implies s.status == Failed
pure def stepBlocksImmutable(before: BudgetState, after: BudgetState): bool =
  before.blocks.every(b => after.blocks.some(a => a.id == b.id and a.token == b.token and a.retryAt == b.retryAt
    and (b.dispatched implies a.dispatched)))
pure def stepSendNeedsActiveInstallation(before: BudgetState, after: BudgetState): bool =
  after.sends > before.sends implies I::active(before.install) and before.status == Failed
pure def sometimesBlocked(s: BudgetState): bool = heldBack(s)
pure def sometimesResumed(s: BudgetState): bool = s.blocks.some(b => b.dispatched) and s.status == Running
pure def sometimesSuspendedBlockWaits(s: BudgetState): bool =
  s.blocks.some(b => not(b.dispatched) and b.retryAt <= s.now) and s.install.suspended and s.status == Failed
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
pure val blockIdValues = Set(1, 2)
pure val statusValues = Set(Completed, Failed, Skipped)
pure val weight_claim = 4
pure val weight_recordBlock = 4
pure val weight_sendResume = 3
```
