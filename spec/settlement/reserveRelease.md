# Untouched wrong-total reserve release

PRD section 6 permits one bounded attester approval for a current owner's request. Source models include `monthly_release`, `monthly_reserve`, `transaction_balance_proof` and `monthly_owner_completion`. This is a release into the same vault's free balance. No external withdrawal is emitted. The evidence adapter verifies finalized chain state and the complete retained allocation against its admitted root.

## Story: Recover an allocation with the wrong total

### A reserve retains the admitted root and complete allocation

```quint
import money as M from "./money"
type ReleasePhase = Reserved | Checked | Approved | OwnerSigned | Released
type ReserveRelease = { phase: ReleasePhase, root: str, allocationRoot: str, originalReserve: M::Amount, originalFree: M::Amount, hasSettled: bool, reserved: M::Amount,
  allocationTotal: M::Amount, settledAmount: M::Amount, free: M::Amount, evidenceHeight: int, observedHeight: int,
  ownerRevision: int, requestRevision: int, upgradeQualified: bool }
pure val initial: ReserveRelease = { phase: Reserved, root: "root", allocationRoot: "root",
  originalReserve: List(6), originalFree: M::zero, hasSettled: false,
  reserved: List(6), allocationTotal: List(5), settledAmount: M::zero, free: M::zero, evidenceHeight: 0, observedHeight: 0,
  ownerRevision: 1, requestRevision: 0, upgradeQualified: false }
pure val byValues = Set("owner", "attester", "wrong")
pure val rootValues = Set("root", "wrong")
pure val releasedAmountValues = Set(List(5), List(6), List(7))
pure val totalValues = Set(List(5), List(6), List(7))
pure val amountValues = Set(List(1), List(6))
pure val settledAmountValues = Set(List(0), List(1))
```

### Current authority and fresh complete wrong-total evidence permit approval

A healthy total, partial settlement, mismatching root or stale owner request refuses release. Evidence freshness means equality with the latest finalized height observed for this operation, whose freshness policy remains the chain adapter's explicit contract.

```quint
pure def canObserve(r: ReserveRelease, height: int): bool = r.phase != Released and height > r.observedHeight
pure def observe(r: ReserveRelease, height: int): ReserveRelease = { ...r, phase: Reserved, observedHeight: height, evidenceHeight: 0, requestRevision: 0 }
pure def canQualifyUpgrade(r: ReserveRelease, by: str): bool = r.phase == Reserved and by == "owner"
pure def qualifyUpgrade(r: ReserveRelease, by: str): ReserveRelease = { ...r, upgradeQualified: true }
pure def canCheck(r: ReserveRelease, root: str, total: M::Amount, height: int, requestRevision: int, by: str): bool =
  r.phase == Reserved and not(r.hasSettled) and r.upgradeQualified and by == "owner" and requestRevision == r.ownerRevision
    and root == r.root and root == r.allocationRoot and M::equalAmounts(total, r.allocationTotal)
    and not(M::equalAmounts(total, r.reserved)) and M::equalAmounts(r.settledAmount, M::zero) and height > 0 and height == r.observedHeight
pure def check(r: ReserveRelease, root: str, total: M::Amount, height: int, requestRevision: int, by: str): ReserveRelease =
  { ...r, phase: Checked, evidenceHeight: height, requestRevision: requestRevision }
pure def canApprove(r: ReserveRelease, by: str): bool = r.phase == Checked and by == "attester"
  and r.evidenceHeight == r.observedHeight and r.requestRevision == r.ownerRevision and M::equalAmounts(r.settledAmount, M::zero)
pure def approve(r: ReserveRelease, by: str): ReserveRelease = { ...r, phase: Approved }
pure def canOwnerSign(r: ReserveRelease, by: str): bool = r.phase == Approved and by == "owner"
pure def ownerSign(r: ReserveRelease, by: str): ReserveRelease = { ...r, phase: OwnerSigned }
```

### Finalized release returns the whole untouched reserve

The owner submits the transaction. The Worker has no submission transition. A qualified on-chain release checks untouched state atomically so a settlement racing the release causes refusal on chain.

```quint
pure def canFinalize(r: ReserveRelease, height: int, releasedAmount: M::Amount, settledAmount: M::Amount): bool =
  r.phase == OwnerSigned and height >= r.evidenceHeight and M::equalAmounts(releasedAmount, r.reserved) and M::equalAmounts(settledAmount, M::zero)
pure def finalize(r: ReserveRelease, height: int, releasedAmount: M::Amount, settledAmount: M::Amount): ReserveRelease =
  { ...r, phase: Released, free: M::addAmounts(r.free, r.reserved), reserved: M::zero }
pure def canChangeOwner(r: ReserveRelease, revision: int): bool = r.phase != Released and revision > r.ownerRevision
pure def changeOwner(r: ReserveRelease, revision: int): ReserveRelease =
  { ...r, phase: Reserved, ownerRevision: revision, requestRevision: 0, evidenceHeight: 0 }
pure def canSettlePart(r: ReserveRelease, amount: M::Amount): bool = r.phase != Released and M::validAmount(amount) and M::positiveAmount(amount) and M::compareAmounts(amount, r.reserved) <= 0
pure def settlePart(r: ReserveRelease, amount: M::Amount): ReserveRelease =
  { ...r, phase: Reserved, hasSettled: true, reserved: M::subtractAmounts(r.reserved, amount), settledAmount: M::addAmounts(r.settledAmount, amount),
    requestRevision: 0, evidenceHeight: 0 }
pure def alwaysNoSettlementOnRelease(r: ReserveRelease): bool = r.phase == Released implies M::equalAmounts(r.settledAmount, M::zero)
pure def alwaysWholeRelease(r: ReserveRelease): bool = r.phase == Released implies M::equalAmounts(r.reserved, M::zero) and M::equalAmounts(r.free, M::addAmounts(r.originalFree, r.originalReserve))
pure def alwaysBoundApproval(r: ReserveRelease): bool = r.phase != Reserved implies
  r.requestRevision == r.ownerRevision and r.evidenceHeight > 0 and not(M::equalAmounts(r.allocationTotal, r.originalReserve)) and not(r.hasSettled) and M::equalAmounts(r.settledAmount, M::zero)
pure def sometimesReleased(r: ReserveRelease): bool = r.phase == Released
pure def sometimesPartialHeld(r: ReserveRelease): bool = M::positiveAmount(r.settledAmount) and r.phase == Reserved
```

### The original balances and allocation survive every recovery step

Discovered by the proof: a syntactically valid OwnerSigned state could contain
an unrelated free balance or reserve and still satisfy the previous rules.
Release would then violate the stated whole-reserve result. Retain the original
free balance and original reserve explicitly. Until settlement or release,
those balances are unchanged. Any settlement permanently records that history
and leaves the allocation in the held Reserved phase. The root and complete
allocation remain immutable, and conservation includes amounts already settled.

```quint
pure def alwaysUntouchedBalances(r: ReserveRelease): bool =
  (not(r.hasSettled) and r.phase != Released) implies
    r.reserved == r.originalReserve and r.free == r.originalFree
pure def alwaysSettlementHistory(r: ReserveRelease): bool =
  (r.hasSettled implies r.phase == Reserved) and
  (not(r.hasSettled) implies r.settledAmount == M::zero)
pure def alwaysValidAmounts(r: ReserveRelease): bool = M::validAmount(r.originalReserve)
  and M::validAmount(r.originalFree) and M::validAmount(r.reserved)
  and M::validAmount(r.allocationTotal) and M::validAmount(r.settledAmount) and M::validAmount(r.free)
pure def alwaysConserved(r: ReserveRelease): bool =
  M::equalAmounts(M::addAmounts(M::addAmounts(r.free, r.reserved), r.settledAmount),
    M::addAmounts(r.originalFree, r.originalReserve))
pure def stepOriginalTermsRetained(before: ReserveRelease, after: ReserveRelease): bool =
  before.originalReserve == after.originalReserve and before.originalFree == after.originalFree
    and before.root == after.root and before.allocationRoot == after.allocationRoot
    and before.allocationTotal == after.allocationTotal
pure def stepSettlementHistoryRetained(before: ReserveRelease, after: ReserveRelease): bool =
  before.hasSettled implies after.hasSettled
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val heightValues = Set(0, 1, 2)
pure val requestRevisionValues = Set(0, 1, 2)
pure val revisionValues = Set(0, 1, 2)
```
