// @source workers/identity/rate-limit.ts
// @source workers/identity/index.ts
// @source migrations/0004_identity_rate_limits.sql
// @evidence scripts/identity-maintenance.test.ts
// Four one-shot exact-counter attempts, two digest keys, limit 2/window 3 and
// clock 0..6. These scale the caller's fixed 12/120 limits and 60-second window.
// Each request keeps its captured stamp across hash/SQL awaits. Row generation
// identifies a reset/recreation, including the same old stamp after cleanup.
// Gate/route/hash-key composition is separate in identity_rate_gate.
module api_identity_admission {
  val ids = Set(1, 2, 3, 4)
  val digestKeys = Set(1, 2)
  type Counter = { present: bool, count: int, started: int, expiry: int, generation: int }
  type Request = { phase: str, key: int, stamp: int, count: int, expiry: int,
    generation: int, result: str, retryAfter: int }
  val absent: Counter = { present: false, count: 0, started: 0, expiry: 0, generation: 0 }
  val unused: Request = { phase: "unused", key: 0, stamp: 0, count: 0, expiry: 0,
    generation: 0, result: "none", retryAfter: 0 }
  var s: { now: int, counters: int -> Counter, requests: int -> Request,
    cleanupPhase: str, cleanupStamp: int }
  action init = s' = { now: 0, counters: digestKeys.mapBy(_ => absent), requests: ids.mapBy(_ => unused),
    cleanupPhase: "idle", cleanupStamp: 0 }
  action tick = all { s.now < 6, s' = s.with("now", s.now + 1) }
  action capture(id: int, key: int): bool = all {
    ids.contains(id), digestKeys.contains(key), s.requests.get(id).phase == "unused",
    s' = s.with("requests", s.requests.set(id, unused.with("phase", "hash")
      .with("key", key).with("stamp", s.now))) }
  action hash(id: int, ok: bool): bool = {
    val request = s.requests.get(id)
    all { ids.contains(id), request.phase == "hash",
      s' = s.with("requests", s.requests.set(id, request.with("phase", if (ok) "ready" else "done")
        .with("result", if (ok) "none" else "503"))) }
  }
  action commit(id: int): bool = {
    val request = s.requests.get(id)
    val prior = if (digestKeys.contains(request.key)) s.counters.get(request.key) else absent
    val reset = not(prior.present) or prior.expiry <= request.stamp
    val nextCounter = { present: true, count: if (reset) 1 else prior.count + 1,
      started: if (reset) request.stamp else prior.started,
      expiry: if (reset) request.stamp + 3 else prior.expiry,
      generation: if (reset) id else prior.generation }
    all { ids.contains(id), request.phase == "ready",
      s' = s.with("counters", s.counters.set(request.key, nextCounter))
        .with("requests", s.requests.set(id, request.with("phase", "committed")
          .with("count", nextCounter.count).with("expiry", nextCounter.expiry).with("generation", nextCounter.generation))) }
  }
  action sqlFailure(id: int): bool = {
    val request = s.requests.get(id)
    all { ids.contains(id), request.phase == "ready",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "done").with("result", "503"))) }
  }
  // Invalid/missing returned metadata or a lost database reply may follow a committed
  // upsert. Such a failure does not restore the consumed request count.
  action reply(id: int, validResult: bool): bool = {
    val request = s.requests.get(id)
    all { ids.contains(id), request.phase == "committed",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "done")
        .with("result", if (not(validResult)) "503" else if (request.count <= 2) "allowed" else "429")
        .with("retryAfter", if (validResult) request.expiry - request.stamp else 0))) }
  }
  action beginCleanup = all { s.cleanupPhase == "idle",
    s' = s.with("cleanupPhase", "waiting").with("cleanupStamp", s.now) }
  action deleteExpired = all { s.cleanupPhase == "waiting",
    s' = s.with("cleanupPhase", "done").with("counters", digestKeys.mapBy(key => {
      val row = s.counters.get(key)
      if (row.present and row.expiry <= s.cleanupStamp) absent else row
    })) }
  action cleanupFailure = all { s.cleanupPhase == "waiting", s' = s.with("cleanupPhase", "failed") }
  action step = {
    nondet id = ids.oneOf()
    nondet key = digestKeys.oneOf()
    nondet ok = Set(false, true).oneOf()
    any { tick, capture(id, key), hash(id, ok), commit(id), sqlFailure(id), reply(id, ok),
      beginCleanup, deleteExpired, cleanupFailure, s' = s }
  }
  val invariant = all {
    s.now >= 0, s.now <= 6,
    digestKeys.forall(key => {
      val row = s.counters.get(key)
      if (row.present) row.count > 0 and row.count <= 4 and row.expiry > row.started
        and ids.contains(row.generation)
      else row == absent
    }),
    ids.forall(id => {
      val request = s.requests.get(id)
      all {
        request.result == "allowed" implies request.count >= 1 and request.count <= 2,
        Set("allowed", "429").contains(request.result) implies request.expiry > request.stamp
          and request.retryAfter == request.expiry - request.stamp and request.retryAfter >= 1,
        request.result == "429" implies request.count > 2,
        request.result == "503" implies request.retryAfter == 0 }
    }),
    // This is a per-row-generation bound, not a bound over live-clock windows.
    ids.forall(generation => ids.filter(id => s.requests.get(id).generation == generation
      and s.requests.get(id).result == "allowed").size() <= 2) }

  run fixedWindowTest = init.then(capture(1, 1)).then(hash(1, true)).then(commit(1)).then(reply(1, true))
    .then(capture(2, 1)).then(hash(2, true)).then(commit(2)).then(reply(2, true))
    .then(capture(3, 1)).then(hash(3, true)).then(commit(3)).then(reply(3, true))
    .expect(s.requests.get(3).result == "429" and s.counters.get(1).count == 3)
    .then(tick).then(tick).then(tick).then(capture(4, 1)).then(hash(4, true)).then(commit(4)).then(reply(4, true))
    .expect(s.requests.get(4).result == "allowed" and s.counters.get(1).count == 1 and invariant)
  run failedClosedTest = init.then(capture(1, 1)).then(hash(1, true)).then(sqlFailure(1))
    .expect(s.requests.get(1).result == "503" and not(s.counters.get(1).present) and invariant)
  run laterRequestCanRecoverAfterStorageFailureTest = init.then(capture(1, 1)).then(hash(1, true)).then(sqlFailure(1))
    .then(capture(2, 1)).then(hash(2, true)).then(commit(2)).then(reply(2, true))
    .expect(s.requests.get(2).result == "allowed" and s.counters.get(1).count == 1 and invariant)
  run firstTouchCreatesWindowAtCapturedStampTest = init.then(tick).then(capture(1, 1)).then(hash(1, true))
    .then(commit(1)).then(reply(1, true))
    .expect(s.counters.get(1).started == 1 and s.counters.get(1).expiry == 4 and invariant)
  run deniedCallsStillIncrementWithoutExtendingWindowTest = init.then(capture(1, 1)).then(hash(1, true)).then(commit(1))
    .then(capture(2, 1)).then(hash(2, true)).then(commit(2))
    .then(capture(3, 1)).then(hash(3, true)).then(commit(3)).then(reply(3, true))
    .then(capture(4, 1)).then(hash(4, true)).then(commit(4)).then(reply(4, true))
    .expect(s.counters.get(1).count == 4 and s.counters.get(1).expiry == 3
      and s.requests.get(4).result == "429" and invariant)
  run concurrentExactCallsReceiveDistinctCountsTest = init.then(capture(1, 1)).then(capture(2, 1))
    .then(hash(1, true)).then(hash(2, true)).then(commit(2)).then(commit(1)).then(reply(1, true)).then(reply(2, true))
    .expect(s.requests.get(2).count == 1 and s.requests.get(1).count == 2 and invariant)
  run separateDigestKeyKeepsIndependentCounterTest = init.then(capture(1, 1)).then(hash(1, true)).then(commit(1))
    .then(capture(2, 2)).then(hash(2, true)).then(commit(2)).then(reply(2, true))
    .expect(s.counters.get(1).count == 1 and s.counters.get(2).count == 1 and invariant)
  run hashingFailureConsumesNoExactQuotaTest = init.then(capture(1, 1)).then(hash(1, false))
    .expect(s.requests.get(1).result == "503" and not(s.counters.get(1).present) and invariant)
  run invalidResultDoesNotUndoCommittedCountTest = init.then(capture(1, 1)).then(hash(1, true)).then(commit(1))
    .then(reply(1, false)).expect(s.requests.get(1).result == "503" and s.counters.get(1).count == 1 and invariant)
  run retryAfterUnknownReplyConsumesAnotherCountTest = init.then(capture(1, 1)).then(hash(1, true)).then(commit(1))
    .then(reply(1, false)).then(capture(2, 1)).then(hash(2, true)).then(commit(2)).then(reply(2, true))
    .expect(s.counters.get(1).count == 2 and s.requests.get(2).count == 2 and invariant)
  run replyUsesCapturedClockAfterLiveExpiryTest = init.then(capture(1, 1)).then(hash(1, true)).then(commit(1))
    .then(tick).then(tick).then(tick).then(reply(1, true))
    .expect(s.now == s.requests.get(1).expiry and s.requests.get(1).result == "allowed"
      and s.requests.get(1).retryAfter == 3 and invariant)
  run staleRequestAfterRenewalCanHaveLongerRetryAfterTest = init.then(capture(1, 1)).then(hash(1, true)).then(commit(1))
    .then(capture(2, 1)).then(hash(2, true)).then(tick).then(tick).then(tick)
    .then(capture(3, 1)).then(hash(3, true)).then(commit(3)).then(commit(2)).then(reply(2, true))
    .expect(s.requests.get(2).retryAfter == 6 and s.counters.get(1).started == 3 and invariant)
  run cleanupAtExpiryDeletesTheRowTest = init.then(capture(1, 1)).then(hash(1, true)).then(commit(1))
    .then(tick).then(tick).then(tick).then(beginCleanup).then(deleteExpired)
    .expect(not(s.counters.get(1).present) and invariant)
  run cleanupPreservesRenewalCommittedAfterCaptureTest = init.then(capture(1, 1)).then(hash(1, true)).then(commit(1))
    .then(tick).then(tick).then(tick).then(beginCleanup).then(capture(2, 1)).then(hash(2, true)).then(commit(2))
    .then(deleteExpired).expect(s.counters.get(1).present and s.counters.get(1).expiry == 6 and invariant)
  run delayedCapturedRequestCanRecreateExpiredRowTest = init.then(capture(1, 1)).then(hash(1, true)).then(commit(1))
    .then(capture(2, 1)).then(hash(2, true)).then(tick).then(tick).then(tick)
    .then(beginCleanup).then(deleteExpired).then(commit(2)).then(reply(2, true))
    .expect(s.counters.get(1).generation == 2 and s.counters.get(1).expiry == s.now
      and s.requests.get(2).result == "allowed" and invariant)
  run cleanupFailurePreservesCounterTest = init.then(capture(1, 1)).then(hash(1, true)).then(commit(1))
    .then(tick).then(tick).then(tick).then(beginCleanup).then(cleanupFailure)
    .expect(s.counters.get(1).present and s.cleanupPhase == "failed" and invariant)
  run cleanupDoesNotInvalidateReturnedSnapshotTest = init.then(capture(1, 1)).then(hash(1, true)).then(commit(1))
    .then(tick).then(tick).then(tick).then(beginCleanup).then(deleteExpired).then(reply(1, true))
    .expect(not(s.counters.get(1).present) and s.requests.get(1).result == "allowed" and invariant)
}
