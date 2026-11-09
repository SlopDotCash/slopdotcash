// @source backend/trace/handler.ts
// @source backend/trace/cloudflare-persistence.ts
// @source backend/trace/contracts.ts
// @source migrations/0001_private_trace_backend.sql
// @evidence scripts/trace-upload-attachable.test.ts
// One owned run, two event keys/payload classes, two request slots (each used
// once), and clock ranks 0..2. The run begins awaiting a trace; attach abstracts
// the separately modeled upload. Route authentication is already complete.
// Owner/body/idempotency predicates summarize the actual source checks. Event
// payload equality includes every sameEvent field, but not generated id/time.
// Event INSERT is guarded by current ownership, finalization and ban state.
// A same-key constraint race returns conflict, not a second existing-row read;
// a later request can observe existing data. This models current source policy.
// Finalization's key is required syntax only; it is not persisted or compared.
// Repeated finalization preserves the first committed finalized_at through
// COALESCE, even when a later write carries an older captured timestamp.
// Statement effects, metadata/replies and readback are separate. A missing
// changes count or lost reply may follow a committed effect. Snapshots can be
// older than later ban/finalization state. No rollback, eventual success, clock
// fairness, provider verification or implementation refinement is assumed.
// The existing workflow covers finalization/ban behavior; it does not execute
// every event-constraint race or missing-count/readback outcome modeled here.
module trace_event_finalization {
  val ids = Set(1, 2)
  val operations = Set("event", "finalize")
  val owners = Set("own", "other", "missing")
  val replyKinds = Set("ok", "missing-count", "error")
  type Request = { phase: str, op: str, key: int, payload: int, owner: str,
    valid: bool, stamp: int, committed: bool, returnedPayload: int,
    desired: str, response: str }
  val idle: Request = { phase: "unused", op: "event", key: 1, payload: 1,
    owner: "own", valid: true, stamp: -1, committed: false, returnedPayload: 0,
    desired: "none", response: "none" }
  var s: { now: int, trace: bool, finalized: bool, finalizedAt: int,
    finalizedEvents: int, banned: bool, events: int -> int, requests: int -> Request }
  action init = s' = { now: 0, trace: false, finalized: false, finalizedAt: -1,
    finalizedEvents: 0, banned: false, events: ids.mapBy(_ => 0), requests: ids.mapBy(_ => idle) }
  def ending(request: Request, desired: str): Request = request.with("phase", "response").with("desired", desired)
  val eventCount = ids.filter(key => s.events.get(key) != 0).size()
  action attach = all { not(s.finalized), not(s.banned), s' = s.with("trace", true) }
  action tick = all { s.now < 2, s' = s.with("now", s.now + 1) }
  action setBan(banned: bool): bool = s' = s.with("banned", banned)
  action begin(id: int, op: str, key: int, payload: int, owner: str, valid: bool): bool = all {
    ids.contains(id), ids.contains(key), ids.contains(payload), operations.contains(op), owners.contains(owner),
    s.requests.get(id).phase == "unused",
    s' = s.with("requests", s.requests.set(id, idle.with("phase", "admission").with("op", op)
      .with("key", key).with("payload", payload).with("owner", owner).with("valid", valid))) }
  action admission(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "admission",
      s' = s.with("requests", s.requests.set(id,
        if (s.banned) ending(request, "403")
        else if (request.op == "finalize" and not(request.valid)) ending(request, "400")
        else request.with("phase", "owner"))) }
  }
  action readOwner(id: int): bool = {
    val request = s.requests.get(id)
    val nextValue = if (request.owner == "missing") ending(request, "404")
      else if (request.owner != "own") ending(request, "404")
      else if (request.op == "event" and s.finalized) ending(request, "409")
      else if (request.op == "finalize" and not(s.trace)) ending(request, "409")
      else request.with("phase", if (request.op == "event") "body" else "finalize-clock")
    all { request.phase == "owner", s' = s.with("requests", s.requests.set(id, nextValue)) }
  }
  action validateEvent(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "body",
      s' = s.with("requests", s.requests.set(id,
        if (request.valid) request.with("phase", "event-read").with("stamp", s.now)
        else ending(request, "400"))) }
  }
  action readEvent(id: int): bool = {
    val request = s.requests.get(id)
    val existing = s.events.get(request.key)
    all { request.phase == "event-read",
      s' = s.with("requests", s.requests.set(id,
        if (existing == 0) request.with("phase", "event-write")
        else if (existing == request.payload) ending(request, "200").with("returnedPayload", existing)
        else request.with("phase", "conflict-ban"))) }
  }
  action insertEvent(id: int): bool = {
    val request = s.requests.get(id)
    val allowed = not(s.banned) and not(s.finalized) and s.events.get(request.key) == 0
    all { request.phase == "event-write",
      s' = s.with("events", if (allowed) s.events.set(request.key, request.payload) else s.events)
        .with("requests", s.requests.set(id,
          if (allowed) request.with("phase", "write-reply").with("committed", true)
          else request.with("phase", "conflict-ban"))) }
  }
  action captureFinalizeTime(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "finalize-clock", s' = s.with("requests", s.requests.set(id,
      request.with("phase", "finalize-write").with("stamp", s.now))) }
  }
  action finalizeWrite(id: int): bool = {
    val request = s.requests.get(id)
    val allowed = not(s.banned) and s.trace
    all { request.phase == "finalize-write",
      s' = s.with("finalizedAt", if (allowed and not(s.finalized)) request.stamp else s.finalizedAt)
        .with("finalizedEvents", if (allowed and not(s.finalized)) eventCount else s.finalizedEvents)
        .with("finalized", s.finalized or allowed)
        .with("requests", s.requests.set(id,
          if (allowed) request.with("phase", "write-reply").with("committed", true)
          else request.with("phase", "conflict-ban"))) }
  }
  action writeReply(id: int, kind: str): bool = {
    val request = s.requests.get(id)
    all { request.phase == "write-reply", replyKinds.contains(kind),
      s' = s.with("requests", s.requests.set(id,
        if (kind == "error") ending(request, "error")
        else if (kind == "missing-count") request.with("phase", "conflict-ban")
        else if (request.op == "finalize") request.with("phase", "finalize-read")
        else ending(request, "201").with("returnedPayload", request.payload))) }
  }
  action readFinalized(id: int, observed: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "finalize-read",
      s' = s.with("requests", s.requests.set(id,
        if (observed and s.finalized) ending(request, "200") else request.with("phase", "conflict-ban"))) }
  }
  action conflictBan(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "conflict-ban", s' = s.with("requests", s.requests.set(id,
      ending(request, if (s.banned) "403" else "409"))) }
  }
  action readOrWriteFailure(id: int): bool = {
    val request = s.requests.get(id)
    all { Set("admission", "owner", "body", "event-read", "event-write", "finalize-clock", "finalize-write", "finalize-read", "conflict-ban").contains(request.phase),
      s' = s.with("requests", s.requests.set(id, ending(request, "error"))) }
  }
  action respond(id: int, delivered: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "response", s' = s.with("requests", s.requests.set(id,
      request.with("phase", "done").with("response", if (delivered) request.desired else "lost"))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet key = ids.oneOf()
    nondet payload = ids.oneOf()
    nondet op = operations.oneOf()
    nondet owner = owners.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet kind = replyKinds.oneOf()
    any { attach, tick, setBan(yes), begin(id, op, key, payload, owner, yes), admission(id), readOwner(id),
      validateEvent(id), readEvent(id), insertEvent(id), captureFinalizeTime(id), finalizeWrite(id),
      writeReply(id, kind), readFinalized(id, yes), conflictBan(id), readOrWriteFailure(id), respond(id, yes), s' = s }
  }
  val invariant = all {
    s.now >= 0, s.now <= 2, eventCount <= 2,
    s.finalized implies s.trace and s.finalizedAt >= 0 and s.finalizedAt <= s.now and eventCount == s.finalizedEvents,
    not(s.finalized) implies s.finalizedAt == -1,
    ids.forall(id => {
      val request = s.requests.get(id)
      all { request.committed implies request.owner == "own" and request.valid,
        request.op == "event" and request.response == "201" implies request.committed,
        request.returnedPayload != 0 implies request.returnedPayload == s.events.get(request.key),
        request.op == "finalize" and request.response == "200" implies s.finalized }
    }) }
  action eventReady(id: int, key: int, payload: int): bool = begin(id, "event", key, payload, "own", true)
    .then(admission(id)).then(readOwner(id)).then(validateEvent(id)).then(readEvent(id))
  action eventStored(id: int, key: int, payload: int): bool = eventReady(id, key, payload)
    .then(insertEvent(id)).then(writeReply(id, "ok")).then(respond(id, true))
  action finalizeReady(id: int): bool = begin(id, "finalize", 1, 1, "own", true)
    .then(admission(id)).then(readOwner(id)).then(captureFinalizeTime(id))
  action finalized(id: int): bool = finalizeReady(id).then(finalizeWrite(id)).then(writeReply(id, "ok"))
    .then(readFinalized(id, true)).then(respond(id, true))

  run eventThenFinalizeFreezesHistoryTest = init.then(eventStored(1, 1, 1)).then(attach).then(finalized(2))
    .expect(s.finalized and s.finalizedEvents == 1 and invariant)
  run identicalLaterEventReturnsStoredRecordTest = init.then(eventStored(1, 1, 1)).then(eventReady(2, 1, 1)).then(respond(2, true))
    .expect(eventCount == 1 and s.requests.get(2).response == "200" and invariant)
  run differentPayloadConflictsTest = init.then(eventStored(1, 1, 1)).then(eventReady(2, 1, 2)).then(conflictBan(2)).then(respond(2, true))
    .expect(eventCount == 1 and s.requests.get(2).response == "409" and invariant)
  run overlappingIdenticalEventsCanReturnConflictTest = init.then(eventReady(1, 1, 1)).then(eventReady(2, 1, 1))
    .then(insertEvent(1)).then(insertEvent(2)).then(conflictBan(2)).then(respond(2, true)).then(writeReply(1, "ok")).then(respond(1, true))
    .expect(s.requests.get(1).response == "201" and s.requests.get(2).response == "409" and eventCount == 1 and invariant)
  run separateEventKeysBothPersistTest = init.then(eventStored(1, 1, 1)).then(eventStored(2, 2, 2)).expect(eventCount == 2 and invariant)
  run eventReplyLossKeepsRecordTest = init.then(eventReady(1, 1, 1)).then(insertEvent(1)).then(writeReply(1, "error")).then(respond(1, true))
    .then(eventReady(2, 1, 1)).then(respond(2, true)).expect(s.requests.get(2).response == "200" and eventCount == 1 and invariant)
  run missingEventChangesCountDoesNotUndoInsertTest = init.then(eventReady(1, 1, 1)).then(insertEvent(1))
    .then(writeReply(1, "missing-count")).then(conflictBan(1)).then(respond(1, true)).expect(eventCount == 1 and s.requests.get(1).response == "409" and invariant)
  run lateBanPreventsEventInsertTest = init.then(eventReady(1, 1, 1)).then(setBan(true)).then(insertEvent(1)).then(conflictBan(1)).then(respond(1, true))
    .expect(eventCount == 0 and s.requests.get(1).response == "403" and invariant)
  run existingReadCanFinishAfterLateBanTest = init.then(eventStored(1, 1, 1)).then(begin(2, "event", 1, 1, "own", true))
    .then(admission(2)).then(readOwner(2)).then(validateEvent(2)).then(setBan(true)).then(readEvent(2)).then(respond(2, true))
    .expect(s.requests.get(2).response == "200" and s.banned and invariant)
  run eventReadAfterFinalizationIsRefusedTest = init.then(attach).then(finalized(1)).then(begin(2, "event", 1, 1, "own", true))
    .then(admission(2)).then(readOwner(2)).then(respond(2, true)).expect(eventCount == 0 and s.requests.get(2).response == "409" and invariant)
  run finalizationBetweenEventReadAndWritePreventsInsertTest = init.then(attach).then(eventReady(1, 1, 1)).then(finalized(2))
    .then(insertEvent(1)).then(conflictBan(1)).then(respond(1, true)).expect(s.finalized and eventCount == 0 and invariant)
  run finalizationRequiresAttachedTraceTest = init.then(begin(1, "finalize", 1, 1, "own", true)).then(admission(1)).then(readOwner(1)).then(respond(1, true))
    .expect(not(s.finalized) and s.requests.get(1).response == "409" and invariant)
  run invalidFinalizationKeyPrecedesOwnerReadTest = init.then(begin(1, "finalize", 1, 1, "other", false)).then(admission(1)).then(respond(1, true))
    .expect(s.requests.get(1).response == "400" and invariant)
  run otherOwnerCannotAppendTest = init.then(begin(1, "event", 1, 1, "other", true)).then(admission(1)).then(readOwner(1)).then(respond(1, true))
    .expect(eventCount == 0 and s.requests.get(1).response == "404" and invariant)
  run missingRunIsNotOwnerSuccessTest = init.then(begin(1, "event", 1, 1, "missing", true)).then(admission(1)).then(readOwner(1)).then(respond(1, true))
    .expect(s.requests.get(1).response == "404" and invariant)
  run invalidEventBodyHasNoWriteTest = init.then(begin(1, "event", 1, 1, "own", false)).then(admission(1)).then(readOwner(1)).then(validateEvent(1)).then(respond(1, true))
    .expect(eventCount == 0 and s.requests.get(1).response == "400" and invariant)
  run repeatedFinalizationKeepsFirstStampTest = init.then(attach).then(finalized(1)).then(tick).then(finalized(2))
    .expect(s.finalizedAt == 0 and s.requests.get(2).response == "200" and invariant)
  run laterWriterCannotReplaceStampWithEarlierCaptureTest = init.then(attach).then(finalizeReady(1)).then(tick).then(finalizeReady(2))
    .then(finalizeWrite(2)).then(writeReply(2, "ok")).then(readFinalized(2, true)).then(respond(2, true))
    .then(finalizeWrite(1)).then(writeReply(1, "ok")).then(readFinalized(1, true)).then(respond(1, true))
    .expect(s.finalizedAt == 1 and s.requests.get(1).stamp == 0 and invariant)
  run lateBanRefusesFinalizationTest = init.then(attach).then(finalizeReady(1)).then(setBan(true)).then(finalizeWrite(1)).then(conflictBan(1)).then(respond(1, true))
    .expect(not(s.finalized) and s.requests.get(1).response == "403" and invariant)
  run finalizationCommitSurvivesLostReplyTest = init.then(attach).then(finalizeReady(1)).then(finalizeWrite(1)).then(writeReply(1, "error")).then(respond(1, true))
    .expect(s.finalized and s.requests.get(1).response == "error" and invariant)
  run missingFinalizationChangesCountKeepsCommitTest = init.then(attach).then(finalizeReady(1)).then(finalizeWrite(1))
    .then(writeReply(1, "missing-count")).then(conflictBan(1)).then(respond(1, true))
    .expect(s.finalized and s.requests.get(1).response == "409" and invariant)
  run missingReadbackKeepsFinalizationTest = init.then(attach).then(finalizeReady(1)).then(finalizeWrite(1)).then(writeReply(1, "ok"))
    .then(readFinalized(1, false)).then(conflictBan(1)).then(respond(1, true)).expect(s.finalized and s.requests.get(1).response == "409" and invariant)
  run finalizationResponseCanFollowLaterBanTest = init.then(attach).then(finalizeReady(1)).then(finalizeWrite(1)).then(writeReply(1, "ok"))
    .then(setBan(true)).then(readFinalized(1, true)).then(respond(1, true)).expect(s.requests.get(1).response == "200" and s.banned and invariant)
  run responseDeliveryFailureDoesNotUndoFinalizationTest = init.then(attach).then(finalizeReady(1)).then(finalizeWrite(1)).then(writeReply(1, "ok"))
    .then(readFinalized(1, true)).then(respond(1, false)).expect(s.finalized and s.requests.get(1).response == "lost" and invariant)
}
