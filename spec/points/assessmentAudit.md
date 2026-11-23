# Read-only historical assessment audit and replay

The reviewed historical workflow of `development` (#3170, #3201, #3240, #3254) has
two read-only operations beside `publish-reviewed`: `audit-assessments` and
`replay-assessments` (`scripts/run-reviewed-historical-points.ts`,
`historical-assessment-catalog.ts`, `historical-assessment-reconciliation.ts`,
`historical-value-replay.ts`, `historical-closed-review-source.ts`,
`historical-replay-review.ts`, `historical-assessment-transport.ts` and the
legacy `historical_assessment_audit` model). This machine is one such run:
it reads both assessment catalogs (the joint `slopbot_work_unit_journal` and
the legacy `slopbot_value_journal`) at one captured cut against the pinned
project, and reports a conclusion only at a complete, current cut. Each
event below is the runner's own verified result, never a request's. A run
writes nothing to the Points journal; its receipt
(`RUNNER_TEMP/historical-assessment-audit/receipt.json`, mode 0600, created
exclusively) holds only the status, digests and counts, and the workflow
uploads it as `historical-assessment-{audit|replay}-<attempt>` for 14 days.
A [reviewed packet](./reviewedHistory.md) applies only with the replay
qualification such a run produces.

## Story: Audit the assessments of a historical scope before owner review

> As the repository owner, I want a read-only audit of every assessment in a
> historical scope, and a replay of what they change, so that I review a
> packet only against a complete and current catalog.

### A read-only assessment audit reports a conclusion only at a complete, current journal cut

A run starts only from a trusted dispatch on `main`, with the exact pinned
scope verified (project id `^[a-z0-9][a-z0-9-]{0,63}$`, the source audit and
Points baseline digests, the complete current single-repository registry
revision, the live public repository identity and the reconstructed census
digest) and no packet to apply; it captures the number of joint and legacy
records at both journal heads. Each record is then read once and classified:
invalid, or active in scope. The cut is complete when no record is invalid
and both counts were read. A checkpoint change that affects the scope
(an assessment appended in it, the baseline, the registry revision or the
enforcement generation) makes the cut stale, and a stale cut is never
sealed; an unrelated append changes nothing. Sealing a complete cut yields
`no-scoped-active-assessments` when nothing relevant was read and
`requires-value-replay` otherwise; anything else, or a rejected binding
below, is `incomplete`, which prints the report and fails "Assessment
catalog could not be reconciled".

```quint
type AuditPhase = AuditIdle | AuditReading | AuditStaged | AuditSealed
type AuditStatus = AuditUnsealed | NoScopedActiveAssessments | RequiresValueReplay | AuditIncomplete
type AuditDispatch = TrustedMainDispatch | OtherDispatch
type AssessmentAudit = { phase: AuditPhase, jointExpected: int, legacyExpected: int, jointRead: int, legacyRead: int,
  invalid: bool, relevant: bool, cutCurrent: bool, status: AuditStatus, reviewAvailable: bool, boundClosureReview: bool,
  retainedRemovedMerge: bool, rejectedRemovedMerge: bool, rejectedClosureReview: bool }
pure val initial: AssessmentAudit = { phase: AuditIdle, jointExpected: 0, legacyExpected: 0, jointRead: 0, legacyRead: 0,
  invalid: false, relevant: false, cutCurrent: true, status: AuditUnsealed, reviewAvailable: false, boundClosureReview: false,
  retainedRemovedMerge: false, rejectedRemovedMerge: false, rejectedClosureReview: false }
pure def catalogsComplete(a: AssessmentAudit): bool =
  not(a.invalid) and a.jointRead == a.jointExpected and a.legacyRead == a.legacyExpected
pure def bindingRejected(a: AssessmentAudit): bool = a.rejectedClosureReview or a.rejectedRemovedMerge
pure def sealedStatus(a: AssessmentAudit): AuditStatus =
  if (catalogsComplete(a) and not(bindingRejected(a))) (if (a.relevant) RequiresValueReplay else NoScopedActiveAssessments)
  else AuditIncomplete
pure def canCapture(a: AssessmentAudit, scoped: bool, applyRequested: bool, jointCount: int, legacyCount: int, by: AuditDispatch): bool =
  a.phase == AuditIdle and by == TrustedMainDispatch and scoped and not(applyRequested) and jointCount >= 0 and legacyCount >= 0
pure def capture(a: AssessmentAudit, scoped: bool, applyRequested: bool, jointCount: int, legacyCount: int, by: AuditDispatch): AssessmentAudit =
  { ...a, phase: AuditReading, jointExpected: jointCount, legacyExpected: legacyCount }
pure def canObserve(a: AssessmentAudit, joint: bool, valid: bool, activeInScope: bool): bool =
  a.phase == AuditReading and (if (joint) a.jointRead < a.jointExpected else a.legacyRead < a.legacyExpected)
pure def observe(a: AssessmentAudit, joint: bool, valid: bool, activeInScope: bool): AssessmentAudit =
  { ...a, jointRead: if (joint) a.jointRead + 1 else a.jointRead, legacyRead: if (joint) a.legacyRead else a.legacyRead + 1,
    invalid: a.invalid or not(valid), relevant: a.relevant or activeInScope }
pure def canChangeCheckpoint(a: AssessmentAudit, affectsScope: bool): bool = a.phase == AuditReading or a.phase == AuditStaged
pure def changeCheckpoint(a: AssessmentAudit, affectsScope: bool): AssessmentAudit =
  { ...a, cutCurrent: a.cutCurrent and not(affectsScope) }
pure def canSeal(a: AssessmentAudit): bool = (a.phase == AuditReading or a.phase == AuditStaged) and a.cutCurrent
pure def seal(a: AssessmentAudit): AssessmentAudit =
  { ...a, phase: AuditSealed, reviewAvailable: a.phase == AuditStaged, status: sealedStatus(a) }
pure def alwaysReadsBounded(a: AssessmentAudit): bool =
  a.jointExpected >= 0 and a.legacyExpected >= 0 and a.jointRead >= 0 and a.legacyRead >= 0 and
  a.jointRead <= a.jointExpected and a.legacyRead <= a.legacyExpected
pure def alwaysIdleUnread(a: AssessmentAudit): bool =
  a.phase == AuditIdle implies (a.jointRead == 0 and a.legacyRead == 0 and not(a.invalid) and not(a.relevant) and a.cutCurrent and
    not(a.boundClosureReview) and not(a.retainedRemovedMerge) and not(bindingRejected(a)))
pure def alwaysStatusOnlyWhenSealed(a: AssessmentAudit): bool =
  (a.status != AuditUnsealed iff a.phase == AuditSealed) and (a.reviewAvailable implies a.phase == AuditSealed)
pure def alwaysConclusionAtCompleteCut(a: AssessmentAudit): bool =
  (a.status == NoScopedActiveAssessments implies (catalogsComplete(a) and not(a.relevant))) and
  (a.status == RequiresValueReplay implies (catalogsComplete(a) and a.relevant)) and
  (a.phase == AuditSealed implies a.cutCurrent)
pure def sometimesNothingScoped(a: AssessmentAudit): bool = a.status == NoScopedActiveAssessments
pure def sometimesValueReplayRequired(a: AssessmentAudit): bool = a.status == RequiresValueReplay
pure def sometimesIncompleteCut(a: AssessmentAudit): bool = a.status == AuditIncomplete
pure def sometimesStaleCut(a: AssessmentAudit): bool = a.phase == AuditReading and not(a.cutCurrent)
pure val scopedValues = Set(true, false)
pure val applyRequestedValues = Set(false, true)
pure val jointCountValues = Set(0, 1)
pure val legacyCountValues = Set(0, 1)
pure val byValues = Set(TrustedMainDispatch, OtherDispatch)
```

### An empty legacy closure is accounted for without a value replay only from exact unmerged-closure evidence

An active legacy value record for a closed-unmerged pull request in the
audit window that the merged census does not contain is accounted for
without a value replay award only when the original record (no
`supersedes`) has no implementation or review credit (tier null, no
reviews, assessed no earlier than the closure), the Points checkpoint the
audit is bound to has no positive award for the source (neither its node id
nor its pull request URL), and both GitHub interfaces verify the exact
unmerged closure: GraphQL reads the same closed, unmerged pull request, head
and public repository with no formal reviews, and REST reads the same
closure, head, base policy commit and repository, with the archived
test-merge SHA compared exactly as recorded (it never establishes
acceptance). The record then stays bound to the audit receipt
(`emptyLegacyClosures`), outside the merged census, the relevant records
and the approved closed-review sources. Any condition that does not hold
leaves the record missing from the merged audit, so the cut is incomplete.
A replay that would change Points, payment basis or retained provenance by
leaving that source out refuses (#3254).

```quint
pure def emptyLegacyClosureAccounted(exactClosure: bool, emptyAssessment: bool, noFormalReviews: bool, noPriorAward: bool): bool =
  exactClosure and emptyAssessment and noFormalReviews and noPriorAward
pure def canObserveEmptyLegacyClosure(a: AssessmentAudit, exactClosure: bool, emptyAssessment: bool, noFormalReviews: bool, noPriorAward: bool): bool =
  canObserve(a, false, emptyLegacyClosureAccounted(exactClosure, emptyAssessment, noFormalReviews, noPriorAward), false)
pure def observeEmptyLegacyClosure(a: AssessmentAudit, exactClosure: bool, emptyAssessment: bool, noFormalReviews: bool, noPriorAward: bool): AssessmentAudit =
  observe(a, false, emptyLegacyClosureAccounted(exactClosure, emptyAssessment, noFormalReviews, noPriorAward), false)
pure def lawFormalReviewOrPriorAwardKeepsLegacyClosureOpen(exactClosure: bool, emptyAssessment: bool, noFormalReviews: bool, noPriorAward: bool): bool =
  (not(noFormalReviews) or not(noPriorAward)) implies not(emptyLegacyClosureAccounted(exactClosure, emptyAssessment, noFormalReviews, noPriorAward))
pure val exactClosureValues = Set(true, false)
pure val emptyAssessmentValues = Set(true, false)
pure val noFormalReviewsValues = Set(true, false)
pure val noPriorAwardValues = Set(true, false)
```

### A closed review and a removed accepted merge bind only from exact public evidence

At a complete cut with a relevant record, a closed-unmerged pull request's
review binds only when GitHub's public closure reads match its recorded
lifecycle, it has an audited merged anchor or a standalone review-only joint
record (one source, no implementation claims, one review-only unit), the
source is exact, the assessed review and its actor are the same, and the
review was submitted before the close (#3201; a replay may leave out one
same-repository related pull request created after the recorded assessment
when both digests still match). An accepted pull request GitHub no longer
returns keeps its prior Points only with native merge ancestry on the
registered integration branch, the same prior canonical award, GitHub's
confirmation that the public source is missing, the unavailable-source hold
over the whole assessment, and no change to any award of that group,
independent corrections in the packet included (#3240,
`assertRemovedMergeGroupsPreserved`). Any binding that does not match is
recorded as rejected: the receipt is then incomplete and nothing is staged.

```quint
type ClosureEvidence = { matchingLifecycle: bool, auditedMergedAnchor: bool, standaloneReviewOnlyRecord: bool,
  exactSource: bool, sameAssessedReviewAndActor: bool, beforeClose: bool, reviewOnly: bool }
type RemovedMergeEvidence = { nativeAcceptance: bool, exactPriorAward: bool, wholeGroupHeld: bool, preservedAwards: bool }
pure def closureBinds(e: ClosureEvidence): bool =
  e.matchingLifecycle and (e.auditedMergedAnchor or e.standaloneReviewOnlyRecord) and e.exactSource and
  e.sameAssessedReviewAndActor and e.beforeClose and e.reviewOnly
pure def removedMergeBinds(e: RemovedMergeEvidence): bool =
  e.nativeAcceptance and e.exactPriorAward and e.wholeGroupHeld and e.preservedAwards
pure def canBindClosureReview(a: AssessmentAudit, closure: ClosureEvidence): bool =
  a.phase == AuditReading and catalogsComplete(a) and a.relevant
pure def bindClosureReview(a: AssessmentAudit, closure: ClosureEvidence): AssessmentAudit =
  { ...a, boundClosureReview: a.boundClosureReview or closureBinds(closure),
    rejectedClosureReview: a.rejectedClosureReview or not(closureBinds(closure)) }
pure def canBindRemovedMerge(a: AssessmentAudit, removal: RemovedMergeEvidence): bool =
  a.phase == AuditReading and catalogsComplete(a) and a.relevant
pure def bindRemovedMerge(a: AssessmentAudit, removal: RemovedMergeEvidence): AssessmentAudit =
  { ...a, retainedRemovedMerge: a.retainedRemovedMerge or removedMergeBinds(removal),
    rejectedRemovedMerge: a.rejectedRemovedMerge or not(removedMergeBinds(removal)) }
pure def alwaysBindingsAtCompleteRelevantCut(a: AssessmentAudit): bool =
  ((a.boundClosureReview or a.retainedRemovedMerge or bindingRejected(a)) implies (catalogsComplete(a) and a.relevant))
pure def alwaysRejectedBindingNeverQualifies(a: AssessmentAudit): bool =
  bindingRejected(a) implies (not(a.reviewAvailable) and a.status != RequiresValueReplay and a.phase != AuditStaged)
pure def sometimesClosureReviewBound(a: AssessmentAudit): bool = a.boundClosureReview and a.reviewAvailable
pure def sometimesRemovedMergeRetained(a: AssessmentAudit): bool = a.retainedRemovedMerge and a.phase == AuditSealed
pure def sometimesRejectedBindingIncomplete(a: AssessmentAudit): bool = bindingRejected(a) and a.status == AuditIncomplete
pure val goodClosure: ClosureEvidence = { matchingLifecycle: true, auditedMergedAnchor: true, standaloneReviewOnlyRecord: false,
  exactSource: true, sameAssessedReviewAndActor: true, beforeClose: true, reviewOnly: true }
pure val goodRemoval: RemovedMergeEvidence = { nativeAcceptance: true, exactPriorAward: true, wholeGroupHeld: true,
  preservedAwards: true }
pure def lawPostCloseReviewRefused(closure: ClosureEvidence): bool = not(closure.beforeClose) implies not(closureBinds(closure))
pure def lawStandaloneRecordAnchorsAReview(closure: ClosureEvidence): bool =
  closure == { ...goodClosure, auditedMergedAnchor: false, standaloneReviewOnlyRecord: true } implies closureBinds(closure)
pure def lawChangedHeldGroupRefused(removal: RemovedMergeEvidence): bool =
  not(removal.preservedAwards) implies not(removedMergeBinds(removal))
pure val closureValues = Set(goodClosure, { ...goodClosure, auditedMergedAnchor: false, standaloneReviewOnlyRecord: true },
  { ...goodClosure, auditedMergedAnchor: false }, { ...goodClosure, beforeClose: false }, { ...goodClosure, reviewOnly: false },
  { ...goodClosure, sameAssessedReviewAndActor: false })
pure val removalValues = Set(goodRemoval, { ...goodRemoval, nativeAcceptance: false }, { ...goodRemoval, wholeGroupHeld: false },
  { ...goodRemoval, preservedAwards: false })
```

### A replay qualifies only an exact merged scope, and its private review is staged only on request after exact readback

`replay-assessments` replays the canonical scorer in historical mode against
the frozen catalog and the complete census, projects the value changes,
verifies the closed reviews and computes the qualification digest, which
binds the value changes and their provenance and never collector timing.
Its private review bundle (the source audit, value snapshot, value keys and
qualification, unsigned) is staged through the encrypted private packet
transport only when the dispatch asks for it (`stage_review_handoff`), only
at a current complete cut with no rejected binding, and only after reading
the staged bundle back exactly; a scope change after staging still refuses
the receipt. Only a sealed run that staged its bundle makes the review
available, and `historical-replay-review.ts RECEIPT OUTPUT` then retrieves
that exact bundle for an authorized operator.

```quint
pure def canStageReview(a: AssessmentAudit, explicit: bool, qualified: bool, verifiedReadback: bool): bool =
  a.phase == AuditReading and a.cutCurrent and catalogsComplete(a) and not(bindingRejected(a)) and explicit and qualified and
  verifiedReadback
pure def stageReview(a: AssessmentAudit, explicit: bool, qualified: bool, verifiedReadback: bool): AssessmentAudit =
  { ...a, phase: AuditStaged }
pure def alwaysStagedAtCompleteCut(a: AssessmentAudit): bool =
  a.phase == AuditStaged implies (catalogsComplete(a) and not(bindingRejected(a)))
pure def alwaysReviewOnlyFromCurrentCompleteCut(a: AssessmentAudit): bool =
  a.reviewAvailable implies (a.phase == AuditSealed and catalogsComplete(a) and a.cutCurrent and not(bindingRejected(a)))
pure def stepSealedRunFixed(before: AssessmentAudit, after: AssessmentAudit): bool = before.phase == AuditSealed implies after == before
pure def sometimesReviewAvailable(a: AssessmentAudit): bool = a.reviewAvailable
pure def sometimesStagedThenStale(a: AssessmentAudit): bool = a.phase == AuditStaged and not(a.cutCurrent)
pure val explicitValues = Set(true, false)
pure val qualifiedValues = Set(true, false)
pure val verifiedReadbackValues = Set(true, false)
pure val eval_witness_sometimesClosureReviewBound = (("capture", true, false, 1, 0, TrustedMainDispatch),
  ("observe", true, true, true, TrustedMainDispatch), ("bindClosureReview", goodClosure, TrustedMainDispatch),
  ("stageReview", true, true, true, TrustedMainDispatch), ("seal", TrustedMainDispatch))
```
