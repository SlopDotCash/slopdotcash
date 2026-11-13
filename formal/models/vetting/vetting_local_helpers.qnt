// @source workers/vetting/local-install-helpers.ts
// @source workers/vetting/bounded-scan.ts
// @conformance workers/vetting/local-install-helpers.test.ts
// Finite lifecycle root, cyclic helpers and an unreachable file. Concrete
// parsing and path-resolution boundaries are checked by the conformance tests.
module vetting_local_helpers {
  var pending: Set[int]
  var visited: Set[int]
  var downloads: Set[int]
  var gap: bool
  var finished: bool
  action init = all {
    pending' = Set(0), visited' = Set(), downloads' = Set(),
    gap' = false, finished' = false,
  }
  action inspect(node) = {
    val successors = if (node == 0) Set(1) else if (node == 1) Set(2) else Set(1)
    all {
      not(finished), pending.contains(node),
      visited' = visited.union(Set(node)),
      pending' = pending.exclude(Set(node)).union(successors.exclude(visited.union(Set(node)))),
      downloads' = if (node == 2) downloads.union(Set(node)) else downloads,
      gap' = gap, finished' = false,
    }
  }
  action unresolved = all {
    not(finished), pending.contains(0), gap' = true,
    pending' = pending, visited' = visited, downloads' = downloads, finished' = false,
  }
  action finish = all {
    pending == Set(), finished' = true,
    pending' = pending, visited' = visited, downloads' = downloads, gap' = gap,
  }
  action step = {
    nondet node = Set(0, 1, 2, 3).oneOf()
    any { inspect(node), unresolved, finish }
  }
  val invariant = all {
    not(visited.contains(3)), not(downloads.contains(3)),
    downloads.subseteq(visited), finished implies pending == Set(),
  }
  run cyclesFinishWithoutDuplicatesTest = init.then(inspect(0)).then(inspect(1)).then(inspect(2)).then(finish)
    .expect(visited == Set(0, 1, 2) and downloads == Set(2))
  run missingHelperKeepsGapTest = init.then(unresolved).then(inspect(0)).then(inspect(1)).then(inspect(2)).then(finish)
    .expect(gap and finished)
  run unrelatedFileNeverBecomesDownloadTest = init.then(inspect(0)).then(inspect(1)).then(inspect(2)).then(finish)
    .expect(not(downloads.contains(3)))
}
