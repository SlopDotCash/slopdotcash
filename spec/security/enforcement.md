# Project restrictions, admission clearance and reinstatement

PRD section 8 and the owner decisions of 27 October and 11 November 2026 in
`CLAUDE.md`. This machine is the security state of one registered project:
the append-only enforcement journal (`project_enforcements`, migrations
`0023`, `0027`, `0032`, `0066`), contributor flags (`project_flags`,
migrations `0060`, `0123`), the latest admission assessment of each
repository (`vetting_assessments`, migration `0025`) and admission
exemptions (migration `0075` and the audited owner-approved grants). The
registry side of each restriction (the paused, retired revision and the
Community revision after reinstatement) is in the
[project registry](../backend/projects.md); the
[composition](../projectComposition.md) performs both in one D1 batch.

Identities are permanent GitHub actor ids. The actor `0` is the signed
vetting service (`VETTING_RESULT_PUBLIC_KEYS`); the shell supplies it only
after verifying the Ed25519 request signature. Administrators
(`ADMIN_GITHUB_IDS`) and moderators (administrators who are also in
`PROJECT_MODERATOR_GITHUB_IDS`) are a configuration snapshot held in the
state, so no guard takes a caller's role claim. An empty moderator set closes
every moderator action.

## Story: Clear each repository by its own admission before work

### Clearance and restrictions are separate dimensions with their own records

```quint
import admission as A from "./admission"
type Restriction = Clear | FlagQuarantine | ModeratorQuarantine | ServiceBan | ModeratorBan
type Appeal = NoAppeal | AppealRequested | AppealGranted | AppealDenied
type AState = NotAssessed | APending | AIncomplete | AClean | AMalicious
type Assessment = { id: int, state: AState, requestSeq: int, requestEpoch: int, reused: bool, verified: bool, snapshot: List[int] }
type Flag = { receipt: int, actor: int, filedDay: int }
type Grant = { id: int, repository: int, seq: int, approver: int, steward: int, revision: int, decision: int,
  branch: int, head: int, scope: int, limitations: int }
type RecordAction = RecordQuarantine | RecordBan | RecordAppeal | RecordReinstate | RecordDeny
type Issuer = ByModerator | ByVettingService | ByContributorFlags | ByAppellant
type JournalEntry = { seq: int, kind: RecordAction, issuer: Issuer, actor: int, result: RevisionPlan }
type Recipient = ListingAccount | StewardAccount | IndependentModerators
type Notice = { entry: int, to: Recipient }
type Enforcement = { projectId: int, repositories: List[int], original: Set[int], frozen: Set[int],
  creator: int, steward: int, revision: int, administrators: Set[int], moderators: Set[int],
  restriction: Restriction, epoch: int, restrictedBy: Set[int], appeal: Appeal, appellants: Set[int],
  revisionPending: bool, findings: Set[int], reviewedFindings: Set[int], accountBans: List[int],
  seq: int, assessmentIds: Set[int], latest: int -> Assessment,
  flags: List[Flag], withdrawn: Set[int], resolved: List[int], clockDay: int,
  grants: List[Grant], grantSeq: int -> int, exempt: Set[int], revocations: List[int],
  journal: List[JournalEntry], notices: List[Notice] }
pure val unassessed: Assessment = { id: 0, state: NotAssessed, requestSeq: 0, requestEpoch: 0, reused: false, verified: false, snapshot: List() }
pure val initial: Enforcement = { projectId: 1, repositories: List(1), original: Set(1), frozen: Set(),
  creator: 0, steward: 0, revision: 0, administrators: Set(5, 6, 7), moderators: Set(5, 6),
  restriction: Clear, epoch: 0, restrictedBy: Set(), appeal: NoAppeal, appellants: Set(),
  revisionPending: false, findings: Set(), reviewedFindings: Set(), accountBans: List(),
  seq: 0, assessmentIds: Set(), latest: Map(),
  flags: List(), withdrawn: Set(), resolved: List(), clockDay: 0,
  grants: List(), grantSeq: Map(), exempt: Set(), revocations: List(),
  journal: List(), notices: List() }
pure val vettingService = 0
pure def latestOf(e: Enforcement, repository: int): Assessment =
  if (e.latest.keys().contains(repository)) e.latest.get(repository) else unassessed
pure def grantSeqOf(e: Enforcement, repository: int): int =
  if (e.grantSeq.keys().contains(repository)) e.grantSeq.get(repository) else 0
pure def alwaysModeratorsAreAdministrators(e: Enforcement): bool = e.moderators.subseteq(e.administrators)
pure def alwaysRepositoriesRegistered(e: Enforcement): bool =
  e.repositories.length() > 0 and e.repositories.every(r => r > 0)
```

### Each repository clears on its own admission, exemption or retained clean scan

The latest actual assessment of the same immutable repository controls normal
admission. Routine source, dependency, skill, Markdown and presentation
changes queue nothing and keep it. An existing row, a pending or incomplete
investigation, a malicious result, or a clean result whose retained evidence
fails its read is not clearance. The migration-0075 set covers only the
repositories a project listed when it was recorded, ignores pending or
incomplete investigations, and never covers malice. An owner-approved grant
covers its repository until an assessment is requested after the grant;
that later assessment then controls. The project clears only when every
repository clears.

```quint
type Basis = Scanned | FrozenExemption | OwnerApprovedExemption | NotCleared
pure def assessedClean(e: Enforcement, repository: int): bool =
  latestOf(e, repository).state == AClean and latestOf(e, repository).verified
pure def frozenCovers(e: Enforcement, repository: int): bool =
  e.frozen.contains(repository) and latestOf(e, repository).state != AMalicious
pure def grantCovers(e: Enforcement, repository: int): bool =
  e.exempt.contains(repository) and latestOf(e, repository).state != AMalicious and
  latestOf(e, repository).requestSeq < grantSeqOf(e, repository)
pure def repositoryCleared(e: Enforcement, repository: int): bool =
  assessedClean(e, repository) or frozenCovers(e, repository) or grantCovers(e, repository)
pure def cleared(e: Enforcement): bool = e.repositories.every(r => repositoryCleared(e, r))
pure def basis(e: Enforcement, repository: int): Basis =
  if (assessedClean(e, repository)) Scanned else if (frozenCovers(e, repository)) FrozenExemption
  else if (grantCovers(e, repository)) OwnerApprovedExemption else NotCleared
pure def mayContribute(e: Enforcement): bool = e.restriction == Clear and cleared(e)
pure def lawExemptionNeverShownAsScan(e: Enforcement, repository: int): bool =
  basis(e, repository) == Scanned implies latestOf(e, repository).state == AClean and latestOf(e, repository).verified
pure def lawRestrictionsBlockWork(e: Enforcement): bool = e.restriction != Clear implies not(mayContribute(e))
pure def lawIncompleteInvestigationBlocksGrant(e: Enforcement, repository: int): bool =
  (latestOf(e, repository).requestSeq >= grantSeqOf(e, repository) and latestOf(e, repository).state != AClean and
    not(e.frozen.contains(repository))) implies not(repositoryCleared(e, repository))
```

### Assessments are queued by setup, owner rescan, administrator investigation or flag recovery

Creation, a setup check of an unscanned repository and the signed refresh
queue initial admission. The owner may request a new scan only after an
incomplete result (`requestScan`). An administrator may queue an explicit
investigation of any listed repository at any time; it controls clearance
even after an owner-approved grant. During a flag-only pause the signed
refresh queues a fresh scan when the latest one is not fresh or does not
cover every active flag. A repository has at most one pending assessment.
The request captures the active flag receipts and the restriction epoch.

```quint
type RequestOrigin = SetupCheck | OwnerRescan | AdminInvestigation | FlagRecovery
pure def activeFlag(e: Enforcement, f: Flag): bool =
  not(e.withdrawn.contains(f.receipt)) and not(e.resolved.includes(f.receipt)) and e.clockDay - f.filedDay < 90
pure def activeReceipts(e: Enforcement): List[int] = e.flags.select(f => activeFlag(e, f)).listMap(f => f.receipt)
pure def freshClean(e: Enforcement, repository: int): bool =
  assessedClean(e, repository) and not(latestOf(e, repository).reused) and latestOf(e, repository).requestEpoch == e.epoch
pure def coversActiveFlags(e: Enforcement, repository: int): bool =
  e.flags.every(f => activeFlag(e, f) implies latestOf(e, repository).snapshot.includes(f.receipt))
pure def canRequestAssessment(e: Enforcement, by: int, repository: int, requestOrigin: RequestOrigin, assessmentId: int): bool =
  e.repositories.includes(repository) and assessmentId > 0 and not(e.assessmentIds.contains(assessmentId)) and
  latestOf(e, repository).state != APending and
  (if (requestOrigin == SetupCheck) by >= 0 and e.restriction == Clear and latestOf(e, repository).state == NotAssessed
   else if (requestOrigin == OwnerRescan) by > 0 and e.restriction == Clear and latestOf(e, repository).state == AIncomplete
   else if (requestOrigin == AdminInvestigation) e.administrators.contains(by)
   else by == vettingService and e.restriction == FlagQuarantine and
     (not(freshClean(e, repository)) or not(coversActiveFlags(e, repository))))
pure def pendingAssessment(id: int, requestSeq: int, requestEpoch: int, snapshot: List[int]): Assessment =
  { id: id, state: APending, requestSeq: requestSeq, requestEpoch: requestEpoch, reused: false, verified: false, snapshot: snapshot }
pure def requestAssessment(e: Enforcement, by: int, repository: int, requestOrigin: RequestOrigin, assessmentId: int): Enforcement =
  { ...e, seq: e.seq + 1, assessmentIds: e.assessmentIds.union(Set(assessmentId)),
    latest: e.latest.put(repository, pendingAssessment(assessmentId, e.seq + 1, e.epoch, activeReceipts(e))) }
pure def alwaysLatestIdsRequested(e: Enforcement): bool =
  e.repositories.every(r => latestOf(e, r).state == NotAssessed or e.assessmentIds.contains(latestOf(e, r).id))
pure def alwaysSequencedRequests(e: Enforcement): bool =
  e.repositories.every(r => latestOf(e, r).requestSeq <= e.seq and latestOf(e, r).requestEpoch <= e.epoch)
```

### A recorded result updates its repository once and confirmed malice bans at once

Only the scanOutcome of the repository's pending assessment is accepted, once.
A clean result resolves exactly the flags its request captured, and only
when every repository's latest clean assessment captured them (migrations
`0060` and `0123`); a reused clean result resolves flags but never lifts a
pause. An incomplete result blocks clearance. A signed malicious result
records a vetting-service Ban immediately, whatever the current restriction,
keeps an open project appeal, and waits for a moderator decision. The
registry revision plan comes from the same batch: the paused, retired revision
was appended, was not needed because the manifest is already paused and
retired, or is pending because the manifest cannot take it yet.

```quint
type RevisionPlan = RevisionAppended | RevisionNotNeeded | RevisionPending
pure def resultState(o: A::Outcome): AState =
  if (o.disposition == A::DClean) AClean else if (o.disposition == A::DMalicious) AMalicious else AIncomplete
pure def withResult(o: A::Outcome, e: Enforcement): Enforcement =
  { ...e, latest: e.latest.put(o.repository, { ...latestOf(e, o.repository), state: resultState(o), reused: o.reused,
    verified: o.disposition != A::DIncomplete and o.retained }) }
pure def newlyResolved(e: Enforcement): List[int] =
  e.flags.select(f => not(e.resolved.includes(f.receipt)) and
    e.repositories.every(r => latestOf(e, r).state == AClean and latestOf(e, r).snapshot.includes(f.receipt))).listMap(f => f.receipt)
pure def entry(e: Enforcement, kind: RecordAction, issuer: Issuer, actor: int): List[JournalEntry] =
  e.journal.append({ seq: e.journal.length() + 1, kind: kind, issuer: issuer, actor: actor, result: RevisionNotNeeded })
pure def restrictionEntry(e: Enforcement, issuer: Issuer, actor: int, kind: RecordAction, plan: RevisionPlan): List[JournalEntry] =
  e.journal.append({ seq: e.journal.length() + 1, kind: kind, issuer: issuer, actor: actor, result: plan })
pure def owners(e: Enforcement): List[Notice] =
  e.notices.append({ entry: e.journal.length() + 1, to: ListingAccount }).append({ entry: e.journal.length() + 1, to: StewardAccount })
pure def canRecordResult(e: Enforcement, scanOutcome: A::Outcome, plan: RevisionPlan): bool =
  A::validOutcome(scanOutcome) and e.repositories.includes(scanOutcome.repository) and scanOutcome.revision <= e.revision and
  latestOf(e, scanOutcome.repository).id == scanOutcome.assessment and latestOf(e, scanOutcome.repository).state == APending and
  (scanOutcome.disposition == A::DMalicious or plan == RevisionNotNeeded)
pure def recordResult(e: Enforcement, scanOutcome: A::Outcome, plan: RevisionPlan): Enforcement =
  val updated = withResult(scanOutcome, e)
  if (scanOutcome.disposition == A::DClean) { ...updated, resolved: updated.resolved.concat(newlyResolved(updated)) }
  else if (scanOutcome.disposition == A::DMalicious)
    { ...updated, restriction: ServiceBan, epoch: e.epoch + 1,
      restrictedBy: if (e.restriction == Clear) Set() else e.restrictedBy,
      appeal: if (e.restriction == Clear) NoAppeal else e.appeal,
      appellants: if (e.restriction == Clear) Set() else e.appellants,
      revisionPending: if (e.restriction == Clear) plan == RevisionPending else e.revisionPending or plan == RevisionPending,
      findings: e.findings.union(Set(scanOutcome.assessment)),
      journal: restrictionEntry(e, ByVettingService, 0, RecordBan, plan), notices: owners(e) }
  else updated
pure val scanOutcomeValues = Set(
  { assessment: 1, repository: 1, revision: 1, disposition: A::DClean, reused: false, retained: true },
  { assessment: 1, repository: 1, revision: 1, disposition: A::DClean, reused: true, retained: true },
  { assessment: 1, repository: 1, revision: 1, disposition: A::DIncomplete, reused: false, retained: false },
  { assessment: 1, repository: 1, revision: 1, disposition: A::DMalicious, reused: false, retained: true },
  { assessment: 2, repository: 1, revision: 1, disposition: A::DClean, reused: false, retained: true },
  { assessment: 2, repository: 1, revision: 1, disposition: A::DMalicious, reused: false, retained: true },
  { assessment: 3, repository: 2, revision: 2, disposition: A::DClean, reused: false, retained: true },
  { assessment: 3, repository: 2, revision: 2, disposition: A::DMalicious, reused: false, retained: true },
  { assessment: 1, repository: 1, revision: 1, disposition: A::DClean, reused: false, retained: false })
pure def alwaysMaliceBanned(e: Enforcement): bool =
  e.repositories.some(r => latestOf(e, r).state == AMalicious) implies (e.restriction == ServiceBan or e.restriction == ModeratorBan)
pure def alwaysServiceBanFindings(e: Enforcement): bool = e.restriction == ServiceBan implies e.findings.size() > 0
```

### Retained evidence is checked when clearance relies on it

Each read of a clean or malicious assessment's canonical retained evidence
(`backend/vetting/evidence-retention.ts`) reports present or missing. Missing,
corrupt, expired or unauthorized evidence makes the clean result unverified
until a later read finds it again.

```quint
type EvidenceRead = { assessment: int, present: bool }
pure def canObserveEvidence(e: Enforcement, repository: int, evidenceRead: EvidenceRead): bool =
  e.repositories.includes(repository) and latestOf(e, repository).id == evidenceRead.assessment and
  (latestOf(e, repository).state == AClean or latestOf(e, repository).state == AMalicious)
pure def observeEvidence(e: Enforcement, repository: int, evidenceRead: EvidenceRead): Enforcement =
  { ...e, latest: e.latest.put(repository, { ...latestOf(e, repository), verified: evidenceRead.present }) }
pure val evidenceReadValues = Set({ assessment: 1, present: false }, { assessment: 1, present: true }, { assessment: 2, present: false })
```

### An appended repository needs its own admission and the registry mirror stays current

The composition appends the repository here and in the registry in one batch,
and mirrors each new registry revision, its steward and the listing account
(the creator of revision 1, or the applicant who published it). The migration-0075 set
never grows to an appended repository.

```quint
pure def canAppendRepository(e: Enforcement, repository: int): bool =
  repository > 0 and not(e.repositories.includes(repository)) and e.restriction == Clear
pure def appendRepository(e: Enforcement, repository: int): Enforcement =
  { ...e, repositories: e.repositories.append(repository), latest: e.latest.put(repository, unassessed) }
pure def lawMissingAssessmentIsUnassessed(e: Enforcement, repository: int): bool =
  not(e.latest.keys().contains(repository)) implies latestOf(e, repository) == unassessed and not(repositoryCleared(e, repository) and not(e.frozen.contains(repository)) and not(e.exempt.contains(repository)))
pure def canObserveRevision(e: Enforcement, revision: int, steward: int, creator: int): bool =
  revision > e.revision and steward > 0 and creator > 0 and (e.creator == 0 or creator == e.creator)
pure def observeRevision(e: Enforcement, revision: int, steward: int, creator: int): Enforcement =
  { ...e, revision: revision, steward: steward, creator: creator }
pure val revisionValues = Set(1, 2)
pure val stewardValues = Set(1, 4)
pure val creatorValues = Set(1, 2)
pure def alwaysRegisteredIdentities(e: Enforcement): bool = e.revision > 0 iff (e.creator > 0 and e.steward > 0)
```

## Story: Exempt only by the frozen set or an audited owner-approved grant

### The frozen migration-0075 rows cover only original repositories

The row is read from the immutable migration-0075 table, which accepts no
insert after the migration. It names the project and the repository.

```quint
type FrozenRow = { projectId: int, repository: int }
pure def canRecognizeFrozen(e: Enforcement, row: FrozenRow): bool =
  row.projectId == e.projectId and e.original.contains(row.repository) and not(e.frozen.contains(row.repository))
pure def recognizeFrozen(e: Enforcement, row: FrozenRow): Enforcement = { ...e, frozen: e.frozen.union(Set(row.repository)) }
pure val rowValues = Set({ projectId: 1, repository: 1 }, { projectId: 2, repository: 1 }, { projectId: 1, repository: 2 })
pure def alwaysFrozenOriginalOnly(e: Enforcement): bool = e.frozen.subseteq(e.original)
```

### An administrator records an owner-approved exemption only for a current authorized steward

The Umia fork decision (27 October 2026) and the cursory-review decision
(11 November 2026) use this audited record. The approving administrator
need not have repository access. The registered creator or individual
steward must currently hold write or maintain authority read through the
Slopbot installation on that repository (`workers/slopbot/repository-access.ts`);
an organization is never the collaborator identity. The grant records the
branch and head observed, the review scope and limitations, the approver and
the owner decision, and binds the current revision, repository and steward.
A restriction, a malicious latest result, missing installation, unavailable
or denied authority, a changed revision or a second active grant refuses it.
Revocation needs a new decision, keeps the grant and restores ordinary
admission.

```quint
type Access = AccessVerified | AccessDenied | AccessUnavailable | InstallationMissing | InstallationSuspended
type StewardCheck = { actor: int, repository: int, access: Access }
type GrantRequest = { id: int, repository: int, revision: int, steward: int, check: StewardCheck, decision: int,
  branch: int, head: int, scope: int, limitations: int }
pure def canGrantExemption(e: Enforcement, by: int, request: GrantRequest): bool =
  e.administrators.contains(by) and e.restriction == Clear and e.repositories.includes(request.repository) and
  request.id > 0 and not(e.grants.some(g => g.id == request.id)) and not(e.exempt.contains(request.repository)) and
  request.revision == e.revision and request.steward == e.steward and
  (request.check.actor == e.steward or request.check.actor == e.creator) and request.check.repository == request.repository and
  request.check.access == AccessVerified and e.repositories.every(r => latestOf(e, r).state != AMalicious) and
  request.decision > 0 and request.branch > 0 and request.head > 0 and request.scope > 0 and request.limitations > 0
pure def grantExemption(e: Enforcement, by: int, request: GrantRequest): Enforcement =
  { ...e, seq: e.seq + 1, exempt: e.exempt.union(Set(request.repository)), grantSeq: e.grantSeq.put(request.repository, e.seq + 1),
    grants: e.grants.append({ id: request.id, repository: request.repository, seq: e.seq + 1, approver: by,
      steward: request.steward, revision: request.revision, decision: request.decision, branch: request.branch,
      head: request.head, scope: request.scope, limitations: request.limitations }) }
pure val verifiedCheck: StewardCheck = { actor: 1, repository: 1, access: AccessVerified }
pure val goodGrant: GrantRequest = { id: 11, repository: 1, revision: 1, steward: 1, check: verifiedCheck, decision: 1,
  branch: 1, head: 1, scope: 1, limitations: 1 }
pure val requestValues = Set(goodGrant, { ...goodGrant, id: 12 },
  { ...goodGrant, check: { ...verifiedCheck, access: InstallationMissing } },
  { ...goodGrant, check: { ...verifiedCheck, access: AccessUnavailable } },
  { ...goodGrant, check: { ...verifiedCheck, actor: 3 } }, { ...goodGrant, revision: 2 }, { ...goodGrant, head: 0 })
pure def canRevokeExemption(e: Enforcement, by: int, repository: int, grantId: int, decision: int): bool =
  e.administrators.contains(by) and decision > 0 and e.exempt.contains(repository) and
  e.grants.some(g => g.id == grantId and g.repository == repository and g.seq == grantSeqOf(e, repository))
pure def revokeExemption(e: Enforcement, by: int, repository: int, grantId: int, decision: int): Enforcement =
  { ...e, exempt: e.exempt.exclude(Set(repository)), revocations: e.revocations.append(grantId) }
pure val grantIdValues = Set(11, 12)
pure val decisionValues = Set(0, 1)
pure def alwaysExemptionGranted(e: Enforcement): bool =
  e.exempt.forall(r => e.repositories.includes(r) and grantSeqOf(e, r) > 0 and grantSeqOf(e, r) <= e.seq and
    e.grants.some(g => g.repository == r and g.seq == grantSeqOf(e, r)))
pure def alwaysGrantsAudited(e: Enforcement): bool =
  e.grants.every(g => g.approver > 0 and g.decision > 0 and g.branch > 0 and g.head > 0 and g.scope > 0 and g.limitations > 0)
```

## Story: Two eligible contributors pause a project and a fresh clean scan resumes it

### Flagger standing is read at filing time and bound to the current revision

`backend/vetting/flagger-standing.ts` reads GitHub and the published profile
census when the flag is filed: account age, accepted Slop contributions,
whether GitHub marks the member as owner, member or collaborator of a project
repository, and the participation ban list. An unavailable read refuses the
flag. The steward cannot flag. A banned account cannot file a flag but can
read and withdraw its own. Repeated live flags by one actor count once.

```quint
type StandingRead = ReadYes | ReadNo | ReadUnavailable
type FlagStanding = { actor: int, revision: int, accountAgeDays: int, acceptedContributions: int,
  maintainer: StandingRead, banned: StandingRead }
pure def eligibleFlagger(e: Enforcement, by: int, standing: FlagStanding): bool =
  by > 0 and standing.actor == by and standing.revision == e.revision and standing.accountAgeDays >= 30 and
  standing.acceptedContributions >= 1 and standing.maintainer == ReadNo and standing.banned == ReadNo and by != e.steward
pure def twoActiveFlaggers(e: Enforcement): bool =
  e.flags.some(first => activeFlag(e, first) and e.flags.some(second => activeFlag(e, second) and first.actor != second.actor))
pure val goodStanding: FlagStanding = { actor: 2, revision: 1, accountAgeDays: 30, acceptedContributions: 1, maintainer: ReadNo, banned: ReadNo }
pure val standingValues = Set(goodStanding, { ...goodStanding, actor: 3 }, { ...goodStanding, actor: 3, accountAgeDays: 29 },
  { ...goodStanding, actor: 3, acceptedContributions: 0 }, { ...goodStanding, actor: 3, maintainer: ReadUnavailable },
  { ...goodStanding, actor: 3, banned: ReadYes }, { ...goodStanding, actor: 3, revision: 2 }, { ...goodStanding, actor: 1 })
```

### The second distinct active flag quarantines a clear project and later flags only record

Each flag counts for 90 days. In the same transaction as the second distinct
active reporter's flag on a clear project, a `contributor-flags` quarantine
is journaled and the listing account, the steward and the moderators are
notified. It appends no registry revision. A flag on an already restricted
project is recorded without another pause. Withdrawal stops a flag counting
and keeps its history.

```quint
pure def canFlag(e: Enforcement, by: int, receipt: int, standing: FlagStanding): bool =
  eligibleFlagger(e, by, standing) and receipt > 0 and
  not(e.flags.some(f => f.receipt == receipt or (f.actor == by and activeFlag(e, f))))
pure def flag(e: Enforcement, by: int, receipt: int, standing: FlagStanding): Enforcement =
  val filed = { ...e, flags: e.flags.append({ receipt: receipt, actor: by, filedDay: e.clockDay }) }
  if (e.restriction == Clear and twoActiveFlaggers(filed))
    { ...filed, restriction: FlagQuarantine, epoch: e.epoch + 1, restrictedBy: Set(), appeal: NoAppeal, appellants: Set(),
      journal: entry(e, RecordQuarantine, ByContributorFlags, 0),
      notices: owners(e).append({ entry: e.journal.length() + 1, to: IndependentModerators }) }
  else filed
pure def canWithdrawFlag(e: Enforcement, by: int, receipt: int): bool =
  e.flags.some(f => f.actor == by and f.receipt == receipt) and not(e.withdrawn.contains(receipt))
pure def withdrawFlag(e: Enforcement, by: int, receipt: int): Enforcement = { ...e, withdrawn: e.withdrawn.union(Set(receipt)) }
pure def canAdvanceDay(e: Enforcement, day: int): bool = day >= e.clockDay
pure def advanceDay(e: Enforcement, day: int): Enforcement = { ...e, clockDay: day }
pure val dayValues = Set(0, 89, 90)
pure val receiptValues = Set(1, 2, 3)
pure def alwaysFlagTimes(e: Enforcement): bool = e.flags.every(f => f.filedDay <= e.clockDay and f.receipt > 0 and f.actor > 0)
pure def alwaysFlagPause(e: Enforcement): bool = twoActiveFlaggers(e) implies e.restriction != Clear
pure def alwaysActiveActorsUnique(e: Enforcement): bool =
  e.flags.every(first => e.flags.every(second =>
    (activeFlag(e, first) and activeFlag(e, second) and first.actor == second.actor) implies first.receipt == second.receipt))
pure def alwaysResolvedFlagsExist(e: Enforcement): bool = e.resolved.every(receipt => e.flags.some(f => f.receipt == receipt))
```

### A fresh clean scan of every repository lifts a flag-only pause

The signed vetting service reinstates a pause that flags alone placed when
every repository has a clean, non-reused assessment requested at or after the
pause, its retained evidence verifies, the live integration-branch head of
every repository still matches the scanned pin, and the resolved flags leave
fewer than two distinct active reporters. An unavailable pin read defers only
the reinstatement. It appends no registry revision.

```quint
type PinState = PinMatches | PinChanged | PinUnavailable
type PinRead = { repository: int, pin: PinState }
pure def pinsMatch(e: Enforcement, pins: List[PinRead]): bool =
  e.repositories.every(r => pins.some(p => p.repository == r and p.pin == PinMatches))
pure def allFresh(e: Enforcement): bool = e.repositories.every(r => freshClean(e, r))
pure def canReinstateFlagPause(e: Enforcement, by: int, pins: List[PinRead]): bool =
  by == vettingService and e.restriction == FlagQuarantine and allFresh(e) and pinsMatch(e, pins) and not(twoActiveFlaggers(e))
pure def reinstateFlagPause(e: Enforcement, by: int, pins: List[PinRead]): Enforcement =
  { ...e, restriction: Clear, restrictedBy: Set(), appeal: if (e.appeal == AppealRequested) AppealGranted else NoAppeal,
    appellants: Set(), journal: entry(e, RecordReinstate, ByVettingService, 0), notices: owners(e) }
pure val pinsValues = Set(List({ repository: 1, pin: PinMatches }), List({ repository: 1, pin: PinUnavailable }),
  List({ repository: 1, pin: PinChanged }), List({ repository: 1, pin: PinMatches }, { repository: 2, pin: PinMatches }))
```

## Story: Moderators restrict, decide malice and decide appeals independently

### A moderator quarantines a clear project or bans it, and decides a service ban

A moderator quarantines only a clear project. A moderator ban applies to a
clear, flag-paused or quarantined project. A vetting-service Ban waits for a
moderator decision: ban the project and the responsible accounts the
moderator selects from the evidence, or reinstate it through the appeal path.
Current stewardship and the original application never select accounts. A
decision that closes an open project appeal needs a moderator who neither
placed the restriction nor filed the appeal. Account bans are recorded for
[participation restrictions](../access.md); project reinstatement never lifts
them.

```quint
pure def independent(e: Enforcement, by: int): bool =
  e.moderators.contains(by) and not(e.restrictedBy.contains(by)) and not(e.appellants.contains(by))
pure def canQuarantine(e: Enforcement, by: int, plan: RevisionPlan): bool =
  e.moderators.contains(by) and e.restriction == Clear
pure def quarantine(e: Enforcement, by: int, plan: RevisionPlan): Enforcement =
  { ...e, restriction: ModeratorQuarantine, epoch: e.epoch + 1, restrictedBy: Set(by), appeal: NoAppeal, appellants: Set(),
    revisionPending: plan == RevisionPending, journal: restrictionEntry(e, ByModerator, by, RecordQuarantine, plan), notices: owners(e) }
pure def canBan(e: Enforcement, by: int, plan: RevisionPlan): bool =
  e.moderators.contains(by) and (e.restriction == Clear or e.restriction == FlagQuarantine or e.restriction == ModeratorQuarantine)
pure def ban(e: Enforcement, by: int, plan: RevisionPlan): Enforcement =
  { ...e, restriction: ModeratorBan, epoch: e.epoch + 1,
    restrictedBy: if (e.restriction == Clear) Set(by) else e.restrictedBy.union(Set(by)),
    appeal: if (e.restriction == Clear) NoAppeal else e.appeal, appellants: if (e.restriction == Clear) Set() else e.appellants,
    revisionPending: e.revisionPending or plan == RevisionPending,
    journal: restrictionEntry(e, ByModerator, by, RecordBan, plan), notices: owners(e) }
pure def canDecideMalice(e: Enforcement, by: int, accounts: List[int]): bool =
  e.moderators.contains(by) and e.restriction == ServiceBan and accounts.every(a => a > 0) and
  (e.appeal == AppealRequested implies independent(e, by))
pure def decideMalice(e: Enforcement, by: int, accounts: List[int]): Enforcement =
  { ...e, restriction: ModeratorBan, restrictedBy: e.restrictedBy.union(Set(by)),
    appeal: if (e.appeal == AppealRequested) AppealDenied else e.appeal,
    accountBans: e.accountBans.concat(accounts), journal: entry(e, RecordBan, ByModerator, by), notices: owners(e) }
pure val accountsValues = Set(List(), List(1), List(2), List(0))
pure def canSettlePendingRevision(e: Enforcement, by: int): bool = e.administrators.contains(by) and e.revisionPending
pure def settlePendingRevision(e: Enforcement, by: int): Enforcement = { ...e, revisionPending: false }
```

### The steward, the listing account or a moderator files one open project appeal

Filing records the request and notifies the moderators who did not place the
restriction. It neither lifts the restriction nor grants project access.
Banned-account appeals belong to [participation restrictions](../access.md).

```quint
pure def canRequestAppeal(e: Enforcement, by: int): bool =
  by > 0 and e.revision > 0 and e.restriction != Clear and e.appeal != AppealRequested and
  (by == e.steward or by == e.creator or e.moderators.contains(by))
pure def requestAppeal(e: Enforcement, by: int): Enforcement =
  { ...e, appeal: AppealRequested, appellants: e.appellants.union(Set(by)),
    journal: entry(e, RecordAppeal, ByAppellant, by),
    notices: owners(e).append({ entry: e.journal.length() + 1, to: IndependentModerators }) }
pure def canDenyAppeal(e: Enforcement, by: int): bool =
  e.appeal == AppealRequested and e.restriction != Clear and e.restriction != ServiceBan and independent(e, by)
pure def denyAppeal(e: Enforcement, by: int): Enforcement =
  { ...e, appeal: AppealDenied, journal: entry(e, RecordDeny, ByModerator, by), notices: owners(e) }
```

### An independent moderator reinstates only after fresh clean scans of every repository

Reinstatement needs an open project appeal, a moderator independent of the
restriction and the appeal, the landed paused and retired revision, and for
every repository a clean, non-reused, evidence-verified assessment requested
after the latest restriction with its live pin matching. It records the
malicious findings it reviewed; a later finding is a new Ban. It resolves the
flags it found. The registry restores a paused Community listing only if the
project was listed when the restriction began.

```quint
pure def canReinstate(e: Enforcement, by: int, pins: List[PinRead]): bool =
  e.appeal == AppealRequested and e.restriction != Clear and independent(e, by) and not(e.revisionPending) and
  allFresh(e) and pinsMatch(e, pins)
pure def reinstate(e: Enforcement, by: int, pins: List[PinRead]): Enforcement =
  { ...e, restriction: Clear, restrictedBy: Set(), appeal: AppealGranted, appellants: Set(),
    reviewedFindings: e.findings, resolved: e.resolved.concat(activeReceipts(e)),
    journal: entry(e, RecordReinstate, ByModerator, by), notices: owners(e) }
pure val byValues = Set(0, 1, 2, 3, 5, 6, 7)
pure val repositoryValues = Set(1, 2)
pure val assessmentIdValues = Set(1, 2, 3)
pure val planValues = Set(RevisionAppended, RevisionNotNeeded, RevisionPending)
```

### Restriction state, appeals and findings stay consistent

```quint
pure def alwaysClearHoldsNoRestrictionState(e: Enforcement): bool =
  e.restriction == Clear implies e.restrictedBy.size() == 0 and e.appeal != AppealRequested and not(e.revisionPending)
pure def alwaysRestrictedEpoch(e: Enforcement): bool = e.restriction != Clear implies e.epoch > 0 and e.journal.length() > 0
pure def alwaysRestrictedByModerators(e: Enforcement): bool = e.restrictedBy.subseteq(e.moderators)
pure def alwaysAppealHasAppellant(e: Enforcement): bool = e.appeal == AppealRequested implies e.appellants.size() > 0
pure def alwaysFlagPauseHasNoRevision(e: Enforcement): bool = e.restriction == FlagQuarantine implies not(e.revisionPending)
pure def alwaysUnbannedReviewedFindings(e: Enforcement): bool =
  (e.restriction != ServiceBan and e.restriction != ModeratorBan) implies e.findings.subseteq(e.reviewedFindings)
pure def alwaysReviewedAreFindings(e: Enforcement): bool = e.reviewedFindings.subseteq(e.findings)
pure def noticeTo(entry: int, recipient: Recipient): Notice = { entry: entry, to: recipient }
pure def alwaysNoticesPerEntry(e: Enforcement): bool =
  e.journal.every(j => e.notices.includes(noticeTo(j.seq, ListingAccount)) and e.notices.includes(noticeTo(j.seq, StewardAccount)))
pure def alwaysJournalNumbered(e: Enforcement): bool =
  e.journal.every(j => j.seq > 0 and j.seq <= e.journal.length() and e.journal.every(k => k.seq == j.seq implies k == j))
pure def alwaysFlagReceiptsUnique(e: Enforcement): bool =
  e.flags.every(f => e.flags.every(g => g.receipt == f.receipt implies g == f))
pure def alwaysGrantIdsUnique(e: Enforcement): bool =
  e.grants.every(f => e.grants.every(g => g.id == f.id implies g == f))
pure def alwaysAccountBansDecided(e: Enforcement): bool = e.accountBans.every(a => a > 0)
```

### Journals only append and lifting a human restriction needs its decision

Each journal entry, flag and grant has a unique key (sequence, receipt, grant
id), so keeping every earlier element with a list no shorter means no earlier
record is rewritten. The vetting service lifts only a flag-only pause. A clean scan never lifts a
moderator or service restriction. A recorded assessment is never upgraded.

```quint
pure def keeps(before: List[int], after: List[int]): bool =
  after.length() >= before.length() and before.every(x => after.includes(x))
pure def stepJournalsOnlyAppend(before: Enforcement, after: Enforcement): bool =
  after.journal.length() >= before.journal.length() and before.journal.every(j => after.journal.includes(j)) and
  after.notices.length() >= before.notices.length() and before.notices.every(n => after.notices.includes(n)) and
  after.flags.length() >= before.flags.length() and before.flags.every(f => after.flags.includes(f)) and
  after.grants.length() >= before.grants.length() and before.grants.every(g => after.grants.includes(g)) and
  keeps(before.revocations, after.revocations) and keeps(before.accountBans, after.accountBans) and
  keeps(before.resolved, after.resolved)
pure def stepCountersMonotone(before: Enforcement, after: Enforcement): bool =
  after.epoch >= before.epoch and after.seq >= before.seq and after.clockDay >= before.clockDay and
  before.withdrawn.subseteq(after.withdrawn) and before.findings.subseteq(after.findings) and
  before.assessmentIds.subseteq(after.assessmentIds) and before.frozen.subseteq(after.frozen) and
  after.administrators.subseteq(before.administrators) and before.administrators.subseteq(after.administrators) and
  after.moderators.subseteq(before.moderators) and before.moderators.subseteq(after.moderators) and
  after.original.subseteq(before.original) and before.original.subseteq(after.original) and
  (before.creator > 0 implies after.creator == before.creator) and after.projectId == before.projectId and after.revision >= before.revision
pure def stepRepositoriesOnlyAppend(before: Enforcement, after: Enforcement): bool =
  keeps(before.repositories, after.repositories)
pure def stepOnlyDecisionsLiftRestrictions(before: Enforcement, via: str, after: Enforcement): bool =
  (before.restriction != Clear and after.restriction == Clear) implies
    (via == "reinstate" or (via == "reinstateFlagPause" and before.restriction == FlagQuarantine))
pure def stepRecordedAssessmentsNeverChange(before: Enforcement, after: Enforcement): bool =
  before.repositories.every(r =>
    (latestOf(before, r).state != APending and latestOf(before, r).state != NotAssessed and latestOf(after, r).id == latestOf(before, r).id)
      implies latestOf(after, r).state == latestOf(before, r).state)
```

### Reachable outcomes

```quint
pure def sometimesFlagPaused(e: Enforcement): bool = e.restriction == FlagQuarantine
pure def sometimesFlagPauseLifted(e: Enforcement): bool =
  e.restriction == Clear and e.journal.some(j => j.kind == RecordReinstate and j.issuer == ByVettingService)
pure def sometimesAwaitingMaliceDecision(e: Enforcement): bool = e.restriction == ServiceBan and e.appeal == AppealRequested
pure def sometimesBannedWithAccounts(e: Enforcement): bool = e.restriction == ModeratorBan and e.accountBans.length() > 0
pure def sometimesReinstatedAfterMalice(e: Enforcement): bool = e.restriction == Clear and e.findings.size() > 0
pure def sometimesAppealDenied(e: Enforcement): bool = e.appeal == AppealDenied and e.restriction == ModeratorQuarantine
pure def sometimesExemptWithoutScan(e: Enforcement): bool = cleared(e) and e.exempt.size() > 0 and latestOf(e, 1).state == NotAssessed
pure def sometimesInvestigationOverridesGrant(e: Enforcement): bool =
  e.exempt.contains(1) and latestOf(e, 1).state == APending and not(cleared(e))
pure def sometimesRevokedGrant(e: Enforcement): bool = e.revocations.length() > 0 and not(cleared(e))
pure def sometimesFrozenDespiteInvestigation(e: Enforcement): bool = e.frozen.contains(1) and latestOf(e, 1).state == APending and cleared(e)
pure def sometimesUnverifiedEvidence(e: Enforcement): bool = latestOf(e, 1).state == AClean and not(cleared(e))
pure def sometimesSingleFlagResolved(e: Enforcement): bool = e.resolved.length() > 0 and e.restriction == Clear and e.journal.length() == 0
pure def sometimesRevisionPending(e: Enforcement): bool = e.revisionPending
pure def sometimesCleared(e: Enforcement): bool = mayContribute(e) and latestOf(e, 1).state == AClean
pure val weight_requestAssessment = 4
pure val weight_recordResult = 4
pure val weight_flag = 4
pure val weight_requestAppeal = 2
pure val weight_reinstate = 3
pure val weight_reinstateFlagPause = 3
pure val eValues = Set(initial)
```
