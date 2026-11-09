// @source backend/security/handler.ts
// @source backend/security/case-store.ts
// @source migrations/0026_private_security_cases.sql
// @source migrations/0101_durable_security_intake.sql
// @evidence backend/security/submissions.test.ts
// One createCase request, one competing ordinary case and one prior durable
// Slop receipt whose GitHub link can arrive before the insert commits. Claims
// are unique by project/advisory/reporter; verified ordinary cases are also
// unique by project/advisory. A rejected claim is retained, not a blocker.
// The durable receipt's case has a null advisory column and is found through
// security_submissions + security_submission_intake, including after UNIQUE.
// Actor1/3 are reporters; actor2 is a maintainer whose current role can lapse.
// Input/time/program validation, exact project/repository identity, SQL atomic
// batches, case projection and access-log execution are bounded predicates.
// Read authorization is a snapshot at caseRoles, not a lock until delivery.
// This model does not assert authority at every later instant, full D1
// semantics, notification delivery, real GitHub evidence or provider access.
module api_private_case_creation {
  type State = { phase: str, mode: str, actor: int, reporter: int,
    authority: bool, admitted: bool, admittedMaintainer: bool,
    existing: str, existingReporter: int, existingActor: int, existingKey: int,
    linked: bool, linkedReporter: int, created: bool, eventWritten: bool,
    writeAudited: bool, inboxWritten: bool, selected: str,
    selectedReporter: int, readAuthorized: bool, readAudited: bool,
    status: int, reason: str, privateResponse: bool }
  var s: State
  val requestedReporter = if (s.mode == "claim") s.actor else s.reporter
  val ordinaryMatches = s.existing != "none" and s.existing != "rejected"
    and s.existingReporter == requestedReporter
  val ordinaryConflict = s.existing != "none" and s.existing != "rejected"
    and (s.existingReporter == requestedReporter or (s.mode == "record" and s.existing == "verified"))
  val canRead = s.selectedReporter == s.actor or (s.actor == 2 and s.authority)
  def stop(status: int, reason: str): State = s.with("phase", "done")
    .with("status", status).with("reason", reason)
  def selectCase(source: str, reporter: int): State = s.with("selected", source)
    .with("selectedReporter", reporter).with("phase", "roles")
  val linkedResult: State = if (s.linkedReporter == requestedReporter)
    selectCase("durable", s.linkedReporter) else stop(409, "already-recorded")

  action init = s' = { phase: "input", mode: "claim", actor: 1, reporter: 1,
    authority: true, admitted: false, admittedMaintainer: false,
    existing: "none", existingReporter: 0, existingActor: 0, existingKey: 0,
    linked: false, linkedReporter: 0, created: false, eventWritten: false,
    writeAudited: false, inboxWritten: false, selected: "none",
    selectedReporter: 0, readAuthorized: false, readAudited: false,
    status: 0, reason: "none", privateResponse: false }
  action begin(mode: str, actor: int, reporter: int): bool = all {
    s.phase == "input", mode.in(Set("claim", "record")),
    actor.in(Set(1, 2, 3)), reporter.in(Set(1, 2, 3)),
    s' = s.with("mode", mode).with("actor", actor).with("reporter", reporter)
      .with("phase", "validation") }
  action rejectInput(missingProgram: bool): bool = all { s.phase == "validation",
    s' = stop(if (missingProgram) 404 else 400, "input") }
  action validateInput = all { s.phase == "validation", s' = s.with("phase", "admission") }
  action admit = all { s.phase == "admission",
    s' = if (s.mode == "record" and (s.actor != 2 or not(s.authority))) stop(403, "forbidden")
      else if (s.mode == "record" and s.actor == s.reporter) stop(403, "self-record")
      else s.with("admitted", true).with("admittedMaintainer", s.mode == "record")
        .with("phase", "precheck") }
  action revokeMaintainer = all { s.authority, s' = s.with("authority", false) }
  // One competitor is enough to expose claim/record uniqueness and replay.
  // Its case and event are external committed history; this request cannot edit them.
  action competingCase(kind: str, reporter: int, actor: int, key: int): bool = all {
    not(s.created), s.existing == "none", s.phase != "done", not(s.linked),
    kind.in(Set("claimed", "verified", "rejected")), reporter.in(Set(1, 3)),
    actor.in(Set(1, 2, 3)), key.in(Set(1, 2)),
    s' = s.with("existing", kind).with("existingReporter", reporter)
      .with("existingActor", actor).with("existingKey", key) }
  action publishDurableLink(reporter: int): bool = all {
    not(s.created), not(s.linked), s.phase != "done", reporter.in(Set(1, 3)),
    s' = s.with("linked", true).with("linkedReporter", reporter) }
  action precheck = all { s.phase == "precheck",
    s' = if (s.linked) linkedResult else s.with("phase", "batch") }
  action batch = all { s.phase == "batch",
    s' = if (s.linked or ordinaryConflict) s.with("phase", "recover-linked")
      else s.with("created", true).with("eventWritten", true)
        .with("writeAudited", true).with("inboxWritten", true)
        .with("selected", "created").with("selectedReporter", requestedReporter)
        .with("phase", "roles") }
  action batchFailure = all { s.phase == "batch", s' = stop(500, "database") }
  action lostCommitReply = all { s.phase == "batch", not(s.linked), not(ordinaryConflict),
    s' = stop(500, "lost-reply").with("created", true).with("eventWritten", true)
      .with("writeAudited", true).with("inboxWritten", true) }
  action recoverLinked = all { s.phase == "recover-linked",
    s' = if (s.linked) linkedResult else s.with("phase", "recover-ordinary") }
  action recoverOrdinary = all { s.phase == "recover-ordinary",
    s' = if (ordinaryMatches and (s.mode == "claim" or
      (s.existing == "verified" and s.existingActor == s.actor and s.existingKey == 1)))
        selectCase("ordinary", s.existingReporter)
      else if (ordinaryMatches and s.existing == "claimed") stop(409, "claim-pending")
      else stop(409, "already-recorded") }
  action resolveRoles = all { s.phase == "roles",
    s' = if (canRead) s.with("readAuthorized", true)
        .with("phase", if (s.selected == "created") "view" else "audit")
      else stop(if (s.selected == "created") 404 else 409, "no-role") }
  action auditRead(succeeds: bool): bool = all { s.phase == "audit",
    s' = if (succeeds) s.with("readAudited", true).with("phase", "view")
      else stop(500, "audit") }
  action render(succeeds: bool): bool = all { s.phase == "view",
    s' = if (succeeds) stop(if (s.selected == "created") 201 else 200, "ok")
        .with("privateResponse", true) else stop(500, "view") }
  // Excluded old behavior: UNIQUE recovery skipped the newly linked durable
  // receipt; a new record also projected its case with an empty role set.
  action oldRecoverOrdinaryOnly = all { s.phase == "recover-linked",
    s' = s.with("phase", "recover-ordinary") }
  action oldReturnWithoutRole = all { s.phase == "roles", s.selected == "created",
    s' = stop(201, "ok").with("privateResponse", true) }
  action step = {
    nondet mode = Set("claim", "record").oneOf()
    nondet actor = Set(1, 2, 3).oneOf()
    nondet reporter = Set(1, 2, 3).oneOf()
    nondet kind = Set("claimed", "verified", "rejected").oneOf()
    nondet key = Set(1, 2).oneOf()
    nondet succeeds = Set(false, true).oneOf()
    any { begin(mode, actor, reporter), rejectInput(succeeds), validateInput,
      admit, revokeMaintainer, competingCase(kind, reporter, actor, key),
      publishDurableLink(reporter), precheck, batch, batchFailure, lostCommitReply,
      recoverLinked, recoverOrdinary, resolveRoles, auditRead(succeeds), render(succeeds) }
  }
  val invariant = all {
    s.created implies s.admitted and s.eventWritten and s.writeAudited and s.inboxWritten,
    s.created and s.mode == "record" implies s.admittedMaintainer,
    s.created implies not(ordinaryConflict),
    s.privateResponse implies s.readAuthorized and s.selectedReporter == requestedReporter,
    s.status == 200 implies s.selected != "created" and s.readAudited,
    s.status == 201 implies s.created,
    s.privateResponse iff s.status.in(Set(200, 201)),
  }
  action startClaim = begin("claim", 1, 1).then(validateInput).then(admit)
  action startRecord = begin("record", 2, 1).then(validateInput).then(admit)
  action returnCreated = resolveRoles.then(render(true))
  action returnReplay = resolveRoles.then(auditRead(true)).then(render(true))

  run claimCreatesAtomicHistoryTest = init.then(startClaim).then(precheck).then(batch).then(returnCreated)
    .expect(s.status == 201 and s.created and invariant)
  run recordCreatesVerifiedHistoryTest = init.then(startRecord).then(precheck).then(batch).then(returnCreated)
    .expect(s.status == 201 and s.admittedMaintainer and invariant)
  run invalidInputCreatesNothingTest = init.then(begin("claim", 1, 1)).then(rejectInput(false))
    .expect(s.status == 400 and not(s.created))
  run missingProjectCreatesNothingTest = init.then(begin("claim", 1, 1)).then(rejectInput(true))
    .expect(s.status == 404 and not(s.created))
  run nonMaintainerCannotRecordTest = init.then(begin("record", 3, 1)).then(validateInput).then(admit)
    .expect(s.status == 403 and not(s.created))
  run maintainerCannotRecordOwnReportTest = init.then(begin("record", 2, 2)).then(validateInput).then(admit)
    .expect(s.status == 403 and not(s.created))
  run revokedBeforeAdmissionCannotRecordTest = init.then(begin("record", 2, 1)).then(validateInput)
    .then(revokeMaintainer).then(admit).expect(s.status == 403 and not(s.created))
  run linkedReceiptPrecheckReplaysTest = init.then(publishDurableLink(1)).then(startClaim).then(precheck)
    .then(returnReplay).expect(s.status == 200 and s.selected == "durable" and not(s.created) and invariant)
  run linkArrivingBeforeInsertReplaysTest = init.then(startClaim).then(precheck).then(publishDurableLink(1))
    .then(batch).then(recoverLinked).then(returnReplay)
    .expect(s.status == 200 and s.selected == "durable" and not(s.created) and invariant)
  run recordRacingLinkedReceiptReplaysTest = init.then(startRecord).then(precheck).then(publishDurableLink(1))
    .then(batch).then(recoverLinked).then(returnReplay)
    .expect(s.status == 200 and s.selected == "durable" and invariant)
  run otherReporterCannotAdoptLinkedReceiptTest = init.then(startClaim).then(precheck).then(publishDurableLink(3))
    .then(batch).then(recoverLinked).expect(s.status == 409 and not(s.privateResponse))
  run linkedReplayNeedsCurrentRoleTest = init.then(startRecord).then(publishDurableLink(1)).then(precheck)
    .then(revokeMaintainer).then(resolveRoles).expect(s.status == 409 and not(s.privateResponse))
  run linkedReplayNeedsAuditTest = init.then(startClaim).then(publishDurableLink(1)).then(precheck)
    .then(resolveRoles).then(auditRead(false)).expect(s.status == 500 and not(s.privateResponse))
  run sameReporterClaimReplaysByIdentityTest = init.then(competingCase("claimed", 1, 3, 2))
    .then(startClaim).then(precheck).then(batch).then(recoverLinked).then(recoverOrdinary)
    .then(returnReplay).expect(s.status == 200 and s.selected == "ordinary" and invariant)
  run verifiedClaimReplaysRegardlessOfOriginalKeyTest = init.then(competingCase("verified", 1, 2, 2))
    .then(startClaim).then(precheck).then(batch).then(recoverLinked).then(recoverOrdinary)
    .then(returnReplay).expect(s.status == 200 and not(s.created))
  run recordReplaysOnlyOriginalActorAndKeyTest = init.then(competingCase("verified", 1, 2, 1))
    .then(startRecord).then(precheck).then(batch).then(recoverLinked).then(recoverOrdinary)
    .then(returnReplay).expect(s.status == 200 and invariant)
  run changedRecordKeyRefusesTest = init.then(competingCase("verified", 1, 2, 2))
    .then(startRecord).then(precheck).then(batch).then(recoverLinked).then(recoverOrdinary)
    .expect(s.status == 409 and not(s.privateResponse))
  run recordCannotReplacePendingClaimTest = init.then(competingCase("claimed", 1, 1, 1))
    .then(startRecord).then(precheck).then(batch).then(recoverLinked).then(recoverOrdinary)
    .expect(s.status == 409 and s.reason == "claim-pending")
  run anotherReportersVerifiedCaseBlocksRecordTest = init.then(competingCase("verified", 3, 2, 1))
    .then(startRecord).then(precheck).then(batch).then(recoverLinked).then(recoverOrdinary)
    .expect(s.status == 409 and not(s.created))
  run separateUnverifiedClaimCanCoexistTest = init.then(competingCase("claimed", 3, 3, 1))
    .then(startClaim).then(precheck).then(batch).then(returnCreated)
    .expect(s.status == 201 and s.existing == "claimed" and invariant)
  run otherVerifiedOrdinaryCaseDoesNotAuthenticateClaimTest = init.then(competingCase("verified", 3, 2, 1))
    .then(startClaim).then(precheck).then(batch).then(returnCreated)
    .expect(s.status == 201 and s.existing == "verified" and invariant)
  run rejectedClaimDoesNotBlockNewClaimTest = init.then(competingCase("rejected", 1, 1, 1))
    .then(startClaim).then(precheck).then(batch).then(returnCreated).expect(s.status == 201 and invariant)
  run nonUniqueDatabaseFailureIsNotReplayTest = init.then(startClaim).then(precheck).then(batchFailure)
    .expect(s.status == 500 and not(s.created))
  run lostCommitReplyRetainsAtomicHistoryTest = init.then(startRecord).then(precheck).then(lostCommitReply)
    .expect(s.status == 500 and s.created and not(s.privateResponse) and invariant)
  run revokedAfterRecordCommitCannotReadTest = init.then(startRecord).then(precheck).then(batch)
    .then(revokeMaintainer).then(resolveRoles).expect(s.status == 404 and s.created and not(s.privateResponse) and invariant)
  run projectionFailureDoesNotUndoCaseTest = init.then(startClaim).then(precheck).then(batch)
    .then(resolveRoles).then(render(false)).expect(s.status == 500 and s.created and invariant)
  run roleSnapshotIsNotAResponseLockTest = init.then(startRecord).then(precheck).then(batch)
    .then(resolveRoles).then(revokeMaintainer).then(render(true)).expect(s.status == 201 and s.readAuthorized and invariant)
  run oldEmptyRoleReturnExposesCaseTest = init.then(startRecord).then(precheck).then(batch)
    .then(revokeMaintainer).then(oldReturnWithoutRole).expect(s.privateResponse and not(invariant))
  run oldLinkedRecoveryMissedDurableCaseTest = init.then(startClaim).then(precheck).then(publishDurableLink(1))
    .then(batch).then(oldRecoverOrdinaryOnly).then(recoverOrdinary)
    .expect(s.status == 409 and s.linked and not(s.created))
}
