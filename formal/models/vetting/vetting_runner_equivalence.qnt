// @source scripts/vetting-runner-equivalence.ts
// @source scripts/run-vetting-controller.ts
// @source .github/workflows/vetting-controller.yml
// @conformance scripts/vetting-runner-equivalence.test.ts
// @conformance scripts/vetting-release-dispatch.test.ts
// Whether a scan pass may run on the deployed isolated runner (PRD section 8,
// operator decision of 23 November 2026). The checkout is the branch head the
// controller runs; the runner reports the commit it was deployed from. The
// pass runs when they are the same commit, or when the checkout descends from
// the deployed commit with no scanner input changed in between and the
// compare list is complete. Any other case, including an unreadable compare,
// refuses the pass until the checkout's own release is deployed. A release
// of a later head makes `deployed` that head again.
module vetting_runner_equivalence {
  // Commits of the branch in order; 0 is the deployed commit at the start.
  // `scannerChangedAt` marks the commits that changed a scanner input.
  var deployed: int
  var tip: int
  var scannerChangedAt: Set[int]
  var compareReadable: bool
  var outcome: str

  pure def scannerChangedBetween(changed: Set[int], lo: int, hi: int): bool =
    changed.exists(commit => commit > lo and commit <= hi)

  action init = all {
    deployed' = 0, tip' = 0, scannerChangedAt' = Set(),
    compareReadable' = true, outcome' = "idle",
  }
  // A merge advances the tip; it may or may not change the scanner.
  action merge(changesScanner: bool): bool = all {
    tip < 3,
    tip' = tip + 1,
    scannerChangedAt' = if (changesScanner) scannerChangedAt.union(Set(tip + 1)) else scannerChangedAt,
    deployed' = deployed, compareReadable' = compareReadable, outcome' = "idle",
  }
  // A release deploys the current tip.
  action release = all {
    deployed' = tip,
    tip' = tip, scannerChangedAt' = scannerChangedAt,
    compareReadable' = compareReadable, outcome' = "idle",
  }
  action compareFails(readable: bool): bool = all {
    compareReadable' = readable,
    deployed' = deployed, tip' = tip, scannerChangedAt' = scannerChangedAt,
    outcome' = outcome,
  }
  // The controller's decision for the current tip.
  action pass = all {
    outcome' =
      if (deployed == tip) "ran"
      else if (compareReadable and not(scannerChangedBetween(scannerChangedAt, deployed, tip))) "ran"
      else "refused",
    deployed' = deployed, tip' = tip, scannerChangedAt' = scannerChangedAt,
    compareReadable' = compareReadable,
  }
  action step = {
    nondet changes = Set(true, false).oneOf()
    nondet readable = Set(true, false).oneOf()
    any { merge(changes), release, compareFails(readable), pass }
  }

  // A pass never runs on a runner whose scanner differs from the checkout's.
  val invariant =
    outcome == "ran" implies (deployed == tip or not(scannerChangedBetween(scannerChangedAt, deployed, tip)))

  run sameCommitRunsTest = init.then(pass).expect(outcome == "ran")
  run laterUnrelatedMergeRunsTest =
    init.then(merge(false)).then(merge(false)).then(pass).expect(outcome == "ran")
  run scannerChangeWaitsForReleaseTest =
    init.then(merge(false)).then(merge(true)).then(pass).expect(outcome == "refused")
      .then(release).then(pass).expect(outcome == "ran")
  run unreadableCompareRefusesTest =
    init.then(merge(false)).then(compareFails(false)).then(pass).expect(outcome == "refused")
  run unrelatedMergeAfterScannerReleaseRunsTest =
    init.then(merge(true)).then(release).then(merge(false)).then(pass).expect(outcome == "ran")
}
