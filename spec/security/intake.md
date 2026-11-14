# Durable private report intake

PRD sections 8 and 10 require a durable Slop receipt before optional GitHub
forwarding. The retained report's exact digest binds reporter, repository,
receipt time and receipt-time terms. Report text is private R2 content.
Source: Slop development `backend/security/report-intake.ts` (`createReport`,
`admitPublicWork`).

## Story: Submit and recover one private report

### Upload and receipt creation have separate durable states

```quint
import terms as T from "./terms"
type IntakeAvailability = Enabled | Disabled | StaleAccess | DeniedAccess | Unavailable | InvalidInput | RestrictedAwaitingOwnerDecision
type IntakePhase = Editing | Uploading | UploadUncertain | ObjectStored | Received
type Intake = { availability: IntakeAvailability, phase: IntakePhase, key: int, digest: int, reporter: int, repository: int,
  projectRevision: int, receivedAt: int, terms: T::ReceiptTerms, banned: bool, admissions: List[int],
  objectVerified: bool, caseExists: bool, inboxExists: bool }
pure val initial: Intake = { availability: Enabled, phase: Editing, key: 0, digest: 0, reporter: 0, repository: 0,
  projectRevision: 0, receivedAt: 0, terms: T::unpaidTerms(0, 0), banned: false, admissions: List(),
  objectVerified: false, caseExists: false, inboxExists: false }
```

### A new attempt binds authenticated identity, passes admission and keeps its idempotency key

Input parsing, current project access and account authentication run before
this event. `reporter` is the authenticated identity, and the repository and
project revision come from the approved D1 revision. A participation ban
(from the access service) refuses a new report before any write. Each actor
may start at most ten public report, revision or rescreen requests per
rolling hour, admitted before any R2 write or paid call. A replay of the same
key with the same digest returns the recorded receipt; the same key with
different bytes is an idempotency conflict and changes nothing.

```quint
pure def recentAdmissions(i: Intake, nowMs: int): int = i.admissions.select(t => t > nowMs - 3600000).length()
pure def canBegin(i: Intake, key: int, digest: int, reporter: int, repository: int, projectRevision: int, nowMs: int): bool =
  i.phase == Editing and i.availability == Enabled and not(i.banned) and key > 0 and digest > 0 and reporter > 0 and repository > 0
    and projectRevision > 0 and nowMs > 0 and i.admissions.every(t => t <= nowMs) and recentAdmissions(i, nowMs) < 10
pure def begin(i: Intake, key: int, digest: int, reporter: int, repository: int, projectRevision: int, nowMs: int): Intake =
  { ...i, phase: Uploading, key: key, digest: digest, reporter: reporter, repository: repository, projectRevision: projectRevision,
    admissions: i.admissions.append(nowMs) }
pure def canObserveAvailability(i: Intake, availability: IntakeAvailability): bool = availability != i.availability
pure def observeAvailability(i: Intake, availability: IntakeAvailability): Intake = { ...i, availability: availability }
pure def canObserveBan(i: Intake, banned: bool): bool = banned != i.banned
pure def observeBan(i: Intake, banned: bool): Intake = { ...i, banned: banned }
pure def lawConflictNeverReplays(i: Intake, key: int, digest: int): bool =
  (key == i.key and digest != i.digest) implies not(canReconcileReceipt(i, key, digest))
pure def canInterruptUpload(i: Intake): bool = i.phase == Uploading
pure def interruptUpload(i: Intake): Intake = { ...i, phase: UploadUncertain }
pure def canRetryUpload(i: Intake, key: int): bool = i.phase == UploadUncertain and key == i.key
pure def retryUpload(i: Intake, key: int): Intake = { ...i, phase: Uploading }
pure def alwaysAdmittedBeforeWrite(i: Intake): bool = i.phase != Editing implies i.admissions.length() > 0 and i.key > 0 and i.digest > 0
```

### Only verified exact object bytes permit an atomic case and Inbox receipt

The transaction creates case and reporter Inbox receipt together under the
unique idempotency key, with the receipt time and the terms the
[program](./program.md) issued at that time. A ban recorded before commit
refuses it. A lost response is reconciled by that key and digest. An
object-store success alone cannot produce a user-visible submitted state; an
unreferenced stored object is never shown and a retry with the same key and
bytes commits it once intake is available again.

```quint
pure def canVerifyObject(i: Intake, digest: int): bool = (i.phase == Uploading or i.phase == UploadUncertain) and digest == i.digest
pure def verifyObject(i: Intake, digest: int): Intake = { ...i, phase: ObjectStored, objectVerified: true }
pure def canCommitReceipt(i: Intake, receivedAt: int, terms: T::ReceiptTerms): bool = i.phase == ObjectStored and i.objectVerified
  and i.availability == Enabled and not(i.banned) and receivedAt > 0 and terms.receivedAt == receivedAt
  and T::validReceipt(terms) and (terms.paidTerms or terms.revision == i.projectRevision)
pure def commitReceipt(i: Intake, receivedAt: int, terms: T::ReceiptTerms): Intake =
  { ...i, phase: Received, receivedAt: receivedAt, terms: terms, caseExists: true, inboxExists: true }
pure def canReconcileReceipt(i: Intake, key: int, digest: int): bool = i.phase == Received and key == i.key and digest == i.digest
pure def reconcileReceipt(i: Intake, key: int, digest: int): Intake = i
pure def alwaysAtomicReceipt(i: Intake): bool = i.caseExists == i.inboxExists and (i.caseExists implies i.objectVerified and i.phase == Received)
pure def alwaysReceivedHasReceipt(i: Intake): bool = i.phase == Received implies i.caseExists and i.inboxExists and i.objectVerified
  and i.receivedAt > 0 and i.terms.receivedAt == i.receivedAt and T::validReceipt(i.terms)
pure def stepPreservesReceipt(before: Intake, after: Intake): bool = before.caseExists implies after.caseExists and after.key == before.key
  and after.digest == before.digest and after.terms == before.terms and after.receivedAt == before.receivedAt
pure def stepAdmissionsAppendOnly(before: Intake, after: Intake): bool =
  after.admissions == before.admissions or after.admissions == before.admissions.append(after.admissions.nthOr(before.admissions.length(), 0))
```

### A restricted project's new reports wait for an owner decision

CLAUDE.md (27 October 2026) keeps confidential reporting for all registered
projects. Slop development closes new reports after a quarantine or ban
appends a retired revision. No owner decision reconciles the two, so the
shell reports `RestrictedAwaitingOwnerDecision` for such a project and this
machine refuses new reports until that decision is recorded. Existing cases,
their reads and appeals are unaffected.

```quint
pure def lawRestrictedRefusesNewReports(i: Intake, key: int, digest: int, reporter: int, repository: int, projectRevision: int, nowMs: int): bool =
  i.availability == RestrictedAwaitingOwnerDecision implies not(canBegin(i, key, digest, reporter, repository, projectRevision, nowMs))
```

The [GitHub forwarding model](./forwarding.md) owns the researcher's separate
authorization, attempts, reconciliation, and advisory receipt after Slop
has stored the case.

```quint
pure def sometimesUnavailable(i: Intake): bool = i.availability == Unavailable
pure def sometimesDenied(i: Intake): bool = i.availability == DeniedAccess
pure def sometimesReceived(i: Intake): bool = i.phase == Received
pure def sometimesPaidReceipt(i: Intake): bool = i.phase == Received and i.terms.paidTerms
pure def sometimesBannedBeforeCommit(i: Intake): bool = i.phase == ObjectStored and i.banned
```

Drafts are account-and-project-bound session storage. Sign-out and account
changes clear retained private draft data. Storage failures remain visible.
No local-storage persistence, server autosave, attachment service or public
issue fallback is introduced. The frontend specification owns those controls.

### Simulation samples

```quint
pure val keyValues = Set(1)
pure val digestValues = Set(1, 2)
pure val reporterValues = Set(1)
pure val repositoryValues = Set(1)
pure val projectRevisionValues = Set(1)
pure val nowMsValues = Set(1, 2)
pure val receivedAtValues = Set(2)
pure val termsValues = Set({ ...T::standardTerms, receivedAt: 2 }, T::unpaidTerms(1, 2), T::unpaidTerms(3, 2))
```
