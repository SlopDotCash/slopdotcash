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
[composition](../backend/projectComposition.md) performs both in one D1 batch.

Identities are permanent GitHub actor ids. The actor `0` is the signed
vetting service (`VETTING_RESULT_PUBLIC_KEYS`); the shell supplies it only
after verifying the Ed25519 request signature. The actor `-1` is the project
API's own scheduled and read jobs (the UTC day clock, the retained-evidence
read and the migration-0075 read); the shell supplies it only for work it
starts itself, never for an HTTP request. Administrators
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
type Assessment = { id: int, repository: int, identity: int, state: AState, revision: int, requestedAt: int, requestEpoch: int,
  requeued: bool, reused: bool, verified: bool, snapshot: List[int], chainRequestedAt: int }
type Flag = { receipt: int, actor: int, filedDay: int }
type Grant = { id: int, repository: int, identity: int, revision: int, manifestDigest: int, steward: int,
  approver: int, at: int, decision: int, reason: int }
type Revocation = { grant: int, administrator: int, decision: int, reason: int, at: int }
type RecordAction = RecordQuarantine | RecordBan | RecordAppeal | RecordReinstate | RecordDeny
  | RecordAccountAppeal | RecordAccountDenial | RecordAccountReinstatement
type Issuer = ByModerator | ByVettingService | ByContributorFlags | ByAppellant
type JournalEntry = { seq: int, kind: RecordAction, issuer: Issuer, actor: int, result: RevisionPlan, assessments: List[int],
  accounts: List[int] }
type AccountBan = { account: int, moderator: int }
type Recipient = ListingAccount | StewardAccount | IndependentModerators
type Notice = { entry: int, to: Recipient }
type Enforcement = { projectId: int, repositories: List[int], original: Set[int], frozen: Set[int], identities: int -> int,
  creator: int, steward: int, revision: int, administrators: Set[int], moderators: Set[int],
  restriction: Restriction, epoch: int, restrictedBy: Set[int], appeal: Appeal, appellants: Set[int],
  revisionPending: bool, findings: Set[int], reviewedFindings: Set[int], accountBans: List[int], liveBans: List[AccountBan],
  seq: int, assessmentIds: Set[int], latest: int -> Assessment, recorded: List[Assessment], unverified: Set[int],
  pinReads: List[PinRead], flags: List[Flag], withdrawn: Set[int], resolved: List[int], clockDay: int,
  grants: List[Grant], activeGrant: int -> int, exempt: Set[int], revocations: List[Revocation],
  journal: List[JournalEntry], notices: List[Notice] }
pure val unassessed: Assessment = { id: 0, repository: 0, identity: 0, state: NotAssessed, revision: 0, requestedAt: 0, requestEpoch: 0,
  requeued: false, reused: false, verified: false, snapshot: List(), chainRequestedAt: 0 }
pure val noGrant: Grant = { id: 0, repository: 0, identity: 0, revision: 0, manifestDigest: 0, steward: 0,
  approver: 0, at: 0, decision: 0, reason: 0 }
pure val initial: Enforcement = { projectId: 1, repositories: List(1), original: Set(1), frozen: Set(), identities: Map(),
  creator: 0, steward: 0, revision: 0, administrators: Set(5, 6, 7), moderators: Set(5, 6),
  restriction: Clear, epoch: 0, restrictedBy: Set(), appeal: NoAppeal, appellants: Set(),
  revisionPending: false, findings: Set(), reviewedFindings: Set(), accountBans: List(), liveBans: List(),
  seq: 0, assessmentIds: Set(), latest: Map(), recorded: List(), unverified: Set(),
  pinReads: List(), flags: List(), withdrawn: Set(), resolved: List(), clockDay: 0,
  grants: List(), activeGrant: Map(), exempt: Set(), revocations: List(),
  journal: List(), notices: List() }
pure val vettingService = 0
pure val platform = -1
pure def latestOf(e: Enforcement, repository: int): Assessment =
  if (e.latest.keys().contains(repository)) e.latest.get(repository) else unassessed
pure def identityOf(e: Enforcement, repository: int): int =
  if (e.identities.keys().contains(repository)) e.identities.get(repository) else 1
pure def grantById(e: Enforcement, grantId: int): Grant = e.grants.select(g => g.id == grantId).nthOr(0, noGrant)
pure def activeGrantOf(e: Enforcement, repository: int): int =
  if (e.activeGrant.keys().contains(repository)) e.activeGrant.get(repository) else 0
pure def grantOf(e: Enforcement, repository: int): Grant = grantById(e, activeGrantOf(e, repository))
pure def exemptStewardOf(e: Enforcement, repository: int): int = grantOf(e, repository).steward
type Fence = { revision: int, sequence: int }
pure def fenced(e: Enforcement, fence: Fence): bool = fence.revision == e.revision and fence.sequence == e.journal.length() + 1
pure val fenceValues = tuples(1.to(4), 1.to(4)).map(x => { revision: x._1, sequence: x._2 })
pure def alwaysModeratorsAreAdministrators(e: Enforcement): bool = e.moderators.subseteq(e.administrators)
pure def alwaysRepositoriesRegistered(e: Enforcement): bool =
  e.repositories.length() > 0 and e.repositories.every(r => r > 0)
```

### Each repository clears on its own admission, exemption or retained clean scan

The latest actual assessment in the uninterrupted history of the same
immutable repository id and node id (its identity epoch) controls normal
admission; an assessment of an earlier identity controls nothing, and no
other repository inherits it. Routine source, dependency, skill, Markdown and
presentation changes queue nothing and keep it. An existing row, a pending or
incomplete investigation, a malicious result, or a clean result whose
retained evidence fails its read is not clearance. The migration-0075 set
covers only the repositories a project listed when it was recorded, ignores
pending or incomplete investigations and identity changes, and never covers
malice. An owner-approved grant covers its repository only for the identity
and steward it bound (`g.steward_id` in `backend/vetting/persistence.ts`), and
only until an assessment of that identity is requested on or after the day of
the grant: a request at the same timestamp controls too. A template-only
replacement of a covered request stays covered through its persisted
replacement chain (`replaces_assessment_id`, `replacesTemplate`), never by
its own day or its reason text: coverage reads the request day of the first
assessment of the chain (`chainRequestedAt`). The project clears
only when every repository clears. Each repository shows one clearance state
(`backend/vetting/README.md`); public views label a grant "Owner-approved
exemption" and never a passed scan.

```quint
type Basis = Scanned | FrozenExemption | OwnerApprovedExemption | NotCleared
type ClearanceState = Unscanned | Unverified | Stale | Queued | Quarantined | Cleared | Banned
pure def controlling(e: Enforcement, repository: int): bool =
  latestOf(e, repository).state != NotAssessed and latestOf(e, repository).identity == identityOf(e, repository)
pure def assessedClean(e: Enforcement, repository: int): bool =
  controlling(e, repository) and latestOf(e, repository).state == AClean and latestOf(e, repository).verified
pure def frozenCovers(e: Enforcement, repository: int): bool =
  e.frozen.contains(repository) and latestOf(e, repository).state != AMalicious
pure def grantCovers(e: Enforcement, repository: int): bool =
  val g = grantOf(e, repository)
  e.exempt.contains(repository) and latestOf(e, repository).state != AMalicious and g.identity == identityOf(e, repository) and
  g.steward == e.steward and (not(controlling(e, repository)) or latestOf(e, repository).chainRequestedAt < g.at)
pure def repositoryCleared(e: Enforcement, repository: int): bool =
  assessedClean(e, repository) or frozenCovers(e, repository) or grantCovers(e, repository)
pure def cleared(e: Enforcement): bool = e.repositories.every(r => repositoryCleared(e, r))
pure def basis(e: Enforcement, repository: int): Basis =
  if (assessedClean(e, repository)) Scanned else if (frozenCovers(e, repository)) FrozenExemption
  else if (grantCovers(e, repository)) OwnerApprovedExemption else NotCleared
pure def basisLabel(b: Basis): str =
  if (b == Scanned) "Admission scan" else if (b == FrozenExemption) "Existing-project exemption"
  else if (b == OwnerApprovedExemption) "Owner-approved exemption" else "Not cleared"
pure def clearanceState(e: Enforcement, repository: int): ClearanceState =
  val a = latestOf(e, repository)
  if (e.restriction == ServiceBan or e.restriction == ModeratorBan or a.state == AMalicious) Banned
  else if (if (e.restriction == Clear) repositoryCleared(e, repository) else freshClean(e, repository)) Cleared
  else if (not(controlling(e, repository))) Unscanned
  else if (a.state == APending) Queued
  else if (a.state == AIncomplete) Quarantined
  else if (not(a.verified)) Unverified
  else Stale
pure def mayContribute(e: Enforcement): bool = e.restriction == Clear and cleared(e)
pure def lawExemptionNeverShownAsScan(e: Enforcement, repository: int): bool =
  basisLabel(basis(e, repository)) == "Admission scan" iff assessedClean(e, repository)
pure def lawExemptionLapsesWithSteward(e: Enforcement, repository: int): bool =
  (exemptStewardOf(e, repository) != e.steward and not(e.frozen.contains(repository)) and not(assessedClean(e, repository)))
    implies not(repositoryCleared(e, repository))
pure def lawRestrictionsBlockWork(e: Enforcement): bool = e.restriction != Clear implies not(mayContribute(e))
pure def lawLaterRequestOverridesGrant(e: Enforcement, repository: int): bool =
  (controlling(e, repository) and latestOf(e, repository).chainRequestedAt >= grantOf(e, repository).at and
    latestOf(e, repository).state != AClean and not(e.frozen.contains(repository))) implies not(repositoryCleared(e, repository))
pure def lawEarlierIdentityControlsNothing(e: Enforcement, repository: int): bool =
  (latestOf(e, repository).identity != identityOf(e, repository) and not(e.frozen.contains(repository)) and not(e.exempt.contains(repository)))
    implies not(repositoryCleared(e, repository))
pure def lawContributionNeedsClearedState(e: Enforcement): bool =
  mayContribute(e) implies e.repositories.every(r => clearanceState(e, r) == Cleared)
```

### Assessments are queued by setup, owner rescan, administrator investigation or flag recovery

A setup check (by the owner or the signed refresh) queues initial admission
only for a repository that is not cleared: unscanned, or an earlier pending
or incomplete scan no exemption covers (`runSetupCheck` and the vetting
refresh queue only `unscanned` or `stale` clearance). A frozen or
owner-approved exemption is kept by the setup check. The owner may request a
new scan only after an incomplete result that no exemption covers
(`requestScan`). An administrator may queue an explicit
investigation of any listed repository at any time; it controls clearance
even after an owner-approved grant. During a flag-only pause the signed
refresh queues a fresh scan when the latest one is not fresh or does not
cover every active flag. A repository has at most one pending assessment.
The request captures the day, the repository's identity epoch, the active
flag receipts and the restriction epoch. When a release replaces the scanner
template before a pending scan finishes, the signed refresh requeues it as a
new assessment, only for a clear project none of whose repositories is
banned: same revision, manifest, content, commit and identity as the retried
request, the live template, and the day, restriction epoch and active flag
receipts of the requeue, inserted only while the retried row is still that
repository's pending assessment (`automaticScans`, `queueAssessment` in
`backend/vetting/handler.ts`). It records the replacement
(`replaces_assessment_id`), through which a grant that covered the retried
request keeps covering it.

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
  e.revision > 0 and e.repositories.includes(repository) and assessmentId > 0 and not(e.assessmentIds.contains(assessmentId)) and
  latestOf(e, repository).state != APending and
  (if (requestOrigin == SetupCheck) by >= 0 and e.restriction == Clear and latestOf(e, repository).state == NotAssessed and
     not(repositoryCleared(e, repository))
   else if (requestOrigin == OwnerRescan) by > 0 and e.restriction == Clear and latestOf(e, repository).state == AIncomplete and
     not(repositoryCleared(e, repository))
   else if (requestOrigin == AdminInvestigation) e.administrators.contains(by)
   else by == vettingService and e.restriction == FlagQuarantine and
     (not(freshClean(e, repository)) or not(coversActiveFlags(e, repository))))
pure def pendingAssessment(e: Enforcement, repository: int, assessmentId: int): Assessment =
  { id: assessmentId, repository: repository, identity: identityOf(e, repository), state: APending,
    revision: e.revision, requestedAt: e.clockDay, requestEpoch: e.epoch, requeued: false, reused: false, verified: false,
    snapshot: activeReceipts(e), chainRequestedAt: e.clockDay }
pure def requestAssessment(e: Enforcement, by: int, repository: int, requestOrigin: RequestOrigin, assessmentId: int): Enforcement =
  { ...e, seq: e.seq + 1, assessmentIds: e.assessmentIds.union(Set(assessmentId)),
    latest: e.latest.put(repository, pendingAssessment(e, repository, assessmentId)) }
pure def canRequeueTemplate(e: Enforcement, by: int, repository: int, assessmentId: int): bool =
  by == vettingService and e.repositories.includes(repository) and latestOf(e, repository).state == APending and
  assessmentId > 0 and not(e.assessmentIds.contains(assessmentId)) and
  e.restriction == Clear and e.repositories.every(r => latestOf(e, r).state != AMalicious)
pure def requeueTemplate(e: Enforcement, by: int, repository: int, assessmentId: int): Enforcement =
  { ...e, assessmentIds: e.assessmentIds.union(Set(assessmentId)),
    latest: e.latest.put(repository, { ...latestOf(e, repository), id: assessmentId, requeued: true, requestedAt: e.clockDay,
      requestEpoch: e.epoch, snapshot: activeReceipts(e) }) }
pure def alwaysLatestIdsRequested(e: Enforcement): bool =
  e.repositories.every(r => latestOf(e, r).state == NotAssessed or
    (e.assessmentIds.contains(latestOf(e, r).id) and latestOf(e, r).repository == r))
pure def alwaysSequencedRequests(e: Enforcement): bool =
  e.clockDay >= 0 and e.epoch >= 0 and e.revision >= 0 and
  e.repositories.every(r => latestOf(e, r).requestedAt <= e.clockDay and latestOf(e, r).requestEpoch <= e.epoch and
    latestOf(e, r).revision <= e.revision and latestOf(e, r).identity <= identityOf(e, r))
```

### A recorded result updates its repository once and confirmed malice bans at once

Only the authenticated vetting service records a result, and only the
scanOutcome of the repository's pending assessment at the revision it was
requested for is accepted, once. A malicious outcome needs its trusted
confirmation (`A::validOutcome`).
Every recorded result is also kept in the assessment history, which no later
assessment, grant or revocation changes. A clean result resolves exactly the
flags its request captured, and only
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
  val after = { ...latestOf(e, o.repository), state: resultState(o), reused: o.reused,
    verified: o.disposition != A::DIncomplete and o.retained }
  { ...e, latest: e.latest.put(o.repository, after), recorded: e.recorded.append(after) }
pure def newlyResolved(e: Enforcement): List[int] =
  e.flags.select(f => not(e.resolved.includes(f.receipt)) and
    e.repositories.every(r => latestOf(e, r).state == AClean and latestOf(e, r).snapshot.includes(f.receipt))).listMap(f => f.receipt)
pure def accountsEntry(e: Enforcement, kind: RecordAction, issuer: Issuer, actor: int, accounts: List[int]): List[JournalEntry] =
  e.journal.append({ seq: e.journal.length() + 1, kind: kind, issuer: issuer, actor: actor, result: RevisionNotNeeded, assessments: List(),
    accounts: accounts })
pure def entry(e: Enforcement, kind: RecordAction, issuer: Issuer, actor: int): List[JournalEntry] = accountsEntry(e, kind, issuer, actor, List())
pure def restrictionEntry(e: Enforcement, issuer: Issuer, actor: int, kind: RecordAction, plan: RevisionPlan): List[JournalEntry] =
  e.journal.append({ seq: e.journal.length() + 1, kind: kind, issuer: issuer, actor: actor, result: plan, assessments: List(), accounts: List() })
pure def owners(e: Enforcement): List[Notice] =
  e.notices.append({ entry: e.journal.length() + 1, to: ListingAccount }).append({ entry: e.journal.length() + 1, to: StewardAccount })
pure def canRecordResult(e: Enforcement, by: int, scanOutcome: A::Outcome, plan: RevisionPlan): bool =
  by == vettingService and A::validOutcome(scanOutcome) and e.repositories.includes(scanOutcome.repository) and
  scanOutcome.revision == latestOf(e, scanOutcome.repository).revision and
  latestOf(e, scanOutcome.repository).id == scanOutcome.assessment and latestOf(e, scanOutcome.repository).state == APending and
  (scanOutcome.disposition == A::DMalicious or plan == RevisionNotNeeded)
pure def recordResult(e: Enforcement, by: int, scanOutcome: A::Outcome, plan: RevisionPlan): Enforcement =
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
  { assessment: 1, repository: 1, revision: 1, disposition: A::DClean, confirmation: A::NoConfirmation, reused: false, retained: true },
  { assessment: 1, repository: 1, revision: 1, disposition: A::DClean, confirmation: A::NoConfirmation, reused: true, retained: true },
  { assessment: 1, repository: 1, revision: 1, disposition: A::DIncomplete, confirmation: A::NoConfirmation, reused: false, retained: false },
  { assessment: 1, repository: 1, revision: 1, disposition: A::DMalicious, confirmation: A::ReproducibleBehavior, reused: false, retained: true },
  { assessment: 2, repository: 1, revision: 1, disposition: A::DClean, confirmation: A::NoConfirmation, reused: false, retained: true },
  { assessment: 2, repository: 1, revision: 1, disposition: A::DMalicious, confirmation: A::ReproducibleBehavior, reused: false, retained: true },
  { assessment: 3, repository: 2, revision: 2, disposition: A::DClean, confirmation: A::NoConfirmation, reused: false, retained: true },
  { assessment: 3, repository: 2, revision: 2, disposition: A::DMalicious, confirmation: A::ReproducibleBehavior, reused: false, retained: true },
  { assessment: 1, repository: 1, revision: 1, disposition: A::DClean, confirmation: A::NoConfirmation, reused: false, retained: false },
  { assessment: 1, repository: 1, revision: 1, disposition: A::DMalicious, confirmation: A::NoConfirmation, reused: false, retained: true },
  { assessment: 1, repository: 1, revision: 2, disposition: A::DClean, confirmation: A::NoConfirmation, reused: false, retained: true })
pure def alwaysMaliceBanned(e: Enforcement): bool =
  (e.repositories.some(r => latestOf(e, r).state == AMalicious) implies (e.restriction == ServiceBan or e.restriction == ModeratorBan)) and
  e.repositories.every(r => latestOf(e, r).state == AMalicious implies latestOf(e, r).requestEpoch < e.epoch) and
  e.recorded.every(a => e.repositories.includes(a.repository) and a.requestEpoch <= latestOf(e, a.repository).requestEpoch)
pure def alwaysServiceBanFindings(e: Enforcement): bool = e.restriction == ServiceBan implies e.findings.size() > 0
```

### Retained evidence is checked when clearance relies on it

Each read of a clean or malicious assessment's canonical retained evidence
(`backend/vetting/evidence-retention.ts`) reports present or missing. Missing,
corrupt, expired or unauthorized evidence makes the clean result unverified
until a later read finds it again. A read may concern any completed clean or
malicious assessment of a listed repository, not only the latest: a
reinstatement relies on the newest completed one at the live pin, which a
later pending or other-pin assessment may follow, and development reads that
one's evidence when it decides (`retainedEvidence(finished)` in
`repositoryClearance`, `backend/vetting/persistence.ts`).

```quint
type EvidenceRead = { assessment: int, present: bool }
pure def canObserveEvidence(e: Enforcement, by: int, repository: int, evidenceRead: EvidenceRead): bool =
  by == platform and e.repositories.includes(repository) and
  ((latestOf(e, repository).id == evidenceRead.assessment and
    (latestOf(e, repository).state == AClean or latestOf(e, repository).state == AMalicious)) or
   e.recorded.some(a => a.id == evidenceRead.assessment and a.repository == repository and (a.state == AClean or a.state == AMalicious)))
pure def observeEvidence(e: Enforcement, by: int, repository: int, evidenceRead: EvidenceRead): Enforcement =
  { ...e, latest: if (latestOf(e, repository).id == evidenceRead.assessment)
      e.latest.put(repository, { ...latestOf(e, repository), verified: evidenceRead.present }) else e.latest,
    unverified: if (evidenceRead.present) e.unverified.exclude(Set(evidenceRead.assessment))
      else e.unverified.union(Set(evidenceRead.assessment)) }
pure val evidenceReadValues = Set({ assessment: 1, present: false }, { assessment: 1, present: true }, { assessment: 2, present: false })
```

### An appended repository needs its own admission and the registry mirror stays current

The composition appends the repository here and in the registry in one batch,
and mirrors each new registry revision, its steward and the listing account
(the creator of revision 1, or the applicant who published it). The migration-0075 set
never grows to an appended repository. The project API's repository read
observes a new node id for a listed repository id (deleted and recreated, or
transferred) as a new identity epoch; the earlier identity's assessments and
grants then control nothing. A restricted project gains a repository only
through an administrator's exception that keeps it paused and retired; the
composition refuses every owner append while it is restricted.

```quint
pure def canAppendRepository(e: Enforcement, repository: int): bool =
  repository > 0 and not(e.repositories.includes(repository))
pure def appendRepository(e: Enforcement, repository: int): Enforcement =
  { ...e, repositories: e.repositories.append(repository), latest: e.latest.put(repository, unassessed),
    identities: e.identities.put(repository, 1) }
pure def lawMissingAssessmentIsUnassessed(e: Enforcement, repository: int): bool =
  not(e.latest.keys().contains(repository)) implies
    (latestOf(e, repository).state == NotAssessed and
     (repositoryCleared(e, repository) implies (e.frozen.contains(repository) or e.exempt.contains(repository))))
pure def canObserveRevision(e: Enforcement, by: int, revision: int, steward: int, creator: int): bool =
  by == platform and revision > e.revision and steward > 0 and creator > 0 and (e.creator == 0 or creator == e.creator)
pure def observeRevision(e: Enforcement, by: int, revision: int, steward: int, creator: int): Enforcement =
  { ...e, revision: revision, steward: steward, creator: creator }
pure def canObserveIdentity(e: Enforcement, by: int, repository: int, identity: int): bool =
  by == platform and e.repositories.includes(repository) and identity > identityOf(e, repository)
pure def observeIdentity(e: Enforcement, by: int, repository: int, identity: int): Enforcement =
  { ...e, seq: e.seq + 1, identities: e.identities.put(repository, identity) }
pure val identityValues = Set(2)
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
pure def canRecognizeFrozen(e: Enforcement, by: int, row: FrozenRow): bool =
  by == platform and row.projectId == e.projectId and e.original.contains(row.repository) and not(e.frozen.contains(row.repository))
pure def recognizeFrozen(e: Enforcement, by: int, row: FrozenRow): Enforcement = { ...e, frozen: e.frozen.union(Set(row.repository)) }
pure val rowValues = Set({ projectId: 1, repository: 1 }, { projectId: 2, repository: 1 }, { projectId: 1, repository: 2 })
pure def alwaysFrozenOriginalOnly(e: Enforcement): bool = e.frozen.subseteq(e.original)
```

### An administrator records an audited exemption only for a current authorized steward

The Umia fork decision (27 October 2026) uses this record, the one kind of
exemption, an owner-approved admission (`POST
/api/v1/admin/vetting/exemptions`, migration `0102`). The approving
administrator need not have repository access, and an ordinary owner never
grants themselves one: the approver is neither the steward nor the listing
account. The registered creator or individual steward must currently hold
write or maintain authority read through the Slopbot installation on that
repository (`workers/slopbot/repository-access.ts`); an organization is never
the collaborator identity. The record binds the current revision and its
canonical manifest digest, the repository's identity and the steward, and
keeps the approver, the owner decision reference (1 to 500 characters), the
reason (1 to 1,000 characters) and the grant day; no reviewed branch, head,
scope or limitations are recorded (`exemptionReason` and `grantExemption` in
`backend/vetting/handler.ts`). An older pin or an unproven source-to-binary match does not block
it. A restriction, a malicious latest result, missing installation,
unavailable or denied authority, a changed revision, a missing confirmation,
an enforcement record written since the administrator's preview
(`stale_revision`) or a second active grant refuses it. Grants and
revocations are separate append-only lists; earlier assessments stay.

```quint
type Access = AccessVerified | AccessDenied | AccessUnavailable | InstallationMissing | InstallationSuspended
type StewardCheck = { actor: int, repository: int, access: Access }
type GrantRequest = { id: int, repository: int, revision: int, manifestDigest: int, steward: int,
  check: StewardCheck, decision: int, reason: int, confirmed: bool }
pure def canGrantExemption(e: Enforcement, by: int, fence: Fence, request: GrantRequest): bool =
  e.administrators.contains(by) and by != e.steward and by != e.creator and e.revision > 0 and fenced(e, fence) and e.restriction == Clear and
  e.repositories.includes(request.repository) and request.id > 0 and not(e.grants.some(g => g.id == request.id)) and
  not(e.exempt.contains(request.repository)) and request.revision == e.revision and request.steward == e.steward and
  (request.check.actor == e.steward or request.check.actor == e.creator) and request.check.repository == request.repository and
  request.check.access == AccessVerified and e.repositories.every(r => latestOf(e, r).state != AMalicious) and
  request.confirmed and request.manifestDigest > 0 and request.decision > 0 and request.reason > 0
pure def grantExemption(e: Enforcement, by: int, fence: Fence, request: GrantRequest): Enforcement =
  { ...e, seq: e.seq + 1, exempt: e.exempt.union(Set(request.repository)), activeGrant: e.activeGrant.put(request.repository, request.id),
    grants: e.grants.append({ id: request.id, repository: request.repository,
      identity: identityOf(e, request.repository), revision: request.revision, manifestDigest: request.manifestDigest,
      steward: request.steward, approver: by, at: e.clockDay, decision: request.decision, reason: request.reason }) }
pure val verifiedCheck: StewardCheck = { actor: 1, repository: 1, access: AccessVerified }
pure val goodGrant: GrantRequest = { id: 11, repository: 1, revision: 1, manifestDigest: 1, steward: 1,
  check: verifiedCheck, decision: 1, reason: 1, confirmed: true }
pure val lostAuthorityGrant: GrantRequest = { ...goodGrant, check: { ...verifiedCheck, access: AccessDenied } }
pure val requestValues = Set(goodGrant, { ...goodGrant, id: 12 },
  lostAuthorityGrant, { ...goodGrant, check: { ...verifiedCheck, access: InstallationMissing } },
  { ...goodGrant, check: { ...verifiedCheck, access: AccessUnavailable } },
  { ...goodGrant, check: { ...verifiedCheck, actor: 3 } }, { ...goodGrant, revision: 2 }, { ...goodGrant, decision: 0 },
  { ...goodGrant, reason: 0 }, { ...goodGrant, confirmed: false })
pure def alwaysExemptionGranted(e: Enforcement): bool =
  e.exempt.forall(r => e.repositories.includes(r) and grantOf(e, r).id > 0 and grantOf(e, r).repository == r and
    grantOf(e, r).steward > 0)
pure def alwaysGrantsAudited(e: Enforcement): bool =
  e.grants.every(g => g.id > 0 and e.repositories.includes(g.repository) and e.administrators.contains(g.approver) and g.manifestDigest > 0 and g.decision > 0 and
    g.reason > 0 and g.at <= e.clockDay and
    g.identity <= identityOf(e, g.repository))
```

### Revocation is its own audited record and restores ordinary admission

An administrator revokes an active grant with a new confirmation, reason and
decision reference (`POST /api/v1/admin/vetting/exemptions/:id/revoke`). The
grant stays in its list; the revocation is appended to its own, and the
repository needs ordinary admission again. A revoked grant never covers
again; a later exemption is a new grant.

```quint
type RevokeRequest = { grant: int, decision: int, reason: int, confirmed: bool }
pure def canRevokeExemption(e: Enforcement, by: int, revoke: RevokeRequest): bool =
  val g = grantById(e, revoke.grant)
  e.administrators.contains(by) and revoke.confirmed and revoke.decision > 0 and revoke.reason > 0 and
  g.id > 0 and e.exempt.contains(g.repository) and activeGrantOf(e, g.repository) == g.id
pure def revokeExemption(e: Enforcement, by: int, revoke: RevokeRequest): Enforcement =
  { ...e, seq: e.seq + 1, exempt: e.exempt.exclude(Set(grantById(e, revoke.grant).repository)),
    revocations: e.revocations.append({ grant: revoke.grant, administrator: by, decision: revoke.decision,
      reason: revoke.reason, at: e.clockDay }) }
pure val revokeValues = Set({ grant: 11, decision: 1, reason: 1, confirmed: true }, { grant: 12, decision: 1, reason: 1, confirmed: true },
  { grant: 11, decision: 1, reason: 1, confirmed: false })
pure def alwaysRevocationsAudited(e: Enforcement): bool =
  e.revocations.every(v => grantById(e, v.grant).id > 0 and e.administrators.contains(v.administrator) and v.decision > 0 and
    v.reason > 0 and v.at <= e.clockDay and
    not(e.exempt.contains(grantById(e, v.grant).repository) and activeGrantOf(e, grantById(e, v.grant).repository) == v.grant))
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
notified. It appends no registry revision. One flag remains private: until a
second distinct reporter's flag pauses the project, filing writes no journal
entry and no notice. A flag on an already restricted project is recorded
without another pause. Withdrawal stops a flag counting and keeps its
history.

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
pure def canAdvanceDay(e: Enforcement, by: int, day: int): bool = by == platform and day >= e.clockDay
pure def advanceDay(e: Enforcement, by: int, day: int): Enforcement = { ...e, clockDay: day }
pure val dayValues = Set(0, 89, 90)
pure val receiptValues = Set(1, 2, 3)
pure def alwaysFlagTimes(e: Enforcement): bool = e.flags.every(f => f.filedDay <= e.clockDay and f.receipt > 0 and f.actor > 0)
pure def alwaysFlagPause(e: Enforcement): bool = twoActiveFlaggers(e) implies e.restriction != Clear
pure def alwaysActiveActorsUnique(e: Enforcement): bool =
  e.flags.every(first => e.flags.every(second =>
    (activeFlag(e, first) and activeFlag(e, second) and first.actor == second.actor) implies first.receipt == second.receipt))
pure def alwaysResolvedFlagsExist(e: Enforcement): bool = e.resolved.every(receipt => e.flags.some(f => f.receipt == receipt))
pure def lawOneFlagStaysPrivate(e: Enforcement, by: int, receipt: int, standing: FlagStanding): bool =
  (canFlag(e, by, receipt, standing) and not(twoActiveFlaggers(flag(e, by, receipt, standing)))) implies
    (flag(e, by, receipt, standing).journal == e.journal and flag(e, by, receipt, standing).notices == e.notices)
```

### Flag evidence text is readable only by its reporter and administrators, and the public sees only the restriction

A flag's category, evidence text (20 to 4,000 characters, migration `0060`)
and evidence URL are private. The signed-in member's flag route
(`GET /api/v1/project-flags/<project>`, `backend/vetting/flags.ts`) returns
only that member's own active flag with its evidence, and never another
member's flag, its reporter or the number of flags. Administrators read the
active flags beside each project in the administrator vetting view. Everyone
else, the steward and moderators who are not administrators included, sees
only the project's restriction and whether flags alone placed it.

```quint
type FlagView = FlagWithEvidence | FlagHidden
pure def flagView(e: Enforcement, viewer: int, receipt: int): FlagView =
  if (viewer > 0 and (e.administrators.contains(viewer) or e.flags.some(f => f.receipt == receipt and f.actor == viewer)))
    FlagWithEvidence
  else FlagHidden
pure def pausedByFlagsOnly(e: Enforcement): bool = e.restriction == FlagQuarantine
pure def lawFlagEvidenceOnlyToReporterOrAdministrator(e: Enforcement, viewer: int, receipt: int): bool =
  (not(e.administrators.contains(viewer)) and not(e.flags.some(f => f.receipt == receipt and f.actor == viewer)))
    implies flagView(e, viewer, receipt) == FlagHidden
pure def lawStewardSeesNoFlagEvidence(e: Enforcement, receipt: int): bool =
  (e.steward > 0 and not(e.administrators.contains(e.steward)) and e.flags.every(f => f.actor != e.steward))
    implies flagView(e, e.steward, receipt) == FlagHidden
```

### A fresh clean scan of every repository lifts a flag-only pause

The signed vetting service reinstates a pause that flags alone placed when
the deciding assessment of every listed repository is clean, non-reused,
requested at or after the pause, covers every active flag and has verified
retained evidence, and the resolved flags leave fewer than two distinct
active reporters (`planFlagReinstatement` in `backend/vetting/persistence.ts`,
commit 519bfa983).

The deciding assessment of a repository is the newest completed one of its
current identity bound to its live pin: the live integration-branch head and
skill template, with the current vetted content (`latestAtPin`). Newest means
the latest request, which the recorded history keeps in request order
(development: `requested_at`, then `rowid`): a repository has at most one
pending assessment and only that one is recorded. A pending assessment never
decides, so a running investigation does not block a clean scan; a completed
one at another commit, template or content does not supersede it; a newer
incomplete one at the same pin blocks it until a still later clean scan at
that pin. Each pin read names one assessment of one repository and says
whether the live pin matches the pin and content that assessment was bound
to. Development selects over every stored row, so the reads must be complete
and consistent: a read for every completed assessment of each repository's
current identity, and never two reads of one assessment that disagree. A
repository whose live pin could not be read decides nothing, which defers
only the reinstatement.

The reinstatement record names the deciding assessment of every listed
repository (`system_issuer.assessmentIds`, the scanned one first), and
storage evaluates the same selection again in the insertion transaction
(migration `0131`), so an assessment completed between the plan and the insert
refuses it. A record written without that list passes only for a
single-repository project, from its `assessmentId`, and an assessment row
without a repository id resolves it from the first repository of its own
revision. It appends no registry revision.

```quint
type PinState = PinMatches | PinChanged | PinUnavailable
type PinRead = { repository: int, assessment: int, pin: PinState }
pure def pinUnavailable(pins: List[PinRead], repository: int): bool =
  pins.some(p => p.repository == repository and p.pin == PinUnavailable)
pure def atLivePin(pins: List[PinRead], repository: int, assessment: int): bool =
  pins.some(p => p.repository == repository and p.assessment == assessment and p.pin == PinMatches)
pure def pinsComplete(e: Enforcement, pins: List[PinRead]): bool =
  e.repositories.every(r => pinUnavailable(pins, r) or
    e.recorded.every(a => (a.repository == r and a.identity == identityOf(e, r)) implies
      pins.some(p => p.repository == r and p.assessment == a.id))) and
  pins.every(p => pins.every(q => (q.repository == p.repository and q.assessment == p.assessment) implies q.pin == p.pin))
pure def completedAtPin(e: Enforcement, repository: int, pins: List[PinRead]): List[Assessment] =
  if (pinUnavailable(pins, repository)) List()
  else e.recorded.select(a => a.repository == repository and a.identity == identityOf(e, repository) and atLivePin(pins, repository, a.id))
pure def decidingAt(e: Enforcement, repository: int, pins: List[PinRead]): Assessment =
  val candidates = completedAtPin(e, repository, pins)
  candidates.nthOr(candidates.length() - 1, unassessed)
pure def freshAtPin(e: Enforcement, repository: int, pins: List[PinRead]): bool =
  val a = decidingAt(e, repository, pins)
  a.state == AClean and not(a.reused) and a.requestEpoch == e.epoch and not(e.unverified.contains(a.id))
pure def allFreshAtPin(e: Enforcement, pins: List[PinRead]): bool = e.repositories.every(r => freshAtPin(e, r, pins))
pure def coversActiveFlagsAt(e: Enforcement, repository: int, pins: List[PinRead]): bool =
  e.flags.every(f => activeFlag(e, f) implies decidingAt(e, repository, pins).snapshot.includes(f.receipt))
pure def provenance(e: Enforcement, pins: List[PinRead]): List[int] = e.repositories.listMap(r => decidingAt(e, r, pins).id)
pure val noEntry: JournalEntry = { seq: 0, kind: RecordDeny, issuer: ByModerator, actor: 0, result: RevisionNotNeeded, assessments: List(),
  accounts: List() }
pure def provenanceOf(e: Enforcement): List[int] = e.journal.nthOr(e.journal.length() - 1, noEntry).assessments
pure def allFresh(e: Enforcement): bool = e.repositories.every(r => freshClean(e, r))
pure def canReinstateFlagPause(e: Enforcement, by: int, pins: List[PinRead]): bool =
  by == vettingService and e.restriction == FlagQuarantine and pinsComplete(e, pins) and allFreshAtPin(e, pins) and
  e.repositories.every(r => coversActiveFlagsAt(e, r, pins)) and not(twoActiveFlaggers(e))
pure def reinstateFlagPause(e: Enforcement, by: int, pins: List[PinRead]): Enforcement =
  { ...e, restriction: Clear, restrictedBy: Set(), appeal: if (e.appeal == AppealRequested) AppealGranted else NoAppeal,
    appellants: Set(), journal: e.journal.append({ seq: e.journal.length() + 1, kind: RecordReinstate, issuer: ByVettingService,
      actor: 0, result: RevisionNotNeeded, assessments: provenance(e, pins), accounts: List() }), notices: owners(e) }
pure def stepScanReinstatementNamesEveryRepository(before: Enforcement, via: str, after: Enforcement): bool =
  via == "reinstateFlagPause" implies
    (provenanceOf(after).length() == before.repositories.length() and
     before.repositories.every(r => provenanceOf(after).some(id =>
       before.recorded.some(a => a.id == id and a.repository == r and a.state == AClean))))
pure val pinsValues = tuples(0.to(2), 0.to(2), 0.to(2))
  .map(x => List({ repository: x._1, assessment: 1, pin: PinMatches }, { repository: x._2, assessment: 2, pin: PinMatches },
    { repository: x._3, assessment: 3, pin: PinMatches }).select(p => p.repository > 0))
  .union(tuples(1.to(3), 1.to(3)).filter(x => x._1 != x._2)
    .map(x => List({ repository: 1, assessment: x._1, pin: PinMatches }, { repository: 1, assessment: x._2, pin: PinChanged })))
  .union(Set(List({ repository: 1, assessment: 1, pin: PinUnavailable }), List({ repository: 1, assessment: 1, pin: PinChanged })))
```

## Story: Moderators restrict, decide malice and decide appeals independently

### A moderator quarantines a clear project or bans it, and decides a service ban

A moderator quarantines only a clear project. A moderator ban applies to a
clear, flag-paused or quarantined project. A vetting-service Ban waits for a
moderator decision: ban the project and the responsible accounts the
moderator selects from the evidence, or reinstate it through the appeal path.
Every moderator decision confirms the revision and the next enforcement
sequence its preview showed (`expectedRevision`, `expectedSequence`); a record
written in between refuses it (`stale_revision`).
Current stewardship and the original application never select accounts. A
decision that closes an open project appeal needs a moderator who neither
placed the restriction nor filed the appeal. Account bans are recorded for
[participation restrictions](../backend/access.md); project reinstatement never lifts
them. The decision names the accounts it bans, re-banning an account closes
that account's open appeal, and each account it re-bans with an open appeal
needs a moderator who is not that account and did not ban it
(`reBanned` and `accountModeratorIndependent` in
`backend/projects/verified-enforcement.ts`).

```quint
pure def independent(e: Enforcement, by: int): bool =
  e.moderators.contains(by) and not(e.restrictedBy.contains(by)) and not(e.appellants.contains(by))
pure def canQuarantine(e: Enforcement, by: int, fence: Fence, plan: RevisionPlan): bool =
  e.moderators.contains(by) and fenced(e, fence) and e.restriction == Clear
pure def quarantine(e: Enforcement, by: int, fence: Fence, plan: RevisionPlan): Enforcement =
  { ...e, restriction: ModeratorQuarantine, epoch: e.epoch + 1, restrictedBy: Set(by), appeal: NoAppeal, appellants: Set(),
    revisionPending: plan == RevisionPending, journal: restrictionEntry(e, ByModerator, by, RecordQuarantine, plan), notices: owners(e) }
pure def canBan(e: Enforcement, by: int, fence: Fence, plan: RevisionPlan): bool =
  e.moderators.contains(by) and fenced(e, fence) and (e.restriction == Clear or e.restriction == FlagQuarantine or e.restriction == ModeratorQuarantine)
pure def ban(e: Enforcement, by: int, fence: Fence, plan: RevisionPlan): Enforcement =
  { ...e, restriction: ModeratorBan, epoch: e.epoch + 1,
    restrictedBy: if (e.restriction == Clear) Set(by) else e.restrictedBy.union(Set(by)),
    appeal: if (e.restriction == Clear) NoAppeal else e.appeal, appellants: if (e.restriction == Clear) Set() else e.appellants,
    revisionPending: e.revisionPending or plan == RevisionPending,
    journal: restrictionEntry(e, ByModerator, by, RecordBan, plan), notices: owners(e) }
pure def canDecideMalice(e: Enforcement, by: int, fence: Fence, accounts: List[int]): bool =
  e.moderators.contains(by) and fenced(e, fence) and e.restriction == ServiceBan and accounts.every(a => a > 0) and
  (e.appeal == AppealRequested implies independent(e, by)) and
  accountsIndependent(e, by, accounts.select(a => accountAppealOpenFor(e, a)))
pure def decideMalice(e: Enforcement, by: int, fence: Fence, accounts: List[int]): Enforcement =
  { ...e, restriction: ModeratorBan, restrictedBy: e.restrictedBy.union(Set(by)),
    appeal: if (e.appeal == AppealRequested) AppealDenied else e.appeal,
    accountBans: e.accountBans.concat(accounts), liveBans: e.liveBans.concat(accounts.listMap(a => { account: a, moderator: by })),
    journal: accountsEntry(e, RecordBan, ByModerator, by, accounts), notices: owners(e) }
pure val accountsValues = Set(List(), List(1), List(2), List(0))
pure def canSettlePendingRevision(e: Enforcement, by: int): bool = e.administrators.contains(by) and e.revisionPending
pure def settlePendingRevision(e: Enforcement, by: int): Enforcement = { ...e, revisionPending: false }
pure def withRevisionLanded(landed: bool, e: Enforcement): Enforcement =
  if (landed and e.restriction != Clear) { ...e, revisionPending: false } else e
```

### The steward, the listing account or a moderator files one open project appeal

The steward, the listing account or a moderator may file the project appeal
(`requestReinstatement`). Filing records the request and notifies the
moderators who did not place the restriction. It neither lifts the
restriction nor grants project access. Any other account this project's
decision banned files with the `banned-account` role, in any project state,
so its request is its own account appeal (below), never the project appeal
(`requestReinstatement` in `backend/projects/handler.ts`;
`selectProjectAppeals` leaves `banned-account` rows out). A banned steward or
listing account files an account appeal too while the project is clear or a
project appeal is open, or whenever it asks for the account scope.

```quint
pure def canRequestAppeal(e: Enforcement, by: int): bool =
  by > 0 and e.revision > 0 and e.restriction != Clear and e.appeal != AppealRequested and
  (by == e.steward or by == e.creator or e.moderators.contains(by))
pure def requestAppeal(e: Enforcement, by: int): Enforcement =
  { ...e, appeal: AppealRequested, appellants: e.appellants.union(Set(by)),
    journal: entry(e, RecordAppeal, ByAppellant, by),
    notices: owners(e).append({ entry: e.journal.length() + 1, to: IndependentModerators }) }
pure def canDenyAppeal(e: Enforcement, by: int, fence: Fence): bool =
  fenced(e, fence) and e.appeal == AppealRequested and e.restriction != Clear and e.restriction != ServiceBan and independent(e, by)
pure def denyAppeal(e: Enforcement, by: int, fence: Fence): Enforcement =
  { ...e, appeal: AppealDenied, journal: entry(e, RecordDeny, ByModerator, by), notices: owners(e) }
```

### Account entries share the project journal without changing its restriction

The access machine's account decisions are rows of the same
`project_enforcements` sequence (`ENFORCEMENT_ACTIONS` in
`backend/projects/enforcement.ts`, migration `0072`): a banned account's own
appeal (`request_reinstatement` with the `banned-account` role), a
moderator's denial of the open account appeals, and a moderator's
reinstatement of selected accounts (`reinstate_accounts`). Each takes the
next sequence number of the project journal, so a moderator's preview of the
project goes stale, and changes no restriction, project appeal, flag,
clearance or recorded account ban (`foldEnforcementStatus`). A moderator
decision confirms the sequence its preview showed. The appeal notifies the
listing account, the steward and the moderators; the denial notifies the
listing account and the steward; an account reinstatement notifies neither
(`notifyProjectEnforcement` in `backend/notifications/events.ts`).

Each account's appeal is its own (`openAccountAppealSource` and
`findAccountBoundary` in `backend/projects/verified-enforcement.ts`). An
account with an active ban from this project, one no reinstatement has
released since it was banned, may file its appeal in any project state,
unless its own appeal is already open (409 `appeal_open`); a released
account may not (403 `forbidden`). The appeal stays open until a
reinstatement or a ban names that account, or a denial closes it. A
moderator denies the open account appeals only in a restricted project with
no open project appeal and no confirmed-malice decision waiting: a denial in
a clear project has nothing to decide (409 `no_open_appeal`), a denial
beside an open project appeal is the project denial and leaves account
appeals open, and a vetting-service ban needs its malice decision first (409
`malicious_decision_required`). A moderator reinstates one or more selected
accounts, each with an active ban (409 `account_not_banned`), while a
project appeal is open or, without one, while each selected account's own
appeal is open (409 `no_open_appeal`); the reinstatement releases every
active ban of those accounts and leaves the project appeal for its own
decision. A denial or reinstatement needs a moderator who is none of the
accounts it decides and banned none of them (403
`independent_review_required`). Slopbot's triage of the appeal and the bans
of other projects are the rules of
[participation restrictions](../backend/access.md).

```quint
pure def activeAccountBan(e: Enforcement, account: int): bool = e.liveBans.some(b => b.account == account)
pure def accountAppealOpenFor(e: Enforcement, account: int): bool = e.journal.foldl(false, (open, j) =>
  if (j.kind == RecordAccountAppeal and j.actor == account) true
  else if (j.kind == RecordAccountDenial or
    ((j.kind == RecordAccountReinstatement or j.kind == RecordBan) and j.accounts.includes(account))) false
  else open)
pure def openAccountAppeals(e: Enforcement): List[int] =
  e.liveBans.select(b => accountAppealOpenFor(e, b.account)).listMap(b => b.account)
pure def accountsIndependent(e: Enforcement, by: int, accounts: List[int]): bool =
  not(accounts.includes(by)) and not(e.liveBans.some(b => accounts.includes(b.account) and b.moderator == by))
pure def canJournalAccountAppeal(e: Enforcement, by: int): bool =
  by > 0 and e.revision > 0 and activeAccountBan(e, by) and not(accountAppealOpenFor(e, by))
pure def journalAccountAppeal(e: Enforcement, by: int): Enforcement =
  { ...e, journal: entry(e, RecordAccountAppeal, ByAppellant, by),
    notices: owners(e).append({ entry: e.journal.length() + 1, to: IndependentModerators }) }
pure def canJournalAccountDenial(e: Enforcement, by: int, fence: Fence): bool =
  fenced(e, fence) and e.moderators.contains(by) and e.restriction != Clear and e.restriction != ServiceBan and
  e.appeal != AppealRequested and openAccountAppeals(e).length() > 0 and accountsIndependent(e, by, openAccountAppeals(e))
pure def journalAccountDenial(e: Enforcement, by: int, fence: Fence): Enforcement =
  { ...e, journal: entry(e, RecordAccountDenial, ByModerator, by), notices: owners(e) }
pure def canJournalAccountReinstatement(e: Enforcement, by: int, fence: Fence, accounts: List[int]): bool =
  fenced(e, fence) and e.moderators.contains(by) and accounts.length() > 0 and accounts.every(a => activeAccountBan(e, a)) and
  ((e.restriction != Clear and e.appeal == AppealRequested) or accounts.every(a => accountAppealOpenFor(e, a))) and
  accountsIndependent(e, by, accounts)
pure def journalAccountReinstatement(e: Enforcement, by: int, fence: Fence, accounts: List[int]): Enforcement =
  { ...e, liveBans: e.liveBans.select(b => not(accounts.includes(b.account))),
    journal: accountsEntry(e, RecordAccountReinstatement, ByModerator, by, accounts) }
pure def alwaysLiveBansRecorded(e: Enforcement): bool =
  e.liveBans.every(b => e.accountBans.includes(b.account) and e.moderators.contains(b.moderator))
pure def stepAccountEntriesKeepRestriction(before: Enforcement, via: str, after: Enforcement): bool =
  (via == "journalAccountAppeal" or via == "journalAccountDenial" or via == "journalAccountReinstatement") implies
    (after.restriction == before.restriction and after.appeal == before.appeal
    and after.epoch == before.epoch and after.revisionPending == before.revisionPending and after.flags == before.flags
    and after.accountBans == before.accountBans and after.resolved == before.resolved and after.recorded == before.recorded
    and after.liveBans.every(b => before.liveBans.includes(b))
    and (via != "journalAccountReinstatement" implies after.liveBans == before.liveBans)
    and after.journal.length() == before.journal.length() + 1)
pure def sometimesAccountReinstatementJournaled(e: Enforcement): bool =
  e.journal.some(j => j.kind == RecordAccountReinstatement) and e.journal.some(j => j.kind == RecordAccountAppeal)
pure def sometimesReleasedAccountCannotAppeal(e: Enforcement): bool =
  e.accountBans.includes(2) and not(activeAccountBan(e, 2)) and e.revision > 0 and not(canJournalAccountAppeal(e, 2))
```

### An independent moderator reinstates only after fresh clean scans of every repository

Reinstatement needs an open project appeal, a moderator independent of the
restriction and the appeal, the landed paused and retired revision, and for
every repository a clean, non-reused, evidence-verified deciding assessment
requested after the latest restriction: as for a flag-only pause, the newest
completed one at its live pin and current content, read from complete and
consistent pin reads, so a pending
investigation does not block it and one at another pin does not supersede it
(`repositoryClearance` with `forReinstatement`). The platform reads the live
pins; a moderator's request carries none. It records the
malicious findings it reviewed; a later finding is a new Ban. It resolves the
flags it found. The registry restores a paused Community listing only if the
project was listed when the restriction began.

```quint
pure def canObservePins(e: Enforcement, by: int, pins: List[PinRead]): bool =
  by == platform and pins.every(p => e.repositories.includes(p.repository))
pure def observePins(e: Enforcement, by: int, pins: List[PinRead]): Enforcement = { ...e, pinReads: pins }
pure def canReinstate(e: Enforcement, by: int, fence: Fence): bool =
  fenced(e, fence) and e.appeal == AppealRequested and e.restriction != Clear and independent(e, by) and not(e.revisionPending) and
  pinsComplete(e, e.pinReads) and allFreshAtPin(e, e.pinReads)
pure def reinstate(e: Enforcement, by: int, fence: Fence): Enforcement =
  { ...e, restriction: Clear, restrictedBy: Set(), appeal: AppealGranted, appellants: Set(),
    reviewedFindings: e.findings, resolved: e.resolved.concat(activeReceipts(e)), pinReads: List(),
    journal: entry(e, RecordReinstate, ByModerator, by), notices: owners(e) }
pure val byValues = Set(-1, 0, 1, 2, 3, 5, 6, 7)
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
  e.journal.every(j => j.kind == RecordAccountReinstatement or
    (e.notices.includes(noticeTo(j.seq, ListingAccount)) and e.notices.includes(noticeTo(j.seq, StewardAccount))))
pure def alwaysJournalNumbered(e: Enforcement): bool =
  e.journal.every(j => j.seq > 0 and j.seq <= e.journal.length() and e.journal.every(k => k.seq == j.seq implies k == j))
pure def alwaysFlagReceiptsUnique(e: Enforcement): bool =
  e.flags.every(f => e.flags.every(g => g.receipt == f.receipt implies g == f))
pure def alwaysGrantIdsUnique(e: Enforcement): bool =
  e.grants.every(f => e.grants.every(g => g.id == f.id implies g == f))
pure def alwaysAccountBansDecided(e: Enforcement): bool = e.accountBans.every(a => a > 0)
```

### Journals only append and lifting a human restriction needs its decision

Each journal entry, flag, grant, revocation and recorded assessment has a
unique key (sequence, receipt, grant id, assessment id), so keeping every
earlier element with a list no shorter means no earlier record is rewritten. The vetting service lifts only a flag-only pause. A clean scan never lifts a
moderator or service restriction. A recorded assessment is never upgraded.

```quint
pure def keeps(before: List[int], after: List[int]): bool =
  after.length() >= before.length() and before.every(x => after.includes(x))
pure def stepJournalsOnlyAppend(before: Enforcement, after: Enforcement): bool =
  after.journal.length() >= before.journal.length() and before.journal.every(j => after.journal.includes(j)) and
  after.notices.length() >= before.notices.length() and before.notices.every(n => after.notices.includes(n)) and
  after.flags.length() >= before.flags.length() and before.flags.every(f => after.flags.includes(f)) and
  after.grants.length() >= before.grants.length() and before.grants.every(g => after.grants.includes(g)) and
  after.revocations.length() >= before.revocations.length() and before.revocations.every(v => after.revocations.includes(v)) and
  after.recorded.length() >= before.recorded.length() and before.recorded.every(a => after.recorded.includes(a)) and
  keeps(before.accountBans, after.accountBans) and keeps(before.resolved, after.resolved)
pure def stepCountersMonotone(before: Enforcement, after: Enforcement): bool =
  after.epoch >= before.epoch and after.seq >= before.seq and after.clockDay >= before.clockDay and
  before.withdrawn.subseteq(after.withdrawn) and before.findings.subseteq(after.findings) and
  before.assessmentIds.subseteq(after.assessmentIds) and before.frozen.subseteq(after.frozen) and
  after.administrators.subseteq(before.administrators) and before.administrators.subseteq(after.administrators) and
  after.moderators.subseteq(before.moderators) and before.moderators.subseteq(after.moderators) and
  after.original.subseteq(before.original) and before.original.subseteq(after.original) and
  (before.creator > 0 implies after.creator == before.creator) and after.projectId == before.projectId and after.revision >= before.revision and
  before.repositories.every(r => identityOf(after, r) >= identityOf(before, r))
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
pure def sometimesExemptWithoutScan(e: Enforcement): bool =
  cleared(e) and e.exempt.size() > 0 and latestOf(e, 1).state == NotAssessed and basisLabel(basis(e, 1)) == "Owner-approved exemption"
pure def sometimesRequeueAfterGrantStaysCovered(e: Enforcement): bool =
  latestOf(e, 1).requeued and latestOf(e, 1).requestedAt >= grantOf(e, 1).at and grantCovers(e, 1)
pure def sometimesGrantRefusedAfterAuthorityLoss(e: Enforcement): bool =
  e.revision == 1 and e.steward == 1 and canGrantExemption(e, 7, { revision: 1, sequence: e.journal.length() + 1 }, goodGrant) and
  not(canGrantExemption(e, 7, { revision: 1, sequence: e.journal.length() + 1 }, lostAuthorityGrant))
pure def sometimesInvestigationOverridesGrant(e: Enforcement): bool =
  e.exempt.contains(1) and latestOf(e, 1).state == APending and not(cleared(e))
pure def sometimesSameDayRequestControls(e: Enforcement): bool =
  e.exempt.contains(1) and latestOf(e, 1).state == APending and latestOf(e, 1).requestedAt == grantOf(e, 1).at and not(grantCovers(e, 1))
pure def sometimesRequeuedStaysCovered(e: Enforcement): bool =
  latestOf(e, 1).requeued and latestOf(e, 1).state == APending and grantCovers(e, 1)
pure def sometimesGrantKeepsEarlierAssessment(e: Enforcement): bool =
  grantCovers(e, 1) and e.recorded.some(a => a.repository == 1 and a.state == AIncomplete)
pure def sometimesRevokedGrant(e: Enforcement): bool =
  e.revocations.length() > 0 and not(cleared(e)) and clearanceState(e, 1) == Unscanned
pure def sometimesNewIdentityUncleared(e: Enforcement): bool =
  identityOf(e, 1) == 2 and latestOf(e, 1).state == AClean and clearanceState(e, 1) == Unscanned
pure def sometimesFrozenDespiteInvestigation(e: Enforcement): bool = e.frozen.contains(1) and latestOf(e, 1).state == APending and cleared(e)
pure def sometimesUnverifiedEvidence(e: Enforcement): bool = clearanceState(e, 1) == Unverified
pure def sometimesStaleDuringRestriction(e: Enforcement): bool = clearanceState(e, 1) == Stale
pure def sometimesQuarantinedByIncomplete(e: Enforcement): bool = e.restriction == Clear and clearanceState(e, 1) == Quarantined
pure def sometimesSingleFlagResolved(e: Enforcement): bool = e.resolved.length() > 0 and e.restriction == Clear and e.journal.length() == 0
pure def sometimesRevisionPending(e: Enforcement): bool = e.revisionPending
pure def sometimesCleared(e: Enforcement): bool = mayContribute(e) and latestOf(e, 1).state == AClean
pure def sometimesBannedAccountAppealed(e: Enforcement): bool =
  e.restriction != Clear and e.appeal != AppealRequested and
  e.accountBans.some(a => accountAppealOpenFor(e, a) and a != e.steward and a != e.creator)
pure def sometimesFlagPauseLiftedPastPendingInvestigation(e: Enforcement): bool =
  latestOf(e, 1).state == APending and
  e.journal.some(j => j.kind == RecordReinstate and j.issuer == ByVettingService and j.assessments.length() > 0 and
    j.assessments.every(id => id != latestOf(e, 1).id))
pure def sometimesFlagPauseLiftedPastOtherPin(e: Enforcement): bool =
  e.restriction == Clear and latestOf(e, 1).state == AIncomplete and
  e.journal.some(j => j.kind == RecordReinstate and j.issuer == ByVettingService and j.assessments.length() > 0 and
    j.assessments.every(id => id != latestOf(e, 1).id))
pure def sometimesFlagPauseLiftablePastPendingInvestigation(e: Enforcement): bool =
  e.restriction == FlagQuarantine and latestOf(e, 1).state == APending and
  canReinstateFlagPause(e, vettingService, List({ repository: 1, assessment: 1, pin: PinMatches }))
pure def sometimesFlagPauseLiftableAtOtherPin(e: Enforcement): bool =
  e.restriction == FlagQuarantine and latestOf(e, 1).state == AIncomplete and
  canReinstateFlagPause(e, vettingService, List({ repository: 1, assessment: 2, pin: PinMatches }, { repository: 1, assessment: 1, pin: PinChanged }))
pure def sometimesEarlierAssessmentUnverified(e: Enforcement): bool =
  e.recorded.some(a => e.unverified.contains(a.id) and a.id != latestOf(e, a.repository).id)
pure def readyToLiftFlagPause(e: Enforcement): bool =
  e.restriction == FlagQuarantine and allFresh(e) and e.repositories.every(r => coversActiveFlags(e, r)) and not(twoActiveFlaggers(e))
pure def leadsToFlagPauseLifted(e: Enforcement, later: Enforcement): bool =
  readyToLiftFlagPause(e) implies (later.restriction != FlagQuarantine or not(readyToLiftFlagPause(later)))
pure val fair_reinstateFlagPause = "weak"
pure val weight_requestAssessment = 4
pure val weight_recordResult = 4
pure val weight_flag = 4
pure val weight_requestAppeal = 2
pure val weight_reinstate = 3
pure val weight_reinstateFlagPause = 3
pure val weight_grantExemption = 3
pure val eValues = Set(initial)
pure val eval_witness_sometimesReinstatedAfterMalice = (
  ("observeRevision", platform, 1, 1, 1),
  ("requestAssessment", 1, 1, SetupCheck, 1),
  ("recordResult", vettingService, { assessment: 1, repository: 1, revision: 1, disposition: A::DMalicious, confirmation: A::ReproducibleBehavior, reused: false, retained: true }, RevisionAppended),
  ("requestAppeal", 1),
  ("requestAssessment", 5, 1, AdminInvestigation, 2),
  ("recordResult", vettingService, { assessment: 2, repository: 1, revision: 1, disposition: A::DClean, confirmation: A::NoConfirmation, reused: false, retained: true }, RevisionNotNeeded),
  ("observePins", platform, List({ repository: 1, assessment: 1, pin: PinMatches }, { repository: 1, assessment: 2, pin: PinMatches })),
  ("reinstate", 5, { revision: 1, sequence: 3 }))
pure val eval_witness_sometimesBannedAccountAppealed = (
  ("observeRevision", platform, 1, 1, 1),
  ("requestAssessment", 1, 1, SetupCheck, 1),
  ("recordResult", vettingService, { assessment: 1, repository: 1, revision: 1, disposition: A::DMalicious, confirmation: A::ReproducibleBehavior, reused: false, retained: true }, RevisionAppended),
  ("decideMalice", 5, { revision: 1, sequence: 2 }, List(2)),
  ("journalAccountAppeal", 2))
pure val eval_witness_sometimesAccountReinstatementJournaled = (
  ("observeRevision", platform, 1, 1, 1),
  ("requestAssessment", 1, 1, SetupCheck, 1),
  ("recordResult", vettingService, { assessment: 1, repository: 1, revision: 1, disposition: A::DMalicious, confirmation: A::ReproducibleBehavior, reused: false, retained: true }, RevisionAppended),
  ("decideMalice", 5, { revision: 1, sequence: 2 }, List(2)),
  ("journalAccountAppeal", 2),
  ("journalAccountDenial", 6, { revision: 1, sequence: 4 }),
  ("journalAccountAppeal", 2),
  ("journalAccountReinstatement", 6, { revision: 1, sequence: 6 }, List(2)))
pure val eval_witness_sometimesReleasedAccountCannotAppeal = (
  ("observeRevision", platform, 1, 1, 1),
  ("requestAssessment", 1, 1, SetupCheck, 1),
  ("recordResult", vettingService, { assessment: 1, repository: 1, revision: 1, disposition: A::DMalicious, confirmation: A::ReproducibleBehavior, reused: false, retained: true }, RevisionAppended),
  ("decideMalice", 5, { revision: 1, sequence: 2 }, List(2)),
  ("journalAccountAppeal", 2),
  ("journalAccountReinstatement", 6, { revision: 1, sequence: 4 }, List(2)))
pure val eval_witness_sometimesFlagPauseLifted = (
  ("observeRevision", platform, 1, 1, 1),
  ("flag", 2, 1, goodStanding),
  ("flag", 3, 2, { ...goodStanding, actor: 3 }),
  ("requestAssessment", vettingService, 1, FlagRecovery, 1),
  ("recordResult", vettingService, { assessment: 1, repository: 1, revision: 1, disposition: A::DClean, confirmation: A::NoConfirmation, reused: false, retained: true }, RevisionNotNeeded),
  ("reinstateFlagPause", vettingService, List({ repository: 1, assessment: 1, pin: PinMatches })))
pure val eval_witness_sometimesFlagPauseLiftablePastPendingInvestigation = (
  ("observeRevision", platform, 1, 1, 1),
  ("flag", 2, 1, goodStanding),
  ("flag", 3, 2, { ...goodStanding, actor: 3 }),
  ("requestAssessment", vettingService, 1, FlagRecovery, 1),
  ("recordResult", vettingService, { assessment: 1, repository: 1, revision: 1, disposition: A::DClean, confirmation: A::NoConfirmation, reused: false, retained: true }, RevisionNotNeeded),
  ("requestAssessment", 5, 1, AdminInvestigation, 2))
pure val eval_witness_sometimesFlagPauseLiftedPastPendingInvestigation = (
  ("observeRevision", platform, 1, 1, 1),
  ("flag", 2, 1, goodStanding),
  ("flag", 3, 2, { ...goodStanding, actor: 3 }),
  ("requestAssessment", vettingService, 1, FlagRecovery, 1),
  ("recordResult", vettingService, { assessment: 1, repository: 1, revision: 1, disposition: A::DClean, confirmation: A::NoConfirmation, reused: false, retained: true }, RevisionNotNeeded),
  ("requestAssessment", 5, 1, AdminInvestigation, 2),
  ("reinstateFlagPause", vettingService, List({ repository: 1, assessment: 1, pin: PinMatches })))
pure val eval_witness_sometimesFlagPauseLiftableAtOtherPin = (
  ("observeRevision", platform, 1, 1, 1),
  ("flag", 2, 1, goodStanding),
  ("flag", 3, 2, { ...goodStanding, actor: 3 }),
  ("requestAssessment", vettingService, 1, FlagRecovery, 2),
  ("recordResult", vettingService, { assessment: 2, repository: 1, revision: 1, disposition: A::DClean, confirmation: A::NoConfirmation, reused: false, retained: true }, RevisionNotNeeded),
  ("requestAssessment", 5, 1, AdminInvestigation, 1),
  ("recordResult", vettingService, { assessment: 1, repository: 1, revision: 1, disposition: A::DIncomplete, confirmation: A::NoConfirmation, reused: false, retained: false }, RevisionNotNeeded))
pure val eval_witness_sometimesFlagPauseLiftedPastOtherPin = (
  ("observeRevision", platform, 1, 1, 1),
  ("flag", 2, 1, goodStanding),
  ("flag", 3, 2, { ...goodStanding, actor: 3 }),
  ("requestAssessment", vettingService, 1, FlagRecovery, 2),
  ("recordResult", vettingService, { assessment: 2, repository: 1, revision: 1, disposition: A::DClean, confirmation: A::NoConfirmation, reused: false, retained: true }, RevisionNotNeeded),
  ("requestAssessment", 5, 1, AdminInvestigation, 1),
  ("recordResult", vettingService, { assessment: 1, repository: 1, revision: 1, disposition: A::DIncomplete, confirmation: A::NoConfirmation, reused: false, retained: false }, RevisionNotNeeded),
  ("reinstateFlagPause", vettingService, List({ repository: 1, assessment: 2, pin: PinMatches }, { repository: 1, assessment: 1, pin: PinChanged })))
pure val eval_witness_sometimesGrantKeepsEarlierAssessment = (
  ("observeRevision", platform, 1, 1, 1),
  ("requestAssessment", 1, 1, SetupCheck, 1),
  ("recordResult", vettingService, { assessment: 1, repository: 1, revision: 1, disposition: A::DIncomplete, confirmation: A::NoConfirmation, reused: false, retained: false }, RevisionNotNeeded),
  ("advanceDay", platform, 89),
  ("grantExemption", 5, { revision: 1, sequence: 1 }, goodGrant))
pure val eval_witness_sometimesRequeuedStaysCovered = (
  ("observeRevision", platform, 1, 1, 1),
  ("requestAssessment", 1, 1, SetupCheck, 1),
  ("advanceDay", platform, 89),
  ("grantExemption", 5, { revision: 1, sequence: 1 }, goodGrant),
  ("requeueTemplate", vettingService, 1, 2))
pure val eval_witness_sometimesRequeueAfterGrantStaysCovered = (
  ("observeRevision", platform, 1, 1, 1),
  ("requestAssessment", 1, 1, SetupCheck, 1),
  ("advanceDay", platform, 89),
  ("grantExemption", 5, { revision: 1, sequence: 1 }, goodGrant),
  ("requeueTemplate", vettingService, 1, 2))
pure val eval_witness_sometimesQuarantinedByIncomplete = (
  ("observeRevision", platform, 1, 1, 1),
  ("requestAssessment", 1, 1, SetupCheck, 1),
  ("recordResult", vettingService, { assessment: 1, repository: 1, revision: 1, disposition: A::DIncomplete, confirmation: A::NoConfirmation, reused: false, retained: false }, RevisionNotNeeded))
```
