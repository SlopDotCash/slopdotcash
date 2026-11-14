# Monthly allocations

PRD section 6 fixes a UTC calendar period and cutoff 72 hours after its end. One instance represents a project and period. Source models include `monthly_coordinator`, `monthly_cutoff_queue`, `monthly_allocation`, `monthly_owner_completion`, `monthly_source_conflict` and `monthly_commit_cursor`.

The full recipient list uses the full-width largest-remainder algorithm. Every weight contains only accepted-work Points for this project and period. Pool amounts, weights, remainders and recipient allocations use arbitrary-length limbs. There is no recipient count, monetary-size or per-account Points cap. Historical cycles retain their original windows and terms.

## Story: Freeze one complete allocation

### A new period has no proposal, pool amount or financial obligation

```quint
import allocation as A from "./allocation"
import money as M from "./money"
type ProjectEligibility = { revision: int, registered: bool, paused: bool, retired: bool, collectionAllowed: bool }
type MonthlyPhase = Collecting | Proposed | Frozen | Reserved | Completed
type Monthly = { phase: MonthlyPhase, period: int, revision: int, cap: M::Amount, total: M::Amount,
  shares: List[A::Share], automatic: bool, paid: List[int], receipts: List[int], wallets: List[int], cutoffReached: bool }
pure val initial: Monthly = { phase: Collecting, period: 202611, revision: 1, cap: M::zero, total: M::zero,
  shares: List(), automatic: true, paid: List(), receipts: List(), wallets: List(), cutoffReached: false }
pure val byValues = Set("owner", "wrong")
pure val elapsedHoursValues = Set(0, 71, 72, 73)
pure val availableValues = Set(List(0), List(3), List(6))
pure val amountValues = Set(List(0), List(1), List(4), List(6), List(0, 1))
pure val capValues = Set(List(0), List(6), List(0, 1))
pure val sourceValues = Set("vault", "wrong")
pure val assetValues = Set("asset", "wrong")
pure val weightsValues = Set(List(), List({ actor: 1, weight: List(1) }), List({ actor: 1, weight: List(1) }, { actor: 2, weight: List(3) }))
pure val sharesValues = Set(List({ actor: 1, amount: List(4) }), List({ actor: 1, amount: List(1) }, { actor: 2, amount: List(3) }))
pure def hasActor(shares: List[A::Share], actor: int): bool = shares.some(s => s.actor == actor)
pure def amountFor(shares: List[A::Share], actor: int): M::Amount =
  shares.foldl(M::zero, (total, share) => M::addAmounts(total, if (share.actor == actor) share.amount else M::zero))
```

### A complete closed-month ledger creates a proposal once

Missing or conflicted source coverage refuses the proposal. Current registry and security evidence must identify the same project revision and permit collection. Paused and retired projects create no monthly proposal. A zero pool with no recipients produces one empty proposal and no obligations. The shared allocator resolves equal remainders by permanent actor ID. Repeat runs cannot add or replace proposal rows.

```quint
pure def projectMayClose(eligibility: ProjectEligibility, revision: int): bool = eligibility.revision == revision and
  eligibility.registered and not(eligibility.paused) and not(eligibility.retired) and eligibility.collectionAllowed
pure def canPropose(m: Monthly, amount: M::Amount, weights: List[A::Weight], closed: bool, complete: bool, eligibility: ProjectEligibility): bool =
  m.phase == Collecting and closed and complete and projectMayClose(eligibility, m.revision) and M::validAmount(amount) and M::compareAmounts(amount, m.cap) <= 0
    and A::canCommitAllocation(amount, weights)
pure def propose(m: Monthly, amount: M::Amount, weights: List[A::Weight], closed: bool, complete: bool, eligibility: ProjectEligibility): Monthly =
  { ...m, phase: Proposed, total: amount, shares: A::allocateAmounts(amount, weights) }
```

### The current owner may adjust before freeze without exceeding the cap

Current authority and the immutable project revision are rechecked at the write boundary. Amount changes retain the same unique recipient identities. The adjustment journal remains private. The trusted UTC clock marks the cutoff only at least 72 hours after the calendar month ends. The automatic freeze worker is weakly fair once its guard stays enabled. Human owner actions have no fairness assumption. A persistent worker outage violates this progress assumption and must be surfaced operationally.

```quint
pure def canAdjust(m: Monthly, shares: List[A::Share], revision: int, by: str): bool =
  m.phase == Proposed and by == "owner" and revision == m.revision and shares.length() == m.shares.length()
    and shares.every(s => M::validAmount(s.amount) and hasActor(m.shares, s.actor)
      and shares.select(other => other.actor == s.actor).length() == 1)
    and M::compareAmounts(A::allocatedTotal(shares), m.cap) <= 0
pure def adjust(m: Monthly, shares: List[A::Share], revision: int, by: str): Monthly =
  { ...m, shares: shares, total: A::allocatedTotal(shares) }
pure def canSetAutomatic(m: Monthly, automatic: bool, by: str): bool =
  (m.phase == Collecting or m.phase == Proposed) and by == "owner"
pure def setAutomatic(m: Monthly, automatic: bool, by: str): Monthly = { ...m, automatic: automatic }
pure def canSetCap(m: Monthly, cap: M::Amount, by: str): bool = m.phase == Collecting and M::validAmount(cap) and by == "owner"
pure def setCap(m: Monthly, cap: M::Amount, by: str): Monthly = { ...m, cap: cap }
pure def canReachCutoff(m: Monthly, elapsedHours: int): bool = not(m.cutoffReached) and elapsedHours >= 72
pure def reachCutoff(m: Monthly, elapsedHours: int): Monthly = { ...m, cutoffReached: true }
pure def canFreeze(m: Monthly, by: str): bool = m.phase == Proposed and by == "owner"
pure def freeze(m: Monthly, by: str): Monthly = { ...m, phase: Frozen }
pure def canAutoFreeze(m: Monthly): bool = m.phase == Proposed and m.cutoffReached and m.automatic
pure def autoFreeze(m: Monthly): Monthly = { ...m, phase: Frozen }
pure val fair_autoFreeze = "weak"
pure def leadsToCutoffFrozen(m: Monthly, later: Monthly): bool =
  (m.phase == Proposed and m.cutoffReached and m.automatic) implies (later.phase != Proposed or not(later.automatic))

```

### Full funding reserves every recipient and walletless awards do not expire

A zero-total period creates no obligations. One recipient's wallet or payment failure leaves the other recipients eligible. Deposits, other periods and unrelated vault operations remain independent.

```quint
pure def canFund(m: Monthly, available: M::Amount): bool = m.phase == Frozen and M::validAmount(available) and M::compareAmounts(available, m.total) >= 0
pure def fund(m: Monthly, available: M::Amount): Monthly =
  { ...m, phase: if (not(M::positiveAmount(m.total))) Completed else Reserved }
pure def canRegisterWallet(m: Monthly, actor: int): bool = hasActor(m.shares, actor) and not(m.wallets.includes(actor))
pure def registerWallet(m: Monthly, actor: int): Monthly = { ...m, wallets: m.wallets.append(actor) }
pure def canPay(m: Monthly, actor: int, amount: M::Amount, source: str, asset: str, receipt: int, height: int, finalized: bool): bool =
  m.phase == Reserved and hasActor(m.shares, actor) and m.wallets.includes(actor) and not(m.paid.includes(actor))
    and M::equalAmounts(amount, amountFor(m.shares, actor)) and M::positiveAmount(amount) and source == "vault" and asset == "asset"
    and receipt > 0 and not(m.receipts.includes(receipt)) and height > 0 and finalized
pure def pay(m: Monthly, actor: int, amount: M::Amount, source: str, asset: str, receipt: int, height: int, finalized: bool): Monthly =
  val paid = m.paid.append(actor)
  { ...m, paid: paid, receipts: m.receipts.append(receipt), phase: if (m.shares.every(s => not(M::positiveAmount(s.amount)) or paid.includes(s.actor))) Completed else Reserved }
pure def alwaysAllocationConserved(m: Monthly): bool = M::validAmount(m.total) and M::validAmount(m.cap) and M::compareAmounts(m.total, m.cap) <= 0
  and M::equalAmounts(A::allocatedTotal(m.shares), m.total) and m.shares.every(s => M::validAmount(s.amount))
pure def alwaysCompletedPaid(m: Monthly): bool = m.phase == Completed implies
  m.shares.every(s => not(M::positiveAmount(s.amount)) or m.paid.includes(s.actor))
pure def alwaysPaidMember(m: Monthly): bool = m.paid.every(actor => hasActor(m.shares, actor))
pure def stepFrozenAmountsStable(before: Monthly, after: Monthly): bool =
  (before.phase == Frozen or before.phase == Reserved or before.phase == Completed) implies
    after.total == before.total and after.shares == before.shares
pure def stepPaidNeverReverts(before: Monthly, after: Monthly): bool = before.paid.every(actor => after.paid.includes(actor))
pure def sometimesWalletlessReserve(m: Monthly): bool = m.phase == Reserved and m.wallets.length() == 0
pure def sometimesIndependentPayment(m: Monthly): bool = m.phase == Reserved and m.paid.length() > 0
pure def sometimesCompleted(m: Monthly): bool = m.phase == Completed and M::positiveAmount(m.total)
pure def sometimesEmptyMonth(m: Monthly): bool = m.phase == Completed and M::equalAmounts(m.total, M::zero) and m.shares.length() == 0
```

### Unproposed and unfunded periods have no paid recipients

Discovered by the proof. Without these lifecycle facts, an arbitrary Collecting
state could already hold old paid-recipient IDs, and a new proposal would
replace the shares those IDs belonged to. Proposal creation begins with no
shares, receipts or paid recipients. Payment occurs only after full funding.

```quint
pure def alwaysCollectingEmpty(m: Monthly): bool = m.phase == Collecting implies
  M::equalAmounts(m.total, M::zero) and m.shares.length() == 0 and m.paid.length() == 0 and m.receipts.length() == 0
pure def alwaysUnfundedUnpaid(m: Monthly): bool =
  (m.phase == Collecting or m.phase == Proposed or m.phase == Frozen) implies m.paid.length() == 0 and m.receipts.length() == 0
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val actorValues = Set(0, 1, 2)
pure val heightValues = Set(0, 1, 2)
pure val receiptValues = Set(0, 1, 2)
pure val revisionValues = Set(0, 1, 2)
pure val eligibilityValues = Set(
  { revision: 1, registered: true, paused: false, retired: false, collectionAllowed: true },
  { revision: 1, registered: true, paused: true, retired: false, collectionAllowed: false },
  { revision: 2, registered: true, paused: false, retired: false, collectionAllowed: true })
pure def lawPausedExcluded(eligibility: ProjectEligibility, revision: int): bool =
  eligibility.paused implies not(projectMayClose(eligibility, revision))
```
