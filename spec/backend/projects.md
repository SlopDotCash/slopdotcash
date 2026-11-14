# Self-service registry lifecycle

This model covers PRD sections 2, 4, 7, and 8. It represents one D1 project,
its application, and its immutable repository identities. D1 uniqueness and
compare-and-swap operations must be tested with real concurrent requests.
GitHub permission, license, and installation observations must name the same
repository and actor and be freshly verified by the future shell.

## Story: Publish and maintain a project

An applicant completes setup, publishes without routine administrator approval,
and can append repositories or retire the project while retaining its records.

### Project history and application state remain separate

```quint
type ApplicationPhase = Draft | Checking | Published | Cancelled
type UpdatePhase = NoUpdate | EditingUpdate | CancelledUpdate | PublishedUpdate
type UpdateRecord = { base: int, outcome: str }
type Project = { applicant: int, authorityActor: int, application: ApplicationPhase, revision: int,
  history: List[int], repositories: List[int], cleared: List[int],
  installed: bool, fieldsComplete: bool, licenseVerified: bool,
  authority: bool, authorityEpoch: int, checkedEpoch: int,
  paused: bool, retired: bool, funded: bool, effectiveMonth: int,
  updatePhase: UpdatePhase, updateAuthor: int, updateBase: int, updateHistory: List[UpdateRecord] }
pure val initial: Project = { applicant: 1, authorityActor: 1, application: Draft, revision: 0,
  history: List(), repositories: List(1), cleared: List(), installed: false,
  fieldsComplete: false, licenseVerified: false, authority: false,
  authorityEpoch: 0, checkedEpoch: -1, paused: true, retired: false,
  funded: false, effectiveMonth: 0, updatePhase: NoUpdate, updateAuthor: 0, updateBase: 0, updateHistory: List() }
pure def alwaysAuthorityActor(p: Project): bool = p.applicant > 0 and p.authorityActor > 0 and p.updateAuthor >= 0
pure def alwaysHistoryLength(p: Project): bool = p.revision == p.history.length()
pure def alwaysPublishedRevision(p: Project): bool = p.application == Published implies p.revision > 0
pure def alwaysRetiredPaused(p: Project): bool = p.retired implies p.paused
pure def alwaysRegisteredRepository(p: Project): bool = p.repositories.length() > 0
pure def alwaysClearanceBelongs(p: Project): bool = p.cleared.every(id => p.repositories.includes(id))
```

### Setup requires current GitHub authority, installation, license facts, and required fields

The mandatory skill fields include scope, contribution guide, supported tasks,
required tests, review expectations, security contact, closure policy, and notes.
Funding readiness does not control publication. Retired projects refuse setup
publication. Discovered by the proof, an otherwise valid synthetic Checking
state could previously clear a retirement pause at completion.

```quint
type SetupEvidence = { installed: bool, fieldsComplete: bool, licenseVerified: bool, authority: bool }
pure def canObserveSetup(p: Project, by: int, setupEvidence: SetupEvidence): bool =
  (if (p.application == Published) by == p.authorityActor and p.authority else by == p.applicant) and not(p.retired) and p.application != Cancelled
pure def observeSetup(p: Project, by: int, setupEvidence: SetupEvidence): Project =
  { ...p, installed: setupEvidence.installed, fieldsComplete: setupEvidence.fieldsComplete,
    licenseVerified: setupEvidence.licenseVerified, authority: setupEvidence.authority,
    authorityEpoch: p.authorityEpoch + 1 }
pure val setupEvidenceValues = Set(
  { installed: true, fieldsComplete: true, licenseVerified: true, authority: true },
  { installed: false, fieldsComplete: true, licenseVerified: true, authority: true },
  { installed: true, fieldsComplete: false, licenseVerified: true, authority: true },
  { installed: true, fieldsComplete: true, licenseVerified: false, authority: true },
  { installed: true, fieldsComplete: true, licenseVerified: true, authority: false },
  { installed: false, fieldsComplete: false, licenseVerified: false, authority: false }
)
pure def canBeginPublish(p: Project, by: int): bool =
  by == p.applicant and p.application == Draft and not(p.retired) and p.authority and p.installed and
  p.fieldsComplete and p.licenseVerified
pure def beginPublish(p: Project, by: int): Project =
  { ...p, application: Checking, checkedEpoch: p.authorityEpoch }
pure def canCompletePublish(p: Project, by: int): bool =
  by == p.applicant and p.application == Checking and not(p.retired) and p.authority and p.installed and
  p.fieldsComplete and p.licenseVerified and p.checkedEpoch == p.authorityEpoch and
  p.repositories.every(id => p.cleared.includes(id))
pure def completePublish(p: Project, by: int): Project =
  { ...p, application: Published, revision: p.revision + 1,
    history: p.history.append(p.revision + 1), paused: false }
pure def canRetryPublish(p: Project, by: int): bool = by == p.applicant and p.application == Checking and not(p.retired)
pure def retryPublish(p: Project, by: int): Project = { ...p, application: Draft, checkedEpoch: -1 }
```

### Admission is repository-specific and appending pauses work until every repository clears

An appended repository is public, unarchived, and not a fork. Its permanent
numeric and node IDs must be globally unregistered. Work begins next UTC month.
A separate admission model supplies retained successful scan or explicit
owner-approved exemption evidence. This event does not describe an exemption
as a successful scan.

```quint
pure def canClearRepository(p: Project, repositoryId: int, admissionEvidence: bool): bool =
  admissionEvidence and p.repositories.includes(repositoryId) and not(p.cleared.includes(repositoryId))
pure def clearRepository(p: Project, repositoryId: int, admissionEvidence: bool): Project =
  { ...p, cleared: p.cleared.append(repositoryId) }
type AppendEvidence = { repositoryId: int, currentMonth: int, publicRepository: bool, archived: bool, fork: bool, globallyUnique: bool, installedAuthority: bool }
pure def canAppendRepository(p: Project, by: int, appendEvidence: AppendEvidence): bool =
  by == p.authorityActor and p.application == Published and not(p.retired) and p.authority and
  appendEvidence.repositoryId > 0 and not(p.repositories.includes(appendEvidence.repositoryId)) and appendEvidence.currentMonth >= 0 and
  appendEvidence.publicRepository and not(appendEvidence.archived) and not(appendEvidence.fork) and appendEvidence.globallyUnique and appendEvidence.installedAuthority
pure def appendRepository(p: Project, by: int, appendEvidence: AppendEvidence): Project =
  { ...p, repositories: p.repositories.append(appendEvidence.repositoryId), paused: true,
    effectiveMonth: appendEvidence.currentMonth + 1, revision: p.revision + 1,
    history: p.history.append(p.revision + 1) }
pure val appendEvidenceValues = Set(
  { repositoryId: 2, currentMonth: 202611, publicRepository: true, archived: false, fork: false, globallyUnique: true, installedAuthority: true },
  { repositoryId: 3, currentMonth: 202611, publicRepository: true, archived: false, fork: false, globallyUnique: true, installedAuthority: true },
  { repositoryId: 1, currentMonth: 202611, publicRepository: true, archived: false, fork: false, globallyUnique: true, installedAuthority: true },
  { repositoryId: 2, currentMonth: 202611, publicRepository: false, archived: false, fork: false, globallyUnique: true, installedAuthority: true },
  { repositoryId: 2, currentMonth: 202611, publicRepository: true, archived: true, fork: false, globallyUnique: true, installedAuthority: true },
  { repositoryId: 2, currentMonth: 202611, publicRepository: true, archived: false, fork: true, globallyUnique: true, installedAuthority: true },
  { repositoryId: 2, currentMonth: 202611, publicRepository: true, archived: false, fork: false, globallyUnique: false, installedAuthority: true },
  { repositoryId: 2, currentMonth: 202611, publicRepository: true, archived: false, fork: false, globallyUnique: true, installedAuthority: false },
  { repositoryId: 0, currentMonth: 202611, publicRepository: true, archived: false, fork: false, globallyUnique: true, installedAuthority: true },
  { repositoryId: 2, currentMonth: -1, publicRepository: true, archived: false, fork: false, globallyUnique: true, installedAuthority: true }
)
pure def canResume(p: Project, by: int): bool =
  by == p.authorityActor and p.application == Published and not(p.retired) and p.authority and
  p.installed and p.fieldsComplete and p.licenseVerified and p.repositories.every(id => p.cleared.includes(id))
pure def resume(p: Project, by: int): Project = { ...p, paused: false }
pure def alwaysActiveClearance(p: Project): bool = not(p.paused) implies
  p.application == Published and not(p.retired) and p.repositories.every(id => p.cleared.includes(id))
```

### Cancellation and retirement retain history and never publish a cancelled application

Retirement hides discovery, collection, and skills. A paused project remains
listed. Funding and historical obligations remain independent.

```quint
pure def canCancel(p: Project, by: int): bool =
  by == p.applicant and (p.application == Draft or p.application == Checking)
pure def cancel(p: Project, by: int): Project = { ...p, application: Cancelled }
pure def canRetire(p: Project, by: int, freshAuthority: bool): bool =
  by == p.authorityActor and p.authority and p.application == Published and not(p.retired) and freshAuthority
pure def retire(p: Project, by: int, freshAuthority: bool): Project =
  { ...p, retired: true, paused: true, revision: p.revision + 1,
    history: p.history.append(p.revision + 1) }
pure def canRecordFunding(p: Project, finalizedFunding: bool): bool = finalizedFunding
pure def recordFunding(p: Project, finalizedFunding: bool): Project = { ...p, funded: true }
pure def listed(p: Project): bool = p.revision > 0 and not(p.retired)
pure def collectable(p: Project): bool = listed(p) and not(p.paused)
pure def skillPublished(p: Project): bool = collectable(p) and p.fieldsComplete
pure def stepApplicantRetained(before: Project, after: Project): bool = before.applicant == after.applicant
pure def stepHistoryOnlyAppends(before: Project, after: Project): bool =
  after.history.length() >= before.history.length() and before.history.every(id => after.history.includes(id))
pure def stepRepositoriesRetained(before: Project, after: Project): bool =
  before.repositories.every(id => after.repositories.includes(id))
pure def sometimesPublishedUnfunded(p: Project): bool = p.application == Published and not(p.funded) and not(p.paused)
pure def sometimesRetired(p: Project): bool = p.retired and p.revision > 0
pure def sometimesCancelled(p: Project): bool = p.application == Cancelled and p.revision == 0
```

## Story: Manage a live project using current GitHub authority

The original applicant remains in history. Each acting maintainer obtains a
fresh authority check for the immutable registered repository and actor.
Changing the acting maintainer does not assign copyright, wallet control or
payment authority. A revoked or unavailable check refuses management actions.

### Current authority is bound to the acting account independently of the applicant

```quint
type AuthorityEvidence = { actorId: int, verified: bool }
pure def canObserveCurrentAuthority(p: Project, authorityEvidence: AuthorityEvidence): bool =
  p.application == Published and authorityEvidence.actorId > 0
pure def observeCurrentAuthority(p: Project, authorityEvidence: AuthorityEvidence): Project =
  { ...p, authorityActor: authorityEvidence.actorId, authority: authorityEvidence.verified,
    authorityEpoch: p.authorityEpoch + 1 }
pure val authorityEvidenceValues = Set(
  { actorId: 1, verified: true }, { actorId: 2, verified: true },
  { actorId: 1, verified: false }, { actorId: 2, verified: false }
)
pure def sometimesLaterMaintainer(p: Project): bool =
  p.application == Published and p.authority and p.authorityActor != p.applicant
```

## Story: Cancel or publish an update without disturbing the live project

The update applicant can abandon a pending update and retain its cancelled record.
The published project and its existing terms remain available while an update
is edited. Publishing compares against the exact revision the update began from.
Month values are consecutive UTC calendar-month ordinals.

### An update has its own lifecycle and never rewrites the published revision

```quint
pure def canBeginUpdate(p: Project, by: int, freshAuthority: bool): bool =
  by == p.authorityActor and p.authority and freshAuthority and p.application == Published and
  not(p.retired) and p.updatePhase != EditingUpdate
pure def beginUpdate(p: Project, by: int, freshAuthority: bool): Project =
  { ...p, updatePhase: EditingUpdate, updateAuthor: by, updateBase: p.revision,
    updateHistory: p.updateHistory.append({ base: p.revision, outcome: "started" }) }
pure def canCancelUpdate(p: Project, by: int): bool =
  by == p.updateAuthor and p.updatePhase == EditingUpdate
pure def cancelUpdate(p: Project, by: int): Project =
  { ...p, updatePhase: CancelledUpdate, updateHistory: p.updateHistory.append({ base: p.updateBase, outcome: "cancelled" }) }
type UpdateEvidence = { expectedRevision: int, freshAuthority: bool, fieldsValid: bool, economicChange: bool, effectiveMonth: int, currentMonth: int }
pure def canPublishUpdate(p: Project, by: int, updateEvidence: UpdateEvidence): bool =
  by == p.authorityActor and p.authority and p.application == Published and not(p.retired) and
  p.updatePhase == EditingUpdate and updateEvidence.expectedRevision == p.revision and p.updateBase == p.revision and
  updateEvidence.freshAuthority and updateEvidence.fieldsValid and updateEvidence.currentMonth >= 0 and
  (if (updateEvidence.economicChange) updateEvidence.effectiveMonth == updateEvidence.currentMonth + 1 else updateEvidence.effectiveMonth >= updateEvidence.currentMonth)
pure def publishUpdate(p: Project, by: int, updateEvidence: UpdateEvidence): Project =
  { ...p, updatePhase: PublishedUpdate, revision: p.revision + 1,
    history: p.history.append(p.revision + 1), effectiveMonth: updateEvidence.effectiveMonth,
    updateHistory: p.updateHistory.append({ base: p.updateBase, outcome: "published" }) }
pure val updateEvidenceValues = Set(
  { expectedRevision: 1, freshAuthority: true, fieldsValid: true, economicChange: true, effectiveMonth: 202612, currentMonth: 202611 },
  { expectedRevision: 2, freshAuthority: true, fieldsValid: true, economicChange: true, effectiveMonth: 202612, currentMonth: 202611 },
  { expectedRevision: 1, freshAuthority: true, fieldsValid: true, economicChange: false, effectiveMonth: 202611, currentMonth: 202611 },
  { expectedRevision: 0, freshAuthority: true, fieldsValid: true, economicChange: true, effectiveMonth: 202612, currentMonth: 202611 },
  { expectedRevision: 1, freshAuthority: false, fieldsValid: true, economicChange: true, effectiveMonth: 202612, currentMonth: 202611 },
  { expectedRevision: 1, freshAuthority: true, fieldsValid: false, economicChange: true, effectiveMonth: 202612, currentMonth: 202611 },
  { expectedRevision: 1, freshAuthority: true, fieldsValid: true, economicChange: true, effectiveMonth: 202611, currentMonth: 202611 }
)
pure def stepUpdateHistoryRetained(before: Project, after: Project): bool =
  after.updateHistory.length() >= before.updateHistory.length()
pure def stepCancelKeepsPublishedRevision(before: Project, via: str, after: Project): bool =
  via == "cancelUpdate" implies after.revision == before.revision and
  after.history == before.history and after.paused == before.paused and after.retired == before.retired
pure def sometimesCancelledUpdate(p: Project): bool = p.updatePhase == CancelledUpdate and p.revision > 0
pure def sometimesPublishedUpdate(p: Project): bool = p.updatePhase == PublishedUpdate and p.revision > p.updateBase
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val weight_beginPublish = 20
pure val weight_completePublish = 20
pure val weight_clearRepository = 5
pure val weight_beginUpdate = 5
pure val weight_publishUpdate = 10
pure val weight_resume = 5
pure val byValues = Set(0, 1, 2)
pure val repositoryIdValues = Set(1, 2, 3)
pure val viaValues = Set("", "a", "b")
```
