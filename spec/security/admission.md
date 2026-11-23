# Repository admission scan

PRD section 8 requires one complete successful admission scan of one
immutable repository commit. This machine is one assessment, from the moment
the queue assigns it until the API records its single immutable result
(`vetting_assessments`, migration `0025`: `pending` to exactly one of
`incomplete`, `clean` or `malicious`, never again). The scanner pipeline
(`workers/vetting/run.ts`, `acquire.ts`, `review-plan.ts`, `publication.ts`,
`publication-journal.ts`) and the signed result intake
(`backend/vetting/handler.ts`, `scan-result.ts`) are its two halves, and the
[scheduled controller](./scanController.md) dispatches the scanner. Counts are
exact manifest cardinalities; the shell retains every chunk's digest, source
path and source range, because a count alone is not evidence of coverage. There is no repository, entry, file, object or run size refusal.

The enforcement machine ([Project restrictions](./enforcement.md)) reads only
the outcome of a recorded assessment (`outcomeOf` below) and the
per-assessment record (`recordOf`). The shell supplies both from the stored
assessment row, which it parses through this machine's state (composition
obligation recorded in the area report).

Repository scans use only the two pinned Surplus profiles: Surplus
`claude-sonnet-5.5` (Anthropic Messages) as the primary reviewer and Surplus
`gpt-6.1-terra` (Responses) as the specialist, both with the operator's
Surplus key; any other provider, endpoint, model or reviewer is refused
before a provider is contacted, and there is no Orbio fallback
(`PINNED_SCANNER_PROFILES` and `validateProfile` in
`workers/vetting/scanners.ts`). The wider Surplus-then-Orbio chain that PRD
section 5 records for 16 November is not used for scans.

## Story: Review every acquired item before granting admission

A maintainer receives clearance only for the exact fetched commit after all
deterministic checks, contextual review and repository synthesis finish and
the evidence is durably retained.

### An assessment is bound to its queued revision, commit and template

The queue assigns the assessment identity, the repository's permanent GitHub
id and identity epoch (the uninterrupted history of one repository id and
node id), the request time, the D1 revision and manifest digest, the
integration-branch commit and the skill-template input digest. The
assignment never changes. The intake refuses a result for any other commit or
template (`commit_mismatch`, HTTP 422) and the assessment stays pending.

```quint
import sandbox as SB from "./sandbox"
type Disposition = NoDisposition | DIncomplete | DClean | DMalicious
type Refusal = NoRefusal | RepositoryMissing | RepositoryMoved | PathRefused | IdentityMismatch
type Review = NotRun | ReviewCompleted | ReviewDeclined
type Escalation = NoEscalation | Ambiguous | HighRisk
type Confirmation = NoConfirmation | ReproducibleBehavior | VerifiedSourceEvidence
type Investigation = NoInvestigation | InvestigationPending | InvestigationIncomplete | InvestigationClean | InvestigationMalicious
type Phase = Queued | Acquiring | Reviewing | Evidence | Publishing | IntentRecorded | Sent | PublicationUnknown
  | PublicationRejected | Recorded | Superseded
type Assignment = { assessment: int, repository: int, identityEpoch: int, requestedAt: int, revision: int, manifestDigest: int,
  commit: int, template: int, policy: int }
type Citation = { assessment: int, repository: int, identityEpoch: int, commit: int }
type Scan = { assignment: Assignment, phase: Phase, attempts: int, staleTemplate: bool, successorTemplate: int,
  inventory: int, inventoryDigest: int, reviewed: int, deterministic: bool, ambiguous: bool, uncoveredExecutable: int, blocked: int,
  primary: Review, escalation: Escalation, specialist: Review, synthesis: bool, reviewBlocked: bool,
  refusal: Refusal, disposition: Disposition, confirmation: Confirmation,
  reused: bool, reuseOrigin: Citation, originPermanent: bool, retained: bool,
  digest: int, sends: int, acceptedDigest: int, recorded: Disposition, investigation: Investigation, investigationId: int }
pure val queuedAssignment: Assignment = { assessment: 1, repository: 1, identityEpoch: 1, requestedAt: 1, revision: 1,
  manifestDigest: 1, commit: 1, template: 1, policy: 1 }
pure val noCitation: Citation = { assessment: 0, repository: 0, identityEpoch: 0, commit: 0 }
pure val initial: Scan = { assignment: queuedAssignment, phase: Queued, attempts: 0, staleTemplate: false, successorTemplate: 0,
  inventory: 0, inventoryDigest: 0, reviewed: 0, deterministic: false, ambiguous: false, uncoveredExecutable: 0, blocked: 0,
  primary: NotRun, escalation: NoEscalation, specialist: NotRun, synthesis: false, reviewBlocked: false,
  refusal: NoRefusal, disposition: NoDisposition, confirmation: NoConfirmation,
  reused: false, reuseOrigin: noCitation, originPermanent: false, retained: false,
  digest: 0, sends: 0, acceptedDigest: 0, recorded: NoDisposition, investigation: NoInvestigation, investigationId: 0 }
pure def validAssignment(a: Assignment): bool =
  a.assessment > 0 and a.repository > 0 and a.identityEpoch > 0 and a.requestedAt > 0 and a.revision > 0 and
  a.manifestDigest > 0 and a.commit > 0 and a.template > 0 and a.policy > 0
pure def alwaysAssignmentValid(s: Scan): bool = validAssignment(s.assignment)
pure def stepAssignmentFixed(before: Scan, after: Scan): bool = before.assignment == after.assignment
pure def intakeAccepts(stored: Assignment, result: Assignment): bool =
  result.assessment == stored.assessment and result.repository == stored.repository and
  result.commit == stored.commit and result.template == stored.template
pure val storedValues = Set(queuedAssignment)
pure val resultValues = Set(queuedAssignment, { ...queuedAssignment, commit: 2 }, { ...queuedAssignment, template: 2 })
```

### Each attempt starts from nothing and a service failure leaves the assessment pending

Starting an attempt clears every per-run fact, so an interrupted or failed
run contributes nothing to the next one. A source, GitHub, Git transport,
model provider or retention outage, a failed reuse lookup, unavailable
runtime readiness and a killed process return the assessment to the queue
without consuming it, and the next pass retries it (legacy
`vetting_terminal_outcomes`, `repositoryOutageRemainsPendingTest`,
`serviceFailureMayRecoverTest`;
`vetting_acquisition.acquisitionFailureDoesNotConsumeQueueTest`). A service
failure never produces an incomplete result. Once the publication intent is
recorded, an interruption leaves the attempt unknown instead.

```quint
type ServiceFailure = ProcessKilled | SourceUnavailable | ReuseLookupFailed | ReadinessUnavailable
pure def resetRun(target: Phase, s: Scan): Scan =
  { ...s, phase: target, inventory: 0, inventoryDigest: 0, reviewed: 0, deterministic: false, ambiguous: false,
    uncoveredExecutable: 0, blocked: 0, primary: NotRun, escalation: NoEscalation, specialist: NotRun, synthesis: false,
    reviewBlocked: false, refusal: NoRefusal, disposition: NoDisposition, confirmation: NoConfirmation, reused: false, reuseOrigin: noCitation,
    originPermanent: false, retained: false, digest: 0 }
pure def canStart(s: Scan): bool = s.phase == Queued and not(s.staleTemplate)
pure def start(s: Scan): Scan = { ...resetRun(Acquiring, s), attempts: s.attempts + 1 }
pure def canInterrupt(s: Scan, failure: ServiceFailure): bool =
  s.phase == Acquiring or s.phase == Reviewing or s.phase == Evidence or s.phase == Publishing or
  s.phase == IntentRecorded or s.phase == Sent
pure def interrupt(s: Scan, failure: ServiceFailure): Scan =
  if (s.phase == IntentRecorded or s.phase == Sent) { ...s, phase: PublicationUnknown } else resetRun(Queued, s)
pure def alwaysQueuedHoldsNoRun(s: Scan): bool =
  (s.phase == Queued or s.phase == Acquiring) implies
    s.inventory == 0 and s.reviewed == 0 and s.blocked == 0 and not(s.deterministic) and not(s.ambiguous) and
    s.primary == NotRun and s.disposition == NoDisposition and not(s.retained) and not(s.reused) and
    not(s.originPermanent) and s.refusal == NoRefusal and not(s.synthesis) and s.confirmation == NoConfirmation and
    s.specialist == NotRun and s.escalation == NoEscalation and s.digest == 0 and s.sends == 0 and not(s.reviewBlocked)
pure def stepServiceFailureDecidesNothing(before: Scan, via: str, after: Scan): bool =
  via == "interrupt" implies after.recorded == before.recorded and
    (after.phase == Queued or after.phase == PublicationUnknown) and
    (after.phase == Queued implies after.disposition == NoDisposition)
```

### Acquisition binds one shallow fetch of the exact commit

One shallow Git fetch of the assigned commit is verified locally. A policy
refusal of the bound assignment is a terminal incomplete result with zero
coverage, the primary review not started and no claimed model call: a
repository id or node id that differs from the registered identity (a reused
name or another repository), a registered repository GitHub reports missing
(404), one it redirects (3xx: renamed or transferred before a revision records
the new path), and a path-policy refusal of that exact pin. A transport
failure, timeout, rate limit or GitHub outage is retryable. A template whose
inputs changed since assignment fails closed without consuming the
assessment, which then waits for the template recovery below.

```quint
type FetchOutcome = Fetched | FetchUnavailable | FetchMissing | FetchMoved | FetchPathRefused | FetchIdentityMismatch
  | FetchStaleTemplate
type Fetch = { fetched: FetchOutcome, commit: int, verifiedLocally: bool, entries: int, inventoryDigest: int }
pure def refusalOf(fetched: FetchOutcome): Refusal =
  if (fetched == FetchMissing) RepositoryMissing else if (fetched == FetchMoved) RepositoryMoved
  else if (fetched == FetchIdentityMismatch) IdentityMismatch else PathRefused
pure def canAcquire(s: Scan, fetch: Fetch): bool =
  s.phase == Acquiring and
  (fetch.fetched != Fetched or
    (fetch.commit == s.assignment.commit and fetch.verifiedLocally and fetch.entries >= 0 and fetch.inventoryDigest > 0))
pure def acquire(s: Scan, fetch: Fetch): Scan =
  if (fetch.fetched == Fetched) { ...s, phase: Reviewing, inventory: fetch.entries, inventoryDigest: fetch.inventoryDigest }
  else if (fetch.fetched == FetchUnavailable) { ...s, phase: Queued }
  else if (fetch.fetched == FetchStaleTemplate) { ...s, phase: Queued, staleTemplate: true }
  else { ...s, phase: Evidence, disposition: DIncomplete, refusal: refusalOf(fetch.fetched) }
pure val fetchValues = Set(
  { fetched: Fetched, commit: 1, verifiedLocally: true, entries: 2, inventoryDigest: 7 },
  { fetched: Fetched, commit: 1, verifiedLocally: true, entries: 1000000, inventoryDigest: 8 },
  { fetched: Fetched, commit: 2, verifiedLocally: true, entries: 2, inventoryDigest: 7 },
  { fetched: Fetched, commit: 1, verifiedLocally: false, entries: 2, inventoryDigest: 7 },
  { fetched: FetchUnavailable, commit: 0, verifiedLocally: false, entries: 0, inventoryDigest: 0 },
  { fetched: FetchMissing, commit: 0, verifiedLocally: false, entries: 0, inventoryDigest: 0 },
  { fetched: FetchMoved, commit: 0, verifiedLocally: false, entries: 0, inventoryDigest: 0 },
  { fetched: FetchIdentityMismatch, commit: 0, verifiedLocally: false, entries: 0, inventoryDigest: 0 },
  { fetched: FetchStaleTemplate, commit: 0, verifiedLocally: false, entries: 0, inventoryDigest: 0 },
  { fetched: FetchPathRefused, commit: 1, verifiedLocally: true, entries: 0, inventoryDigest: 0 })
pure def alwaysRefusalIsIncompleteWithoutReview(s: Scan): bool =
  s.refusal != NoRefusal implies s.disposition == DIncomplete and s.primary == NotRun and s.reviewed == 0 and
    s.inventory == 0 and not(s.synthesis) and not(s.reused)
```

### A replaced template requeues the pending assessment with its original commit

When a release replaces the template before a pending scan can finish, the
next refresh queues the current template with the original source commit and
manifest as a new assessment. The old assignment stays unchanged and is never
consumed. A recorded result needs no routine rescan. Because the assignment
never changes, a retry after a recorded result is likewise a new assessment of
the same repository, never this one.

```quint
pure def canRequeueWithTemplate(s: Scan, template: int): bool =
  s.phase == Queued and s.staleTemplate and template > 0 and template != s.assignment.template
pure def requeueWithTemplate(s: Scan, template: int): Scan = { ...s, phase: Superseded, successorTemplate: template }
pure def alwaysSupersededUnconsumed(s: Scan): bool =
  s.phase == Superseded implies s.recorded == NoDisposition and s.sends == 0 and s.successorTemplate > 0 and
    s.successorTemplate != s.assignment.template
pure val templateValues = Set(1, 2)
```

### Every reviewed batch covers the next unreviewed inventory entries

The review plan orders entries risky-first; the adapter maps that permutation
onto manifest positions, so a batch is the next contiguous range of positions
and no entry is counted twice. Batch size follows the provider token budget.
Deterministic checks run over every file and every match goes to contextual
model review; a match the checks cannot resolve is ambiguous. Executable
content that no check, isolated execution or specialist review covers is
counted and prevents a pass. Install-time shell helpers are followed through
ordinary shell syntax: the commands inside substitutions, subshells,
conditionals, loops and braces are read as if they run, and `cd "$(dirname
"$0")"` in a script file enters that file's directory. A `cd` that may not
run leaves the directory unknown, so a later local launch stays uncovered;
`eval`, `case`, `select`, dynamic commands and unclosed substitutions keep
install coverage partial (operator decision, 23 November 2026).

```quint
pure def canReviewBatch(s: Scan, count: int): bool = s.phase == Reviewing and count > 0 and count <= s.inventory - s.reviewed
pure def reviewBatch(s: Scan, count: int): Scan = { ...s, reviewed: s.reviewed + count }
pure val countValues = Set(1, 2, 1000000)
pure def canCheckDeterministically(s: Scan, uncovered: int, ambiguous: bool): bool =
  s.phase == Reviewing and not(s.deterministic) and uncovered >= 0 and uncovered + s.blocked <= s.inventory
pure def checkDeterministically(s: Scan, uncovered: int, ambiguous: bool): Scan =
  { ...s, deterministic: true, uncoveredExecutable: uncovered, ambiguous: ambiguous }
pure val uncoveredValues = Set(0, 1)
pure def alwaysReviewsAfterChecks(s: Scan): bool =
  not(s.deterministic) implies s.primary == NotRun and s.escalation == NoEscalation and s.specialist == NotRun
pure def alwaysReviewingUndecided(s: Scan): bool =
  s.phase == Reviewing implies s.disposition == NoDisposition and s.refusal == NoRefusal and not(s.retained) and
    not(s.reused) and not(s.synthesis) and s.confirmation == NoConfirmation
pure def alwaysCoverageBounds(s: Scan): bool =
  s.inventory >= 0 and s.reviewed >= 0 and s.reviewed <= s.inventory and
  s.uncoveredExecutable >= 0 and s.blocked >= 0 and s.uncoveredExecutable + s.blocked <= s.inventory
```

### Risky artifacts run in an isolated sandbox without network or secrets

One disposable [sandbox](./sandbox.md) run covers risky artifacts. Only a
completed run (destroyed after a verified, isolated execution) counts. An
executed artifact is released after a clean behavior analysis; a suspicious
or malicious analysis blocks it (`vetting_artifacts` states `quarantined`,
`released`, `blocked`), and a blocked artifact prevents a clean result. A
not-executable artifact or a run at its output or time limit stays uncovered,
so the result is incomplete. A failed isolation or cleanup is a service
failure that leaves the assessment pending.

```quint
type BehaviorAnalysis = BehaviorClean | Suspicious | MaliciousBehavior
type ArtifactRun = { artifacts: int, sandbox: SB::Sandbox, analysis: BehaviorAnalysis }
pure def canRunIsolated(s: Scan, artifactRun: ArtifactRun): bool =
  s.phase == Reviewing and s.deterministic and SB::completed(artifactRun.sandbox) and
  artifactRun.artifacts > 0 and artifactRun.artifacts <= s.uncoveredExecutable
pure def runIsolated(s: Scan, artifactRun: ArtifactRun): Scan =
  if (artifactRun.sandbox.result != SB::Executed) s
  else if (artifactRun.analysis == BehaviorClean) { ...s, uncoveredExecutable: s.uncoveredExecutable - artifactRun.artifacts }
  else { ...s, uncoveredExecutable: s.uncoveredExecutable - artifactRun.artifacts, blocked: s.blocked + artifactRun.artifacts }
pure val sandboxDone: SB::Sandbox = { ...SB::initial, phase: SB::Destroyed, result: SB::Executed }
pure val artifactRunValues = Set({ artifacts: 1, sandbox: sandboxDone, analysis: BehaviorClean },
  { artifacts: 1, sandbox: sandboxDone, analysis: Suspicious },
  { artifacts: 1, sandbox: { ...sandboxDone, result: SB::LimitReached, coverageGap: true }, analysis: BehaviorClean },
  { artifacts: 1, sandbox: { ...sandboxDone, phase: SB::CleanupFailed }, analysis: BehaviorClean },
  { artifacts: 1, sandbox: { ...sandboxDone, result: SB::IsolationFailed }, analysis: BehaviorClean })
```

### The primary review decides and an ambiguous or high-risk finding needs the specialist

The primary review (Surplus Claude Sonnet 5.5) reads the complete assessed
inventory; the specialist is Surplus GPT-6.1 Terra, and no other profile
reviews a scan. A high-risk result, or an ambiguous deterministic match, escalates
to the specialist review before any clean or malicious decision. A declined
review is incomplete. A provider outage returns the assessment to the queue.
A model label never confirms malice. Any primary finding or risk above low
escalates (`scanNeedsSpecialist` in `workers/verified-policy.ts`). A review
that reports a high or critical finding or suspects malice is blocking: it
escalates, and the scan can no longer be clean, whatever the specialist finds
(`scanProblems` in `backend/vetting/scan-result.ts`, operator decision of
19 November 2026, development commit `ec2e04a96`). Info, low and medium
findings are advisory: they escalate and a completed specialist review clears
them. A verified reviewer gap for content outside the acquired revision is
advisory too and keeps no scan from being clean.

```quint
type PrimaryOutcome = PrimaryClean | PrimaryEscalate | PrimaryBlocking | PrimaryDeclined | PrimaryUnavailable
type SpecialistOutcome = SpecialistClean | SpecialistBlocking | SpecialistDeclined | SpecialistUnavailable
pure def escalated(s: Scan): bool = s.escalation != NoEscalation
pure def canReviewPrimary(s: Scan, primaryOutcome: PrimaryOutcome): bool =
  s.phase == Reviewing and s.deterministic and s.reviewed == s.inventory and s.primary == NotRun
pure def reviewPrimary(s: Scan, primaryOutcome: PrimaryOutcome): Scan =
  if (primaryOutcome == PrimaryUnavailable) resetRun(Queued, s)
  else if (primaryOutcome == PrimaryDeclined) { ...s, primary: ReviewDeclined, phase: Evidence, disposition: DIncomplete }
  else { ...s, primary: ReviewCompleted, reviewBlocked: primaryOutcome == PrimaryBlocking,
    escalation: if (primaryOutcome == PrimaryEscalate or primaryOutcome == PrimaryBlocking) HighRisk else NoEscalation }
pure def canEscalateSpecialist(s: Scan, reason: Escalation): bool =
  s.phase == Reviewing and s.primary == ReviewCompleted and not(escalated(s)) and reason != NoEscalation and
  (reason == Ambiguous implies s.ambiguous)
pure def escalateSpecialist(s: Scan, reason: Escalation): Scan = { ...s, escalation: reason }
pure def canReviewSpecialist(s: Scan, specialistOutcome: SpecialistOutcome): bool =
  s.phase == Reviewing and s.primary == ReviewCompleted and escalated(s) and s.specialist == NotRun
pure def reviewSpecialist(s: Scan, specialistOutcome: SpecialistOutcome): Scan =
  if (specialistOutcome == SpecialistUnavailable) resetRun(Queued, s)
  else if (specialistOutcome == SpecialistDeclined) { ...s, specialist: ReviewDeclined, phase: Evidence, disposition: DIncomplete }
  else { ...s, specialist: ReviewCompleted, reviewBlocked: s.reviewBlocked or specialistOutcome == SpecialistBlocking }
pure def specialistSettled(s: Scan): bool = (s.ambiguous implies escalated(s)) and (escalated(s) implies s.specialist == ReviewCompleted)
pure def alwaysDeclinedIsIncomplete(s: Scan): bool =
  (s.primary == ReviewDeclined or s.specialist == ReviewDeclined) implies s.disposition == DIncomplete
pure def alwaysSpecialistOnlyAfterEscalation(s: Scan): bool =
  (s.specialist != NotRun implies s.primary == ReviewCompleted and escalated(s)) and
  (escalated(s) implies s.primary == ReviewCompleted) and (s.escalation == Ambiguous implies s.ambiguous)
pure val reasonValues = Set(Ambiguous, HighRisk)
```

### Synthesis decides the repository result and confirmed malice needs trusted evidence

The repository synthesis yields clean only when every entry was reviewed, the
deterministic checks ran, no executable content is uncovered, the primary
review completed, every required specialist review completed and neither
review was blocking. Anything else is incomplete. Malice requires a confirmation with basis
`reproducible-behavior` or `verified-source-evidence` from the separate
trusted reviewer outside the guest and model context (`PUBLICATION.md`), and
an ambiguous or high-risk finding first needs the completed specialist review.

```quint
pure def reviewsComplete(s: Scan): bool = s.primary == ReviewCompleted and specialistSettled(s)
pure def cleanEvidence(s: Scan): bool =
  s.reviewed == s.inventory and s.deterministic and s.uncoveredExecutable == 0 and s.blocked == 0 and reviewsComplete(s) and s.synthesis
    and not(s.reviewBlocked)
pure def canSynthesize(s: Scan): bool = s.phase == Reviewing and s.deterministic and s.reviewed == s.inventory and reviewsComplete(s)
pure def synthesize(s: Scan): Scan =
  { ...s, synthesis: true, phase: Evidence,
    disposition: if (s.uncoveredExecutable == 0 and s.blocked == 0 and not(s.reviewBlocked)) DClean else DIncomplete }
pure def canConfirmMalice(s: Scan, confirmation: Confirmation): bool =
  s.phase == Reviewing and s.deterministic and s.primary == ReviewCompleted and confirmation != NoConfirmation and
  specialistSettled(s)
pure def confirmMalice(s: Scan, confirmation: Confirmation): Scan =
  { ...s, phase: Evidence, disposition: DMalicious, confirmation: confirmation }
pure def alwaysMaliceConfirmed(s: Scan): bool =
  s.disposition == DMalicious implies s.confirmation != NoConfirmation and specialistSettled(s)
pure def alwaysCleanComplete(s: Scan): bool =
  s.disposition == DClean implies (s.reused and s.reuseOrigin.assessment > 0) or cleanEvidence(s)
```

### A reused clean result cites one original clean scan of the same repository and commit

The scanner may reuse an original result before fresh isolated execution.
The API compares the stored original row with this assessment: same immutable
repository id and identity epoch (the same node id history), commit, acquired-input inventory digest, template and policy; the
original is clean, not itself reused, and its evidence is retained; no
quarantine or ban was recorded after it; and it covers the active flags.
Reuse marks the original evidence permanent. Another repository never
inherits the result, and a reused result never lifts a flag pause
(`backend/vetting/reuse.ts`, `verified-reuse.ts`).

```quint
type ReuseOrigin = { assessment: int, disposition: Disposition, reused: bool, repository: int, identityEpoch: int, commit: int,
  inventoryDigest: int, template: int, policy: int, retained: bool, laterRestriction: bool, flagsCovered: bool }
pure def canReuse(s: Scan, origin: ReuseOrigin): bool =
  s.phase == Reviewing and s.reviewed == 0 and not(s.deterministic) and
  origin.assessment > 0 and origin.assessment != s.assignment.assessment and origin.disposition == DClean and
  not(origin.reused) and origin.retained and origin.repository == s.assignment.repository and
  origin.identityEpoch == s.assignment.identityEpoch and origin.commit == s.assignment.commit and origin.inventoryDigest == s.inventoryDigest and
  origin.template == s.assignment.template and origin.policy == s.assignment.policy and
  not(origin.laterRestriction) and origin.flagsCovered
pure def reuse(s: Scan, origin: ReuseOrigin): Scan =
  { ...s, phase: Evidence, disposition: DClean, reused: true, originPermanent: true,
    reuseOrigin: { assessment: origin.assessment, repository: origin.repository, identityEpoch: origin.identityEpoch, commit: origin.commit } }
pure val reusable = { assessment: 9, disposition: DClean, reused: false, repository: 1, identityEpoch: 1, commit: 1, inventoryDigest: 7,
  template: 1, policy: 1, retained: true, laterRestriction: false, flagsCovered: true }
pure val originValues = Set(reusable, { ...reusable, reused: true }, { ...reusable, inventoryDigest: 8 },
  { ...reusable, disposition: DIncomplete }, { ...reusable, repository: 2 }, { ...reusable, identityEpoch: 2 },
  { ...reusable, laterRestriction: true },
  { ...reusable, flagsCovered: false })
pure def alwaysReuseCitesOrigin(s: Scan): bool =
  s.reused implies s.reuseOrigin.assessment > 0 and s.reuseOrigin.assessment != s.assignment.assessment and s.originPermanent
    and s.reuseOrigin.repository == s.assignment.repository and s.reuseOrigin.identityEpoch == s.assignment.identityEpoch
    and s.reuseOrigin.commit == s.assignment.commit
pure val sValues = Set(initial, { ...initial, phase: Reviewing, inventoryDigest: 7 },
  { ...initial, phase: Recorded, disposition: DClean, recorded: DClean, retained: true, digest: 5, acceptedDigest: 5, sends: 1 })
```

### Evidence durability precedes a clean or malicious publication

Objects use SHA-256 identities, 8 MiB upload parts and a complete private R2
manifest (`backend/vetting/EVIDENCE.md`). Retention runs after the
disposition, so it covers every batch the result relies on. A clean or
malicious result whose retention failed returns to the queue; an incomplete
result may record failed retention (legacy `cleanCannotRecordFailedRetentionTest`,
`incompleteCanRecordFailedRetentionTest`). Successful admission evidence,
including the original evidence of a reused result, is retained permanently
under the 27 October 2026 owner decision ([evidence store](./evidence.md)).

```quint
type Retention = Stored | StoreFailed
pure def canRetain(s: Scan, retention: Retention): bool = s.phase == Evidence and s.disposition != NoDisposition
pure def retain(s: Scan, retention: Retention): Scan =
  if (retention == Stored) { ...s, retained: true, phase: Publishing }
  else if (s.disposition == DIncomplete) { ...s, retained: false, phase: Publishing }
  else resetRun(Queued, s)
pure def publicationPhase(phase: Phase): bool =
  phase == Publishing or phase == IntentRecorded or phase == Sent or phase == PublicationUnknown or
  phase == PublicationRejected or phase == Recorded
pure def alwaysPublishingDecided(s: Scan): bool =
  publicationPhase(s.phase) implies s.disposition != NoDisposition and (s.disposition == DIncomplete or s.retained)
```

### Publication records its intent, sends once, keeps uncertainty and records the result exactly once

Preparation fixes the exact result bytes and their digest. The publication
journal reserves one directory per assessment and writes the intent before
the single signed request. The API verifies the Ed25519 signature against
`VETTING_RESULT_PUBLIC_KEYS` and the assignment, then records the result and
returns the assessment identity and state. The API accepts a result only for
its stored pending assignment (`intakeAccepts`); a different commit or template
is rejected (`commit_mismatch`). A lost or malformed response, a mismatched
returned digest, or an interruption after the intent stays unknown, and a
later call for the same assessment refuses to send; only the restricted admin
assessment record with the same digest reconciles it. A rejected attempt
leaves the stored assessment pending and is journaled, so no pass sends it
again; it waits for operator inspection (`workers/vetting/README.md`). A
recorded result never changes; an incomplete result never becomes clean.

```quint
type ReceiptKind = ReceiptAccepted | ReceiptRejected | ReceiptLost
type Receipt = { kind: ReceiptKind, digest: int, stored: Assignment }
type RecordRead = RecordMatches | RecordStillPending | RecordUnavailable
type AdminRecord = { read: RecordRead, digest: int }
pure def canRecordIntent(s: Scan, digest: int): bool = s.phase == Publishing and s.sends == 0 and digest > 0
pure def recordIntent(s: Scan, digest: int): Scan = { ...s, phase: IntentRecorded, digest: digest }
pure def canSend(s: Scan): bool = s.phase == IntentRecorded and s.sends == 0
pure def send(s: Scan): Scan = { ...s, phase: Sent, sends: s.sends + 1 }
pure def canRecordReceipt(s: Scan, response: Receipt): bool =
  s.phase == Sent and (response.kind == ReceiptAccepted implies intakeAccepts(response.stored, s.assignment))
pure def recordReceipt(s: Scan, response: Receipt): Scan =
  if (response.kind == ReceiptAccepted and response.digest == s.digest)
    { ...s, phase: Recorded, recorded: s.disposition, acceptedDigest: response.digest }
  else if (response.kind == ReceiptRejected) { ...s, phase: PublicationRejected }
  else { ...s, phase: PublicationUnknown }
pure def canReconcileFromAdminRecord(s: Scan, record: AdminRecord): bool = s.phase == PublicationUnknown
pure def reconcileFromAdminRecord(s: Scan, record: AdminRecord): Scan =
  if (record.read == RecordMatches and record.digest == s.digest)
    { ...s, phase: Recorded, recorded: s.disposition, acceptedDigest: record.digest }
  else s
pure val digestValues = Set(5)
pure val responseValues = Set({ kind: ReceiptAccepted, digest: 5, stored: queuedAssignment },
  { kind: ReceiptAccepted, digest: 6, stored: queuedAssignment },
  { kind: ReceiptAccepted, digest: 5, stored: { ...queuedAssignment, commit: 2 } },
  { kind: ReceiptRejected, digest: 0, stored: { ...queuedAssignment, commit: 2 } },
  { kind: ReceiptLost, digest: 0, stored: queuedAssignment })
pure val recordValues = Set({ read: RecordMatches, digest: 5 }, { read: RecordMatches, digest: 6 },
  { read: RecordStillPending, digest: 0 }, { read: RecordUnavailable, digest: 0 })
pure def alwaysAtMostOneSend(s: Scan): bool =
  s.sends >= 0 and s.sends <= 1 and
  ((s.phase == Sent or s.phase == PublicationRejected) implies s.sends == 1) and
  ((s.phase == Publishing or s.phase == IntentRecorded or not(publicationPhase(s.phase))) implies s.sends == 0) and
  ((s.phase == IntentRecorded or s.sends > 0 or s.phase == PublicationUnknown or s.phase == Recorded) implies s.digest > 0)
pure def alwaysDigestOnlyAfterIntent(s: Scan): bool =
  (s.phase == Queued or s.phase == Acquiring or s.phase == Reviewing or s.phase == Evidence or s.phase == Publishing or
    s.phase == Superseded) implies s.digest == 0
pure def alwaysRecordedOnlyWhenRecorded(s: Scan): bool = (s.recorded != NoDisposition) iff (s.phase == Recorded)
pure def alwaysRecordedMatchesDisposition(s: Scan): bool =
  s.phase == Recorded implies s.recorded == s.disposition and s.acceptedDigest == s.digest and s.digest > 0
pure def alwaysCleanVisibleOnlyAfterAccepted(s: Scan): bool =
  s.recorded == DClean implies s.phase == Recorded and s.acceptedDigest > 0 and s.acceptedDigest == s.digest
pure def resultUnchanged(before: Scan, after: Scan): bool =
  after.phase == before.phase and after.disposition == before.disposition and after.recorded == before.recorded and
  after.digest == before.digest and after.acceptedDigest == before.acceptedDigest and after.sends == before.sends and
  after.reused == before.reused and after.retained == before.retained and after.confirmation == before.confirmation
pure def stepRecordedImmutable(before: Scan, after: Scan): bool = before.phase == Recorded implies resultUnchanged(before, after)
pure def stepRejectedRetained(before: Scan, after: Scan): bool = before.phase == PublicationRejected implies resultUnchanged(before, after)
pure def stepUnknownNeverResends(before: Scan, via: str, after: Scan): bool =
  before.phase == PublicationUnknown implies (via == "reconcileFromAdminRecord" or resultUnchanged(before, after)) and after.sends == before.sends
pure def stepIncompleteNeverClean(before: Scan, after: Scan): bool =
  (before.disposition == DIncomplete and before.digest > 0) implies after.disposition == DIncomplete
pure def stepAttemptsCount(before: Scan, after: Scan): bool = after.attempts >= before.attempts and after.sends >= before.sends
```

### A signed service request binds method, path, timestamp and body digest and is refused outside a five-minute window

Every request from the vetting service (refresh, queue read, reuse lookup,
sandbox, evidence upload and result) carries `x-slop-vetting-timestamp`,
`x-slop-vetting-key` (the SHA-256 of one configured raw Ed25519 key in
`VETTING_RESULT_PUBLIC_KEYS`) and `x-slop-vetting-signature` (64 bytes,
base64). The signed message is the five lines `slop-vetting:v1`, the method,
the path with its query, the timestamp and the SHA-256 hex of the exact body
bytes (`vettingSignedMessage` in `backend/vetting/handler.ts`). With no key
configured the route answers 503 `vetting_unavailable`. A timestamp that is
not an ISO-8601 UTC instant (`YYYY-MM-DDTHH:MM:SS[.mmm]Z`) or lies more than
300,000 ms from the server clock in either direction, an unknown key, a
signature of the wrong length, and a signature that does not verify over the
received method, path, timestamp and body each answer 401
`invalid_signature` and change nothing. The body is read within the route's
byte limit (256 KiB for a result, 1,024 bytes for the refresh) before it is
digested. Only an accepted request makes the shell supply the vetting-service
sender (`0`) to [enforcement](./enforcement.md). The window bounds replay:
the same signed request is refused once it is older than five minutes, and a
body swapped under a valid signature never verifies.

```quint
pure val signatureWindowMs = 300000
type SignedFields = { signedMethod: int, signedPath: int, signedTimestampMs: int, signedBodyDigest: int }
type ServiceRequest = { method: int, pathAndQuery: int, timestampMs: int, bodyDigest: int,
  keyConfigured: bool, keyKnown: bool, signedOver: SignedFields }
pure def withinSignatureWindow(timestampMs: int, atMs: int): bool =
  atMs - timestampMs <= signatureWindowMs and timestampMs - atMs <= signatureWindowMs
pure def serviceRequestAccepted(serviceRequest: ServiceRequest, atMs: int): bool =
  serviceRequest.keyConfigured and serviceRequest.keyKnown and
  withinSignatureWindow(serviceRequest.timestampMs, atMs) and
  serviceRequest.signedOver.signedMethod == serviceRequest.method and
  serviceRequest.signedOver.signedPath == serviceRequest.pathAndQuery and
  serviceRequest.signedOver.signedTimestampMs == serviceRequest.timestampMs and
  serviceRequest.signedOver.signedBodyDigest == serviceRequest.bodyDigest
pure def lawStaleServiceRequestRefused(serviceRequest: ServiceRequest, atMs: int): bool =
  not(withinSignatureWindow(serviceRequest.timestampMs, atMs)) implies not(serviceRequestAccepted(serviceRequest, atMs))
pure def lawSwappedBodyRefused(serviceRequest: ServiceRequest, atMs: int): bool =
  serviceRequest.signedOver.signedBodyDigest != serviceRequest.bodyDigest implies not(serviceRequestAccepted(serviceRequest, atMs))
pure def lawReplayedOnOtherRouteRefused(serviceRequest: ServiceRequest, atMs: int): bool =
  (serviceRequest.signedOver.signedPath != serviceRequest.pathAndQuery or serviceRequest.signedOver.signedMethod != serviceRequest.method)
    implies not(serviceRequestAccepted(serviceRequest, atMs))
pure val signedRequestFields: SignedFields = { signedMethod: 1, signedPath: 1, signedTimestampMs: 0, signedBodyDigest: 1 }
pure val signedServiceRequest: ServiceRequest = { method: 1, pathAndQuery: 1, timestampMs: 0, bodyDigest: 1,
  keyConfigured: true, keyKnown: true, signedOver: signedRequestFields }
pure val serviceRequestValues = Set(signedServiceRequest, { ...signedServiceRequest, bodyDigest: 2 },
  { ...signedServiceRequest, pathAndQuery: 2 }, { ...signedServiceRequest, keyKnown: false },
  { ...signedServiceRequest, keyConfigured: false })
pure val atMsValues = Set(0, 300000, 300001, -300001)
```

### An explicit later investigation controls admission while it is open

An administrator may request an explicit later investigation of the same
repository identity through the assessment route. While its assessment is
pending or incomplete it blocks the pass this assessment would grant; a
malicious result needs the independent decision of enforcement. Only a clean
investigation result restores the pass.

```quint
pure def canOpenInvestigation(s: Scan, investigationId: int): bool =
  investigationId > s.assignment.assessment and investigationId > s.investigationId and
  s.investigation != InvestigationPending
pure def openInvestigation(s: Scan, investigationId: int): Scan =
  { ...s, investigation: InvestigationPending, investigationId: investigationId }
pure def canCloseInvestigation(s: Scan, finding: Disposition): bool =
  s.investigation == InvestigationPending and finding != NoDisposition
pure def closeInvestigation(s: Scan, finding: Disposition): Scan =
  { ...s, investigation: if (finding == DClean) InvestigationClean else if (finding == DMalicious) InvestigationMalicious
    else InvestigationIncomplete }
pure def investigationBlocks(s: Scan): bool = s.investigation != NoInvestigation and s.investigation != InvestigationClean
pure def passes(s: Scan): bool = s.phase == Recorded and s.recorded == DClean and s.retained and not(investigationBlocks(s))
pure def alwaysInvestigationIdentified(s: Scan): bool =
  (s.investigation != NoInvestigation) iff (s.investigationId > s.assignment.assessment)
pure val investigationIdValues = Set(2, 3)
pure val findingValues = Set(DIncomplete, DClean, DMalicious)
```

### The outcome and the per-assessment record are what enforcement reads

The signed result request carries the outcome. Enforcement accepts it only
from the authenticated vetting service, only for the pending assessment of the
same repository and requested revision, and a malicious outcome only with its
trusted confirmation. The commit and template binding is checked against the
stored assignment before the outcome is formed (`intakeAccepts`). The
per-assessment record carries the request time, identity epoch, result, reuse
and whether the retained evidence is readable now; missing, corrupt or expired
evidence fails closed on every read.

```quint
type Outcome = { assessment: int, repository: int, revision: int, disposition: Disposition, confirmation: Confirmation,
  reused: bool, retained: bool }
type AssessmentRecord = { assessment: int, repository: int, identityEpoch: int, requestedAt: int, result: Disposition,
  reused: bool, evidenceAvailable: bool, investigationOpen: bool }
pure def isRecorded(s: Scan): bool = s.phase == Recorded
pure def outcomeOf(s: Scan): Outcome =
  { assessment: s.assignment.assessment, repository: s.assignment.repository, revision: s.assignment.revision,
    disposition: s.recorded, confirmation: s.confirmation, reused: s.reused, retained: s.retained }
pure def recordOf(s: Scan, evidenceReadable: bool): AssessmentRecord =
  { assessment: s.assignment.assessment, repository: s.assignment.repository, identityEpoch: s.assignment.identityEpoch,
    requestedAt: s.assignment.requestedAt, result: s.recorded, reused: s.reused,
    evidenceAvailable: s.retained and evidenceReadable, investigationOpen: investigationBlocks(s) }
pure def liftsFlagPause(rec: AssessmentRecord): bool =
  rec.result == DClean and not(rec.reused) and rec.evidenceAvailable and not(rec.investigationOpen)
pure def validOutcome(o: Outcome): bool =
  o.assessment > 0 and o.repository > 0 and o.revision > 0 and o.disposition != NoDisposition and
  (o.disposition == DIncomplete or o.retained) and
  (o.disposition == DMalicious implies o.confirmation != NoConfirmation)
pure def lawRecordedOutcomeValid(s: Scan): bool =
  (isRecorded(s) and alwaysPublishingDecided(s) and alwaysRecordedMatchesDisposition(s) and alwaysAssignmentValid(s) and
    alwaysMaliceConfirmed(s)) implies validOutcome(outcomeOf(s))
pure def lawUnconfirmedMaliceRefused(o: Outcome): bool =
  (o.disposition == DMalicious and o.confirmation == NoConfirmation) implies not(validOutcome(o))
pure def lawUnreadableEvidenceNeverLifts(s: Scan): bool = not(liftsFlagPause(recordOf(s, false)))
pure val oValues = Set({ assessment: 1, repository: 1, revision: 1, disposition: DMalicious, confirmation: NoConfirmation, reused: false, retained: true },
  { assessment: 1, repository: 1, revision: 1, disposition: DMalicious, confirmation: ReproducibleBehavior, reused: false, retained: true },
  { assessment: 1, repository: 1, revision: 1, disposition: DClean, confirmation: NoConfirmation, reused: false, retained: true })
pure val recValues = Set(
  { assessment: 1, repository: 1, identityEpoch: 1, requestedAt: 1, result: DClean, reused: true, evidenceAvailable: true, investigationOpen: false },
  { assessment: 1, repository: 1, identityEpoch: 1, requestedAt: 1, result: DClean, reused: false, evidenceAvailable: true, investigationOpen: false },
  { assessment: 1, repository: 1, identityEpoch: 1, requestedAt: 1, result: DClean, reused: false, evidenceAvailable: false, investigationOpen: false })
pure def sometimesCleanRecorded(s: Scan): bool = s.phase == Recorded and s.recorded == DClean and not(s.reused)
pure def sometimesReusedClean(s: Scan): bool = s.phase == Recorded and s.recorded == DClean and s.reused
pure def sometimesSpecialist(s: Scan): bool = s.disposition == DClean and s.escalation == Ambiguous and s.specialist == ReviewCompleted
pure def sometimesIncompleteRecorded(s: Scan): bool = s.phase == Recorded and s.recorded == DIncomplete
pure def sometimesRefusedIncomplete(s: Scan): bool = s.phase == Recorded and s.recorded == DIncomplete and s.refusal != NoRefusal
pure def sometimesMaliciousRecorded(s: Scan): bool = s.phase == Recorded and s.recorded == DMalicious
pure def sometimesRetriedAfterOutage(s: Scan): bool = s.phase == Publishing and s.attempts >= 2
pure def sometimesPublicationUnknown(s: Scan): bool = s.phase == PublicationUnknown and s.sends == 1
pure def sometimesReconciled(s: Scan): bool = s.phase == Recorded and s.sends == 0
pure def sometimesPublicationRejected(s: Scan): bool = s.phase == PublicationRejected
pure def sometimesSuperseded(s: Scan): bool = s.phase == Superseded
pure def sometimesInvestigationBlocksPass(s: Scan): bool = s.phase == Recorded and s.recorded == DClean and s.retained and not(passes(s))
pure def sometimesUncoveredIncomplete(s: Scan): bool = s.disposition == DIncomplete and s.synthesis
pure def sometimesBlockingReviewIncomplete(s: Scan): bool = s.disposition == DIncomplete and s.synthesis and s.reviewBlocked
  and s.specialist == ReviewCompleted
pure def sometimesBlockedArtifactIncomplete(s: Scan): bool = s.phase == Recorded and s.recorded == DIncomplete and s.blocked > 0
```

### Simulation weights steer runs to each outcome

These sets and weights bound simulation only.

```quint
pure val weight_acquire = 5
pure val weight_reviewBatch = 4
pure val weight_checkDeterministically = 4
pure val weight_reviewPrimary = 4
pure val weight_escalateSpecialist = 3
pure val weight_reviewSpecialist = 3
pure val weight_synthesize = 4
pure val weight_retain = 4
pure val weight_recordIntent = 5
pure val weight_send = 5
pure val weight_recordReceipt = 4
pure val weight_start = 4
```

A clean assessment records only the evaluated commit. Routine later changes
retain admission under policy without claiming the changed bytes were
scanned; a different immutable repository identity needs its own admission
(enforcement).
