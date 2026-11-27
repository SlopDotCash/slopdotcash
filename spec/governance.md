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

### The ledger binds the requirement and release-gate inventory, its maintainers and its recorders

The ledger's owner, maintainers and recorders are configuration, never event
fields: maintainers record completion and approve later phases (PRD section
1), and recorders are maintainers and verification services that report
evidence. A maintainer binds the inventory (the digest of the requirement
and release-gate list in `formal/requirements.json`) and adds one obligation
per requirement, release gate or model; that the obligations equal that
inventory is a shell obligation. Changing the inventory or adding an
obligation voids any completion record.

```quint
type EvidenceKind = Missing | Simulated | FiniteVerified | Proved | Conformant | LiveVerified
  | Failed | Waived | Unavailable | TimedOut | Skipped
type ObligationClass = RequirementObligation | ReleaseGate | ModelObligation
type Obligation = { id: int, obligationClass: ObligationClass, resultRevision: int, kind: EvidenceKind, bound: int,
  recorder: int, reviewer: int, approval: int }
type Ledger = { owner: int, maintainers: List[int], recorders: List[int], revision: int, inventory: str,
  obligations: List[Obligation], blockingDefects: int, completionRevision: int, completedBy: int, phaseApproval: int }
pure def missing(id: int, obligationClass: ObligationClass): Obligation = { id: id, obligationClass: obligationClass,
  resultRevision: 0, kind: Missing, bound: 0, recorder: 0, reviewer: 0, approval: 0 }
pure def cleared(o: Obligation): Obligation = missing(o.id, o.obligationClass)
pure val initial: Ledger = { owner: 1, maintainers: List(1, 2), recorders: List(1, 2, 3), revision: 1, inventory: "",
  obligations: List(), blockingDefects: 0, completionRevision: 0, completedBy: 0, phaseApproval: 0 }
pure def maintainer(l: Ledger, by: int): bool = by > 0 and l.maintainers.includes(by)
pure def known(l: Ledger, id: int): bool = l.obligations.some(o => o.id == id)
pure def canBindInventory(l: Ledger, by: int, inventory: str): bool = maintainer(l, by) and inventory != ""
pure def bindInventory(l: Ledger, by: int, inventory: str): Ledger = { ...l, inventory: inventory, completionRevision: 0 }
pure def canAddObligation(l: Ledger, by: int, id: int, obligationClass: ObligationClass): bool =
  maintainer(l, by) and l.inventory != "" and id > 0 and not(known(l, id))
pure def addObligation(l: Ledger, by: int, id: int, obligationClass: ObligationClass): Ledger =
  { ...l, obligations: l.obligations.append(missing(id, obligationClass)), completionRevision: 0 }
pure def stepConfigurationFixed(before: Ledger, after: Ledger): bool = after.owner == before.owner
  and after.maintainers == before.maintainers and after.recorders == before.recorders
pure def stepObligationsNeverRemoved(before: Ledger, after: Ledger): bool =
  before.obligations.every(o => after.obligations.some(x => x.id == o.id and x.obligationClass == o.obligationClass))
```

### A verification result records its recorder, revision, kind and bound, and a different maintainer reviews it

Real evidence includes tool identities, commands, hashes, finite bounds and
original logs, held outside this ledger; the ledger keeps their recorder,
kind, the revision they were produced against, and the finite bound of a
finite exploration. Only a configured recorder records a result, and only a
maintainer other than that recorder reviews it. A new implementation revision
returns every obligation to missing, and an earlier completion record no
longer applies to it.

```quint
pure def canRecord(l: Ledger, by: int, id: int, revision: int, result: EvidenceKind, bound: int): bool =
  l.recorders.includes(by) and by > 0 and known(l, id) and revision == l.revision and result != Waived and result != Missing
    and bound >= 0 and ((result == FiniteVerified) iff (bound > 0))
pure def record(l: Ledger, by: int, id: int, revision: int, result: EvidenceKind, bound: int): Ledger =
  { ...l, completionRevision: 0, obligations: l.obligations.listMap(o => if (o.id == id)
      { ...o, resultRevision: revision, kind: result, bound: bound, recorder: by, reviewer: 0, approval: 0 } else o) }
pure def canReview(l: Ledger, by: int, id: int): bool = maintainer(l, by) and
  l.obligations.some(o => o.id == id and o.kind != Missing and o.resultRevision == l.revision and o.recorder != by)
pure def review(l: Ledger, by: int, id: int): Ledger =
  { ...l, completionRevision: 0, obligations: l.obligations.listMap(o => if (o.id == id) { ...o, reviewer: by } else o) }
pure def canChangeRevision(l: Ledger, by: int, revision: int): bool = l.recorders.includes(by) and by > 0 and revision > l.revision
pure def changeRevision(l: Ledger, by: int, revision: int): Ledger =
  { ...l, revision: revision, obligations: l.obligations.listMap(o => cleared(o)) }
pure def alwaysEvidenceIdentity(l: Ledger): bool = l.revision > 0 and l.blockingDefects >= 0 and l.obligations.every(o => o.id > 0
  and (o.kind == Missing iff o.resultRevision == 0)
  and (o.kind != Missing implies o.resultRevision == l.revision)
  and ((o.kind == FiniteVerified) iff (o.bound > 0))
  and (o.kind == Waived iff o.approval > 0)
  and ((o.kind != Missing and o.kind != Waived) iff o.recorder > 0)
  and (o.reviewer > 0 implies o.reviewer != o.recorder and l.maintainers.includes(o.reviewer))
  and o.reviewer >= 0)
  and l.completionRevision <= l.revision
  and (l.obligations.length() > 0 implies l.inventory != "")
pure def alwaysUniqueObligations(l: Ledger): bool = l.obligations.every(o => l.obligations.every(x => x.id == o.id implies x == o))
```

### A waiver needs the owner, and simulation, timeout, skip and waiver never pass

Only the repository owner records a waiver (an owner decision gate: no source
names the waiver approver). The PRD permits an exhaustive timeout warning in
the legacy release gate; the 14 November 2026 owner decision lets a manual
release skip proofs (`operations/release.md`). Neither converts a timeout or
a skip into a proof or a finite exploration. A waived obligation is
discharged by the owner's decision, not passed. Models cannot replace
implementation conformance or live provider, deployment and chain checks
(PRD STATE-03): a requirement needs conformance or live evidence, a release
gate needs live evidence, and only a model obligation is discharged by a
proof or finite exploration.

```quint
pure def canWaive(l: Ledger, by: int, id: int, decision: int): bool = by == l.owner and known(l, id) and decision > 0
pure def waive(l: Ledger, by: int, id: int, decision: int): Ledger =
  { ...l, completionRevision: 0, obligations: l.obligations.listMap(o => if (o.id == id)
      { ...o, resultRevision: l.revision, kind: Waived, bound: 0, approval: decision, recorder: 0, reviewer: 0 } else o) }
pure def verified(o: Obligation): bool =
  if (o.obligationClass == RequirementObligation) o.kind == Conformant or o.kind == LiveVerified
  else if (o.obligationClass == ReleaseGate) o.kind == LiveVerified
  else o.kind == Proved or o.kind == Conformant or o.kind == LiveVerified or (o.kind == FiniteVerified and o.bound > 0)
pure def simulatedOnly(o: Obligation): bool = o.kind == Simulated
pure def discharged(o: Obligation): bool = verified(o) or (o.kind == Waived and o.approval > 0)
pure def lawSimulationIsNotVerification(o: Obligation): bool = simulatedOnly(o) implies not(verified(o)) and not(discharged(o))
pure def lawTimeoutIsNotProof(o: Obligation): bool = o.kind == TimedOut implies not(verified(o))
pure def lawSkipIsNotProof(o: Obligation): bool = o.kind == Skipped implies not(verified(o)) and not(discharged(o))
pure def lawWaiverIsNotPassing(o: Obligation): bool = o.kind == Waived implies not(verified(o))
pure def lawModelsCannotReplaceConformance(o: Obligation): bool =
  (o.obligationClass != ModelObligation and (o.kind == Proved or o.kind == FiniteVerified)) implies not(discharged(o))
```

### Blocking defects are resolved before completion

A maintainer records each blocking defect and its resolution. An open
blocking defect voids any completion record.

```quint
pure def canOpenDefect(l: Ledger, by: int): bool = maintainer(l, by) and l.blockingDefects < 9007199254740000
pure def openDefect(l: Ledger, by: int): Ledger = { ...l, blockingDefects: l.blockingDefects + 1, completionRevision: 0 }
pure def canResolveDefect(l: Ledger, by: int): bool = maintainer(l, by) and l.blockingDefects > 0
pure def resolveDefect(l: Ledger, by: int): Ledger = { ...l, blockingDefects: l.blockingDefects - 1 }
```

### MVP completion is a maintainer's record over a fully reviewed, discharged revision

Later phases require a separate maintainer-approved scope after maintainers
record MVP completion in the PRD (PRD section 1). The completion record
covers a bound inventory with at least one requirement and one release gate,
every obligation discharged and independently reviewed at the current
revision, and no open blocking defect. It is bound to the revision it was
made for and to the evidence it saw: a later revision, an inventory change, a
new obligation, any new, reviewed or waived result, or a new blocking defect
needs a new record.

```quint
pure def mvpComplete(l: Ledger): bool = l.inventory != "" and l.blockingDefects == 0
  and l.obligations.some(o => o.obligationClass == RequirementObligation)
  and l.obligations.some(o => o.obligationClass == ReleaseGate)
  and l.obligations.every(o => discharged(o) and o.resultRevision == l.revision
    and (o.kind == Waived or o.reviewer > 0))
pure def canRecordCompletion(l: Ledger, by: int): bool = maintainer(l, by) and mvpComplete(l)
pure def recordCompletion(l: Ledger, by: int): Ledger = { ...l, completionRevision: l.revision, completedBy: by }
pure def completionCurrent(l: Ledger): bool = l.completionRevision == l.revision and maintainer(l, l.completedBy)
pure def canApprovePhase(l: Ledger, by: int, decision: int): bool = maintainer(l, by) and completionCurrent(l) and decision > 0
pure def approvePhase(l: Ledger, by: int, decision: int): Ledger = { ...l, phaseApproval: decision }
pure def laterPhaseAllowed(l: Ledger): bool = completionCurrent(l) and l.phaseApproval > 0
pure def lawUnprovedBlocksCompletion(ledger: Ledger): bool =
  ledger.obligations.some(o => o.kind == Simulated or o.kind == TimedOut) implies not(mvpComplete(ledger))
pure def alwaysCompletionWasEarned(l: Ledger): bool = completionCurrent(l) implies mvpComplete(l)
pure def alwaysPhaseNeedsCompletion(l: Ledger): bool = l.phaseApproval > 0 implies maintainer(l, l.completedBy)
pure def sometimesCompleted(l: Ledger): bool = completionCurrent(l)
pure def sometimesLaterPhase(l: Ledger): bool = laterPhaseAllowed(l)
pure def sometimesWaived(l: Ledger): bool = l.obligations.some(o => o.kind == Waived)
pure def sometimesTimeout(l: Ledger): bool = l.obligations.some(o => o.kind == TimedOut)
pure def sometimesSimulatedBlocksCompletion(l: Ledger): bool = l.obligations.some(o => o.kind == Simulated and o.reviewer > 0) and not(mvpComplete(l))
pure def sometimesProvedRequirementBlocksCompletion(l: Ledger): bool =
  l.obligations.some(o => o.obligationClass == RequirementObligation and o.kind == Proved and o.reviewer > 0) and not(mvpComplete(l))
pure def sometimesDefectBlocksCompletion(l: Ledger): bool = l.blockingDefects > 0 and l.completedBy > 0 and not(completionCurrent(l))
pure def sometimesStaleCompletion(l: Ledger): bool = l.completionRevision > 0 and not(completionCurrent(l))
```

### Simulation samples

These input sets bound simulation only.

```quint
pure val idValues = Set(1, 2)
pure val oValues = Set(missing(1, ModelObligation), { ...missing(1, ModelObligation), resultRevision: 1, kind: Simulated, recorder: 3 },
  { ...missing(1, ModelObligation), resultRevision: 1, kind: Proved, recorder: 3 },
  { ...missing(1, RequirementObligation), resultRevision: 1, kind: Proved, recorder: 3 },
  { ...missing(1, RequirementObligation), resultRevision: 1, kind: Conformant, recorder: 3 },
  { ...missing(1, ReleaseGate), resultRevision: 1, kind: FiniteVerified, bound: 3, recorder: 3 },
  { ...missing(1, ModelObligation), resultRevision: 1, kind: Waived, approval: 1 },
  { ...missing(1, ModelObligation), resultRevision: 1, kind: TimedOut, recorder: 3 },
  { ...missing(1, ModelObligation), resultRevision: 1, kind: Skipped, recorder: 3 })
pure val reviewedRequirement: Obligation = { ...missing(1, RequirementObligation), resultRevision: 1, kind: Conformant, recorder: 3, reviewer: 1 }
pure val reviewedGate: Obligation = { ...missing(2, ReleaseGate), resultRevision: 1, kind: LiveVerified, recorder: 3, reviewer: 1 }
pure val completeLedger: Ledger = { ...initial, inventory: "inv-a", obligations: List(reviewedRequirement, reviewedGate) }
pure val ledgerValues = Set(initial, completeLedger,
  { ...completeLedger, obligations: List(reviewedRequirement, reviewedGate, { ...reviewedRequirement, id: 3, kind: Simulated }) },
  { ...completeLedger, obligations: List(reviewedRequirement, reviewedGate, { ...missing(3, ModelObligation), resultRevision: 1, kind: TimedOut, recorder: 3, reviewer: 1 }) })
pure val byValues = Set(1, 3)
pure val resultValues = Set(Simulated, Proved, Conformant, LiveVerified, TimedOut, Skipped, Failed, FiniteVerified)
pure val revisionValues = Set(1, 2)
pure val boundValues = Set(0, 3)
pure val decisionValues = Set(0, 1)
pure val inventoryValues = Set("", "inv-a")
pure val weight_record = 3
pure val weight_review = 3
pure val weight_addObligation = 2
pure val weight_bindInventory = 1
pure val weight_recordCompletion = 2
pure val weight_approvePhase = 1
pure val weight_changeRevision = 1
pure val eval_witness_sometimesLaterPhase = (
  ("bindInventory", 1, "inv-a"),
  ("addObligation", 1, 1, RequirementObligation),
  ("addObligation", 1, 2, ReleaseGate),
  ("record", 3, 1, 1, Conformant, 0),
  ("review", 1, 1),
  ("record", 3, 2, 1, LiveVerified, 0),
  ("review", 1, 2),
  ("recordCompletion", 1),
  ("approvePhase", 1, 1)
)
pure val eval_witness_sometimesDefectBlocksCompletion = (
  ("bindInventory", 1, "inv-a"),
  ("addObligation", 1, 1, RequirementObligation),
  ("addObligation", 1, 2, ReleaseGate),
  ("record", 3, 1, 1, Conformant, 0),
  ("review", 1, 1),
  ("record", 3, 2, 1, LiveVerified, 0),
  ("review", 1, 2),
  ("recordCompletion", 1),
  ("openDefect", 1)
)
pure val eval_witness_sometimesStaleCompletion = (
  ("bindInventory", 1, "inv-a"),
  ("addObligation", 1, 1, RequirementObligation),
  ("addObligation", 1, 2, ReleaseGate),
  ("record", 3, 1, 1, Conformant, 0),
  ("review", 1, 1),
  ("record", 3, 2, 1, LiveVerified, 0),
  ("review", 1, 2),
  ("recordCompletion", 1),
  ("changeRevision", 3, 2)
)
```
