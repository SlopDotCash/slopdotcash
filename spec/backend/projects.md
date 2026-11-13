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
type Project = { applicant: int, application: ApplicationPhase, revision: int,
  history: List[int], repositories: List[int], cleared: List[int],
  installed: bool, fieldsComplete: bool, licenseVerified: bool,
  authority: bool, authorityEpoch: int, checkedEpoch: int,
  paused: bool, retired: bool, funded: bool, effectiveMonth: int,
  updatePhase: UpdatePhase, updateBase: int, updateHistory: List[UpdateRecord] }
pure val initial: Project = { applicant: 1, application: Draft, revision: 0,
  history: List(), repositories: List(1), cleared: List(), installed: false,
  fieldsComplete: false, licenseVerified: false, authority: false,
  authorityEpoch: 0, checkedEpoch: -1, paused: true, retired: false,
  funded: false, effectiveMonth: 0, updatePhase: NoUpdate, updateBase: 0, updateHistory: List() }
pure def alwaysHistoryLength(p: Project): bool = p.revision == p.history.length()
pure def alwaysPublishedRevision(p: Project): bool = p.application == Published implies p.revision > 0
pure def alwaysRetiredPaused(p: Project): bool = p.retired implies p.paused
pure def alwaysRegisteredRepository(p: Project): bool = p.repositories.length() > 0
pure def alwaysClearanceBelongs(p: Project): bool = p.cleared.every(id => p.repositories.includes(id))
```

### Setup requires current GitHub authority, installation, license facts, and required fields

The mandatory skill fields include scope, contribution guide, supported tasks,
required tests, review expectations, security contact, closure policy, and notes.
Funding readiness does not control publication.

```quint
pure def canObserveSetup(p: Project, by: int, installed: bool, fieldsComplete: bool, licenseVerified: bool, authority: bool): bool =
  by == p.applicant and not(p.retired) and p.application != Cancelled
pure def observeSetup(p: Project, by: int, installed: bool, fieldsComplete: bool, licenseVerified: bool, authority: bool): Project =
  { ...p, installed: installed, fieldsComplete: fieldsComplete,
    licenseVerified: licenseVerified, authority: authority,
    authorityEpoch: p.authorityEpoch + 1 }
pure def canBeginPublish(p: Project, by: int): bool =
  by == p.applicant and p.application == Draft and p.authority and p.installed and
  p.fieldsComplete and p.licenseVerified
pure def beginPublish(p: Project, by: int): Project =
  { ...p, application: Checking, checkedEpoch: p.authorityEpoch }
pure def canCompletePublish(p: Project, by: int): bool =
  by == p.applicant and p.application == Checking and p.authority and p.installed and
  p.fieldsComplete and p.licenseVerified and p.checkedEpoch == p.authorityEpoch and
  p.repositories.every(id => p.cleared.includes(id))
pure def completePublish(p: Project, by: int): Project =
  { ...p, application: Published, revision: p.revision + 1,
    history: p.history.append(p.revision + 1), paused: false }
pure def canRetryPublish(p: Project, by: int): bool = by == p.applicant and p.application == Checking
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
pure def canAppendRepository(p: Project, by: int, repositoryId: int, currentMonth: int,
  publicRepository: bool, archived: bool, fork: bool, globallyUnique: bool, installedAuthority: bool): bool =
  by == p.applicant and p.application == Published and not(p.retired) and p.authority and
  repositoryId > 0 and not(p.repositories.includes(repositoryId)) and currentMonth >= 0 and
  publicRepository and not(archived) and not(fork) and globallyUnique and installedAuthority
pure def appendRepository(p: Project, by: int, repositoryId: int, currentMonth: int,
  publicRepository: bool, archived: bool, fork: bool, globallyUnique: bool, installedAuthority: bool): Project =
  { ...p, repositories: p.repositories.append(repositoryId), paused: true,
    effectiveMonth: currentMonth + 1, revision: p.revision + 1,
    history: p.history.append(p.revision + 1) }
pure def canResume(p: Project, by: int): bool =
  by == p.applicant and p.application == Published and not(p.retired) and p.authority and
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
  by == p.applicant and p.application == Published and not(p.retired) and freshAuthority
pure def retire(p: Project, by: int, freshAuthority: bool): Project =
  { ...p, retired: true, paused: true, revision: p.revision + 1,
    history: p.history.append(p.revision + 1) }
pure def canRecordFunding(p: Project, finalizedFunding: bool): bool = finalizedFunding
pure def recordFunding(p: Project, finalizedFunding: bool): Project = { ...p, funded: true }
pure def listed(p: Project): bool = p.revision > 0 and not(p.retired)
pure def collectable(p: Project): bool = listed(p) and not(p.paused)
pure def skillPublished(p: Project): bool = collectable(p) and p.fieldsComplete
pure def stepHistoryOnlyAppends(before: Project, after: Project): bool =
  after.history.length() >= before.history.length() and before.history.every(id => after.history.includes(id))
pure def stepRepositoriesRetained(before: Project, after: Project): bool =
  before.repositories.every(id => after.repositories.includes(id))
pure def sometimesPublishedUnfunded(p: Project): bool = p.application == Published and not(p.funded) and not(p.paused)
pure def sometimesRetired(p: Project): bool = p.retired and p.revision > 0
pure def sometimesCancelled(p: Project): bool = p.application == Cancelled and p.revision == 0
```

## Story: Cancel or publish an update without disturbing the live project

The applicant can abandon a pending update and retain its cancelled record.
The published project and its existing terms remain available while an update
is edited. Publishing compares against the exact revision the update began from.
Month values are consecutive UTC calendar-month ordinals.

### An update has its own lifecycle and never rewrites the published revision

```quint
pure def canBeginUpdate(p: Project, by: int, freshAuthority: bool): bool =
  by == p.applicant and freshAuthority and p.application == Published and
  not(p.retired) and p.updatePhase != EditingUpdate
pure def beginUpdate(p: Project, by: int, freshAuthority: bool): Project =
  { ...p, updatePhase: EditingUpdate, updateBase: p.revision,
    updateHistory: p.updateHistory.append({ base: p.revision, outcome: "started" }) }
pure def canCancelUpdate(p: Project, by: int): bool =
  by == p.applicant and p.updatePhase == EditingUpdate
pure def cancelUpdate(p: Project, by: int): Project =
  { ...p, updatePhase: CancelledUpdate, updateHistory: p.updateHistory.append({ base: p.updateBase, outcome: "cancelled" }) }
pure def canPublishUpdate(p: Project, by: int, expectedRevision: int,
  freshAuthority: bool, fieldsValid: bool, economicChange: bool, effectiveMonth: int, currentMonth: int): bool =
  by == p.applicant and p.application == Published and not(p.retired) and
  p.updatePhase == EditingUpdate and expectedRevision == p.revision and p.updateBase == p.revision and
  freshAuthority and fieldsValid and currentMonth >= 0 and
  (if (economicChange) effectiveMonth == currentMonth + 1 else effectiveMonth >= currentMonth)
pure def publishUpdate(p: Project, by: int, expectedRevision: int,
  freshAuthority: bool, fieldsValid: bool, economicChange: bool, effectiveMonth: int, currentMonth: int): Project =
  { ...p, updatePhase: PublishedUpdate, revision: p.revision + 1,
    history: p.history.append(p.revision + 1), effectiveMonth: effectiveMonth,
    updateHistory: p.updateHistory.append({ base: p.updateBase, outcome: "published" }) }
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
pure val byValues = Set(0, 1, 2)
pure val currentMonthValues = Set(202611)
pure val effectiveMonthValues = Set(202610, 202611, 202612)
pure val expectedRevisionValues = Set(0, 1, 2)
pure val repositoryIdValues = Set(1, 2)
pure val viaValues = Set("", "a", "b")
```
