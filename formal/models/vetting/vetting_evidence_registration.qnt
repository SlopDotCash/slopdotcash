// @source backend/vetting/evidence.ts
// @source backend/vetting/evidence-chunks.ts
// @source backend/vetting/handler.ts
// @source migrations/0034_vetting_private_evidence.sql
// @source migrations/0036_vetting_evidence_assembly.sql
// @source migrations/0107_vetting_content_addressed_evidence.sql
// @source migrations/0119_vetting_storage_generations.sql
// @source backend/vetting/evidence-storage.ts
// @evidence scripts/vetting-api.test.ts
// Two requests, each with one retry; one assessment and two run IDs; two
// immutable canonical manifests over two distinct object digests. Raw forms1/2
// differ only in order and normalize to manifest1. Raw form3 is manifest2
// (changed immutable metadata/assembly declaration). SHA collisions are excluded.
// JSON/schema/ref/chunk predicates represent source validation, not a parser
// proof. The source bound is a signed1MiB request and1,024 object declarations;
// neither the source nor this model introduces an object/run byte-size cap.
// The assessment lookup precedes per-object validation. A canonical assembly
// digest only names a declared manifest object; registration does not validate
// its contents or grant scan clearance. Signing authority is captured by the
// verified request, not inferred from manifest fields or an operator session.
// Initial read, D1 commit, promise reply, catch readback, sequential stored-hint
// reads and response delivery are independent. D1 batch atomicity is assumed:
// run + every object row + exactly one register audit commit together, or none.
// A successful batch promise denotes its committed transaction; missing/false
// success metadata from an out-of-contract adapter is not modeled. Lost/thrown
// replies after commit are modeled and may replay the caller's own new row.
// Generation allocation and run/object references share the registration batch.
// Two physical generations are represented, with both digests rotating together
// in this bound. rotateGeneration abstracts independently authorized retirement;
// its policy/target fencing is modeled by the generation and retention models.
// Replay retains the original binding; a new run selects the current generation.
// Legacy cleanup claims do not block a new generation. Per-generation part
// observations are separate; no old copy is inferred into a new generation.
// Existing run/object metadata is never deleted in this bound. Retention-based
// selection, old deletion receipts, physical delete retries, uploads and whole
// finalization belong to their separate models. Stored hints are observations,
// not leases or new references. Object1 has one part; object2 has two parts.
// A stored hint can survive later corruption, or include object2 despite a
// mismatched whole-file digest: registration checks its parts only, and the
// run still needs its own whole-file finalization and current retention proof.
// Clock0..3 models capture vs execution, not a new expiry requirement. No
// tests, parser, checker, provider request or runtime was executed here.
module vetting_evidence_registration {
  val ids = Set(1, 2)
  val parts = Set(1, 2, 3)
  val physicalParts = Set(1, 2, 3, 4, 5, 6)
  val faults = Set("none", "json", "shape", "digest", "empty", "limit", "object", "duplicate", "layout", "trace", "assembly")
  type Row = { generation: int, manifest: int, objects: Set[int], audited: bool, service: int, at: int }
  type Request = { phase: str, attempt: int, scope: int, raw: int, manifest: int,
    fault: str, service: int, at: int, committed: bool, cause: str,
    status: int, replayed: bool, hintIndex: int, stored: Set[int], delivered: bool }
  val emptyRow: Row = { generation: 0, manifest: 0, objects: Set(), audited: false, service: 0, at: 0 }
  val idle: Request = { phase: "idle", attempt: 0, scope: 1, raw: 1, manifest: 0,
    fault: "none", service: 1, at: 0, committed: false, cause: "none",
    status: 0, replayed: false, hintIndex: 0, stored: Set(), delivered: false }
  var s: { now: int, assessment: bool, rows: int -> Row, requests: int -> Request,
    generation: int, bytes: int -> str, wholeMatches: bool }
  action init = s' = { now: 0, assessment: true, rows: ids.mapBy(_ => emptyRow), requests: ids.mapBy(_ => idle),
    generation: 1, bytes: physicalParts.mapBy(_ => "missing"), wholeMatches: true }
  def failedState(r: Request, status: int): Request = r.with("phase", "response").with("status", status)
  def replay(r: Request, row: Row): Request = if (r.manifest != row.manifest) failedState(r, 409)
    else r.with("phase", "hints").with("status", 200).with("replayed", true)
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1) }
  action removeUnreferencedAssessment = all { ids.forall(scope => s.rows.get(scope).manifest == 0), s' = s.with("assessment", false) }
  action rotateGeneration = all { s.generation == 1, s' = s.with("generation", 2) }
  action changePart(part: int, state: str): bool = all { physicalParts.contains(part), Set("valid", "missing", "corrupt").contains(state),
    s' = s.with("bytes", s.bytes.set(part, state)) }
  action wrongWhole = s' = s.with("wholeMatches", false)
  action begin(id: int, scope: int, raw: int, fault: str, service: int): bool = {
    val previous = s.requests.get(id)
    all { ids.contains(id), ids.contains(scope), Set(1, 2, 3).contains(raw), faults.contains(fault), ids.contains(service),
      Set("idle", "done").contains(previous.phase), previous.attempt < 2,
      s' = s.with("requests", s.requests.set(id, idle.with("phase", "configuration").with("attempt", previous.attempt + 1)
        .with("scope", scope).with("raw", raw).with("fault", fault).with("service", service))) }
  }
  action configuration(id: int, ready: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "configuration", s' = s.with("requests", s.requests.set(id,
      if (ready) r.with("phase", "signature") else failedState(r, 503))) }
  }
  action signature(id: int, outcome: str): bool = {
    val r = s.requests.get(id)
    all { r.phase == "signature", Set("valid", "invalid", "unconfigured", "oversize", "throw").contains(outcome),
      s' = s.with("requests", s.requests.set(id, if (outcome == "valid") r.with("phase", "json")
        else failedState(r, if (outcome == "invalid") 401 else if (outcome == "unconfigured") 503 else if (outcome == "oversize") 413 else 500))) }
  }
  action json(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "json", s' = s.with("requests", s.requests.set(id,
      if (Set("json", "shape", "digest", "empty", "limit").contains(r.fault)) failedState(r, 400) else r.with("phase", "assessment"))) }
  }
  action assessment(id: int, readable: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "assessment", s' = s.with("requests", s.requests.set(id,
      if (not(readable)) failedState(r, 500) else if (not(s.assessment)) failedState(r, 404) else r.with("phase", "objects"))) }
  }
  action objects(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "objects", s' = s.with("requests", s.requests.set(id,
      if (r.fault != "none") failedState(r, 400) else r.with("phase", "canonical"))) }
  }
  action canonical(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "canonical", s' = s.with("requests", s.requests.set(id,
      r.with("manifest", if (r.raw == 3) 2 else 1).with("phase", "initial-read"))) }
  }
  action initialRead(id: int, readable: bool): bool = {
    val r = s.requests.get(id)
    val row = s.rows.get(r.scope)
    all { r.phase == "initial-read", s' = s.with("requests", s.requests.set(id,
      if (not(readable)) failedState(r, 500) else if (row.manifest != 0) replay(r, row)
      else r.with("phase", "batch").with("at", s.now))) }
  }
  action batch(id: int, operational: bool): bool = {
    val r = s.requests.get(id)
    val isPresent = s.rows.get(r.scope).manifest != 0
    val commits = operational and not(isPresent) and s.assessment
    val cause = if (isPresent) "unique" else if (not(operational) or not(s.assessment)) "other" else "none"
    all { r.phase == "batch",
      s' = s.with("rows", if (commits) s.rows.set(r.scope,
        { generation: s.generation, manifest: r.manifest, objects: Set(1, 2), audited: true, service: r.service, at: r.at }) else s.rows)
        .with("requests", s.requests.set(id, r.with("phase", "batch-reply").with("committed", commits).with("cause", cause))) }
  }
  action batchReply(id: int, successful: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "batch-reply", s' = s.with("requests", s.requests.set(id,
      if (r.committed and successful) r.with("phase", "hints").with("status", 201)
      else r.with("phase", "catch-read"))) }
  }
  action catchRead(id: int, readable: bool): bool = {
    val r = s.requests.get(id)
    val row = s.rows.get(r.scope)
    all { r.phase == "catch-read", s' = s.with("requests", s.requests.set(id,
      if (not(readable)) failedState(r, 500) else if (row.manifest != 0) replay(r, row)
      else failedState(r, 500))) }
  }
  action hint(id: int, ioWorks: bool): bool = {
    val r = s.requests.get(id)
    val generation = s.rows.get(r.scope).generation
    val valid = ioWorks and (if (r.hintIndex < 3 and generation > 0)
      s.bytes.get(r.hintIndex + 1 + 3 * (generation - 1)) == "valid" else false)
    val nextValue = if (r.hintIndex == 1 and not(valid)) 3 else r.hintIndex + 1
    val stored = if (valid and r.hintIndex == 0) r.stored.union(Set(1))
      else if (valid and r.hintIndex == 2) r.stored.union(Set(2)) else r.stored
    all { r.phase == "hints", r.hintIndex < 3,
      s' = s.with("requests", s.requests.set(id, r.with("hintIndex", nextValue).with("stored", stored)
        .with("phase", if (nextValue == 3) "response" else "hints"))) }
  }
  action response(id: int, delivered: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "response", s' = s.with("requests", s.requests.set(id, r.with("phase", "done").with("delivered", delivered))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet scope = ids.oneOf()
    nondet raw = Set(1, 2, 3).oneOf()
    nondet fault = faults.oneOf()
    nondet service = ids.oneOf()
    nondet outcome = Set("valid", "invalid", "unconfigured", "oversize", "throw").oneOf()
    nondet part = physicalParts.oneOf()
    nondet state = Set("valid", "missing", "corrupt").oneOf()
    nondet yes = Set(false, true).oneOf()
    any { tick, removeUnreferencedAssessment, rotateGeneration, changePart(part, state), wrongWhole,
      begin(id, scope, raw, fault, service), configuration(id, yes), signature(id, outcome), json(id), assessment(id, yes), objects(id), canonical(id),
      initialRead(id, yes), batch(id, yes), batchReply(id, yes), catchRead(id, yes), hint(id, yes), response(id, yes), s' = s }
  }
  val invariant = all {
    ids.forall(scope => {
      val row = s.rows.get(scope)
      all { (row.manifest != 0) == row.audited,
        row.manifest != 0 implies row.objects == Set(1, 2) and s.assessment and Set(1, 2).contains(row.generation),
        row.manifest == 0 implies row.objects.size() == 0 }
    }),
    ids.forall(id => {
      val r = s.requests.get(id)
      all { r.attempt <= 2, r.stored.subseteq(Set(1, 2)),
        Set(200, 201).contains(r.status) implies s.rows.get(r.scope).manifest == r.manifest,
        r.status == 201 implies r.committed,
        r.replayed implies r.status == 200 and not(r.phase == "batch") }
    }) }
  action validated(id: int, scope: int, raw: int): bool = begin(id, scope, raw, "none", id)
    .then(configuration(id, true)).then(signature(id, "valid")).then(json(id)).then(assessment(id, true)).then(objects(id)).then(canonical(id))
  action emptyRead(id: int, scope: int, raw: int): bool = validated(id, scope, raw).then(initialRead(id, true))
  action create(id: int, scope: int, raw: int): bool = emptyRead(id, scope, raw).then(batch(id, true)).then(batchReply(id, true))
  action finish(id: int): bool = hint(id, true).then(hint(id, true)).then(hint(id, true)).then(response(id, true))
  action allParts = changePart(1, "valid").then(changePart(2, "valid")).then(changePart(3, "valid"))

  run configuredSignedRegistrationCommitsOneCompleteBatchTest = init.then(create(1, 1, 1))
    .expect(s.rows.get(1).objects == Set(1, 2) and s.rows.get(1).audited and s.requests.get(1).status == 201 and invariant)
  run absentStorageRefusesBeforeSignatureTest = init.then(begin(1, 1, 1, "none", 1)).then(configuration(1, false))
    .expect(s.requests.get(1).status == 503 and s.rows.get(1).manifest == 0)
  run invalidSignatureNeverReadsAssessmentTest = init.then(begin(1, 1, 1, "none", 1)).then(configuration(1, true)).then(signature(1, "invalid"))
    .expect(s.requests.get(1).status == 401 and s.rows.get(1).manifest == 0)
  run signedBodyBoundRefusesOversizeTest = init.then(begin(1, 1, 1, "none", 1)).then(configuration(1, true)).then(signature(1, "oversize"))
    .expect(s.requests.get(1).status == 413 and invariant)
  run invalidJsonPrecedesMissingAssessmentTest = init.then(removeUnreferencedAssessment).then(begin(1, 1, 1, "json", 1))
    .then(configuration(1, true)).then(signature(1, "valid")).then(json(1)).expect(s.requests.get(1).status == 400)
  run missingAssessmentPrecedesInvalidObjectTest = init.then(removeUnreferencedAssessment).then(begin(1, 1, 1, "object", 1))
    .then(configuration(1, true)).then(signature(1, "valid")).then(json(1)).then(assessment(1, true)).expect(s.requests.get(1).status == 404)
  run duplicateDigestsCannotRegisterTest = init.then(begin(1, 1, 1, "duplicate", 1)).then(configuration(1, true)).then(signature(1, "valid"))
    .then(json(1)).then(assessment(1, true)).then(objects(1)).expect(s.requests.get(1).status == 400 and invariant)
  run invalidChunkLayoutCannotRegisterTest = init.then(begin(1, 1, 1, "layout", 1)).then(configuration(1, true)).then(signature(1, "valid"))
    .then(json(1)).then(assessment(1, true)).then(objects(1)).expect(s.requests.get(1).status == 400)
  run missingDeclaredTraceCannotRegisterTest = init.then(begin(1, 1, 1, "trace", 1)).then(configuration(1, true)).then(signature(1, "valid"))
    .then(json(1)).then(assessment(1, true)).then(objects(1)).expect(s.requests.get(1).status == 400)
  run assemblyDigestMustNameDeclaredManifestObjectTest = init.then(begin(1, 1, 3, "assembly", 1)).then(configuration(1, true)).then(signature(1, "valid"))
    .then(json(1)).then(assessment(1, true)).then(objects(1)).expect(s.requests.get(1).status == 400)
  run reorderedInputReplaysCanonicalManifestTest = init.then(create(1, 1, 1)).then(validated(2, 1, 2)).then(initialRead(2, true))
    .expect(s.requests.get(2).replayed and s.rows.get(1).service == 1 and invariant)
  run changedImmutableDeclarationConflictsTest = init.then(create(1, 1, 1)).then(validated(2, 1, 3)).then(initialRead(2, true))
    .expect(s.requests.get(2).status == 409 and s.rows.get(1).manifest == 1 and invariant)
  run sameManifestConcurrentLoserReplaysWinnerTest = init.then(emptyRead(1, 1, 1)).then(emptyRead(2, 1, 2)).then(batch(1, true)).then(batchReply(1, true))
    .then(batch(2, true)).then(batchReply(2, false)).then(catchRead(2, true)).expect(s.requests.get(2).replayed and s.rows.get(1).service == 1 and invariant)
  run changedManifestConcurrentLoserConflictsTest = init.then(emptyRead(1, 1, 1)).then(emptyRead(2, 1, 3)).then(batch(1, true)).then(batchReply(1, true))
    .then(batch(2, true)).then(batchReply(2, false)).then(catchRead(2, true)).expect(s.requests.get(2).status == 409 and invariant)
  run lostBatchReplyCanReadBackOwnCommittedRegistrationTest = init.then(emptyRead(1, 1, 1)).then(batch(1, true)).then(batchReply(1, false)).then(catchRead(1, true))
    .expect(s.requests.get(1).committed and s.requests.get(1).replayed and invariant)
  run failedCatchReadKeepsCommittedHistoryTest = init.then(emptyRead(1, 1, 1)).then(batch(1, true)).then(batchReply(1, false)).then(catchRead(1, false))
    .expect(s.requests.get(1).status == 500 and s.rows.get(1).audited and invariant)
  run generationReservationFailureRollsBackRunObjectsAndAuditTest = init.then(emptyRead(1, 1, 1)).then(batch(1, false)).then(batchReply(1, false)).then(catchRead(1, true))
    .expect(s.requests.get(1).status == 500 and s.rows.get(1) == emptyRow and invariant)
  run newRunSelectsNewGenerationTest = init.then(create(1, 1, 1)).then(rotateGeneration).then(create(2, 2, 1))
    .expect(s.rows.get(1).generation == 1 and s.rows.get(2).generation == 2 and invariant)
  run lostBatchReplyKeepsOriginalGenerationTest = init.then(emptyRead(1, 1, 1)).then(batch(1, true)).then(rotateGeneration)
    .then(batchReply(1, false)).then(catchRead(1, true)).expect(s.requests.get(1).replayed and s.rows.get(1).generation == 1 and invariant)
  run foreignKeyRefusesDeletedAssessmentAfterLookupTest = init.then(emptyRead(1, 1, 1)).then(removeUnreferencedAssessment).then(batch(1, true))
    .then(batchReply(1, false)).then(catchRead(1, true)).expect(s.requests.get(1).status == 500 and s.rows.get(1) == emptyRow)
  run genericFailureWithNoWinnerKeepsNoPartialRegistrationTest = init.then(emptyRead(1, 1, 1)).then(batch(1, false)).then(batchReply(1, false)).then(catchRead(1, true))
    .expect(s.requests.get(1).status == 500 and s.rows.get(1) == emptyRow and invariant)
  run independentRunsKeepSeparateObjectReferencesTest = init.then(create(1, 1, 1)).then(create(2, 2, 1))
    .expect(s.rows.get(1).audited and s.rows.get(2).audited and invariant)
  run existingRunReplayCannotRebindGenerationTest = init.then(create(1, 1, 1)).then(rotateGeneration)
    .then(validated(2, 1, 2)).then(initialRead(2, true))
    .expect(s.requests.get(2).replayed and s.rows.get(1).generation == 1 and invariant)
  run registrationSucceedsWithNoStoredBytesTest = init.then(create(1, 1, 1)).then(hint(1, true)).then(hint(1, true)).then(response(1, true))
    .expect(s.requests.get(1).status == 201 and s.requests.get(1).stored.size() == 0 and invariant)
  run storedHintCanBeStaleBeforeResponseTest = init.then(allParts).then(create(1, 1, 1)).then(hint(1, true)).then(changePart(1, "missing"))
    .then(hint(1, true)).then(hint(1, true)).then(response(1, true)).expect(s.requests.get(1).stored == Set(1, 2) and s.bytes.get(1) == "missing")
  run partHintsDoNotProveWholeFileCompletionTest = init.then(allParts).then(wrongWhole).then(create(1, 1, 1)).then(finish(1))
    .expect(s.requests.get(1).stored == Set(1, 2) and not(s.wholeMatches) and invariant)
  run failedHintReadOmitsObjectWithoutUndoingCommitTest = init.then(allParts).then(create(1, 1, 1)).then(hint(1, false)).then(hint(1, true)).then(hint(1, false))
    .then(response(1, true)).expect(s.requests.get(1).stored.size() == 0 and s.rows.get(1).audited and invariant)
  run capturedRegistrationTimeSurvivesDelayedBatchTest = init.then(emptyRead(1, 1, 1)).then(tick).then(tick).then(batch(1, true)).then(batchReply(1, true))
    .expect(s.rows.get(1).at == 0 and s.now == 2 and invariant)
  run lostResponseRetriesAsReplayWithoutAnotherAuditTest = init.then(create(1, 1, 1)).then(hint(1, true)).then(hint(1, true)).then(response(1, false))
    .then(validated(1, 1, 2)).then(initialRead(1, true)).expect(s.requests.get(1).attempt == 2 and s.requests.get(1).replayed and s.rows.get(1).service == 1 and invariant)
}
