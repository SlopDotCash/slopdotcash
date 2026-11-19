# Points disputes

PRD section 7 (append corrections; never rewrite earlier records), section 9
(escalation criteria, moderators) and CLAUDE.md "Slopbot triages disputes
first, and a moderator decides escalated disputes". Source
`backend/points/disputes.ts` (`GET|POST /api/v1/points/disputes[/:key]`),
`workers/slopbot/points-disputes.ts` (`processPointsDispute`,
`processPendingPointsDisputes`, `POST slopbot.internal/v1/points-disputes`),
`workers/slopbot/appeals.ts` (`recordDraft`, `escalateAppeal`) and migration
`0114` (`points_disputes`).

One instance is one dispute keyed `points-dispute:sha256(<revision>:<actor>)`:
one recipient's dispute of one retained, immutable Points revision, including
non-PR and manual awards. It follows the [appeal](../slopbot/appeals.md)
lifecycle (Slopbot draft, escalation to the same moderators, a moderator-only
resolution named *upheld* when the appellant wins) with its own subject. A
pull-request debit is appealed there instead, and a dispute of a retained
single or joint value assessment is a [value dispute](../slopbot/valueDisputes.md).
Slopbot never retrieves the original work for this intake, so its draft
confidence stays below the appeal confidence threshold and every triaged
dispute reaches a moderator. A resolution records a decision only: it never
edits the disputed revision, Points, awards, payments or penalties. A
correction is a new revision appended through the [Points journal](./journal.md),
which supersedes the disputed one without rewriting it.

The `by` sender is the authenticated member's numeric GitHub ID, a moderator's
GitHub ID, or Slopbot's intake, cron and retry worker (`slopbotWorker`).

## Story: A recipient disputes their own current Points record privately

### Only the recipient of the current revision files, and a repeated filing returns the first

The retained revision must pass its integrity check (its ID is the digest of
its payload) and name the signed-in member as the award recipient by
immutable GitHub ID. A superseded revision is refused with a pointer to the
current one. The statement is 1 to 4000 characters. Filing the same
statement again returns the stored dispute; a different statement for the
same revision is refused as already submitted. Filing records the "opened"
Inbox notice in the same write.

```quint
import appeals as A from "../slopbot/appeals"
import categories as F from "../slopbot/categories"
type RecordView = { revision: str, recipient: int, current: bool, integrityVerified: bool }
type FileResult = Created | ReturnedExisting | AlreadySubmitted | SupersededRecord | NotRecipient | InvalidStatement
type Escalation = NotEscalated | ProjectUnregistered | ProjectRestricted | InstallationUnavailable |
  TriageUnavailable | ModeratorReviewRequired | Overdue
type NoticeKind = OpenedNotice | EscalatedNotice | ResolvedNotice
type Notice = { kind: NoticeKind, recipient: int }
type Dispute = { filed: bool, revision: str, recipient: int, statementLength: int, statementDigest: str,
  now: int, openedAt: int, lastToken: int, claimToken: int, claimUntil: int, callsInFlight: bool,
  modelCalls: int, unknownCostCalls: int, draft: A::DraftChoice, draftConfidence: int, escalation: Escalation,
  resolution: A::Resolution, resolver: int, reasonLength: int, notices: List[Notice] }
pure val initial: Dispute = { filed: false, revision: "", recipient: 0, statementLength: 0, statementDigest: "",
  now: 0, openedAt: 0, lastToken: 0, claimToken: 0, claimUntil: 0, callsInFlight: false,
  modelCalls: 0, unknownCostCalls: 0, draft: A::NoDraft, draftConfidence: 0, escalation: NotEscalated,
  resolution: A::Unresolved, resolver: 0, reasonLength: 0, notices: List() }
pure val slopbotWorker = -1
pure val leaseSeconds = 600
pure val cappedConfidence = F::closeConfidence - 1
pure def validText(textLength: int): bool = textLength >= 1 and textLength <= 4000
pure def fileResult(d: Dispute, by: int, record: RecordView, statementLength: int, statementDigest: str): FileResult =
  if (not(validText(statementLength))) InvalidStatement
  else if (not(record.integrityVerified) or record.recipient != by or by <= 0) NotRecipient
  else if (d.filed and d.revision == record.revision and d.recipient == by)
    (if (d.statementDigest == statementDigest) ReturnedExisting else AlreadySubmitted)
  else if (not(record.current)) SupersededRecord
  else Created
pure def canFile(d: Dispute, by: int, record: RecordView, statementLength: int, statementDigest: str): bool =
  not(d.filed) and statementDigest != "" and fileResult(d, by, record, statementLength, statementDigest) == Created
pure def file(d: Dispute, by: int, record: RecordView, statementLength: int, statementDigest: str): Dispute =
  { ...d, filed: true, revision: record.revision, recipient: by, statementLength: statementLength,
    statementDigest: statementDigest, openedAt: d.now, notices: d.notices.append({ kind: OpenedNotice, recipient: by }) }
pure def lawOnlyRecipientFiles(d: Dispute, by: int, record: RecordView, statementLength: int, statementDigest: str): bool =
  record.recipient != by implies fileResult(d, by, record, statementLength, statementDigest) != Created
pure def lawSupersededRefused(d: Dispute, by: int, record: RecordView, statementLength: int, statementDigest: str): bool =
  (not(d.filed) and not(record.current)) implies fileResult(d, by, record, statementLength, statementDigest) != Created
pure def lawOneDisputePerRevisionAndActor(d: Dispute, by: int, record: RecordView, statementLength: int, statementDigest: str): bool =
  (d.filed and d.revision == record.revision and d.recipient == by) implies
    fileResult(d, by, record, statementLength, statementDigest) != Created
pure def stepSourceImmutable(before: Dispute, after: Dispute): bool = before.filed implies
  after.filed and after.revision == before.revision and after.recipient == before.recipient and
  after.statementDigest == before.statementDigest and after.statementLength == before.statementLength and
  after.openedAt == before.openedAt
```

### Triage runs under an expiring lease, a saved draft is reused, and every outcome escalates

The intake request, the recipient's retry and the five-minute cron each try
to claim an unresolved dispute that lacks a draft or an escalation. A claim
needs no current lease; an expired one is taken over. Every later write names
the worker's own token and is admitted only while that token is the current
claim and its lease has not expired, so a worker whose lease was taken over
writes nothing. An unregistered or restricted project or an unavailable
installation escalates without a model call. Provider calls are journaled
before the draft; any failure before a call starts, and a failed, blocked or
budget-deferred triage once its calls' costs are recorded, escalates as
unavailable. A worker that loses its calls' cost record before recording them
releases its lease without escalating, and the call is retained as an unknown
cost, so a later lease retries. A draft is immutable: a later lease that finds
it escalates with it and never calls the model again, and a failure before
that escalation escalates as unavailable.

```quint
type Availability = Available | Unregistered | Restricted | NoInstallation
pure def needsTriage(d: Dispute): bool = d.filed and d.resolution == A::Unresolved and
  (d.draft == A::NoDraft or d.escalation == NotEscalated)
pure def tokenHolds(holder: int, until: int, observedAt: int, token: int): bool =
  token > 0 and token == holder and observedAt < until
pure def holds(d: Dispute, token: int): bool = tokenHolds(d.claimToken, d.claimUntil, d.now, token)
pure def lawOtherTokenNeverWrites(holder: int, until: int, observedAt: int, token: int): bool =
  token != holder implies not(tokenHolds(holder, until, observedAt, token))
pure def lawExpiredLeaseNeverWrites(holder: int, until: int, observedAt: int, token: int): bool =
  observedAt >= until implies not(tokenHolds(holder, until, observedAt, token))
pure def canObserveTime(d: Dispute, by: int, observedAt: int): bool = by == slopbotWorker and observedAt >= d.now
pure def observeTime(d: Dispute, by: int, observedAt: int): Dispute = { ...d, now: observedAt }
pure def canClaim(d: Dispute, by: int): bool =
  (by == slopbotWorker or by == d.recipient) and needsTriage(d) and (d.claimToken == 0 or d.now >= d.claimUntil)
pure def claim(d: Dispute, by: int): Dispute =
  { ...d, lastToken: d.lastToken + 1, claimToken: d.lastToken + 1, claimUntil: d.now + leaseSeconds,
    unknownCostCalls: if (d.callsInFlight) d.unknownCostCalls + 1 else d.unknownCostCalls, callsInFlight: false }
pure def escalatedWith(reason: Escalation, d: Dispute): Dispute =
  if (d.escalation != NotEscalated) d
  else { ...d, escalation: reason, notices: d.notices.concat(List({ kind: EscalatedNotice, recipient: 18633264 },
    { kind: EscalatedNotice, recipient: 202660855 })) }
pure def canEscalateUnavailable(d: Dispute, by: int, token: int, availability: Availability): bool =
  by == slopbotWorker and holds(d, token) and needsTriage(d) and availability != Available and not(d.callsInFlight)
pure def escalateUnavailable(d: Dispute, by: int, token: int, availability: Availability): Dispute =
  escalatedWith(if (availability == Unregistered) ProjectUnregistered
    else if (availability == Restricted) ProjectRestricted else InstallationUnavailable, d)
pure def canStartCall(d: Dispute, by: int, token: int): bool =
  by == slopbotWorker and holds(d, token) and d.draft == A::NoDraft and not(d.callsInFlight)
pure def startCall(d: Dispute, by: int, token: int): Dispute = { ...d, callsInFlight: true, modelCalls: d.modelCalls + 1 }
pure def canDraft(d: Dispute, by: int, token: int, uphold: bool, confidenceHundredths: int): bool =
  by == slopbotWorker and holds(d, token) and d.callsInFlight and d.draft == A::NoDraft and
  F::validConfidence(confidenceHundredths)
pure def draft(d: Dispute, by: int, token: int, uphold: bool, confidenceHundredths: int): Dispute =
  { ...d, callsInFlight: false, draft: if (uphold) A::DraftUphold else A::DraftDeny,
    draftConfidence: if (confidenceHundredths > cappedConfidence) cappedConfidence else confidenceHundredths }
pure def canFailTriage(d: Dispute, by: int, token: int): bool =
  by == slopbotWorker and holds(d, token) and needsTriage(d)
pure def failTriage(d: Dispute, by: int, token: int): Dispute = escalatedWith(TriageUnavailable, { ...d, callsInFlight: false })
pure def canEscalateDrafted(d: Dispute, by: int, token: int): bool =
  by == slopbotWorker and holds(d, token) and d.draft != A::NoDraft and d.escalation == NotEscalated
pure def escalateDrafted(d: Dispute, by: int, token: int): Dispute = escalatedWith(ModeratorReviewRequired, d)
pure def canRelease(d: Dispute, by: int, token: int): bool = by == slopbotWorker and token > 0 and token == d.claimToken
pure def release(d: Dispute, by: int, token: int): Dispute =
  { ...d, claimToken: 0, claimUntil: 0, callsInFlight: false,
    unknownCostCalls: if (d.callsInFlight) d.unknownCostCalls + 1 else d.unknownCostCalls }
pure def lawStaleWorkerNeverDrafts(d: Dispute, token: int, uphold: bool, confidenceHundredths: int): bool =
  (token != d.claimToken or d.now >= d.claimUntil) implies not(canDraft(d, slopbotWorker, token, uphold, confidenceHundredths))
pure def lawStaleWorkerNeverEscalates(d: Dispute, token: int): bool =
  (token != d.claimToken or d.now >= d.claimUntil) implies
    not(canEscalateDrafted(d, slopbotWorker, token)) and not(canFailTriage(d, slopbotWorker, token)) and
    not(canStartCall(d, slopbotWorker, token))
pure def lawDraftedCriteriaEscalate(d: Dispute): bool =
  d.draftConfidence < F::closeConfidence implies
    A::criteriaReason({ ...A::initial, ban: A::NotBanned, draftConfidence: d.draftConfidence }) != A::NotEscalated
pure def stepWritesOnlyByCurrentLease(before: Dispute, via: str, after: Dispute): bool =
  (via == "startCall" or via == "draft" or via == "failTriage" or via == "escalateDrafted" or
    via == "escalateUnavailable") implies (before.claimToken > 0 and before.now < before.claimUntil)
pure def stepNoCallAfterDraft(before: Dispute, after: Dispute): bool =
  before.draft != A::NoDraft implies after.modelCalls == before.modelCalls
pure def alwaysDraftBelowThreshold(d: Dispute): bool = d.draftConfidence >= 0 and d.draftConfidence < F::closeConfidence
pure def alwaysClaimShape(d: Dispute): bool = d.claimToken >= 0 and d.claimToken <= d.lastToken and
  (d.claimToken == 0 implies d.claimUntil == 0 and not(d.callsInFlight)) and
  (d.callsInFlight implies d.draft == A::NoDraft and d.modelCalls > 0) and
  (d.draft != A::NoDraft implies d.modelCalls > 0) and
  d.unknownCostCalls >= 0 and d.unknownCostCalls + (if (d.callsInFlight) 1 else 0) <= d.modelCalls
pure def alwaysTriageNeedsFiling(d: Dispute): bool = not(d.filed) implies
  d.draft == A::NoDraft and d.escalation == NotEscalated and d.lastToken == 0 and d.notices.length() == 0 and
  d.modelCalls == 0
pure def stepDraftAndEscalationOnce(before: Dispute, after: Dispute): bool =
  (before.draft != A::NoDraft implies after.draft == before.draft and after.draftConfidence == before.draftConfidence) and
  (before.escalation != NotEscalated implies after.escalation == before.escalation)
pure def stepUnknownCostsRetained(before: Dispute, after: Dispute): bool = after.unknownCostCalls >= before.unknownCostCalls
pure def sometimesFailedBeforeAnyCall(d: Dispute): bool = d.escalation == TriageUnavailable and d.modelCalls == 0
pure def stepTokensIncrease(before: Dispute, after: Dispute): bool = after.lastToken >= before.lastToken and after.now >= before.now
pure def sometimesDraftedAndEscalated(d: Dispute): bool = d.draft != A::NoDraft and d.escalation == ModeratorReviewRequired
pure def sometimesUnavailableEscalated(d: Dispute): bool = d.escalation == ProjectRestricted
pure def sometimesLostCostRetried(d: Dispute): bool = d.unknownCostCalls > 0 and d.claimToken > 0
pure def sometimesLeaseTakenOver(d: Dispute): bool = d.lastToken >= 2 and d.claimToken == d.lastToken
pure def sometimesDraftResumedByLaterLease(d: Dispute): bool =
  d.escalation == ModeratorReviewRequired and d.lastToken >= 2 and d.modelCalls == 1
pure def sometimesRetriedByRecipient(d: Dispute): bool = d.lastToken >= 2 and d.unknownCostCalls > 0 and d.draft == A::NoDraft
```

### A dispute still unresolved seven days after filing escalates without a lease

PRD section 9 escalates a case still unresolved after seven days, the same
period as an appeal. The scheduled worker escalates it without a lease, so a
worker that keeps failing cannot hold a dispute in triage. The development
worker relies on every triage escalating; this is the PRD bound it lacks.

```quint
pure def canEscalateOverdue(d: Dispute, by: int): bool = by == slopbotWorker and needsTriage(d) and
  d.escalation == NotEscalated and d.now - d.openedAt >= A::resolutionSeconds
pure def escalateOverdue(d: Dispute, by: int): Dispute = escalatedWith(Overdue, d)
pure val fair_escalateOverdue = "weak"
pure def leadsToOverdueEscalated(d: Dispute, later: Dispute): bool =
  (d.filed and d.resolution == A::Unresolved and d.now - d.openedAt >= A::resolutionSeconds) implies
    later.escalation != NotEscalated
pure def alwaysTimes(d: Dispute): bool = d.openedAt >= 0 and d.openedAt <= d.now
pure def sometimesOverdueEscalated(d: Dispute): bool = d.escalation == Overdue
```

### Only a moderator other than the recipient reads and decides an escalated dispute, once, with a reason

The recipient may always read their own dispute. A moderator may read it
only after escalation and never their own. The decision records the
resolution, the moderator's immutable ID and a reason of 1 to 4000
characters, with the "resolved" Inbox notice in the same write. It is a
compare-and-set on the unresolved escalated row: a racing second decision
and a retry of a resolved dispute are refused as already resolved and change
nothing. Each notice is written once per kind and recipient.

```quint
type DecisionResult = DecisionRecorded | AlreadyResolved | NotAuthorized | InvalidDecision
pure def mayRead(d: Dispute, viewer: int): bool = d.filed and
  (viewer == d.recipient or (A::slopModerators.contains(viewer) and viewer != d.recipient and d.escalation != NotEscalated))
pure def decisionResult(d: Dispute, by: int, reasonLength: int): DecisionResult =
  if (not(d.filed) or not(A::slopModerators.contains(by)) or by == d.recipient or d.escalation == NotEscalated) NotAuthorized
  else if (d.resolution != A::Unresolved) AlreadyResolved
  else if (not(validText(reasonLength))) InvalidDecision
  else DecisionRecorded
pure def canDecide(d: Dispute, by: int, uphold: bool, reasonLength: int): bool = decisionResult(d, by, reasonLength) == DecisionRecorded
pure def decide(d: Dispute, by: int, uphold: bool, reasonLength: int): Dispute =
  { ...d, resolution: if (uphold) A::Upheld else A::Denied, resolver: by, reasonLength: reasonLength,
    claimToken: 0, claimUntil: 0, callsInFlight: false,
    unknownCostCalls: if (d.callsInFlight) d.unknownCostCalls + 1 else d.unknownCostCalls,
    notices: d.notices.append({ kind: ResolvedNotice, recipient: d.recipient }) }
pure def lawModeratorReadsOnlyEscalated(d: Dispute, viewer: int): bool =
  (viewer != d.recipient and d.escalation == NotEscalated) implies not(mayRead(d, viewer))
pure def lawSecondDecisionRefused(d: Dispute, by: int, other: int, reasonLength: int): bool =
  canDecide(d, by, true, reasonLength) implies decisionResult(decide(d, by, true, reasonLength), other, reasonLength) != DecisionRecorded
pure def lawResolvedRetryClaimsNothing(d: Dispute, by: int): bool = d.resolution != A::Unresolved implies not(canClaim(d, by))
pure def alwaysResolvedByModerator(d: Dispute): bool = d.resolution != A::Unresolved implies
  A::slopModerators.contains(d.resolver) and d.resolver != d.recipient and d.escalation != NotEscalated and
  validText(d.reasonLength) and d.claimToken == 0
pure def alwaysNoticesOnce(d: Dispute): bool =
  d.notices.every(n => d.notices.select(m => m == n).length() == 1) and
  (d.resolution != A::Unresolved iff d.notices.some(n => n.kind == ResolvedNotice)) and
  (d.escalation != NotEscalated iff d.notices.some(n => n.kind == EscalatedNotice)) and
  (d.filed iff d.notices.some(n => n.kind == OpenedNotice))
pure def stepResolutionOnce(before: Dispute, after: Dispute): bool = before.resolution != A::Unresolved implies
  after.resolution == before.resolution and after.resolver == before.resolver and after.reasonLength == before.reasonLength
pure def stepNoticesAppendOnly(before: Dispute, after: Dispute): bool =
  after.notices.length() >= before.notices.length() and before.notices.every(n => after.notices.includes(n))
pure def sometimesUpheld(d: Dispute): bool = d.resolution == A::Upheld
pure def sometimesDenied(d: Dispute): bool = d.resolution == A::Denied
pure val fair_claim = "weak"
pure val fair_escalateDrafted = "weak"
pure def leadsToModerator(d: Dispute, later: Dispute): bool =
  (d.filed and d.draft != A::NoDraft and d.escalation == NotEscalated) implies later.escalation != NotEscalated
```

### Simulation samples cover other members, superseded records and expired leases

```quint
pure val recordValues = Set({ revision: "r1", recipient: 5, current: true, integrityVerified: true },
  { revision: "r1", recipient: 6, current: true, integrityVerified: true },
  { revision: "r0", recipient: 5, current: false, integrityVerified: true },
  { revision: "r1", recipient: 5, current: true, integrityVerified: false })
pure val byValues = Set(5, 6, 18633264, slopbotWorker)
pure val otherValues = Set(202660855, 6)
pure val viewerValues = Set(5, 6, 18633264)
pure val statementLengthValues = Set(0, 12, 4001)
pure val statementDigestValues = Set("s1", "s2")
pure val tokenValues = Set(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)
pure val holderValues = Set(0, 1, 2)
pure val untilValues = Set(0, 600)
pure val observedAtValues = Set(0, 300, 600, 1200, 604800)
pure val availabilityValues = Set(Available, Restricted, NoInstallation)
pure val confidenceHundredthsValues = Set(40, 95)
pure val reasonLengthValues = Set(0, 20)
pure val weight_file = 6
pure val weight_claim = 6
pure val weight_startCall = 5
pure val weight_draft = 5
pure val weight_release = 2
```
