// @source backend/payments/handler.ts
// @source backend/payments/vault-snapshots.ts
// @source backend/projects/edge-cache.ts
// @evidence backend/payments/totals.test.ts
// Public /projects/:id/vault after the shared origin/method gate: two requests,
// two database versions, production/staging URL keys, one mainnet and one
// testnet snapshot. Stored row bytes and JSON are supplied valid data; no chain
// access or new evidence verification is implied. now is captured before cache
// and D1 awaits. Empty and stale snapshots still return 200, not zero balances.
// Cache expiry is the host's supplied miss/eviction outcome; this model does not
// implement or prove Cache API TTL. A hit retains its original servedAt and
// payload. Keys include origin/path/query; tier is a stable origin contract.
// Cache failures fall back or leave a successful response usable. No cross-colo
// freshness, immediate refresh after writes, or single-flight promise is made.
// New scenarios and regression definitions are unexecuted.
module public_vault_snapshots {
  type Entry = { present: bool, version: int, rows: Set[int], servedAt: int }
  type State = { phase: str, invocation: int, keyId: int, caching: bool,
    now: int, capturedNow: int, databaseVersion: int, databaseRows: Set[int],
    cache: int -> Entry, built: Entry, response: Entry, status: int, tag: str,
    changed: bool, returned: bool }
  var s: State
  val absent: Entry = { present: false, version: 0, rows: Set(), servedAt: 0 }
  action init = s' = { phase: "input", invocation: 1, keyId: 1, caching: true,
    now: 1, capturedNow: 0, databaseVersion: 1, databaseRows: Set(1, 2),
    cache: Map(1 -> absent, 2 -> absent), built: absent, response: absent,
    status: 0, tag: "none", changed: false, returned: false }
  // Key 1 is production (only row 2), key 2 staging (rows 1 and 2).
  action configure(keyId: int, caching: bool, rows: Set[int]): bool = all {
    s.phase == "input", Set(1, 2).contains(keyId), rows.subseteq(Set(1, 2)),
    s' = s.with("keyId", keyId).with("caching", caching).with("databaseRows", rows) }
  action begin = all { s.phase == "input", s' = s.with("capturedNow", s.now)
    .with("phase", if (s.caching) "cache-read" else "database") }
  action cacheRead(available: bool): bool = {
    val entry = s.cache.get(s.keyId)
    all { s.phase == "cache-read", s' =
      if (available and entry.present) s.with("response", entry).with("status", 200)
        .with("tag", "hit").with("phase", "done").with("returned", true)
      else s.with("phase", "database") }
  }
  action databaseRead = {
    val rows = if (s.keyId == 1) s.databaseRows.exclude(Set(1)) else s.databaseRows
    val entry: Entry = { present: true, version: s.databaseVersion, rows: rows, servedAt: s.capturedNow }
    all { s.phase == "database", s' = s.with("built", entry)
      .with("phase", if (s.caching) "body" else "uncached") }
  }
  action databaseFailure = all { s.phase == "database", s' = s.with("phase", "done").with("status", 503) }
  action bodyRead(ok: bool): bool = all { s.phase == "body", s' =
    if (ok) s.with("phase", "cache-write") else s.with("phase", "done").with("status", 503) }
  action cacheWrite(ok: bool): bool = all { s.phase == "cache-write",
    s' = s.with("cache", if (ok) s.cache.set(s.keyId, s.built) else s.cache).with("phase", "reply") }
  action reply = all { Set("reply", "uncached").contains(s.phase), s' = s.with("phase", "done")
    .with("status", 200).with("response", s.built).with("returned", true)
    .with("tag", if (s.caching) "miss" else "none") }
  action changeDatabase(rows: Set[int]): bool = all { not(s.changed), rows.subseteq(Set(1, 2)),
    s' = s.with("databaseVersion", 2).with("databaseRows", rows).with("changed", true).with("now", 2) }
  action evict(keyId: int): bool = all { Set(1, 2).contains(keyId), s' = s.with("cache", s.cache.set(keyId, absent)) }
  action nextRequest(keyId: int): bool = all { s.phase == "done", s.invocation == 1, Set(1, 2).contains(keyId),
    s' = s.with("phase", "input").with("invocation", 2).with("keyId", keyId)
      .with("built", absent).with("response", absent).with("status", 0).with("tag", "none").with("returned", false) }
  action step = {
    nondet keyId = Set(1, 2).oneOf() nondet yes = Set(false, true).oneOf()
    nondet rows = Set(1, 2).powerset().oneOf()
    any { configure(keyId, yes, rows), begin, cacheRead(yes), databaseRead, databaseFailure,
      bodyRead(yes), cacheWrite(yes), reply, changeDatabase(rows), evict(keyId), nextRequest(keyId), s' = s }
  }
  val invariant = all { s.invocation <= 2, s.returned implies s.status == 200 and s.response.present,
    s.status == 503 implies not(s.returned),
    s.keyId == 1 and s.returned implies not(s.response.rows.contains(1)),
    s.tag == "hit" implies s.returned and s.caching,
    s.returned implies s.response.servedAt <= s.now }
  action build = begin.then(cacheRead(true)).then(databaseRead).then(bodyRead(true)).then(cacheWrite(true)).then(reply)
  run productionExcludesTestnetSnapshotTest = init.then(build).expect(s.response.rows == Set(2) and s.tag == "miss" and invariant)
  run stagingRetainsBothSnapshotsTest = init.then(configure(2, true, Set(1, 2))).then(build).expect(s.response.rows == Set(1, 2) and invariant)
  run emptyProjectStillReturns200Test = init.then(configure(1, true, Set())).then(build).expect(s.status == 200 and s.response.rows == Set() and invariant)
  run testnetOnlyProjectReturnsEmptyProductionBodyTest = init.then(configure(1, true, Set(1))).then(build).expect(s.response.rows == Set() and invariant)
  run noCacheReadsDatabaseDirectlyTest = init.then(configure(1, false, Set(1, 2))).then(begin).then(databaseRead).then(reply).expect(s.tag == "none" and not(s.cache.get(1).present) and invariant)
  run matchFailureFallsBackToDatabaseTest = init.then(begin).then(cacheRead(false)).then(databaseRead).then(bodyRead(true)).then(cacheWrite(true)).then(reply).expect(s.tag == "miss" and invariant)
  run putFailureStillReturnsSuccessfulBodyTest = init.then(begin).then(cacheRead(true)).then(databaseRead).then(bodyRead(true)).then(cacheWrite(false)).then(reply).expect(s.status == 200 and not(s.cache.get(1).present) and invariant)
  run databaseFailureIsNotCachedTest = init.then(begin).then(cacheRead(true)).then(databaseFailure).expect(s.status == 503 and not(s.cache.get(1).present) and invariant)
  run bodyReadFailureIsNotCachedTest = init.then(begin).then(cacheRead(true)).then(databaseRead).then(bodyRead(false)).expect(s.status == 503 and not(s.cache.get(1).present) and invariant)
  run servedAtCapturedBeforeAwaitTest = init.then(begin).then(cacheRead(true)).then(changeDatabase(Set(2))).then(databaseRead).then(bodyRead(true)).then(cacheWrite(true)).then(reply).expect(s.response.version == 2 and s.response.servedAt == 1 and s.now == 2 and invariant)
  run cacheHitKeepsOldPayloadAndServedAtTest = init.then(build).then(changeDatabase(Set())).then(nextRequest(1)).then(begin).then(cacheRead(true)).expect(s.response.version == 1 and s.response.rows == Set(2) and s.response.servedAt == 1 and s.tag == "hit" and invariant)
  run cacheMissRebuildsAfterEvictionTest = init.then(build).then(changeDatabase(Set())).then(evict(1)).then(nextRequest(1)).then(build).expect(s.response.version == 2 and s.response.rows == Set() and s.response.servedAt == 2 and invariant)
  run stagingCacheCannotPopulateProductionKeyTest = init.then(configure(2, true, Set(1, 2))).then(build).then(nextRequest(1)).then(build).expect(s.response.rows == Set(2) and s.tag == "miss" and invariant)
  run failedRequestCanRetryFromDatabaseTest = init.then(begin).then(cacheRead(true)).then(databaseFailure).then(nextRequest(1)).then(build).expect(s.status == 200 and invariant)
}
