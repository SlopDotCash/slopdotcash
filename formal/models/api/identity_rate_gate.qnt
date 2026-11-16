// @source workers/identity/index.ts
// @source workers/identity/rate-limit.ts
// Two gate invocations, the four exact route names plus a bypass class, and
// two named principal classes plus the shared unattributed principal. Matching
// HTTPS origin/method and principal extraction are predicates, not parsers.
// Numeric key classes assume distinct digest inputs do not collide. No secret,
// IP address, actual hash, edge implementation or OAuth success is modeled.
module identity_rate_gate {
  val ids = Set(1, 2)
  val endpoints = Set("oauth-start", "local-start", "oauth-poll", "local-poll", "other")
  def scope(endpoint: str): int = if (Set("oauth-start", "local-start").contains(endpoint)) 1
    else if (Set("oauth-poll", "local-poll").contains(endpoint)) 2 else 0
  def counterKey(endpoint: str, principal: int): int = scope(endpoint) * 3 + principal
  type Invocation = { phase: str, endpoint: str, principal: int, key: int,
    edgeCalls: int, exactCalls: int, edgePassed: bool, clockCaptured: bool, hashOk: bool,
    quotaCommitted: bool, gateResult: str, forwarded: bool, coreResult: str }
  val unused: Invocation = { phase: "unused", endpoint: "other", principal: 0, key: 0,
    edgeCalls: 0, exactCalls: 0, edgePassed: false, clockCaptured: false, hashOk: false,
    quotaCommitted: false, gateResult: "none", forwarded: false, coreResult: "none" }
  var calls: int -> Invocation
  action init = calls' = ids.mapBy(_ => unused)
  action route(id: int, endpoint: str, configuredHttpsPost: bool, principal: int): bool = {
    val limited = configuredHttpsPost and scope(endpoint) != 0
    all { ids.contains(id), calls.get(id).phase == "unused", endpoints.contains(endpoint),
      principal >= 0, principal <= 2,
      calls' = calls.set(id, unused.with("phase", if (limited) "edge" else "core")
        .with("endpoint", endpoint).with("principal", principal)
        .with("key", if (limited) counterKey(endpoint, principal) else 0)
        .with("edgeCalls", if (limited) 1 else 0)
        .with("gateResult", if (limited) "none" else "bypass").with("forwarded", not(limited))) }
  }
  action edge(id: int, outcome: str): bool = {
    val call = calls.get(id)
    all { ids.contains(id), call.phase == "edge", Set("pass", "deny", "error").contains(outcome),
      calls' = calls.set(id, call.with("phase", if (outcome == "pass") "clock" else "done")
        .with("edgePassed", outcome == "pass")
        .with("gateResult", if (outcome == "pass") "none" else if (outcome == "deny") "429" else "503")) }
  }
  action captureClock(id: int, ok: bool): bool = {
    val call = calls.get(id)
    all { ids.contains(id), call.phase == "clock",
      calls' = calls.set(id, call.with("phase", if (ok) "hash" else "done")
        .with("clockCaptured", ok).with("gateResult", if (ok) "none" else "503")) }
  }
  action hash(id: int, ok: bool): bool = {
    val call = calls.get(id)
    all { ids.contains(id), call.phase == "hash",
      calls' = calls.set(id, call.with("phase", if (ok) "exact" else "done")
        .with("hashOk", ok).with("exactCalls", if (ok) 1 else 0)
        .with("gateResult", if (ok) "none" else "503")) }
  }
  action exactReply(id: int, outcome: str): bool = {
    val call = calls.get(id)
    all { ids.contains(id), call.phase == "exact",
      Set("allowed", "limited", "precommit-error", "postcommit-error").contains(outcome),
      calls' = calls.set(id, call.with("phase", if (outcome == "allowed") "core" else "done")
        .with("quotaCommitted", outcome != "precommit-error")
        .with("gateResult", if (outcome == "allowed") "allowed" else if (outcome == "limited") "429" else "503")
        .with("forwarded", outcome == "allowed")) }
  }
  action coreReply(id: int, successful: bool): bool = {
    val call = calls.get(id)
    all { ids.contains(id), call.phase == "core",
      calls' = calls.set(id, call.with("phase", "done")
        .with("coreResult", if (successful) "success" else "rejected")) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet endpoint = endpoints.oneOf()
    nondet principal = Set(0, 1, 2).oneOf()
    nondet ok = Set(false, true).oneOf()
    nondet edgeOutcome = Set("pass", "deny", "error").oneOf()
    nondet exactOutcome = Set("allowed", "limited", "precommit-error", "postcommit-error").oneOf()
    any { route(id, endpoint, ok, principal), edge(id, edgeOutcome), captureClock(id, ok), hash(id, ok),
      exactReply(id, exactOutcome), coreReply(id, ok), calls' = calls }
  }
  val invariant = ids.forall(id => {
    val call = calls.get(id)
    all {
      call.edgeCalls <= 1, call.exactCalls <= 1,
      call.exactCalls == 1 implies call.edgePassed and call.clockCaptured and call.hashOk,
      call.forwarded implies Set("allowed", "bypass").contains(call.gateResult),
      Set("429", "503").contains(call.gateResult) implies not(call.forwarded),
      call.quotaCommitted implies call.exactCalls == 1,
      call.gateResult == "bypass" implies call.exactCalls == 0 and call.edgeCalls == 0 }
  })

  run nonmatchingOriginOrMethodBypassesOnlyTheLimiterTest = init.then(route(1, "oauth-start", false, 1))
    .expect(calls.get(1).gateResult == "bypass" and calls.get(1).exactCalls == 0 and invariant)
  run otherPathBypassesOnlyTheLimiterTest = init.then(route(1, "other", true, 1))
    .then(coreReply(1, false)).expect(calls.get(1).coreResult == "rejected" and invariant)
  run edgeDenialDoesNotTouchExactCounterTest = init.then(route(1, "oauth-start", true, 1)).then(edge(1, "deny"))
    .expect(calls.get(1).gateResult == "429" and calls.get(1).exactCalls == 0 and invariant)
  run edgeFailureDoesNotForwardTest = init.then(route(1, "oauth-start", true, 1)).then(edge(1, "error"))
    .expect(calls.get(1).gateResult == "503" and not(calls.get(1).forwarded) and invariant)
  run clockFailureStopsBeforeHashAndSqlTest = init.then(route(1, "oauth-start", true, 1)).then(edge(1, "pass"))
    .then(captureClock(1, false)).expect(calls.get(1).gateResult == "503" and calls.get(1).exactCalls == 0 and invariant)
  run hashFailureStopsBeforeSqlTest = init.then(route(1, "oauth-start", true, 1)).then(edge(1, "pass"))
    .then(captureClock(1, true)).then(hash(1, false))
    .expect(calls.get(1).gateResult == "503" and calls.get(1).exactCalls == 0 and invariant)
  run exactDenialDoesNotForwardTest = init.then(route(1, "oauth-start", true, 1)).then(edge(1, "pass"))
    .then(captureClock(1, true)).then(hash(1, true)).then(exactReply(1, "limited"))
    .expect(calls.get(1).gateResult == "429" and calls.get(1).quotaCommitted and invariant)
  run precommitFailureDoesNotConsumeQuotaTest = init.then(route(1, "oauth-start", true, 1)).then(edge(1, "pass"))
    .then(captureClock(1, true)).then(hash(1, true)).then(exactReply(1, "precommit-error"))
    .expect(calls.get(1).gateResult == "503" and not(calls.get(1).quotaCommitted) and invariant)
  run postcommitFailureCanConsumeQuotaWithoutForwardingTest = init.then(route(1, "oauth-start", true, 1))
    .then(edge(1, "pass")).then(captureClock(1, true)).then(hash(1, true)).then(exactReply(1, "postcommit-error"))
    .expect(calls.get(1).gateResult == "503" and calls.get(1).quotaCommitted and invariant)
  run admittedRequestCanFailLaterIdentityChecksTest = init.then(route(1, "oauth-start", true, 1))
    .then(edge(1, "pass")).then(captureClock(1, true)).then(hash(1, true)).then(exactReply(1, "allowed"))
    .then(coreReply(1, false)).expect(calls.get(1).quotaCommitted and calls.get(1).coreResult == "rejected" and invariant)
  run oauthAndLocalStartShareExactScopeTest = init.then(route(1, "oauth-start", true, 1))
    .then(route(2, "local-start", true, 1)).expect(calls.get(1).key == calls.get(2).key and invariant)
  run oauthAndLocalPollShareExactScopeTest = init.then(route(1, "oauth-poll", true, 1))
    .then(route(2, "local-poll", true, 1)).expect(calls.get(1).key == calls.get(2).key and invariant)
  run startAndPollHaveSeparateExactScopesTest = init.then(route(1, "oauth-start", true, 1))
    .then(route(2, "oauth-poll", true, 1)).expect(calls.get(1).key != calls.get(2).key and invariant)
  run distinctPrincipalsHaveSeparateExactKeysTest = init.then(route(1, "oauth-start", true, 1))
    .then(route(2, "oauth-start", true, 2)).expect(calls.get(1).key != calls.get(2).key and invariant)
  run unattributedRequestsShareFallbackKeyTest = init.then(route(1, "oauth-start", true, 0))
    .then(route(2, "local-start", true, 0)).expect(calls.get(1).key == calls.get(2).key and invariant)
}
