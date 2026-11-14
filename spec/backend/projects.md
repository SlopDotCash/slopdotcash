# Self-service project registry lifecycle

PRD sections 2, 4, 7 and 8 and the owner decisions of 24 October (D11),
11 November and 13 November 2026. This machine is one D1 project row and its
append-only revisions (`projects`, `project_revisions`), its repositories
(`project_repositories`) and the stored applications that may create or
update it (`project_applications`, migrations `0019`, `0020`, `0055`,
`0121`). Every manifest change appends exactly one immutable revision. The
referrer is recorded once, at creation or from the published application,
and never changes (migration `0055`). Applications an administrator approved
or rejected before self-service are kept as decided history
(`ApplicationDecidedLegacy`); no route reaches or leaves that state, and an
applicant's own withdrawal is exposed as cancelled.
Security restrictions and admission clearance are the
[enforcement machine](../security/enforcement.md); the
[composition](../projectComposition.md) joins them in one D1 batch and adds
the registry-wide checks (repository uniqueness, restricted repositories,
account bans) of the [registry](./projectRegistry.md).

Identities are permanent GitHub actor and repository ids. Every management
action carries one authority read from the Slopbot Worker
(`workers/slopbot/repository-access.ts`, the installation's
`collaborators/:login/permission` read): the actor, the repository it names,
the permission (write, maintain or admin is verified) and the installation
state. A read naming another actor or repository authorizes nothing, and an
unavailable read is a retry, never a denial and never a grant. Repository
facts come from the public GitHub read (`SLOP_GITHUB_READ_TOKEN`).
Administrators (`ADMIN_GITHUB_IDS`) are a configuration snapshot held in the
state.

## Story: Create or publish a project without routine approval

An owner creates a paused project at once; a stored applicant publishes a
pending application through the same checks; the setup check activates it.

### A project is one row of immutable revisions and separate application records

```quint
import closureConsent as C from "./closureConsent"
type Status = Active | Paused
type Tier = Community | Featured | Retired
type Retirement = NotRetired | OwnerRemoved | AdminDelisted | RestrictionRetired
type RevisionKind = Created | Activated | OwnerUpdate | RepositoryAppended | Removed | AdminHold | AdminDelist
  | AdminException | RestrictionRetirement | CommunityRestored | Placement | ConsentChanged
type Revision = { number: int, kind: RevisionKind, status: Status, tier: Tier, by: int }
type ApplicationPhase = NoApplication | ApplicationPending | ApplicationPublished | ApplicationCancelled | ApplicationDecidedLegacy
type Participation = OpenParticipation | Archived | PermissionRequired
type UpdatePhase = NoUpdate | UpdatePending | UpdateCancelled | UpdatePublished
type LicenseTerms = SpdxLicense | UnknownTerms | MixedTerms
type License = { terms: LicenseTerms, url: int, commit: int, digest: int }
type RepositoryStart = { repositoryId: int, month: int }
type EconomicTerm = { fromMonth: int, revision: int }
type Project = { creator: int, steward: int, referrer: int, administrators: List[int], participation: Participation,
  application: ApplicationPhase, applicant: int, update: UpdatePhase, updateApplicant: int, updateBase: int,
  revision: int, history: List[Revision], status: Status, tier: Tier, retirement: Retirement,
  repositories: List[int], starts: List[RepositoryStart], fieldsComplete: bool, branch: int, license: License,
  consent: C::SavedConsent, month: int, economic: List[EconomicTerm], asset: int, funded: bool }
pure val noLicense: License = { terms: UnknownTerms, url: 0, commit: 0, digest: 0 }
pure val initial: Project = { creator: 0, steward: 0, referrer: 3, administrators: List(5, 6, 7), participation: OpenParticipation,
  application: ApplicationPending, applicant: 1, update: UpdatePending, updateApplicant: 2, updateBase: 1,
  revision: 0, history: List(), status: Paused, tier: Community, retirement: NotRetired,
  repositories: List(1), starts: List({ repositoryId: 1, month: 202611 }), fieldsComplete: false, branch: 0,
  license: noLicense, consent: C::Absent, month: 202611, economic: List(), asset: 1, funded: false }
pure val noRevision: Revision = { number: 0, kind: Created, status: Paused, tier: Retired, by: 0 }
pure def currentRevision(p: Project): Revision = p.history.nthOr(p.revision - 1, noRevision)
pure def primary(p: Project): int = p.repositories.nthOr(0, 0)
pure def revised(kind: RevisionKind, by: int, status: Status, tier: Tier, p: Project): Project =
  { ...p, revision: p.revision + 1, status: status, tier: tier,
    history: p.history.append({ number: p.revision + 1, kind: kind, status: status, tier: tier, by: by }) }
pure def alwaysHistoryNumbered(p: Project): bool =
  p.revision == p.history.length() and p.history.every(r => r.number > 0 and r.number <= p.revision and
    p.history.every(q => q.number == r.number implies q == r))
pure def alwaysCurrentRevisionIsState(p: Project): bool =
  p.revision > 0 implies currentRevision(p).number == p.revision and currentRevision(p).status == p.status and currentRevision(p).tier == p.tier
pure def stepHistoryRetained(before: Project, after: Project): bool =
  after.history.length() >= before.history.length() and before.history.every(r => after.history.includes(r))
pure def stepRevisionAdvancesByOne(before: Project, after: Project): bool =
  after.revision == before.revision or after.revision == before.revision + 1
```

### Authority is one read bound to the acting account and the stored repository

```quint
type Permission = PermissionVerified | PermissionDenied | PermissionUnavailable
type Installation = Installed | InstallationMissing | InstallationSuspended | InstallationUnavailable
type AuthorityRead = { actor: int, repository: int, permission: Permission, installation: Installation }
pure def authorized(by: int, repository: int, read: AuthorityRead): bool =
  by > 0 and repository > 0 and read.actor == by and read.repository == repository and
  read.permission == PermissionVerified and read.installation == Installed
pure def currentAuthority(p: Project, by: int, read: AuthorityRead): bool = authorized(by, primary(p), read)
pure def lawUnavailableAuthorizesNothing(by: int, repository: int, authorityRead: AuthorityRead): bool =
  (authorityRead.permission != PermissionVerified or authorityRead.installation != Installed) implies not(authorized(by, repository, authorityRead))
pure val owner1: AuthorityRead = { actor: 1, repository: 1, permission: PermissionVerified, installation: Installed }
pure val authorityReadValues = Set(owner1, { ...owner1, actor: 2 }, { ...owner1, actor: 3 }, { ...owner1, permission: PermissionUnavailable },
  { ...owner1, permission: PermissionDenied }, { ...owner1, installation: InstallationMissing },
  { ...owner1, installation: InstallationSuspended }, { ...owner1, repository: 2 })
```

### Creation and stored-application publication record a paused revision 1

Creation checks the repository's public identity, its integration branch and
its license facts (SPDX or `unknown` or `mixed`, with LICENSE URL, commit and
digest), records the GitHub owner as steward, requires the complete
maintainer-authored skill fields, and records the closure consent of the
new-project form (unchecked by default, absent for a bounty-only setup).
Revision 1 is paused and listed in Community with no money. A stored applicant
publishes a pending application through the same checks, and becomes the
listing account; a cancelled application can never publish. Funding readiness
never controls creation.

```quint
type RepositoryFacts = { repository: int, owner: int, public: bool, archived: bool, fork: bool, branch: int }
type Creation = { authority: AuthorityRead, facts: RepositoryFacts, fieldsComplete: bool, license: License,
  fundingChoice: C::FundingChoice, closureChecked: bool, referrer: int }
pure def licenseRecorded(l: License): bool = l.url > 0 and l.commit > 0 and l.digest > 0
pure def creationValid(p: Project, by: int, creation: Creation): bool =
  p.revision == 0 and currentAuthority(p, by, creation.authority) and creation.facts.repository == primary(p) and
  creation.facts.owner > 0 and creation.facts.public and creation.facts.branch > 0 and
  creation.fieldsComplete and licenseRecorded(creation.license)
pure def created(by: int, creation: Creation, p: Project): Project =
  { ...revised(Created, by, Paused, Community, p), creator: by, steward: creation.facts.owner,
    starts: List({ repositoryId: primary(p), month: p.month }), fieldsComplete: true, branch: creation.facts.branch,
    license: creation.license, consent: C::newProjectConsent(creation.fundingChoice, creation.closureChecked) }
pure def canCreate(p: Project, by: int, creation: Creation): bool =
  (p.application == NoApplication or p.application == ApplicationCancelled) and creationValid(p, by, creation) and
  creation.referrer >= 0 and creation.referrer != by
pure def create(p: Project, by: int, creation: Creation): Project = { ...created(by, creation, p), referrer: creation.referrer }
pure def canPublishApplication(p: Project, by: int, creation: Creation): bool =
  p.application == ApplicationPending and by == p.applicant and creationValid(p, by, creation) and p.referrer != by
pure def publishApplication(p: Project, by: int, creation: Creation): Project =
  { ...created(by, creation, p), application: ApplicationPublished }
pure val facts1: RepositoryFacts = { repository: 1, owner: 1, public: true, archived: false, fork: false, branch: 1 }
pure val license1: License = { terms: SpdxLicense, url: 1, commit: 1, digest: 1 }
pure val creation1: Creation = { authority: owner1, facts: facts1, fieldsComplete: true, license: license1,
  fundingChoice: C::OrdinarySetup, closureChecked: false, referrer: 0 }
pure val creationValues = Set(creation1, { ...creation1, closureChecked: true },
  { ...creation1, license: { ...license1, terms: MixedTerms } }, { ...creation1, fundingChoice: C::BountyOnly, closureChecked: true },
  { ...creation1, authority: { ...owner1, permission: PermissionUnavailable } }, { ...creation1, fieldsComplete: false },
  { ...creation1, license: { ...license1, digest: 0 } }, { ...creation1, facts: { ...facts1, public: false } })
pure def alwaysCreatedFacts(p: Project): bool =
  p.revision > 0 implies p.creator > 0 and p.steward > 0 and p.branch > 0 and licenseRecorded(p.license)
pure def alwaysPublishedApplicationCreated(p: Project): bool =
  p.application == ApplicationPublished implies p.revision > 0 and p.creator == p.applicant
pure def stepCreatorFixed(before: Project, after: Project): bool =
  before.creator > 0 implies after.creator == before.creator and after.referrer == before.referrer
pure def lawDecidedLegacyApplicationsRefuse(p: Project, by: int, creation: Creation): bool =
  p.application == ApplicationDecidedLegacy implies not(canPublishApplication(p, by, creation)) and not(canCancelApplication(p, by))
```

### An applicant cancels a pending application or update without GitHub access

Cancellation competes atomically with publication; the first committed
transition wins. Repeating the applicant's cancellation succeeds and changes
nothing. A cancelled record is retained and never publishes.

```quint
pure def canCancelApplication(p: Project, by: int): bool =
  by == p.applicant and (p.application == ApplicationPending or p.application == ApplicationCancelled)
pure def cancelApplication(p: Project, by: int): Project = { ...p, application: ApplicationCancelled }
pure def canCancelUpdate(p: Project, by: int): bool =
  by == p.updateApplicant and (p.update == UpdatePending or p.update == UpdateCancelled)
pure def cancelUpdate(p: Project, by: int): Project = { ...p, update: UpdateCancelled }
pure def stepCancellationFinal(before: Project, after: Project): bool =
  (before.application == ApplicationCancelled implies after.application == ApplicationCancelled) and
  (before.update == UpdateCancelled implies after.update == UpdateCancelled) and
  (before.application == ApplicationPublished implies after.application == ApplicationPublished)
pure def stepCancellationAppendsNothing(before: Project, via: str, after: Project): bool =
  (via == "cancelApplication" or via == "cancelUpdate") implies after.revision == before.revision
```

### The setup check activates a paused project that passes every check

The account running the check needs current authority on the primary
repository, and every repository needs an installed Slopbot. The project must
be registered, paused, not retired and have complete skill fields. Admission
clearance and restrictions are checked by the composition. A clean scan result
reruns this check for the recorded creator; the scan grants no authority.
Activation is its own revision.

```quint
type InstallationRead = { repository: int, installation: Installation }
type SetupCheck = { authority: AuthorityRead, installations: List[InstallationRead] }
pure def everyRepositoryInstalled(p: Project, check: SetupCheck): bool =
  p.repositories.every(r => check.installations.some(i => i.repository == r and i.installation == Installed))
pure def canActivate(p: Project, by: int, check: SetupCheck): bool =
  p.revision > 0 and p.status == Paused and p.retirement == NotRetired and p.fieldsComplete and
  p.participation == OpenParticipation and
  currentAuthority(p, by, check.authority) and everyRepositoryInstalled(p, check)
pure def activate(p: Project, by: int, check: SetupCheck): Project = revised(Activated, by, Active, p.tier, p)
pure val checkValues = Set({ authority: owner1, installations: List({ repository: 1, installation: Installed }) },
  { authority: owner1, installations: List({ repository: 1, installation: Installed }, { repository: 2, installation: Installed }) },
  { authority: owner1, installations: List({ repository: 1, installation: Installed }, { repository: 2, installation: InstallationSuspended }) },
  { authority: { ...owner1, permission: PermissionUnavailable }, installations: List({ repository: 1, installation: Installed }) })
pure def alwaysActiveRequirements(p: Project): bool =
  p.status == Active implies p.revision > 0 and p.retirement == NotRetired and p.tier != Retired and p.fieldsComplete
```

## Story: Maintain a live project with current GitHub authority

### Owner revisions publish at once against the expected revision

The server classifies the submitted manifest against the current one
(`classifyRevisionChanges`): presentation, executable skill inputs and
financial policy. A revision that changes nothing, or a field reserved to
administrators (steward, authority, terms, status, listing tier, `skill`,
`reviewSkill`), is refused. Status and tier are kept, except that missing
skill fields pause the project, and an executable change pauses it when its
admission clearance is not retained (the composition reads the clearance).
Financial policy applies from the next UTC calendar month; earlier months keep
their terms. A funded project keeps its reward asset.

```quint
type Clearance = ClearanceRetained | ClearanceMissing
type OwnerChange = { authority: AuthorityRead, expectedRevision: int, presentation: bool, executable: bool,
  financial: bool, restrictedField: bool, fieldsComplete: bool, asset: int, clearance: Clearance }
pure def changeValid(p: Project, by: int, change: OwnerChange): bool =
  p.revision > 0 and p.retirement == NotRetired and change.expectedRevision == p.revision and
  currentAuthority(p, by, change.authority) and not(change.restrictedField) and
  (change.presentation or change.executable or change.financial) and change.asset > 0 and
  (change.asset != p.asset implies change.financial and not(p.funded))
pure def changed(by: int, change: OwnerChange, p: Project): Project =
  val pauses = not(change.fieldsComplete) or (change.executable and change.clearance == ClearanceMissing)
  { ...revised(OwnerUpdate, by, if (pauses) Paused else p.status, p.tier, p), fieldsComplete: change.fieldsComplete, asset: change.asset,
    economic: if (change.financial) p.economic.append({ fromMonth: p.month + 1, revision: p.revision + 1 }) else p.economic }
pure def canPublishOwnerRevision(p: Project, by: int, change: OwnerChange): bool = changeValid(p, by, change)
pure def publishOwnerRevision(p: Project, by: int, change: OwnerChange): Project = changed(by, change, p)
pure def canPublishUpdate(p: Project, by: int, change: OwnerChange): bool =
  p.update == UpdatePending and by == p.updateApplicant and p.revision == p.updateBase and changeValid(p, by, change)
pure def publishUpdate(p: Project, by: int, change: OwnerChange): Project = { ...changed(by, change, p), update: UpdatePublished }
pure def updatePublishable(p: Project): bool = p.update == UpdatePending and p.revision == p.updateBase
pure val change1: OwnerChange = { authority: owner1, expectedRevision: 2, presentation: true, executable: false, financial: false,
  restrictedField: false, fieldsComplete: true, asset: 1, clearance: ClearanceRetained }
pure val changeValues = Set(change1, { ...change1, expectedRevision: 1 }, { ...change1, expectedRevision: 3 },
  { ...change1, presentation: false, financial: true }, { ...change1, presentation: false, financial: true, asset: 2 },
  { ...change1, executable: true, clearance: ClearanceMissing }, { ...change1, fieldsComplete: false },
  { ...change1, restrictedField: true }, { ...change1, presentation: false },
  { ...change1, authority: { ...owner1, actor: 2 } }, { ...change1, authority: { ...owner1, actor: 2 }, expectedRevision: 1 })
pure def alwaysEconomicTermsPrecedeNothing(p: Project): bool =
  p.economic.every(t => t.revision > 0 and t.revision <= p.revision and t.fromMonth > 202611 and t.fromMonth <= p.month + 1)
pure def stepEconomicTermsRetained(before: Project, after: Project): bool =
  after.economic.length() >= before.economic.length() and before.economic.every(t => after.economic.includes(t))
pure def stepFundedAssetFixed(before: Project, after: Project): bool = before.funded implies after.asset == before.asset
```

### Appending a repository pauses the project and its work counts from next month

The new repository is public, not archived and not a fork, with its own
integration branch; the acting owner holds current authority on the primary
repository and through a Slopbot installation on the new one. The registry
checks that no project lists its permanent ids. At most 20 repositories are
listed. An append never removes, reorders or renames a listed repository. The
original repository's eligibility and the economic terms do not change.

```quint
type Append = { expectedRevision: int, authority: AuthorityRead, appended: AuthorityRead, facts: RepositoryFacts }
pure def canAppendRepository(p: Project, by: int, appendEvidence: Append): bool =
  p.revision > 0 and p.retirement == NotRetired and appendEvidence.expectedRevision == p.revision and p.repositories.length() < 20 and
  currentAuthority(p, by, appendEvidence.authority) and authorized(by, appendEvidence.facts.repository, appendEvidence.appended) and
  appendEvidence.facts.repository > 0 and not(p.repositories.includes(appendEvidence.facts.repository)) and
  appendEvidence.facts.public and not(appendEvidence.facts.archived) and not(appendEvidence.facts.fork) and appendEvidence.facts.branch > 0
pure def appendRepository(p: Project, by: int, appendEvidence: Append): Project =
  { ...revised(RepositoryAppended, by, Paused, p.tier, p), repositories: p.repositories.append(appendEvidence.facts.repository),
    starts: p.starts.append({ repositoryId: appendEvidence.facts.repository, month: p.month + 1 }) }
pure val facts2: RepositoryFacts = { ...facts1, repository: 2 }
pure val append1: Append = { expectedRevision: 2, authority: owner1, appended: { ...owner1, repository: 2 }, facts: facts2 }
pure val appendEvidenceValues = Set(append1, { ...append1, expectedRevision: 1 }, { ...append1, expectedRevision: 3 },
  { ...append1, facts: { ...facts2, fork: true } }, { ...append1, facts: { ...facts2, archived: true } },
  { ...append1, appended: { ...owner1, repository: 2, installation: InstallationMissing } },
  { ...append1, facts: facts1, appended: owner1 })
pure def alwaysRepositoryBound(p: Project): bool = p.repositories.length() >= 1 and p.repositories.length() <= 20
pure def alwaysRepositoryStarts(p: Project): bool =
  p.starts.every(start => start.month >= 0 and p.repositories.includes(start.repositoryId)) and
  p.repositories.every(id => p.starts.select(start => start.repositoryId == id).length() == 1)
pure def stepRepositoriesRetained(before: Project, after: Project): bool =
  after.repositories.length() >= before.repositories.length() and before.repositories.every(id => after.repositories.includes(id)) and
  primary(after) == primary(before)
pure def stepRepositoryStartsRetained(before: Project, after: Project): bool =
  before.revision > 0 implies before.starts.every(start => after.starts.includes(start))
pure def repositoryEligible(p: Project, repositoryId: int, period: int): bool =
  p.starts.some(start => start.repositoryId == repositoryId and period >= start.month)
```

### Automatic-closure consent changes only by an owner revision

Editing appends a revision at the expected revision under current authority.
Unchecking an explicit Yes records No; an untouched missing setting stays
absent. A write that would change nothing is refused.

```quint
type ConsentEdit = { authority: AuthorityRead, expectedRevision: int, checked: bool }
pure def canEditConsent(p: Project, by: int, edit: ConsentEdit): bool =
  p.revision > 0 and p.retirement == NotRetired and edit.expectedRevision == p.revision and
  currentAuthority(p, by, edit.authority) and C::savedEdit(p.consent, edit.checked) != p.consent
pure def editConsent(p: Project, by: int, edit: ConsentEdit): Project =
  { ...revised(ConsentChanged, by, p.status, p.tier, p), consent: C::savedEdit(p.consent, edit.checked) }
pure val editValues = Set({ authority: owner1, expectedRevision: 2, checked: true }, { authority: owner1, expectedRevision: 3, checked: false },
  { authority: owner1, expectedRevision: 2, checked: false }, { authority: { ...owner1, actor: 2 }, expectedRevision: 2, checked: true })
```

### A current maintainer removes a project and a lost reply can be retried

Removal rechecks current authority on the stored primary repository, even on
a retry. It appends a paused, retired revision and never runs activation. A
project that is already paused and retired returns success unchanged. History,
earned Points, private cases and funded obligations are kept.

```quint
type Removal = { authority: AuthorityRead, expectedRevision: int }
pure def canRemove(p: Project, by: int, removal: Removal): bool =
  p.revision > 0 and currentAuthority(p, by, removal.authority) and
  (p.retirement != NotRetired or removal.expectedRevision == p.revision)
pure def remove(p: Project, by: int, removal: Removal): Project =
  if (p.retirement != NotRetired) p else { ...revised(Removed, by, Paused, Retired, p), retirement: OwnerRemoved }
pure val removalValues = Set({ authority: owner1, expectedRevision: 2 }, { authority: owner1, expectedRevision: 3 },
  { authority: { ...owner1, permission: PermissionUnavailable }, expectedRevision: 2 })
pure def stepRemovalReplayAppendsNothing(before: Project, via: str, after: Project): bool =
  (via == "remove" and before.retirement != NotRetired) implies after == before
pure def stepOwnerRemovalPermanent(before: Project, after: Project): bool =
  (before.retirement == OwnerRemoved implies after.retirement == OwnerRemoved) and
  (before.retirement == AdminDelisted implies after.retirement == AdminDelisted)
```

## Story: Administrators handle exceptions and restrictions, not routine approval

### Administrators hold, delist, change the steward or place a project

A plain paused hold is reactivated by the owner's next passing setup check
(D11); a delisting appends a paused, retired revision that setup never
reactivates. Steward changes use the administrator exception path. Featured
placement is an administrator decision and never depends on funding. The
manifest's `participation` state (`archived` with a successor project, or
`permission-required`) is administrator-only and keeps the project paused.

```quint
type AdminKind = Hold | Delist | ChangeSteward | ArchiveParticipation | RequirePermission | OpenParticipationAgain
pure def canAdminRevise(p: Project, by: int, kind: AdminKind, steward: int): bool =
  p.administrators.includes(by) and p.revision > 0 and p.retirement == NotRetired and
  (if (kind == ChangeSteward) steward > 0 and steward != p.steward else steward == 0) and
  (kind == ArchiveParticipation implies p.participation != Archived) and
  (kind == RequirePermission implies p.participation != PermissionRequired) and
  (kind == OpenParticipationAgain implies p.participation != OpenParticipation)
pure def adminRevise(p: Project, by: int, kind: AdminKind, steward: int): Project =
  if (kind == Hold) revised(AdminHold, by, Paused, p.tier, p)
  else if (kind == Delist) { ...revised(AdminDelist, by, Paused, Retired, p), retirement: AdminDelisted }
  else if (kind == ArchiveParticipation) { ...revised(AdminException, by, Paused, p.tier, p), participation: Archived }
  else if (kind == RequirePermission) { ...revised(AdminException, by, Paused, p.tier, p), participation: PermissionRequired }
  else if (kind == OpenParticipationAgain) { ...revised(AdminException, by, p.status, p.tier, p), participation: OpenParticipation }
  else { ...revised(AdminException, by, p.status, p.tier, p), steward: steward }
pure def canPlace(p: Project, by: int, tier: Tier): bool =
  p.administrators.includes(by) and p.revision > 0 and p.retirement == NotRetired and tier != Retired and tier != p.tier
pure def place(p: Project, by: int, tier: Tier): Project = revised(Placement, by, p.status, tier, p)
pure val stewardValues = Set(0, 4)
pure def alwaysRestrictedParticipationPaused(p: Project): bool = p.participation != OpenParticipation implies p.status == Paused
pure def alwaysRetirementConsistent(p: Project): bool =
  (p.retirement != NotRetired iff p.tier == Retired) and (p.retirement != NotRetired implies p.status == Paused)
```

### A restriction retires the listing and reinstatement restores only a paused Community listing

A quarantine or ban appends a paused, retired revision in the same batch when
the project is listed; a project already retired needs none. Reinstatement
restores a paused Community revision only for a project the restriction
retired: never featuring, activation or money. These registry steps have no
sender of their own; the composition performs them with the enforcement
decision.

```quint
pure def canRetireForRestriction(p: Project): bool = p.revision > 0 and p.retirement == NotRetired
pure def retireForRestriction(p: Project): Project =
  { ...revised(RestrictionRetirement, 0, Paused, Retired, p), retirement: RestrictionRetired }
pure def canRestoreCommunity(p: Project): bool = p.retirement == RestrictionRetired
pure def restoreCommunity(p: Project): Project =
  { ...revised(CommunityRestored, 0, Paused, Community, p), retirement: NotRetired }
pure def stepRestorationIsPausedCommunity(before: Project, via: str, after: Project): bool =
  via == "restoreCommunity" implies after.status == Paused and after.tier == Community
pure def stepOnlyReinstatementUnretires(before: Project, via: str, after: Project): bool =
  (before.retirement != NotRetired and after.retirement == NotRetired) implies via == "restoreCommunity"
```

### Funding is observed separately and the clock only advances

Finalized vault funding comes from the settlement snapshot of the project's
vault; it appends no revision and changes no placement.

```quint
type FundingEvidence = { finalizedDeposits: int }
pure def canRecordFunding(p: Project, funding: FundingEvidence): bool = p.revision > 0 and funding.finalizedDeposits > 0
pure def recordFunding(p: Project, funding: FundingEvidence): Project = { ...p, funded: true }
pure val fundingValues = Set({ finalizedDeposits: 0 }, { finalizedDeposits: 1 })
pure def canAdvanceMonth(p: Project, month: int): bool = month > p.month
pure def advanceMonth(p: Project, month: int): Project = { ...p, month: month }
pure val monthValues = Set(202612, 202701)
pure def stepEveryManifestChangeAppendsRevision(before: Project, after: Project): bool =
  (before.status != after.status or before.tier != after.tier or before.retirement != after.retirement or
    before.repositories != after.repositories or before.consent != after.consent or before.steward != after.steward or
    before.fieldsComplete != after.fieldsComplete or before.economic != after.economic or before.asset != after.asset or
    before.participation != after.participation)
    implies after.revision == before.revision + 1
pure def stepClockMonotone(before: Project, after: Project): bool = after.month >= before.month
```

### Reachable registry outcomes

```quint
pure def listed(p: Project): bool = p.revision > 0 and p.tier != Retired
pure def sometimesCreatedPaused(p: Project): bool = p.revision == 1 and p.status == Paused and listed(p) and p.application != ApplicationPublished
pure def sometimesApplicationPublished(p: Project): bool = p.application == ApplicationPublished
pure def sometimesActive(p: Project): bool = p.status == Active
pure def sometimesCancelledUnpublished(p: Project): bool = p.application == ApplicationCancelled and p.revision == 0
pure def sometimesStaleUpdateCancelled(p: Project): bool = p.update == UpdateCancelled and p.revision > p.updateBase
pure def sometimesUpdatePublished(p: Project): bool = p.update == UpdatePublished
pure def sometimesOwnerRemoved(p: Project): bool = p.retirement == OwnerRemoved
pure def sometimesDelisted(p: Project): bool = p.retirement == AdminDelisted
pure def sometimesHeldThenActive(p: Project): bool = p.status == Active and p.history.some(r => r.kind == AdminHold)
pure def sometimesRestoredCommunity(p: Project): bool = p.history.some(r => r.kind == CommunityRestored) and p.tier == Community
pure def sometimesFeatured(p: Project): bool = p.tier == Featured
pure def sometimesPausedWithoutSkillFields(p: Project): bool = p.revision > 0 and not(p.fieldsComplete)
pure def sometimesAppendedRepositoryDeferred(p: Project): bool =
  p.starts.some(start => start.month > p.starts.nthOr(0, start).month and repositoryEligible(p, primary(p), p.month) and
    not(repositoryEligible(p, start.repositoryId, p.month)))
pure def sometimesNextMonthTerms(p: Project): bool = p.economic.length() > 0
pure def sometimesLaterSteward(p: Project): bool = p.steward != p.creator and p.revision > 0
pure def sometimesClosureEnabled(p: Project): bool = p.consent == C::Enabled
pure val byValues = Set(0, 1, 2, 5)
pure val repositoryValues = Set(1, 2)
pure val tierValues = Set(Community, Featured)
pure val weight_create = 6
pure val weight_publishApplication = 6
pure val weight_activate = 4
pure val weight_publishOwnerRevision = 4
pure val weight_appendRepository = 3
```
