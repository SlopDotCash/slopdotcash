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
[composition](./projectComposition.md) joins them in one D1 batch and adds
the registry-wide checks (repository uniqueness, restricted repositories,
account bans) of the [registry](./projectRegistry.md).

Identities are permanent GitHub actor and repository ids. Every management
action carries one authority read from the Slopbot Worker
(`workers/slopbot/repository-access.ts`, the installation's
`collaborators/:login/permission` read): the actor, the repository it names,
the permission (write, maintain or admin is verified) and the installation
state. A read naming another actor or repository authorizes nothing, and an
unavailable read is a retry, never a denial and never a grant. Repository
facts come from the public GitHub read (`SLOP_GITHUB_READ_TOKEN`). The
setup form's lookups (`GET /project-github/owned-repositories` and
`GET /project-github/repositories/:owner/:name`) need a signed-in session,
are cached for 300 seconds (owned repositories per actor, repository facts
for every caller) and are shell reads with no state here: a lookup grants no
authority, a failed or partial lookup fills no fact, and every fact is read
again when the event commits.
Administrators (`ADMIN_GITHUB_IDS`) are a configuration snapshot held in the
state. The actor `-1` is the project API's own scheduled jobs (the UTC month
clock); the shell supplies it only for work it starts itself, never for an
HTTP request. The actor `-2` is the settlement area's vault setup service
(`POST /api/v1/project-vaults/:id` and its saved-creation sweep), which
supplies it only after it verified a finalized vault creation itself.

## Story: Create or publish a project without routine approval

An owner creates a paused project at once; a stored applicant publishes a
pending application through the same checks; the setup check activates it.

### A project is one row of immutable revisions and separate application records

Development keeps at most one pending application per project (migration
`0019`, index `project_applications_one_pending_project`). The `initial`
state here is not a development state: it holds a pending creation
application and a pending update application of the same project at once
only so that one machine reaches both publication paths, since no route
stores a new application. The one-pending guarantee is not stated as a rule
until stored update applications are modelled on a published project of
their own.
The current revision is the latest appended one. Discovered by proof: read
by its number (`p.revision - 1`), a project whose history is not numbered
made the law that a consent-only save records `ConsentChanged` false for
some values of its parameters; every reachable project keeps
`alwaysHistoryNumbered`, where the two readings agree. The app reads the
same entry: the store takes the last appended revision and refuses unless its
number is the next one (`apps/backend/src/projects/store/store.vibe`), and the
registry triggers keep the project row at that appended revision
(`migrations/0019_project_registry.sql`).

```quint
import closureConsent as C from "./closureConsent"
type Status = Active | Paused
type Tier = Community | Featured | Retired
type Retirement = NotRetired | OwnerRemoved | AdminDelisted | RestrictionRetired
type RevisionKind = Created | Activated | OwnerUpdate | RepositoryAppended | Removed | AdminHold | AdminDelist
  | AdminException | RestrictionRetirement | CommunityRestored | Placement | ConsentChanged | VaultRegistered
type Revision = { number: int, kind: RevisionKind, status: Status, tier: Tier, by: int }
type ApplicationPhase = NoApplication | ApplicationPending | ApplicationPublished | ApplicationCancelled | ApplicationDecidedLegacy
type Participation = OpenParticipation | Archived | PermissionRequired
type UpdatePhase = NoUpdate | UpdatePending | UpdateCancelled | UpdatePublished
type LicenseTerms = SpdxLicense | UnknownTerms | MixedTerms
type License = { terms: LicenseTerms, url: int, commit: int, digest: int }
type RepositoryStart = { repositoryId: int, month: int }
type EconomicTerm = { fromMonth: int, revision: int }
type VaultRecords = { ordinary: bool, bounty: bool }
type Project = { creator: int, steward: int, referrer: int, administrators: List[int], participation: Participation,
  application: ApplicationPhase, applicant: int, update: UpdatePhase, updateApplicant: int, updateBase: int,
  revision: int, history: List[Revision], status: Status, tier: Tier, retirement: Retirement,
  repositories: List[int], starts: List[RepositoryStart], fieldsComplete: bool, branch: int, license: License,
  consent: C::SavedConsent, month: int, economic: List[EconomicTerm], network: int, asset: int, funded: bool,
  honorSystem: bool, vaults: VaultRecords, share: int, shareHistory: List[ShareEntry] }
pure val noLicense: License = { terms: UnknownTerms, url: 0, commit: 0, digest: 0 }
pure val noVaults: VaultRecords = { ordinary: false, bounty: false }
pure val initial: Project = { creator: 0, steward: 0, referrer: 3, administrators: List(5, 6, 7), participation: OpenParticipation,
  application: ApplicationPending, applicant: 1, update: UpdatePending, updateApplicant: 2, updateBase: 1,
  revision: 0, history: List(), status: Paused, tier: Community, retirement: NotRetired,
  repositories: List(1), starts: List({ repositoryId: 1, month: 202611 }), fieldsComplete: false, branch: 0,
  license: noLicense, consent: C::Absent, month: 202611, economic: List(), network: 1, asset: 1, funded: false,
  honorSystem: false, vaults: noVaults, share: 0, shareHistory: List() }
pure val platform = -1
pure val noRevision: Revision = { number: 0, kind: Created, status: Paused, tier: Retired, by: 0 }
pure def currentRevision(p: Project): Revision = p.history.nthOr(p.history.length() - 1, noRevision)
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
its license facts (`repositoryLicense`: verified SPDX or mixed terms with
LICENSE URL, commit and digest, or `unknown` with none of them, which invents
no terms), records the GitHub owner as steward, requires the complete
maintainer-authored skill fields, and records the closure consent of the
new-project form (unchecked by default, absent for a bounty-only setup) and
the reward's honor-system promise (valid as below; the form starts it
unchecked) and its maintainer share (below), with no share history: a
submitted `reward.maintainerShareHistory` is refused (422 `invalid_manifest`,
"A new project has no maintainer share history; set only the maintainer
share"). Revision 1 is paused and listed in Community with no money. A
stored applicant publishes a pending application through the same checks,
and becomes the listing account; a cancelled application can never publish.
Funding readiness never controls creation.

```quint
type RepositoryFacts = { repository: int, owner: int, public: bool, archived: bool, fork: bool, branch: int }
type Creation = { authority: AuthorityRead, facts: RepositoryFacts, fieldsComplete: bool, license: License,
  fundingChoice: C::FundingChoice, closureChecked: bool, referrer: int, reward: RewardPromise, shareHistory: List[ShareEntry] }
pure def licenseRecorded(l: License): bool = l.url > 0 and l.commit > 0 and l.digest > 0
pure def licenseValid(l: License): bool =
  if (l.terms == UnknownTerms) l.url == 0 and l.commit == 0 and l.digest == 0 else licenseRecorded(l)
pure def creationValid(p: Project, by: int, creation: Creation): bool =
  p.revision == 0 and currentAuthority(p, by, creation.authority) and creation.facts.repository == primary(p) and
  creation.facts.owner > 0 and creation.facts.public and creation.facts.branch > 0 and
  creation.fieldsComplete and licenseValid(creation.license) and honorSystemValid(creation.reward) and
  shareValid(creation.reward) and creation.shareHistory == List()
pure def created(by: int, creation: Creation, p: Project): Project =
  { ...revised(Created, by, Paused, Community, p), creator: by, steward: creation.facts.owner,
    starts: List({ repositoryId: primary(p), month: p.month }), fieldsComplete: true, branch: creation.facts.branch,
    license: creation.license, consent: C::newProjectConsent(creation.fundingChoice, creation.closureChecked),
    honorSystem: creation.reward.honor == HonorTrue, share: creation.reward.share, shareHistory: List() }
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
  fundingChoice: C::OrdinarySetup, closureChecked: false, referrer: 0, reward: noPromise, shareHistory: List() }
pure val creationValues = Set(creation1, { ...creation1, closureChecked: true },
  { ...creation1, license: { ...license1, terms: MixedTerms } }, { ...creation1, fundingChoice: C::BountyOnly, closureChecked: true },
  { ...creation1, authority: { ...owner1, permission: PermissionUnavailable } }, { ...creation1, fieldsComplete: false },
  { ...creation1, license: { ...license1, digest: 0 } }, { ...creation1, facts: { ...facts1, public: false } },
  { ...creation1, license: noLicense }, { ...creation1, license: { ...noLicense, url: 1 } },
  { ...creation1, reward: { ...noPromise, honor: HonorTrue } }, { ...creation1, reward: { ...noPromise, monthlyAmount: 0, honor: HonorTrue } },
  { ...creation1, reward: { ...noPromise, share: 2000 } }, { ...creation1, shareHistory: List({ throughMonth: 202611, basisPoints: 0 }) })
pure def alwaysCreatedFacts(p: Project): bool =
  (p.revision > 0 implies p.creator > 0 and p.steward > 0 and p.branch > 0 and licenseValid(p.license)) and
  (p.revision == 0 implies p.creator == 0 and p.retirement == NotRetired and p.status == Paused)
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
be registered, paused, not retired and have complete skill fields. An active
project needs known mandatory terms, so a project whose license is
`unknown` stays paused (`active projects require known mandatory terms`).
Admission clearance and restrictions are checked by the composition. A clean
scan result reruns this check for the recorded creator; the scan grants no
authority. Activation is its own revision.

```quint
type InstallationRead = { repository: int, installation: Installation }
type SetupCheck = { authority: AuthorityRead, installations: List[InstallationRead] }
pure def everyRepositoryInstalled(p: Project, check: SetupCheck): bool =
  p.repositories.every(r => check.installations.some(i => i.repository == r and i.installation == Installed))
pure def canActivate(p: Project, by: int, check: SetupCheck): bool =
  p.revision > 0 and p.status == Paused and p.retirement == NotRetired and p.fieldsComplete and
  p.participation == OpenParticipation and p.license.terms != UnknownTerms and
  currentAuthority(p, by, check.authority) and everyRepositoryInstalled(p, check)
pure def activate(p: Project, by: int, check: SetupCheck): Project = revised(Activated, by, Active, p.tier, p)
pure val checkValues = Set({ authority: owner1, installations: List({ repository: 1, installation: Installed }) },
  { authority: owner1, installations: List({ repository: 1, installation: Installed }, { repository: 2, installation: Installed }) },
  { authority: owner1, installations: List({ repository: 1, installation: Installed }, { repository: 2, installation: InstallationSuspended }) },
  { authority: { ...owner1, permission: PermissionUnavailable }, installations: List({ repository: 1, installation: Installed }) })
pure def alwaysActiveRequirements(p: Project): bool =
  p.status == Active implies p.revision > 0 and p.retirement == NotRetired and p.tier != Retired and p.fieldsComplete and
    p.license.terms != UnknownTerms
```

## Story: Maintain a live project with current GitHub authority

### Owner revisions publish at once against the expected revision

One save (`PUT /api/v1/projects/:id`) publishes everything it changes as one
revision: there is no "one change at a time" refusal. The server classifies
the submitted manifest against the current one
(`classifyRevisionChanges`, `src/lib/project-revision-changes.ts`):
presentation (name, eyebrow, headline, image, description, links, `security`,
the report deposit setting, and every `slopbot` setting: the
automatic-closure consent, the [ready label](./readyLabelSettings.md), the
[intake cap](./intakeCap.md), the [submission fee](./submissionFeeSettings.md)
and wanted issues, each published at once), executable skill inputs (appended
repositories and `contribution`) and financial policy (reward, among it the
maintainer share below, reward asset, escrow, funding, security bounty). The
registry parses each of those settings with development's limits and texts
(`src/lib/project-schema.mjs`); what a setting means is its owner's rule. A
save that names `integrationBranch` instead of `manifest` is the
integration-branch change below, not an owner revision of this kind.
The project's website and X account (`links.website`,
`links.x`), which an owner sets or clears, are presentation links, not
material terms ([project page links](../frontend/projectLinks.md)). A consent
edit in the save (`consent`) is recorded as the
[closure consent](./closureConsent.md) edit below records it, and only when
it changes the saved meaning. Repositories appended in the save (`appends`,
any number up to 20 listed in all) are each verified as an appended
repository below, before anything is recorded; they pause the project and
count from next month. This is the only owner save: there is no separate
consent or append request. The revision's kind is derived from what the save
changes: `RepositoryAppended` when it appends a repository, else
`ConsentChanged` when the consent is its only change, else `OwnerUpdate`. The
five classification fields of `OwnerChange` (`presentation`, `executable`,
`financial`, `restrictedField`, `fieldsComplete`) are that classifier's output
over the stored and the submitted manifest, computed by the project API, with
`presentation` meaning a presentation field other than the consent differs; a
client never supplies them (shell obligation). A revision that changes nothing, or a field reserved
to administrators (steward, authority, terms, status, listing tier, `skill`,
`reviewSkill`), is refused. Status and tier are kept: an active project's
revision that leaves the generated-skill fields incomplete is refused
(`skill_content_incomplete`), and an executable change pauses an active
project when its admission clearance is not retained (`scanRequired` in
`publishOwnerRevision`; the composition reads the clearance). An owner-removed
or delisted project accepts owner revisions and stays paused and retired, as
the project API does.
Financial policy applies from the next UTC calendar month; earlier months keep
their terms. An unfunded project may change its network and asset; a funded
one keeps them. A change to the payout exclusions is financial; the
[composition](./projectComposition.md) checks that it is only prospective.

```quint
type Clearance = ClearanceRetained | ClearanceMissing
type ConsentChoice = ConsentUntouched | ConsentChecked | ConsentUnchecked
type NewRepository = { appended: AuthorityRead, facts: RepositoryFacts }
type OwnerChange = { authority: AuthorityRead, expectedRevision: int, presentation: bool, executable: bool,
  financial: bool, restrictedField: bool, fieldsComplete: bool, network: int, asset: int, exclusionsChanged: bool,
  clearance: Clearance, consent: ConsentChoice, appends: List[NewRepository], reward: RewardPromise,
  shareHistory: List[ShareEntry] }
pure def consentAfter(prior: C::SavedConsent, choice: ConsentChoice): C::SavedConsent =
  if (choice == ConsentUntouched) prior else C::savedEdit(prior, choice == ConsentChecked)
pure def appendsValid(p: Project, by: int, appends: List[NewRepository]): bool =
  p.repositories.length() + appends.length() <= 20 and
  appends.every(a => appendable(p, by, a) and appends.select(b => b.facts.repository == a.facts.repository).length() == 1)
pure def changeValid(p: Project, by: int, change: OwnerChange): bool =
  p.revision > 0 and p.retirement != RestrictionRetired and change.expectedRevision == p.revision and
  currentAuthority(p, by, change.authority) and not(change.restrictedField) and
  (change.fieldsComplete or p.status == Paused) and
  (change.presentation or change.executable or change.financial or change.consent != ConsentUntouched) and
  change.network > 0 and change.asset > 0 and
  ((change.network != p.network or change.asset != p.asset) implies change.financial and not(p.funded)) and
  (change.exclusionsChanged implies change.financial) and
  (change.consent != ConsentUntouched implies consentAfter(p.consent, change.consent) != p.consent) and
  (change.appends.length() > 0 implies change.executable) and appendsValid(p, by, change.appends) and
  honorSystemValid(change.reward) and (honorChanged(p, change.reward) implies change.financial) and
  shareValid(change.reward) and (change.reward.share != p.share implies change.financial) and
  change.shareHistory == p.shareHistory and (change.shareHistory == List() or change.reward.monthlyPool)
pure def consentOnly(change: OwnerChange): bool =
  change.consent != ConsentUntouched and not(change.presentation) and not(change.executable) and not(change.financial) and
  change.appends.length() == 0
pure def ownerRevisionKind(change: OwnerChange): RevisionKind =
  if (change.appends.length() > 0) RepositoryAppended else if (consentOnly(change)) ConsentChanged else OwnerUpdate
pure def changed(by: int, change: OwnerChange, p: Project): Project =
  val added = change.appends.listMap(a => a.facts.repository)
  val pauses = added.length() > 0 or (change.executable and change.clearance == ClearanceMissing)
  { ...revised(ownerRevisionKind(change), by, if (pauses) Paused else p.status, p.tier, p),
    fieldsComplete: change.fieldsComplete, network: change.network, asset: change.asset,
    consent: consentAfter(p.consent, change.consent), honorSystem: change.reward.honor == HonorTrue,
    share: change.reward.share, shareHistory: prospectiveShare(p, change.reward.share),
    repositories: p.repositories.concat(added), starts: p.starts.concat(added.listMap(r => { repositoryId: r, month: p.month + 1 })),
    economic: if (change.financial) p.economic.append({ fromMonth: p.month + 1, revision: p.revision + 1 }) else p.economic }
pure def canPublishOwnerRevision(p: Project, by: int, change: OwnerChange): bool = changeValid(p, by, change)
pure def publishOwnerRevision(p: Project, by: int, change: OwnerChange): Project = changed(by, change, p)
pure def canPublishUpdate(p: Project, by: int, change: OwnerChange): bool =
  p.update == UpdatePending and by == p.updateApplicant and p.revision == p.updateBase and changeValid(p, by, change)
pure def publishUpdate(p: Project, by: int, change: OwnerChange): Project = { ...changed(by, change, p), update: UpdatePublished }
pure def updatePublishable(p: Project): bool = p.update == UpdatePending and p.revision == p.updateBase
pure val change1: OwnerChange = { authority: owner1, expectedRevision: 2, presentation: true, executable: false, financial: false,
  restrictedField: false, fieldsComplete: true, network: 1, asset: 1, exclusionsChanged: false, clearance: ClearanceRetained,
  consent: ConsentUntouched, appends: List(), reward: noPromise, shareHistory: List() }
pure val newRepository2: NewRepository = { appended: { ...owner1, repository: 2 }, facts: { ...facts1, repository: 2 } }
pure val changeValues = Set(change1, { ...change1, expectedRevision: 1 }, { ...change1, expectedRevision: 3 },
  { ...change1, consent: ConsentChecked }, { ...change1, consent: ConsentUnchecked, expectedRevision: 3 },
  { ...change1, presentation: false, consent: ConsentChecked }, { ...change1, presentation: false, consent: ConsentUnchecked },
  { ...change1, presentation: false, consent: ConsentUnchecked, expectedRevision: 3 },
  { ...change1, presentation: false, executable: true, appends: List(newRepository2) },
  { ...change1, presentation: false, executable: true, appends: List(newRepository2), expectedRevision: 3 },
  { ...change1, consent: ConsentChecked, executable: true, appends: List(newRepository2) },
  { ...change1, presentation: false, executable: true, appends: List(newRepository2, newRepository2) },
  { ...change1, presentation: false, financial: true, reward: { ...noPromise, honor: HonorTrue } },
  { ...change1, presentation: false, financial: true, reward: { ...noPromise, monthlyAmount: 0, honor: HonorTrue } },
  { ...change1, reward: { ...noPromise, honor: HonorTrue } },
  { ...change1, presentation: false, financial: true }, { ...change1, presentation: false, financial: true, asset: 2 },
  { ...change1, presentation: false, financial: true, network: 2 },
  { ...change1, presentation: false, financial: true, exclusionsChanged: true }, { ...change1, exclusionsChanged: true },
  { ...change1, presentation: false, financial: true, reward: { ...noPromise, share: 2000 } },
  { ...change1, presentation: false, financial: true, reward: { ...noPromise, share: 2000 }, expectedRevision: 3 },
  { ...change1, reward: { ...noPromise, share: 2000 } },
  { ...change1, presentation: false, financial: true, shareHistory: List({ throughMonth: 202611, basisPoints: 0 }) },
  { ...change1, executable: true, clearance: ClearanceMissing }, { ...change1, fieldsComplete: false },
  { ...change1, restrictedField: true }, { ...change1, presentation: false },
  { ...change1, authority: { ...owner1, actor: 2 } }, { ...change1, authority: { ...owner1, actor: 2 }, expectedRevision: 1 })
pure def alwaysEconomicTermsPrecedeNothing(p: Project): bool =
  p.economic.every(t => t.revision > 0 and t.revision <= p.revision and t.fromMonth > 202611 and t.fromMonth <= p.month + 1)
pure def alwaysClockStarted(p: Project): bool = p.month >= 202611
pure def stepEconomicTermsRetained(before: Project, after: Project): bool =
  after.economic.length() >= before.economic.length() and before.economic.every(t => after.economic.includes(t))
pure def stepFundedAssetFixed(before: Project, after: Project): bool =
  before.funded implies after.network == before.network and after.asset == before.asset
```

### An honor-system promise is the owner's opt-in on a positive monthly pool and changes no amount or payment

`reward.honorSystem` is omitted or `true`, and only on a monthly pool whose
monthly amount is positive; `false`, any other reward kind or a zero amount
is refused (422 `invalid_manifest`, "honorSystem must be true on a positive
monthly pool, or omitted"). The owner sets or removes it at creation and by
owner revision under current authority, funded or not: it is a financial
change of the reward that the fixed-reward comparison leaves out, so it never
changes amounts, cycle caps, payment mode, committed amounts or recorded
obligations, and earlier revisions keep their value. New projects and
existing ones start without it. It changes no listing and no funding
(owner decision, 17 November 2026; Slop development `47f9b35c1`,
`src/lib/project-schema.mjs`, `backend/projects/handler.ts`
`prospectiveFinancialChange`).

```quint
type HonorField = HonorOmitted | HonorTrue | HonorFalse
type RewardPromise = { monthlyPool: bool, monthlyAmount: int, honor: HonorField, share: int }
pure val noPromise: RewardPromise = { monthlyPool: true, monthlyAmount: 1, honor: HonorOmitted, share: 0 }
pure def honorSystemValid(reward: RewardPromise): bool =
  reward.honor == HonorOmitted or (reward.honor == HonorTrue and reward.monthlyPool and reward.monthlyAmount > 0)
pure def honorChanged(p: Project, reward: RewardPromise): bool = (reward.honor == HonorTrue) != p.honorSystem
pure def lawHonorPromiseNeedsPositivePool(reward: RewardPromise): bool =
  honorSystemValid(reward) implies (reward.honor != HonorFalse and
    (reward.honor == HonorTrue implies reward.monthlyPool and reward.monthlyAmount > 0))
pure def lawHonorPromiseChangesNoMoney(p: Project, by: int, change: OwnerChange): bool =
  (canPublishOwnerRevision(p, by, change) and change.network == p.network and change.asset == p.asset) implies
    (publishOwnerRevision(p, by, change).funded == p.funded and publishOwnerRevision(p, by, change).vaults == p.vaults and
     publishOwnerRevision(p, by, change).network == p.network and publishOwnerRevision(p, by, change).asset == p.asset)
pure val rewardValues = Set(noPromise, { ...noPromise, honor: HonorTrue }, { ...noPromise, honor: HonorFalse },
  { ...noPromise, monthlyAmount: 0, honor: HonorTrue }, { ...noPromise, monthlyPool: false, honor: HonorTrue },
  { ...noPromise, share: 2000 }, { ...noPromise, share: 3001 }, { ...noPromise, monthlyPool: false, share: 100 })
```

### The maintainer share is an owner setting whose history only the server writes

`reward.maintainerShare` is whole basis points of the monthly amount, 1 to
3000, or omitted (`share` 0), and only on a monthly pool ("must be whole
basis points from 1 to 3000, or omitted"; "applies to a monthly pool only")
(operator decision, 18 November 2026; Slop development `ac54042a8`,
`8e3ea3a23`, `src/lib/maintainer-share.mjs`, `src/lib/project-schema.mjs`,
`backend/projects/handler.ts` `prospectiveFinancialChange`).
`reward.maintainerShareHistory` lists, oldest first, the share each month
through its `throughCycle` had (strictly later UTC months, 0 to 3000 basis
points each), also on a monthly pool only. The owner sets, changes or removes the share at creation and
by owner revision under current authority, funded or not: it is a financial
change of the reward that the fixed-reward comparison leaves out, so it
changes no amount, cycle cap, payment mode or recorded obligation. Only the
server writes the history: creation and stored-application publication
refuse a submitted one (the new project's share applies from its first
month), and an owner revision whose history differs from the
stored one is refused (422 `financial_change_restricted`, "The maintainer
share history cannot change"). When a revision changes the share during the
open UTC month, the server appends that month with the share it had, unless
the history already reaches the open month (a second change in the same
month keeps the month's first recorded share), so every month through the
open one keeps its share and the new one starts next month. A month's share
is that of the first history entry reaching it, else the current share. An
administrator exception replaces the manifest, the share and its history
included, as it replaces any field (below). How settlement splits it is the
[maintainer share](../settlement/maintainerShare.md).

```quint
type ShareEntry = { throughMonth: int, basisPoints: int }
pure val maxShareBasisPoints = 3000
pure def shareValid(reward: RewardPromise): bool =
  reward.share == 0 or (reward.monthlyPool and reward.share >= 1 and reward.share <= maxShareBasisPoints)
pure def shareHistoryValid(history: List[ShareEntry]): bool =
  history.every(e => e.basisPoints >= 0 and e.basisPoints <= maxShareBasisPoints and e.throughMonth > 0) and
  history.foldl(0, (priorMonth, e) => if (priorMonth >= 0 and e.throughMonth > priorMonth) e.throughMonth else -1) >= 0
pure def prospectiveShare(p: Project, share: int): List[ShareEntry] =
  if (share == p.share or p.shareHistory.some(e => e.throughMonth >= p.month)) p.shareHistory
  else p.shareHistory.append({ throughMonth: p.month, basisPoints: p.share })
pure def shareOf(p: Project, month: int): int =
  p.shareHistory.select(e => month <= e.throughMonth).nthOr(0, { throughMonth: 0, basisPoints: p.share }).basisPoints
pure def alwaysShareWithinLimits(p: Project): bool =
  p.share >= 0 and p.share <= maxShareBasisPoints and shareHistoryValid(p.shareHistory)
pure def stepShareHistoryOnlyAppends(before: Project, via: str, after: Project): bool =
  via != "adminRevise" implies (after.shareHistory == before.shareHistory or
    after.shareHistory == before.shareHistory.append({ throughMonth: before.month, basisPoints: before.share }))
pure def stepOpenMonthShareKept(before: Project, via: str, after: Project): bool =
  (before.revision > 0 and via != "adminRevise") implies shareOf(after, before.month) == shareOf(before, before.month)
pure def lawShareChangeStartsNextMonth(p: Project, share: int): bool =
  (share != p.share and not(p.shareHistory.some(e => e.throughMonth >= p.month))) implies
    shareOf({ ...p, share: share, shareHistory: prospectiveShare(p, share) }, p.month) == p.share and
    shareOf({ ...p, share: share, shareHistory: prospectiveShare(p, share) }, p.month + 1) == share
pure def sometimesShareChangedForNextMonth(p: Project): bool =
  p.shareHistory.length() > 0 and p.share > 0 and shareOf(p, p.month) != p.share
pure val shareValues = Set(0, 2000, 3000)
```

### Appending a repository pauses the project and its work counts from next month

The new repository is public, not archived and not a fork, with its own
integration branch; the acting owner holds current authority on the primary
repository and through a Slopbot installation on the new one. The registry
checks that no project lists its permanent ids. At most 20 repositories are
listed. An append never removes, reorders or renames a listed repository. The
original repository's eligibility and the economic terms do not change.

```quint
pure def appendable(p: Project, by: int, newRepository: NewRepository): bool =
  authorized(by, newRepository.facts.repository, newRepository.appended) and
  newRepository.facts.repository > 0 and not(p.repositories.includes(newRepository.facts.repository)) and
  newRepository.facts.public and not(newRepository.facts.archived) and not(newRepository.facts.fork) and newRepository.facts.branch > 0
pure val facts2: RepositoryFacts = { ...facts1, repository: 2 }
pure def lawAppendedRepositoryPausesAndStartsNextMonth(p: Project, by: int, change: OwnerChange, newRepository: NewRepository): bool =
  (canPublishOwnerRevision(p, by, change) and change.appends.includes(newRepository)) implies
    (publishOwnerRevision(p, by, change).status == Paused and
     publishOwnerRevision(p, by, change).starts.includes({ repositoryId: newRepository.facts.repository, month: p.month + 1 }))
pure val newRepositoryValues = Set(newRepository2, { ...newRepository2, facts: { ...facts2, fork: true } },
  { ...newRepository2, facts: { ...facts2, archived: true } },
  { ...newRepository2, appended: { ...owner1, repository: 2, installation: InstallationMissing } },
  { appended: owner1, facts: facts1 })
pure def alwaysRepositoryBound(p: Project): bool =
  p.repositories.length() >= 1 and p.repositories.length() <= 20 and (p.revision == 0 implies p.repositories.length() == 1)
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

### Automatic-closure consent changes only by an owner revision or an administrator exception

Editing appends a revision at the expected revision under current authority.
Unchecking an explicit Yes records No; an untouched missing setting stays
absent. A write that would change nothing is refused. The consent is part of
`slopbot`, a presentation field, so a save may carry it together with other
changes in one owner revision (above); a save whose only change is the
consent records a `ConsentChanged` revision and keeps status and tier. An
administrator exception replaces the whole manifest, `slopbot` included, so it
records the replacement's saved value as it stands, `slopbot.automaticClosure`
true, false or absent (below; `replaceProjectManifest` in
`backend/projects/handler.ts` checks no consent transition).

```quint
pure def lawConsentOnlySaveRecordsConsentChange(p: Project, by: int, change: OwnerChange): bool =
  (canPublishOwnerRevision(p, by, change) and consentOnly(change)) implies
    (currentRevision(publishOwnerRevision(p, by, change)).kind == ConsentChanged and
     publishOwnerRevision(p, by, change).status == p.status and publishOwnerRevision(p, by, change).tier == p.tier and
     publishOwnerRevision(p, by, change).consent == consentAfter(p.consent, change.consent))
pure def stepConsentChangesOnlyByOwnerOrAdministratorRevision(before: Project, via: str, after: Project): bool =
  (before.revision > 0 and after.consent != before.consent) implies
    (via == "publishOwnerRevision" or via == "publishUpdate" or via == "adminRevise")
```

### A current maintainer removes a project and a lost reply can be retried

Removal rechecks current authority on the stored primary repository, even on
a retry. It appends a paused, retired revision and never runs activation;
only an administrator exception lists the project again (below). A
project the owner already removed, or an administrator delisted, returns
success unchanged. Removal waits until the project's own restriction is
lifted: the [composition](./projectComposition.md) refuses it while a
Quarantine or Ban is in force (409 `project_restricted`), before the
already-removed retry, so a restriction's retired revision is never taken for
a removal and reinstatement lists the project again from the revision the
restriction opened on (Slop development `da358d8a9`). History, earned
Points, private cases and funded obligations are kept.
A removal or delisting is never restored: the restriction's reinstatement
leaves such a project at its revision and its Retired tier.
Discovered by proof: over all values the law was false for a project whose
retirement and tier disagree, which no reachable state has; the law now names
`alwaysRetirementConsistent` as its premise and keeps the Retired conclusion.

```quint
type Removal = { authority: AuthorityRead, expectedRevision: int }
pure def canRemove(p: Project, by: int, removal: Removal): bool =
  p.revision > 0 and currentAuthority(p, by, removal.authority) and
  (p.retirement != NotRetired or removal.expectedRevision == p.revision)
pure def ownerRetired(p: Project): bool = p.retirement == OwnerRemoved or p.retirement == AdminDelisted
pure def remove(p: Project, by: int, removal: Removal): Project =
  if (ownerRetired(p)) p else { ...revised(Removed, by, Paused, Retired, p), retirement: OwnerRemoved }
pure val removalValues = Set({ authority: owner1, expectedRevision: 2 }, { authority: owner1, expectedRevision: 3 },
  { authority: { ...owner1, permission: PermissionUnavailable }, expectedRevision: 2 })
pure def stepRemovalReplayAppendsNothing(before: Project, via: str, after: Project): bool =
  (via == "remove" and ownerRetired(before)) implies
    after.revision == before.revision and after.retirement == before.retirement and after.status == before.status
pure def stepOwnerRemovalPermanent(before: Project, via: str, after: Project): bool =
  (before.retirement == OwnerRemoved implies (after.retirement == OwnerRemoved or (via == "adminRevise" and after.retirement == NotRetired))) and
  (before.retirement == AdminDelisted implies (after.retirement == AdminDelisted or (via == "adminRevise" and after.retirement == NotRetired)))
pure def stepRemovalAlwaysRetires(before: Project, via: str, after: Project): bool =
  via == "remove" implies (after.tier == Retired and after.status == Paused and ownerRetired(after))
```

### A finalized owner vault registration appends one revision for the current maintainer

An owner manifest edit never adds or changes a vault record ("Use vault setup
to register a verified owner vault"); the vault setup route does. The vault
setup service (`-2`) appends one revision recording one reviewed vault
deployment, the project's ordinary escrow or its security bounty settlement
(effective from the current UTC period), for an owner whose current
authority it read on the stored primary repository: the steward or a
repository admin, since write access is not enough (403
`vault_authority_required`). It does so only with finalized creation evidence
it verified against the reviewed factory or program and the project's
policy; an included creation that is not final appends nothing. The
creation's reviewed revision is the current one, or an earlier one whose
asset and vault policy equal the current ones (otherwise 409
`vault_policy_changed`). A project has one vault of each purpose (409
`vault_already_registered`); repeating the registration of the recorded
deployment is answered from the stored record and appends nothing. The
composition refuses a restricted project (409 `project_restricted`) and a
banned actor or steward. The revision keeps status and tier and is the
project's acting owner's; its reason names the path ("Owner registered a
finalized vault …" or "Slop finished the owner's saved vault registration
after finality …", from the saved creations of
[vault setup](../settlement/vaultSnapshots.md)). A recorded ordinary vault
makes the project funded, which fixes its network and asset; a bounty vault
does not. Recording a vault gives no payment by itself.

```quint
type VaultPurpose = OrdinaryVault | BountyVault
type VaultRegistration = { authority: AuthorityRead, repositoryAdmin: bool, expectedRevision: int, purpose: VaultPurpose,
  finalized: bool, policyMatches: bool }
pure val vaultSetup = -2
pure def vaultRecorded(vaults: VaultRecords, purpose: VaultPurpose): bool =
  if (purpose == OrdinaryVault) vaults.ordinary else vaults.bounty
pure def canRegisterVault(p: Project, by: int, registration: VaultRegistration): bool =
  val owner = registration.authority.actor
  by == vaultSetup and p.revision > 0 and p.retirement != RestrictionRetired and
  currentAuthority(p, owner, registration.authority) and (owner == p.steward or registration.repositoryAdmin) and
  registration.finalized and not(vaultRecorded(p.vaults, registration.purpose)) and
  (registration.expectedRevision == p.revision or
    (registration.expectedRevision > 0 and registration.expectedRevision < p.revision and registration.policyMatches))
pure def registerVault(p: Project, by: int, registration: VaultRegistration): Project =
  val ordinary = registration.purpose == OrdinaryVault
  { ...revised(VaultRegistered, registration.authority.actor, p.status, p.tier, p),
    vaults: { ordinary: p.vaults.ordinary or ordinary, bounty: p.vaults.bounty or not(ordinary) }, funded: p.funded or ordinary }
pure val registration1: VaultRegistration = { authority: owner1, repositoryAdmin: false, expectedRevision: 2, purpose: OrdinaryVault,
  finalized: true, policyMatches: true }
pure val registrationValues = Set(registration1, { ...registration1, purpose: BountyVault }, { ...registration1, finalized: false },
  { ...registration1, expectedRevision: 1 }, { ...registration1, expectedRevision: 1, policyMatches: false },
  { ...registration1, authority: { ...owner1, actor: 2 } }, { ...registration1, authority: { ...owner1, actor: 2 }, repositoryAdmin: true },
  { ...registration1, expectedRevision: 3 })
pure def alwaysOrdinaryVaultFunds(p: Project): bool = p.vaults.ordinary implies p.funded
pure def stepVaultRecordsRetained(before: Project, after: Project): bool =
  (before.vaults.ordinary implies after.vaults.ordinary) and (before.vaults.bounty implies after.vaults.bounty)
pure def lawUnfinalizedCreationRegistersNothing(p: Project, by: int, registration: VaultRegistration): bool =
  not(registration.finalized) implies not(canRegisterVault(p, by, registration))
```

### A current repository administrator moves the integration branch with a committed declaration

A save (`PUT /api/v1/projects/:id`) with `integrationBranch: { name,
commitSha }` and `expectedRevision` in place of `manifest`, and optionally
`reason` and `contribution`, moves the primary repository's integration
branch (Slop development `8d52d586c`, `e2fe2b22f`, `a2c8f5ef0`,
`backend/projects/handler.ts` `publishIntegrationBranch`,
`github-lookup.ts` `readIntegrationBranchAuthority`,
`src/lib/project-policy.mjs` `assertRepositoryTransition`). After the stale
revision (409 `stale_revision`), ban (403 `maintainer_banned`), restriction
(409 `project_restricted`, the [composition](./projectComposition.md)) and
current-authority checks, the actor's current read of the stored repository
must be admin with Slopbot installed (403 `authority_required`, "The
integration branch requires current GitHub repository admin permission.");
the selection must be a valid branch name and a 40-hex commit (400
`invalid_request`); the branch must differ (422 `no_change`); a retired
project refuses (409 `project_restricted`, "A retired project cannot change
integration branches."). The project API reads the branch's head and
`.github/slop-project.json` at that exact commit: a head that is not that
commit answers 409 `branch_head_changed` ("The GitHub branch moved. Reload
and verify its current head."), and a declaration that is not exactly kind
`slop-project-authority`, `schemaVersion` "1", the project id, the terms
revision, the repository's full name and id, the new branch and the
steward's actor and node ids, 1 to 4096 bytes, answers 422
`branch_proof_required` (shell obligations: `headCurrent` and `declared` are
that read's facts, never the request's). The same revision may replace the
contribution instructions. It is an owner revision (`OwnerUpdate`): status,
tier, funding, economic terms, repositories, consent and share are kept,
only the branch moves, and every other repository field and every other
repository's branch stay as they were (an administrator exception never
moves a branch). An active project needs retained admission clearance for it
(422 `vetting_required`), since the repository inputs changed; it is never
paused for it. Both generated skills then use the new branch, and the setup
check runs without activation.

```quint
type BranchChange = { authority: AuthorityRead, repositoryAdmin: bool, expectedRevision: int, target: int, declared: bool,
  headCurrent: bool, fieldsComplete: bool, clearance: Clearance }
pure def canMoveBranch(p: Project, by: int, branchChange: BranchChange): bool =
  p.revision > 0 and p.tier != Retired and branchChange.expectedRevision == p.revision and
  currentAuthority(p, by, branchChange.authority) and branchChange.repositoryAdmin and
  branchChange.target > 0 and branchChange.target != p.branch and branchChange.headCurrent and branchChange.declared and
  (branchChange.fieldsComplete or p.status == Paused) and
  (p.status == Active implies branchChange.clearance == ClearanceRetained)
pure def moveBranch(p: Project, by: int, branchChange: BranchChange): Project =
  { ...revised(OwnerUpdate, by, p.status, p.tier, p), branch: branchChange.target, fieldsComplete: branchChange.fieldsComplete }
pure def lawBranchMoveKeepsStatusAndFunding(p: Project, by: int, branchChange: BranchChange): bool =
  canMoveBranch(p, by, branchChange) implies
    (moveBranch(p, by, branchChange).status == p.status and moveBranch(p, by, branchChange).tier == p.tier and
     moveBranch(p, by, branchChange).funded == p.funded and moveBranch(p, by, branchChange).economic == p.economic and
     moveBranch(p, by, branchChange).repositories == p.repositories and moveBranch(p, by, branchChange).consent == p.consent and
     moveBranch(p, by, branchChange).share == p.share and moveBranch(p, by, branchChange).branch == branchChange.target)
pure def lawRetiredBranchNeverMoves(p: Project, by: int, branchChange: BranchChange): bool =
  p.tier == Retired implies not(canMoveBranch(p, by, branchChange))
pure def stepBranchMovesOnlyByVerifiedChange(before: Project, via: str, after: Project): bool =
  (before.revision > 0 and after.branch != before.branch) implies via == "moveBranch"
pure def sometimesBranchMoved(p: Project): bool = p.revision > 0 and p.branch == 2 and p.history.some(r => r.kind == OwnerUpdate)
pure val branchChange1: BranchChange = { authority: owner1, repositoryAdmin: true, expectedRevision: 2, target: 2, declared: true,
  headCurrent: true, fieldsComplete: true, clearance: ClearanceRetained }
pure val branchChangeValues = Set(branchChange1, { ...branchChange1, expectedRevision: 3 }, { ...branchChange1, repositoryAdmin: false },
  { ...branchChange1, declared: false }, { ...branchChange1, headCurrent: false }, { ...branchChange1, target: 1 },
  { ...branchChange1, clearance: ClearanceMissing }, { ...branchChange1, expectedRevision: 3, clearance: ClearanceMissing },
  { ...branchChange1, authority: { ...owner1, permission: PermissionUnavailable } })
```

## Story: Administrators handle exceptions and restrictions, not routine approval

### Administrators hold, delist, change the steward or place a project

Every administrator exception (`PUT /api/v1/admin/projects/:id/manifest`)
replaces the manifest, any field but the project id, in one revision against
the expected revision (409 `stale_revision`) and needs a reason of 1 to 1000
characters; one that changes nothing is refused (422 `no_change`). The
`Exception` record is the replaced manifest's registry facts; the project
API computes `financial` (a reward, asset, escrow, funding or bounty field
differs), `executable`, `otherFields` (any other field differs) and
`funded` (the replacement's committed funding state, positive committed
amount, enabled payments, recorded escrow deployment, funding address or
funding commitment) from the stored and the submitted manifest; a client
never supplies them. The replacement's closure consent (`consent`, the saved
`slopbot.automaticClosure`, absent when the manifest has none) and the
repositories it appends after the listed ones (`appended`, each with the
exact UTC month it counts from, `countsFrom`) are read from the submitted
manifest too. Listed repositories keep their ids and start months
(`assertRepositoryTransition`: the inventory only grows), at most 20 are
listed, and an appended repository changes executable inputs; unlike an
owner's append it needs no authority read on the new repository and may
count from any month the administrator names. The registry checks it as it
checks any appended repository. The revision passes every registry check a revision
passes: a project that a restriction retired keeps a paused, retired
revision (the composition requires one under any restriction); restricted
repositories, policy transitions (a funded project keeps its network, asset
and recorded vaults), prospective payout exclusions and registry uniqueness
are checked; an active result needs complete generated-skill fields, open
participation, known mandatory terms and, when it activates or changes
executable inputs, retained admission clearance. A financial replacement
applies from the next UTC month, as an owner's does. The license facts
(`terms.repositoryLicense`, administrator-only) are replaced too, valid as at
creation, so an administrator can record known terms for a project created
with `unknown` ones and activate it (`active projects require known mandatory
terms` reads the replacement). With no restriction in force, a replacement
may list an owner-removed or delisted project again in a listed tier: the
project API checks `enforcedManifest` only while a restriction holds
(`appendRevision`). A hold is the replacement that
only pauses an active project; a plain paused hold is reactivated by the
owner's next passing setup check (D11), so holding a project needs a
quarantine. A delisting is the replacement that retires a listed project: a
paused, retired revision that setup never reactivates. Steward changes and
the other owner-restricted fields use this path. Featured placement is an
administrator decision and never depends on funding. The manifest's
`participation` state (`archived` with a successor project, or
`permission-required`) is administrator-only and keeps the project paused.

```quint
type Exception = { expectedRevision: int, reason: int, status: Status, tier: Tier, steward: int, participation: Participation,
  fieldsComplete: bool, network: int, asset: int, financial: bool, executable: bool, otherFields: bool, funded: bool,
  vaults: VaultRecords, reward: RewardPromise, clearance: Clearance, license: License, consent: C::SavedConsent,
  appended: List[RepositoryStart], shareHistory: List[ShareEntry] }
pure def exceptionAppendsValid(p: Project, appended: List[RepositoryStart]): bool =
  p.repositories.length() + appended.length() <= 20 and
  appended.every(s => s.repositoryId > 0 and s.month >= 0 and not(p.repositories.includes(s.repositoryId)) and
    appended.select(t => t.repositoryId == s.repositoryId).length() == 1)
pure def exceptionChanges(p: Project, exception: Exception): bool =
  exception.status != p.status or exception.tier != p.tier or exception.steward != p.steward or
  exception.participation != p.participation or exception.fieldsComplete != p.fieldsComplete or exception.financial or
  exception.executable or exception.otherFields or exception.network != p.network or exception.asset != p.asset or
  exception.funded != p.funded or exception.vaults != p.vaults or honorChanged(p, exception.reward) or
  exception.license != p.license or exception.consent != p.consent or exception.appended.length() > 0 or
  exception.reward.share != p.share or exception.shareHistory != p.shareHistory
pure def exceptionKind(p: Project, exception: Exception): RevisionKind =
  if (exception.tier == Retired and p.tier != Retired) AdminDelist
  else if (exception.status == Paused and p.status == Active and exception == holdOf(p, exception)) AdminHold
  else AdminException
pure def holdOf(p: Project, exception: Exception): Exception =
  { ...exception, status: Paused, tier: p.tier, steward: p.steward, participation: p.participation, fieldsComplete: p.fieldsComplete,
    network: p.network, asset: p.asset, financial: false, executable: false, otherFields: false, funded: p.funded, vaults: p.vaults,
    reward: { ...exception.reward, honor: if (p.honorSystem) HonorTrue else HonorOmitted, share: p.share }, license: p.license,
    consent: p.consent, appended: List(), shareHistory: p.shareHistory }
pure def canAdminRevise(p: Project, by: int, exception: Exception): bool =
  p.administrators.includes(by) and p.revision > 0 and
  exception.expectedRevision == p.revision and exception.reason > 0 and exceptionChanges(p, exception) and
  exception.steward > 0 and exception.network > 0 and exception.asset > 0 and honorSystemValid(exception.reward) and
  licenseValid(exception.license) and exceptionAppendsValid(p, exception.appended) and
  shareValid(exception.reward) and shareHistoryValid(exception.shareHistory) and
  (exception.shareHistory == List() or exception.reward.monthlyPool) and
  ((exception.reward.share != p.share or exception.shareHistory != p.shareHistory) implies exception.financial) and
  (exception.appended.length() > 0 implies exception.executable) and
  (p.retirement == RestrictionRetired implies exception.status == Paused and exception.tier == Retired) and
  (exception.tier == Retired implies exception.status == Paused) and
  (exception.participation != OpenParticipation implies exception.status == Paused) and
  (exception.status == Active implies exception.fieldsComplete and exception.license.terms != UnknownTerms and
    ((p.status != Active or exception.executable) implies exception.clearance == ClearanceRetained)) and
  ((exception.network != p.network or exception.asset != p.asset) implies exception.financial and not(p.funded)) and
  ((exception.funded != p.funded or exception.vaults != p.vaults or honorChanged(p, exception.reward)) implies exception.financial) and
  (p.funded implies exception.funded) and (p.vaults.ordinary implies exception.vaults.ordinary) and
  (p.vaults.bounty implies exception.vaults.bounty) and (exception.vaults.ordinary implies exception.funded)
pure def adminRevise(p: Project, by: int, exception: Exception): Project =
  { ...revised(exceptionKind(p, exception), by, exception.status, exception.tier, p),
    retirement: if (exception.tier != Retired) NotRetired else if (p.retirement == NotRetired) AdminDelisted else p.retirement,
    steward: exception.steward, license: exception.license, participation: exception.participation, fieldsComplete: exception.fieldsComplete,
    network: exception.network, asset: exception.asset, funded: exception.funded, vaults: exception.vaults,
    honorSystem: exception.reward.honor == HonorTrue, consent: exception.consent,
    share: exception.reward.share, shareHistory: exception.shareHistory,
    repositories: p.repositories.concat(exception.appended.listMap(s => s.repositoryId)), starts: p.starts.concat(exception.appended),
    economic: if (exception.financial) p.economic.append({ fromMonth: p.month + 1, revision: p.revision + 1 }) else p.economic }
pure def canPlace(p: Project, by: int, tier: Tier): bool =
  p.administrators.includes(by) and p.revision > 0 and p.retirement == NotRetired and tier != Retired and tier != p.tier
pure def place(p: Project, by: int, tier: Tier): Project = revised(Placement, by, p.status, tier, p)
pure val exception1: Exception = { expectedRevision: 2, reason: 1, status: Paused, tier: Community, steward: 1,
  participation: OpenParticipation, fieldsComplete: true, network: 1, asset: 1, financial: false, executable: false,
  otherFields: false, funded: false, vaults: noVaults, reward: noPromise, clearance: ClearanceRetained, license: license1,
  consent: C::Absent, appended: List(), shareHistory: List() }
pure val exceptionValues = tuples(Set(1, 2, 3), Set(exception1, { ...exception1, tier: Retired }, { ...exception1, steward: 4 },
  { ...exception1, participation: Archived }, { ...exception1, participation: PermissionRequired },
  { ...exception1, status: Active }, { ...exception1, status: Active, executable: true, clearance: ClearanceMissing },
  { ...exception1, financial: true, funded: true, vaults: { ordinary: true, bounty: false } },
  { ...exception1, financial: true, network: 2 }, { ...exception1, otherFields: true },
  { ...exception1, status: Active, participation: Archived }, { ...exception1, license: noLicense },
  { ...exception1, status: Active, license: noLicense }, { ...exception1, license: { ...noLicense, url: 1 } },
  { ...exception1, consent: C::Disabled }, { ...exception1, consent: C::Enabled },
  { ...exception1, executable: true, appended: List({ repositoryId: 2, month: 202612 }) },
  { ...exception1, executable: true, appended: List({ repositoryId: 2, month: 202610 }) },
  { ...exception1, appended: List({ repositoryId: 2, month: 202612 }) },
  { ...exception1, executable: true, appended: List({ repositoryId: 1, month: 202612 }) },
  { ...exception1, financial: true, reward: { ...noPromise, share: 1500 }, shareHistory: List({ throughMonth: 202611, basisPoints: 0 }) }))
  .map(x => { ...x._2, expectedRevision: x._1 }).union(Set({ ...exception1, steward: 4, reason: 0 }))
pure def alwaysRestrictedParticipationPaused(p: Project): bool = p.participation != OpenParticipation implies p.status == Paused
pure def alwaysRetirementConsistent(p: Project): bool =
  (p.retirement != NotRetired iff p.tier == Retired) and (p.retirement != NotRetired implies p.status == Paused)
```

### A restriction retires the listing and reinstatement restores only a paused Community listing

A quarantine or ban appends a paused, retired revision in the same batch when
the project is listed; a project already retired needs none. Reinstatement
restores a paused Community revision only for a project the restriction
retired and the owner did not remove since: never featuring, activation or
money. These registry steps are helpers, not events: they have no sender of
their own, and only the composition performs them, with the enforcement
decision, in the same batch. No other registry event lists a retired project
again, except an administrator exception on a project the owner removed or an
administrator delisted (above).

```quint
pure def retirableForRestriction(p: Project): bool = p.revision > 0 and p.retirement == NotRetired
pure def withRestrictionRetirement(retire: bool, p: Project): Project =
  if (retire and retirableForRestriction(p)) { ...revised(RestrictionRetirement, 0, Paused, Retired, p), retirement: RestrictionRetired }
  else p
pure def restorable(p: Project): bool = p.revision > 0 and p.retirement == RestrictionRetired
pure def withCommunityRestored(restore: bool, p: Project): Project =
  if (restore and restorable(p)) { ...revised(CommunityRestored, 0, Paused, Community, p), retirement: NotRetired } else p
pure def lawRestorationIsPausedCommunity(p: Project): bool =
  restorable(p) implies (withCommunityRestored(true, p).status == Paused and withCommunityRestored(true, p).tier == Community)
pure def lawRemovedNeverRestored(p: Project): bool =
  (ownerRetired(p) and alwaysRetirementConsistent(p)) implies (withCommunityRestored(true, p).revision == p.revision and withCommunityRestored(true, p).tier == Retired)
pure def stepNoRegistryEventUnretires(before: Project, via: str, after: Project): bool =
  (before.retirement != NotRetired and after.retirement == NotRetired) implies
    (via == "adminRevise" and before.retirement != RestrictionRetired)
```

### Funding is a fact of the current revision and the clock only advances

`funded`, which fixes the network and the asset, is read from the current
revision's manifest: a committed funding state, a positive committed amount,
enabled payments, a recorded escrow deployment, a funding address or a
funding commitment (`prospectiveFinancialChange`, Slop development
`backend/projects/handler.ts`). No separate funding observation changes it:
an owner revision cannot change those fields, so only an administrator
exception or an ordinary vault registration, each a revision, makes a project
funded. Funding changes no placement. Deposits and month totals are
settlement's, never the registry's.

```quint
pure def canAdvanceMonth(p: Project, by: int, month: int): bool = by == platform and month > p.month
pure def advanceMonth(p: Project, by: int, month: int): Project = { ...p, month: month }
pure val monthValues = Set(202612, 202701)
pure def stepEveryManifestChangeAppendsRevision(before: Project, after: Project): bool =
  (before.status != after.status or before.tier != after.tier or before.retirement != after.retirement or
    before.repositories != after.repositories or before.consent != after.consent or before.steward != after.steward or
    before.fieldsComplete != after.fieldsComplete or before.economic != after.economic or before.asset != after.asset or
    before.network != after.network or before.participation != after.participation or before.funded != after.funded or
    before.vaults != after.vaults or before.honorSystem != after.honorSystem or before.license != after.license)
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
pure def sometimesRevisedWhileRemoved(p: Project): bool =
  p.retirement == OwnerRemoved and p.history.some(r => r.kind == OwnerUpdate and r.tier == Retired)
pure def sometimesFeatured(p: Project): bool = p.tier == Featured
pure def sometimesPausedWithoutSkillFields(p: Project): bool = p.revision > 0 and not(p.fieldsComplete)
pure def sometimesAppendedRepositoryDeferred(p: Project): bool =
  p.starts.some(start => start.month > p.starts.nthOr(0, start).month and repositoryEligible(p, primary(p), p.month) and
    not(repositoryEligible(p, start.repositoryId, p.month)))
pure def sometimesNextMonthTerms(p: Project): bool = p.economic.length() > 0
pure def sometimesLaterSteward(p: Project): bool = p.steward != p.creator and p.revision > 0
pure def sometimesClosureEnabled(p: Project): bool = p.consent == C::Enabled
pure def sometimesAdminHoldWithReason(p: Project): bool = p.history.some(r => r.kind == AdminHold) and p.status == Paused
pure def sometimesCreatedWithUnknownLicense(p: Project): bool = p.revision > 0 and p.license.terms == UnknownTerms
pure def sometimesHonorPromisedUnfunded(p: Project): bool = p.honorSystem and not(p.funded)
pure def sometimesVaultRegistered(p: Project): bool = p.vaults.ordinary and p.funded and p.history.some(r => r.kind == VaultRegistered)
pure def sometimesCombinedOwnerRevision(p: Project): bool =
  p.consent == C::Enabled and p.repositories.length() == 2 and p.history.some(r => r.kind == RepositoryAppended) and
  not(p.history.some(r => r.kind == ConsentChanged))
pure def sometimesAdminReplacedFinancialTerms(p: Project): bool = p.history.some(r => r.kind == AdminException) and p.economic.length() > 0
pure def sometimesConsentOnlyRevision(p: Project): bool = p.history.some(r => r.kind == ConsentChanged) and p.consent == C::Enabled
pure def sometimesRelistedByAdministrator(p: Project): bool = p.retirement == NotRetired and p.history.some(r => r.kind == Removed)
pure def sometimesAdministratorSetConsent(p: Project): bool =
  p.consent == C::Disabled and not(p.history.some(r => r.kind == ConsentChanged or r.kind == RepositoryAppended or r.kind == OwnerUpdate))
pure def sometimesAdministratorAppendedRepository(p: Project): bool =
  p.repositories.length() == 2 and not(p.history.some(r => r.kind == RepositoryAppended))
pure val byValues = Set(-2, -1, 0, 1, 2, 5)
pure val pValues = Set(initial, { ...initial, application: ApplicationDecidedLegacy },
  { ...initial, revision: 1, creator: 1, steward: 1, branch: 1, license: license1, tier: Retired, retirement: RestrictionRetired,
    history: List({ number: 1, kind: RestrictionRetirement, status: Paused, tier: Retired, by: 0 }) },
  { ...initial, revision: 1, creator: 1, steward: 1, branch: 1, license: license1, tier: Retired, retirement: OwnerRemoved,
    history: List({ number: 1, kind: Removed, status: Paused, tier: Retired, by: 1 }) })
pure val repositoryValues = Set(1, 2)
pure val tierValues = Set(Community, Featured)
pure val weight_create = 6
pure val weight_publishApplication = 6
pure val weight_activate = 4
pure val weight_publishOwnerRevision = 4
```
