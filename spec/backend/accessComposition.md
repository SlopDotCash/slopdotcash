# Account bans across participation

PRD sections 2, 7, 8 and 9 and the pinned `backend/projects/README.md`
("Ban project and maintainer"): an account ban from
[participation restrictions](./access.md) stops everything new the account
could start in every subsystem, and leaves what it already has and its
appeals. This machine holds the ban state and the writes the other
subsystems gate on it. Each gated write reads the ban list when it starts
and again inside its committing write, so a ban that commits first refuses
it whole (`assertMaintainerNotBanned`, `assertParticipationAllowed` in
`backend/trace/handler.ts`, the bounty reservation and the private intake
send); nothing is half written. The [project composition](./projectComposition.md)
consumes the same ban read for project creation, publication, revisions and
activation, as actor or as named steward (`maintainer_banned`); the
[monthly settlement](../settlement/monthly.md) owns how a ban excludes a
recipient from a month's allocation. Senders are the authenticated GitHub
account, the services of [participation restrictions](./access.md) and the
project API's scheduler (`-4`), which advances the clock and observes the
score generator's GitHub events.

## Story: A ban refuses new participation and keeps existing rights

### Every new participation write is refused for a banned account, at commit

A new project write or named stewardship, a contribution run or its progress
event, a bounty reservation for the account as researcher, a private report
submission or send, and a new project flag each need the account unbanned
when they start and when they commit. Reading and withdrawing an existing
flag, reconciling a report GitHub already received, and appealing the ban
stay open to a banned account.

```quint
import access as AC from "./access"
import enforcement as E from "../security/enforcement"
type Gate = ProjectWrite | NamedSteward | TraceRun | TraceProgress | BountyReservation | IntakeSubmission | FlagFiling
type Kept = FlagRead | FlagWithdrawal | IntakeReconciliation
type Write = { gate: Gate, actor: int, at: int }
type KeptUse = { kept: Kept, actor: int }
type BanStart = { enforcement: int, target: int, at: int }
type ScoreEvent = { actor: int, at: int }
type Composed = { access: AC::Access, now: int, banStarts: List[BanStart], pending: List[Write], committed: List[Write],
  refused: List[Write], kept: List[KeptUse], events: List[ScoreEvent] }
pure val initial: Composed = { access: AC::initial, now: 0, banStarts: List(), pending: List(), committed: List(),
  refused: List(), kept: List(), events: List() }
pure val scheduler = -4
pure def canBegin(c: Composed, by: int, gate: Gate): bool =
  by > 0 and AC::mayStartParticipation(c.access, by) and not(c.pending.some(w => w.gate == gate and w.actor == by))
pure def begin(c: Composed, by: int, gate: Gate): Composed =
  { ...c, pending: c.pending.append({ gate: gate, actor: by, at: c.now }) }
pure def canCommit(c: Composed, by: int, gate: Gate): bool = c.pending.some(w => w.gate == gate and w.actor == by)
pure def commit(c: Composed, by: int, gate: Gate): Composed =
  val w = { gate: gate, actor: by, at: c.now }
  { ...c, pending: c.pending.select(p => not(p.gate == gate and p.actor == by)),
    committed: if (AC::mayStartParticipation(c.access, by)) c.committed.append(w) else c.committed,
    refused: if (AC::mayStartParticipation(c.access, by)) c.refused else c.refused.append(w) }
pure def canUseKept(c: Composed, by: int, kept: Kept): bool = by > 0
pure def useKept(c: Composed, by: int, kept: Kept): Composed = { ...c, kept: c.kept.append({ kept: kept, actor: by }) }
pure def stepCommitsOnlyUnbanned(before: Composed, after: Composed): bool =
  after.committed.every(w => before.committed.includes(w) or AC::mayStartParticipation(before.access, w.actor))
pure def stepWritesAreWholeOrNothing(before: Composed, via: str, after: Composed): bool =
  via == "commit" implies
    (after.committed.length() + after.refused.length() == before.committed.length() + before.refused.length() + 1)
pure def stepRecordsRetained(before: Composed, after: Composed): bool =
  before.committed.every(w => after.committed.includes(w)) and before.refused.every(w => after.refused.includes(w)) and
  before.banStarts.every(b => after.banStarts.includes(b)) and before.events.every(v => after.events.includes(v)) and
  after.now >= before.now
pure def alwaysWritesTimed(c: Composed): bool =
  c.committed.every(w => w.at <= c.now and w.actor > 0) and c.pending.every(w => w.at <= c.now and w.actor > 0)
```

### The ban decisions are those of participation restrictions, with their start times

Each wrapped decision runs under its own guard. A ban records the time it
started; a released ban no longer gates the account.

```quint
pure def canRecordVettingBan(c: Composed, by: int, project: int, decision: int): bool =
  AC::canRecordVettingBan(c.access, by, project, decision)
pure def recordVettingBan(c: Composed, by: int, project: int, decision: int): Composed =
  { ...c, access: AC::recordVettingBan(c.access, by, project, decision) }
pure def canDecideProjectBan(c: Composed, by: int, project: int, decision: int): bool =
  AC::canDecideProjectBan(c.access, by, project, decision)
pure def decideProjectBan(c: Composed, by: int, project: int, decision: int): Composed =
  { ...c, access: AC::decideProjectBan(c.access, by, project, decision) }
pure def canIdentify(c: Composed, by: int, enforcement: int, target: int): bool = AC::canIdentify(c.access, by, enforcement, target)
pure def identify(c: Composed, by: int, enforcement: int, target: int): Composed =
  { ...c, access: AC::identify(c.access, by, enforcement, target) }
pure def canBan(c: Composed, by: int, enforcement: int, target: int): bool = AC::canBan(c.access, by, enforcement, target)
pure def ban(c: Composed, by: int, enforcement: int, target: int): Composed =
  { ...c, access: AC::ban(c.access, by, enforcement, target),
    banStarts: c.banStarts.append({ enforcement: enforcement, target: target, at: c.now }) }
pure def canAppeal(c: Composed, by: int, enforcement: int): bool = AC::canAppeal(c.access, by, enforcement)
pure def appeal(c: Composed, by: int, enforcement: int): Composed = { ...c, access: AC::appeal(c.access, by, enforcement) }
pure def canTriageAppeal(c: Composed, by: int, appealId: int, uphold: bool, confidenceHundredths: int): bool =
  AC::canTriageAppeal(c.access, by, appealId, uphold, confidenceHundredths)
pure def triageAppeal(c: Composed, by: int, appealId: int, uphold: bool, confidenceHundredths: int): Composed =
  { ...c, access: AC::triageAppeal(c.access, by, appealId, uphold, confidenceHundredths) }
pure def canReinstateAccounts(c: Composed, by: int, decision: int, project: int, targets: List[int]): bool =
  AC::canReinstateAccounts(c.access, by, decision, project, targets)
pure def reinstateAccounts(c: Composed, by: int, decision: int, project: int, targets: List[int]): Composed =
  { ...c, access: AC::reinstateAccounts(c.access, by, decision, project, targets) }
pure def canAdvanceTime(c: Composed, by: int, at: int): bool = by == scheduler and at > c.now
pure def advanceTime(c: Composed, by: int, at: int): Composed = { ...c, now: at }
```

### The score generator gives no credit at or after a ban's start

The generator reads the account bans (`GET /api/v1/project-account-bans`)
and gives no contribution or review credit for an account's events at or
after the start of a ban in force (`scripts/value-ingestion.ts`, `addScore`
in `src/lib/leaderboard.ts`). Earlier credit stays.

```quint
pure def inForce(c: Composed, b: BanStart): bool = not(AC::released(c.access, AC::banFor(c.access, b.enforcement, b.target)))
pure def credited(c: Composed): List[ScoreEvent] =
  c.events.select(v => not(c.banStarts.some(b => b.target == v.actor and b.at <= v.at and inForce(c, b))))
pure def canObserveEvent(c: Composed, by: int, actor: int): bool = by == scheduler and actor > 0
pure def observeEvent(c: Composed, by: int, actor: int): Composed = { ...c, events: c.events.append({ actor: actor, at: c.now }) }
pure def lawNoCreditAfterBanStart(c: Composed, v: ScoreEvent): bool =
  (c.banStarts.some(b => b.target == v.actor and b.at <= v.at and inForce(c, b))) implies not(credited(c).includes(v))
pure def lawEarlierCreditStays(c: Composed, v: ScoreEvent): bool =
  (c.events.includes(v) and c.banStarts.every(b => b.target != v.actor or b.at > v.at)) implies credited(c).includes(v)
```

## Story: A project restriction closes new case work and keeps existing cases moving

### After a quarantine or ban, an existing case keeps analysis and appeal triage

`backend/security/README.md` ("Restricted projects"): while the project is
quarantined or banned, new reports, receipt checks and new awards close;
analysis of an existing case and Slopbot's triage of its appeal continue.

```quint
type CaseAction = AnalyzeCase | TriageCaseAppeal | NewReport | CheckReceipt | NewAward
pure def caseActionOpen(restriction: E::Restriction, work: CaseAction): bool =
  restriction == E::Clear or work == AnalyzeCase or work == TriageCaseAppeal
pure def lawRestrictionClosesNewCaseWork(restriction: E::Restriction, work: CaseAction): bool =
  (restriction != E::Clear and (work == NewReport or work == CheckReceipt or work == NewAward))
    implies not(caseActionOpen(restriction, work))
pure def lawExistingCasesContinue(restriction: E::Restriction): bool =
  caseActionOpen(restriction, AnalyzeCase) and caseActionOpen(restriction, TriageCaseAppeal)
```

### Reachable outcomes

```quint
pure def sometimesRefusedAtCommit(c: Composed): bool = c.refused.some(w => w.gate == BountyReservation)
pure def sometimesBannedKeepsRights(c: Composed): bool =
  AC::banned(c.access, 7) and c.kept.some(k => k.actor == 7 and k.kept == FlagWithdrawal)
pure def sometimesCreditStops(c: Composed): bool =
  credited(c).some(v => v.actor == 7) and c.events.some(v => v.actor == 7 and not(credited(c).includes(v)))
pure def sometimesWritesAgainAfterRelease(c: Composed): bool =
  c.access.releases.some(r => r.target == 7) and not(AC::banned(c.access, 7)) and
  c.committed.some(w => w.actor == 7 and c.banStarts.some(b => b.target == 7 and b.at < w.at))
pure val byValues = Set(18633264, 202660855, 7, AC::vettingService, AC::slopbotService, scheduler)
pure val gateValues = Set(BountyReservation, FlagFiling, TraceRun)
pure val keptValues = Set(FlagWithdrawal, IntakeReconciliation)
pure val projectValues = Set(1)
pure val decisionValues = Set(1, 2, 3)
pure val enforcementValues = Set(2)
pure val targetValues = Set(7)
pure val targetsValues = Set(List(7))
pure val appealIdValues = Set(1)
pure val upholdValues = Set(true)
pure val confidenceHundredthsValues = Set(95)
pure val actorValues = Set(7)
pure val atValues = Set(1, 2, 3)
pure val restrictionValues = Set(E::Clear, E::FlagQuarantine, E::ModeratorQuarantine, E::ServiceBan, E::ModeratorBan)
pure val workValues = Set(AnalyzeCase, TriageCaseAppeal, NewReport, CheckReceipt, NewAward)
pure val vValues = Set({ actor: 7, at: 1 }, { actor: 7, at: 2 })
pure val weight_begin = 4
pure val weight_commit = 4
pure val weight_identify = 6
pure val weight_ban = 6
pure val weight_decideProjectBan = 6
pure val weight_recordVettingBan = 6
pure val weight_observeEvent = 3
pure val cValues = Set(initial)
```
