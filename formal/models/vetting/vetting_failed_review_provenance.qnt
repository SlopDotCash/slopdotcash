// @source workers/vetting/verified-review-batches.ts
// @source workers/vetting/review-plan.ts
// Three batches, at most two concurrent calls, then one synthesis. Completed
// outcomes can be cache hits; active calls finish after another call fails.
// The final failed report names the whole inventory and every returned pass.
module vetting_failed_review_provenance {
  var s: {phase: str, started: Set[int], active: Set[int], finished: Set[int],
    failed: Set[int], report: Set[int], wholeInventory: bool, selectedFailure: int}
  action init = s' = {phase: "batches", started: Set(), active: Set(), finished: Set(),
    failed: Set(), report: Set(), wholeInventory: false, selectedFailure: 0}
  action startBatch(id: int): bool = all {s.phase == "batches", s.failed.size() == 0,
    id.in(Set(1, 2, 3)), not(id.in(s.started)), s.active.size() < 2,
    s' = s.with("started", s.started.union(Set(id))).with("active", s.active.union(Set(id)))}
  action finish(id: int, ok: bool): bool = all {id.in(s.active),
    s' = s.with("active", s.active.exclude(Set(id))).with("finished", s.finished.union(Set(id)))
      .with("failed", if(ok) s.failed else s.failed.union(Set(id)))}
  val firstFailure = s.failed.fold(5, (first, id) => if(id < first) id else first)
  action returnFailure = all {s.phase.in(Set("batches", "synthesis")), s.active.size() == 0, s.failed.size() > 0,
    s' = s.with("phase", "returned").with("report", s.finished)
      .with("wholeInventory", true).with("selectedFailure", firstFailure)}
  action startSynthesis = all {s.phase == "batches", s.finished == Set(1, 2, 3), s.failed.size() == 0,
    s' = s.with("phase", "synthesis").with("started", s.started.union(Set(4))).with("active", Set(4))}
  action budgetExhausted = all {s.phase == "batches", s.active.size() == 0, s.failed.size() == 0,
    s.finished != Set(1, 2, 3), s' = s.with("phase", "pending")}
  action step = {
    nondet id = Set(1, 2, 3, 4).oneOf()
    nondet ok = Set(false, true).oneOf()
    any {startBatch(id), finish(id, ok), returnFailure, startSynthesis, budgetExhausted, s' = s}
  }
  val invariant = all {
    s.finished.subseteq(s.started), s.active.intersect(s.finished).size() == 0,
    s.failed.subseteq(s.finished),
    s.phase == "returned" implies all {s.wholeInventory, s.report == s.finished,
      s.active.size() == 0, s.selectedFailure == firstFailure},
    4.in(s.started) implies Set(1, 2, 3).subseteq(s.finished),
    s.phase == "pending" implies s.report.size() == 0 and not(s.wholeInventory),
  }
  run inFlightPassIsRetainedAfterPeerFailsTest = init.then(startBatch(1)).then(startBatch(2))
    .then(finish(2, false)).then(finish(1, true)).then(returnFailure)
    .expect(s.report == Set(1, 2) and s.wholeInventory and s.selectedFailure == 2)
  run firstFailureUsesBatchOrderTest = init.then(startBatch(1)).then(startBatch(2))
    .then(finish(2, false)).then(finish(1, false)).then(returnFailure).expect(s.selectedFailure == 1)
  run synthesisFailureRetainsAllPassesTest = init.then(startBatch(1)).then(finish(1, true))
    .then(startBatch(2)).then(finish(2, true)).then(startBatch(3)).then(finish(3, true))
    .then(startSynthesis).then(finish(4, false)).then(returnFailure)
    .expect(s.report == Set(1, 2, 3, 4) and s.wholeInventory and s.selectedFailure == 4)
  run exhaustedBudgetDoesNotInventReportTest = init.then(startBatch(1)).then(finish(1, true))
    .then(budgetExhausted).expect(s.phase == "pending" and s.report.size() == 0)
}
