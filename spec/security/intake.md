# Durable private report intake

PRD sections 8 and 10 require a durable Slop receipt before optional GitHub
forwarding. The retained report's exact digest binds reporter, repository,
receipt time and receipt-time terms. Report text is private R2 content.

## Story: Submit and recover one private report

### Upload and receipt creation have separate durable states

```quint
type IntakeAvailability = Enabled | Disabled | StaleAccess | DeniedAccess | Unavailable | InvalidInput
type IntakePhase = Editing | Uploading | UploadUncertain | ObjectStored | Received
type Intake = { availability: IntakeAvailability, phase: IntakePhase, key: int, digest: int, reporter: int, repository: int, termsRevision: int, objectVerified: bool, caseExists: bool, inboxExists: bool }
pure val initial: Intake = { availability: Enabled, phase: Editing, key: 0, digest: 0, reporter: 0, repository: 0, termsRevision: 0, objectVerified: false, caseExists: false, inboxExists: false }
```

### A new attempt binds authenticated identity and keeps its idempotency key

Input parsing, current project access and account authentication run before
this event. `reporter` is supplied from the authenticated identity, and the
repository and terms revision come from the approved D1 revision.

```quint
pure def canBegin(i: Intake, key: int, digest: int, reporter: int, repository: int, termsRevision: int): bool = i.phase == Editing and i.availability == Enabled and key > 0 and digest > 0 and reporter > 0 and repository > 0 and termsRevision > 0
pure def begin(i: Intake, key: int, digest: int, reporter: int, repository: int, termsRevision: int): Intake = { ...i, phase: Uploading, key: key, digest: digest, reporter: reporter, repository: repository, termsRevision: termsRevision }
pure def canObserveAvailability(i: Intake, availability: IntakeAvailability): bool = true
pure def observeAvailability(i: Intake, availability: IntakeAvailability): Intake = { ...i, availability: availability }
pure val keyValues = Set(1)
pure val digestValues = Set(1, 2)
pure val reporterValues = Set(1)
pure val repositoryValues = Set(1)
pure val termsRevisionValues = Set(1)
pure def canInterruptUpload(i: Intake): bool = i.phase == Uploading
pure def interruptUpload(i: Intake): Intake = { ...i, phase: UploadUncertain }
pure def canRetryUpload(i: Intake, key: int): bool = i.phase == UploadUncertain and key == i.key
pure def retryUpload(i: Intake, key: int): Intake = { ...i, phase: Uploading }
```

### Only verified exact object bytes permit an atomic case and Inbox receipt

The transaction creates case and reporter Inbox receipt together under the
unique idempotency key. A lost response is reconciled by that key and digest.
An object-store success alone cannot produce a user-visible submitted state.

```quint
pure def canVerifyObject(i: Intake, digest: int): bool = (i.phase == Uploading or i.phase == UploadUncertain) and digest == i.digest
pure def verifyObject(i: Intake, digest: int): Intake = { ...i, phase: ObjectStored, objectVerified: true }
pure def canCommitReceipt(i: Intake): bool = i.phase == ObjectStored and i.objectVerified and i.availability == Enabled
pure def commitReceipt(i: Intake): Intake = { ...i, phase: Received, caseExists: true, inboxExists: true }
pure def canReconcileReceipt(i: Intake, key: int, digest: int): bool = i.phase == Received and key == i.key and digest == i.digest
pure def reconcileReceipt(i: Intake, key: int, digest: int): Intake = i
pure def alwaysAtomicReceipt(i: Intake): bool = i.caseExists == i.inboxExists and (i.caseExists implies i.objectVerified and i.phase == Received)
pure def alwaysReceivedHasReceipt(i: Intake): bool = i.phase == Received implies i.caseExists and i.inboxExists and i.objectVerified
pure def stepPreservesReceipt(before: Intake, after: Intake): bool = before.caseExists implies after.caseExists and after.key == before.key and after.digest == before.digest and after.termsRevision == before.termsRevision
```

The [GitHub forwarding model](./forwarding.md) owns the researcher's separate
authorization, attempts, reconciliation, and advisory receipt after Slop
has stored the case.

```quint
pure def sometimesUnavailable(i: Intake): bool = i.availability == Unavailable
pure def sometimesDenied(i: Intake): bool = i.availability == DeniedAccess
pure def sometimesReceived(i: Intake): bool = i.phase == Received
```

Drafts are account-and-project-bound session storage. Sign-out and account
changes clear retained private draft data. Storage failures remain visible.
No local-storage persistence, server autosave, attachment service or public
issue fallback is introduced. The frontend specification owns those controls.
