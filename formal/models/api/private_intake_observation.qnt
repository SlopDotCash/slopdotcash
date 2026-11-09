// @source migrations/0006_private_intake_status.sql
// @source backend/trace/cloudflare-persistence.ts
// @source backend/trace/handler.ts
// @source backend/trace/validation.ts
// @evidence backend/trace/private-intake-status.test.ts
// Two reads of one trusted singleton, with public-status or capability-upload
// callers. Finite millisecond representatives preserve exact 24h/+5m bounds.
// ISO validation is an input predicate (UTC seconds or three fractional digits).
// Reader captures caller clock milliseconds before SELECT; its row and age
// remain a snapshot if a renewal/disable or wall-clock change races later.
// Verified disabled is HTTP200 diagnostic state, not permission to keep bytes.
// Upload capability/standing precede this read. The intake gate precedes body
// reads; a later disable does not repeat that gate. Detailed reservation, R2,
// attachment, account-ban races and permanent retention live in api_trace.
// A storage request can have an uncertain result; no rollback is inferred.
// No database/HTTP/browser/provider execution or complete refinement is claimed.
module private_intake_observation {
  val ids = Set(1, 2)
  val stamps = Set(-86400001, -86400000, -300001, -300000, 0, 1, 300000, 300001, 86400000, 86400001)
  type Observation = { present: bool, enabled: int, stamp: int, validTime: bool, sortable: bool }
  val absent: Observation = { present: false, enabled: 0, stamp: 0, validTime: false, sortable: false }
  type Read = { phase: str, mode: str, capturedClock: int, snapshot: Observation,
    verified: bool, permission: bool, dbRead: bool, bodyRead: bool,
    storageRequested: bool, status: int }
  val idle: Read = { phase: "idle", mode: "public", capturedClock: 0, snapshot: absent,
    verified: false, permission: false, dbRead: false, bodyRead: false,
    storageRequested: false, status: 0 }
  var s: { setup: bool, clock: int, row: Observation, calls: int -> Read }
  action init = s' = { setup: true, clock: 0, row: absent, calls: ids.mapBy(_ => idle) }
  action seed(enabled: int, stamp: int, validTime: bool): bool = all {
    s.setup, Set(0, 1, 2).contains(enabled), stamps.contains(stamp),
    s' = s.with("row", { present: true, enabled: enabled, stamp: stamp, validTime: validTime, sortable: validTime }) }
  // Whole-second UTC is readable too, but arbitrary legacy spellings cannot
  // use numeric ordering to predict SQL's lexical replacement condition.
  action seedUnsortable(stamp: int, validTime: bool): bool = all { s.setup, stamps.contains(stamp),
    s' = s.with("row", { present: true, enabled: 1, stamp: stamp, validTime: validTime, sortable: false }) }
  action clock(value: int): bool = all { stamps.contains(value), s' = s.with("clock", value) }
  // Bound renewal to the writer's canonical millisecond timestamps. Legacy
  // or invalid raw-string replacement order is deliberately not inferred.
  action renew(enabled: int, stamp: int): bool = all { Set(0, 1).contains(enabled), stamps.contains(stamp),
    not(s.row.present) or s.row.sortable,
    s' = if (not(s.row.present) or stamp > s.row.stamp)
      s.with("row", { present: true, enabled: enabled, stamp: stamp, validTime: true, sortable: true }) else s }
  action begin(id: int, mode: str, capability: bool, standing: bool): bool = all {
    s.calls.get(id).phase == "idle", Set("public", "upload").contains(mode),
    s' = s.with("setup", false).with("calls", s.calls.set(id, idle.with("mode", mode)
      .with("phase", if (mode == "public" or (capability and standing)) "clock" else "done")
      .with("status", if (mode == "public" or (capability and standing)) 0 else if (capability) 403 else 410))) }
  action captureClock(id: int): bool = {
    val c = s.calls.get(id)
    all { c.phase == "clock", s' = s.with("calls", s.calls.set(id, c.with("capturedClock", s.clock).with("phase", "query"))) }
  }
  action query(id: int, succeeds: bool): bool = {
    val c = s.calls.get(id)
    all { c.phase == "query", s' = s.with("calls", s.calls.set(id, c.with("dbRead", true)
      .with("snapshot", if (succeeds) s.row else absent).with("phase", "validate"))) }
  }
  def isVerified(c: Read): bool = {
    val age = c.capturedClock - c.snapshot.stamp
    c.snapshot.present and Set(0, 1).contains(c.snapshot.enabled) and c.snapshot.validTime
      and age >= -300000 and age <= 86400000
  }
  action validate(id: int): bool = {
    val c = s.calls.get(id)
    val verified = isVerified(c)
    val allowed = verified and c.snapshot.enabled == 1
    all { c.phase == "validate", s' = s.with("calls", s.calls.set(id,
      c.with("verified", verified).with("permission", allowed)
        .with("phase", if (c.mode == "upload" and allowed) "body" else "done")
        .with("status", if (c.mode == "public") (if (verified) 200 else 503) else if (allowed) 0 else 503))) }
  }
  action body(id: int, valid: bool): bool = {
    val c = s.calls.get(id)
    all { c.phase == "body", s' = s.with("calls", s.calls.set(id, c.with("bodyRead", true)
      .with("phase", if (valid) "reserve" else "done").with("status", if (valid) 0 else 400))) }
  }
  action reserve(id: int, allowed: bool): bool = {
    val c = s.calls.get(id)
    all { c.phase == "reserve", s' = s.with("calls", s.calls.set(id,
      c.with("phase", if (allowed) "storage" else "done").with("status", if (allowed) 0 else 409))) }
  }
  action store(id: int, succeeds: bool): bool = {
    val c = s.calls.get(id)
    all { c.phase == "storage", s' = s.with("calls", s.calls.set(id,
      c.with("storageRequested", true).with("phase", "done").with("status", if (succeeds) 201 else 500))) }
  }
  action step = {
    nondet id = ids.oneOf() nondet stamp = stamps.oneOf() nondet enabled = Set(0, 1, 2).oneOf()
    nondet yes = Set(false, true).oneOf() nondet other = Set(false, true).oneOf()
    nondet mode = Set("public", "upload").oneOf()
    any { seed(enabled, stamp, yes), seedUnsortable(stamp, yes), renew(if (enabled == 2) 0 else enabled, stamp), clock(stamp),
      begin(id, mode, yes, other), captureClock(id), query(id, yes), validate(id), body(id, yes),
      reserve(id, yes), store(id, yes), s' = s }
  }
  val invariant = ids.forall(id => { val c = s.calls.get(id)
    all { c.verified implies c.dbRead and isVerified(c),
      c.permission implies c.verified and c.snapshot.enabled == 1,
      c.bodyRead implies c.mode == "upload" and c.permission,
      c.storageRequested implies c.bodyRead and c.permission,
      c.dbRead and c.phase != "validate" implies c.verified == isVerified(c),
      c.mode == "public" implies not(c.bodyRead) and not(c.storageRequested),
      c.mode == "public" and c.status == 200 implies c.verified,
      c.status == 201 implies c.storageRequested } })
  action read(id: int, mode: str): bool = begin(id, mode, true, true).then(captureClock(id)).then(query(id, true)).then(validate(id))
  action upload(id: int): bool = read(id, "upload").then(body(id, true)).then(reserve(id, true)).then(store(id, true))
  run missingRowIsUnavailableTest = init.then(read(1, "public")).expect(s.calls.get(1).status == 503 and invariant)
  run currentEnabledIsVerifiedTest = init.then(seed(1, 0, true)).then(read(1, "public")).expect(s.calls.get(1).status == 200 and s.calls.get(1).permission and invariant)
  run disabledStillReturnsDiagnosticSuccessTest = init.then(seed(0, 0, true)).then(read(1, "public")).expect(s.calls.get(1).status == 200 and not(s.calls.get(1).permission) and invariant)
  run exactAgeBoundaryIsVerifiedTest = init.then(seed(1, -86400000, true)).then(read(1, "public")).expect(s.calls.get(1).verified and invariant)
  run oneMillisecondStaleIsUnavailableTest = init.then(seed(1, -86400001, true)).then(read(1, "public")).expect(s.calls.get(1).status == 503 and invariant)
  run exactFutureSkewIsVerifiedTest = init.then(seed(1, 300000, true)).then(read(1, "public")).expect(s.calls.get(1).verified and invariant)
  run excessiveFutureSkewIsUnavailableTest = init.then(seed(1, 300001, true)).then(read(1, "public")).expect(s.calls.get(1).status == 503 and invariant)
  run invalidEnabledValueIsUnavailableTest = init.then(seed(2, 0, true)).then(read(1, "public")).expect(not(s.calls.get(1).verified) and invariant)
  run invalidTimestampIsUnavailableTest = init.then(seed(1, 0, false)).then(read(1, "public")).expect(not(s.calls.get(1).verified) and invariant)
  run wholeSecondUtcCanBeReadWithoutInferringReplacementOrderTest = init.then(seedUnsortable(0, true)).then(read(1, "public")).expect(s.calls.get(1).verified and not(s.row.sortable) and invariant)
  run callerClockMutationCannotChangePendingReadTest = init.then(seed(1, 0, true)).then(begin(1, "public", true, true)).then(captureClock(1)).then(clock(86400001)).then(query(1, true)).then(validate(1)).expect(s.calls.get(1).status == 200 and s.calls.get(1).capturedClock == 0 and invariant)
  run renewalAfterSelectDoesNotRewriteSnapshotTest = init.then(seed(1, 0, true)).then(begin(1, "public", true, true)).then(captureClock(1)).then(query(1, true)).then(renew(0, 1)).then(validate(1)).expect(s.calls.get(1).permission and s.row.enabled == 0 and invariant)
  run nextReadObservesDisabledRenewalTest = init.then(seed(1, 0, true)).then(read(1, "public")).then(renew(0, 1)).then(read(2, "public")).expect(s.calls.get(1).permission and not(s.calls.get(2).permission) and invariant)
  run queryFailureReturnsNoPermissionTest = init.then(seed(1, 0, true)).then(begin(1, "upload", true, true)).then(captureClock(1)).then(query(1, false)).then(validate(1)).expect(s.calls.get(1).status == 503 and not(s.calls.get(1).bodyRead) and invariant)
  run invalidCapabilityPrecedesObservationTest = init.then(seed(1, 0, true)).then(begin(1, "upload", false, true)).expect(s.calls.get(1).status == 410 and not(s.calls.get(1).dbRead) and invariant)
  run standingRefusalPrecedesObservationTest = init.then(seed(1, 0, true)).then(begin(1, "upload", true, false)).expect(s.calls.get(1).status == 403 and not(s.calls.get(1).dbRead) and invariant)
  run disabledUploadReadsNoBytesTest = init.then(seed(0, 0, true)).then(read(1, "upload")).expect(s.calls.get(1).status == 503 and not(s.calls.get(1).bodyRead) and not(s.calls.get(1).storageRequested) and invariant)
  run staleUploadReadsNoBytesTest = init.then(seed(1, -86400001, true)).then(read(1, "upload")).expect(s.calls.get(1).status == 503 and not(s.calls.get(1).bodyRead) and invariant)
  run renewedUploadCanRequestStorageTest = init.then(seed(0, 0, true)).then(read(1, "upload")).then(renew(1, 1)).then(upload(2)).expect(s.calls.get(2).status == 201 and invariant)
  run disableDuringBodyDoesNotRepeatCapturedGateTest = init.then(seed(1, 0, true)).then(read(1, "upload")).then(renew(0, 1)).then(body(1, true)).then(reserve(1, true)).then(store(1, true)).expect(s.row.enabled == 0 and s.calls.get(1).status == 201 and invariant)
  run reservationRefusalMakesNoStorageRequestTest = init.then(seed(1, 0, true)).then(read(1, "upload")).then(body(1, true)).then(reserve(1, false)).expect(s.calls.get(1).status == 409 and not(s.calls.get(1).storageRequested) and invariant)
  run lostStorageReplyDoesNotClaimRollbackTest = init.then(seed(1, 0, true)).then(read(1, "upload")).then(body(1, true)).then(reserve(1, true)).then(store(1, false)).expect(s.calls.get(1).status == 500 and s.calls.get(1).storageRequested and invariant)
  // Historical readers used Date.parse alone and the mutable Date after await.
  // Both controls are excluded from step.
  action oldValidateParseableNonIso(id: int): bool = {
    val c = s.calls.get(id)
    all { c.phase == "validate", s' = s.with("calls", s.calls.set(id,
      c.with("phase", "done").with("verified", true).with("status", 200))) }
  }
  action oldValidateMutableClock(id: int): bool = {
    val c = s.calls.get(id)
    val age = s.clock - c.snapshot.stamp
    val verified = c.snapshot.present and c.snapshot.validTime and age >= -300000 and age <= 86400000
    all { c.phase == "validate", s' = s.with("calls", s.calls.set(id,
      c.with("phase", "done").with("verified", verified).with("status", if (verified) 200 else 503))) }
  }
  run oldParseableNonIsoCouldClaimVerifiedTest = init.then(seed(1, 0, false)).then(begin(1, "public", true, true)).then(captureClock(1)).then(query(1, true)).then(oldValidateParseableNonIso(1)).expect(s.calls.get(1).verified and not(invariant))
  run oldMutableClockCouldChangeReadDecisionTest = init.then(seed(1, 0, true)).then(begin(1, "public", true, true)).then(captureClock(1)).then(clock(86400001)).then(query(1, true)).then(oldValidateMutableClock(1)).expect(s.calls.get(1).status == 503 and not(invariant))
}
