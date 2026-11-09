// @source backend/payments/handler.ts
// @source backend/http.ts
// @source functions/api/v1/[[path]].ts
// @source workers/payments/deployments.ts
// @source workers/payment-executor/entrypoint.ts
// @evidence contracts/solana/integration/executor.e2e.mjs
// Two API requests, one authenticated actor/requested obligation, two current
// claim/attempt snapshots, and ordinary/private ledger classes. Each class
// has at most one selectable attempt; created_at ties and SQL encodings are
// outside this bound. prepared/unknown/submitted are the accepted states.
// "unavailable" collapses absent rows and every failed join predicate: actor,
// obligation, Solana chain, reserved state, registry source, authorization or
// matching attempt. The source SQL, schema and cryptography remain assumptions.
// Both ledger classes may match to exercise ordinary-query precedence; this
// does not assert deployed obligation-ID collisions. Private reads require a
// reporter-owned settlement and a committed access audit first. The audit
// clock is captured before session/body awaits; two requests can append two
// audits. A failed audit reply does not undo a committed audit.
// Claim selection, deployment context and service invocation are not atomic.
// Selection is retained through subsequent awaits; the Worker independently
// revalidates it in solana_binding_completion. The supplied transaction cannot
// select a claim, attempt, scope, actor, deployment or service. Runtime session
// observations and the optional expected-actor header are admission checks,
// not continuous global session revocation. The route is POST-only; this model
// starts after route matching and summarizes allowed-origin/write validation.
// Production supplies a registry resolver combining ordinary/private pins.
// Missing resolver is nevertheless accepted by this handler: prepare then
// returns no bindingContext. A present resolver must uniquely match exact
// Solana/network/vault and have program/project/domain fields. The dependency
// validates registry contents; the handler does not prove their byte shape.
// Response acceptance is type-only: any string transactionId (even empty) and
// an absent/string transaction qualify. Prepare forwards optional transaction
// and context; complete returns only transactionId. Worker validation and UI
// byte/signature validation are separate boundaries. This is not a claim that
// empty IDs or arbitrary strings are valid on-chain evidence.
// Opaque remote effects may commit before or after a lost/rejected fetch; an
// API failure never proves rollback or absence of a signed/submitted binding.
// No exact-once guarantee, payment transition, chain finality or auto-retry is
// added. Existing real workflow is a partial conformance reference; no tests,
// parsers, validators, services or providers were run for these definitions.
module solana_binding_api {
  val ids = Set(1, 2)
  val scopes = Set(1, 2)
  val modes = Set("prepare", "complete")
  val profiles = Set("none", "ordinary", "private", "private-unavailable", "both", "ordinary-private-unavailable")
  val rows = Set("prepared", "unknown", "submitted", "unavailable")
  val inputClasses = Set("valid", "bad-json", "bad-id", "no-transaction", "large-transaction", "bad-transaction", "limit-transaction")
  val envelopes = Set("no-transaction", "transaction", "empty-id", "missing-id", "bad-id", "bad-transaction", "invalid-json", "null")
  type Request = { phase: str, mode: str, stamp: int, admitted: bool,
    scope: int, claim: int, attempt: int, owner: bool, audited: bool,
    context: bool, contextClaim: int, dispatched: bool, dispatchScope: int,
    dispatchClaim: int, dispatchAttempt: int, requestTransaction: bool,
    replyTransaction: bool, replyContext: bool, emptyId: bool,
    desired: str, response: str }
  val idle: Request = { phase: "unused", mode: "prepare", stamp: -1, admitted: false,
    scope: 0, claim: 0, attempt: 0, owner: false, audited: false,
    context: false, contextClaim: 0, dispatched: false, dispatchScope: 0,
    dispatchClaim: 0, dispatchAttempt: 0, requestTransaction: false,
    replyTransaction: false, replyContext: false, emptyId: false,
    desired: "none", response: "none" }
  var s: { configured: bool, now: int, claim: int, profile: str,
    deployments: bool, owned: bool, ledger: int -> str,
    audits: Set[int], auditStamps: int -> int, effects: Set[int], requests: int -> Request }
  action init = s' = { configured: false, now: 0, claim: 1, profile: "none",
    deployments: false, owned: false, ledger: scopes.mapBy(_ => "unavailable"),
    audits: Set(), auditStamps: ids.mapBy(_ => -1), effects: Set(), requests: ids.mapBy(_ => idle) }
  def ending(request: Request, result: str): Request = request.with("phase", "response").with("desired", result)
  def ordinaryService(profile: str): bool = Set("ordinary", "both", "ordinary-private-unavailable").contains(profile)
  def privateConfigured(profile: str): bool = Set("private", "private-unavailable", "both", "ordinary-private-unavailable").contains(profile)
  def privateService(profile: str): bool = Set("private", "both").contains(profile)
  def selectable(scope: int): bool = s.ledger.get(scope) != "unavailable"
  def selected(request: Request, scope: int): Request = request.with("phase", "context")
    .with("scope", scope).with("claim", s.claim).with("attempt", scope * 10 + s.claim)
  action configure(profile: str, ordinary: str, privateRow: str, owned: bool, deployments: bool): bool = all {
    not(s.configured), profiles.contains(profile), rows.contains(ordinary), rows.contains(privateRow),
    s' = s.with("configured", true).with("profile", profile).with("deployments", deployments)
      .with("owned", owned).with("ledger", Map(1 -> ordinary, 2 -> privateRow)) }
  action advance = all { s.configured, s.now < 2, s' = s.with("now", s.now + 1) }
  // Abstracts a separately authorized successor and its matching attempt.
  action replaceClaim = all { s.configured, s.claim == 1, s' = s.with("claim", 2) }
  action closeAttempt(scope: int): bool = all { scopes.contains(scope), selectable(scope),
    s' = s.with("ledger", s.ledger.set(scope, "unavailable")) }
  action begin(id: int, mode: str): bool = all {
    s.configured, ids.contains(id), modes.contains(mode), s.requests.get(id).phase == "unused",
    s' = s.with("requests", s.requests.set(id, idle.with("phase", "origin").with("mode", mode).with("stamp", s.now))) }
  action origin(id: int, allowed: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "origin", s' = s.with("requests", s.requests.set(id,
      if (allowed) request.with("phase", "session") else ending(request, "403-origin"))) }
  }
  action session(id: int, kind: str): bool = {
    val request = s.requests.get(id)
    all { request.phase == "session", Set("member", "missing", "expired", "error").contains(kind),
      s' = s.with("requests", s.requests.set(id,
        if (kind == "member") request.with("phase", "expected-actor")
        else ending(request, if (kind == "error") "503-unavailable" else if (kind == "expired") "401-expired" else "401-sign-in"))) }
  }
  action expectedActor(id: int, kind: str): bool = {
    val request = s.requests.get(id)
    all { request.phase == "expected-actor", Set("absent", "matching", "invalid", "changed").contains(kind),
      s' = s.with("requests", s.requests.set(id,
        if (Set("absent", "matching").contains(kind)) request.with("phase", "body").with("admitted", true)
        else ending(request, if (kind == "invalid") "400-actor" else "403-actor"))) }
  }
  action body(id: int, kind: str): bool = {
    val request = s.requests.get(id)
    val invalid = Set("bad-json", "bad-id").contains(kind)
      or (request.mode == "complete" and Set("no-transaction", "large-transaction", "bad-transaction").contains(kind))
    all { request.phase == "body", inputClasses.contains(kind),
      s' = s.with("requests", s.requests.set(id,
        if (invalid) ending(request, "400-input") else request.with("phase", "services"))) }
  }
  action serviceGate(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "services", s' = s.with("requests", s.requests.set(id,
      if (ordinaryService(s.profile) or privateConfigured(s.profile)) request.with("phase", "ordinary-query")
      else ending(request, "503-attester"))) }
  }
  action ordinaryQuery(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "ordinary-query", s' = s.with("requests", s.requests.set(id,
      if (selectable(1)) selected(request, 1)
      else if (privateConfigured(s.profile)) request.with("phase", "owner-query")
      else ending(request, "409-not-ready"))) }
  }
  action ownerQuery(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "owner-query", s' = s.with("requests", s.requests.set(id,
      if (s.owned) request.with("phase", "audit-write").with("owner", true)
      else ending(request, "409-not-ready"))) }
  }
  action commitAudit(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "audit-write",
      s' = s.with("audits", s.audits.union(Set(id))).with("auditStamps", s.auditStamps.set(id, request.stamp))
        .with("requests", s.requests.set(id, request.with("phase", "audit-reply").with("audited", true))) }
  }
  action auditReply(id: int, received: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "audit-reply", s' = s.with("requests", s.requests.set(id,
      if (received) request.with("phase", "private-query") else ending(request, "503-unavailable"))) }
  }
  action privateQuery(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "private-query", s' = s.with("requests", s.requests.set(id,
      if (selectable(2)) selected(request, 2) else ending(request, "409-not-ready"))) }
  }
  action contextGate(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "context", s' = s.with("requests", s.requests.set(id,
      request.with("phase", if (request.mode == "prepare" and s.deployments) "context-query" else "selected-service"))) }
  }
  action contextReply(id: int, kind: str): bool = {
    val request = s.requests.get(id)
    all { request.phase == "context-query", Set("matching", "missing", "duplicate", "missing-fields", "error").contains(kind),
      s' = s.with("requests", s.requests.set(id,
        if (kind == "matching") request.with("phase", "selected-service").with("context", true).with("contextClaim", request.claim)
        else ending(request, if (kind == "error") "503-unavailable" else "503-deployment"))) }
  }
  action selectedService(id: int): bool = {
    val request = s.requests.get(id)
    val available = if (request.scope == 1) ordinaryService(s.profile) else privateService(s.profile)
    all { request.phase == "selected-service", s' = s.with("requests", s.requests.set(id,
      if (available) request.with("phase", "dispatch") else ending(request, "503-attester"))) }
  }
  action dispatch(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "dispatch", s' = s.with("requests", s.requests.set(id,
      request.with("phase", "inflight").with("dispatched", true).with("dispatchScope", request.scope)
        .with("dispatchClaim", request.claim).with("dispatchAttempt", request.attempt)
        .with("requestTransaction", request.mode == "complete"))) }
  }
  action serviceEffect(id: int): bool = all {
    s.requests.get(id).dispatched, not(s.effects.contains(id)),
    s' = s.with("effects", s.effects.union(Set(id))) }
  action fetchReply(id: int, kind: str): bool = {
    val request = s.requests.get(id)
    all { request.phase == "inflight", Set("ok", "non-ok", "throw").contains(kind),
      s' = s.with("requests", s.requests.set(id,
        if (kind == "ok") request.with("phase", "json")
        else ending(request, if (kind == "non-ok") "409-attester" else "503-unavailable"))) }
  }
  action responseJson(id: int, kind: str): bool = {
    val request = s.requests.get(id)
    val accepted = Set("no-transaction", "transaction", "empty-id").contains(kind)
    all { request.phase == "json", envelopes.contains(kind),
      s' = s.with("requests", s.requests.set(id,
        if (not(accepted)) ending(request, "503-unavailable")
        else ending(request.with("emptyId", kind == "empty-id")
          .with("replyTransaction", request.mode == "prepare" and kind == "transaction")
          .with("replyContext", request.mode == "prepare" and request.context), "200"))) }
  }
  action lookupFailure(id: int): bool = {
    val request = s.requests.get(id)
    all { Set("ordinary-query", "owner-query", "audit-write", "private-query").contains(request.phase),
      s' = s.with("requests", s.requests.set(id, ending(request, "503-unavailable"))) }
  }
  action respond(id: int, received: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "response", s' = s.with("requests", s.requests.set(id,
      request.with("phase", "done").with("response", if (received) request.desired else "lost"))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet scope = scopes.oneOf()
    nondet mode = modes.oneOf()
    nondet profile = profiles.oneOf()
    nondet first = rows.oneOf()
    nondet second = rows.oneOf()
    nondet input = inputClasses.oneOf()
    nondet sessionClass = Set("member", "missing", "expired", "error").oneOf()
    nondet expected = Set("absent", "matching", "invalid", "changed").oneOf()
    nondet context = Set("matching", "missing", "duplicate", "missing-fields", "error").oneOf()
    nondet fetch = Set("ok", "non-ok", "throw").oneOf()
    nondet envelope = envelopes.oneOf()
    nondet a = Set(false, true).oneOf()
    nondet b = Set(false, true).oneOf()
    any { configure(profile, first, second, a, b), advance, replaceClaim, closeAttempt(scope), begin(id, mode),
      origin(id, a), session(id, sessionClass), expectedActor(id, expected), body(id, input), serviceGate(id),
      ordinaryQuery(id), ownerQuery(id), commitAudit(id), auditReply(id, a), privateQuery(id), contextGate(id),
      contextReply(id, context), selectedService(id), dispatch(id), serviceEffect(id), fetchReply(id, fetch),
      responseJson(id, envelope), lookupFailure(id), respond(id, a), s' = s }
  }
  val invariant = all {
    Set(0, 1, 2).contains(s.now), scopes.contains(s.claim), s.audits.subseteq(ids), s.effects.subseteq(ids),
    ids.forall(id => {
      val request = s.requests.get(id)
      all { request.audited == s.audits.contains(id),
        request.audited implies request.owner and s.auditStamps.get(id) == request.stamp,
        request.scope == 2 implies request.owner and request.audited,
        request.dispatched implies request.admitted and scopes.contains(request.scope)
          and request.dispatchScope == request.scope and request.dispatchClaim == request.claim
          and request.dispatchAttempt == request.attempt and request.requestTransaction == (request.mode == "complete"),
        s.effects.contains(id) implies request.dispatched,
        request.context implies request.mode == "prepare" and request.contextClaim == request.claim,
        request.replyTransaction implies request.mode == "prepare" and request.desired == "200",
        request.replyContext implies request.context and request.desired == "200",
        request.desired == "200" implies request.dispatched }
    }) }
  action ordinary = init.then(configure("ordinary", "prepared", "unavailable", false, true))
  action privateSetup = init.then(configure("private", "unavailable", "prepared", true, true))
  action admitted(id: int, mode: str): bool = begin(id, mode).then(origin(id, true)).then(session(id, "member"))
    .then(expectedActor(id, "matching")).then(body(id, "valid")).then(serviceGate(id))
  action ordinarySelected(id: int, mode: str): bool = admitted(id, mode).then(ordinaryQuery(id))
  action privateSelected(id: int, mode: str): bool = admitted(id, mode).then(ordinaryQuery(id)).then(ownerQuery(id))
    .then(commitAudit(id)).then(auditReply(id, true)).then(privateQuery(id))
  action sent(id: int): bool = contextGate(id).then(selectedService(id)).then(dispatch(id))
  action sentWithContext(id: int): bool = contextGate(id).then(contextReply(id, "matching")).then(selectedService(id)).then(dispatch(id))
  action success(id: int, envelope: str): bool = fetchReply(id, "ok").then(responseJson(id, envelope)).then(respond(id, true))

  run ordinaryPrepareReturnsSelectedContextAndBytesTest = ordinary.then(ordinarySelected(1, "prepare")).then(sentWithContext(1)).then(success(1, "transaction"))
    .expect(s.requests.get(1).response == "200" and s.requests.get(1).replyContext and s.requests.get(1).replyTransaction and invariant)
  run completeForwardsTransactionWithoutReturningItTest = ordinary.then(ordinarySelected(1, "complete")).then(sent(1)).then(success(1, "transaction"))
    .expect(s.requests.get(1).requestTransaction and not(s.requests.get(1).replyTransaction) and not(s.requests.get(1).replyContext) and invariant)
  run forbiddenOriginRefusesBeforeSessionTest = ordinary.then(begin(1, "prepare")).then(origin(1, false)).then(respond(1, true))
    .expect(s.requests.get(1).response == "403-origin" and not(s.requests.get(1).admitted) and invariant)
  run missingSessionRefusesTest = ordinary.then(begin(1, "prepare")).then(origin(1, true)).then(session(1, "missing")).then(respond(1, true))
    .expect(s.requests.get(1).response == "401-sign-in" and invariant)
  run expiredSessionRefusesDistinctlyTest = ordinary.then(begin(1, "prepare")).then(origin(1, true)).then(session(1, "expired")).then(respond(1, true))
    .expect(s.requests.get(1).response == "401-expired" and invariant)
  run mismatchedExpectedActorRefusesTest = ordinary.then(begin(1, "prepare")).then(origin(1, true)).then(session(1, "member"))
    .then(expectedActor(1, "changed")).then(respond(1, true)).expect(s.requests.get(1).response == "403-actor" and invariant)
  run invalidExpectedActorRefusesTest = ordinary.then(begin(1, "complete")).then(origin(1, true)).then(session(1, "member"))
    .then(expectedActor(1, "invalid")).then(respond(1, true)).expect(s.requests.get(1).response == "400-actor" and invariant)
  run invalidBodyRefusesBeforeServiceLookupTest = ordinary.then(begin(1, "prepare")).then(origin(1, true)).then(session(1, "member"))
    .then(expectedActor(1, "absent")).then(body(1, "bad-json")).then(respond(1, true))
    .expect(s.requests.get(1).response == "400-input" and s.requests.get(1).scope == 0 and invariant)
  run completeRequiresBoundedEncodedTransactionTest = ordinary.then(begin(1, "complete")).then(origin(1, true)).then(session(1, "member"))
    .then(expectedActor(1, "matching")).then(body(1, "large-transaction")).then(respond(1, true))
    .expect(s.requests.get(1).response == "400-input" and not(s.requests.get(1).dispatched) and invariant)
  run prepareIgnoresUnneededTransactionFieldTest = ordinary.then(begin(1, "prepare")).then(origin(1, true)).then(session(1, "member"))
    .then(expectedActor(1, "absent")).then(body(1, "bad-transaction")).then(serviceGate(1)).then(ordinaryQuery(1)).then(sentWithContext(1))
    .then(success(1, "no-transaction")).expect(s.requests.get(1).response == "200" and not(s.requests.get(1).requestTransaction) and invariant)
  run noServicesRefusesBeforeAnyLedgerReadTest = init.then(configure("none", "prepared", "prepared", true, true)).then(admitted(1, "prepare"))
    .then(respond(1, true)).expect(s.requests.get(1).response == "503-attester" and s.requests.get(1).scope == 0 and invariant)
  run absentSelectableAttemptReturnsNotReadyTest = init.then(configure("ordinary", "unavailable", "unavailable", false, true))
    .then(admitted(1, "prepare")).then(ordinaryQuery(1)).then(respond(1, true)).expect(s.requests.get(1).response == "409-not-ready" and invariant)
  run unknownAttemptRemainsSelectableTest = init.then(configure("ordinary", "unknown", "unavailable", false, true))
    .then(ordinarySelected(1, "complete")).then(sent(1)).then(success(1, "no-transaction")).expect(s.requests.get(1).response == "200" and invariant)
  run submittedAttemptRemainsSelectableForRetryTest = init.then(configure("ordinary", "submitted", "unavailable", false, true))
    .then(ordinarySelected(1, "complete")).then(sent(1)).then(success(1, "no-transaction")).expect(s.requests.get(1).response == "200" and invariant)
  run ordinaryMatchTakesPriorityOverPrivateFallbackTest = init.then(configure("both", "prepared", "prepared", true, true))
    .then(ordinarySelected(1, "complete")).then(sent(1)).then(success(1, "no-transaction"))
    .expect(s.requests.get(1).dispatchScope == 1 and s.audits == Set() and invariant)
  run privateReadRequiresReporterOwnershipTest = init.then(configure("private", "unavailable", "prepared", false, true))
    .then(admitted(1, "complete")).then(ordinaryQuery(1)).then(ownerQuery(1)).then(respond(1, true))
    .expect(s.requests.get(1).response == "409-not-ready" and s.audits == Set() and invariant)
  run privateReadAndDispatchFollowCommittedAuditTest = privateSetup.then(privateSelected(1, "complete")).then(sent(1)).then(success(1, "no-transaction"))
    .expect(s.audits == Set(1) and s.requests.get(1).dispatchScope == 2 and invariant)
  run privatePrepareUsesPrivateDeploymentContextTest = privateSetup.then(privateSelected(1, "prepare")).then(sentWithContext(1)).then(success(1, "transaction"))
    .expect(s.requests.get(1).dispatchScope == 2 and s.requests.get(1).replyContext and invariant)
  run auditReplyFailureKeepsAuditAndSkipsPrivateReadTest = privateSetup.then(admitted(1, "complete")).then(ordinaryQuery(1)).then(ownerQuery(1))
    .then(commitAudit(1)).then(auditReply(1, false)).then(respond(1, true))
    .expect(s.audits == Set(1) and s.requests.get(1).response == "503-unavailable" and s.requests.get(1).scope == 0 and invariant)
  run privateNotReadyStillRetainsReadAuditTest = init.then(configure("private", "unavailable", "unavailable", true, true))
    .then(privateSelected(1, "complete")).then(respond(1, true)).expect(s.audits == Set(1) and s.requests.get(1).response == "409-not-ready" and invariant)
  run missingPrivateServiceNeverFallsBackToOrdinaryTest = init.then(configure("ordinary-private-unavailable", "unavailable", "prepared", true, true))
    .then(privateSelected(1, "complete")).then(contextGate(1)).then(selectedService(1)).then(respond(1, true))
    .expect(s.requests.get(1).response == "503-attester" and not(s.requests.get(1).dispatched) and invariant)
  run missingResolverReturnsPrepareWithoutContextTest = init.then(configure("ordinary", "prepared", "unavailable", false, false))
    .then(ordinarySelected(1, "prepare")).then(sent(1)).then(success(1, "transaction"))
    .expect(s.requests.get(1).replyTransaction and not(s.requests.get(1).replyContext) and invariant)
  run duplicateDeploymentRefusesBeforeServiceTest = ordinary.then(ordinarySelected(1, "prepare")).then(contextGate(1))
    .then(contextReply(1, "duplicate")).then(respond(1, true))
    .expect(s.requests.get(1).response == "503-deployment" and not(s.requests.get(1).dispatched) and invariant)
  run deploymentResolverErrorReturnsUnavailableTest = ordinary.then(ordinarySelected(1, "prepare")).then(contextGate(1))
    .then(contextReply(1, "error")).then(respond(1, true)).expect(s.requests.get(1).response == "503-unavailable" and invariant)
  run capturedClaimSurvivesLaterReplacementTest = ordinary.then(ordinarySelected(1, "prepare")).then(replaceClaim).then(sentWithContext(1))
    .then(success(1, "transaction")).expect(s.claim == 2 and s.requests.get(1).dispatchClaim == 1 and s.requests.get(1).contextClaim == 1 and invariant)
  run laterRequestObservesReplacementClaimTest = ordinary.then(ordinarySelected(1, "complete")).then(replaceClaim)
    .then(ordinarySelected(2, "complete")).then(sent(2)).then(success(2, "no-transaction"))
    .expect(s.requests.get(1).claim == 1 and s.requests.get(2).dispatchClaim == 2 and invariant)
  run closingAttemptAfterSelectionDoesNotRewriteRequestTest = ordinary.then(ordinarySelected(1, "complete")).then(closeAttempt(1))
    .then(sent(1)).then(fetchReply(1, "non-ok")).then(respond(1, true))
    .expect(s.requests.get(1).dispatchAttempt == 11 and s.requests.get(1).response == "409-attester" and invariant)
  run nonOkServiceResponseMapsTo409Test = ordinary.then(ordinarySelected(1, "complete")).then(sent(1)).then(fetchReply(1, "non-ok"))
    .then(respond(1, true)).expect(s.requests.get(1).response == "409-attester" and invariant)
  run thrownFetchCanStillHaveCommittedRemoteEffectTest = ordinary.then(ordinarySelected(1, "complete")).then(sent(1))
    .then(fetchReply(1, "throw")).then(respond(1, true)).then(serviceEffect(1))
    .expect(s.requests.get(1).response == "503-unavailable" and s.effects == Set(1) and invariant)
  run invalidJsonDoesNotUndoRemoteEffectTest = ordinary.then(ordinarySelected(1, "complete")).then(sent(1)).then(serviceEffect(1))
    .then(fetchReply(1, "ok")).then(responseJson(1, "invalid-json")).then(respond(1, true))
    .expect(s.requests.get(1).response == "503-unavailable" and s.effects == Set(1) and invariant)
  run malformedOptionalTransactionRefusesEvenOnCompleteTest = ordinary.then(ordinarySelected(1, "complete")).then(sent(1))
    .then(fetchReply(1, "ok")).then(responseJson(1, "bad-transaction")).then(respond(1, true))
    .expect(s.requests.get(1).response == "503-unavailable" and invariant)
  run stringOnlyIdValidationAcceptsEmptyStringTest = ordinary.then(ordinarySelected(1, "complete")).then(sent(1)).then(success(1, "empty-id"))
    .expect(s.requests.get(1).response == "200" and s.requests.get(1).emptyId and invariant)
  run lostSuccessReplyPreservesRemoteEffectTest = ordinary.then(ordinarySelected(1, "complete")).then(sent(1)).then(serviceEffect(1))
    .then(fetchReply(1, "ok")).then(responseJson(1, "no-transaction")).then(respond(1, false))
    .expect(s.requests.get(1).response == "lost" and s.effects == Set(1) and invariant)
  run auditUsesCapturedTimeAcrossAwaitTest = privateSetup.then(admitted(1, "complete")).then(ordinaryQuery(1)).then(ownerQuery(1)).then(advance)
    .then(commitAudit(1)).then(auditReply(1, true)).then(privateQuery(1)).then(sent(1)).then(success(1, "no-transaction"))
    .expect(s.now == 1 and s.auditStamps.get(1) == 0 and invariant)
  run explicitPrivateRetryAppendsAnotherAuditTest = privateSetup.then(privateSelected(1, "complete")).then(sent(1)).then(fetchReply(1, "throw"))
    .then(respond(1, true)).then(advance).then(privateSelected(2, "complete")).then(sent(2)).then(success(2, "no-transaction"))
    .expect(s.audits == Set(1, 2) and s.auditStamps.get(1) == 0 and s.auditStamps.get(2) == 1 and invariant)
}
