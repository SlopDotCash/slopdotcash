// @source backend/slopbot/value-import.ts
// @source workers/slopbot/value-import-service.ts
// @source workers/slopbot/value-import.ts
// @source workers/slopbot/value-settings.ts
// @source workers/slopbot/value-publication.ts
// @source workers/slopbot/value-work-unit-publication.ts
// @source workers/slopbot/value-publication-fence.ts
// @source workers/slopbot/value-journal.ts
// @source workers/slopbot/value-work-unit-journal.ts
// @source migrations/0038_slopbot_value_journal.sql
// @source migrations/0042_slopbot_value_no_replace.sql
// @source migrations/0046_slopbot_work_unit_journal.sql
// @evidence workers/slopbot/value-settings.test.ts
// @evidence workers/slopbot/value-publication-fence.test.ts
// Two HTTP requests, each with at most one repeated envelope; two source
// identities/revisions, two assessment keys per journal and payload classes.
// One overlapping source family represents competing single/joint revisions.
// A joint row has both sources and claims. Its source, claim and predecessor
// indexes commit with the row in one INSERT/trigger transaction, never partly.
// Validation predicates include strict field sets, deployed producer SHA,
// subscription provenance, canonical identities, complete evidence, policy,
// digest and verdict checks. A false predicate is not a synthetic policy cap.
// Each selected source must be closed with its merge/close date before the
// configured cutoff. A bundle is joint-only and binds one repository, the
// complete ordered reconstruction result and each exact merge-recipe digest.
// Initial and publication source reads are separate. A later source change
// can invalidate a still-pending refresh; the model does not claim continuous
// GitHub freshness after an individual source's final read. Registry revision,
// selection and installation state are also checked at the atomic INSERT.
// Existing assessment keys return the first row, including an in-flight replay
// after an authority change. An entirely new request still passes intake and
// publisher authority checks before it can reach that replay. Changed payloads
// do not replace the first same-key winner. Joint authority prevents later
// single-source forks. The parent represents the complete required predecessor
// set for this bounded family; detailed multi-parent rules have separate models.
// An INSERT or subsequent readback/RPC response can fail after commit. HTTP409
// and a lost HTTP response are not proof that no journal row was written.
// Listed test files cover selected settings/fence branches only. No direct
// HTTP-to-RPC historical import conformance test was found. These scenarios
// have not been parsed, simulated, model-checked or executed.
module historical_subscription_intake {
  val slots = Set(1, 2)
  val sources = Set(1, 2)
  val rows = Set(1, 2, 3, 4)
  type Record = { exists: bool, mode: str, parent: int, payload: int, members: Set[int] }
  val absent: Record = { exists: false, mode: "single", parent: 0, payload: 0, members: Set() }
  type Request = { phase: str, attempt: int, mode: str, key: int, parent: int,
    payload: int, bundle: bool, members: Set[int], collected: Set[int], refreshed: Set[int],
    sourceRevisions: int -> int, registryRevision: int, status: int,
    returnedRow: int, returnedPayload: int, noStore: bool, received: bool }
  val idle: Request = { phase: "unused", attempt: 0, mode: "single", key: 1, parent: 0,
    payload: 1, bundle: false, members: Set(), collected: Set(), refreshed: Set(),
    sourceRevisions: sources.mapBy(_ => 0), registryRevision: 0, status: 0,
    returnedRow: 0, returnedPayload: 0, noStore: false, received: false }
  var s: { requests: int -> Request, sourceRevisions: int -> int, registryRevision: int,
    active: bool, installed: bool, selected: Set[int], tip: int,
    records: int -> Record, sourceIndex: int -> Set[int], claimIndex: int -> Set[int],
    parentIndex: int -> Set[int] }
  action init = s' = { requests: slots.mapBy(_ => idle), sourceRevisions: sources.mapBy(_ => 1),
    registryRevision: 1, active: true, installed: true, selected: sources, tip: 0,
    records: rows.mapBy(_ => absent), sourceIndex: rows.mapBy(_ => Set()),
    claimIndex: rows.mapBy(_ => Set()), parentIndex: rows.mapBy(_ => Set()) }
  def rowOf(request: Request): int = if (request.mode == "single") request.key else request.key + 2
  def rowAt(row: int): Record = if (rows.contains(row)) s.records.get(row) else absent
  def respond(request: Request, status: int): Request = request.with("phase", "response")
    .with("status", status).with("noStore", true)
  action sourceChanges(source: int): bool = all { sources.contains(source), s.sourceRevisions.get(source) == 1,
    s' = s.with("sourceRevisions", s.sourceRevisions.set(source, 2)) }
  action registryChanges = all { s.registryRevision == 1, s' = s.with("registryRevision", 2) }
  action pause = all { s.active, s' = s.with("active", false).with("registryRevision", 2) }
  action removeSource(source: int): bool = all { sources.contains(source), s.selected.contains(source),
    s' = s.with("selected", s.selected.exclude(Set(source))) }
  action revokeInstallation = all { s.installed, s' = s.with("installed", false) }
  action begin(id: int, mode: str, key: int, parent: int, payload: int, bundle: bool): bool = {
    val prior = s.requests.get(id)
    all { slots.contains(id), Set("single", "joint").contains(mode), Set(1, 2).contains(key),
      0.to(4).contains(parent), Set(1, 2).contains(payload), Set("unused", "done").contains(prior.phase), prior.attempt < 2,
      prior.attempt > 0 implies mode == prior.mode and key == prior.key and parent == prior.parent
        and payload == prior.payload and bundle == prior.bundle,
      s' = s.with("requests", s.requests.set(id, idle.with("phase", "headers").with("attempt", prior.attempt + 1)
        .with("mode", mode).with("key", key).with("parent", parent).with("payload", payload).with("bundle", bundle)
        .with("members", if (mode == "single") Set(1) else sources))) }
  }
  action headers(id: int, post: bool, origin: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "headers", s' = s.with("requests", s.requests.set(id,
      if (not(post)) respond(r, 405) else if (not(origin)) respond(r, 403) else r.with("phase", "session"))) }
  }
  action session(id: int, result: str, publisher: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "session", Set("admin", "missing", "forbidden", "error").contains(result),
      s' = s.with("requests", s.requests.set(id,
        if (result == "error") respond(r, 503) else if (result == "missing") respond(r, 401)
        else if (result == "forbidden") respond(r, 403) else if (not(publisher)) respond(r, 503)
        else r.with("phase", "body"))) }
  }
  action body(id: int, valid: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "body", s' = s.with("requests", s.requests.set(id,
      if (valid) r.with("phase", "worker") else respond(r, 400))) }
  }
  action envelope(id: int, valid: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "worker", s' = s.with("requests", s.requests.set(id,
      if (valid and not(r.mode == "single" and r.bundle)) r.with("phase", "installation") else respond(r, 409))) }
  }
  action installation(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "installation", s' = s.with("requests", s.requests.set(id,
      if (s.installed and available) r.with("phase", "collect") else respond(r, 409))) }
  }
  action collect(id: int, source: int, valid: bool, historical: bool): bool = {
    val r = s.requests.get(id)
    val collected = r.collected.union(Set(source))
    all { r.phase == "collect", r.members.contains(source), not(r.collected.contains(source)),
      s' = s.with("requests", s.requests.set(id,
        if (not(valid and historical and s.active and s.selected.contains(source))) respond(r, 409)
        else r.with("collected", collected).with("sourceRevisions", r.sourceRevisions.set(source, s.sourceRevisions.get(source)))
          .with("phase", if (collected != r.members) "collect" else if (r.bundle) "reconstruct" else "capture"))) }
  }
  action reconstruct(id: int, valid: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "reconstruct", r.mode == "joint", r.bundle,
      s' = s.with("requests", s.requests.set(id, if (valid) r.with("phase", "capture") else respond(r, 409))) }
  }
  action capture(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "capture", s' = s.with("requests", s.requests.set(id,
      if (s.active and s.installed and r.members.subseteq(s.selected))
        r.with("registryRevision", s.registryRevision).with("phase", "refresh") else respond(r, 409))) }
  }
  action refresh(id: int, source: int, valid: bool): bool = {
    val r = s.requests.get(id)
    val refreshed = r.refreshed.union(Set(source))
    all { r.phase == "refresh", r.members.contains(source), not(r.refreshed.contains(source)),
      s' = s.with("requests", s.requests.set(id,
        if (not(valid) or r.sourceRevisions.get(source) != s.sourceRevisions.get(source)) respond(r, 409)
        else r.with("refreshed", refreshed).with("phase", if (refreshed == r.members) "prepare" else "refresh"))) }
  }
  action prepare(id: int, valid: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "prepare", s' = s.with("requests", s.requests.set(id,
      if (valid) r.with("phase", "preflight") else respond(r, 409))) }
  }
  action preflight(id: int): bool = {
    val r = s.requests.get(id)
    val replay = rowAt(rowOf(r)).exists
    val allowed = replay or (r.parent == s.tip and not(r.mode == "single" and rowAt(s.tip).mode == "joint"))
    all { r.phase == "preflight", s' = s.with("requests", s.requests.set(id,
      if (allowed) r.with("phase", "append") else respond(r, 409))) }
  }
  action appendRecord(id: int, lostReply: bool): bool = {
    val r = s.requests.get(id)
    val row = rowOf(r)
    val replay = rowAt(row).exists
    val valid = s.active and s.installed and r.members.subseteq(s.selected) and r.registryRevision == s.registryRevision
      and r.parent == s.tip and not(r.mode == "single" and rowAt(s.tip).mode == "joint")
    val nextValue = if (lostReply) respond(r, 409) else r.with("phase", "readback")
    val record: Record = { exists: true, mode: r.mode, parent: r.parent, payload: r.payload, members: r.members }
    all { r.phase == "append",
      s' = if (replay) s.with("requests", s.requests.set(id, nextValue))
        else if (not(valid)) s.with("requests", s.requests.set(id, respond(r, 409)))
        else s.with("records", s.records.set(row, record)).with("tip", row)
          .with("sourceIndex", s.sourceIndex.set(row, if (r.mode == "joint") r.members else Set()))
          .with("claimIndex", s.claimIndex.set(row, if (r.mode == "joint") r.members else Set()))
          .with("parentIndex", s.parentIndex.set(row, if (r.mode == "joint" and rowAt(r.parent).mode == "joint") Set(r.parent) else Set()))
          .with("requests", s.requests.set(id, nextValue)) }
  }
  action readback(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    val row = rowOf(r)
    val stored = rowAt(row)
    all { r.phase == "readback", s' = s.with("requests", s.requests.set(id,
      if (available and stored.exists) respond(r, 200).with("returnedRow", row).with("returnedPayload", stored.payload)
      else respond(r, 409))) }
  }
  action failure(id: int): bool = {
    val r = s.requests.get(id)
    all { Set("worker", "installation", "collect", "reconstruct", "capture", "refresh", "prepare", "preflight", "append").contains(r.phase),
      s' = s.with("requests", s.requests.set(id, respond(r, 409))) }
  }
  action send(id: int, received: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "response", s' = s.with("requests", s.requests.set(id, r.with("phase", "done").with("received", received))) }
  }
  action step = {
    nondet id = slots.oneOf()
    nondet source = sources.oneOf()
    nondet mode = Set("single", "joint").oneOf()
    nondet key = Set(1, 2).oneOf()
    nondet parent = 0.to(4).oneOf()
    nondet payload = Set(1, 2).oneOf()
    nondet result = Set("admin", "missing", "forbidden", "error").oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    any { sourceChanges(source), registryChanges, pause, removeSource(source), revokeInstallation,
      begin(id, mode, key, parent, payload, yes), headers(id, yes, other), session(id, result, yes), body(id, yes), envelope(id, yes), installation(id, yes),
      collect(id, source, yes, other), reconstruct(id, yes), capture(id), refresh(id, source, yes), prepare(id, yes),
      preflight(id), appendRecord(id, yes), readback(id, yes), failure(id), send(id, yes), s' = s }
  }
  val invariant = all {
    0.to(4).contains(s.tip), s.tip > 0 implies rowAt(s.tip).exists,
    rows.forall(row => {
      val record = rowAt(row)
      all { s.sourceIndex.get(row) == (if (record.exists and record.mode == "joint") record.members else Set()),
        s.claimIndex.get(row) == s.sourceIndex.get(row),
        s.parentIndex.get(row) == (if (record.exists and record.mode == "joint" and rowAt(record.parent).mode == "joint") Set(record.parent) else Set()),
        record.exists and record.parent > 0 implies rowAt(record.parent).exists }
    }),
    slots.forall(id => {
      val r = s.requests.get(id)
      all { r.status > 0 implies r.noStore,
        r.status == 200 implies rowAt(r.returnedRow).exists and r.returnedPayload == rowAt(r.returnedRow).payload,
        r.refreshed.subseteq(r.collected), r.collected.subseteq(r.members) }
    }) }
  action admitted(id: int, mode: str, key: int, parent: int, payload: int, bundle: bool): bool = begin(id, mode, key, parent, payload, bundle)
    .then(headers(id, true, true)).then(session(id, "admin", true)).then(body(id, true)).then(envelope(id, true)).then(installation(id, true))
  action singleCollected(id: int): bool = collect(id, 1, true, true).then(capture(id)).then(refresh(id, 1, true)).then(prepare(id, true)).then(preflight(id))
  action jointCollected(id: int): bool = collect(id, 1, true, true).then(collect(id, 2, true, true))
  action jointPrepared(id: int): bool = capture(id).then(refresh(id, 1, true)).then(refresh(id, 2, true)).then(prepare(id, true)).then(preflight(id))
  action receipt(id: int): bool = appendRecord(id, false).then(readback(id, true)).then(send(id, true))
  run validSingleImportTest = init.then(admitted(1, "single", 1, 0, 1, false)).then(singleCollected(1)).then(receipt(1))
    .expect(s.requests.get(1).status == 200 and s.tip == 1 and invariant)
  run methodRefusedBeforeSessionTest = init.then(begin(1, "single", 1, 0, 1, false)).then(headers(1, false, true))
    .expect(s.requests.get(1).status == 405 and s.tip == 0 and invariant)
  run foreignOriginRefusedTest = init.then(begin(1, "single", 1, 0, 1, false)).then(headers(1, true, false))
    .expect(s.requests.get(1).status == 403 and invariant)
  run missingSessionRefusedTest = init.then(begin(1, "single", 1, 0, 1, false)).then(headers(1, true, true)).then(session(1, "missing", true))
    .expect(s.requests.get(1).status == 401 and invariant)
  run nonAdminRefusedTest = init.then(begin(1, "single", 1, 0, 1, false)).then(headers(1, true, true)).then(session(1, "forbidden", true))
    .expect(s.requests.get(1).status == 403 and invariant)
  run absentPublisherUnavailableTest = init.then(begin(1, "single", 1, 0, 1, false)).then(headers(1, true, true)).then(session(1, "admin", false))
    .expect(s.requests.get(1).status == 503 and invariant)
  run malformedBodyRefusedTest = init.then(begin(1, "single", 1, 0, 1, false)).then(headers(1, true, true)).then(session(1, "admin", true)).then(body(1, false))
    .expect(s.requests.get(1).status == 400 and invariant)
  run invalidProducerEnvelopeRefusedTest = init.then(begin(1, "single", 1, 0, 1, false)).then(headers(1, true, true)).then(session(1, "admin", true))
    .then(body(1, true)).then(envelope(1, false)).expect(s.requests.get(1).status == 409 and s.tip == 0 and invariant)
  run singleBundleRefusedTest = init.then(begin(1, "single", 1, 0, 1, true)).then(headers(1, true, true))
    .then(session(1, "admin", true)).then(body(1, true)).then(envelope(1, true)).expect(s.requests.get(1).status == 409 and invariant)
  run apiEraSourceRefusedTest = init.then(admitted(1, "single", 1, 0, 1, false)).then(collect(1, 1, true, false))
    .expect(s.requests.get(1).status == 409 and s.tip == 0 and invariant)
  run oneInvalidJointSourceWritesNothingTest = init.then(admitted(1, "joint", 1, 0, 1, false)).then(collect(1, 1, true, true)).then(collect(1, 2, false, true))
    .expect(s.tip == 0 and rows.forall(row => not(rowAt(row).exists)) and invariant)
  run invalidBundleRecipeWritesNothingTest = init.then(admitted(1, "joint", 1, 0, 1, true)).then(jointCollected(1)).then(reconstruct(1, false))
    .expect(s.tip == 0 and invariant)
  run validJointBundlePublishesAllIndexesTest = init.then(admitted(1, "joint", 1, 0, 1, true)).then(jointCollected(1)).then(reconstruct(1, true))
    .then(jointPrepared(1)).then(receipt(1)).expect(s.sourceIndex.get(3) == sources and s.claimIndex.get(3) == sources and invariant)
  run sourceChangeBeforeRefreshRefusesTest = init.then(admitted(1, "single", 1, 0, 1, false)).then(collect(1, 1, true, true))
    .then(sourceChanges(1)).then(capture(1)).then(refresh(1, 1, true)).expect(s.requests.get(1).status == 409 and s.tip == 0 and invariant)
  run changedResultDigestRefusesTest = init.then(admitted(1, "single", 1, 0, 1, false)).then(collect(1, 1, true, true)).then(capture(1))
    .then(refresh(1, 1, true)).then(prepare(1, false)).expect(s.tip == 0 and s.requests.get(1).status == 409 and invariant)
  run lateRegistryChangeRefusesInsertTest = init.then(admitted(1, "single", 1, 0, 1, false)).then(singleCollected(1)).then(registryChanges).then(appendRecord(1, false))
    .expect(s.tip == 0 and s.requests.get(1).status == 409 and invariant)
  run lateInstallationRemovalRefusesInsertTest = init.then(admitted(1, "single", 1, 0, 1, false)).then(singleCollected(1)).then(revokeInstallation).then(appendRecord(1, false))
    .expect(s.tip == 0 and invariant)
  run lateSourceDeselectionRefusesInsertTest = init.then(admitted(1, "joint", 1, 0, 1, false)).then(jointCollected(1)).then(jointPrepared(1))
    .then(removeSource(2)).then(appendRecord(1, false)).expect(s.tip == 0 and invariant)
  run differentKeysCannotForkOnePredecessorTest = init.then(admitted(1, "single", 1, 0, 1, false)).then(singleCollected(1))
    .then(admitted(2, "single", 2, 0, 2, false)).then(singleCollected(2)).then(receipt(1)).then(appendRecord(2, false))
    .expect(s.tip == 1 and not(rowAt(2).exists) and s.requests.get(2).status == 409 and invariant)
  run sameKeyReturnsFirstPayloadTest = init.then(admitted(1, "single", 1, 0, 1, false)).then(singleCollected(1))
    .then(admitted(2, "single", 1, 0, 2, false)).then(singleCollected(2)).then(receipt(1)).then(receipt(2))
    .expect(s.requests.get(2).returnedPayload == 1 and s.tip == 1 and invariant)
  run lostInsertReplyDoesNotUndoJournalTest = init.then(admitted(1, "single", 1, 0, 1, false)).then(singleCollected(1)).then(appendRecord(1, true))
    .expect(rowAt(1).exists and s.requests.get(1).status == 409 and invariant)
  run lostReadbackDoesNotUndoJournalTest = init.then(admitted(1, "joint", 1, 0, 1, false)).then(jointCollected(1)).then(jointPrepared(1))
    .then(appendRecord(1, false)).then(readback(1, false)).expect(s.requests.get(1).status == 409 and s.sourceIndex.get(3) == sources and invariant)
  run retryAfterLostReplyUsesStoredRowTest = init.then(admitted(1, "single", 1, 0, 1, false)).then(singleCollected(1)).then(appendRecord(1, true)).then(send(1, true))
    .then(admitted(1, "single", 1, 0, 1, false)).then(singleCollected(1)).then(receipt(1)).expect(s.tip == 1 and s.requests.get(1).status == 200 and invariant)
  run concurrentReplayAfterPauseReturnsExistingRowTest = init.then(admitted(1, "single", 1, 0, 1, false)).then(singleCollected(1))
    .then(admitted(2, "single", 1, 0, 2, false)).then(singleCollected(2)).then(receipt(1)).then(pause).then(receipt(2))
    .expect(s.tip == 1 and s.requests.get(2).returnedPayload == 1 and invariant)
  run jointMigrationPreventsSingleForkTest = init.then(admitted(1, "joint", 1, 0, 1, false)).then(jointCollected(1)).then(jointPrepared(1)).then(receipt(1))
    .then(admitted(2, "single", 2, 3, 2, false)).then(singleCollected(2)).expect(s.requests.get(2).status == 409 and s.tip == 3 and invariant)
  run lostHttpResponseKeepsSuccessfulJournalTest = init.then(admitted(1, "single", 1, 0, 1, false)).then(singleCollected(1)).then(appendRecord(1, false))
    .then(readback(1, true)).then(send(1, false)).expect(rowAt(1).exists and not(s.requests.get(1).received) and invariant)
  run sourceChangeAfterFinalReadIsNotContinuousFenceTest = init.then(admitted(1, "single", 1, 0, 1, false)).then(singleCollected(1))
    .then(sourceChanges(1)).then(receipt(1)).expect(s.requests.get(1).status == 200 and invariant)
  run jointSuccessorIndexesItsJointParentTest = init.then(admitted(1, "joint", 1, 0, 1, false)).then(jointCollected(1)).then(jointPrepared(1)).then(receipt(1))
    .then(admitted(2, "joint", 2, 3, 2, false)).then(jointCollected(2)).then(jointPrepared(2)).then(receipt(2))
    .expect(s.parentIndex.get(4) == Set(3) and s.tip == 4 and invariant)
}
