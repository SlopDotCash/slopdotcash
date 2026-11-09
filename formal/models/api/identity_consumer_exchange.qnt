// @source backend/identity-assertion.ts
// @source backend/points/handler.ts
// @source backend/trace/handler.ts
// @source backend/trace/auth.ts
// @source workers/identity/persistence.ts
// @source functions/api/v1/[[path]].ts
// @evidence backend/points/publication.test.ts
// @evidence tests/e2e/account-closure-integration.spec.ts
// Two exchange attempts and one previously issued assertion, with one fixed
// audience, actor and login. Time ranks 0..8 and assertion expiry rank 3 model
// ordering, not seconds. Trace token TTL is scaled to two ranks (actual: 600s).
// Remote atomic consumption and its received reply are separate. A 401 means
// rejected, not proof of wall-clock expiry. Failed replies, body reads, payload
// validation and downstream issuance cannot undo consumption.
// Header/body/identity/secret/claim-validation classes stand for source checks;
// crypto, bytes, transport authenticity and collision resistance are assumed.
// The service returns success only for its accepted consumption. Missing node
// identity is allowed by the shared adapter and trace consumer, but refused
// by Points. Points ends after identity validation, before membership reads or
// writes; api_accounts and account-closure workflows model later lifecycle.
// Trace signing creates a stateless contributor token, not an operator role or
// a persisted session row. A prepared response is not proof of client delivery.
// This covers signApiToken only through the contributor exchange; the general
// bearer verifier, operator-role filtering and later route actions are separate.
// Existing evidence covers selected Points failures and a synthetic-provider
// browser workflow; it is not full adapter or trace-exchange conformance.
module identity_consumer_exchange {
  val ids = Set(1, 2)
  val callers = Set("points", "trace")
  val replyKinds = Set("ok", "unavailable", "lost")
  val bodyKinds = Set("valid", "invalid", "read-error")
  type Exchange = { phase: str, caller: str, matchingToken: bool,
    stamp: int, accepted: bool, helper: str, nodeValid: bool,
    result: str, signed: bool, issuedAt: int, expiresAt: int,
    roles: Set[str], identityReady: bool }
  val unused: Exchange = { phase: "unused", caller: "trace", matchingToken: true,
    stamp: -1, accepted: false, helper: "none", nodeValid: false,
    result: "none", signed: false, issuedAt: -1, expiresAt: -1,
    roles: Set(), identityReady: false }
  var s: { configured: bool, audience: str, now: int, spent: bool,
    consumedBy: int, commits: int, calls: int -> Exchange }
  action init = s' = { configured: false, audience: "trace", now: 0,
    spent: false, consumedBy: 0, commits: 0, calls: ids.mapBy(_ => unused) }
  action configure(audience: str): bool = all { not(s.configured), callers.contains(audience),
    s' = s.with("configured", true).with("audience", audience) }
  action tick = all { s.configured, s.now < 8, s' = s.with("now", s.now + 1) }
  action begin(id: int, caller: str, inputValid: bool, matchingToken: bool): bool = all {
    s.configured, ids.contains(id), callers.contains(caller), s.calls.get(id).phase == "unused",
    s' = s.with("calls", s.calls.set(id, unused.with("caller", caller).with("matchingToken", matchingToken)
      .with("phase", if (inputValid) "service" else "done")
      .with("result", if (inputValid) "pending" else "invalid-request"))) }
  action remoteClock(id: int): bool = {
    val call = s.calls.get(id)
    all { call.phase == "service", s' = s.with("calls", s.calls.set(id,
      call.with("phase", "consume").with("stamp", s.now))) }
  }
  action consume(id: int): bool = {
    val call = s.calls.get(id)
    val accepted = call.matchingToken and call.caller == s.audience and not(s.spent) and call.stamp < 3
    all { call.phase == "consume",
      s' = s.with("spent", s.spent or accepted).with("commits", s.commits + (if (accepted) 1 else 0))
        .with("consumedBy", if (accepted) id else s.consumedBy)
        .with("calls", s.calls.set(id, call.with("phase", "reply").with("accepted", accepted))) }
  }
  action serviceFailure(id: int): bool = {
    val call = s.calls.get(id)
    all { Set("service", "consume").contains(call.phase),
      s' = s.with("calls", s.calls.set(id, call.with("phase", "done").with("helper", "error").with("result", "service-error"))) }
  }
  action reply(id: int, kind: str): bool = {
    val call = s.calls.get(id)
    val body = kind == "ok" and call.accepted
    val expired = kind == "ok" and not(call.accepted)
    all { call.phase == "reply", replyKinds.contains(kind),
      s' = s.with("calls", s.calls.set(id, call.with("phase", if (body) "body" else "done")
        .with("helper", if (body) "none" else if (expired) "expired" else "error")
        .with("result", if (body) "pending" else if (expired) "identity-refused" else "service-error"))) }
  }
  action readBody(id: int, kind: str, nodeValid: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "body", bodyKinds.contains(kind),
      s' = s.with("calls", s.calls.set(id, call.with("phase", if (kind == "valid") "project" else "done")
        .with("nodeValid", nodeValid).with("helper", if (kind == "valid") "identity" else if (kind == "invalid") "invalid" else "error")
        .with("result", if (kind == "valid") "pending" else if (kind == "invalid") "invalid-identity" else "service-error"))) }
  }
  action project(id: int): bool = {
    val call = s.calls.get(id)
    val trace = call.caller == "trace"
    all { call.phase == "project",
      s' = s.with("calls", s.calls.set(id, call.with("phase", if (trace) "claim-clock" else "done")
        .with("identityReady", not(trace) and call.nodeValid)
        .with("result", if (trace) "pending" else if (call.nodeValid) "identity-ready" else "invalid-identity"))) }
  }
  action captureClaims(id: int): bool = {
    val call = s.calls.get(id)
    all { call.phase == "claim-clock",
      s' = s.with("calls", s.calls.set(id, call.with("phase", "sign")
        .with("issuedAt", s.now).with("expiresAt", s.now + 2).with("roles", Set("contributor")))) }
  }
  action sign(id: int, valid: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "sign",
      s' = s.with("calls", s.calls.set(id, call.with("phase", if (valid) "response" else "done")
        .with("signed", valid).with("result", if (valid) "pending" else "token-error"))) }
  }
  action respond(id: int, delivered: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "response", s' = s.with("calls", s.calls.set(id,
      call.with("phase", "done").with("result", if (delivered) "token-returned" else "response-lost"))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet caller = callers.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet kind = replyKinds.oneOf()
    nondet body = bodyKinds.oneOf()
    any { configure(caller), tick, begin(id, caller, yes, other), remoteClock(id), consume(id), serviceFailure(id),
      reply(id, kind), readBody(id, body, yes), project(id), captureClaims(id), sign(id, yes), respond(id, yes), s' = s }
  }
  val invariant = all {
    s.now >= 0, s.now <= 8, s.commits >= 0, s.commits <= 1, s.spent == (s.commits == 1),
    ids.forall(id => {
      val call = s.calls.get(id)
      all {
        call.accepted implies s.consumedBy == id and call.matchingToken and call.caller == s.audience and call.stamp < 3,
        call.helper == "identity" implies call.accepted,
        call.identityReady implies call.caller == "points" and call.helper == "identity" and call.nodeValid,
        call.signed implies call.caller == "trace" and call.helper == "identity" and call.roles == Set("contributor")
          and call.expiresAt == call.issuedAt + 2,
        call.result == "token-returned" implies call.signed,
        not(call.roles.contains("operator")), not(call.roles.contains("project_owner")) }
    }) }

  action points = init.then(configure("points"))
  action trace = init.then(configure("trace"))
  action consumed(id: int, caller: str): bool = begin(id, caller, true, true).then(remoteClock(id)).then(consume(id))
  action projected(id: int, caller: str, node: bool): bool = consumed(id, caller).then(reply(id, "ok"))
    .then(readBody(id, "valid", node)).then(project(id))

  run pointsIdentityPassesNodeValidationTest = points.then(projected(1, "points", true))
    .expect(s.calls.get(1).identityReady and s.spent and invariant)
  run traceIdentityIssuesOnlyContributorTokenTest = trace.then(projected(1, "trace", true)).then(captureClaims(1)).then(sign(1, true)).then(respond(1, true))
    .expect(s.calls.get(1).result == "token-returned" and s.calls.get(1).roles == Set("contributor") and invariant)
  run traceAcceptsBasicIdentityWithoutNodeTest = trace.then(projected(1, "trace", false)).then(captureClaims(1)).then(sign(1, true)).then(respond(1, true))
    .expect(s.calls.get(1).signed and invariant)
  run pointsRequiresValidNodeAfterSharedAdapterTest = points.then(projected(1, "points", false))
    .expect(s.calls.get(1).helper == "identity" and s.calls.get(1).result == "invalid-identity" and s.spent and invariant)
  run invalidRequestNeverContactsServiceTest = trace.then(begin(1, "trace", false, true))
    .expect(s.calls.get(1).result == "invalid-request" and not(s.spent) and invariant)
  run wrongAudienceDoesNotConsumeTest = points.then(consumed(1, "trace")).then(reply(1, "ok"))
    .expect(s.calls.get(1).helper == "expired" and not(s.spent) and invariant)
  run wrongTokenDoesNotConsumeTest = trace.then(begin(1, "trace", true, false)).then(remoteClock(1)).then(consume(1)).then(reply(1, "ok"))
    .expect(s.calls.get(1).result == "identity-refused" and not(s.spent) and invariant)
  run serviceFailureBeforeCommitAllowsRetryTest = trace.then(begin(1, "trace", true, true)).then(serviceFailure(1))
    .then(projected(2, "trace", true)).expect(s.calls.get(2).phase == "claim-clock" and s.commits == 1 and invariant)
  run lostConsumeReplyDoesNotRestoreAssertionTest = trace.then(consumed(1, "trace")).then(reply(1, "lost"))
    .then(consumed(2, "trace")).then(reply(2, "ok"))
    .expect(s.calls.get(1).result == "service-error" and s.calls.get(2).result == "identity-refused" and s.commits == 1 and invariant)
  run failedServiceResponseDoesNotRestoreAssertionTest = points.then(consumed(1, "points")).then(reply(1, "unavailable"))
    .expect(s.calls.get(1).helper == "error" and s.spent and invariant)
  run bodyReadFailureCannotUndoConsumptionTest = trace.then(consumed(1, "trace")).then(reply(1, "ok")).then(readBody(1, "read-error", true))
    .expect(s.calls.get(1).result == "service-error" and s.spent and invariant)
  run invalidServiceIdentityCannotUndoConsumptionTest = points.then(consumed(1, "points")).then(reply(1, "ok")).then(readBody(1, "invalid", true))
    .expect(s.calls.get(1).helper == "invalid" and s.spent and not(s.calls.get(1).identityReady) and invariant)
  run rejectedIdentityCannotBecomeTraceTokenTest = trace.then(consumed(1, "trace")).then(reply(1, "ok")).then(readBody(1, "invalid", false))
    .expect(s.calls.get(1).result == "invalid-identity" and not(s.calls.get(1).signed) and invariant)
  run signingFailureRequiresNewAssertionTest = trace.then(projected(1, "trace", true)).then(captureClaims(1)).then(sign(1, false))
    .then(consumed(2, "trace")).then(reply(2, "ok"))
    .expect(s.calls.get(1).result == "token-error" and s.calls.get(2).helper == "expired" and invariant)
  run lostTokenResponseKeepsAssertionConsumedTest = trace.then(projected(1, "trace", true)).then(captureClaims(1)).then(sign(1, true)).then(respond(1, false))
    .expect(s.calls.get(1).signed and s.calls.get(1).result == "response-lost" and s.spent and invariant)
  run concurrentExchangesHaveOneAcceptedConsumeTest = trace.then(begin(1, "trace", true, true)).then(begin(2, "trace", true, true))
    .then(remoteClock(1)).then(remoteClock(2)).then(consume(2)).then(consume(1)).then(reply(1, "ok")).then(reply(2, "ok"))
    .expect(s.calls.get(1).helper == "expired" and s.calls.get(2).phase == "body" and invariant)
  run expiredBeforeRemoteClockIsRefusedTest = trace.then(begin(1, "trace", true, true)).then(tick).then(tick).then(tick)
    .then(remoteClock(1)).then(consume(1)).then(reply(1, "ok"))
    .expect(not(s.spent) and s.calls.get(1).helper == "expired" and invariant)
  run capturedRemoteStampMayCommitAfterExpiryTest = trace.then(begin(1, "trace", true, true)).then(remoteClock(1))
    .then(tick).then(tick).then(tick).then(consume(1)).then(reply(1, "ok"))
    .expect(s.spent and s.calls.get(1).stamp == 0 and s.now == 3 and invariant)
  run traceTokenClockIsSampledAfterIdentityReplyTest = trace.then(projected(1, "trace", true)).then(tick).then(tick).then(captureClaims(1))
    .then(sign(1, true)).then(respond(1, true)).expect(s.calls.get(1).issuedAt == 2 and s.calls.get(1).expiresAt == 4 and invariant)
  run tokenSigningDelayDoesNotRefreshClaimsTest = trace.then(projected(1, "trace", true)).then(captureClaims(1)).then(tick).then(tick)
    .then(sign(1, true)).then(respond(1, true)).expect(s.now == s.calls.get(1).expiresAt and s.calls.get(1).issuedAt == 0 and invariant)
}
