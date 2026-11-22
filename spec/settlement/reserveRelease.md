# Untouched wrong-total reserve release

PRD section 6 permits one bounded attester approval for a current owner's request. Source models include `monthly_release`, `monthly_reserve`, `transaction_balance_proof` and `monthly_owner_completion`. This is a release into the same vault's free balance. No external withdrawal is emitted. The evidence adapter verifies finalized chain state and the complete retained allocation against its admitted root.

## Story: Recover an allocation with the wrong total

### A reserve retains the admitted root and complete allocation

```quint
import money as M from "./money"
type ReleasePhase = Absent | Reserved | Checked | Approved | OwnerSigned | Released
type Network = Unpinned | Evm | Solana
type ReleaseRefusal = NoRefusal | NetworkUnsupported
type RetainedAllocation = { root: str, allocationRoot: str, allocationTotal: M::Amount, reserve: M::Amount, free: M::Amount,
  settled: M::Amount, released: M::Amount, leafCount: int, retainedLeaves: int, height: int }
type UpgradeQualification = { implementation: str, height: int }
type DeploymentPin = { revision: int, implementation: str, network: Network }
type ReleaseReceipt = { attempt: int, root: str, height: int, releasedAmount: M::Amount,
  settledAmount: M::Amount, finalized: bool, succeeded: bool }
type FailedReleaseReceipt = { attempt: int, root: str, height: int, canonicalFailure: bool }
type RetiredReleaseAttempt = { attempt: int, requestRevision: int, evidenceHeight: int, failureHeight: int }
type ReserveRelease = { phase: ReleasePhase, root: str, allocationRoot: str, originalReserve: M::Amount, originalFree: M::Amount, hasSettled: bool, reserved: M::Amount,
  allocationTotal: M::Amount, settledAmount: M::Amount, free: M::Amount, evidenceHeight: int, observedHeight: int,
  ownerRevision: int, requestRevision: int, signedAttempt: int, retiredAttempts: List[RetiredReleaseAttempt],
  finalizedHeight: int, observedAfterSignature: bool, upgradeQualified: bool, pinRevision: int, reviewedImplementation: str,
  network: Network, refusal: ReleaseRefusal }
pure val initial: ReserveRelease = { phase: Absent, root: "", allocationRoot: "",
  originalReserve: M::zero, originalFree: M::zero, hasSettled: false,
  reserved: M::zero, allocationTotal: M::zero, settledAmount: M::zero, free: M::zero, evidenceHeight: 0, observedHeight: 0,
  ownerRevision: 1, requestRevision: 0, signedAttempt: 0, retiredAttempts: List(), finalizedHeight: 0, observedAfterSignature: false, upgradeQualified: false,
  pinRevision: 0, reviewedImplementation: "", network: Unpinned, refusal: NoRefusal }
pure val byValues = Set("owner", "attester", "wrong")
pure val retainedSample: RetainedAllocation = { root: "root", allocationRoot: "root", allocationTotal: List(5), reserve: List(6),
  free: M::zero, settled: M::zero, released: M::zero, leafCount: 2, retainedLeaves: 2, height: 1 }
pure val evidenceValues = Set(retainedSample, { ...retainedSample, allocationTotal: List(6) }, { ...retainedSample, settled: List(1) },
  { ...retainedSample, retainedLeaves: 1 }, { ...retainedSample, height: 2 }, { ...retainedSample, released: List(6) })
pure val qualificationValues = Set({ implementation: "v2", height: 1 }, { implementation: "v1", height: 1 })
pure val pinValues = Set({ revision: 1, implementation: "v2", network: Evm }, { revision: 0, implementation: "v2", network: Evm },
  { revision: 1, implementation: "program", network: Solana }, { revision: 1, implementation: "v2", network: Unpinned })
pure val rootValues = Set("root", "wrong")
pure val totalValues = Set(List(5), List(6), List(7))
pure val amountValues = Set(List(1), List(6))
```

### Only complete, untouched, finalized retained evidence admits an allocation

Before admission there is no allocation, so check, approval and signature
refuse. Admission needs the complete retained allocation (every leaf of its
admitted root), its finalized reserve and free balance read at the latest
observed height, and no settled or released gross. Missing, stale, partly
settled or already released evidence leaves the allocation absent.

```quint
pure def canAdmitRetained(r: ReserveRelease, evidence: RetainedAllocation): bool =
  r.phase == Absent and r.network == Evm and evidence.root != "" and evidence.allocationRoot == evidence.root
    and evidence.leafCount > 0 and evidence.retainedLeaves == evidence.leafCount
    and M::validAmount(evidence.allocationTotal) and M::validAmount(evidence.reserve) and M::positiveAmount(evidence.reserve)
    and M::validAmount(evidence.free) and M::validAmount(evidence.settled) and M::validAmount(evidence.released)
    and not(M::positiveAmount(evidence.settled)) and not(M::positiveAmount(evidence.released))
    and evidence.height > 0 and evidence.height == r.observedHeight
pure def admitRetained(r: ReserveRelease, evidence: RetainedAllocation): ReserveRelease =
  { ...r, phase: Reserved, root: evidence.root, allocationRoot: evidence.allocationRoot, allocationTotal: evidence.allocationTotal,
    originalReserve: evidence.reserve, reserved: evidence.reserve, originalFree: evidence.free, free: evidence.free }
pure def alwaysAbsentEmpty(r: ReserveRelease): bool = r.phase == Absent implies
  r.root == "" and r.signedAttempt == 0 and r.requestRevision == 0 and not(r.hasSettled)
    and M::equalAmounts(r.reserved, M::zero) and M::equalAmounts(r.free, M::zero) and r.retiredAttempts.length() == 0
```

### Current authority and fresh complete wrong-total evidence permit approval

A healthy total, partial settlement, mismatching root or stale owner request refuses release. The
release capability exists only after a finalized read shows the vault running
the reviewed release-capable implementation recorded in the project's
deployment pin; neither the owner nor the attester can assert it. The pin is
state: it is recorded once from the approved D1 project revision's
deployment binding (supplied by the project registry) and never changes, and
the qualification carries only the implementation the finalized read
returned. The pin also records that binding's single vault network (PRD
section 6, one network per project), so a record has no network until it is
pinned and its network never changes. For an EVM binding the pinned
implementation is the reviewed vault implementation of its EVM upgrade
binding; for a Solana binding it is the escrow program id, which identifies
the deployment but is no upgrade implementation. Upgrade qualification is
therefore an EVM read only: `release.vibe` qualifies only
`deployment.evmUpgrade.vaultImplementation`, so a record pinned to another
network is never qualified. Binding the retained allocation to the escrow's own admitted month
(root, admitted gross and remainder) is a composition obligation with
[escrow accounting](./escrow.md). Evidence freshness means equality with the latest finalized height observed for this operation, whose freshness policy remains the chain adapter's explicit contract. A newer
height invalidates a pre-signature review. After the owner signs, a newer
height preserves the signed attempt and its bound evidence.

```quint
pure def canObserve(r: ReserveRelease, height: int): bool = r.phase != Released and height > r.observedHeight
pure def observe(r: ReserveRelease, height: int): ReserveRelease =
  if (r.signedAttempt > 0) { ...r, observedHeight: height, observedAfterSignature: true }
  else if (r.phase == Absent) { ...r, observedHeight: height }
  else { ...r, phase: Reserved, observedHeight: height, evidenceHeight: 0, requestRevision: 0 }
pure def canPinImplementation(r: ReserveRelease, pin: DeploymentPin): bool =
  r.pinRevision == 0 and pin.revision > 0 and pin.implementation != "" and pin.network != Unpinned
pure def pinImplementation(r: ReserveRelease, pin: DeploymentPin): ReserveRelease =
  { ...r, pinRevision: pin.revision, reviewedImplementation: pin.implementation, network: pin.network }
pure def canQualifyUpgrade(r: ReserveRelease, qualification: UpgradeQualification): bool =
  not(r.upgradeQualified) and r.phase != Released and r.network == Evm and qualification.implementation != ""
    and r.reviewedImplementation != "" and qualification.implementation == r.reviewedImplementation
    and qualification.height > 0 and qualification.height <= r.observedHeight
pure def qualifyUpgrade(r: ReserveRelease, qualification: UpgradeQualification): ReserveRelease = { ...r, upgradeQualified: true }
pure def canCheck(r: ReserveRelease, root: str, total: M::Amount, height: int, requestRevision: int, by: str): bool =
  r.phase == Reserved and r.network == Evm and r.signedAttempt == 0 and not(r.hasSettled) and r.upgradeQualified and by == "owner" and requestRevision > 0 and requestRevision == r.ownerRevision
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
  if (r.signedAttempt > 0 or r.phase == Absent) { ...r, ownerRevision: revision }
  else { ...r, phase: Reserved, ownerRevision: revision, requestRevision: 0, evidenceHeight: 0 }
pure def canSettlePart(r: ReserveRelease, amount: M::Amount): bool = r.phase != Released and r.phase != Absent and M::validAmount(amount) and M::positiveAmount(amount) and M::compareAmounts(amount, r.reserved) <= 0
pure def settlePart(r: ReserveRelease, amount: M::Amount): ReserveRelease =
  { ...r, phase: Reserved, hasSettled: true, reserved: M::subtractAmounts(r.reserved, amount), settledAmount: M::addAmounts(r.settledAmount, amount),
    requestRevision: if (r.signedAttempt > 0) r.requestRevision else 0,
    evidenceHeight: if (r.signedAttempt > 0) r.evidenceHeight else 0 }
pure def alwaysNoSettlementOnRelease(r: ReserveRelease): bool = r.phase == Released implies M::equalAmounts(r.settledAmount, M::zero)
pure def alwaysWholeRelease(r: ReserveRelease): bool = r.phase == Released implies M::equalAmounts(r.reserved, M::zero) and M::equalAmounts(r.free, M::addAmounts(r.originalFree, r.originalReserve))
pure def alwaysBoundApproval(r: ReserveRelease): bool = (r.phase != Reserved and r.phase != Absent) implies
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

### Only an EVM vault's release reaches service approval

Both contracts accept only the whole untouched reserve, signed by the owner
with the identity authority's attestation:
`packages/contracts/evm/src/ProjectEscrow.sol` `releaseMonthlyReserve`
requires `remaining == total` and `releasedGross == expectedRemaining`, and
`packages/contracts/solana/programs/slop-escrow/src/lib.rs`
`release_monthly_reserve` requires `committed == 0`, `released == 0`,
`unsettled == total` and `released == unsettled`, verified against an Ed25519
attestation of `monthly_release_message`. The service approval path is
implemented only for EVM vaults: `apps/settlement/src/reserveRelease/release.vibe`
takes a registered EVM deployment, qualifies its EVM upgrade implementation and
signs `monthlyReleaseDigest`. `apps/settlement/src/chain/solana/messages.ts`
already encodes the Solana release message and instruction, but the service has
no Solana evidence adapter and never signs an Ed25519 attestation of that
message. A record pinned to a Solana deployment binding is therefore never
admitted, checked or approved. Before anything is written, a Solana request
passes the same owner checks as an EVM request: the route's owner authorization
and manifest check, then the current steward, GitHub repository authority and
unchanged manifest (`refuseUnsupportedNetwork` runs `ownedProject`, as
`prepareRelease` does). The attester then records the named
refusal `NetworkUnsupported` on it, and the request stays held; time never
releases it (PRD section 6). The named refusal is retained in the release
record. The owner receives the route's existing `release_held` answer, as for
every other held release, because the route's refusal catalog follows the
reference parity contract (`reference/parity/routes.json`). A stored record
written before the network was recorded has no network field; the state
decoder refuses it and the generated store never writes over it, so it stays
held instead of being approved or reset. A Solana approval path needs its own reviewed
implementation and model.

```quint
pure def canRefuseNetwork(r: ReserveRelease, by: str): bool =
  by == "attester" and r.phase == Absent and r.network == Solana and r.refusal == NoRefusal
pure def refuseNetwork(r: ReserveRelease, by: str): ReserveRelease = { ...r, refusal: NetworkUnsupported }
pure def alwaysApprovedEvm(r: ReserveRelease): bool = r.phase != Absent implies r.network == Evm
pure def alwaysRefusalNamed(r: ReserveRelease): bool =
  r.refusal == NetworkUnsupported implies r.network == Solana and r.phase == Absent
pure def alwaysNetworkPinned(r: ReserveRelease): bool =
  (r.pinRevision > 0 iff r.network != Unpinned) and (r.pinRevision > 0 iff r.reviewedImplementation != "")
pure def stepNetworkFixed(before: ReserveRelease, after: ReserveRelease): bool =
  before.network != Unpinned implies after.network == before.network
pure def stepRefusalRetained(before: ReserveRelease, after: ReserveRelease): bool =
  before.refusal == NetworkUnsupported implies after.refusal == NetworkUnsupported
pure def sometimesNetworkRefused(r: ReserveRelease): bool = r.refusal == NetworkUnsupported
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
pure def alwaysQualifiedAgainstPin(r: ReserveRelease): bool = r.upgradeQualified implies r.reviewedImplementation != "" and r.pinRevision > 0
pure def stepPinFixed(before: ReserveRelease, after: ReserveRelease): bool =
  before.pinRevision > 0 implies after.pinRevision == before.pinRevision and after.reviewedImplementation == before.reviewedImplementation
pure def alwaysValidAmounts(r: ReserveRelease): bool = M::validAmount(r.originalReserve)
  and M::validAmount(r.originalFree) and M::validAmount(r.reserved)
  and M::validAmount(r.allocationTotal) and M::validAmount(r.settledAmount) and M::validAmount(r.free)
pure def alwaysConserved(r: ReserveRelease): bool =
  M::equalAmounts(M::addAmounts(M::addAmounts(r.free, r.reserved), r.settledAmount),
    M::addAmounts(r.originalFree, r.originalReserve))
pure def stepOriginalTermsRetained(before: ReserveRelease, after: ReserveRelease): bool =
  before.phase != Absent implies before.originalReserve == after.originalReserve and before.originalFree == after.originalFree
    and before.root == after.root and before.allocationRoot == after.allocationRoot
    and before.allocationTotal == after.allocationTotal
pure def stepSettlementHistoryRetained(before: ReserveRelease, after: ReserveRelease): bool =
  before.hasSettled implies after.hasSettled
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules. Discovered by simulation: without a Solana pin and an unpinned pin among the
samples, the network refusal is never allowed and the pin guard's network
condition never refuses, so both are sampled beside the EVM pins. The network
refusal also gets the same weight as the other attester events
(`weight_refuseNetwork`), so a Solana-pinned record reaches it in the sampled
traces instead of leaving the event rarely chosen.

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
pure val weight_pinImplementation = 20
pure val weight_admitRetained = 25
pure val weight_check = 25
pure val weight_approve = 25
pure val weight_ownerSign = 25
pure val weight_finalize = 20
pure val weight_retireFailedAttempt = 20
pure val weight_refuseNetwork = 20
pure val requestRevisionValues = Set(0, 1, 2)
pure val revisionValues = Set(0, 1, 2)
```
