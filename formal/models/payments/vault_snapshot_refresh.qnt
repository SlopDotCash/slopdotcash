// @source backend/payments/vault-snapshots.ts
// @evidence backend/payments/vault-snapshots.test.ts
// Six deployments, four workers, one invocation. Input order is fixed; the
// shared synchronous next++ assigns each index once before its first await.
// Representative outcome profiles avoid multiplying unrelated parser inputs.
// Reader and store internals are delegated; vault_snapshot_store refines the
// latter. Missing RPC, read/store failures, stored and older are distinct.
// A failed store reply may follow a durable write; durable effects are separate
// from successfully returned stored results. All survive aggregate failure.
// Reported failures sort by
// input index, not completion order. No timeout/fairness guarantee is invented;
// a host interruption can leave work pending and stored rows retained.
// The caller supplies a valid Date. Source reads now.toISOString() after each
// reader resolves; immutability of a caller-owned Date is not a store guarantee.
// New scenarios and regression definitions are source-only and unexecuted.
module vault_snapshot_refresh {
  val workers = Set(0, 1, 2, 3)
  val jobs = Set(0, 1, 2, 3, 4, 5)
  val orderedJobs = List(0, 1, 2, 3, 4, 5)
  val emptyState = Map(0 -> "new", 1 -> "new", 2 -> "new", 3 -> "new", 4 -> "new", 5 -> "new")
  val normalOutcomes = Map(0 -> "stored", 1 -> "stored", 2 -> "stored", 3 -> "stored", 4 -> "stored", 5 -> "stored")
  type State = { phase: str, count: int, nextIndex: int, active: int -> int,
    state: int -> str, outcomes: int -> str, claimed: List[int], reads: List[int],
    stored: Set[int], durable: Set[int], older: Set[int], failed: Set[int], failedOrder: List[int],
    reportedErrors: List[int], reply: str }
  var s: State
  action init = s' = { phase: "input", count: 6, nextIndex: 0,
    active: Map(0 -> -1, 1 -> -1, 2 -> -1, 3 -> -1),
    state: emptyState, outcomes: normalOutcomes, claimed: List(), reads: List(),
    stored: Set(), durable: Set(), older: Set(), failed: Set(), failedOrder: List(),
    reportedErrors: List(), reply: "none" }
  action configure(count: int, profile: int): bool = {
    val outcomes = if (profile == 1) normalOutcomes.set(0, "missing")
      else if (profile == 2) normalOutcomes.set(0, "read-error")
      else if (profile == 3) normalOutcomes.set(0, "store-error")
      else if (profile == 4) normalOutcomes.set(0, "older")
      else if (profile == 5) normalOutcomes.set(0, "read-error").set(1, "missing").set(2, "store-error").set(3, "older")
      else if (profile == 6) normalOutcomes.set(0, "store-lost")
      else normalOutcomes
    all { s.phase == "input", 0.to(6).contains(count), 0.to(6).contains(profile),
      s' = s.with("count", count).with("outcomes", outcomes) }
  }
  action begin = all { s.phase == "input", s' = s.with("phase", "running") }
  def workerLimit: int = if (s.count < 4) s.count else 4
  def assigned(who: int): int = s.active.get(who)
  def completeFailure(who: int): State = {
    val id = assigned(who)
    if (jobs.contains(id)) s.with("state", s.state.set(id, "failed")).with("active", s.active.set(who, -1))
      .with("failed", s.failed.union(Set(id))).with("failedOrder", s.failedOrder.append(id)) else s
  }
  action claim(who: int): bool = all { s.phase == "running", who < workerLimit,
    assigned(who) == -1, s.nextIndex < s.count,
    s' = s.with("active", s.active.set(who, s.nextIndex)).with("nextIndex", s.nextIndex + 1)
      .with("state", s.state.set(s.nextIndex, "rpc")).with("claimed", s.claimed.append(s.nextIndex)) }
  action checkRpc(who: int): bool = {
    val id = assigned(who)
    val valid = jobs.contains(id)
    val phase = if (valid) s.state.get(id) else "none"
    val outcome = if (valid) s.outcomes.get(id) else "none"
    all { s.phase == "running", phase == "rpc", s' =
      if (not(valid)) s else if (outcome == "missing") completeFailure(who)
      else s.with("state", s.state.set(id, "read")).with("reads", s.reads.append(id)) }
  }
  action readResult(who: int): bool = {
    val id = assigned(who)
    val phase = if (jobs.contains(id)) s.state.get(id) else "none"
    val outcome = if (jobs.contains(id)) s.outcomes.get(id) else "none"
    all { s.phase == "running", phase == "read", s' =
      if (not(jobs.contains(id))) s else if (outcome == "read-error") completeFailure(who)
      else s.with("state", s.state.set(id, "store")) }
  }
  action storeResult(who: int): bool = {
    val id = assigned(who)
    val phase = if (jobs.contains(id)) s.state.get(id) else "none"
    val outcome = if (jobs.contains(id)) s.outcomes.get(id) else "none"
    val finished = if (jobs.contains(id)) s.with("state", s.state.set(id, "done")).with("active", s.active.set(who, -1)) else s
    all { s.phase == "running", phase == "store", s' =
      if (outcome == "store-error") completeFailure(who)
      else if (outcome == "store-lost") completeFailure(who).with("durable", s.durable.union(Set(id)))
      else if (outcome == "older") finished.with("older", s.older.union(Set(id)))
      else finished.with("stored", s.stored.union(Set(id))).with("durable", s.durable.union(Set(id))) }
  }
  action report = all { s.phase == "running", s.nextIndex == s.count,
    workers.forall(who => assigned(who) == -1),
    s' = s.with("phase", "done").with("reportedErrors", orderedJobs.select(id => s.failed.contains(id)))
      .with("reply", if (s.failed.size() == 0) "success" else "aggregate-error") }
  action interrupt = all { s.phase == "running", s' = s.with("phase", "abandoned") }
  action step = {
    nondet who = workers.oneOf() nondet count = 0.to(6).oneOf() nondet profile = 0.to(6).oneOf()
    any { configure(count, profile), begin, claim(who), checkRpc(who), readResult(who),
      storeResult(who), report, interrupt, s' = s }
  }
  val invariant = all { s.nextIndex <= s.count, s.claimed.length() == s.nextIndex,
    s.claimed == orderedJobs.slice(0, s.nextIndex),
    workers.filter(who => assigned(who) != -1).size() <= workerLimit,
    s.stored.intersect(s.failed) == Set(), s.older.intersect(s.failed) == Set(),
    s.stored.intersect(s.older) == Set(), s.stored.subseteq(s.durable),
    s.phase == "done" implies s.nextIndex == s.count and s.stored.size() + s.older.size() + s.failed.size() == s.count,
    s.reply == "success" implies s.failed == Set(),
    s.reply == "aggregate-error" implies s.reportedErrors == orderedJobs.select(id => s.failed.contains(id)) }
  action readJob(who: int) = claim(who).then(checkRpc(who)).then(readResult(who))
  action finishJob(who: int) = readJob(who).then(storeResult(who))
  action claimFour = claim(0).then(claim(1)).then(claim(2)).then(claim(3))
  run emptyInputSucceedsWithoutWorkersTest = init.then(configure(0, 0)).then(begin).then(report).expect(s.reply == "success" and s.reads == List() and invariant)
  run oneWorkerForOneDeploymentTest = init.then(configure(1, 0)).then(begin).then(finishJob(0)).then(report).expect(s.stored == Set(0) and invariant)
  run fourPendingCallsBoundConcurrencyTest = init.then(begin).then(claimFour).expect(s.nextIndex == 4 and invariant).then(claim(0).fail())
  run slotReusedOnlyAfterStoreCompletesTest = init.then(begin).then(claimFour).then(checkRpc(0)).then(readResult(0)).then(storeResult(0)).then(claim(0)).expect(assigned(0) == 4 and s.stored == Set(0) and invariant)
  run missingRpcSkipsReaderAndContinuesTest = init.then(configure(2, 1)).then(begin).then(claim(0)).then(checkRpc(0)).then(finishJob(0)).then(report).expect(s.reads == List(1) and s.failed == Set(0) and s.stored == Set(1) and invariant)
  run readFailureReleasesSlotTest = init.then(configure(2, 2)).then(begin).then(readJob(0)).then(finishJob(0)).then(report).expect(s.failed == Set(0) and s.stored == Set(1) and invariant)
  run storeFailureDoesNotStopNextDeploymentTest = init.then(configure(2, 3)).then(begin).then(readJob(0)).then(storeResult(0)).then(finishJob(0)).then(report).expect(s.failed == Set(0) and s.stored == Set(1) and invariant)
  run olderSnapshotIsSuccessfulWithoutWriteTest = init.then(configure(1, 4)).then(begin).then(finishJob(0)).then(report).expect(s.older == Set(0) and s.stored == Set() and s.reply == "success" and invariant)
  run failureOrderFollowsInputsNotCompletionTest = init.then(configure(4, 5)).then(begin).then(claimFour)
    .then(checkRpc(2)).then(readResult(2)).then(storeResult(2)).then(checkRpc(1)).then(checkRpc(0)).then(readResult(0))
    .then(checkRpc(3)).then(readResult(3)).then(storeResult(3)).then(report)
    .expect(s.failedOrder == List(2, 1, 0) and s.reportedErrors == List(0, 1, 2) and s.older == Set(3) and invariant)
  run pendingReadPreventsReportTest = init.then(configure(1, 0)).then(begin).then(claim(0)).then(checkRpc(0)).expect(s.reply == "none" and invariant).then(report.fail())
  run pendingStorePreventsReportTest = init.then(configure(1, 0)).then(begin).then(readJob(0)).expect(s.reply == "none" and invariant).then(report.fail())
  run interruptionRetainsCompletedWritesTest = init.then(begin).then(finishJob(0)).then(claim(1)).then(checkRpc(1)).then(interrupt).expect(s.phase == "abandoned" and s.stored == Set(0) and s.reply == "none" and invariant)
  run completeBatchRetainsHealthyRowsOnAggregateErrorTest = init.then(configure(3, 2)).then(begin).then(readJob(0)).then(finishJob(0)).then(finishJob(0)).then(report).expect(s.reply == "aggregate-error" and s.stored == Set(1, 2) and invariant)
  run failedStoreReplyCanRetainDurableRowTest = init.then(configure(2, 6)).then(begin).then(finishJob(0)).then(finishJob(0)).then(report)
    .expect(s.reply == "aggregate-error" and s.failed == Set(0) and s.stored == Set(1) and s.durable == Set(0, 1) and invariant)
}
