// @source src/lib/identity-flow.ts
// @source src/lib/verified-frontend.ts
// @source src/Points.tsx
// @source src/lib/local-signin.ts
// @evidence tests/e2e/account-closure-integration.spec.ts
// @evidence tests/e2e/login.spec.ts
// One helper invocation, fresh or resumed, and at most two poll replies. The
// application has no two-poll limit: later loop iterations are outside this
// finite prefix. Time ranks 0..8 preserve comparisons, not milliseconds;
// flow expiry is rank 6. Initial/updated intervals retain exact integer bounds
// 1..10; timer duration arithmetic is abstracted by identityPollDelay's contract.
// Start-body classes stand for canonical timestamps, expiry/skew, ids, bound
// authorization URL and interval predicates. Request adapters, popup navigation,
// storage effects, schema parsing and server effects are external. Hook success
// does not imply sessionStorage persisted or erased anything.
// A resolved request after abort is allowed by this helper's injected-request
// contract. Points uses an aborting fetch adapter and also checks the signal
// before exchanging the returned assertion. Neither cancellation nor a local
// timeout is assumed to undo an already accepted server write.
// Time and abort events interleave at awaits. A setup callback may synchronously
// abort too (modeled by abortFromHook), without inventing browser event turns
// between synchronous statements. No fairness, provider success or retry promise.
module ui_identity_poll_protocol {
  val intervals = 1.to(10)
  val startClasses = Set("valid", "missing", "non-record", "expired", "future", "flow-id", "capability", "url", "interval")
  val flowExpiry = 6
  var s: { phase: str, now: int, resumed: bool, hook: bool, aborted: bool, mounted: bool,
    startRequests: int, polls: int, baseInterval: int, interval: int,
    authorizationCalls: int, saveCalls: int, clearCalls: int,
    storageIntent: str, receivedAssertion: bool, assertionExpiry: int, validatedAt: int,
    returnedAssertion: bool, joinRequested: bool, result: str, reason: str }
  action init = s' = { phase: "setup", now: 0, resumed: false, hook: false, aborted: false, mounted: true,
    startRequests: 0, polls: 0, baseInterval: 1, interval: 1,
    authorizationCalls: 0, saveCalls: 0, clearCalls: 0,
    storageIntent: "none", receivedAssertion: false, assertionExpiry: -1, validatedAt: -1,
    returnedAssertion: false, joinRequested: false, result: "pending", reason: "none" }
  action begin(resumed: bool, hook: bool, originValid: bool, interval: int): bool = all {
    s.phase == "setup", intervals.contains(interval),
    s' = s.with("resumed", resumed).with("hook", hook).with("baseInterval", interval).with("interval", interval)
      .with("startRequests", if (originValid and not(resumed)) 1 else 0)
      .with("phase", if (not(originValid)) "failed" else if (resumed) "resume" else "start")
      .with("result", if (originValid) "pending" else "error")
      .with("reason", if (originValid) "none" else "origin") }
  action tick = all { Set("start", "delay", "poll").contains(s.phase), s.now < 8,
    s' = s.with("now", s.now + 1) }
  action abort = all { Set("start", "delay", "poll", "returned").contains(s.phase), not(s.aborted),
    s' = s.with("aborted", true)
      .with("phase", if (s.phase == "delay") "failed" else s.phase)
      .with("result", if (s.phase == "delay") "error" else s.result)
      .with("reason", if (s.phase == "delay") "cancelled" else s.reason) }
  action startReply(kind: str): bool = {
    val valid = kind == "valid" and s.now < flowExpiry
    all { Set("start", "resume").contains(s.phase), startClasses.contains(kind),
      s' = s.with("phase", if (valid) "save-start" else "failed")
        .with("result", if (valid) "pending" else "error")
        .with("reason", if (valid) "none" else if (s.now >= flowExpiry) "expired" else kind) }
  }
  action saveStart(ok: bool): bool = all { s.phase == "save-start",
    s' = s.with("saveCalls", if (s.hook) 1 else 0)
      .with("storageIntent", if (s.hook) "retain-authorization" else "none")
      .with("phase", if (s.hook and not(ok)) "failed" else if (s.resumed) "loop" else "authorize")
      .with("result", if (s.hook and not(ok)) "error" else "pending")
      .with("reason", if (s.hook and not(ok)) "save-hook" else "none") }
  action abortFromHook = all { Set("save-start", "authorize", "clear").contains(s.phase),
    s.hook or s.phase == "authorize", not(s.aborted), s' = s.with("aborted", true) }
  // A synchronous callback can take time; expiry validation is an observation,
  // not a guarantee that a caller-owned hook completes before the deadline.
  action timeInHook = all { Set("save-start", "authorize", "clear").contains(s.phase),
    s.hook or s.phase == "authorize", s.now < 8, s' = s.with("now", s.now + 1) }
  action authorize(ok: bool): bool = all { s.phase == "authorize",
    s' = s.with("authorizationCalls", 1).with("phase", if (ok) "loop" else "failed")
      .with("result", if (ok) "pending" else "error")
      .with("reason", if (ok) "none" else "authorization-hook") }
  action scheduleDelay = all { s.phase == "loop",
    s' = s.with("phase", if (s.now >= flowExpiry or s.aborted) "failed" else "delay")
      .with("result", if (s.now >= flowExpiry or s.aborted) "error" else "pending")
      .with("reason", if (s.now >= flowExpiry) "expired" else if (s.aborted) "cancelled" else "none") }
  action timerFires = all { s.phase == "delay", not(s.aborted),
    s.now >= flowExpiry or s.polls < 2,
    s' = s.with("phase", if (s.now >= flowExpiry) "failed" else "poll")
      .with("polls", if (s.now >= flowExpiry) s.polls else s.polls + 1)
      .with("result", if (s.now >= flowExpiry) "error" else "pending")
      .with("reason", if (s.now >= flowExpiry) "expired" else "none") }
  action requestFails = all { Set("start", "poll").contains(s.phase),
    s' = s.with("phase", "failed").with("result", "error").with("reason", "request") }
  action pollPending(interval: int): bool = {
    val valid = interval >= s.baseInterval and interval <= 10
    all { s.phase == "poll", 0 <= interval, interval <= 11,
      s' = s.with("interval", if (valid) interval else s.interval)
        .with("phase", if (valid) "loop" else "failed")
        .with("result", if (valid) "pending" else "error")
        .with("reason", if (valid) "none" else "retry-interval") }
  }
  action pollRefuses = all { s.phase == "poll",
    s' = s.with("phase", "failed").with("result", "error").with("reason", "poll-shape-or-status") }
  action pollComplete(valid: bool, expires: int): bool = {
    val accepted = valid and expires > s.now
    all { s.phase == "poll", 0 <= expires, expires <= 8,
      s' = s.with("receivedAssertion", valid).with("assertionExpiry", expires).with("validatedAt", s.now)
        .with("phase", if (accepted) "clear" else "failed")
        .with("result", if (accepted) "pending" else "error")
        .with("reason", if (not(valid)) "assertion-shape" else if (not(accepted)) "assertion-expired" else "none") }
  }
  action clearAuthorization(ok: bool): bool = {
    val completed = not(s.hook) or ok
    all { s.phase == "clear",
      s' = s.with("clearCalls", if (s.hook) 1 else 0)
        .with("storageIntent", if (s.hook) "clear-authorization" else s.storageIntent)
        .with("returnedAssertion", completed).with("phase", if (completed) "returned" else "failed")
        .with("result", if (completed) "assertion" else "error")
        .with("reason", if (completed) "none" else "clear-hook") }
  }
  // JoinPoints aborts during committed removal, including after the helper
  // resolved but before its caller resumes. Accepted POSTs are not undone.
  action depart = all { s.mounted, not(s.joinRequested),
    Set("start", "resume", "save-start", "authorize", "loop", "delay", "poll", "clear", "returned").contains(s.phase),
    s' = s.with("mounted", false).with("aborted", true) }
  // This is Points.start's guard before /points/join, not a session result.
  action parentGuard = all { s.phase == "returned",
    s' = s.with("phase", if (s.aborted) "discarded" else "join-requested")
      .with("joinRequested", not(s.aborted)) }
  action step = {
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet third = Set(false, true).oneOf()
    nondet interval = intervals.oneOf()
    nondet retry = 0.to(11).oneOf()
    nondet kind = startClasses.oneOf()
    nondet expires = 0.to(8).oneOf()
    any { begin(yes, other, third, interval), tick, abort, startReply(kind), saveStart(yes),
      abortFromHook, timeInHook, authorize(yes), scheduleDelay, timerFires, requestFails,
      pollPending(retry), pollRefuses, pollComplete(yes, expires), clearAuthorization(yes),
      depart, parentGuard, s' = s }
  }
  val invariant = all {
    s.now >= 0, s.now <= 8, s.startRequests >= 0, s.startRequests <= 1,
    s.polls >= 0, s.polls <= 2, intervals.contains(s.interval),
    s.resumed implies s.startRequests == 0 and s.authorizationCalls == 0,
    s.authorizationCalls <= 1, s.saveCalls <= 1, s.clearCalls <= 1,
    s.clearCalls == 1 implies s.hook and s.receivedAssertion,
    s.returnedAssertion implies s.receivedAssertion and s.assertionExpiry > s.validatedAt,
    s.joinRequested implies s.returnedAssertion and not(s.aborted),
    s.phase == "discarded" implies s.returnedAssertion and s.aborted,
    s.result == "error" implies not(s.returnedAssertion) and not(s.joinRequested) }

  action fresh = init.then(begin(false, true, true, 2))
  action resumed = init.then(begin(true, true, true, 2))
  action waiting = startReply("valid").then(saveStart(true)).then(authorize(true)).then(scheduleDelay)
  action polling = waiting.then(timerFires)

  run freshFlowAuthorizesAndReturnsAssertionTest = fresh.then(polling).then(pollComplete(true, 3)).then(clearAuthorization(true)).then(parentGuard)
    .expect(s.joinRequested and s.startRequests == 1 and s.authorizationCalls == 1 and s.clearCalls == 1 and invariant)
  run resumeSkipsStartAndAuthorizationTest = resumed.then(startReply("valid")).then(saveStart(true)).then(scheduleDelay)
    .then(timerFires).then(pollComplete(true, 3)).then(clearAuthorization(true)).then(parentGuard)
    .expect(s.joinRequested and s.startRequests == 0 and s.authorizationCalls == 0 and invariant)
  run invalidOriginHasNoRequestsTest = init.then(begin(false, true, false, 2))
    .expect(s.result == "error" and s.startRequests == 0 and invariant)
  run absentStartBodyFailsBeforeHooksTest = fresh.then(startReply("missing"))
    .expect(s.result == "error" and s.saveCalls == 0 and s.authorizationCalls == 0 and invariant)
  run nonRecordResumeFailsBeforeHooksTest = resumed.then(startReply("non-record"))
    .expect(s.result == "error" and s.saveCalls == 0 and invariant)
  run invalidFlowIdFailsTest = fresh.then(startReply("flow-id")).expect(s.reason == "flow-id" and invariant)
  run invalidCapabilityFailsTest = fresh.then(startReply("capability")).expect(s.reason == "capability" and invariant)
  run unboundAuthorizationUrlFailsTest = fresh.then(startReply("url")).expect(s.reason == "url" and invariant)
  run excessiveStartExpiryFailsTest = fresh.then(startReply("future")).expect(s.reason == "future" and invariant)
  run invalidInitialIntervalFailsTest = fresh.then(startReply("interval")).expect(s.reason == "interval" and invariant)
  run expiredStartFailsTest = fresh.then(startReply("expired")).expect(s.reason == "expired" and invariant)
  run startResponseAtExpiryIsRejectedTest = fresh.then(tick).then(tick).then(tick).then(tick).then(tick).then(tick)
    .then(startReply("valid")).expect(s.reason == "expired" and s.saveCalls == 0 and invariant)
  run startRequestFailureHasNoAuthorizationTest = fresh.then(requestFails)
    .expect(s.reason == "request" and s.authorizationCalls == 0 and invariant)
  run retainHookFailureStopsBeforeAuthorizationTest = fresh.then(startReply("valid")).then(saveStart(false))
    .expect(s.reason == "save-hook" and s.saveCalls == 1 and s.authorizationCalls == 0 and invariant)
  run authorizationHookFailureRetainsOnlyIntentTest = fresh.then(startReply("valid")).then(saveStart(true)).then(authorize(false))
    .expect(s.reason == "authorization-hook" and s.storageIntent == "retain-authorization" and invariant)
  run abortAfterResolvedStartDoesNotInventRollbackTest = fresh.then(abort).then(waiting)
    .expect(s.reason == "cancelled" and s.startRequests == 1 and s.authorizationCalls == 1 and invariant)
  run timerAbortStopsBeforePollTest = fresh.then(waiting).then(abort)
    .expect(s.reason == "cancelled" and s.polls == 0 and invariant)
  run expiryDuringDelaySendsNoPollTest = fresh.then(waiting).then(tick).then(tick).then(tick).then(tick).then(tick).then(tick)
    .then(timerFires).expect(s.reason == "expired" and s.polls == 0 and invariant)
  run pendingReplySchedulesAnotherDelayTest = fresh.then(polling).then(pollPending(4)).then(scheduleDelay).then(timerFires)
    .then(pollComplete(true, 3)).then(clearAuthorization(true)).expect(s.polls == 2 and s.returnedAssertion and invariant)
  run retryIntervalBelowInitialIsRejectedTest = fresh.then(polling).then(pollPending(1))
    .expect(s.reason == "retry-interval" and invariant)
  run retryIntervalAboveTenIsRejectedTest = fresh.then(polling).then(pollPending(11))
    .expect(s.reason == "retry-interval" and invariant)
  run retryMayDecreaseButNotBelowInitialTest = fresh.then(polling).then(pollPending(8)).then(scheduleDelay)
    .then(timerFires).then(pollPending(4)).expect(s.interval == 4 and s.phase == "loop" and invariant)
  run malformedPollStopsWithoutClearingAuthorizationTest = fresh.then(polling).then(pollRefuses)
    .expect(s.result == "error" and s.clearCalls == 0 and invariant)
  run pollRequestFailureDoesNotAssumeServerRollbackTest = fresh.then(polling).then(requestFails)
    .expect(s.reason == "request" and s.clearCalls == 0 and invariant)
  run malformedAssertionCannotReachParentExchangeTest = fresh.then(polling).then(pollComplete(false, 3))
    .expect(s.reason == "assertion-shape" and not(s.joinRequested) and invariant)
  run assertionExpiredAtReceiptIsRejectedTest = fresh.then(polling).then(tick).then(pollComplete(true, 1))
    .expect(s.reason == "assertion-expired" and s.clearCalls == 0 and invariant)
  run liveAssertionCanArriveAfterFlowExpiryTest = fresh.then(polling).then(tick).then(tick).then(tick).then(tick).then(tick).then(tick)
    .then(pollComplete(true, 8)).then(clearAuthorization(true)).then(parentGuard)
    .expect(s.now == flowExpiry and s.joinRequested and invariant)
  run abortDuringPollCannotStartParentExchangeTest = fresh.then(polling).then(abort).then(pollComplete(true, 3))
    .then(clearAuthorization(true)).then(parentGuard).expect(s.returnedAssertion and s.phase == "discarded" and not(s.joinRequested) and invariant)
  run clearHookFailureDoesNotReturnAssertionTest = fresh.then(polling).then(pollComplete(true, 3)).then(clearAuthorization(false))
    .expect(s.reason == "clear-hook" and s.clearCalls == 1 and not(s.returnedAssertion) and invariant)
  run noStorageHookDoesNotClaimErasureTest = init.then(begin(false, false, true, 2)).then(polling)
    .then(pollComplete(true, 3)).then(clearAuthorization(true))
    .expect(s.returnedAssertion and s.saveCalls == 0 and s.clearCalls == 0 and s.storageIntent == "none" and invariant)
  run clearHookMaySynchronouslyCancelParentTest = fresh.then(polling).then(pollComplete(true, 3)).then(abortFromHook)
    .then(clearAuthorization(true)).then(parentGuard).expect(s.phase == "discarded" and invariant)
  run expiryCheckDoesNotBoundCallerHookDurationTest = fresh.then(polling).then(pollComplete(true, 1)).then(timeInHook)
    .then(clearAuthorization(true)).expect(s.returnedAssertion and s.assertionExpiry == s.now and s.validatedAt == 0 and invariant)
  run pendingPrefixDoesNotInventApplicationRetryLimitTest = fresh.then(polling).then(pollPending(2)).then(scheduleDelay)
    .then(timerFires).then(pollPending(2)).then(scheduleDelay).expect(s.phase == "delay" and s.polls == 2 and s.result == "pending" and invariant)
  run committedDepartureAfterAssertionRefusesJoinTest = fresh.then(polling)
    .then(pollComplete(true, 3)).then(clearAuthorization(true)).then(depart).then(parentGuard)
    .expect(s.returnedAssertion and not(s.joinRequested) and s.phase == "discarded")
  run committedDepartureDuringHelperRefusesJoinTest = fresh.then(polling).then(pollComplete(true, 3))
    .then(depart).then(clearAuthorization(true)).then(parentGuard).expect(not(s.joinRequested))
  // Old passive cleanup left the signal live until a later task; outside step.
  action oldPassiveCommit = all { s.mounted, s' = s.with("mounted", false) }
  run oldPassiveDepartureCouldJoinTest = fresh.then(polling).then(pollComplete(true, 3))
    .then(clearAuthorization(true)).then(oldPassiveCommit).then(parentGuard).expect(s.joinRequested)
}
