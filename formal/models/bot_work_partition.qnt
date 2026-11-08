// @source workers/slopbot/value-work-unit.ts
// @source workers/slopbot/value-work-unit-review.ts
// @source src/lib/value-assessment.ts
// Two immutable implementation claims and two review sources. Units partition
// claims and required reviews exactly once; self-review never gets credit.
module bot_work_partition {
  var s: { remaining: Set[int], assigned: Set[int], reviews: Set[int], used: Set[int],
    credited: Set[int], units: int, published: bool }
  action init = s' = {remaining: Set(1, 2), assigned: Set(), reviews: Set(1, 2),
    used: Set(), credited: Set(), units: 0, published: false}
  action unit(claim: int, review: int, selfReview: bool): bool = all {
    claim.in(s.remaining), review.in(s.reviews), not(review.in(s.used)),
    s' = s.with("remaining", s.remaining.exclude(Set(claim)))
      .with("assigned", s.assigned.union(Set(claim))).with("used", s.used.union(Set(review)))
      .with("credited", if (selfReview) s.credited else s.credited.union(Set(review)))
      .with("units", s.units + 1) }
  action publish = all { s.remaining.size() == 0, s.used == s.reviews,
    s' = s.with("published", true) }
  action step = { nondet claim = Set(1, 2).oneOf(); nondet review = Set(1, 2).oneOf()
    any { unit(claim, review, true), unit(claim, review, false), publish, s' = s } }
  val invariant = all { s.assigned.intersect(s.remaining).size() == 0,
    s.assigned.union(s.remaining) == Set(1, 2), s.units == s.assigned.size(),
    s.credited.subseteq(s.used), s.published implies s.assigned == Set(1, 2) and s.used == Set(1, 2) }
  run selfReviewNotCreditedTest = init.then(unit(1, 1, true)).then(unit(2, 2, false))
    .then(publish).expect(s.credited == Set(2) and invariant)
  run partialPartitionNotPublishedTest = init.then(unit(1, 1, false))
    .expect(not(s.published) and s.remaining == Set(2))
}
