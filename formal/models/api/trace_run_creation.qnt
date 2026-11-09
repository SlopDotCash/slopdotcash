// @source backend/trace/handler.ts
// @source backend/trace/cloudflare-persistence.ts
// @source backend/trace/contracts.ts
// @source backend/projects/account-bans.ts
// @source backend/d1.ts
// @source migrations/0001_private_trace_backend.sql
// @evidence scripts/trace-upload-attachable.test.ts
// @evidence scripts/project-self-service.test.ts
// Two authenticated writer actors, two actor-scoped idempotency keys, two
// payload classes and two concurrent request slots. Each slot may retry once
// with the same actor/key; its payload and login may differ on retry. Four
// fresh generated server IDs and a clock 0..2 bound this model. IDs never
// collide or get reused; UUID entropy and byte-level validators are not proved.
// A payload class represents all eight sameCreate fields, including clientRunId.
// Generated ID, creation time and current GitHub login do not participate in
// sameCreate. Distinct keys may create rows with identical clientRunId/payload.
// Actor/key uniqueness and statement atomicity are assumptions of the migrated
// SQLite/D1 schema. A failed constraint writes no row. INSERT commit, observed
// result, race readback, by-ID readback and HTTP response are separate; run()
// success/changes metadata is not inspected by this implementation.
// Effective bans represent the query's ban/reinstatement result, not the human
// decision protocol. New insertion checks the ban atomically. Existing replay
// has only the handler's earlier ban check; conflict alone performs a later
// check. A successful response need not imply absence of a later ban.
// advanceRun abstracts another authorized upload/finalization operation; its
// own guards, objects and events belong to the other trace models. Readback
// returns state at that read, which can differ from insertion state or state
// at response delivery. No local transition rewrites creation metadata.
// The existing trace workflow creates ordinary runs through signed requests;
// project-self-service's moderator-ban workflow covers a ban between initial
// admission and insertion. Neither is comprehensive concurrent-create or lost
// response conformance. This model and its named scenarios are unexecuted.
module trace_run_creation {
  val actors = Set(1, 2)
  val keyIds = Set(1, 2)
  val slots = Set(1, 2)
  val rowKeys = Set(1, 2, 3, 4)
  val payloads = Set(1, 2)
  val logins = Set(1, 2)
  val bodyResults = Set("valid", "400", "413", "error")
  type Row = { exists: bool, id: int, actor: int, key: int, payload: int,
    login: int, created: int, state: str }
  type Request = { phase: str, attempt: int, actor: int, key: int, payload: int,
    login: int, generatedId: int, created: int, insertOutcome: str,
    snapshotId: int, snapshotActor: int, snapshotPayload: int,
    snapshotLogin: int, snapshotCreated: int, snapshotState: str,
    disposition: str, desired: str, response: str, priorResponse: str }
  val absent: Row = { exists: false, id: 0, actor: 0, key: 0, payload: 0,
    login: 0, created: -1, state: "absent" }
  // Inactive slots still use valid map indexes if a disabled action evaluates
  // its local bindings before the phase guard.
  val idle: Request = { phase: "idle", attempt: 0, actor: 1, key: 1, payload: 0,
    login: 0, generatedId: 0, created: -1, insertOutcome: "none",
    snapshotId: 0, snapshotActor: 0, snapshotPayload: 0, snapshotLogin: 0,
    snapshotCreated: -1, snapshotState: "none", disposition: "none",
    desired: "none", response: "none", priorResponse: "none" }
  var s: { now: int, bans: Set[int], rows: int -> Row, requests: int -> Request, insertions: int }
  action init = s' = { now: 0, bans: Set(), rows: rowKeys.mapBy(_ => absent),
    requests: slots.mapBy(_ => idle), insertions: 0 }
  def index(actor: int, key: int): int = (actor - 1) * 2 + key
  def finish(request: Request, status: str): Request = request.with("phase", "reply").with("desired", status)
  def snapshot(request: Request, row: Row, disposition: str): Request =
    finish(request, if (disposition == "created") "201" else "200")
      .with("snapshotId", row.id).with("snapshotActor", row.actor).with("snapshotPayload", row.payload)
      .with("snapshotLogin", row.login).with("snapshotCreated", row.created).with("snapshotState", row.state)
      .with("disposition", disposition)
  def conflict(request: Request): Request = request.with("phase", "conflict-ban").with("disposition", "conflict")
  action tick = all { s.now < 2, s' = s.with("now", s.now + 1) }
  action ban(actor: int): bool = all { actors.contains(actor), not(s.bans.contains(actor)),
    s' = s.with("bans", s.bans.union(Set(actor))) }
  action reinstate(actor: int): bool = all { s.bans.contains(actor),
    s' = s.with("bans", s.bans.exclude(Set(actor))) }
  action begin(slot: int, actor: int, key: int, payload: int, login: int): bool = {
    val previous = s.requests.get(slot)
    all { slots.contains(slot), actors.contains(actor), keyIds.contains(key), payloads.contains(payload), logins.contains(login),
      Set("idle", "done").contains(previous.phase), previous.attempt < 2,
      previous.attempt > 0 implies actor == previous.actor and key == previous.key,
      s' = s.with("requests", s.requests.set(slot, idle.with("phase", "initial-ban")
        .with("attempt", previous.attempt + 1).with("actor", actor).with("key", key)
        .with("payload", payload).with("login", login).with("priorResponse", previous.response))) }
  }
  action initialBanRead(slot: int, ok: bool): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "initial-ban",
      s' = s.with("requests", s.requests.set(slot, if (not(ok)) finish(request, "500")
        else if (s.bans.contains(request.actor)) finish(request, "403") else request.with("phase", "body"))) }
  }
  action readBody(slot: int, result: str): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "body", bodyResults.contains(result),
      s' = s.with("requests", s.requests.set(slot, if (result == "valid") request.with("phase", "prepare")
        else finish(request, if (result == "error") "500" else result))) }
  }
  action prepare(slot: int, randomIdOk: bool, fieldsValid: bool): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "prepare",
      s' = s.with("requests", s.requests.set(slot, if (not(randomIdOk)) finish(request, "500")
        else if (not(fieldsValid)) finish(request, "400")
        else request.with("phase", "lookup").with("created", s.now)
          .with("generatedId", (slot - 1) * 2 + request.attempt))) }
  }
  action readExisting(slot: int, ok: bool): bool = {
    val request = s.requests.get(slot)
    val row = s.rows.get(index(request.actor, request.key))
    val nextValue = if (not(ok)) finish(request, "500") else if (not(row.exists)) request.with("phase", "insert")
      else if (row.payload == request.payload) snapshot(request, row, "existing") else conflict(request)
    all { request.phase == "lookup", s' = s.with("requests", s.requests.set(slot, nextValue)) }
  }
  action insert(slot: int): bool = {
    val request = s.requests.get(slot)
    val rowKey = index(request.actor, request.key)
    val row = s.rows.get(rowKey)
    // SELECT emits no candidate on a current ban, before uniqueness matters.
    val outcome = if (s.bans.contains(request.actor)) "no-op" else if (row.exists) "constraint" else "inserted"
    val created: Row = { exists: true, id: request.generatedId, actor: request.actor, key: request.key,
      payload: request.payload, login: request.login, created: request.created, state: "awaiting_trace" }
    all { request.phase == "insert",
      s' = s.with("rows", if (outcome == "inserted") s.rows.set(rowKey, created) else s.rows)
        .with("insertions", s.insertions + (if (outcome == "inserted") 1 else 0))
        .with("requests", s.requests.set(slot, request.with("phase", "insert-result").with("insertOutcome", outcome))) }
  }
  action insertFailure(slot: int): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "insert", s' = s.with("requests", s.requests.set(slot, finish(request, "500"))) }
  }
  action insertResult(slot: int, observed: bool): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "insert-result",
      s' = s.with("requests", s.requests.set(slot, if (not(observed)) finish(request, "500")
        else request.with("phase", if (request.insertOutcome == "constraint") "race-read" else "by-id-read"))) }
  }
  action raceRead(slot: int, ok: bool): bool = {
    val request = s.requests.get(slot)
    val row = s.rows.get(index(request.actor, request.key))
    all { request.phase == "race-read",
      s' = s.with("requests", s.requests.set(slot, if (not(ok)) finish(request, "500")
        else if (row.exists and row.payload == request.payload) snapshot(request, row, "existing") else conflict(request))) }
  }
  action createdRead(slot: int, ok: bool): bool = {
    val request = s.requests.get(slot)
    val row = s.rows.get(index(request.actor, request.key))
    all { request.phase == "by-id-read",
      s' = s.with("requests", s.requests.set(slot, if (not(ok)) finish(request, "500")
        else if (row.exists and row.id == request.generatedId) snapshot(request, row, "created") else conflict(request))) }
  }
  action conflictBanRead(slot: int, ok: bool): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "conflict-ban",
      s' = s.with("requests", s.requests.set(slot, finish(request,
        if (not(ok)) "500" else if (s.bans.contains(request.actor)) "403" else "409"))) }
  }
  action respond(slot: int, delivered: bool): bool = {
    val request = s.requests.get(slot)
    all { request.phase == "reply", s' = s.with("requests", s.requests.set(slot,
      request.with("phase", "done").with("response", if (delivered) request.desired else "lost"))) }
  }
  action advanceRun(actor: int, key: int): bool = {
    val rowKey = index(actor, key)
    val row = s.rows.get(rowKey)
    all { row.exists, row.state != "finalized",
      s' = s.with("rows", s.rows.set(rowKey, row.with("state",
        if (row.state == "awaiting_trace") "trace_uploaded" else "finalized"))) }
  }
  action step = {
    nondet slot = slots.oneOf()
    nondet actor = actors.oneOf()
    nondet key = keyIds.oneOf()
    nondet payload = payloads.oneOf()
    nondet login = logins.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet body = bodyResults.oneOf()
    any { tick, ban(actor), reinstate(actor), begin(slot, actor, key, payload, login), initialBanRead(slot, yes),
      readBody(slot, body), prepare(slot, yes, other), readExisting(slot, yes), insert(slot), insertFailure(slot),
      insertResult(slot, yes), raceRead(slot, yes), createdRead(slot, yes), conflictBanRead(slot, yes), respond(slot, yes),
      advanceRun(actor, key), s' = s }
  }
  val invariant = all {
    s.now >= 0, s.now <= 2, s.insertions == rowKeys.filter(key => s.rows.get(key).exists).size(), s.insertions <= 2,
    rowKeys.forall(key => {
      val row = s.rows.get(key)
      not(row.exists) or (index(row.actor, row.key) == key and row.id >= 1 and row.id <= 4
        and payloads.contains(row.payload) and logins.contains(row.login) and row.created >= 0 and row.created <= 2)
    }),
    rowKeys.forall(a => rowKeys.forall(b => a == b or not(s.rows.get(a).exists and s.rows.get(b).exists)
      or s.rows.get(a).id != s.rows.get(b).id)),
    slots.forall(slot => {
      val request = s.requests.get(slot)
      all { request.attempt >= 0, request.attempt <= 2,
        request.snapshotId > 0 implies request.snapshotActor == request.actor and request.snapshotPayload == request.payload,
        request.desired == "201" implies request.disposition == "created" and request.snapshotId == request.generatedId,
        request.desired == "200" implies request.disposition == "existing" and request.snapshotId > 0,
        request.insertOutcome == "inserted" implies s.rows.get(index(request.actor, request.key)).id == request.generatedId }
    }) }

  action prepared(slot: int, actor: int, key: int, payload: int, login: int): bool = begin(slot, actor, key, payload, login)
    .then(initialBanRead(slot, true)).then(readBody(slot, "valid")).then(prepare(slot, true, true))
  action emptyRead(slot: int, actor: int, key: int, payload: int): bool = prepared(slot, actor, key, payload, 1).then(readExisting(slot, true))
  action committed(slot: int): bool = insert(slot).then(insertResult(slot, true))
  action created(slot: int, actor: int, key: int, payload: int): bool = emptyRead(slot, actor, key, payload)
    .then(committed(slot)).then(createdRead(slot, true)).then(respond(slot, true))

  run ordinaryCreationReturnsPersistedRunTest = init.then(created(1, 1, 1, 1))
    .expect(s.requests.get(1).response == "201" and s.rows.get(1).state == "awaiting_trace" and invariant)
  run initialBanRefusesBeforeBodyOrLookupTest = init.then(ban(1)).then(begin(1, 1, 1, 1, 1))
    .then(initialBanRead(1, true)).then(respond(1, true)).expect(s.requests.get(1).response == "403" and s.insertions == 0 and invariant)
  run initialBanReadFailureDoesNotCreateRunTest = init.then(begin(1, 1, 1, 1, 1)).then(initialBanRead(1, false)).then(respond(1, true))
    .expect(s.requests.get(1).response == "500" and s.insertions == 0 and invariant)
  run malformedBodyRefusesBeforePersistenceTest = init.then(begin(1, 1, 1, 1, 1)).then(initialBanRead(1, true))
    .then(readBody(1, "400")).then(respond(1, true)).expect(s.requests.get(1).response == "400" and s.insertions == 0 and invariant)
  run oversizedBodyRefusesBeforePersistenceTest = init.then(begin(1, 1, 1, 1, 1)).then(initialBanRead(1, true))
    .then(readBody(1, "413")).then(respond(1, true)).expect(s.requests.get(1).response == "413" and s.insertions == 0 and invariant)
  run randomIdFailurePrecedesFieldValidationTest = init.then(begin(1, 1, 1, 1, 1)).then(initialBanRead(1, true))
    .then(readBody(1, "valid")).then(prepare(1, false, false)).then(respond(1, true))
    .expect(s.requests.get(1).response == "500" and s.insertions == 0 and invariant)
  run invalidRequiredFieldsNeverReachLookupTest = init.then(begin(1, 1, 1, 1, 1)).then(initialBanRead(1, true))
    .then(readBody(1, "valid")).then(prepare(1, true, false)).then(respond(1, true))
    .expect(s.requests.get(1).response == "400" and s.insertions == 0 and invariant)
  run matchingReplayReturnsOriginalIdLoginAndTimeTest = init.then(created(1, 1, 1, 1)).then(tick)
    .then(prepared(1, 1, 1, 1, 2)).then(readExisting(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "200" and s.requests.get(1).snapshotId == 1
      and s.requests.get(1).snapshotLogin == 1 and s.requests.get(1).snapshotCreated == 0 and s.insertions == 1 and invariant)
  run changedPayloadOnSameKeyRefusesTest = init.then(created(1, 1, 1, 1)).then(prepared(1, 1, 1, 2, 1))
    .then(readExisting(1, true)).then(conflictBanRead(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "409" and s.rows.get(1).payload == 1 and s.insertions == 1 and invariant)
  run sameClientPayloadWithDifferentKeysCreatesDistinctRunsTest = init.then(created(1, 1, 1, 1)).then(created(2, 1, 2, 1))
    .expect(s.insertions == 2 and s.rows.get(1).id != s.rows.get(2).id and invariant)
  run sameKeyAcrossActorsDoesNotConflictTest = init.then(created(1, 1, 1, 1)).then(created(2, 2, 1, 2))
    .expect(s.insertions == 2 and s.rows.get(1).actor == 1 and s.rows.get(3).actor == 2 and invariant)
  run concurrentMatchingPayloadReturnsCreatedAndExistingTest = init.then(emptyRead(1, 1, 1, 1)).then(emptyRead(2, 1, 1, 1))
    .then(committed(1)).then(committed(2)).then(raceRead(2, true)).then(createdRead(1, true))
    .then(respond(1, true)).then(respond(2, true))
    .expect(s.requests.get(1).response == "201" and s.requests.get(2).response == "200"
      and s.requests.get(1).snapshotId == s.requests.get(2).snapshotId and s.insertions == 1 and invariant)
  run concurrentDifferentPayloadReturnsConflictTest = init.then(emptyRead(1, 1, 1, 1)).then(emptyRead(2, 1, 1, 2))
    .then(committed(1)).then(committed(2)).then(raceRead(2, true)).then(conflictBanRead(2, true)).then(respond(2, true))
    .expect(s.requests.get(2).response == "409" and s.rows.get(1).payload == 1 and invariant)
  run raceReadFailureKeepsWinningInsertionTest = init.then(emptyRead(1, 1, 1, 1)).then(emptyRead(2, 1, 1, 1))
    .then(committed(1)).then(committed(2)).then(raceRead(2, false)).then(respond(2, true))
    .expect(s.requests.get(2).response == "500" and s.insertions == 1 and invariant)
  run banBetweenInitialCheckAndInsertPreventsNewRowTest = init.then(emptyRead(1, 1, 1, 1)).then(ban(1))
    .then(committed(1)).then(createdRead(1, true)).then(conflictBanRead(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "403" and s.insertions == 0 and invariant)
  run reinstatementBeforeConflictClassificationReturns409Test = init.then(emptyRead(1, 1, 1, 1)).then(ban(1))
    .then(committed(1)).then(createdRead(1, true)).then(reinstate(1)).then(conflictBanRead(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "409" and s.insertions == 0 and invariant)
  run retryAfterRefusedInsertCanCreateAfterReinstatementTest = init.then(emptyRead(1, 1, 1, 1)).then(ban(1))
    .then(committed(1)).then(createdRead(1, true)).then(conflictBanRead(1, true)).then(respond(1, true))
    .then(reinstate(1)).then(created(1, 1, 1, 1)).expect(s.requests.get(1).response == "201" and s.insertions == 1 and invariant)
  run laterBanDoesNotUndoCommittedRunTest = init.then(emptyRead(1, 1, 1, 1)).then(committed(1)).then(ban(1))
    .then(createdRead(1, true)).then(respond(1, true)).expect(s.requests.get(1).response == "201" and s.insertions == 1 and invariant)
  run replayCanReturnAfterBanFollowingInitialAdmissionTest = init.then(created(1, 1, 1, 1))
    .then(prepared(1, 1, 1, 1, 1)).then(ban(1)).then(readExisting(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "200" and s.insertions == 1 and invariant)
  run conflictingReplayRechecksLaterBanTest = init.then(created(1, 1, 1, 1))
    .then(prepared(1, 1, 1, 2, 1)).then(readExisting(1, true)).then(ban(1)).then(conflictBanRead(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "403" and s.insertions == 1 and invariant)
  run conflictBanReadFailurePreservesOriginalRowTest = init.then(created(1, 1, 1, 1))
    .then(prepared(1, 1, 1, 2, 1)).then(readExisting(1, true)).then(conflictBanRead(1, false)).then(respond(1, true))
    .expect(s.requests.get(1).response == "500" and s.rows.get(1).payload == 1 and invariant)
  run genericInsertFailureCanRetryTest = init.then(emptyRead(1, 1, 1, 1)).then(insertFailure(1)).then(respond(1, true))
    .then(created(1, 1, 1, 1)).expect(s.requests.get(1).response == "201" and s.insertions == 1 and invariant)
  run committedInsertLostResultRecoversByReplayTest = init.then(emptyRead(1, 1, 1, 1)).then(insert(1))
    .then(insertResult(1, false)).then(respond(1, true)).expect(s.insertions == 1 and s.requests.get(1).response == "500")
    .then(prepared(1, 1, 1, 1, 1)).then(readExisting(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "200" and s.requests.get(1).snapshotId == 1 and s.insertions == 1 and invariant)
  run failedByIdReadbackDoesNotUndoCommitTest = init.then(emptyRead(1, 1, 1, 1)).then(committed(1))
    .then(createdRead(1, false)).then(respond(1, true)).expect(s.requests.get(1).response == "500" and s.insertions == 1 and invariant)
  run lostSuccessResponseRecoversSameRunTest = init.then(emptyRead(1, 1, 1, 1)).then(committed(1)).then(createdRead(1, true))
    .then(respond(1, false)).then(prepared(1, 1, 1, 1, 1)).then(readExisting(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).priorResponse == "lost" and s.requests.get(1).response == "200" and s.insertions == 1 and invariant)
  run byIdReadbackCanObserveAdvancedRunStateTest = init.then(emptyRead(1, 1, 1, 1)).then(committed(1))
    .then(advanceRun(1, 1)).then(createdRead(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).response == "201" and s.requests.get(1).snapshotState == "trace_uploaded" and invariant)
  run responseRetainsStateCapturedBeforeLaterFinalizationTest = init.then(created(1, 1, 1, 1))
    .then(prepared(1, 1, 1, 1, 1)).then(readExisting(1, true)).then(advanceRun(1, 1)).then(advanceRun(1, 1)).then(respond(1, true))
    .expect(s.requests.get(1).snapshotState == "awaiting_trace" and s.rows.get(1).state == "finalized"
      and s.requests.get(1).response == "200" and invariant)
  run finalizedRunStillReplaysCreationTest = init.then(created(1, 1, 1, 1)).then(advanceRun(1, 1)).then(advanceRun(1, 1))
    .then(prepared(1, 1, 1, 1, 1)).then(readExisting(1, true)).then(respond(1, true))
    .expect(s.requests.get(1).snapshotState == "finalized" and s.requests.get(1).response == "200" and s.insertions == 1 and invariant)
  run pendingReadIsNotSuccessfulCreationTest = init.then(prepared(1, 1, 1, 1, 1))
    .expect(s.requests.get(1).phase == "lookup" and s.requests.get(1).response == "none" and s.insertions == 0 and invariant)
}
