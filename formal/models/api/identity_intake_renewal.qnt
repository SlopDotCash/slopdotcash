// @source workers/identity/index.ts
// @source migrations/0006_private_intake_status.sql
// @evidence scripts/identity-maintenance.test.ts
// Worker renewal only; operator_intake_renewal keeps the separate CLI outcome.
// Two invocations, caller-captured timestamp ranks 0..2, and at most two fetches
// per invocation. Timestamp ranks represent the SQL comparison of canonical
// ISO strings. The scheduled caller freezes its Date before network awaits;
// the default direct helper's later clock sampling is outside this bound.
// HTTP/token/body classes are predicates, not parser, credential or network
// proofs. A valid disabled answer is renewed. Renewed does not imply the
// conditional SQL write replaced a newer/equal stored observation.
module identity_intake_renewal {
  val ids = Set(1, 2)
  val tokenKinds = Set("absent", "malformed", "valid")
  val replies = Set("ok", "unreachable", "rate-limited", "unauthorized", "rejected")
  type Renewal = { phase: str, token: str, tokenRejected: bool, fetches: int,
    stamp: int, candidate: bool, attempted: bool, applied: bool, status: str, reason: str }
  val unused: Renewal = { phase: "unused", token: "absent", tokenRejected: false, fetches: 0,
    stamp: 0, candidate: false, attempted: false, applied: false, status: "none", reason: "none" }
  var s: { now: int, storedAt: int, storedEnabled: bool, storedBy: int, requests: int -> Renewal }
  action init = s' = { now: 0, storedAt: -1, storedEnabled: false, storedBy: 0,
    requests: ids.mapBy(_ => unused) }
  action tick = all { s.now < 2, s' = s.with("now", s.now + 1) }
  action begin(id: int, token: str): bool = all {
    ids.contains(id), tokenKinds.contains(token), s.requests.get(id).phase == "unused",
    s' = s.with("requests", s.requests.set(id, unused
      .with("phase", if (token == "valid") "authenticated" else "anonymous")
      .with("token", token).with("tokenRejected", token == "malformed")
      .with("fetches", 1).with("stamp", s.now))) }
  action fetchReply(id: int, result: str): bool = {
    val request = s.requests.get(id)
    val fallback = request.phase == "authenticated" and result == "unauthorized"
    all { ids.contains(id), Set("authenticated", "anonymous").contains(request.phase), replies.contains(result),
      s' = s.with("requests", s.requests.set(id,
        if (fallback) request.with("phase", "anonymous").with("fetches", 2).with("tokenRejected", true)
        else if (result == "ok") request.with("phase", "body")
        else request.with("phase", "done").with("status", "skipped").with("reason", result))) }
  }
  action body(id: int, valid: bool, isEnabled: bool): bool = {
    val request = s.requests.get(id)
    all { ids.contains(id), request.phase == "body",
      s' = s.with("requests", s.requests.set(id,
        if (valid) request.with("phase", "write").with("candidate", isEnabled)
        else request.with("phase", "done").with("status", "skipped").with("reason", "malformed"))) }
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
  action writeReply(id: int, received: bool): bool = {
    val request = s.requests.get(id)
    all { ids.contains(id), request.phase == "committed",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "done")
        .with("status", if (received) "renewed" else "rejected")
        .with("reason", if (received) "none" else "write"))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet token = tokenKinds.oneOf()
    nondet result = replies.oneOf()
    nondet valid = Set(false, true).oneOf()
    nondet isEnabled = Set(false, true).oneOf()
    any { tick, begin(id, token), fetchReply(id, result), body(id, valid, isEnabled),
      commitWrite(id), writeFailure(id), writeReply(id, valid), s' = s }
  }
  val invariant = {
    val stored = if (ids.contains(s.storedBy)) s.requests.get(s.storedBy) else unused
    all {
      s.now >= 0, s.now <= 2, s.storedAt <= s.now,
      s.storedBy == 0 implies s.storedAt == -1,
      s.storedBy != 0 implies stored.applied and s.storedAt == stored.stamp and s.storedEnabled == stored.candidate,
      ids.forall(id => {
        val request = s.requests.get(id)
        all {
          request.fetches >= 0, request.fetches <= 2,
          request.fetches == 2 implies request.token == "valid" and request.tokenRejected,
          request.status == "renewed" implies request.phase == "done" and request.attempted,
          request.status == "skipped" implies not(request.attempted) and not(request.applied),
          request.applied implies request.attempted }
      }) }
  }

  run anonymousEnabledObservationRenewsTest = init.then(begin(1, "absent")).then(fetchReply(1, "ok"))
    .then(body(1, true, true)).then(commitWrite(1)).then(writeReply(1, true))
    .expect(s.storedEnabled and s.requests.get(1).status == "renewed" and invariant)
  run validTokenObservationRenewsTest = init.then(begin(1, "valid")).then(fetchReply(1, "ok"))
    .then(body(1, true, true)).then(commitWrite(1)).then(writeReply(1, true))
    .expect(s.requests.get(1).fetches == 1 and not(s.requests.get(1).tokenRejected) and invariant)
  run malformedTokenUsesAnonymousWithoutSendingTokenTest = init.then(begin(1, "malformed"))
    .then(fetchReply(1, "ok")).then(body(1, true, true)).then(commitWrite(1)).then(writeReply(1, true))
    .expect(s.requests.get(1).tokenRejected and s.requests.get(1).fetches == 1 and invariant)
  run unauthorizedTokenGetsOneAnonymousRetryTest = init.then(begin(1, "valid"))
    .then(fetchReply(1, "unauthorized")).then(fetchReply(1, "ok")).then(body(1, true, true))
    .then(commitWrite(1)).then(writeReply(1, true))
    .expect(s.requests.get(1).fetches == 2 and s.requests.get(1).tokenRejected and invariant)
  run rateLimitedTokenDoesNotFallBackTest = init.then(begin(1, "valid")).then(fetchReply(1, "rate-limited"))
    .expect(s.requests.get(1).status == "skipped" and s.requests.get(1).fetches == 1
      and not(s.requests.get(1).tokenRejected) and s.storedAt == -1 and invariant)
  run unreachableTokenDoesNotFallBackTest = init.then(begin(1, "valid")).then(fetchReply(1, "unreachable"))
    .expect(s.requests.get(1).reason == "unreachable" and s.requests.get(1).fetches == 1 and invariant)
  run anonymousRetryCannotRecurseTest = init.then(begin(1, "valid")).then(fetchReply(1, "unauthorized"))
    .then(fetchReply(1, "unauthorized")).expect(s.requests.get(1).status == "skipped"
      and s.requests.get(1).tokenRejected and s.requests.get(1).fetches == 2 and invariant)
  run invalidBodySkipsWithoutWriteTest = init.then(begin(1, "absent")).then(fetchReply(1, "ok"))
    .then(body(1, false, true)).expect(s.requests.get(1).reason == "malformed"
      and not(s.requests.get(1).attempted) and s.storedAt == -1 and invariant)
  run validDisabledObservationIsRenewedTest = init.then(begin(1, "absent")).then(fetchReply(1, "ok"))
    .then(body(1, true, false)).then(commitWrite(1)).then(writeReply(1, true))
    .expect(s.requests.get(1).status == "renewed" and s.storedAt == 0 and not(s.storedEnabled) and invariant)
  run writeFailureRetainsEarlierObservationTest = init.then(begin(1, "absent")).then(fetchReply(1, "ok"))
    .then(body(1, true, true)).then(commitWrite(1)).then(writeReply(1, true)).then(tick)
    .then(begin(2, "absent")).then(fetchReply(2, "ok")).then(body(2, true, false)).then(writeFailure(2))
    .expect(s.storedAt == 0 and s.storedEnabled and s.requests.get(2).status == "rejected" and invariant)
  run failedWriteReplyDoesNotUndoObservationTest = init.then(begin(1, "absent")).then(fetchReply(1, "ok"))
    .then(body(1, true, false)).then(commitWrite(1)).then(writeReply(1, false))
    .expect(s.storedAt == 0 and not(s.storedEnabled) and s.requests.get(1).status == "rejected" and invariant)
  run olderCandidateReturnsRenewedWithoutReplacingNewerTest = init.then(begin(1, "absent")).then(tick)
    .then(begin(2, "absent")).then(fetchReply(2, "ok")).then(body(2, true, true))
    .then(commitWrite(2)).then(writeReply(2, true)).then(fetchReply(1, "ok")).then(body(1, true, false))
    .then(commitWrite(1)).then(writeReply(1, true)).expect(s.storedAt == 1 and s.storedEnabled
      and s.requests.get(1).status == "renewed" and not(s.requests.get(1).applied) and invariant)
  run equalTimestampPreservesFirstStoredValueTest = init.then(begin(1, "absent")).then(begin(2, "absent"))
    .then(fetchReply(1, "ok")).then(body(1, true, false)).then(commitWrite(1)).then(writeReply(1, true))
    .then(fetchReply(2, "ok")).then(body(2, true, true)).then(commitWrite(2)).then(writeReply(2, true))
    .expect(not(s.storedEnabled) and s.requests.get(2).status == "renewed"
      and not(s.requests.get(2).applied) and invariant)
  run laterValidObservationReplacesDisabledValueTest = init.then(begin(1, "absent")).then(fetchReply(1, "ok"))
    .then(body(1, true, false)).then(commitWrite(1)).then(writeReply(1, true)).then(tick)
    .then(begin(2, "absent")).then(fetchReply(2, "ok")).then(body(2, true, true))
    .then(commitWrite(2)).then(writeReply(2, true)).expect(s.storedEnabled and s.storedAt == 1 and invariant)
  run skipPreservesPreviousObservationTest = init.then(begin(1, "absent")).then(fetchReply(1, "ok"))
    .then(body(1, true, true)).then(commitWrite(1)).then(writeReply(1, true)).then(tick)
    .then(begin(2, "absent")).then(fetchReply(2, "rejected"))
    .expect(s.storedEnabled and s.storedAt == 0 and s.requests.get(2).status == "skipped" and invariant)
  run retryAfterFailureCanRenewTest = init.then(begin(1, "absent")).then(fetchReply(1, "unreachable"))
    .then(tick).then(begin(2, "absent")).then(fetchReply(2, "ok")).then(body(2, true, true))
    .then(commitWrite(2)).then(writeReply(2, true)).expect(s.storedAt == 1 and s.storedEnabled and invariant)
}
