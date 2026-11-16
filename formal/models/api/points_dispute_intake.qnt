// @source backend/points/disputes.ts
// @source backend/notifications/events.ts
// @source migrations/0114_points_dispute_intake.sql
// One retained Points revision, one optional successor and two intake requests.
// The SQL batch is atomic. Identity, revision digest and body grammar are classes.
// Admission: 0 invalid body, 1 corrupt source, 2 foreign recipient, 3 own source.
// Source-authored scenarios are unexecuted.
module points_dispute_intake {
  pure val requests = Set(1, 2)
  var s: { current: bool, exists: bool, statement: int, firstStatement: int,
    retainedRevision: int, openedNotice: bool, used: Set[int], pending: Set[int],
    requested: int -> int, response: int -> str, awards: int, payments: int }
  action init = s' = { current: true, exists: false, statement: 0, firstStatement: 0,
    retainedRevision: 0, openedNotice: false, used: Set(), pending: Set(),
    requested: requests.mapBy(_ => 0), response: requests.mapBy(_ => "none"),
    awards: 1, payments: 0 }
  action prepare(id: int, admission: int, statement: int): bool = all {
    not(s.used.contains(id)), admission >= 0, admission <= 3,
    statement >= 1, statement <= 2,
    s' = s.with("used", s.used.union(Set(id)))
      .with("requested", s.requested.set(id, statement))
      .with("pending", if(admission == 3) s.pending.union(Set(id)) else s.pending)
      .with("response", s.response.set(id, if(admission == 0) "invalid"
        else if(admission == 1) "error" else if(admission == 2) "forbidden" else "pending")) }
  action successor = all { s.current, s' = s.with("current", false) }
  action commit(id: int, databaseWorks: bool): bool = all {
    s.pending.contains(id),
    val create = databaseWorks and not(s.exists) and s.current
    val retained = s.exists or create
    val statement = if(create) s.requested.get(id) else s.statement
    val result = if(not(databaseWorks)) "error" else if(not(retained)) "superseded"
      else if(statement == s.requested.get(id)) "created" else "already_submitted"
    s' = s.with("exists", retained).with("statement", statement)
      .with("firstStatement", if(create) statement else s.firstStatement)
      .with("retainedRevision", if(create) 1 else s.retainedRevision)
      .with("openedNotice", s.openedNotice or create)
      .with("pending", s.pending.exclude(Set(id))).with("response", s.response.set(id, result)) }
  action step = {
    nondet id = requests.oneOf()
    nondet admission = Set(0, 1, 2, 3).oneOf()
    nondet statement = Set(1, 2).oneOf()
    nondet databaseWorks = Set(false, true).oneOf()
    any { prepare(id, admission, statement), successor, commit(id, databaseWorks), s' = s }
  }
  val invariant = all {
    s.statement == s.firstStatement, s.exists == s.openedNotice,
    s.exists == (s.statement > 0), s.exists == (s.retainedRevision == 1),
    s.pending.subseteq(s.used), s.awards == 1, s.payments == 0,
    requests.forall(id => s.response.get(id) == "created" implies s.exists) }
  run recipientOpensRetainedRevisionTest = init.then(prepare(1, 3, 1)).then(commit(1, true))
    .expect(s.response.get(1) == "created" and s.retainedRevision == 1 and s.openedNotice)
  run malformedBodyDoesNotWriteTest = init.then(prepare(1, 0, 1))
    .expect(s.response.get(1) == "invalid" and not(s.exists))
  run corruptRetainedSourceDoesNotWriteTest = init.then(prepare(1, 1, 1))
    .expect(s.response.get(1) == "error" and not(s.exists))
  run anotherRecipientCannotOpenTest = init.then(prepare(1, 2, 1))
    .expect(s.response.get(1) == "forbidden" and not(s.exists))
  run correctionBeforePrepareRefusesTest = init.then(successor).then(prepare(1, 3, 1)).then(commit(1, true))
    .expect(s.response.get(1) == "superseded" and not(s.openedNotice))
  run correctionBetweenReadAndInsertRefusesTest = init.then(prepare(1, 3, 1)).then(successor).then(commit(1, true))
    .expect(s.response.get(1) == "superseded" and not(s.exists))
  run identicalRetryKeepsFirstStatementTest = init.then(prepare(1, 3, 1)).then(commit(1, true))
    .then(prepare(2, 3, 1)).then(commit(2, true)).expect(s.response.get(2) == "created" and s.statement == 1)
  run retryAfterCorrectionRecoversOldDisputeTest = init.then(prepare(1, 3, 1)).then(commit(1, true))
    .then(successor).then(prepare(2, 3, 1)).then(commit(2, true))
    .expect(s.response.get(2) == "created" and s.retainedRevision == 1)
  run changedReasonCannotReplaceStatementTest = init.then(prepare(1, 3, 1)).then(commit(1, true))
    .then(prepare(2, 3, 2)).then(commit(2, true))
    .expect(s.response.get(2) == "already_submitted" and s.statement == 1)
  run concurrentRequestsKeepFirstCommitTest = init.then(prepare(1, 3, 1)).then(prepare(2, 3, 2))
    .then(commit(2, true)).then(commit(1, true))
    .expect(s.response.get(1) == "already_submitted" and s.statement == 2)
  run failedBatchDoesNotPublishNotificationTest = init.then(prepare(1, 3, 1)).then(commit(1, false))
    .expect(s.response.get(1) == "error" and not(s.exists) and not(s.openedNotice))
  run retryAfterFailedBatchCanCreateTest = init.then(prepare(1, 3, 1)).then(commit(1, false))
    .then(prepare(2, 3, 1)).then(commit(2, true))
    .expect(s.response.get(2) == "created" and s.openedNotice and s.awards == 1 and s.payments == 0)
}
