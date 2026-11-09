// @source migrations/0037_points_batch_prefix.sql
// @source migrations/0038_points_coverage_staging.sql
// @source migrations/0044_points_immutable_history.sql
// @source scripts/generate-points.ts
// @source scripts/prepare-pr-ledger.ts
// Three immutable record identities stand for their complete canonical bytes.
// Staging is invisible; a committed batch must extend the exact public prefix.
module journal_publication {
  var published: List[int]
  var staged: List[int]
  var staging: bool
  pure def prefix(old, candidate) = if (candidate.length() < old.length()) false
    else old.indices().forall(i => old.nth(i) == candidate.nth(i))
  pure def unique(items) = items.indices().forall(i => items.indices().forall(j =>
    i == j or items.nth(i) != items.nth(j)))
  action init = all { published' = List(1), staged' = List(), staging' = false }
  action stage(candidate) = all { staged' = candidate, staging' = true, published' = published }
  action commit = all {
    staging, prefix(published, staged), unique(staged),
    published' = staged, staged' = List(), staging' = false,
  }
  action reject = all { staging, not(prefix(published, staged) and unique(staged)),
    published' = published, staged' = List(), staging' = false }
  action interrupt = all { staged' = List(), staging' = false, published' = published }
  action step = {
    nondet candidate = Set(List(), List(1), List(1, 2), List(1, 2, 3), List(2, 1), List(1, 1)).oneOf()
    any { stage(candidate), commit, reject, interrupt }
  }
  val invariant = all { published.length() >= 1, published.nth(0) == 1, unique(published) }
  run extendsExactPrefixTest = init.then(stage(List(1, 2))).then(commit)
    .then(stage(List(1, 2, 3))).then(commit).expect(published == List(1, 2, 3))
  run reorderIsRejectedTest = init.then(stage(List(1, 2))).then(commit)
    .then(stage(List(2, 1))).then(reject).expect(published == List(1, 2))
  run interruptedStagePreservesPublicationTest = init.then(stage(List(1, 2))).then(interrupt)
    .expect(published == List(1))
  run duplicateCannotReplaceRecordTest = init.then(stage(List(1, 1))).then(reject).expect(published == List(1))
}
