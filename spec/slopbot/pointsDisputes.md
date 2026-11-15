# Points disputes

PRD section 7 (append corrections; never rewrite earlier records), section 9
(escalation criteria, moderators) and CLAUDE.md "Slopbot triages disputes
first, and a moderator decides escalated disputes". Source
`backend/points/disputes.ts` (`GET|POST /api/v1/points/disputes[/:key]`),
`workers/slopbot/points-disputes.ts` (`processPointsDispute`,
`processPendingPointsDisputes`, `POST slopbot.internal/v1/points-disputes`),
`appeals.ts` (`recordDraft`, `escalateAppeal`) and migration `0114`
(`points_disputes`).

One instance is one dispute keyed `points-dispute:sha256(<revision>:<actor>)`.
A member selects one of their own current Points revisions in Inbox, including
non-PR and manual awards, and states a reason. Slopbot triages under a lease
but never retrieves the original work for this intake, so its draft
confidence stays below 90 hundredths and every dispute reaches a moderator.
An upheld dispute records a decision only; it never edits Points or funded
awards. A correction appends through the Points journal.

## Story: A recipient disputes their own current Points record privately

### Only the recipient of the current revision files, and a repeated filing returns the first

The retained revision must pass its integrity check (its ID is the digest of
its payload) and name the signed-in member as the award recipient by
immutable GitHub ID. A superseded revision is refused with a pointer to the
current one. The statement is 1 to 4000 characters. Filing the same
statement again returns the stored dispute; a different statement for the
same record is refused as already submitted. Filing records an "opened"
Inbox notice in the same write.

```quint
type RecordView = { revision: str, recipient: int, current: bool, integrityVerified: bool }
type FileResult = Created | ReturnedExisting | AlreadySubmitted | SupersededRecord | NotRecipient | InvalidStatement
type DraftChoice = NoDraft | DraftUphold | DraftDeny
type Escalation = NotEscalated | ProjectUnregistered | ProjectRestricted | InstallationUnavailable |
  TriageUnavailable | ModeratorReviewRequired
type Resolution = Unresolved | Upheld | Denied
type NoticeKind = OpenedNotice | EscalatedNotice | ResolvedNotice
type Notice = { kind: NoticeKind, recipient: int }
type Dispute = { filed: bool, revision: str, recipient: int, statementLength: int, statementDigest: str,
  now: int, lastToken: int, claimToken: int, claimUntil: int, callsInFlight: bool, unknownCostCalls: int,
  draft: DraftChoice, draftConfidence: int, escalation: Escalation, resolution: Resolution,
  resolver: int, reasonLength: int, notices: List[Notice] }
pure val initial: Dispute = { filed: false, revision: "", recipient: 0, statementLength: 0, statementDigest: "",
  now: 0, lastToken: 0, claimToken: 0, claimUntil: 0, callsInFlight: false, unknownCostCalls: 0,
  draft: NoDraft, draftConfidence: 0, escalation: NotEscalated, resolution: Unresolved,
  resolver: 0, reasonLength: 0, notices: List() }
pure val slopModerators: Set[int] = Set(18633264, 202660855)
pure val leaseSeconds = 600
pure val cappedConfidence = 89
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
    statementDigest: statementDigest, notices: d.notices.append({ kind: OpenedNotice, recipient: by }) }
pure def lawOnlyRecipientFiles(d: Dispute, by: int, record: RecordView, statementLength: int, statementDigest: str): bool =
  record.recipient != by implies fileResult(d, by, record, statementLength, statementDigest) != Created
pure def lawSupersededRefused(d: Dispute, by: int, record: RecordView, statementLength: int, statementDigest: str): bool =
  (not(d.filed) and not(record.current)) implies fileResult(d, by, record, statementLength, statementDigest) != Created
pure def stepSourceImmutable(before: Dispute, after: Dispute): bool = before.filed implies
  after.filed and after.revision == before.revision and after.recipient == before.recipient and
  after.statementDigest == before.statementDigest and after.statementLength == before.statementLength
```

### Triage runs under an expiring lease and every outcome escalates to a moderator

The intake request, an appellant retry and the five-minute cron each try to
claim an unresolved dispute that lacks a draft or an escalation; a retry is
only another `claim`. Every later write names the worker's own token and is
admitted only while that token is the current claim and its lease has not
expired (`mayWrite` with the worker's token after the model call), so a
worker whose lease was taken over writes nothing. An unregistered or restricted
project or an unavailable installation escalates without a model call.
Provider calls are journaled before the draft; a failed, blocked or
budget-deferred triage escalates as unavailable. A worker that loses its
calls' cost record before recording them releases its lease without
escalating and the call is retained as an unknown cost, so a later lease
retries. After a draft, the dispute always escalates because the original
work was not independently retrieved.

```quint
type Availability = Available | Unregistered | Restricted | NoInstallation
pure def needsTriage(d: Dispute): bool = d.filed and d.resolution == Unresolved and
  (d.draft == NoDraft or d.escalation == NotEscalated)
pure def tokenHolds(holder: int, until: int, observedAt: int, token: int): bool =
  token > 0 and token == holder and observedAt < until
pure def holds(d: Dispute, token: int): bool = tokenHolds(d.claimToken, d.claimUntil, d.now, token)
pure def lawOtherTokenNeverWrites(holder: int, until: int, observedAt: int, token: int): bool =
  token != holder implies not(tokenHolds(holder, until, observedAt, token))
pure def lawExpiredLeaseNeverWrites(holder: int, until: int, observedAt: int, token: int): bool =
  observedAt >= until implies not(tokenHolds(holder, until, observedAt, token))
pure def canObserveTime(d: Dispute, observedAt: int): bool = observedAt >= d.now
pure def observeTime(d: Dispute, observedAt: int): Dispute = { ...d, now: observedAt }
pure def canClaim(d: Dispute): bool = needsTriage(d) and (d.claimToken == 0 or d.now >= d.claimUntil)
pure def claim(d: Dispute): Dispute =
  { ...d, lastToken: d.lastToken + 1, claimToken: d.lastToken + 1, claimUntil: d.now + leaseSeconds,
    unknownCostCalls: if (d.callsInFlight) d.unknownCostCalls + 1 else d.unknownCostCalls, callsInFlight: false }
pure def escalatedWith(reason: Escalation, d: Dispute): Dispute =
  if (d.escalation != NotEscalated) d
  else { ...d, escalation: reason, notices: d.notices.concat(List({ kind: EscalatedNotice, recipient: 18633264 },
    { kind: EscalatedNotice, recipient: 202660855 })) }
pure def canEscalateUnavailable(d: Dispute, token: int, availability: Availability): bool =
  holds(d, token) and needsTriage(d) and availability != Available and not(d.callsInFlight)
pure def escalateUnavailable(d: Dispute, token: int, availability: Availability): Dispute =
  escalatedWith(if (availability == Unregistered) ProjectUnregistered
    else if (availability == Restricted) ProjectRestricted else InstallationUnavailable, d)
pure def canStartCall(d: Dispute, token: int): bool = holds(d, token) and d.draft == NoDraft and not(d.callsInFlight)
pure def startCall(d: Dispute, token: int): Dispute = { ...d, callsInFlight: true }
pure def canDraft(d: Dispute, token: int, uphold: bool, confidenceHundredths: int): bool =
  holds(d, token) and d.callsInFlight and d.draft == NoDraft and confidenceHundredths >= 0 and confidenceHundredths <= 100
pure def draft(d: Dispute, token: int, uphold: bool, confidenceHundredths: int): Dispute =
  { ...d, callsInFlight: false, draft: if (uphold) DraftUphold else DraftDeny,
    draftConfidence: if (confidenceHundredths > cappedConfidence) cappedConfidence else confidenceHundredths }
pure def canFailTriage(d: Dispute, token: int): bool = holds(d, token) and d.callsInFlight and d.draft == NoDraft
pure def failTriage(d: Dispute, token: int): Dispute = escalatedWith(TriageUnavailable, { ...d, callsInFlight: false })
pure def canEscalateDrafted(d: Dispute, token: int): bool = holds(d, token) and d.draft != NoDraft and d.escalation == NotEscalated
pure def escalateDrafted(d: Dispute, token: int): Dispute = escalatedWith(ModeratorReviewRequired, d)
pure def canRelease(d: Dispute, token: int): bool = token > 0 and token == d.claimToken
pure def release(d: Dispute, token: int): Dispute =
  { ...d, claimToken: 0, claimUntil: 0, callsInFlight: false,
    unknownCostCalls: if (d.callsInFlight) d.unknownCostCalls + 1 else d.unknownCostCalls }
pure def lawStaleWorkerNeverDrafts(d: Dispute, token: int, uphold: bool, confidenceHundredths: int): bool =
  (token != d.claimToken or d.now >= d.claimUntil) implies not(canDraft(d, token, uphold, confidenceHundredths))
pure def lawStaleWorkerNeverEscalates(d: Dispute, token: int): bool =
  (token != d.claimToken or d.now >= d.claimUntil) implies
    not(canEscalateDrafted(d, token)) and not(canFailTriage(d, token)) and not(canStartCall(d, token))
pure def stepWritesOnlyByCurrentLease(before: Dispute, via: str, after: Dispute): bool =
  (via == "startCall" or via == "draft" or via == "failTriage" or via == "escalateDrafted" or
    via == "escalateUnavailable") implies (before.claimToken > 0 and before.now < before.claimUntil)
pure def alwaysDraftBelowThreshold(d: Dispute): bool = d.draftConfidence >= 0 and d.draftConfidence < 90
pure def alwaysClaimShape(d: Dispute): bool = d.claimToken >= 0 and d.claimToken <= d.lastToken and
  (d.claimToken == 0 implies d.claimUntil == 0 and not(d.callsInFlight)) and
  (d.callsInFlight implies d.draft == NoDraft)
pure def alwaysTriageNeedsFiling(d: Dispute): bool = not(d.filed) implies
  d.draft == NoDraft and d.escalation == NotEscalated and d.lastToken == 0 and d.notices.length() == 0
pure def stepDraftAndEscalationOnce(before: Dispute, after: Dispute): bool =
  (before.draft != NoDraft implies after.draft == before.draft and after.draftConfidence == before.draftConfidence) and
  (before.escalation != NotEscalated implies after.escalation == before.escalation)
pure def stepUnknownCostsRetained(before: Dispute, after: Dispute): bool = after.unknownCostCalls >= before.unknownCostCalls
pure def stepTokensIncrease(before: Dispute, after: Dispute): bool = after.lastToken >= before.lastToken and after.now >= before.now
pure def sometimesDraftedAndEscalated(d: Dispute): bool = d.draft != NoDraft and d.escalation == ModeratorReviewRequired
pure def sometimesUnavailableEscalated(d: Dispute): bool = d.escalation == ProjectRestricted
pure def sometimesLostCostRetried(d: Dispute): bool = d.unknownCostCalls > 0 and d.claimToken > 0
pure def sometimesLeaseTakenOver(d: Dispute): bool = d.lastToken >= 2 and d.claimToken == d.lastToken
pure def sometimesTakenOverWhileOldCallInFlight(d: Dispute): bool =
  d.lastToken >= 2 and d.claimToken == d.lastToken and d.unknownCostCalls > 0 and d.draft == NoDraft
```

### Only a moderator other than the recipient reads and decides an escalated dispute, once, with a reason

The recipient may always read their own dispute. A moderator may read it only
after escalation and never their own. The decision records the resolution,
the moderator's immutable ID and a reason of 1 to 4000 characters, with a
"resolved" Inbox notice in the same write. A second decision is refused.

```quint
pure def mayRead(d: Dispute, viewer: int): bool = d.filed and
  (viewer == d.recipient or (slopModerators.contains(viewer) and viewer != d.recipient and d.escalation != NotEscalated))
pure def canDecide(d: Dispute, by: int, uphold: bool, reasonLength: int): bool =
  d.filed and d.resolution == Unresolved and d.escalation != NotEscalated and slopModerators.contains(by) and
  by != d.recipient and validText(reasonLength)
pure def decide(d: Dispute, by: int, uphold: bool, reasonLength: int): Dispute =
  { ...d, resolution: if (uphold) Upheld else Denied, resolver: by, reasonLength: reasonLength,
    notices: d.notices.append({ kind: ResolvedNotice, recipient: d.recipient }) }
pure def lawModeratorReadsOnlyEscalated(d: Dispute, viewer: int): bool =
  (viewer != d.recipient and d.escalation == NotEscalated) implies not(mayRead(d, viewer))
pure def alwaysResolvedByModerator(d: Dispute): bool = d.resolution != Unresolved implies
  slopModerators.contains(d.resolver) and d.resolver != d.recipient and d.escalation != NotEscalated and validText(d.reasonLength)
pure def stepResolutionOnce(before: Dispute, after: Dispute): bool = before.resolution != Unresolved implies
  after.resolution == before.resolution and after.resolver == before.resolver and after.reasonLength == before.reasonLength
pure def stepNoticesAppendOnly(before: Dispute, after: Dispute): bool =
  after.notices.length() >= before.notices.length() and before.notices.every(n => after.notices.includes(n))
pure def sometimesUpheld(d: Dispute): bool = d.resolution == Upheld
pure val fair_claim = "weak"
pure val fair_escalateDrafted = "weak"
pure def leadsToModerator(d: Dispute, later: Dispute): bool =
  (d.filed and d.draft != NoDraft and d.escalation == NotEscalated) implies later.escalation != NotEscalated
```

### Simulation samples cover other members, superseded records and expired leases

```quint
pure val recordValues = Set({ revision: "r1", recipient: 5, current: true, integrityVerified: true },
  { revision: "r1", recipient: 6, current: true, integrityVerified: true },
  { revision: "r0", recipient: 5, current: false, integrityVerified: true },
  { revision: "r1", recipient: 5, current: true, integrityVerified: false })
pure val byValues = Set(5, 6, 18633264)
pure val viewerValues = Set(5, 6, 18633264)
pure val statementLengthValues = Set(0, 12, 4001)
pure val statementDigestValues = Set("s1", "s2")
pure val tokenValues = Set(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)
pure val holderValues = Set(0, 1, 2)
pure val untilValues = Set(0, 600)
pure val observedAtValues = Set(0, 300, 600, 1200)
pure val availabilityValues = Set(Available, Restricted, NoInstallation)
pure val confidenceHundredthsValues = Set(40, 95)
pure val reasonLengthValues = Set(0, 20)
pure val weight_file = 6
pure val weight_claim = 6
pure val weight_startCall = 5
pure val weight_draft = 5
```
