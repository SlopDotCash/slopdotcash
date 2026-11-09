// @source backend/projects/handler.ts
// @source backend/projects/edge-cache.ts
// @source backend/http.ts
// @source backend/projects/github-lookup.ts
// @source src/lib/project-proposal.ts
// @evidence scripts/project-registry-api.test.ts
// @evidence scripts/project-application-github-check.test.ts
// @evidence tests/e2e/project-proposal.spec.ts
// Two request slots, each with one retry after its prior cache put settles;
// two authenticated actors, two canonical repository paths, one origin and
// two public-data/login versions. Four cache entries represent owned lists
// keyed by actor ID and repository facts keyed by lowercased path in the
// repository-node-v1 namespace. A separate two-entry legacy cache represents
// old REST/name-based bytes, including a late put by the prior deployment;
// the current reader never selects those keys. Owned-list keys do not change.
// Query and path-case variants intentionally share a key. TTL expiry is an
// explicit removal action, not a wall-clock/HTTP-cache implementation proof.
// GET session is separate: it returns200/null without requireActor. Known
// lookup routes authenticate and validate an optional expected actor BEFORE
// cache access. Unmatched project routes return404 without a session read;
// non-GET project requests first require same-origin JSON transport.
// Successful current-generation cache bytes are public GitHub facts, never
// project authority. Public reads use the configured public-only credential;
// there is no Slopbot installation-token fallback. Actual credential scope is
// a deployment assumption. Older cache bytes need not satisfy the current
// immutable-node identity checks and cannot bypass them on a current miss.
// The client policy is private,max-age=300; stored edge copies retain public
// s-maxage=300. The current browser client explicitly uses cache:no-store.
// The session gates spending, not a continuous account observation. Owned
// misses resolve the captured immutable actor ID, then use its returned login
// for the repository-list request; no atomic GitHub snapshot is asserted.
// subject labels the captured actor's cache partition; it is not a fresh
// ownership proof for every listed repository after a concurrent GitHub change.
// Provider identity/JSON/branch/license/page predicates are delegated to the
// github-lookup model. Provider errors retain their status; generic throws are
// 500. A missing owned actor becomes502, a missing repository remains404.
// providerReads counts abstract reader completions, not individual HTTP calls;
// missing-credential validation before HTTP belongs to the lookup model.
// One moderator-selected account is modeled only through the pre-enforcement
// prefix: role check, lookup and optional expected-ID comparison. The later
// recordEnforcement call, multi-account deduplication and writes are excluded.
// No in-flight lookup coalescing exists; a later completion may overwrite a
// newer public cache snapshot. Failed cache reads fall back; failed puts do
// not fail a response. waitUntil may let a put settle after response delivery.
// No tests, parser, checker or provider request ran for these definitions.
module api_project_lookup_routes {
  val ids = Set(1, 2)
  val keyIds = Set(1, 2, 3, 4)
  val routes = Set("owned", "repository", "session", "actor-selection", "unknown")
  val outcomes = Set("found", "missing", "organization", "unavailable", "limited", "throw")
  type Entry = { version: int, subject: int }
  type Request = { phase: str, attempt: int, route: str, method: str,
    transport: bool, expected: int, actor: int, loginValid: bool, repository: int,
    key: int, cacheEnabled: bool, waitUntil: bool, putPending: bool,
    providerReads: int, login: int, payload: int, subject: int, selected: int,
    selectedExpected: int, status: int, policy: str, hit: bool, delivered: bool }
  val empty: Entry = { version: 0, subject: 0 }
  val idle: Request = { phase: "unused", attempt: 0, route: "owned", method: "GET",
    transport: true, expected: 0, actor: 0, loginValid: true, repository: 1,
    key: 0, cacheEnabled: true, waitUntil: false, putPending: false,
    providerReads: 0, login: 0, payload: 0, subject: 0, selected: 0,
    selectedExpected: 0, status: 0, policy: "none", hit: false, delivered: false }
  var s: { session: int, loginVersion: int -> int, dataVersion: int,
    admins: Set[int], moderators: Set[int], requests: int -> Request,
    cache: int -> Entry, legacyCache: int -> Entry }
  action init = s' = { session: 1, loginVersion: ids.mapBy(_ => 1), dataVersion: 1,
    admins: Set(1), moderators: Set(1), requests: ids.mapBy(_ => idle),
    cache: keyIds.mapBy(_ => empty), legacyCache: ids.mapBy(_ => empty) }
  def reply(request: Request, status: int): Request = request.with("phase", "response")
    .with("status", status).with("policy", if (status == 200 and Set("owned", "repository").contains(request.route)) "private-300" else "no-store")
  def errorStatus(outcome: str): int = if (outcome == "organization") 422
    else if (outcome == "limited") 503 else if (outcome == "throw") 500 else 502
  action switchSession(actor: int): bool = all { Set(0, 1, 2).contains(actor), s' = s.with("session", actor) }
  action rename(actor: int): bool = all { ids.contains(actor), s.loginVersion.get(actor) == 1,
    s' = s.with("loginVersion", s.loginVersion.set(actor, 2)) }
  action changeData = all { s.dataVersion == 1, s' = s.with("dataVersion", 2) }
  action revokeModerator(actor: int): bool = all { ids.contains(actor), s' = s.with("moderators", s.moderators.exclude(Set(actor))) }
  action expire(key: int): bool = all { keyIds.contains(key), s' = s.with("cache", s.cache.set(key, empty)) }
  // Environment: bytes from the old deployment remain under the old key.
  // This is not a write performed by the current githubLookup function.
  action legacyPut(repository: int, version: int): bool = all {
    ids.contains(repository), ids.contains(version),
    s' = s.with("legacyCache", s.legacyCache.set(repository, { version: version, subject: 0 })) }
  // expected0=absent,1/2=the named actor,3=malformed header. Repository0 is a
  // syntactically invalid but route-shaped owner/name; valid paths are1/2.
  action begin(id: int, route: str, method: str, expected: int, repository: int, transport: bool, cached: bool, wait: bool): bool = {
    val previous = s.requests.get(id)
    all { ids.contains(id), routes.contains(route), Set("GET", "POST", "HEAD").contains(method),
      Set(0, 1, 2, 3).contains(expected), Set(0, 1, 2).contains(repository),
      Set("unused", "done").contains(previous.phase), previous.attempt < 2, not(previous.putPending),
      s' = s.with("requests", s.requests.set(id, idle.with("phase", "dispatch").with("attempt", previous.attempt + 1)
        .with("route", route).with("method", method).with("expected", expected).with("repository", repository)
        .with("transport", transport).with("cacheEnabled", cached).with("waitUntil", wait))) }
  }
  action dispatch(id: int): bool = {
    val request = s.requests.get(id)
    val matched = if (request.route == "actor-selection") request.method == "POST"
      else request.method == "GET" and request.route != "unknown"
    all { request.phase == "dispatch", s' = s.with("requests", s.requests.set(id,
      if (request.method != "GET" and not(request.transport)) reply(request, 403)
      else if (not(matched)) reply(request, 404) else request.with("phase", "session"))) }
  }
  action session(id: int, readable: bool, loginValid: bool): bool = {
    val request = s.requests.get(id)
    val captured = request.with("actor", s.session).with("loginValid", loginValid)
    val key = if (request.route == "owned") s.session else if (request.repository == 0) 0 else request.repository + 2
    all { request.phase == "session", s' = s.with("requests", s.requests.set(id,
      if (not(readable)) reply(captured, 500)
      else if (request.route == "session") reply(captured, 200)
      else if (s.session == 0) reply(captured, 401)
      else if (request.expected == 3) reply(captured, 400)
      else if (request.expected != 0 and request.expected != s.session) reply(captured, 403)
      else if (request.route == "actor-selection" and (not(s.admins.contains(s.session)) or not(s.moderators.contains(s.session)))) reply(captured, 403)
      else captured.with("key", key).with("phase", if (request.route == "actor-selection") "selection-input" else "cache"))) }
  }
  action cacheRead(id: int, result: str): bool = {
    val request = s.requests.get(id)
    val entry = if (keyIds.contains(request.key)) s.cache.get(request.key) else empty
    all { request.phase == "cache", Set("hit", "miss", "error").contains(result),
      result == "hit" implies request.cacheEnabled and entry.version > 0,
      s' = s.with("requests", s.requests.set(id,
        if (result == "hit") reply(request.with("payload", entry.version).with("subject", entry.subject).with("hit", true), 200)
        else request.with("phase", "validate"))) }
  }
  action validate(id: int): bool = {
    val request = s.requests.get(id)
    val valid = if (request.route == "owned") request.loginValid else request.repository != 0
    all { request.phase == "validate", s' = s.with("requests", s.requests.set(id,
      if (not(valid)) reply(request, 400) else request.with("phase", if (request.route == "owned") "actor" else "repository"))) }
  }
  action actorReply(id: int, outcome: str): bool = {
    val request = s.requests.get(id)
    val name = if (ids.contains(request.actor)) s.loginVersion.get(request.actor) else 0
    all { request.phase == "actor", outcomes.contains(outcome),
      s' = s.with("requests", s.requests.set(id, (if (outcome == "found") request.with("phase", "owned-list").with("login", name)
        else reply(request, if (outcome == "missing") 502 else errorStatus(outcome)))
        .with("providerReads", request.providerReads + 1))) }
  }
  action dataReply(id: int, outcome: str): bool = {
    val request = s.requests.get(id)
    val found = request.with("payload", s.dataVersion).with("subject", if (request.route == "owned") request.actor else 0)
    all { Set("owned-list", "repository").contains(request.phase),
      Set("found", "missing", "unavailable", "limited", "throw").contains(outcome),
      s' = s.with("requests", s.requests.set(id,
        (if (outcome == "found") (if (request.cacheEnabled) found.with("phase", "buffer") else reply(found, 200))
        else reply(request, if (outcome == "missing" and request.route == "repository") 404 else errorStatus(outcome)))
        .with("providerReads", request.providerReads + 1))) }
  }
  action buffer(id: int, readable: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "buffer", s' = s.with("requests", s.requests.set(id,
      if (not(readable)) reply(request, 500) else reply(request, 200).with("putPending", request.cacheEnabled))) }
  }
  action putRecord(id: int, succeeds: bool): bool = {
    val request = s.requests.get(id)
    all { request.putPending, keyIds.contains(request.key),
      s' = s.with("cache", if (succeeds) s.cache.set(request.key, { version: request.payload, subject: request.subject }) else s.cache)
        .with("requests", s.requests.set(id, request.with("putPending", false))) }
  }
  action selectionInput(id: int, expected: int, valid: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "selection-input", Set(0, 1, 2).contains(expected),
      s' = s.with("requests", s.requests.set(id, if (not(valid)) reply(request, 400)
        else request.with("phase", "selection-actor").with("selectedExpected", expected))) }
  }
  action selectionReply(id: int, outcome: str, actor: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "selection-actor", outcomes.contains(outcome), ids.contains(actor),
      s' = s.with("requests", s.requests.set(id,
        (if (outcome == "missing" or (outcome == "found" and request.selectedExpected != 0 and request.selectedExpected != actor)) reply(request, 409)
        else if (outcome != "found") reply(request, errorStatus(outcome))
        else request.with("phase", "enforcement-handoff").with("selected", actor))
        .with("providerReads", request.providerReads + 1))) }
  }
  action respond(id: int, delivered: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "response", request.waitUntil or not(request.putPending),
      s' = s.with("requests", s.requests.set(id, request.with("phase", "done").with("delivered", delivered))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet route = routes.oneOf()
    nondet method = Set("GET", "POST", "HEAD").oneOf()
    nondet expected = Set(0, 1, 2, 3).oneOf()
    nondet repository = Set(0, 1, 2).oneOf()
    nondet actor = Set(0, 1, 2).oneOf()
    nondet key = keyIds.oneOf()
    nondet result = Set("hit", "miss", "error").oneOf()
    nondet outcome = outcomes.oneOf()
    nondet yes = Set(false, true).oneOf()
    any { switchSession(actor), rename(id), changeData, revokeModerator(id), expire(key), legacyPut(id, repository),
      begin(id, route, method, expected, repository, yes, yes, yes), dispatch(id), session(id, yes, yes), cacheRead(id, result),
      validate(id), actorReply(id, outcome), dataReply(id, outcome), buffer(id, yes), putRecord(id, yes), selectionInput(id, repository, yes),
      selectionReply(id, outcome, id), respond(id, yes), s' = s }
  }
  val invariant = ids.forall(id => {
    val request = s.requests.get(id)
    all { request.attempt <= 2,
      request.hit implies request.actor != 0 and request.providerReads == 0 and request.status == 200,
      request.route == "owned" and request.status == 200 implies request.subject == request.actor and request.actor != 0,
      request.putPending implies request.status == 200 and request.payload > 0,
      request.status == 200 and Set("owned", "repository").contains(request.route) implies request.policy == "private-300",
      request.phase == "enforcement-handoff" implies request.selected != 0 and request.providerReads == 1,
      Set(400, 401, 403, 404, 422, 500, 502, 503).contains(request.status) implies not(request.putPending) }
  })
  action start(id: int, route: str): bool = begin(id, route, "GET", 0, 1, true, true, false).then(dispatch(id)).then(session(id, true, true))
  action miss(id: int, route: str): bool = start(id, route).then(cacheRead(id, "miss")).then(validate(id))
  action repository(id: int): bool = miss(id, "repository").then(dataReply(id, "found")).then(buffer(id, true))
  action owned(id: int): bool = miss(id, "owned").then(actorReply(id, "found")).then(dataReply(id, "found")).then(buffer(id, true))

  run signedOutLookupNeverReadsCacheTest = init.then(switchSession(0)).then(start(1, "owned"))
    .expect(s.requests.get(1).status == 401 and s.requests.get(1).providerReads == 0)
  run signedOutSessionStatusIs200NullTest = init.then(switchSession(0)).then(start(1, "session"))
    .expect(s.requests.get(1).status == 200 and s.requests.get(1).actor == 0 and invariant)
  run expectedActorMismatchPrecedesCacheTest = init.then(begin(1, "repository", "GET", 2, 1, true, true, false))
    .then(dispatch(1)).then(session(1, true, true)).expect(s.requests.get(1).status == 403 and invariant)
  run malformedExpectedActorIs400Test = init.then(begin(1, "owned", "GET", 3, 1, true, true, false))
    .then(dispatch(1)).then(session(1, true, true)).expect(s.requests.get(1).status == 400 and invariant)
  run unknownProjectLookupRouteReturns404WithoutSessionTest = init.then(begin(1, "unknown", "GET", 0, 1, true, true, false)).then(dispatch(1))
    .expect(s.requests.get(1).status == 404 and s.requests.get(1).actor == 0)
  run wrongOriginWriteRefusesBeforeSessionTest = init.then(begin(1, "actor-selection", "POST", 0, 1, false, true, false)).then(dispatch(1))
    .expect(s.requests.get(1).status == 403 and s.requests.get(1).providerReads == 0)
  run repositorySuccessCachesPublicFactsAndReturnsPrivatePolicyTest = init.then(repository(1)).then(putRecord(1, true)).then(respond(1, true))
    .expect(s.cache.get(3).version == 1 and s.requests.get(1).policy == "private-300" and invariant)
  run canonicalRepositoryKeySharesFactsAcrossActorsTest = init.then(repository(1)).then(putRecord(1, true)).then(respond(1, true))
    .then(switchSession(2)).then(start(2, "repository")).then(cacheRead(2, "hit"))
    .expect(s.requests.get(2).payload == 1 and s.requests.get(2).actor == 2 and invariant)
  run ownedCacheIsPartitionedByImmutableActorTest = init.then(owned(1)).then(putRecord(1, true)).then(respond(1, true))
    .then(switchSession(2)).then(start(2, "owned")).then(cacheRead(2, "hit").fail())
  run signedOutCannotReadAnExistingPublicFactCacheTest = init.then(repository(1)).then(putRecord(1, true)).then(respond(1, true))
    .then(switchSession(0)).then(start(2, "repository")).expect(s.requests.get(2).status == 401 and invariant)
  run accountRenameUsesImmutableActorThenCurrentLoginTest = init.then(rename(1)).then(owned(1)).then(putRecord(1, false))
    .expect(s.requests.get(1).login == 2 and s.requests.get(1).subject == 1 and invariant)
  run sessionSwitchAfterCaptureDoesNotRewriteRequestTest = init.then(start(1, "owned")).then(switchSession(2))
    .then(cacheRead(1, "miss")).then(validate(1)).then(actorReply(1, "found")).then(dataReply(1, "found")).then(buffer(1, true)).then(putRecord(1, true))
    .expect(s.cache.get(1).subject == 1 and s.cache.get(2).version == 0 and invariant)
  run missingOwnedActorIsUnavailableNotEmptySuccessTest = init.then(miss(1, "owned")).then(actorReply(1, "missing"))
    .expect(s.requests.get(1).status == 502 and s.cache.get(1).version == 0 and invariant)
  run missingRepositoryIs404AndNotCachedTest = init.then(miss(1, "repository")).then(dataReply(1, "missing"))
    .expect(s.requests.get(1).status == 404 and s.cache.get(3).version == 0 and invariant)
  run providerFailureCanRetryAfterNoCacheWriteTest = init.then(miss(1, "repository")).then(dataReply(1, "limited")).then(respond(1, true))
    .then(repository(1)).then(putRecord(1, true)).then(respond(1, true)).expect(s.requests.get(1).attempt == 2 and s.requests.get(1).status == 200 and invariant)
  run cacheReadFailureFallsBackToProviderTest = init.then(start(1, "repository")).then(cacheRead(1, "error")).then(validate(1))
    .then(dataReply(1, "found")).then(buffer(1, true)).then(putRecord(1, true)).expect(s.requests.get(1).providerReads == 1 and invariant)
  run cachePutFailureKeepsSuccessfulResponseTest = init.then(repository(1)).then(putRecord(1, false)).then(respond(1, true))
    .expect(s.requests.get(1).status == 200 and s.cache.get(3).version == 0 and invariant)
  run absentCacheReturnsBuiltResponseWithoutBufferingTest = init.then(begin(1, "repository", "GET", 0, 1, true, false, false))
    .then(dispatch(1)).then(session(1, true, true)).then(cacheRead(1, "miss")).then(validate(1)).then(dataReply(1, "found"))
    .then(respond(1, true)).expect(s.requests.get(1).status == 200 and not(s.requests.get(1).putPending) and invariant)
  run synchronousCachePutMustSettleBeforeResponseTest = init.then(repository(1)).then(respond(1, true).fail())
  run backgroundCachePutCanSettleAfterResponseTest = init.then(begin(1, "repository", "GET", 0, 1, true, true, true))
    .then(dispatch(1)).then(session(1, true, true)).then(cacheRead(1, "miss")).then(validate(1)).then(dataReply(1, "found"))
    .then(buffer(1, true)).then(respond(1, false)).then(putRecord(1, true))
    .expect(not(s.requests.get(1).delivered) and s.cache.get(3).version == 1 and invariant)
  run latePublicCacheWriteCanOverwriteNewerSnapshotTest = init.then(repository(1)).then(changeData).then(repository(2)).then(putRecord(2, true)).then(putRecord(1, true))
    .expect(s.requests.get(2).payload == 2 and s.cache.get(3).version == 1 and invariant)
  run invalidRepositoryRefusesOnMissTest = init.then(begin(1, "repository", "GET", 0, 0, true, true, false))
    .then(dispatch(1)).then(session(1, true, true)).then(cacheRead(1, "miss")).then(validate(1)).expect(s.requests.get(1).status == 400 and invariant)
  run moderatorSelectionUsesExpectedImmutableIdTest = init.then(begin(1, "actor-selection", "POST", 0, 1, true, true, false))
    .then(dispatch(1)).then(session(1, true, true)).then(selectionInput(1, 1, true)).then(selectionReply(1, "found", 2))
    .expect(s.requests.get(1).status == 409 and invariant)
  run missingSelectedActorIs409Test = init.then(begin(1, "actor-selection", "POST", 0, 1, true, true, false))
    .then(dispatch(1)).then(session(1, true, true)).then(selectionInput(1, 0, true)).then(selectionReply(1, "missing", 1))
    .expect(s.requests.get(1).status == 409 and invariant)
  run organizationSelectionKeeps422Test = init.then(begin(1, "actor-selection", "POST", 0, 1, true, true, false))
    .then(dispatch(1)).then(session(1, true, true)).then(selectionInput(1, 0, true)).then(selectionReply(1, "organization", 1))
    .expect(s.requests.get(1).status == 422 and invariant)
  run knownSelectionHandsOffWithoutInventingAnEnforcementResultTest = init.then(begin(1, "actor-selection", "POST", 0, 1, true, true, false))
    .then(dispatch(1)).then(session(1, true, true)).then(selectionInput(1, 1, true)).then(revokeModerator(1)).then(selectionReply(1, "found", 1))
    .expect(s.requests.get(1).phase == "enforcement-handoff" and s.requests.get(1).status == 0 and invariant)
  run legacyRepositoryCacheCannotHitCurrentNamespaceTest = init.then(legacyPut(1, 1))
    .then(start(1, "repository")).then(cacheRead(1, "hit").fail())
  run currentRepositoryReadIgnoresLegacyBytesAndLateLegacyPutTest = init.then(legacyPut(1, 1)).then(changeData)
    .then(repository(1)).then(putRecord(1, true)).then(respond(1, true)).then(legacyPut(1, 1))
    .then(start(2, "repository")).then(cacheRead(2, "hit"))
    .expect(s.legacyCache.get(1).version == 1 and s.cache.get(3).version == 2
      and s.requests.get(1).providerReads == 1 and s.requests.get(2).payload == 2 and invariant)
}
