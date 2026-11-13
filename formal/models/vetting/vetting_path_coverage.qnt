// @source workers/vetting/bounded-scan.ts
// @conformance workers/vetting/agent-instruction-surfaces.test.ts
// @conformance workers/vetting/nested-surface-directories.test.ts
// @conformance workers/vetting/source-content-coverage.test.ts
// Finite abstraction of previously omitted content classes. Concrete
// tests check path matching, deterministic findings, and actual review bytes.
// Set identity abstracts the inventory hash; cryptographic collision resistance
// and complete repository acquisition are external assumptions.
module vetting_path_coverage {
  val required = Set("markdown", "nestedInstruction", "nestedHook", "unclassifiedText")
  var inventory: Set[str]
  var reviewed: Set[str]
  var published: bool
  action init = all {
    inventory' = Set(), reviewed' = Set(), published' = false,
  }
  action classify(kind) = all {
    not(published), kind.in(required),
    inventory' = inventory.union(Set(kind)), reviewed' = reviewed,
    published' = published,
  }
  action review(kind) = all {
    not(published), kind.in(inventory),
    reviewed' = reviewed.union(Set(kind)), inventory' = inventory,
    published' = published,
  }
  action reuse(previousInventory) = all {
    not(published), previousInventory == inventory,
    reviewed' = inventory, inventory' = inventory, published' = published,
  }
  action publish = all {
    inventory == required, reviewed == inventory,
    published' = true, inventory' = inventory, reviewed' = reviewed,
  }
  action step = {
    nondet kind = required.oneOf()
    nondet previousInventory = required.powerset().oneOf()
    any { classify(kind), review(kind), reuse(previousInventory), publish,
      all { inventory' = inventory, reviewed' = reviewed, published' = published } }
  }
  val invariant = all {
    reviewed.subseteq(inventory),
    published implies (inventory == required and reviewed == required),
  }
  run omittedContentCannotPublishTest = init.then(classify("markdown"))
    .then(review("markdown")).expect(not(published) and inventory != required)
  run previousCoverageCannotBeReusedTest = init.then(classify("markdown"))
    .expect(inventory != Set())
  run unclassifiedTextCannotBeOmittedTest = init.then(classify("markdown"))
    .then(classify("nestedInstruction")).then(classify("nestedHook"))
    .then(review("markdown")).then(review("nestedInstruction"))
    .then(review("nestedHook")).expect(not(published) and inventory != required)
  run completeContentReviewTest = init.then(classify("markdown"))
    .then(classify("nestedInstruction")).then(classify("nestedHook"))
    .then(classify("unclassifiedText"))
    .then(review("markdown")).then(review("nestedInstruction"))
    .then(review("nestedHook")).then(review("unclassifiedText"))
    .then(publish).expect(published)
}
