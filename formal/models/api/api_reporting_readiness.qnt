// @source backend/security/reporting-readiness.ts
// @source migrations/0086_repository_reporting_status.sql
// @source backend/security/handler.ts
// @evidence backend/security/submissions.test.ts
// Two revision/repository keys, two refreshes, two valid immutable identities,
// one invalid identity class, and a six-half-tick observation lifetime. Three
// abstract seconds include the final fractional-second band where stale=false
// but the floored cache max-age is zero. Provider
// reads, atomic SQL writes, optional readback and caller delivery are separate.
// Each request captures its timestamp before awaiting the provider. SQL admits
// strictly newer attempts only; a returned live observation need not be the
// latest cached value. Failed refreshes preserve known values with stale=true.
// Cache answers retain their read-time row and clock, make no continuous
// freshness claim and never authorize a sensitive mutation. Regex/schema checks
// are represented by the invalid identity class. No provider is called here.
module api_reporting_readiness {
  val slots = Set(1, 2)
  type Row = { present: bool, identity: int, value: int, verifiedAt: int, attemptedAt: int, failure: str }
  type Refresh = { phase: str, key: int, pin: int, at: int, kind: str, identity: int, value: int,
    result: str, returnedIdentity: int }
  type Cache = { phase: str, key: int, pin: int, at: int, row: Row, answer: str,
    stale: bool, checkedAt: int, maxAge: int }
  type State = { now: int, target: int, pin: int, rows: int -> Row, refreshes: int -> Refresh,
    firstIdentities: int -> int, cache: Cache }
  var s: State
  val emptyRow: Row = { present: false, identity: 0, value: -1, verifiedAt: -1, attemptedAt: -1, failure: "none" }
  val emptyRefresh: Refresh = { phase: "idle", key: 1, pin: 1, at: 0, kind: "none", identity: 0,
    value: -1, result: "none", returnedIdentity: 0 }
  val emptyCache: Cache = { phase: "idle", key: 1, pin: 1, at: 0, row: emptyRow,
    answer: "unavailable", stale: true, checkedAt: -1, maxAge: 0 }
  action init = s' = { now: 0, target: 1, pin: 1, rows: slots.mapBy(_ => emptyRow),
    refreshes: slots.mapBy(_ => emptyRefresh), firstIdentities: slots.mapBy(_ => 0), cache: emptyCache }
  action secondaryRepository = all { slots.forall(id => s.refreshes.get(id).phase == "idle"),
    s' = s.with("pin", 0) }
  action revision = all { s.target == 1, s' = s.with("target", 2) }
  action tick = all { s.now < 7, s' = s.with("now", s.now + 1) }
  action finalFraction = all { s.now < 5, s' = s.with("now", 5) }
  action begin(id: int): bool = all { slots.contains(id), s.refreshes.get(id).phase == "idle",
    s' = s.with("refreshes", s.refreshes.put(id, emptyRefresh.with("phase", "provider")
      .with("key", s.target).with("pin", s.pin).with("at", s.now))) }
  action provider(id: int, kind: str, identity: int, value: int): bool = {
    val request = s.refreshes.get(id)
    val actual = if (kind == "throw") "unavailable"
      else if (kind == "verified" and (not(slots.contains(identity)) or (request.pin != 0 and identity != request.pin)))
        "identity-mismatch" else kind
    all { slots.contains(id), request.phase == "provider",
      Set("verified", "unavailable", "identity-mismatch", "app-not-installed", "throw").contains(kind),
      Set(0, 1, 2).contains(identity), Set(0, 1).contains(value),
      s' = s.with("refreshes", s.refreshes.put(id, request.with("phase", "write").with("kind", actual)
        .with("identity", if (actual == "verified") identity else 0)
        .with("value", if (actual == "verified") value else -1))) }
  }
  def updatedRow(row: Row, request: Refresh): Row = {
    val verified = request.kind == "verified"
    val sameIdentity = row.identity == 0 or not(verified) or row.identity == request.identity
    if (row.present and request.at <= row.attemptedAt) row else {
      present: true,
      identity: if (row.identity != 0) row.identity else request.identity,
      value: if (verified and sameIdentity) request.value else row.value,
      verifiedAt: if (verified and sameIdentity) request.at else row.verifiedAt,
      attemptedAt: request.at,
      failure: if (not(sameIdentity)) "identity-mismatch" else if (verified) "none" else request.kind
    }
  }
  action commit(id: int, delivered: bool): bool = {
    val request = s.refreshes.get(id)
    val row = updatedRow(s.rows.get(request.key), request)
    all { slots.contains(id), request.phase == "write",
      s' = s.with("rows", s.rows.put(request.key, row))
        .with("firstIdentities", s.firstIdentities.put(request.key,
          if (s.firstIdentities.get(request.key) == 0) row.identity else s.firstIdentities.get(request.key)))
        .with("refreshes", s.refreshes.put(id, request
          .with("phase", if (delivered and request.kind == "verified") "readback" else "done")
          .with("result", if (not(delivered)) "unknown" else if (request.kind == "verified") "none" else request.kind))) }
  }
  action writeFailure(id: int): bool = all { slots.contains(id), s.refreshes.get(id).phase == "write",
    s' = s.with("refreshes", s.refreshes.put(id, s.refreshes.get(id).with("phase", "done").with("result", "unknown"))) }
  action readback(id: int, available: bool): bool = {
    val request = s.refreshes.get(id)
    val identity = s.rows.get(request.key).identity
    val matches = identity == request.identity
    all { slots.contains(id), request.phase == "readback",
      s' = s.with("refreshes", s.refreshes.put(id, request.with("phase", "done")
        .with("returnedIdentity", if (available) identity else 0)
        .with("result", if (not(available)) "unknown" else if (not(matches)) "identity-mismatch"
          else if (request.value == 1) "ready" else "disabled"))) }
  }
  action beginRead = all { s.cache.phase != "pending",
    s' = s.with("cache", emptyCache.with("phase", "pending").with("key", s.target).with("pin", s.pin).with("at", s.now)) }
  def known(cache: Cache): bool = cache.row.present and (cache.pin == 0 or cache.row.identity == cache.pin)
    and Set(0, 1).contains(cache.row.value) and cache.at >= cache.row.verifiedAt
  def stale(cache: Cache): bool = not(known(cache)) or cache.row.failure != "none" or cache.at - cache.row.verifiedAt >= 6
  def maxAge(cache: Cache): int = {
    val age = cache.at - cache.row.verifiedAt
    if (stale(cache)) 0 else if (age == 0) 3 else if (age <= 2) 2 else if (age <= 4) 1 else 0
  }
  action finishRead = {
    val cache = s.cache.with("row", s.rows.get(s.cache.key))
    all { s.cache.phase == "pending",
      s' = s.with("cache", cache.with("phase", "done")
        .with("answer", if (not(known(cache))) "unavailable" else if (cache.row.value == 1) "ready" else "disabled")
        .with("stale", stale(cache)).with("checkedAt", if (known(cache)) cache.row.verifiedAt else -1)
        .with("maxAge", maxAge(cache))) }
  }
  action read = beginRead.then(finishRead)
  action step = {
    nondet id = slots.oneOf()
    nondet identity = Set(0, 1, 2).oneOf()
    nondet value = Set(0, 1).oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet kind = Set("verified", "unavailable", "identity-mismatch", "app-not-installed", "throw").oneOf()
    any { secondaryRepository, revision, tick, finalFraction, begin(id), provider(id, kind, identity, value), commit(id, yes),
      writeFailure(id), readback(id, yes), beginRead, finishRead, s' = s }
  }
  val invariant = all {
    slots.forall(key => {
      val row = s.rows.get(key)
      all { s.firstIdentities.get(key) != 0 implies row.identity == s.firstIdentities.get(key),
        row.value != -1 implies slots.contains(row.identity) and row.verifiedAt >= 0,
        row.verifiedAt <= row.attemptedAt }
    }),
    slots.forall(id => {
      val request = s.refreshes.get(id)
      Set("ready", "disabled").contains(request.result) implies request.kind == "verified"
        and request.returnedIdentity == request.identity
    }),
    s.cache.phase == "done" implies all {
      s.cache.stale == stale(s.cache),
      (s.cache.answer != "unavailable") == known(s.cache),
      s.cache.stale implies s.cache.maxAge == 0,
      not(s.cache.stale) implies s.cache.maxAge >= 0 and s.cache.checkedAt >= 0,
      s.cache.maxAge == maxAge(s.cache) }
  }
  action observed(id: int, value: int): bool = begin(id).then(provider(id, "verified", 1, value)).then(commit(id, true)).then(readback(id, true))
  run identityChangeTest = init.then(observed(1, 1)).then(revision).then(read)
    .expect(s.cache.answer == "unavailable" and s.cache.stale and invariant)
  run disabledIsNotUnavailableTest = init.then(observed(1, 0)).then(read)
    .expect(s.cache.answer == "disabled" and not(s.cache.stale) and invariant)
  run freshEnabledObservationTest = init.then(observed(1, 1)).then(read)
    .expect(s.cache.answer == "ready" and s.cache.maxAge == 3 and invariant)
  run expiredObservationRetainsValueTest = init.then(observed(1, 1)).then(finalFraction).then(tick).then(read)
    .expect(s.cache.answer == "ready" and s.cache.stale and s.cache.checkedAt == 0 and invariant)
  run failedRefreshRetainsSuccessfulObservationTest = init.then(observed(1, 1)).then(tick).then(begin(2))
    .then(provider(2, "unavailable", 0, 0)).then(commit(2, true)).then(read)
    .expect(s.cache.answer == "ready" and s.cache.stale and s.cache.checkedAt == 0 and invariant)
  run providerThrowBecomesUnavailableTest = init.then(begin(1)).then(provider(1, "throw", 0, 0)).then(commit(1, true)).then(read)
    .expect(s.refreshes.get(1).result == "unavailable" and s.cache.answer == "unavailable" and invariant)
  run missingAppRetainsDisabledObservationTest = init.then(observed(1, 0)).then(tick).then(begin(2))
    .then(provider(2, "app-not-installed", 0, 0)).then(commit(2, true)).then(read)
    .expect(s.cache.answer == "disabled" and s.cache.stale and s.cache.row.failure == "app-not-installed" and invariant)
  run pinnedIdentityMismatchCannotPublishTest = init.then(begin(1)).then(provider(1, "verified", 2, 1)).then(commit(1, true)).then(read)
    .expect(s.refreshes.get(1).result == "identity-mismatch" and s.cache.answer == "unavailable" and invariant)
  run malformedIdentityCannotPublishTest = init.then(secondaryRepository).then(begin(1)).then(provider(1, "verified", 0, 1)).then(commit(1, true)).then(read)
    .expect(s.cache.answer == "unavailable" and s.cache.row.identity == 0 and invariant)
  run secondaryIdentityFirstWinnerRetainedTest = init.then(secondaryRepository).then(observed(1, 1)).then(tick).then(begin(2))
    .then(provider(2, "verified", 2, 0)).then(commit(2, true)).then(readback(2, true)).then(read)
    .expect(s.refreshes.get(2).result == "identity-mismatch" and s.cache.row.identity == 1 and s.cache.answer == "ready" and s.cache.stale and invariant)
  run newerAttemptWinsCacheButOlderCallReturnsOwnValueTest = init.then(begin(1)).then(tick).then(observed(2, 0))
    .then(provider(1, "verified", 1, 1)).then(commit(1, true)).then(readback(1, true)).then(read)
    .expect(s.refreshes.get(1).result == "ready" and s.cache.answer == "disabled" and s.cache.checkedAt == 1 and invariant)
  run equalTimestampFirstValueWinsTest = init.then(observed(1, 0)).then(observed(2, 1)).then(read)
    .expect(s.refreshes.get(2).result == "ready" and s.cache.answer == "disabled" and invariant)
  run equalTimestampFailurePreventsIdentityReadbackTest = init.then(begin(1)).then(provider(1, "unavailable", 0, 0))
    .then(commit(1, true)).then(observed(2, 1)).then(read)
    .expect(s.refreshes.get(2).result == "identity-mismatch" and s.cache.answer == "unavailable" and invariant)
  run committedLostReplyLeavesFreshCacheTest = init.then(begin(1)).then(provider(1, "verified", 1, 1)).then(commit(1, false)).then(read)
    .expect(s.refreshes.get(1).result == "unknown" and s.cache.answer == "ready" and not(s.cache.stale) and invariant)
  run failedWriteLeavesNoObservationTest = init.then(begin(1)).then(provider(1, "verified", 1, 1)).then(writeFailure(1)).then(read)
    .expect(s.refreshes.get(1).result == "unknown" and not(s.cache.row.present) and invariant)
  run readbackFailureDoesNotUndoCommitTest = init.then(begin(1)).then(provider(1, "verified", 1, 1))
    .then(commit(1, true)).then(readback(1, false)).then(read)
    .expect(s.refreshes.get(1).result == "unknown" and s.cache.answer == "ready" and invariant)
  run readClockBeforeLaterWriteRefusesFutureObservationTest = init.then(beginRead).then(tick).then(observed(1, 1)).then(finishRead)
    .expect(s.cache.answer == "unavailable" and s.cache.checkedAt == -1 and invariant)
  run revisionDuringReadDoesNotRetargetCapturedReadTest = init.then(observed(1, 1)).then(beginRead).then(revision).then(finishRead)
    .expect(s.cache.key == 1 and s.target == 2 and s.cache.answer == "ready" and invariant)
  run clockAfterReadDoesNotRewriteAnswerTest = init.then(observed(1, 1)).then(read).then(finalFraction).then(tick)
    .expect(s.cache.answer == "ready" and not(s.cache.stale) and s.cache.at == 0 and invariant)
  run finalFractionIsFreshWithZeroMaxAgeTest = init.then(observed(1, 1)).then(finalFraction).then(read)
    .expect(s.cache.answer == "ready" and not(s.cache.stale) and s.cache.maxAge == 0 and invariant)
}
