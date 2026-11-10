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
  type State = { requests: int -> Request, sourceRevisions: int -> int, registryRevision: int,
    active: bool, installed: bool, selected: Set[int], tip: int,
    records: int -> Record, sourceIndex: int -> Set[int], claimIndex: int -> Set[int],
    parentIndex: int -> Set[int] }
  var s: State
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
  def preflightResult(r: Request): Request = {
    val replay = rowAt(rowOf(r)).exists
    val allowed = replay or (r.parent == s.tip and not(r.mode == "single" and rowAt(s.tip).mode == "joint"))
    if (allowed) r.with("phase", "append") else respond(r, 409)
  }
  action preflight(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "preflight", s' = s.with("requests", s.requests.set(id, preflightResult(r))) }
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
  // Step-only reductions. Direct actions and named scenarios keep the original
  // behavior; formal/README.md ("Fused local request steps") states the pattern.
  // 1. Slots are symmetric, so a first attempt uses the lowest unused slot.
  // 2. Request parameters are chosen when first read: mode and bundle by the
  //    envelope check, key, parent and payload by preflight. Until then a
  //    request stores the unread markers "unset", 0, -1 and 0 and empty members.
  //    Every concrete choice has identical successors until that reader, and a
  //    retry repeats chosen parameters while unread ones stay open, matching
  //    begin's equality guard.
  // 3. headers, session, body, envelope, reconstruct, prepare and delivery read
  //    and write only their own request, which no other action reads, so they
  //    commute with every other transition. Step runs each one together with
  //    the preceding action of the same request. Their refusal statuses are
  //    read by no guard; the invariant reads only `status > 0`, which respond
  //    pairs with noStore, and `status == 200`.
  // 4. A refused request goes straight to its delivered form. Its response
  //    state satisfies every request conjunct (respond keeps the subset chain
  //    and sets noStore) and differs from its predecessor only in that request.
  //    A delivered request is changed again only by begin, which reads its
  //    attempt count and, for a retry, its parameters; records are never
  //    removed or rewritten, so its conjuncts stay true. `received` has no
  //    reader besides one named scenario. A 200 reply keeps its response state.
  // 5. Source copies, collected and refreshed sets have no reader after the
  //    last refresh, and the registry copy none after append, so step clears
  //    them. Clearing keeps the subset conjuncts true.
  // 6. Each environment change is a one-time update that no invariant conjunct
  //    reads and that commutes with every transition that does not read the
  //    changed field. Step therefore applies a change only together with the
  //    first reader that observes it: collect, capture and a non-replay append
  //    for pause and selection, a non-replay append for the registry, and
  //    refresh for a source. A change applied with a reader that would refuse
  //    anyway, or with a replay, is unobserved there and is left to a later
  //    reader. Source and registry revisions are read only by comparing a
  //    request's copy with the current value, so a change before the copy only
  //    renames the value; step offers it only where the copy differs.
  // 7. Pausing, revoking the installation and deselecting source 1 each make
  //    every installation-to-append path that has not appended refuse:
  //    installation or collect, capture, and every non-replay append. They
  //    differ only in which of those stages refuses, and the stages between
  //    are request-local, so each reaches the same delivered request. Step
  //    keeps pause as the representative. After any of them every other
  //    installation, selection or registry change is read only by stages that
  //    already refuse, so step offers none. Deselecting source 2 refuses only
  //    joint requests and stays separate. Source changes remain, because
  //    refresh still decides whether a replay reaches readback.
  val environmentChanges = Set("none", "pause", "drop2", "registry", "source1", "source2")
  // 8. A payload is read only when it is copied into a record and from that
  //    record into returnedPayload, which the invariant compares with the same
  //    record. No guard reads it, so step uses payload 1; the named scenarios
  //    keep both payloads.
  val live = s.active and s.installed and s.selected.contains(1)
  // 9. Slots are symmetric in every action and in the invariant, and no other
  //    state names a slot. After each request update step stores the two
  //    requests in rank order; a rank tie keeps the order it has. Either order
  //    is a slot-permuted copy of the same state.
  def phaseRank(phase: str): int = if (phase == "unused") 0 else if (phase == "done") 1
    else if (phase == "installation") 2 else if (phase == "collect") 3 else if (phase == "capture") 4
    else if (phase == "refresh") 5 else if (phase == "preflight") 6 else if (phase == "append") 7
    else if (phase == "readback") 8 else 9
  def slotRank(r: Request): int = {
    val modeRank = if (r.mode == "single") 1 else if (r.mode == "joint") 2 else 0
    ((((((phaseRank(r.phase) * 3 + r.attempt) * 3 + modeRank) * 2 + (if (r.bundle) 1 else 0)) * 3 + r.key) * 6
      + r.parent + 1) * 4 + r.collected.size() + 2 * r.refreshed.size()) * 3 + r.registryRevision
  }
  def sortedSlots(current: int -> Request, id: int, r: Request): int -> Request = {
    val updated = current.set(id, r)
    if (slotRank(updated.get(1)) <= slotRank(updated.get(2))) updated
    else updated.set(1, updated.get(2)).set(2, updated.get(1))
  }
  def carried(prior: Request): Request = idle.with("attempt", prior.attempt + 1)
    .with("mode", if (prior.attempt > 0) prior.mode else "unset")
    .with("bundle", prior.attempt > 0 and prior.bundle)
    .with("members", if (prior.attempt > 0 and prior.mode == "single") Set(1)
      else if (prior.attempt > 0 and prior.mode == "joint") sources else Set())
    .with("key", if (prior.attempt > 0) prior.key else 0)
    .with("parent", if (prior.attempt > 0) prior.parent else -1)
    .with("payload", if (prior.attempt > 0) prior.payload else 0)
  def delivered(r: Request): Request = if (r.attempt >= 2) idle.with("phase", "done").with("attempt", r.attempt)
    else idle.with("phase", "done").with("attempt", r.attempt).with("mode", r.mode).with("key", r.key)
      .with("parent", r.parent).with("payload", r.payload).with("bundle", r.bundle)
  def canBegin(id: int): bool = {
    val prior = s.requests.get(id)
    all { Set("unused", "done").contains(prior.phase), prior.attempt < 2,
      prior.phase == "unused" implies slots.forall(earlier => earlier < id implies s.requests.get(earlier).phase != "unused") }
  }
  action stepRefuseEarly(id: int): bool = all { canBegin(id),
    s' = s.with("requests", sortedSlots(s.requests, id, delivered(carried(s.requests.get(id))))) }
  action stepAdmit(id: int, valid: bool, mode: str, bundle: bool): bool = {
    val r = carried(s.requests.get(id))
    val chosen = if (r.mode != "unset") r
      else r.with("mode", mode).with("bundle", bundle).with("members", if (mode == "single") Set(1) else sources)
    all { canBegin(id), r.mode == "unset" or (mode == r.mode and bundle == r.bundle),
      s' = s.with("requests", sortedSlots(s.requests, id,
        if (valid and not(chosen.mode == "single" and chosen.bundle)) chosen.with("phase", "installation")
        else delivered(chosen))) }
  }
  action stepInstallation(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "installation", s' = s.with("requests", sortedSlots(s.requests, id,
      if (s.installed and available) r.with("phase", "collect") else delivered(r))) }
  }
  // Environment changes as observed by readers (item 6).
  def changeAllowed(change: str): bool = if (change == "none") true
    else if (change == "pause") live
    else if (change == "drop2") live and s.selected.contains(2)
    else if (change == "registry") live and s.registryRevision == 1
    else if (change == "source1") s.sourceRevisions.get(1) == 1
    else if (change == "source2") s.sourceRevisions.get(2) == 1
    else false
  def changedEnvironment(change: str): State =
    if (change == "pause") s.with("active", false).with("registryRevision", 2)
    else if (change == "drop2") s.with("selected", s.selected.exclude(Set(2)))
    else if (change == "registry") s.with("registryRevision", 2)
    else if (change == "source1") s.with("sourceRevisions", s.sourceRevisions.set(1, 2))
    else if (change == "source2") s.with("sourceRevisions", s.sourceRevisions.set(2, 2))
    else s
  action stepCollect(id: int, source: int, valid: bool, reconstructed: bool, change: str): bool = {
    val r = s.requests.get(id)
    val e = changedEnvironment(change)
    val collected = r.collected.union(Set(source))
    val gathered = r.with("collected", collected).with("sourceRevisions", r.sourceRevisions.set(source, e.sourceRevisions.get(source)))
    all { r.phase == "collect", r.members.contains(source), not(r.collected.contains(source)), reconstructed or (r.bundle and collected == r.members),
      changeAllowed(change), Set("none", "pause", if (source == 2) "drop2" else "none").contains(change), change != "none" implies valid,
      s' = e.with("requests", sortedSlots(e.requests, id,
        if (not(valid and e.active and e.selected.contains(source))) delivered(r)
        else if (collected != r.members) gathered
        else if (r.bundle and not(reconstructed)) delivered(r)
        else gathered.with("phase", "capture"))) }
  }
  action stepCapture(id: int, change: str): bool = {
    val r = s.requests.get(id)
    val e = changedEnvironment(change)
    all { r.phase == "capture", changeAllowed(change),
      Set("none", "pause", if (r.members.contains(2)) "drop2" else "none").contains(change),
      s' = e.with("requests", sortedSlots(e.requests, id,
      if (e.active and e.installed and r.members.subseteq(e.selected))
        r.with("registryRevision", e.registryRevision).with("phase", "refresh") else delivered(r))) }
  }
  action stepRefresh(id: int, source: int, valid: bool, prepared: bool, change: str): bool = {
    val r = s.requests.get(id)
    val e = changedEnvironment(change)
    val refreshed = r.refreshed.union(Set(source))
    all { r.phase == "refresh", r.members.contains(source), not(r.refreshed.contains(source)), prepared or refreshed == r.members,
      changeAllowed(change), Set("none", if (source == 1) "source1" else "source2").contains(change), change != "none" implies valid,
      s' = e.with("requests", sortedSlots(e.requests, id,
        if (not(valid) or r.sourceRevisions.get(source) != e.sourceRevisions.get(source)) delivered(r)
        else if (refreshed != r.members) r.with("refreshed", refreshed)
        else if (not(prepared)) delivered(r)
        else r.with("phase", "preflight").with("collected", Set()).with("refreshed", Set())
          .with("sourceRevisions", idle.sourceRevisions))) }
  }
  // 10. The parent is read only by preflight and a non-replay append, both as
  //    `parent == tip`, and is copied into a new record. A replay never reads
  //    it, now or on a retry, because rows are never removed, so a replaying
  //    request leaves it unread (-1). A last attempt that does not match the
  //    tip is refused and delivered without parameters, so one mismatching
  //    value represents the others. A first attempt keeps every value for its
  //    retry.
  action stepPreflight(id: int, key: int, parent: int, payload: int): bool = {
    val r = s.requests.get(id)
    val keyed = if (r.key != 0) r else r.with("key", key).with("payload", payload)
    val replayNow = rowAt(rowOf(keyed)).exists
    val mismatch = if (s.tip == 0) 1 else 0
    val chosen = if (r.parent != -1) keyed else keyed.with("parent", parent)
    val checked = preflightResult(chosen)
    all { r.phase == "preflight", r.key == 0 or (key == r.key and payload == r.payload),
      if (r.parent != -1) parent == r.parent
      else if (replayNow) parent == -1
      else if (r.attempt >= 2) parent == s.tip or parent == mismatch
      else parent >= 0,
      s' = s.with("requests", sortedSlots(s.requests, id, if (checked.phase == "append") checked else delivered(chosen))) }
  }
  action stepAppend(id: int, lostReply: bool, change: str): bool = {
    val r = s.requests.get(id)
    val e = changedEnvironment(change)
    val row = rowOf(r)
    val replay = rowAt(row).exists
    val valid = e.active and e.installed and r.members.subseteq(e.selected) and r.registryRevision == e.registryRevision
      and r.parent == s.tip and not(r.mode == "single" and rowAt(s.tip).mode == "joint")
    val nextValue = if (lostReply) delivered(r) else r.with("phase", "readback").with("registryRevision", 0)
    val record: Record = { exists: true, mode: r.mode, parent: r.parent, payload: r.payload, members: r.members }
    all { r.phase == "append", changeAllowed(change), change != "none" implies not(replay),
      Set("none", "pause", "registry", if (r.members.contains(2)) "drop2" else "none").contains(change),
      s' = if (replay) e.with("requests", sortedSlots(e.requests, id, nextValue))
        else if (not(valid)) e.with("requests", sortedSlots(e.requests, id, delivered(r)))
        else e.with("records", s.records.set(row, record)).with("tip", row)
          .with("sourceIndex", s.sourceIndex.set(row, if (r.mode == "joint") r.members else Set()))
          .with("claimIndex", s.claimIndex.set(row, if (r.mode == "joint") r.members else Set()))
          .with("parentIndex", s.parentIndex.set(row, if (r.mode == "joint" and rowAt(r.parent).mode == "joint") Set(r.parent) else Set()))
          .with("requests", sortedSlots(e.requests, id, nextValue)) }
  }
  action stepReadback(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    val row = rowOf(r)
    val stored = rowAt(row)
    all { r.phase == "readback", s' = s.with("requests", sortedSlots(s.requests, id,
      if (available and stored.exists) respond(r, 200).with("returnedRow", row).with("returnedPayload", stored.payload)
      else delivered(r))) }
  }
  // Installation, collect and refresh failures equal their own refusal
  // outcomes, so stepFailure covers the remaining phases.
  action stepFailure(id: int): bool = {
    val r = s.requests.get(id)
    all { Set("capture", "preflight", "append").contains(r.phase),
      s' = s.with("requests", sortedSlots(s.requests, id, delivered(r))) }
  }
  action stepSend(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "response", s' = s.with("requests", sortedSlots(s.requests, id, delivered(r))) }
  }
  // Each nondeterministic choice is bound inside the one branch that reads it,
  // so TLC enumerates the sum of the branch choices instead of their product
  // (formal/README.md, "Branch-local nondeterministic choices").
  action step = any {
    { nondet id = slots.oneOf()
      stepRefuseEarly(id) },
    { nondet id = slots.oneOf()
      nondet yes = Set(false, true).oneOf()
      nondet mode = Set("single", "joint").oneOf()
      nondet bundle = Set(false, true).oneOf()
      stepAdmit(id, yes, mode, bundle) },
    { nondet id = slots.oneOf()
      nondet yes = Set(false, true).oneOf()
      stepInstallation(id, yes) },
    { nondet id = slots.oneOf()
      nondet source = sources.oneOf()
      nondet yes = Set(false, true).oneOf()
      nondet third = Set(false, true).oneOf()
      nondet change = environmentChanges.oneOf()
      stepCollect(id, source, yes, third, change) },
    { nondet id = slots.oneOf()
      nondet change = environmentChanges.oneOf()
      stepCapture(id, change) },
    { nondet id = slots.oneOf()
      nondet source = sources.oneOf()
      nondet yes = Set(false, true).oneOf()
      nondet other = Set(false, true).oneOf()
      nondet change = environmentChanges.oneOf()
      stepRefresh(id, source, yes, other, change) },
    { nondet id = slots.oneOf()
      nondet key = Set(1, 2).oneOf()
      nondet parent = (-1).to(4).oneOf()
      stepPreflight(id, key, parent, 1) },
    { nondet id = slots.oneOf()
      nondet yes = Set(false, true).oneOf()
      nondet change = environmentChanges.oneOf()
      stepAppend(id, yes, change) },
    { nondet id = slots.oneOf()
      nondet yes = Set(false, true).oneOf()
      stepReadback(id, yes) },
    { nondet id = slots.oneOf()
      stepFailure(id) },
    { nondet id = slots.oneOf()
      stepSend(id) },
    s' = s
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
