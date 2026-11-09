// @source skills/project-contributor-template/scripts/live-report.mjs
// Atomic transition guard, PID birth identity and active child leases prevent
// ABA reclamation. A dead parent with a live GitHub child still owns the lock.
module contributor_discovery_lock {
  type S = { owner: int, parentLive: bool, childLive: bool, childPublished: bool, helperLive: bool, commandLease: bool,
    primaryFailure: int, transition: bool, crashed: bool, generation: int, report: bool }
  var s: S
  action init = s' = { owner:0,parentLive:false,childLive:false,childPublished:false,helperLive:false,commandLease:false,
    primaryFailure:0,transition:false,crashed:false,generation:0,report:false }
  action enter = all { not(s.transition),s'=s.with("transition",true).with("crashed",false) }
  action leave = all { s.transition,not(s.crashed),s'=s.with("transition",false) }
  val commandActive = s.commandLease and (s.helperLive or (s.childPublished and s.childLive))
  action acquire(owner: int): bool = all { s.transition,not(s.parentLive),not(commandActive),s.generation<2,
    s'=s.with("owner",owner).with("parentLive",true).with("generation",s.generation+1).with("transition",false)
      .with("commandLease",false).with("childPublished",false).with("primaryFailure",0) }
  action helper = all { s.parentLive,not(s.transition),not(s.helperLive),not(s.commandLease),
    s'=s.with("helperLive",true).with("commandLease",true).with("childPublished",false).with("primaryFailure",0) }
  action child = all { s.parentLive,not(s.transition),not(s.childLive),s.helperLive,s.commandLease,
    s'=s.with("childLive",true) }
  action publishChildIdentity = all { s.childLive,s.helperLive,s.commandLease,
    s'=s.with("childPublished",true) }
  action bookkeepingFailure = all { s.childLive,s.helperLive,s.commandLease,
    s'=s.with("primaryFailure",if(s.primaryFailure==0)1 else s.primaryFailure) }
  action parentDies = s'=s.with("parentLive",false)
  action childStops = s'=s.with("childLive",false)
  action cleanupCommand(fails:bool):bool = all { not(s.childLive),s.commandLease,
    s'=s.with("helperLive",false).with("commandLease",fails)
      .with("primaryFailure",if(fails and s.primaryFailure==0)2 else s.primaryFailure) }
  action release(owner: int): bool = all { s.transition,s.owner==owner,not(commandActive),s'=s.with("owner",0).with("parentLive",false).with("transition",false) }
  action crashGuard = all { s.transition,s'=s.with("parentLive",false).with("crashed",true) }
  action report = all { s.parentLive,s'=s.with("report",true) }
  action step = any { enter,leave,acquire(1),acquire(2),helper,child,publishChildIdentity,bookkeepingFailure,parentDies,childStops,
    cleanupCommand(false),cleanupCommand(true),release(1),release(2),crashGuard,report,s'=s }
  val invariant = all { s.generation<=2,s.childLive implies s.owner!=0 and s.helperLive and s.commandLease }
  run childPreventsReclaimTest = init.then(enter).then(acquire(1)).then(helper).then(child).then(parentDies).then(enter).then(acquire(2).fail())
  run staleOwnerCanBeReclaimedTest = init.then(enter).then(acquire(1)).then(parentDies).then(enter).then(acquire(2)).expect(s.owner==2 and invariant)
  run crashedGuardRequiresInterventionTest = init.then(enter).then(crashGuard).then(enter.fail())
  run bookkeepingFailureRetainsLaunchedChildOwnershipTest = init.then(enter).then(acquire(1)).then(helper).then(child)
    .then(bookkeepingFailure).then(parentDies).then(enter).then(acquire(2).fail())
  run failedBookkeepingWaitsBeforeLeaseCleanupTest = init.then(enter).then(acquire(1)).then(helper).then(child)
    .then(bookkeepingFailure).then(cleanupCommand(false).fail())
  run cleanupDoesNotReplacePrimaryBookkeepingFailureTest = init.then(enter).then(acquire(1)).then(helper).then(child)
    .then(bookkeepingFailure).then(childStops).then(cleanupCommand(true)).expect(s.primaryFailure==1)
  run helperBeforeSpawnBlocksReclaimTest = init.then(enter).then(acquire(1)).then(helper)
    .then(parentDies).then(enter).then(acquire(2).fail())
  run closedChildStillHasLiveHelperUntilCleanupTest = init.then(enter).then(acquire(1)).then(helper).then(child)
    .then(publishChildIdentity).then(childStops).then(parentDies).then(enter).then(acquire(2).fail())
}
