// @source scripts/dev-identity-bridge.ts
// @source scripts/dev-backend.ts
// @source workers/identity/handler.ts
// @source workers/identity/persistence.ts
// @source src/lib/local-signin.ts
// @evidence scripts/dev-identity-bridge.test.ts
// One local process, one remote flow/start, two poll requests, two consume
// requests and at most one process restart. Clock 0..8, flow TTL 4 and local
// assertion TTL 2 preserve relative boundaries, not real units (300s/90s).
// Local/remote clocks share this finite order; skew and real transport timers
// are outside the bound. No automatic retry or liveness is claimed.
// The remote handler supplies canonical start fields and one fixed identity.
// URL/query, body decoding, origin and identity checks are predicate classes;
// query equality means the exact URL.search comparison, not parameter-set
// equivalence. This does not claim the bridge validates every start field or
// the syntax of githubNodeId (it checks only that node ID is a string).
// The fixed production authority/HTTPS, remote identity truth, random token
// uniqueness, SHA-256 binding and accurate positive D1 readback are assumptions.
// Missing/mismatched readback is an external observation class; the finite
// local transitions do not themselves remove or rewrite an assertion row. The
// real remote flow's atomic once-only mark is modeled separately from Map
// membership. Local INSERT explicitly passes null for its parent flow: this
// random local token is not the production deterministic assertion.
// Entry pruning is synchronous and request-driven. Passing time alone does
// not remove a Map entry. A request already dispatched can finish after a
// different request prunes the Map. Remote creation clock/insert, remote
// expiry cleanup, claim/write/response and local
// delete/hash/write/readback/response are separate, including lost replies.
// Restart loses the Map and local in-flight continuations, retains SQLite,
// and may leave an already-dispatched remote request able to commit. Client
// possession survives as an abstract saved flow/token; browser storage success
// is not implied. No new flow after restart is included in this bound.
// Local assertion expiry is checked against the consume stamp captured after
// hashing. There is no scheduled local assertion DELETE in dev-backend.ts;
// expiry does not mean the row vanished. The existing test covers successful
// real-handler handoff, origin/mode refusal and one-use join, not these held
// async, lost-response, expiry or restart traces. Definitions are unexecuted.
module dev_identity_bridge {
  val ids = Set(1, 2)
  val remoteReplies = Set("ok", "missing-count", "error")
  val writeReplies = Set("ok", "false", "error")
  type Poll = { phase: str, alive: bool, capability: bool, remoteStamp: int,
    issueStamp: int, claimed: bool, remoteResult: str, expiry: int,
    created: int, desired: str, response: str }
  type Consume = { phase: str, matches: bool, stamp: int, accepted: bool, response: str }
  type State = { now: int, restarted: bool, startPhase: str, startResult: str,
    remoteCreated: bool, remotePresent: bool, remoteStatus: str, remoteExpiry: int, remoteClaims: int,
    mapPresent: bool, flowKnown: bool, authorizeResult: str,
    rowPresent: bool, rowCreated: int, rowExpiry: int, rowConsumed: bool,
    localWrites: int, tokenKnown: bool, consumeCommits: int,
    polls: int -> Poll, consumers: int -> Consume }
  val unusedPoll: Poll = { phase: "unused", alive: true, capability: false,
    remoteStamp: -1, issueStamp: -1, claimed: false, remoteResult: "none",
    expiry: -1, created: -1, desired: "none", response: "none" }
  val unusedConsume: Consume = { phase: "unused", matches: false, stamp: -1,
    accepted: false, response: "none" }
  var s: State
  action init = s' = { now: 0, restarted: false, startPhase: "unused", startResult: "none",
    remoteCreated: false, remotePresent: false, remoteStatus: "absent", remoteExpiry: -1, remoteClaims: 0,
    mapPresent: false, flowKnown: false, authorizeResult: "none",
    rowPresent: false, rowCreated: -1, rowExpiry: -1, rowConsumed: false,
    localWrites: 0, tokenKnown: false, consumeCommits: 0,
    polls: ids.mapBy(_ => unusedPoll), consumers: ids.mapBy(_ => unusedConsume) }
  def pruned(state: State): State = state.with("mapPresent",
    state.mapPresent and state.now < state.remoteExpiry)
  def ending(poll: Poll, result: str): Poll = poll.with("phase", "finish").with("desired", result)
  action tick = all { s.now < 8, s' = s.with("now", s.now + 1) }

  action beginStart(originAllowed: bool, audience: bool): bool = all {
    s.startPhase == "unused", not(s.restarted),
    s' = pruned(s).with("startPhase", if (originAllowed and audience) "remote" else "done")
      .with("startResult", if (not(originAllowed)) "403" else if (not(audience)) "400" else "none") }
  action captureStartClock = {
    val waiting = s.startPhase == "remote"
    val abandoned = s.startPhase == "done" and Set("error", "process-lost").contains(s.startResult)
    all { s.remoteExpiry == -1, waiting or abandoned,
      s' = s.with("remoteExpiry", s.now + 4) }
  }
  action createRemoteFlow = {
    val waiting = s.startPhase == "remote"
    val abandoned = s.startPhase == "done" and Set("error", "process-lost").contains(s.startResult)
    all { not(s.remoteCreated), s.remoteExpiry >= 0, waiting or abandoned,
      s' = s.with("remoteCreated", true).with("remotePresent", true).with("remoteStatus", "pending")
        .with("startPhase", if (waiting) "headers" else "done") }
  }
  action startHeaders(ok: bool): bool = all { s.startPhase == "headers",
    s' = s.with("startPhase", if (ok) "body" else "done")
      .with("startResult", if (ok) "none" else "503") }
  action startBody(decoded: bool): bool = all { s.startPhase == "body",
    s' = s.with("startPhase", if (decoded) "validate" else "done")
      .with("startResult", if (decoded) "none" else "error") }
  action validateStart(urlBound: bool, urlParses: bool): bool = {
    val accepted = urlParses and urlBound and s.now < s.remoteExpiry
    all { s.startPhase == "validate",
      s' = s.with("mapPresent", accepted).with("startPhase", if (accepted) "reply" else "done")
        .with("startResult", if (accepted) "none" else if (urlParses) "502" else "error") }
  }
  action startFailure = all { Set("remote", "headers", "body").contains(s.startPhase),
    s' = s.with("startPhase", "done").with("startResult", "error") }
  action startReply(delivered: bool): bool = all { s.startPhase == "reply",
    s' = s.with("startPhase", "done").with("flowKnown", delivered)
      .with("startResult", if (delivered) "201" else "lost") }
  action authorize(originAllowed: bool, exactQuery: bool): bool = {
    val state = pruned(s)
    all { s.authorizeResult == "none", exactQuery implies s.flowKnown,
      s' = state.with("authorizeResult", if (not(originAllowed)) "403"
        else if (state.mapPresent and exactQuery) "302" else "410") }
  }
  action completeRemote = all { s.remotePresent, s.remoteStatus == "pending", s.now < s.remoteExpiry,
    s' = s.with("remoteStatus", "complete") }
  action cleanupRemoteFlow = all { s.remotePresent, s.now >= s.remoteExpiry,
    s' = s.with("remotePresent", false).with("remoteStatus", "absent") }

  action beginPoll(id: int, originAllowed: bool): bool = all {
    ids.contains(id), s.polls.get(id).phase == "unused",
    s' = pruned(s).with("polls", s.polls.set(id,
      if (originAllowed) unusedPoll.with("phase", "body") else ending(unusedPoll, "403"))) }
  action pollBody(id: int, decoded: bool, audience: bool, capability: bool): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "body", capability implies s.flowKnown,
      s' = s.with("polls", s.polls.set(id,
        if (not(decoded)) ending(poll, "error") else if (not(audience)) ending(poll, "400")
        else poll.with("phase", "lookup").with("capability", capability))) }
  }
  action lookupFlow(id: int): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "lookup",
      s' = s.with("polls", s.polls.set(id, if (s.mapPresent and poll.capability)
        poll.with("phase", "remote-read").with("remoteStamp", s.now) else ending(poll, "410"))) }
  }
  action readRemote(id: int): bool = {
    val poll = s.polls.get(id)
    val available = s.remotePresent and poll.remoteStamp < s.remoteExpiry
    val ready = available and s.remoteStatus == "complete"
    val result = if (not(available) or s.remoteStatus == "issued") "410" else "202"
    all { poll.phase == "remote-read",
      s' = s.with("polls", s.polls.set(id, poll.with("phase", if (ready) "remote-clock" else "remote-reply")
        .with("remoteResult", if (ready) "none" else result))) }
  }
  action remoteClock(id: int): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "remote-clock",
      s' = s.with("polls", s.polls.set(id, poll.with("phase", "remote-write").with("issueStamp", s.now))) }
  }
  action claimRemote(id: int): bool = {
    val poll = s.polls.get(id)
    val accepted = s.remotePresent and s.remoteStatus == "complete" and poll.issueStamp < s.remoteExpiry
    all { poll.phase == "remote-write",
      s' = s.with("remoteStatus", if (accepted) "issued" else s.remoteStatus)
        .with("remoteClaims", s.remoteClaims + (if (accepted) 1 else 0))
        .with("polls", s.polls.set(id, poll.with("phase", "remote-write-reply").with("claimed", accepted))) }
  }
  action remoteWriteReply(id: int, outcome: str): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "remote-write-reply", remoteReplies.contains(outcome),
      s' = s.with("polls", s.polls.set(id, poll.with("phase", "remote-reply")
        .with("remoteResult", if (outcome == "error") "500"
          else if (outcome == "ok" and poll.claimed) "200" else "410"))) }
  }
  action remoteFailure(id: int): bool = {
    val poll = s.polls.get(id)
    all { Set("remote-read", "remote-clock", "remote-write", "remote-write-reply", "remote-reply").contains(poll.phase),
      s' = s.with("polls", s.polls.set(id, poll.with("phase", if (poll.alive) "finish" else "done")
        .with("desired", "error").with("response", if (poll.alive) "none" else poll.response))) }
  }
  // A local fetch rejection/abort is not proof that the dispatched server
  // request stopped. Keep that remote continuation without a local callback.
  action loseRemoteCaller(id: int): bool = {
    val poll = s.polls.get(id)
    all { poll.alive, Set("remote-read", "remote-clock", "remote-write").contains(poll.phase),
      s' = s.with("polls", s.polls.set(id, poll.with("alive", false).with("response", "error"))) }
  }
  action remoteResponse(id: int): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "remote-reply",
      s' = s.with("polls", s.polls.set(id, poll.with("phase", if (poll.alive) "remote-body" else "done")
        .with("response", if (poll.alive) "none" else poll.response))) }
  }
  action pollResponseBody(id: int, decoded: bool, identityBound: bool): bool = {
    val poll = s.polls.get(id)
    val result = if (not(decoded)) "error" else if (poll.remoteResult != "200") poll.remoteResult
      else if (not(identityBound)) "502" else "none"
    all { poll.phase == "remote-body",
      s' = s.with("polls", s.polls.set(id, if (result == "none") poll.with("phase", "delete-map")
        else ending(poll, result))) }
  }
  action deleteFlow(id: int): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "delete-map", poll.claimed,
      s' = s.with("mapPresent", false).with("polls", s.polls.set(id, poll.with("phase", "mint"))) }
  }
  action mintAssertion(id: int, randomSucceeded: bool): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "mint",
      s' = s.with("polls", s.polls.set(id, if (randomSucceeded)
        poll.with("phase", "hash").with("expiry", s.now + 2) else ending(poll, "error"))) }
  }
  action assertionHash(id: int, ok: bool): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "hash",
      s' = s.with("polls", s.polls.set(id, if (ok)
        poll.with("phase", "store").with("created", s.now) else ending(poll, "error"))) }
  }
  action storeAssertion(id: int): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "store", not(s.rowPresent),
      s' = s.with("rowPresent", true).with("rowCreated", poll.created).with("rowExpiry", poll.expiry)
        .with("localWrites", s.localWrites + 1)
        .with("polls", s.polls.set(id, poll.with("phase", "store-reply"))) }
  }
  action localFailure(id: int): bool = {
    val poll = s.polls.get(id)
    all { Set("store", "readback").contains(poll.phase),
      s' = s.with("polls", s.polls.set(id, ending(poll, "error"))) }
  }
  action storeReply(id: int, outcome: str): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "store-reply", writeReplies.contains(outcome),
      s' = s.with("polls", s.polls.set(id, if (outcome == "ok") poll.with("phase", "readback")
        else ending(poll, if (outcome == "false") "503" else "error"))) }
  }
  action readLocalAssertion(id: int, matching: bool): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "readback",
      s' = s.with("polls", s.polls.set(id,
        ending(poll, if (matching and s.rowPresent and not(s.rowConsumed)) "200" else "503"))) }
  }
  action pollReply(id: int, delivered: bool): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "finish",
      s' = s.with("tokenKnown", s.tokenKnown or (delivered and poll.desired == "200"))
        .with("polls", s.polls.set(id, poll.with("phase", "done")
          .with("response", if (delivered) poll.desired else "lost"))) }
  }

  action beginConsume(id: int): bool = all { ids.contains(id), s.consumers.get(id).phase == "unused",
    s' = pruned(s).with("consumers", s.consumers.set(id, unusedConsume.with("phase", "body"))) }
  action consumeBody(id: int, decoded: bool, bearer: bool, audience: bool, matches: bool): bool = {
    val call = s.consumers.get(id)
    all { call.phase == "body", (bearer and matches) implies s.tokenKnown,
      s' = s.with("consumers", s.consumers.set(id,
        if (not(decoded)) call.with("phase", "done").with("response", "error")
        else if (not(bearer and audience)) call.with("phase", "done").with("response", "401")
        else call.with("phase", "hash").with("matches", matches))) }
  }
  action consumeHash(id: int, ok: bool): bool = {
    val call = s.consumers.get(id)
    all { call.phase == "hash",
      s' = s.with("consumers", s.consumers.set(id, if (ok)
        call.with("phase", "write").with("stamp", s.now)
        else call.with("phase", "done").with("response", "error"))) }
  }
  action consumeWrite(id: int): bool = {
    val call = s.consumers.get(id)
    val accepted = call.matches and s.rowPresent and not(s.rowConsumed) and call.stamp < s.rowExpiry
    all { call.phase == "write",
      s' = s.with("rowConsumed", s.rowConsumed or accepted)
        .with("consumeCommits", s.consumeCommits + (if (accepted) 1 else 0))
        .with("consumers", s.consumers.set(id, call.with("phase", "reply").with("accepted", accepted))) }
  }
  action consumeFailure(id: int): bool = {
    val call = s.consumers.get(id)
    all { call.phase == "write", s' = s.with("consumers", s.consumers.set(id,
      call.with("phase", "done").with("response", "error"))) }
  }
  action consumeReply(id: int, delivered: bool): bool = {
    val call = s.consumers.get(id)
    all { call.phase == "reply", s' = s.with("consumers", s.consumers.set(id,
      call.with("phase", "done").with("response", if (not(delivered)) "error" else if (call.accepted) "200" else "401"))) }
  }
  action restart = all { not(s.restarted),
    s' = s.with("restarted", true).with("mapPresent", false)
      .with("startPhase", if (s.startPhase == "done" or s.startPhase == "unused") s.startPhase else "done")
      .with("startResult", if (s.startPhase == "done" or s.startPhase == "unused") s.startResult else "process-lost")
      .with("polls", ids.mapBy(id => {
        val poll = s.polls.get(id)
        if (Set("unused", "done").contains(poll.phase)) poll
        else if (Set("remote-read", "remote-clock", "remote-write", "remote-write-reply", "remote-reply").contains(poll.phase))
          poll.with("alive", false).with("response", if (poll.alive) "process-lost" else poll.response)
        else poll.with("alive", false).with("phase", "done").with("response", "process-lost") }))
      .with("consumers", ids.mapBy(id => {
        val call = s.consumers.get(id)
        if (Set("unused", "done").contains(call.phase)) call
        else call.with("phase", "done").with("response", "process-lost") })) }
  action step = {
    nondet id = ids.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet third = Set(false, true).oneOf()
    nondet fourth = Set(false, true).oneOf()
    nondet remoteReply = remoteReplies.oneOf()
    nondet writeReply = writeReplies.oneOf()
    any { tick, beginStart(yes, other), captureStartClock, createRemoteFlow, startHeaders(yes), startBody(yes),
      validateStart(yes, other), startFailure, startReply(yes), authorize(yes, other), completeRemote, cleanupRemoteFlow,
      beginPoll(id, yes), pollBody(id, yes, other, third), lookupFlow(id), readRemote(id), remoteClock(id),
      claimRemote(id), remoteWriteReply(id, remoteReply), remoteFailure(id), loseRemoteCaller(id), remoteResponse(id),
      pollResponseBody(id, yes, other), deleteFlow(id), mintAssertion(id, yes), assertionHash(id, yes),
      storeAssertion(id), localFailure(id), storeReply(id, writeReply), readLocalAssertion(id, yes), pollReply(id, yes),
      beginConsume(id), consumeBody(id, yes, other, third, fourth), consumeHash(id, yes), consumeWrite(id),
      consumeFailure(id), consumeReply(id, yes), restart, s' = s }
  }
  val invariant = all {
    s.now >= 0, s.now <= 8, s.remoteClaims <= 1, s.localWrites <= 1, s.consumeCommits <= 1,
    s.mapPresent implies s.remoteCreated,
    s.remotePresent implies s.remoteCreated,
    s.remoteClaims == 1 implies s.remoteCreated,
    s.localWrites == 1 implies s.remoteClaims == 1 and s.rowPresent,
    s.tokenKnown implies s.localWrites == 1 and s.rowPresent,
    s.rowConsumed implies s.consumeCommits == 1 and s.tokenKnown,
    s.consumeCommits == 1 implies s.rowPresent,
    ids.forall(id => {
      val poll = s.polls.get(id)
      val call = s.consumers.get(id)
      all { poll.claimed implies s.remoteClaims == 1,
        poll.response == "200" implies poll.claimed and s.localWrites == 1 and s.tokenKnown,
        call.accepted implies s.rowConsumed and call.stamp < s.rowExpiry,
        call.response == "200" implies call.accepted } }) }

  action opened = beginStart(true, true).then(captureStartClock).then(createRemoteFlow).then(startHeaders(true)).then(startBody(true))
    .then(validateStart(true, true)).then(startReply(true))
  action ready = opened.then(completeRemote)
  action dispatched(id: int): bool = beginPoll(id, true).then(pollBody(id, true, true, true)).then(lookupFlow(id))
  action claimed(id: int): bool = readRemote(id).then(remoteClock(id)).then(claimRemote(id))
    .then(remoteWriteReply(id, "ok")).then(remoteResponse(id)).then(pollResponseBody(id, true, true))
  action prepared(id: int): bool = deleteFlow(id).then(mintAssertion(id, true)).then(assertionHash(id, true))
  action published(id: int): bool = storeAssertion(id).then(storeReply(id, "ok"))
    .then(readLocalAssertion(id, true)).then(pollReply(id, true))
  action tokenReady = ready.then(dispatched(1)).then(claimed(1)).then(prepared(1)).then(published(1))
  action consumption(id: int): bool = beginConsume(id).then(consumeBody(id, true, true, true, true))
    .then(consumeHash(id, true)).then(consumeWrite(id))

  run wrongOriginNeverDispatchesStartTest = init.then(beginStart(false, true))
    .expect(s.startResult == "403" and not(s.remotePresent) and invariant)
  run invalidStartAudienceNeverDispatchesTest = init.then(beginStart(true, false))
    .expect(s.startResult == "400" and not(s.remotePresent) and invariant)
  run failedStartTransportHasNoMapTest = init.then(beginStart(true, true)).then(startFailure)
    .expect(s.startResult == "error" and not(s.mapPresent) and invariant)
  run remoteStartMayCommitAfterFetchRejectionTest = init.then(beginStart(true, true)).then(startFailure)
    .then(captureStartClock).then(createRemoteFlow)
    .expect(s.startResult == "error" and s.remotePresent and not(s.mapPresent) and invariant)
  run nonOkStartMayLeaveRemoteFlowTest = init.then(beginStart(true, true)).then(captureStartClock).then(createRemoteFlow).then(startHeaders(false))
    .expect(s.startResult == "503" and s.remotePresent and not(s.mapPresent) and invariant)
  run malformedStartBodyLeavesNoMapTest = init.then(beginStart(true, true)).then(captureStartClock).then(createRemoteFlow)
    .then(startHeaders(true)).then(startBody(false)).expect(s.startResult == "error" and not(s.mapPresent) and invariant)
  run unboundAuthorizationUrlRefusedTest = init.then(beginStart(true, true)).then(captureStartClock).then(createRemoteFlow)
    .then(startHeaders(true)).then(startBody(true)).then(validateStart(false, true))
    .expect(s.startResult == "502" and not(s.mapPresent) and invariant)
  run startResponseExpiredAtValidationRefusesMapTest = init.then(beginStart(true, true)).then(captureStartClock).then(createRemoteFlow)
    .then(startHeaders(true)).then(startBody(true)).then(tick).then(tick).then(tick).then(tick)
    .then(validateStart(true, true)).expect(s.startResult == "502" and not(s.mapPresent) and invariant)
  run lostStartResponseLeavesUnusableMapTest = init.then(beginStart(true, true)).then(captureStartClock).then(createRemoteFlow)
    .then(startHeaders(true)).then(startBody(true)).then(validateStart(true, true)).then(startReply(false))
    .expect(s.mapPresent and not(s.flowKnown) and s.startResult == "lost" and invariant)
  run authorizeRequiresExactQueryTest = init.then(opened).then(authorize(true, false))
    .expect(s.authorizeResult == "410" and s.mapPresent and invariant)
  run boundAuthorizeRedirectsWithoutConsumingMapTest = init.then(opened).then(authorize(true, true))
    .expect(s.authorizeResult == "302" and s.mapPresent and invariant)
  run expiryNeedsAnIncomingRequestToPruneMapTest = init.then(opened).then(tick).then(tick).then(tick).then(tick)
    .expect(s.mapPresent).then(authorize(true, true)).expect(not(s.mapPresent) and s.authorizeResult == "410" and invariant)
  run requestBodyDelayDoesNotRecheckLocalExpiryTest = init.then(opened).then(beginPoll(1, true))
    .then(tick).then(tick).then(tick).then(tick).then(pollBody(1, true, true, true)).then(lookupFlow(1))
    .expect(s.polls.get(1).phase == "remote-read").then(readRemote(1)).then(remoteResponse(1))
    .then(pollResponseBody(1, true, true)).then(pollReply(1, true))
    .expect(s.polls.get(1).response == "410" and invariant)
  run pendingResponseRetainsFlowForSecondPollTest = init.then(opened).then(dispatched(1)).then(readRemote(1))
    .then(remoteResponse(1)).then(pollResponseBody(1, true, true)).then(pollReply(1, true))
    .expect(s.polls.get(1).response == "202" and s.mapPresent).then(completeRemote)
    .then(dispatched(2)).then(claimed(2)).then(prepared(2)).then(published(2)).expect(s.tokenKnown and invariant)
  run concurrentPollsUseRemoteClaimAsMutexTest = init.then(ready).then(dispatched(1)).then(dispatched(2))
    .then(readRemote(1)).then(readRemote(2)).then(remoteClock(1)).then(remoteClock(2))
    .then(claimRemote(1)).then(claimRemote(2)).then(remoteWriteReply(1, "ok")).then(remoteWriteReply(2, "ok"))
    .then(remoteResponse(2)).then(pollResponseBody(2, true, true)).then(pollReply(2, true))
    .then(remoteResponse(1)).then(pollResponseBody(1, true, true)).then(prepared(1)).then(published(1))
    .expect(s.polls.get(2).response == "410" and s.remoteClaims == 1 and s.localWrites == 1 and invariant)
  run lostRemoteReplyLeavesClaimedFlowAndNoLocalRowTest = init.then(ready).then(dispatched(1))
    .then(readRemote(1)).then(remoteClock(1)).then(claimRemote(1)).then(remoteFailure(1)).then(pollReply(1, true))
    .then(dispatched(2)).then(readRemote(2)).then(remoteResponse(2)).then(pollResponseBody(2, true, true)).then(pollReply(2, true))
    .expect(s.mapPresent and s.remoteClaims == 1 and not(s.rowPresent) and s.polls.get(2).response == "410" and invariant)
  run remoteClaimMayFollowLocalFetchRejectionTest = init.then(ready).then(dispatched(1)).then(readRemote(1))
    .then(remoteClock(1)).then(loseRemoteCaller(1)).expect(s.polls.get(1).response == "error" and s.remoteClaims == 0)
    .then(claimRemote(1)).then(remoteWriteReply(1, "ok")).then(remoteResponse(1))
    .expect(s.remoteClaims == 1 and not(s.rowPresent) and s.polls.get(1).response == "error" and invariant)
  run missingRemoteChangeCountCannotIssueLocalTokenTest = init.then(ready).then(dispatched(1))
    .then(readRemote(1)).then(remoteClock(1)).then(claimRemote(1)).then(remoteWriteReply(1, "missing-count"))
    .then(remoteResponse(1)).then(pollResponseBody(1, true, true)).then(pollReply(1, true))
    .expect(s.remoteClaims == 1 and not(s.rowPresent) and s.polls.get(1).response == "410" and invariant)
  run remoteCleanupBeforeClaimRefusesCapturedPollTest = init.then(ready).then(dispatched(1)).then(readRemote(1))
    .then(remoteClock(1)).then(tick).then(tick).then(tick).then(tick).then(cleanupRemoteFlow)
    .then(claimRemote(1)).then(remoteWriteReply(1, "ok")).then(remoteResponse(1))
    .then(pollResponseBody(1, true, true)).then(pollReply(1, true))
    .expect(s.polls.get(1).response == "410" and s.remoteClaims == 0 and not(s.rowPresent) and invariant)
  run remoteCleanupAfterClaimKeepsReceivedIdentityTest = init.then(ready).then(dispatched(1)).then(readRemote(1))
    .then(remoteClock(1)).then(claimRemote(1)).then(tick).then(tick).then(tick).then(tick).then(cleanupRemoteFlow)
    .then(remoteWriteReply(1, "ok")).then(remoteResponse(1)).then(pollResponseBody(1, true, true))
    .then(prepared(1)).then(published(1))
    .expect(not(s.remotePresent) and s.remoteClaims == 1 and s.tokenKnown and invariant)
  run errorResponseBodyIsParsedBeforeStatusTest = init.then(ready).then(dispatched(1))
    .then(readRemote(1)).then(remoteClock(1)).then(claimRemote(1)).then(remoteWriteReply(1, "error"))
    .then(remoteResponse(1)).then(pollResponseBody(1, false, true)).then(pollReply(1, true))
    .expect(s.polls.get(1).response == "error" and s.mapPresent and invariant)
  run unboundRemoteIdentityRetainsMapAfterRemoteClaimTest = init.then(ready).then(dispatched(1))
    .then(readRemote(1)).then(remoteClock(1)).then(claimRemote(1)).then(remoteWriteReply(1, "ok"))
    .then(remoteResponse(1)).then(pollResponseBody(1, true, false)).then(pollReply(1, true))
    .expect(s.polls.get(1).response == "502" and s.mapPresent and s.remoteClaims == 1 and not(s.rowPresent) and invariant)
  run laterEntryPruningDoesNotCancelReceivedIdentityTest = init.then(ready).then(dispatched(1)).then(claimed(1))
    .then(tick).then(tick).then(tick).then(tick).then(beginPoll(2, true))
    .expect(not(s.mapPresent)).then(prepared(1)).then(published(1)).expect(s.tokenKnown and invariant)
  run mintFailureDoesNotRestoreDeletedMapTest = init.then(ready).then(dispatched(1)).then(claimed(1))
    .then(deleteFlow(1)).then(mintAssertion(1, false)).then(pollReply(1, true))
    .expect(not(s.mapPresent) and not(s.rowPresent) and s.remoteClaims == 1 and invariant)
  run hashFailureRequiresANewFlowTest = init.then(ready).then(dispatched(1)).then(claimed(1))
    .then(deleteFlow(1)).then(mintAssertion(1, true)).then(assertionHash(1, false)).then(pollReply(1, true))
    .then(dispatched(2)).then(pollReply(2, true)).expect(s.polls.get(2).response == "410" and not(s.rowPresent) and invariant)
  run localWriteFailureCannotReplayRemoteHandoffTest = init.then(ready).then(dispatched(1)).then(claimed(1)).then(prepared(1))
    .then(localFailure(1)).then(pollReply(1, true)).then(dispatched(2)).then(pollReply(2, true))
    .expect(s.remoteClaims == 1 and s.localWrites == 0 and s.polls.get(2).response == "410" and invariant)
  run lostLocalWriteReplyRetainsUnknownAssertionTest = init.then(ready).then(dispatched(1)).then(claimed(1)).then(prepared(1))
    .then(storeAssertion(1)).then(storeReply(1, "error")).then(pollReply(1, true))
    .expect(s.rowPresent and not(s.tokenKnown) and not(s.mapPresent) and invariant)
  run falseLocalWriteResultCanFollowCommitTest = init.then(ready).then(dispatched(1)).then(claimed(1)).then(prepared(1))
    .then(storeAssertion(1)).then(storeReply(1, "false")).then(pollReply(1, true))
    .expect(s.rowPresent and s.polls.get(1).response == "503" and not(s.tokenKnown) and invariant)
  run readbackFailureDoesNotUndoLocalInsertTest = init.then(ready).then(dispatched(1)).then(claimed(1)).then(prepared(1))
    .then(storeAssertion(1)).then(storeReply(1, "ok")).then(localFailure(1)).then(pollReply(1, true))
    .expect(s.rowPresent and s.polls.get(1).response == "error" and not(s.tokenKnown) and invariant)
  run missingReadbackRefusesCommittedLocalRowTest = init.then(ready).then(dispatched(1)).then(claimed(1)).then(prepared(1))
    .then(storeAssertion(1)).then(storeReply(1, "ok")).then(readLocalAssertion(1, false)).then(pollReply(1, true))
    .expect(s.rowPresent and s.polls.get(1).response == "503" and not(s.tokenKnown) and invariant)
  run lostLocalSuccessReplyDoesNotDiscloseTokenTest = init.then(ready).then(dispatched(1)).then(claimed(1)).then(prepared(1))
    .then(storeAssertion(1)).then(storeReply(1, "ok")).then(readLocalAssertion(1, true)).then(pollReply(1, false))
    .expect(s.rowPresent and not(s.tokenKnown) and s.polls.get(1).response == "lost" and invariant)
  run delayedHashCanStoreAndReturnAlreadyExpiredAssertionTest = init.then(ready).then(dispatched(1)).then(claimed(1))
    .then(deleteFlow(1)).then(mintAssertion(1, true)).then(tick).then(tick).then(tick).then(assertionHash(1, true))
    .then(published(1)).expect(s.rowCreated > s.rowExpiry and s.tokenKnown).then(consumption(1)).then(consumeReply(1, true))
    .expect(s.consumers.get(1).response == "401" and s.rowPresent and invariant)
  run restartLosesSavedFlowRoutingTest = init.then(opened).then(restart).then(authorize(true, true))
    .then(dispatched(1)).then(pollReply(1, true))
    .expect(s.flowKnown and s.remotePresent and s.authorizeResult == "410" and s.polls.get(1).response == "410" and invariant)
  run remoteClaimMayCommitAfterLocalRestartTest = init.then(ready).then(dispatched(1)).then(readRemote(1))
    .then(remoteClock(1)).then(restart).then(claimRemote(1)).then(remoteWriteReply(1, "ok")).then(remoteResponse(1))
    .expect(s.remoteClaims == 1 and not(s.rowPresent) and s.polls.get(1).response == "process-lost" and invariant)
  run restartAfterInsertKeepsUnknownRowTest = init.then(ready).then(dispatched(1)).then(claimed(1)).then(prepared(1))
    .then(storeAssertion(1)).then(restart)
    .expect(s.rowPresent and not(s.tokenKnown) and not(s.mapPresent) and s.polls.get(1).response == "process-lost" and invariant)
  run issuedLocalTokenSurvivesBackendRestartTest = init.then(tokenReady).then(restart).then(consumption(1)).then(consumeReply(1, true))
    .expect(s.consumers.get(1).response == "200" and not(s.mapPresent) and invariant)
  run concurrentLocalConsumesCommitOnlyOnceTest = init.then(tokenReady).then(beginConsume(1)).then(beginConsume(2))
    .then(consumeBody(1, true, true, true, true)).then(consumeBody(2, true, true, true, true))
    .then(consumeHash(1, true)).then(consumeHash(2, true)).then(consumeWrite(1)).then(consumeWrite(2))
    .then(consumeReply(1, true)).then(consumeReply(2, true))
    .expect(s.consumers.get(1).response == "200" and s.consumers.get(2).response == "401" and s.consumeCommits == 1 and invariant)
  run lostConsumeReplyDoesNotRestoreTokenTest = init.then(tokenReady).then(consumption(1)).then(consumeReply(1, false))
    .then(consumption(2)).then(consumeReply(2, true))
    .expect(s.consumers.get(1).response == "error" and s.consumers.get(2).response == "401" and invariant)
  run consumeFailureBeforeCommitAllowsSecondAttemptTest = init.then(tokenReady).then(beginConsume(1))
    .then(consumeBody(1, true, true, true, true)).then(consumeHash(1, true)).then(consumeFailure(1))
    .then(consumption(2)).then(consumeReply(2, true))
    .expect(s.consumers.get(2).response == "200" and s.consumeCommits == 1 and invariant)
  run consumeCapturedExactlyAtExpiryIsRefusedTest = init.then(tokenReady).then(tick).then(tick)
    .then(consumption(1)).then(consumeReply(1, true))
    .expect(s.consumers.get(1).response == "401" and not(s.rowConsumed) and s.rowPresent and invariant)
  run capturedConsumeTimeMayPrecedeExpiryAtCommitTest = init.then(tokenReady).then(beginConsume(1))
    .then(consumeBody(1, true, true, true, true)).then(consumeHash(1, true)).then(tick).then(tick)
    .then(consumeWrite(1)).then(consumeReply(1, true))
    .expect(s.now == s.rowExpiry and s.consumers.get(1).response == "200" and invariant)
  run wrongLocalAudienceRefusesWithoutConsumptionTest = init.then(tokenReady).then(beginConsume(1))
    .then(consumeBody(1, true, true, false, true))
    .expect(s.consumers.get(1).response == "401" and not(s.rowConsumed) and invariant)
  run localBodyFailurePrecedesBearerRefusalTest = init.then(beginConsume(1)).then(consumeBody(1, false, false, false, false))
    .expect(s.consumers.get(1).response == "error" and s.consumeCommits == 0 and invariant)
}
