// @source src/lib/leaderboard.ts
// createSnapshotWithReviewCutoff/assertLeaderboardSnapshot: full outcome census,
// disjoint hydration, open queue counts, unique identities and explicit payment
// basis. Parser grammar and every legacy compatibility branch remain separate.
module ui_snapshot_contract {
  var outcomes: Set[int]
  var details: Set[int]
  var reviewOnly: Set[int]
  var queue: Set[int]
  var declaredQueueCount: int
  var basis: str
  var oldReview: bool
  var published: bool
  action init = all { outcomes' = Set(), details' = Set(), reviewOnly' = Set(),
    queue' = Set(), declaredQueueCount' = 0, basis' = "missing", oldReview' = false,
    published' = false }
  action addOutcome(id: int): bool = all { outcomes' = outcomes.union(Set(id)),
    details' = details, reviewOnly' = reviewOnly, queue' = queue,
    declaredQueueCount' = declaredQueueCount, basis' = basis, oldReview' = oldReview, published' = false }
  action hydrate(id: int): bool = all { details' = details.union(Set(id)),
    outcomes' = outcomes, reviewOnly' = reviewOnly, queue' = queue,
    declaredQueueCount' = declaredQueueCount, basis' = basis, oldReview' = oldReview, published' = false }
  action hydrateReview(id: int): bool = all { reviewOnly' = reviewOnly.union(Set(id)),
    outcomes' = outcomes, details' = details, queue' = queue,
    declaredQueueCount' = declaredQueueCount, basis' = basis, oldReview' = oldReview, published' = false }
  action queueOne = all { queue' = Set(1), declaredQueueCount' = 1,
    outcomes' = outcomes, details' = details, reviewOnly' = reviewOnly,
    basis' = basis, oldReview' = oldReview, published' = false }
  action loseQueueRow = all { queue' = Set(), declaredQueueCount' = declaredQueueCount,
    outcomes' = outcomes, details' = details, reviewOnly' = reviewOnly,
    basis' = basis, oldReview' = oldReview, published' = false }
  action paymentBasis(value: str): bool = all { basis' = value, oldReview' = oldReview,
    outcomes' = outcomes, details' = details, reviewOnly' = reviewOnly,
    queue' = queue, declaredQueueCount' = declaredQueueCount, published' = false }
  action retainOldReview = all { oldReview' = true, basis' = basis,
    outcomes' = outcomes, details' = details, reviewOnly' = reviewOnly,
    queue' = queue, declaredQueueCount' = declaredQueueCount, published' = false }
  val complete = details.union(reviewOnly).subseteq(outcomes)
    and details.intersect(reviewOnly).size() == 0
    and declaredQueueCount == queue.size()
    and (basis == "explicit" or (basis == "omitted" and not(oldReview)))
  action publish = all { published' = complete,
    outcomes' = outcomes, details' = details, reviewOnly' = reviewOnly,
    queue' = queue, declaredQueueCount' = declaredQueueCount, basis' = basis, oldReview' = oldReview }
  action step = any { addOutcome(1), addOutcome(2), hydrate(1), hydrateReview(1),
    queueOne, loseQueueRow, paymentBasis("explicit"), paymentBasis("omitted"),
    retainOldReview, publish }
  val invariant = published implies complete
  run completeTest = init.then(addOutcome(1)).then(hydrate(1)).then(queueOne).then(paymentBasis("explicit")).then(publish).expect(published)
  run missingSourceTest = init.then(hydrate(1)).then(paymentBasis("explicit")).then(publish).expect(not(published))
  run duplicateHydrationTest = init.then(addOutcome(1)).then(hydrate(1)).then(hydrateReview(1)).then(paymentBasis("explicit")).then(publish).expect(not(published))
  run omittedOldReviewTest = init.then(paymentBasis("omitted")).then(retainOldReview).then(publish).expect(not(published))
  run missingQueueTest = init.then(queueOne).then(loseQueueRow).then(paymentBasis("explicit")).then(publish).expect(not(published))
}
