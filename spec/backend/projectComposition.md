# Registry and security composition

PRD sections 2, 4, 5, 7, 8 and 12. One registered project is two machines
written in one D1 batch: its [registry revisions](./projects.md) and
its [security state](../security/enforcement.md). This machine holds both and
performs each user, administrator, moderator and service action on both at
once, so a restriction, an append or an activation can never land on one
side only (`backend/projects/cloudflare-persistence.ts` checks the current
revision, the enforcement generation and, for admission-gated activation, the
clearance generation inside the SQL write). It also derives what consumers
read: collection and skill publication, the Slopbot review scope, monthly
eligibility and the setup status.

Every revision the registry appends also appends one row of the
[revision receipt store](./revisionReceipts.md) in the same D1 insert: the
shell calls its `appendRevision` with the project's new `revision` and the
canonical manifest text of that revision, so the store's row count equals the
project's `revision` (shell obligation). The receipt store declares an opaque
digest function and cannot be imported, so no composed rule here can state
that equality; its guard refuses any revision number but the next one.

Three inputs come from other areas and are typed evidence, never caller
claims: the account standing from [participation restrictions](./access.md)
(the moderator account-ban list read for the acting account and for the
steward the manifest names), the registry-wide repository read and project
closure from the [registry](./projectRegistry.md) (which project, if
any, lists the repository's permanent id or path, and which restricted
project closes this one), and the admission outcome, which only the signed
vetting service submits from the recorded state of the
[assessment machine](../security/admission.md). The manifest policy result is
the project API's deterministic `assertProjectPolicyTransition` check of the
stored manifest at the current revision. Clock and finalized-funding events
come only from the project API's own scheduled jobs (`-1`).

## Story: Perform every project action on registry and security together

### The composed state keeps the two machines' shared facts equal

Every composed action calls each child transition only under that child's own
guard, so the children's rules hold of the composed state. The child facts the
composed rules rely on are restated here so the composition proves them too.

```quint
import closureConsent as C from "./closureConsent"
import projects as P from "./projects"
import enforcement as E from "../security/enforcement"
import admission as A from "../security/admission"
import projectRegistry as R from "./projectRegistry"
import skillRendering as SR from "../contributor/skillRendering"
import payoutExclusions as X from "../settlement/payoutExclusions"
type Registry = { project: P::Project, security: E::Enforcement, exclusions: List[X::Exclusion] }
pure val initial: Registry = { project: P::initial, security: E::initial, exclusions: List() }
pure def sync(p: P::Project, e: E::Enforcement): E::Enforcement =
  if (p.revision > e.revision and p.steward > 0 and p.creator > 0 and (e.creator == 0 or p.creator == e.creator))
    E::observeRevision(e, E::platform, p.revision, p.steward, p.creator) else e
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
pure def stepOnlyReinstatementUnretires(before: Registry, via: str, after: Registry): bool =
  (before.project.retirement != P::NotRetired and after.project.retirement == P::NotRetired) implies
    (via == "reinstate" and before.project.retirement == P::RestrictionRetired and after.project.tier == P::Community and
     after.project.status == P::Paused)
```

### Account bans and registry conflicts refuse new projects and owner writes

A banned maintainer cannot create a project, publish a stored application,
publish an owner revision, append, edit consent or activate it, whether the
banned account acts itself or is the steward the manifest names
(`assertMaintainerNotBanned`, `maintainer_banned`). An unavailable ban read
refuses. An account this project's own moderator decision banned is refused
too. No project can be created for a repository another project lists or a
restriction binds.

```quint
type BanRead = NotBanned | AccountBanned | BanUnavailable
type AccountStanding = { actor: int, steward: int, actorBan: BanRead, stewardBan: BanRead }
type RegistryRead = { repository: int, listedBy: int, restricted: bool }
pure def unbanned(by: int, steward: int, account: AccountStanding): bool =
  account.actor == by and account.steward == steward and account.actorBan == NotBanned and account.stewardBan == NotBanned
pure def repositoryFree(repository: int, read: RegistryRead): bool = read.repository == repository and read.listedBy == 0 and not(read.restricted)
pure def lawConflictsRefuseCreation(repository: int, read: RegistryRead): bool =
  (read.listedBy != 0 or read.restricted) implies not(repositoryFree(repository, read))
pure def lawBanOrUnavailableRefusesOwnerWrite(by: int, steward: int, account: AccountStanding): bool =
  (account.actorBan != NotBanned or account.stewardBan != NotBanned) implies not(unbanned(by, steward, account))
pure val readValues = Set({ repository: 1, listedBy: 0, restricted: false }, { repository: 1, listedBy: 9, restricted: false },
  { repository: 1, listedBy: 0, restricted: true })
pure def canCreate(c: Registry, by: int, creation: P::Creation, account: AccountStanding, registry: RegistryRead,
  exclusions: List[X::Exclusion]): bool =
  P::canCreate(c.project, by, creation) and unbanned(by, creation.facts.owner, account) and repositoryFree(P::primary(c.project), registry) and
  c.security.restriction == E::Clear and exclusionsMayBecome(c, exclusions)
pure def create(c: Registry, by: int, creation: P::Creation, account: AccountStanding, registry: RegistryRead,
  exclusions: List[X::Exclusion]): Registry =
  val p = P::create(c.project, by, creation)
  { project: p, security: sync(p, c.security), exclusions: exclusions }
pure def canPublishApplication(c: Registry, by: int, creation: P::Creation, account: AccountStanding, registry: RegistryRead,
  exclusions: List[X::Exclusion]): bool =
  P::canPublishApplication(c.project, by, creation) and unbanned(by, creation.facts.owner, account) and repositoryFree(P::primary(c.project), registry) and
  c.security.restriction == E::Clear and exclusionsMayBecome(c, exclusions)
pure def publishApplication(c: Registry, by: int, creation: P::Creation, account: AccountStanding, registry: RegistryRead,
  exclusions: List[X::Exclusion]): Registry =
  val p = P::publishApplication(c.project, by, creation)
  { project: p, security: sync(p, c.security), exclusions: exclusions }
pure def canCancelApplication(c: Registry, by: int): bool = P::canCancelApplication(c.project, by)
pure def cancelApplication(c: Registry, by: int): Registry = { ...c, project: P::cancelApplication(c.project, by) }
pure def canCancelUpdate(c: Registry, by: int): bool = P::canCancelUpdate(c.project, by)
pure def cancelUpdate(c: Registry, by: int): Registry = { ...c, project: P::cancelUpdate(c.project, by) }
```

### Payout exclusions change only with a revision and only for later months

`reward.payoutExclusions` names owners, funded employees and related parties,
each an immutable actor for the months from `fromCycle` until `untilCycle`;
[payout exclusions](../settlement/payoutExclusions.md) define the list. Every
revision path (creation, stored application, owner revision, published
update and administrator exception) carries the list its manifest states and
refuses a change to who is excluded in the open UTC month or earlier
(`assertPayoutExclusionTransition`); an owner's change is financial policy.

```quint
pure def exclusionsMayBecome(c: Registry, exclusions: List[X::Exclusion]): bool =
  X::validList(exclusions) and X::prospective(c.exclusions, exclusions, c.project.month)
pure def stepExclusionsProspective(before: Registry, after: Registry): bool =
  X::prospective(before.exclusions, after.exclusions, before.project.month) and
  (after.exclusions != before.exclusions implies after.project.revision == before.project.revision + 1)
pure def alwaysExclusionsValid(c: Registry): bool = X::validList(c.exclusions)
pure val ownerExcluded: X::Exclusion = { actor: 1, relationship: X::ProjectOwner, fromPeriod: 202612, untilPeriod: 0 }
pure val exclusionsValues = Set(List(), List(ownerExcluded), List({ ...ownerExcluded, fromPeriod: 202611 }))
pure def sometimesOwnerExcludedFromNextMonth(c: Registry): bool = c.exclusions.length() > 0 and c.project.revision > 1
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
type PolicyCheck = { revision: int, result: ManifestPolicy }
pure def policyCurrent(p: P::Project, policy: PolicyCheck): bool = policy.revision == p.revision
pure def restrictionPlan(p: P::Project, policy: PolicyCheck): E::RevisionPlan =
  if (p.retirement != P::NotRetired) E::RevisionNotNeeded else if (policy.result == PolicyAccepts) E::RevisionAppended else E::RevisionPending
pure def retiredFor(plan: E::RevisionPlan, p: P::Project): P::Project = P::withRestrictionRetirement(plan == E::RevisionAppended, p)
pure def canRequestAssessment(c: Registry, by: int, repository: int, requestOrigin: E::RequestOrigin, assessmentId: int, authority: P::AuthorityRead): bool =
  c.project.revision > 0 and E::canRequestAssessment(c.security, by, repository, requestOrigin, assessmentId) and
  ((requestOrigin == E::SetupCheck or requestOrigin == E::OwnerRescan) implies
    (c.project.retirement == P::NotRetired and (by == E::vettingService or P::currentAuthority(c.project, by, authority))))
pure def requestAssessment(c: Registry, by: int, repository: int, requestOrigin: E::RequestOrigin, assessmentId: int, authority: P::AuthorityRead): Registry =
  { ...c, security: E::requestAssessment(c.security, by, repository, requestOrigin, assessmentId) }
pure def canRecordResult(c: Registry, by: int, scanOutcome: A::Outcome, policy: PolicyCheck): bool =
  policyCurrent(c.project, policy) and
  E::canRecordResult(c.security, by, scanOutcome, if (scanOutcome.disposition == A::DMalicious) restrictionPlan(c.project, policy) else E::RevisionNotNeeded)
pure def recordResult(c: Registry, by: int, scanOutcome: A::Outcome, policy: PolicyCheck): Registry =
  val malicious = scanOutcome.disposition == A::DMalicious
  val plan = if (malicious) restrictionPlan(c.project, policy) else E::RevisionNotNeeded
  val p = if (malicious) retiredFor(plan, c.project) else c.project
  { ...c, project: p, security: sync(p, E::recordResult(c.security, by, scanOutcome, plan)) }
pure def canObserveEvidence(c: Registry, by: int, repository: int, evidenceRead: E::EvidenceRead): bool =
  E::canObserveEvidence(c.security, by, repository, evidenceRead)
pure def observeEvidence(c: Registry, by: int, repository: int, evidenceRead: E::EvidenceRead): Registry =
  { ...c, security: E::observeEvidence(c.security, by, repository, evidenceRead) }
pure val policyValues = tuples(1.to(5), Set(PolicyAccepts, PolicyRefuses)).map(x => { revision: x._1, result: x._2 })
```

### Activation needs current clearance and no restriction, and owner writes need a clear project

The setup check activates a paused project only when every repository clears,
no restriction holds and neither the acting account nor the steward is
banned (activation is an owner-participation revision). It commits only
against the revision, enforcement record count and clearance generation it
read, so a scan result, grant, revocation or identity change recorded in
between refuses it and the check runs again. Owner revisions,
appended repositories, consent edits and placements are refused while any
restriction holds (`project_restricted`). Removal is refused too while the
project's own restriction is in force, a pending restriction revision
included: 409 `project_restricted`, "The project is <state>; request
reinstatement before removing it", checked after the authority recheck and
before the already-removed retry, and again inside the guarded append
(Slop development `da358d8a9`, `backend/projects/handler.ts:1857,2202,2406`,
the retained `api_project_removal` model). An owner
revision's clearance input is the composed clearance, so an executable change
pauses an active project whose admission is not retained: an executable
change never leaves the project collectable without clearance.

```quint
pure def clearanceOf(e: E::Enforcement): P::Clearance = if (E::cleared(e)) P::ClearanceRetained else P::ClearanceMissing
pure def canActivate(c: Registry, by: int, check: P::SetupCheck, account: AccountStanding, observed: RegistryObservation): bool =
  P::canActivate(c.project, by, check) and E::mayContribute(c.security) and unbanned(by, c.project.steward, account) and
  not(c.security.accountBans.includes(by)) and observed == observation(c)
pure def activate(c: Registry, by: int, check: P::SetupCheck, account: AccountStanding, observed: RegistryObservation): Registry =
  val p = P::activate(c.project, by, check)
  { ...c, project: p, security: sync(p, c.security) }
pure def ownerWriteAllowed(c: Registry, by: int, account: AccountStanding): bool =
  c.security.restriction == E::Clear and unbanned(by, c.project.steward, account) and not(c.security.accountBans.includes(by))
pure def canPublishOwnerRevision(c: Registry, by: int, change: P::OwnerChange, account: AccountStanding, exclusions: List[X::Exclusion]): bool =
  P::canPublishOwnerRevision(c.project, by, change) and ownerWriteAllowed(c, by, account) and change.clearance == clearanceOf(c.security) and
  exclusionsMayBecome(c, exclusions) and (change.exclusionsChanged iff exclusions != c.exclusions)
pure def publishOwnerRevision(c: Registry, by: int, change: P::OwnerChange, account: AccountStanding, exclusions: List[X::Exclusion]): Registry =
  val p = P::publishOwnerRevision(c.project, by, change)
  { project: p, security: sync(p, c.security), exclusions: exclusions }
pure def lawExecutableChangeNeedsClearance(c: Registry, by: int, change: P::OwnerChange, account: AccountStanding,
  exclusions: List[X::Exclusion]): bool =
  (canPublishOwnerRevision(c, by, change, account, exclusions) and change.executable) implies
    (publishOwnerRevision(c, by, change, account, exclusions).project.status == P::Paused or E::cleared(c.security))
pure def canPublishUpdate(c: Registry, by: int, change: P::OwnerChange, account: AccountStanding, exclusions: List[X::Exclusion]): bool =
  P::canPublishUpdate(c.project, by, change) and ownerWriteAllowed(c, by, account) and change.clearance == clearanceOf(c.security) and
  exclusionsMayBecome(c, exclusions) and (change.exclusionsChanged iff exclusions != c.exclusions)
pure def publishUpdate(c: Registry, by: int, change: P::OwnerChange, account: AccountStanding, exclusions: List[X::Exclusion]): Registry =
  val p = P::publishUpdate(c.project, by, change)
  { project: p, security: sync(p, c.security), exclusions: exclusions }
pure def canAppendRepository(c: Registry, by: int, appendEvidence: P::Append, account: AccountStanding, registry: RegistryRead): bool =
  P::canAppendRepository(c.project, by, appendEvidence) and ownerWriteAllowed(c, by, account) and
  E::canAppendRepository(c.security, appendEvidence.facts.repository) and repositoryFree(appendEvidence.facts.repository, registry)
pure def appendRepository(c: Registry, by: int, appendEvidence: P::Append, account: AccountStanding, registry: RegistryRead): Registry =
  val p = P::appendRepository(c.project, by, appendEvidence)
  { ...c, project: p, security: sync(p, E::appendRepository(c.security, appendEvidence.facts.repository)) }
pure def canEditConsent(c: Registry, by: int, edit: P::ConsentEdit, account: AccountStanding): bool =
  P::canEditConsent(c.project, by, edit) and ownerWriteAllowed(c, by, account)
pure def editConsent(c: Registry, by: int, edit: P::ConsentEdit, account: AccountStanding): Registry =
  val p = P::editConsent(c.project, by, edit)
  { ...c, project: p, security: sync(p, c.security) }
pure def canRemove(c: Registry, by: int, removal: P::Removal): bool =
  P::canRemove(c.project, by, removal) and c.security.restriction == E::Clear
pure def remove(c: Registry, by: int, removal: P::Removal): Registry =
  val p = P::remove(c.project, by, removal)
  { ...c, project: p, security: E::withRevisionLanded(p.tier == P::Retired, sync(p, c.security)) }
pure def canAdminRevise(c: Registry, by: int, exception: P::Exception, exclusions: List[X::Exclusion]): bool =
  P::canAdminRevise(c.project, by, exception) and c.security.restriction == E::Clear and exclusionsMayBecome(c, exclusions)
pure def adminRevise(c: Registry, by: int, exception: P::Exception, exclusions: List[X::Exclusion]): Registry =
  val p = P::adminRevise(c.project, by, exception)
  { project: p, security: sync(p, c.security), exclusions: exclusions }
pure def canPlace(c: Registry, by: int, tier: P::Tier): bool = P::canPlace(c.project, by, tier) and c.security.restriction == E::Clear
pure def place(c: Registry, by: int, tier: P::Tier): Registry =
  val p = P::place(c.project, by, tier)
  { ...c, project: p, security: sync(p, c.security) }
pure def canRecordFunding(c: Registry, by: int, funding: P::FundingEvidence): bool = P::canRecordFunding(c.project, by, funding)
pure def recordFunding(c: Registry, by: int, funding: P::FundingEvidence): Registry = { ...c, project: P::recordFunding(c.project, by, funding) }
pure def canAdvanceMonth(c: Registry, by: int, month: int): bool = P::canAdvanceMonth(c.project, by, month)
pure def advanceMonth(c: Registry, by: int, month: int): Registry = { ...c, project: P::advanceMonth(c.project, by, month) }
```

### Flags, restrictions and reinstatement change the registry only through their revisions

Flags are filed on registered projects that the owner has not removed and
administrators have not delisted. A flag pause appends no revision. A
moderator quarantine or ban appends the restriction's revision with the
record, or marks it pending when the current revision's policy check refuses
it; an administrator later appends it under a passing policy check, and
reinstatement is refused until it lands. The owner cannot remove the project
while the restriction holds, so the restriction's retired revision is never
taken for a removal. Reinstatement restores a paused Community listing only
for a project the restriction retired; a project the owner removed before
the restriction stays removed. Every moderator decision carries the
revision and sequence its preview confirmed.

```quint
pure def canFlag(c: Registry, by: int, receipt: int, standing: E::FlagStanding): bool =
  c.project.revision > 0 and (c.project.retirement == P::NotRetired or c.project.retirement == P::RestrictionRetired) and
  E::canFlag(c.security, by, receipt, standing)
pure def flag(c: Registry, by: int, receipt: int, standing: E::FlagStanding): Registry =
  { ...c, security: E::flag(c.security, by, receipt, standing) }
pure def canWithdrawFlag(c: Registry, by: int, receipt: int): bool = E::canWithdrawFlag(c.security, by, receipt)
pure def withdrawFlag(c: Registry, by: int, receipt: int): Registry = { ...c, security: E::withdrawFlag(c.security, by, receipt) }
pure def canAdvanceDay(c: Registry, by: int, day: int): bool = E::canAdvanceDay(c.security, by, day)
pure def advanceDay(c: Registry, by: int, day: int): Registry = { ...c, security: E::advanceDay(c.security, by, day) }
pure def canReinstateFlagPause(c: Registry, by: int, pins: List[E::PinRead]): bool = E::canReinstateFlagPause(c.security, by, pins)
pure def reinstateFlagPause(c: Registry, by: int, pins: List[E::PinRead]): Registry =
  { ...c, security: E::reinstateFlagPause(c.security, by, pins) }
pure def canQuarantine(c: Registry, by: int, fence: E::Fence, policy: PolicyCheck): bool =
  c.project.revision > 0 and policyCurrent(c.project, policy) and E::canQuarantine(c.security, by, fence, restrictionPlan(c.project, policy))
pure def quarantine(c: Registry, by: int, fence: E::Fence, policy: PolicyCheck): Registry =
  val plan = restrictionPlan(c.project, policy)
  val p = retiredFor(plan, c.project)
  { ...c, project: p, security: sync(p, E::quarantine(c.security, by, fence, plan)) }
pure def canBan(c: Registry, by: int, fence: E::Fence, policy: PolicyCheck): bool =
  c.project.revision > 0 and policyCurrent(c.project, policy) and E::canBan(c.security, by, fence, restrictionPlan(c.project, policy))
pure def ban(c: Registry, by: int, fence: E::Fence, policy: PolicyCheck): Registry =
  val plan = restrictionPlan(c.project, policy)
  val p = retiredFor(plan, c.project)
  { ...c, project: p, security: sync(p, E::ban(c.security, by, fence, plan)) }
pure def canDecideMalice(c: Registry, by: int, fence: E::Fence, accounts: List[int]): bool = E::canDecideMalice(c.security, by, fence, accounts)
pure def decideMalice(c: Registry, by: int, fence: E::Fence, accounts: List[int]): Registry =
  { ...c, security: E::decideMalice(c.security, by, fence, accounts) }
pure def canSettleRestrictionRevision(c: Registry, by: int, policy: PolicyCheck): bool =
  E::canSettlePendingRevision(c.security, by) and policyCurrent(c.project, policy) and policy.result == PolicyAccepts
pure def settleRestrictionRevision(c: Registry, by: int, policy: PolicyCheck): Registry =
  val p = P::withRestrictionRetirement(true, c.project)
  { ...c, project: p, security: sync(p, E::settlePendingRevision(c.security, by)) }
pure def canRequestAppeal(c: Registry, by: int): bool = E::canRequestAppeal(c.security, by)
pure def requestAppeal(c: Registry, by: int): Registry = { ...c, security: E::requestAppeal(c.security, by) }
pure def canDenyAppeal(c: Registry, by: int, fence: E::Fence): bool = E::canDenyAppeal(c.security, by, fence)
pure def denyAppeal(c: Registry, by: int, fence: E::Fence): Registry = { ...c, security: E::denyAppeal(c.security, by, fence) }
pure def canObservePins(c: Registry, by: int, pins: List[E::PinRead]): bool = E::canObservePins(c.security, by, pins)
pure def observePins(c: Registry, by: int, pins: List[E::PinRead]): Registry = { ...c, security: E::observePins(c.security, by, pins) }
pure def canReinstate(c: Registry, by: int, fence: E::Fence): bool = E::canReinstate(c.security, by, fence)
pure def reinstate(c: Registry, by: int, fence: E::Fence): Registry =
  val p = P::withCommunityRestored(true, c.project)
  { ...c, project: p, security: sync(p, E::reinstate(c.security, by, fence)) }
pure def canGrantExemption(c: Registry, by: int, fence: E::Fence, request: E::GrantRequest): bool =
  E::canGrantExemption(c.security, by, fence, request)
pure def grantExemption(c: Registry, by: int, fence: E::Fence, request: E::GrantRequest): Registry =
  { ...c, security: E::grantExemption(c.security, by, fence, request) }
pure def canRevokeExemption(c: Registry, by: int, revoke: E::RevokeRequest): bool = E::canRevokeExemption(c.security, by, revoke)
pure def revokeExemption(c: Registry, by: int, revoke: E::RevokeRequest): Registry =
  { ...c, security: E::revokeExemption(c.security, by, revoke) }
pure def canObserveIdentity(c: Registry, by: int, repository: int, identity: int): bool =
  E::canObserveIdentity(c.security, by, repository, identity)
pure def observeIdentity(c: Registry, by: int, repository: int, identity: int): Registry =
  { ...c, security: E::observeIdentity(c.security, by, repository, identity) }
pure def canRecognizeFrozen(c: Registry, by: int, row: E::FrozenRow): bool = E::canRecognizeFrozen(c.security, by, row)
pure def recognizeFrozen(c: Registry, by: int, row: E::FrozenRow): Registry = { ...c, security: E::recognizeFrozen(c.security, by, row) }
pure def alwaysRestrictionRetiresRegistry(c: Registry): bool =
  (c.security.restriction != E::Clear and c.security.restriction != E::FlagQuarantine and not(c.security.revisionPending))
    implies c.project.tier == P::Retired and c.project.status == P::Paused
pure def alwaysRestrictionRetirementHasRestriction(c: Registry): bool =
  c.project.retirement == P::RestrictionRetired implies c.security.restriction != E::Clear and c.security.restriction != E::FlagQuarantine
pure def alwaysRestrictedProjectRegistered(c: Registry): bool = c.security.restriction != E::Clear implies c.project.revision > 0
```

## Story: Consumers read one derived view of the project

### Collection and skills need an active, unrestricted, cleared project at the current revision

A repository's work is collected only while the project is active and listed,
no restriction holds on it or on a project sharing one of its repository ids
or paths, every repository clears, and the repository's own start month has
come. The collector's observation must be a complete snapshot taken at the
current revision, enforcement record count and clearance generation, which
this machine computes from its own state; a stale or partial observation
collects nothing. A paused project with current clearance and no restriction
serves skill bytes for inspection; discovery and installation need an active
project. The served bytes are the [rendering](../contributor/skillRendering.md)
of the canonical template commit and the approved revision at the current
registry revision, published once as raw Markdown and inside the `.skill`
archive; no other bytes are served.

```quint
type RegistryObservation = { revision: int, enforcementGeneration: int, clearanceGeneration: int }
type Coverage = CompleteSnapshot | PartialSnapshot
type WorkEvidence = { captured: RegistryObservation, coverage: Coverage }
type SkillServing = { revision: int, template: SR::Template, approved: SR::Revision, served: SR::Publication }
pure def observation(c: Registry): RegistryObservation =
  { revision: c.project.revision, enforcementGeneration: c.security.journal.length(), clearanceGeneration: c.security.seq }
pure def currentEvidence(c: Registry, evidence: WorkEvidence): bool =
  evidence.coverage == CompleteSnapshot and c.project.revision > 0 and evidence.captured == observation(c)
pure def unclosed(c: Registry, closure: R::Closure): bool = closure.project == c.security.projectId and closure.source == 0
pure def mayCollect(c: Registry, evidence: WorkEvidence, closure: R::Closure, repository: int, period: int): bool =
  currentEvidence(c, evidence) and unclosed(c, closure) and c.project.status == P::Active and P::listed(c.project) and
  E::mayContribute(c.security) and c.project.repositories.includes(repository) and P::repositoryEligible(c.project, repository, period)
pure def rendered(c: Registry, skill: SkillServing): bool =
  skill.revision == c.project.revision and skill.template.commit != "" and skill.approved.digest != "" and
  skill.served == SR::publish(skill.template, skill.approved)
pure def mayServeSkill(c: Registry, evidence: WorkEvidence, closure: R::Closure, skill: SkillServing): bool =
  currentEvidence(c, evidence) and unclosed(c, closure) and P::listed(c.project) and c.project.fieldsComplete and
  E::mayContribute(c.security) and rendered(c, skill)
pure def mayDiscoverSkill(c: Registry, evidence: WorkEvidence, closure: R::Closure, skill: SkillServing): bool =
  mayServeSkill(c, evidence, closure, skill) and c.project.status == P::Active
pure def lawServedSkillIsTheRendering(c: Registry, evidence: WorkEvidence, closure: R::Closure, skill: SkillServing): bool =
  mayServeSkill(c, evidence, closure, skill) implies
    (skill.served.rawMarkdown == SR::render(skill.template, skill.approved) and skill.served.archivedSkill == skill.served.rawMarkdown)
pure def lawRestrictionStopsCollection(c: Registry, evidence: WorkEvidence, closure: R::Closure, repository: int, period: int): bool =
  (c.security.restriction != E::Clear or closure.source != 0) implies
    (not(mayCollect(c, evidence, closure, repository, period)) and
     not(mayServeSkill(c, evidence, closure, renderedSkill(c.project.revision))))
pure def lawPauseStopsCollection(c: Registry, evidence: WorkEvidence, closure: R::Closure, repository: int, period: int): bool =
  (c.project.status == P::Paused or c.project.tier == P::Retired) implies not(mayCollect(c, evidence, closure, repository, period))
pure def lawStaleObservationStopsCollection(c: Registry, evidence: WorkEvidence, closure: R::Closure, repository: int, period: int): bool =
  (evidence.coverage != CompleteSnapshot or evidence.captured.revision != c.project.revision or
    evidence.captured.enforcementGeneration != c.security.journal.length() or evidence.captured.clearanceGeneration != c.security.seq)
    implies not(mayCollect(c, evidence, closure, repository, period))
pure def lawAppendedRepositoryWaitsForItsMonth(c: Registry, evidence: WorkEvidence, closure: R::Closure, repository: int, period: int): bool =
  mayCollect(c, evidence, closure, repository, period) implies P::repositoryEligible(c.project, repository, period)
pure def lawUnclearedRepositoryStopsAll(c: Registry, evidence: WorkEvidence, closure: R::Closure, repository: int, period: int): bool =
  c.security.repositories.some(r => not(E::repositoryCleared(c.security, r))) implies not(mayCollect(c, evidence, closure, repository, period))
pure def lawPausedProjectNotDiscoverable(c: Registry, evidence: WorkEvidence, closure: R::Closure, skill: SkillServing): bool =
  c.project.status == P::Paused implies not(mayDiscoverSkill(c, evidence, closure, skill))
```

### Slopbot scope and monthly eligibility derive from the same state

Slopbot reviews only registered repositories. An active, unrestricted,
unclosed, cleared project gets full review. A paused, flagged, quarantined or
banned project, and one closed by another project's restriction, gets
security-only review (comment and scam label): the retirement a quarantine or
ban applies keeps the security review (owner decision D12,
`src/lib/project-capabilities.mjs`). Removed and delisted projects get no
review. When Slopbot cannot read the evidence that a restriction retired the
listing, it treats the retirement as the owner's and gives no review
(`workers/slopbot/registry.ts`). The monthly close reads the project's
registered, paused, retired and collection facts at its revision; a paused
or restricted project has no allocation for the month.

```quint
type ReviewScope = Unregistered | FullReview | SecurityOnly | NoReview
type RetirementEvidence = RetirementProven | RetirementUnavailable
pure def reviewScope(c: Registry, closure: R::Closure, retirementRead: RetirementEvidence, repository: int, period: int): ReviewScope =
  if (c.project.revision == 0 or not(c.project.repositories.includes(repository))) Unregistered
  else if (P::ownerRetired(c.project)) NoReview
  else if (c.project.retirement == P::RestrictionRetired and retirementRead == RetirementUnavailable) NoReview
  else if (c.project.status == P::Active and c.security.restriction == E::Clear and unclosed(c, closure) and E::cleared(c.security) and
    P::repositoryEligible(c.project, repository, period)) FullReview
  else SecurityOnly
type MonthlyEligibility = { revision: int, registered: bool, paused: bool, retired: bool, collectionAllowed: bool }
pure def monthlyEligibility(c: Registry): MonthlyEligibility =
  { revision: c.project.revision, registered: c.project.revision > 0,
    paused: c.project.status == P::Paused or c.security.restriction != E::Clear, retired: c.project.tier == P::Retired,
    collectionAllowed: E::mayContribute(c.security) }
pure def lawRestrictedProjectSecurityOnly(c: Registry, closure: R::Closure, repository: int, period: int): bool =
  (c.project.revision > 0 and c.project.repositories.includes(repository) and not(P::ownerRetired(c.project)) and
    (c.security.restriction != E::Clear or closure.source != 0))
    implies reviewScope(c, closure, RetirementProven, repository, period) == SecurityOnly
pure def lawOwnerRetirementEndsReview(c: Registry, closure: R::Closure, repository: int, period: int): bool =
  (c.project.revision > 0 and c.project.repositories.includes(repository) and P::ownerRetired(c.project))
    implies reviewScope(c, closure, RetirementProven, repository, period) == NoReview
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

### A cleared, ready project is activated by the setup refresh

PRD section 4: a clean scan of the last uncleared repository reactivates the
project. The setup refresh (`refreshProjectSetup`) reruns the setup check for
the creator after each recorded result. While the creator's authority and
installation reads verify and nothing else changes, a paused project that
clears, has its skill fields, open participation, no restriction and no ban
does not stay paused.

```quint
pure def readyToActivate(c: Registry): bool =
  c.project.revision > 0 and c.project.status == P::Paused and c.project.retirement == P::NotRetired and
  c.project.fieldsComplete and c.project.participation == P::OpenParticipation and E::mayContribute(c.security) and
  not(c.security.accountBans.includes(c.project.creator))
pure def leadsToActivation(c: Registry, later: Registry): bool =
  readyToActivate(c) implies (later.project.status == P::Active or not(readyToActivate(later)))
pure val fair_activate = "weak"
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
pure def sometimesRemovedDuringRestriction(c: Registry): bool =
  c.security.restriction != E::Clear and c.project.retirement == P::OwnerRemoved and not(c.security.revisionPending)
pure def sometimesAppendedAwaitingScan(c: Registry): bool =
  c.project.repositories.length() == 2 and c.project.status == P::Paused and not(E::cleared(c.security))
pure def sometimesExemptionLapsedWithSteward(c: Registry): bool =
  c.security.exempt.contains(1) and c.project.steward != E::exemptStewardOf(c.security, 1) and not(E::repositoryCleared(c.security, 1))
pure def sometimesExemptAfterSetupCheck(c: Registry): bool =
  c.security.exempt.contains(1) and E::cleared(c.security) and c.project.status == P::Active and
  E::latestOf(c.security, 1).state == E::NotAssessed
pure val byValues = Set(-1, 0, 1, 2, 3, 5, 6)
pure val goodStanding: E::FlagStanding = { actor: 2, revision: 1, accountAgeDays: 30, acceptedContributions: 1, maintainer: E::ReadNo, banned: E::ReadNo }
pure val standingValues = Set(goodStanding, { ...goodStanding, actor: 3 }, { ...goodStanding, revision: 2 }, { ...goodStanding, actor: 3, revision: 2 })
pure val repositoryValues = Set(1, 2)
pure val assessmentIdValues = Set(1, 2, 3)
pure val creationValues = Set(P::creation1)
pure val accountValues = Set({ actor: 1, steward: 1, actorBan: NotBanned, stewardBan: NotBanned },
  { actor: 2, steward: 1, actorBan: NotBanned, stewardBan: NotBanned },
  { actor: 1, steward: 4, actorBan: NotBanned, stewardBan: NotBanned },
  { actor: 1, steward: 1, actorBan: AccountBanned, stewardBan: NotBanned },
  { actor: 2, steward: 1, actorBan: NotBanned, stewardBan: AccountBanned })
pure val registryValues = Set({ repository: 1, listedBy: 0, restricted: false }, { repository: 2, listedBy: 0, restricted: false })
pure val authorityValues = Set(P::owner1)
pure val checkValues = Set({ authority: P::owner1, installations: List({ repository: 1, installation: P::Installed }, { repository: 2, installation: P::Installed }) },
  { authority: { ...P::owner1, installation: P::InstallationUnavailable }, installations: List() })
pure val changeValues = Set(P::change1, { ...P::change1, presentation: false, financial: true, exclusionsChanged: true }, { ...P::change1, expectedRevision: 3, executable: true, clearance: P::ClearanceRetained },
  { ...P::change1, authority: { ...P::owner1, actor: 2 }, expectedRevision: 1 },
  { ...P::change1, authority: { ...P::owner1, actor: 2 }, expectedRevision: 1, clearance: P::ClearanceMissing })
pure val weight_publishUpdate = 4
pure val appendEvidenceValues = Set({ ...P::append1, expectedRevision: 1 }, P::append1)
pure val editValues = Set({ authority: P::owner1, expectedRevision: 2, checked: true })
pure val removalValues = Set({ authority: P::owner1, expectedRevision: 2 }, { authority: P::owner1, expectedRevision: 3 })
pure val requestValues = Set({ ...E::goodGrant, kind: E::OwnerApproved, branch: E::IntegrationBranch })
pure val fenceValues = E::fenceValues
pure val rowValues = Set({ projectId: 1, repository: 1 })
pure val pinsValues = tuples(0.to(2), 0.to(2), 0.to(2))
  .map(x => List({ repository: x._1, assessment: 1, pin: E::PinMatches }, { repository: x._2, assessment: 2, pin: E::PinMatches },
    { repository: x._3, assessment: 3, pin: E::PinMatches }).select(p => p.repository > 0))
  .union(tuples(1.to(3), 1.to(3)).filter(x => x._1 != x._2)
    .map(x => List({ repository: 1, assessment: x._1, pin: E::PinMatches }, { repository: 1, assessment: x._2, pin: E::PinChanged })))
pure val scanOutcomeValues = tuples(Set(1, 2, 3), 1.to(3), Set(A::DClean, A::DMalicious)).map(x =>
  { assessment: x._1, repository: if (x._1 == 3) 2 else 1, revision: x._2, disposition: x._3,
    confirmation: if (x._3 == A::DMalicious) A::ReproducibleBehavior else A::NoConfirmation, reused: false, retained: true })
pure val closureValues = Set({ project: 1, source: 0 }, { project: 1, source: 2 })
pure val evidenceValues = Set(
  { captured: { revision: 2, enforcementGeneration: 0, clearanceGeneration: 1 }, coverage: CompleteSnapshot },
  { captured: { revision: 2, enforcementGeneration: 0, clearanceGeneration: 1 }, coverage: PartialSnapshot })
pure val periodValues = Set(202611, 202612)
pure val evidenceReadValues = Set({ assessment: 1, present: false })
pure def renderedSkill(revision: int): SkillServing =
  { revision: revision, template: SR::templateA, approved: { digest: "d1", notes: List() },
    served: SR::publish(SR::templateA, { digest: "d1", notes: List() }) }
pure val skillValues = Set(renderedSkill(2), renderedSkill(1),
  { ...renderedSkill(2), served: SR::publish(SR::templateA, { digest: "d2", notes: List() }) })
pure val observedValues = tuples(1.to(3), Set(0), 1.to(3)).map(x => { revision: x._1, enforcementGeneration: x._2, clearanceGeneration: x._3 })
pure val exceptionValues = tuples(Set(P::Hold, P::ChangeSteward), 1.to(3)).map(x =>
  { kind: x._1, steward: if (x._1 == P::ChangeSteward) 4 else 0, expectedRevision: x._2, reason: 1 })
pure val revokeValues = Set({ grant: 11, decision: 1, reason: 1, confirmed: true })
pure val identityValues = Set(2)
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
pure val weight_grantExemption = 4
pure val weight_adminRevise = 3
pure val weight_remove = 3
```
