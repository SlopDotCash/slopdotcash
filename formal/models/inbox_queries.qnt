// @source backend/notifications/handler.ts
// @source src/lib/notifications.ts
// @evidence backend/notifications/notifications.test.ts
// Five immutable rows, two actors, two sequential lists, page limit two plus
// one lookahead. Rank values stand for SQL TEXT order, not elapsed time or all
// Date.parse-accepted encodings. Row 2 is a moderator-only appeal; row 3 is its owner's
// Points-dispute receipt; row 5 belongs to actor 2. Page/count are independent.
module inbox_queries {
  val rows = Set(1, 2, 3, 4, 5)
  def owner(row: int): int = if (row == 5) 2 else 1
  def stamp(row: int): int = if (row == 4) 3 else if (row == 3) 1 else 2
  def before(left: int, right: int): bool = stamp(left) > stamp(right)
    or (stamp(left) == stamp(right) and left < right)
  def after(row: int, cursor: int): bool = cursor == 0 or stamp(row) < stamp(cursor)
    or (stamp(row) == stamp(cursor) and row > cursor)
  def visible(row: int, actor: int, moderator: bool): bool = owner(row) == actor
    and (row != 2 or moderator)
  def firstPage(eligible: Set[int]): Set[int] =
    eligible.filter(row => eligible.filter(other => before(other, row)).size() < 2)

  var s: { present: Set[int], read: Set[int], resolved: Set[int], moderators: Set[int],
    requests: int, result: str, actor: int, moderator: bool, cursor: int,
    pageDone: bool, countDone: bool, page: Set[int], pageRead: Set[int], pageResolved: Set[int],
    unread: int, next: int, pageQueries: int, countQueries: int }
  action init = s' = { present: Set(), read: Set(), resolved: Set(), moderators: Set(1),
    requests: 0, result: "idle", actor: 0, moderator: false, cursor: 0,
    pageDone: true, countDone: true, page: Set(), pageRead: Set(), pageResolved: Set(),
    unread: 0, next: 0, pageQueries: 0, countQueries: 0 }
  action insert(row: int): bool = all { rows.contains(row), not(s.present.contains(row)),
    s' = s.with("present", s.present.union(Set(row))) }
  // Other authorized requests may mark rows while this read is in flight.
  action mark(row: int): bool = all { s.present.contains(row),
    s' = s.with("read", s.read.union(Set(row))) }
  action resolveReview(row: int): bool = all { s.present.contains(row), Set(2, 3).contains(row),
    s' = s.with("resolved", s.resolved.union(Set(row))) }
  action revoke(actor: int): bool = all { Set(1, 2).contains(actor),
    s' = s.with("moderators", s.moderators.filter(value => value != actor)) }
  action begin(actor: int, cursor: int): bool = all {
    s.requests < 2, s.pageDone, s.countDone, Set("idle", "success", "failure").contains(s.result),
    Set(1, 2).contains(actor), Set(0, 1, 2, 3, 4, 5).contains(cursor),
    s' = s.with("requests", s.requests + 1).with("result", "pending")
      .with("actor", actor).with("moderator", s.moderators.contains(actor)).with("cursor", cursor)
      .with("pageDone", false).with("countDone", false).with("page", Set())
      .with("pageRead", Set()).with("pageResolved", Set()).with("unread", 0).with("next", 0) }
  action rejectInput = all {
    s.requests < 2, s.pageDone, s.countDone, Set("idle", "success", "failure").contains(s.result),
    s' = s.with("requests", s.requests + 1).with("result", "failure")
      .with("page", Set()).with("pageRead", Set()).with("pageResolved", Set()).with("next", 0) }
  action observePage(last: int): bool = {
    val eligible = s.present.filter(row => visible(row, s.actor, s.moderator) and after(row, s.cursor))
    val page = firstPage(eligible)
    val more = eligible.size() > 2
    all { Set("pending", "failure").contains(s.result), not(s.pageDone),
      if (more) page.contains(last) and page.forall(row => not(before(last, row))) else last == 0,
      s' = s.with("pageDone", true).with("pageQueries", s.pageQueries + 1)
        .with("page", page).with("pageRead", page.filter(row => s.read.contains(row)))
        .with("pageResolved", page.filter(row => s.resolved.contains(row))).with("next", last) }
  }
  action observeCount = all { Set("pending", "failure").contains(s.result), not(s.countDone),
    s' = s.with("countDone", true).with("countQueries", s.countQueries + 1)
      .with("unread", s.present.filter(row => visible(row, s.actor, s.moderator) and not(s.read.contains(row))).size()) }
  action failPage = all { Set("pending", "failure").contains(s.result), not(s.pageDone),
    s' = s.with("result", "failure").with("pageDone", true).with("pageQueries", s.pageQueries + 1) }
  action failCount = all { Set("pending", "failure").contains(s.result), not(s.countDone),
    s' = s.with("result", "failure").with("countDone", true).with("countQueries", s.countQueries + 1) }
  action finish = all { s.result == "pending", s.pageDone, s.countDone,
    s' = s.with("result", "success") }
  action step = {
    nondet row = rows.oneOf()
    nondet actor = Set(1, 2).oneOf()
    nondet cursor = Set(0, 1, 2, 3, 4, 5).oneOf()
    any { insert(row), mark(row), resolveReview(row), revoke(actor), begin(actor, cursor), rejectInput,
      observePage(cursor), observeCount, failPage, failCount, finish, s' = s }
  }
  val invariant = all {
    s.requests <= 2, s.pageQueries <= s.requests, s.countQueries <= s.requests,
    s.read.subseteq(s.present), s.resolved.subseteq(s.present), s.page.size() <= 2,
    s.pageRead.subseteq(s.page), s.pageResolved.subseteq(s.page),
    s.page.forall(row => visible(row, s.actor, s.moderator) and after(row, s.cursor)),
    s.next != 0 implies s.page.contains(s.next),
    s.result == "success" implies s.pageDone and s.countDone,
    s.unread >= 0, s.unread <= 5 }

  run textDescendingAndKeyAscendingPageTest = init.then(insert(1)).then(insert(2)).then(insert(3))
    .then(begin(1, 0)).then(observePage(2)).then(observeCount).then(finish)
    .expect(s.page == Set(1, 2) and s.next == 2 and s.unread == 3 and invariant)
  run newerInsertDoesNotShiftContinuationTest = init.then(insert(1)).then(insert(2)).then(insert(3))
    .then(begin(1, 0)).then(observePage(2)).then(observeCount).then(finish).then(insert(4))
    .then(begin(1, 2)).then(observePage(0)).then(observeCount).then(finish)
    .expect(s.page == Set(3) and s.unread == 4 and invariant)
  run laterOlderInsertCanEnterContinuationTest = init.then(insert(1)).then(insert(2)).then(insert(4))
    .then(begin(1, 0)).then(observePage(1)).then(observeCount).then(finish).then(insert(3))
    .then(begin(1, 1)).then(observePage(0)).then(observeCount).then(finish)
    .expect(s.page == Set(2, 3) and invariant)
  run cursorDoesNotRequireAnExistingRowTest = init.then(insert(1)).then(insert(3))
    .then(begin(1, 2)).then(observePage(0)).then(observeCount).then(finish)
    .expect(s.page == Set(3) and s.unread == 2 and invariant)
  run revokedRoleAndAppellantExceptionFilterBothQueriesTest = init.then(insert(1)).then(insert(2))
    .then(insert(3)).then(insert(5)).then(revoke(1)).then(begin(1, 0))
    .then(observePage(0)).then(observeCount).then(finish)
    .expect(s.page == Set(1, 3) and s.unread == 2 and invariant)
  run currentRequestRetainsCapturedRoleTest = init.then(insert(2)).then(begin(1, 0)).then(revoke(1))
    .then(observePage(0)).then(observeCount).then(finish)
    .expect(s.page == Set(2) and s.unread == 1 and invariant)
  run nextRequestSeesRevokedRoleTest = init.then(insert(2)).then(begin(1, 0)).then(revoke(1))
    .then(observePage(0)).then(observeCount).then(finish).then(begin(1, 0))
    .then(observePage(0)).then(observeCount).then(finish)
    .expect(s.page == Set() and s.unread == 0 and invariant)
  run eachActorReceivesOnlyOwnRowsTest = init.then(insert(1)).then(insert(5))
    .then(begin(1, 0)).then(observePage(0)).then(observeCount).then(finish)
    .expect(s.page == Set(1)).then(begin(2, 0)).then(observePage(0)).then(observeCount).then(finish)
    .expect(s.page == Set(5) and s.unread == 1 and invariant)
  run pageBeforeMarkCanContainUnreadRowsWithZeroCountTest = init.then(insert(1)).then(begin(1, 0))
    .then(observePage(0)).then(mark(1)).then(observeCount).then(finish)
    .expect(s.page == Set(1) and s.pageRead == Set() and s.unread == 0 and invariant)
  run countBeforeMarkCanOutliveReadRowStateTest = init.then(insert(1)).then(begin(1, 0))
    .then(observeCount).then(mark(1)).then(observePage(0)).then(finish)
    .expect(s.pageRead == Set(1) and s.unread == 1 and invariant)
  run emptyPageAndNonzeroCountCanCoexistTest = init.then(begin(1, 0)).then(observePage(0))
    .then(insert(1)).then(observeCount).then(finish)
    .expect(s.page == Set() and s.unread == 1 and invariant)
  run emptyOlderPageDoesNotMeanEmptyInboxTest = init.then(insert(1)).then(begin(1, 1))
    .then(observePage(0)).then(observeCount).then(finish)
    .expect(s.page == Set() and s.unread == 1 and s.next == 0 and invariant)
  run pageFailureCannotPublishSuccessfulCountTest = init.then(insert(1)).then(begin(1, 0))
    .then(failPage).then(observeCount).expect(s.result == "failure" and s.unread == 1 and invariant)
    .then(finish.fail())
  run countFailureCannotPublishSuccessfulPageTest = init.then(insert(1)).then(begin(1, 0))
    .then(observePage(0)).then(failCount).expect(s.result == "failure" and s.page == Set(1) and invariant)
    .then(finish.fail())
  run rejectedInputDoesNotIssueQueriesTest = init.then(rejectInput)
    .expect(s.result == "failure" and s.pageQueries == 0 and s.countQueries == 0 and invariant)
  run resolvedKindDoesNotEscapeStoredRoleRestrictionTest = init.then(insert(2)).then(resolveReview(2))
    .then(revoke(1)).then(begin(1, 0)).then(observePage(0)).then(observeCount).then(finish)
    .expect(s.page == Set() and s.unread == 0 and invariant)
  run resolutionProjectionUsesPageObservationTest = init.then(insert(2)).then(begin(1, 0))
    .then(observePage(0)).then(resolveReview(2)).then(observeCount).then(finish)
    .expect(s.pageResolved == Set()).then(begin(1, 0)).then(observePage(0)).then(observeCount).then(finish)
    .expect(s.pageResolved == Set(2) and invariant)
  run queryRetryAfterFailureUsesFreshObservationsTest = init.then(begin(1, 0)).then(failPage).then(observeCount)
    .then(insert(1)).then(begin(1, 0)).then(observePage(0)).then(observeCount).then(finish)
    .expect(s.result == "success" and s.page == Set(1) and invariant)
}
