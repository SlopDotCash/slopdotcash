// @source skills/project-contributor-template/scripts/live-report.mjs
// Atomic transition guard, PID birth identity and active child leases prevent
// ABA reclamation. A dead parent with a live GitHub child still owns the lock.
module contributor_discovery_lock {
  type S = { owner: int, parentLive: bool, childLive: bool, transition: bool, crashed: bool, generation: int, report: bool }
  var s: S
  action init = s' = { owner:0,parentLive:false,childLive:false,transition:false,crashed:false,generation:0,report:false }
  action enter = all { not(s.transition),s'=s.with("transition",true).with("crashed",false) }
  action leave = all { s.transition,not(s.crashed),s'=s.with("transition",false) }
  action acquire(owner: int): bool = all { s.transition,not(s.parentLive),not(s.childLive),s.generation<2,
    s'=s.with("owner",owner).with("parentLive",true).with("generation",s.generation+1).with("transition",false) }
  action child = all { s.parentLive,not(s.transition),s'=s.with("childLive",true) }
  action parentDies = s'=s.with("parentLive",false)
  action childStops = s'=s.with("childLive",false)
  action release(owner: int): bool = all { s.transition,s.owner==owner,not(s.childLive),s'=s.with("owner",0).with("parentLive",false).with("transition",false) }
  action crashGuard = all { s.transition,s'=s.with("parentLive",false).with("crashed",true) }
  action report = all { s.parentLive,s'=s.with("report",true) }
  action step = any { enter,leave,acquire(1),acquire(2),child,parentDies,childStops,release(1),release(2),crashGuard,report,s'=s }
  val invariant = all { s.generation<=2,s.childLive implies s.owner!=0 }
  run childPreventsReclaimTest = init.then(enter).then(acquire(1)).then(child).then(parentDies).then(enter).then(acquire(2).fail())
  run staleOwnerCanBeReclaimedTest = init.then(enter).then(acquire(1)).then(parentDies).then(enter).then(acquire(2)).expect(s.owner==2 and invariant)
  run crashedGuardRequiresInterventionTest = init.then(enter).then(crashGuard).then(enter.fail())
}
