// @source workers/identity/handler.ts
// @source workers/identity/persistence.ts
// @source workers/identity/crypto.ts
// @source workers/identity/contracts.ts
// @evidence workers/identity/expiry-boundary.test.ts
// @evidence scripts/dev-identity-bridge.test.ts
// @evidence backend/points/publication.test.ts
// One existing flow, two polls, two consume calls, one cleanup sequence and
// at most two generations of one deterministic token. Clock 0..6, flow expiry
// 5 and assertion TTL 2 preserve the shorter-assertion ordering, not real units
// (production: 300s and 90s). Existing assertions represent an earlier orphan.
// Flow/actor/capability/audience/secret are fixed. HMAC equality for repeated
// inputs and collision resistance are assumptions, not crypto proofs.
// Poll/consume timestamps are captured at their actual call boundaries. SQL
// effects, readback, observed counts and replies are distinct. Visible counts
// and RETURNING rows are assumed accurate; missing counts and failed replies
// refuse without rolling back a commit. Metadata validity is an input class.
// Completed-flow actor/login presence is guaranteed by the migrated schema;
// malformed body with valid Bearer syntax is distinct from bad Bearer syntax.
// Fixed production INSERT requires the parent flow still be callback_complete
// in that statement. historicalUnfencedInsert is a negative-control action;
// it is deliberately absent from step. Local bridge random-token insertion
// with flowId=null is separate: a local Worker poll creates no platform token.
// A valid consume needs a token returned by a poll. The retained token-known
// flag permits replay attempts by its holder; it does not invent disclosure
// before issuance. Local identity delivery never sets that flag. Client-side
// expiry checks, network delivery, automatic retries and liveness are excluded.
module identity_assertion_lifecycle {
  val ids = Set(1, 2)
  val flowExpiry = 5
  val statuses = Set("pending", "callback_processing", "callback_complete", "callback_failed", "assertion_issued")
  val insertReplies = Set("ok", "false", "error")
  val markReplies = Set("ok", "missing-count", "error")
  val consumeInputs = Set("valid", "wrong-audience", "wrong-token", "bad-input", "bad-body")
  type Poll = { phase: str, stamp: int, issueStamp: int, endpointLocal: bool,
    capability: bool, audience: bool, snapshotStatus: str, tokenComputed: bool,
    inserted: bool, parentOpen: bool, readGeneration: int, readCreated: int,
    readExpiry: int, markAccepted: bool, desired: str, response: str }
  type Consume = { phase: str, stamp: int, tokenMatches: bool, audience: bool,
    accepted: bool, generation: int, response: str }
  type State = { configured: bool, local: bool, node: bool, now: int,
    flowPresent: bool, flowStatus: str, marks: int, tokenKnown: bool, localHandoffs: int,
    assertionPresent: bool, generations: int, assertionGeneration: int,
    assertionCreated: int, assertionExpiry: int, assertionConsumed: bool,
    consumeCommits: int, usedGenerations: Set[int], cleanupPhase: str, cleanupStamp: int,
    polls: int -> Poll, consumers: int -> Consume }
  val unusedPoll: Poll = { phase: "unused", stamp: -1, issueStamp: -1, endpointLocal: false,
    capability: false, audience: false, snapshotStatus: "none", tokenComputed: false,
    inserted: false, parentOpen: false, readGeneration: 0, readCreated: -1,
    readExpiry: -1, markAccepted: false, desired: "none", response: "none" }
  val unusedConsume: Consume = { phase: "unused", stamp: -1, tokenMatches: false,
    audience: false, accepted: false, generation: 0, response: "none" }
  var s: State
  action init = s' = { configured: false, local: false, node: true, now: 0,
    flowPresent: true, flowStatus: "callback_complete", marks: 0, tokenKnown: false, localHandoffs: 0,
    assertionPresent: false, generations: 0, assertionGeneration: 0,
    assertionCreated: -1, assertionExpiry: -1, assertionConsumed: false,
    consumeCommits: 0, usedGenerations: Set(), cleanupPhase: "idle", cleanupStamp: -1,
    polls: ids.mapBy(_ => unusedPoll), consumers: ids.mapBy(_ => unusedConsume) }
  action configure(local: bool, node: bool, status: str, existing: bool): bool = all {
    not(s.configured), statuses.contains(status), existing implies not(local) and status == "callback_complete",
    s' = s.with("configured", true).with("local", local).with("node", node).with("flowStatus", status)
      .with("assertionPresent", existing).with("generations", if (existing) 1 else 0)
      .with("assertionGeneration", if (existing) 1 else 0)
      .with("assertionCreated", if (existing) 0 else -1).with("assertionExpiry", if (existing) 2 else -1) }
  action tick = all { s.configured, s.now < 6, s' = s.with("now", s.now + 1) }
  def ending(poll: Poll, desired: str): Poll = poll.with("phase", "finish").with("desired", desired)
  action beginPoll(id: int, valid: bool, capability: bool, audience: bool, endpointLocal: bool): bool = all {
    s.configured, ids.contains(id), s.polls.get(id).phase == "unused",
    s' = s.with("polls", s.polls.set(id, unusedPoll.with("phase", if (valid) "flow-hash" else "finish")
      .with("stamp", if (valid) s.now else -1).with("capability", capability).with("audience", audience)
      .with("endpointLocal", endpointLocal).with("desired", if (valid) "none" else "400"))) }
  action flowHash(id: int, ok: bool): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "flow-hash", s' = s.with("polls", s.polls.set(id,
      if (ok) poll.with("phase", "flow-read") else ending(poll, "error"))) }
  }
  action readFlow(id: int): bool = {
    val poll = s.polls.get(id)
    val found = s.flowPresent and poll.capability and poll.stamp < flowExpiry
    val nextValue = if (not(found) or not(poll.audience)) ending(poll, "410")
      else if (poll.endpointLocal != s.local) ending(poll, "403")
      else if (Set("pending", "callback_processing").contains(s.flowStatus)) ending(poll, "202")
      else if (s.flowStatus != "callback_complete") ending(poll, "410")
      else if (s.local and not(s.node)) ending(poll, "502")
      else poll.with("phase", if (s.local) "issue-clock" else "derive")
    all { poll.phase == "flow-read",
      s' = s.with("polls", s.polls.set(id, nextValue.with("snapshotStatus", if (found) s.flowStatus else "none"))) }
  }
  action derive(id: int, ok: bool): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "derive", s' = s.with("polls", s.polls.set(id,
      if (ok) poll.with("phase", "assertion-hash").with("tokenComputed", true) else ending(poll, "error"))) }
  }
  action assertionHash(id: int, ok: bool): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "assertion-hash", s' = s.with("polls", s.polls.set(id,
      if (ok) poll.with("phase", "insert") else ending(poll, "error"))) }
  }
  def inserted(state: State, id: int, fenced: bool): State = {
    val poll = state.polls.get(id)
    val parent = state.flowPresent and state.flowStatus == "callback_complete"
    val create = not(state.assertionPresent) and (not(fenced) or parent)
    val generation = if (create) state.generations + 1 else state.assertionGeneration
    state.with("assertionPresent", state.assertionPresent or create)
      .with("generations", if (create) generation else state.generations)
      .with("assertionGeneration", generation)
      .with("assertionCreated", if (create) poll.stamp else state.assertionCreated)
      .with("assertionExpiry", if (create) poll.stamp + 2 else state.assertionExpiry)
      .with("assertionConsumed", if (create) false else state.assertionConsumed)
      .with("polls", state.polls.set(id, poll.with("phase", "insert-reply").with("inserted", create).with("parentOpen", parent)))
  }
  action insertAssertion(id: int): bool = all { s.polls.get(id).phase == "insert", s.generations < 2 or s.assertionPresent,
    s' = inserted(s, id, true) }
  // Negative control only: the former unconditional INSERT could recreate an
  // expired token row after the parent had already issued that token.
  action historicalUnfencedInsert(id: int): bool = all { s.polls.get(id).phase == "insert", s.generations < 2 or s.assertionPresent,
    s' = inserted(s, id, false) }
  action insertReply(id: int, outcome: str): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "insert-reply", insertReplies.contains(outcome),
      s' = s.with("polls", s.polls.set(id, if (outcome == "ok") poll.with("phase", "readback")
        else ending(poll, if (outcome == "error") "error" else "503"))) }
  }
  action readAssertion(id: int, identityMatches: bool): bool = {
    val poll = s.polls.get(id)
    val found = s.assertionPresent and not(s.assertionConsumed) and identityMatches
    all { poll.phase == "readback", s' = s.with("polls", s.polls.set(id,
      if (found) poll.with("phase", "validate-assertion").with("readGeneration", s.assertionGeneration)
        .with("readCreated", s.assertionCreated).with("readExpiry", s.assertionExpiry)
      else ending(poll, "503"))) }
  }
  action validateAssertion(id: int, canonicalMetadata: bool): bool = {
    val poll = s.polls.get(id)
    val valid = canonicalMetadata and poll.readCreated <= poll.stamp and poll.readExpiry > poll.stamp
    all { poll.phase == "validate-assertion", s' = s.with("polls", s.polls.set(id,
      if (valid) poll.with("phase", "issue-clock") else ending(poll, "503"))) }
  }
  action issueClock(id: int): bool = {
    val poll = s.polls.get(id)
    all { poll.phase == "issue-clock",
      s' = s.with("polls", s.polls.set(id, poll.with("phase", "issue-write").with("issueStamp", s.now))) }
  }
  action issueWrite(id: int): bool = {
    val poll = s.polls.get(id)
    val accepted = s.flowPresent and s.flowStatus == "callback_complete" and poll.issueStamp < flowExpiry
    all { poll.phase == "issue-write",
      s' = s.with("flowStatus", if (accepted) "assertion_issued" else s.flowStatus)
        .with("marks", if (accepted) s.marks + 1 else s.marks)
        .with("polls", s.polls.set(id, poll.with("phase", "issue-reply").with("markAccepted", accepted))) }
  }
  action issueReply(id: int, outcome: str): bool = {
    val poll = s.polls.get(id)
    val success = outcome == "ok" and poll.markAccepted
    all { poll.phase == "issue-reply", markReplies.contains(outcome),
      s' = s.with("polls", s.polls.set(id, ending(poll,
        if (outcome == "error") "error" else if (not(success)) "410"
        else if (s.local) "local-200" else "browser-200"))) }
  }
  action pollFailure(id: int): bool = {
    val poll = s.polls.get(id)
    all { Set("flow-read", "insert", "readback", "issue-clock", "issue-write").contains(poll.phase),
      s' = s.with("polls", s.polls.set(id, ending(poll, "error"))) }
  }
  action finishPoll(id: int, delivered: bool): bool = {
    val poll = s.polls.get(id)
    val browser = delivered and poll.desired == "browser-200"
    val local = delivered and poll.desired == "local-200"
    all { poll.phase == "finish",
      s' = s.with("tokenKnown", s.tokenKnown or browser)
        .with("localHandoffs", s.localHandoffs + (if (local) 1 else 0))
        .with("polls", s.polls.set(id, poll.with("phase", "done").with("response", if (delivered) poll.desired else "lost"))) }
  }
  action beginConsume(id: int, input: str): bool = {
    val knownRequired = Set("valid", "wrong-audience").contains(input)
    all { s.configured, ids.contains(id), s.consumers.get(id).phase == "unused", consumeInputs.contains(input),
      knownRequired implies s.tokenKnown,
      s' = s.with("consumers", s.consumers.set(id, unusedConsume
        .with("phase", if (Set("bad-input", "bad-body").contains(input)) "done" else "hash")
        .with("tokenMatches", input != "wrong-token").with("audience", input != "wrong-audience")
        .with("response", if (input == "bad-input") "401" else if (input == "bad-body") "400" else "none"))) }
  }
  action consumeHash(id: int, ok: bool): bool = {
    val call = s.consumers.get(id)
    all { call.phase == "hash", s' = s.with("consumers", s.consumers.set(id,
      if (ok) call.with("phase", "write").with("stamp", s.now)
      else call.with("phase", "done").with("response", "error"))) }
  }
  action consumeWrite(id: int): bool = {
    val call = s.consumers.get(id)
    val accepted = call.tokenMatches and call.audience and s.assertionPresent
      and not(s.assertionConsumed) and call.stamp < s.assertionExpiry
    all { call.phase == "write",
      s' = s.with("assertionConsumed", s.assertionConsumed or accepted)
        .with("consumeCommits", s.consumeCommits + (if (accepted) 1 else 0))
        .with("usedGenerations", if (accepted) s.usedGenerations.union(Set(s.assertionGeneration)) else s.usedGenerations)
        .with("consumers", s.consumers.set(id, call.with("phase", "reply").with("accepted", accepted)
          .with("generation", if (accepted) s.assertionGeneration else 0))) }
  }
  action consumeFailure(id: int): bool = {
    val call = s.consumers.get(id)
    all { call.phase == "write", s' = s.with("consumers", s.consumers.set(id, call.with("phase", "done").with("response", "error"))) }
  }
  action consumeReply(id: int, received: bool): bool = {
    val call = s.consumers.get(id)
    all { call.phase == "reply", s' = s.with("consumers", s.consumers.set(id, call.with("phase", "done")
      .with("response", if (not(received)) "error" else if (call.accepted) "200" else "401"))) }
  }
  action beginCleanup = all { s.configured, s.cleanupPhase == "idle",
    s' = s.with("cleanupPhase", "flows").with("cleanupStamp", s.now) }
  action cleanupFlow = all { s.cleanupPhase == "flows",
    s' = s.with("cleanupPhase", "assertions")
      .with("flowPresent", s.flowPresent and s.cleanupStamp < flowExpiry)
      .with("flowStatus", if (s.cleanupStamp >= flowExpiry) "absent" else s.flowStatus) }
  action cleanupAssertion = all { s.cleanupPhase == "assertions",
    s' = s.with("cleanupPhase", "done")
      .with("assertionPresent", s.assertionPresent and s.cleanupStamp < s.assertionExpiry) }
  action step = {
    nondet id = ids.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet status = statuses.oneOf()
    nondet reply = insertReplies.oneOf()
    nondet mark = markReplies.oneOf()
    nondet input = consumeInputs.oneOf()
    any { configure(yes, other, status, false), configure(false, yes, "callback_complete", true), tick,
      beginPoll(id, yes, true, true, other), beginPoll(id, true, false, true, other), beginPoll(id, true, true, false, other),
      flowHash(id, yes), readFlow(id), derive(id, yes), assertionHash(id, yes), insertAssertion(id), insertReply(id, reply),
      readAssertion(id, yes), validateAssertion(id, yes), issueClock(id), issueWrite(id), issueReply(id, mark), pollFailure(id),
      finishPoll(id, yes), beginConsume(id, input), consumeHash(id, yes), consumeWrite(id), consumeFailure(id), consumeReply(id, yes),
      beginCleanup, cleanupFlow, cleanupAssertion, s' = s }
  }
  val tokenOnce = s.consumeCommits <= 1
  val invariant = all {
    s.now >= 0, s.now <= 6, s.marks <= 1, s.localHandoffs <= 1, s.generations <= 2,
    tokenOnce, s.consumeCommits == s.usedGenerations.size(),
    s.local implies s.generations == 0 and not(s.tokenKnown),
    ids.forall(id => {
      val poll = s.polls.get(id)
      val call = s.consumers.get(id)
      all {
        poll.inserted implies poll.parentOpen,
        poll.markAccepted implies poll.issueStamp < flowExpiry,
        Set("browser-200", "local-200").contains(poll.response) implies poll.markAccepted,
        poll.response == "browser-200" implies not(s.local) and poll.tokenComputed,
        poll.response == "local-200" implies s.local and s.node,
        call.accepted implies call.tokenMatches and call.audience and call.generation > 0,
        call.response == "200" implies call.accepted }
    }) }

  action browser = init.then(configure(false, true, "callback_complete", false))
  action pollSnapshot(id: int): bool = beginPoll(id, true, true, true, false).then(flowHash(id, true)).then(readFlow(id))
  action insertionReady(id: int): bool = pollSnapshot(id).then(derive(id, true)).then(assertionHash(id, true))
  action stored(id: int): bool = insertionReady(id).then(insertAssertion(id)).then(insertReply(id, "ok"))
    .then(readAssertion(id, true)).then(validateAssertion(id, true))
  action issue(id: int): bool = issueClock(id).then(issueWrite(id)).then(issueReply(id, "ok")).then(finishPoll(id, true))
  action consume(id: int): bool = beginConsume(id, "valid").then(consumeHash(id, true)).then(consumeWrite(id)).then(consumeReply(id, true))
  action clean = beginCleanup.then(cleanupFlow).then(cleanupAssertion)

  run browserPollReturnsOneConsumableTokenTest = browser.then(stored(1)).then(issue(1)).then(consume(1))
    .expect(s.polls.get(1).response == "browser-200" and s.consumers.get(1).response == "200" and invariant)
  run repeatedPollAfterIssueIsGoneTest = browser.then(stored(1)).then(issue(1)).then(pollSnapshot(2)).then(finishPoll(2, true))
    .expect(s.polls.get(2).response == "410" and s.marks == 1 and invariant)
  run replayedConsumeIsRefusedTest = browser.then(stored(1)).then(issue(1)).then(consume(1)).then(consume(2))
    .expect(s.consumers.get(2).response == "401" and s.consumeCommits == 1 and invariant)
  run concurrentConsumesHaveOneWinnerTest = browser.then(stored(1)).then(issue(1))
    .then(beginConsume(1, "valid")).then(beginConsume(2, "valid")).then(consumeHash(1, true)).then(consumeHash(2, true))
    .then(consumeWrite(2)).then(consumeWrite(1)).then(consumeReply(1, true)).then(consumeReply(2, true))
    .expect(s.consumers.get(2).response == "200" and s.consumers.get(1).response == "401" and invariant)
  run consumedCommitSurvivesLostReplyTest = browser.then(stored(1)).then(issue(1))
    .then(beginConsume(1, "valid")).then(consumeHash(1, true)).then(consumeWrite(1)).then(consumeReply(1, false)).then(consume(2))
    .expect(s.consumers.get(1).response == "error" and s.consumers.get(2).response == "401" and invariant)
  run wrongAudienceDoesNotConsumeTest = browser.then(stored(1)).then(issue(1))
    .then(beginConsume(1, "wrong-audience")).then(consumeHash(1, true)).then(consumeWrite(1)).then(consumeReply(1, true)).then(consume(2))
    .expect(s.consumers.get(1).response == "401" and s.consumers.get(2).response == "200" and invariant)
  run wrongTokenDoesNotTouchAssertionTest = browser.then(stored(1)).then(issue(1))
    .then(beginConsume(1, "wrong-token")).then(consumeHash(1, true)).then(consumeWrite(1)).then(consumeReply(1, true))
    .expect(s.consumeCommits == 0 and s.consumers.get(1).response == "401" and invariant)
  run badConsumeInputSendsNoDatabaseWriteTest = browser.then(beginConsume(1, "bad-input"))
    .expect(s.consumers.get(1).response == "401" and s.consumeCommits == 0 and invariant)
  run malformedConsumeBodySendsNoDatabaseWriteTest = browser.then(beginConsume(1, "bad-body"))
    .expect(s.consumers.get(1).response == "400" and s.consumeCommits == 0 and invariant)
  run consumeFailureBeforeCommitCanRetryTest = browser.then(stored(1)).then(issue(1))
    .then(beginConsume(1, "valid")).then(consumeHash(1, true)).then(consumeFailure(1)).then(consume(2))
    .expect(s.consumers.get(2).response == "200" and invariant)
  run localPollReturnsIdentityWithoutPlatformAssertionTest = init.then(configure(true, true, "callback_complete", false))
    .then(beginPoll(1, true, true, true, true)).then(flowHash(1, true)).then(readFlow(1)).then(issue(1))
    .expect(s.polls.get(1).response == "local-200" and s.generations == 0 and not(s.tokenKnown) and invariant)
  run localPollRequiresNodeIdentityTest = init.then(configure(true, false, "callback_complete", false))
    .then(beginPoll(1, true, true, true, true)).then(flowHash(1, true)).then(readFlow(1)).then(finishPoll(1, true))
    .expect(s.polls.get(1).response == "502" and s.marks == 0 and invariant)
  run wrongPollModeCannotIssueTest = init.then(configure(true, true, "callback_complete", false))
    .then(pollSnapshot(1)).then(finishPoll(1, true)).expect(s.polls.get(1).response == "403" and invariant)
  run pendingCallbackReturnsPendingTest = init.then(configure(false, true, "callback_processing", false))
    .then(pollSnapshot(1)).then(finishPoll(1, true)).expect(s.polls.get(1).response == "202" and s.generations == 0 and invariant)
  run failedCallbackCannotIssueTest = init.then(configure(false, true, "callback_failed", false))
    .then(pollSnapshot(1)).then(finishPoll(1, true)).expect(s.polls.get(1).response == "410" and invariant)
  run conflictingInsertReusesOriginalTimestampsTest = browser.then(stored(1)).then(tick).then(stored(2))
    .expect(s.generations == 1 and s.polls.get(2).readCreated == 0 and s.polls.get(2).readExpiry == 2 and invariant)
  run futureCreatedReadbackRefusesEarlierPollTest = browser.then(insertionReady(1)).then(tick).then(stored(2))
    .then(insertAssertion(1)).then(insertReply(1, "ok")).then(readAssertion(1, true)).then(validateAssertion(1, true)).then(finishPoll(1, true))
    .expect(s.polls.get(1).response == "503" and invariant)
  run mismatchedIdentityReadbackRefusesTest = browser.then(insertionReady(1)).then(insertAssertion(1)).then(insertReply(1, "ok"))
    .then(readAssertion(1, false)).then(finishPoll(1, true)).expect(s.polls.get(1).response == "503" and invariant)
  run invalidTimestampReadbackRefusesTest = browser.then(insertionReady(1)).then(insertAssertion(1)).then(insertReply(1, "ok"))
    .then(readAssertion(1, true)).then(validateAssertion(1, false)).then(finishPoll(1, true))
    .expect(s.polls.get(1).response == "503" and invariant)
  run consumedReadbackCannotRearmExistingRowTest = browser.then(insertionReady(2)).then(stored(1)).then(issue(1)).then(consume(1))
    .then(insertAssertion(2)).then(insertReply(2, "ok")).then(readAssertion(2, true)).then(finishPoll(2, true))
    .expect(s.polls.get(2).response == "503" and s.assertionConsumed and invariant)
  run expiredOrphanIsNotRefreshedByConflictTest = init.then(configure(false, true, "callback_complete", true))
    .then(tick).then(tick).then(stored(1)).then(finishPoll(1, true))
    .expect(s.polls.get(1).response == "503" and s.assertionExpiry == 2 and invariant)
  run parentCanRecreateExpiredUnissuedAssertionAfterCleanupTest = init.then(configure(false, true, "callback_complete", true))
    .then(tick).then(tick).then(clean).then(stored(1))
    .expect(s.generations == 2 and s.assertionCreated == 2 and s.assertionExpiry == 4 and invariant)
  run missingIssueCountKeepsCommittedIssuedStateTest = browser.then(stored(1)).then(issueClock(1)).then(issueWrite(1))
    .then(issueReply(1, "missing-count")).then(finishPoll(1, true)).then(pollSnapshot(2)).then(finishPoll(2, true))
    .expect(s.marks == 1 and s.polls.get(1).response == "410" and s.polls.get(2).response == "410" and invariant)
  run lostIssueReplyDoesNotReopenFlowTest = browser.then(stored(1)).then(issueClock(1)).then(issueWrite(1))
    .then(issueReply(1, "error")).then(finishPoll(1, true)).then(pollSnapshot(2)).then(finishPoll(2, true))
    .expect(s.marks == 1 and not(s.tokenKnown) and s.polls.get(2).response == "410" and invariant)
  run delayedPollMayReturnExpiredAssertionTest = browser.then(stored(1)).then(tick).then(tick).then(issue(1)).then(consume(1))
    .expect(s.polls.get(1).response == "browser-200" and s.consumers.get(1).response == "401" and invariant)
  run expiredFlowRefusesFreshIssueStampTest = browser.then(stored(1)).then(tick).then(tick).then(tick).then(tick).then(tick)
    .then(issue(1)).expect(s.polls.get(1).response == "410" and s.marks == 0 and invariant)
  run capturedIssueStampCanCommitAfterClockExpiryTest = browser.then(stored(1)).then(issueClock(1))
    .then(tick).then(tick).then(tick).then(tick).then(tick).then(issueWrite(1)).then(issueReply(1, "ok")).then(finishPoll(1, true))
    .expect(s.now == flowExpiry and s.polls.get(1).response == "browser-200" and invariant)
  run insertedAssertionCanSurviveFailedInsertReplyTest = browser.then(insertionReady(1)).then(insertAssertion(1))
    .then(insertReply(1, "error")).then(finishPoll(1, true)).then(stored(2))
    .expect(s.generations == 1 and s.polls.get(1).response == "error" and invariant)
  run cleanupBeforeReadbackMakesAssertionUnavailableTest = browser.then(insertionReady(1)).then(insertAssertion(1)).then(insertReply(1, "ok"))
    .then(tick).then(tick).then(clean).then(readAssertion(1, true)).then(finishPoll(1, true))
    .expect(s.polls.get(1).response == "503" and invariant)
  run fixedParentFencePreventsTokenResurrectionTest = browser.then(stored(1)).then(tick).then(insertionReady(2))
    .then(issue(1)).then(consume(1)).then(tick).then(clean).then(insertAssertion(2)).then(insertReply(2, "ok"))
    .then(readAssertion(2, true)).then(finishPoll(2, true)).then(consume(2))
    .expect(not(s.assertionPresent) and s.generations == 1 and s.consumeCommits == 1
      and s.consumers.get(2).response == "401" and invariant)
  run historicalUnfencedRecreationPermitsReplayNegativeControlTest = browser.then(stored(1)).then(tick).then(insertionReady(2))
    .then(issue(1)).then(consume(1)).then(tick).then(clean).then(historicalUnfencedInsert(2)).then(insertReply(2, "ok"))
    .then(readAssertion(2, true)).then(validateAssertion(2, true)).then(issue(2)).then(consume(2))
    .expect(s.polls.get(2).response == "410" and s.consumeCommits == 2 and not(tokenOnce))
}
