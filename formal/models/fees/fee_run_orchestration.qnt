// @source workers/fee-converter/index.ts
// @source workers/fee-converter/core.ts
// @source workers/fee-converter/store.ts
// @evidence workers/fee-converter/fee-converter.test.ts
// One runOnce invocation visits two configured networks sequentially. At most
// one restart is represented. Each network has two row/token identities.
// Clock ticks 0..4 represent seven-minute intervals; a lease lasts two ticks.
// A deployment/configuration change affects the next invocation, not the mode
// captured by this one. Key availability and lower conversion outcomes are
// supplied observations, not cryptographic or provider evidence.
//
// The cached lease result is deliberately separate from actual lease owner.
// Time/takeover may intervene after an observation. This model proves no
// continuous signing authority: native reservation and signed INSERT gates
// belong to fee_lease_journal/fee_value_journal_reply and the chain clients.
// A per-row or per-token error can still return status="ran". That status is
// completion of the network loop, not proof that all work succeeded. An outer
// failure still permits the second network before AggregateError is returned.
// A release error replaces an earlier exception, as JavaScript finally does.
module fee_run_orchestration {
  val networks = Set(1, 2)
  val tokens = Set(1, 2)
  val modes = Set("off", "dry_run", "live")
  type State = { phase: str, invocation: int, environmentMode: str, mode: str,
    trigger: str, network: int, clock: int, leaseOwner: int -> int, leaseUntil: int -> int,
    stamp: int, acquired: bool, acquireGranted: bool, cachedLease: bool, renewedAt: int,
    target: bool, rowIndex: int, tokenIndex: int, openRows: Set[int], candidates: Set[int],
    blocked: Set[int], rowErrors: Set[int], tokenErrors: Set[int], visited: Set[int],
    keyLoaded: bool, vaultRead: bool, candidateRead: bool, localFailure: str,
    localStatus: str, results: int -> str, errors: int -> str,
    returnedRowErrors: int -> Set[int], returnedTokenErrors: int -> Set[int], outcome: str }
  var s: State
  action init = s' = { phase: "input", invocation: 0, environmentMode: "off", mode: "none",
    trigger: "receipts", network: 1, clock: 0, leaseOwner: networks.mapBy(_ => 0),
    leaseUntil: networks.mapBy(_ => 0), stamp: 0, acquired: false, acquireGranted: false,
    cachedLease: false, renewedAt: 0, target: true, rowIndex: 1, tokenIndex: 1,
    openRows: Set(), candidates: Set(), blocked: Set(), rowErrors: Set(), tokenErrors: Set(),
    visited: Set(), keyLoaded: false, vaultRead: false, candidateRead: false,
    localFailure: "none", localStatus: "ran", results: networks.mapBy(_ => "none"),
    errors: networks.mapBy(_ => "none"), returnedRowErrors: networks.mapBy(_ => Set()),
    returnedTokenErrors: networks.mapBy(_ => Set()), outcome: "none" }
  action configure(mode: str): bool = all { modes.contains(mode), s' = s.with("environmentMode", mode) }
  action configureFirstTarget(present: bool): bool = all { s.phase == "input",
    s' = s.with("target", present) }
  action begin(validConfig: bool, trigger: str): bool = all {
    s.phase == "input", s.invocation < 2, Set("receipts", "recovery").contains(trigger),
    s' = s.with("invocation", s.invocation + 1).with("mode", s.environmentMode)
      .with("trigger", trigger).with("network", 1).with("outcome", "none")
      .with("results", networks.mapBy(_ => "none")).with("errors", networks.mapBy(_ => "none"))
      .with("phase", if (s.environmentMode == "off" or not(validConfig)) "done" else "acquire")
      .with("outcome", if (s.environmentMode == "off") "off" else if (not(validConfig)) "configuration-error" else "none") }
  action advanceClock = all { s.clock < 4, s' = s.with("clock", s.clock + 1) }
  action takeover = all { s.phase != "input", s.clock > s.leaseUntil.get(s.network),
    s' = s.with("leaseOwner", s.leaseOwner.set(s.network, 3))
      .with("leaseUntil", s.leaseUntil.set(s.network, s.clock + 2)) }
  // The acquire request commits before its reply reaches runNetwork's try.
  action acquire = {
    val granted = s.leaseOwner.get(s.network) == 0 or s.leaseUntil.get(s.network) < s.clock
    all { s.phase == "acquire",
      s' = s.with("stamp", s.clock).with("acquireGranted", granted).with("phase", "acquire-reply")
        .with("leaseOwner", if (granted) s.leaseOwner.set(s.network, s.invocation) else s.leaseOwner)
        .with("leaseUntil", if (granted) s.leaseUntil.set(s.network, s.clock + 2) else s.leaseUntil) }
  }
  action acquireReply(delivered: bool): bool = all { s.phase == "acquire-reply",
    s' = if (not(delivered)) s.with("localFailure", "acquire-reply").with("phase", "network-done")
      else if (not(s.acquireGranted)) s.with("localStatus", "locked").with("phase", "network-done")
      else s.with("acquired", true).with("cachedLease", true).with("renewedAt", s.stamp).with("phase", "client") }
  def throwNetwork(reason: str): State = s.with("localFailure", reason).with("phase", "release")
  action clientReply(available: bool): bool = all { s.phase == "client",
    s' = if (available) s.with("keyLoaded", s.mode == "live" and s.target).with("phase", "native")
      else throwNetwork("client") }
  action nativeReply(ok: bool): bool = all { s.phase == "native",
    s' = if (ok) s.with("phase", "rows") else throwNetwork("native-reconciliation") }
  action rowsReply(rows: Set[int]): bool = all { s.phase == "rows", rows.subseteq(tokens),
    s' = s.with("openRows", rows).with("rowIndex", 1).with("phase", "reconcile") }
  action reconcileRow(result: str): bool = all { s.phase == "reconcile", s.rowIndex <= 2,
    Set("settled", "open", "error").contains(result),
    s' = s.with("rowIndex", s.rowIndex + 1)
      .with("blocked", if (s.openRows.contains(s.rowIndex) and result != "settled") s.blocked.union(Set(s.rowIndex)) else s.blocked)
      .with("rowErrors", if (s.openRows.contains(s.rowIndex) and result == "error") s.rowErrors.union(Set(s.rowIndex)) else s.rowErrors) }
  action reconciled = all { s.phase == "reconcile", s.rowIndex == 3, s' = s.with("phase", "target") }
  action targetAvailable(value: bool): bool = all { s.phase == "target", value == s.target,
    s' = s.with("target", value).with("phase", if (value) "candidates" else "release")
      .with("localStatus", if (value) "ran" else "not_converted") }
  action candidatesReply(ok: bool, candidates: Set[int]): bool = all {
    s.phase == "candidates", candidates.subseteq(tokens),
    s' = if (not(ok)) throwNetwork("candidates") else s.with("candidates", candidates)
      .with("candidateRead", true).with("phase", if (s.trigger == "recovery") "vaults" else "budget") }
  action vaultsReply(ok: bool): bool = all { s.phase == "vaults",
    s' = if (ok) s.with("vaultRead", true).with("phase", "budget") else throwNetwork("vaults") }
  action budgetReply(ok: bool): bool = all { s.phase == "budget",
    s' = if (ok) s.with("tokenIndex", 1).with("phase", "candidate") else throwNetwork("budget") }
  action visit = all { s.phase == "candidate",
    s' = if (s.tokenIndex > 2) s.with("phase", "release")
      else if (not(s.candidates.contains(s.tokenIndex)) or s.blocked.contains(s.tokenIndex))
        s.with("tokenIndex", s.tokenIndex + 1)
      else s.with("phase", "lease-check") }
  action checkLease = all { s.phase == "lease-check",
    s' = if (not(s.cachedLease)) s.with("phase", "release")
      else if (s.clock - s.renewedAt < 1) s.with("phase", "balance")
      else s.with("stamp", s.clock).with("phase", "renew") }
  action renew = {
    val granted = s.leaseOwner.get(s.network) == s.invocation and s.leaseUntil.get(s.network) >= s.stamp
    all { s.phase == "renew", s' = s.with("acquireGranted", granted).with("phase", "renew-reply")
      .with("leaseUntil", if (granted) s.leaseUntil.set(s.network, s.stamp + 2) else s.leaseUntil) }
  }
  action renewReply(delivered: bool): bool = all { s.phase == "renew-reply",
    s' = if (not(delivered)) throwNetwork("renew-reply")
      else s.with("cachedLease", s.acquireGranted)
        .with("renewedAt", if (s.acquireGranted) s.stamp else s.renewedAt)
        .with("phase", if (s.acquireGranted) "balance" else "release") }
  def nextToken: State = s.with("tokenIndex", s.tokenIndex + 1).with("phase", "candidate")
  action balanceReply(outcome: str): bool = all { s.phase == "balance", Set("zero", "positive", "error").contains(outcome),
    s' = if (outcome == "error") nextToken.with("tokenErrors", s.tokenErrors.union(Set(s.tokenIndex)))
      else if (outcome == "zero") nextToken
      else s.with("phase", if (s.trigger == "receipts") "latest" else "convert") }
  action latestReply(outcome: str): bool = all { s.phase == "latest", Set("unchanged", "evaluate", "error").contains(outcome),
    s' = if (outcome == "evaluate") s.with("phase", "convert")
      else if (outcome == "error") nextToken.with("tokenErrors", s.tokenErrors.union(Set(s.tokenIndex))) else nextToken }
  // The lower conversion contract owns signing, journal and cap evidence.
  action conversionReply(errored: bool): bool = all { s.phase == "convert",
    s' = nextToken.with("visited", s.visited.union(Set(s.tokenIndex)))
      .with("tokenErrors", if (errored) s.tokenErrors.union(Set(s.tokenIndex)) else s.tokenErrors) }
  // releaseLock receives a Date before awaiting DELETE. Its SQL compares the
  // retained expiry with that captured timestamp, not the later wall clock.
  action captureRelease = all { s.phase == "release", s.acquired,
    s' = s.with("stamp", s.clock).with("phase", "release-sql") }
  action commitRelease = all { s.phase == "release-sql",
    s' = s.with("leaseOwner", if (s.leaseOwner.get(s.network) == s.invocation and s.leaseUntil.get(s.network) >= s.stamp)
        s.leaseOwner.set(s.network, 0) else s.leaseOwner).with("phase", "release-reply") }
  action refuseRelease = all { s.phase == "release-sql",
    s' = s.with("localFailure", "release-write").with("phase", "network-done") }
  action releaseReply(delivered: bool): bool = all { s.phase == "release-reply",
    s' = s.with("localFailure", if (delivered) s.localFailure else "release-reply").with("phase", "network-done") }
  action release(delivered: bool): bool = captureRelease.then(commitRelease).then(releaseReply(delivered))
  action finishNetwork = {
    val errors = s.errors.set(s.network, s.localFailure)
    val results = s.results.set(s.network, if (s.localFailure == "none") s.localStatus else "error")
    all { s.phase == "network-done",
      s' = s.with("errors", errors).with("results", results)
        .with("returnedRowErrors", s.returnedRowErrors.set(s.network, s.rowErrors))
        .with("returnedTokenErrors", s.returnedTokenErrors.set(s.network, s.tokenErrors))
        .with("phase", if (s.network == 1) "acquire" else "done")
        .with("outcome", if (s.network == 1) "none" else if (networks.exists(n => errors.get(n) != "none")) "aggregate-error" else "returned")
        .with("network", if (s.network == 1) 2 else 2).with("acquired", false).with("keyLoaded", false)
        .with("cachedLease", false).with("target", true).with("localStatus", "ran").with("localFailure", "none")
        .with("rowErrors", Set()).with("tokenErrors", Set()).with("blocked", Set()).with("visited", Set())
        .with("vaultRead", false).with("candidateRead", false) }
  }
  action interrupt = all { s.phase != "input", s.phase != "done", s.phase != "interrupted",
    s' = s.with("phase", "interrupted").with("outcome", "interrupted") }
  action restart = all { s.phase == "interrupted", s.invocation < 2,
    s' = s.with("phase", "input").with("acquired", false).with("cachedLease", false)
      .with("localFailure", "none").with("localStatus", "ran").with("blocked", Set())
      .with("rowErrors", Set()).with("tokenErrors", Set()).with("visited", Set()).with("keyLoaded", false) }
  action step = {
    nondet mode = modes.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet result = Set("settled", "open", "error").oneOf()
    nondet amount = Set("zero", "positive", "error").oneOf()
    nondet latest = Set("unchanged", "evaluate", "error").oneOf()
    nondet selected = Set(Set(), Set(1), Set(2), tokens).oneOf()
    any { configure(mode), configureFirstTarget(yes), begin(yes, "receipts"), begin(yes, "recovery"), advanceClock, takeover,
      acquire, acquireReply(yes), clientReply(yes), nativeReply(yes), rowsReply(selected), reconcileRow(result),
      reconciled, targetAvailable(yes), candidatesReply(yes, selected), vaultsReply(yes), budgetReply(yes),
      visit, checkLease, renew, renewReply(yes), balanceReply(amount), latestReply(latest), conversionReply(yes),
      captureRelease, commitRelease, refuseRelease, releaseReply(yes), finishNetwork, interrupt, restart, s' = s }
  }
  val invariant = all { s.invocation <= 2, s.network >= 1 and s.network <= 2,
    s.blocked.subseteq(tokens), s.visited.intersect(s.blocked) == Set(),
    s.mode == "dry_run" implies not(s.keyLoaded),
    s.outcome == "returned" implies networks.forall(n => s.errors.get(n) == "none"),
    s.outcome == "aggregate-error" implies networks.exists(n => s.errors.get(n) != "none"),
    s.outcome == "off" implies networks.forall(n => s.results.get(n) == "none") }
  action live = configure("live").then(begin(true, "receipts"))
  action rowsReady = acquire.then(acquireReply(true)).then(clientReply(true)).then(nativeReply(true))
  action noRows = rowsReady.then(rowsReply(Set())).then(reconcileRow("settled")).then(reconcileRow("settled")).then(reconciled)
  action emptyNetwork = noRows.then(targetAvailable(true)).then(candidatesReply(true, Set())).then(budgetReply(true))
    .then(visit).then(visit).then(visit).then(release(true)).then(finishNetwork)
  run offDoesNotAcquireTest = init.then(begin(false, "recovery")).expect(s.outcome == "off" and invariant)
  run invalidConfigurationStopsBeforeNetworksTest = init.then(configure("live")).then(begin(false, "receipts"))
    .expect(s.outcome == "configuration-error" and s.results.get(1) == "none" and invariant)
  run capturedModeSurvivesDeploymentChangeTest = init.then(live).then(configure("off")).then(rowsReady)
    .expect(s.mode == "live" and s.keyLoaded and invariant)
  run nativeFailureStillVisitsSecondNetworkTest = init.then(live).then(acquire).then(acquireReply(true))
    .then(clientReply(true)).then(nativeReply(false)).then(release(true)).then(finishNetwork).then(emptyNetwork)
    .expect(s.results.get(2) == "ran" and s.outcome == "aggregate-error" and invariant)
  run rowErrorBlocksOnlyItsTokenTest = init.then(live).then(rowsReady).then(rowsReply(Set(1)))
    .then(reconcileRow("error")).then(reconcileRow("settled")).then(reconciled).then(targetAvailable(true))
    .then(candidatesReply(true, tokens)).then(budgetReply(true)).then(visit).then(visit).then(checkLease)
    .then(balanceReply("positive")).then(latestReply("evaluate")).then(conversionReply(false))
    .then(visit).then(release(true)).then(finishNetwork).then(emptyNetwork)
    .expect(s.returnedRowErrors.get(1) == Set(1) and s.results.get(1) == "ran" and s.outcome == "returned" and invariant)
  run tokenErrorCanReturnRanTest = init.then(live).then(noRows).then(targetAvailable(true))
    .then(candidatesReply(true, Set(1))).then(budgetReply(true)).then(visit).then(checkLease).then(balanceReply("error"))
    .then(visit).then(visit).then(release(true)).then(finishNetwork).then(emptyNetwork)
    .expect(s.returnedTokenErrors.get(1) == Set(1) and s.results.get(1) == "ran" and s.outcome == "returned" and invariant)
  run noTargetReconcilesWithoutCandidateReadTest = init.then(configureFirstTarget(false)).then(live).then(noRows).then(targetAvailable(false))
    .expect(not(s.keyLoaded) and not(s.candidateRead) and not(s.vaultRead)).then(release(true)).then(finishNetwork).then(emptyNetwork)
    .expect(s.results.get(1) == "not_converted" and invariant)
  run receiptsTriggerSkipsVaultReadTest = init.then(live).then(noRows).then(targetAvailable(true))
    .then(candidatesReply(true, Set())).expect(s.phase == "budget" and not(s.vaultRead) and invariant)
  run recoveryTriggerReadsVaultsTest = init.then(configure("live")).then(begin(true, "recovery")).then(noRows)
    .then(targetAvailable(true)).then(candidatesReply(true, Set())).then(vaultsReply(true))
    .expect(s.phase == "budget" and s.vaultRead and invariant)
  run observedLeaseCanExpireDuringBalanceTest = init.then(live).then(noRows).then(targetAvailable(true))
    .then(candidatesReply(true, Set(1))).then(budgetReply(true)).then(visit).then(checkLease)
    .then(advanceClock).then(advanceClock).then(advanceClock).then(takeover)
    .expect(s.phase == "balance" and s.cachedLease and s.leaseOwner.get(1) == 3 and invariant)
  run lostRenewalEndsCandidateLoopTest = init.then(live).then(noRows).then(targetAvailable(true))
    .then(candidatesReply(true, tokens)).then(budgetReply(true)).then(visit).then(advanceClock)
    .then(advanceClock).then(advanceClock).then(takeover).then(checkLease).then(renew).then(renewReply(true))
    .then(release(true)).then(finishNetwork).then(emptyNetwork)
    .expect(s.results.get(1) == "ran" and s.outcome == "returned" and invariant)
  run releaseFailureOverridesEarlierExceptionTest = init.then(live).then(acquire).then(acquireReply(true))
    .then(clientReply(true)).then(nativeReply(false)).then(release(false)).then(finishNetwork).then(emptyNetwork)
    .expect(s.errors.get(1) == "release-reply" and s.outcome == "aggregate-error" and invariant)
  run delayedReleaseUsesCapturedTimeForOwnRowTest = init.then(live).then(acquire).then(acquireReply(true))
    .then(clientReply(false)).then(captureRelease).then(advanceClock).then(advanceClock).then(advanceClock)
    .then(commitRelease).then(releaseReply(true))
    .expect(s.clock > s.leaseUntil.get(1) and s.leaseOwner.get(1) == 0 and invariant)
  run delayedReleaseCannotDeleteSuccessorTest = init.then(live).then(acquire).then(acquireReply(true))
    .then(clientReply(false)).then(captureRelease).then(advanceClock).then(advanceClock).then(advanceClock)
    .then(takeover).then(commitRelease).then(releaseReply(true))
    .expect(s.leaseOwner.get(1) == 3 and invariant)
  run definiteReleaseRefusalKeepsLeaseRowTest = init.then(live).then(acquire).then(acquireReply(true))
    .then(clientReply(false)).then(captureRelease).then(refuseRelease)
    .expect(s.leaseOwner.get(1) == 1 and s.localFailure == "release-write" and invariant)
  run lostReleaseReplyKeepsCommittedDeletionTest = init.then(live).then(acquire).then(acquireReply(true))
    .then(clientReply(false)).then(captureRelease).then(commitRelease).then(releaseReply(false))
    .expect(s.leaseOwner.get(1) == 0 and s.localFailure == "release-reply" and invariant)
  run lostAcquireReplyLeavesLeaseForRecoveryTest = init.then(live).then(acquire).then(acquireReply(false))
    .expect(s.leaseOwner.get(1) == 1 and not(s.acquired) and invariant)
  run restartDoesNotDiscardEarlierLeaseTest = init.then(live).then(acquire).then(interrupt).then(restart)
    .then(begin(true, "receipts")).then(acquire).then(acquireReply(true))
    .expect(s.localStatus == "locked" and s.leaseOwner.get(1) == 1 and invariant)
}
