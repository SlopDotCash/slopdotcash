// @source scripts/configure-staging-secrets.mjs
// Every required value is loaded before the first write. Three fixed staging
// destinations are updated sequentially; failure retains partial progress,
// and a retry writes the same complete set. No production destination exists.
module operator_staging_secrets {
  var s: { authorized: bool, loaded: bool, stage: int, written: Set[int], failed: bool, complete: bool }
  action init = s' = {authorized: false, loaded: false, stage: 0, written: Set(), failed: false, complete: false}
  action authorize = s' = s.with("authorized", true)
  action loadAll = all { s.authorized, s' = s.with("loaded", true) }
  action writeNext = all { s.loaded, not(s.failed), s.stage < 3,
    s' = s.with("stage", s.stage + 1).with("written", s.written.union(Set(s.stage + 1))) }
  action failure = all { s.loaded, s.stage < 3, s' = s.with("failed", true) }
  action lostWriteResponse = all { s.loaded, not(s.failed), s.stage < 3,
    s' = s.with("written", s.written.union(Set(s.stage + 1))).with("failed", true) }
  action retry = all { s.failed, s' = s.with("stage", 0).with("failed", false) }
  action finish = all { s.stage == 3, not(s.failed), s' = s.with("complete", true) }
  action step = any { authorize, loadAll, writeNext, failure, lostWriteResponse, retry, finish, s' = s }
  val invariant = all { s.written.subseteq(Set(1, 2, 3)),
    s.written.size() > 0 implies s.loaded and s.authorized,
    s.complete implies s.written == Set(1, 2, 3) and s.stage == 3 }
  run partialFailureDoesNotClaimCompletionTest = init.then(authorize).then(loadAll).then(writeNext).then(failure)
    .expect(s.written == Set(1) and not(s.complete))
  run retryCompletesSameDestinationsTest = init.then(authorize).then(loadAll).then(writeNext).then(failure).then(retry)
    .then(writeNext).then(writeNext).then(writeNext).then(finish).expect(s.complete)
  run unknownWriteDoesNotClaimCompletionTest = init.then(authorize).then(loadAll).then(lostWriteResponse)
    .expect(s.written == Set(1) and s.failed and not(s.complete))
}
