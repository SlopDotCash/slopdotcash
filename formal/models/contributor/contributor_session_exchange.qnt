// @source skills/project-contributor-template/scripts/run-receipt.mjs
// @source backend/trace/handler.ts
// @source backend/trace/cloudflare-persistence.ts
// @source backend/identity-assertion.ts
// @evidence scripts/contributor-transport.test.js
// @evidence scripts/trace-upload-attachable.test.ts
// Two sequential CLI invocations, two authenticated actors, two complete
// create-payload/idempotency classes and four durable actor/key rows. Time0..8
// and flow/assertion/token lifetimes3/2/2 are finite ordering abstractions, not
// actual seconds. One invocation has no automatic retry for OAuth, session or
// create-run transport failures. A user retry starts a new OAuth flow.
//
// Fixed HTTPS authority, redirect refusal, byte/schema checks, token signing,
// one-time assertion consumption, server actor binding and atomic actor/key
// idempotency are predicates/contracts of their existing detailed models.
// Flow consumption, assertion consumption, token issuance, durable run writes
// and received responses are distinct transitions. No assertion or bearer is
// persisted locally. Provider-authenticated identity may differ on user retry;
// request metadata never chooses that actor.
//
// The poll loop checks its deadline before sleeping, so a request can occur
// after expiry; the server still refuses it. Returned assertion expiry is
// checked locally. Session response expiry is schema-checked, not compared
// with now by this CLI; later server authentication enforces token expiry.
// Run authorization is an earlier observation, not response-time freshness.
// A valid create response returns a session/run pair, not trace finalization.
// Changing clientVersion or any create field changes its idempotency key;
// identical clientRunId alone is not the server's uniqueness constraint.
// Existing transport/workflow definitions are partial conformance evidence.
// No tests, parser, model checker, crypto or provider calls were executed.
module contributor_session_exchange {
  val actors = Set(1, 2)
  val payloads = Set(1, 2)
  val rowKeys = Set(1, 2, 3, 4)
  var s: { phase: str, attempt: int, now: int, actor: int, payload: int,
    flowExpires: int, assertionExpires: int, tokenExpires: int, retryAfter: int,
    flowReady: bool, pollKind: str, authorizationShown: bool,
    spentFlows: Set[int], issuedAssertions: Set[int], spentAssertions: Set[int],
    issuedTokens: Set[int], assertionMemory: bool, bearerMemory: bool,
    tokenMinted: bool, authorized: bool, createAccepted: bool,
    rows: Set[int], rowStates: int -> str, snapshot: int, snapshotState: str,
    returned: int, persistedSecrets: bool, result: str }
  action init = s' = { phase: "idle", attempt: 0, now: 0, actor: 1, payload: 1,
    flowExpires: 0, assertionExpires: 0, tokenExpires: 0, retryAfter: 1,
    flowReady: false, pollKind: "none", authorizationShown: false,
    spentFlows: Set(), issuedAssertions: Set(), spentAssertions: Set(), issuedTokens: Set(),
    assertionMemory: false, bearerMemory: false, tokenMinted: false, authorized: false,
    createAccepted: false, rows: Set(), rowStates: rowKeys.mapBy(_ => "absent"),
    snapshot: 0, snapshotState: "none", returned: 0, persistedSecrets: false, result: "none" }
  pure def rowKey(actor: int, payload: int): int = (actor - 1) * 2 + payload
  def refused(reason) = s.with("phase", "done").with("result", reason)
  action begin(actor: int, payload: int): bool = all {
    Set("idle", "done").contains(s.phase), s.attempt < 2, actors.contains(actor), payloads.contains(payload),
    s' = s.with("phase", "start").with("attempt", s.attempt + 1).with("actor", actor).with("payload", payload)
      .with("flowReady", false).with("pollKind", "none").with("authorizationShown", false)
      .with("assertionMemory", false).with("bearerMemory", false).with("tokenMinted", false)
      .with("authorized", false).with("createAccepted", false).with("retryAfter", 1)
      .with("snapshot", 0).with("snapshotState", "none").with("returned", 0).with("result", "pending") }
  action tick = all { s.now < 8, s' = s.with("now", s.now + 1) }
  action startCommit = all { s.phase == "start",
    s' = s.with("phase", "start-reply").with("flowExpires", s.now + 3) }
  action startReply(valid: bool): bool = all { s.phase == "start-reply",
    s' = if (valid) s.with("phase", "wait").with("authorizationShown", true) else refused("start-error") }
  action authorizeFlow = all { Set("wait", "poll").contains(s.phase), s.now < s.flowExpires,
    s' = s.with("flowReady", true) }
  action waitPoll = all { s.phase == "wait", s.now >= s.flowExpires or s.now + s.retryAfter <= 8,
    s' = if (s.now < s.flowExpires) s.with("phase", "poll").with("now", s.now + s.retryAfter)
      else refused("flow-expired") }
  action pollCommit = all { s.phase == "poll",
    s' = if (s.now >= s.flowExpires) s.with("phase", "poll-reply").with("pollKind", "expired")
      else if (s.flowReady) s.with("phase", "poll-reply").with("pollKind", "complete")
        .with("spentFlows", s.spentFlows.union(Set(s.attempt)))
        .with("issuedAssertions", s.issuedAssertions.union(Set(s.attempt))).with("assertionExpires", s.now + 2)
      else s.with("phase", "poll-reply").with("pollKind", "pending") }
  action pollReply(valid: bool, retryAfter: int): bool = all { s.phase == "poll-reply", Set(1, 2).contains(retryAfter),
    s' = if (not(valid)) refused("poll-error")
      else if (s.pollKind == "expired") refused("flow-expired")
      else if (s.pollKind == "pending") s.with("phase", "wait").with("retryAfter", retryAfter)
      else if (s.now >= s.assertionExpires) refused("assertion-expired")
      else s.with("phase", "exchange").with("assertionMemory", true) }
  action exchangeCommit(signs: bool): bool = all { s.phase == "exchange", s.assertionMemory,
    s' = if (s.now >= s.assertionExpires or s.spentAssertions.contains(s.attempt)) refused("identity-refused")
      else s.with("phase", "auth-reply").with("spentAssertions", s.spentAssertions.union(Set(s.attempt)))
        .with("tokenMinted", signs).with("tokenExpires", s.now + 2)
        .with("issuedTokens", if (signs) s.issuedTokens.union(Set(s.attempt)) else s.issuedTokens) }
  action authReply(valid: bool): bool = all { s.phase == "auth-reply",
    s' = if (valid and s.tokenMinted) s.with("phase", "create-auth").with("bearerMemory", true)
      else refused("session-error") }
  action createAuth(allowed: bool): bool = all { s.phase == "create-auth", s.bearerMemory,
    s' = if (allowed and s.now < s.tokenExpires) s.with("phase", "insert").with("authorized", true)
      else refused("run-refused") }
  action insert(commits: bool): bool = {
    val key = rowKey(s.actor, s.payload)
    all { s.phase == "insert", s.authorized,
      s' = s.with("phase", "create-reply").with("createAccepted", commits)
        .with("rows", if (commits) s.rows.union(Set(key)) else s.rows)
        .with("rowStates", if (commits and not(s.rows.contains(key))) s.rowStates.set(key, "awaiting") else s.rowStates)
        .with("snapshot", if (commits) key else 0)
        .with("snapshotState", if (not(commits)) "none" else if (s.rows.contains(key)) s.rowStates.get(key) else "awaiting") }
  }
  action createReply(valid: bool): bool = all { s.phase == "create-reply",
    s' = if (valid and s.createAccepted) s.with("phase", "done").with("returned", s.snapshot).with("result", "ready")
      else refused("create-error") }
  action advanceRun(key: int): bool = all { rowKeys.contains(key), s.rows.contains(key), s.rowStates.get(key) != "finalized",
    s' = s.with("rowStates", s.rowStates.set(key, if (s.rowStates.get(key) == "awaiting") "uploaded" else "finalized")) }
  action crash = all { not(Set("idle", "done").contains(s.phase)),
    s' = refused("interrupted").with("assertionMemory", false).with("bearerMemory", false) }
  action transportFailure = all { Set("start", "poll", "exchange", "create-auth").contains(s.phase),
    s' = refused("request-error") }
  action step = {
    nondet actor = actors.oneOf()
    nondet payload = payloads.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet retry = Set(1, 2).oneOf()
    nondet key = rowKeys.oneOf()
    any { begin(actor, payload), tick, startCommit, startReply(yes), authorizeFlow, waitPoll, pollCommit,
      pollReply(yes, retry), exchangeCommit(yes), authReply(yes), createAuth(yes), insert(yes), createReply(yes),
      advanceRun(key), crash, transportFailure, s' = s }
  }
  val invariant = all {
    s.attempt <= 2, s.now >= 0 and s.now <= 8, not(s.persistedSecrets),
    s.spentAssertions.subseteq(s.issuedAssertions), s.issuedTokens.subseteq(s.spentAssertions),
    s.issuedAssertions.subseteq(s.spentFlows),
    s.rows.subseteq(rowKeys),
    s.result == "ready" implies s.authorized and s.bearerMemory and s.createAccepted
      and s.returned == rowKey(s.actor, s.payload) and s.rows.contains(s.returned),
    s.snapshot != 0 implies s.createAccepted and s.rows.contains(s.snapshot),
    s.result == "interrupted" implies not(s.assertionMemory) and not(s.bearerMemory) }
  action polling = startCommit.then(startReply(true)).then(authorizeFlow).then(waitPoll).then(pollCommit)
  action assertion = polling.then(pollReply(true, 1))
  action session = assertion.then(exchangeCommit(true)).then(authReply(true))
  action creating = session.then(createAuth(true))
  action ready = creating.then(insert(true)).then(createReply(true))
  run successfulExchangeDoesNotFinalizeTraceTest = init.then(begin(1, 1)).then(ready)
    .expect(s.result == "ready" and s.rowStates.get(1) == "awaiting" and invariant)
  run lostStartResponseDoesNotCreateRunTest = init.then(begin(1, 1)).then(startCommit).then(startReply(false))
    .expect(s.rows == Set() and not(s.authorizationShown) and invariant)
  run expiredStartResponseDoesNotBeginPollingTest = init.then(begin(1, 1)).then(startCommit).then(tick).then(tick).then(tick).then(startReply(true)).then(waitPoll)
    .expect(s.result == "flow-expired" and s.spentFlows == Set() and invariant)
  run pendingPollWaitsAgainTest = init.then(begin(1, 1)).then(startCommit).then(startReply(true)).then(waitPoll).then(pollCommit).then(pollReply(true, 1))
    .then(authorizeFlow).then(waitPoll).then(pollCommit).then(pollReply(true, 1)).then(exchangeCommit(true)).then(authReply(true)).then(createAuth(true)).then(insert(true)).then(createReply(true))
    .expect(s.result == "ready" and invariant)
  run waitMayCrossExpiryButServerRefusesTest = init.then(begin(1, 1)).then(startCommit).then(startReply(true)).then(waitPoll).then(pollCommit).then(pollReply(true, 2)).then(waitPoll).then(pollCommit).then(pollReply(true, 1))
    .expect(s.result == "flow-expired" and s.rows == Set() and invariant)
  run lostCompletedPollDoesNotUndoFlowConsumptionTest = init.then(begin(1, 1)).then(polling).then(pollReply(false, 1))
    .expect(s.spentFlows == Set(1) and s.issuedAssertions == Set(1) and not(s.assertionMemory) and invariant)
  run expiredAssertionResponseIsLocallyRefusedTest = init.then(begin(1, 1)).then(polling).then(tick).then(tick).then(pollReply(true, 1))
    .expect(s.result == "assertion-expired" and s.spentAssertions == Set() and invariant)
  run assertionCanExpireBeforeExchangeTest = init.then(begin(1, 1)).then(assertion).then(tick).then(tick).then(exchangeCommit(true))
    .expect(s.result == "identity-refused" and s.rows == Set() and invariant)
  run tokenSigningFailureKeepsAssertionConsumedTest = init.then(begin(1, 1)).then(assertion).then(exchangeCommit(false)).then(authReply(true))
    .expect(s.spentAssertions == Set(1) and s.issuedTokens == Set() and s.result == "session-error" and invariant)
  run lostSessionResponseLeavesConsumedAssertionTest = init.then(begin(1, 1)).then(assertion).then(exchangeCommit(true)).then(authReply(false))
    .expect(s.spentAssertions == Set(1) and s.issuedTokens == Set(1) and not(s.bearerMemory) and invariant)
  run expiredReturnedSessionFailsAtServerAuthenticationTest = init.then(begin(1, 1)).then(assertion).then(exchangeCommit(true)).then(tick).then(tick).then(authReply(true)).then(createAuth(true))
    .expect(s.result == "run-refused" and s.rows == Set() and invariant)
  run authorizationObservationCanPrecedeExpiryTest = init.then(begin(1, 1)).then(creating).then(tick).then(tick).then(insert(true)).then(createReply(true))
    .expect(s.now >= s.tokenExpires and s.result == "ready" and invariant)
  run lostRunReplyRetainsDurableRowTest = init.then(begin(1, 1)).then(creating).then(insert(true)).then(createReply(false))
    .expect(s.rows == Set(1) and s.returned == 0 and s.result == "create-error" and invariant)
  run userRetryReauthenticatesAndReusesSameRunTest = init.then(begin(1, 1)).then(creating).then(insert(true)).then(createReply(false))
    .then(begin(1, 1)).then(ready).expect(s.rows == Set(1) and s.returned == 1 and s.spentAssertions == Set(1, 2) and invariant)
  run retryCanObserveAlreadyFinalizedRunTest = init.then(begin(1, 1)).then(creating).then(insert(true)).then(createReply(false)).then(advanceRun(1)).then(advanceRun(1))
    .then(begin(1, 1)).then(ready).expect(s.rows == Set(1) and s.snapshotState == "finalized" and invariant)
  run changedPayloadUsesDifferentIdempotencyKeyTest = init.then(begin(1, 1)).then(ready).then(begin(1, 2)).then(ready)
    .expect(s.rows == Set(1, 2) and s.returned == 2 and invariant)
  run differentAuthenticatedActorHasIndependentRunTest = init.then(begin(1, 1)).then(ready).then(begin(2, 1)).then(ready)
    .expect(s.rows == Set(1, 3) and s.returned == 3 and invariant)
  run failedInsertionDoesNotInventRunTest = init.then(begin(1, 1)).then(creating).then(insert(false)).then(createReply(true))
    .expect(s.rows == Set() and s.result == "create-error" and invariant)
  run processDeathForgetsSecretsButPreservesWriteTest = init.then(begin(1, 1)).then(creating).then(insert(true)).then(crash)
    .expect(s.rows == Set(1) and not(s.assertionMemory) and not(s.bearerMemory) and invariant)
  run processDeathBeforeWriteNeedsFreshAuthenticationTest = init.then(begin(1, 1)).then(session).then(crash).then(begin(1, 1)).then(ready)
    .expect(s.rows == Set(1) and s.issuedTokens == Set(1, 2) and invariant)
}
