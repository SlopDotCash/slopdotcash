// @source backend/vetting/evidence.ts
// @source backend/vetting/evidence-retention.ts
// @source backend/http.ts
// @source migrations/0034_vetting_private_evidence.sql
// @evidence scripts/vetting-api.test.ts
// @evidence tests/e2e/evidence-download.spec.ts
// One immutable run/object, two independently issued grants and two read slots;
// a buffered body or a native stream of exactly two verified parts. Both actors
// are designated operators; no-session and actor changes are explicit. Input,
// expected-header and nonoperator admission are in vetting_evidence_access.
// Grant verification is an abstract prefix. Its D1 grant+audit batch, reply,
// consume UPDATE RETURNING, and read-attempt audit are separate boundaries.
// RETURNING may be absent/lost after a committed consume: no grant is restored.
// Clock0..4 represents relative expiry classes, not seconds; grant and closed
// case windows are two ticks. Open/permanent runs have no access expiry. The
// grant comparison uses the stamp captured after authentication, not a new DB
// clock. Expiry after consumption does not itself revoke an admitted read.
// Buffered completion refreshes retention after the read audit, then checks
// the same current operator and expiry before constructing the response.
// Native parts recheck authority after bounded storage I/O; cancellation does
// not abort that I/O, but its later completion cannot enqueue private bytes.
// A terminal outcome is claimed before its audit await. A cancelled reader
// racing a claimed finish cannot append a second terminal outcome. Audit
// commit, audit reply, server close and client receipt are distinct; neither
// a read audit nor server finish proves that a browser saved a file.
// Cookie issuance replies overwrite one path-scoped slot. Download responses
// never mutate it; a retained spent cookie conveys no reusable authority and
// expires by the original900-second browser TTL. Browser expiry is abstracted
// by clearExpiredCookie. This does not assert a network delivery order.
// Actual SQL atomicity, cryptography, exact chunk bytes and bounded reader
// cleanup are assumptions/refinements outside this model. No continuous lock
// across the last authorization observation and external delivery is claimed.
// Definitions are source-authored; no parser, checker or runtime was executed.
module vetting_evidence_delivery {
  val ids = Set(1, 2)
  val kinds = Set("body", "native")
  type Grant = { phase: str, kind: str, owner: int, expires: int,
    stored: bool, audited: bool, known: bool, spent: bool }
  type Read = { phase: str, kind: str, grant: int, owner: int, stamp: int,
    won: bool, attemptAudit: bool, readAudit: bool, buffer: bool,
    sent: int, verified: int, authorizedParts: int, started: bool,
    io: bool, ended: bool, cancelled: bool, outcome: str,
    terminalAudit: str, retentionUntil: int, authorized: bool,
    status: int, delivered: bool, responseSeen: bool }
  val unusedGrant: Grant = { phase: "unused", kind: "body", owner: 0, expires: 0,
    stored: false, audited: false, known: false, spent: false }
  val unusedRead: Read = { phase: "unused", kind: "body", grant: 1, owner: 0, stamp: 0,
    won: false, attemptAudit: false, readAudit: false, buffer: false,
    sent: 0, verified: 0, authorizedParts: 0, started: false,
    io: false, ended: false, cancelled: false, outcome: "none",
    terminalAudit: "none", retentionUntil: 0, authorized: false,
    status: 0, delivered: false, responseSeen: false }
  var s: { now: int, actor: int, retentionUntil: int, permanent: bool,
    grants: int -> Grant, reads: int -> Read, cookie: int }
  action init = s' = { now: 0, actor: 1, retentionUntil: 0, permanent: false,
    grants: ids.mapBy(_ => unusedGrant), reads: ids.mapBy(_ => unusedRead), cookie: 0 }
  def readable(until: int): bool = until == 0 or s.now < until
  def currentRetention: int = if (s.permanent) 0 else s.retentionUntil
  def refuse(r: Read, status: int): Read = r.with("phase", "done").with("status", status)
  def streamFailure(r: Read): Read = r.with("phase", "terminal-audit")
    .with("ended", true).with("outcome", "failed")
  action tick = all { s.now < 4, s' = s.with("now", s.now + 1) }
  action session(actor: int): bool = all { Set(0, 1, 2).contains(actor), s' = s.with("actor", actor) }
  action closeCase = all { s.retentionUntil == 0, s' = s.with("retentionUntil", s.now + 2) }
  action permanent = s' = s.with("permanent", true)
  action prepareGrant(id: int, kind: str, verified: bool): bool = all {
    ids.contains(id), kinds.contains(kind), s.grants.get(id).phase == "unused",
    s' = s.with("grants", s.grants.set(id, unusedGrant.with("kind", kind).with("owner", s.actor)
      .with("phase", if (s.actor != 0 and verified and readable(currentRetention)) "write" else "done"))) }
  action grantWrite(id: int, commits: bool): bool = {
    val g = s.grants.get(id)
    all { g.phase == "write", s' = s.with("grants", s.grants.set(id,
      g.with("phase", "reply").with("stored", commits).with("audited", commits).with("expires", s.now + 2))) }
  }
  action grantReply(id: int, delivered: bool): bool = {
    val g = s.grants.get(id)
    val known = g.stored and delivered
    all { g.phase == "reply", s' = s.with("grants", s.grants.set(id, g.with("phase", "done").with("known", known)))
      .with("cookie", if (known and g.kind == "native") id else s.cookie) }
  }
  action clearExpiredCookie = {
    val g = if (ids.contains(s.cookie)) s.grants.get(s.cookie) else unusedGrant
    all { ids.contains(s.cookie), s.now >= g.expires, s' = s.with("cookie", 0) }
  }
  action begin(id: int, grant: int, kind: str, transport: bool): bool = {
    val g = s.grants.get(grant)
    all { ids.contains(id), ids.contains(grant), kinds.contains(kind), s.reads.get(id).phase == "unused",
      s' = s.with("reads", s.reads.set(id, unusedRead.with("grant", grant).with("kind", kind)
        .with("phase", if (transport and g.known and (kind == "body" or s.cookie == grant)) "auth" else "done")
        .with("status", if (transport and g.known and (kind == "body" or s.cookie == grant)) 0 else 403))) }
  }
  action authenticate(id: int): bool = {
    val r = s.reads.get(id)
    all { r.phase == "auth", s' = s.with("reads", s.reads.set(id,
      if (s.actor == 0) refuse(r, 401) else r.with("phase", "consume").with("owner", s.actor).with("stamp", s.now))) }
  }
  action consumeWrite(id: int, databaseWorks: bool): bool = {
    val r = s.reads.get(id)
    val g = s.grants.get(r.grant)
    val wins = databaseWorks and g.stored and not(g.spent) and g.owner == r.owner and r.stamp < g.expires
    all { r.phase == "consume", s' = s.with("grants", s.grants.set(r.grant, g.with("spent", g.spent or wins)))
      .with("reads", s.reads.set(id, r.with("phase", "consume-reply").with("won", wins)
        .with("status", if (databaseWorks) 0 else 500))) }
  }
  action consumeReply(id: int, received: bool, rowVisible: bool): bool = {
    val r = s.reads.get(id)
    all { r.phase == "consume-reply", s' = s.with("reads", s.reads.set(id,
      if (not(received) or r.status == 500) refuse(r, 500)
      else if (not(r.won and rowVisible)) refuse(r, 403) else r.with("phase", "attempt-audit"))) }
  }
  action attemptAudit(id: int, commits: bool, reply: bool): bool = {
    val r = s.reads.get(id)
    all { r.phase == "attempt-audit", s' = s.with("reads", s.reads.set(id,
      (if (commits and reply) r.with("phase", "prepare") else refuse(r, 500)).with("attemptAudit", commits))) }
  }
  action prepareRead(id: int, metadata: bool, authorizedAudit: bool): bool = {
    val r = s.reads.get(id)
    all { r.phase == "prepare", s' = s.with("reads", s.reads.set(id,
      if (not(metadata)) refuse(r, 404)
      else if (not(readable(currentRetention))) refuse(r, 410)
      else if (r.kind == "body") r.with("phase", "body-io").with("io", true)
      else if (not(authorizedAudit)) refuse(r, 500)
      else r.with("phase", "pull").with("status", 200))) }
  }
  action bodyIo(id: int, valid: bool): bool = {
    val r = s.reads.get(id)
    all { r.phase == "body-io", s' = s.with("reads", s.reads.set(id,
      (if (valid) r.with("phase", "read-audit").with("buffer", true) else refuse(r, 409)).with("io", false))) }
  }
  action bodyAudit(id: int, commits: bool, reply: bool): bool = {
    val r = s.reads.get(id)
    all { r.phase == "read-audit", s' = s.with("reads", s.reads.set(id,
      (if (commits and reply) r.with("phase", "refresh") else refuse(r, 500)).with("readAudit", commits))) }
  }
  action refresh(id: int, isPresent: bool): bool = {
    val r = s.reads.get(id)
    all { r.phase == "refresh", s' = s.with("reads", s.reads.set(id,
      if (isPresent) r.with("phase", "final-auth").with("retentionUntil", currentRetention) else refuse(r, 404))) }
  }
  action bodyFinish(id: int): bool = {
    val r = s.reads.get(id)
    all { r.phase == "final-auth", s' = s.with("reads", s.reads.set(id,
      if (s.actor == 0) refuse(r, 401)
      else if (s.actor != r.owner) refuse(r, 403)
      else if (not(readable(r.retentionUntil))) refuse(r, 410)
      else r.with("phase", "response").with("status", 200).with("authorized", true))) }
  }
  action response(id: int, delivered: bool): bool = {
    val r = s.reads.get(id)
    all { r.phase == "response", s' = s.with("reads", s.reads.set(id, r.with("phase", "done").with("delivered", delivered))) }
  }
  // Delivery of native response headers is independent of later grant replies;
  // no Set-Cookie is present on this response, including error responses.
  action nativeResponse(id: int): bool = {
    val r = s.reads.get(id)
    all { r.kind == "native", r.status == 200, not(r.responseSeen),
      s' = s.with("reads", s.reads.set(id, r.with("responseSeen", true))) }
  }
  action pull(id: int): bool = {
    val r = s.reads.get(id)
    all { r.phase == "pull", r.responseSeen, s' = s.with("reads", s.reads.set(id,
      if (s.actor != r.owner or not(readable(currentRetention))) streamFailure(r)
      else if (r.sent == 2) r.with("phase", "terminal-audit").with("ended", true).with("outcome", "finished")
      else r.with("phase", "part-io").with("io", true).with("retentionUntil", currentRetention))) }
  }
  action partIo(id: int, valid: bool): bool = {
    val r = s.reads.get(id)
    all { r.phase == "part-io", s' = s.with("reads", s.reads.set(id,
      (if (not(valid)) streamFailure(r)
      else r.with("verified", r.verified + 1).with("buffer", true)
        .with("phase", if (r.started) "post-auth" else "start-audit")).with("io", false))) }
  }
  action startAudit(id: int, succeeds: bool): bool = {
    val r = s.reads.get(id)
    all { r.phase == "start-audit", s' = s.with("reads", s.reads.set(id,
      if (succeeds) r.with("phase", "post-auth").with("started", true) else streamFailure(r))) }
  }
  action enqueue(id: int): bool = {
    val r = s.reads.get(id)
    all { r.phase == "post-auth", not(r.ended), s' = s.with("reads", s.reads.set(id,
      if (s.actor != r.owner or not(readable(r.retentionUntil))) streamFailure(r)
      else r.with("phase", "pull").with("buffer", false).with("sent", r.sent + 1).with("authorizedParts", r.authorizedParts + 1))) }
  }
  action cancel(id: int): bool = {
    val r = s.reads.get(id)
    all { r.kind == "native", r.status == 200, r.responseSeen, not(r.cancelled),
      Set("pull", "part-io", "start-audit", "post-auth", "terminal-audit").contains(r.phase),
      s' = s.with("reads", s.reads.set(id, (if (r.ended) r else r.with("phase", "terminal-audit")
        .with("ended", true).with("outcome", "cancelled")).with("cancelled", true))) }
  }
  action drainCancelledIo(id: int): bool = {
    val r = s.reads.get(id)
    all { r.cancelled, r.io, s' = s.with("reads", s.reads.set(id, r.with("io", false))) }
  }
  action terminalAudit(id: int, commits: bool, reply: bool): bool = {
    val r = s.reads.get(id)
    all { r.phase == "terminal-audit", r.ended,
      s' = s.with("reads", s.reads.set(id, r.with("terminalAudit", if (commits) r.outcome else "none")
        .with("phase", if (commits and reply and r.outcome == "finished" and not(r.cancelled)) "closed" else "done"))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet grant = ids.oneOf()
    nondet kind = kinds.oneOf()
    nondet actor = Set(0, 1, 2).oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    any { tick, session(actor), closeCase, permanent, prepareGrant(id, kind, yes), grantWrite(id, yes), grantReply(id, yes), clearExpiredCookie,
      begin(id, grant, kind, yes), authenticate(id), consumeWrite(id, yes), consumeReply(id, yes, other), attemptAudit(id, yes, other),
      prepareRead(id, yes, other), bodyIo(id, yes), bodyAudit(id, yes, other), refresh(id, yes), bodyFinish(id), response(id, yes), nativeResponse(id),
      pull(id), partIo(id, yes), startAudit(id, yes), enqueue(id), cancel(id), drainCancelledIo(id), terminalAudit(id, yes, other), s' = s }
  }
  val invariant = all {
    ids.forall(id => s.grants.get(id).stored == s.grants.get(id).audited),
    ids.forall(id => {
      val r = s.reads.get(id)
      all { r.won implies s.grants.get(r.grant).spent,
        r.delivered implies r.kind == "body" and r.authorized and r.buffer and r.readAudit and r.attemptAudit,
        r.sent <= r.verified and r.sent == r.authorizedParts and r.sent <= 2,
        r.sent > 0 implies r.started and r.attemptAudit and r.won,
        r.phase == "closed" implies r.sent == 2 and r.terminalAudit == "finished" and not(r.cancelled),
        r.terminalAudit != "none" implies r.terminalAudit == r.outcome and r.ended }
    }) }
  action issue(id: int, kind: str): bool = prepareGrant(id, kind, true).then(grantWrite(id, true)).then(grantReply(id, true))
  action consume(id: int, grant: int, kind: str): bool = begin(id, grant, kind, true).then(authenticate(id)).then(consumeWrite(id, true)).then(consumeReply(id, true, true))
  action readyBody = issue(1, "body").then(consume(1, 1, "body")).then(attemptAudit(1, true, true)).then(prepareRead(1, true, true))
  action finishBody = bodyIo(1, true).then(bodyAudit(1, true, true)).then(refresh(1, true)).then(bodyFinish(1)).then(response(1, true))
  action preparedNative = issue(1, "native").then(consume(1, 1, "native")).then(attemptAudit(1, true, true)).then(prepareRead(1, true, true))
  action readyNative = preparedNative.then(nativeResponse(1))
  action firstPart = pull(1).then(partIo(1, true)).then(startAudit(1, true)).then(enqueue(1))
  action secondPart = pull(1).then(partIo(1, true)).then(enqueue(1))

  run bufferedVerifiedAuditedReadTest = init.then(readyBody).then(finishBody).expect(s.reads.get(1).delivered and invariant)
  run twoReadersConsumeOneGrantOnceTest = init.then(issue(1, "body")).then(begin(1, 1, "body", true)).then(begin(2, 1, "body", true))
    .then(authenticate(1)).then(authenticate(2)).then(consumeWrite(1, true)).then(consumeWrite(2, true))
    .then(consumeReply(1, true, true)).then(consumeReply(2, true, true)).expect(s.reads.get(2).status == 403 and invariant)
  run consumeLostReplyDoesNotRestoreGrantTest = init.then(issue(1, "body")).then(begin(1, 1, "body", true)).then(authenticate(1))
    .then(consumeWrite(1, true)).then(consumeReply(1, false, false)).expect(s.grants.get(1).spent and s.reads.get(1).status == 500 and invariant)
  run missingReturningRowAfterCommitRefusesTest = init.then(issue(1, "body")).then(begin(1, 1, "body", true)).then(authenticate(1))
    .then(consumeWrite(1, true)).then(consumeReply(1, true, false)).expect(s.grants.get(1).spent and s.reads.get(1).status == 403)
  run failedAttemptAuditKeepsGrantSpentTest = init.then(issue(1, "body")).then(consume(1, 1, "body")).then(attemptAudit(1, false, false))
    .expect(s.grants.get(1).spent and not(s.reads.get(1).attemptAudit) and invariant)
  run corruptedBufferedBytesNeverReturnTest = init.then(readyBody).then(bodyIo(1, false)).expect(s.reads.get(1).status == 409 and not(s.reads.get(1).delivered))
  run readAuditLostReplyRetainsAuditWithoutDeliveryTest = init.then(readyBody).then(bodyIo(1, true)).then(bodyAudit(1, true, false))
    .expect(s.reads.get(1).readAudit and s.reads.get(1).status == 500 and not(s.reads.get(1).delivered))
  run revokedDuringBufferedIoRefusesTest = init.then(readyBody).then(session(0)).then(bodyIo(1, true)).then(bodyAudit(1, true, true))
    .then(refresh(1, true)).then(bodyFinish(1)).expect(s.reads.get(1).status == 401 and s.grants.get(1).spent and invariant)
  run actorChangesDuringReadAuditRefusesTest = init.then(readyBody).then(bodyIo(1, true)).then(session(2)).then(bodyAudit(1, true, true))
    .then(refresh(1, true)).then(bodyFinish(1)).expect(s.reads.get(1).status == 403 and s.reads.get(1).readAudit and invariant)
  run closedCaseExpiresBeforeBufferedCompletionTest = init.then(closeCase).then(readyBody).then(tick).then(tick)
    .then(bodyIo(1, true)).then(bodyAudit(1, true, true)).then(refresh(1, true)).then(bodyFinish(1)).expect(s.reads.get(1).status == 410)
  run permanentAdmissionDoesNotExpireAtCaseBoundaryTest = init.then(closeCase).then(permanent).then(readyBody).then(tick).then(tick).then(finishBody)
    .expect(s.reads.get(1).delivered and invariant)
  run responseLossDoesNotUndoReadAuditTest = init.then(readyBody).then(bodyIo(1, true)).then(bodyAudit(1, true, true)).then(refresh(1, true))
    .then(bodyFinish(1)).then(response(1, false)).expect(s.reads.get(1).readAudit and not(s.reads.get(1).delivered) and invariant)
  run laterRevocationDoesNotRewritePreparedResponseTest = init.then(readyBody).then(bodyIo(1, true)).then(bodyAudit(1, true, true))
    .then(refresh(1, true)).then(bodyFinish(1)).then(session(0)).then(response(1, true)).expect(s.reads.get(1).delivered and invariant)
  run grantLostReplyCanBeReplacedWithoutDeletingHistoryTest = init.then(prepareGrant(1, "body", true)).then(grantWrite(1, true)).then(grantReply(1, false))
    .then(issue(2, "body")).expect(s.grants.get(1).stored and not(s.grants.get(1).known) and s.grants.get(2).known)
  run nativeTwoPartFinishTest = init.then(readyNative).then(firstPart).then(secondPart).then(pull(1)).then(terminalAudit(1, true, true))
    .expect(s.reads.get(1).phase == "closed" and invariant)
  run nativeCancelledBeforeFirstPullTest = init.then(readyNative).then(cancel(1)).then(terminalAudit(1, true, true))
    .expect(s.reads.get(1).sent == 0 and s.reads.get(1).terminalAudit == "cancelled" and invariant)
  run cancelledIoMayFinishWithoutEnqueueTest = init.then(readyNative).then(pull(1)).then(cancel(1)).then(terminalAudit(1, true, true)).then(drainCancelledIo(1))
    .expect(not(s.reads.get(1).io) and s.reads.get(1).sent == 0 and invariant)
  run nativePostIoRevocationStopsFirstPartTest = init.then(readyNative).then(pull(1)).then(partIo(1, true)).then(startAudit(1, true))
    .then(session(0)).then(enqueue(1)).then(terminalAudit(1, true, true)).expect(s.reads.get(1).sent == 0 and s.reads.get(1).outcome == "failed")
  run nativePostIoExpiryStopsFirstPartTest = init.then(closeCase).then(readyNative).then(pull(1)).then(partIo(1, true)).then(startAudit(1, true))
    .then(tick).then(tick).then(enqueue(1)).expect(s.reads.get(1).sent == 0 and s.reads.get(1).outcome == "failed")
  run nativeSecondPartFailureRetainsDeliveredPrefixTest = init.then(readyNative).then(firstPart).then(pull(1)).then(partIo(1, false)).then(terminalAudit(1, true, true))
    .expect(s.reads.get(1).sent == 1 and s.reads.get(1).terminalAudit == "failed" and invariant)
  run finishClaimWinsConcurrentCancelAuditTest = init.then(readyNative).then(firstPart).then(secondPart).then(pull(1)).then(cancel(1)).then(terminalAudit(1, true, true))
    .expect(s.reads.get(1).terminalAudit == "finished" and s.reads.get(1).cancelled and s.reads.get(1).phase != "closed" and invariant)
  run failedFinishAuditCannotCloseSuccessfullyTest = init.then(readyNative).then(firstPart).then(secondPart).then(pull(1)).then(terminalAudit(1, false, false))
    .expect(s.reads.get(1).terminalAudit == "none" and s.reads.get(1).phase != "closed" and invariant)
  run oldDownloadResponseCannotClearNewGrantCookieTest = init.then(preparedNative).then(issue(2, "native")).then(nativeResponse(1)).then(cancel(1)).then(terminalAudit(1, true, true))
    .expect(s.cookie == 2 and not(s.grants.get(2).spent) and invariant)
  run retainedSpentCookieCannotReplayTest = init.then(readyNative).then(cancel(1)).then(terminalAudit(1, true, true)).then(consume(2, 1, "native"))
    .expect(s.cookie == 1 and s.reads.get(2).status == 403 and invariant)
  run nativeTransportRefusalDoesNotConsumeTest = init.then(issue(1, "native")).then(begin(1, 1, "native", false))
    .expect(s.reads.get(1).status == 403 and not(s.grants.get(1).spent))
  run cancelledNativeReadCanRetryWithNewGrantTest = init.then(readyNative).then(cancel(1)).then(terminalAudit(1, true, true))
    .then(issue(2, "native")).then(consume(2, 2, "native")).then(attemptAudit(2, true, true)).then(prepareRead(2, true, true)).then(nativeResponse(2))
    .expect(s.grants.get(1).spent and s.grants.get(2).spent and s.reads.get(2).phase == "pull" and invariant)
  run capturedConsumeStampMayPrecedeExpiryAtWriteTest = init.then(issue(1, "body")).then(begin(1, 1, "body", true)).then(authenticate(1)).then(tick).then(tick)
    .then(consumeWrite(1, true)).then(consumeReply(1, true, true)).expect(s.grants.get(1).spent and s.reads.get(1).phase == "attempt-audit" and invariant)
}
