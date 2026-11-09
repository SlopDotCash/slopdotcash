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
// The finite step uses reviewed reductions (see the comment at step and
// formal/README.md); direct actions and named scenarios keep full behavior.
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
  val startState = { configured: false, now: 0, claim: 1, profile: "none",
    deployments: false, owned: false, ledger: scopes.mapBy(_ => "unavailable"),
    audits: Set(), auditStamps: ids.mapBy(_ => -1), effects: Set(), requests: ids.mapBy(_ => idle) }
  action init = s' = startState
  // Quint cannot translate init when another action also reuses it (QNT409).
  // Reusable setup actions start from initState, which sets the same state.
  action initState = s' = startState
  def ending(request: Request, result: str): Request = request.with("phase", "response").with("desired", result)
  // Projection used only by step (project=true). Requests are one-shot, so a
  // done request is terminal. No guard or update reads its response, emptyId
  // or error text; the invariant reads its desired status only through
  // desired == "200" and its stamp only when audited. Those fields are written
  // as fixed representatives. The response phase is read only by respond,
  // whose projected successor depends on nothing else, and the invariant has
  // the same value there as in that successor; a projected ending therefore
  // moves directly to that done state.
  def finished(request: Request): Request = request.with("phase", "done").with("response", "none")
    .with("emptyId", false).with("desired", if (request.desired == "200") "200" else "error")
    .with("stamp", if (request.audited) request.stamp else -1)
  def endingWith(request: Request, result: str, project: bool): Request =
    if (project) finished(ending(request, result)) else ending(request, result)
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
  action origin(id: int, allowed: bool): bool = originWith(id, allowed, false)
  action originWith(id: int, allowed: bool, project: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "origin", s' = s.with("requests", s.requests.set(id,
      if (allowed) request.with("phase", "session") else endingWith(request, "403-origin", project))) }
  }
  action session(id: int, kind: str): bool = sessionWith(id, kind, false)
  action sessionWith(id: int, kind: str, project: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "session", Set("member", "missing", "expired", "error").contains(kind),
      s' = s.with("requests", s.requests.set(id,
        if (kind == "member") request.with("phase", "expected-actor")
        else endingWith(request, if (kind == "error") "503-unavailable" else if (kind == "expired") "401-expired" else "401-sign-in", project))) }
  }
  action expectedActor(id: int, kind: str): bool = expectedActorWith(id, kind, false)
  action expectedActorWith(id: int, kind: str, project: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "expected-actor", Set("absent", "matching", "invalid", "changed").contains(kind),
      s' = s.with("requests", s.requests.set(id,
        if (Set("absent", "matching").contains(kind)) request.with("phase", "body").with("admitted", true)
        else endingWith(request, if (kind == "invalid") "400-actor" else "403-actor", project))) }
  }
  action body(id: int, kind: str): bool = bodyWith(id, kind, false)
  action bodyWith(id: int, kind: str, project: bool): bool = {
    val request = s.requests.get(id)
    val invalid = Set("bad-json", "bad-id").contains(kind)
      or (request.mode == "complete" and Set("no-transaction", "large-transaction", "bad-transaction").contains(kind))
    all { request.phase == "body", inputClasses.contains(kind),
      s' = s.with("requests", s.requests.set(id,
        if (invalid) endingWith(request, "400-input", project) else request.with("phase", "services"))) }
  }
  action serviceGate(id: int): bool = serviceGateWith(id, false)
  action serviceGateWith(id: int, project: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "services", s' = s.with("requests", s.requests.set(id,
      if (ordinaryService(s.profile) or privateConfigured(s.profile)) request.with("phase", "ordinary-query")
      else endingWith(request, "503-attester", project))) }
  }
  action ordinaryQuery(id: int): bool = ordinaryQueryWith(id, false)
  action ordinaryQueryWith(id: int, project: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "ordinary-query", s' = s.with("requests", s.requests.set(id,
      if (selectable(1)) selected(request, 1)
      else if (privateConfigured(s.profile)) request.with("phase", "owner-query")
      else endingWith(request, "409-not-ready", project))) }
  }
  action ownerQuery(id: int): bool = ownerQueryWith(id, false)
  action ownerQueryWith(id: int, project: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "owner-query", s' = s.with("requests", s.requests.set(id,
      if (s.owned) request.with("phase", "audit-write").with("owner", true)
      else endingWith(request, "409-not-ready", project))) }
  }
  action commitAudit(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "audit-write",
      s' = s.with("audits", s.audits.union(Set(id))).with("auditStamps", s.auditStamps.set(id, request.stamp))
        .with("requests", s.requests.set(id, request.with("phase", "audit-reply").with("audited", true))) }
  }
  action auditReply(id: int, received: bool): bool = auditReplyWith(id, received, false)
  action auditReplyWith(id: int, received: bool, project: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "audit-reply", s' = s.with("requests", s.requests.set(id,
      if (received) request.with("phase", "private-query") else endingWith(request, "503-unavailable", project))) }
  }
  action privateQuery(id: int): bool = privateQueryWith(id, false)
  action privateQueryWith(id: int, project: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "private-query", s' = s.with("requests", s.requests.set(id,
      if (selectable(2)) selected(request, 2) else endingWith(request, "409-not-ready", project))) }
  }
  action contextGate(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "context", s' = s.with("requests", s.requests.set(id,
      request.with("phase", if (request.mode == "prepare" and s.deployments) "context-query" else "selected-service"))) }
  }
  action contextReply(id: int, kind: str): bool = contextReplyWith(id, kind, false)
  action contextReplyWith(id: int, kind: str, project: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "context-query", Set("matching", "missing", "duplicate", "missing-fields", "error").contains(kind),
      s' = s.with("requests", s.requests.set(id,
        if (kind == "matching") request.with("phase", "selected-service").with("context", true).with("contextClaim", request.claim)
        else endingWith(request, if (kind == "error") "503-unavailable" else "503-deployment", project))) }
  }
  action selectedService(id: int): bool = selectedServiceWith(id, false)
  action selectedServiceWith(id: int, project: bool): bool = {
    val request = s.requests.get(id)
    val available = if (request.scope == 1) ordinaryService(s.profile) else privateService(s.profile)
    all { request.phase == "selected-service", s' = s.with("requests", s.requests.set(id,
      if (available) request.with("phase", "dispatch") else endingWith(request, "503-attester", project))) }
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
  action fetchReply(id: int, kind: str): bool = fetchReplyWith(id, kind, false)
  action fetchReplyWith(id: int, kind: str, project: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "inflight", Set("ok", "non-ok", "throw").contains(kind),
      s' = s.with("requests", s.requests.set(id,
        if (kind == "ok") request.with("phase", "json")
        else endingWith(request, if (kind == "non-ok") "409-attester" else "503-unavailable", project))) }
  }
  action responseJson(id: int, kind: str): bool = responseJsonWith(id, kind, false)
  action responseJsonWith(id: int, kind: str, project: bool): bool = {
    val request = s.requests.get(id)
    val accepted = Set("no-transaction", "transaction", "empty-id").contains(kind)
    all { request.phase == "json", envelopes.contains(kind),
      s' = s.with("requests", s.requests.set(id,
        if (not(accepted)) endingWith(request, "503-unavailable", project)
        else endingWith(request.with("emptyId", kind == "empty-id")
          .with("replyTransaction", request.mode == "prepare" and kind == "transaction")
          .with("replyContext", request.mode == "prepare" and request.context), "200", project))) }
  }
  action lookupFailure(id: int): bool = lookupFailureWith(id, false)
  action lookupFailureWith(id: int, project: bool): bool = {
    val request = s.requests.get(id)
    all { Set("ordinary-query", "owner-query", "audit-write", "private-query").contains(request.phase),
      s' = s.with("requests", s.requests.set(id, endingWith(request, "503-unavailable", project))) }
  }
  action respond(id: int, received: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "response", s' = s.with("requests", s.requests.set(id,
      request.with("phase", "done").with("response", if (received) request.desired else "lost"))) }
  }
  // Finite step reductions (direct actions and scenarios are unchanged):
  // - Small shared choices stay hoisted; each larger choice is bound only by
  //   the action that reads it, after a guard the action itself requires. TLC
  //   no longer evaluates every action for the full product of unrelated
  //   choices, and the simulator does not retry them for a disabled action.
  // - Ledger rows are read only through selectable, which distinguishes only
  //   "unavailable"; configure therefore uses "prepared" to represent the three
  //   selectable states. A row, owned or deployments value is fixed when the
  //   profile makes its only reader unreachable: ordinaryQuery, contextGate and
  //   ledger row 1 need a profile that passes serviceGate, and ownerQuery and
  //   ledger row 2 need a configured private service.
  // - now is read only by begin; claim and ledger only by ordinaryQuery and
  //   privateQuery (and closeAttempt's own guard). The invariant only checks
  //   their ranges. Once no request can still perform those reads, a change is
  //   unobservable, so step offers advance only while a request is unused and
  //   replaceClaim and closeAttempt only while one has not yet been selected.
  // - Ending requests are written through the projection at finished; the
  //   response phase and respond are therefore unused in step.
  // - Local actions first. In a local phase every enabled action of that
  //   request reads only fixed configuration and that request's own fields,
  //   audit, stamp and effect entries, and writes only those; serviceEffect
  //   after dispatch is the same. Such an action commutes with every action of
  //   the other request and of the environment, and no other action can
  //   disable it. Every invariant conjunct reads one request's own data or a
  //   global range that local actions do not change. When some request has a
  //   local action, step therefore takes only the local actions of the lowest
  //   such request (an ample set). Each request still reaches every own state
  //   of the full model, and non-local reads (begin, ordinaryQuery and
  //   privateQuery) still interleave with every environment change.
  val unselected = Set("unused", "origin", "session", "expected-actor", "body", "services",
    "ordinary-query", "owner-query", "audit-write", "audit-reply", "private-query")
  val clockLive = ids.exists(id => s.requests.get(id).phase == "unused")
  val selectionLive = ids.exists(id => unselected.contains(s.requests.get(id).phase))
  val localPhases = Set("origin", "session", "expected-actor", "body", "services", "owner-query", "audit-write",
    "audit-reply", "context", "context-query", "selected-service", "dispatch", "inflight", "json")
  def localReady(id: int): bool = localPhases.contains(s.requests.get(id).phase)
    or (s.requests.get(id).dispatched and not(s.effects.contains(id)))
  val focus = if (localReady(1)) 1 else if (localReady(2)) 2 else 0
  action step = {
    nondet id = ids.oneOf()
    nondet scope = scopes.oneOf()
    nondet mode = modes.oneOf()
    nondet a = Set(false, true).oneOf()
    any {
      all { not(s.configured), {
        nondet profile = profiles.oneOf()
        nondet first = Set("prepared", "unavailable").oneOf()
        nondet second = Set("prepared", "unavailable").oneOf()
        nondet b = Set(false, true).oneOf()
        val served = ordinaryService(profile) or privateConfigured(profile)
        val owner = privateConfigured(profile)
        configure(profile, if (served) first else "unavailable", if (owner) second else "unavailable",
          owner and a, served and b) } },
      all { focus == 0, clockLive, advance }, all { focus == 0, selectionLive, replaceClaim },
      all { focus == 0, selectionLive, closeAttempt(scope) }, all { focus == 0, begin(id, mode) },
      all { focus == 0, ordinaryQueryWith(id, true) }, all { focus == 0, privateQueryWith(id, true) },
      all { focus == 0 or focus == id, local(id, a) }, s' = s }
  }
  // The actions of one request in a local phase (and its pending service effect).
  action local(id: int, a: bool): bool = {
    val phase = s.requests.get(id).phase
    any {
      originWith(id, a, true),
      all { phase == "session", { nondet sessionClass = Set("member", "missing", "expired", "error").oneOf()
        sessionWith(id, sessionClass, true) } },
      all { phase == "expected-actor", { nondet expected = Set("absent", "matching", "invalid", "changed").oneOf()
        expectedActorWith(id, expected, true) } },
      all { phase == "body", { nondet input = inputClasses.oneOf() bodyWith(id, input, true) } },
      serviceGateWith(id, true), ownerQueryWith(id, true), commitAudit(id), auditReplyWith(id, a, true), contextGate(id),
      all { phase == "context-query", {
        nondet context = Set("matching", "missing", "duplicate", "missing-fields", "error").oneOf()
        contextReplyWith(id, context, true) } },
      selectedServiceWith(id, true), dispatch(id), serviceEffect(id),
      all { phase == "inflight", { nondet fetch = Set("ok", "non-ok", "throw").oneOf() fetchReplyWith(id, fetch, true) } },
      all { phase == "json", { nondet envelope = envelopes.oneOf() responseJsonWith(id, envelope, true) } },
      lookupFailureWith(id, true) }
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
  action ordinary = initState.then(configure("ordinary", "prepared", "unavailable", false, true))
  action privateSetup = initState.then(configure("private", "unavailable", "prepared", true, true))
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
