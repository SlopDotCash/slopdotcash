// @source skills/project-contributor-template/scripts/live-report.mjs
// @evidence scripts/contributor-discovery-lifetime.test.ts
// Two owners, one command and at most two lock generations. The child may
// outlive both processes. A persisted startup guard or unknown legacy lease
// never expires into evidence of child termination. Source-only, unexecuted.
// Publication/rollback and post-rename cleanup are refined separately in
// contributor_lock_publication; commitAcquire here is an accepted acquisition.
module contributor_discovery_lock {
  type S = { owner: int, parentLive: bool, generation: int, guard: str,
    candidate: int, observedClear: bool, requestOwner: int, requestPresent: bool,
    helperLive: bool, phase: str, commandLease: bool, childLive: bool,
    childPublished: bool, closeObserved: bool, launchOwner: int, primaryFailure: int,
    pastOldGrace: bool, report: bool }
  var s: S
  action init = s' = { owner: 0, parentLive: false, generation: 0, guard: "none",
    candidate: 0, observedClear: false, requestOwner: 0, requestPresent: false,
    helperLive: false, phase: "none", commandLease: false, childLive: false,
    childPublished: false, closeObserved: false, launchOwner: 0, primaryFailure: 0,
    pastOldGrace: false, report: false }
  val commandActive = s.commandLease and
    (s.helperLive or not(s.childPublished) or s.childLive)
  action enterAcquire(owner: int): bool = all {
    s.guard == "none", Set(1, 2).contains(owner), s.generation < 2,
    s' = s.with("guard", "acquire").with("candidate", owner).with("observedClear", false) }
  // The scan/rename gap is explicit. Startup cannot enter while this guard is held.
  action observeClear = all { s.guard == "acquire", not(s.parentLive), not(commandActive),
    s' = s.with("observedClear", true) }
  action commitAcquire = all { s.guard == "acquire", s.observedClear,
    s' = s.with("owner", s.candidate).with("parentLive", true)
      .with("generation", s.generation + 1).with("guard", "none")
      .with("commandLease", false).with("childPublished", false)
      .with("requestPresent", false).with("primaryFailure", 0)
      .with("phase", if (s.helperLive) s.phase else "none") }
  action refuseAcquire = all { s.guard == "acquire", not(s.observedClear),
    s' = s.with("guard", "none") }
  // Atomic sync guard: a stale/released handle cannot publish into a successor.
  action request(owner: int): bool = all {
    s.guard == "none", s.owner == owner, s.parentLive,
    Set("none", "done", "refused").contains(s.phase), not(commandActive),
    s' = s.with("requestOwner", owner).with("requestPresent", true)
      .with("helperLive", true).with("phase", "waiting").with("primaryFailure", 0) }
  // A helper may have read its request before a dead owner's lock was replaced.
  action beginStartup = all { s.guard == "none", s.helperLive, s.phase == "waiting",
    s' = s.with("guard", "startup").with("phase", "checking") }
  action admitStartup = all { s.guard == "startup", s.phase == "checking",
    s.requestOwner == s.owner, s.owner != 0,
    s' = s.with("commandLease", true).with("childPublished", false)
      .with("closeObserved", false).with("phase", "admitted") }
  action refuseStartup = all { s.guard == "startup", s.phase == "checking",
    s.requestOwner != s.owner or s.owner == 0,
    s' = s.with("guard", "none").with("helperLive", false).with("phase", "refused") }
  action child = all { s.guard == "startup", s.phase == "admitted", s.helperLive,
    s' = s.with("childLive", true).with("launchOwner", s.owner).with("phase", "unpublished") }
  action publishChildIdentity = all {
    s.guard == "startup", s.phase == "unpublished", s.helperLive, s.childLive,
    s' = s.with("childPublished", true).with("phase", "published") }
  action bookkeepingFailure = all {
    s.guard == "startup", Set("admitted", "unpublished", "closed").contains(s.phase),
    s' = s.with("phase", "closing").with("primaryFailure", 1) }
  action failedSpawnClose = all {
    s.guard == "startup", s.phase == "closing", not(s.childLive),
    s' = s.with("closeObserved", true) }
  action releaseStartup = all { s.guard == "startup", s.helperLive,
    s.childPublished or (not(s.childLive) and s.closeObserved),
    Set("published", "closed", "closing").contains(s.phase),
    s' = s.with("guard", "none").with("phase", if (s.childLive) "running" else "closed") }
  action childStops = all { s.childLive,
    s' = s.with("childLive", false).with("closeObserved", true)
      .with("phase", if (s.guard == "crashed") "crashed" else "closed") }
  action helperDies = all { s.helperLive,
    s' = s.with("helperLive", false)
      .with("guard", if (s.guard == "startup") "crashed" else s.guard)
      .with("phase", if (s.guard == "startup" or s.commandLease) "crashed" else "done") }
  action parentDies = all { s.parentLive, s' = s.with("parentLive", false) }
  action cleanupCommand(fails: bool): bool = all {
    s.guard == "none", s.helperLive, s.commandLease, not(s.childLive),
    s' = s.with("helperLive", false).with("commandLease", fails)
      .with("phase", "done").with("requestPresent", false)
      .with("primaryFailure", if (fails and s.primaryFailure == 0) 2 else s.primaryFailure) }
  action release(owner: int): bool = all {
    s.guard == "none", s.owner == owner, s.parentLive, not(commandActive),
    s' = s.with("owner", 0).with("parentLive", false).with("requestPresent", false) }
  action report = all { s.parentLive, s' = s.with("report", true) }
  action timePasses = s' = s.with("pastOldGrace", true)
  // Existing old-version rows are input states, not a new runtime transition.
  action legacyUnknown(live: bool): bool = all {
    s.guard == "none", s.owner != 0, s.phase == "none", not(s.commandLease),
    s' = s.with("parentLive", false).with("commandLease", true)
      .with("childPublished", false).with("childLive", live)
      .with("closeObserved", false).with("launchOwner", s.owner).with("phase", "crashed") }
  // External manual recovery requires all affected processes positively stopped.
  // This does not model an application route that guesses whether they stopped.
  action manualRecovery = all {
    not(s.parentLive), not(s.helperLive), not(s.childLive),
    s.guard == "crashed" or (s.guard == "none" and s.commandLease and not(s.childPublished)),
    s' = s.with("guard", "none").with("commandLease", false)
      .with("requestPresent", false).with("phase", "done") }
  action step = {
    nondet owner = Set(1, 2).oneOf()
    nondet flag = Set(false, true).oneOf()
    any { enterAcquire(owner), observeClear, commitAcquire, refuseAcquire,
      request(owner), beginStartup, admitStartup, refuseStartup, child,
      publishChildIdentity, bookkeepingFailure, failedSpawnClose, releaseStartup, childStops,
      helperDies, parentDies, cleanupCommand(flag), release(owner), report,
      timePasses, legacyUnknown(flag), manualRecovery, s' = s }
  }
  val invariant = all {
    s.generation <= 2,
    s.childLive implies s.owner != 0 and s.owner == s.launchOwner and s.commandLease,
    s.closeObserved implies not(s.childLive),
    s.guard == "startup" implies s.helperLive,
    s.phase == "unpublished" implies s.guard == "startup",
    s.observedClear and s.guard == "acquire" implies not(commandActive) }
  run childPreventsReclaimTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(beginStartup).then(admitStartup).then(child).then(publishChildIdentity)
    .then(releaseStartup).then(parentDies).then(enterAcquire(2)).then(observeClear.fail())
  run staleOwnerCanBeReclaimedTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(parentDies).then(enterAcquire(2)).then(observeClear).then(commitAcquire).expect(s.owner == 2)
  run crashedGuardRequiresInterventionTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(beginStartup).then(helperDies).then(parentDies).then(enterAcquire(2).fail())
  run bookkeepingFailureRetainsLaunchedChildOwnershipTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(beginStartup).then(admitStartup).then(child).then(bookkeepingFailure)
    .then(parentDies).then(enterAcquire(2).fail())
  run failedBookkeepingWaitsBeforeLeaseCleanupTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(beginStartup).then(admitStartup).then(child).then(bookkeepingFailure)
    .then(releaseStartup.fail())
  run cleanupDoesNotReplacePrimaryBookkeepingFailureTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(beginStartup).then(admitStartup).then(child).then(bookkeepingFailure)
    .then(childStops).then(releaseStartup).then(cleanupCommand(true)).expect(s.primaryFailure == 1)
  run helperBeforeSpawnBlocksReclaimTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(beginStartup).then(admitStartup).then(parentDies).then(enterAcquire(2).fail())
  run closedChildStillHasLiveHelperUntilCleanupTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(beginStartup).then(admitStartup).then(child).then(publishChildIdentity)
    .then(releaseStartup).then(childStops).then(parentDies).then(enterAcquire(2)).then(observeClear.fail())
  run delayedOldHelperRefusedAfterReclaimTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(parentDies).then(enterAcquire(2)).then(observeClear).then(commitAcquire)
    .then(beginStartup).then(refuseStartup).expect(s.owner == 2 and not(s.childLive))
  run parentDeathBeforeStartupCanStillFinishTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(parentDies).then(beginStartup).then(admitStartup).then(child)
    .then(publishChildIdentity).then(releaseStartup).expect(s.childLive and s.owner == 1)
  run reclaimScanBlocksLateStartupTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(parentDies).then(enterAcquire(2)).then(observeClear).then(beginStartup.fail())
  run helperCrashBeforePublicationRetainsGuardTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(beginStartup).then(admitStartup).then(child).then(helperDies)
    .then(parentDies).then(timePasses).then(enterAcquire(2).fail())
  run timeDoesNotReleaseLegacyUnknownLiveChildTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(legacyUnknown(true)).then(timePasses).then(enterAcquire(2)).then(observeClear.fail())
  run timeDoesNotReleaseLegacyUnknownStoppedChildTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(legacyUnknown(false)).then(timePasses).then(enterAcquire(2)).then(observeClear.fail())
  run manualRecoveryRequiresStoppedChildTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(beginStartup).then(admitStartup).then(child).then(helperDies)
    .then(parentDies).then(manualRecovery.fail())
  run stoppedCrashMayBeRecoveredExplicitlyTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(beginStartup).then(admitStartup).then(child).then(helperDies)
    .then(parentDies).then(childStops).then(manualRecovery).then(enterAcquire(2))
    .then(observeClear).then(commitAcquire).expect(s.owner == 2 and not(s.childLive))
  run publishedChildOutlivesHelperTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(beginStartup).then(admitStartup).then(child).then(publishChildIdentity)
    .then(releaseStartup).then(helperDies).then(parentDies).then(enterAcquire(2)).then(observeClear.fail())
  run publishedDeadChildAllowsReclaimTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(beginStartup).then(admitStartup).then(child).then(publishChildIdentity)
    .then(releaseStartup).then(helperDies).then(parentDies).then(childStops)
    .then(enterAcquire(2)).then(observeClear).then(commitAcquire).expect(s.owner == 2)
  run releasedHandleCannotPublishRequestTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(release(1)).then(request(1).fail())
  run staleHandleCannotPublishSuccessorRequestTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(parentDies).then(enterAcquire(2)).then(observeClear).then(commitAcquire).then(request(1).fail())
  run failedSpawnStillWaitsForCloseTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(beginStartup).then(admitStartup).then(bookkeepingFailure)
    .then(releaseStartup.fail())
  run failedSpawnCloseReleasesStartupTest = init.then(enterAcquire(1)).then(observeClear).then(commitAcquire)
    .then(request(1)).then(beginStartup).then(admitStartup).then(bookkeepingFailure)
    .then(failedSpawnClose).then(releaseStartup).then(cleanupCommand(false))
    .expect(s.guard == "none" and not(s.childLive) and not(s.commandLease))
}
