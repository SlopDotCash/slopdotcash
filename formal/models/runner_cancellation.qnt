// @source scripts/runner-cancellation.mjs
// @source scripts/run-security-payments.mjs
// @source scripts/run-e2e.mjs
// @source scripts/prepare-e2e-fixture.mjs
// Three jobs, at most two active; one representative startup resource per job.
// Opaque startup may return a resource after cancellation. Cleanup is awaited
// before completion; its failure is not proof that the resource disappeared.
module runner_cancellation {
  var s: {next:int, preparing:Set[int], ready:Set[int], live:Set[int],
    pendingCleanup:Set[int], finished:Set[int], canceled:bool, launches:int,
    canceledLaunches:int, first:int, cleanupFailed:bool, result:str}
  action init = s'={next:1,preparing:Set(),ready:Set(),live:Set(),pendingCleanup:Set(),
    finished:Set(),canceled:false,launches:0,canceledLaunches:0,first:0,cleanupFailed:false,result:"running"}
  def primary(code:int):int = if(s.first==0) code else s.first
  action begin = all {s.result=="running",not(s.canceled),s.next<=3,
    s.preparing.size()+s.ready.size()+s.live.size()<2,
    s'=s.with("preparing",s.preparing.union(Set(s.next))).with("next",s.next+1)}
  action startupReturns(id:int):bool = all {s.preparing.contains(id),
    s'=s.with("preparing",s.preparing.exclude(Set(id))).with("ready",s.ready.union(Set(id)))
      .with("pendingCleanup",s.pendingCleanup.union(Set(id)))}
  // No resource handle was returned. This settles the rejected job, not any
  // unreturned resource hidden inside an opaque startup implementation.
  action rejectStartup(id:int,code:int):bool = all {s.preparing.contains(id),code!=0,
    s'=s.with("preparing",s.preparing.exclude(Set(id))).with("finished",s.finished.union(Set(id)))
      .with("canceled",true).with("canceledLaunches",if(s.canceled)s.canceledLaunches else s.launches)
      .with("first",primary(code))}
  action launch(id:int):bool = all {not(s.canceled),s.ready.contains(id),
    s'=s.with("ready",s.ready.exclude(Set(id))).with("live",s.live.union(Set(id)))
      .with("launches",s.launches+1)}
  action settle(id:int,code:int):bool = all {s.live.contains(id),
    s'=s.with("live",s.live.exclude(Set(id))).with("finished",s.finished.union(Set(id)))
      .with("first",if(code==0) s.first else primary(code))}
  action interrupt(code:int):bool = all {s.result=="running",
    s'=s.with("canceled",true).with("canceledLaunches",if(s.canceled) s.canceledLaunches else s.launches)
      .with("first",primary(code))}
  action discardReady(id:int):bool = all {s.canceled,s.ready.contains(id),
    s'=s.with("ready",s.ready.exclude(Set(id))).with("finished",s.finished.union(Set(id)))}
  // Settled cleanup work is removed even if it failed; failure never proves
  // a process/container disappeared and must prevent a successful result.
  action closeResource(id:int,ok:bool):bool = all {s.pendingCleanup.contains(id),s.finished.contains(id),
    s'=s.with("pendingCleanup",s.pendingCleanup.exclude(Set(id))).with("first",if(ok) s.first else primary(1)).with("cleanupFailed",s.cleanupFailed or not(ok))}
  action complete = all {s.result=="running",s.preparing.size()==0,s.ready.size()==0,
    s.live.size()==0,s.pendingCleanup.size()==0,s.canceled or s.finished.size()==3,
    s'=s.with("result",if(s.first==0)"passed" else "failed")}
  action step = {
    nondet id=Set(1,2,3).oneOf()
    any {begin,startupReturns(id),rejectStartup(id,1),launch(id),settle(id,0),settle(id,1),
      interrupt(130),interrupt(143),interrupt(129),discardReady(id),
      closeResource(id,true),closeResource(id,false),complete,s'=s}
  }
  val invariant = all {
    s.next>=1,s.next<=4,s.launches>=0,s.launches<=3,
    s.preparing.size()+s.ready.size()+s.live.size()<=2,
    s.canceled implies s.launches==s.canceledLaunches,
    s.result!="running" implies (s.preparing.size()==0 and s.ready.size()==0 and s.live.size()==0 and s.pendingCleanup.size()==0),
    s.cleanupFailed implies s.first!=0,
    s.result=="passed" implies (s.first==0 and not(s.canceled) and not(s.cleanupFailed) and s.finished.size()==3)
  }
  run beginAfterCancellationRefusedTest = init.then(interrupt(143)).then(begin.fail())
  run canceledBeforeAnyStartupTest = init.then(interrupt(143)).then(complete)
    .expect(s.launches==0 and s.first==143)
  run launchAfterCancellationRefusedTest = init.then(begin).then(interrupt(130))
    .then(startupReturns(1)).then(launch(1).fail())
  run cancellationBetweenPortsPreventsLaunchTest = init.then(begin).then(interrupt(130))
    .then(startupReturns(1)).then(discardReady(1)).then(closeResource(1,true)).then(complete)
    .expect(s.first==130 and s.pendingCleanup.size()==0)
  run activePhasePreventsCompletionTest = init.then(begin).then(begin)
    .then(startupReturns(1)).then(startupReturns(2)).then(launch(1)).then(launch(2))
    .then(interrupt(143)).then(settle(1,1)).then(complete.fail())
  run twoPhasesDrainBeforeCompletionTest = init.then(begin).then(begin)
    .then(startupReturns(1)).then(startupReturns(2)).then(launch(1)).then(launch(2))
    .then(interrupt(143)).then(settle(1,1)).then(settle(2,1))
    .then(closeResource(1,true)).then(closeResource(2,true)).then(complete)
    .expect(s.first==143 and s.finished==Set(1,2))
  run firstFailureSurvivesRepeatedSignalsTest = init.then(begin).then(startupReturns(1)).then(launch(1))
    .then(settle(1,1)).then(interrupt(143)).then(interrupt(130)).then(closeResource(1,false)).then(complete)
    .expect(s.first==1)
  run pendingCleanupPreventsCompletionTest = init.then(begin).then(interrupt(143))
    .then(startupReturns(1)).then(discardReady(1)).then(complete.fail())
  run lateStartupResourceStillClosesTest = init.then(begin).then(interrupt(143))
    .then(startupReturns(1)).then(discardReady(1)).then(closeResource(1,true)).then(complete)
    .expect(s.first==143 and s.launches==0)
  run rejectedStartupPreventsNewJobTest = init.then(begin).then(begin).then(rejectStartup(1,1))
    .then(begin.fail())
  run rejectedStartupPreventsLateLaunchTest = init.then(begin).then(begin).then(rejectStartup(1,1))
    .then(startupReturns(2)).then(launch(2).fail())
  run rejectedStartupAwaitsCleanupTest = init.then(begin).then(begin).then(rejectStartup(1,1))
    .then(startupReturns(2)).then(discardReady(2)).then(complete.fail())
  run rejectedStartupDrainsLateSiblingTest = init.then(begin).then(begin).then(rejectStartup(1,1))
    .then(startupReturns(2)).then(discardReady(2))
    .then(closeResource(2,true)).then(complete)
    .expect(s.first==1 and s.launches==0 and s.finished==Set(1,2) and s.result=="failed")
  run rejectedStartupPreservesEarlierSignalTest = init.then(begin).then(interrupt(143)).then(rejectStartup(1,1))
    .then(complete).expect(s.first==143 and s.result=="failed")
}
