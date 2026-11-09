// @source backend/trace/cloudflare-persistence.ts
// @source src/lib/browser-json.ts
// @evidence scripts/trace-upload-attachable.test.ts
// putTraceBytes and its internal readTraceBytes verification, for one digest
// and at most two calls. HEAD and GET are separate observations; a successful
// or failed PUT reply is never byte-integrity evidence. R2 only receives the
// caller-validated bytes with create-only conditions. No public read is added.
// Size 0/2 and fragments 1/2/3 represent empty, bounded, short and overflowing
// bodies. Digest equality is a predicate, not a cryptographic proof. Each GET
// supplies a fresh unlocked standard stream. Reader release is synchronous;
// cancellation may fail, which does not prove the source has closed.
// The outer method converts an invalid/null internal read into an error. This
// model ends before the D1 attachment protocol represented by api_trace.
module trace_object_storage {
  type State = { phase: str, attempts: int, writes: int, headReads: int,
    expected: int, offset: int, headVerified: bool, bodyAcquired: bool,
    metadataGood: bool, readerOwned: bool, acquisitions: int, releases: int,
    eof: bool, sourceClosed: bool, cancelAttempted: bool, cancelFailed: bool,
    bytesMatch: bool, digestChecked: bool, writeReplyOk: bool,
    primary: str, outcome: str }
  var s: State
  action init = s' = { phase: "idle", attempts: 0, writes: 0, headReads: 0,
    expected: 2, offset: 0, headVerified: false, bodyAcquired: false,
    metadataGood: false, readerOwned: false, acquisitions: 0, releases: 0,
    eof: false, sourceClosed: false, cancelAttempted: false, cancelFailed: false,
    bytesMatch: true, digestChecked: false, writeReplyOk: false,
    primary: "none", outcome: "pending" }
  def terminal(reason: str): State = s.with("phase", "done")
    .with("primary", reason).with("outcome", if (reason == "none") "verified" else "error")
  action begin(size: int): bool = all {
    s.phase == "idle", s.attempts < 2, Set(0, 2).contains(size),
    s' = s.with("phase", "head-first").with("attempts", s.attempts + 1)
      .with("expected", size).with("offset", 0).with("headVerified", false)
      .with("bodyAcquired", false).with("metadataGood", false)
      .with("eof", false).with("sourceClosed", false)
      .with("cancelAttempted", false).with("cancelFailed", false)
      .with("bytesMatch", true).with("digestChecked", false)
      .with("writeReplyOk", false).with("primary", "none").with("outcome", "pending") }
  action headReply(present: bool, metadata: bool): bool = all {
    Set("head-first", "head-after").contains(s.phase),
    s' = (if (present and metadata) s.with("phase", "get").with("headVerified", true)
      else if (not(present) and s.phase == "head-first") s.with("phase", "put")
      else terminal("head-integrity")).with("headReads", s.headReads + 1) }
  action headReject = all { Set("head-first", "head-after").contains(s.phase),
    s' = terminal("head-error") }
  action writeReply(ok: bool): bool = all { s.phase == "put",
    // Both replies require a new HEAD and a byte-verified GET.
    s' = s.with("phase", "head-after").with("writes", s.writes + 1)
      .with("writeReplyOk", ok) }
  action getReply(present: bool, metadata: bool): bool = all { s.phase == "get",
    s' = if (not(present)) terminal("missing")
      else s.with("bodyAcquired", true).with("metadataGood", metadata)
        .with("phase", if (metadata) "read" else "cancel-body")
        .with("readerOwned", metadata)
        .with("acquisitions", s.acquisitions + (if (metadata) 1 else 0))
        .with("primary", if (metadata) "none" else "metadata") }
  action getReject = all { s.phase == "get", s' = terminal("get-error") }
  action fragment(length: int, matching: bool): bool = all {
    s.phase == "read", Set(1, 2, 3).contains(length),
    s' = if (s.offset + length > s.expected)
      s.with("phase", "cancel-reader").with("primary", "overflow")
      else s.with("offset", s.offset + length).with("bytesMatch", s.bytesMatch and matching) }
  action readReject = all { s.phase == "read",
    s' = s.with("phase", "cancel-reader").with("primary", "read-error") }
  action readRangeReject = all { s.phase == "read",
    s' = s.with("phase", "cancel-reader").with("primary", "range-error") }
  action endBody = all { s.phase == "read",
    s' = s.with("phase", "release-complete").with("eof", true).with("sourceClosed", true) }
  action cancelReply(ok: bool): bool = all {
    Set("cancel-body", "cancel-reader").contains(s.phase),
    s' = (if (s.phase == "cancel-body") terminal(s.primary)
      else s.with("phase", "release-error"))
      .with("cancelAttempted", true).with("cancelFailed", not(ok))
      .with("sourceClosed", s.sourceClosed or ok) }
  action releaseReader = all {
    Set("release-complete", "release-error").contains(s.phase), s.readerOwned,
    s' = (if (s.phase == "release-error") terminal(s.primary)
      else if (s.offset != s.expected) terminal("length")
      else s.with("phase", "hash"))
      .with("readerOwned", false).with("releases", s.releases + 1) }
  action hashDone = all { s.phase == "hash",
    s' = terminal(if (s.bytesMatch) "none" else "digest").with("digestChecked", true) }
  action hashReject = all { s.phase == "hash", s' = terminal("hash-error") }
  action retry = all { s.phase == "done", s.attempts < 2,
    s' = s.with("phase", "idle").with("outcome", "pending").with("primary", "none") }
  action step = {
    nondet ok = Set(false, true).oneOf()
    nondet present = Set(false, true).oneOf()
    nondet size = Set(0, 2).oneOf()
    nondet length = Set(1, 2, 3).oneOf()
    any { begin(size), headReply(present, ok), headReject, writeReply(ok),
      getReply(present, ok), getReject, fragment(length, ok), readReject, readRangeReject,
      endBody, cancelReply(ok), releaseReader, hashDone, hashReject, retry, s' = s }
  }
  val invariant = all {
    s.attempts >= 0 and s.attempts <= 2,
    s.writes <= s.attempts, s.headReads <= 2 * s.attempts,
    s.releases <= s.acquisitions, s.acquisitions <= s.attempts,
    s.acquisitions - s.releases == (if (s.readerOwned) 1 else 0),
    s.offset >= 0 and s.offset <= s.expected,
    s.readerOwned implies s.bodyAcquired and s.metadataGood,
    s.cancelFailed implies s.cancelAttempted,
    s.phase == "done" implies not(s.readerOwned),
    s.phase == "done" and s.bodyAcquired implies s.eof or s.cancelAttempted,
    s.outcome == "error" implies s.primary != "none",
    s.outcome == "verified" implies all { s.phase == "done", s.primary == "none",
      s.headVerified, s.metadataGood, s.eof, s.offset == s.expected,
      s.bytesMatch, s.digestChecked, not(s.cancelAttempted) }
  }
  action existing = begin(2).then(headReply(true, true)).then(getReply(true, true))
  action written = begin(2).then(headReply(false, false)).then(writeReply(true))
  action exactBody = fragment(2, true).then(endBody).then(releaseReader).then(hashDone)
  run existingBytesNeedNoWriteTest = init.then(existing).then(exactBody)
    .expect(s.outcome == "verified" and s.writes == 0 and invariant)
  run createdBytesRequireFreshObservationsTest = init.then(written)
    .expect(s.outcome == "pending" and not(s.digestChecked))
    .then(headReply(true, true)).then(getReply(true, true)).then(exactBody)
    .expect(s.outcome == "verified" and s.headReads == 2 and invariant)
  run lostWriteReplyCanReconcileExactBytesTest = init.then(begin(2)).then(headReply(false, false))
    .then(writeReply(false)).then(headReply(true, true)).then(getReply(true, true)).then(exactBody)
    .expect(s.outcome == "verified" and not(s.writeReplyOk) and invariant)
  run writeReplyDoesNotProveStorageTest = init.then(written).then(headReply(false, false))
    .expect(s.outcome == "error" and not(s.bodyAcquired) and invariant)
  run changedHeadMetadataRefusesBeforeGetTest = init.then(written).then(headReply(true, false))
    .expect(s.primary == "head-integrity" and s.acquisitions == 0 and invariant)
  run existingBadHeadIsNotOverwrittenTest = init.then(begin(2)).then(headReply(true, false))
    .expect(s.outcome == "error" and s.writes == 0 and invariant)
  run failedHeadOwnsNoBodyTest = init.then(begin(2)).then(headReject)
    .expect(s.primary == "head-error" and not(s.bodyAcquired) and invariant)
  run missingGetOwnsNoBodyTest = init.then(begin(2)).then(headReply(true, true)).then(getReply(false, false))
    .expect(s.primary == "missing" and not(s.cancelAttempted) and invariant)
  run failedGetOwnsNoBodyTest = init.then(begin(2)).then(headReply(true, true)).then(getReject)
    .expect(s.primary == "get-error" and s.acquisitions == 0 and invariant)
  run mismatchedGetCancelsWithoutReadingTest = init.then(begin(2)).then(headReply(true, true))
    .then(getReply(true, false)).then(cancelReply(true))
    .expect(s.primary == "metadata" and s.cancelAttempted and s.acquisitions == 0 and invariant)
  run rejectedCancellationPreservesIntegrityRefusalTest = init.then(begin(2)).then(headReply(true, true))
    .then(getReply(true, false)).then(cancelReply(false))
    .expect(s.primary == "metadata" and s.cancelFailed and not(s.sourceClosed) and invariant)
  run emptyObjectStillNeedsHashTest = init.then(begin(0)).then(headReply(true, true))
    .then(getReply(true, true)).then(endBody).then(releaseReader)
    .expect(s.outcome == "pending" and not(s.readerOwned)).then(hashDone)
    .expect(s.outcome == "verified" and invariant)
  run shortBodyReleasesBeforeRefusalTest = init.then(existing).then(fragment(1, true))
    .then(endBody).then(releaseReader)
    .expect(s.primary == "length" and s.releases == 1 and not(s.cancelAttempted) and invariant)
  run wrongDigestReleasesBeforeRefusalTest = init.then(existing).then(fragment(2, false))
    .then(endBody).then(releaseReader).then(hashDone)
    .expect(s.primary == "digest" and not(s.cancelAttempted) and invariant)
  run overflowCancelsAndReleasesTest = init.then(existing).then(fragment(3, true))
    .then(cancelReply(true)).then(releaseReader)
    .expect(s.primary == "overflow" and s.releases == 1 and invariant)
  run failedOverflowCancellationPreservesRefusalTest = init.then(existing).then(fragment(3, true))
    .then(cancelReply(false)).then(releaseReader)
    .expect(s.primary == "overflow" and s.cancelFailed and invariant)
  run failedReadCancellationPreservesReadErrorTest = init.then(existing).then(readReject)
    .then(cancelReply(false)).then(releaseReader)
    .expect(s.primary == "read-error" and s.releases == 1 and invariant)
  run rangeReadFailureStillDisposesTheReaderTest = init.then(existing).then(readRangeReject)
    .then(cancelReply(true)).then(releaseReader)
    .expect(s.primary == "range-error" and s.releases == 1 and invariant)
  run hashFailureOwnsNoReaderTest = init.then(existing).then(fragment(2, true))
    .then(endBody).then(releaseReader).then(hashReject)
    .expect(s.primary == "hash-error" and not(s.readerOwned) and invariant)
  run exactByteCountBeforeExtraFragmentDoesNotPassTest = init.then(existing).then(fragment(2, true))
    .then(fragment(1, true)).then(cancelReply(true)).then(releaseReader)
    .expect(s.primary == "overflow" and s.outcome == "error" and invariant)
  run laterRetryMustVerifyAgainTest = init.then(begin(2)).then(headReply(true, true))
    .then(getReply(true, false)).then(cancelReply(false)).then(retry)
    .then(existing).then(exactBody)
    .expect(s.attempts == 2 and s.outcome == "verified" and s.acquisitions == 1 and invariant)
}
