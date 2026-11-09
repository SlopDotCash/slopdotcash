// @source backend/security/submissions.ts
// @source backend/security/github-advisories.ts
// @source backend/security/report-intake.ts
// @source backend/security/handler.ts
// @source migrations/0059_private_security_submissions.sql
// @source migrations/0101_durable_security_intake.sql
// @evidence backend/security/submissions.test.ts
// Two verification requests for one owned submission and one possible
// competing advisory case. Direct reports start as drafts; Slop reports have
// a submitted advisory. Actor/grant admission, parsed advisory fields and exact
// cryptography are caller/input predicates, not proofs in this model.
// Source, author, private-report, time and marker checks precede current
// routing-contact lookup. Missing contacts records a contacts-unavailable
// event after identity checks, without persisting new facts/digests or creating
// an ownerless case. Legacy creation and durable linking
// have different writes: the latter keeps the already saved case.
// Row/event/case/access/notice writes are one guarded batch. A later readback
// or HTTP failure cannot undo it. A concurrent same-submission winner is
// returned; an unrelated case with the advisory is refused without its data.
// Five revisions are an exploration bound. Analysis contents and recommendations
// are abstracted; they grant no receipt, payout or severity authority. Provider
// freshness, SQL implementation, actual grants and full reconciliation are
// separate boundaries. All scenarios are source-authored and unexecuted.
module submission_receipt_verification {
  val ids = Set(1, 2)
  val faults = Set("valid", "unavailable", "not-found", "source", "author", "not-private", "future", "marker")
  // Failure-code classification only; later retry admission is outside this invocation.
  val terminalFailures = Set("author-mismatch", "already-recorded", "not-private-report", "unverifiable")
  type Request = { phase: str, revision: int, rowState: str, outcome: str,
    failureCode: str, factsValid: bool, contacts: bool, committed: bool, status: int, returnedReceipt: bool }
  val unused: Request = { phase: "unused", revision: 0, rowState: "none", outcome: "none",
    failureCode: "none", factsValid: false, contacts: false, committed: false, status: 0, returnedReceipt: false }
  var s: { configured: bool, origin: str, durable: bool, rowState: str, revision: int,
    receipt: bool, caseCount: int, newCase: bool, caseEvent: bool, accessLog: bool,
    notice: bool, contactsEvent: bool, otherCase: bool, failedDuplicate: bool, failureCode: str,
    requests: int -> Request, recovered: bool }
  action init = s' = { configured: false, origin: "slop", durable: false,
    rowState: "submitted", revision: 1, receipt: false, caseCount: 0,
    newCase: false, caseEvent: false, accessLog: false, notice: false,
    contactsEvent: false, otherCase: false, failedDuplicate: false, failureCode: "none",
    requests: ids.mapBy(_ => unused), recovered: false }
  def response(r: Request, status: int): Request = r.with("phase", "done").with("status", status)
  action configure(origin: str, durable: bool): bool = all { not(s.configured),
    Set("slop", "direct").contains(origin), durable implies origin == "slop",
    s' = s.with("configured", true).with("origin", origin).with("durable", durable)
      .with("rowState", if (origin == "direct") "draft" else "submitted")
      .with("caseCount", if (durable) 1 else 0) }
  action begin(id: int): bool = all { s.configured, ids.contains(id), s.requests.get(id).phase == "unused",
    not(s.receipt), Set("draft", "submitted").contains(s.rowState),
    s' = s.with("requests", s.requests.set(id, unused.with("phase", "terms")
      .with("revision", s.revision).with("rowState", s.rowState))) }
  action terms(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "terms", s' = s.with("requests", s.requests.set(id,
      if (available) r.with("phase", "facts") else response(r, 500))) }
  }
  action advisory(id: int, fault: str): bool = {
    val r = s.requests.get(id)
    val stay = fault == "unavailable" or (fault == "not-found" and s.origin == "slop")
    val valid = fault == "valid" or (s.origin == "slop" and fault == "not-private")
      or (s.origin == "direct" and fault == "marker")
    val failure = if (fault == "not-found") "not-found" else if (fault == "author") "author-mismatch"
      else if (fault == "not-private") "not-private-report" else "invalid"
    all { r.phase == "facts", faults.contains(fault),
      s' = s.with("requests", s.requests.set(id,
        if (valid) r.with("phase", "contacts").with("factsValid", true)
        else r.with("phase", "write").with("outcome", if (stay) "stay" else "fail")
          .with("failureCode", if (stay) "none" else failure))) }
  }
  action contacts(id: int, outcome: str): bool = {
    val r = s.requests.get(id)
    all { r.phase == "contacts", Set("ready", "none", "unavailable", "unexpected").contains(outcome),
      s' = s.with("requests", s.requests.set(id,
        if (outcome == "unexpected") response(r, 500)
        else if (outcome != "ready") r.with("phase", "write").with("outcome", "contacts-stay")
        else r.with("contacts", true).with("phase", if (s.durable) "write" else "prepare")
          .with("outcome", "verify"))) }
  }
  // The legacy path obtains historical policy and prepares all dependent
  // writes; a failure before the batch leaves the submission untouched.
  action prepare(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "prepare", s' = s.with("requests", s.requests.set(id,
      if (available) r.with("phase", "write") else response(r, 500))) }
  }
  action otherAdvisoryCase = all { not(s.receipt), not(s.otherCase), s' = s.with("otherCase", true) }
  action concurrentTransition = all { s.configured, not(s.receipt), s.revision < 5,
    s' = s.with("revision", s.revision + 1) }
  // A failure known to precede commit. An ambiguous batch result has its own edge.
  action batchFailureBeforeCommit(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "write", s' = s.with("requests", s.requests.set(id, response(r, 500))) }
  }
  action commit(id: int): bool = {
    val r = s.requests.get(id)
    val same = s.revision == r.revision and s.rowState == r.rowState
    val verifying = r.outcome == "verify"
    val duplicate = verifying and s.otherCase
    val success = same and not(duplicate)
    all { r.phase == "write", success implies s.revision < 5,
      s' = if (not(success)) s.with("requests", s.requests.set(id, r.with("phase", "resolve")))
      else s.with("revision", s.revision + 1)
        .with("rowState", if (verifying) "receipt-verified" else if (r.outcome == "fail") "failed" else s.rowState)
        .with("failureCode", if (r.outcome == "fail") r.failureCode else "none")
        .with("receipt", s.receipt or verifying)
        .with("caseCount", if (verifying) 1 else s.caseCount)
        .with("newCase", s.newCase or (verifying and not(s.durable)))
        .with("caseEvent", s.caseEvent or (verifying and not(s.durable)))
        .with("accessLog", s.accessLog or (verifying and not(s.durable)))
        .with("notice", s.notice or (verifying and not(s.durable)))
        .with("contactsEvent", s.contactsEvent or r.outcome == "contacts-stay")
        .with("requests", s.requests.set(id, r.with("phase", "reply").with("committed", true))) }
  }
  // The atomic batch committed, but its awaited result never reached the caller.
  action lostBatchResult(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "reply", r.committed,
      s' = s.with("requests", s.requests.set(id, response(r, 500))) }
  }
  action reply(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "reply", s' = s.with("requests", s.requests.set(id,
      if (not(available)) response(r, 500)
      else response(r, if (Set("stay", "contacts-stay").contains(r.outcome)) 202 else 200)
        .with("returnedReceipt", r.outcome == "verify"))) }
  }
  action resolve(id: int): bool = {
    val r = s.requests.get(id)
    val unchanged = s.revision == r.revision and s.rowState == r.rowState
    val markDuplicate = r.outcome == "verify" and not(s.receipt) and s.otherCase and unchanged
    all { r.phase == "resolve", markDuplicate implies s.revision < 5,
      s' = s.with("failedDuplicate", s.failedDuplicate or markDuplicate)
        .with("rowState", if (markDuplicate) "failed" else s.rowState)
        .with("failureCode", if (markDuplicate) "already-recorded" else s.failureCode)
        .with("revision", if (markDuplicate) s.revision + 1 else s.revision)
        .with("requests", s.requests.set(id,
          if (r.outcome == "verify") response(r, if (s.receipt) 200 else 409).with("returnedReceipt", s.receipt)
          else response(r, if (Set("stay", "contacts-stay").contains(r.outcome)) 202 else 200))) }
  }
  action recoverReceipt = all { s.receipt, s' = s.with("recovered", true) }
  val permanentFailure = s.rowState == "failed" and terminalFailures.contains(s.failureCode)
  action step = {
    nondet id = ids.oneOf()
    nondet origin = Set("slop", "direct").oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet fault = faults.oneOf()
    nondet outcome = Set("ready", "none", "unavailable", "unexpected").oneOf()
    any { configure(origin, yes), begin(id), terms(id, yes), advisory(id, fault), contacts(id, outcome),
      prepare(id, yes), otherAdvisoryCase, concurrentTransition, batchFailureBeforeCommit(id), commit(id), lostBatchResult(id), reply(id, yes), resolve(id), recoverReceipt, s' = s }
  }
  val invariant = all { s.revision >= 1 and s.revision <= 5, s.caseCount >= 0 and s.caseCount <= 1,
    s.receipt implies s.rowState == "receipt-verified" and s.caseCount == 1,
    s.rowState == "failed" implies s.failureCode != "none",
    s.failedDuplicate implies permanentFailure,
    s.newCase == s.caseEvent, s.newCase == s.accessLog, s.newCase == s.notice,
    s.durable implies s.caseCount == 1 and not(s.newCase),
    ids.forall(id => {
      val r = s.requests.get(id)
      all { r.returnedReceipt implies s.receipt,
        r.outcome == "verify" implies r.factsValid and r.contacts }
    }) }
  action found(id: int): bool = begin(id).then(terms(id, true)).then(advisory(id, "valid"))
  action routed(id: int): bool = found(id).then(contacts(id, "ready"))
  action legacyReady(id: int): bool = routed(id).then(prepare(id, true))
  action done(id: int): bool = commit(id).then(reply(id, true))
  run directReportCreatesOneAtomicCaseTest = init.then(configure("direct", false)).then(legacyReady(1)).then(done(1))
    .expect(s.receipt and s.newCase and s.caseEvent and s.notice and invariant)
  run durableReportLinksExistingCaseTest = init.then(configure("slop", true)).then(routed(1)).then(done(1))
    .expect(s.receipt and s.caseCount == 1 and not(s.newCase) and invariant)
  run directNotFoundFailsTest = init.then(configure("direct", false)).then(begin(1)).then(terms(1, true))
    .then(advisory(1, "not-found")).then(done(1)).expect(s.rowState == "failed" and not(permanentFailure) and s.caseCount == 0 and invariant)
  run slopNotFoundRemainsRecoverableTest = init.then(configure("slop", false)).then(begin(1)).then(terms(1, true))
    .then(advisory(1, "not-found")).then(done(1)).expect(s.rowState == "submitted" and s.requests.get(1).status == 202 and invariant)
  run authorMismatchCreatesNoCaseTest = init.then(configure("direct", false)).then(begin(1)).then(terms(1, true))
    .then(advisory(1, "author")).then(done(1)).expect(permanentFailure and not(s.receipt) and s.caseCount == 0 and invariant)
  run directNonPrivateReportRefusesTest = init.then(configure("direct", false)).then(begin(1)).then(terms(1, true))
    .then(advisory(1, "not-private")).then(done(1)).expect(permanentFailure and invariant)
  run missingSlopMarkerRefusesTest = init.then(configure("slop", false)).then(begin(1)).then(terms(1, true))
    .then(advisory(1, "marker")).then(done(1)).expect(s.rowState == "failed" and not(permanentFailure) and invariant)
  run futureReceiptRefusesTest = init.then(configure("direct", false)).then(begin(1)).then(terms(1, true))
    .then(advisory(1, "future")).then(done(1)).expect(not(s.receipt) and invariant)
  run missingContactsKeepsEvidenceWithoutOwnerlessCaseTest = init.then(configure("slop", false)).then(found(1))
    .then(contacts(1, "none")).then(done(1)).expect(s.contactsEvent and s.caseCount == 0 and s.rowState == "submitted" and invariant)
  run unavailableContactsKeepsDurableCaseTest = init.then(configure("slop", true)).then(found(1))
    .then(contacts(1, "unavailable")).then(done(1)).expect(s.caseCount == 1 and not(s.receipt) and invariant)
  run historicalPolicyFailureWritesNothingTest = init.then(configure("direct", false)).then(routed(1)).then(prepare(1, false))
    .expect(s.revision == 1 and s.caseCount == 0 and invariant)
  run concurrentVerificationReturnsExistingReceiptTest = init.then(configure("direct", false)).then(legacyReady(1)).then(legacyReady(2))
    .then(done(1)).then(commit(2)).then(resolve(2)).expect(s.caseCount == 1 and s.requests.get(2).returnedReceipt and invariant)
  run changedSubmissionRefusesCapturedCaseWriteTest = init.then(configure("direct", false)).then(legacyReady(1))
    .then(concurrentTransition).then(commit(1)).then(resolve(1)).expect(s.requests.get(1).status == 409 and s.caseCount == 0 and invariant)
  run anotherCaseKeepsItsIdentityPrivateTest = init.then(configure("direct", false)).then(legacyReady(1)).then(otherAdvisoryCase)
    .then(commit(1)).then(resolve(1)).expect(s.failedDuplicate and s.caseCount == 0 and s.requests.get(1).status == 409 and invariant)
  run batchFailureDoesNotPartiallyCreateCaseTest = init.then(configure("direct", false)).then(legacyReady(1)).then(batchFailureBeforeCommit(1))
    .expect(s.revision == 1 and not(s.caseEvent) and not(s.notice) and invariant)
  run lostBatchResultKeepsAtomicReceiptTest = init.then(configure("direct", false)).then(legacyReady(1)).then(commit(1)).then(lostBatchResult(1))
    .then(recoverReceipt).expect(s.receipt and s.caseEvent and s.accessLog and s.notice and s.recovered and s.requests.get(1).status == 500 and invariant)
  run staleReadResolvesAtRevisionBoundTest = init.then(configure("direct", false)).then(legacyReady(1))
    .then(concurrentTransition).then(concurrentTransition).then(concurrentTransition).then(concurrentTransition)
    .then(commit(1)).then(resolve(1)).expect(s.revision == 5 and s.requests.get(1).status == 409 and not(s.receipt) and invariant)
  run lostReplyKeepsCommittedReceiptTest = init.then(configure("direct", false)).then(legacyReady(1)).then(commit(1)).then(reply(1, false))
    .then(recoverReceipt).expect(s.receipt and s.recovered and s.requests.get(1).status == 500 and invariant)
}
