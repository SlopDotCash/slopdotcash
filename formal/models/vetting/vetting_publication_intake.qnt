// @source backend/vetting/handler.ts
// @source backend/vetting/persistence.ts
// @source migrations/0074_vetting_publication_journal.sql
// @evidence backend/vetting/publication-journal.test.ts
// Signed serviceJournal: two calls and two assessment identifiers, two exact
// intent identities, one immutable intent/receipt per identifier. UTF-8/JSON,
// exact object keys and metadata grammar are bounded outcome classes. Signature
// and body-size checks have their own model. A known assessment may already be
// completed; has intentionally permits a readiness id that is not an assessment.
// Receipt outcome/status are operator reports, not proof of result acceptance.
// Native SQL atomicity, foreign keys and immutability triggers are assumptions
// linked to migrated SQL regression definitions. A lost INSERT reply can leave
// a durable row; retry conflict is distinct from an acknowledged first success.
module vetting_publication_intake {
  val callIds = Set(1, 2)
  val assessmentIds = Set(1, 2)
  type Intent = { present: bool, digest: int, origin: int, disposition: str }
  type Receipt = { present: bool, intent: Intent, outcome: str, httpStatus: int }
  type Call = { phase: str, operation: str, target: int, identity: Intent,
    auth: int, decoded: bool, idValid: bool, exactKeys: bool, metadata: bool,
    outcome: str, httpStatus: int, status: int, present: bool, storeRead: bool,
    assessmentRead: bool, committed: bool, received: bool }
  val absent: Intent = { present: false, digest: 0, origin: 0, disposition: "none" }
  val identity: Intent = { present: true, digest: 1, origin: 1, disposition: "incomplete" }
  val noReceipt: Receipt = { present: false, intent: absent, outcome: "none", httpStatus: -1 }
  val fresh: Call = { phase: "new", operation: "reserve", target: 1, identity: identity,
    auth: 0, decoded: true, idValid: true, exactKeys: true, metadata: true,
    outcome: "unknown", httpStatus: -1, status: 0, present: false,
    storeRead: false, assessmentRead: false, committed: false, received: false }
  var s: { assessments: Set[int], intents: int -> Intent, receipts: int -> Receipt,
    calls: int -> Call, intentWrites: int -> int, receiptWrites: int -> int }
  action init = s' = { assessments: Set(1), intents: assessmentIds.mapBy(_ => absent),
    receipts: assessmentIds.mapBy(_ => noReceipt), calls: callIds.mapBy(_ => fresh),
    intentWrites: assessmentIds.mapBy(_ => 0), receiptWrites: assessmentIds.mapBy(_ => 0) }
  def request(id: int): Call = s.calls.get(id)
  pure def ended(c: Call, status: int): Call = c.with("phase", "done").with("status", status)
  action configure(id: int, operation: str, target: int, alternate: bool): bool = {
    val c = request(id)
    all { c.phase == "new", assessmentIds.contains(target),
      s' = s.with("calls", s.calls.set(id, c.with("operation", operation).with("target", target)
        .with("identity", if (alternate) identity.with("digest", 2).with("origin", 2).with("disposition", "malicious") else identity))) }
  }
  action malformed(id: int, kind: str): bool = {
    val c = request(id)
    all { c.phase == "new", s' = s.with("calls", s.calls.set(id,
      if (kind == "signature") c.with("auth", 1)
      else if (kind == "keys") c.with("auth", 2)
      else if (kind == "decode") c.with("decoded", false)
      else if (kind == "id") c.with("idValid", false)
      else if (kind == "fields") c.with("exactKeys", false)
      else c.with("metadata", false))) }
  }
  action reportedReceipt(id: int, outcome: str, status: int): bool = {
    val c = request(id)
    all { c.phase == "new", s' = s.with("calls", s.calls.set(id, c.with("outcome", outcome).with("httpStatus", status))) }
  }
  action authenticate(id: int): bool = {
    val c = request(id)
    all { c.phase == "new", s' = s.with("calls", s.calls.set(id,
      if (c.auth == 0) c.with("phase", "decode") else ended(c, if (c.auth == 1) 401 else 503))) }
  }
  action parseBody(id: int): bool = {
    val c = request(id)
    all { c.phase == "decode", s' = s.with("calls", s.calls.set(id,
      if (not(c.decoded) or not(c.idValid)) ended(c, 400)
      else if (c.operation == "has") (if (c.exactKeys) c.with("phase", "has") else ended(c, 400))
      else if (not(Set("reserve", "complete").contains(c.operation)) or not(c.exactKeys) or not(c.metadata)) ended(c, 400)
      else c.with("phase", "assessment"))) }
  }
  action readPresence(id: int): bool = {
    val c = request(id)
    all { c.phase == "has", s' = s.with("calls", s.calls.set(id,
      c.with("storeRead", true).with("present", s.intents.get(c.target).present).with("phase", "reply").with("status", 200))) }
  }
  action readAssessment(id: int): bool = {
    val c = request(id)
    val validReceipt = Set("accepted", "rejected", "unknown").contains(c.outcome)
      and (c.httpStatus == -1 or (c.httpStatus >= 100 and c.httpStatus <= 599))
    val observed = c.with("assessmentRead", true)
    all { c.phase == "assessment", s' = s.with("calls", s.calls.set(id,
      if (not(s.assessments.contains(c.target))) ended(observed, 404)
      else if (c.operation == "complete" and not(validReceipt)) ended(observed, 400)
      else observed.with("phase", "write"))) }
  }
  action write(id: int): bool = {
    val c = request(id)
    val prior = s.intents.get(c.target)
    val receipt = s.receipts.get(c.target)
    val commitIntent = c.operation == "reserve" and not(prior.present)
    val matching = prior == c.identity
    val commitReceipt = c.operation == "complete" and matching and not(receipt.present)
    val committed = commitIntent or commitReceipt
    val status = if (committed) 200 else if (c.operation == "complete" and not(matching)) 422 else 409
    all { c.phase == "write",
      s' = s.with("intents", if (commitIntent) s.intents.set(c.target, c.identity) else s.intents)
        .with("receipts", if (commitReceipt) s.receipts.set(c.target,
          { present: true, intent: c.identity, outcome: c.outcome, httpStatus: c.httpStatus }) else s.receipts)
        .with("intentWrites", if (commitIntent) s.intentWrites.set(c.target, 1) else s.intentWrites)
        .with("receiptWrites", if (commitReceipt) s.receiptWrites.set(c.target, 1) else s.receiptWrites)
        .with("calls", s.calls.set(id, c.with("phase", "writeReply").with("status", status).with("committed", committed))) }
  }
  action observeWrite(id: int, replyLost: bool): bool = {
    val c = request(id)
    all { c.phase == "writeReply", s' = s.with("calls", s.calls.set(id,
      c.with("phase", "reply").with("status", if (replyLost) 500 else c.status))) }
  }
  action readFailure(id: int): bool = {
    val c = request(id)
    all { Set("has", "assessment", "write").contains(c.phase),
      s' = s.with("calls", s.calls.set(id, ended(c, 500))) }
  }
  action deliver(id: int, received: bool): bool = {
    val c = request(id)
    all { c.phase == "reply", s' = s.with("calls", s.calls.set(id,
      c.with("phase", "done").with("received", received))) }
  }
  action restart(id: int): bool = all { request(id).phase == "done", s' = s.with("calls", s.calls.set(id, fresh)) }
  action addAssessment = s' = s.with("assessments", s.assessments.union(Set(2)))
  action ready(id: int): bool = authenticate(id).then(parseBody(id)).then(readAssessment(id))
  action reserve(id: int): bool = ready(id).then(write(id)).then(observeWrite(id, false)).then(deliver(id, true))
  action presence(id: int): bool = authenticate(id).then(parseBody(id)).then(readPresence(id)).then(deliver(id, true))
  action step = {
    nondet id = callIds.oneOf()
    nondet target = assessmentIds.oneOf()
    nondet operation = Set("has", "reserve", "complete", "invalid").oneOf()
    nondet alternate = Set(false, true).oneOf()
    nondet kind = Set("signature", "keys", "decode", "id", "fields", "metadata").oneOf()
    nondet outcome = Set("accepted", "rejected", "unknown", "invalid").oneOf()
    nondet status = Set(-1, 0, 100, 200, 599, 600).oneOf()
    any { configure(id, operation, target, alternate), malformed(id, kind), reportedReceipt(id, outcome, status),
      authenticate(id), parseBody(id), readPresence(id), readAssessment(id), write(id),
      observeWrite(id, alternate), readFailure(id), deliver(id, alternate), restart(id), addAssessment, s' = s }
  }
  val invariant = all {
    assessmentIds.forall(id => all {
      s.intentWrites.get(id) <= 1, s.receiptWrites.get(id) <= 1,
      s.intents.get(id).present == (s.intentWrites.get(id) == 1),
      s.receipts.get(id).present == (s.receiptWrites.get(id) == 1),
      s.intents.get(id).present implies s.assessments.contains(id),
      s.receipts.get(id).present implies s.receipts.get(id).intent == s.intents.get(id)
    }),
    callIds.forall(id => { val c = request(id)
      all { c.storeRead implies c.operation == "has", c.committed implies c.assessmentRead,
        c.committed implies Set("reserve", "complete").contains(c.operation),
        c.status == 200 implies (c.operation == "has" or c.committed) } })
  }
  run readinessProbeDoesNotNeedAssessmentTest = init.then(configure(1, "has", 2, false)).then(presence(1))
    .expect(request(1).status == 200 and not(request(1).present) and not(request(1).assessmentRead))
  run unsignedNeverReadsTablesTest = init.then(malformed(1, "signature")).then(authenticate(1)).expect(request(1).status == 401 and not(request(1).assessmentRead))
  run missingKeysPrecedeParsingTest = init.then(malformed(1, "keys")).then(malformed(1, "decode")).then(authenticate(1)).expect(request(1).status == 503)
  run invalidBodyRefusedTest = init.then(malformed(1, "decode")).then(authenticate(1)).then(parseBody(1)).expect(request(1).status == 400)
  run invalidIdRefusedBeforeStoreTest = init.then(malformed(1, "id")).then(authenticate(1)).then(parseBody(1)).expect(request(1).status == 400 and not(request(1).assessmentRead))
  run extraHasFieldRefusedTest = init.then(configure(1, "has", 1, false)).then(malformed(1, "fields")).then(authenticate(1)).then(parseBody(1)).expect(request(1).status == 400)
  run unsupportedOperationRefusedTest = init.then(configure(1, "invalid", 1, false)).then(authenticate(1)).then(parseBody(1)).expect(request(1).status == 400)
  run metadataRefusedBeforeExistenceTest = init.then(configure(1, "reserve", 2, false)).then(malformed(1, "metadata")).then(authenticate(1)).then(parseBody(1)).expect(request(1).status == 400 and not(request(1).assessmentRead))
  run missingAssessmentRefusedTest = init.then(configure(1, "reserve", 2, false)).then(ready(1)).expect(request(1).status == 404)
  run missingAssessmentPrecedesBadOutcomeTest = init.then(configure(1, "complete", 2, false)).then(reportedReceipt(1, "invalid", 600)).then(ready(1)).expect(request(1).status == 404)
  run knownAssessmentChecksBadOutcomeTest = init.then(configure(1, "complete", 1, false)).then(reportedReceipt(1, "invalid", -1)).then(ready(1)).expect(request(1).status == 400)
  run outOfRangeStatusRefusedTest = init.then(configure(1, "complete", 1, false)).then(reportedReceipt(1, "unknown", 600)).then(ready(1)).expect(request(1).status == 400)
  run reserveCommitsOnceTest = init.then(reserve(1)).then(reserve(2)).expect(request(1).status == 200 and request(2).status == 409 and invariant)
  run competingDifferentIntentCannotReplaceTest = init.then(configure(2, "reserve", 1, true)).then(ready(1)).then(ready(2)).then(write(1)).then(write(2)).expect(s.intents.get(1) == identity and request(2).status == 409)
  run readBeforeReservationKeepsCapturedFalseTest = init.then(configure(1, "has", 1, false)).then(authenticate(1)).then(parseBody(1)).then(readPresence(1)).then(reserve(2)).then(deliver(1, true)).expect(not(request(1).present) and s.intents.get(1).present)
  run readAfterReservationReturnsTrueTest = init.then(reserve(1)).then(configure(2, "has", 1, false)).then(presence(2)).expect(request(2).present)
  run failedWriteDoesNotReserveTest = init.then(ready(1)).then(readFailure(1)).expect(not(s.intents.get(1).present) and request(1).status == 500)
  run lostInsertReplyRetainsReservationTest = init.then(ready(1)).then(write(1)).then(observeWrite(1, true)).then(deliver(1, true)).then(reserve(2)).expect(request(1).status == 500 and request(2).status == 409 and invariant)
  run lostResponseRetainsReservationTest = init.then(ready(1)).then(write(1)).then(observeWrite(1, false)).then(deliver(1, false)).then(reserve(2)).expect(not(request(1).received) and request(2).status == 409)
  run noIntentReceiptRefusedTest = init.then(configure(1, "complete", 1, false)).then(reserve(1)).expect(request(1).status == 422 and not(s.receipts.get(1).present))
  run mismatchedIntentReceiptRefusedTest = init.then(reserve(1)).then(configure(2, "complete", 1, true)).then(reserve(2)).expect(request(2).status == 422 and not(s.receipts.get(1).present))
  run exactReceiptCommitsTest = init.then(reserve(1)).then(configure(2, "complete", 1, false)).then(reserve(2)).expect(s.receipts.get(1).present and request(2).status == 200 and invariant)
  run acceptedNullStatusIsOnlyReportedMetadataTest = init.then(reserve(1)).then(configure(2, "complete", 1, false)).then(reportedReceipt(2, "accepted", -1)).then(reserve(2)).expect(s.receipts.get(1).outcome == "accepted" and s.receipts.get(1).httpStatus == -1)
  run lowStatusBoundaryAcceptedTest = init.then(reserve(1)).then(configure(2, "complete", 1, false)).then(reportedReceipt(2, "unknown", 100)).then(reserve(2)).expect(request(2).status == 200)
  run highStatusBoundaryAcceptedTest = init.then(reserve(1)).then(configure(2, "complete", 1, false)).then(reportedReceipt(2, "rejected", 599)).then(reserve(2)).expect(request(2).status == 200)
  run duplicateReceiptNeverOverwritesTest = init.then(reserve(1)).then(restart(1)).then(configure(1, "complete", 1, false)).then(reserve(1)).then(configure(2, "complete", 1, false)).then(reportedReceipt(2, "accepted", 200)).then(reserve(2)).expect(request(2).status == 409 and s.receipts.get(1).outcome == "unknown")
  run mismatchedReceiptAfterPriorReceiptStillMissingTest = init.then(reserve(1)).then(restart(1)).then(configure(1, "complete", 1, false)).then(reserve(1)).then(configure(2, "complete", 1, true)).then(reserve(2)).expect(request(2).status == 422)
  run lostReceiptReplyRetainsReceiptTest = init.then(reserve(1)).then(configure(2, "complete", 1, false)).then(ready(2)).then(write(2)).then(observeWrite(2, true)).expect(request(2).status == 500 and s.receipts.get(1).present and invariant)
  run independentAssessmentCanReserveTest = init.then(addAssessment).then(reserve(1)).then(configure(2, "reserve", 2, true)).then(reserve(2)).expect(s.intents.get(1).present and s.intents.get(2).present)
}
