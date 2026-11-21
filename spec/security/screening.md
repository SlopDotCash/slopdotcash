# Private report screening and routing

PRD sections 8 and 10. This machine starts after the durable report receipt.
It owns one submission's current screening revision and report version.
`backend/security/report-intake.ts` owns claim, recovery and routing.
`backend/security/analysis.ts` owns the Surplus adapter and separate advisory
assessment. The report bytes and private reasons stay outside public state.
Screening closes nothing; the [routine pass](./routineDecisions.md) reads a
saved version once its screening settles, or 15 minutes after the save.

## Story: Screen the exact saved version privately before owner routing

### Claim queued, unavailable or expired work for the current revision

A running claim becomes recoverable when its known age reaches 15 minutes.
A missing clock never establishes expiry. The public retry and revision routes
admit work through the existing per-actor rolling window before durable
writes or paid calls. The public screening retry on a qualified intake
retries its routing; no schedule does. Maintainer assessment retries follow their separate authorization.
Credentials absent at screening produce unavailable evidence.

```quint
import terms as T from "./terms"
type Phase = Queued | Running | Legitimate | NeedsInformation | Spam | Unavailable
type Review = PendingReview | Forward | RequestInformation
type Screening = { reporter: int, revision: int, version: int, digest: str, phase: Phase, review: Review,
  startedAt: int, routed: bool, noticeVersions: Set[int], reportDigests: List[str], exclusions: T::ExclusionContext }
type Clock = UnknownClock | ExactClock({ nowMs: int })
type Claim = { revision: int, version: int, digest: str }
pure val initial: Screening = { reporter: 1, revision: 1, version: 1, digest: "original", phase: Queued, review: PendingReview,
  startedAt: 0, routed: false, noticeVersions: Set(), reportDigests: List("original"), exclusions: T::noExclusions }
pure def qualified(s: Screening): bool = s.review == Forward or (s.review == PendingReview and s.phase == Legitimate)
pure def recoverable(s: Screening, clock: Clock): bool =
  match clock {
    | UnknownClock => s.phase == Queued or s.phase == Unavailable
    | ExactClock(t) => s.phase == Queued or s.phase == Unavailable
      or (s.phase == Running and t.nowMs >= s.startedAt and t.nowMs - s.startedAt >= 900000)
  }
pure def canClaim(s: Screening, seenRevision: int, nowMs: int, admitted: bool): bool =
  seenRevision == s.revision and nowMs > 0 and admitted and s.review == PendingReview and recoverable(s, ExactClock({ nowMs: nowMs }))
pure def claim(s: Screening, seenRevision: int, nowMs: int, admitted: bool): Screening =
  { ...s, revision: s.revision + 1, phase: Running, startedAt: nowMs }
pure def owns(s: Screening, token: Claim): bool =
  s.phase == Running and s.revision == token.revision and s.version == token.version and s.digest == token.digest
pure def alwaysClockBindings(s: Screening): bool = s.startedAt >= 0 and (s.phase == Running implies s.startedAt > 0)
pure def stepRevisionAdvancesOnce(before: Screening, after: Screening): bool =
  after.revision >= before.revision and after.revision <= before.revision + 1
```

### The fixed private route treats missing and partial provider evidence as unavailable

Check exact evidence duplication within the project before a call. Exact
duplication holds for private review without spending. Private automatic
screening uses Surplus and records the requested `claude-sonnet-5.5` id.
PRD section 5 (operator decision of 16 November 2026, replacing the
Orbio-first order of 11 November) routes private-report analysis through
Surplus Sonnet, then Surplus Terra, then Orbio Sonnet as the backstop; a
Surplus spending denial goes directly to Orbio, and the request waits for the
Surplus reset only when Orbio serves no valid result. PRD section 8 requires
the existing Surplus account with no provider fallback. This is an owner decision gate: until the owner confirms, the narrower
confidential Surplus route governs private-report analysis.
Credentials, exact retained bytes, complete response and validated schema
gate a recommendation. Truncated, malformed, refused and timed-out answers
are unavailable. A proposal with a supplied earlier case match becomes
needs information. When prior case summaries informed the request, display
the bounded generic reason, never free-form model text to the reporter.
The request carries Slop's default exclusions and the owner's exclusions of
a scoped receipt, or none ([terms](./terms.md)); the screening records that
context. A matching exclusion is named only in the free-text reason
(`SCREENING_PROMPT` and `parseScreeningProposal` in
`backend/security/analysis.ts` carry no line field), which is advice; no
structured line is recorded and the phase never depends on it.

```quint
type ProviderRoute = Surplus | Absent | OtherRoute
type Observation = DuplicateEvidence | Unready | Incomplete
  | Proposal({ phase: Phase, validResponse: bool, matchesPriorCase: bool, suppliedPriorCases: bool })
type Input = { exactVersionLoaded: bool, duplicateEvidence: bool, route: ProviderRoute, exclusions: T::ExclusionContext }
pure def mayCall(s: Screening, token: Claim, input: Input): bool =
  owns(s, token) and input.exactVersionLoaded and not(input.duplicateEvidence) and input.route == Surplus
pure def providerPhase(phase: Phase): bool = phase == Legitimate or phase == NeedsInformation or phase == Spam
pure def observedPhase(observation: Observation): Phase =
  match observation {
    | DuplicateEvidence => NeedsInformation
    | Unready => Unavailable
    | Incomplete => Unavailable
    | Proposal(p) => if (not(p.validResponse) or not(providerPhase(p.phase))) Unavailable
      else if (p.matchesPriorCase) NeedsInformation else p.phase
  }
pure def privateReasonMayUseProposal(observation: Observation): bool =
  match observation {
    | Proposal(p) => p.validResponse and providerPhase(p.phase) and not(p.matchesPriorCase) and not(p.suppliedPriorCases)
    | _ => false
  }
pure def acceptsObservation(s: Screening, token: Claim, input: Input, observation: Observation): bool =
  match observation {
    | DuplicateEvidence => input.duplicateEvidence
    | Unready => not(input.duplicateEvidence) and not(mayCall(s, token, input))
    | _ => mayCall(s, token, input)
  }
pure def canFinish(s: Screening, token: Claim, input: Input, observation: Observation): bool =
  owns(s, token) and acceptsObservation(s, token, input, observation)
pure def finish(s: Screening, token: Claim, input: Input, observation: Observation): Screening =
  { ...s, revision: s.revision + 1, phase: observedPhase(observation), exclusions: input.exclusions }
pure def lawDuplicateNeverCalls(s: Screening, token: Claim, input: Input): bool =
  input.duplicateEvidence implies not(mayCall(s, token, input))
pure def lawOnlySurplusReceivesLoadedVersion(s: Screening, token: Claim, input: Input): bool =
  mayCall(s, token, input) implies input.route == Surplus and input.exactVersionLoaded and owns(s, token)
pure def sometimesLegitimate(s: Screening): bool = s.phase == Legitimate
pure def sometimesNeedsInformation(s: Screening): bool = s.phase == NeedsInformation
pure def sometimesUnavailable(s: Screening): bool = s.phase == Unavailable
pure def sometimesScreenedWithOwnerExclusions(s: Screening): bool = s.exclusions.owner.length() > 0
  and (s.phase == Legitimate or s.phase == NeedsInformation or s.phase == Spam)
```

### A late result cannot replace human review or a newly saved version

A current security maintainer other than the reporter may forward or ask for
information with a valid reason; the [composed report flow](./journey.md) supplies
`currentMaintainer` from the case's verified authority snapshot. Require optimistic versions for both intake and case before
a reporter replaces an eligible draft or failed report. The transaction
advances both records and appends exact retained evidence. A successful
replacement queues new screening and clears current routing. Preserve prior
versions and their notices. The shell checks the concurrent case revision,
case eligibility, private object and reporter before this event.

```quint
type RevisionEvidence = { isReporter: bool, draftOrFailed: bool, noAdvisory: bool, caseNeedsInformation: bool,
  exactCaseCas: bool, allowedCaseState: bool, exactObjectStored: bool, admitted: bool }
pure def canReviewReport(s: Screening, by: int, seenRevision: int, decision: Review, currentMaintainer: bool, checkedReason: bool): bool =
  seenRevision == s.revision and by != s.reporter and currentMaintainer and checkedReason and decision != PendingReview
pure def reviewReport(s: Screening, by: int, seenRevision: int, decision: Review, currentMaintainer: bool, checkedReason: bool): Screening =
  { ...s, revision: s.revision + 1, review: decision }
pure def revisionPermitted(s: Screening, evidence: RevisionEvidence): bool =
  evidence.isReporter and evidence.draftOrFailed and evidence.noAdvisory and evidence.exactCaseCas and evidence.allowedCaseState
    and evidence.exactObjectStored and evidence.admitted
    and (s.review == RequestInformation or evidence.caseNeedsInformation or
      (s.review == PendingReview and (s.phase == NeedsInformation or s.phase == Spam or s.phase == Unavailable)))
pure def canReplace(s: Screening, seenRevision: int, digest: str, evidence: RevisionEvidence): bool =
  seenRevision == s.revision and digest != "" and digest != s.digest and revisionPermitted(s, evidence)
pure def replace(s: Screening, seenRevision: int, digest: str, evidence: RevisionEvidence): Screening =
  { ...s, revision: s.revision + 1, version: s.version + 1, digest: digest, phase: Queued, startedAt: 0,
    review: PendingReview, routed: false, reportDigests: s.reportDigests.append(digest) }
pure def alwaysHistoryMatchesVersion(s: Screening): bool = s.version >= 1 and s.version == s.reportDigests.length()
  and s.digest != "" and (if (s.version >= 1 and s.version == s.reportDigests.length())
    s.reportDigests.nth(s.version - 1) == s.digest else false)
pure def stepReportHistoryRetained(before: Screening, after: Screening): bool =
  after.reportDigests == before.reportDigests or after.reportDigests == before.reportDigests.append(after.digest)
pure def sometimesRevised(s: Screening): bool = s.version > 1
```

### Routing writes only private references for the current qualified version

Routing requires the exact revision and current technical approver or
triager context. Exclude the reporter and the acting maintainer from their
own notice. An acting sole technical approver may complete routing without
mailing themselves. Missing contacts keep routing pending. The database
deduplicates each submission, version and recipient. The notification worker
checks recipient authority again before delivery. Routing and model output
leave case findings, award authority and disclosures with their owners.

```quint
type Routing = { checkedContext: bool, eligibleRecipients: bool, actingTechnicalApprover: bool }
pure def canRoute(s: Screening, seenRevision: int, routing: Routing): bool =
  seenRevision == s.revision and qualified(s) and not(s.routed) and routing.checkedContext
    and (routing.eligibleRecipients or routing.actingTechnicalApprover)
pure def route(s: Screening, seenRevision: int, routing: Routing): Screening =
  { ...s, revision: s.revision + 1, routed: true,
    noticeVersions: if (routing.eligibleRecipients) s.noticeVersions.union(Set(s.version)) else s.noticeVersions }
pure def alwaysRecordedNoticeBelongsToRetainedVersion(s: Screening): bool =
  s.noticeVersions.forall(version => version > 0 and version <= s.version)
pure def stepNoticeHistoryRetained(before: Screening, after: Screening): bool = before.noticeVersions.subseteq(after.noticeVersions)
pure def stepNewRoutingNeedsQualification(before: Screening, after: Screening): bool =
  after.routed and not(before.routed) implies before.version == after.version and qualified(before)
pure def sometimesRouted(s: Screening): bool = s.routed
```

### Samples exercise missing, stale, duplicate and current screening evidence

```quint
pure val seenRevisionValues = Set(1, 2, 3, 4, 5, 6, 7, 8, 9)
pure val nowMsValues = Set(1, 2, 900000, 900001, 1800001)
pure val digestValues = Set("original", "revised", "new")
pure val tokenValues = Set(2, 3, 4, 5, 6, 7, 8, 9).fold(Set(), (tokens, revision) =>
  tokens.union(Set({ revision: revision, version: 1, digest: "original" },
    { revision: revision, version: 2, digest: "revised" })))
pure val sampleExclusions: T::ExclusionContext = { defaults: T::slopDefaultExclusionCount, owner: List(3) }
pure val inputValues = Set(
  { exactVersionLoaded: true, duplicateEvidence: false, route: Surplus, exclusions: sampleExclusions },
  { exactVersionLoaded: true, duplicateEvidence: false, route: Surplus, exclusions: T::noExclusions },
  { exactVersionLoaded: false, duplicateEvidence: false, route: Absent, exclusions: sampleExclusions },
  { exactVersionLoaded: true, duplicateEvidence: true, route: Surplus, exclusions: sampleExclusions })
pure val observationValues = Set(DuplicateEvidence, Unready, Incomplete,
  Proposal({ phase: Legitimate, validResponse: true, matchesPriorCase: false, suppliedPriorCases: false }),
  Proposal({ phase: Legitimate, validResponse: true, matchesPriorCase: true, suppliedPriorCases: true }),
  Proposal({ phase: Spam, validResponse: true, matchesPriorCase: false, suppliedPriorCases: true }),
  Proposal({ phase: Spam, validResponse: false, matchesPriorCase: false, suppliedPriorCases: false }))
pure val evidenceValues = Set(
  { isReporter: true, draftOrFailed: true, noAdvisory: true, caseNeedsInformation: false, exactCaseCas: true,
    allowedCaseState: true, exactObjectStored: true, admitted: true },
  { isReporter: true, draftOrFailed: true, noAdvisory: true, caseNeedsInformation: false, exactCaseCas: false,
    allowedCaseState: true, exactObjectStored: true, admitted: true })
pure val routingValues = Set(
  { checkedContext: true, eligibleRecipients: true, actingTechnicalApprover: false },
  { checkedContext: true, eligibleRecipients: false, actingTechnicalApprover: true },
  { checkedContext: true, eligibleRecipients: false, actingTechnicalApprover: false })
pure val byValues = Set(1, 2)
pure val weight_claim = 35
pure val weight_finish = 100
pure val weight_reviewReport = 20
pure val weight_replace = 45
pure val weight_route = 50
```
