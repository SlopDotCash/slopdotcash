// @source backend/security/handler.ts
// @source backend/security/operator-queue.ts
// One program repository with two GitHub reports and the scheduled import.
// A report becomes a case at most once, only while GitHub serves the list,
// and the import never asks for a deposit or closes anything.
module api_security_automatic_import {
  // github: reports GitHub holds. cases: reports recorded as cases.
  // available: whether GitHub serves the list. asked: deposits asked.
  var s: { github: Set[int], cases: Set[int], available: bool, asked: int,
    closed: int, runs: int }
  action init = s' = {github: Set(), cases: Set(), available: true, asked: 0,
    closed: 0, runs: 0}
  action file(report: int): bool = all { not(report.in(s.github)),
    s' = s.with("github", s.github.union(Set(report))) }
  action outage = all { s.available, s' = s.with("available", false) }
  action recover = all { not(s.available), s' = s.with("available", true) }
  // The scheduled import: every unrecorded report GitHub serves is recorded.
  action importRun = all { s.runs < 4,
    s' = (if (s.available) s.with("cases", s.cases.union(s.github)) else s)
      .with("runs", s.runs + 1) }
  action step = { nondet report = Set(1, 2).oneOf()
    any { file(report), outage, recover, importRun } }
  val invariant = all { s.cases.subseteq(s.github), s.asked == 0, s.closed == 0 }
  run importsOnceTest = init.then(file(1)).then(importRun).then(importRun)
    .expect(s.cases == Set(1) and s.asked == 0)
  run outageWritesNothingTest = init.then(file(1)).then(outage).then(importRun)
    .expect(s.cases == Set() and s.runs == 1)
  run laterReportIsImportedTest = init.then(file(1)).then(importRun).then(file(2))
    .then(importRun).expect(s.cases == Set(1, 2))
  run recoveryImportsTest = init.then(file(1)).then(outage).then(importRun)
    .then(recover).then(importRun).expect(s.cases == Set(1))
}
