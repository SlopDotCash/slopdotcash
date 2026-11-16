// @source src/lib/cycle-index.ts
// @source src/CyclePages.tsx
// Index readers must reject a mixed immutable-file/lifecycle projection.
// Money and wallet evidence predicates are checked by the production validator;
// this finite model focuses on stage/files/timestamps, including the discovered
// planned-with-settlement contradiction. Three milestones model time ordering.
module ui_cycle_publication {
  var stage: str
  var allocation: bool
  var plan: bool
  var settlement: bool
  var approved: bool
  var settled: bool
  var rendered: str
  action init = all { stage' = "review", allocation' = false, plan' = false,
    settlement' = false, approved' = false, settled' = false, rendered' = "loading" }
  action approve = all { stage == "review", stage' = "payment-ready",
    allocation' = true, approved' = true, plan' = plan, settlement' = settlement,
    settled' = settled, rendered' = "loading" }
  action prepare = all { stage == "payment-ready", stage' = "settlement-planned",
    plan' = true, allocation' = allocation, settlement' = settlement,
    approved' = approved, settled' = settled, rendered' = "loading" }
  action finalize = all { stage == "settlement-planned", stage' = "paid",
    settlement' = true, settled' = true, allocation' = allocation, plan' = plan,
    approved' = approved, rendered' = "loading" }
  // Models malformed fetched bytes, not an allowed application transition.
  action mixedStagePayload = all { stage == "paid", stage' = "settlement-planned",
    allocation' = allocation, plan' = plan, settlement' = settlement,
    approved' = approved, settled' = settled, rendered' = "loading" }
  val valid = all {
    settlement == settled,
    settlement implies stage == "paid",
    stage == "paid" implies settlement and allocation and plan and approved,
    stage == "settlement-planned" implies allocation and plan and approved,
    stage == "payment-ready" implies allocation and approved and not(plan) and not(settlement),
    stage == "review" implies not(allocation) and not(plan) and not(settlement) and not(approved)
  }
  action read = all { rendered' = if (valid) stage else "error",
    stage' = stage, allocation' = allocation, plan' = plan,
    settlement' = settlement, approved' = approved, settled' = settled }
  action step = any { approve, prepare, finalize, mixedStagePayload, read }
  val invariant = all {
    rendered == "paid" implies settlement and settled and stage == "paid",
    rendered == "settlement-planned" implies not(settlement) and not(settled),
    rendered != "loading" and rendered != "error" implies valid
  }
  run paidTest = init.then(approve).then(prepare).then(finalize).then(read).expect(rendered == "paid")
  run pendingTest = init.then(approve).then(prepare).then(read).expect(rendered == "settlement-planned")
  run contradictoryPayloadTest = init.then(approve).then(prepare).then(finalize)
    .then(mixedStagePayload).then(read).expect(rendered == "error")
}
