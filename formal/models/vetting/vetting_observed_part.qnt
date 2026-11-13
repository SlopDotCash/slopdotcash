// @source backend/vetting/evidence-chunks.ts
// @source workers/vetting-backup/core.ts
// @evidence scripts/vetting-api.test.ts
// One observedPart invocation and one acquired R2 body. Two abstract byte
// units represent a valid bounded size; zero represents an empty body. The
// invalid size classes cover negative, fractional/nonfinite and >8 MiB sizes.
// Fragments contain one/two units, or an overflowing third. SHA computation is
// an explicit predicate over the complete observed bytes, not a crypto proof.
//
// The GET response owns its advertised size and marker flag. getReader takes
// ownership before marker/size checks. Fresh unlocked R2 streams are an input
// contract; prelocked streams and allocation/crypto implementation failures
// are outside this bound. The metadata hash and expected evidence digest are
// independent observations which this helper never accepts as byte proof.
// A successful result describes the complete body actually read, even if its
// digest disagrees with the evidence declaration or metadata. It never marks
// declared evidence verified or authorizes a backed retirement/deletion.
//
// Missing/rejected GET owns no reader. After acquisition every refusal attempts
// cancellation, preserves the primary reason even if cancellation fails, and
// releases the lock. A failed cancel does not establish source closure. A
// caller abandoning outer work does not abort this bounded helper: it has no
// abort-signal argument. These are authored scenarios only, with no executed
// parser, checker, tests, provider requests, or runtime conformance claim.
module vetting_observed_part {
  val sizeClasses = Set("empty", "bounded", "negative", "fractional", "oversized")
  var s: { phase: str, sizeClass: str, headerSize: int, offset: int,
    marked: bool, metadataMatches: bool, declaredMatches: bool,
    allocated: bool, readerOwned: bool, acquisitions: int, releases: int,
    sourceClosed: bool, eofSeen: bool, cancelTried: bool, cancelFailed: bool,
    primary: str, preserved: str, digestFromRead: bool, returnedSize: int,
    declaredVerified: bool, callerCancelled: bool, outcome: str }
  action init = s' = { phase: "get", sizeClass: "bounded", headerSize: 2, offset: 0,
    marked: false, metadataMatches: true, declaredMatches: true,
    allocated: false, readerOwned: false, acquisitions: 0, releases: 0,
    sourceClosed: false, eofSeen: false, cancelTried: false, cancelFailed: false,
    primary: "none", preserved: "none", digestFromRead: false, returnedSize: -1,
    declaredVerified: false, callerCancelled: false, outcome: "pending" }
  action source(sizeClass: str, marked: bool, metadataMatches: bool, declaredMatches: bool): bool = all {
    s.phase == "get", sizeClasses.contains(sizeClass),
    s' = s.with("sizeClass", sizeClass).with("headerSize", if (sizeClass == "empty") 0 else 2)
      .with("marked", marked).with("metadataMatches", metadataMatches).with("declaredMatches", declaredMatches) }
  action getRecord(outcome: str): bool = all { s.phase == "get", Set("present", "missing", "rejected").contains(outcome),
    s' = if (outcome == "present") s.with("phase", "acquire")
      else s.with("phase", "done").with("outcome", "error")
        .with("primary", if (outcome == "missing") "missing" else "fetch")
        .with("preserved", if (outcome == "missing") "missing" else "fetch") }
  action acquire = all { s.phase == "acquire",
    s' = s.with("phase", "marker").with("readerOwned", true).with("acquisitions", 1) }
  action marker = all { s.phase == "marker",
    s' = if (s.marked) s.with("phase", "cancel").with("primary", "retired").with("preserved", "retired")
      else s.with("phase", "size") }
  action byteSize = all { s.phase == "size",
    s' = if (Set("empty", "bounded").contains(s.sizeClass)) s.with("phase", "read").with("allocated", true)
      else s.with("phase", "cancel").with("primary", "size").with("preserved", "size") }
  action fragment(byteLength: int): bool = all { s.phase == "read", Set(1, 2, 3).contains(byteLength),
    s' = if (s.offset + byteLength > s.headerSize)
      s.with("phase", "cancel").with("primary", "length").with("preserved", "length")
      else s.with("offset", s.offset + byteLength) }
  action readError = all { s.phase == "read",
    s' = s.with("phase", "cancel").with("primary", "read").with("preserved", "read") }
  action eof = all { s.phase == "read",
    s' = s.with("eofSeen", true).with("sourceClosed", true)
      .with("phase", if (s.offset == s.headerSize) "digest" else "cancel")
      .with("primary", if (s.offset == s.headerSize) "none" else "length")
      .with("preserved", if (s.offset == s.headerSize) "none" else "length") }
  action digest = all { s.phase == "digest",
    s' = s.with("digestFromRead", true).with("returnedSize", s.offset).with("phase", "release-success") }
  action cancelStart = all { s.phase == "cancel",
    s' = s.with("phase", "cancel-pending").with("cancelTried", true) }
  action cancelResult(ok: bool): bool = all { s.phase == "cancel-pending",
    s' = s.with("phase", "release-failure").with("cancelFailed", not(ok))
      .with("sourceClosed", s.sourceClosed or ok) }
  action release = all { Set("release-success", "release-failure").contains(s.phase), s.readerOwned,
    s' = s.with("phase", "done").with("readerOwned", false).with("releases", 1)
      .with("outcome", if (s.phase == "release-success") "observed" else "error") }
  action callerCancel = all { s.phase == "read", not(s.callerCancelled),
    s' = s.with("callerCancelled", true) }
  action step = {
    nondet sizeClass = sizeClasses.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet metadataMatches = Set(false, true).oneOf()
    nondet declaredMatches = Set(false, true).oneOf()
    nondet outcome = Set("present", "missing", "rejected").oneOf()
    nondet byteLength = Set(1, 2, 3).oneOf()
    any { source(sizeClass, yes, metadataMatches, declaredMatches), getRecord(outcome), acquire, marker, byteSize,
      fragment(byteLength), readError, eof, digest, cancelStart, cancelResult(yes), release, callerCancel, s' = s }
  }
  val invariant = all {
    s.releases <= s.acquisitions, s.acquisitions <= 1,
    s.acquisitions - s.releases == (if (s.readerOwned) 1 else 0),
    s.offset >= 0 and s.offset <= s.headerSize,
    s.primary == s.preserved, not(s.declaredVerified),
    s.cancelFailed implies s.cancelTried and s.primary != "none",
    s.phase == "done" implies not(s.readerOwned),
    s.allocated implies Set("empty", "bounded").contains(s.sizeClass) and not(s.marked),
    s.digestFromRead implies s.eofSeen and s.returnedSize == s.headerSize,
    s.outcome == "observed" implies s.primary == "none" and s.digestFromRead and s.sourceClosed and s.releases == 1 }
  action acquired = getRecord("present").then(acquire)
  action reading = acquired.then(marker).then(byteSize)
  action complete = eof.then(digest).then(release)
  action cleanup(ok: bool): bool = cancelStart.then(cancelResult(ok)).then(release)
  run completeObservedBodyComputesOwnDigestTest = init.then(reading).then(fragment(1)).then(fragment(1)).then(complete)
    .expect(s.outcome == "observed" and s.returnedSize == 2 and invariant)
  run staleMetadataDoesNotBlockRawPreservationTest = init.then(source("bounded", false, false, true)).then(reading).then(fragment(2)).then(complete)
    .expect(not(s.metadataMatches) and s.outcome == "observed" and invariant)
  run changedBodyDoesNotVerifyDeclaredEvidenceTest = init.then(source("bounded", false, true, false)).then(reading).then(fragment(2)).then(complete)
    .expect(not(s.declaredMatches) and s.outcome == "observed" and not(s.declaredVerified) and invariant)
  run metadataAndExpectedDigestCanBothDifferTest = init.then(source("bounded", false, false, false)).then(reading).then(fragment(2)).then(complete)
    .expect(s.outcome == "observed" and s.digestFromRead and not(s.declaredVerified) and invariant)
  run emptyObservedBodyStillRequiresEofTest = init.then(source("empty", false, false, false)).then(reading)
    .expect(s.outcome == "pending" and not(s.digestFromRead)).then(complete)
    .expect(s.outcome == "observed" and s.returnedSize == 0 and invariant)
  run advertisedLengthWithoutEofIsNotSuccessTest = init.then(reading).then(fragment(2))
    .expect(s.offset == 2 and s.outcome == "pending" and s.readerOwned and not(s.digestFromRead) and invariant)
  run missingBodyOwnsNoReaderTest = init.then(getRecord("missing"))
    .expect(s.primary == "missing" and s.acquisitions == 0 and not(s.cancelTried) and invariant)
  run unavailableBodyIsNotMissingTest = init.then(getRecord("rejected"))
    .expect(s.primary == "fetch" and s.acquisitions == 0 and invariant)
  run negativeAdvertisedSizeReleasesOwnedBodyTest = init.then(source("negative", false, true, true)).then(acquired).then(marker).then(byteSize).then(cleanup(true))
    .expect(s.primary == "size" and not(s.allocated) and s.releases == 1 and invariant)
  run fractionalAdvertisedSizeRefusesTest = init.then(source("fractional", false, true, true)).then(acquired).then(marker).then(byteSize).then(cleanup(true))
    .expect(s.primary == "size" and s.offset == 0 and invariant)
  run oversizedAdvertisedSizeRefusesBeforeAllocationTest = init.then(source("oversized", false, true, true)).then(acquired).then(marker).then(byteSize).then(cleanup(false))
    .expect(s.primary == "size" and not(s.allocated) and s.cancelFailed and s.releases == 1 and invariant)
  run retirementMarkerPrecedesInvalidSizeTest = init.then(source("oversized", true, false, false)).then(acquired).then(marker).then(cleanup(true))
    .expect(s.primary == "retired" and not(s.allocated) and s.offset == 0 and invariant)
  run emptyMarkerNeverBecomesObservedEvidenceTest = init.then(source("empty", true, false, false)).then(acquired).then(marker).then(cleanup(false))
    .expect(s.primary == "retired" and not(s.digestFromRead) and s.cancelFailed and s.releases == 1 and invariant)
  run overflowingFragmentIsNotPartiallyAcceptedTest = init.then(reading).then(fragment(1)).then(fragment(2)).then(cleanup(true))
    .expect(s.offset == 1 and s.primary == "length" and not(s.digestFromRead) and invariant)
  run truncatedBodyCannotProduceObservedDigestTest = init.then(reading).then(fragment(1)).then(eof).then(cleanup(true))
    .expect(s.primary == "length" and s.eofSeen and not(s.digestFromRead) and invariant)
  run readFailureAndFailedCancelPreserveOriginalErrorTest = init.then(reading).then(readError).then(cleanup(false))
    .expect(s.primary == "read" and s.cancelFailed and not(s.sourceClosed) and s.releases == 1 and invariant)
  run extraFragmentAfterExactLengthRefusesTest = init.then(reading).then(fragment(2)).then(fragment(1)).then(cleanup(true))
    .expect(s.primary == "length" and s.offset == 2 and not(s.digestFromRead) and invariant)
  run outerCancellationDoesNotAbortBoundedObservationTest = init.then(reading).then(callerCancel).then(fragment(2)).then(complete)
    .expect(s.callerCancelled and s.outcome == "observed" and invariant)
}
