// @source migrations/0006_private_intake_status.sql
// @source migrations/0001_private_trace_backend.sql
// @source migrations/0005_atomic_trace_attachment.sql
// @source migrations/0058_trace_write_reservations.sql
// @source backend/trace/handler.ts
// @source backend/trace/cloudflare-persistence.ts
// @source backend/trace/contracts.ts
// @source backend/trace/auth.ts
// @source backend/trace/validation.ts
// @evidence scripts/trace-upload-attachable.test.ts
// One already-created owned run, two capability keys, two digest/metadata
// representatives and two overlapping HTTP requests, each dispatched at most
// twice. Exact intent creation/renewal is in api_trace_intent_admission.
// A digest represents matching bytes, size and media type. Crypto, body parsing
// and R2 verification are predicates, not implementation-refinement proofs.
module api_trace {
  type Intent = { exists: bool, digest: int, live: bool, spent: bool }
  type Request = { stage: str, key: int, digest: int, inTime: bool,
    admitted: bool, writeAuthorized: bool, attempts: int,
    result: str, responsePhase: str }
  val ids = Set(1, 2)
  val noIntent = { exists: false, digest: 0, live: false, spent: false }
  val idle = { stage: "idle", key: 1, digest: 0, inTime: false,
    admitted: false, writeAuthorized: false, attempts: 0,
    result: "none", responsePhase: "none" }
  var s: { phase: str, runDigest: int, reservation: int,
    reservationWitness: int, intents: int -> Intent,
    requests: int -> Request, objects: Set[int], metadata: Set[int],
    uploads: Set[int], commits: Set[int], banned: bool, intakeReady: bool,
    events: int, finalizedEvents: int, finalized: bool,
    legacyHistoryIntact: bool, removedRequests: int, reads: int }
  action init = s' = { phase: "awaiting_trace", runDigest: 0,
    reservation: 0, reservationWitness: 0,
    intents: ids.mapBy(_ => noIntent), requests: ids.mapBy(_ => idle),
    objects: Set(), metadata: Set(), uploads: Set(), commits: Set(),
    banned: false, intakeReady: false, events: 0, finalizedEvents: 0,
    finalized: false, legacyHistoryIntact: true, removedRequests: 0, reads: 0 }
  def compatible(digest: int): bool = s.runDigest == 0 or s.runDigest == digest
  def mayReserve(digest: int): bool = not(s.banned)
    and s.phase != "finalized" and compatible(digest)
  def ended(request: Request, result: str): Request =
    request.with("stage", "done").with("result", result)
  action verifyIntake = s' = s.with("intakeReady", true)
  action disableIntake = s' = s.with("intakeReady", false)
  action ban = s' = s.with("banned", true)
  action reinstate = s' = s.with("banned", false)
  action issueIntent(key: int, digest: int): bool = all {
    ids.contains(key), ids.contains(digest), not(s.intents.get(key).exists),
    mayReserve(digest),
    s' = s.with("intents", s.intents.set(key,
      { exists: true, digest: digest, live: true, spent: false })) }
  action expire(key: int): bool = all {
    ids.contains(key), s.intents.get(key).exists, s.intents.get(key).live,
    s' = s.with("intents", s.intents.set(key,
      s.intents.get(key).with("live", false))) }
  // uploadTraceCapability captures authorizedAt before its first lookup.
  // Expiry after this point does not change the captured expiry comparison.
  action dispatch(slot: int, key: int): bool = {
    val request = s.requests.get(slot)
    val intent = s.intents.get(key)
    all { ids.contains(slot), ids.contains(key),
      Set("idle", "done").contains(request.stage), request.attempts < 2,
      s' = s.with("requests", s.requests.set(slot,
        { stage: "capability", key: key, digest: intent.digest,
          inTime: intent.exists and intent.live, admitted: false,
          writeAuthorized: false, attempts: request.attempts + 1,
          result: "none", responsePhase: "none" })) }
  }
  action readCapability(slot: int): bool = {
    val request = s.requests.get(slot)
    val intent = s.intents.get(request.key)
    val accepted = request.inTime and intent.exists and not(intent.spent)
    all { ids.contains(slot), request.stage == "capability",
      s' = s.with("requests", s.requests.set(slot,
        if (accepted) request.with("stage", "validate").with("admitted", true)
        else ended(request, "capability-invalid"))) }
  }
  // Collapses the early ban/intake checks and exact bounded body validation.
  // The later reservation SQL still observes a ban or finalization after it.
  action validateUpload(slot: int, validBytes: bool): bool = {
    val request = s.requests.get(slot)
    val accepted = not(s.banned) and s.intakeReady and validBytes
    all { ids.contains(slot), request.stage == "validate",
      s' = s.with("requests", s.requests.set(slot,
        if (accepted) request.with("stage", "reserve")
        else ended(request, "preflight-refused"))) }
  }
  // INSERT and its SELECT readback are separate awaits. ON CONFLICT keeps the
  // first immutable reservation even if this request names another digest.
  action reserveInsert(slot: int): bool = {
    val request = s.requests.get(slot)
    val inserted = s.reservation == 0 and mayReserve(request.digest)
    all { ids.contains(slot), request.stage == "reserve",
      s' = s.with("reservation", if (inserted) request.digest else s.reservation)
        .with("reservationWitness", if (inserted) request.digest else s.reservationWitness)
        .with("requests", s.requests.set(slot, request.with("stage", "reserved-read"))) }
  }
  action readReservation(slot: int): bool = {
    val request = s.requests.get(slot)
    val accepted = s.reservation == request.digest and mayReserve(request.digest)
    all { ids.contains(slot), request.stage == "reserved-read",
      s' = s.with("requests", s.requests.set(slot,
        if (accepted) request.with("stage", "put").with("writeAuthorized", true)
        else ended(request, "reservation-conflict"))) }
  }
  // R2 may create bytes despite a lost response. No later failure removes
  // them. created=false also represents finding the existing immutable key.
  action putBytes(slot: int, created: bool): bool = {
    val request = s.requests.get(slot)
    all { ids.contains(slot), request.stage == "put", request.writeAuthorized,
      s' = s.with("objects", if (created) s.objects.union(Set(request.digest)) else s.objects)
        .with("requests", s.requests.set(slot, request.with("stage", "verify-object"))) }
  }
  action verifyObject(slot: int, exact: bool): bool = {
    val request = s.requests.get(slot)
    val accepted = exact and s.objects.contains(request.digest)
    all { ids.contains(slot), request.stage == "verify-object",
      s' = s.with("requests", s.requests.set(slot,
        if (accepted) request.with("stage", "attach")
        else ended(request, "storage-error"))) }
  }
  // This is the five-statement D1 batch and its assertion trigger, not five
  // independently committed writes. A refused/failed batch retains R2 and
  // the reservation while changing none of these D1 record families.
  action attach(slot: int, batchSucceeds: bool): bool = {
    val request = s.requests.get(slot)
    val intent = s.intents.get(request.key)
    val allowed = request.admitted and request.inTime and not(intent.spent)
      and mayReserve(request.digest) and s.objects.contains(request.digest)
    val committed = allowed and batchSucceeds
    all { ids.contains(slot), request.stage == "attach",
      s' = s.with("intents", if (committed) s.intents.set(request.key,
          intent.with("spent", true)) else s.intents)
        .with("metadata", if (committed) s.metadata.union(Set(request.digest)) else s.metadata)
        .with("uploads", if (committed) s.uploads.union(Set(request.key)) else s.uploads)
        .with("commits", if (committed) s.commits.union(Set(request.key)) else s.commits)
        .with("runDigest", if (committed) request.digest else s.runDigest)
        .with("phase", if (committed) "trace_uploaded" else s.phase)
        .with("requests", s.requests.set(slot,
          if (committed) request.with("stage", "reply")
          else ended(request, if (allowed) "attachment-error" else "attachment-conflict"))) }
  }
  // The final getRun can observe another request's later finalization.
  action reply(slot: int): bool = {
    val request = s.requests.get(slot)
    all { ids.contains(slot), request.stage == "reply",
      s' = s.with("requests", s.requests.set(slot,
        ended(request, "created").with("responsePhase", s.phase))) }
  }
  // A D1 batch may commit before its response is lost. The catch/readback or
  // the caller can observe failure while the consumed capability stays spent.
  action loseAttachmentReply(slot: int): bool = {
    val request = s.requests.get(slot)
    all { ids.contains(slot), request.stage == "reply",
      s' = s.with("requests", s.requests.set(slot,
        ended(request, "attachment-response-lost"))) }
  }
  action finalize = all { s.runDigest != 0, not(s.banned),
    s' = s.with("phase", "finalized").with("finalized", true)
      .with("finalizedEvents", if (s.finalized) s.finalizedEvents else s.events) }
  action event = all { s.phase != "finalized", not(s.banned), s.events < 2,
    s' = s.with("events", s.events + 1) }
  // Historical grant/audit rows remain, but their old routes return 404.
  action removedRoute = all { s.removedRequests < 2,
    s' = s.with("removedRequests", s.removedRequests + 1) }
  action step = {
    nondet slot = ids.oneOf()
    nondet key = ids.oneOf()
    nondet digest = ids.oneOf()
    nondet successful = Set(false, true).oneOf()
    any { verifyIntake, disableIntake, ban, reinstate, issueIntent(key, digest),
      expire(key), dispatch(slot, key), readCapability(slot),
      validateUpload(slot, successful), reserveInsert(slot), readReservation(slot),
      putBytes(slot, successful), verifyObject(slot, successful),
      attach(slot, successful), reply(slot), loseAttachmentReply(slot),
      finalize, event, removedRoute, s' = s }
  }
  val invariant = all {
    s.reservation == s.reservationWitness,
    s.objects.forall(digest => digest == s.reservation),
    s.metadata.forall(digest => s.objects.contains(digest) and digest == s.runDigest),
    s.uploads == s.commits,
    ids.forall(key => s.intents.get(key).spent == s.commits.contains(key)),
    s.runDigest != 0 implies (s.metadata.contains(s.runDigest)
      and s.objects.contains(s.runDigest) and s.commits.size() > 0),
    (s.phase == "awaiting_trace") == (s.runDigest == 0),
    (s.phase == "finalized") == s.finalized,
    s.finalized implies s.events == s.finalizedEvents,
    ids.forall(slot => {
      val request = s.requests.get(slot)
      all { request.attempts >= 0, request.attempts <= 2,
        request.writeAuthorized implies request.admitted and request.digest == s.reservation,
        request.stage == "reply" implies s.commits.contains(request.key) }
    }),
    s.reads == 0, s.legacyHistoryIntact
  }
  run traceTest = init.then(verifyIntake).then(issueIntent(1, 1))
    .then(dispatch(1, 1)).then(readCapability(1)).then(validateUpload(1, true))
    .then(reserveInsert(1)).then(readReservation(1)).then(putBytes(1, true))
    .then(verifyObject(1, true)).then(attach(1, true)).then(reply(1))
    .then(event).then(finalize).expect(s.phase == "finalized" and s.events == 1 and invariant)
  // The previous orphanTest used expiry alone to prevent attachment. The real
  // request retains its admission time, so this witness uses failed R2 verification.
  run orphanTest = init.then(verifyIntake).then(issueIntent(1, 1))
    .then(dispatch(1, 1)).then(readCapability(1)).then(validateUpload(1, true))
    .then(reserveInsert(1)).then(readReservation(1)).then(putBytes(1, true))
    .then(verifyObject(1, false))
    .expect(s.objects.contains(1) and s.reservation == 1 and s.commits.size() == 0)
  run retiredGrantAndReadRemainUnavailableTest = init.then(removedRoute).then(removedRoute)
    .expect(s.reads == 0 and s.legacyHistoryIntact and s.removedRequests == 2)
  run competingDigestCannotChangeReservationTest = init.then(verifyIntake)
    .then(issueIntent(1, 1)).then(issueIntent(2, 2))
    .then(dispatch(1, 1)).then(readCapability(1)).then(validateUpload(1, true))
    .then(dispatch(2, 2)).then(readCapability(2)).then(validateUpload(2, true))
    .then(reserveInsert(1)).then(reserveInsert(2)).then(readReservation(2))
    .then(readReservation(1)).then(putBytes(1, true)).then(verifyObject(1, true))
    .then(attach(1, true)).expect(s.requests.get(2).result == "reservation-conflict"
      and s.reservation == 1 and s.objects == Set(1) and invariant)
  run failedWriteAllowsSameCapabilityRetryTest = init.then(verifyIntake).then(issueIntent(1, 1))
    .then(dispatch(1, 1)).then(readCapability(1)).then(validateUpload(1, true))
    .then(reserveInsert(1)).then(readReservation(1)).then(putBytes(1, false))
    .then(verifyObject(1, false)).then(dispatch(1, 1)).then(readCapability(1))
    .then(validateUpload(1, true)).then(reserveInsert(1)).then(readReservation(1))
    .then(putBytes(1, true)).then(verifyObject(1, true)).then(attach(1, true))
    .expect(s.reservation == 1 and s.commits == Set(1) and invariant)
  run lostWriteResponseRetainsBytesForRetryTest = init.then(verifyIntake).then(issueIntent(1, 1))
    .then(dispatch(1, 1)).then(readCapability(1)).then(validateUpload(1, true))
    .then(reserveInsert(1)).then(readReservation(1)).then(putBytes(1, true))
    .then(verifyObject(1, false)).then(dispatch(1, 1)).then(readCapability(1))
    .then(validateUpload(1, true)).then(reserveInsert(1)).then(readReservation(1))
    .then(putBytes(1, false)).then(verifyObject(1, true)).then(attach(1, true))
    .expect(s.objects == Set(1) and s.commits == Set(1) and invariant)
  run banBeforeReservationRefusesWriteTest = init.then(verifyIntake).then(issueIntent(1, 1))
    .then(dispatch(1, 1)).then(readCapability(1)).then(validateUpload(1, true))
    .then(ban).then(reserveInsert(1)).then(readReservation(1))
    .expect(s.reservation == 0 and s.objects.size() == 0
      and s.requests.get(1).result == "reservation-conflict")
  run banBetweenReservationAndReadbackRetainsOnlyReservationTest = init
    .then(verifyIntake).then(issueIntent(1, 1)).then(dispatch(1, 1))
    .then(readCapability(1)).then(validateUpload(1, true)).then(reserveInsert(1))
    .then(ban).then(readReservation(1)).expect(s.reservation == 1
      and s.objects.size() == 0 and s.commits.size() == 0)
  run banAfterReservationRetainsUnattachedBytesTest = init.then(verifyIntake)
    .then(issueIntent(1, 1)).then(dispatch(1, 1)).then(readCapability(1))
    .then(validateUpload(1, true)).then(reserveInsert(1)).then(readReservation(1))
    .then(ban).then(putBytes(1, true)).then(verifyObject(1, true)).then(attach(1, true))
    .expect(s.objects == Set(1) and s.metadata.size() == 0 and s.commits.size() == 0
      and not(s.intents.get(1).spent) and s.phase == "awaiting_trace" and invariant)
  run admittedRequestMayFinishAfterExpiryTest = init.then(verifyIntake)
    .then(issueIntent(1, 1)).then(dispatch(1, 1)).then(expire(1))
    .then(readCapability(1)).then(validateUpload(1, true)).then(reserveInsert(1))
    .then(readReservation(1)).then(putBytes(1, true)).then(verifyObject(1, true))
    .then(attach(1, true)).expect(not(s.intents.get(1).live)
      and s.intents.get(1).spent and s.commits == Set(1) and invariant)
  run expiredBeforeDispatchRefusesCapabilityTest = init.then(verifyIntake)
    .then(issueIntent(1, 1)).then(expire(1)).then(dispatch(1, 1)).then(readCapability(1))
    .expect(s.requests.get(1).result == "capability-invalid" and s.reservation == 0)
  run duplicateCapabilityHasOnlyOneCommitTest = init.then(verifyIntake)
    .then(issueIntent(1, 1)).then(dispatch(1, 1)).then(dispatch(2, 1))
    .then(readCapability(1)).then(readCapability(2)).then(validateUpload(1, true))
    .then(validateUpload(2, true)).then(reserveInsert(1)).then(reserveInsert(2))
    .then(readReservation(1)).then(readReservation(2)).then(putBytes(1, true))
    .then(putBytes(2, false)).then(verifyObject(1, true)).then(verifyObject(2, true))
    .then(attach(1, true)).then(attach(2, true)).expect(s.commits == Set(1)
      and s.requests.get(2).result == "attachment-conflict" and invariant)
  run twoCapabilitiesMayAttachOneDigestTest = init.then(verifyIntake)
    .then(issueIntent(1, 1)).then(issueIntent(2, 1))
    .then(dispatch(1, 1)).then(readCapability(1)).then(validateUpload(1, true))
    .then(reserveInsert(1)).then(readReservation(1)).then(putBytes(1, true))
    .then(verifyObject(1, true)).then(attach(1, true))
    .then(dispatch(2, 2)).then(readCapability(2)).then(validateUpload(2, true))
    .then(reserveInsert(2)).then(readReservation(2)).then(putBytes(2, false))
    .then(verifyObject(2, true)).then(attach(2, true))
    .expect(s.commits == Set(1, 2) and s.metadata == Set(1) and invariant)
  run finalizedRunRefusesLateAttachmentTest = init.then(verifyIntake)
    .then(issueIntent(1, 1)).then(issueIntent(2, 1))
    .then(dispatch(1, 1)).then(readCapability(1)).then(validateUpload(1, true))
    .then(reserveInsert(1)).then(readReservation(1)).then(putBytes(1, true))
    .then(verifyObject(1, true)).then(attach(1, true))
    .then(dispatch(2, 2)).then(readCapability(2)).then(validateUpload(2, true))
    .then(reserveInsert(2)).then(readReservation(2)).then(putBytes(2, false))
    .then(verifyObject(2, true)).then(finalize).then(attach(2, true))
    .expect(s.phase == "finalized" and s.commits == Set(1)
      and not(s.intents.get(2).spent) and invariant)
  run failedBatchRetainsCapabilityAndAllowsRetryTest = init.then(verifyIntake)
    .then(issueIntent(1, 1)).then(dispatch(1, 1)).then(readCapability(1))
    .then(validateUpload(1, true)).then(reserveInsert(1)).then(readReservation(1))
    .then(putBytes(1, true)).then(verifyObject(1, true)).then(attach(1, false))
    .expect(s.objects == Set(1) and s.metadata.size() == 0
      and s.uploads.size() == 0 and not(s.intents.get(1).spent))
    .then(dispatch(1, 1)).then(readCapability(1)).then(validateUpload(1, true))
    .then(reserveInsert(1)).then(readReservation(1)).then(putBytes(1, false))
    .then(verifyObject(1, true)).then(attach(1, true)).expect(s.commits == Set(1) and invariant)
  run invalidBytesNeverReserveTest = init.then(verifyIntake).then(issueIntent(1, 1))
    .then(dispatch(1, 1)).then(readCapability(1)).then(validateUpload(1, false))
    .expect(s.reservation == 0 and s.objects.size() == 0)
  run unavailableIntakeNeverReservesTest = init.then(issueIntent(1, 1))
    .then(dispatch(1, 1)).then(readCapability(1)).then(validateUpload(1, true))
    .expect(s.reservation == 0 and s.objects.size() == 0)
  run finalizationBeforeReplyIsVisibleTest = init.then(verifyIntake).then(issueIntent(1, 1))
    .then(dispatch(1, 1)).then(readCapability(1)).then(validateUpload(1, true))
    .then(reserveInsert(1)).then(readReservation(1)).then(putBytes(1, true))
    .then(verifyObject(1, true)).then(attach(1, true)).then(finalize).then(reply(1))
    .expect(s.requests.get(1).result == "created"
      and s.requests.get(1).responsePhase == "finalized" and invariant)
  run lostAttachmentReplyRetainsAtomicReceiptTest = init.then(verifyIntake)
    .then(issueIntent(1, 1)).then(dispatch(1, 1)).then(readCapability(1))
    .then(validateUpload(1, true)).then(reserveInsert(1)).then(readReservation(1))
    .then(putBytes(1, true)).then(verifyObject(1, true)).then(attach(1, true))
    .then(loseAttachmentReply(1)).then(dispatch(1, 1)).then(readCapability(1))
    .then(finalize).expect(s.requests.get(1).result == "capability-invalid"
      and s.commits == Set(1) and s.phase == "finalized" and invariant)
  run finalizationFreezesEventsTest = init.then(verifyIntake).then(issueIntent(1, 1))
    .then(dispatch(1, 1)).then(readCapability(1)).then(validateUpload(1, true))
    .then(reserveInsert(1)).then(readReservation(1)).then(putBytes(1, true))
    .then(verifyObject(1, true)).then(attach(1, true)).then(event).then(finalize)
    .expect(s.events == 1 and invariant).then(event.fail())
  run banPreservesAttachedReceiptAndRefusesFinalizationTest = init.then(verifyIntake)
    .then(issueIntent(1, 1)).then(dispatch(1, 1)).then(readCapability(1))
    .then(validateUpload(1, true)).then(reserveInsert(1)).then(readReservation(1))
    .then(putBytes(1, true)).then(verifyObject(1, true)).then(attach(1, true)).then(ban)
    .expect(s.commits == Set(1) and s.phase == "trace_uploaded" and invariant)
    .then(finalize.fail())
}
