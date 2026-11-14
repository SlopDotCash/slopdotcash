# Scope and verification evidence

PRD sections 1, 11 and 12 (STATE-01 to STATE-05) and CLAUDE.md "Scope and
contribution rules" and "Working rules". Slop connects accepted open-source
work and private reports to review, Points and reconciled rewards. GitHub
owns work acceptance and repository authority. D1 owns project revisions and
private allocations. Finalized chain evidence establishes deposits, reserves
and payments.

This unit is the verification ledger of one implementation revision. It
records evidence; it does not produce it. Simulation, exhaustive finite
exploration, proof, implementation conformance and live integration stay
distinct, and model simulation alone proves neither source refinement nor the
absence of every application state error. The Vibestack acceptance record is
`spec/lock.json`, written only by `pnpm accept`; nothing here substitutes for
it.

## Story: Complete the approved MVP with auditable evidence

### A verification result records the exact revision, kind and bound of its evidence

Real evidence includes tool identities, commands, hashes, finite bounds and
original logs, held outside this ledger; the ledger keeps their kind, the
revision they were produced against, and the finite bound of a finite
exploration. A new implementation revision returns every obligation to
missing, and an earlier completion record no longer applies to it.

```quint
type EvidenceKind = Missing | Simulated | FiniteVerified | Proved | Conformant | LiveVerified
  | Failed | Waived | Unavailable | TimedOut | Skipped
type Obligation = { id: int, resultRevision: int, kind: EvidenceKind, bound: int, reviewer: int, approval: int }
type Ledger = { owner: int, revision: int, obligations: List[Obligation], completionRevision: int, completedBy: int,
  phaseApproval: int }
pure def missing(id: int): Obligation = { id: id, resultRevision: 0, kind: Missing, bound: 0, reviewer: 0, approval: 0 }
pure val initial: Ledger = { owner: 1, revision: 1, obligations: List(missing(1), missing(2)),
  completionRevision: 0, completedBy: 0, phaseApproval: 0 }
pure def known(l: Ledger, id: int): bool = l.obligations.some(o => o.id == id)
pure def canRecord(l: Ledger, id: int, revision: int, result: EvidenceKind, bound: int): bool =
  known(l, id) and revision == l.revision and result != Waived and result != Missing and bound >= 0
    and ((result == FiniteVerified) iff (bound > 0))
pure def record(l: Ledger, id: int, revision: int, result: EvidenceKind, bound: int): Ledger =
  { ...l, completionRevision: 0, obligations: l.obligations.listMap(o => if (o.id == id)
      { ...o, resultRevision: revision, kind: result, bound: bound, reviewer: 0, approval: 0 } else o) }
pure def canReview(l: Ledger, by: int, id: int): bool = by > 0 and
  l.obligations.some(o => o.id == id and o.kind != Missing and o.resultRevision == l.revision)
pure def review(l: Ledger, by: int, id: int): Ledger =
  { ...l, obligations: l.obligations.listMap(o => if (o.id == id) { ...o, reviewer: by } else o) }
pure def canChangeRevision(l: Ledger, revision: int): bool = revision > l.revision
pure def changeRevision(l: Ledger, revision: int): Ledger =
  { ...l, revision: revision, obligations: l.obligations.listMap(o => missing(o.id)) }
pure def alwaysEvidenceIdentity(l: Ledger): bool = l.revision > 0 and l.obligations.every(o => o.id > 0
  and (o.kind == Missing iff o.resultRevision == 0)
  and (o.kind != Missing implies o.resultRevision == l.revision)
  and ((o.kind == FiniteVerified) iff (o.bound > 0))
  and (o.kind == Waived iff o.approval > 0) and o.reviewer >= 0)
  and l.completionRevision <= l.revision
pure def alwaysUniqueObligations(l: Ledger): bool = l.obligations.every(o => l.obligations.every(x => x.id == o.id implies x == o))
```

### A waiver needs the owner, and simulation, timeout, skip and waiver never pass

Only the repository owner records a waiver; the owner identity is
configuration of the ledger, never an event field. The PRD permits an
exhaustive timeout warning in the legacy release gate; the 14 November 2026
owner decision lets a manual release skip proofs (`operations/release.md`).
Neither converts a timeout or a skip into a proof or a finite exploration. A
waived obligation is discharged by the owner's decision, not passed.

```quint
pure def canWaive(l: Ledger, by: int, id: int, decision: int): bool = by == l.owner and known(l, id) and decision > 0
pure def waive(l: Ledger, by: int, id: int, decision: int): Ledger =
  { ...l, completionRevision: 0, obligations: l.obligations.listMap(o => if (o.id == id)
      { ...o, resultRevision: l.revision, kind: Waived, bound: 0, approval: decision, reviewer: 0 } else o) }
pure def verified(o: Obligation): bool = o.kind == Proved or o.kind == Conformant or o.kind == LiveVerified
  or (o.kind == FiniteVerified and o.bound > 0)
pure def simulatedOnly(o: Obligation): bool = o.kind == Simulated
pure def discharged(o: Obligation): bool = verified(o) or (o.kind == Waived and o.approval > 0)
pure def lawSimulationIsNotVerification(o: Obligation): bool = simulatedOnly(o) implies not(verified(o)) and not(discharged(o))
pure def lawTimeoutIsNotProof(o: Obligation): bool = o.kind == TimedOut implies not(verified(o))
pure def lawSkipIsNotProof(o: Obligation): bool = o.kind == Skipped implies not(verified(o)) and not(discharged(o))
pure def lawWaiverIsNotPassing(o: Obligation): bool = o.kind == Waived implies not(verified(o))
```

### MVP completion is the owner's record over a fully reviewed, discharged revision

Later phases require a separate owner-approved scope after maintainers record
MVP completion in the PRD. The completion record is bound to the revision it
was made for and to the evidence it saw: a later revision, or any new or
waived result, needs a new record.

```quint
pure def mvpComplete(l: Ledger): bool = l.obligations.length() > 0 and
  l.obligations.every(o => discharged(o) and o.reviewer > 0 and o.resultRevision == l.revision)
pure def canRecordCompletion(l: Ledger, by: int): bool = by == l.owner and mvpComplete(l)
pure def recordCompletion(l: Ledger, by: int): Ledger = { ...l, completionRevision: l.revision, completedBy: by }
pure def completionCurrent(l: Ledger): bool = l.completionRevision == l.revision and l.completedBy == l.owner
pure def canApprovePhase(l: Ledger, by: int, decision: int): bool = by == l.owner and completionCurrent(l) and decision > 0
pure def approvePhase(l: Ledger, by: int, decision: int): Ledger = { ...l, phaseApproval: decision }
pure def laterPhaseAllowed(l: Ledger): bool = completionCurrent(l) and l.phaseApproval > 0
pure def alwaysCompletionWasEarned(l: Ledger): bool = completionCurrent(l) implies mvpComplete(l)
pure def alwaysPhaseNeedsCompletion(l: Ledger): bool = l.phaseApproval > 0 implies l.completedBy == l.owner
pure def stepOwnerFixed(before: Ledger, after: Ledger): bool = after.owner == before.owner
pure def sometimesCompleted(l: Ledger): bool = completionCurrent(l)
pure def sometimesLaterPhase(l: Ledger): bool = laterPhaseAllowed(l)
pure def sometimesWaived(l: Ledger): bool = l.obligations.some(o => o.kind == Waived)
pure def sometimesTimeout(l: Ledger): bool = l.obligations.some(o => o.kind == TimedOut)
pure def sometimesSimulatedBlocksCompletion(l: Ledger): bool = l.obligations.some(o => o.kind == Simulated and o.reviewer > 0) and not(mvpComplete(l))
pure def sometimesStaleCompletion(l: Ledger): bool = l.completionRevision > 0 and not(completionCurrent(l))
pure val idValues = Set(1, 2)
pure val oValues = Set(missing(1), { ...missing(1), resultRevision: 1, kind: Simulated }, { ...missing(1), resultRevision: 1, kind: Proved },
  { ...missing(1), resultRevision: 1, kind: Waived, approval: 1 }, { ...missing(1), resultRevision: 1, kind: TimedOut },
  { ...missing(1), resultRevision: 1, kind: Skipped }, { ...missing(1), resultRevision: 1, kind: FiniteVerified, bound: 3 })
pure val byValues = Set(1, 2)
pure val revisionValues = Set(1, 2)
pure val boundValues = Set(0, 3)
pure val decisionValues = Set(0, 1)
pure val weight_record = 6
pure val weight_review = 6
pure val weight_recordCompletion = 4
```
