// @source workers/slopbot/value-commit-pages.ts
// @source scripts/value-ingestion.ts
// @evidence workers/slopbot/value-commit-pages.test.ts
// @evidence workers/slopbot/value-import-recovery.test.ts
// @evidence scripts/value-native-file-recovery.test.ts
// Invocation-local immutable evidence reuse requires this client's current
// public repository identity. Failed/truncated data never creates an entry.
module value_source_cache {
  var s: {verified: bool, cached: bool, immutable: bool, complete: bool,
    entries: int, bytes: int, replayed: bool}
  action init = s' = {verified: false, cached: false, immutable: true,
    complete: true, entries: 0, bytes: 0, replayed: false}
  action verifyRepository = s' = s.with("verified", true).with("replayed", false)
  action differentOrPrivateRepository = s' = s.with("verified", false).with("replayed", false)
  action nextClient = s' = s.with("verified", false).with("replayed", false)
  action mutable = s' = s.with("immutable", false).with("replayed", false)
  action incomplete = s' = s.with("complete", false).with("replayed", false)
  action retain = all {s.verified, s.immutable, s.complete, not(s.cached),
    s.entries < 2, s.bytes < 2,
    s' = s.with("cached", true).with("entries", s.entries + 1).with("bytes", s.bytes + 1).with("replayed", false)}
  action replay = all {s.verified, s.cached, s.immutable,
    s' = s.with("replayed", true)}
  action step = any {verifyRepository, differentOrPrivateRepository, nextClient,
    mutable, incomplete, retain, replay, s' = s}
  val invariant = all {s.entries <= 2, s.bytes <= 2,
    s.cached implies s.entries > 0 and s.bytes > 0,
    s.replayed implies s.verified and s.cached and s.immutable}
  run newClientNeedsRepositoryTest = init.then(verifyRepository).then(retain)
    .then(nextClient).expect(invariant).then(replay.fail())
  run currentPublicIdentityPermitsReuseTest = init.then(verifyRepository).then(retain)
    .then(nextClient).then(verifyRepository).then(replay).expect(invariant)
  run privateRepositoryCannotReuseTest = init.then(verifyRepository).then(retain)
    .then(differentOrPrivateRepository).expect(invariant).then(replay.fail())
  run mutableCannotRetainTest = init.then(verifyRepository).then(mutable)
    .expect(invariant).then(retain.fail())
  run incompleteCannotRetainTest = init.then(verifyRepository).then(incomplete)
    .expect(invariant).then(retain.fail())
}
