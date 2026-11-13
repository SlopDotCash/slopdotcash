// @source backend/vetting/evidence-chunks.ts
// @source backend/vetting/evidence.ts
// @evidence scripts/vetting-api.test.ts
// One verifiedPart invocation, or verifyParts over two ordered parts. A part
// has two abstract byte units (representing a valid <=8 MiB size), or zero for
// the standalone empty object; fragments are one/two units or an overflowing
// third. Equality and SHA-256 are explicit
// predicates, not cryptographic proofs. Caller chunkLayout validation supplies
// the ordered list; this model does not certify arbitrary unvalidated layouts.
// R2 metadata is checked only after taking ownership of its body reader.
// Every rejection then attempts cancellation, preserves its primary error if
// cancellation fails, and releases the reader. A failed cancellation does not
// prove the source closed. Missing objects and invalid sizes own no reader.
// This models the default evidence read: an explicit retirement marker refuses
// before metadata/byte verification, even when the original object was empty.
// The worker's opt-in canonical marker verification is a separate protocol.
// bucket.get either rejects, returns null, or supplies a fresh unlocked R2
// body whose getReader operation succeeds; prelocked/invalid adapter objects
// are outside that storage input contract.
// Own corruption errors carry that response's optional ETag. Repair CAS and
// missing-ETag refusal are covered by vetting_upload_completion, not here.
// verifyParts feeds only fully verified original bytes to the whole-file hash,
// in list order, and destroys that hash on both success and failure. Individual
// part hashes alone cannot prove the declared whole digest.
// callerCancel records the native response's abandonment during a read. The
// helper has no abort input: bounded work may continue and return internally.
// No model action exposes bytes to the outer caller or creates a read audit,
// completion receipt, retention exemption, or backup/delete authorization.
// These are authored scenarios; no model checker or regression was executed.
module vetting_verified_parts {
  var s: { phase: str, mode: str, part: int, expectedSize: int, offset: int, bytesMatch: bool,
    acquisitions: int, releases: int, readerOwned: bool, sourceClosed: bool,
    cancelTried: bool, cancelFailed: bool, primary: str, preserved: str,
    verified: Set[int], fed: List[int], hashDestroyed: bool,
    callerCancelled: bool, outcome: str }
  action init = s' = { phase: "input", mode: "part", part: 0, expectedSize: 2, offset: 0,
    bytesMatch: true, acquisitions: 0, releases: 0, readerOwned: false,
    sourceClosed: false, cancelTried: false, cancelFailed: false,
    primary: "none", preserved: "none", verified: Set(), fed: [],
    hashDestroyed: false, callerCancelled: false, outcome: "pending" }
  action begin(mode: str, bounded: bool): bool = all {
    s.phase == "input", Set("part", "whole").contains(mode),
    s' = s.with("mode", mode).with("phase", if (bounded) "get" else "done")
      .with("outcome", if (bounded) "pending" else "error")
      .with("primary", if (bounded) "none" else "size")
      .with("preserved", if (bounded) "none" else "size")
      .with("hashDestroyed", mode == "whole" and not(bounded)) }
  action emptyPart = all { s.phase == "get", s.mode == "part",
    s' = s.with("expectedSize", 0) }
  action getRecord(present: bool): bool = all { s.phase == "get",
    s' = if (present) s.with("phase", "acquire")
      else s.with("phase", "done").with("outcome", "error")
        .with("primary", "missing").with("preserved", "missing")
        .with("hashDestroyed", s.mode == "whole") }
  action fetchError = all { s.phase == "get",
    s' = s.with("phase", "done").with("outcome", "error")
      .with("primary", "fetch-error").with("preserved", "fetch-error")
      .with("hashDestroyed", s.mode == "whole") }
  action acquire = all { s.phase == "acquire",
    s' = s.with("phase", "metadata").with("readerOwned", true)
      .with("acquisitions", s.acquisitions + 1).with("sourceClosed", false)
      .with("cancelTried", false).with("cancelFailed", false) }
  action retirementMarker = all { s.phase == "metadata",
    s' = s.with("phase", "cancel").with("primary", "retired")
      .with("preserved", "retired") }
  action metadata(matches: bool): bool = all { s.phase == "metadata",
    s' = if (matches) s.with("phase", "read")
      else s.with("phase", "cancel").with("primary", "metadata")
        .with("preserved", "metadata") }
  action fragment(byteLength: int, matches: bool): bool = all {
    s.phase == "read", Set(1, 2, 3).contains(byteLength),
    s' = if (s.offset + byteLength > s.expectedSize)
      s.with("phase", "cancel").with("primary", "overflow").with("preserved", "overflow")
      else s.with("offset", s.offset + byteLength).with("bytesMatch", s.bytesMatch and matches) }
  action readError = all { s.phase == "read",
    s' = s.with("phase", "cancel").with("primary", "read").with("preserved", "read") }
  action wrongExpectedDigest = all { s.phase == "read",
    s' = s.with("bytesMatch", false) }
  action eof = all { s.phase == "read",
    s' = if (s.offset == s.expectedSize and s.bytesMatch)
      s.with("phase", "release-success").with("sourceClosed", true)
        .with("verified", s.verified.union(Set(s.part)))
      else s.with("phase", "cancel").with("sourceClosed", true)
        .with("primary", if (s.offset != s.expectedSize) "truncated" else "digest")
        .with("preserved", if (s.offset != s.expectedSize) "truncated" else "digest") }
  action cancelStart = all { s.phase == "cancel",
    s' = s.with("phase", "cancel-pending").with("cancelTried", true) }
  action cancelResult(ok: bool): bool = all { s.phase == "cancel-pending",
    // A cleanup rejection never replaces preserved, even on metadata refusal.
    s' = s.with("phase", "release-failure").with("cancelFailed", not(ok))
      .with("sourceClosed", s.sourceClosed or ok) }
  action release = all { Set("release-success", "release-failure").contains(s.phase), s.readerOwned,
    s' = s.with("readerOwned", false).with("releases", s.releases + 1)
      .with("phase", if (s.phase == "release-failure") "finish-error"
        else if (s.mode == "whole") "feed" else "done")
      .with("outcome", if (s.phase == "release-success" and s.mode == "part") "verified" else s.outcome) }
  action finishError = all { s.phase == "finish-error",
    s' = s.with("phase", "done").with("outcome", "error")
      .with("hashDestroyed", s.mode == "whole") }
  action feed = all { s.phase == "feed", s.verified.contains(s.part),
    s' = s.with("fed", s.fed.append(s.part))
      .with("phase", if (s.part == 1) "whole-hash" else "get")
      .with("part", 1)
      .with("offset", 0).with("bytesMatch", true) }
  action wholeHash(matches: bool): bool = all { s.phase == "whole-hash",
    s' = s.with("phase", "done").with("hashDestroyed", true)
      .with("outcome", if (matches) "verified" else "error")
      .with("primary", if (matches) "none" else "whole-digest")
      .with("preserved", if (matches) "none" else "whole-digest") }
  action callerCancel = all { s.phase == "read", not(s.callerCancelled),
    s' = s.with("callerCancelled", true) }
  action step = {
    nondet mode = Set("part", "whole").oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet byteLength = Set(1, 2, 3).oneOf()
    any { begin(mode, yes), emptyPart, getRecord(yes), fetchError, acquire, retirementMarker, metadata(yes), fragment(byteLength, yes),
      readError, wrongExpectedDigest, eof, cancelStart, cancelResult(yes), release, finishError,
      feed, wholeHash(yes), callerCancel, s' = s }
  }
  val invariant = all {
    s.releases <= s.acquisitions, s.acquisitions <= 2,
    s.acquisitions - s.releases == (if (s.readerOwned) 1 else 0),
    s.offset >= 0 and s.offset <= s.expectedSize,
    s.fed == [] or s.fed == [0] or s.fed == [0, 1],
    s.fed.indices().forall(index => s.verified.contains(s.fed.nth(index))),
    s.primary == s.preserved,
    s.cancelFailed implies s.cancelTried and s.primary != "none",
    s.phase == "done" implies not(s.readerOwned),
    s.phase == "done" and s.mode == "whole" implies s.hashDestroyed,
    s.outcome == "verified" implies s.primary == "none" and
      (if (s.mode == "part") s.verified == Set(0) else s.verified == Set(0, 1) and s.fed == [0, 1]) }
  action part = begin("part", true).then(getRecord(true)).then(acquire)
  action whole = begin("whole", true).then(getRecord(true)).then(acquire)
  action validPart = metadata(true).then(fragment(1, true)).then(fragment(1, true)).then(eof).then(release)
  action rejectCleanup(ok: bool): bool = cancelStart.then(cancelResult(ok)).then(release).then(finishError)
  action secondPart = feed.then(getRecord(true)).then(acquire).then(validPart).then(feed)
  run exactBytesRequireEofTest = init.then(part).then(metadata(true)).then(fragment(2, true))
    .expect(s.outcome == "pending" and s.readerOwned).then(eof).then(release).expect(s.outcome == "verified" and invariant)
  run validFragmentedPartReleasesReaderTest = init.then(part).then(validPart).expect(s.releases == 1 and not(s.cancelTried) and invariant)
  run oversizedRequestOwnsNoBodyTest = init.then(begin("part", false)).expect(s.acquisitions == 0 and s.primary == "size" and invariant)
  run missingObjectOwnsNoReaderTest = init.then(begin("part", true)).then(getRecord(false)).expect(s.acquisitions == 0 and s.primary == "missing" and invariant)
  run unavailableObjectIsNotMissingTest = init.then(begin("part", true)).then(fetchError)
    .expect(s.acquisitions == 0 and s.primary == "fetch-error" and invariant)
  run unavailableObjectDestroysWholeHasherTest = init.then(begin("whole", true)).then(fetchError)
    .expect(s.acquisitions == 0 and s.primary == "fetch-error" and s.hashDestroyed and invariant)
  run emptyObjectVerifiesAtEofTest = init.then(begin("part", true)).then(emptyPart).then(getRecord(true)).then(acquire)
    .then(metadata(true)).then(eof).then(release).expect(s.outcome == "verified" and s.offset == 0 and invariant)
  run emptyObjectStillRequiresDigestTest = init.then(begin("part", true)).then(emptyPart).then(getRecord(true)).then(acquire)
    .then(metadata(true)).then(wrongExpectedDigest).then(eof).then(rejectCleanup(true))
    .expect(s.primary == "digest" and s.outcome == "error" and invariant)
  run metadataRefusalCancelsWithoutReadingTest = init.then(part).then(metadata(false)).then(rejectCleanup(true))
    .expect(s.offset == 0 and s.cancelTried and s.sourceClosed and s.primary == "metadata" and invariant)
  run retiredMarkerCancelsAndReleasesWithoutReadingTest = init.then(part).then(retirementMarker).then(rejectCleanup(true))
    .expect(s.offset == 0 and s.cancelTried and s.sourceClosed and s.releases == 1 and s.primary == "retired" and invariant)
  run retiredMarkerCleanupFailurePreservesRefusalTest = init.then(begin("part", true)).then(emptyPart).then(getRecord(true)).then(acquire)
    .then(retirementMarker).then(rejectCleanup(false))
    .expect(s.offset == 0 and s.primary == "retired" and s.verified == Set() and s.cancelFailed and s.releases == 1 and invariant)
  run metadataCleanupFailurePreservesPrimaryTest = init.then(part).then(metadata(false)).then(rejectCleanup(false))
    .expect(s.cancelFailed and not(s.sourceClosed) and s.primary == "metadata" and s.releases == 1 and invariant)
  run overflowCleanupFailurePreservesPrimaryTest = init.then(part).then(metadata(true)).then(fragment(3, true)).then(rejectCleanup(false))
    .expect(s.offset == 0 and s.primary == "overflow" and s.cancelFailed and invariant)
  run readFailureAlwaysReleasesTest = init.then(part).then(metadata(true)).then(readError).then(rejectCleanup(false))
    .expect(s.primary == "read" and not(s.readerOwned) and invariant)
  run truncatedBodyIsNotVerifiedTest = init.then(part).then(metadata(true)).then(fragment(1, true)).then(eof).then(rejectCleanup(true))
    .expect(s.primary == "truncated" and s.verified == Set() and invariant)
  run equalLengthWrongBytesAreNotVerifiedTest = init.then(part).then(metadata(true)).then(fragment(2, false)).then(eof).then(rejectCleanup(true))
    .expect(s.primary == "digest" and s.verified == Set() and invariant)
  run exactLengthBeforeExtraChunkCannotPassTest = init.then(part).then(metadata(true)).then(fragment(2, true)).then(fragment(1, true)).then(rejectCleanup(true))
    .expect(s.primary == "overflow" and s.outcome == "error" and invariant)
  run verifiedPartsNeedWholeDigestTest = init.then(whole).then(validPart).then(secondPart).then(wholeHash(false))
    .expect(s.verified == Set(0, 1) and s.primary == "whole-digest" and s.hashDestroyed and invariant)
  run orderedWholeDigestSucceedsTest = init.then(whole).then(validPart).then(secondPart).then(wholeHash(true))
    .expect(s.outcome == "verified" and s.fed == [0, 1] and s.hashDestroyed and invariant)
  run missingSecondPartDestroysWholeHasherTest = init.then(whole).then(validPart).then(feed).then(getRecord(false))
    .expect(s.fed == [0] and s.primary == "missing" and s.hashDestroyed and invariant)
  run corruptSecondPartNeverFeedsWholeHasherTest = init.then(whole).then(validPart).then(feed).then(getRecord(true)).then(acquire)
    .then(metadata(true)).then(fragment(2, false)).then(eof).then(rejectCleanup(true))
    .expect(s.fed == [0] and s.hashDestroyed and s.releases == 2 and invariant)
  run callerCancellationDoesNotAbortBoundedHelperTest = init.then(part).then(metadata(true)).then(callerCancel)
    .then(fragment(2, true)).then(eof).then(release).expect(s.callerCancelled and s.outcome == "verified" and invariant)
}
