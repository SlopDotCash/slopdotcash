// @source backend/vetting/evidence.ts
// @source backend/http.ts
// @source backend/vetting/evidence-retention.ts
// @evidence scripts/vetting-api.test.ts
// One overview request and one retry, two designated operators plus signed-out
// and nonoperator classes; no query, a partial query, or one exact run query.
// One run has at most two objects: object1 is unchunked (R2 head), object2 is
// chunked (D1 completion lookup). Clock0..2 gives exact access-expiry equality.
// Input/session header details are covered by vetting_evidence_access. Here
// admission, run/row snapshots, each head read, assembly closure, list audit,
// final current same-actor observation and response delivery are separate.
// An empty query intentionally returns an empty inventory; it does not enumerate
// every run. Expired metadata remains listable. Head/completion observations are
// not byte verification: all available objects remain stored-unverified.
// Assembly failure is caught and projected unavailable with scanReady=false;
// it does not hide otherwise readable inventory. A list-audit failure refuses
// the response, but a committed audit can remain after its reply or final auth
// fails. The final check protects response construction, not atomic delivery or
// ongoing authorization. Per-object times can differ and captured metadata is
// not a coherent live snapshot. Immutable policy JSON is assumed valid under
// its database CHECK. Hashing, source bodies, global enumeration and cleanup
// selection are outside this finite model. No executions/checks were run.
module vetting_evidence_inventory {
  val objects = Set(1, 2)
  type Request = { phase: str, attempt: int, query: int, actor: int,
    count: int, index: int, expires: int, states: int -> str,
    assembly: str, audit: bool, authorized: bool, status: int, delivered: bool }
  val idle: Request = { phase: "idle", attempt: 0, query: 0, actor: 0,
    count: 0, index: 1, expires: 0, states: objects.mapBy(_ => "unread"),
    assembly: "none", audit: false, authorized: false, status: 0, delivered: false }
  var s: { now: int, actor: int, runExists: bool, expires: int,
    objectCount: int, head: str, completed: bool, bytesValid: bool, request: Request }
  action init = s' = { now: 0, actor: 1, runExists: true, expires: 0,
    objectCount: 2, head: "valid", completed: true, bytesValid: true, request: idle }
  def refuse(r: Request, status: int): Request = r.with("phase", "response").with("status", status)
  action session(actor: int): bool = all { Set(0, 1, 2, 3).contains(actor), s' = s.with("actor", actor) }
  action tick = all { s.now < 2, s' = s.with("now", s.now + 1) }
  action closeCase = s' = s.with("expires", 2)
  action removeRun = all { s.request.phase == "idle", s' = s.with("runExists", false) }
  action rows(count: int): bool = all { s.request.phase == "idle", Set(0, 1, 2).contains(count), s' = s.with("objectCount", count) }
  action changeHead(readHead: str): bool = all { Set("valid", "missing", "corrupt").contains(readHead), s' = s.with("head", readHead) }
  action completion(present: bool): bool = all { s.request.phase == "idle" or present,
    s' = s.with("completed", present) }
  action corruptBytes = s' = s.with("bytesValid", false)
  action begin(query: int): bool = all { Set(0, 1, 2).contains(query), Set("idle", "done").contains(s.request.phase), s.request.attempt < 2,
    s' = s.with("request", idle.with("phase", "admit").with("query", query).with("attempt", s.request.attempt + 1)) }
  action admit(readable: bool): bool = {
    val r = s.request.with("actor", s.actor)
    all { r.phase == "admit", s' = s.with("request",
      if (not(readable)) refuse(r, 500) else if (s.actor == 0) refuse(r, 401)
      else if (s.actor == 3) refuse(r, 403) else r.with("phase", "query")) }
  }
  action query = all { s.request.phase == "query", s' = s.with("request",
    if (s.request.query == 2) refuse(s.request, 400)
    else s.request.with("phase", if (s.request.query == 0) "audit" else "run")) }
  action readRun(readable: bool): bool = all { s.request.phase == "run", s' = s.with("request",
    if (not(readable)) refuse(s.request, 500) else if (not(s.runExists)) refuse(s.request, 404)
    else s.request.with("expires", s.expires).with("phase", "rows")) }
  action readRows(readable: bool): bool = all { s.request.phase == "rows", s' = s.with("request",
    if (not(readable)) refuse(s.request, 500) else s.request.with("count", s.objectCount)
      .with("phase", if (s.objectCount == 0) "assembly" else "head")) }
  action readHead(outcome: str): bool = {
    val r = s.request
    val expired = r.expires != 0 and s.now >= r.expires
    val state = if (expired) "expired"
      else if (r.index == 2) (if (s.completed) "stored-unverified" else "pending")
      else if (s.head == "valid") "stored-unverified" else s.head
    all { r.phase == "head", Set("ok", "io-error", "layout-error").contains(outcome),
      outcome != "layout-error" or r.index == 2,
      s' = s.with("request", if (outcome != "ok") refuse(r, if (outcome == "io-error") 500 else 409)
        else r.with("states", r.states.set(r.index, state)).with("index", r.index + 1)
          .with("phase", if (r.index == r.count) "assembly" else "head")) }
  }
  action assembly(retained: bool): bool = all { s.request.phase == "assembly",
    s' = s.with("request", s.request.with("assembly", if (retained) "retained-not-scan-ready" else "unavailable").with("phase", "audit")) }
  action audit(commits: bool, reply: bool): bool = all { s.request.phase == "audit",
    s' = s.with("request", (if (commits and reply) s.request.with("phase", "final-auth") else refuse(s.request, 500)).with("audit", commits)) }
  action finalAuth(readable: bool): bool = {
    val r = s.request
    all { r.phase == "final-auth", s' = s.with("request",
      if (not(readable)) refuse(r, 500) else if (s.actor == 0) refuse(r, 401)
      else if (s.actor != r.actor or s.actor == 3) refuse(r, 403)
      else r.with("authorized", true).with("status", 200).with("phase", "response")) }
  }
  action response(delivered: bool): bool = all { s.request.phase == "response",
    s' = s.with("request", s.request.with("phase", "done").with("delivered", delivered and s.request.status == 200)) }
  action step = {
    nondet actor = Set(0, 1, 2, 3).oneOf()
    nondet count = Set(0, 1, 2).oneOf()
    nondet headChoice = Set("valid", "missing", "corrupt").oneOf()
    nondet outcome = Set("ok", "io-error", "layout-error").oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    any { session(actor), tick, closeCase, removeRun, rows(count), changeHead(headChoice), completion(yes), corruptBytes,
      begin(count), admit(yes), query, readRun(yes), readRows(yes), readHead(outcome), assembly(yes), audit(yes, other), finalAuth(yes), response(yes), s' = s }
  }
  val invariant = all {
    s.request.delivered implies s.request.authorized and s.request.audit and s.request.status == 200,
    s.request.authorized implies Set(1, 2).contains(s.request.actor),
    s.request.query == 0 implies s.request.count == 0,
    objects.forall(object => Set("unread", "expired", "missing", "corrupt", "pending", "stored-unverified").contains(s.request.states.get(object))) }
  action start(queryClass: int): bool = begin(queryClass).then(admit(true)).then(query)
  action listed = start(1).then(readRun(true)).then(readRows(true)).then(readHead("ok")).then(readHead("ok")).then(assembly(false))
  action finish = audit(true, true).then(finalAuth(true)).then(response(true))

  run emptyQueryReturnsAuditedEmptyInventoryTest = init.then(start(0)).then(finish)
    .expect(s.request.count == 0 and s.request.delivered and invariant)
  run partialQueryRefusesBeforeRunReadTest = init.then(start(2)).expect(s.request.status == 400 and not(s.request.audit))
  run signedOutInventoryRefusesTest = init.then(session(0)).then(begin(1)).then(admit(true)).expect(s.request.status == 401 and invariant)
  run nonoperatorInventoryRefusesTest = init.then(session(3)).then(begin(1)).then(admit(true)).expect(s.request.status == 403 and invariant)
  run missingRunIs404Test = init.then(removeRun).then(start(1)).then(readRun(true)).expect(s.request.status == 404)
  run failedObjectQueryReturnsNoInventoryTest = init.then(start(1)).then(readRun(true)).then(readRows(false)).expect(s.request.status == 500 and not(s.request.audit))
  run invalidLayoutIsExplicit409Test = init.then(start(1)).then(readRun(true)).then(readRows(true)).then(readHead("ok")).then(readHead("layout-error"))
    .expect(s.request.status == 409)
  run missingSingleObjectIsMetadataStateTest = init.then(changeHead("missing")).then(listed).then(finish)
    .expect(s.request.states.get(1) == "missing" and s.request.delivered)
  run absentChunkCompletionIsPendingTest = init.then(completion(false)).then(listed).then(finish)
    .expect(s.request.states.get(2) == "pending" and invariant)
  run completionDoesNotProveCurrentBytesTest = init.then(corruptBytes).then(listed).then(finish)
    .expect(s.request.states.get(2) == "stored-unverified" and not(s.bytesValid) and invariant)
  run expiredMetadataRemainsListableTest = init.then(closeCase).then(tick).then(tick).then(listed).then(finish)
    .expect(s.request.states.get(1) == "expired" and s.request.states.get(2) == "expired" and s.request.delivered)
  run perObjectReadsCanStraddleExpiryTest = init.then(closeCase).then(start(1)).then(readRun(true)).then(readRows(true)).then(readHead("ok"))
    .then(tick).then(tick).then(readHead("ok")).then(assembly(false)).then(finish)
    .expect(s.request.states.get(1) == "stored-unverified" and s.request.states.get(2) == "expired" and invariant)
  run assemblyFailureDoesNotHideInventoryTest = init.then(listed).then(finish)
    .expect(s.request.assembly == "unavailable" and s.request.delivered)
  run assemblyRetentionStillIsNotScanReadinessTest = init.then(start(1)).then(readRun(true)).then(readRows(true)).then(readHead("ok")).then(readHead("ok"))
    .then(assembly(true)).then(finish).expect(s.request.assembly == "retained-not-scan-ready")
  run failedListAuditRefusesResponseTest = init.then(listed).then(audit(false, false)).expect(s.request.status == 500 and not(s.request.delivered))
  run lostListAuditReplyRetainsCommittedAuditTest = init.then(listed).then(audit(true, false)).expect(s.request.audit and s.request.status == 500)
  run revokedDuringListAuditCannotReceiveInventoryTest = init.then(listed).then(audit(true, true)).then(session(0)).then(finalAuth(true))
    .expect(s.request.audit and s.request.status == 401 and not(s.request.delivered))
  run otherOperatorCannotBorrowCapturedInventoryTest = init.then(listed).then(audit(true, true)).then(session(2)).then(finalAuth(true))
    .expect(s.request.status == 403 and not(s.request.delivered))
  run laterRevocationDoesNotRewritePreparedResponseTest = init.then(listed).then(audit(true, true)).then(finalAuth(true)).then(session(0)).then(response(true))
    .expect(s.request.delivered and invariant)
  run refusedInventoryCanRetryWithFreshSessionTest = init.then(listed).then(audit(true, true)).then(session(0)).then(finalAuth(true)).then(response(false))
    .then(session(1)).then(listed).then(finish).expect(s.request.attempt == 2 and s.request.delivered and invariant)
}
