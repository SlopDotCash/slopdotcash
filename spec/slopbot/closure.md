# Qualified automatic closure

PRD section 5 governs closure, and CLAUDE.md "Slopbot" and "Automatic closure"
restate it. The project automatic-closure setting comes from the approved
project revision: a new draft starts unchecked and a missing saved value is
false (owner decision, 13 November 2026;
[closure consent](../backend/closureConsent.md)). Source
`workers/slopbot/review.ts` (`runReview`, `stillMayClose`, `closureState`,
`confirmedClosure`, `grounded`), `closure-eligibility.ts`,
`close-attempts.ts`, `maintainer-holds.ts`, `contracts.ts` and migrations
`0060`, `0064` and `0117` at the development head.

Each instance is one reviewed item revision. Every fact that authorizes an
action is either state this model owns or a typed observation whose
provenance is a named verified service:

| Observation | Verified by |
|---|---|
| `SourceObservation` | the GitHub review adapter: exact item, head, content digest, installation, item state, assignees, author role, the approved project revision with its saved consent, and the repository's `.github/slopbot.json` |
| `ParticipationEvidence` | the closure-eligibility reader over `points_members`, `trace_runs` and `run_progress_events` in D1 |
| `Verdict` | the provider route of review (`review.md`), one retained call record per triage or confirm call |
| `ActivationView` | closure activation (`closureActivation.md`) |
| `CapacityGrant` | close capacity (`closeCapacity.md`), which reserves the repository slot in the same D1 write |
| `CloseEvidence`, `GithubRefusal`, `TimelineObservation`, `ReopenEvidence`, `RemovalEvidence` | GitHub's immutable close event, response status, issue timeline, reopen event and label read |
| `AppealOutcome` | appeals (`appeals.md`) |

Binding these sibling machines into one composed state is an open
composition obligation; until then each observation is an input of this
machine. A shell obligation remains: each adapter must produce its
observation from the named verified source and never from request text.

## Story: Decide a current review under the registered repository's policy

### Review actions require the exact current source and effective repository scope

The observation binds project, permanent repository ID, item kind and node,
head revision, content digest and author. An unknown source, installation,
item state, coverage, assignment or author role refuses action and leaves the
item recoverable for a later check. A draft, merged or closed item, a removed
or suspended installation and a limited review cannot label, close or
penalize. A paused, flagged or quarantined project (`SecurityOnly`) permits
only an authorized security comment and the confirmed scam label. A retired
(`ReversalOnly`) or unregistered repository permits no review action. The
decision keeps the scope where it was made, so a security-only result never
becomes a full-review decision after reinstatement.

```quint
import categories as F from "./categories"
import closureConsent as CC from "../backend/closureConsent"
type ItemKind = PullRequest | Issue
type RepositoryScope = Unregistered | Active | SecurityOnly | ReversalOnly
type SourceStatus = SourceUnknown | SourceCurrent | SourceSuperseded
type InstallationStatus = InstallationUnknown | InstallationActive | InstallationSuspended | InstallationRemoved
type ItemState = ItemUnknown | ItemOpen | ItemClosed | ItemMerged
type ClosedBy = NotClosed | ClosedBySlopbot | ClosedByHuman
type Coverage = CoverageUnknown | CoverageComplete | CoverageLimited
type Assignment = AssignmentUnknown | Unassigned | Assigned
type AuthorRole = RoleUnknown | Maintainer | NonMaintainer
type PolicyFile = FileAbsent | FileValid | FileInvalid
type CategoryMode = ModeOff | ModeLabel | ModeClose
type ReviewIdentity = { project: int, repository: int, kind: ItemKind, itemNode: str, revision: str,
  contentDigest: str, author: int }
type SourceObservation = { identity: ReviewIdentity, scope: RepositoryScope, source: SourceStatus,
  installation: InstallationStatus, item: ItemState, closedBy: ClosedBy, draft: bool, coverage: Coverage,
  assignment: Assignment, authorRole: AuthorRole, projectRevision: int, consent: CC::SavedConsent,
  file: PolicyFile, fileClosure: bool, modeCategory: F::Category, fileMode: CategoryMode, securityAuthorized: bool }
pure val reviewedItem: ReviewIdentity = { project: 1, repository: 7, kind: PullRequest, itemNode: "pr",
  revision: "head", contentDigest: "review", author: 5 }
pure val unknownSource: SourceObservation = { identity: reviewedItem, scope: Unregistered, source: SourceUnknown,
  installation: InstallationUnknown, item: ItemUnknown, closedBy: NotClosed, draft: false, coverage: CoverageUnknown,
  assignment: AssignmentUnknown, authorRole: RoleUnknown, projectRevision: 0, consent: CC::Absent,
  file: FileInvalid, fileClosure: false, modeCategory: F::NoFinding, fileMode: ModeOff, securityAuthorized: false }
pure def sourceUsable(o: SourceObservation, identity: ReviewIdentity): bool =
  o.identity == identity and o.source == SourceCurrent and o.installation == InstallationActive and
  o.item == ItemOpen and not(o.draft) and o.coverage != CoverageUnknown
pure def lawUnknownSourceRefusesAction(identity: ReviewIdentity): bool = not(sourceUsable(unknownSource, identity))
```

### The effective policy keeps file opt-outs, category restrictions and the saved project consent

Source `projectRepositoryConfig`: effective closure is the saved project
consent and the file's `closure` value; a missing file defers to the saved
consent with the default category modes; an invalid file is label-only for
every category and never closes. A category that can never close is
label-only even if a file asks for closure, since such a file is invalid.

```quint
pure def defaultMode(category: F::Category): CategoryMode =
  if (category == F::NoFinding) ModeOff
  else if (category == F::OutOfScope or category == F::MissingEvidence or category == F::LowQuality) ModeLabel
  else ModeClose
pure def effectiveMode(o: SourceObservation, category: F::Category): CategoryMode =
  if (category == F::NoFinding) ModeOff
  else if (o.file == FileInvalid) ModeLabel
  else if (o.file == FileAbsent) defaultMode(category)
  else if (o.modeCategory != category) ModeOff
  else if (F::neverCloses(category) and o.fileMode == ModeClose) ModeLabel
  else o.fileMode
pure def effectiveClosure(o: SourceObservation): bool =
  CC::checkedOnLoad(o.consent) and (o.file == FileAbsent or (o.file == FileValid and o.fileClosure))
pure def lawMissingConsentNeverCloses(sampleObservation: SourceObservation): bool =
  sampleObservation.consent != CC::Enabled implies not(effectiveClosure(sampleObservation))
pure def lawInvalidFileIsLabelOnly(sampleObservation: SourceObservation, category: F::Category): bool =
  sampleObservation.file == FileInvalid implies not(effectiveClosure(sampleObservation)) and effectiveMode(sampleObservation, category) != ModeClose
pure def lawNeverCloseCategoriesNeverModeClose(sampleObservation: SourceObservation, category: F::Category): bool =
  F::neverCloses(category) implies effectiveMode(sampleObservation, category) != ModeClose
pure def lawFileOptOutWins(sampleObservation: SourceObservation): bool =
  (sampleObservation.file == FileValid and not(sampleObservation.fileClosure)) implies not(effectiveClosure(sampleObservation))
```

### Only the author's own authenticated run for the exact PR supplies participation authority

Participation needs an active Slop membership (`points_members.closed_at IS
NULL`) for the author's permanent GitHub ID and a `pull_request_opened` event
whose actor equals the run's authenticated session actor, recorded for this
project and permanent repository ID and naming this exact PR node. A copied
footer, marker, receipt or URL supplies none of these facts. A closed, absent
or unknown membership refuses closure.

```quint
type Membership = MemberUnknown | MemberAbsent | MemberActive | MemberClosed
type PrOpenedEvent = { actor: int, sessionActor: int, project: int, repository: int, prNode: str }
type ParticipationEvidence = { member: int, membership: Membership, events: List[PrOpenedEvent], copiedMarker: bool }
pure val noParticipation: ParticipationEvidence = { member: 0, membership: MemberUnknown, events: List(), copiedMarker: false }
pure def participationAuthority(p: ParticipationEvidence, identity: ReviewIdentity): bool =
  identity.kind == PullRequest and identity.author > 0 and p.member == identity.author and
  p.membership == MemberActive and p.events.some(e => e.actor == identity.author and
    e.sessionActor == identity.author and e.project == identity.project and
    e.repository == identity.repository and e.prNode == identity.itemNode)
pure def lawCopiedMarkerNeverAuthorizes(sampleRun: ParticipationEvidence, identity: ReviewIdentity): bool =
  participationAuthority({ ...sampleRun, copiedMarker: true }, identity) iff participationAuthority({ ...sampleRun, copiedMarker: false }, identity)
pure def lawClosedMembershipRefuses(sampleRun: ParticipationEvidence, identity: ReviewIdentity): bool =
  sampleRun.membership != MemberActive implies not(participationAuthority(sampleRun, identity))
pure def lawOtherActorsRunRefuses(sampleRun: ParticipationEvidence, identity: ReviewIdentity): bool =
  sampleRun.events.every(e => e.actor != identity.author or e.sessionActor != identity.author) implies
    not(participationAuthority(sampleRun, identity))
```

### Two independent grounded verdicts with the same category are required before any close

The first call is triage; a close also needs a confirm call. A verdict is
grounded when its evidence is verbatim item text and, outside the universal
categories, its cited rule is found verbatim in the reviewed policy. A
finding is uncertain when it is not grounded, has confidence below 90
hundredths, reports limitations, or is a duplicate with no verified related
open item by the same author. On the closure path a deterministic prefilter
without model triage and a confirm call that disagrees, is ungrounded or is
not confident are uncertain too. Objective low quality also needs the same
objective defect in both verdicts.

```quint
type Verdict = { category: F::Category, confidenceHundredths: int, limitations: bool, evidenceVerbatim: bool,
  ruleQuotedVerbatim: bool, relatedOpenItem: bool, objectiveDefect: str, deterministic: bool }
pure val noVerdict: Verdict = { category: F::NoFinding, confidenceHundredths: 0, limitations: false,
  evidenceVerbatim: false, ruleQuotedVerbatim: false, relatedOpenItem: false, objectiveDefect: "", deterministic: false }
pure def validVerdict(v: Verdict): bool = F::validConfidence(v.confidenceHundredths)
pure def grounded(v: Verdict): bool =
  v.deterministic or (v.evidenceVerbatim and (F::universal(v.category) or v.ruleQuotedVerbatim))
pure def initiallyUncertain(v: Verdict): bool = v.category != F::NoFinding and
  (not(grounded(v)) or not(F::confident(v.confidenceHundredths)) or v.limitations or
    (v.category == F::Duplicate and not(v.relatedOpenItem)))
pure def confirms(verdict: Verdict, confirmVerdict: Verdict): bool =
  not(verdict.deterministic) and not(confirmVerdict.deterministic) and verdict.category == confirmVerdict.category and
  F::confident(verdict.confidenceHundredths) and F::confident(confirmVerdict.confidenceHundredths) and
  not(verdict.limitations) and not(confirmVerdict.limitations) and grounded(verdict) and grounded(confirmVerdict) and
  (verdict.category != F::LowQuality or (verdict.objectiveDefect != "" and verdict.objectiveDefect == confirmVerdict.objectiveDefect))
pure def lawUncertainNeverConfirms(sampleVerdict: Verdict, otherVerdict: Verdict): bool =
  initiallyUncertain(sampleVerdict) and sampleVerdict.category != F::Duplicate implies not(confirms(sampleVerdict, otherVerdict))
pure def lawDeterministicNeverConfirms(sampleVerdict: Verdict, otherVerdict: Verdict): bool =
  sampleVerdict.deterministic implies not(confirms(sampleVerdict, otherVerdict))
pure def lawDisagreementNeverConfirms(sampleVerdict: Verdict, otherVerdict: Verdict): bool =
  sampleVerdict.category != otherVerdict.category implies not(confirms(sampleVerdict, otherVerdict))
```

### Closing also needs current production activation, a qualified category and every independent gate

The closure gates are rechecked from fresh state at the decision, at slot
reservation and immediately before the GitHub request: active full-review
scope, a current open PR (never an issue) with complete coverage, no
assignee, a known non-maintainer author, effective closure consent, a close
mode for the category, participation authority, the global switch on with
the category qualified (and the objective verifier for low quality), two
confirming verdicts, and no reopen or appeal of this revision.

```quint
type ActivationView = { enabled: bool, category: F::Category, categoryQualified: bool, verifierQualified: bool }
pure val inactive: ActivationView = { enabled: false, category: F::NoFinding, categoryQualified: false, verifierQualified: false }
pure def activationAllows(a: ActivationView, category: F::Category): bool =
  a.enabled and a.category == category and a.categoryQualified and
  (not(F::requiresObjectiveVerifier(category)) or a.verifierQualified)
pure def lawInactiveNeverAllows(category: F::Category): bool = not(activationAllows(inactive, category))
```

### A decision is recorded once and keeps its scope, verdicts and outcome

`decide` records exactly one outcome for the revision: advisory (no finding,
limited coverage or mode off), a certain label, an uncertain maintainer hold,
a security-only comment, or a close candidate. A close candidate still has to
reserve capacity and pass the final recheck before any GitHub request. A
budget-blocked or failed confirm call leaves the revision triaged and
retryable; it never decides.

```quint
type Phase = Unreviewed | Triaged | Decided
type Outcome = Undecided | Advisory | LabelFinding | Uncertain | SecurityAdvisory | CloseCandidate
type AttemptState = NoAttempt | Pending | Confirmed
type CloseAttempt = { state: AttemptState, id: int, requests: int, closedAt: int, commentConfirmed: bool }
type HoldStatus = NoHold | WaitingForMaintainer | MaintainerActed | HoldSuperseded | HoldLabeled
type Closure = { identity: ReviewIdentity, source: SourceObservation, participation: ParticipationEvidence,
  activation: ActivationView, phase: Phase, triage: Verdict, hasConfirm: bool, confirm: Verdict,
  outcome: Outcome, decidedScope: RepositoryScope, attempt: CloseAttempt, rejected: List[int],
  now: int, heldAt: int, holdQueuedAt: int, hold: HoldStatus,
  findingLabel: bool, uncertainLabel: bool, moderatorLabel: bool, securityCommented: bool,
  moderatorNotices: Set[int], maintainerReopened: bool, authorAppealed: bool, appealUpheld: bool, slopbotReopened: bool }
pure val noAttempt: CloseAttempt = { state: NoAttempt, id: 0, requests: 0, closedAt: 0, commentConfirmed: false }
pure val initial: Closure = { identity: reviewedItem, source: unknownSource, participation: noParticipation,
  activation: inactive, phase: Unreviewed, triage: noVerdict, hasConfirm: false, confirm: noVerdict,
  outcome: Undecided, decidedScope: Unregistered, attempt: noAttempt, rejected: List(),
  now: 0, heldAt: 0, holdQueuedAt: 0, hold: NoHold,
  findingLabel: false, uncertainLabel: false, moderatorLabel: false, securityCommented: false,
  moderatorNotices: Set(), maintainerReopened: false, authorAppealed: false, appealUpheld: false, slopbotReopened: false }
pure def revisionDisputed(c: Closure): bool = c.maintainerReopened or c.authorAppealed or c.appealUpheld
pure def mayReview(c: Closure): bool = sourceUsable(c.source, c.identity) and not(revisionDisputed(c))
pure def mayPostOrdinary(c: Closure): bool = c.source.scope == Active and mayReview(c)
pure def mayActOrdinary(c: Closure): bool = mayPostOrdinary(c) and c.source.coverage == CoverageComplete
pure def mayPostSecurity(c: Closure): bool = c.source.scope == SecurityOnly and c.source.securityAuthorized and mayReview(c)
pure def closePolicy(c: Closure): bool = mayActOrdinary(c) and c.identity.kind == PullRequest and
  c.source.assignment == Unassigned and c.source.authorRole == NonMaintainer and effectiveClosure(c.source) and
  effectiveMode(c.source, c.triage.category) == ModeClose and F::permittedAction(c.triage.category) == F::CloseAllowed
pure def closeGates(c: Closure): bool = closePolicy(c) and participationAuthority(c.participation, c.identity) and
  activationAllows(c.activation, c.triage.category) and c.hasConfirm and confirms(c.triage, c.confirm)
pure def closePath(c: Closure): bool = closePolicy(c) and participationAuthority(c.participation, c.identity) and
  activationAllows(c.activation, c.triage.category)
pure def uncertainFinding(c: Closure): bool = c.triage.category != F::NoFinding and
  (initiallyUncertain(c.triage) or (closePath(c) and (c.triage.deterministic or
    (c.hasConfirm and not(confirms(c.triage, c.confirm))))))
pure def canObserveSource(c: Closure, observation: SourceObservation): bool = observation.identity == c.identity
pure def observeSource(c: Closure, observation: SourceObservation): Closure = { ...c, source: observation }
pure def observeParticipation(c: Closure, runEvidence: ParticipationEvidence): Closure = { ...c, participation: runEvidence }
pure def observeActivation(c: Closure, view: ActivationView): Closure = { ...c, activation: view }
pure def canRecordTriage(c: Closure, verdict: Verdict): bool =
  c.phase == Unreviewed and validVerdict(verdict) and (mayPostOrdinary(c) or mayPostSecurity(c))
pure def recordTriage(c: Closure, verdict: Verdict): Closure = { ...c, phase: Triaged, triage: verdict }
pure def canRecordConfirm(c: Closure, verdict: Verdict): bool =
  c.phase == Triaged and not(c.hasConfirm) and validVerdict(verdict) and closePath(c) and
  not(initiallyUncertain(c.triage)) and not(c.triage.deterministic)
pure def recordConfirm(c: Closure, verdict: Verdict): Closure = { ...c, hasConfirm: true, confirm: verdict }
pure def needsConfirm(c: Closure): bool = closePath(c) and not(initiallyUncertain(c.triage)) and
  not(c.triage.deterministic) and not(c.hasConfirm)
pure def outcomeFor(c: Closure): Outcome =
  if (c.source.scope == SecurityOnly) SecurityAdvisory
  else if (c.triage.category == F::NoFinding or c.source.coverage != CoverageComplete or
    effectiveMode(c.source, c.triage.category) == ModeOff) Advisory
  else if (uncertainFinding(c)) Uncertain
  else if (closeGates(c)) CloseCandidate
  else LabelFinding
pure def canDecide(c: Closure): bool = c.phase == Triaged and
  (if (c.source.scope == SecurityOnly) mayPostSecurity(c) else mayPostOrdinary(c) and not(needsConfirm(c)))
pure def decide(c: Closure): Closure =
  { ...c, phase: Decided, outcome: outcomeFor(c), decidedScope: c.source.scope }
pure def alwaysOutcomeOnlyWhenDecided(c: Closure): bool = (c.phase == Decided) iff (c.outcome != Undecided)
pure def alwaysTriageBeforeConfirm(c: Closure): bool = c.hasConfirm implies c.phase != Unreviewed
pure def alwaysOrdinaryOutcomesActive(c: Closure): bool =
  (c.outcome == Advisory or c.outcome == LabelFinding or c.outcome == Uncertain or c.outcome == CloseCandidate)
    implies c.decidedScope == Active
pure def alwaysSecurityDecisionKeepsScope(c: Closure): bool =
  (c.outcome == SecurityAdvisory iff (c.phase == Decided and c.decidedScope == SecurityOnly)) and
  (c.phase == Decided implies (c.decidedScope == Active or c.decidedScope == SecurityOnly))
pure def stepDecisionImmutable(before: Closure, after: Closure): bool = before.phase == Decided implies
  after.phase == Decided and after.outcome == before.outcome and after.decidedScope == before.decidedScope and
  after.triage == before.triage and after.confirm == before.confirm and after.hasConfirm == before.hasConfirm
pure def stepIdentityFixed(before: Closure, after: Closure): bool = after.identity == before.identity
pure def sometimesAdvisory(c: Closure): bool = c.outcome == Advisory
pure def sometimesLabelOutcome(c: Closure): bool = c.outcome == LabelFinding
```

## Story: Close at most once, never resend, and reconcile lost responses

### The repository slot is reserved before the request and a request is sent at most once

Source `reserveClose`: one serialized D1 write owns the repository slot
under the current review claim before any external request. The model keeps
one live attempt per revision. The GitHub close request is issued only after
a final fresh recheck of every gate and at most once per attempt, so replay
never sends another close.

```quint
type CapacityGrant = { repository: int, itemNode: str, revision: str, attemptId: int }
pure def canReserveClose(c: Closure, grant: CapacityGrant): bool =
  c.outcome == CloseCandidate and closeGates(c) and c.attempt.state == NoAttempt and
  grant.repository == c.identity.repository and grant.itemNode == c.identity.itemNode and
  grant.revision == c.identity.revision and grant.attemptId > c.attempt.id and
  not(c.rejected.includes(grant.attemptId)) and c.rejected.every(r => r < grant.attemptId)
pure def reserveClose(c: Closure, grant: CapacityGrant): Closure =
  { ...c, attempt: { state: Pending, id: grant.attemptId, requests: 0, closedAt: 0, commentConfirmed: false } }
pure def canRequestClose(c: Closure): bool = c.attempt.state == Pending and c.attempt.requests == 0 and closeGates(c)
pure def requestClose(c: Closure): Closure = { ...c, attempt: { ...c.attempt, requests: 1 } }
pure def alwaysAtMostOneRequest(c: Closure): bool = c.attempt.requests >= 0 and c.attempt.requests <= 1 and
  (c.attempt.state == NoAttempt implies c.attempt == noAttempt)
pure def alwaysAttemptOnlyForCloseCandidate(c: Closure): bool = c.attempt.state != NoAttempt implies
  c.outcome == CloseCandidate and c.identity.kind == PullRequest and c.hasConfirm and confirms(c.triage, c.confirm) and
  F::permittedAction(c.triage.category) == F::CloseAllowed and c.decidedScope == Active
pure def stepRequestOnlyWhenEligible(before: Closure, via: str, after: Closure): bool =
  via == "requestClose" implies closeGates(before)
pure def stepNoResend(before: Closure, after: Closure): bool =
  (before.attempt.id == after.attempt.id and before.attempt.state != NoAttempt) implies after.attempt.requests >= before.attempt.requests
```

### Only GitHub's own close evidence confirms and only a definitive refusal releases

A confirmed close needs GitHub's immutable close event by the Slopbot App on
the reviewed revision with its `closed_at`. A definitive 401, 403, 404, 410,
422 or 429 response rejects the attempt and releases its slot; a later retry
creates a new attempt and never rewrites the rejected one. A timeout, lost
response, a human close or unavailable evidence keeps the attempt pending;
pending attempts never expire with the review lease and keep occupying
capacity until reconciled (an operator release of a stuck attempt is an
owner decision gate, not modeled as allowed). After confirmation the close
comment is retried until GitHub confirms it.

```quint
type CloseActor = ActorUnknown | SlopbotApp | HumanActor
type CloseEvidence = { itemNode: str, revision: str, closedBy: CloseActor, closedAt: int }
type GithubRefusal = { attemptId: int, status: int }
pure def definitiveRefusal(status: int): bool =
  status == 401 or status == 403 or status == 404 or status == 410 or status == 422 or status == 429
pure def canConfirmClose(c: Closure, closeEvent: CloseEvidence): bool =
  c.attempt.state == Pending and c.attempt.requests == 1 and closeEvent.itemNode == c.identity.itemNode and
  closeEvent.revision == c.identity.revision and closeEvent.closedBy == SlopbotApp and closeEvent.closedAt > 0
pure def confirmClose(c: Closure, closeEvent: CloseEvidence): Closure =
  { ...c, attempt: { ...c.attempt, state: Confirmed, closedAt: closeEvent.closedAt } }
pure def canRejectClose(c: Closure, refusal: GithubRefusal): bool =
  c.attempt.state == Pending and c.attempt.requests == 1 and refusal.attemptId == c.attempt.id and
  definitiveRefusal(refusal.status)
pure def rejectClose(c: Closure, refusal: GithubRefusal): Closure =
  { ...c, attempt: noAttempt, rejected: c.rejected.append(refusal.attemptId) }
pure def canConfirmCloseComment(c: Closure): bool = c.attempt.state == Confirmed and not(c.attempt.commentConfirmed)
pure def confirmCloseComment(c: Closure): Closure = { ...c, attempt: { ...c.attempt, commentConfirmed: true } }
pure def closedBySlopbot(c: Closure): bool = c.attempt.state == Confirmed
pure def alwaysConfirmedHasCloseTime(c: Closure): bool =
  (c.attempt.state == Confirmed implies c.attempt.closedAt > 0 and c.attempt.requests == 1) and
  (c.attempt.state != Confirmed implies c.attempt.closedAt == 0 and not(c.attempt.commentConfirmed))
pure def alwaysRejectedIdsOrdered(c: Closure): bool =
  c.rejected.every(r => r > 0 and (c.attempt.state == NoAttempt or r < c.attempt.id))
pure def stepRejectedHistoryRetained(before: Closure, after: Closure): bool =
  after.rejected.length() >= before.rejected.length() and before.rejected.every(r => after.rejected.includes(r))
pure def stepConfirmedIsFinal(before: Closure, after: Closure): bool = before.attempt.state == Confirmed implies
  after.attempt.state == Confirmed and after.attempt.id == before.attempt.id and after.attempt.closedAt == before.attempt.closedAt
pure def sometimesConfirmedClose(c: Closure): bool = c.attempt.state == Confirmed
pure def sometimesCloseCommented(c: Closure): bool = c.attempt.commentConfirmed
pure def sometimesRejectedThenRetried(c: Closure): bool = c.rejected.length() > 0 and c.attempt.state == Pending
pure def sometimesPendingAfterRequest(c: Closure): bool = c.attempt.state == Pending and c.attempt.requests == 1
```

### A confirmed scam closure notifies each moderator once and adds the moderator label

Source `notifyScamReviewForPenalty`: a confirmed close of a `scam` finding
(the only `moderator_review` category) records one moderator Inbox notice
per configured moderator under an idempotent key and adds the
`slopbot: moderator` label. The notice is retried from the committed close
even after GitHub already shows the item closed. Moderators are the PRD
section 9 GitHub actors 18633264 and 202660855.

```quint
pure val slopModerators: Set[int] = Set(18633264, 202660855)
pure def canNotifyModerator(c: Closure, recipient: int): bool =
  closedBySlopbot(c) and F::moderatorReview(c.triage.category) and slopModerators.contains(recipient) and
  not(c.moderatorNotices.contains(recipient))
pure def notifyModerator(c: Closure, recipient: int): Closure =
  { ...c, moderatorNotices: c.moderatorNotices.union(Set(recipient)) }
pure def canAddModeratorLabel(c: Closure): bool =
  closedBySlopbot(c) and F::moderatorReview(c.triage.category) and not(c.moderatorLabel)
pure def addModeratorLabel(c: Closure): Closure = { ...c, moderatorLabel: true }
pure def alwaysNoticesOnlyForConfirmedScam(c: Closure): bool =
  (c.moderatorNotices.size() > 0 or c.moderatorLabel) implies closedBySlopbot(c) and c.triage.category == F::Scam
pure def alwaysNoticesToModerators(c: Closure): bool = c.moderatorNotices.subseteq(slopModerators)
pure def sometimesAllModeratorsNotified(c: Closure): bool = slopModerators.subseteq(c.moderatorNotices)
pure val fair_notifyModerator = "weak"
pure def leadsToEveryModeratorNotified(c: Closure, later: Closure): bool =
  (closedBySlopbot(c) and c.triage.category == F::Scam) implies slopModerators.subseteq(later.moderatorNotices)
```

## Story: Label certain findings and security results without closing

### A certain finding that cannot close is labeled once; out-of-scope and missing evidence are label-only

Source `runReview`: a certain finding whose close is blocked by a policy gate
(no consent, an ineligible author, mode label, inactive switch) is commented
and labeled with its category label. Issues are labeled and never closed.

```quint
pure def canLabelFinding(c: Closure): bool =
  c.outcome == LabelFinding and mayActOrdinary(c) and not(c.findingLabel) and
  effectiveMode(c.source, c.triage.category) != ModeOff
pure def labelFinding(c: Closure): Closure = { ...c, findingLabel: true }
pure def alwaysIssuesNeverClose(c: Closure): bool = c.identity.kind == Issue implies c.attempt.state == NoAttempt
pure def alwaysLabelOnlyCategoriesStayOpen(c: Closure): bool =
  F::neverCloses(c.triage.category) implies c.attempt.state == NoAttempt
pure def alwaysUncertainNeverCloses(c: Closure): bool = c.outcome == Uncertain implies c.attempt.state == NoAttempt
pure def sometimesLabeledFinding(c: Closure): bool = c.findingLabel and c.outcome == LabelFinding
```

### A restricted project permits only an authorized security comment and the confirmed scam label

```quint
pure def canCommentSecurity(c: Closure): bool = c.outcome == SecurityAdvisory and mayPostSecurity(c) and not(c.securityCommented)
pure def commentSecurity(c: Closure): Closure = { ...c, securityCommented: true }
pure def canLabelSecurityScam(c: Closure): bool = c.outcome == SecurityAdvisory and mayPostSecurity(c) and
  c.source.coverage == CoverageComplete and
  F::securityCategory(c.triage.category) and not(initiallyUncertain(c.triage)) and not(c.findingLabel)
pure def labelSecurityScam(c: Closure): Closure = { ...c, findingLabel: true }
pure def alwaysRestrictedNeverCloses(c: Closure): bool = c.decidedScope == SecurityOnly implies c.attempt.state == NoAttempt
pure def alwaysSecurityLabelIsScam(c: Closure): bool =
  (c.findingLabel and c.decidedScope == SecurityOnly) implies c.triage.category == F::Scam
pure def sometimesRestrictedScamLabel(c: Closure): bool =
  c.decidedScope == SecurityOnly and c.triage.category == F::Scam and c.securityCommented and c.findingLabel
```

## Story: Give the maintainer seven days to decide an uncertain finding

### The first durable maintainer notice starts the window once

Source `maintainer-holds.ts` derives the deadline from the stored hold
timestamp and preserves it on retry. The hold starts when the maintainer
comment is confirmed and the durable hold is recorded. The adapter supplies
an absolute trusted time in seconds. A notification retry cannot restart the
window. A security-only finding never starts an ordinary hold.

```quint
pure val holdSeconds = 604800
pure val requeueSeconds = 86400
pure def canObserveTime(c: Closure, observedAt: int): bool = observedAt >= c.now
pure def observeTime(c: Closure, observedAt: int): Closure = { ...c, now: observedAt }
pure def canNotifyMaintainer(c: Closure): bool = c.outcome == Uncertain and mayActOrdinary(c) and c.hold == NoHold
pure def notifyMaintainer(c: Closure): Closure = { ...c, heldAt: c.now, hold: WaitingForMaintainer }
pure def holdDue(c: Closure): bool = c.hold == WaitingForMaintainer and c.now - c.heldAt >= holdSeconds
pure def alwaysHoldTime(c: Closure): bool = c.now >= 0 and c.heldAt >= 0 and c.heldAt <= c.now and
  c.holdQueuedAt >= 0 and c.holdQueuedAt <= c.now
pure def alwaysHoldHasUncertainFinding(c: Closure): bool =
  c.hold != NoHold implies c.outcome == Uncertain and c.decidedScope == Active and c.attempt.state == NoAttempt
pure def stepHoldStartRetained(before: Closure, after: Closure): bool =
  before.hold != NoHold implies after.heldAt == before.heldAt and after.hold != NoHold
```

### The scheduled dispatcher queues each due hold and requeues a lost message after a day

Source `dispatchDueJobs`: the five-minute cron selects unresolved holds whose
deadline passed and whose last queue time is absent or a day old, then
records the queue time. The one-time hold resolution and the unique label
action make a duplicate delivery harmless.

```quint
pure def canDispatchHold(c: Closure): bool = holdDue(c) and
  (c.holdQueuedAt == 0 or c.now - c.holdQueuedAt >= requeueSeconds)
pure def dispatchHold(c: Closure): Closure = { ...c, holdQueuedAt: c.now }
pure def holdQueued(c: Closure): bool = c.holdQueuedAt > 0 and c.holdQueuedAt >= c.heldAt + holdSeconds
pure def alwaysQueuedOnlyWhenDue(c: Closure): bool = c.holdQueuedAt > 0 implies c.holdQueuedAt - c.heldAt >= holdSeconds and c.hold != NoHold
pure def sometimesRequeued(c: Closure): bool = holdQueued(c) and c.holdQueuedAt - c.heldAt >= holdSeconds + requeueSeconds
```

### The due hold labels only when current evidence proves no maintainer acted

Current maintainer comments, reviews, labels, assignments and state changes
since the hold began count once attributed to the maintainer. Passive mentions
and subscriptions do not. The observation binds the reviewed revision, the
first notice timestamp and the current decision time. A known changed
source, scope or installation, a closed item, an appeal or a verified reopen
supersedes the hold; an unknown source or timeline refuses labeling and leaves
the hold retryable. The only automatic hold output is the once-only
`slopbot:uncertain` label; it never closes.

```quint
type MaintainerTimeline = TimelineUnknown | NoMaintainerAction | MaintainerAction
type TimelineObservation = { itemNode: str, revision: str, heldAt: int, checkedAt: int, timeline: MaintainerTimeline }
pure def matchesHoldObservation(c: Closure, timeline: TimelineObservation): bool =
  timeline.itemNode == c.identity.itemNode and timeline.revision == c.identity.revision and
  timeline.heldAt == c.heldAt and timeline.checkedAt == c.now
pure def canResolveMaintainerAction(c: Closure, timeline: TimelineObservation): bool =
  holdDue(c) and holdQueued(c) and mayPostOrdinary(c) and matchesHoldObservation(c, timeline) and
  timeline.timeline == MaintainerAction
pure def resolveMaintainerAction(c: Closure, timeline: TimelineObservation): Closure = { ...c, hold: MaintainerActed }
pure def supersedingFact(c: Closure): bool =
  c.source.source == SourceSuperseded or c.source.scope != Active or c.source.installation == InstallationRemoved or
  c.source.installation == InstallationSuspended or c.source.item == ItemClosed or c.source.item == ItemMerged or
  revisionDisputed(c)
pure def canSupersedeHold(c: Closure): bool = holdDue(c) and holdQueued(c) and c.source.identity == c.identity and supersedingFact(c)
pure def supersedeHold(c: Closure): Closure = { ...c, hold: HoldSuperseded }
pure def canLabelUncertain(c: Closure, timeline: TimelineObservation): bool = mayActOrdinary(c) and
  holdDue(c) and holdQueued(c) and matchesHoldObservation(c, timeline) and
  timeline.timeline == NoMaintainerAction and not(c.uncertainLabel)
pure def labelUncertain(c: Closure, timeline: TimelineObservation): Closure =
  { ...c, hold: HoldLabeled, uncertainLabel: true }
pure def alwaysUncertainLabelAfterWindow(c: Closure): bool =
  c.uncertainLabel implies c.hold == HoldLabeled and c.now - c.heldAt >= holdSeconds
pure def alwaysHoldResolvedOnce(c: Closure): bool =
  (c.hold == HoldLabeled or c.hold == MaintainerActed or c.hold == HoldSuperseded) implies c.holdQueuedAt > 0
pure def stepHoldResolutionFinal(before: Closure, after: Closure): bool =
  (before.hold == HoldLabeled or before.hold == MaintainerActed or before.hold == HoldSuperseded) implies after.hold == before.hold
pure def sometimesUncertainLabel(c: Closure): bool = c.hold == HoldLabeled
pure def sometimesMaintainerActed(c: Closure): bool = c.hold == MaintainerActed
pure def sometimesSuperseded(c: Closure): bool = c.hold == HoldSuperseded
```

## Story: Reopen and appeal decisions stop further automatic action on the revision

### Any maintainer reopen or author appeal blocks re-closing that revision

A confirmed reopen event binds the actor, the reopened revision and its
event time. A current maintainer's reopen is a maintainer decision and always
wins. The author's reopen of their own item is an appeal of the revision it
reopened. A reopen by anyone else records no decision (source
`recordHumanSignal`; the README's "any reopen" means these two). An author's
`/slopbot appeal` also disputes the revision. An author's appeal of a
revision that no finding covers decides nothing for that revision, which
keeps its own review (`appeal-before-finding`). Each blocks review actions and
any further close of this revision; a newer head is a new instance.

```quint
type ReopenRole = ReopenByMaintainer | ReopenByAuthor | ReopenByOther
type ReopenEvidence = { itemNode: str, revision: str, actor: int, role: ReopenRole, at: int }
pure def canObserveReopen(c: Closure, reopen: ReopenEvidence): bool =
  reopen.itemNode == c.identity.itemNode and reopen.revision == c.identity.revision and reopen.at > 0 and
  (reopen.role == ReopenByMaintainer or
    (reopen.role == ReopenByAuthor and reopen.actor == c.identity.author and findingRecorded(c)))
pure def observeReopen(c: Closure, reopen: ReopenEvidence): Closure =
  if (reopen.role == ReopenByMaintainer) { ...c, maintainerReopened: true } else { ...c, authorAppealed: true }
pure def findingRecorded(c: Closure): bool = c.phase == Decided and c.triage.category != F::NoFinding
pure def canObserveAuthorAppeal(c: Closure, appellant: int): bool =
  appellant == c.identity.author and appellant > 0 and findingRecorded(c)
pure def observeAuthorAppeal(c: Closure, appellant: int): Closure = { ...c, authorAppealed: true }
pure def stepDisputeIsPermanent(before: Closure, after: Closure): bool =
  (before.maintainerReopened implies after.maintainerReopened) and (before.authorAppealed implies after.authorAppealed) and
  (before.appealUpheld implies after.appealUpheld)
pure def stepNoReservationAfterDispute(before: Closure, after: Closure): bool =
  (revisionDisputed(before) and before.attempt.state == NoAttempt) implies after.attempt.state == NoAttempt
pure def sometimesMaintainerReopened(c: Closure): bool = c.maintainerReopened and closedBySlopbot(c)
```

### An upheld appeal reopens Slopbot's current close and removes Slopbot's labels

Source `finishAppeal`: an upheld appeal of this revision reopens the item
only while Slopbot's own close is current; a later human close stays. The
finding and uncertain labels are removed and GitHub must confirm removal or
absence. A maintainer reopen removes the same labels. The appeal and debit
journals own their resolutions; this model only consumes the outcome.

```quint
type AppealVerdict = AppealUpheld | AppealDenied
type AppealOutcome = { itemNode: str, revision: str, verdict: AppealVerdict }
type RemovalEvidence = { itemNode: str, revision: str, confirmedRemoval: bool }
pure def canObserveAppealOutcome(c: Closure, appealOutcome: AppealOutcome): bool =
  appealOutcome.itemNode == c.identity.itemNode and appealOutcome.revision == c.identity.revision and
  appealOutcome.verdict == AppealUpheld and not(c.appealUpheld)
pure def observeAppealOutcome(c: Closure, appealOutcome: AppealOutcome): Closure = { ...c, appealUpheld: true }
pure def canReopenAfterAppeal(c: Closure): bool = c.appealUpheld and closedBySlopbot(c) and not(c.slopbotReopened) and
  c.source.identity == c.identity and c.source.item == ItemClosed and c.source.closedBy == ClosedBySlopbot and
  c.source.installation == InstallationActive
pure def reopenAfterAppeal(c: Closure): Closure = { ...c, slopbotReopened: true }
pure def canRemoveLabels(c: Closure, removal: RemovalEvidence): bool =
  (c.appealUpheld or c.maintainerReopened) and (c.findingLabel or c.uncertainLabel) and
  removal.itemNode == c.identity.itemNode and removal.revision == c.identity.revision and removal.confirmedRemoval
pure def removeLabels(c: Closure, removal: RemovalEvidence): Closure = { ...c, findingLabel: false, uncertainLabel: false }
pure def alwaysSlopbotReopensOnlyOwnClose(c: Closure): bool = c.slopbotReopened implies c.appealUpheld and closedBySlopbot(c)
pure def sometimesAppealReopened(c: Closure): bool = c.slopbotReopened
pure def sometimesLabelsRemoved(c: Closure): bool = c.hold == HoldLabeled and not(c.uncertainLabel) and c.appealUpheld
```

### Simulation samples include allowed and refused repository, participation and timeline observations

The finite samples exercise changes after a review, closure opt-outs, absent
consent, an invalid file, ineligible participation, inactive activation and
the exact hold boundary. They do not bound production values.

```quint
pure val verifiedSource: SourceObservation = { identity: reviewedItem, scope: Active, source: SourceCurrent,
  installation: InstallationActive, item: ItemOpen, closedBy: NotClosed, draft: false, coverage: CoverageComplete,
  assignment: Unassigned, authorRole: NonMaintainer, projectRevision: 3, consent: CC::Enabled,
  file: FileAbsent, fileClosure: false, modeCategory: F::NoFinding, fileMode: ModeOff, securityAuthorized: false }
pure val observationValues = Set(verifiedSource,
  { ...verifiedSource, scope: SecurityOnly, securityAuthorized: true },
  { ...verifiedSource, consent: CC::Absent },
  { ...verifiedSource, coverage: CoverageLimited },
  { ...verifiedSource, source: SourceSuperseded },
  { ...verifiedSource, item: ItemClosed, closedBy: ClosedBySlopbot },
  { ...verifiedSource, identity: { ...reviewedItem, kind: Issue } })
pure val sampleObservationValues = Set(verifiedSource,
  { ...verifiedSource, scope: ReversalOnly }, { ...verifiedSource, consent: CC::Absent },
  { ...verifiedSource, consent: CC::Disabled },
  { ...verifiedSource, file: FileValid, fileClosure: false, modeCategory: F::Spam, fileMode: ModeClose },
  { ...verifiedSource, file: FileValid, fileClosure: true, modeCategory: F::OutOfScope, fileMode: ModeClose },
  { ...verifiedSource, file: FileInvalid }, { ...verifiedSource, assignment: Assigned },
  { ...verifiedSource, authorRole: RoleUnknown }, { ...verifiedSource, item: ItemClosed, closedBy: ClosedByHuman })
pure val ownRun: PrOpenedEvent = { actor: 5, sessionActor: 5, project: 1, repository: 7, prNode: "pr" }
pure val eligibleParticipation: ParticipationEvidence = { member: 5, membership: MemberActive,
  events: List(ownRun), copiedMarker: false }
pure val runEvidenceValues = Set(eligibleParticipation, { ...eligibleParticipation, membership: MemberClosed })
pure val sampleRunValues = Set(eligibleParticipation,
  { ...eligibleParticipation, membership: MemberClosed },
  { ...eligibleParticipation, events: List({ ...ownRun, sessionActor: 6 }), copiedMarker: true },
  { ...eligibleParticipation, events: List({ ...ownRun, prNode: "other" }) },
  { ...eligibleParticipation, events: List({ ...ownRun, repository: 8 }) })
pure val activeSpam: ActivationView = { enabled: true, category: F::Spam, categoryQualified: true, verifierQualified: false }
pure val viewValues = Set(activeSpam, { ...activeSpam, category: F::Scam })
pure val spamVerdict: Verdict = { category: F::Spam, confidenceHundredths: 95, limitations: false,
  evidenceVerbatim: true, ruleQuotedVerbatim: false, relatedOpenItem: false, objectiveDefect: "", deterministic: false }
pure val verdictValues = Set(spamVerdict, { ...spamVerdict, category: F::Scam },
  { ...spamVerdict, confidenceHundredths: 89 }, { ...spamVerdict, category: F::OutOfScope, ruleQuotedVerbatim: true })
pure val sampleVerdictValues = Set(spamVerdict, { ...spamVerdict, confidenceHundredths: 89 },
  { ...spamVerdict, deterministic: true }, { ...spamVerdict, category: F::Busywork },
  { ...spamVerdict, category: F::Busywork, ruleQuotedVerbatim: true }, { ...spamVerdict, limitations: true },
  { ...spamVerdict, category: F::Duplicate }, { ...spamVerdict, category: F::Duplicate, relatedOpenItem: true },
  { ...spamVerdict, category: F::LowQuality, ruleQuotedVerbatim: true, objectiveDefect: "d" },
  { ...spamVerdict, category: F::LowQuality, ruleQuotedVerbatim: true, objectiveDefect: "e" })
pure val otherVerdictValues = sampleVerdictValues
pure val identityValues = Set(reviewedItem, { ...reviewedItem, author: 6 }, { ...reviewedItem, kind: Issue })
pure val grantValues = Set({ repository: 7, itemNode: "pr", revision: "head", attemptId: 1 },
  { repository: 7, itemNode: "pr", revision: "head", attemptId: 2 })
pure val closeEvidence: CloseEvidence = { itemNode: "pr", revision: "head", closedBy: SlopbotApp, closedAt: 100 }
pure val closeEventValues = Set(closeEvidence, { ...closeEvidence, closedBy: HumanActor })
pure val refusalValues = Set({ attemptId: 1, status: 422 }, { attemptId: 1, status: 504 })
pure val recipientValues = Set(18633264, 202660855)
pure val observedAtValues = Set(604800, 691200)
pure val dueObservation: TimelineObservation = { itemNode: "pr", revision: "head", heldAt: 0, checkedAt: 604800,
  timeline: NoMaintainerAction }
pure val timelineValues = Set(dueObservation, { ...dueObservation, timeline: MaintainerAction },
  { ...dueObservation, timeline: TimelineUnknown })
pure val reopenValues = Set({ itemNode: "pr", revision: "head", actor: 9, role: ReopenByMaintainer, at: 50 },
  { itemNode: "pr", revision: "head", actor: 5, role: ReopenByAuthor, at: 50 },
  { itemNode: "pr", revision: "head", actor: 6, role: ReopenByOther, at: 50 })
pure val appellantValues = Set(5, 6)
pure val appealOutcomeValues = Set({ itemNode: "pr", revision: "head", verdict: AppealUpheld })
pure val removalValues = Set({ itemNode: "pr", revision: "head", confirmedRemoval: true })
pure val weight_observeSource = 3
pure val weight_observeParticipation = 3
pure val weight_observeActivation = 3
pure val weight_recordTriage = 20
pure val weight_recordConfirm = 15
pure val weight_decide = 20
pure val weight_reserveClose = 20
pure val weight_requestClose = 20
pure val weight_confirmClose = 20
pure val weight_rejectClose = 15
pure val weight_confirmCloseComment = 8
pure val weight_notifyModerator = 20
pure val weight_notifyMaintainer = 10
pure val weight_observeTime = 3
pure val weight_dispatchHold = 10
pure val weight_labelUncertain = 10
pure val weight_labelFinding = 8
pure val weight_commentSecurity = 6
pure val weight_labelSecurityScam = 6
pure val weight_reopenAfterAppeal = 20
pure val weight_removeLabels = 20
pure val weight_observeAppealOutcome = 2
pure val weight_addModeratorLabel = 5
pure val weight_supersedeHold = 5
pure val weight_resolveMaintainerAction = 5
```
