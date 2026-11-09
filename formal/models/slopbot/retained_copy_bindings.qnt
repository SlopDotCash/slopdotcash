// @source workers/slopbot/value-retained-copy.ts
// @source workers/slopbot/value-work-unit.ts
// @source workers/slopbot/verified-retained-binding.ts
// @source workers/slopbot/value-retained-reference.ts
// @source workers/slopbot/value-manifest-identity.ts
// @evidence workers/slopbot/accepted-promotion.test.ts
// Two original sources, each with one commit/path, and two candidate accepted
// commit/path keys. Inputs classify one immutable captured evidence set; this
// helper does not fetch new PR state or write a journal. A retained-reference
// lookup may reject, in which case no result is returned, even after an earlier
// binding was accumulated. Candidate keys include repository, SHA and path.
// same-source means same repository, a different PR, a merged outcome with a
// merge SHA, a non-bot merger and overlapping paths. Reopen proof includes
// same human author, ordered complete ordinary-commit history, exact net edits,
// PR relationship and closure/merge ordering. Comment proof includes merger
// identity, time, wording, older original PR and exact merge/reference binding.
// These are predicates, not proofs of hashes, GitHub identity or patch parsing.
// An unacknowledged-copy predicate includes a PR relationship, matching edits
// and absence of an independently acknowledged carrier of the same commit.
// Matching kinds preserve exact edits, manifest identity and uniquely bound
// ancestor hunks; the low-level graph/hunk algorithms remain separate models.
// A promotion is skipped only when it has no admitted integration. Zero/many
// matches and competing originals retain limitations; prior Map entries are
// not rolled back. Downstream publication must reject every such partial result.
// Existing accepted-promotion definitions are partial conformance evidence.
// These scenarios have not been parsed, simulated or executed.
module retained_copy_bindings {
  val ids = Set(1, 2)
  val sourceKinds = Set("original", "accepted", "promotion")
  val identities = Set("same-source", "foreign-repository", "same-pr", "unmerged", "no-merge", "bot", "no-overlap")
  val proofs = Set("none", "reopen", "bad-reopen", "comment", "bad-comment")
  val matchKinds = Set("none", "exact", "manifest", "ancestor", "ambiguous-hunks")
  var s: { phase: str, original: int, kind: str, inspected: Set[int],
    admitted: Set[int], unacknowledged: Set[int], matched: Set[int],
    compared: Set[int], owners: int -> int, limitations: Set[int],
    finished: Set[int], returned: bool, usable: bool, published: bool }
  action init = s' = { phase: "origin", original: 1, kind: "original",
    inspected: Set(), admitted: Set(), unacknowledged: Set(), matched: Set(),
    compared: Set(), owners: ids.mapBy(_ => 0), limitations: Set(),
    finished: Set(), returned: false, usable: false, published: false }
  val nextOrigin = if (s.original == 1) "origin" else "finished"
  val finishedOrigin = s.with("phase", nextOrigin).with("finished", s.finished.union(Set(s.original)))
    .with("original", 2)
  action begin(kind: str): bool = all { s.phase == "origin", sourceKinds.contains(kind),
    s' = s.with("phase", "candidates").with("kind", kind).with("inspected", Set())
      .with("admitted", Set()).with("unacknowledged", Set()).with("matched", Set()).with("compared", Set()) }
  action candidate(id: int, identity: str, proof: str, unacknowledgedCopy: bool): bool = {
    val accepted = s.kind != "accepted" and identity == "same-source" and Set("reopen", "comment").contains(proof)
    all { s.phase == "candidates", ids.contains(id), not(s.inspected.contains(id)),
      identities.contains(identity), proofs.contains(proof),
      s' = s.with("inspected", s.inspected.union(Set(id)))
        .with("admitted", if (accepted) s.admitted.union(Set(id)) else s.admitted)
        .with("unacknowledged", if (s.kind != "accepted" and Set("same-source", "no-merge", "bot", "no-overlap").contains(identity) and unacknowledgedCopy)
          s.unacknowledged.union(Set(id)) else s.unacknowledged) }
  }
  action admissions = {
    val ambiguous = s.unacknowledged.exclude(s.admitted) != Set()
    val skipped = s.kind == "accepted" or (s.kind == "promotion" and s.admitted == Set())
    val recorded = if (not(skipped) and ambiguous) s.limitations.union(Set(s.original)) else s.limitations
    all { s.phase == "candidates", s.inspected == ids,
      s' = if (skipped or s.admitted == Set()) finishedOrigin.with("limitations", recorded)
        else s.with("phase", "file").with("limitations", recorded) }
  }
  action fileEvidence(complete: bool): bool = all { s.phase == "file",
    s' = if (complete) s.with("phase", "matches")
      else finishedOrigin.with("limitations", s.limitations.union(Set(s.original))) }
  action matchCandidate(id: int, kind: str): bool = all { s.phase == "matches", s.admitted.contains(id),
    not(s.compared.contains(id)), matchKinds.contains(kind),
    s' = s.with("compared", s.compared.union(Set(id)))
      .with("matched", if (Set("exact", "manifest", "ancestor").contains(kind)) s.matched.union(Set(id)) else s.matched) }
  action bind = {
    val key = if (s.matched.contains(1)) 1 else 2
    val unique = s.matched.size() == 1 and s.owners.get(key) == 0
    all { s.phase == "matches", s.compared == s.admitted,
      s' = if (unique) finishedOrigin.with("owners", s.owners.set(key, s.original))
        else finishedOrigin.with("limitations", s.limitations.union(Set(s.original))) }
  }
  action referenceFailure = all { s.phase == "candidates", s.kind != "accepted", s' = s.with("phase", "error") }
  action returnResult = all { s.phase == "finished", s' = s.with("phase", "result")
    .with("returned", true).with("usable", s.limitations == Set()) }
  // Represents the caller's additional checks, not publication by this helper.
  action downstream(otherChecks: bool): bool = all { s.phase == "result", s.usable, otherChecks,
    s' = s.with("published", true) }
  action oldIgnoreLimitations = all { s.phase == "result", s.limitations != Set(),
    s' = s.with("published", true) }
  action step = {
    nondet id = ids.oneOf()
    nondet source = sourceKinds.oneOf()
    nondet identity = identities.oneOf()
    nondet proof = proofs.oneOf()
    nondet matchKind = matchKinds.oneOf()
    nondet yes = Set(false, true).oneOf()
    any { begin(source), candidate(id, identity, proof, yes), admissions, fileEvidence(yes),
      matchCandidate(id, matchKind), bind, referenceFailure, returnResult, downstream(yes), s' = s }
  }
  val invariant = all { ids.contains(s.original), s.inspected.subseteq(ids), s.admitted.subseteq(s.inspected),
    s.compared.subseteq(s.admitted), s.matched.subseteq(s.compared), s.limitations.subseteq(ids),
    ids.forall(key => Set(0, 1, 2).contains(s.owners.get(key))),
    s.returned implies s.phase == "result" and s.finished == ids,
    s.usable implies s.returned and s.limitations == Set(),
    s.published implies s.returned and s.limitations == Set(),
    s.phase == "error" implies not(s.returned) and not(s.published) }
  action oneIntegration(kind: str, proof: str): bool = begin(kind)
    .then(candidate(1, "same-source", proof, false)).then(candidate(2, "foreign-repository", "none", false)).then(admissions)
  action matched(kind: str): bool = fileEvidence(true).then(matchCandidate(1, kind)).then(bind)
  action skipLast = begin("accepted").then(candidate(1, "same-source", "reopen", false))
    .then(candidate(2, "same-source", "comment", false)).then(admissions).then(returnResult)
  run sameAuthorReopenBindsTest = init.then(oneIntegration("original", "reopen")).then(matched("exact"))
    .then(skipLast).expect(s.owners.get(1) == 1 and s.usable and invariant)
  run authenticatedCommentBindsTest = init.then(oneIntegration("original", "comment")).then(matched("exact"))
    .then(skipLast).expect(s.usable and invariant)
  run manifestIdentityBindsTest = init.then(oneIntegration("original", "comment")).then(matched("manifest"))
    .then(skipLast).expect(s.owners.get(1) == 1 and invariant)
  run uniqueAncestorHunksBindTest = init.then(oneIntegration("original", "comment")).then(matched("ancestor"))
    .then(skipLast).expect(s.owners.get(1) == 1 and invariant)
  run ambiguousAncestorHunksDoNotBindTest = init.then(oneIntegration("original", "comment")).then(matched("ambiguous-hunks"))
    .then(skipLast).expect(s.owners.get(1) == 0 and not(s.usable) and invariant)
  run changedAuthorNeedsCommentTest = init.then(begin("original")).then(candidate(1, "same-source", "bad-reopen", true))
    .then(candidate(2, "foreign-repository", "none", false)).then(admissions).then(skipLast)
    .expect(s.limitations == Set(1) and not(s.usable) and invariant)
  run forgedOrLateCommentDoesNotAcknowledgeTest = init.then(begin("original")).then(candidate(1, "same-source", "bad-comment", true))
    .then(candidate(2, "foreign-repository", "none", false)).then(admissions).then(skipLast)
    .expect(not(s.usable) and s.owners.get(1) == 0 and invariant)
  run foreignRepositoryCannotBindTest = init.then(begin("original")).then(candidate(1, "foreign-repository", "comment", false))
    .then(candidate(2, "foreign-repository", "reopen", false)).then(admissions).then(skipLast)
    .expect(s.owners.get(1) == 0 and s.owners.get(2) == 0 and invariant)
  run samePrCannotBindItselfTest = init.then(begin("original")).then(candidate(1, "same-pr", "comment", false))
    .then(candidate(2, "unmerged", "comment", false)).then(admissions).then(skipLast)
    .expect(s.owners.get(1) == 0 and invariant)
  run botMergerCannotAcknowledgeTest = init.then(begin("original")).then(candidate(1, "bot", "comment", false))
    .then(candidate(2, "no-merge", "comment", false)).then(admissions).then(skipLast)
    .expect(s.owners.get(1) == 0 and invariant)
  run acceptedOriginalIsSkippedTest = init.then(begin("accepted")).then(candidate(1, "same-source", "comment", true))
    .then(candidate(2, "same-source", "reopen", true)).then(admissions).then(skipLast)
    .expect(s.limitations == Set() and s.owners.get(1) == 0 and invariant)
  run independentlyAcceptedPromotionNeedsNoNewBindingTest = init.then(begin("promotion"))
    .then(candidate(1, "same-source", "none", true)).then(candidate(2, "foreign-repository", "none", false))
    .then(admissions).then(skipLast).expect(s.usable and s.owners.get(1) == 0 and invariant)
  run acknowledgedPromotionStillChecksFilesTest = init.then(oneIntegration("promotion", "comment")).then(fileEvidence(false))
    .then(skipLast).expect(not(s.usable) and invariant)
  run incompleteOriginalFileIsHeldTest = init.then(oneIntegration("original", "comment")).then(fileEvidence(false))
    .then(skipLast).expect(s.limitations == Set(1) and invariant)
  run zeroExactMatchesIsHeldTest = init.then(oneIntegration("original", "comment")).then(matched("none"))
    .then(skipLast).expect(not(s.usable) and invariant)
  run twoExactMatchesAreAmbiguousTest = init.then(begin("original")).then(candidate(1, "same-source", "comment", false))
    .then(candidate(2, "same-source", "reopen", false)).then(admissions).then(fileEvidence(true))
    .then(matchCandidate(1, "exact")).then(matchCandidate(2, "exact")).then(bind).then(skipLast)
    .expect(s.limitations == Set(1) and s.owners.get(1) == 0 and invariant)
  run competingOriginalsRetainFirstMapEntryAndHoldTest = init.then(oneIntegration("original", "comment")).then(matched("exact"))
    .then(oneIntegration("original", "comment")).then(matched("exact")).then(returnResult)
    .expect(s.owners.get(1) == 1 and s.limitations == Set(2) and not(s.usable) and invariant)
  run laterFailureReturnsPartialMapWithLimitationsTest = init.then(oneIntegration("original", "comment")).then(matched("exact"))
    .then(oneIntegration("original", "comment")).then(fileEvidence(false)).then(returnResult)
    .expect(s.owners.get(1) == 1 and s.returned and not(s.usable) and invariant)
  run referenceLookupRejectsWithoutReturningPartialMapTest = init.then(oneIntegration("original", "comment")).then(matched("exact"))
    .then(begin("original")).then(referenceFailure).expect(s.owners.get(1) == 1 and not(s.returned) and invariant)
  run cleanResultStillNeedsOtherPublicationChecksTest = init.then(oneIntegration("original", "comment")).then(matched("exact"))
    .then(skipLast).expect(not(s.published) and invariant).then(downstream(false).fail())
  run ignoringPartialResultLimitationsNegativeControlTest = init.then(oneIntegration("original", "comment")).then(matched("exact"))
    .then(oneIntegration("original", "comment")).then(fileEvidence(false)).then(returnResult).then(oldIgnoreLimitations)
    .expect(not(invariant))
}
