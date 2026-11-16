# Moderator and steward Inbox items

PRD section 9 "Administrator and moderator journey" and "Notifications",
section 5 (one moderator notice per Scam closure) and section 6 (one steward
payout exception per underfunded month). Source
`backend/notifications/events.ts` (`notifySlopbotScamReview`,
`notifySlopbotAppeal`, `notifyPointsDispute`, `notifyProjectEnforcement`,
`notifyReinstatementReviewers`, `notifyMonthlyUnderfunded`,
`notifyMonthlyCut`), `backend/notifications/handler.ts` (the list, the
unread count and the `appeals/` and `scam-reviews/` routes) and
`backend/payments/README.md` (monthly coordinator).

This unit owns the role-scoped Inbox rows of moderators, stewards, applicants
and contributors, the moderator roster they are checked against, the
recorded moderator decisions and each queue read. Each row is keyed by its
source, so a retry or replay never adds a second row; the row carries only
its kind, its source key and a link, never a reason, evidence or amount.
Email delivery and its retries are the [notice outbox](./notifications.md).
The sources are the confirmed Scam close of a [close attempt](../slopbot/closeAttempt.md)
with its [penalty](../points/penalties.md) row, an escalated
[appeal](../slopbot/appeals.md) or [Points dispute](../points/disputes.md),
a project enforcement record, and the [monthly settlement](../settlement/monthly.md).
Senders: `slopbotWorker` (Slopbot's committed close, penalty and escalation
writes), `projectService` (an enforcement record's own batch), `monthlyJob`
(the monthly coordinator and owner cut writes), `configRelease` (the reviewed
moderator list of PRD section 9) and the signed-in viewer's GitHub ID.

## Story: Each source writes its Inbox rows once, to the right audience

### A confirmed Scam close asks each moderator other than the author once, keyed by the closed item

The rows come from the committed penalty row, so a close that recorded no
moderator-review penalty writes nothing, and the closed item's node ID keys
them, so a retried close, a reopen or a replay never adds a second row.

```quint
type Kind = ScamReview | AppealReview | EnforcementRecord | ReinstatementReview | MonthlyUnderfunded | MonthlyCut
type Key = { kind: Kind, subject: str, project: int, period: int, sequence: int }
type Item = { key: Key, recipient: int, readAt: int }
type Penalty = { item: str, author: int, reversed: bool }
type Case = { key: str, appellant: int, escalated: bool, resolved: bool }
type Outcome = RestrictionApplied | NoticeSent | RecoveryOpened
type Decision = { caseKey: str, by: int, reasonLength: int, outcome: Outcome, confirmed: bool }
type ReadResult = Shown | NotShown | StaleRefused | RetryLater
type Read = { viewer: int, key: Key, result: ReadResult }
type Moderation = { rosterVersion: int, moderators: List[int], clock: int, items: List[Item], penalties: List[Penalty],
  cases: List[Case], decisions: List[Decision], reads: List[Read] }
pure val slopbotWorker = -1
pure val projectService = -2
pure val monthlyJob = -3
pure val configRelease = -4
pure val initial: Moderation = { rosterVersion: 1, moderators: List(18633264, 202660855), clock: 1, items: List(),
  penalties: List(), cases: List(), decisions: List(), reads: List() }
pure val noKey: Key = { kind: ScamReview, subject: "", project: 0, period: 0, sequence: 0 }
pure def has(m: Moderation, key: Key, recipient: int): bool = m.items.some(i => i.key == key and i.recipient == recipient)
pure def addOnce(items: List[Item], key: Key, recipient: int): List[Item] =
  if (recipient <= 0 or items.some(i => i.key == key and i.recipient == recipient)) items
  else items.append({ key: key, recipient: recipient, readAt: 0 })
pure def scamKey(item: str): Key = { ...noKey, kind: ScamReview, subject: item }
pure def penaltyOf(m: Moderation, item: str): Penalty =
  m.penalties.select(p => p.item == item).nthOr(0, { item: "", author: 0, reversed: true })
pure def canRecordScamPenalty(m: Moderation, by: int, item: str, author: int): bool =
  by == slopbotWorker and item != "" and author > 0 and not(m.penalties.some(p => p.item == item))
pure def recordScamPenalty(m: Moderation, by: int, item: str, author: int): Moderation =
  { ...m, penalties: m.penalties.append({ item: item, author: author, reversed: false }) }
pure def canNotifyScamReview(m: Moderation, by: int, item: str, recipient: int): bool =
  by == slopbotWorker and m.moderators.includes(recipient) and
  m.penalties.some(p => p.item == item and not(p.reversed) and p.author != recipient)
pure def notifyScamReview(m: Moderation, by: int, item: str, recipient: int): Moderation =
  { ...m, items: addOnce(m.items, scamKey(item), recipient) }
pure def canReversePenalty(m: Moderation, by: int, item: str): bool =
  by == slopbotWorker and m.penalties.some(p => p.item == item and not(p.reversed))
pure def reversePenalty(m: Moderation, by: int, item: str): Moderation =
  { ...m, penalties: m.penalties.listMap(p => if (p.item == item) { ...p, reversed: true } else p) }
pure def alwaysOneRowPerKeyAndRecipient(m: Moderation): bool =
  m.items.every(i => i.recipient > 0 and m.items.select(o => o.key == i.key and o.recipient == i.recipient).length() == 1)
pure def alwaysScamRowsFromPenalty(m: Moderation): bool = m.items.every(i => i.key.kind == ScamReview implies
  (m.penalties.some(p => p.item == i.key.subject and p.author != i.recipient)))
pure def alwaysOnePenaltyPerItem(m: Moderation): bool =
  m.penalties.every(p => p.item != "" and p.author > 0 and m.penalties.select(o => o.item == p.item).length() == 1)
pure def sometimesScamReviewed(m: Moderation): bool =
  m.moderators.every(r => has(m, scamKey("pr"), r)) and not(penaltyOf(m, "pr").reversed)
```

### An escalated appeal or dispute asks each moderator other than the appellant once

Slopbot's escalation write records the case and one row per current
moderator in the same write; the appellant never receives the review row for
their own case.

```quint
pure def appealKey(caseKey: str): Key = { ...noKey, kind: AppealReview, subject: caseKey }
pure def caseOf(m: Moderation, caseKey: str): Case =
  m.cases.select(c => c.key == caseKey).nthOr(0, { key: "", appellant: 0, escalated: false, resolved: false })
pure def canEscalateCase(m: Moderation, by: int, caseKey: str, appellant: int): bool =
  by == slopbotWorker and caseKey != "" and appellant > 0 and not(m.cases.some(c => c.key == caseKey))
pure def escalateCase(m: Moderation, by: int, caseKey: str, appellant: int): Moderation =
  { ...m, cases: m.cases.append({ key: caseKey, appellant: appellant, escalated: true, resolved: false }),
    items: m.moderators.foldl(m.items, (acc, r) => if (r != appellant) addOnce(acc, appealKey(caseKey), r) else acc) }
pure def alwaysAppealRowsForOthers(m: Moderation): bool = m.items.every(i => i.key.kind == AppealReview implies
  (m.cases.some(c => c.key == i.key.subject and c.escalated and c.appellant != i.recipient)))
pure def alwaysCasesUnique(m: Moderation): bool = m.cases.every(c => c.key != "" and c.appellant > 0 and c.escalated and
  m.cases.select(o => o.key == c.key).length() == 1)
```

### An enforcement record reaches its applicant and steward, and a reinstatement request the moderators who did not place it

The rows are written in the enforcement record's own batch and carry no
reason or evidence: those stay in the administrator panel. A reinstatement
request also reaches each current moderator except the one who placed the
restriction.

```quint
type Enforcement = { id: str, project: int, applicant: int, steward: int, placedBy: int, reinstatementRequest: bool }
pure def enforcementKey(e: Enforcement): Key = { ...noKey, kind: EnforcementRecord, subject: e.id, project: e.project }
pure def reviewKey(e: Enforcement): Key = { ...noKey, kind: ReinstatementReview, subject: e.id, project: e.project }
pure def canRecordEnforcement(m: Moderation, by: int, enforcement: Enforcement): bool =
  by == projectService and enforcement.id != "" and enforcement.project > 0 and enforcement.applicant > 0 and
  enforcement.steward > 0 and enforcement.placedBy > 0 and not(m.items.some(i => i.key == enforcementKey(enforcement)))
pure def recordEnforcement(m: Moderation, by: int, enforcement: Enforcement): Moderation =
  val owners = addOnce(addOnce(m.items, enforcementKey(enforcement), enforcement.applicant), enforcementKey(enforcement),
    enforcement.steward)
  { ...m, items: if (not(enforcement.reinstatementRequest)) owners
    else m.moderators.foldl(owners, (acc, r) => if (r != enforcement.placedBy) addOnce(acc, reviewKey(enforcement), r) else acc) }
pure def lawPlacingModeratorNotAsked(m: Moderation, enforcement: Enforcement): bool =
  not(has(recordEnforcement({ ...m, items: List() }, projectService, enforcement), reviewKey(enforcement), enforcement.placedBy))
pure def sometimesReinstatementReviewRequested(m: Moderation): bool = m.items.some(i => i.key.kind == ReinstatementReview)
```

### An underfunded month asks the steward once, and each owner cut notifies its contributor once

The steward's payout exception is keyed by project and month, without a
time, so a coordinator retry never adds a second row. Each committed owner
cut is keyed by its sequence and reaches the contributor whose amount was
cut; a refused cut writes nothing.

```quint
pure def underfundedKey(project: int, period: int): Key = { ...noKey, kind: MonthlyUnderfunded, project: project, period: period }
pure def cutKey(project: int, period: int, sequence: int): Key =
  { ...noKey, kind: MonthlyCut, project: project, period: period, sequence: sequence }
pure def canNoteUnderfunded(m: Moderation, by: int, project: int, period: int, steward: int): bool =
  by == monthlyJob and project > 0 and period > 0 and steward > 0
pure def noteUnderfunded(m: Moderation, by: int, project: int, period: int, steward: int): Moderation =
  if (m.items.some(i => i.key == underfundedKey(project, period))) m
  else { ...m, items: addOnce(m.items, underfundedKey(project, period), steward) }
pure def canNoteCut(m: Moderation, by: int, project: int, period: int, sequence: int, recipient: int): bool =
  by == monthlyJob and project > 0 and period > 0 and sequence > 0 and recipient > 0 and
  not(m.items.some(i => i.key == cutKey(project, period, sequence) and i.recipient != recipient))
pure def noteCut(m: Moderation, by: int, project: int, period: int, sequence: int, recipient: int): Moderation =
  { ...m, items: addOnce(m.items, cutKey(project, period, sequence), recipient) }
pure def alwaysOneUnderfundedRowPerMonth(m: Moderation): bool = m.items.every(i => i.key.kind == MonthlyUnderfunded implies
  m.items.select(o => o.key == i.key).length() == 1)
pure def sometimesUnderfundedRetried(m: Moderation): bool = m.items.some(i => i.key.kind == MonthlyUnderfunded)
```

## Story: A moderator reads only what current authority allows and records each decision with a reason

### Every open rechecks the current roster and refuses a stale or unavailable check

The list, the unread count and each open read the moderator roster again;
the shell supplies the version it checked against. A check against an
earlier roster is refused and an unavailable one is retryable. A moderator
review row is shown only to a current moderator: a Scam review only while
the penalty still stands and never about the viewer's own account, an
appeal or dispute review only while escalated and never to its appellant.
Other rows are shown only to their recipient.

```quint
type AuthorityCheck = { actor: int, rosterVersion: int, available: bool }
pure def visible(m: Moderation, viewer: int, key: Key): bool =
  has(m, key, viewer) and (
    if (key.kind == ScamReview) m.moderators.includes(viewer) and not(penaltyOf(m, key.subject).reversed) and
      penaltyOf(m, key.subject).author != viewer
    else if (key.kind == AppealReview) m.moderators.includes(viewer) and caseOf(m, key.subject).escalated and
      caseOf(m, key.subject).appellant != viewer
    else true)
pure def readResult(m: Moderation, by: int, key: Key, authority: AuthorityCheck): ReadResult =
  if (authority.actor != by or by <= 0) StaleRefused
  else if (not(authority.available)) RetryLater
  else if (authority.rosterVersion != m.rosterVersion) StaleRefused
  else if (visible(m, by, key)) Shown else NotShown
pure def canOpenItem(m: Moderation, by: int, key: Key, authority: AuthorityCheck): bool = by > 0 and has(m, key, by)
pure def openItem(m: Moderation, by: int, key: Key, authority: AuthorityCheck): Moderation =
  val result = readResult(m, by, key, authority)
  { ...m, reads: m.reads.append({ viewer: by, key: key, result: result }),
    items: if (result == Shown) m.items.listMap(i => if (i.key == key and i.recipient == by and i.readAt == 0)
      { ...i, readAt: m.clock } else i) else m.items }
pure def canChangeRoster(m: Moderation, by: int, moderators: List[int]): bool = by == configRelease and moderators.every(r => r > 0)
pure def changeRoster(m: Moderation, by: int, moderators: List[int]): Moderation =
  { ...m, rosterVersion: m.rosterVersion + 1, moderators: moderators }
pure def canTick(m: Moderation, by: int): bool = by == configRelease
pure def tick(m: Moderation, by: int): Moderation = { ...m, clock: m.clock + 1 }
pure def stepShownOnlyWhenVisible(before: Moderation, after: Moderation): bool =
  val r = after.reads.nthOr(before.reads.length(), { viewer: 0, key: noKey, result: NotShown })
  (after.reads.length() > before.reads.length() and r.result == Shown) implies visible(before, r.viewer, r.key)
pure def lawStaleRosterRefused(m: Moderation, by: int, key: Key, authority: AuthorityCheck): bool =
  (authority.available and authority.rosterVersion != m.rosterVersion) implies readResult(m, by, key, authority) != Shown
pure def lawReversedScamHidden(m: Moderation, viewer: int, item: str): bool =
  penaltyOf(m, item).reversed implies not(visible(m, viewer, scamKey(item)))
pure def sometimesFormerModeratorRefused(m: Moderation): bool =
  m.reads.some(r => r.result == NotShown and r.key.kind == AppealReview)
pure def sometimesStaleRefused(m: Moderation): bool = m.reads.some(r => r.result == StaleRefused)
pure def sometimesReversedScamHidden(m: Moderation): bool =
  m.reads.some(r => r.result == NotShown and r.key.kind == ScamReview)
pure def sometimesShown(m: Moderation): bool = m.reads.some(r => r.result == Shown and r.key.kind == ScamReview)
```

### A decision records its reason once, its resulting state is confirmed, and history stays

Only a current moderator other than the appellant decides an escalated,
unresolved case, with a reason of 1 to 4000 characters. The resulting
restriction, notice or recovery state is confirmed from its own committed
record. Rows, cases, decisions and reads are never removed, and a decision
never takes away the appellant's own view of the case.

```quint
pure def canDecide(m: Moderation, by: int, caseKey: str, reasonLength: int, outcome: Outcome): bool =
  val c = caseOf(m, caseKey)
  m.moderators.includes(by) and c.key == caseKey and caseKey != "" and c.escalated and not(c.resolved) and
  c.appellant != by and reasonLength >= 1 and reasonLength <= 4000
pure def decide(m: Moderation, by: int, caseKey: str, reasonLength: int, outcome: Outcome): Moderation =
  { ...m, cases: m.cases.listMap(c => if (c.key == caseKey) { ...c, resolved: true } else c),
    decisions: m.decisions.append({ caseKey: caseKey, by: by, reasonLength: reasonLength, outcome: outcome, confirmed: false }) }
pure def canConfirmOutcome(m: Moderation, by: int, caseKey: str): bool =
  by == slopbotWorker and m.decisions.some(d => d.caseKey == caseKey and not(d.confirmed))
pure def confirmOutcome(m: Moderation, by: int, caseKey: str): Moderation =
  { ...m, decisions: m.decisions.listMap(d => if (d.caseKey == caseKey) { ...d, confirmed: true } else d) }
pure def alwaysDecisionsRecorded(m: Moderation): bool = m.decisions.every(d =>
  d.reasonLength >= 1 and d.reasonLength <= 4000 and caseOf(m, d.caseKey).resolved and caseOf(m, d.caseKey).appellant != d.by and
  m.decisions.select(o => o.caseKey == d.caseKey).length() == 1) and
  m.cases.every(c => c.resolved iff m.decisions.some(d => d.caseKey == c.key))
pure def stepHistoryRetained(before: Moderation, after: Moderation): bool =
  before.items.every(i => after.items.some(o => o.key == i.key and o.recipient == i.recipient and
    (i.readAt > 0 implies o.readAt == i.readAt))) and
  before.cases.every(c => after.cases.some(o => o.key == c.key and o.appellant == c.appellant and (c.resolved implies o.resolved))) and
  before.decisions.every(d => after.decisions.some(o => o.caseKey == d.caseKey and o.by == d.by and o.reasonLength == d.reasonLength and
    o.outcome == d.outcome and (d.confirmed implies o.confirmed))) and
  before.reads.every(r => after.reads.includes(r)) and
  before.penalties.every(p => after.penalties.some(o => o.item == p.item and o.author == p.author and (p.reversed implies o.reversed)))
pure def sometimesDecisionConfirmed(m: Moderation): bool = m.decisions.some(d => d.confirmed and d.outcome == RestrictionApplied)
```

### Simulation samples cover authors, appellants, former moderators and stale checks

```quint
pure val byValues = Set(18633264, 202660855, 5, slopbotWorker, projectService, monthlyJob, configRelease)
pure val itemValues = Set("pr")
pure val authorValues = Set(5, 18633264)
pure val recipientValues = Set(18633264, 202660855, 5)
pure val caseKeyValues = Set("appeal:pr:head")
pure val appellantValues = Set(5, 202660855)
pure val enforcementValues = Set({ id: "e1", project: 1, applicant: 7, steward: 8, placedBy: 18633264, reinstatementRequest: true },
  { id: "e2", project: 1, applicant: 7, steward: 7, placedBy: 202660855, reinstatementRequest: false })
pure val projectValues = Set(1)
pure val periodValues = Set(202611)
pure val stewardValues = Set(8)
pure val sequenceValues = Set(1, 2)
pure val keyValues = Set(scamKey("pr"), appealKey("appeal:pr:head"), underfundedKey(1, 202611))
pure val authorityValues = Set({ actor: 18633264, rosterVersion: 1, available: true },
  { actor: 18633264, rosterVersion: 2, available: true }, { actor: 202660855, rosterVersion: 1, available: true },
  { actor: 18633264, rosterVersion: 1, available: false }, { actor: 8, rosterVersion: 1, available: true })
pure val moderatorsValues = Set(List(202660855), List(18633264, 202660855))
pure val reasonLengthValues = Set(0, 30)
pure val outcomeValues = Set(RestrictionApplied, NoticeSent)
pure val weight_recordScamPenalty = 5
pure val weight_notifyScamReview = 8
pure val weight_escalateCase = 5
pure val weight_openItem = 8
pure val weight_decide = 5
```
