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

### A report body holds between 1 and 262,144 bytes and any other size creates nothing

The request is read within 256 KiB (`MAX_SEND_BYTES` in
`backend/security/submissions.ts`); a larger request answers 400
`invalid_request` before rate admission (`begin`) and creates nothing: no
admission, no R2 object, no case and no receipt. The stored object is the
normalised report (`JSON.stringify` of the parsed input), refused after rate
admission with 413
`report_too_large` above 262,144 bytes (`MAX_REPORT_BYTES` in
`backend/security/report-intake.ts`), a check the envelope bound makes
unreachable in practice; `security_intake_reports.byte_count` (migration
`0101`) keeps the same bound as a database check. An empty report is refused
by the input schema, and a stored object whose size differs from its recorded
count is never shown.

```quint
pure val maxReportBytes = 262144
pure def reportBytesAccepted(bytes: int): bool = bytes >= 1 and bytes <= maxReportBytes
pure def lawReportSizeBound(bytes: int): bool =
  (bytes < 1 or bytes > 262144) implies not(reportBytesAccepted(bytes))
pure def lawLargestReportAccepted(bytes: int): bool = bytes == 262144 implies reportBytesAccepted(bytes)
pure val bytesValues = Set(0, 1, 262144, 262145)
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

### The private-reporting handoff reads the repository's cached reporting observation, and an observation older than its interval is StaleAccess

GitHub private vulnerability reporting on the program's reporting repository
is observed by Slopbot's hourly refresher and cached per project revision
and repository (`repository_reporting_status`, migrations `0006` and `0086`;
`backend/security/reporting-readiness.ts`). A read takes that row: with no
row, no verified time, a repository identity that differs from the
registered one, or a verified time in the future, the answer is
`Unavailable`. A row whose last refresh failed, or whose verified time is one
hour (3,600 s) old or older, is `StaleAccess`: the last verified value is
kept and reported with a stale marker; a failed refresh never overwrites it. A fresh enabled row is `Enabled`, a fresh disabled row
`Disabled`. Only a fresh `Enabled` answer marks the automatic GitHub handoff
ready. The handoff link is a separate answer (`handoffLinkShown`): it is
shown while the last verified value is enabled for the registered repository
and its verified time is not in the future, fresh or stale, as `handoffUrl` is
in `intakeReadiness` (`backend/security/handler.ts`), and no
answer offers a public fallback. This answer governs the
GitHub handoff only: Slop's stored intake (`canBegin`, `commitReceipt`) is
gated by storage configuration, participation bans and the rate admission,
as `acceptStoredReport` was, and the shell does not feed this answer to
`observeAvailability`.

```quint
type ReportingReadiness = ReadinessEnabled | ReadinessDisabled | ReadinessUnobserved
type ReportingObservation = { readiness: ReportingReadiness, identityMatches: bool, refreshFailed: bool, verifiedAtSecond: int }
pure val reportingObservationSeconds = 3600
pure def handoffAvailability(reportingObservation: ReportingObservation, nowSecond: int): IntakeAvailability =
  if (reportingObservation.readiness == ReadinessUnobserved or not(reportingObservation.identityMatches) or
      nowSecond < reportingObservation.verifiedAtSecond) Unavailable
  else if (reportingObservation.refreshFailed or nowSecond - reportingObservation.verifiedAtSecond >= reportingObservationSeconds) StaleAccess
  else if (reportingObservation.readiness == ReadinessEnabled) Enabled
  else Disabled
pure def lawOldObservationIsStale(reportingObservation: ReportingObservation, nowSecond: int): bool =
  (reportingObservation.readiness != ReadinessUnobserved and reportingObservation.identityMatches and
    nowSecond - reportingObservation.verifiedAtSecond >= 3600) implies handoffAvailability(reportingObservation, nowSecond) == StaleAccess
pure def lawStaleNeverEnabledOrDisabled(reportingObservation: ReportingObservation, nowSecond: int): bool =
  (reportingObservation.refreshFailed or nowSecond - reportingObservation.verifiedAtSecond >= 3600) implies
    (handoffAvailability(reportingObservation, nowSecond) != Enabled and handoffAvailability(reportingObservation, nowSecond) != Disabled)
pure def handoffLinkShown(reportingObservation: ReportingObservation, nowSecond: int): bool =
  reportingObservation.readiness == ReadinessEnabled and reportingObservation.identityMatches and
    nowSecond >= reportingObservation.verifiedAtSecond
pure def lawStaleEnabledShowsLink(reportingObservation: ReportingObservation, nowSecond: int): bool =
  (reportingObservation.readiness == ReadinessEnabled and reportingObservation.identityMatches and
    nowSecond >= reportingObservation.verifiedAtSecond and handoffAvailability(reportingObservation, nowSecond) == StaleAccess)
    implies handoffLinkShown(reportingObservation, nowSecond)
pure def lawLinkNeedsEnabled(reportingObservation: ReportingObservation, nowSecond: int): bool =
  handoffAvailability(reportingObservation, nowSecond) == Disabled implies not(handoffLinkShown(reportingObservation, nowSecond))
pure val freshObservation: ReportingObservation = { readiness: ReadinessEnabled, identityMatches: true, refreshFailed: false, verifiedAtSecond: 0 }
pure val reportingObservationValues = Set(freshObservation, { ...freshObservation, readiness: ReadinessDisabled },
  { ...freshObservation, readiness: ReadinessUnobserved }, { ...freshObservation, identityMatches: false },
  { ...freshObservation, refreshFailed: true })
pure val nowSecondValues = Set(-1, 0, 3599, 3600)
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
