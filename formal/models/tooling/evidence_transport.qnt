// @source scripts/evidence-contract.mjs
// @source scripts/record-evidence.mjs
// @source scripts/evidence-bundle.mjs
// @evidence scripts/evidence-transport.test.ts
// One TLS probe and one response, a two-unit body bound and three chunks.
// Fake clock progress marks one absolute deadline; traffic cannot reset it.
// Native TLS/Web Stream details and network authenticity remain external.
module evidence_transport {
  var s: { tlsPhase: str, socketOpen: bool, validated: bool, closeRequested: bool,
    tlsPrimary: str, tlsCleanupError: bool, tlsResult: str, tlsSettlements: int, clock: int, deadlineExpired: bool,
    httpPhase: str, kind: str, bodyPresent: bool, bodyOpen: bool, locked: bool,
    received: int, chunks: int, httpPrimary: str, cleanupErrors: Set[str],
    httpResult: str, httpSettlements: int }
  action init = s' = { tlsPhase: "idle", socketOpen: false, validated: false, closeRequested: false,
    tlsPrimary: "none", tlsCleanupError: false, tlsResult: "pending", tlsSettlements: 0, clock: 0, deadlineExpired: false,
    httpPhase: "idle", kind: "headers", bodyPresent: false, bodyOpen: false, locked: false,
    received: 0, chunks: 0, httpPrimary: "none", cleanupErrors: Set(),
    httpResult: "pending", httpSettlements: 0 }
  action tlsStart = all { s.tlsPhase == "idle",
    s' = s.with("tlsPhase", "handshake").with("socketOpen", true) }
  action tlsCreationFailure = all { s.tlsPhase == "idle",
    s' = s.with("tlsPhase", "closed").with("tlsPrimary", "connect")
      .with("tlsResult", "failure").with("tlsSettlements", 1) }
  action tlsSecure(valid: bool): bool = all { s.tlsPhase == "handshake", s.tlsResult == "pending",
    s' = s.with("tlsPhase", "closing").with("closeRequested", true).with("validated", valid)
      .with("tlsPrimary", if (valid) "none" else "validation") }
  action tlsEarlyEnd = all { s.tlsPhase == "handshake", s.tlsResult == "pending",
    s' = s.with("tlsPhase", "closing").with("closeRequested", true)
      .with("tlsPrimary", "early-end") }
  action tlsError = all { s.socketOpen, s.tlsResult == "pending",
    s' = s.with("tlsPhase", "closing").with("closeRequested", true)
      .with("tlsPrimary", if (s.tlsPrimary == "none") "socket" else s.tlsPrimary) }
  action tick = all { s.clock == 0, s.socketOpen, s.tlsResult == "pending", s' = s.with("clock", 1) }
  action tlsActivity = all { s.socketOpen, s' = s }
  action tlsDeadline = all { s.socketOpen, s.clock == 1, s.tlsResult == "pending", not(s.deadlineExpired),
    s' = s.with("tlsPhase", "closing").with("closeRequested", true)
      .with("tlsPrimary", if (s.tlsPrimary == "none") "deadline" else s.tlsPrimary)
      .with("deadlineExpired", true) }
  action tlsFinishDeadline = all { s.deadlineExpired, s.tlsResult == "pending",
    s' = s.with("tlsResult", "failure").with("tlsSettlements", 1) }
  action tlsDestroyFailure = all { s.socketOpen, s.closeRequested, s.tlsResult == "pending",
    s' = s.with("tlsCleanupError", true)
      .with("tlsPrimary", if (s.tlsPrimary == "none") "destroy" else s.tlsPrimary)
      .with("tlsResult", "failure").with("tlsSettlements", 1) }
  action tlsClose = all { s.socketOpen,
    s' = s.with("socketOpen", false).with("tlsPhase", "closed")
      .with("tlsPrimary", if (s.tlsResult == "pending" and not(s.validated) and s.tlsPrimary == "none") "early-close" else s.tlsPrimary)
      .with("tlsResult", if (s.tlsResult != "pending") s.tlsResult
        else if (s.validated and s.tlsPrimary == "none") "success" else "failure")
      .with("tlsSettlements", 1) }
  action response(kind: str, hasBody: bool): bool = all { s.httpPhase == "idle",
    Set("headers", "bounded", "exact").contains(kind),
    s' = s.with("httpPhase", "operation").with("kind", kind)
      .with("bodyPresent", hasBody).with("bodyOpen", hasBody) }
  action fetchFailure = all { s.httpPhase == "idle",
    s' = s.with("httpPhase", "done").with("httpPrimary", "fetch")
      .with("httpResult", "failure").with("httpSettlements", 1) }
  action headers(valid: bool): bool = all { s.httpPhase == "operation",
    s' = if (not(valid)) s.with("httpPrimary", "headers").with("httpPhase", "cancel")
      else if (s.kind == "headers") s.with("httpPhase", "cancel")
      else s.with("httpPhase", "acquire") }
  action acquireReader = all { s.httpPhase == "acquire",
    s' = if (s.bodyPresent) s.with("locked", true).with("httpPhase", "reading")
      else s.with("httpPrimary", "missing-body").with("httpPhase", "cancel") }
  action readChunk = all { s.httpPhase == "reading", s.chunks < 3,
    s' = s.with("received", s.received + 1).with("chunks", s.chunks + 1)
      .with("httpPhase", if (s.received + 1 > 2) "release" else "reading")
      .with("httpPrimary", if (s.received + 1 > 2) "size" else "none") }
  action readEnd = all { s.httpPhase == "reading",
    s' = s.with("httpPhase", "release").with("bodyOpen", false) }
  action readFailure = all { s.httpPhase == "reading",
    s' = s.with("httpPhase", "release").with("httpPrimary", "read") }
  action releaseReader(ok: bool): bool = all { s.httpPhase == "release",
    s' = s.with("httpPhase", "after-read").with("locked", not(ok))
      .with("cleanupErrors", if (ok) s.cleanupErrors else s.cleanupErrors.union(Set("release"))) }
  action validateLength = all { s.httpPhase == "after-read",
    s' = s.with("httpPhase", "cancel").with("httpPrimary",
      if (s.httpPrimary != "none") s.httpPrimary
      else if (s.cleanupErrors == Set() and s.kind == "exact" and s.received != 2) "length" else "none") }
  action cancelBody(ok: bool): bool = {
    val clean = not(s.bodyPresent) or (ok and not(s.locked))
    all { s.httpPhase == "cancel",
      s' = s.with("httpPhase", "done").with("httpSettlements", 1)
        .with("bodyOpen", if (clean) false else s.bodyOpen)
        .with("cleanupErrors", if (clean) s.cleanupErrors else s.cleanupErrors.union(Set("cancel")))
        .with("httpResult", if (clean and s.httpPrimary == "none" and s.cleanupErrors == Set()) "success" else "failure") }
  }
  action step = {
    nondet ok = Set(false, true).oneOf()
    nondet kind = Set("headers", "bounded", "exact").oneOf()
    any { tlsStart, tlsCreationFailure, tlsSecure(ok), tlsEarlyEnd, tlsError,
      tick, tlsActivity, tlsDeadline, tlsFinishDeadline, tlsDestroyFailure, tlsClose, response(kind, ok),
      fetchFailure, headers(ok), acquireReader, readChunk, readEnd, readFailure,
      releaseReader(ok), validateLength, cancelBody(ok), s' = s }
  }
  val invariant = all {
    s.tlsSettlements <= 1, s.httpSettlements <= 1,
    s.tlsResult == "pending" iff s.tlsSettlements == 0,
    s.httpResult == "pending" iff s.httpSettlements == 0,
    s.tlsResult == "success" implies s.validated and not(s.socketOpen) and s.tlsPrimary == "none",
    s.tlsPrimary != "none" implies s.tlsResult != "success",
    s.httpResult == "success" implies not(s.bodyOpen) and not(s.locked)
      and s.httpPrimary == "none" and s.cleanupErrors == Set(),
    s.httpPrimary != "none" and s.httpPhase == "done" implies s.httpResult == "failure" }

  run tlsSuccessWaitsForCloseTest = init.then(tlsStart).then(tlsSecure(true))
    .expect(s.tlsResult == "pending" and s.socketOpen).then(tlsClose)
    .expect(s.tlsResult == "success" and invariant)
  run tlsGetterOrValidationFailureSettlesTest = init.then(tlsStart).then(tlsSecure(false))
    .then(tlsClose).expect(s.tlsResult == "failure" and s.tlsPrimary == "validation" and invariant)
  run tlsEarlyCloseRefusesTest = init.then(tlsStart).then(tlsClose)
    .expect(s.tlsResult == "failure" and s.tlsPrimary == "early-close" and invariant)
  run tlsEarlyEndRefusesTest = init.then(tlsStart).then(tlsEarlyEnd).then(tlsClose)
    .expect(s.tlsPrimary == "early-end" and s.tlsSettlements == 1 and invariant)
  run tlsTrafficDoesNotResetDeadlineTest = init.then(tlsStart).then(tlsActivity).then(tick)
    .then(tlsActivity).then(tlsDeadline).then(tlsFinishDeadline).then(tlsClose)
    .expect(s.tlsPrimary == "deadline" and invariant)
  run tlsCloseDeadlineCannotBecomeSuccessTest = init.then(tlsStart).then(tlsSecure(true)).then(tick)
    .then(tlsDeadline).then(tlsFinishDeadline).then(tlsClose).expect(s.tlsResult == "failure" and invariant)
  run tlsDestroyFailureKeepsValidationErrorTest = init.then(tlsStart).then(tlsSecure(false))
    .then(tlsDestroyFailure).expect(s.tlsPrimary == "validation" and s.tlsCleanupError and invariant)
  run tlsErrorAfterHandshakeRefusesTest = init.then(tlsStart).then(tlsSecure(true)).then(tlsError)
    .then(tlsClose).expect(s.tlsPrimary == "socket" and s.tlsResult == "failure" and invariant)
  run headerOnlyResponseIsCanceledTest = init.then(response("headers", true)).then(headers(true))
    .then(cancelBody(true)).expect(s.httpResult == "success" and not(s.bodyOpen) and invariant)
  run rejectedHeadersStillCancelBodyTest = init.then(response("headers", true)).then(headers(false))
    .then(cancelBody(true)).expect(s.httpPrimary == "headers" and not(s.bodyOpen) and invariant)
  run successfulOperationCanFailCancellationTest = init.then(response("headers", true)).then(headers(true))
    .then(cancelBody(false)).expect(s.httpResult == "failure" and s.cleanupErrors == Set("cancel") and invariant)
  run rejectedHeadersKeepPrimaryWhenCancellationFailsTest = init.then(response("headers", true))
    .then(headers(false)).then(cancelBody(false)).expect(s.httpPrimary == "headers"
      and s.cleanupErrors == Set("cancel") and invariant)
  run exactBytesReleaseThenCancelTest = init.then(response("exact", true)).then(headers(true)).then(acquireReader)
    .then(readChunk).then(readChunk).then(readEnd).then(releaseReader(true)).then(validateLength)
    .then(cancelBody(true)).expect(s.httpResult == "success" and not(s.locked) and invariant)
  run oversizedBodyKeepsSizeErrorThroughCancelFailureTest = init.then(response("bounded", true))
    .then(headers(true)).then(acquireReader).then(readChunk).then(readChunk).then(readChunk)
    .then(releaseReader(true)).then(validateLength).then(cancelBody(false))
    .expect(s.httpPrimary == "size" and s.cleanupErrors == Set("cancel") and invariant)
  run shortExactBodyRefusesTest = init.then(response("exact", true)).then(headers(true)).then(acquireReader)
    .then(readChunk).then(readEnd).then(releaseReader(true)).then(validateLength).then(cancelBody(true))
    .expect(s.httpPrimary == "length" and s.httpResult == "failure" and invariant)
  run shortBoundedBodyIsValidTest = init.then(response("bounded", true)).then(headers(true)).then(acquireReader)
    .then(readChunk).then(readEnd).then(releaseReader(true)).then(validateLength).then(cancelBody(true))
    .expect(s.httpResult == "success" and invariant)
  run failedReadStillReleasesAndCancelsTest = init.then(response("bounded", true)).then(headers(true)).then(acquireReader)
    .then(readFailure).then(releaseReader(true)).then(validateLength).then(cancelBody(false))
    .expect(s.httpPrimary == "read" and not(s.locked) and s.cleanupErrors.contains("cancel") and invariant)
  run failedReaderReleaseCannotPassTest = init.then(response("bounded", true)).then(headers(true)).then(acquireReader)
    .then(readEnd).then(releaseReader(false)).then(validateLength).then(cancelBody(true))
    .expect(s.httpResult == "failure" and s.cleanupErrors == Set("release", "cancel") and invariant)
  run missingBodyRefusesWithoutInventedCleanupErrorTest = init.then(response("bounded", false)).then(headers(true))
    .then(acquireReader).then(cancelBody(false)).expect(s.httpPrimary == "missing-body"
      and s.cleanupErrors == Set() and invariant)
  run failedFetchCreatesNoResponseOwnershipTest = init.then(fetchFailure)
    .expect(s.httpResult == "failure" and not(s.bodyPresent) and invariant)
  run tlsDeadlinePreservesEarlierValidationFailureTest = init.then(tlsStart).then(tlsSecure(false))
    .then(tick).then(tlsDeadline).then(tlsFinishDeadline)
    .expect(s.tlsPrimary == "validation" and s.tlsResult == "failure" and s.socketOpen and invariant)
}
