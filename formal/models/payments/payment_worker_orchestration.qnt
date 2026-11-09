// @source workers/payments/index.ts
// @source workers/payments/deployments.ts
// @evidence workers/payments/worker-orchestration.test.ts
// syncRegistryVaults and the scheduled parent, not the child payment protocols.
// Two deployments, five ordered jobs, at most two invocations. The scan list
// and RPC JSON value are captured once per sync. Later child jobs may perform
// their own registry/configuration reads. Individual snapshot/scan/job effects
// can survive rejection; aggregate errors are not rollback. A successful run
// does not prove any payment happened. Registry parsing, snapshot concurrency,
// event verification and child SQL/executor state have separate models.
// Fatal registry/RPC parse errors precede the catch-and-continue loops. A
// structurally invalid but parseable RPC JSON value is represented by later
// child failure, not invented early schema validation. No fairness is assumed
// for pending operations. All new scenarios and regressions are unexecuted.
module payment_worker_orchestration {
  val jobNames = List("recovery", "reconcile", "coordinator", "commit", "dispatch")
  type State = { phase: str, invocation: int, onlySync: bool, count: int,
    registryFault: bool, rpcFault: bool, registryProblems: bool,
    cursor: int, job: int, calls: List[str], errors: List[str],
    snapshotEffects: Set[int], scanEffects: Set[int], jobEffects: Set[str],
    scans: List[int], syncReturned: bool, result: str }
  var s: State
  val initial: State = { phase: "input", invocation: 1, onlySync: false,
    count: 2, registryFault: false, rpcFault: false, registryProblems: false,
    cursor: 1, job: 0, calls: List(), errors: List(), snapshotEffects: Set(),
    scanEffects: Set(), jobEffects: Set(), scans: List(), syncReturned: false,
    result: "none" }
  action init = s' = initial
  action configure(onlySync: bool, count: int, registryFault: bool, rpcFault: bool, problems: bool): bool = all {
    s.phase == "input", 0.to(2).contains(count), count > 0 or problems,
    s' = s.with("onlySync", onlySync).with("count", count).with("registryFault", registryFault)
      .with("rpcFault", rpcFault).with("registryProblems", problems) }
  action start = all { s.phase == "input", s' = s.with("phase", "registry") }
  action registry = all { s.phase == "registry", s' =
    if (s.registryFault) s.with("phase", "done").with("result", "registry-threw")
    else s.with("phase", "rpc").with("errors", if (s.registryProblems) List("registry") else List()) }
  action rpc = all { s.phase == "rpc", s' =
    if (s.rpcFault) s.with("phase", "done").with("result", "rpc-parse-threw")
    else s.with("phase", "snapshots") }
  action snapshots(ok: bool, changed: bool): bool = all { s.phase == "snapshots",
    s.count > 0 or (ok and not(changed)),
    s' = s.with("phase", "scan").with("cursor", 1)
      .with("errors", if (ok) s.errors else s.errors.append("snapshots"))
      .with("snapshotEffects", if (changed) s.snapshotEffects.union(Set(s.invocation)) else s.snapshotEffects) }
  action nextScan = all { s.phase == "scan", s' =
    if (s.cursor > s.count) s.with("phase", "sync-return")
    else s.with("phase", "scan-pending").with("scans", s.scans.append(s.cursor)) }
  action scanResult(ok: bool, changed: bool): bool = all { s.phase == "scan-pending",
    s' = s.with("phase", "scan").with("cursor", s.cursor + 1)
      .with("errors", if (ok) s.errors else s.errors.append(if (s.cursor == 1) "scan-1" else "scan-2"))
      .with("scanEffects", if (changed) s.scanEffects.union(Set((s.invocation - 1) * 2 + s.cursor)) else s.scanEffects) }
  action returnSync = all { s.phase == "sync-return", s' = s.with("syncReturned", true)
    .with("phase", if (s.onlySync) "done" else "jobs")
    .with("result", if (s.onlySync) "sync-returned" else "none") }
  action nextJob = all { s.phase == "jobs", s' =
    if (s.job == 5) s.with("phase", "report")
    else s.with("phase", "job-pending").with("calls", s.calls.append(jobNames.nth(s.job))) }
  action jobResult(ok: bool, changed: bool): bool = {
    val name = if (s.job < 5) jobNames.nth(s.job) else "none"
    all { s.phase == "job-pending", s' = s.with("phase", "jobs").with("job", s.job + 1)
      .with("errors", if (ok) s.errors else s.errors.append(name))
      .with("jobEffects", if (changed) s.jobEffects.union(Set(name)) else s.jobEffects) }
  }
  action report = all { s.phase == "report", s' = s.with("phase", "done")
    .with("result", if (s.errors.length() > 0) "aggregate-error" else "success") }
  action retry = all { s.phase == "done", s.invocation == 1,
    s' = initial.with("invocation", 2).with("snapshotEffects", s.snapshotEffects)
      .with("scanEffects", s.scanEffects).with("jobEffects", s.jobEffects) }
  action step = {
    nondet count = 0.to(2).oneOf()
    nondet a = Set(false, true).oneOf() nondet b = Set(false, true).oneOf()
    nondet c = Set(false, true).oneOf() nondet d = Set(false, true).oneOf()
    any { configure(a, count, b, c, d), start, registry, rpc, snapshots(a, b), nextScan,
      scanResult(a, b), returnSync, nextJob, jobResult(a, b), report, retry, s' = s }
  }
  val invariant = all { s.invocation <= 2, s.cursor <= 3, s.job <= 5,
    s.calls.length() <= 5, s.scans.length() <= s.count,
    s.calls.indices().forall(i => s.calls.nth(i) == jobNames.nth(i)),
    s.scans.indices().forall(i => s.scans.nth(i) == i + 1),
    s.calls.length() > 0 implies s.syncReturned,
    Set("registry-threw", "rpc-parse-threw").contains(s.result)
      implies not(s.syncReturned) and s.calls == List() and s.scans == List(),
    s.result == "sync-returned" implies s.onlySync and s.syncReturned,
    Set("success", "aggregate-error").contains(s.result)
      implies s.syncReturned and s.calls == jobNames and s.scans.length() == s.count,
    s.result == "success" implies s.errors == List(),
    s.result == "aggregate-error" implies s.errors.length() > 0 }
  action toSnapshots = start.then(registry).then(rpc)
  action scan(ok: bool, changed: bool): bool = nextScan.then(scanResult(ok, changed))
  action completeSync = toSnapshots.then(snapshots(true, false)).then(scan(true, false))
    .then(scan(true, false)).then(nextScan).then(returnSync)
  action completeJob = nextJob.then(jobResult(true, false))
  action failedJob = nextJob.then(jobResult(false, false))
  action completeJobs = completeJob.then(completeJob).then(completeJob).then(completeJob).then(completeJob).then(nextJob).then(report)
  run registryFailureAbortsBeforeJobsTest = init.then(configure(false, 2, true, false, false))
    .then(start).then(registry).expect(s.result == "registry-threw" and invariant)
  run rpcParseFailureAbortsBeforeSnapshotsTest = init.then(configure(false, 2, false, true, true))
    .then(toSnapshots).expect(s.result == "rpc-parse-threw" and s.errors == List("registry") and invariant)
  run registryProblemsDoNotStopJobsTest = init.then(configure(false, 2, false, false, true))
    .then(completeSync).then(completeJobs).expect(s.result == "aggregate-error" and s.errors == List("registry") and invariant)
  run syncReturnsFailuresInsteadOfThrowingTest = init.then(configure(true, 2, false, false, true))
    .then(toSnapshots).then(snapshots(false, true)).then(scan(false, true)).then(scan(true, false))
    .then(nextScan).then(returnSync).expect(s.result == "sync-returned" and s.errors == List("registry", "snapshots", "scan-1") and invariant)
  run snapshotFailureStillScansEveryDeploymentTest = init.then(toSnapshots).then(snapshots(false, true))
    .then(scan(true, true)).then(scan(true, false)).then(nextScan).then(returnSync).then(completeJobs)
    .expect(s.scans == List(1, 2) and s.snapshotEffects == Set(1) and s.result == "aggregate-error" and invariant)
  run firstScanFailureDoesNotSkipNextScanTest = init.then(toSnapshots).then(snapshots(true, false))
    .then(scan(false, true)).then(scan(true, true)).then(nextScan).then(returnSync).then(completeJobs)
    .expect(s.scans == List(1, 2) and s.scanEffects == Set(1, 2) and s.errors == List("scan-1") and invariant)
  run scanWaitsForSnapshotJoinTest = init.then(toSnapshots).expect(s.scans == List()).then(nextScan.fail())
  run jobsWaitForSyncReturnTest = init.then(toSnapshots).then(snapshots(true, false)).then(nextJob.fail())
  run jobsDoNotOverlapTest = init.then(completeSync).then(nextJob).expect(s.calls == List("recovery")).then(nextJob.fail())
  run allJobFailuresAreReportedInCallOrderTest = init.then(completeSync)
    .then(failedJob).then(failedJob).then(failedJob).then(failedJob).then(failedJob).then(nextJob).then(report)
    .expect(s.calls == jobNames and s.errors == jobNames and s.result == "aggregate-error" and invariant)
  run errorDoesNotRollBackJobEffectTest = init.then(completeSync).then(nextJob).then(jobResult(false, true))
    .then(completeJob).then(completeJob).then(completeJob).then(completeJob).then(nextJob).then(report)
    .expect(s.jobEffects == Set("recovery") and s.result == "aggregate-error" and invariant)
  run laterMalformedConfigurationCanStillReachDispatchTest = init.then(completeSync).then(completeJob)
    .then(failedJob).then(failedJob).then(failedJob).then(completeJob).then(nextJob).then(report)
    .expect(s.calls == jobNames and s.errors == List("reconcile", "coordinator", "commit") and invariant)
  run emptyRegistryStillRunsJobsTest = init.then(configure(false, 0, false, false, true))
    .then(toSnapshots).then(snapshots(true, false)).then(nextScan).then(returnSync).then(completeJobs)
    .expect(s.scans == List() and s.calls == jobNames and s.result == "aggregate-error" and invariant)
  run successfulReturnDoesNotRequirePaymentEffectsTest = init.then(completeSync).then(completeJobs)
    .expect(s.result == "success" and s.jobEffects == Set() and invariant)
  run retryDoesNotErasePriorDurableEffectsTest = init.then(toSnapshots).then(snapshots(false, true))
    .then(scan(false, true)).then(scan(true, false)).then(nextScan).then(returnSync).then(completeJobs)
    .then(retry).then(completeSync).then(completeJobs)
    .expect(s.invocation == 2 and s.snapshotEffects == Set(1) and s.scanEffects == Set(1) and s.result == "success" and invariant)
}
