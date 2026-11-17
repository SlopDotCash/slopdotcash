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

Report bodies, case audit records and contributor traces are permanent
private records: no machine has a deletion path for them. Contributor trace
bodies are permanent private R2 objects; the uploader stores the exact
contributor-reviewed bytes and never performs automatic redaction. Scanner
evidence retention, permanent successful admission evidence and
reference-aware cleanup belong to the [shared evidence store](./evidence.md),
and daily private backups, one-year access-log retention and verified
restoration to
[backup](../operations/backup.md).

### A scanner evidence grant is redeemed once, and a download needs exactly one grant cookie, a same-origin GET and no range

A designated scanner operator asks for a read grant on one evidence object of
one run of one assessment (`backend/vetting/evidence.ts`). The grant records
the operator, the object and a reason, is audited as `grant`, and expires
after fifteen minutes. Only the SHA-256 of its random token is stored. Small
evidence is read with the token in `x-vetting-read-grant`; large evidence
needs a download grant, delivered as an `HttpOnly`, `Secure`,
`SameSite=Strict` cookie scoped to that object's download path. Redeeming
consumes the grant in one compare-and-set (`consumed_at` was empty, the
token, object and operator match and the grant has not expired), so a second
use, an expired grant, another operator's grant or a grant for another object
answers 403 `grant_invalid` and delivers nothing. A download that is not a
GET (HEAD included) answers 405 `method_not_allowed`; one that is not a
same-origin browser request or carries a `Range` header answers 403
`origin_forbidden`; one with no grant cookie or more than one answers 403
`grant_invalid`. These refusals come before the grant is consumed. A
consumed grant stays consumed when the stream later aborts, and the stream
records `download-authorized`, `download-started` and exactly one of
`download-finished`, `download-failed` or `download-cancelled`. The response
offers no ranges (`accept-ranges: none`).

```quint
type DownloadMethod = DownloadGet | DownloadHead | DownloadOther
type EvidenceDownload = { method: DownloadMethod, sameOrigin: bool, ranged: bool, grantCookies: int }
type DownloadRefusal = DownloadAccepted | MethodNotAllowed | OriginForbidden | GrantInvalid
type EvidenceGrant = { grantOperator: int, grantObject: int, expiresAtMinute: int, consumed: bool }
pure def downloadRefusal(download: EvidenceDownload): DownloadRefusal =
  if (download.method != DownloadGet) MethodNotAllowed
  else if (not(download.sameOrigin) or download.ranged) OriginForbidden
  else if (download.grantCookies != 1) GrantInvalid
  else DownloadAccepted
pure def grantRedeemable(grant: EvidenceGrant, operator: int, evidenceObject: int, nowMinute: int): bool =
  not(grant.consumed) and grant.grantOperator == operator and grant.grantObject == evidenceObject and nowMinute < grant.expiresAtMinute
pure def redeemed(grant: EvidenceGrant): EvidenceGrant = { ...grant, consumed: true }
pure def lawGrantRedeemedOnce(grant: EvidenceGrant, operator: int, evidenceObject: int, nowMinute: int): bool =
  not(grantRedeemable(redeemed(grant), operator, evidenceObject, nowMinute))
pure def lawExpiredGrantRefused(grant: EvidenceGrant, operator: int, evidenceObject: int, nowMinute: int): bool =
  nowMinute >= grant.expiresAtMinute implies not(grantRedeemable(grant, operator, evidenceObject, nowMinute))
pure def lawHeadAndRangeRefused(download: EvidenceDownload): bool =
  (download.method != DownloadGet or download.ranged) implies downloadRefusal(download) != DownloadAccepted
pure def lawOneGrantCookie(download: EvidenceDownload): bool =
  download.grantCookies != 1 implies downloadRefusal(download) != DownloadAccepted
pure val cleanDownload: EvidenceDownload = { method: DownloadGet, sameOrigin: true, ranged: false, grantCookies: 1 }
pure val downloadValues = Set(cleanDownload, { ...cleanDownload, method: DownloadHead }, { ...cleanDownload, ranged: true },
  { ...cleanDownload, sameOrigin: false }, { ...cleanDownload, grantCookies: 2 }, { ...cleanDownload, grantCookies: 0 })
pure val openGrant: EvidenceGrant = { grantOperator: 18633264, grantObject: 1, expiresAtMinute: 15, consumed: false }
pure val grantValues = Set(openGrant, { ...openGrant, consumed: true }, { ...openGrant, grantOperator: 202660855 })
pure val operatorValues = Set(18633264, 202660855)
pure val evidenceObjectValues = Set(1, 2)
pure val nowMinuteValues = Set(0, 14, 15)
```

### Simulation samples

```quint
pure val byValues = Set(1, 2, 4, 5, 6, 18633264, 202660855)
pure val actorValues = Set(6)
pure val checkedEpochValues = Set(1, 2)
pure val minutesValues = Set(1, 15)
pure val snapshotValues = Set({ ...C::staff, epoch: 2 }, { ...C::staff, epoch: 3, technical: List(3) })
```
