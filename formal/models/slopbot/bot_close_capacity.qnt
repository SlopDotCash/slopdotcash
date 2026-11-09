// @source workers/slopbot/close-attempts.ts
// @source workers/slopbot/contracts.ts
// @source workers/slopbot/review.ts
// @source workers/slopbot/value-publication-fence.ts
// @source migrations/0117_slopbot_close_attempts.sql
// Two items, two immutable attempts per item, one repository slot and three
// scaled days. A definitive no-effect refusal allows a new attempt; unknown
// external outcomes never age out. IDs 0/1 belong to item A; 2/3 to item B.
// The second ID of an item is either the same review retried after a definitive
// refusal or a new head's review after a maintainer reopened the first close:
// the SQL refuses only a pending attempt for the item (unique index) and a
// close action for the same review key, not every earlier close of the item.
// Reopened closes still count against the rolling daily capacity.
module bot_close_capacity {
  var s: {reserved: Set[int], sent: Set[int], mayApply: Set[int], closed: Set[int],
    confirmed: Set[int], rejected: Set[int], commented: Set[int], lost: Set[int],
    reopened: Set[int], at: List[int], now: int, generation: int, observed: List[int], allowed: bool, breaker: bool}
  action init = s' = {reserved: Set(), sent: Set(), mayApply: Set(), closed: Set(),
    confirmed: Set(), rejected: Set(), commented: Set(), lost: Set(),
    reopened: Set(), at: List(-1, -1, -1, -1), now: 0, generation: 0,
    observed: List(-1, -1, -1, -1), allowed: true, breaker: false}
  def sourceItem(i) = if(i < 2) 0 else 1
  val pending = s.reserved.exclude(s.confirmed).exclude(s.rejected)
  val occupied = pending.size() + s.confirmed.filter(i => s.at.nth(i) == s.now).size()
  def mayReserve(i) = all {not(i.in(s.reserved)), occupied < 1, s.allowed, not(s.breaker),
    s.observed.nth(i) == s.generation,
    not(pending.exists(other => sourceItem(other) == sourceItem(i))),
    not(s.confirmed.exclude(s.reopened).exists(other => sourceItem(other) == sourceItem(i))),
    (i == 1 implies 0.in(s.rejected.union(s.reopened))),
    (i == 3 implies 2.in(s.rejected.union(s.reopened)))}
  action observe(i) = s' = s.with("observed", s.observed.replaceAt(i, s.generation))
  action reserve(i) = all {mayReserve(i), s' = s.with("reserved", s.reserved.union(Set(i)))}
  action dispatch(i) = all {i.in(pending), not(i.in(s.sent)),
    s' = s.with("sent", s.sent.union(Set(i))).with("mayApply", s.mayApply.union(Set(i)))}
  action loseResponse(i) = all {i.in(s.sent), s' = s.with("lost", s.lost.union(Set(i)))}
  action definitiveRejection(i) = all {i.in(pending), i.in(s.sent), not(i.in(s.closed)), not(i.in(s.lost)),
    s' = s.with("rejected", s.rejected.union(Set(i))).with("mayApply", s.mayApply.exclude(Set(i)))}
  action externalClose(i) = all {i.in(s.mayApply),
    s' = s.with("mayApply", s.mayApply.exclude(Set(i))).with("closed", s.closed.union(Set(i)))
      .with("at", s.at.replaceAt(i, s.now))}
  action confirm(i) = all {i.in(s.closed), not(i.in(s.confirmed)),
    s' = s.with("confirmed", s.confirmed.union(Set(i)))}
  action acknowledgeComment(i) = all {i.in(s.confirmed), not(i.in(s.commented)),
    s' = s.with("commented", s.commented.union(Set(i)))}
  action replay(i) = all {i.in(s.confirmed), s' = s}
  // A maintainer reopen of a confirmed close; its close action stays counted.
  action reopen(i) = all {i.in(s.confirmed), not(i.in(s.reopened)),
    s' = s.with("reopened", s.reopened.union(Set(i)))}
  action tick = all {s.now < 2, s' = s.with("now", s.now + 1)}
  action revoke = all {s.generation == 0, s' = s.with("generation", 1).with("allowed", false)}
  action tripBreaker = all {not(s.breaker), s' = s.with("breaker", true)}
  action step = {nondet i = Set(0, 1, 2, 3).oneOf()
    any {observe(i), reserve(i), dispatch(i), loseResponse(i), definitiveRejection(i),
      externalClose(i), confirm(i), acknowledgeComment(i), replay(i), reopen(i), tick, revoke, tripBreaker, s' = s}}
  val invariant = all {occupied <= 1, s.confirmed.subseteq(s.closed), s.closed.subseteq(s.sent),
    s.sent.subseteq(s.reserved), s.commented.subseteq(s.confirmed),
    s.confirmed.intersect(s.mayApply).size() == 0, s.rejected.intersect(s.closed).size() == 0,
    s.reopened.subseteq(s.confirmed),
    Set(0, 1).forall(src => s.reserved.filter(i => sourceItem(i) == src
      and not(i.in(s.rejected.union(s.reopened)))).size() <= 1)}
  run concurrentLastSlotHasOneWinnerTest = init.then(observe(0)).then(observe(2)).then(reserve(0))
    .expect(not(mayReserve(2)) and occupied == 1)
  run timeoutDoesNotFreeSlotTest = init.then(observe(0)).then(reserve(0)).then(dispatch(0))
    .then(loseResponse(0)).then(tick).then(tick).then(observe(2))
    .expect(not(mayReserve(2)) and occupied == 1 and 0.in(s.mayApply))
  run lateCompletionReconcilesWithoutResendingTest = init.then(observe(0)).then(reserve(0)).then(dispatch(0))
    .then(loseResponse(0)).then(externalClose(0)).then(confirm(0)).then(acknowledgeComment(0)).then(replay(0))
    .expect(occupied == 1 and s.sent == Set(0) and s.confirmed == Set(0) and s.commented == Set(0))
  run confirmedHistoryDoesNotDoubleCountTest = init.then(observe(0)).then(reserve(0)).then(dispatch(0))
    .then(externalClose(0)).then(confirm(0)).then(tick).then(observe(2)).then(reserve(2))
    .expect(occupied == 1 and s.reserved == Set(0, 2))
  run changedAuthorityLosesQueuedReservationTest = init.then(observe(0)).then(revoke)
    .expect(not(mayReserve(0)) and s.reserved.size() == 0)
  run definitiveRefusalReleasesSlotAndKeepsHistoryTest = init.then(observe(0)).then(reserve(0)).then(dispatch(0))
    .then(definitiveRejection(0)).then(observe(1)).then(reserve(1)).then(dispatch(1))
    .then(externalClose(1)).then(confirm(1))
    .expect(s.reserved == Set(0, 1) and s.rejected == Set(0) and occupied == 1)
  run breakerTripsBeforeReservationTest = init.then(observe(0)).then(tripBreaker)
    .expect(not(mayReserve(0)) and s.reserved.size() == 0)
  run breakerDoesNotEraseUnknownRequestTest = init.then(observe(0)).then(reserve(0)).then(dispatch(0))
    .then(loseResponse(0)).then(tripBreaker).then(tick)
    .expect(pending == Set(0) and occupied == 1 and s.rejected.size() == 0)
  run reopenedItemMayCloseNewHeadNextDayTest = init.then(observe(0)).then(reserve(0)).then(dispatch(0))
    .then(externalClose(0)).then(confirm(0)).then(observe(1)).expect(not(mayReserve(1)))
    .then(reopen(0)).expect(not(mayReserve(1)) and occupied == 1)
    .then(tick).then(reserve(1))
    .expect(s.reserved == Set(0, 1) and pending == Set(1) and occupied == 1)
}
