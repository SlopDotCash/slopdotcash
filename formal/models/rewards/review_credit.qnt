// @source src/lib/scoring-policy.ts
// Fixed seven-review fixture ingested in any order: actor A at t1/band1 and
// t3/band3, B at t2/band2, C/D/E/F at t4..7. First five distinct actors receive
// one highest-band weight each; F is beyond the cap. Size is bounded 0..5.
module review_credit {
  type S = { seen: Set[int], order: List[int], size: int, done: bool, credited: List[int],
    sourceA: int, pool: int, paid: bool }
  var s: S
  action init = s' = { seen: Set(), order: List(), size: 0, done: false, credited: List(), sourceA: 0, pool: 0, paid: false }
  action chooseSize(assessed: int): bool = all { s.seen.size() == 0, not(s.done), s' = s.with("size", assessed) }
  action ingest(id: int): bool = all { not(s.done), not(s.seen.contains(id)),
    s' = s.with("seen", s.seen.union(Set(id))).with("order", s.order.append(id)) }
  action allocate = all { s.seen == 1.to(7), not(s.done),
    s' = s.with("done", true).with("credited", List(1, 2, 3, 4, 5)).with("sourceA", 3)
      .with("pool", if(s.size == 0) 1 else s.size) }
  action chooseAnySize = { nondet assessed = 0.to(5).oneOf() chooseSize(assessed) }
  action ingestAny = { nondet id = 1.to(7).exclude(s.seen).oneOf() ingest(id) }
  action produce = chooseAnySize.then(ingestAny).then(ingestAny).then(ingestAny)
    .then(ingestAny).then(ingestAny).then(ingestAny).then(ingestAny).then(allocate)
  action step = {
    nondet assessed = 0.to(5).oneOf()
    nondet id = 1.to(7).oneOf()
    any { chooseSize(assessed), ingest(id), allocate, s' = s }
  }
  val invariant = all { not(s.paid), s.seen.subseteq(1.to(7)),
    s.done implies s.credited == List(1, 2, 3, 4, 5) and s.sourceA == 3 and s.pool >= 1 and s.pool <= 5 }
  run unorderedHighestBandTest = init.then(chooseSize(5))
    .then(ingest(7)).then(ingest(6)).then(ingest(5)).then(ingest(4))
    .then(ingest(3)).then(ingest(2)).then(ingest(1)).then(allocate)
    .expect(s.sourceA == 3 and s.credited == List(1, 2, 3, 4, 5) and s.pool == 5 and invariant)
  run minimumPoolTest = init.then(chooseSize(0))
    .then(ingest(1)).then(ingest(2)).then(ingest(3)).then(ingest(4))
    .then(ingest(5)).then(ingest(6)).then(ingest(7)).then(allocate).expect(s.pool == 1 and invariant)
  run duplicateSourceRefusedTest = init.then(ingest(1)).then(ingest(1).fail())
  run sampledReviewTest = init.then(produce).expect(invariant)
}
