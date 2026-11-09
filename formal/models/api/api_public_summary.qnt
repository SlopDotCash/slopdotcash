// @source backend/slopbot/summary.ts
// @source migrations/0013_slopbot.sql
// @source migrations/0045_slopbot_review_leases.sql
// @source migrations/0048_slopbot_budget_blocks.sql
// @evidence backend/slopbot/summary.test.ts
// Two repositories, two item identities, two installations, three review rows,
// five action rows and three event-time classes. Review status/claim mutations
// are external input transitions, not a model of Slopbot admission. Row order
// and timestamps are independent: latest-row suppression uses SQLite rowid,
// while activity and close/reopen windows use retained timestamps.
// One atomic SQL statement supplies the captured projection. Later table writes
// do not rewrite that response. Failed-only repositories are public aggregates;
// running/skipped-only repositories and action-only repositories are absent.
// Counts disclose no review bodies, authors or item identities. Finite sets
// stand for the returned counts; response repository ordering is explicit.
module api_public_summary {
  val identities = Set(1, 2)
  type Review = { repo: int, item: int, installation: int, status: str, createdAt: int,
    completedAt: int, claim: int, blockedClaim: int, privateBody: int }
  type Event = { repo: int, item: int, kind: str, at: int }
  type Summary = { repo: int, installations: Set[int], reviewed: Set[int], blocked: Set[int],
    labeled: Set[int], closed: Set[int], reopened: Set[int], appealed: Set[int], lastActivity: int }
  type State = { reviews: List[Review], events: List[Event], phase: str, status: int,
    cache: str, capturedReviews: List[Review], capturedEvents: List[Event],
    answer: Set[Summary], order: List[int], delivered: bool }
  var s: State
  action init = s' = { reviews: List(), events: List(), phase: "idle", status: 0,
    cache: "none", capturedReviews: List(), capturedEvents: List(), answer: Set(), order: List(), delivered: false }
  pure def base(row: Review): bool = Set("completed", "failed").contains(row.status)
  pure def reviewedRows(rows: List[Review], repo: int): List[Review] = rows.select(row => row.repo == repo and base(row))
  pure def itemSet(rows: List[Review]): Set[int] = rows.foldl(Set(), (out, row) => out.union(Set(row.item)))
  pure def eventItems(events: List[Event], repo: int, kind: str): Set[int] =
    events.select(event => event.repo == repo and event.kind == kind).foldl(Set(), (out, event) => out.union(Set(event.item)))
  pure def firstClose(events: List[Event], repo: int, item: int): int = events.foldl(4, (earliest, event) =>
    if (event.repo == repo and event.item == item and event.kind == "close" and event.at < earliest) event.at else earliest)
  pure def afterClose(events: List[Event], repo: int, kind: str): Set[int] =
    events.select(event => event.repo == repo and event.kind == kind and event.at >= firstClose(events, repo, event.item))
      .foldl(Set(), (out, event) => out.union(Set(event.item)))
  pure def blockedItems(rows: List[Review], repo: int): Set[int] = rows.indices().fold(Set(), (out, i) => {
    val row = rows[i]
    val latest = rows.indices().forall(j => j <= i or rows[j].repo != row.repo or rows[j].item != row.item)
    if (row.repo == repo and row.status == "failed" and row.claim != 0 and row.claim == row.blockedClaim and latest)
      out.union(Set(row.item)) else out
  })
  pure def activity(rows: List[Review], events: List[Event], repo: int): int = {
    val at = reviewedRows(rows, repo).foldl(0, (latest, row) => {
      val time = if (row.completedAt == 0) row.createdAt else row.completedAt
      if (time > latest) time else latest
    })
    events.select(event => event.repo == repo).foldl(at, (latest, event) => if (event.at > latest) event.at else latest)
  }
  pure def summary(rows: List[Review], events: List[Event], repo: int): Summary = {
    repo: repo,
    installations: reviewedRows(rows, repo).foldl(Set(), (out, row) => out.union(Set(row.installation))),
    reviewed: itemSet(rows.select(row => row.repo == repo and row.status == "completed")),
    blocked: blockedItems(rows, repo), labeled: eventItems(events, repo, "label"),
    closed: eventItems(events, repo, "close"), reopened: afterClose(events, repo, "human_reopen"),
    appealed: afterClose(events, repo, "appeal"), lastActivity: activity(rows, events, repo)
  }
  pure def projected(rows: List[Review], events: List[Event]): Set[Summary] =
    identities.filter(repo => reviewedRows(rows, repo).length() > 0).map(repo => summary(rows, events, repo))
  pure def ordered(rows: List[Review]): List[int] =
    (if (reviewedRows(rows, 1).length() > 0) List(1) else List())
      .concat(if (reviewedRows(rows, 2).length() > 0) List(2) else List())
  action appendReview(repo: int, item: int, installation: int, status: str, at: int): bool = all {
    identities.contains(repo), identities.contains(item), identities.contains(installation), Set(1, 2, 3).contains(at),
    Set("running", "completed", "failed", "skipped").contains(status), s.reviews.length() < 3,
    s' = s.with("reviews", s.reviews.append({ repo: repo, item: item, installation: installation, status: status,
      createdAt: at, completedAt: if (Set("completed", "failed").contains(status)) at else 0,
      claim: 1, blockedClaim: 0, privateBody: 1 })) }
  action updateStatus(index: int, status: str, at: int): bool = if (not(s.reviews.indices().contains(index))) false else all {
    Set("running", "completed", "failed", "skipped").contains(status), Set(1, 2, 3).contains(at),
    s' = s.with("reviews", s.reviews.replaceAt(index, s.reviews[index].with("status", status)
      .with("completedAt", if (Set("completed", "failed").contains(status)) at else 0))) }
  action budgetBlock(index: int, at: int): bool = if (not(s.reviews.indices().contains(index))) false else all { s.reviews[index].status == "running",
    Set(1, 2, 3).contains(at), s' = s.with("reviews", s.reviews.replaceAt(index,
      s.reviews[index].with("status", "failed").with("completedAt", at).with("blockedClaim", s.reviews[index].claim))) }
  action rotateClaim(index: int): bool = if (not(s.reviews.indices().contains(index))) false else all { s.reviews[index].claim == 1,
    s' = s.with("reviews", s.reviews.replaceAt(index, s.reviews[index].with("claim", 2))) }
  action changePrivateBody(index: int): bool = if (not(s.reviews.indices().contains(index))) false else all {
    s' = s.with("reviews", s.reviews.replaceAt(index, s.reviews[index].with("privateBody", 2))) }
  action missingCompletedAt(index: int): bool = if (not(s.reviews.indices().contains(index))) false else
    s' = s.with("reviews", s.reviews.replaceAt(index, s.reviews[index].with("completedAt", 0)))
  action appendEvent(repo: int, item: int, kind: str, at: int): bool = all {
    identities.contains(repo), identities.contains(item), Set("label", "close", "appeal", "human_reopen", "comment").contains(kind),
    Set(1, 2, 3).contains(at), s.events.length() < 5,
    s' = s.with("events", s.events.append({ repo: repo, item: item, kind: kind, at: at })) }
  action request(route: bool, method: bool): bool = all { s.phase == "idle",
    s' = if (not(route)) s.with("phase", "reply").with("status", 404).with("cache", "public-60")
      else if (not(method)) s.with("phase", "reply").with("status", 405).with("cache", "public-60")
      else s.with("phase", "query") }
  action query = all { s.phase == "query", s' = s.with("phase", "parse")
    .with("capturedReviews", s.reviews).with("capturedEvents", s.events) }
  action render = all { s.phase == "parse", s' = s.with("phase", "reply").with("status", 200).with("cache", "public-60")
    .with("answer", projected(s.capturedReviews, s.capturedEvents)).with("order", ordered(s.capturedReviews)) }
  action unavailable = all { Set("query", "parse").contains(s.phase),
    s' = s.with("phase", "reply").with("status", 503).with("cache", "no-store") }
  action deliver(received: bool): bool = all { s.phase == "reply", s' = s.with("phase", "done").with("delivered", received) }
  action read = request(true, true).then(query).then(render).then(deliver(true))
  action step = {
    nondet repo = identities.oneOf()
    nondet item = identities.oneOf()
    nondet install = identities.oneOf()
    nondet at = Set(1, 2, 3).oneOf()
    nondet index = Set(0, 1, 2).oneOf()
    nondet status = Set("running", "completed", "failed", "skipped").oneOf()
    nondet kind = Set("label", "close", "appeal", "human_reopen", "comment").oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    any { appendReview(repo, item, install, status, at), updateStatus(index, status, at), budgetBlock(index, at), rotateClaim(index),
      changePrivateBody(index), missingCompletedAt(index), appendEvent(repo, item, kind, at), request(yes, other), query, render, unavailable, deliver(yes), s' = s }
  }
  val invariant = all { s.reviews.length() <= 3, s.events.length() <= 5,
    s.status == 200 implies s.answer == projected(s.capturedReviews, s.capturedEvents) and s.order == ordered(s.capturedReviews),
    s.status == 503 implies s.cache == "no-store" and s.answer == Set(),
    s.answer.forall(row => row.reopened.subseteq(row.closed) and row.appealed.subseteq(row.closed)
      and row.installations.size() > 0 and row.lastActivity > 0) }
  run duplicateItemCountsOnceTest = init.then(appendReview(1, 1, 1, "completed", 1)).then(appendReview(1, 1, 2, "completed", 2)).then(read)
    .expect(s.answer == Set({ repo: 1, installations: Set(1, 2), reviewed: Set(1), blocked: Set(), labeled: Set(), closed: Set(), reopened: Set(), appealed: Set(), lastActivity: 2 }) and invariant)
  run failureNotEmptySuccessTest = init.then(request(true, true)).then(unavailable).then(deliver(true))
    .expect(s.status == 503 and s.cache == "no-store" and invariant)
  run emptyDatabaseIsSuccessfulTest = init.then(read).expect(s.status == 200 and s.answer == Set() and invariant)
  run runningAndSkippedRepositoriesAreAbsentTest = init.then(appendReview(1, 1, 1, "running", 1))
    .then(appendReview(2, 1, 2, "skipped", 2)).then(read).expect(s.answer == Set() and invariant)
  run failedOnlyRepositoryIsPresentTest = init.then(appendReview(1, 1, 1, "failed", 1)).then(read)
    .expect(s.order == List(1) and s.answer.forall(row => row.reviewed == Set() and row.blocked == Set()) and invariant)
  run latestBudgetBlockCountsTest = init.then(appendReview(1, 1, 1, "running", 1)).then(budgetBlock(0, 2)).then(read)
    .expect(s.answer.forall(row => row.blocked == Set(1)) and invariant)
  run newerRunningRowSuppressesOldBlockTest = init.then(appendReview(1, 1, 1, "running", 1)).then(budgetBlock(0, 2))
    .then(appendReview(1, 1, 1, "running", 1)).then(read).expect(s.answer.forall(row => row.blocked == Set()) and invariant)
  run newerSkippedRowSuppressesOldBlockTest = init.then(appendReview(1, 1, 1, "running", 1)).then(budgetBlock(0, 2))
    .then(appendReview(1, 1, 1, "skipped", 1)).then(read).expect(s.answer.forall(row => row.blocked == Set()) and invariant)
  run differentClaimDoesNotMatchHistoricalBlockTest = init.then(appendReview(1, 1, 1, "running", 1)).then(budgetBlock(0, 2))
    .then(rotateClaim(0)).then(read).expect(s.answer.forall(row => row.blocked == Set()) and invariant)
  run ordinaryFailureIsNotBudgetBlockTest = init.then(appendReview(1, 1, 1, "failed", 1)).then(read)
    .expect(s.answer.forall(row => row.blocked == Set()) and invariant)
  run actionOnlyRepositoryIsAbsentTest = init.then(appendEvent(2, 1, "close", 3)).then(read).expect(s.answer == Set() and invariant)
  run repeatedLabelsAndClosuresCountOneItemTest = init.then(appendReview(1, 1, 1, "completed", 1))
    .then(appendEvent(1, 1, "label", 1)).then(appendEvent(1, 1, "label", 2))
    .then(appendEvent(1, 1, "close", 2)).then(appendEvent(1, 1, "close", 3)).then(read)
    .expect(s.answer.forall(row => row.labeled == Set(1) and row.closed == Set(1)) and invariant)
  run reopenBeforeFirstCloseDoesNotCountTest = init.then(appendReview(1, 1, 1, "completed", 1))
    .then(appendEvent(1, 1, "human_reopen", 1)).then(appendEvent(1, 1, "close", 2)).then(read)
    .expect(s.answer.forall(row => row.reopened == Set()) and invariant)
  run equalTimeAppealAndReopenCountTest = init.then(appendReview(1, 1, 1, "completed", 1))
    .then(appendEvent(1, 1, "close", 2)).then(appendEvent(1, 1, "human_reopen", 2)).then(appendEvent(1, 1, "appeal", 2)).then(read)
    .expect(s.answer.forall(row => row.reopened == Set(1) and row.appealed == Set(1)) and invariant)
  run earliestCloseDefinesWindowTest = init.then(appendReview(1, 1, 1, "completed", 1))
    .then(appendEvent(1, 1, "close", 3)).then(appendEvent(1, 1, "human_reopen", 2)).then(appendEvent(1, 1, "close", 1)).then(read)
    .expect(s.answer.forall(row => row.reopened == Set(1) and row.lastActivity == 3) and invariant)
  run unknownItemCommentUpdatesRepositoryActivityTest = init.then(appendReview(1, 1, 1, "completed", 1))
    .then(appendEvent(1, 2, "comment", 3)).then(read).expect(s.answer.forall(row => row.lastActivity == 3 and row.reviewed == Set(1)) and invariant)
  run missingCompletionUsesCreationTimeTest = init.then(appendReview(1, 1, 1, "completed", 2)).then(missingCompletedAt(0)).then(read)
    .expect(s.answer.forall(row => row.lastActivity == 2 and row.reviewed == Set(1)) and invariant)
  run numericRepositoryOrderIsStableTest = init.then(appendReview(2, 1, 2, "failed", 3)).then(appendReview(1, 1, 1, "completed", 1)).then(read)
    .expect(s.order == List(1, 2) and invariant)
  run capturedQueryDoesNotChangeWithLaterCompletionTest = init.then(appendReview(1, 1, 1, "running", 1))
    .then(request(true, true)).then(query).then(updateStatus(0, "completed", 2)).then(render).then(deliver(true))
    .expect(s.answer == Set() and invariant)
  run hiddenReviewBodyDoesNotEnterProjectionTest = init.then(appendReview(1, 1, 1, "completed", 1))
    .then(request(true, true)).then(query).then(changePrivateBody(0)).then(render)
    .expect(s.answer == projected(s.reviews, s.events) and invariant)
  run parsingFailureIsNotEmptySuccessTest = init.then(request(true, true)).then(query).then(unavailable)
    .expect(s.status == 503 and s.answer == Set() and invariant)
  run unsupportedMethodDoesNotReadDatabaseTest = init.then(request(true, false)).then(deliver(true))
    .expect(s.status == 405 and s.cache == "public-60" and s.capturedReviews == List() and invariant)
  run lostReplyDoesNotImplyConsumerObservationTest = init.then(request(true, true)).then(query).then(render).then(deliver(false))
    .expect(s.status == 200 and not(s.delivered) and invariant)
}
