# Scope and verification evidence

PRD sections 1, 11 and 12. Slop connects accepted open-source work and private
reports to review, Points and reconciled rewards. GitHub owns work acceptance
and repository authority. D1 owns project revisions and private allocations.
Finalized chain evidence establishes deposits, reserves and payments.

## Story: Complete the approved MVP with auditable evidence

### A verification result records the exact source and kind of evidence

Simulation, finite exploration, proof, implementation conformance, live
integration, failure, waiver and unavailability remain distinguishable.
Real evidence includes tool identities, commands, hashes, finite bounds,
original logs and the approval for a waiver.

```quint
type EvidenceKind = Missing | Simulated | FiniteVerified | Proved | Conformant | LiveVerified | Failed | Waived | Unavailable | TimedOut
type Obligation = { source: int, resultSource: int, kind: EvidenceKind, reviewer: int, approval: int }
pure val initial: Obligation = { source: 1, resultSource: 0, kind: Missing, reviewer: 0, approval: 0 }
pure def canRecord(o: Obligation, sourceId: int, result: EvidenceKind): bool = sourceId == o.source and result != Waived and result != Missing
pure def record(o: Obligation, sourceId: int, result: EvidenceKind): Obligation = { ...o, resultSource: sourceId, kind: result, reviewer: 0, approval: 0 }
pure def canWaive(o: Obligation, sourceId: int, ownerApproval: int): bool = sourceId == o.source and ownerApproval > 0
pure def waive(o: Obligation, sourceId: int, ownerApproval: int): Obligation = { ...o, resultSource: sourceId, kind: Waived, approval: ownerApproval, reviewer: 0 }
pure def canReview(o: Obligation, reviewerId: int): bool = o.kind != Missing and o.resultSource == o.source and reviewerId > 0
pure def review(o: Obligation, reviewerId: int): Obligation = { ...o, reviewer: reviewerId }
pure def canChangeSource(o: Obligation, sourceId: int): bool = sourceId > 0 and sourceId != o.source
pure def changeSource(o: Obligation, sourceId: int): Obligation = { source: sourceId, resultSource: 0, kind: Missing, reviewer: 0, approval: 0 }
```

### A reviewed waiver and a bounded timeout never become a passing result

The PRD permits an exhaustive timeout warning in the legacy release gate.
Vibestack retains its required proof stage. Neither rule converts a timeout
into a proof or a successful finite exploration.

```quint
pure def passed(o: Obligation): bool = o.kind == Simulated or o.kind == FiniteVerified or o.kind == Proved or o.kind == Conformant or o.kind == LiveVerified
pure def alwaysEvidenceIdentity(o: Obligation): bool = o.source > 0 and
  (o.kind != Missing implies o.resultSource == o.source) and
  (o.kind == Waived implies o.approval > 0) and o.reviewer >= 0
pure def lawTimeoutIsNotProof(o: Obligation): bool = o.kind == TimedOut implies not(passed(o))
pure def lawWaiverIsNotPassing(o: Obligation): bool = o.kind == Waived implies not(passed(o))
pure def sometimesReviewed(o: Obligation): bool = o.kind == Proved and o.reviewer > 0
pure def sometimesWaived(o: Obligation): bool = o.kind == Waived and o.approval > 0
pure def sometimesTimeout(o: Obligation): bool = o.kind == TimedOut
pure val sourceIdValues = Set(1, 2)
pure val ownerApprovalValues = Set(0, 1)
pure val reviewerIdValues = Set(0, 1, 2)
```

### MVP completion requires reviewed coverage and real workflow evidence

Each field binds to reviewed evidence at the exact implementation revision.
Later phases require a separate owner-approved scope after MVP completion.

```quint
type Completion = { inventoryComplete: bool, modelsReviewed: bool, allTransitionsCovered: bool, proofsComplete: bool, conformant: bool, providerEvidence: bool, chainEvidence: bool, browserEvidence: bool, releaseEvidence: bool, defectsResolved: bool, ownerRecord: bool }
pure def mvpComplete(c: Completion): bool = c.inventoryComplete and c.modelsReviewed and c.allTransitionsCovered and c.proofsComplete and
  c.conformant and c.providerEvidence and c.chainEvidence and c.browserEvidence and c.releaseEvidence and c.defectsResolved and c.ownerRecord
pure def laterPhaseAllowed(c: Completion, phaseApproval: bool): bool = mvpComplete(c) and phaseApproval
pure def lawLaterPhaseNeedsCompletion(c: Completion, phaseApproval: bool): bool = laterPhaseAllowed(c, phaseApproval) implies mvpComplete(c) and phaseApproval
pure val cValues = Set(
  { inventoryComplete: true, modelsReviewed: true, allTransitionsCovered: true, proofsComplete: true, conformant: true, providerEvidence: true, chainEvidence: true, browserEvidence: true, releaseEvidence: true, defectsResolved: true, ownerRecord: true },
  { inventoryComplete: true, modelsReviewed: true, allTransitionsCovered: false, proofsComplete: false, conformant: false, providerEvidence: false, chainEvidence: false, browserEvidence: false, releaseEvidence: false, defectsResolved: false, ownerRecord: false }
)
```
