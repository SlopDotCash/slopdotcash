// @source scripts/generate-leaderboard.ts
// @source scripts/github-token.ts
// Atomic output and source-census retry boundary. The same client keeps the
// consumed API budget across the single complete-source retry; publication
// failure does not trigger another collection. One existing output revision.
// A joint member outside the census is held in the first attempt only after
// three probes, each a counted request, all report it unavailable. A probe
// that differs discards the attempt like any census change. The retry holds on
// its own single probe (operator decision, 20 November 2026).
module ingestion_retry {
  var s: {phase:str,attempt:int,cost:int,complete:bool,temporary:bool,
    published:int,error:bool,probes:int,held:bool}
  action init = s'={phase:"collect",attempt:1,cost:0,complete:false,
    temporary:false,published:1,error:false,probes:0,held:false}
  action request = all {s.phase=="collect",s.cost<4,s'=s.with("cost",s.cost+1)}
  action censusChanged = all {s.phase=="collect",s.attempt==1,
    s'=s.with("attempt",2).with("complete",false).with("probes",0).with("held",false)}
  action jointProbeUnavailable = all {s.phase=="collect",not(s.held),s.cost<4,s.probes<3,
    s'=s.with("cost",s.cost+1).with("probes",s.probes+1)}
  action jointProbeDiffers = all {s.phase=="collect",not(s.held),s.attempt==1,s.cost<4,
    s.probes>0,s.probes<3,
    s'=s.with("cost",s.cost+1).with("attempt",2).with("complete",false).with("probes",0)}
  action holdJointSource = all {s.phase=="collect",not(s.held),
    or {s.probes==3, and {s.attempt==2,s.probes>0}},
    s'=s.with("held",true)}
  action collected = all {s.phase=="collect",s.cost>0,
    s'=s.with("phase","validate").with("complete",true)}
  action stage = all {s.phase=="validate",s.complete,
    s'=s.with("phase","write").with("temporary",true)}
  action activate = all {s.phase=="write",s.temporary,s.complete,
    s'=s.with("phase","done").with("published",2).with("temporary",false)}
  action failure = all {s.phase!="done",s'=s.with("phase","failed").with("error",true).with("temporary",false)}
  // rename commits the output before finally removes the old temporary path.
  // A cleanup error is visible to the caller without rolling back that rename.
  action cleanupFailure = all {s.phase=="done",s'=s.with("phase","failed").with("error",true)}
  action advance = any {request,censusChanged,jointProbeUnavailable,jointProbeDiffers,
    holdJointSource,collected,stage,activate,failure,cleanupFailure}
  action step = any {advance,s'=s}
  val invariant = all {s.attempt<=2,s.cost<=4,s.published==2 implies (Set("done","failed").contains(s.phase) and s.complete),
    s.error implies s.phase=="failed",s.probes<=3,
    s.held implies (s.probes==3 or (s.attempt==2 and s.probes>0))}
  // If the bounded request/write machinery keeps making enabled progress,
  // collection settles successfully or fails visibly; it cannot retry forever.
  // Fairness applies to a non-stuttering advance, not the whole step relation.
  // It requires scheduling progress, never provider or publication success.
  temporal terminationProperty = advance.weakFair(s).implies(eventually(
    Set("done","failed").contains(s.phase)))
  run retryPreservesCostTest = init.then(request).then(censusChanged).expect(s.cost==1 and s.attempt==2)
  run writeFailureRetainsOldSnapshotTest = init.then(request).then(collected).then(stage).then(failure)
    .expect(s.published==1 and s.phase=="failed" and invariant)
  run oneCompleteRetryTest = init.then(request).then(censusChanged).then(request).then(collected)
    .then(stage).then(activate).expect(s.published==2 and s.cost==2 and invariant)
  run secondCensusChangeStopsTest = init.then(censusChanged).then(censusChanged.fail())
  run confirmedJointHoldPublishesFirstAttemptTest = init.then(jointProbeUnavailable)
    .then(jointProbeUnavailable).then(jointProbeUnavailable).then(holdJointSource)
    .then(collected).then(stage).then(activate)
    .expect(s.published==2 and s.attempt==1 and s.held and s.cost==3 and invariant)
  run unconfirmedJointProbeCannotHoldFirstAttemptTest = init.then(jointProbeUnavailable)
    .then(jointProbeUnavailable).then(holdJointSource.fail())
  run differingJointProbeRecollectsOnceTest = init.then(jointProbeUnavailable)
    .then(jointProbeDiffers).expect(s.attempt==2 and s.probes==0 and not(s.held))
    .then(jointProbeUnavailable).then(holdJointSource)
    .then(collected).then(stage).then(activate)
    .expect(s.published==2 and s.attempt==2 and s.held and s.cost==3 and invariant)
  run secondDifferingJointProbeStopsTest = init.then(jointProbeUnavailable)
    .then(jointProbeDiffers).then(jointProbeUnavailable).then(jointProbeDiffers.fail())
  run cleanupFailureDoesNotUndoPublishedOutputTest = init.then(request).then(collected)
    .then(stage).then(activate).then(cleanupFailure).expect(s.error and s.published==2 and invariant)
}
