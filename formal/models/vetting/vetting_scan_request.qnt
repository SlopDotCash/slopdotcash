// @source backend/vetting/handler.ts
// @source backend/vetting/persistence.ts
// @source migrations/0099_vetting_queue_current_pin.sql
// @source migrations/0103_vetting_template_replacements.sql
// @evidence backend/vetting/scan-request.test.ts
// queueAssessment and owner/automatic/admin outcome mapping. One caller, two
// source/template/revision identities, three flag-set identities, and one
// latest competing row. Service-key/auth/schema checks are supplied contracts;
// vetting_admin_actor and vetting_service_auth refine those gates separately.
// The project revision is captured before the live-pin await; no second current
// revision CAS is invented. The database captures active flags at insertion.
// A template retry retains original source/revision but takes the live template.
// Same-pending comparison uses the latest row and exact flag-set equality;
// historical pending rows do not independently block another scan. SQL/FK and
// digest construction remain delegated. A lost write/read reply can follow a
// committed row. Queue success is neither a clean scan nor project activation.
// All new scenarios and regression definitions are unexecuted.
module vetting_scan_request {
  type Prior = { present: bool, pending: bool, revision: int, commit: int, template: int, flags: int }
  type State = { phase: str, mode: str, retry: bool, serviceOk: bool, pinOk: bool,
    idOk: bool, currentRevision: int, capturedRevision: int, liveCommit: int,
    liveTemplate: int, commit: int, template: int, flags: int, capturedFlags: int,
    prior: Prior, retryStillLatest: bool, collision: bool, rowPresent: bool,
    rowComplete: bool, returned: bool, outcome: str, error: str }
  var s: State
  action init = s' = { phase: "input", mode: "owner", retry: false,
    serviceOk: true, pinOk: true, idOk: true, currentRevision: 1, capturedRevision: 0,
    liveCommit: 1, liveTemplate: 1, commit: 0, template: 0, flags: 0, capturedFlags: -1,
    prior: { present: false, pending: true, revision: 1, commit: 1, template: 1, flags: 0 },
    retryStillLatest: true, collision: false, rowPresent: false, rowComplete: false,
    returned: false, outcome: "none", error: "none" }
  pure def errorResult(value: State, code: str): State = value.with("phase", "done")
    .with("returned", value.mode == "automatic" or (value.mode == "owner" and code == "pin"))
    .with("outcome", if (value.mode == "automatic" or (value.mode == "owner" and code == "pin")) "unavailable" else "error")
    .with("error", code)
  def conflictResult: State = s.with("phase", "done").with("returned", s.mode != "admin")
    .with("outcome", if (s.mode == "admin") "conflict" else "already-queued")
  action configure(mode: str, retry: bool, service: bool, pin: bool, id: bool): bool = all {
    s.phase == "input", Set("owner", "automatic", "admin").contains(mode),
    s' = s.with("mode", mode).with("retry", retry).with("serviceOk", service).with("pinOk", pin).with("idOk", id)
      .with("prior", s.prior.with("present", retry)) }
  action begin = all { s.phase == "input", s' = s.with("phase", "service").with("capturedRevision", s.currentRevision) }
  action service = all { s.phase == "service", s' =
    if (s.serviceOk) s.with("phase", "pin")
    else s.with("phase", "done").with("returned", s.mode != "admin")
      .with("outcome", if (s.mode == "admin") "error" else "unavailable").with("error", "service") }
  action serviceException = all { s.phase == "service", s.mode == "owner",
    s' = errorResult(s, "service-exception") }
  action pin = all { s.phase == "pin", s' =
    if (not(s.pinOk)) errorResult(s, "pin")
    else s.with("phase", "build").with("commit", if (s.retry) 1 else s.liveCommit)
      .with("template", s.liveTemplate).with("capturedRevision", if (s.retry) 1 else s.capturedRevision) }
  action build = all { s.phase == "build", s' =
    if (s.idOk) s.with("phase", "write") else errorResult(s, "id") }
  action advanceProject = all { s.currentRevision == 1, s' = s.with("currentRevision", 2) }
  action advancePin = all { s.liveCommit == 1, s' = s.with("liveCommit", 2).with("liveTemplate", 2) }
  action changeFlags = all { s.flags < 2, s' = s.with("flags", s.flags + 1) }
  action competing(pending: bool, same: bool): bool = all { s.phase == "write",
    s' = s.with("retryStillLatest", not(s.retry)).with("prior", { present: true, pending: pending,
      revision: if (same) s.capturedRevision else 2,
      commit: if (same) s.commit else 2, template: if (same) s.template else 2, flags: s.flags }) }
  action replaceRetry = all { s.phase == "write", s' = s.with("retryStillLatest", false) }
  action collideId = all { s.phase == "write", s' = s.with("collision", true) }
  val duplicate = s.prior.present and s.prior.pending and s.prior.revision == s.capturedRevision
    and s.prior.commit == s.commit and s.prior.template == s.template and s.prior.flags == s.flags
  action write = all { s.phase == "write", s' =
    if (s.collision or duplicate or (s.retry and not(s.retryStillLatest))) conflictResult
    else s.with("phase", "ack").with("rowPresent", true).with("capturedFlags", s.flags) }
  action failedWrite = all { s.phase == "write", s' = errorResult(s, "write") }
  action acknowledge(delivered: bool): bool = all { s.phase == "ack", s' =
    if (delivered) s.with("phase", "read") else errorResult(s, "write-reply") }
  action completeBeforeRead = all { s.rowPresent, s.phase == "read", s' = s.with("rowComplete", true) }
  action readBack(found: bool): bool = all { s.phase == "read", s' =
    if (found) s.with("phase", "done").with("returned", true).with("outcome", "queued")
    else errorResult(s, "readback") }
  action step = {
    nondet mode = Set("owner", "automatic", "admin").oneOf()
    nondet a = Set(false, true).oneOf() nondet b = Set(false, true).oneOf()
    nondet c = Set(false, true).oneOf() nondet d = Set(false, true).oneOf()
    any { configure(mode, a, b, c, d), begin, service, serviceException, pin, build, advanceProject, advancePin,
      changeFlags, competing(a, b), replaceRetry, collideId, write, failedWrite,
      acknowledge(a), completeBeforeRead, readBack(a), s' = s }
  }
  val invariant = all { s.capturedRevision <= s.currentRevision,
    s.rowPresent implies s.commit > 0 and s.template > 0 and s.capturedFlags >= 0,
    s.outcome == "queued" implies s.rowPresent and s.returned,
    s.outcome == "already-queued" implies not(s.rowPresent) and s.returned,
    s.outcome == "conflict" implies not(s.rowPresent) and not(s.returned),
    s.rowComplete implies s.rowPresent,
    s.retry and s.rowPresent implies s.capturedRevision == 1 and s.commit == 1 }
  action toWrite = begin.then(service).then(pin).then(build)
  action finish = write.then(acknowledge(true)).then(readBack(true))
  run ownerQueueTest = init.then(toWrite).then(finish).expect(s.outcome == "queued" and not(s.rowComplete) and invariant)
  run thrownOwnerReadinessDoesNotBecomeUnavailableTest = init.then(begin).then(serviceException).expect(s.outcome == "error" and not(s.returned) and invariant)
  run ownerServiceUnavailableDoesNotReadPinTest = init.then(configure("owner", false, false, true, true)).then(begin).then(service).expect(s.outcome == "unavailable" and s.commit == 0 and invariant)
  run automaticServiceUnavailableReturnsTest = init.then(configure("automatic", false, false, true, true)).then(begin).then(service).expect(s.returned and s.outcome == "unavailable" and invariant)
  run adminServiceUnavailableThrowsTest = init.then(configure("admin", false, false, true, true)).then(begin).then(service).expect(not(s.returned) and s.error == "service" and invariant)
  run ownerPinUnavailableReturnsTest = init.then(configure("owner", false, true, false, true)).then(begin).then(service).then(pin).expect(s.returned and s.outcome == "unavailable" and invariant)
  run ownerNonPinFailureThrowsTest = init.then(configure("owner", false, true, true, false)).then(toWrite).expect(not(s.returned) and s.error == "id" and invariant)
  run automaticNonPinFailureReturnsUnavailableTest = init.then(configure("automatic", false, true, true, false)).then(toWrite).expect(s.returned and s.outcome == "unavailable" and invariant)
  run ownerDuplicateIsAlreadyQueuedTest = init.then(toWrite).then(competing(true, true)).then(write).expect(s.outcome == "already-queued" and invariant)
  run adminDuplicateIsConflictTest = init.then(configure("admin", false, true, true, true)).then(toWrite).then(competing(true, true)).then(write).expect(s.outcome == "conflict" and invariant)
  run completedPriorDoesNotBlockNewScanTest = init.then(toWrite).then(competing(false, true)).then(finish).expect(s.outcome == "queued" and invariant)
  run differentLatestPinDoesNotBlockTest = init.then(toWrite).then(competing(true, false)).then(finish).expect(s.outcome == "queued" and invariant)
  run flagsAreCapturedAtInsertTest = init.then(toWrite).then(changeFlags).then(finish).expect(s.capturedFlags == 1 and invariant)
  run newFlagAllowsSamePinRequestTest = init.then(toWrite).then(competing(true, true)).then(changeFlags).then(finish).expect(s.capturedFlags == 1 and invariant)
  run projectCanAdvanceAfterCaptureTest = init.then(begin).then(service).then(advanceProject).then(pin).then(build).then(finish).expect(s.currentRevision == 2 and s.capturedRevision == 1 and invariant)
  run pinCanAdvanceAfterCaptureTest = init.then(toWrite).then(advancePin).then(finish).expect(s.commit == 1 and s.liveCommit == 2 and invariant)
  run templateRetryKeepsOriginalSourceTest = init.then(configure("owner", true, true, true, true)).then(advanceProject).then(advancePin).then(toWrite).then(finish).expect(s.capturedRevision == 1 and s.commit == 1 and s.template == 2 and invariant)
  run obsoleteTemplateRetryConflictsTest = init.then(configure("owner", true, true, true, true)).then(toWrite).then(replaceRetry).then(write).expect(s.outcome == "already-queued" and invariant)
  run collidingRandomIdConflictsTest = init.then(toWrite).then(collideId).then(write).expect(s.outcome == "already-queued" and invariant)
  run failedWriteCreatesNoRowTest = init.then(toWrite).then(failedWrite).expect(not(s.rowPresent) and s.error == "write" and invariant)
  run lostWriteReplyKeepsRowTest = init.then(toWrite).then(write).then(acknowledge(false)).expect(s.rowPresent and not(s.returned) and invariant)
  run automaticLostWriteReplyIsUnavailableWithRowTest = init.then(configure("automatic", false, true, true, true)).then(toWrite).then(write).then(acknowledge(false)).expect(s.rowPresent and s.outcome == "unavailable" and invariant)
  run missingReadbackKeepsCommittedRowTest = init.then(toWrite).then(write).then(acknowledge(true)).then(readBack(false)).expect(s.rowPresent and s.error == "readback" and invariant)
  run readbackMayObserveCompletedAssessmentTest = init.then(toWrite).then(write).then(acknowledge(true)).then(completeBeforeRead).then(readBack(true)).expect(s.outcome == "queued" and s.rowComplete and invariant)
}
