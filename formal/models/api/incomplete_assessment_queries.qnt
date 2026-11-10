// @source backend/notifications/incomplete-assessments.ts
// @source backend/notifications/handler.ts
// @source workers/slopbot/value-processing.ts
// @source migrations/0115_incomplete_value_inbox.sql
// @evidence backend/notifications/incomplete-assessments.test.ts
// @evidence backend/notifications/incomplete-assessments.workflow.mjs
// One project/repository, three PRs and four delivery rows (two for PR 1).
// Worker actions below are committed input observations, not lease admission.
// api_incomplete_assessments retains the simpler worker-gap projection;
// inbox_queries/inbox_mark_read retain ordinary-list and mark-write details.
// Verification reductions apply to step only; direct actions and scenarios keep
// the exact behavior (the *As actions with exact = true). Reviewed reasoning:
// (1) Each branch draws only the choices its action reads.
// (2) One request: begin resets every request field and no world action reads
// a request field, so a second request reaches the same request states from
// the same worlds; only requestCount differs, read solely by begin's bound and
// the requestCount <= 2 conjunct. Scenarios still run two requests.
// (3) Read-time choices: step draws actor and permission in observeAccessAs,
// cursor in observeRowsAs and bundled at a failure, their only later readers
// (items are empty before observeRows; success never reads bundled). The
// stored permission and the write-only ordinaryRead keep their initial values.
// Representatives: denied for denied/private and unavailable for the three
// identical outage classes; begin uses one admitted, one 401 and one 403 call.
// (4) With one request, rows and the clock are unread after observeRows and
// nothing is read after a response, so settle resets them; the world-only
// conjuncts were already checked in the predecessor state.
// (5) Canonical rows: updated is read only for a completed resolving sibling
// of PR 1; retry feeds only the response retry map, which no conjunct reads;
// the gap of the single-delivery PRs 2 and 3 matters only as gap >= 0. Values
// within the invariant bounds map to one representative and others are kept,
// so every conjunct keeps its truth value. (6) Deliveries 1 and 2 are
// interchangeable siblings; step stores them in code order.
module incomplete_assessment_queries {
  val deliveries = Set(1, 2, 3, 4)
  val prs = Set(1, 2, 3)
  def pullRequest(id: int): int = if (id <= 2) 1 else id - 1
  type Delivery = { exists: bool, gap: int, retry: int, phase: str,
    resolving: bool, updated: int }
  val absent: Delivery = { exists: false, gap: -1, retry: -1,
    phase: "absent", resolving: false, updated: 0 }
  val missingTimes = prs.mapBy(_ => -1)
  type State = { rows: int -> Delivery, now: int, manifest: int, binding: bool,
    permission: str, requestCount: int, phase: str, actor: int, bundled: bool,
    cursor: int, capturedManifest: int, capturedBinding: bool, contexts: bool,
    allowed: bool, queue: str, status: int, ordinaryNotice: bool,
    ordinaryRead: bool, items: Set[int], eligibleSnapshot: Set[int],
    since: int -> int, retry: int -> int, running: Set[int], nextCursor: int,
    publishedManifest: int }
  var s: State
  action init = s' = { rows: deliveries.mapBy(_ => absent), now: 0,
    manifest: 1, binding: true, permission: "allowed", requestCount: 0,
    phase: "idle", actor: 0, bundled: false, cursor: 0, capturedManifest: 0,
    capturedBinding: false, contexts: false, allowed: false, queue: "none",
    status: 0, ordinaryNotice: false, ordinaryRead: false, items: Set(),
    eligibleSnapshot: Set(), since: missingTimes, retry: missingTimes,
    running: Set(), nextCursor: 0, publishedManifest: 0 }
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1) }
  // These represent individual retained rows. A different delivery may be a
  // later input or an exhausted sibling which a finish does not rewrite.
  // Verification canonical form, used only by step (exact = false); see header.
  def stored(id: int, row: Delivery, exact: bool): Delivery = if (exact) row else row
    .with("updated", if (pullRequest(id) == 1 and row.phase == "completed" and row.resolving) row.updated else 0)
    .with("retry", if (row.retry >= 0 and row.retry <= 4) 0 else row.retry)
    .with("gap", if (pullRequest(id) != 1 and row.gap >= 0 and row.gap <= 3) 0 else row.gap)
  def code(row: Delivery): int = {
    val phase = if (row.phase == "absent") 0 else if (row.phase == "waiting") 1 else if (row.phase == "running") 2 else 3
    ((((phase * 2 + (if (row.resolving) 1 else 0)) * 6 + row.gap + 1) * 7 + row.retry + 1) * 5) + row.updated
  }
  // Deliveries 1 and 2 are interchangeable siblings; step stores them in code order.
  def place(id: int, row: Delivery, exact: bool): int -> Delivery = {
    val rows = s.rows.set(id, stored(id, row, exact))
    if (exact or code(rows.get(1)) <= code(rows.get(2))) rows
    else rows.set(1, rows.get(2)).set(2, rows.get(1))
  }
  action recordGapAs(id: int, exact: bool): bool = {
    val row = s.rows.get(id)
    all { deliveries.contains(id), Set("absent", "waiting", "running").contains(row.phase),
      s' = s.with("rows", place(id, { exists: true,
        gap: if (row.gap < 0) s.now else row.gap, retry: s.now + 1,
        phase: "waiting", resolving: false, updated: s.now }, exact)) }
  }
  action recordGap(id: int): bool = recordGapAs(id, true)
  action recordRunningAs(id: int, exact: bool): bool = {
    val row = s.rows.get(id)
    all { deliveries.contains(id), row.exists, row.phase == "waiting",
      s' = s.with("rows", place(id,
        row.with("phase", "running").with("retry", -1).with("updated", s.now), exact)) }
  }
  action recordRunning(id: int): bool = recordRunningAs(id, true)
  action recordCompletionAs(id: int, resolves: bool, exact: bool): bool = {
    val row = s.rows.get(id)
    all { deliveries.contains(id), row.exists, row.phase == "running",
      s' = s.with("rows", place(id, row.with("phase", "completed")
        .with("gap", if (resolves) -1 else row.gap).with("retry", -1)
        .with("resolving", resolves).with("updated", s.now), exact)) }
  }
  action recordCompletion(id: int, resolves: bool): bool = recordCompletionAs(id, resolves, true)
  // Exact manifest bytes, not merely status or a newer timestamp, are compared.
  action changeManifest(mapped: bool): bool = all { s.manifest == 1,
    s' = s.with("manifest", 2).with("binding", mapped) }
  action permission(value: str): bool = all {
    Set("allowed", "denied", "private", "unavailable", "missing", "replaced").contains(value),
    s' = s.with("permission", value) }
  def unresolvedRows(pr: int): Set[int] = deliveries.filter(id => {
    val row = s.rows.get(id)
    all { pullRequest(id) == pr, row.exists, row.gap >= 0,
      not(deliveries.exists(other => {
        val completed = s.rows.get(other)
        all { pullRequest(other) == pr, completed.exists,
          completed.phase == "completed", completed.resolving,
          completed.updated >= row.gap }
      })) }
  })
  val grouped = prs.filter(pr => unresolvedRows(pr).size() > 0)
  def minimum(values: Set[int]): int =
    if (values.size() == 0) -1 else values.fold(4, (low, value) => if (value < low) value else low)
  // bundled is a parameter so that step can choose it at a failure, its only
  // later read; failed reads the stored value. Only admitted requests reach a
  // failure, so ordinaryNotice already equals the stored bundled flag there.
  def failedAs(code: int, bundled: bool): State = s.with("phase", "done")
    .with("bundled", bundled).with("ordinaryNotice", s.ordinaryNotice or bundled)
    .with("queue", if (bundled) "unavailable" else "none")
    .with("status", if (bundled) 200 else code)
    .with("items", Set()).with("running", Set()).with("nextCursor", 0)
    .with("since", missingTimes).with("retry", missingTimes)
  def failed(code: int): State = failedAs(code, s.bundled)
  // Verification only (exact = false): with one request, rows and the clock
  // are not read after observeRows, and nothing is read after a response.
  def settle(result: State, exact: bool): State =
    if (exact or not(Set("manifest", "done").contains(result.phase))) result
    else {
      val discarded = result.with("rows", deliveries.mapBy(_ => absent)).with("now", 0)
      if (result.phase == "done") discarded.with("manifest", 1).with("binding", true) else discarded
    }
  // Actors: 1=current maintainer, 2=unrelated actor, 3=configured admin,
  // 0=signed out. Expected actor 0 is an absent legacy-compatible header.
  // Bundled begins after the ordinary page/count reads succeeded; their own
  // failure behavior is modeled by inbox_queries, not swallowed here.
  action beginAs(actor: int, expected: int, bundled: bool, cursor: int, exact: bool): bool = {
    val admitted = actor != 0 and (expected == 0 or actor == expected)
    all { Set("idle", "done").contains(s.phase), s.requestCount < 2,
      Set(0, 1, 2, 3).contains(actor), Set(0, 1, 2, 3).contains(expected),
      Set(0, 1, 2, 3).contains(cursor),
      s' = settle(s.with("requestCount", s.requestCount + 1).with("actor", actor)
        .with("bundled", bundled).with("cursor", cursor)
        .with("phase", if (admitted) "cursor" else "done")
        .with("queue", "none").with("status", if (admitted) 0 else if (actor == 0) 401 else 403)
        .with("ordinaryNotice", admitted and bundled).with("allowed", false)
        .with("contexts", false).with("capturedManifest", 0).with("capturedBinding", false)
        .with("items", Set()).with("eligibleSnapshot", Set()).with("since", missingTimes)
        .with("retry", missingTimes).with("running", Set()).with("nextCursor", 0)
        .with("publishedManifest", 0), exact) }
  }
  action begin(actor: int, expected: int, bundled: bool, cursor: int): bool =
    beginAs(actor, expected, bundled, cursor, true)
  action validateCursorAs(valid: bool, bundled: bool, exact: bool): bool = all { s.phase == "cursor",
    s' = settle(if (valid) s.with("phase", "contexts") else failedAs(400, bundled), exact) }
  action validateCursor(valid: bool): bool = validateCursorAs(valid, s.bundled, true)
  action observeContexts = all { s.phase == "contexts",
    s' = s.with("contexts", grouped.size() > 0).with("capturedManifest", s.manifest)
      .with("capturedBinding", s.binding).with("phase", "access") }
  // actor and permission are parameters so that step can choose them here, at
  // their only read; observeAccess reads the stored values.
  action observeAccessAs(actor: int, permission: str, bundled: bool, exact: bool): bool = {
    val needsRemote = s.contexts and s.capturedBinding and actor != 3
    val error = needsRemote and Set("unavailable", "missing", "replaced").contains(permission)
    val allowed = s.contexts and s.capturedBinding
      and (actor == 3 or (actor == 1 and permission == "allowed"))
    all { s.phase == "access",
      s' = settle(if (error) failedAs(503, bundled) else s.with("allowed", allowed).with("phase", "rows"), exact) }
  }
  action observeAccess = observeAccessAs(s.actor, s.permission, s.bundled, true)
  // cursor is a parameter so that step can choose it here, at its only read.
  action observeRowsAs(cursor: int, exact: bool): bool = {
    val eligible = if (s.allowed) grouped.filter(pr => pr > cursor) else Set()
    val page = eligible.filter(pr => eligible.filter(other => other < pr).size() < 2)
    val nextCursor = if (eligible.size() > 2) page.fold(0, (high, pr) => if (pr > high) pr else high) else 0
    all { s.phase == "rows",
      s' = settle(s.with("cursor", cursor).with("eligibleSnapshot", eligible).with("items", page)
        .with("since", prs.mapBy(pr => if (page.contains(pr))
          minimum(unresolvedRows(pr).map(id => s.rows.get(id).gap)) else -1))
        .with("retry", prs.mapBy(pr => if (page.contains(pr))
          minimum(unresolvedRows(pr).map(id => s.rows.get(id).retry).filter(value => value >= 0)) else -1))
        .with("running", page.filter(pr => deliveries.exists(id =>
          pullRequest(id) == pr and s.rows.get(id).exists and s.rows.get(id).phase == "running")))
        .with("nextCursor", nextCursor).with("phase", "manifest"), exact) }
  }
  action observeRows = observeRowsAs(s.cursor, true)
  // There is no continuous role/session freshness promise. Only the stored
  // manifest is reread here, and only for an admitted repository scope.
  action publishAs(bundled: bool, exact: bool): bool = all { s.phase == "manifest",
    s' = settle(if (s.allowed and s.manifest != s.capturedManifest) failedAs(503, bundled)
      else s.with("phase", "done").with("queue", "ready").with("status", 200)
        .with("publishedManifest", s.manifest), exact) }
  action publish = publishAs(s.bundled, true)
  action readFailureAs(bundled: bool, exact: bool): bool = all { Set("contexts", "rows", "manifest").contains(s.phase),
    s' = settle(failedAs(500, bundled), exact) }
  action readFailure = readFailureAs(s.bundled, true)
  // A mark-read write affects ordinary notices, not live assessment rows.
  action markOrdinaryRead = s' = s.with("ordinaryRead", true)
  // Verification relation; the header states each reduction.
  action step = any {
    all { s.phase != "manifest", s.phase != "done", any {
      tick,
      { nondet id = deliveries.oneOf() any { recordGapAs(id, false), recordRunningAs(id, false) } },
      { nondet id = deliveries.oneOf() nondet yes = Set(false, true).oneOf() recordCompletionAs(id, yes, false) } } },
    all { s.phase != "done", any { { nondet yes = Set(false, true).oneOf() changeManifest(yes) } } },
    all { s.requestCount == 0, any { beginAs(1, 0, false, 0, false), beginAs(0, 0, false, 0, false),
      beginAs(2, 1, false, 0, false) } },
    { nondet yes = Set(false, true).oneOf() nondet bundled = Set(false, true).oneOf()
      validateCursorAs(yes, bundled, false) },
    observeContexts,
    { nondet actor = Set(1, 2, 3).oneOf() nondet permission = Set("allowed", "denied", "unavailable").oneOf()
      nondet bundled = Set(false, true).oneOf() observeAccessAs(actor, permission, bundled, false) },
    { nondet cursor = Set(0, 1, 2, 3).oneOf() observeRowsAs(cursor, false) },
    { nondet bundled = Set(false, true).oneOf() any { publishAs(bundled, false), readFailureAs(bundled, false) } },
    s' = s }
  val invariant = all {
    s.requestCount <= 2, s.items.size() <= 2, s.items.subseteq(s.eligibleSnapshot),
    s.items.forall(pr => pr > s.cursor and s.since.get(pr) >= 0),
    s.running.subseteq(s.items),
    s.nextCursor != 0 implies s.items.contains(s.nextCursor),
    s.queue == "ready" and s.items.size() > 0 implies s.allowed and s.capturedBinding,
    s.queue == "ready" and s.allowed implies s.publishedManifest == s.capturedManifest,
    s.queue == "unavailable" implies s.bundled and s.status == 200
      and s.ordinaryNotice and s.items.size() == 0,
    s.phase == "done" and s.status == 200 implies Set("ready", "unavailable").contains(s.queue),
    s.status == 401 or s.status == 403 implies not(s.ordinaryNotice),
    deliveries.forall(id => {
      val row = s.rows.get(id)
      all { row.gap >= -1, row.gap <= 3, row.retry >= -1, row.retry <= 4,
        row.resolving implies row.phase == "completed" and row.gap == -1 }
    }) }
  // These macros represent sequential await completion, not atomic SQL.
  action query = validateCursor(true).then(observeContexts).then(observeAccess).then(observeRows).then(publish)
  run oneGroupForTwoDeliveriesTest = init.then(recordGap(1)).then(tick).then(recordGap(2))
    .then(begin(1, 1, false, 0)).then(query)
    .expect(s.items == Set(1) and s.since.get(1) == 0 and s.retry.get(1) == 1 and invariant)
  run runningSiblingKeepsEarliestWaitingRetryTest = init.then(recordGap(1)).then(recordRunning(1))
    .then(tick).then(recordGap(2)).then(begin(1, 1, false, 0)).then(query)
    .expect(s.running == Set(1) and s.since.get(1) == 0 and s.retry.get(1) == 2 and invariant)
  run exhaustedGapRemainsVisibleTest = init.then(recordGap(1)).then(recordRunning(1))
    .then(recordCompletion(1, false)).then(begin(1, 1, false, 0)).then(query)
    .expect(s.items == Set(1) and s.retry.get(1) == -1 and invariant)
  run resolvingSiblingHidesOlderExhaustedGapTest = init.then(recordGap(1)).then(recordRunning(1))
    .then(recordCompletion(1, false)).then(tick).then(recordGap(2)).then(recordRunning(2))
    .then(recordCompletion(2, true)).then(begin(1, 1, false, 0)).then(query)
    .expect(s.items == Set() and s.rows.get(1).gap == 0 and invariant)
  run equalTimestampCompletionHidesGapTest = init.then(recordGap(1)).then(recordGap(2))
    .then(recordRunning(2)).then(recordCompletion(2, true)).then(begin(1, 1, false, 0)).then(query)
    .expect(s.items == Set() and invariant)
  run gapNewerThanCompletionReturnsTest = init.then(recordGap(1)).then(recordRunning(1))
    .then(recordCompletion(1, true)).then(tick).then(recordGap(2))
    .then(begin(1, 1, false, 0)).then(query).expect(s.items == Set(1) and s.since.get(1) == 1 and invariant)
  run markReadDoesNotResolveAssessmentTest = init.then(recordGap(1)).then(markOrdinaryRead)
    .then(begin(1, 1, true, 0)).then(query).expect(s.ordinaryRead and s.items == Set(1) and invariant)
  run unrelatedActorGetsVerifiedEmptyQueueTest = init.then(recordGap(1))
    .then(begin(2, 2, false, 0)).then(query).expect(s.status == 200 and s.queue == "ready" and s.items == Set() and invariant)
  run deniedMaintainerGetsVerifiedEmptyQueueTest = init.then(recordGap(1)).then(permission("denied"))
    .then(begin(1, 1, false, 0)).then(query).expect(s.queue == "ready" and s.items == Set() and invariant)
  run adminBypassesRemoteOutageTest = init.then(recordGap(1)).then(permission("unavailable"))
    .then(begin(3, 3, false, 0)).then(query).expect(s.items == Set(1) and invariant)
  run directAuthorityOutageIsNotEmptyTest = init.then(recordGap(1)).then(permission("unavailable"))
    .then(begin(1, 1, false, 0)).then(validateCursor(true)).then(observeContexts).then(observeAccess)
    .expect(s.status == 503 and s.queue == "none" and invariant)
  run bundledAuthorityOutageKeepsOrdinaryNoticeTest = init.then(recordGap(1)).then(permission("unavailable"))
    .then(begin(1, 1, true, 0)).then(validateCursor(true)).then(observeContexts).then(observeAccess)
    .expect(s.status == 200 and s.queue == "unavailable" and s.ordinaryNotice and invariant)
  run missingInstallationIsUnavailableTest = init.then(recordGap(1)).then(permission("missing"))
    .then(begin(1, 1, false, 0)).then(validateCursor(true)).then(observeContexts).then(observeAccess)
    .expect(s.status == 503 and invariant)
  run changedRepositoryIdentityIsUnavailableTest = init.then(recordGap(1)).then(permission("replaced"))
    .then(begin(1, 1, false, 0)).then(validateCursor(true)).then(observeContexts).then(observeAccess)
    .expect(s.status == 503 and invariant)
  run manifestChangeAfterAccessRefusesQueueTest = init.then(recordGap(1)).then(begin(1, 1, false, 0))
    .then(validateCursor(true)).then(observeContexts).then(observeAccess).then(changeManifest(true))
    .then(observeRows).then(publish).expect(s.status == 503 and s.items == Set() and invariant)
  run bundledManifestChangeKeepsOrdinaryNoticeTest = init.then(recordGap(1)).then(begin(1, 1, true, 0))
    .then(validateCursor(true)).then(observeContexts).then(observeAccess).then(observeRows)
    .then(changeManifest(true)).then(publish)
    .expect(s.queue == "unavailable" and s.ordinaryNotice and invariant)
  run observedPermissionDoesNotPromiseContinuousAuthorityTest = init.then(recordGap(1))
    .then(begin(1, 1, false, 0)).then(validateCursor(true)).then(observeContexts).then(observeAccess)
    .then(permission("denied")).then(observeRows).then(publish).expect(s.items == Set(1) and invariant)
  run completionAfterRowsDoesNotRewriteSnapshotTest = init.then(recordGap(1)).then(recordRunning(1))
    .then(begin(1, 1, false, 0)).then(validateCursor(true)).then(observeContexts).then(observeAccess)
    .then(observeRows).then(recordCompletion(1, true)).then(publish)
    .expect(s.items == Set(1) and s.running == Set(1) and grouped == Set() and invariant)
  run numericContinuationVisitsRemainingPrTest = init.then(recordGap(1)).then(recordGap(3)).then(recordGap(4))
    .then(begin(1, 1, false, 0)).then(query).expect(s.items == Set(1, 2) and s.nextCursor == 2)
    .then(begin(1, 1, false, 2)).then(query).expect(s.items == Set(3) and s.nextCursor == 0 and invariant)
  run malformedCursorIsUnavailableOnlyForBundledQueueTest = init.then(begin(1, 1, true, 0))
    .then(validateCursor(false)).expect(s.queue == "unavailable" and s.ordinaryNotice and invariant)
  run expectedActorMismatchRefusesWholeRequestTest = init.then(recordGap(1)).then(begin(2, 1, true, 0))
    .expect(s.status == 403 and s.queue == "none" and not(s.ordinaryNotice) and invariant)
  run signedOutRequestRefusesBeforeQueueTest = init.then(begin(0, 0, true, 0))
    .expect(s.status == 401 and s.phase == "done" and invariant)
  run rowReadFailureDoesNotPublishEmptyQueueTest = init.then(recordGap(1)).then(begin(1, 1, false, 0))
    .then(validateCursor(true)).then(observeContexts).then(observeAccess).then(readFailure)
    .expect(s.status == 500 and s.queue == "none" and invariant)
}
