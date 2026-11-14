# Untouched wrong-total reserve release

PRD section 6 permits one bounded attester approval for a current owner's request. Source models include `monthly_release`, `monthly_reserve`, `transaction_balance_proof` and `monthly_owner_completion`. This is a release into the same vault's free balance. No external withdrawal is emitted. The evidence adapter verifies finalized chain state and the complete retained allocation against its admitted root.

## Story: Recover an allocation with the wrong total

### A reserve retains the admitted root and complete allocation

```quint
import money as M from "./money"
type ReleasePhase = Reserved | Checked | Approved | OwnerSigned | Released
type ReleaseReceipt = { attempt: int, root: str, height: int, releasedAmount: M::Amount,
  settledAmount: M::Amount, finalized: bool, succeeded: bool }
type FailedReleaseReceipt = { attempt: int, root: str, height: int, canonicalFailure: bool }
type RetiredReleaseAttempt = { attempt: int, requestRevision: int, evidenceHeight: int, failureHeight: int }
type ReserveRelease = { phase: ReleasePhase, root: str, allocationRoot: str, originalReserve: M::Amount, originalFree: M::Amount, hasSettled: bool, reserved: M::Amount,
  allocationTotal: M::Amount, settledAmount: M::Amount, free: M::Amount, evidenceHeight: int, observedHeight: int,
  ownerRevision: int, requestRevision: int, signedAttempt: int, retiredAttempts: List[RetiredReleaseAttempt],
  finalizedHeight: int, observedAfterSignature: bool, upgradeQualified: bool }
pure val initial: ReserveRelease = { phase: Reserved, root: "root", allocationRoot: "root",
  originalReserve: List(6), originalFree: M::zero, hasSettled: false,
  reserved: List(6), allocationTotal: List(5), settledAmount: M::zero, free: M::zero, evidenceHeight: 0, observedHeight: 0,
  ownerRevision: 1, requestRevision: 0, signedAttempt: 0, retiredAttempts: List(), finalizedHeight: 0, observedAfterSignature: false, upgradeQualified: false }
pure val byValues = Set("owner", "attester", "wrong")
pure val rootValues = Set("root", "wrong")
pure val totalValues = Set(List(5), List(6), List(7))
pure val amountValues = Set(List(1), List(6))
```

### Current authority and fresh complete wrong-total evidence permit approval

A healthy total, partial settlement, mismatching root or stale owner request refuses release. Evidence freshness means equality with the latest finalized height observed for this operation, whose freshness policy remains the chain adapter's explicit contract. A newer
height invalidates a pre-signature review. After the owner signs, a newer
height preserves the signed attempt and its bound evidence.

```quint
pure def canObserve(r: ReserveRelease, height: int): bool = r.phase != Released and height > r.observedHeight
pure def observe(r: ReserveRelease, height: int): ReserveRelease =
  if (r.signedAttempt > 0) { ...r, observedHeight: height, observedAfterSignature: true }
  else { ...r, phase: Reserved, observedHeight: height, evidenceHeight: 0, requestRevision: 0 }
pure def canQualifyUpgrade(r: ReserveRelease, by: str): bool = r.phase == Reserved and by == "owner"
pure def qualifyUpgrade(r: ReserveRelease, by: str): ReserveRelease = { ...r, upgradeQualified: true }
pure def canCheck(r: ReserveRelease, root: str, total: M::Amount, height: int, requestRevision: int, by: str): bool =
  r.phase == Reserved and r.signedAttempt == 0 and not(r.hasSettled) and r.upgradeQualified and by == "owner" and requestRevision > 0 and requestRevision == r.ownerRevision
    and root == r.root and root == r.allocationRoot and M::equalAmounts(total, r.allocationTotal)
    and not(M::equalAmounts(total, r.reserved)) and M::equalAmounts(r.settledAmount, M::zero) and height > 0 and height == r.observedHeight
pure def check(r: ReserveRelease, root: str, total: M::Amount, height: int, requestRevision: int, by: str): ReserveRelease =
  { ...r, phase: Checked, evidenceHeight: height, requestRevision: requestRevision }
pure def canApprove(r: ReserveRelease, by: str): bool = r.phase == Checked and by == "attester"
  and r.evidenceHeight == r.observedHeight and r.requestRevision == r.ownerRevision and M::equalAmounts(r.settledAmount, M::zero)
pure def approve(r: ReserveRelease, by: str): ReserveRelease = { ...r, phase: Approved }
pure def canOwnerSign(r: ReserveRelease, attempt: int, by: str): bool =
  r.phase == Approved and by == "owner" and attempt > 0
    and r.evidenceHeight == r.observedHeight and r.requestRevision == r.ownerRevision
    and not(r.retiredAttempts.foldl(false, (used, prior) => used or prior.attempt == attempt))
pure def ownerSign(r: ReserveRelease, attempt: int, by: str): ReserveRelease =
  { ...r, phase: OwnerSigned, signedAttempt: attempt }
```

### Finalized release returns the whole untouched reserve

The owner submits the transaction. The Worker has no submission transition.
The signed attempt identifies its reviewed plan and transaction. Finalization
requires the authenticated receipt for that attempt and allocation root, the
whole untouched reserve, canonical finality and a successful release. The
adapter verifies the exact signed transaction and its deployment identity.
A later head observation or owner rotation cannot erase the signed attempt.
The chain still checks untouched state atomically. A conflicting finalized
settlement ends the release path while preserving the signed attempt record.
A verified failure of the exact canonical finalized transaction retires its
attempt without moving funds. The record retains the request revision and
review and failure heights. The current owner can start a new review at the
latest observed finalized height only if the reserve is still untouched. A
new signature requires a fresh attempt identity. Pending, unknown or mismatched
transactions keep the existing attempt outstanding. The failure adapter checks
the retained plan and exact chain transaction before establishing canonical
failure. The pinned product implementation at `6b3b9d0b979f0608d87941f1146056a98513ffcf`
verifies this boundary in `workers/payment-executor/monthly-release.ts:221–326`
and opens fresh review in `src/OwnerReserveRelease.tsx:141–204,241–257`.

```quint
pure def canFinalize(r: ReserveRelease, receipt: ReleaseReceipt): bool =
  r.phase == OwnerSigned and receipt.attempt == r.signedAttempt and receipt.attempt > 0
    and receipt.root == r.root and receipt.height >= r.evidenceHeight and receipt.finalized and receipt.succeeded
    and M::validAmount(receipt.releasedAmount) and M::equalAmounts(receipt.releasedAmount, r.reserved)
    and M::validAmount(receipt.settledAmount) and M::equalAmounts(receipt.settledAmount, M::zero)
pure def finalize(r: ReserveRelease, receipt: ReleaseReceipt): ReserveRelease =
  { ...r, phase: Released, free: M::addAmounts(r.free, r.reserved), reserved: M::zero, finalizedHeight: receipt.height }
pure def canRetireFailedAttempt(r: ReserveRelease, failure: FailedReleaseReceipt): bool =
  r.phase != Released and r.signedAttempt > 0 and failure.attempt == r.signedAttempt
    and failure.root == r.root and failure.height >= r.evidenceHeight and failure.canonicalFailure
pure def retireFailedAttempt(r: ReserveRelease, failure: FailedReleaseReceipt): ReserveRelease =
  { ...r, phase: Reserved, signedAttempt: 0, requestRevision: 0, evidenceHeight: 0, observedAfterSignature: false,
    observedHeight: if (failure.height > r.observedHeight) failure.height else r.observedHeight,
    retiredAttempts: r.retiredAttempts.append({ attempt: r.signedAttempt, requestRevision: r.requestRevision,
      evidenceHeight: r.evidenceHeight, failureHeight: failure.height }) }
pure def canChangeOwner(r: ReserveRelease, revision: int): bool = r.phase != Released and revision > r.ownerRevision
pure def changeOwner(r: ReserveRelease, revision: int): ReserveRelease =
  if (r.signedAttempt > 0) { ...r, ownerRevision: revision }
  else { ...r, phase: Reserved, ownerRevision: revision, requestRevision: 0, evidenceHeight: 0 }
pure def canSettlePart(r: ReserveRelease, amount: M::Amount): bool = r.phase != Released and M::validAmount(amount) and M::positiveAmount(amount) and M::compareAmounts(amount, r.reserved) <= 0
pure def settlePart(r: ReserveRelease, amount: M::Amount): ReserveRelease =
  { ...r, phase: Reserved, hasSettled: true, reserved: M::subtractAmounts(r.reserved, amount), settledAmount: M::addAmounts(r.settledAmount, amount),
    requestRevision: if (r.signedAttempt > 0) r.requestRevision else 0,
    evidenceHeight: if (r.signedAttempt > 0) r.evidenceHeight else 0 }
pure def alwaysNoSettlementOnRelease(r: ReserveRelease): bool = r.phase == Released implies M::equalAmounts(r.settledAmount, M::zero)
pure def alwaysWholeRelease(r: ReserveRelease): bool = r.phase == Released implies M::equalAmounts(r.reserved, M::zero) and M::equalAmounts(r.free, M::addAmounts(r.originalFree, r.originalReserve))
pure def alwaysBoundApproval(r: ReserveRelease): bool = r.phase != Reserved implies
  r.requestRevision > 0 and r.requestRevision <= r.ownerRevision and r.evidenceHeight > 0 and r.root == r.allocationRoot
    and not(M::equalAmounts(r.allocationTotal, r.originalReserve)) and not(r.hasSettled) and M::equalAmounts(r.settledAmount, M::zero)
pure def alwaysSignedIdentity(r: ReserveRelease): bool =
  r.signedAttempt >= 0 and ((r.phase == OwnerSigned or r.phase == Released) implies r.signedAttempt > 0)
    and (r.signedAttempt > 0 implies r.requestRevision > 0 and r.requestRevision <= r.ownerRevision and r.evidenceHeight > 0)
    and ((r.phase == Checked or r.phase == Approved) implies r.signedAttempt == 0 and r.requestRevision == r.ownerRevision
      and r.evidenceHeight == r.observedHeight)
    and (r.signedAttempt > 0 and r.phase == Reserved implies r.hasSettled)
    and (r.hasSettled implies r.phase == Reserved)
pure def alwaysLiveAttemptFresh(r: ReserveRelease): bool =
  r.signedAttempt > 0 implies r.retiredAttempts.foldl(true, (fresh, prior) => fresh and prior.attempt != r.signedAttempt)
pure def alwaysFinalizedHeight(r: ReserveRelease): bool =
  if (r.phase == Released) r.finalizedHeight >= r.evidenceHeight and r.finalizedHeight > 0 else r.finalizedHeight == 0
pure def alwaysObservedAfterSignature(r: ReserveRelease): bool = r.observedAfterSignature implies r.signedAttempt > 0
pure def stepAttemptHistoryRetained(before: ReserveRelease, after: ReserveRelease): bool =
  before.retiredAttempts == after.retiredAttempts or (
    before.signedAttempt > 0 and after.signedAttempt == 0
      and after.retiredAttempts.length() == before.retiredAttempts.length() + 1
      and after.retiredAttempts == before.retiredAttempts.append({ attempt: before.signedAttempt,
        requestRevision: before.requestRevision, evidenceHeight: before.evidenceHeight,
        failureHeight: after.retiredAttempts[before.retiredAttempts.length()].failureHeight })
      and after.retiredAttempts[before.retiredAttempts.length()].failureHeight >= before.evidenceHeight)
pure def stepSignedAttemptRetained(before: ReserveRelease, after: ReserveRelease): bool =
  before.signedAttempt > 0 implies (
    (after.signedAttempt == before.signedAttempt and after.requestRevision == before.requestRevision
      and after.evidenceHeight == before.evidenceHeight)
    or (after.signedAttempt == 0 and after.retiredAttempts.length() == before.retiredAttempts.length() + 1))
pure def sometimesReleased(r: ReserveRelease): bool = r.phase == Released
pure def sometimesObservedThenReleased(r: ReserveRelease): bool = r.phase == Released and r.observedAfterSignature
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
pure def alwaysOwnerRevision(r: ReserveRelease): bool = r.ownerRevision > 0
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
pure val heightValues = Set(0, 1, 2, 3)
pure val attemptValues = Set(0, 1, 2)
pure val receiptValues = Set(
  { attempt: 1, root: "root", height: 2, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: true },
  { attempt: 2, root: "root", height: 3, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: true },
  { attempt: 1, root: "wrong", height: 2, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: true },
  { attempt: 1, root: "root", height: 2, releasedAmount: List(5), settledAmount: List(0), finalized: true, succeeded: true },
  { attempt: 1, root: "root", height: 2, releasedAmount: List(6), settledAmount: List(0), finalized: false, succeeded: true },
  { attempt: 1, root: "root", height: 2, releasedAmount: List(6), settledAmount: List(0), finalized: true, succeeded: false })
pure val failureValues = Set(
  { attempt: 1, root: "root", height: 2, canonicalFailure: true },
  { attempt: 2, root: "root", height: 2, canonicalFailure: true },
  { attempt: 1, root: "root", height: 0, canonicalFailure: true },
  { attempt: 1, root: "wrong", height: 2, canonicalFailure: true },
  { attempt: 1, root: "root", height: 2, canonicalFailure: false })
pure val weight_observe = 10
pure val weight_qualifyUpgrade = 20
pure val weight_check = 25
pure val weight_approve = 25
pure val weight_ownerSign = 25
pure val weight_finalize = 20
pure val weight_retireFailedAttempt = 20
pure val requestRevisionValues = Set(0, 1, 2)
pure val revisionValues = Set(0, 1, 2)
```
