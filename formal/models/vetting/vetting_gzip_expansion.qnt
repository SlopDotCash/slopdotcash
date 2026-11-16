// @source workers/vetting/gzip-inputs.ts
// @source workers/vetting/bounded-scan.ts
// @source workers/vetting/run.ts
// One transparent compression wrapper with two member headers and one leaf
// represent an arbitrary finite gzip chain. Two headers are a finite quotient,
// not an input/member bound. Complete decoding abstracts CRC validation and exact
// input consumption; codec correctness is an external-library assumption
// checked with corrupt/truncated/trailing-data implementation counterexamples.
// Each member's lossless header inventory is bound to its archive and original
// path; neither filename/comment metadata nor duplicate compressed bytes may
// redirect a derived path or merge two distinct original-path header identities.
// Concrete byte encodings, unique path hashes and optional FNAME/FCOMMENT/FEXTRA
// serialization remain implementation-test obligations, not a digest theorem.
// This models preprocessing and retained lineage only. Opaque child release
// remains in the existing isolated-inspection/disposition models; a wrapper
// release is never a malicious finding, moderator decision or admission.
module vetting_gzip_expansion {
  var s: { phase: str, wrapper: str, completeInput: bool, decoded: bool,
    kind: str, child: str, parentBound: bool, linkPresent: bool,
    linkRetained: bool, payloadReviewed: bool, headersInventoried: bool,
    headersReviewed: Set[int], headerPathBound: bool, gap: bool, clean: bool,
    moderatorDecision: bool }

  action init = s' = { phase: "input", wrapper: "unclassified",
    completeInput: false, decoded: false, kind: "none", child: "none",
    parentBound: false, linkPresent: false, linkRetained: false,
    payloadReviewed: false, headersInventoried: false, headersReviewed: Set(),
    headerPathBound: false, gap: false, clean: false, moderatorDecision: false }

  action originalSymlink = all { s.phase == "input", not(s.linkPresent),
    s' = s.with("linkPresent", true).with("linkRetained", true) }

  action decodeComplete(kind: str): bool = all {
    s.phase == "input", kind.in(Set("source", "native", "unknown", "archive")),
    s' = s.with("phase", "decoded").with("wrapper", "released")
      .with("completeInput", true).with("decoded", true).with("kind", kind)
      .with("child", if (kind == "source") "none" else "quarantined")
      .with("parentBound", true).with("headersInventoried", true)
      .with("headerPathBound", true),
  }

  action decodeFailure = all { s.phase == "input",
    s' = s.with("phase", "unreadable").with("wrapper", "quarantined").with("gap", true) }

  action reviewPayload = all { s.phase == "decoded", s.kind == "source",
    s' = s.with("payloadReviewed", true) }

  action reviewHeader(member: int): bool = all {
    s.phase == "decoded", s.headersInventoried, member.in(Set(1, 2)),
    s' = s.with("headersReviewed", s.headersReviewed.union(Set(member))),
  }

  action reviewAllHeaders = reviewHeader(1).then(reviewHeader(2))

  action discoverGap = all { not(s.clean), s' = s.with("gap", true) }

  action publishClean = all {
    s.phase == "decoded", s.wrapper == "released", s.completeInput,
    s.kind == "source", s.payloadReviewed, s.headersInventoried,
    s.headersReviewed == Set(1, 2), s.headerPathBound, s.child == "none", not(s.gap),
    s.parentBound, s.linkPresent implies s.linkRetained,
    s' = s.with("phase", "published").with("clean", true),
  }

  action step = {
    nondet kind = Set("source", "native", "unknown", "archive").oneOf()
    nondet member = Set(1, 2).oneOf()
    any { originalSymlink, decodeComplete(kind), decodeFailure,
      reviewPayload, reviewHeader(member), discoverGap, publishClean, s' = s }
  }

  val invariant = all {
    s.wrapper == "released" implies all { s.completeInput, s.decoded, s.parentBound,
      s.headersInventoried, s.headerPathBound },
    s.linkPresent implies s.linkRetained,
    s.kind.in(Set("native", "unknown", "archive")) implies s.child == "quarantined",
    s.clean implies all { s.completeInput, s.payloadReviewed, s.kind == "source",
      s.headersInventoried, s.headersReviewed == Set(1, 2), s.headerPathBound,
      not(s.gap), s.parentBound, s.linkPresent implies s.linkRetained },
    not(s.moderatorDecision),
  }

  run decodedSourceStillRequiresReviewTest = init.then(decodeComplete("source"))
    .expect(not(s.clean) and not(s.payloadReviewed)).then(reviewPayload)
    .then(reviewAllHeaders).then(publishClean).expect(s.clean and invariant)

  run payloadOnlyMissesOptionalHeaderInstructionsTest = init
    .then(decodeComplete("source")).then(reviewPayload)
    .expect(s.headersInventoried and s.headersReviewed == Set() and not(s.clean) and invariant)

  run laterMemberHeaderMustAlsoBeReviewedTest = init.then(decodeComplete("source"))
    .then(reviewPayload).then(reviewHeader(1))
    .expect(s.headersReviewed == Set(1) and not(s.clean) and invariant)
    .then(reviewHeader(2)).then(publishClean).expect(s.clean and invariant)

  run corruptOrPartlyConsumedInputStaysHeldTest = init.then(decodeFailure)
    .expect(s.gap and s.wrapper == "quarantined" and not(s.clean) and invariant)

  run nativeChildKeepsIndependentQuarantineTest = init.then(decodeComplete("native"))
    .expect(s.wrapper == "released" and s.child == "quarantined" and not(s.clean) and invariant)

  run unknownAndNestedArchiveDoNotClearTest = init.then(decodeComplete("archive"))
    .expect(s.parentBound and s.child == "quarantined" and not(s.clean) and invariant)

  run originalCompressedSymlinkLineageSurvivesTest = init.then(originalSymlink)
    .then(decodeComplete("source")).then(reviewPayload).then(reviewAllHeaders).then(publishClean)
    .expect(s.linkPresent and s.linkRetained and s.clean and invariant)

  run ordinaryGapCannotBeErasedByWrapperTest = init.then(discoverGap)
    .then(decodeComplete("source")).then(reviewPayload)
    .expect(s.gap and not(s.clean) and invariant)
}
