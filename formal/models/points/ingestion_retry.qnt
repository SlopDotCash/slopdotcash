// @source scripts/generate-leaderboard.ts
// @source scripts/github-token.ts
// Atomic output and source-census retry boundary. The same client keeps the
// consumed API budget across the single complete-source retry; publication
// failure does not trigger another collection. One existing output revision.
module ingestion_retry {
  var s: {phase:str,attempt:int,cost:int,complete:bool,temporary:bool,
    published:int,error:bool}
  action init = s'={phase:"collect",attempt:1,cost:0,complete:false,
    temporary:false,published:1,error:false}
  action request = all {s.phase=="collect",s.cost<4,s'=s.with("cost",s.cost+1)}
  action censusChanged = all {s.phase=="collect",s.attempt==1,
    s'=s.with("attempt",2).with("complete",false)}
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
  action advance = any {request,censusChanged,collected,stage,activate,failure,cleanupFailure}
  action step = any {advance,s'=s}
  val invariant = all {s.attempt<=2,s.cost<=4,s.published==2 implies (Set("done","failed").contains(s.phase) and s.complete),
    s.error implies s.phase=="failed"}
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
  run cleanupFailureDoesNotUndoPublishedOutputTest = init.then(request).then(collected)
    .then(stage).then(activate).then(cleanupFailure).expect(s.error and s.published==2 and invariant)
}
