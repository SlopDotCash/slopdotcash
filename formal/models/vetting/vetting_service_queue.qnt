// @source backend/vetting/handler.ts
// @source backend/vetting/persistence.ts
// @source migrations/0025_community_security_vetting.sql
// @source migrations/0099_vetting_queue_current_pin.sql
// @evidence backend/vetting/service-queue.test.ts
// Signed GET /vetting/requests composes authentication, one evidence-ready
// observation, one database snapshot, and a redacted source assignment.
// Authentication outcomes abstract vetting_service_auth; result validation,
// insertion arbitration and evidence retention have separate models.
// Five retained rowids, three projects/time ranks, two concurrent readers;
// response cap two abstracts SQL LIMIT 100 (the implementation test uses 101).
// Immutable source values are distinct integer atoms. URL origin/project/
// revision components stand for the literal URLs checked by the API tests.
// Polling grants no lease, claim or current-registry/permission revalidation.
// A completed/latest row suppresses historical pending work. Read snapshots
// can become stale before delivery; a later poll observes the newer store.
// Source-only definitions; no parser, checker or conformance run is claimed.
module vetting_service_queue {
  val rowIds = List(1, 2, 3, 4, 5)
  val readerIds = Set(1, 2)
  val terminalStates = Set("clean", "incomplete", "malicious")
  type Row = { id: int, project: int, revision: int, manifest: int, commit: int,
    template: int, requestedAt: int, privateActor: int, privateReason: int, state: str }
  type Item = { assessmentId: int, projectId: int, revision: int, manifestSha256: int,
    commitSha: int, templateSha256: int, requestedAt: int, manifestOrigin: int,
    manifestProject: int, manifestRevision: int, templateIndexOrigin: int }
  type Reader = { phase: str, authOutcome: int, origin: int, authenticated: bool,
    evidenceObserved: bool, queried: bool, snapshot: List[Row], response: List[Item],
    status: int, delivered: bool }
  val emptyRow: Row = { id: 0, project: 0, revision: 0, manifest: 0, commit: 0,
    template: 0, requestedAt: 0, privateActor: 0, privateReason: 0, state: "pending" }
  val emptyReader: Reader = { phase: "idle", authOutcome: 0, origin: 1,
    authenticated: false, evidenceObserved: false, queried: false,
    snapshot: List(), response: List(), status: 0, delivered: false }
  var s: { rows: int -> Row, original: int -> Row, count: int,
    evidenceAvailable: bool, readers: int -> Reader }
  action init = s' = { rows: rowIds.indices().map(i => rowIds.nth(i)).mapBy(_ => emptyRow),
    original: rowIds.indices().map(i => rowIds.nth(i)).mapBy(_ => emptyRow),
    count: 0, evidenceAvailable: true, readers: readerIds.mapBy(_ => emptyReader) }
  def isEligible(rows: int -> Row, count: int, id: int): bool = {
    val row = rows.get(id)
    id <= count and row.state == "pending" and
      not(rowIds.indices().exists(i => {
        val otherId = rowIds.nth(i)
        otherId <= count and otherId > id and rows.get(otherId).project == row.project
      }))
  }
  def queueSnapshot(rows: int -> Row, count: int): List[Row] = {
    val ordered = List(1, 2, 3).foldl(List(), (result, time) =>
      rowIds.foldl(result, (entries, id) =>
        if (isEligible(rows, count, id) and rows.get(id).requestedAt == time)
          entries.append(rows.get(id)) else entries))
    ordered.slice(0, if (ordered.length() < 2) ordered.length() else 2)
  }
  def assignment(row: Row, origin: int): Item = { assessmentId: row.id, projectId: row.project,
    revision: row.revision, manifestSha256: row.manifest, commitSha: row.commit,
    templateSha256: row.template, requestedAt: row.requestedAt, manifestOrigin: origin,
    manifestProject: row.project, manifestRevision: row.revision, templateIndexOrigin: origin }
  action appendRow(project: int, time: int): bool = {
    val id = s.count + 1
    val row = emptyRow.with("id", id).with("project", project).with("revision", id)
      .with("manifest", id + 10).with("commit", id + 20).with("template", id + 30)
      .with("requestedAt", time).with("privateActor", id + 40).with("privateReason", id + 50)
    all { s.count < 5, Set(1, 2, 3).contains(project), Set(1, 2, 3).contains(time),
      s' = s.with("rows", s.rows.set(id, row)).with("original", s.original.set(id, row)).with("count", id) }
  }
  action finishRow(id: int, state: str): bool = all { id >= 1, id <= s.count,
    terminalStates.contains(state), s.rows.get(id).state == "pending",
    s' = s.with("rows", s.rows.set(id, s.rows.get(id).with("state", state))) }
  action evidenceAvailability(available: bool): bool = s' = s.with("evidenceAvailable", available)
  action beginRead(id: int, authOutcome: int, origin: int): bool = all {
    readerIds.contains(id), Set("idle", "done").contains(s.readers.get(id).phase),
    Set(0, 1, 2).contains(authOutcome), Set(1, 2).contains(origin),
    s' = s.with("readers", s.readers.set(id, emptyReader.with("phase", "authenticate")
      .with("authOutcome", authOutcome).with("origin", origin))) }
  action authenticate(id: int): bool = {
    val r = s.readers.get(id)
    all { r.phase == "authenticate", s' = s.with("readers", s.readers.set(id,
      if (r.authOutcome == 0) r.with("authenticated", true).with("phase", "evidence")
      else r.with("phase", "reply").with("status", if (r.authOutcome == 1) 401 else 503))) }
  }
  action observeEvidence(id: int): bool = {
    val r = s.readers.get(id)
    all { r.phase == "evidence", s' = s.with("readers", s.readers.set(id,
      if (s.evidenceAvailable) r.with("evidenceObserved", true).with("phase", "query")
      else r.with("phase", "reply").with("status", 503))) }
  }
  action query(id: int, succeeds: bool): bool = {
    val r = s.readers.get(id)
    all { r.phase == "query", s' = s.with("readers", s.readers.set(id,
      if (succeeds) r.with("queried", true).with("snapshot", queueSnapshot(s.rows, s.count)).with("phase", "serialize")
      else r.with("queried", true).with("phase", "reply").with("status", 500))) }
  }
  action serialize(id: int): bool = {
    val r = s.readers.get(id)
    all { r.phase == "serialize", s' = s.with("readers", s.readers.set(id,
      r.with("response", r.snapshot.map(row => assignment(row, r.origin))).with("status", 200).with("phase", "reply"))) }
  }
  action delivery(id: int, received: bool): bool = {
    val r = s.readers.get(id)
    all { r.phase == "reply", s' = s.with("readers", s.readers.set(id, r.with("phase", "done").with("delivered", received))) }
  }
  action step = {
    nondet reader = readerIds.oneOf()
    nondet row = Set(1, 2, 3, 4, 5).oneOf()
    nondet project = Set(1, 2, 3).oneOf()
    nondet time = Set(1, 2, 3).oneOf()
    nondet authOutcome = Set(0, 1, 2).oneOf()
    nondet origin = Set(1, 2).oneOf()
    nondet terminalState = terminalStates.oneOf()
    nondet succeeds = Set(false, true).oneOf()
    any { appendRow(project, time), finishRow(row, terminalState), evidenceAvailability(succeeds),
      beginRead(reader, authOutcome, origin), authenticate(reader), observeEvidence(reader), query(reader, succeeds),
      serialize(reader), delivery(reader, succeeds), s' = s }
  }
  val invariant = all { s.count >= 0, s.count <= 5,
    rowIds.indices().forall(i => { val id = rowIds.nth(i)
      id > s.count or s.rows.get(id).with("state", "pending") == s.original.get(id) }),
    readerIds.forall(id => { val r = s.readers.get(id)
      all { r.response.length() <= 2,
        r.queried implies r.authenticated and r.evidenceObserved,
        r.status == 200 implies r.queried and r.response == r.snapshot.map(row => assignment(row, r.origin)),
        r.status != 200 implies r.response == List(),
        r.snapshot.indices().forall(i => r.snapshot.nth(i).state == "pending"),
        r.snapshot.indices().forall(i => r.snapshot.indices().forall(j =>
          i == j or r.snapshot.nth(i).project != r.snapshot.nth(j).project)) } }) }
  action admitted(id: int): bool = beginRead(id, 0, 1).then(authenticate(id)).then(observeEvidence(id))
  action read(id: int): bool = admitted(id).then(query(id, true)).then(serialize(id)).then(delivery(id, true))
  run emptyQueueReturnsSuccessTest = init.then(read(1)).expect(s.readers.get(1).status == 200 and s.readers.get(1).response == List() and invariant)
  run exactAssignmentSurvivesProjectionTest = init.then(appendRow(2, 1)).then(read(1)).expect(s.readers.get(1).response == List(assignment(s.original.get(1), 1)) and invariant)
  run latestRowidWinsOverRequestTimeTest = init.then(appendRow(1, 3)).then(appendRow(1, 1)).then(read(1)).expect(s.readers.get(1).response.map(r => r.assessmentId) == List(2) and invariant)
  run latestCleanSuppressesHistoricalPendingTest = init.then(appendRow(1, 1)).then(appendRow(1, 2)).then(finishRow(2, "clean")).then(read(1)).expect(s.readers.get(1).response == List() and s.rows.get(1).state == "pending" and invariant)
  run latestIncompleteSuppressesHistoricalPendingTest = init.then(appendRow(1, 1)).then(appendRow(1, 2)).then(finishRow(2, "incomplete")).then(read(1)).expect(s.readers.get(1).response == List() and invariant)
  run latestMaliciousSuppressesHistoricalPendingTest = init.then(appendRow(1, 1)).then(appendRow(1, 2)).then(finishRow(2, "malicious")).then(read(1)).expect(s.readers.get(1).response == List() and invariant)
  run requestedTimeSortsBeforeInsertionTest = init.then(appendRow(1, 3)).then(appendRow(2, 1)).then(read(1)).expect(s.readers.get(1).response.map(r => r.assessmentId) == List(2, 1) and invariant)
  run rowidBreaksRequestTimeTiesTest = init.then(appendRow(2, 1)).then(appendRow(1, 1)).then(read(1)).expect(s.readers.get(1).response.map(r => r.assessmentId) == List(1, 2) and invariant)
  run capAppliesAfterProjectDeduplicationTest = init.then(appendRow(1, 1)).then(appendRow(1, 1)).then(appendRow(2, 2)).then(appendRow(3, 3)).then(read(1)).expect(s.readers.get(1).response.map(r => r.assessmentId) == List(2, 3) and invariant)
  run signatureRefusalDoesNotReadStorageTest = init.then(beginRead(1, 1, 1)).then(authenticate(1)).expect(s.readers.get(1).status == 401 and not(s.readers.get(1).queried) and invariant)
  run unavailableKeysPrecedeEvidenceRefusalTest = init.then(evidenceAvailability(false)).then(beginRead(1, 2, 1)).then(authenticate(1)).expect(s.readers.get(1).status == 503 and not(s.readers.get(1).authenticated) and invariant)
  run absentEvidencePreventsQueueReadTest = init.then(evidenceAvailability(false)).then(admitted(1)).expect(s.readers.get(1).status == 503 and not(s.readers.get(1).queried) and invariant)
  run databaseFailureReturnsNoAssignmentsTest = init.then(appendRow(1, 1)).then(admitted(1)).then(query(1, false)).expect(s.readers.get(1).status == 500 and s.readers.get(1).response == List() and invariant)
  run readinessIsOneObservationTest = init.then(appendRow(1, 1)).then(admitted(1)).then(evidenceAvailability(false)).then(query(1, true)).then(serialize(1)).expect(s.readers.get(1).status == 200 and invariant)
  run completionAfterReadDoesNotRewriteSnapshotTest = init.then(appendRow(1, 1)).then(admitted(1)).then(query(1, true)).then(finishRow(1, "clean")).then(serialize(1)).expect(s.readers.get(1).response.map(r => r.assessmentId) == List(1) and invariant)
  run replacementAfterReadDoesNotRewriteSnapshotTest = init.then(appendRow(1, 1)).then(admitted(1)).then(query(1, true)).then(appendRow(1, 2)).then(serialize(1)).expect(s.readers.get(1).response.map(r => r.assessmentId) == List(1) and invariant)
  run nextPollObservesReplacementTest = init.then(appendRow(1, 1)).then(read(1)).then(appendRow(1, 2)).then(read(1)).expect(s.readers.get(1).response.map(r => r.assessmentId) == List(2) and invariant)
  run nextPollObservesCompletionTest = init.then(appendRow(1, 1)).then(read(1)).then(finishRow(1, "incomplete")).then(read(1)).expect(s.readers.get(1).response == List() and invariant)
  run replayDoesNotClaimWorkTest = init.then(appendRow(1, 1)).then(read(1)).then(read(1)).expect(s.readers.get(1).response.map(r => r.assessmentId) == List(1) and s.rows.get(1).state == "pending" and invariant)
  run concurrentReadersReceiveSameAssignmentTest = init.then(appendRow(1, 1)).then(admitted(1)).then(admitted(2)).then(query(1, true)).then(query(2, true)).then(serialize(1)).then(serialize(2)).expect(s.readers.get(1).response == s.readers.get(2).response and invariant)
  run concurrentReadersCanObserveDifferentSnapshotsTest = init.then(appendRow(1, 1)).then(admitted(1)).then(admitted(2)).then(query(1, true)).then(appendRow(1, 2)).then(query(2, true)).then(serialize(1)).then(serialize(2)).expect(s.readers.get(1).response.map(r => r.assessmentId) == List(1) and s.readers.get(2).response.map(r => r.assessmentId) == List(2) and invariant)
  run requestOriginOwnsBothReadUrlsTest = init.then(appendRow(1, 1)).then(beginRead(1, 0, 2)).then(authenticate(1)).then(observeEvidence(1)).then(query(1, true)).then(serialize(1)).expect(s.readers.get(1).response == List(assignment(s.original.get(1), 2)) and invariant)
  run lostResponseLeavesPendingWorkTest = init.then(appendRow(1, 1)).then(admitted(1)).then(query(1, true)).then(serialize(1)).then(delivery(1, false)).then(read(2)).expect(not(s.readers.get(1).delivered) and s.readers.get(2).response.map(r => r.assessmentId) == List(1) and invariant)
  run readsRetainEveryHistoricalAssignmentTest = init.then(appendRow(1, 1)).then(appendRow(1, 2)).then(finishRow(2, "clean")).then(read(1)).expect(s.count == 2 and s.rows.get(1) == s.original.get(1) and s.rows.get(2).with("state", "pending") == s.original.get(2) and invariant)
}
