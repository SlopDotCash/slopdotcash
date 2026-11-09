// @source workers/payments/scanner.ts
// @source migrations/0012_solana_scan_backlog.sql
// Backward discovery is complete before oldest-first processing. A transaction
// checkpoint advances cursor, page prefix and revision atomically. Two workers,
// four original signatures, one later arrival and a single frozen interval.
module solana_scan_checkpoint {
  type S = { pages: int, ready: bool, cursor: int, indexed: Set[int], revision: int,
    aRevision: int, aItem: int, bRevision: int, bItem: int, later: bool, closed: bool }
  var s: S
  action init = s' = { pages: 0, ready: false, cursor: 0, indexed: Set(), revision: 0,
    aRevision: -1, aItem: 0, bRevision: -1, bItem: 0, later: false, closed: false }
  action discover = all { s.pages < 2, not(s.closed),
    s' = s.with("pages", s.pages + 1).with("ready", s.pages == 1).with("revision", s.revision + 1) }
  action captureA = all { s.ready, s.cursor < 4, not(s.closed),
    s' = s.with("aRevision", s.revision).with("aItem", s.cursor + 1) }
  action captureB = all { s.ready, s.cursor < 4, not(s.closed),
    s' = s.with("bRevision", s.revision).with("bItem", s.cursor + 1) }
  action verifyA = all { s.aItem > 0, s' = s.with("indexed", s.indexed.union(Set(s.aItem))) }
  action verifyB = all { s.bItem > 0, s' = s.with("indexed", s.indexed.union(Set(s.bItem))) }
  action checkpointA = all { s.aItem > 0, s.indexed.contains(s.aItem),
    s' = if (s.aRevision == s.revision)
      s.with("cursor", s.aItem).with("revision", s.revision + 1).with("aItem", 0)
    else s.with("aItem", 0) }
  action checkpointB = all { s.bItem > 0, s.indexed.contains(s.bItem),
    s' = if (s.bRevision == s.revision)
      s.with("cursor", s.bItem).with("revision", s.revision + 1).with("bItem", 0)
    else s.with("bItem", 0) }
  action restart = s' = s.with("aItem", 0).with("bItem", 0)
  action laterArrival = s' = s.with("later", true)
  action close = all { s.cursor == 4, s' = s.with("closed", true) }
  action step = any { discover, captureA, captureB, verifyA, verifyB,
    checkpointA, checkpointB, restart, laterArrival, close, s' = s }
  val invariant = all {
    s.cursor >= 0 and s.cursor <= 4,
    s.revision == s.pages + s.cursor,
    s.cursor > 0 implies 1.to(s.cursor).subseteq(s.indexed),
    s.indexed.forall(signatureId => signatureId <= s.cursor + 1),
    s.closed implies s.cursor == 4,
    not(s.ready) implies s.cursor == 0,
  }
  run discoveryBeforeProcessingTest = init.then(discover).then(captureA.fail())
  run staleCheckpointCannotRewindTest = init.then(discover).then(discover)
    .then(captureA).then(captureB).then(verifyA).then(checkpointA)
    .then(captureA).then(verifyA).then(checkpointA).then(verifyB).then(checkpointB)
    .expect(s.cursor == 2 and s.revision == 4 and invariant)
  run restartKeepsVerifiedPrefixTest = init.then(discover).then(discover)
    .then(captureA).then(verifyA).then(checkpointA).then(captureA).then(restart)
    .expect(s.cursor == 1 and s.indexed == Set(1) and invariant)
  run laterArrivalOutsideIntervalTest = init.then(discover).then(discover).then(laterArrival)
    .then(captureA).then(verifyA).then(checkpointA)
    .then(captureA).then(verifyA).then(checkpointA)
    .then(captureA).then(verifyA).then(checkpointA)
    .then(captureA).then(verifyA).then(checkpointA).then(close)
    .expect(s.later and s.cursor == 4 and s.indexed == Set(1, 2, 3, 4) and invariant)
}
