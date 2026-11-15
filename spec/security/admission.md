# Repository admission scan

PRD section 8 requires one complete successful admission scan of one
immutable repository commit. This machine is one assessment, from the moment
the queue assigns it until the API records its single immutable result
(`vetting_assessments`, migration `0025`: `pending` to exactly one of
`incomplete`, `clean` or `malicious`, never again). The scanner pipeline
(`workers/vetting/run.ts`, `acquire.ts`, `review-plan.ts`, `publication.ts`)
and the signed result intake (`backend/vetting/handler.ts`, `scan-result.ts`)
are its two halves. Counts are exact manifest cardinalities; the shell retains
every chunk's digest, source path and source range, because a count alone is
not evidence of coverage. There is no repository, entry, file, object or run
size refusal.

The enforcement machine ([Project restrictions](./enforcement.md)) reads only
the outcome of a recorded assessment (`outcomeOf` below). The shell supplies it
from the stored assessment row, which it parses through this machine's state
(composition obligation recorded in the area report).

## Story: Review every acquired item before granting admission

A maintainer receives clearance only for the exact fetched commit after all
deterministic checks, contextual review and repository synthesis finish and
the evidence is durably retained.

### An assessment is bound to its queued revision, commit and template

The queue assigns the assessment identity, the repository's permanent GitHub
id, the D1 revision and manifest digest, the integration-branch commit and the
skill-template input digest. The assignment never changes. A result for any
other binding is refused (`commit_mismatch`).

```quint
type Disposition = NoDisposition | DIncomplete | DClean | DMalicious
type Refusal = NoRefusal | RepositoryMissing | RepositoryMoved | PathRefused
type Review = NotRun | ReviewCompleted | ReviewDeclined
type Confirmation = NoConfirmation | ReproducibleBehavior | VerifiedSourceEvidence
type Phase = Queued | Acquiring | Reviewing | Evidence | Publishing | PublicationUnknown | PublicationRejected | Recorded
type Assignment = { assessment: int, repository: int, revision: int, manifestDigest: int, commit: int, template: int, policy: int }
type Scan = { assignment: Assignment, phase: Phase, attempts: int,
  inventory: int, inventoryDigest: int, reviewed: int, deterministic: bool, uncoveredExecutable: int, blocked: int,
  primary: Review, escalated: bool, specialist: Review, synthesis: bool,
  refusal: Refusal, disposition: Disposition, confirmation: Confirmation,
  reused: bool, reuseOrigin: int, retained: bool, recorded: Disposition }
pure val queuedAssignment: Assignment = { assessment: 1, repository: 1, revision: 1, manifestDigest: 1, commit: 1, template: 1, policy: 1 }
pure val initial: Scan = { assignment: queuedAssignment, phase: Queued, attempts: 0,
  inventory: 0, inventoryDigest: 0, reviewed: 0, deterministic: false, uncoveredExecutable: 0, blocked: 0,
  primary: NotRun, escalated: false, specialist: NotRun, synthesis: false,
  refusal: NoRefusal, disposition: NoDisposition, confirmation: NoConfirmation,
  reused: false, reuseOrigin: 0, retained: false, recorded: NoDisposition }
pure def validAssignment(a: Assignment): bool =
  a.assessment > 0 and a.repository > 0 and a.revision > 0 and a.manifestDigest > 0 and a.commit > 0 and a.template > 0 and a.policy > 0
pure def alwaysAssignmentValid(s: Scan): bool = validAssignment(s.assignment)
pure def stepAssignmentFixed(before: Scan, after: Scan): bool = before.assignment == after.assignment
```

### Each attempt starts from nothing and an outage leaves the assessment pending

Starting an attempt clears every per-run fact, so an interrupted or failed
run contributes nothing to the next one. A GitHub, Git transport, model
provider or retention outage, and a killed process, return the assessment to
the queue without consuming it (legacy `vetting_terminal_outcomes`,
`repositoryOutageRemainsPendingTest`, `serviceFailureMayRecoverTest`;
`vetting_acquisition.acquisitionFailureDoesNotConsumeQueueTest`). Readiness
failure is never an incomplete result.

```quint
pure def resetRun(target: Phase, s: Scan): Scan =
  { ...s, phase: target, inventory: 0, inventoryDigest: 0, reviewed: 0, deterministic: false, uncoveredExecutable: 0, blocked: 0,
    primary: NotRun, escalated: false, specialist: NotRun, synthesis: false, refusal: NoRefusal,
    disposition: NoDisposition, confirmation: NoConfirmation, reused: false, reuseOrigin: 0, retained: false }
pure def canStart(s: Scan): bool = s.phase == Queued
pure def start(s: Scan): Scan = { ...resetRun(Acquiring, s), attempts: s.attempts + 1 }
pure def canInterrupt(s: Scan): bool = s.phase == Acquiring or s.phase == Reviewing or s.phase == Evidence
pure def interrupt(s: Scan): Scan = resetRun(Queued, s)
pure def alwaysQueuedHoldsNoRun(s: Scan): bool =
  (s.phase == Queued or s.phase == Acquiring) implies
    s.inventory == 0 and s.reviewed == 0 and s.blocked == 0 and not(s.deterministic) and s.primary == NotRun and
    s.disposition == NoDisposition and not(s.retained) and not(s.reused)
```

### Acquisition binds one shallow fetch of the exact commit

One shallow Git fetch of the assigned commit is verified locally. A missing or
moved repository, and a path-policy refusal of that exact pin, are terminal
incomplete results with no review. A transport failure, timeout or GitHub
outage is retryable.

```quint
type FetchOutcome = Fetched | FetchUnavailable | FetchMissing | FetchMoved | FetchPathRefused
type Fetch = { outcome: FetchOutcome, commit: int, verifiedLocally: bool, entries: int, inventoryDigest: int }
pure def canAcquire(s: Scan, fetch: Fetch): bool =
  s.phase == Acquiring and
  (fetch.outcome != Fetched or
    (fetch.commit == s.assignment.commit and fetch.verifiedLocally and fetch.entries >= 0 and fetch.inventoryDigest > 0))
pure def acquire(s: Scan, fetch: Fetch): Scan =
  if (fetch.outcome == Fetched) { ...s, phase: Reviewing, inventory: fetch.entries, inventoryDigest: fetch.inventoryDigest }
  else if (fetch.outcome == FetchUnavailable) { ...s, phase: Queued }
  else { ...s, phase: Evidence, disposition: DIncomplete,
    refusal: if (fetch.outcome == FetchMissing) RepositoryMissing else if (fetch.outcome == FetchMoved) RepositoryMoved else PathRefused }
pure val fetchValues = Set(
  { outcome: Fetched, commit: 1, verifiedLocally: true, entries: 2, inventoryDigest: 7 },
  { outcome: Fetched, commit: 1, verifiedLocally: true, entries: 1000000, inventoryDigest: 8 },
  { outcome: Fetched, commit: 2, verifiedLocally: true, entries: 2, inventoryDigest: 7 },
  { outcome: Fetched, commit: 1, verifiedLocally: false, entries: 2, inventoryDigest: 7 },
  { outcome: FetchUnavailable, commit: 0, verifiedLocally: false, entries: 0, inventoryDigest: 0 },
  { outcome: FetchMissing, commit: 0, verifiedLocally: false, entries: 0, inventoryDigest: 0 },
  { outcome: FetchMoved, commit: 0, verifiedLocally: false, entries: 0, inventoryDigest: 0 },
  { outcome: FetchPathRefused, commit: 1, verifiedLocally: true, entries: 0, inventoryDigest: 0 })
pure def alwaysRefusalIsIncompleteWithoutReview(s: Scan): bool =
  s.refusal != NoRefusal implies s.disposition == DIncomplete and s.primary == NotRun and s.reviewed == 0
```

### Every reviewed batch covers the next unreviewed inventory entries

The review plan orders entries risky-first; the adapter maps that permutation
onto manifest positions, so a batch is the next contiguous range of positions
and no entry is counted twice. Batch size follows the provider token budget.
Deterministic checks run over every file and every match goes to contextual
model review. Executable content that no check, isolated execution or
specialist review covers is counted and prevents a pass.

```quint
pure def canReviewBatch(s: Scan, count: int): bool = s.phase == Reviewing and count > 0 and count <= s.inventory - s.reviewed
pure def reviewBatch(s: Scan, count: int): Scan = { ...s, reviewed: s.reviewed + count }
pure val countValues = Set(1, 2, 1000000)
pure def canCheckDeterministically(s: Scan, uncovered: int): bool =
  s.phase == Reviewing and not(s.deterministic) and uncovered >= 0 and uncovered + s.blocked <= s.inventory
pure def checkDeterministically(s: Scan, uncovered: int): Scan = { ...s, deterministic: true, uncoveredExecutable: uncovered }
pure val uncoveredValues = Set(0, 1)
pure def alwaysReviewingUndecided(s: Scan): bool =
  s.phase == Reviewing implies s.disposition == NoDisposition and s.refusal == NoRefusal and not(s.retained) and
    not(s.reused) and not(s.synthesis) and s.confirmation == NoConfirmation
pure def alwaysCoverageBounds(s: Scan): bool =
  s.inventory >= 0 and s.reviewed >= 0 and s.reviewed <= s.inventory and
  s.uncoveredExecutable >= 0 and s.blocked >= 0 and s.uncoveredExecutable + s.blocked <= s.inventory
```

### Risky artifacts run in an isolated sandbox without network or secrets

One disposable Cloudflare sandbox runs each risky artifact. The run record
comes from `workers/vetting-sandbox`; its contract requires disabled internet
and no provided secrets, so a run that reports either is refused and covers
nothing. An artifact is released only after a clean static or detonation
analysis; a suspicious or malicious analysis blocks it (`vetting_artifacts`
states `quarantined`, `released`, `blocked`), and a blocked artifact prevents
a clean result.

```quint
type ArtifactAnalysis = StaticClean | DetonationClean | Suspicious | MaliciousBehavior
type SandboxRun = { artifacts: int, internetDisabled: bool, secretsProvided: bool, analysis: ArtifactAnalysis }
pure def canRunIsolated(s: Scan, sandboxRun: SandboxRun): bool =
  s.phase == Reviewing and s.deterministic and sandboxRun.internetDisabled and not(sandboxRun.secretsProvided) and
  sandboxRun.artifacts > 0 and sandboxRun.artifacts <= s.uncoveredExecutable
pure def runIsolated(s: Scan, sandboxRun: SandboxRun): Scan =
  if (sandboxRun.analysis == StaticClean or sandboxRun.analysis == DetonationClean)
    { ...s, uncoveredExecutable: s.uncoveredExecutable - sandboxRun.artifacts }
  else { ...s, uncoveredExecutable: s.uncoveredExecutable - sandboxRun.artifacts, blocked: s.blocked + sandboxRun.artifacts }
pure val sandboxRunValues = Set({ artifacts: 1, internetDisabled: true, secretsProvided: false, analysis: DetonationClean },
  { artifacts: 1, internetDisabled: true, secretsProvided: false, analysis: Suspicious },
  { artifacts: 1, internetDisabled: false, secretsProvided: false, analysis: StaticClean },
  { artifacts: 1, internetDisabled: true, secretsProvided: true, analysis: StaticClean })
```

### The primary and specialist reviews decide clean, incomplete or escalation

The primary review (Surplus Claude Sonnet 5.5 under the 11 November 2026
owner decision) reads the complete assessed inventory. An ambiguous or
high-risk result escalates to a specialist review (GPT-6.1 Terra or a
specialist investigation). A declined review is incomplete. A provider outage
returns the assessment to the queue. A model label never confirms malice.

```quint
type PrimaryOutcome = PrimaryClean | PrimaryEscalate | PrimaryDeclined | PrimaryUnavailable
type SpecialistOutcome = SpecialistClean | SpecialistDeclined | SpecialistUnavailable
pure def canReviewPrimary(s: Scan, primaryOutcome: PrimaryOutcome): bool =
  s.phase == Reviewing and s.deterministic and s.reviewed == s.inventory and s.primary == NotRun
pure def reviewPrimary(s: Scan, primaryOutcome: PrimaryOutcome): Scan =
  if (primaryOutcome == PrimaryUnavailable) resetRun(Queued, s)
  else if (primaryOutcome == PrimaryDeclined) { ...s, primary: ReviewDeclined, phase: Evidence, disposition: DIncomplete }
  else { ...s, primary: ReviewCompleted, escalated: primaryOutcome == PrimaryEscalate }
pure def canReviewSpecialist(s: Scan, specialistOutcome: SpecialistOutcome): bool =
  s.phase == Reviewing and s.primary == ReviewCompleted and s.escalated and s.specialist == NotRun
pure def reviewSpecialist(s: Scan, specialistOutcome: SpecialistOutcome): Scan =
  if (specialistOutcome == SpecialistUnavailable) resetRun(Queued, s)
  else if (specialistOutcome == SpecialistDeclined) { ...s, specialist: ReviewDeclined, phase: Evidence, disposition: DIncomplete }
  else { ...s, specialist: ReviewCompleted }
pure def alwaysDeclinedIsIncomplete(s: Scan): bool =
  (s.primary == ReviewDeclined or s.specialist == ReviewDeclined) implies s.disposition == DIncomplete
pure def alwaysSpecialistOnlyAfterEscalation(s: Scan): bool =
  s.specialist != NotRun implies s.primary == ReviewCompleted and s.escalated
```

### Synthesis decides the repository result and confirmed malice needs trusted evidence

The repository synthesis yields clean only when every entry was reviewed, the
deterministic checks ran, no executable content is uncovered, the primary
review completed and any escalation completed. Anything else is incomplete.
Malice requires a confirmation with basis `reproducible-behavior` or
`verified-source-evidence` from the separate trusted reviewer outside the
guest and model context (`PUBLICATION.md`).

```quint
pure def reviewsComplete(s: Scan): bool =
  s.primary == ReviewCompleted and (not(s.escalated) or s.specialist == ReviewCompleted)
pure def cleanEvidence(s: Scan): bool =
  s.reviewed == s.inventory and s.deterministic and s.uncoveredExecutable == 0 and s.blocked == 0 and reviewsComplete(s) and s.synthesis
pure def canSynthesize(s: Scan): bool = s.phase == Reviewing and s.deterministic and s.reviewed == s.inventory and reviewsComplete(s)
pure def synthesize(s: Scan): Scan =
  { ...s, synthesis: true, phase: Evidence, disposition: if (s.uncoveredExecutable == 0 and s.blocked == 0) DClean else DIncomplete }
pure def canConfirmMalice(s: Scan, confirmation: Confirmation): bool =
  s.phase == Reviewing and s.deterministic and s.primary == ReviewCompleted and confirmation != NoConfirmation
pure def confirmMalice(s: Scan, confirmation: Confirmation): Scan =
  { ...s, phase: Evidence, disposition: DMalicious, confirmation: confirmation }
pure def alwaysMaliceConfirmed(s: Scan): bool = s.disposition == DMalicious implies s.confirmation != NoConfirmation
pure def alwaysCleanComplete(s: Scan): bool =
  s.disposition == DClean implies (s.reused and s.reuseOrigin > 0) or cleanEvidence(s)
```

### A reused clean result cites one original clean, non-reused scan of the same input

The scanner may reuse an original result before fresh isolated execution. The
API compares the stored original row with this assessment: same repository,
acquired-input inventory digest, template and policy; the original is clean,
not itself reused, and its evidence is retained. A reused result never lifts
a flag pause (enforcement reads `reused`).

```quint
type ReuseOrigin = { assessment: int, disposition: Disposition, reused: bool, repository: int,
  inventoryDigest: int, template: int, policy: int, retained: bool }
pure def canReuse(s: Scan, origin: ReuseOrigin): bool =
  s.phase == Reviewing and s.reviewed == 0 and not(s.deterministic) and
  origin.assessment > 0 and origin.assessment != s.assignment.assessment and origin.disposition == DClean and
  not(origin.reused) and origin.retained and origin.repository == s.assignment.repository and
  origin.inventoryDigest == s.inventoryDigest and origin.template == s.assignment.template and origin.policy == s.assignment.policy
pure def reuse(s: Scan, origin: ReuseOrigin): Scan =
  { ...s, phase: Evidence, disposition: DClean, reused: true, reuseOrigin: origin.assessment }
pure val originValues = Set(
  { assessment: 9, disposition: DClean, reused: false, repository: 1, inventoryDigest: 7, template: 1, policy: 1, retained: true },
  { assessment: 9, disposition: DClean, reused: true, repository: 1, inventoryDigest: 7, template: 1, policy: 1, retained: true },
  { assessment: 9, disposition: DClean, reused: false, repository: 1, inventoryDigest: 8, template: 1, policy: 1, retained: true },
  { assessment: 9, disposition: DIncomplete, reused: false, repository: 1, inventoryDigest: 7, template: 1, policy: 1, retained: true })
pure def alwaysReuseCitesOrigin(s: Scan): bool = s.reused implies s.reuseOrigin > 0 and s.reuseOrigin != s.assignment.assessment
```

### Evidence durability precedes a clean or malicious publication

Objects use SHA-256 identities, 8 MiB upload parts and a complete private R2
manifest (`backend/vetting/EVIDENCE.md`). Retention runs after the
disposition, so it covers every batch the result relies on. A clean or
malicious result whose retention failed returns to the queue; an incomplete
result may record failed retention (legacy `cleanCannotRecordFailedRetentionTest`,
`incompleteCanRecordFailedRetentionTest`). Successful admission evidence is
retained permanently under the 27 October 2026 owner decision.

```quint
type Retention = Stored | StoreFailed
pure def canRetain(s: Scan, retention: Retention): bool = s.phase == Evidence and s.disposition != NoDisposition
pure def retain(s: Scan, retention: Retention): Scan =
  if (retention == Stored) { ...s, retained: true, phase: Publishing }
  else if (s.disposition == DIncomplete) { ...s, retained: false, phase: Publishing }
  else resetRun(Queued, s)
pure def alwaysPublishingDecided(s: Scan): bool =
  (s.phase == Publishing or s.phase == PublicationUnknown or s.phase == PublicationRejected or s.phase == Recorded) implies
    s.disposition != NoDisposition and (s.disposition == DIncomplete or s.retained)
```

### Publication sends once, keeps uncertainty and records the result exactly once

The publication journal reserves one intent per assessment before the single
signed request. The API verifies the Ed25519 signature against
`VETTING_RESULT_PUBLIC_KEYS` and the assignment, then records the result. A
lost or malformed response stays unknown, and a later call refuses to send
again; only the stored assessment row reconciles it. A rejected attempt stays
recorded until an operator inspects it and requeues the run. A recorded result
never changes.

```quint
type Receipt = ReceiptAccepted | ReceiptRejected | ReceiptLost
type RecordRead = RecordMatches | RecordStillPending | RecordUnavailable
pure def canPublish(s: Scan, receipt: Receipt): bool = s.phase == Publishing
pure def publish(s: Scan, receipt: Receipt): Scan =
  if (receipt == ReceiptAccepted) { ...s, phase: Recorded, recorded: s.disposition }
  else if (receipt == ReceiptRejected) { ...s, phase: PublicationRejected }
  else { ...s, phase: PublicationUnknown }
pure def canReconcile(s: Scan, read: RecordRead): bool = s.phase == PublicationUnknown
pure def reconcile(s: Scan, read: RecordRead): Scan =
  if (read == RecordMatches) { ...s, phase: Recorded, recorded: s.disposition } else s
pure def canRequeueRejected(s: Scan): bool = s.phase == PublicationRejected
pure def requeueRejected(s: Scan): Scan = resetRun(Queued, s)
pure def alwaysRecordedOnlyWhenRecorded(s: Scan): bool = (s.recorded != NoDisposition) iff (s.phase == Recorded)
pure def alwaysRecordedMatchesDisposition(s: Scan): bool = s.phase == Recorded implies s.recorded == s.disposition
pure def stepRecordedImmutable(before: Scan, after: Scan): bool = before.phase == Recorded implies after == before
pure def stepUnknownNeverResends(before: Scan, via: str, after: Scan): bool =
  before.phase == PublicationUnknown implies (via == "reconcile" or after == before)
pure def stepAttemptsCount(before: Scan, after: Scan): bool = after.attempts >= before.attempts
```

### The outcome is what enforcement reads

```quint
type Outcome = { assessment: int, repository: int, revision: int, disposition: Disposition, reused: bool, retained: bool }
pure def isRecorded(s: Scan): bool = s.phase == Recorded
pure def outcomeOf(s: Scan): Outcome =
  { assessment: s.assignment.assessment, repository: s.assignment.repository, revision: s.assignment.revision,
    disposition: s.recorded, reused: s.reused, retained: s.retained }
pure def validOutcome(o: Outcome): bool =
  o.assessment > 0 and o.repository > 0 and o.revision > 0 and o.disposition != NoDisposition and
  (o.disposition == DIncomplete or o.retained)
pure def lawRecordedOutcomeValid(s: Scan): bool =
  (isRecorded(s) and alwaysPublishingDecided(s) and alwaysRecordedMatchesDisposition(s) and alwaysAssignmentValid(s))
    implies validOutcome(outcomeOf(s))
pure val sValues = Set(initial, { ...initial, phase: Recorded, disposition: DClean, recorded: DClean, retained: true })
pure def sometimesCleanRecorded(s: Scan): bool = s.phase == Recorded and s.recorded == DClean and not(s.reused)
pure def sometimesReusedClean(s: Scan): bool = s.phase == Recorded and s.recorded == DClean and s.reused
pure def sometimesIncompleteRecorded(s: Scan): bool = s.phase == Recorded and s.recorded == DIncomplete
pure def sometimesRefusedIncomplete(s: Scan): bool = s.phase == Recorded and s.refusal == RepositoryMoved
pure def sometimesMaliciousRecorded(s: Scan): bool = s.phase == Recorded and s.recorded == DMalicious
pure def sometimesRetriedAfterOutage(s: Scan): bool = s.phase == Recorded and s.attempts >= 2
pure def sometimesPublicationUnknown(s: Scan): bool = s.phase == PublicationUnknown
pure def sometimesUncoveredIncomplete(s: Scan): bool = s.disposition == DIncomplete and s.synthesis
pure def sometimesBlockedArtifactIncomplete(s: Scan): bool = s.phase == Recorded and s.recorded == DIncomplete and s.blocked > 0
```

### Simulation weights steer runs to each outcome

These sets and weights bound simulation only.

```quint
pure val weight_acquire = 4
pure val weight_reviewBatch = 4
pure val weight_checkDeterministically = 3
pure val weight_reviewPrimary = 3
pure val weight_synthesize = 3
pure val weight_retain = 3
pure val weight_publish = 3
pure val weight_start = 3
```

A clean assessment records only the evaluated commit. Routine later changes
retain admission under policy without claiming the changed bytes were
scanned; a different immutable repository identity needs its own admission
(enforcement). The approved provider fallback order of the 11 November 2026
owner decision (Orbio first, then Surplus) is a provider-routing shell
obligation, not modeled here.
