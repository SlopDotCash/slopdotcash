# Durable private report intake

PRD sections 8 and 10 require a durable Slop receipt before optional GitHub
forwarding. The retained report's exact digest binds reporter, repository,
receipt time and receipt-time terms. Report text is private R2 content.

## Story: Submit and recover one private report

### Upload and receipt creation have separate durable states

```quint
type IntakeAvailability = Enabled | Disabled | StaleAccess | DeniedAccess | Unavailable | InvalidInput
type IntakePhase = Editing | Uploading | UploadUncertain | ObjectStored | Received
type Intake = { availability: IntakeAvailability, phase: IntakePhase, key: int, digest: int, reporter: int, repository: int, termsRevision: int, objectVerified: bool, caseExists: bool, inboxExists: bool, forwarded: bool, forwardingAuthorized: bool, forwardUncertain: bool }
pure val initial: Intake = { availability: Enabled, phase: Editing, key: 0, digest: 0, reporter: 0, repository: 0, termsRevision: 0, objectVerified: false, caseExists: false, inboxExists: false, forwarded: false, forwardingAuthorized: false, forwardUncertain: false }
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
pure def stepPreservesReceipt(before: Intake, after: Intake): bool = before.caseExists implies after.caseExists and after.key == before.key and after.digest == before.digest and after.termsRevision == before.termsRevision
```

### Forwarding requires separate researcher authorization and its own receipt

The adapter uses the authorized user's GitHub token. Installation tokens retain
read-only advisory access. Unknown delivery requires reconciliation before a
new send. A forwarding failure leaves the original Slop receipt available.

```quint
pure def canAuthorizeForwarding(i: Intake, by: int): bool = i.phase == Received and by == i.reporter
pure def authorizeForwarding(i: Intake, by: int): Intake = { ...i, forwardingAuthorized: true }
pure def canStartForwarding(i: Intake, userToken: bool): bool = i.forwardingAuthorized and userToken and not(i.forwarded) and not(i.forwardUncertain)
pure def startForwarding(i: Intake, userToken: bool): Intake = { ...i, forwardUncertain: true }
pure def canConfirmForwarding(i: Intake, receiptMatches: bool): bool = i.forwardUncertain and receiptMatches
pure def confirmForwarding(i: Intake, receiptMatches: bool): Intake = { ...i, forwarded: true, forwardUncertain: false }
pure def canProveUnsent(i: Intake, absenceProved: bool): bool = i.forwardUncertain and absenceProved
pure def proveUnsent(i: Intake, absenceProved: bool): Intake = { ...i, forwardUncertain: false }
pure def alwaysForwardedAfterReceipt(i: Intake): bool = i.forwarded implies i.caseExists and i.forwardingAuthorized
pure def sometimesUnavailable(i: Intake): bool = i.availability == Unavailable
pure def sometimesDenied(i: Intake): bool = i.availability == DeniedAccess
pure def sometimesReceived(i: Intake): bool = i.phase == Received
pure def sometimesForwarded(i: Intake): bool = i.forwarded
```

Drafts are account-and-project-bound session storage. Sign-out and account
changes clear retained private draft data. Storage failures remain visible.
No local-storage persistence, server autosave, attachment service or public
issue fallback is introduced. The frontend specification owns those controls.

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val byValues = Set(0, 1, 2)
```
