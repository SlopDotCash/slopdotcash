// @source workers/vetting-flags/build.ts
// @source workers/vetting-flags/qualification.ts
// @source workers/vetting-flags/workflow.ts
// @source workers/vetting-flags/run-workflow.mjs
// @source workers/vetting-backup/qualification-access.ts
// Scoped synthetic fixtures retain an in-progress marker. A failed partial
// setup cannot rerun mutations as a fresh fixture; cleanup stays available.
module qualification_fixture {
  var s: { started: bool, finished: bool, failed: bool, deleted: bool,
    receipts: Set[int], active: bool, mutations: int }
  action init = s' = {started: false, finished: false, failed: false, deleted: false,
    receipts: Set(), active: false, mutations: 0}
  action start = all { not(s.started), not(s.active),
    s' = s.with("started", true).with("active", true).with("mutations", 1) }
  action finish = all { s.active, s' = s.with("active", false).with("finished", true) }
  action failure = all { s.active, s' = s.with("active", false).with("failed", true) }
  action acknowledge(id: int): bool = all { s.finished or s.failed,
    s' = s.with("receipts", s.receipts.union(Set(id))) }
  action cleanup = all { s.started, not(s.active), s' = s.with("deleted", true) }
  action step = { nondet id = Set(1, 2).oneOf()
    any { start, finish, failure, acknowledge(id), cleanup, s' = s } }
  val invariant = all { s.mutations <= 1, s.finished implies s.started,
    s.failed implies not(s.finished), s.deleted implies not(s.active) }
  run completedReplayDoesNotRerunFixtureTest = init.then(start).then(finish).then(acknowledge(1)).then(acknowledge(2))
    .expect(s.mutations == 1 and s.receipts == Set(1, 2))
  run partialFailureStillCleansTest = init.then(start).then(failure).then(cleanup)
    .expect(s.deleted and not(s.finished))
}
