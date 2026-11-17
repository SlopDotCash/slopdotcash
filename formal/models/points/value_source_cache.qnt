// @source workers/slopbot/value-commit-pages.ts
// @evidence workers/slopbot/value-commit-pages.test.ts
// @evidence workers/slopbot/value-commit-pages-intern.test.ts
// @evidence workers/slopbot/value-import-recovery.test.ts
// Invocation-local immutable evidence reuse requires this client's current
// public repository identity. Failed/truncated data never creates an entry.
// Text 0 represents a short value, and 1/2 distinct long UTF-16 values. These
// finite logical values abstract exact content, not runtime size/evidence caps.
// Sharing preserves logical bytes and every admission/authorization field;
// implementation tests establish actual Unicode/hash parity and object isolation.
// This model does not prove backing-string identity or measured heap savings.
module value_source_cache {
  var s: {verified: bool, cached: bool, immutable: bool, complete: bool,
    fits: bool, entries: int, bytes: int, replayed: bool,
    textInput: int, textOutput: int, textPool: Set[int]}
  val emptyPublication = {verified: false, cached: false, immutable: true,
    complete: true, fits: true, entries: 0, bytes: 0, replayed: false,
    textInput: 0, textOutput: 0, textPool: Set()}
  action init = s' = emptyPublication
  action verifyRepository = s' = s.with("verified", true).with("replayed", false)
  action differentOrPrivateRepository = s' = s.with("verified", false).with("replayed", false)
  action nextClient = s' = s.with("verified", false).with("replayed", false)
  action mutable = s' = s.with("immutable", false).with("replayed", false)
  action incomplete = s' = s.with("complete", false).with("replayed", false)
  action oversized = s' = s.with("fits", false).with("replayed", false)
  action shareText(value: int): bool = all {value.in(Set(0, 1, 2)),
    s' = s.with("textInput", value).with("textOutput", value)
      .with("textPool", if (value == 0) s.textPool else s.textPool.union(Set(value)))}
  action nextPublication = s' = emptyPublication
  action retain = all {s.verified, s.immutable, s.complete, not(s.cached),
    s.fits, s.entries < 2, s.bytes < 2,
    s' = s.with("cached", true).with("entries", s.entries + 1).with("bytes", s.bytes + 1).with("replayed", false)}
  action replay = all {s.verified, s.cached, s.immutable,
    s' = s.with("replayed", true)}
  action step = {nondet text = Set(0, 1, 2).oneOf()
    any {verifyRepository, differentOrPrivateRepository, nextClient,
      mutable, incomplete, oversized, shareText(text), nextPublication,
      retain, replay, s' = s}}
  val invariant = all {s.entries <= 2, s.bytes <= 2,
    s.cached implies s.entries > 0 and s.bytes > 0,
    s.replayed implies s.verified and s.cached and s.immutable,
    s.textInput == s.textOutput, s.textPool.subseteq(Set(1, 2))}
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
  run textSharingDoesNotAuthorizeTest = init.then(shareText(1))
    .expect(invariant and not(s.verified) and not(s.cached) and s.entries == 0
      and s.bytes == 0 and s.immutable and s.complete and s.fits)
    .then(retain.fail())
  run textSharingCannotReplayTest = init.then(shareText(1))
    .expect(invariant).then(replay.fail())
  run privateClientCanShareButNotReplayTest = init.then(verifyRepository).then(retain)
    .then(nextClient).then(differentOrPrivateRepository).then(shareText(2))
    .expect(invariant and not(s.verified) and s.cached and s.entries == 1 and s.bytes == 1)
    .then(replay.fail())
  run oversizedUncachedTextStillSharesTest = init.then(verifyRepository).then(oversized)
    .then(shareText(1)).expect(invariant and s.verified and not(s.cached)
      and s.entries == 0 and s.bytes == 0 and not(s.fits) and s.textPool == Set(1))
    .then(retain.fail())
  run exactRepeatedAndDistinctValuesTest = init.then(shareText(1)).then(shareText(1))
    .expect(s.textPool == Set(1) and s.textInput == 1 and s.textOutput == 1)
    .then(shareText(2)).expect(invariant and s.textPool == Set(1, 2)
      and s.textInput == 2 and s.textOutput == 2)
  run shortTextDoesNotEnterPoolTest = init.then(shareText(0))
    .expect(invariant and s.textPool == Set())
  run poolLifetimeIsPublicationTest = init.then(shareText(1)).then(nextClient)
    .expect(s.textPool == Set(1)).then(nextPublication)
    .expect(invariant and s.textPool == Set() and not(s.verified) and not(s.cached))
}
