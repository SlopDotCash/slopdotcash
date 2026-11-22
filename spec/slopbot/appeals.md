# Finding appeals

PRD sections 5, 7 and 9 and CLAUDE.md: Slopbot triages each appeal first and
drafts a resolution; a moderator decides escalated appeals; a maintainer's
reopen always wins; self-approval is refused. Source
`workers/slopbot/appeals.ts`, `review.ts` (`recordHumanSignal`,
`triageAppeal`, `draftResolution`, `applyAppealCommand`, `finishAppeal`,
`escalateDueAppeal`), `maintainer-holds.ts` (`dispatchDueJobs`) and
migration `0064` (`slopbot_appeals`). Terminology follows the source and PRD
section 7: an *upheld* appeal succeeded and reverses the debit; a *denied*
appeal leaves the finding standing.

One instance is one appeal, keyed `appeal:<item node>:<revision>`: at most
one per item revision. The appealed finding, its debit and the project scope
come from an `AppealSubject` that the [closure](./closure.md) decision and
the [penalty journal](../points/penalties.md) supply. The debit is either
zero (no debit row: not closed, not penalty eligible, or a zero-debit
category) or exactly the published table debit of the subject's category
under the row's table version, so escalation by debit always follows the
table. The same phases and escalation criteria govern the other appealable
subjects, each with its own identity: a Points award revision in
[Points disputes](../points/disputes.md), a retained value assessment in
[value disputes](./valueDisputes.md), an account ban in
[participation restrictions](../backend/access.md) and a project restriction in
[enforcement](../security/enforcement.md). Upheld effects on GitHub and on
the debit belong to the close attempt and the penalty journal, which consume
this machine's outcome in the [Slopbot composition](./composition.md).

## Story: The author appeals and Slopbot triages first

### Only the author opens an appeal of a recorded finding, once per revision

`/slopbot appeal` from the author, or the author reopening their own item,
opens the appeal of the newest finding on that revision. A retired project
gets no review; its appeal exists only to reverse an existing debit and goes
straight to a moderator without triage or GitHub writes. A repeated command
keeps the first appeal.

```quint
import categories as F from "./categories"
type ProjectScope = ScopeActive | ScopeSecurityOnly | ScopeRetired
type AppealSubject = { item: str, revision: str, author: int, category: F::Category, tableVersion: int, debit: int,
  scope: ProjectScope }
type DraftChoice = NoDraft | DraftUphold | DraftDeny
type Escalation = NotEscalated | MaliciousFinding | HighDebit | LowConfidence | DraftRejected | Overdue |
  ParticipationBan | RetiredProject | SiblingHeld
type SiblingStatus = SiblingUnknown | NoSiblingHold | SiblingDenied | SiblingEscalated | SiblingDenyDraft
type Resolution = Unresolved | Upheld | Denied
type ResolvedVia = NotResolved | AcceptedDraft | MaintainerReopen | ModeratorDecision
type BanStatus = BanUnknown | NotBanned | Banned
type Stage = DraftStage | EscalationStage | ResolutionStage
type Entry = { stage: Stage, by: int }
type Appeal = { opened: bool, subject: AppealSubject, appellant: int, openedAt: int, now: int, queuedAt: int,
  draft: DraftChoice, draftConfidence: int, escalation: Escalation, notices: Set[int], ban: BanStatus,
  resolution: Resolution, via: ResolvedVia, resolvedBy: int,
  postedDraft: bool, postedEscalation: bool, postedResolution: bool, journal: List[Entry], sibling: SiblingStatus }
pure val noSubject: AppealSubject = { item: "", revision: "", author: 0, category: F::NoFinding, tableVersion: 0, debit: 0,
  scope: ScopeActive }
pure val initial: Appeal = { opened: false, subject: noSubject, appellant: 0, openedAt: 0, now: 0, queuedAt: 0,
  draft: NoDraft, draftConfidence: 0, escalation: NotEscalated, notices: Set(), ban: BanUnknown,
  resolution: Unresolved, via: NotResolved, resolvedBy: 0,
  postedDraft: false, postedEscalation: false, postedResolution: false, journal: List(), sibling: SiblingUnknown }
pure val slopModerators: Set[int] = Set(18633264, 202660855)
pure val resolutionSeconds = 604800
pure val requeueSeconds = 86400
pure def validSubject(subject: AppealSubject): bool = subject.item != "" and subject.revision != "" and
  subject.author > 0 and subject.category != F::NoFinding and
  (subject.debit == 0 or (F::knownTableVersion(subject.tableVersion) and
    subject.debit == F::debitFor(subject.tableVersion, subject.category))) and
  (subject.scope != ScopeRetired or subject.debit > 0)
pure def lawDebitFollowsTable(subject: AppealSubject): bool =
  validSubject(subject) implies (subject.debit == 0 or subject.debit == F::debitFor(subject.tableVersion, subject.category))
pure def lawHighDebitOnlyForScam(subject: AppealSubject): bool =
  (validSubject(subject) and subject.debit >= F::escalationDebit) implies subject.category == F::Scam
pure def canOpen(a: Appeal, by: int, subject: AppealSubject): bool =
  not(a.opened) and validSubject(subject) and by == subject.author
pure def open(a: Appeal, by: int, subject: AppealSubject): Appeal =
  { ...a, opened: true, subject: subject, appellant: by, openedAt: a.now }
pure def retired(a: Appeal): bool = a.subject.scope == ScopeRetired
pure def unresolved(a: Appeal): bool = a.opened and a.resolution == Unresolved
pure def escalated(a: Appeal): bool = a.escalation != NotEscalated
pure def alwaysOpenedByAuthor(a: Appeal): bool =
  (a.opened implies a.appellant == a.subject.author and validSubject(a.subject)) and
  (not(a.opened) implies a.draft == NoDraft and not(escalated(a)) and a.resolution == Unresolved and
    a.queuedAt == 0 and a.openedAt == 0 and a.via == NotResolved and a.resolvedBy == 0)
pure def stepSubjectFixed(before: Appeal, after: Appeal): bool = before.opened implies
  after.opened and after.subject == before.subject and after.appellant == before.appellant and after.openedAt == before.openedAt
```

### Slopbot stores one draft, and the published criteria escalate it to a moderator

Slopbot reviews the same revision independently with the appeal as
untrusted data and drafts uphold or deny with a confidence. The first draft
is kept; a budget-deferred draft records nothing. Escalation records its
first reason and, in the same write, one moderator Inbox notice per
moderator. A scam (confirmed-malicious) finding, a debit of at least 240
Points, confidence below 90 hundredths and an appellant with an active
participation ban each escalate. A private security case uses its separate
path in the security area.

The appeal also observes its siblings, the other finding appeals of the same
item (`siblingAppealHold` in `appeals.ts`, development `8e7f678e5`,
`49a48f001`, #3179, #3208, #3216): a penalty is recorded once per item, so a
repeat appeal opened on a new head or body must not be self-decided while an
earlier appeal of the same item was denied ("an earlier appeal of this item
was denied"), awaits a moderator ("… awaits a moderator") or has an
unanswered deny draft ("… has a deny draft"). Value disputes are not
findings and are left out. The order at triage is the ban, then a sibling
hold, then the published criteria (`triageAppeal` in `review.ts`).

A `missing_evidence` finding whose active penalty is `missing_evidence`
is drafted deterministically, at confidence 100, from the current item:
uphold when the Evidence section now passes the check of
[closure](./closure.md), deny otherwise (`draftResolution`, development
`bf73d46fa`). No model drafts it.

```quint
pure def canObserveTime(a: Appeal, observedAt: int): bool = observedAt >= a.now
pure def observeTime(a: Appeal, observedAt: int): Appeal = { ...a, now: observedAt }
pure def canObserveBan(a: Appeal, status: BanStatus): bool = unresolved(a) and status != BanUnknown
pure def observeBan(a: Appeal, status: BanStatus): Appeal = { ...a, ban: status }
pure def canObserveSibling(a: Appeal, siblingStatus: SiblingStatus): bool =
  unresolved(a) and siblingStatus != SiblingUnknown
pure def observeSibling(a: Appeal, siblingStatus: SiblingStatus): Appeal = { ...a, sibling: siblingStatus }
pure def siblingHeld(a: Appeal): bool =
  a.sibling == SiblingDenied or a.sibling == SiblingEscalated or a.sibling == SiblingDenyDraft
pure def evidenceDrafted(a: Appeal): bool = a.subject.category == F::MissingEvidence and a.subject.debit > 0
pure def canDraft(a: Appeal, uphold: bool, confidenceHundredths: int): bool =
  unresolved(a) and not(retired(a)) and a.draft == NoDraft and F::validConfidence(confidenceHundredths) and
  not(evidenceDrafted(a))
pure def draft(a: Appeal, uphold: bool, confidenceHundredths: int): Appeal =
  { ...a, draft: if (uphold) DraftUphold else DraftDeny, draftConfidence: confidenceHundredths }
pure def canDraftFromEvidence(a: Appeal, evidenceMissing: bool): bool =
  unresolved(a) and not(retired(a)) and a.draft == NoDraft and evidenceDrafted(a)
pure def draftFromEvidence(a: Appeal, evidenceMissing: bool): Appeal =
  { ...a, draft: if (evidenceMissing) DraftDeny else DraftUphold, draftConfidence: 100 }
pure def publishedReason(a: Appeal): Escalation =
  if (F::confirmedMalicious(a.subject.category)) MaliciousFinding
  else if (a.subject.debit >= F::escalationDebit) HighDebit
  else if (a.draftConfidence < F::closeConfidence) LowConfidence
  else NotEscalated
pure def criteriaReason(a: Appeal): Escalation =
  if (a.ban == Banned) ParticipationBan
  else if (siblingHeld(a)) SiblingHeld
  else publishedReason(a)
pure def escalatedWith(reason: Escalation, a: Appeal): Appeal =
  { ...a, escalation: reason, notices: slopModerators,
    journal: a.journal.append({ stage: EscalationStage, by: 0 }) }
pure def canEscalateByCriteria(a: Appeal): bool =
  unresolved(a) and not(escalated(a)) and a.draft != NoDraft and a.ban != BanUnknown and a.sibling != SiblingUnknown and
  criteriaReason(a) != NotEscalated
pure def escalateByCriteria(a: Appeal): Appeal = escalatedWith(criteriaReason(a), a)
pure def canEscalateRetired(a: Appeal): bool = unresolved(a) and retired(a) and not(escalated(a))
pure def escalateRetired(a: Appeal): Appeal = escalatedWith(RetiredProject, a)
pure def alwaysEscalationNotifiesModerators(a: Appeal): bool =
  (escalated(a) iff a.notices.size() > 0) and a.notices.subseteq(slopModerators) and
  (escalated(a) implies slopModerators.subseteq(a.notices))
pure def alwaysRetiredHasNoDraft(a: Appeal): bool = retired(a) implies a.draft == NoDraft and not(a.postedDraft)
pure def stepDraftOnce(before: Appeal, after: Appeal): bool = before.draft != NoDraft implies
  after.draft == before.draft and after.draftConfidence == before.draftConfidence
pure def stepEscalationOnce(before: Appeal, after: Appeal): bool = escalated(before) implies after.escalation == before.escalation
pure def sometimesEvidenceDraftUpheld(a: Appeal): bool =
  evidenceDrafted(a) and a.draft == DraftUphold and a.draftConfidence == 100
pure def sometimesSiblingHeldAtTriage(a: Appeal): bool = a.escalation == SiblingHeld and a.draft == DraftDeny
pure def sometimesEscalatedByCriteria(a: Appeal): bool = a.escalation == HighDebit or a.escalation == MaliciousFinding
pure def sometimesBanEscalated(a: Appeal): bool = a.escalation == ParticipationBan
pure def sometimesRetiredEscalated(a: Appeal): bool = a.escalation == RetiredProject
```

## Story: The draft is accepted or rejected, and escalated appeals go to a moderator

### Only the appellant or a current maintainer answers a draft; rejection escalates

`/slopbot accept` applies the draft and `/slopbot reject` escalates it. Only
the appellant or a current maintainer of the repository may answer, checked
by the GitHub permission service for the sender. A participation ban of the
appellant seen at an answer from the appellant or a current maintainer
escalates instead of resolving, whether or not a draft exists yet; any other
sender is refused first (`review.ts` lines 3060-3082). Without a
ban and without a draft, an answer changes nothing ("no draft to answer
yet"). An escalated appeal ignores further draft answers ("a Slop moderator
decides this appeal"). A sibling can be denied or escalated, or get a deny
draft, after triage, so the siblings are read again when the appellant
accepts an uphold draft: with a hold the appeal escalates with that reason
instead of resolving (`review.ts` lines 3273-3293). A maintainer's accept,
and the appellant's accept of a deny draft, are not held.

```quint
type ActorRole = RoleUnavailable | CurrentMaintainer | NotMaintainer
type AuthorityCheck = { actor: int, item: str, role: ActorRole }
pure def mayAnswer(a: Appeal, by: int, authority: AuthorityCheck): bool = by > 0 and
  (by == a.appellant or (authority.actor == by and authority.item == a.subject.item and authority.role == CurrentMaintainer))
pure def answerable(a: Appeal): bool = unresolved(a) and not(escalated(a)) and a.draft != NoDraft
pure def canReject(a: Appeal, by: int, authority: AuthorityCheck): bool = answerable(a) and mayAnswer(a, by, authority) and
  a.ban == NotBanned
pure def reject(a: Appeal, by: int, authority: AuthorityCheck): Appeal = escalatedWith(DraftRejected, a)
pure def canEscalateBanAtAnswer(a: Appeal, by: int, authority: AuthorityCheck): bool =
  unresolved(a) and not(escalated(a)) and a.ban == Banned and mayAnswer(a, by, authority)
pure def escalateBanAtAnswer(a: Appeal, by: int, authority: AuthorityCheck): Appeal = escalatedWith(ParticipationBan, a)
pure def appellantUpholds(a: Appeal, by: int): bool = by == a.appellant and a.draft == DraftUphold
pure def canAccept(a: Appeal, by: int, authority: AuthorityCheck): bool =
  answerable(a) and mayAnswer(a, by, authority) and a.ban == NotBanned and publishedReason(a) == NotEscalated and
  (appellantUpholds(a, by) implies a.sibling == NoSiblingHold)
pure def canEscalateSiblingAtAnswer(a: Appeal, by: int, authority: AuthorityCheck): bool =
  answerable(a) and mayAnswer(a, by, authority) and a.ban == NotBanned and appellantUpholds(a, by) and siblingHeld(a)
pure def escalateSiblingAtAnswer(a: Appeal, by: int, authority: AuthorityCheck): Appeal = escalatedWith(SiblingHeld, a)
pure def stepHeldSiblingNeverSelfUpheld(before: Appeal, via: str, after: Appeal): bool =
  via == "accept" implies not(siblingHeld(before) and appellantUpholds(before, after.resolvedBy))
pure def sometimesSiblingHeldAtAnswer(a: Appeal): bool = a.escalation == SiblingHeld and a.draft == DraftUphold
pure def accept(a: Appeal, by: int, authority: AuthorityCheck): Appeal =
  { ...a, resolution: if (a.draft == DraftUphold) Upheld else Denied, via: AcceptedDraft, resolvedBy: by,
    journal: a.journal.append({ stage: ResolutionStage, by: by }) }
pure def sometimesAcceptedDraft(a: Appeal): bool = a.via == AcceptedDraft and a.resolution == Upheld
pure def sometimesRejectedDraft(a: Appeal): bool = a.escalation == DraftRejected
pure def sometimesBanEscalatedBeforeDraft(a: Appeal): bool = a.escalation == ParticipationBan and a.draft == NoDraft
```

### Only a moderator other than the appellant decides an escalated appeal

`/slopbot uphold` or `/slopbot deny` from a Slop moderator decides an
escalated appeal. A moderator cannot decide their own appeal.

```quint
pure def canModeratorDecide(a: Appeal, by: int, uphold: bool): bool =
  unresolved(a) and escalated(a) and slopModerators.contains(by) and by != a.appellant
pure def moderatorDecide(a: Appeal, by: int, uphold: bool): Appeal =
  { ...a, resolution: if (uphold) Upheld else Denied, via: ModeratorDecision, resolvedBy: by,
    journal: a.journal.append({ stage: ResolutionStage, by: by }) }
pure def alwaysNoSelfModeration(a: Appeal): bool = a.via == ModeratorDecision implies
  a.resolvedBy != a.appellant and slopModerators.contains(a.resolvedBy) and escalated(a)
pure def alwaysAcceptedOnlyUnescalatedLowStakes(a: Appeal): bool = a.via == AcceptedDraft implies
  not(escalated(a)) and a.draft != NoDraft and a.draftConfidence >= F::closeConfidence and
  a.subject.debit < F::escalationDebit and not(F::confirmedMalicious(a.subject.category)) and not(retired(a)) and
  (a.resolution == Upheld iff a.draft == DraftUphold)
pure def alwaysEscalatedResolvedOnlyByModeratorOrReopen(a: Appeal): bool =
  (escalated(a) and a.resolution != Unresolved) implies (a.via == ModeratorDecision or a.via == MaintainerReopen)
pure def sometimesModeratorDecided(a: Appeal): bool = a.via == ModeratorDecision
```

### A verified maintainer reopen of the revision resolves the appeal as upheld, even after escalation

The maintainer's GitHub reopen is a confirmed maintainer decision bound to
the reopened revision and always wins over Slopbot's draft and over a
pending moderator decision.

```quint
type ReopenRecord = { item: str, revision: str, actor: int, role: ActorRole }
pure def canMaintainerReopen(a: Appeal, decision: ReopenRecord): bool = unresolved(a) and
  decision.item == a.subject.item and decision.revision == a.subject.revision and
  decision.role == CurrentMaintainer and decision.actor > 0
pure def maintainerReopen(a: Appeal, decision: ReopenRecord): Appeal =
  { ...a, resolution: Upheld, via: MaintainerReopen, resolvedBy: decision.actor,
    journal: a.journal.append({ stage: ResolutionStage, by: decision.actor }) }
pure def alwaysResolutionConsistent(a: Appeal): bool =
  ((a.resolution == Unresolved) iff (a.via == NotResolved)) and
  (a.resolution != Unresolved implies a.opened and a.resolvedBy > 0) and
  (a.via == MaintainerReopen implies a.resolution == Upheld) and
  (a.resolution == Unresolved implies a.resolvedBy == 0)
pure def stepResolutionOnce(before: Appeal, after: Appeal): bool = before.resolution != Unresolved implies
  after.resolution == before.resolution and after.via == before.via and after.resolvedBy == before.resolvedBy
pure def stepMaintainerReopenWins(before: Appeal, via: str, after: Appeal): bool =
  via == "maintainerReopen" implies after.resolution == Upheld
pure def sometimesReopenAfterEscalation(a: Appeal): bool = a.via == MaintainerReopen and escalated(a)
```

## Story: Unresolved appeals reach a moderator after seven days and stages are posted once

### The scheduled dispatcher escalates an appeal still unresolved seven days after it opened

Source `dispatchDueAppeals`: the five-minute cron queues each unresolved,
unescalated appeal whose due time passed and requeues a lost message after a
day. The queued job escalates once. A permanently unavailable repository or
item still records the escalation and its database-only notices.

```quint
pure def due(a: Appeal): bool = unresolved(a) and not(escalated(a)) and a.now - a.openedAt >= resolutionSeconds
pure def canDispatchDue(a: Appeal): bool = due(a) and (a.queuedAt == 0 or a.now - a.queuedAt >= requeueSeconds)
pure def dispatchDue(a: Appeal): Appeal = { ...a, queuedAt: a.now }
pure def canEscalateOverdue(a: Appeal): bool = due(a) and a.queuedAt > 0
pure def escalateOverdue(a: Appeal): Appeal = escalatedWith(Overdue, a)
pure def alwaysTimes(a: Appeal): bool = a.now >= 0 and a.openedAt >= 0 and a.openedAt <= a.now and
  a.queuedAt >= 0 and a.queuedAt <= a.now and (a.queuedAt > 0 implies a.queuedAt - a.openedAt >= resolutionSeconds)
pure def sometimesOverdueEscalated(a: Appeal): bool = a.escalation == Overdue
pure val fair_dispatchDue = "weak"
pure val fair_escalateOverdue = "weak"
pure val fair_escalateByCriteria = "weak"
pure val fair_escalateRetired = "weak"
pure val fair_observeTime = "weak"
```

### Each stage comment is posted once and a resolution retry resumes its recorded writes

The draft, escalation and resolution comments are posted once each and a
retried command reconciles a write whose response was lost. A retry of a
resolved appeal finishes the recorded decision and never applies the new
command. A retired project gets no GitHub writes; moderators see the Inbox
notices.

```quint
pure def canPostDraft(a: Appeal): bool = a.opened and not(retired(a)) and a.draft != NoDraft and not(a.postedDraft)
pure def postDraft(a: Appeal): Appeal = { ...a, postedDraft: true, journal: a.journal.append({ stage: DraftStage, by: 0 }) }
pure def canPostEscalation(a: Appeal): bool = a.opened and not(retired(a)) and escalated(a) and not(a.postedEscalation)
pure def postEscalation(a: Appeal): Appeal = { ...a, postedEscalation: true }
pure def canPostResolution(a: Appeal): bool = a.opened and not(retired(a)) and a.resolution != Unresolved and not(a.postedResolution)
pure def postResolution(a: Appeal): Appeal = { ...a, postedResolution: true }
pure def alwaysPostsFollowRecords(a: Appeal): bool =
  (a.postedDraft implies a.draft != NoDraft) and (a.postedEscalation implies escalated(a)) and
  (a.postedResolution implies a.resolution != Unresolved) and
  (retired(a) implies not(a.postedDraft) and not(a.postedEscalation) and not(a.postedResolution))
pure def stepJournalAppendOnly(before: Appeal, after: Appeal): bool =
  after.journal.length() >= before.journal.length() and before.journal.every(e => after.journal.includes(e))
pure def stepPostsPermanent(before: Appeal, after: Appeal): bool =
  (before.postedDraft implies after.postedDraft) and (before.postedEscalation implies after.postedEscalation) and
  (before.postedResolution implies after.postedResolution)
pure def sometimesFullyPosted(a: Appeal): bool = a.postedDraft and a.postedEscalation and a.postedResolution
pure def leadsToModeratorOrResolution(a: Appeal, later: Appeal): bool =
  (a.opened and a.resolution == Unresolved and a.now - a.openedAt >= resolutionSeconds) implies
    (escalated(later) or later.resolution != Unresolved)
```

### Simulation samples cover authors and others, high and low stakes, bans and moderators

```quint
pure val spamSubject: AppealSubject = { item: "pr", revision: "head", author: 5, category: F::Spam, tableVersion: 1,
  debit: 30, scope: ScopeActive }
pure val subjectValues = Set(spamSubject, { ...spamSubject, category: F::Scam, debit: 240 },
  { ...spamSubject, category: F::Duplicate, debit: 0 }, { ...spamSubject, scope: ScopeRetired },
  { ...spamSubject, scope: ScopeRetired, debit: 0 }, { ...spamSubject, category: F::NoFinding },
  { ...spamSubject, debit: 240 }, { ...spamSubject, tableVersion: 2 }, { ...spamSubject, tableVersion: 3 },
  { ...spamSubject, category: F::MissingEvidence, tableVersion: 2, debit: 10 },
  { ...spamSubject, category: F::MissingEvidence, tableVersion: 1, debit: 10 })
pure val byValues = Set(5, 6, 18633264)
pure val authorityValues = Set({ actor: 6, item: "pr", role: CurrentMaintainer }, { actor: 6, item: "pr", role: NotMaintainer },
  { actor: 6, item: "pr", role: RoleUnavailable }, { actor: 18633264, item: "pr", role: CurrentMaintainer })
pure val decisionValues = Set({ item: "pr", revision: "head", actor: 6, role: CurrentMaintainer },
  { item: "pr", revision: "older", actor: 6, role: CurrentMaintainer }, { item: "pr", revision: "head", actor: 7, role: NotMaintainer })
pure val confidenceHundredthsValues = Set(50, 89, 90, 97)
pure val observedAtValues = Set(0, 10, 604800, 604810, 691210)
pure val weight_open = 6
pure val weight_draft = 6
pure val weight_accept = 6
pure val weight_observeBan = 3
pure val weight_dispatchDue = 4
pure val weight_escalateOverdue = 4
```
