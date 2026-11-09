// @source workers/slopbot/persistence.ts
// @source workers/slopbot/contracts.ts
// @source workers/slopbot/review.ts
// @source migrations/0117_slopbot_close_attempts.sql
// One new author, two items and two earlier completed reviews in one rolling
// day. Lease expiry is not completion. A pending external close keeps capacity
// after failure; only a positive GitHub prior-merge observation bypasses cap3.
module bot_author_admission {
  var s: {status: List[str], pendingClose: Set[int], uncertain: Set[int], expired: Set[int], established: bool}
  action init = s' = {status: List("absent", "absent"), pendingClose: Set(), uncertain: Set(), expired: Set(), established: false}
  def occupied(i) = (s.status.nth(i) == "running" and not(i.in(s.expired))) or
    s.status.nth(i) == "completed" or i.in(s.pendingClose)
  val total = 2 + Set(0, 1).filter(i => occupied(i)).size()
  def mayStart(i) = not(i.in(s.pendingClose)) and s.status.nth(i) != "completed" and
    (s.status.nth(i) != "running" or i.in(s.expired)) and
    (s.established or total - (if(occupied(i)) 1 else 0) < 3)
  action start(i) = all {mayStart(i), s' = s.with("status", s.status.replaceAt(i, "running"))
    .with("expired", s.expired.exclude(Set(i)))}
  action dispatchClose(i) = all {s.status.nth(i) == "running", not(i.in(s.expired)),
    s' = s.with("pendingClose", s.pendingClose.union(Set(i)))}
  action failReview(i) = all {s.status.nth(i) == "running", not(i.in(s.expired)),
    s' = s.with("status", s.status.replaceAt(i, "failed"))
      .with("uncertain", if(i.in(s.pendingClose)) s.uncertain.union(Set(i)) else s.uncertain)}
  action definitiveRefusal(i) = all {i.in(s.pendingClose), not(i.in(s.uncertain)),
    s' = s.with("pendingClose", s.pendingClose.exclude(Set(i)))}
  action complete(i) = all {s.status.nth(i) == "running", not(i.in(s.expired)),
    s' = s.with("status", s.status.replaceAt(i, "completed")).with("pendingClose", s.pendingClose.exclude(Set(i)))}
  action expire(i) = all {s.status.nth(i) == "running", s' = s.with("expired", s.expired.union(Set(i)))}
  action reconcile(i) = all {i.in(s.pendingClose), s' = s.with("status", s.status.replaceAt(i, "completed"))
    .with("pendingClose", s.pendingClose.exclude(Set(i)))}
  action verifiedPriorMerge = s' = s.with("established", true)
  action step = {nondet i = Set(0, 1).oneOf()
    any {start(i), dispatchClose(i), failReview(i), definitiveRefusal(i), complete(i), expire(i), reconcile(i), verifiedPriorMerge, s' = s}}
  val invariant = not(s.established) implies total <= 3
  run newAuthorLastSlotIsAtomicTest = init.then(start(0)).expect(not(mayStart(1)) and total == 3)
  run failedUnsentReviewReleasesSlotTest = init.then(start(0)).then(failReview(0)).then(start(1)).expect(total == 3)
  run ambiguousCloseKeepsAuthorSlotTest = init.then(start(0)).then(dispatchClose(0)).then(failReview(0))
    .expect(not(mayStart(1)) and not(mayStart(0)) and total == 3)
  run expiredReviewCanReclaimItsOwnSlotTest = init.then(start(0)).then(expire(0)).then(start(0))
    .expect(total == 3 and not(mayStart(1)))
  run expiredUnsentReviewReleasesSlotTest = init.then(start(0)).then(expire(0)).then(start(1))
    .expect(total == 3 and not(mayStart(0)))
  run expiredSentReviewRetainsSlotTest = init.then(start(0)).then(dispatchClose(0)).then(expire(0))
    .expect(total == 3 and not(mayStart(1)))
  run confirmedCloseCountsOnceTest = init.then(start(0)).then(dispatchClose(0)).then(failReview(0)).then(reconcile(0))
    .expect(total == 3 and s.pendingClose.size() == 0)
  run definitiveCloseRefusalReleasesFailedReviewTest = init.then(start(0)).then(dispatchClose(0))
    .then(definitiveRefusal(0)).then(failReview(0)).then(start(1)).expect(total == 3)
  run establishedAuthorMayExceedNewAuthorLimitTest = init.then(verifiedPriorMerge).then(start(0)).then(start(1))
    .expect(total == 4 and invariant)
}
