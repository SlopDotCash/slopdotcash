# Private access and retained evidence

PRD sections 2, 8 and 10 require current authority on every private read.
The protocol returns report bodies only through audited case access. Trace
bodies have no website or API read route for any role.

## Story: Read only authorized retained evidence

### Read authorization comes from the current case roles and is audited before delivery

One read concerns one representative received [case](./cases.md). Its
reporter and the current case roles of the latest verified authority
snapshot may read the report body: technical approvers, assigned triagers,
and moderators while an appeal or related-party review is open. Financial
approvers and website administrators read no body. Scanner evidence is
readable only by `lalalune` (18633264) and `drew-dot-com` (202660855), whose
policy `lalalune` owns, through grants that expire after fifteen minutes. A
read records its audit before any byte is delivered. A role change or grant
expiry during the response stream aborts it; nothing delivered after
revocation counts as authorized.

```quint
import money as M from "../settlement/money"
import terms as T from "./terms"
import cases as C from "./cases"
type BodyKind = ReportBody | ScannerBody | ContributorTrace
type ReadPhase = Idle | Requested | Audited | Streaming | Delivered | Aborted
type ReadAccess = { report: C::PrivateCase, kind: BodyKind, requester: int, checkedEpoch: int, grantedAtMinute: int,
  clockMinute: int, phase: ReadPhase, audits: int }
pure val scannerOperators = Set(18633264, 202660855)
pure val receivedCase: C::PrivateCase = C::observeAuthority(C::receive(C::initial, C::SlopReceived, T::standardTerms, C::NewReceipt, M::zero, 1), C::staff)
pure val initial: ReadAccess = { report: receivedCase, kind: ReportBody, requester: 0, checkedEpoch: 0, grantedAtMinute: 0,
  clockMinute: 0, phase: Idle, audits: 0 }
pure def allowed(a: ReadAccess): bool = a.checkedEpoch == a.report.authority.epoch and a.requester > 0
  and (if (a.kind == ReportBody) C::mayReadBody(a.report, a.requester, a.checkedEpoch)
    else if (a.kind == ScannerBody) scannerOperators.contains(a.requester) and a.clockMinute - a.grantedAtMinute < 15
    else false)
pure def canRequestRead(a: ReadAccess, kind: BodyKind, by: int): bool = by > 0
  and (a.phase == Idle or a.phase == Delivered or a.phase == Aborted)
pure def requestRead(a: ReadAccess, kind: BodyKind, by: int): ReadAccess =
  { ...a, kind: kind, requester: by, checkedEpoch: a.report.authority.epoch, grantedAtMinute: a.clockMinute, phase: Requested }
pure def canRecordAudit(a: ReadAccess): bool = a.phase == Requested and allowed(a)
pure def recordAudit(a: ReadAccess): ReadAccess = { ...a, phase: Audited, audits: a.audits + 1 }
pure def canStartStream(a: ReadAccess): bool = a.phase == Audited and allowed(a)
pure def startStream(a: ReadAccess): ReadAccess = { ...a, phase: Streaming }
pure def canFinishStream(a: ReadAccess): bool = a.phase == Streaming and allowed(a)
pure def finishStream(a: ReadAccess): ReadAccess = { ...a, phase: Delivered }
pure def canAbortStream(a: ReadAccess): bool = (a.phase == Requested or a.phase == Audited or a.phase == Streaming) and not(allowed(a))
pure def abortStream(a: ReadAccess): ReadAccess = { ...a, phase: Aborted }
pure def canAdvanceClock(a: ReadAccess, minutes: int): bool = minutes > 0
pure def advanceClock(a: ReadAccess, minutes: int): ReadAccess = { ...a, clockMinute: a.clockMinute + minutes }
pure def canObserveAuthority(a: ReadAccess, snapshot: C::Authority): bool = C::canObserveAuthority(a.report, snapshot)
pure def observeAuthority(a: ReadAccess, snapshot: C::Authority): ReadAccess = { ...a, report: C::observeAuthority(a.report, snapshot) }
pure def canAssignTriager(a: ReadAccess, by: int, checkedEpoch: int, actor: int): bool = C::canAssignTriager(a.report, by, checkedEpoch, actor)
pure def assignTriager(a: ReadAccess, by: int, checkedEpoch: int, actor: int): ReadAccess = { ...a, report: C::assignTriager(a.report, by, checkedEpoch, actor) }
pure def canRevokeTriager(a: ReadAccess, by: int, checkedEpoch: int, actor: int): bool = C::canRevokeTriager(a.report, by, checkedEpoch, actor)
pure def revokeTriager(a: ReadAccess, by: int, checkedEpoch: int, actor: int): ReadAccess = { ...a, report: C::revokeTriager(a.report, by, checkedEpoch, actor) }
pure def alwaysDeliveryWasAuthorized(a: ReadAccess): bool = a.audits >= 0 and ((a.phase == Audited or a.phase == Streaming) implies a.audits > 0 and a.requester > 0)
pure def alwaysNoTraceRead(a: ReadAccess): bool = a.kind == ContributorTrace implies (a.phase == Idle or a.phase == Requested or a.phase == Aborted)
pure def stepDeliveredOnlyWhileAuthorized(before: ReadAccess, after: ReadAccess): bool =
  (after.phase == Delivered and before.phase != Delivered) implies allowed(before) and before.phase == Streaming and before.audits > 0
pure def stepAuditsRetained(before: ReadAccess, after: ReadAccess): bool = after.audits >= before.audits
pure def sometimesReportRead(a: ReadAccess): bool = a.kind == ReportBody and a.phase == Delivered and a.requester != 1
pure def sometimesTriagerRevokedMidStream(a: ReadAccess): bool = a.phase == Aborted and a.kind == ReportBody and a.audits > 0
pure def sometimesScannerRead(a: ReadAccess): bool = a.kind == ScannerBody and a.phase == Delivered
pure def sometimesScannerGrantExpired(a: ReadAccess): bool = a.kind == ScannerBody and a.phase == Aborted
```

A website administrator has no automatic case role. Outputs, logs,
analytics, caches and public totals omit private case content, counts and
financial amounts unless the receiving view has case authority; that
omission is a shell and frontend obligation verified by conformance, not by
this machine.

## Story: Retain private records permanently and scanner evidence by policy

### Only ordinary scanner evidence and scanner access logs ever become deletable

Report bodies, case audit records and contributor traces are permanent.
Successful admission evidence and any object still referenced are retained.
Other scanner evidence becomes deletable 90 days after closure. Scanner
recovery access logs are retained for one year. Private backups are daily and
retained for 30 days, and restoration requires a verified complete chain
before activation; the [shared evidence store](./evidence.md) owns those
steps.

```quint
type ObjectKind = ReportBodyObject | CaseAuditRecord | TraceObject | ScannerObject | ScannerAccessLog
type RetainedObject = { kind: ObjectKind, references: int, successfulAdmission: bool, caseOpen: bool, daysAfterClose: int, ageDays: int }
pure def mayDeleteObject(o: RetainedObject): bool =
  if (o.kind == ScannerObject) o.references == 0 and not(o.successfulAdmission) and not(o.caseOpen) and o.daysAfterClose >= 90
  else if (o.kind == ScannerAccessLog) o.ageDays >= 365
  else false
pure def lawPrivateRecordsPermanent(o: RetainedObject): bool =
  (o.kind == ReportBodyObject or o.kind == CaseAuditRecord or o.kind == TraceObject) implies not(mayDeleteObject(o))
pure def lawSuccessfulAdmissionPermanent(o: RetainedObject): bool = o.successfulAdmission and o.kind == ScannerObject implies not(mayDeleteObject(o))
pure def lawSharedObjectsRetained(o: RetainedObject): bool = o.references > 0 and o.kind == ScannerObject implies not(mayDeleteObject(o))
pure def lawAccessLogsKeptOneYear(o: RetainedObject): bool = o.kind == ScannerAccessLog and o.ageDays < 365 implies not(mayDeleteObject(o))
```

Contributor trace bodies remain permanent private R2 objects. The uploader
stores the exact contributor-reviewed bytes and never performs automatic
redaction.

### Simulation samples

```quint
pure val byValues = Set(1, 2, 4, 5, 6, 18633264, 202660855)
pure val actorValues = Set(6)
pure val checkedEpochValues = Set(1, 2)
pure val minutesValues = Set(1, 15)
pure val snapshotValues = Set({ ...C::staff, epoch: 2 }, { ...C::staff, epoch: 3, technical: List(3) })
pure val oValues = Set(
  { kind: ScannerObject, references: 0, successfulAdmission: false, caseOpen: false, daysAfterClose: 90, ageDays: 400 },
  { kind: ScannerObject, references: 1, successfulAdmission: false, caseOpen: false, daysAfterClose: 91, ageDays: 400 },
  { kind: ScannerObject, references: 0, successfulAdmission: true, caseOpen: false, daysAfterClose: 100, ageDays: 400 },
  { kind: ReportBodyObject, references: 0, successfulAdmission: false, caseOpen: false, daysAfterClose: 1000, ageDays: 4000 },
  { kind: ScannerAccessLog, references: 0, successfulAdmission: false, caseOpen: false, daysAfterClose: 0, ageDays: 364 })
```
