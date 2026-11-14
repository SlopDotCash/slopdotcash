# Account participation bans and retained rights

PRD sections 2, 7, 8 and 9, CLAUDE.md ("humans decide ... confirmed-malicious
bans") and the pinned `backend/projects/account-bans.ts`, migrations 0066,
0070, 0071 and 0072. A project investigation identifies responsible accounts
individually; current ownership or original application authorship never
establishes responsibility. A moderator decides each account ban on a
project's confirmed-malicious result. Each ban is its own permanent record and
is released only by its own reinstatement record, decided by a moderator other
than the one who banned. Project reinstatement never releases an account.

The authenticated sender `by` is a GitHub actor ID the shell established
from a live session, or one of two service senders the shell established
from a signed service request: `vettingService` for the vetting service's
signed project result and `allocationService` for the monthly allocation and
award reservation job. Moderators are the fixed configured actors of PRD
section 9; changing them is a deployment change, not an event.

## Story: Ban an account from new participation while preserving funded awards and appeals

> As a moderator, I want to stop a confirmed-malicious account from earning or
> starting anything new, without taking away what it is already owed or its
> right to appeal.

### A project ban becomes confirmed malice only through the vetting service's ban and a moderator decision

The vetting service records a confirmed-malicious ban result for a project.
A moderator then decides the project ban on that result; only that decision
makes the project's confirmed malice available for account bans. A later
project reinstatement does not change any account ban.

```quint
type Ban = { enforcement: int, project: int, target: int, decidedBy: int }
type Release = { decision: int, enforcement: int, target: int, decidedBy: int }
type AppealStatus = AppealOpen | AppealDenied | AppealGranted
type Appeal = { id: int, enforcement: int, target: int, status: AppealStatus, decidedBy: int }
type ProjectDecision = { enforcement: int, project: int, decidedBy: int }
type Award = { id: int, recipient: int, funded: bool, paid: bool }
type Access = { vettingBans: List[int], projectBans: List[ProjectDecision], bans: List[Ban], releases: List[Release],
  appeals: List[Appeal], awards: List[Award], decisions: List[int], lastAppeal: int }
pure val moderators: List[int] = List(18633264, 202660855)
pure val vettingService = -1
pure val allocationService = -2
pure val initial: Access = { vettingBans: List(), projectBans: List(), bans: List(), releases: List(), appeals: List(),
  awards: List(), decisions: List(), lastAppeal: 0 }
pure def isModerator(by: int): bool = moderators.includes(by)
pure def freshDecision(a: Access, decision: int): bool = decision > 0 and not(a.decisions.includes(decision))
pure def canRecordVettingBan(a: Access, by: int, project: int): bool =
  by == vettingService and project > 0 and not(a.vettingBans.includes(project))
pure def recordVettingBan(a: Access, by: int, project: int): Access = { ...a, vettingBans: a.vettingBans.append(project) }
pure def canDecideProjectBan(a: Access, by: int, project: int, decision: int): bool =
  isModerator(by) and a.vettingBans.includes(project) and freshDecision(a, decision)
    and not(a.projectBans.some(p => p.project == project))
pure def decideProjectBan(a: Access, by: int, project: int, decision: int): Access =
  { ...a, projectBans: a.projectBans.append({ enforcement: decision, project: project, decidedBy: by }),
    decisions: a.decisions.append(decision) }
pure def alwaysProjectBansConfirmed(a: Access): bool = a.projectBans.every(p =>
  a.vettingBans.includes(p.project) and isModerator(p.decidedBy) and a.decisions.includes(p.enforcement))
```

### A moderator bans each responsible account on that confirmed-malicious decision

The ban rides on the moderator's project ban decision and names the account
by its immutable GitHub ID. A moderator cannot ban their own account. A
banned account may receive further bans from other decisions. Ban records
are permanent and immutable.

```quint
pure def projectDecision(a: Access, enforcement: int): ProjectDecision =
  a.projectBans.select(p => p.enforcement == enforcement).nthOr(0, { enforcement: 0, project: 0, decidedBy: 0 })
pure def canBan(a: Access, by: int, enforcement: int, target: int): bool =
  val p = projectDecision(a, enforcement)
  isModerator(by) and p.enforcement > 0 and p.decidedBy == by and target > 0 and target != by
    and not(a.bans.some(b => b.enforcement == enforcement and b.target == target))
pure def ban(a: Access, by: int, enforcement: int, target: int): Access =
  { ...a, bans: a.bans.append({ enforcement: enforcement, project: projectDecision(a, enforcement).project, target: target, decidedBy: by }) }
pure def released(a: Access, b: Ban): bool = a.releases.some(r => r.enforcement == b.enforcement and r.target == b.target)
pure def banned(a: Access, actor: int): bool = a.bans.some(b => b.target == actor and not(released(a, b)))
pure def alwaysBansDecidedOnConfirmedMalice(a: Access): bool = a.bans.every(b =>
  projectDecision(a, b.enforcement).project == b.project and projectDecision(a, b.enforcement).decidedBy == b.decidedBy
    and isModerator(b.decidedBy) and b.target != b.decidedBy
    and a.bans.select(o => o.enforcement == b.enforcement and o.target == b.target).length() == 1)
pure def stepBanRecordsPermanent(before: Access, after: Access): bool =
  before.bans.every(b => after.bans.includes(b)) and before.releases.every(r => after.releases.includes(r))
    and before.projectBans.every(p => after.projectBans.includes(p)) and before.vettingBans.every(p => after.vettingBans.includes(p))
    and before.decisions.every(d => after.decisions.includes(d))
```

### Each ban is released only by its own independent moderator decision

A release names one ban (decision and account). It needs a moderator other
than the one who decided that ban and a fresh decision record. Releasing one
ban leaves every other unreleased ban in force.

```quint
pure def banFor(a: Access, enforcement: int, target: int): Ban =
  a.bans.select(b => b.enforcement == enforcement and b.target == target).nthOr(0, { enforcement: 0, project: 0, target: 0, decidedBy: 0 })
pure def canRelease(a: Access, by: int, decision: int, enforcement: int, target: int): bool =
  val b = banFor(a, enforcement, target)
  isModerator(by) and b.enforcement > 0 and not(released(a, b)) and by != b.decidedBy and by != target and freshDecision(a, decision)
pure def release(a: Access, by: int, decision: int, enforcement: int, target: int): Access =
  { ...a, releases: a.releases.append({ decision: decision, enforcement: enforcement, target: target, decidedBy: by }),
    decisions: a.decisions.append(decision),
    appeals: a.appeals.listMap(p => if (p.enforcement == enforcement and p.target == target and p.status == AppealOpen)
      { ...p, status: AppealGranted, decidedBy: by } else p) }
pure def alwaysReleasesIndependent(a: Access): bool = a.releases.every(r =>
  isModerator(r.decidedBy) and banFor(a, r.enforcement, r.target).enforcement > 0
    and r.decidedBy != banFor(a, r.enforcement, r.target).decidedBy and a.decisions.includes(r.decision)
    and a.releases.select(o => o.enforcement == r.enforcement and o.target == r.target).length() == 1)
pure def lawOneReleaseKeepsOtherBans(a: Access, by: int, decision: int, enforcement: int, target: int): bool =
  (canRelease(a, by, decision, enforcement, target)
    and a.bans.some(b => b.target == target and b.enforcement != enforcement and not(released(a, b))))
    implies banned(release(a, by, decision, enforcement, target), target)
```

### A banned account keeps its appeal and a moderator decides it

The banned account appeals one ban at a time. Granting the appeal is the
independent release above; denial keeps the ban. Appeal access needs no
other permission and survives project transfer.

```quint
pure def canAppeal(a: Access, by: int, enforcement: int): bool =
  val b = banFor(a, enforcement, by)
  by > 0 and b.enforcement > 0 and not(released(a, b))
    and not(a.appeals.some(p => p.enforcement == enforcement and p.target == by and p.status == AppealOpen))
pure def appeal(a: Access, by: int, enforcement: int): Access =
  { ...a, lastAppeal: a.lastAppeal + 1,
    appeals: a.appeals.append({ id: a.lastAppeal + 1, enforcement: enforcement, target: by, status: AppealOpen, decidedBy: 0 }) }
pure def appealById(a: Access, appealId: int): Appeal =
  a.appeals.select(p => p.id == appealId).nthOr(0, { id: 0, enforcement: 0, target: 0, status: AppealDenied, decidedBy: 0 })
pure def canDenyAppeal(a: Access, by: int, appealId: int, decision: int): bool =
  val p = appealById(a, appealId)
  isModerator(by) and p.id > 0 and p.status == AppealOpen and by != p.target and freshDecision(a, decision)
pure def denyAppeal(a: Access, by: int, appealId: int, decision: int): Access =
  { ...a, decisions: a.decisions.append(decision),
    appeals: a.appeals.listMap(p => if (p.id == appealId) { ...p, status: AppealDenied, decidedBy: by } else p) }
pure def canGrantAppeal(a: Access, by: int, appealId: int, decision: int): bool =
  val p = appealById(a, appealId)
  p.id > 0 and p.status == AppealOpen and canRelease(a, by, decision, p.enforcement, p.target)
pure def grantAppeal(a: Access, by: int, appealId: int, decision: int): Access =
  val p = appealById(a, appealId)
  release(a, by, decision, p.enforcement, p.target)
pure def appealAccess(a: Access, actor: int): bool = a.bans.some(b => b.target == actor)
pure def alwaysAppealsDecidedByModerators(a: Access): bool = a.appeals.every(p =>
  p.id > 0 and p.id <= a.lastAppeal and banFor(a, p.enforcement, p.target).enforcement > 0
    and (p.status == AppealOpen iff p.decidedBy == 0) and (p.status != AppealOpen implies isModerator(p.decidedBy))
    and (p.status == AppealGranted implies released(a, banFor(a, p.enforcement, p.target))))
pure def lawEveryBannedAccountCanAppealOrHasOpenAppeal(a: Access, actor: int, enforcement: int): bool =
  (actor > 0 and banFor(a, enforcement, actor).enforcement > 0 and not(released(a, banFor(a, enforcement, actor))))
    implies (canAppeal(a, actor, enforcement)
      or a.appeals.some(p => p.enforcement == enforcement and p.target == actor and p.status == AppealOpen))
```

### A ban blocks new awards while funded awards stay payable

The allocation service reserves a new award only for an account with no
unreleased ban; the check runs inside the reserving write, so a ban that
lands first wins. A funded award reserved before a ban stays funded and
payable; a ban never removes or changes it. Contributor, trace, intake and
credit paths take the same `banned` fact from this state (see composition
obligations in the accounts fix report).

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
pure def sometimesBannedTwice(a: Access): bool = a.bans.select(b => b.target == 7).length() >= 2 and banned(a, 7)
pure def sometimesStillBannedAfterOneRelease(a: Access): bool = a.releases.some(r => r.target == 7) and banned(a, 7)
pure def sometimesFullyReleased(a: Access): bool = a.releases.some(r => r.target == 7) and not(banned(a, 7))
pure def sometimesAppealDenied(a: Access): bool = a.appeals.some(p => p.status == AppealDenied) and banned(a, 7)
pure def sometimesAppealGranted(a: Access): bool = a.appeals.some(p => p.status == AppealGranted)
pure def sometimesPaidWhileBanned(a: Access): bool = a.awards.some(w => w.recipient == 7 and w.paid) and banned(a, 7)
pure val byValues = Set(18633264, 202660855, 7, vettingService, allocationService)
pure val projectValues = Set(1, 2)
pure val enforcementValues = Set(1, 2, 3)
pure val decisionValues = Set(1, 2, 3, 4, 5)
pure val targetValues = Set(7, 18633264)
pure val actorValues = Set(7, 8)
pure val appealIdValues = Set(1, 2)
pure val awardIdValues = Set(1, 2)
pure val recipientValues = Set(7, 8)
pure val weight_ban = 6
pure val weight_decideProjectBan = 6
pure val weight_recordVettingBan = 4
pure val sampleConfirmed: Access = decideProjectBan(recordVettingBan(initial, vettingService, 1), 18633264, 1, 1)
pure val sampleBanned: Access = ban(sampleConfirmed, 18633264, 1, 7)
pure val aValues = Set(initial).union(Set(sampleConfirmed)).union(Set(sampleBanned))
```
