// @source scripts/validate-evaluator-awards.ts
// @source src/lib/evaluator-awards.ts
// @source src/lib/github-work.ts
// @source src/lib/external-sources.ts
// @source src/lib/github-actor.ts
// @evidence scripts/validate-evaluator-awards.test.ts
// @evidence scripts/quality-external-evaluation.test.ts
// Two sorted candidate paths and two invocations. Input profiles represent
// loose files, retained envelope records and their validation failures. The
// production limits remain 256 files and 64 KiB per file; countOk represents
// that boundary without enumerating 257 files. SourceRevision/JSON/schema,
// canonical URLs and hashes are predicates, not cryptographic proofs.
//
// A loose file keeps its exact bytes; a retained record reconstructs pretty
// JSON plus newline and must match its saved digest. The sorted union shares
// all duplicate sets. IDs are global; source/work/content keys are repository
// scoped; GitHub review pairs additionally bind normalized actor and PR.
// An internal accepted prefix is not a returned batch. A later throw returns
// nothing and a retry resets all local sets. No action writes a Points journal,
// publishes a score or pays. Journal provenance has a separate model.
//
// Approval of committed evaluation files is an external repository-review
// assumption. Runtime checks review metadata syntax and ordering; they do not
// query GitHub for a merge, reviewer authority or current approval. Future
// timestamps are not rejected here; window selection performs that check.
// Filesystem observations are synchronous but are not an atomic snapshot
// against another process modifying files. Such external mutation is outside
// these fixed-input invocations. Scenarios are authored, not executed.
module evaluated_award_loader {
  val slots = Set(1, 2)
  type File = { origin: str, shape: bool, digest: bool, json: bool, schema: bool, path: bool,
    id: int, repository: int, source: int, work: int, actor: int, pull: int, content: int,
    kind: str, enabled: bool, occurred: int, captured: int, reviewed: int, points: int, bytes: int }
  val base: File = { origin: "loose", shape: true, digest: true, json: true, schema: true, path: true,
    id: 1, repository: 1, source: 1, work: 1, actor: 1, pull: 1, content: 1,
    kind: "pull", enabled: true, occurred: 0, captured: 1, reviewed: 2, points: 1, bytes: 1 }
  val other: File = base.with("id", 2).with("source", 2).with("work", 2).with("content", 2).with("bytes", 2)
  var s: { phase: str, invocation: int, files: int -> File, root: str, retained: bool,
    position: int, collected: Set[int], accepted: Set[int], returned: Set[int], provenance: int -> str,
    ids: Set[int], sources: Set[(int, int)], github: Set[(int, int)], reviews: Set[(int, int, int)],
    external: Set[(int, int)], content: Set[(int, int)], points: int, result: str, error: str }
  action init = s' = { phase: "idle", invocation: 0, files: Map(1 -> base, 2 -> other), root: "valid", retained: false,
    position: 1, collected: Set(), accepted: Set(), returned: Set(), provenance: slots.mapBy(_ => "none"),
    ids: Set(), sources: Set(), github: Set(), reviews: Set(), external: Set(), content: Set(), points: 0,
    result: "none", error: "none" }
  def current: File = s.files.get(if (slots.contains(s.position)) s.position else 1)
  def refuse(error: str) = s.with("phase", "done").with("result", "threw").with("error", error)
  action configure(id: int, file: File): bool = all { slots.contains(id), Set("idle", "done").contains(s.phase),
    s' = s.with("files", s.files.set(id, file)) }
  // Representative finite input classes; direct configure is also used by named traces.
  action profile(kind: int): bool = {
    val first = if (kind >= 4 and kind <= 6) base.with("kind", "external")
      else if (kind == 3) base.with("kind", "review") else base
    val second = if (kind == 1) other.with("work", 1)
      else if (kind == 3) other.with("kind", "review")
      else if (kind == 4) other.with("kind", "external").with("content", 1)
      else if (kind == 5) other.with("kind", "external").with("work", 1)
      else if (kind == 6) other.with("kind", "external").with("repository", 2).with("content", 1)
      else if (kind == 7) other.with("origin", "retained").with("digest", false)
      else if (kind == 8) other.with("schema", false)
      else if (kind == 9) other.with("json", false)
      else if (kind == 10) other.with("path", false)
      else if (kind == 11) other.with("occurred", 2).with("reviewed", 1)
      else if (kind == 12) other.with("points", 9)
      else if (kind == 13) other.with("kind", "external").with("enabled", false)
      else if (kind == 14) base.with("origin", "retained") else other
    all { Set("idle", "done").contains(s.phase), kind >= 1, kind <= 14,
      s' = s.with("files", Map(1 -> first, 2 -> second)) }
  }
  action begin(root: str, retained: bool): bool = all { Set("idle", "done").contains(s.phase), s.invocation < 2,
    Set("valid", "absent", "invalid").contains(root),
    s' = s.with("invocation", s.invocation + 1).with("root", root).with("retained", retained)
      .with("position", 1).with("phase", "root").with("collected", Set()).with("accepted", Set()).with("returned", Set())
      .with("provenance", slots.mapBy(_ => "none")).with("ids", Set()).with("sources", Set()).with("github", Set())
      .with("reviews", Set()).with("external", Set()).with("content", Set()).with("points", 0).with("result", "pending").with("error", "none") }
  action inspectRoot = all { s.phase == "root",
    s' = if (s.root == "invalid") refuse("root-shape") else s.with("phase", "loose") }
  action collectLoose = all { s.phase == "loose",
    s' = if (s.position > 2) s.with("phase", "retained-envelope").with("position", 1)
      else if (s.root == "absent" or current.origin != "loose") s.with("position", s.position + 1)
      else if (not(current.shape)) refuse("loose-file-shape-or-size")
      else s.with("collected", s.collected.union(Set(s.position)))
        .with("provenance", s.provenance.set(s.position, "exact-loose-bytes")).with("position", s.position + 1) }
  action retainedEnvelope(valid: bool): bool = all { s.phase == "retained-envelope",
    s' = if (s.retained and not(valid)) refuse("retained-envelope")
      else s.with("phase", if (s.retained) "retained-files" else "count").with("position", 1) }
  action collectRetained = all { s.phase == "retained-files",
    s' = if (s.position > 2) s.with("phase", "count").with("position", 1)
      else if (current.origin != "retained") s.with("position", s.position + 1)
      else if (not(current.shape) or not(current.digest)) refuse("retained-bytes-or-digest")
      else s.with("collected", s.collected.union(Set(s.position)))
        .with("provenance", s.provenance.set(s.position, "canonical-retained-bytes")).with("position", s.position + 1) }
  action count(ok: bool): bool = all { s.phase == "count",
    s' = if (ok) s.with("phase", "validate").with("position", 1) else refuse("file-count") }
  action validate = {
    val file = current
    val sourceKey = (file.repository, file.source)
    val workKey = (file.repository, file.work)
    val reviewKey = (file.repository, file.actor, file.pull)
    val contentKey = (file.repository, file.content)
    val external = file.kind == "external"
    val invalid = not(file.json) or not(file.schema) or not(file.path) or file.points < 1 or file.points > 8
      or file.reviewed < file.occurred or (external and (not(file.enabled) or file.captured < file.occurred or file.captured > file.reviewed))
    val duplicate = s.ids.contains(file.id) or s.sources.contains(sourceKey)
      or (not(external) and s.github.contains(workKey))
      or (file.kind == "review" and s.reviews.contains(reviewKey))
      or (external and (s.external.contains(workKey) or s.content.contains(contentKey)))
    all { s.phase == "validate",
      s' = if (s.position > 2) s.with("returned", s.accepted).with("phase", "done").with("result", "returned")
        else if (not(s.collected.contains(s.position))) s.with("position", s.position + 1)
        else if (invalid) refuse("manifest") else if (duplicate) refuse("duplicate")
        else s.with("accepted", s.accepted.union(Set(s.position))).with("ids", s.ids.union(Set(file.id)))
          .with("sources", s.sources.union(Set(sourceKey))).with("github", if (external) s.github else s.github.union(Set(workKey)))
          .with("reviews", if (file.kind == "review") s.reviews.union(Set(reviewKey)) else s.reviews)
          .with("external", if (external) s.external.union(Set(workKey)) else s.external)
          .with("content", if (external) s.content.union(Set(contentKey)) else s.content)
          .with("points", s.points + file.points).with("position", s.position + 1) }
  }
  action ioError = all { Set("root", "loose", "retained-envelope", "retained-files").contains(s.phase), s' = refuse("filesystem") }
  action step = {
    nondet kind = 1.to(14).oneOf()
    nondet root = Set("valid", "absent", "invalid").oneOf()
    nondet yes = Set(false, true).oneOf()
    any { profile(kind), begin(root, yes), inspectRoot, collectLoose, retainedEnvelope(yes), collectRetained, count(yes), validate, ioError, s' = s }
  }
  val invariant = all { s.invocation <= 2, s.position >= 1, s.position <= 3,
    s.accepted.subseteq(s.collected), s.returned.subseteq(s.accepted), s.ids.size() == s.accepted.size(),
    s.points >= s.accepted.size(), s.points <= s.accepted.size() * 8,
    s.result == "threw" implies s.returned == Set(),
    s.result == "returned" implies s.returned == s.collected,
    s.returned.forall(id => s.provenance.get(id) != "none") }
  action discover = inspectRoot.then(collectLoose).then(collectLoose).then(collectLoose)
    .then(retainedEnvelope(true))
  action collected = discover.then(count(true))
  action allLoose = begin("valid", false).then(collected)
  action complete = validate.then(validate).then(validate)
  run distinctLooseFilesReturnOneCompleteBatchTest = init.then(allLoose).then(complete)
    .expect(s.returned == slots and s.points == 2 and invariant)
  run absentRootCanReturnEmptyBatchTest = init.then(begin("absent", false)).then(collected).then(complete)
    .expect(s.result == "returned" and s.returned == Set() and invariant)
  run invalidRootRejectsBeforeRetainedInputTest = init.then(begin("invalid", true)).then(inspectRoot)
    .expect(s.result == "threw" and s.collected == Set() and invariant)
  run retainedDigestFailurePrecedesManifestAdmissionTest = init.then(profile(7)).then(begin("valid", true)).then(discover)
    .then(collectRetained).then(collectRetained).expect(s.error == "retained-bytes-or-digest" and s.accepted == Set() and invariant)
  run mixedLooseAndRetainedDuplicateSharesOneNamespaceTest = init.then(profile(14)).then(begin("valid", true)).then(discover)
    .then(collectRetained).then(collectRetained).then(collectRetained).then(count(true)).then(validate).then(validate)
    .expect(s.error == "duplicate" and s.accepted == Set(1) and s.returned == Set() and invariant)
  run secondInvalidManifestNeverReturnsFirstPrefixTest = init.then(profile(8)).then(allLoose).then(validate).then(validate)
    .expect(s.result == "threw" and s.accepted == Set(1) and s.returned == Set() and invariant)
  run correctedRetryStartsWithEmptyDuplicateSetsTest = init.then(profile(8)).then(allLoose).then(validate).then(validate)
    .then(profile(2)).then(allLoose).then(complete).expect(s.returned == slots and s.invocation == 2 and invariant)
  run legacyAndModernNodeSpellingsCannotDuplicateWorkTest = init.then(profile(1)).then(allLoose).then(validate).then(validate)
    .expect(s.error == "duplicate" and invariant)
  run reviewerPullPairRejectsDifferentReviewFragmentsTest = init.then(profile(3)).then(allLoose).then(validate).then(validate)
    .expect(s.error == "duplicate" and s.github.size() == 1 and invariant)
  run externalContentDuplicateRefusesDifferentUrlsTest = init.then(profile(4)).then(allLoose).then(validate).then(validate)
    .expect(s.error == "duplicate" and invariant)
  run externalCanonicalWorkRefusesDifferentPresentationsTest = init.then(profile(5)).then(allLoose).then(validate).then(validate)
    .expect(s.error == "duplicate" and invariant)
  run externalContentIsScopedToRepositoryTest = init.then(profile(6)).then(allLoose).then(complete)
    .expect(s.returned == slots and s.content.size() == 2 and invariant)
  run projectPathMismatchRefusesWholeBatchTest = init.then(profile(10)).then(allLoose).then(validate).then(validate)
    .expect(s.error == "manifest" and s.returned == Set() and invariant)
  run reviewCannotPrecedeContributionTest = init.then(profile(11)).then(allLoose).then(validate).then(validate)
    .expect(s.error == "manifest" and invariant)
  run outOfRangePointsCannotAccumulateTest = init.then(profile(12)).then(allLoose).then(validate).then(validate)
    .expect(s.error == "manifest" and s.points == 1 and invariant)
  run externalWorkRequiresProjectOptInTest = init.then(profile(13)).then(allLoose).then(validate).then(validate)
    .expect(s.error == "manifest" and invariant)
  run aggregateCountBoundaryStopsBeforeValidationTest = init.then(begin("valid", false)).then(discover).then(count(false))
    .expect(s.error == "file-count" and s.accepted == Set() and invariant)
  run filesystemFailureDoesNotReturnCapturedFilesTest = init.then(begin("valid", false)).then(inspectRoot).then(collectLoose).then(ioError)
    .expect(s.collected == Set(1) and s.returned == Set() and invariant)
}
