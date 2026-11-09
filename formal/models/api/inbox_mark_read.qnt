// @source backend/notifications/handler.ts
// @source src/lib/notifications.ts
// @source migrations/0079_slopbot_scam_review_notifications.sql
// @evidence backend/notifications/notifications.test.ts
// @evidence backend/notifications/mark-read.workflow.mjs
// Four immutable rows, two actors and two mark attempts. Rows 1 and 4 have
// the same event key but different recipients. Row 2 needs moderator access;
// row 3 is the owner's Points-dispute receipt. Key 4 matches no row. The
// production 100-key limit is represented by a two-key limit plus a rejected
// input class; JSON/duplicate-key parsing is abstracted, not proved here.
module inbox_mark_read {
  val rows = Set(1, 2, 3, 4)
  val attempts = Set(1, 2)
  val keyChoices = Set(Set(), Set(1), Set(2), Set(3), Set(4), Set(1, 2), Set(1, 3), Set(1, 4), Set(2, 3), Set(1, 2, 3))
  def owner(row: int): int = if (row == 4) 2 else 1
  def key(row: int): int = if (row == 4) 1 else row
  def visible(row: int, actor: int, moderator: bool): bool = owner(row) == actor
    and (row != 2 or moderator)
  type Attempt = { phase: str, actor: int, moderator: bool, keys: Set[int],
    changed: Set[int], outcome: str, marked: int }
  val unused: Attempt = { phase: "unused", actor: 0, moderator: false, keys: Set(),
    changed: Set(), outcome: "none", marked: -1 }
  var s: { readAt: int -> int, requests: int -> Attempt, moderators: Set[int] }
  action init = s' = { readAt: rows.mapBy(_ => 0), requests: attempts.mapBy(_ => unused), moderators: Set(1) }
  action revoke(actor: int): bool = all { Set(1, 2).contains(actor),
    s' = s.with("moderators", s.moderators.filter(value => value != actor)) }
  action begin(id: int, actor: int, keyIds: Set[int]): bool = all {
    attempts.contains(id), s.requests.get(id).phase == "unused", Set(1, 2).contains(actor),
    keyIds.subseteq(Set(1, 2, 3, 4)),
    s' = s.with("requests", s.requests.set(id, unused.with("phase", "body")
      .with("actor", actor).with("moderator", s.moderators.contains(actor)).with("keys", keyIds))) }
  action rejectAdmission(id: int): bool = all {
    attempts.contains(id), s.requests.get(id).phase == "unused",
    s' = s.with("requests", s.requests.set(id, unused.with("phase", "done").with("outcome", "failure"))) }
  action validate(id: int, wellFormed: bool): bool = {
    val request = s.requests.get(id)
    val valid = wellFormed and request.keys.size() > 0 and request.keys.size() <= 2
    all { attempts.contains(id), request.phase == "body",
      s' = s.with("requests", s.requests.set(id, request.with("phase", if (valid) "prepared" else "done")
        .with("outcome", if (valid) "pending" else "failure"))) }
  }
  action commit(id: int): bool = {
    val request = s.requests.get(id)
    val changed = rows.filter(row => request.keys.contains(key(row))
      and visible(row, request.actor, request.moderator) and s.readAt.get(row) == 0)
    all { attempts.contains(id), request.phase == "prepared",
      s' = s.with("readAt", rows.mapBy(row => if (changed.contains(row)) id else s.readAt.get(row)))
        .with("requests", s.requests.set(id, request.with("phase", "committed").with("changed", changed))) }
  }
  action statementFailure(id: int): bool = {
    val request = s.requests.get(id)
    all { attempts.contains(id), request.phase == "prepared",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "done").with("outcome", "failure"))) }
  }
  action reply(id: int, successful: bool): bool = {
    val request = s.requests.get(id)
    all { attempts.contains(id), request.phase == "committed",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "done")
        .with("outcome", if (successful) "success" else "failure")
        .with("marked", if (successful) request.changed.size() else -1))) }
  }
  action step = {
    nondet id = attempts.oneOf()
    nondet actor = Set(1, 2).oneOf()
    nondet keyIds = keyChoices.oneOf()
    nondet ok = Set(false, true).oneOf()
    any { revoke(actor), begin(id, actor, keyIds), rejectAdmission(id), validate(id, ok), commit(id),
      statementFailure(id), reply(id, ok), s' = s }
  }
  val invariant = all {
    rows.forall(row => s.readAt.get(row) == 0 or attempts.exists(id =>
      s.readAt.get(row) == id and s.requests.get(id).changed.contains(row))),
    attempts.forall(id => {
      val request = s.requests.get(id)
      all {
        request.changed.forall(row => request.keys.contains(key(row))
          and visible(row, request.actor, request.moderator) and s.readAt.get(row) == id),
        request.outcome == "success" implies request.phase == "done" and request.marked == request.changed.size(),
        request.outcome != "success" implies request.marked == -1 }
    }),
    not(s.requests.get(1).changed.exists(row => s.requests.get(2).changed.contains(row))) }

  run ownUnreadRowMarksOnceTest = init.then(begin(1, 1, Set(1))).then(validate(1, true))
    .then(commit(1)).then(reply(1, true)).expect(s.readAt.get(1) == 1 and s.requests.get(1).marked == 1 and invariant)
  run replayDoesNotReplaceFirstReadTimestampTest = init.then(begin(1, 1, Set(1))).then(validate(1, true))
    .then(commit(1)).then(reply(1, true)).then(begin(2, 1, Set(1))).then(validate(2, true))
    .then(commit(2)).then(reply(2, true)).expect(s.readAt.get(1) == 1 and s.requests.get(2).marked == 0 and invariant)
  run concurrentReadMarksHaveOneWinnerTest = init.then(begin(1, 1, Set(1))).then(begin(2, 1, Set(1)))
    .then(validate(1, true)).then(validate(2, true)).then(commit(2)).then(commit(1)).then(reply(1, true)).then(reply(2, true))
    .expect(s.readAt.get(1) == 2 and s.requests.get(1).marked == 0 and s.requests.get(2).marked == 1 and invariant)
  run sharedEventKeyStaysRecipientScopedTest = init.then(begin(1, 1, Set(1))).then(validate(1, true))
    .then(commit(1)).then(reply(1, true)).expect(s.readAt.get(4) == 0)
    .then(begin(2, 2, Set(1))).then(validate(2, true)).then(commit(2)).then(reply(2, true))
    .expect(s.readAt.get(1) == 1 and s.readAt.get(4) == 2 and invariant)
  run foreignRecipientKeysChangeNothingTest = init.then(begin(1, 2, Set(2, 3))).then(validate(1, true))
    .then(commit(1)).then(reply(1, true)).expect(s.requests.get(1).marked == 0 and s.readAt.get(2) == 0 and invariant)
  run revokedModeratorCannotMarkHiddenReviewTest = init.then(revoke(1)).then(begin(1, 1, Set(2)))
    .then(validate(1, true)).then(commit(1)).then(reply(1, true))
    .expect(s.requests.get(1).marked == 0 and s.readAt.get(2) == 0 and invariant)
  run appellantReceiptRemainsMarkableWithoutRoleTest = init.then(revoke(1)).then(begin(1, 1, Set(2, 3)))
    .then(validate(1, true)).then(commit(1)).then(reply(1, true))
    .expect(s.requests.get(1).changed == Set(3) and s.readAt.get(2) == 0 and invariant)
  run currentMarkUsesCapturedRoleTest = init.then(begin(1, 1, Set(2))).then(revoke(1))
    .then(validate(1, true)).then(commit(1)).then(reply(1, true))
    .expect(s.requests.get(1).marked == 1 and s.readAt.get(2) == 1 and invariant)
  run mixedKnownAndMissingKeysCountOnlyChangesTest = init.then(begin(1, 1, Set(1, 4)))
    .then(validate(1, true)).then(commit(1)).then(reply(1, true))
    .expect(s.requests.get(1).marked == 1 and invariant)
  run emptyInputRefusesBeforeStatementTest = init.then(begin(1, 1, Set())).then(validate(1, true))
    .expect(s.requests.get(1).outcome == "failure" and s.readAt.get(1) == 0 and invariant)
  run overLimitInputRefusesBeforeStatementTest = init.then(begin(1, 1, Set(1, 2, 3))).then(validate(1, true))
    .expect(s.requests.get(1).outcome == "failure" and rows.forall(row => s.readAt.get(row) == 0) and invariant)
  run malformedOrDuplicateInputRefusesBeforeStatementTest = init.then(begin(1, 1, Set(1)))
    .then(validate(1, false)).expect(s.requests.get(1).outcome == "failure" and s.readAt.get(1) == 0 and invariant)
  run admissionFailureCreatesNoWriteTest = init.then(rejectAdmission(1))
    .expect(s.requests.get(1).changed == Set() and rows.forall(row => s.readAt.get(row) == 0) and invariant)
  run statementFailureRollsBackTheWholeMarkTest = init.then(begin(1, 1, Set(1, 2))).then(validate(1, true))
    .then(statementFailure(1)).expect(s.readAt.get(1) == 0 and s.readAt.get(2) == 0 and invariant)
  run failedReplyDoesNotUndoCommittedReadTest = init.then(begin(1, 1, Set(1))).then(validate(1, true))
    .then(commit(1)).then(reply(1, false))
    .expect(s.readAt.get(1) == 1 and s.requests.get(1).outcome == "failure" and invariant)
  run retryAfterLostReplyReportsZeroNewChangesTest = init.then(begin(1, 1, Set(1))).then(validate(1, true))
    .then(commit(1)).then(reply(1, false)).then(begin(2, 1, Set(1))).then(validate(2, true))
    .then(commit(2)).then(reply(2, true)).expect(s.readAt.get(1) == 1 and s.requests.get(2).marked == 0 and invariant)
  run twoKeyStatementCommitsTogetherTest = init.then(begin(1, 1, Set(1, 2))).then(validate(1, true))
    .then(commit(1)).then(reply(1, true))
    .expect(s.readAt.get(1) == 1 and s.readAt.get(2) == 1 and s.requests.get(1).marked == 2 and invariant)
}
