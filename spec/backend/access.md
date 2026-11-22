# Account participation bans and retained rights

PRD sections 2, 7, 8 and 9, CLAUDE.md ("humans decide ... confirmed-malicious
bans") and the pinned `backend/projects/account-bans.ts`, migrations 0066,
0070, 0071 and 0072. A project investigation identifies responsible accounts
individually; current ownership or original application authorship never
establishes responsibility. A moderator decides the account bans on a
project's confirmed-malicious result, naming the responsible accounts in that
decision. Each ban is its own permanent record and is released only by a
moderator's account reinstatement decision on the account's open appeal, by a
moderator other than the one who banned; one decision may release several
bans. Project reinstatement never releases an account. A moderator decides a
ban appeal directly: there is no Slopbot triage of an account-ban appeal
(Slopbot's appeal triage covers private security cases only, migration 0069).

The authenticated sender `by` is a GitHub actor ID the shell established
from a live session, or one of two service senders the shell established
from a signed service request: `vettingService` for the vetting service's
signed project result and `allocationService` for the monthly allocation and
award reservation job. Moderators are the configured administrators who are
also moderators (`PROJECT_MODERATOR_GITHUB_IDS`, PRD section 9), a
configuration snapshot held in the state as
[enforcement](../security/enforcement.md) holds it; changing them is a
deployment change, not an event, and with none configured no moderator
action is possible (403 `moderation_unavailable`).

## Story: Ban an account from new participation while preserving funded awards and appeals

> As a moderator, I want to stop a confirmed-malicious account from earning or
> starting anything new, without taking away what it is already owed or its
> right to appeal.

### A project ban becomes confirmed malice only through the vetting service's ban and a moderator decision

Each project has one gapless, append-only enforcement sequence (migration
0072, `project_enforcements`); this machine holds the records that decide
account bans. The signed vetting service records a confirmed-malicious ban.
A moderator then decides the project ban, and only when the project's
immediately preceding record is that vetting-service ban (migration 0066,
`project_maintainer_bans_valid`). A project reinstatement, decided after a
fresh clean scan in the [enforcement](../security/enforcement.md) area,
returns the project to clear, so a later moderator ban needs a new
confirmed-malicious result; a project may go through several such cycles.
Project reinstatement never changes an account ban.

```quint
type Ban = { enforcement: int, project: int, target: int, decidedBy: int }
type Release = { decision: int, enforcement: int, target: int, decidedBy: int }
type AppealStatus = AppealOpen | AppealDenied | AppealGranted
type BanAppeal = { id: int, project: int, target: int, status: AppealStatus, decidedBy: int }
type ProjectState = ProjectClear | ProjectBanned
type EnforcementRole = VettingRole | ModeratorRole
type EnforcementAction = BanAction | ReinstateAction
type Enforcement = { id: int, project: int, sequence: int, kind: EnforcementAction, role: EnforcementRole,
  stateAfter: ProjectState, decidedBy: int }
type Award = { id: int, recipient: int, funded: bool, paid: bool }
type Access = { moderators: Set[int], enforcements: List[Enforcement], bans: List[Ban], releases: List[Release],
  appeals: List[BanAppeal], awards: List[Award], decisions: List[int], lastAppeal: int }
pure val vettingService = -1
pure val allocationService = -2
pure val initial: Access = { moderators: Set(18633264, 202660855), enforcements: List(), bans: List(), releases: List(), appeals: List(),
  awards: List(), decisions: List(), lastAppeal: 0 }
pure val absentEnforcement: Enforcement = { id: 0, project: 0, sequence: 0, kind: ReinstateAction, role: ModeratorRole,
  stateAfter: ProjectClear, decidedBy: 0 }
pure def isModerator(a: Access, by: int): bool = a.moderators.contains(by)
pure def freshDecision(a: Access, decision: int): bool = decision > 0 and not(a.decisions.includes(decision))
pure def projectRecords(a: Access, project: int): List[Enforcement] = a.enforcements.select(e => e.project == project)
pure def latestRecord(a: Access, project: int): Enforcement =
  a.enforcements.select(e => e.project == project and e.sequence == projectRecords(a, project).length()).nthOr(0, absentEnforcement)
pure def recordFor(a: Access, by: int, project: int, decision: int, kind: EnforcementAction, role: EnforcementRole,
  stateAfter: ProjectState): Enforcement =
  { id: decision, project: project, sequence: projectRecords(a, project).length() + 1, kind: kind, role: role,
    stateAfter: stateAfter, decidedBy: by }
pure def canRecordVettingBan(a: Access, by: int, project: int, decision: int): bool =
  by == vettingService and project > 0 and freshDecision(a, decision)
pure def recordVettingBan(a: Access, by: int, project: int, decision: int): Access =
  { ...a, enforcements: a.enforcements.append(recordFor(a, by, project, decision, BanAction, VettingRole, ProjectBanned)),
    decisions: a.decisions.append(decision) }
pure def canDecideProjectBan(a: Access, by: int, project: int, decision: int, accounts: List[int]): bool =
  val prior = latestRecord(a, project)
  isModerator(a, by) and project > 0 and freshDecision(a, decision)
    and prior.role == VettingRole and prior.kind == BanAction and prior.stateAfter == ProjectBanned
    and accounts.every(t => t > 0 and t != by and accounts.select(u => u == t).length() == 1
      and (openAppeal(a, project, t) implies independentOf(a, by, project, t)))
pure def decideProjectBan(a: Access, by: int, project: int, decision: int, accounts: List[int]): Access =
  { ...a, enforcements: a.enforcements.append(recordFor(a, by, project, decision, BanAction, ModeratorRole, ProjectBanned)),
    decisions: a.decisions.append(decision),
    bans: a.bans.concat(accounts.listMap(t => { enforcement: decision, project: project, target: t, decidedBy: by })),
    appeals: a.appeals.listMap(p => if (p.status == AppealOpen and p.project == project and accounts.includes(p.target))
      { ...p, status: AppealDenied, decidedBy: by } else p) }
pure def canReinstateProject(a: Access, by: int, project: int, decision: int): bool =
  isModerator(a, by) and project > 0 and freshDecision(a, decision) and latestRecord(a, project).stateAfter == ProjectBanned
pure def reinstateProject(a: Access, by: int, project: int, decision: int): Access =
  { ...a, enforcements: a.enforcements.append(recordFor(a, by, project, decision, ReinstateAction, ModeratorRole, ProjectClear)),
    decisions: a.decisions.append(decision) }
pure def alwaysEnforcementSequenced(a: Access): bool = a.enforcements.every(e =>
  e.id > 0 and e.project > 0 and a.decisions.includes(e.id) and a.enforcements.select(o => o.id == e.id).length() == 1
    and e.sequence > 0 and e.sequence <= projectRecords(a, e.project).length()
    and a.enforcements.select(o => o.project == e.project and o.sequence == e.sequence).length() == 1
    and (e.role == VettingRole implies (e.decidedBy == vettingService and e.kind == BanAction))
    and (e.role == ModeratorRole implies isModerator(a, e.decidedBy))
    and (e.stateAfter == ProjectBanned iff e.kind == BanAction))
pure def alwaysProjectBansConfirmed(a: Access): bool = a.enforcements.every(p =>
  (p.role == ModeratorRole and p.kind == BanAction) implies a.enforcements.some(v => v.project == p.project
    and v.sequence == p.sequence - 1 and v.role == VettingRole and v.kind == BanAction))
```

### A moderator bans each responsible account the investigation identified

The moderator's decision on the project's confirmed-malicious result names
each account the investigation's evidence identifies as responsible
(`responsibleAccounts`, immutable GitHub IDs, each once), and the same
enforcement record bans each of them (`project_maintainer_bans`); there is no
separate identification step. Current stewardship or the original
application never identifies one. A moderator cannot ban their own account. A
banned account may receive further bans from other decisions; a decision that
bans an account again closes that account's open appeal from the project as
denied, so its moderator must be independent of the account's bans there.
Ban records are permanent and immutable.

```quint
pure def projectDecision(a: Access, enforcement: int): Enforcement =
  a.enforcements.select(e => e.id == enforcement and e.role == ModeratorRole and e.kind == BanAction).nthOr(0, absentEnforcement)
pure def released(a: Access, b: Ban): bool = a.releases.some(r => r.enforcement == b.enforcement and r.target == b.target)
pure def banned(a: Access, actor: int): bool = a.bans.some(b => b.target == actor and not(released(a, b)))
pure def alwaysBansDecidedOnConfirmedMalice(a: Access): bool = a.bans.every(b =>
  projectDecision(a, b.enforcement).project == b.project and projectDecision(a, b.enforcement).decidedBy == b.decidedBy
    and isModerator(a, b.decidedBy) and b.target != b.decidedBy and b.target > 0
    and a.bans.select(o => o.enforcement == b.enforcement and o.target == b.target).length() == 1)
pure def stepBanRecordsPermanent(before: Access, after: Access): bool =
  before.bans.every(b => after.bans.includes(b)) and before.releases.every(r => after.releases.includes(r))
    and before.enforcements.every(e => after.enforcements.includes(e))
    and before.decisions.every(d => after.decisions.includes(d))
pure def stepProjectReinstatementKeepsAccountBans(before: Access, via: str, after: Access): bool =
  via == "reinstateProject" implies (after.bans == before.bans and after.releases == before.releases)
pure def stepBansOnlyByDecision(before: Access, via: str, after: Access): bool =
  after.bans.length() > before.bans.length() implies via == "decideProjectBan"
```

### One moderator decision reinstates selected accounts, each on its own appeal or the project's open request

A reinstatement decision names one project and the accounts to release
(migration 0072, `reinstate_accounts`; none selected is 400). For each
selected account it releases every unreleased ban of that account from that
project; the account must have such a ban (409 `account_not_banned`) and its
open account appeal from the project (409 `no_open_appeal`, "Record an appeal
before reinstating an account"), which the decision grants. The deciding
moderator may not have decided any of those bans, nor be a selected account
(403 `independent_review_required`). One decision may therefore release
several accounts and several bans; every other unreleased ban stays in force.
While the project's own reinstatement request is open in the
[enforcement](../security/enforcement.md) area, that request stands for the
selected accounts' own appeals (`reinstate_accounts` in
`backend/projects/verified-enforcement.ts` asks each account's appeal only
when no project appeal is open). This machine does not hold project requests:
`projectRequest` is the enforcement record's read, never a request field,
and `ProjectRequestOpen` stands in for each target's open appeal. Each account decision is one decision written in one D1 batch on both
sides: the shell sends the security side's `journalAccountAppeal(by)`,
`journalAccountDenial(fence)`, `journalAccountReinstatement(fence, accounts)`
and `decideMalice(fence, accounts)` of this project's
[composition](./projectComposition.md) together with this machine's
`appeal(project)`, `denyAppeal(project, decision, projectRequest)`,
`reinstateAccounts(decision, project, targets, projectRequest)` and
`decideProjectBan(project, decision, accounts)`, with `accounts == targets`,
and `projectRequest` read from the same enforcement record whose open project
appeal the security side reads; a refusal of either refuses both (shell
obligation).

```quint
pure def selectedBans(a: Access, project: int, targets: List[int]): List[Ban] =
  a.bans.select(b => b.project == project and targets.includes(b.target) and not(released(a, b)))
pure def openAppeal(a: Access, project: int, target: int): bool =
  a.appeals.some(p => p.project == project and p.target == target and p.status == AppealOpen)
pure def independentOf(a: Access, by: int, project: int, target: int): bool =
  by != target and not(a.bans.some(b => b.project == project and b.target == target and not(released(a, b)) and b.decidedBy == by))
type ProjectRequestRead = ProjectRequestOpen | NoProjectRequest
pure def canReinstateAccounts(a: Access, by: int, decision: int, project: int, targets: List[int],
  projectRequest: ProjectRequestRead): bool =
  isModerator(a, by) and freshDecision(a, decision) and project > 0 and targets.length() > 0
    and targets.every(t => t > 0 and targets.select(u => u == t).length() == 1
      and selectedBans(a, project, List(t)).length() > 0
      and (projectRequest == ProjectRequestOpen or openAppeal(a, project, t)) and independentOf(a, by, project, t))
pure def reinstateAccounts(a: Access, by: int, decision: int, project: int, targets: List[int],
  projectRequest: ProjectRequestRead): Access =
  { ...a, decisions: a.decisions.append(decision),
    releases: a.releases.concat(selectedBans(a, project, targets).listMap(b =>
      { decision: decision, enforcement: b.enforcement, target: b.target, decidedBy: by })),
    appeals: a.appeals.listMap(p => if (p.status == AppealOpen and p.project == project and targets.includes(p.target))
      { ...p, status: AppealGranted, decidedBy: by } else p) }
pure def banFor(a: Access, enforcement: int, target: int): Ban =
  a.bans.select(b => b.enforcement == enforcement and b.target == target).nthOr(0, { enforcement: 0, project: 0, target: 0, decidedBy: 0 })
pure def alwaysReleasesIndependent(a: Access): bool = a.releases.every(r =>
  isModerator(a, r.decidedBy) and banFor(a, r.enforcement, r.target).enforcement > 0
    and r.decidedBy != banFor(a, r.enforcement, r.target).decidedBy and r.decidedBy != r.target
    and a.decisions.includes(r.decision)
    and a.releases.every(o => o.decision == r.decision implies o.decidedBy == r.decidedBy)
    and a.releases.select(o => o.enforcement == r.enforcement and o.target == r.target).length() == 1)
pure def lawReinstatementKeepsOtherProjectBans(a: Access, by: int, decision: int, project: int, targets: List[int],
  projectRequest: ProjectRequestRead, actor: int): bool =
  (alwaysBansDecidedOnConfirmedMalice(a) and canReinstateAccounts(a, by, decision, project, targets, projectRequest)
    and a.bans.some(b => b.target == actor and b.project != project and not(released(a, b))))
    implies banned(reinstateAccounts(a, by, decision, project, targets, projectRequest), actor)
pure def lawUnselectedAccountStaysBanned(a: Access, by: int, decision: int, project: int, targets: List[int],
  projectRequest: ProjectRequestRead, actor: int): bool =
  (canReinstateAccounts(a, by, decision, project, targets, projectRequest) and not(targets.includes(actor)) and banned(a, actor))
    implies banned(reinstateAccounts(a, by, decision, project, targets, projectRequest), actor)
pure def lawReinstatementNeedsAnOpenAppeal(a: Access, by: int, decision: int, project: int, targets: List[int],
  projectRequest: ProjectRequestRead): bool =
  canReinstateAccounts(a, by, decision, project, targets, projectRequest) implies
    (projectRequest == ProjectRequestOpen or targets.every(t => openAppeal(a, project, t)))
```

### A banned account keeps its appeal and an independent moderator decides it

A banned account appeals once per project (`request_reinstatement` with
`appealScope` `account`): the appeal covers every unreleased ban of that
account from that project, needs no other permission, survives project
transfer, and is refused while one is open (409 `appeal_open`). A moderator
decides it directly. A grant is the reinstatement decision above. A denial
(`deny_reinstatement` while the project has no open project request: with one
open it is the project denial of [enforcement](../security/enforcement.md) and
leaves the account appeals open) closes
every open account appeal of the project at once and keeps the bans; it
needs a restricted project (409 `no_open_appeal` while the project is clear)
and a moderator who banned none of those accounts and is none of them (403
`independent_review_required`). While the project's latest record is the
vetting service's ban awaiting a moderator decision, a denial is refused (409
`malicious_decision_required`): the confirmed-malicious result is decided
first, by banning or reinstating.

```quint
pure def canAppeal(a: Access, by: int, project: int): bool =
  by > 0 and project > 0 and a.bans.some(b => b.project == project and b.target == by and not(released(a, b)))
    and not(openAppeal(a, project, by))
pure def appeal(a: Access, by: int, project: int): Access =
  { ...a, lastAppeal: a.lastAppeal + 1,
    appeals: a.appeals.append({ id: a.lastAppeal + 1, project: project, target: by, status: AppealOpen, decidedBy: 0 }) }
pure def projectRestricted(a: Access, project: int): bool = latestRecord(a, project).stateAfter == ProjectBanned
pure def openAppealsOf(a: Access, project: int): List[BanAppeal] =
  a.appeals.select(p => p.project == project and p.status == AppealOpen)
pure def canDenyAppeal(a: Access, by: int, project: int, decision: int, projectRequest: ProjectRequestRead): bool =
  isModerator(a, by) and project > 0 and freshDecision(a, decision) and projectRestricted(a, project)
    and projectRequest == NoProjectRequest and latestRecord(a, project).role == ModeratorRole
    and openAppealsOf(a, project).length() > 0 and openAppealsOf(a, project).every(p => independentOf(a, by, project, p.target))
pure def denyAppeal(a: Access, by: int, project: int, decision: int, projectRequest: ProjectRequestRead): Access =
  { ...a, decisions: a.decisions.append(decision),
    appeals: a.appeals.listMap(p => if (p.status == AppealOpen and p.project == project) { ...p, status: AppealDenied, decidedBy: by } else p) }
pure def appealAccess(a: Access, actor: int): bool = a.bans.some(b => b.target == actor)
pure def alwaysAppealsDecidedByModerators(a: Access): bool = a.lastAppeal >= 0 and a.appeals.every(p =>
  p.id > 0 and p.id <= a.lastAppeal and p.project > 0 and a.bans.some(b => b.project == p.project and b.target == p.target)
    and (p.status == AppealOpen iff p.decidedBy == 0)
    and (p.status == AppealGranted implies a.releases.some(r => r.target == p.target and r.decidedBy == p.decidedBy
      and banFor(a, r.enforcement, r.target).project == p.project))
    and (p.status == AppealOpen implies (a.bans.some(b => b.project == p.project and b.target == p.target and not(released(a, b)))
      and a.appeals.select(o => o.project == p.project and o.target == p.target and o.status == AppealOpen).length() == 1)))
pure def alwaysBanAppealsDecidedIndependently(a: Access): bool = a.appeals.every(p =>
  p.status != AppealOpen implies (isModerator(a, p.decidedBy) and p.decidedBy != p.target))
pure def lawEveryBannedAccountCanAppealOrHasOpenAppeal(a: Access, actor: int, project: int): bool =
  (actor > 0 and project > 0 and a.bans.some(b => b.project == project and b.target == actor and not(released(a, b))))
    implies (canAppeal(a, actor, project) or openAppeal(a, project, actor))
pure def lawDenialNeedsRestrictedProject(a: Access, by: int, project: int, decision: int, projectRequest: ProjectRequestRead): bool =
  not(projectRestricted(a, project)) implies not(canDenyAppeal(a, by, project, decision, projectRequest))
pure def lawDenialWaitsForMaliceDecision(a: Access, by: int, project: int, decision: int, projectRequest: ProjectRequestRead): bool =
  latestRecord(a, project).role == VettingRole implies not(canDenyAppeal(a, by, project, decision, projectRequest))
pure def lawOpenProjectRequestLeavesAccountAppealsOpen(a: Access, by: int, project: int, decision: int): bool =
  not(canDenyAppeal(a, by, project, decision, ProjectRequestOpen))
```

### A ban blocks new awards while funded awards stay payable

The allocation service reserves a new award only for an account with no
unreleased ban; the check runs inside the reserving write, so a ban that
lands first wins. A funded award reserved before a ban stays funded and
payable; a ban never removes or changes it. The award list here is a local
abstraction of settlement's reserved obligations, kept only to state those
two rules against bans; the real reservation and payment state is
settlement's, which must consume `mayStartParticipation` when it reserves
(an external composition obligation, as are the contributor, trace, intake
and credit paths that must refuse a banned actor). Until that composition
exists these rules constrain this abstraction only.

```quint
pure def mayStartParticipation(a: Access, actor: int): bool = not(banned(a, actor))
pure def canReserveAward(a: Access, by: int, awardId: int, recipient: int): bool =
  by == allocationService and awardId > 0 and recipient > 0 and mayStartParticipation(a, recipient)
    and not(a.awards.some(w => w.id == awardId))
pure def reserveAward(a: Access, by: int, awardId: int, recipient: int): Access =
  { ...a, awards: a.awards.append({ id: awardId, recipient: recipient, funded: true, paid: false }) }
pure def canPayAward(a: Access, by: int, awardId: int): bool =
  by == allocationService and a.awards.some(w => w.id == awardId and w.funded and not(w.paid))
pure def payAward(a: Access, by: int, awardId: int): Access =
  { ...a, awards: a.awards.listMap(w => if (w.id == awardId) { ...w, paid: true } else w) }
pure def stepFundedAwardsPreserved(before: Access, after: Access): bool = before.awards.every(w =>
  after.awards.some(x => x.id == w.id and x.recipient == w.recipient and x.funded and (w.paid implies x.paid)))
pure def stepNewAwardOnlyWhenAllowed(before: Access, after: Access): bool = after.awards.every(w =>
  before.awards.some(x => x.id == w.id) or mayStartParticipation(before, w.recipient))
pure def alwaysAwardsIdentified(a: Access): bool = a.awards.every(w => w.id > 0 and w.recipient > 0 and w.funded
  and a.awards.select(x => x.id == w.id).length() == 1)
pure def lawBannedCannotReserve(a: Access, awardId: int, recipient: int): bool =
  banned(a, recipient) implies not(canReserveAward(a, allocationService, awardId, recipient))
```

### Bans, releases, appeals and funded payments are reachable together

The sample sets bound simulation only.

```quint
pure def sometimesProjectReinstatedAccountStillBanned(a: Access): bool =
  latestRecord(a, 1).kind == ReinstateAction and banned(a, 7)
pure def sometimesSecondMaliceCycle(a: Access): bool =
  projectRecords(a, 1).select(e => e.role == ModeratorRole and e.kind == BanAction).length() >= 2
pure def sometimesOneDecisionReleasesTwo(a: Access): bool =
  a.releases.some(r => a.releases.select(o => o.decision == r.decision).length() >= 2)
pure def sometimesBannedTwice(a: Access): bool = a.bans.select(b => b.target == 7).length() >= 2 and banned(a, 7)
pure def sometimesStillBannedAfterOneRelease(a: Access): bool = a.releases.some(r => r.target == 7) and banned(a, 7)
pure def sometimesFullyReleased(a: Access): bool = a.releases.some(r => r.target == 7) and not(banned(a, 7))
pure def sometimesAppealDenied(a: Access): bool = a.appeals.some(p => p.status == AppealDenied) and banned(a, 7)
pure def sometimesAppealAwaitsModerator(a: Access): bool = a.appeals.some(p => p.status == AppealOpen) and banned(a, 7)
pure def sometimesReBanClosedAppeal(a: Access): bool =
  a.appeals.some(p => p.status == AppealDenied and a.bans.some(b => b.target == p.target and b.decidedBy == p.decidedBy))
pure def sometimesOneDenialClosesTwo(a: Access): bool =
  a.appeals.some(p => p.status == AppealDenied and a.appeals.some(o => o.id != p.id and o.status == AppealDenied and o.decidedBy == p.decidedBy
    and o.project == p.project))
pure def sometimesAppealGranted(a: Access): bool = a.appeals.some(p => p.status == AppealGranted)
pure def sometimesReleasedOnProjectRequest(a: Access): bool =
  a.releases.some(r => not(a.appeals.some(p => p.target == r.target and p.project == banFor(a, r.enforcement, r.target).project)))
pure def sometimesPaidWhileBanned(a: Access): bool = a.awards.some(w => w.recipient == 7 and w.paid) and banned(a, 7)
pure val byValues = Set(18633264, 202660855, 7, vettingService, allocationService)
pure val projectValues = Set(1, 2)
pure val decisionValues = Set(1, 2, 3, 4, 5, 6, 7)
pure val accountsValues = Set(List(), List(7), List(8), List(7, 8), List(7, 7), List(18633264))
pure val targetsValues = Set(List(7), List(8), List(7, 8), List(7, 7))
pure val projectRequestValues = Set(ProjectRequestOpen, NoProjectRequest)
pure val actorValues = Set(7, 8)
pure val awardIdValues = Set(1, 2)
pure val recipientValues = Set(7, 8)
pure val weight_appeal = 6
pure val weight_reinstateAccounts = 6
pure val weight_decideProjectBan = 6
pure val weight_recordVettingBan = 4
pure val sampleVetted: Access = recordVettingBan(initial, vettingService, 1, 1)
pure val sampleConfirmed: Access = decideProjectBan(sampleVetted, 18633264, 1, 2, List())
pure val sampleBanned: Access = decideProjectBan(sampleVetted, 18633264, 1, 2, List(7))
pure val aValues = Set(initial).union(Set(sampleConfirmed)).union(Set(sampleBanned))
```
