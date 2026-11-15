# Registry and security composition

PRD sections 2, 4, 5, 7, 8 and 12. One registered project is two machines
written in one D1 batch: its [registry revisions](./backend/projects.md) and
its [security state](./security/enforcement.md). This machine holds both and
performs each user, administrator, moderator and service action on both at
once, so a restriction, an append or an activation can never land on one
side only (`backend/projects/cloudflare-persistence.ts` checks the current
revision, the enforcement generation and, for admission-gated activation, the
clearance generation inside the SQL write). It also derives what consumers
read: collection and skill publication, the Slopbot review scope, monthly
eligibility and the setup status.

Two inputs come from other areas and are typed evidence, never caller claims:
the account standing from [participation restrictions](./access.md) (the
`project-account-bans` list read for the acting account) and the registry-wide
repository read from the [registry](./backend/projectRegistry.md) (which
project, if any, lists the repository's permanent id, and whether a
restriction binds it). The manifest policy result is the deterministic
`assertProjectPolicyTransition` check of the stored manifest. The admission
outcome is the recorded state of the [assessment machine](./security/admission.md).

## Story: Perform every project action on registry and security together

### The composed state keeps the two machines' shared facts equal

Every composed action calls each child transition only under that child's own
guard, so the children's rules hold of the composed state. The child facts the
composed rules rely on are restated here so the composition proves them too.

```quint
import closureConsent as C from "./backend/closureConsent"
import projects as P from "./backend/projects"
import enforcement as E from "./security/enforcement"
import admission as A from "./security/admission"
type Registry = { project: P::Project, security: E::Enforcement }
pure val initial: Registry = { project: P::initial, security: E::initial }
pure def sync(p: P::Project, e: E::Enforcement): E::Enforcement =
  if (p.revision > e.revision and p.steward > 0 and p.creator > 0 and (e.creator == 0 or p.creator == e.creator))
    E::observeRevision(e, p.revision, p.steward, p.creator) else e
pure def alwaysRepositoriesAgree(c: Registry): bool = c.project.repositories == c.security.repositories
pure def alwaysRevisionMirrored(c: Registry): bool =
  c.security.revision == c.project.revision and c.security.steward == c.project.steward and c.security.creator == c.project.creator
pure def alwaysChildFactsHold(c: Registry): bool =
  P::alwaysCreatedFacts(c.project) and P::alwaysRetirementConsistent(c.project) and
  E::alwaysClearHoldsNoRestrictionState(c.security) and E::alwaysFlagPauseHasNoRevision(c.security) and
  E::alwaysRegisteredIdentities(c.security)
pure def alwaysAdministratorsAgree(c: Registry): bool =
  c.project.administrators.every(a => c.security.administrators.contains(a)) and
  c.security.administrators.forall(a => c.project.administrators.includes(a))
```

### Account bans and registry conflicts refuse new projects and owner writes

A banned maintainer cannot create a project, publish a stored application or
publish an owner revision, as the actor or as the named steward
(`maintainer_banned`). An unavailable ban read refuses. No project can be
created for a repository another project lists or a restriction binds.

```quint
type BanRead = NotBanned | AccountBanned | BanUnavailable
type AccountStanding = { actor: int, ban: BanRead }
type RegistryRead = { repository: int, listedBy: int, restricted: bool }
pure def unbanned(by: int, account: AccountStanding): bool = account.actor == by and account.ban == NotBanned
pure def repositoryFree(repository: int, read: RegistryRead): bool = read.repository == repository and read.listedBy == 0 and not(read.restricted)
pure def lawConflictsRefuseCreation(repository: int, read: RegistryRead): bool =
  (read.listedBy != 0 or read.restricted) implies not(repositoryFree(repository, read))
pure def lawBanOrUnavailableRefusesOwnerWrite(by: int, account: AccountStanding): bool =
  account.ban != NotBanned implies not(unbanned(by, account))
pure val readValues = Set({ repository: 1, listedBy: 0, restricted: false }, { repository: 1, listedBy: 9, restricted: false },
  { repository: 1, listedBy: 0, restricted: true })
pure def canCreate(c: Registry, by: int, creation: P::Creation, account: AccountStanding, registry: RegistryRead): bool =
  P::canCreate(c.project, by, creation) and unbanned(by, account) and repositoryFree(P::primary(c.project), registry) and
  c.security.restriction == E::Clear
pure def create(c: Registry, by: int, creation: P::Creation, account: AccountStanding, registry: RegistryRead): Registry =
  val p = P::create(c.project, by, creation)
  { project: p, security: sync(p, c.security) }
pure def canPublishApplication(c: Registry, by: int, creation: P::Creation, account: AccountStanding, registry: RegistryRead): bool =
  P::canPublishApplication(c.project, by, creation) and unbanned(by, account) and repositoryFree(P::primary(c.project), registry) and
  c.security.restriction == E::Clear
pure def publishApplication(c: Registry, by: int, creation: P::Creation, account: AccountStanding, registry: RegistryRead): Registry =
  val p = P::publishApplication(c.project, by, creation)
  { project: p, security: sync(p, c.security) }
pure def canCancelApplication(c: Registry, by: int): bool = P::canCancelApplication(c.project, by)
pure def cancelApplication(c: Registry, by: int): Registry = { ...c, project: P::cancelApplication(c.project, by) }
pure def canCancelUpdate(c: Registry, by: int): bool = P::canCancelUpdate(c.project, by)
pure def cancelUpdate(c: Registry, by: int): Registry = { ...c, project: P::cancelUpdate(c.project, by) }
```

### Scans are queued and recorded against the project's current repositories

The owner's setup check and rescan need current authority on the primary
repository of an unretired project; the signed service (`0`) queues initial
admission too. Administrator investigations and flag recovery work on any
registered project. A malicious result bans at once and, in the same batch,
appends the restriction's paused, retired revision, or records it as pending
when the manifest cannot take it, or needs none when the project is already
retired.

```quint
type ManifestPolicy = PolicyAccepts | PolicyRefuses
pure def restrictionPlan(p: P::Project, policy: ManifestPolicy): E::RevisionPlan =
  if (p.retirement != P::NotRetired) E::RevisionNotNeeded else if (policy == PolicyAccepts) E::RevisionAppended else E::RevisionPending
pure def retiredFor(plan: E::RevisionPlan, p: P::Project): P::Project =
  if (plan == E::RevisionAppended and P::canRetireForRestriction(p)) P::retireForRestriction(p) else p
pure def canRequestAssessment(c: Registry, by: int, repository: int, requestOrigin: E::RequestOrigin, assessmentId: int, authority: P::AuthorityRead): bool =
  c.project.revision > 0 and E::canRequestAssessment(c.security, by, repository, requestOrigin, assessmentId) and
  ((requestOrigin == E::SetupCheck or requestOrigin == E::OwnerRescan) implies
    (c.project.retirement == P::NotRetired and (by == E::vettingService or P::currentAuthority(c.project, by, authority))))
pure def requestAssessment(c: Registry, by: int, repository: int, requestOrigin: E::RequestOrigin, assessmentId: int, authority: P::AuthorityRead): Registry =
  { ...c, security: E::requestAssessment(c.security, by, repository, requestOrigin, assessmentId) }
pure def canRecordResult(c: Registry, scanOutcome: A::Outcome, policy: ManifestPolicy): bool =
  E::canRecordResult(c.security, scanOutcome, if (scanOutcome.disposition == A::DMalicious) restrictionPlan(c.project, policy) else E::RevisionNotNeeded)
pure def recordResult(c: Registry, scanOutcome: A::Outcome, policy: ManifestPolicy): Registry =
  val malicious = scanOutcome.disposition == A::DMalicious
  val plan = if (malicious) restrictionPlan(c.project, policy) else E::RevisionNotNeeded
  val p = if (malicious) retiredFor(plan, c.project) else c.project
  { project: p, security: sync(p, E::recordResult(c.security, scanOutcome, plan)) }
pure def canObserveEvidence(c: Registry, repository: int, evidenceRead: E::EvidenceRead): bool = E::canObserveEvidence(c.security, repository, evidenceRead)
pure def observeEvidence(c: Registry, repository: int, evidenceRead: E::EvidenceRead): Registry =
  { ...c, security: E::observeEvidence(c.security, repository, evidenceRead) }
pure val policyValues = Set(PolicyAccepts, PolicyRefuses)
```

### Activation needs current clearance and no restriction, and owner writes need a clear project

The setup check activates a paused project only when every repository clears
and no restriction holds. Owner revisions, appended repositories, consent
edits and placements are refused while any restriction holds. An owner
revision's clearance input is the composed clearance, so an executable change
pauses an active project whose admission is not retained.

```quint
pure def clearanceOf(e: E::Enforcement): P::Clearance = if (E::cleared(e)) P::ClearanceRetained else P::ClearanceMissing
pure def canActivate(c: Registry, by: int, check: P::SetupCheck): bool =
  P::canActivate(c.project, by, check) and E::mayContribute(c.security)
pure def activate(c: Registry, by: int, check: P::SetupCheck): Registry =
  val p = P::activate(c.project, by, check)
  { project: p, security: sync(p, c.security) }
pure def ownerWriteAllowed(c: Registry, by: int, account: AccountStanding): bool =
  c.security.restriction == E::Clear and unbanned(by, account)
pure def canPublishOwnerRevision(c: Registry, by: int, change: P::OwnerChange, account: AccountStanding): bool =
  P::canPublishOwnerRevision(c.project, by, change) and ownerWriteAllowed(c, by, account) and change.clearance == clearanceOf(c.security)
pure def publishOwnerRevision(c: Registry, by: int, change: P::OwnerChange, account: AccountStanding): Registry =
  val p = P::publishOwnerRevision(c.project, by, change)
  { project: p, security: sync(p, c.security) }
pure def canPublishUpdate(c: Registry, by: int, change: P::OwnerChange, account: AccountStanding): bool =
  P::canPublishUpdate(c.project, by, change) and ownerWriteAllowed(c, by, account) and change.clearance == clearanceOf(c.security)
pure def publishUpdate(c: Registry, by: int, change: P::OwnerChange, account: AccountStanding): Registry =
  val p = P::publishUpdate(c.project, by, change)
  { project: p, security: sync(p, c.security) }
pure def canAppendRepository(c: Registry, by: int, appendEvidence: P::Append, account: AccountStanding, registry: RegistryRead): bool =
  P::canAppendRepository(c.project, by, appendEvidence) and ownerWriteAllowed(c, by, account) and
  E::canAppendRepository(c.security, appendEvidence.facts.repository) and repositoryFree(appendEvidence.facts.repository, registry)
pure def appendRepository(c: Registry, by: int, appendEvidence: P::Append, account: AccountStanding, registry: RegistryRead): Registry =
  val p = P::appendRepository(c.project, by, appendEvidence)
  { project: p, security: sync(p, E::appendRepository(c.security, appendEvidence.facts.repository)) }
pure def canEditConsent(c: Registry, by: int, edit: P::ConsentEdit, account: AccountStanding): bool =
  P::canEditConsent(c.project, by, edit) and ownerWriteAllowed(c, by, account)
pure def editConsent(c: Registry, by: int, edit: P::ConsentEdit, account: AccountStanding): Registry =
  val p = P::editConsent(c.project, by, edit)
  { project: p, security: sync(p, c.security) }
pure def canRemove(c: Registry, by: int, removal: P::Removal): bool = P::canRemove(c.project, by, removal)
pure def remove(c: Registry, by: int, removal: P::Removal): Registry =
  val p = P::remove(c.project, by, removal)
  { project: p, security: sync(p, c.security) }
pure def canAdminRevise(c: Registry, by: int, kind: P::AdminKind, steward: int): bool =
  P::canAdminRevise(c.project, by, kind, steward) and c.security.restriction == E::Clear
pure def adminRevise(c: Registry, by: int, kind: P::AdminKind, steward: int): Registry =
  val p = P::adminRevise(c.project, by, kind, steward)
  { project: p, security: sync(p, c.security) }
pure def canPlace(c: Registry, by: int, tier: P::Tier): bool = P::canPlace(c.project, by, tier) and c.security.restriction == E::Clear
pure def place(c: Registry, by: int, tier: P::Tier): Registry =
  val p = P::place(c.project, by, tier)
  { project: p, security: sync(p, c.security) }
pure def canRecordFunding(c: Registry, funding: P::FundingEvidence): bool = P::canRecordFunding(c.project, funding)
pure def recordFunding(c: Registry, funding: P::FundingEvidence): Registry = { ...c, project: P::recordFunding(c.project, funding) }
pure def canAdvanceMonth(c: Registry, month: int): bool = P::canAdvanceMonth(c.project, month)
pure def advanceMonth(c: Registry, month: int): Registry = { ...c, project: P::advanceMonth(c.project, month) }
```

### Flags, restrictions and reinstatement change the registry only through their revisions

Flags are filed on registered projects that the owner has not removed and
administrators have not delisted. A flag pause appends no revision. A
moderator quarantine or ban appends the restriction's revision with the
record, or marks it pending; an administrator later appends it, and
reinstatement is refused until it lands. Reinstatement restores a paused
Community listing for a project the restriction retired.

```quint
pure def canFlag(c: Registry, by: int, receipt: int, standing: E::FlagStanding): bool =
  c.project.revision > 0 and (c.project.retirement == P::NotRetired or c.project.retirement == P::RestrictionRetired) and
  E::canFlag(c.security, by, receipt, standing)
pure def flag(c: Registry, by: int, receipt: int, standing: E::FlagStanding): Registry =
  { ...c, security: E::flag(c.security, by, receipt, standing) }
pure def canWithdrawFlag(c: Registry, by: int, receipt: int): bool = E::canWithdrawFlag(c.security, by, receipt)
pure def withdrawFlag(c: Registry, by: int, receipt: int): Registry = { ...c, security: E::withdrawFlag(c.security, by, receipt) }
pure def canAdvanceDay(c: Registry, day: int): bool = E::canAdvanceDay(c.security, day)
pure def advanceDay(c: Registry, day: int): Registry = { ...c, security: E::advanceDay(c.security, day) }
pure def canReinstateFlagPause(c: Registry, by: int, pins: List[E::PinRead]): bool = E::canReinstateFlagPause(c.security, by, pins)
pure def reinstateFlagPause(c: Registry, by: int, pins: List[E::PinRead]): Registry =
  { ...c, security: E::reinstateFlagPause(c.security, by, pins) }
pure def canQuarantine(c: Registry, by: int, policy: ManifestPolicy): bool =
  c.project.revision > 0 and E::canQuarantine(c.security, by, restrictionPlan(c.project, policy))
pure def quarantine(c: Registry, by: int, policy: ManifestPolicy): Registry =
  val plan = restrictionPlan(c.project, policy)
  val p = retiredFor(plan, c.project)
  { project: p, security: sync(p, E::quarantine(c.security, by, plan)) }
pure def canBan(c: Registry, by: int, policy: ManifestPolicy): bool =
  c.project.revision > 0 and E::canBan(c.security, by, restrictionPlan(c.project, policy))
pure def ban(c: Registry, by: int, policy: ManifestPolicy): Registry =
  val plan = restrictionPlan(c.project, policy)
  val p = retiredFor(plan, c.project)
  { project: p, security: sync(p, E::ban(c.security, by, plan)) }
pure def canDecideMalice(c: Registry, by: int, accounts: List[int]): bool = E::canDecideMalice(c.security, by, accounts)
pure def decideMalice(c: Registry, by: int, accounts: List[int]): Registry = { ...c, security: E::decideMalice(c.security, by, accounts) }
pure def canSettleRestrictionRevision(c: Registry, by: int): bool = E::canSettlePendingRevision(c.security, by)
pure def settleRestrictionRevision(c: Registry, by: int): Registry =
  val p = if (P::canRetireForRestriction(c.project)) P::retireForRestriction(c.project) else c.project
  { project: p, security: sync(p, E::settlePendingRevision(c.security, by)) }
pure def canRequestAppeal(c: Registry, by: int): bool = E::canRequestAppeal(c.security, by)
pure def requestAppeal(c: Registry, by: int): Registry = { ...c, security: E::requestAppeal(c.security, by) }
pure def canDenyAppeal(c: Registry, by: int): bool = E::canDenyAppeal(c.security, by)
pure def denyAppeal(c: Registry, by: int): Registry = { ...c, security: E::denyAppeal(c.security, by) }
pure def canReinstate(c: Registry, by: int, pins: List[E::PinRead]): bool = E::canReinstate(c.security, by, pins)
pure def reinstate(c: Registry, by: int, pins: List[E::PinRead]): Registry =
  val p = if (P::canRestoreCommunity(c.project)) P::restoreCommunity(c.project) else c.project
  { project: p, security: sync(p, E::reinstate(c.security, by, pins)) }
pure def canGrantExemption(c: Registry, by: int, request: E::GrantRequest): bool = E::canGrantExemption(c.security, by, request)
pure def grantExemption(c: Registry, by: int, request: E::GrantRequest): Registry = { ...c, security: E::grantExemption(c.security, by, request) }
pure def canRevokeExemption(c: Registry, by: int, repository: int, grantId: int, decision: int): bool =
  E::canRevokeExemption(c.security, by, repository, grantId, decision)
pure def revokeExemption(c: Registry, by: int, repository: int, grantId: int, decision: int): Registry =
  { ...c, security: E::revokeExemption(c.security, by, repository, grantId, decision) }
pure def canRecognizeFrozen(c: Registry, row: E::FrozenRow): bool = E::canRecognizeFrozen(c.security, row)
pure def recognizeFrozen(c: Registry, row: E::FrozenRow): Registry = { ...c, security: E::recognizeFrozen(c.security, row) }
pure def alwaysRestrictionRetiresRegistry(c: Registry): bool =
  (c.security.restriction != E::Clear and c.security.restriction != E::FlagQuarantine and not(c.security.revisionPending))
    implies c.project.tier == P::Retired and c.project.status == P::Paused
pure def alwaysRestrictionRetirementHasRestriction(c: Registry): bool =
  c.project.retirement == P::RestrictionRetired implies c.security.restriction != E::Clear and c.security.restriction != E::FlagQuarantine
```

## Story: Consumers read one derived view of the project

### Collection and skills need an active, unrestricted, cleared project at the current revision

A repository's work is collected only while the project is active and listed,
no restriction holds, every repository clears, and the repository's own start
month has come. The observation must be complete and name the same project,
revision, manifest digest and generations as the current registry. A paused
project with current clearance and no restriction serves skill bytes for
inspection; discovery and installation need an active project.

```quint
type RegistryObservation = { revision: int, manifestDigest: int, enforcementGeneration: int, clearanceGeneration: int }
type WorkEvidence = { captured: RegistryObservation, currentRegistry: RegistryObservation, complete: bool }
type TemplateEvidence = { checkedDigest: int, renderedDigest: int }
pure def currentEvidence(c: Registry, evidence: WorkEvidence): bool =
  evidence.complete and evidence.captured.manifestDigest > 0 and evidence.captured.revision == c.project.revision and
  evidence.captured.revision > 0 and evidence.captured == evidence.currentRegistry
pure def mayCollect(c: Registry, evidence: WorkEvidence, repository: int, period: int): bool =
  currentEvidence(c, evidence) and c.project.status == P::Active and P::listed(c.project) and E::mayContribute(c.security) and
  c.project.repositories.includes(repository) and P::repositoryEligible(c.project, repository, period)
pure def mayServeSkill(c: Registry, evidence: WorkEvidence, template: TemplateEvidence): bool =
  currentEvidence(c, evidence) and P::listed(c.project) and c.project.fieldsComplete and E::mayContribute(c.security) and
  template.checkedDigest > 0 and template.checkedDigest == template.renderedDigest
pure def mayDiscoverSkill(c: Registry, evidence: WorkEvidence, template: TemplateEvidence): bool =
  mayServeSkill(c, evidence, template) and c.project.status == P::Active
pure def lawRestrictionStopsCollection(c: Registry, evidence: WorkEvidence, repository: int, period: int): bool =
  c.security.restriction != E::Clear implies not(mayCollect(c, evidence, repository, period)) and not(mayServeSkill(c, evidence, { checkedDigest: 1, renderedDigest: 1 }))
pure def lawPauseStopsCollection(c: Registry, evidence: WorkEvidence, repository: int, period: int): bool =
  (c.project.status == P::Paused or c.project.tier == P::Retired) implies not(mayCollect(c, evidence, repository, period))
pure def lawStaleObservationStopsCollection(c: Registry, evidence: WorkEvidence, repository: int, period: int): bool =
  (not(evidence.complete) or evidence.captured != evidence.currentRegistry or evidence.captured.revision != c.project.revision)
    implies not(mayCollect(c, evidence, repository, period))
pure def lawAppendedRepositoryWaitsForItsMonth(c: Registry, evidence: WorkEvidence, repository: int, period: int): bool =
  mayCollect(c, evidence, repository, period) implies P::repositoryEligible(c.project, repository, period)
pure def lawUnclearedRepositoryStopsAll(c: Registry, evidence: WorkEvidence, repository: int, period: int): bool =
  c.security.repositories.some(r => not(E::repositoryCleared(c.security, r))) implies not(mayCollect(c, evidence, repository, period))
pure def lawPausedProjectNotDiscoverable(c: Registry, evidence: WorkEvidence, template: TemplateEvidence): bool =
  c.project.status == P::Paused implies not(mayDiscoverSkill(c, evidence, template))
```

### Slopbot scope and monthly eligibility derive from the same state

Slopbot reviews only registered repositories. An active, unrestricted, cleared
project gets full review. A paused, flagged or quarantined project gets
security-only review (comment and scam label). Removed and delisted projects
get no review. Slopbot's scope for a banned project is not decided by the PRD
or an owner decision, so it is an explicit gate that consumers treat as no
review until an owner decides. The monthly close reads the project's
registered, paused, retired and collection facts at its revision; a paused or
restricted project has no allocation for the month.

```quint
type ReviewScope = Unregistered | FullReview | SecurityOnly | NoReview | BanScopeUndecided
pure def reviewScope(c: Registry, repository: int, period: int): ReviewScope =
  if (c.project.revision == 0 or not(c.project.repositories.includes(repository))) Unregistered
  else if (c.project.retirement == P::OwnerRemoved or c.project.retirement == P::AdminDelisted) NoReview
  else if (c.security.restriction == E::ServiceBan or c.security.restriction == E::ModeratorBan) BanScopeUndecided
  else if (c.project.status == P::Active and c.security.restriction == E::Clear and E::cleared(c.security) and
    P::repositoryEligible(c.project, repository, period)) FullReview
  else SecurityOnly
type MonthlyEligibility = { revision: int, registered: bool, paused: bool, retired: bool, collectionAllowed: bool }
pure def monthlyEligibility(c: Registry): MonthlyEligibility =
  { revision: c.project.revision, registered: c.project.revision > 0,
    paused: c.project.status == P::Paused or c.security.restriction != E::Clear, retired: c.project.tier == P::Retired,
    collectionAllowed: E::mayContribute(c.security) }
pure def lawFlaggedProjectSecurityOnly(c: Registry, repository: int, period: int): bool =
  (c.security.restriction == E::FlagQuarantine or c.security.restriction == E::ModeratorQuarantine) implies
    reviewScope(c, repository, period) != FullReview
pure def lawRestrictedMonthSkipped(c: Registry): bool =
  c.security.restriction != E::Clear implies monthlyEligibility(c).paused
```

### The setup status names one next state from the same checks

A restriction or retirement dominates. An unavailable installation or
authority read is a retry, never a denial. A cleared active project is ready;
a cleared paused one needs activation or its skill fields; a pending scan
waits; an incomplete scan asks the owner to request a new scan; an unscanned,
unverified or stale repository is a retry that queues a scan.

```quint
type SetupState = SetupRestricted | SetupRetry | SetupActionRequired | SetupWaiting | SetupReady
pure def setupState(c: Registry, check: P::SetupCheck): SetupState =
  if (c.security.restriction != E::Clear or c.project.tier == P::Retired) SetupRestricted
  else if (check.authority.installation == P::InstallationUnavailable) SetupRetry
  else if (check.authority.installation != P::Installed) SetupActionRequired
  else if (check.authority.permission == P::PermissionUnavailable) SetupRetry
  else if (check.authority.permission == P::PermissionDenied) SetupActionRequired
  else if (E::cleared(c.security) and c.project.status == P::Active) SetupReady
  else if (E::cleared(c.security)) SetupActionRequired
  else if (c.security.repositories.some(r => E::latestOf(c.security, r).state == E::APending)) SetupWaiting
  else if (c.security.repositories.some(r => E::latestOf(c.security, r).state == E::AIncomplete)) SetupActionRequired
  else SetupRetry
pure def lawRetryIsNeverDenied(c: Registry, check: P::SetupCheck): bool =
  (c.security.restriction == E::Clear and c.project.tier != P::Retired and check.authority.permission == P::PermissionUnavailable and
    check.authority.installation == P::Installed) implies setupState(c, check) == SetupRetry
pure def lawReadyMeansCollectable(c: Registry, check: P::SetupCheck): bool =
  setupState(c, check) == SetupReady implies E::mayContribute(c.security) and c.project.status == P::Active
```

### Reachable composed outcomes

```quint
pure def sometimesCollectable(c: Registry): bool =
  c.project.status == P::Active and E::mayContribute(c.security) and P::listed(c.project)
pure def sometimesFlagPausedActiveManifest(c: Registry): bool =
  c.security.restriction == E::FlagQuarantine and c.project.status == P::Active
pure def sometimesBannedRetired(c: Registry): bool = c.security.restriction == E::ServiceBan and c.project.retirement == P::RestrictionRetired
pure def sometimesRestoredAfterRestriction(c: Registry): bool =
  c.security.restriction == E::Clear and c.project.history.some(r => r.kind == P::CommunityRestored)
pure def sometimesPendingRestrictionRevision(c: Registry): bool = c.security.revisionPending and c.project.retirement == P::NotRetired
pure def sometimesAppendedAwaitingScan(c: Registry): bool =
  c.project.repositories.length() == 2 and c.project.status == P::Paused and not(E::cleared(c.security))
pure val byValues = Set(0, 1, 2, 3, 5, 6)
pure val goodStanding: E::FlagStanding = { actor: 2, revision: 1, accountAgeDays: 30, acceptedContributions: 1, maintainer: E::ReadNo, banned: E::ReadNo }
pure val standingValues = Set(goodStanding, { ...goodStanding, actor: 3 }, { ...goodStanding, revision: 2 }, { ...goodStanding, actor: 3, revision: 2 })
pure val repositoryValues = Set(1, 2)
pure val assessmentIdValues = Set(1, 2, 3)
pure val creationValues = Set(P::creation1)
pure val accountValues = Set({ actor: 1, ban: NotBanned }, { actor: 2, ban: NotBanned }, { actor: 1, ban: AccountBanned })
pure val registryValues = Set({ repository: 1, listedBy: 0, restricted: false }, { repository: 2, listedBy: 0, restricted: false })
pure val authorityValues = Set(P::owner1)
pure val checkValues = Set({ authority: P::owner1, installations: List({ repository: 1, installation: P::Installed }, { repository: 2, installation: P::Installed }) },
  { authority: { ...P::owner1, installation: P::InstallationUnavailable }, installations: List() })
pure val changeValues = Set(P::change1, { ...P::change1, expectedRevision: 3, executable: true, clearance: P::ClearanceRetained },
  { ...P::change1, authority: { ...P::owner1, actor: 2 }, expectedRevision: 1 },
  { ...P::change1, authority: { ...P::owner1, actor: 2 }, expectedRevision: 1, clearance: P::ClearanceMissing })
pure val weight_publishUpdate = 4
pure val appendEvidenceValues = Set({ ...P::append1, expectedRevision: 1 }, P::append1)
pure val editValues = Set({ authority: P::owner1, expectedRevision: 2, checked: true })
pure val removalValues = Set({ authority: P::owner1, expectedRevision: 2 })
pure val requestValues = Set(E::goodGrant)
pure val rowValues = Set({ projectId: 1, repository: 1 })
pure val pinsValues = Set(List({ repository: 1, pin: E::PinMatches }, { repository: 2, pin: E::PinMatches }))
pure val scanOutcomeValues = Set(
  { assessment: 1, repository: 1, revision: 1, disposition: A::DClean, reused: false, retained: true },
  { assessment: 1, repository: 1, revision: 1, disposition: A::DMalicious, reused: false, retained: true },
  { assessment: 2, repository: 1, revision: 1, disposition: A::DClean, reused: false, retained: true },
  { assessment: 3, repository: 2, revision: 2, disposition: A::DClean, reused: false, retained: true })
pure val evidenceValues = Set(
  { captured: { revision: 2, manifestDigest: 1, enforcementGeneration: 1, clearanceGeneration: 1 },
    currentRegistry: { revision: 2, manifestDigest: 1, enforcementGeneration: 1, clearanceGeneration: 1 }, complete: true },
  { captured: { revision: 2, manifestDigest: 1, enforcementGeneration: 1, clearanceGeneration: 1 },
    currentRegistry: { revision: 2, manifestDigest: 1, enforcementGeneration: 2, clearanceGeneration: 1 }, complete: true })
pure val periodValues = Set(202611, 202612)
pure val stewardValues = Set(0, 4)
pure val evidenceReadValues = Set({ assessment: 1, present: false })
pure val templateValues = Set({ checkedDigest: 1, renderedDigest: 1 }, { checkedDigest: 1, renderedDigest: 2 })
pure val cValues = Set(initial)
pure val weight_create = 4
pure val weight_publishApplication = 10
pure val weight_requestAssessment = 10
pure val weight_recordResult = 10
pure val weight_activate = 8
pure val weight_flag = 8
pure val weight_requestAppeal = 5
pure val weight_reinstate = 6
pure val weight_reinstateFlagPause = 6
pure val weight_quarantine = 4
pure val weight_ban = 3
pure val weight_appendRepository = 4
```
