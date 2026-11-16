module security__privacy { // # Private access and retained evidence

// PRD sections 2, 8 and 10 require current authority on every private read.
// The protocol returns report bodies only through audited case access. Trace
// bodies have no website or API read route for any role.

// ## Story: Read only authorized retained evidence

// ### Read authorization is scoped, expiring and audited

// The representative case belongs to actor 1. Current case reviewers are supplied
// by fresh role lookup. Scanner operator grants expire after fifteen minutes.
// The shell must fence the complete response stream on authority revocation.

// ```quint
type BodyKind = ReportBody | ScannerBody | ContributorTrace
type ReadAccess = { kind: BodyKind, requester: int, caseOwner: int, caseReviewer: bool, scannerOperator: bool, grantAgeMinutes: int, authorityCurrent: bool, audited: bool, delivered: bool }
pure val initial: ReadAccess = { kind: ReportBody, requester: 0, caseOwner: 1, caseReviewer: false, scannerOperator: false, grantAgeMinutes: 15, authorityCurrent: false, audited: false, delivered: false }
pure def scannerActorAllowed(actor: int): bool = actor == 18633264 or actor == 202660855
pure val byValues = Set(1, 2, 18633264, 202660855)
pure def canRequestRead(a: ReadAccess, kind: BodyKind, by: int, caseReviewer: bool): bool = by > 0 and not(a.delivered)
pure def requestRead(a: ReadAccess, kind: BodyKind, by: int, caseReviewer: bool): ReadAccess = { ...a, kind: kind, requester: by, caseReviewer: caseReviewer, scannerOperator: scannerActorAllowed(by), grantAgeMinutes: 0, authorityCurrent: true, audited: false }
pure def allowed(a: ReadAccess): bool = a.authorityCurrent and a.grantAgeMinutes < 15 and (if (a.kind == ReportBody) a.requester == a.caseOwner or a.caseReviewer else if (a.kind == ScannerBody) a.scannerOperator else false)
pure def canRecordAudit(a: ReadAccess): bool = allowed(a)
pure def recordAudit(a: ReadAccess): ReadAccess = { ...a, audited: true }
pure def canDeliver(a: ReadAccess): bool = allowed(a) and a.audited and not(a.delivered)
pure def deliver(a: ReadAccess): ReadAccess = { ...a, delivered: true }
pure def canExpire(a: ReadAccess): bool = not(a.delivered)
pure def expire(a: ReadAccess): ReadAccess = { ...a, grantAgeMinutes: 15, authorityCurrent: false }
pure def alwaysAuditedDelivery(a: ReadAccess): bool = a.delivered implies a.audited and allowed(a)
pure def alwaysNoTraceRead(a: ReadAccess): bool = a.kind == ContributorTrace implies not(a.delivered)
pure def sometimesReportRead(a: ReadAccess): bool = a.kind == ReportBody and a.delivered
pure def sometimesScannerRead(a: ReadAccess): bool = a.kind == ScannerBody and a.delivered
// ```

// `scannerOperator` is true only for the two policy-authorized operators after
// identity verification. A website administrator has no automatic case role.
// Outputs, logs, analytics, caches and public totals omit private case content,
// counts and financial amounts unless the receiving view has case authority.

// ## Story: Retain evidence while any obligation references it

// ### Content-addressed objects cannot be deleted while retained

// ```quint
type RetainedObject = { references: int, successfulAdmission: bool, caseOpen: bool, daysAfterClose: int, present: bool }
pure val emptyObject: RetainedObject = { references: 0, successfulAdmission: false, caseOpen: true, daysAfterClose: 0, present: true }
pure val oValues = Set(
  { references: 0, successfulAdmission: false, caseOpen: false, daysAfterClose: 90, present: true },
  { references: 1, successfulAdmission: false, caseOpen: false, daysAfterClose: 91, present: true },
  { references: 0, successfulAdmission: true, caseOpen: false, daysAfterClose: 100, present: true },
  { references: 0, successfulAdmission: false, caseOpen: true, daysAfterClose: 100, present: true },
  { references: 0, successfulAdmission: false, caseOpen: false, daysAfterClose: 89, present: true }
)
pure def mayDeleteObject(o: RetainedObject): bool = o.references == 0 and not(o.successfulAdmission) and not(o.caseOpen) and o.daysAfterClose >= 90
pure def lawSuccessfulAdmissionPermanent(o: RetainedObject): bool = o.successfulAdmission implies not(mayDeleteObject(o))
pure def lawSharedObjectsRetained(o: RetainedObject): bool = o.references > 0 implies not(mayDeleteObject(o))
// ```

// Failed, incomplete and malicious scanner cases require authorized closure.
// Other scanner evidence remains for 90 days after closure. Private backups are
// daily and retained for 30 days. Access logs remain for one year. Restoration
// requires a verified complete chain before activation. Contributor trace bodies
// remain permanent private R2 objects. The uploader stores the exact
// contributor-reviewed bytes and never performs automatic redaction.

// ### Simulation samples exercise missing, matching and conflicting evidence

// These input sets bound simulation only. The generated guards accept every
// value allowed by their declared types and product rules.

// ```quint
pure val actorValues = Set(0, 1, 2)
// ```

}
