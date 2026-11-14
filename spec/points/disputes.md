# Points disputes

PRD sections 2, 7 and 9: Slopbot triages disputes and a moderator decides
escalated ones. A dispute concerns a retained, immutable Points revision that
is not tied to a pull-request debit (those are [appeals](../slopbot/appeals.md)).
This machine follows `backend/points/disputes.ts`,
`workers/slopbot/points-disputes.ts` (the `processPendingPointsDisputes` cron
and the `POST slopbot.internal/v1/points-disputes` route) and the D1 table
`points_disputes` of `migrations/0114_points_dispute_intake.sql`. It
represents one dispute by one appellant of one revision.

Only the revision's recipient opens a dispute, and only for the latest
revision of its key. The revision record is read from `points_revisions` and
verified against its content digest by the dispute service. The Slopbot
triage draft is advisory; its confidence stays below 0.9 because the
original work is not independently retrieved, so every dispute reaches a
moderator. A dispute never changes Points, awards, payments or penalties by
itself. The moderator allowlist is the current immutable GitHub actor list
of PRD section 9.

## Story: File, triage and decide a Points dispute

### Only the recipient opens a dispute of the latest retained revision

The dispute's identity is the revision and the appellant. Repeating the
same request is an idempotent replay; a different statement for the same
revision is refused. A superseded revision is refused.

```quint
type DisputePhase = NotOpened | Triage | Escalated | Resolved
type Draft = NoDraft | Drafted({ uphold: bool, confidence: int })
type Resolution = NoResolution | Upheld | Denied
type Escalation = NotEscalated | ProjectUnavailable | ProjectRestricted | InstallationUnavailable | TriageUnavailable | NeedsModerator
type RevisionEvidence = { revision: int, recipient: int, latest: bool, digestVerified: bool }
type Dispute = { phase: DisputePhase, revision: int, appellant: int, statement: str, openedAt: int, dueAt: int,
  now: int, draft: Draft, leaseToken: int, leaseUntil: int, escalation: Escalation, resolution: Resolution,
  resolver: int, reason: str, modelCalls: int, callsRecorded: int }
pure val appealDays = 7
pure val leaseDays = 1
pure val moderators = Set(18633264, 202660855)
pure val initial: Dispute = { phase: NotOpened, revision: 0, appellant: 0, statement: "", openedAt: 0, dueAt: 0,
  now: 10, draft: NoDraft, leaseToken: 0, leaseUntil: 0, escalation: NotEscalated, resolution: NoResolution,
  resolver: 0, reason: "", modelCalls: 0, callsRecorded: 0 }
pure def canOpen(d: Dispute, rev: RevisionEvidence, statement: str, by: int): bool =
  d.phase == NotOpened and rev.revision > 0 and rev.digestVerified and rev.latest and by > 0 and
  by == rev.recipient and statement != ""
pure def open(d: Dispute, rev: RevisionEvidence, statement: str, by: int): Dispute =
  { ...d, phase: Triage, revision: rev.revision, appellant: by, statement: statement, openedAt: d.now, dueAt: d.now + appealDays }
pure def canReplayOpen(d: Dispute, rev: RevisionEvidence, statement: str, by: int): bool =
  d.phase != NotOpened and rev.revision == d.revision and by == d.appellant and statement == d.statement
pure def replayOpen(d: Dispute, rev: RevisionEvidence, statement: str, by: int): Dispute = d
pure def canAdvance(d: Dispute, at: int): bool = at > d.now
pure def advance(d: Dispute, at: int): Dispute = { ...d, now: at }
```

### Triage writes only under a current lease

A worker claims an unresolved dispute when no lease is current. A dispute
already escalated with a draft is never claimed again. An expired lease
cannot draft, escalate or record calls. Model calls are recorded before any
draft; an unrecorded call fails the run without escalation.

```quint
pure def leaseHeld(d: Dispute, token: int): bool = token > 0 and d.leaseToken == token and d.leaseUntil > d.now
pure def canClaim(d: Dispute, token: int): bool =
  (d.phase == Triage or (d.phase == Escalated and d.draft == NoDraft)) and token > 0 and
  (d.leaseToken == 0 or d.leaseUntil <= d.now)
pure def claim(d: Dispute, token: int): Dispute = { ...d, leaseToken: token, leaseUntil: d.now + leaseDays }
pure def canCallModel(d: Dispute, token: int): bool = leaseHeld(d, token) and d.draft == NoDraft and d.phase != Resolved
pure def callModel(d: Dispute, token: int): Dispute = { ...d, modelCalls: d.modelCalls + 1 }
pure def canRecordCalls(d: Dispute, token: int): bool = leaseHeld(d, token) and d.callsRecorded < d.modelCalls
pure def recordCalls(d: Dispute, token: int): Dispute = { ...d, callsRecorded: d.modelCalls }
pure def canRecordDraft(d: Dispute, token: int, uphold: bool, confidence: int): bool =
  leaseHeld(d, token) and d.draft == NoDraft and d.phase != Resolved and
  d.modelCalls > 0 and d.callsRecorded == d.modelCalls and confidence >= 0 and confidence <= 100
pure def recordDraft(d: Dispute, token: int, uphold: bool, confidence: int): Dispute =
  { ...d, draft: Drafted({ uphold: uphold, confidence: if (confidence > 89) 89 else confidence }) }
pure def canEscalate(d: Dispute, token: int, why: Escalation): bool =
  leaseHeld(d, token) and d.phase == Triage and why != NotEscalated and d.callsRecorded == d.modelCalls and
  (why == NeedsModerator implies d.draft != NoDraft) and
  ((why == ProjectUnavailable or why == ProjectRestricted or why == InstallationUnavailable) implies d.modelCalls == 0)
pure def escalate(d: Dispute, token: int, why: Escalation): Dispute = { ...d, phase: Escalated, escalation: why }
pure def canReleaseLease(d: Dispute, token: int): bool = token > 0 and d.leaseToken == token
pure def releaseLease(d: Dispute, token: int): Dispute = { ...d, leaseToken: 0, leaseUntil: 0 }
```

### Only an independent moderator decides an escalated dispute

The appellant can retry triage or read the dispute; a moderator can read it
only after escalation. The decision and its reason are immutable.

```quint
pure def mayRead(d: Dispute, by: int): bool = by == d.appellant or (moderators.contains(by) and d.phase != Triage and d.phase != NotOpened)
pure def canResolve(d: Dispute, decision: Resolution, reason: str, by: int): bool =
  d.phase == Escalated and decision != NoResolution and reason != "" and moderators.contains(by) and by != d.appellant
pure def resolve(d: Dispute, decision: Resolution, reason: str, by: int): Dispute =
  { ...d, phase: Resolved, resolution: decision, reason: reason, resolver: by, leaseToken: 0, leaseUntil: 0 }
pure def alwaysDraftAdvisory(d: Dispute): bool =
  val draft = d.draft
  match draft { | Drafted(x) => x.confidence >= 0 and x.confidence < 90 | NoDraft => true }
pure def alwaysResolvedByModerator(d: Dispute): bool = d.phase == Resolved implies
  (moderators.contains(d.resolver) and d.resolver != d.appellant and d.escalation != NotEscalated and d.resolution != NoResolution and d.reason != "")
pure def alwaysUnresolvedHasNoDecision(d: Dispute): bool = d.phase != Resolved implies (d.resolution == NoResolution and d.resolver == 0)
pure def alwaysEscalationRecorded(d: Dispute): bool = (d.phase == Escalated or d.phase == Resolved) iff d.escalation != NotEscalated
pure def alwaysCallsRecordedBound(d: Dispute): bool = d.callsRecorded >= 0 and d.callsRecorded <= d.modelCalls
pure def alwaysOpenedIdentity(d: Dispute): bool = d.phase != NotOpened implies
  (d.revision > 0 and d.appellant > 0 and d.statement != "" and d.dueAt == d.openedAt + appealDays)
pure def stepIdentityImmutable(before: Dispute, after: Dispute): bool = before.phase != NotOpened implies
  (after.revision == before.revision and after.appellant == before.appellant and after.statement == before.statement and after.openedAt == before.openedAt)
pure def stepDraftImmutable(before: Dispute, after: Dispute): bool = before.draft != NoDraft implies after.draft == before.draft
pure def stepDecisionImmutable(before: Dispute, after: Dispute): bool = before.phase == Resolved implies
  (after.resolution == before.resolution and after.reason == before.reason and after.resolver == before.resolver and after.phase == Resolved)
pure def lawModeratorCannotReadBeforeEscalation(by: int): bool =
  (moderators.contains(by) and by != 5) implies not(mayRead({ ...initial, phase: Triage, appellant: 5 }, by))
pure def lawRecipientCannotDecide(by: int): bool = not(canResolve({ ...initial, phase: Escalated, appellant: by, escalation: NeedsModerator }, Upheld, "r", by))
pure def sometimesUnavailableEscalatesWithoutCall(d: Dispute): bool = d.escalation == ProjectUnavailable and d.modelCalls == 0
pure def sometimesDraftedThenEscalated(d: Dispute): bool = d.phase == Escalated and d.escalation == NeedsModerator
pure def sometimesUpheld(d: Dispute): bool = d.resolution == Upheld
pure def sometimesDenied(d: Dispute): bool = d.resolution == Denied
pure def sometimesLeaseExpiredUndrafted(d: Dispute): bool = d.phase == Triage and d.leaseToken > 0 and d.leaseUntil <= d.now and d.draft == NoDraft
```

### Simulation samples cover the recipient, a moderator and other actors

```quint
pure val byValues = Set(1, 2, 18633264)
pure val revValues = Set({ revision: 7, recipient: 1, latest: true, digestVerified: true },
  { revision: 7, recipient: 1, latest: false, digestVerified: true }, { revision: 8, recipient: 2, latest: true, digestVerified: false })
pure val statementValues = Set("wrong total", "other")
pure val tokenValues = Set(1, 2)
pure val atValues = Set(11, 12, 20)
pure val confidenceValues = Set(50, 95)
pure val whyValues = Set(ProjectUnavailable, TriageUnavailable, NeedsModerator)
pure val decisionValues = Set(Upheld, Denied)
pure val reasonValues = Set("checked", "")
```
