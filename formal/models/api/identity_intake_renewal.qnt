// @source workers/identity/index.ts
// @source migrations/0006_private_intake_status.sql
// @evidence scripts/identity-maintenance.test.ts
// @evidence workers/identity/private-intake-renewal.test.ts
// Two invocations, timestamps0..2, at most two fetches each. Scheduled renewal
// captures the invocation clock; a direct call samples after body validation.
// HTTP/token/body classes abstract wire parsing and provider truth. Disposal
// records an attempt, not proof that a failed native cancellation released all
// resources. Rejected/over-limit/invalid replies do not refresh the singleton.
// A valid disabled observation does. SQL only replaces an older timestamp;
// renewed describes the candidate, not whether it replaced the retained row.
// A false database success flag and thrown/lost reply both reject the call,
// but do not prove no write committed. No execution is claimed by this model.
module identity_intake_renewal {
  val ids = Set(1, 2)
  val tokenKinds = Set("absent", "malformed", "valid")
  val replies = Set("ok", "unreachable", "rate-limited", "unauthorized", "rejected")
  type Renewal = { phase: str, token: str, tokenRejected: bool, fetches: int,
    stamp: int, lateClock: bool, candidate: bool, attempted: bool, applied: bool,
    status: str, reason: str, nextAfterDispose: str,
    responses: Set[int], bodyReads: Set[int], cancelAttempts: Set[int], cancelFailures: Set[int] }
  val unused: Renewal = { phase: "unused", token: "absent", tokenRejected: false, fetches: 0,
    stamp: 0, lateClock: false, candidate: false, attempted: false, applied: false,
    status: "none", reason: "none", nextAfterDispose: "none",
    responses: Set(), bodyReads: Set(), cancelAttempts: Set(), cancelFailures: Set() }
  var s: { now: int, storedAt: int, storedEnabled: bool, storedBy: int, requests: int -> Renewal }
  action init = s' = { now: 0, storedAt: -1, storedEnabled: false, storedBy: 0,
    requests: ids.mapBy(_ => unused) }
  action tick = all { s.now < 2, s' = s.with("now", s.now + 1) }
  action start(id: int, token: str, lateClock: bool): bool = all {
    ids.contains(id), tokenKinds.contains(token), s.requests.get(id).phase == "unused",
    s' = s.with("requests", s.requests.set(id, unused
      .with("phase", if (token == "valid") "authenticated" else "anonymous")
      .with("token", token).with("tokenRejected", token == "malformed")
      .with("fetches", 1).with("stamp", s.now).with("lateClock", lateClock))) }
  action begin(id: int, token: str): bool = start(id, token, false)
  action beginDirect(id: int, token: str): bool = start(id, token, true)
  action fetchReply(id: int, result: str): bool = {
    val request = s.requests.get(id)
    val fallback = request.phase == "authenticated" and result == "unauthorized"
    val observed = request.with("responses", if (result == "unreachable") request.responses
      else request.responses.union(Set(request.fetches)))
    all { ids.contains(id), Set("authenticated", "anonymous").contains(request.phase), replies.contains(result),
      s' = s.with("requests", s.requests.set(id,
        if (result == "unreachable") observed.with("phase", "done").with("status", "skipped").with("reason", result)
        else if (result == "ok") observed.with("phase", "body")
        else observed.with("phase", "discard").with("reason", result)
          .with("tokenRejected", request.tokenRejected or fallback)
          .with("nextAfterDispose", if (fallback) "anonymous" else "done"))) }
  }
  action disposeReply(id: int, succeeds: bool): bool = {
    val request = s.requests.get(id)
    val fallback = request.nextAfterDispose == "anonymous"
    all { request.phase == "discard",
      s' = s.with("requests", s.requests.set(id, request
        .with("cancelAttempts", request.cancelAttempts.union(Set(request.fetches)))
        .with("cancelFailures", if (succeeds) request.cancelFailures else request.cancelFailures.union(Set(request.fetches)))
        .with("phase", request.nextAfterDispose)
        .with("fetches", if (fallback) 2 else request.fetches)
        .with("status", if (fallback) "none" else "skipped"))) }
  }
  action body(id: int, valid: bool, isEnabled: bool): bool = {
    val request = s.requests.get(id)
    val read = request.with("bodyReads", request.bodyReads.union(Set(request.fetches)))
    all { ids.contains(id), request.phase == "body",
      s' = s.with("requests", s.requests.set(id,
        if (valid) read.with("phase", "write").with("candidate", isEnabled)
          .with("stamp", if (request.lateClock) s.now else request.stamp)
        else read.with("phase", "done").with("status", "skipped").with("reason", "malformed"))) }
  }
  action commitWrite(id: int): bool = {
    val request = s.requests.get(id)
    val newer = request.stamp > s.storedAt
    all { ids.contains(id), request.phase == "write",
      s' = s.with("storedAt", if (newer) request.stamp else s.storedAt)
        .with("storedEnabled", if (newer) request.candidate else s.storedEnabled)
        .with("storedBy", if (newer) id else s.storedBy)
        .with("requests", s.requests.set(id, request.with("phase", "committed")
          .with("attempted", true).with("applied", newer))) }
  }
  action writeFailure(id: int): bool = {
    val request = s.requests.get(id)
    all { ids.contains(id), request.phase == "write",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "done")
        .with("attempted", true).with("status", "rejected").with("reason", "write"))) }
  }
  action writeReply(id: int, success: bool): bool = {
    val request = s.requests.get(id)
    all { ids.contains(id), request.phase == "committed",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "done")
        .with("status", if (success) "renewed" else "rejected")
        .with("reason", if (success) "none" else "write"))) }
  }
  action step = {
    nondet id = ids.oneOf() nondet token = tokenKinds.oneOf() nondet result = replies.oneOf()
    nondet yes = Set(false, true).oneOf()
    any { tick, begin(id, token), beginDirect(id, token), fetchReply(id, result), disposeReply(id, yes),
      body(id, yes, yes), body(id, yes, not(yes)), commitWrite(id), writeFailure(id), writeReply(id, yes), s' = s }
  }
  val invariant = {
    val stored = if (ids.contains(s.storedBy)) s.requests.get(s.storedBy) else unused
    all { s.now >= 0, s.now <= 2, s.storedAt <= s.now,
      s.storedBy == 0 implies s.storedAt == -1,
      s.storedBy != 0 implies stored.applied and s.storedAt == stored.stamp and s.storedEnabled == stored.candidate,
      ids.forall(id => { val request = s.requests.get(id)
        all { request.fetches >= 0, request.fetches <= 2,
          request.fetches == 2 implies request.token == "valid" and request.tokenRejected and request.cancelAttempts.contains(1),
          request.status == "renewed" implies request.phase == "done" and request.attempted,
          request.status == "skipped" implies not(request.attempted) and not(request.applied),
          request.applied implies request.attempted,
          request.phase == "done" implies request.responses.subseteq(request.bodyReads.union(request.cancelAttempts)),
          request.cancelFailures.subseteq(request.cancelAttempts) } }) }
  }
  action observed(id: int, value: bool): bool = fetchReply(id, "ok").then(body(id, true, value))
  action persisted(id: int): bool = commitWrite(id).then(writeReply(id, true))
  action refused(id: int, reason: str): bool = fetchReply(id, reason).then(disposeReply(id, true))

  run anonymousEnabledObservationRenewsTest = init.then(begin(1, "absent")).then(observed(1, true)).then(persisted(1))
    .expect(s.storedEnabled and s.requests.get(1).status == "renewed" and invariant)
  run validTokenObservationRenewsTest = init.then(begin(1, "valid")).then(observed(1, true)).then(persisted(1))
    .expect(s.requests.get(1).fetches == 1 and not(s.requests.get(1).tokenRejected) and invariant)
  run malformedTokenUsesAnonymousWithoutSendingTokenTest = init.then(begin(1, "malformed")).then(observed(1, true)).then(persisted(1))
    .expect(s.requests.get(1).tokenRejected and s.requests.get(1).fetches == 1 and invariant)
  run unauthorizedTokenGetsOneAnonymousRetryTest = init.then(begin(1, "valid")).then(refused(1, "unauthorized"))
    .then(observed(1, true)).then(persisted(1)).expect(s.requests.get(1).fetches == 2 and s.requests.get(1).tokenRejected and invariant)
  run rateLimitedTokenDoesNotFallBackTest = init.then(begin(1, "valid")).then(refused(1, "rate-limited"))
    .expect(s.requests.get(1).status == "skipped" and s.requests.get(1).fetches == 1 and not(s.requests.get(1).tokenRejected) and invariant)
  run unreachableTokenDoesNotFallBackTest = init.then(begin(1, "valid")).then(fetchReply(1, "unreachable"))
    .expect(s.requests.get(1).reason == "unreachable" and s.requests.get(1).responses == Set() and invariant)
  run anonymousRetryCannotRecurseTest = init.then(begin(1, "valid")).then(refused(1, "unauthorized")).then(refused(1, "unauthorized"))
    .expect(s.requests.get(1).status == "skipped" and s.requests.get(1).fetches == 2 and invariant)
  run invalidBodySkipsWithoutWriteTest = init.then(begin(1, "absent")).then(fetchReply(1, "ok")).then(body(1, false, true))
    .expect(s.requests.get(1).reason == "malformed" and s.storedAt == -1 and invariant)
  run validDisabledObservationIsRenewedTest = init.then(begin(1, "absent")).then(observed(1, false)).then(persisted(1))
    .expect(s.requests.get(1).status == "renewed" and not(s.storedEnabled) and invariant)
  run writeFailureRetainsEarlierObservationTest = init.then(begin(1, "absent")).then(observed(1, true)).then(persisted(1)).then(tick)
    .then(begin(2, "absent")).then(observed(2, false)).then(writeFailure(2))
    .expect(s.storedAt == 0 and s.storedEnabled and s.requests.get(2).status == "rejected" and invariant)
  run failedWriteReplyDoesNotUndoObservationTest = init.then(begin(1, "absent")).then(observed(1, false)).then(commitWrite(1)).then(writeReply(1, false))
    .expect(s.storedAt == 0 and not(s.storedEnabled) and s.requests.get(1).status == "rejected" and invariant)
  run olderCandidateReturnsRenewedWithoutReplacingNewerTest = init.then(begin(1, "absent")).then(tick)
    .then(begin(2, "absent")).then(observed(2, true)).then(persisted(2)).then(observed(1, false)).then(persisted(1))
    .expect(s.storedAt == 1 and s.storedEnabled and not(s.requests.get(1).applied) and invariant)
  run equalTimestampPreservesFirstStoredValueTest = init.then(begin(1, "absent")).then(begin(2, "absent"))
    .then(observed(1, false)).then(persisted(1)).then(observed(2, true)).then(persisted(2))
    .expect(not(s.storedEnabled) and not(s.requests.get(2).applied) and invariant)
  run laterValidObservationReplacesDisabledValueTest = init.then(begin(1, "absent")).then(observed(1, false)).then(persisted(1)).then(tick)
    .then(begin(2, "absent")).then(observed(2, true)).then(persisted(2)).expect(s.storedEnabled and s.storedAt == 1 and invariant)
  run skipPreservesPreviousObservationTest = init.then(begin(1, "absent")).then(observed(1, true)).then(persisted(1)).then(tick)
    .then(begin(2, "absent")).then(refused(2, "rejected")).expect(s.storedEnabled and s.storedAt == 0 and invariant)
  run retryAfterFailureCanRenewTest = init.then(begin(1, "absent")).then(fetchReply(1, "unreachable")).then(tick)
    .then(begin(2, "absent")).then(observed(2, true)).then(persisted(2)).expect(s.storedAt == 1 and invariant)
  run fallbackWaitsForDisposalTest = init.then(begin(1, "valid")).then(fetchReply(1, "unauthorized"))
    .expect(s.requests.get(1).phase == "discard" and s.requests.get(1).fetches == 1)
  run failedCancellationStillFallsBackTest = init.then(begin(1, "valid")).then(fetchReply(1, "unauthorized")).then(disposeReply(1, false))
    .then(observed(1, true)).then(persisted(1)).expect(s.requests.get(1).cancelFailures == Set(1) and invariant)
  run finalRefusalWaitsForDisposalTest = init.then(begin(1, "absent")).then(fetchReply(1, "rejected"))
    .expect(s.requests.get(1).status == "none" and s.requests.get(1).phase == "discard")
  run finalCancellationFailurePreservesRefusalTest = init.then(begin(1, "absent")).then(fetchReply(1, "rejected")).then(disposeReply(1, false))
    .expect(s.requests.get(1).status == "skipped" and s.requests.get(1).reason == "rejected" and invariant)
  run directClockSamplesAfterBodyTest = init.then(beginDirect(1, "absent")).then(fetchReply(1, "ok")).then(tick).then(body(1, true, true)).then(persisted(1))
    .expect(s.storedAt == 1 and invariant)
  run scheduledClockStaysCapturedTest = init.then(begin(1, "absent")).then(fetchReply(1, "ok")).then(tick).then(body(1, true, true)).then(persisted(1))
    .expect(s.storedAt == 0 and invariant)
  run bothHttpResponsesAccountedForTest = init.then(begin(1, "valid")).then(refused(1, "unauthorized")).then(refused(1, "rate-limited"))
    .expect(s.requests.get(1).responses == Set(1, 2) and s.requests.get(1).cancelAttempts == Set(1, 2) and invariant)
  run falseDatabaseResultNeverRenewsTest = init.then(begin(1, "absent")).then(observed(1, true)).then(writeFailure(1))
    .expect(s.requests.get(1).status == "rejected" and s.storedAt == -1 and invariant)
}
