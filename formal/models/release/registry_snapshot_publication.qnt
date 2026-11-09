// @source scripts/sync-project-registry.mjs
// One sync invocation and a subsequent check invocation. A pair mismatch can
// retry twice; only the first request's missing API permits the old snapshot.
// File writes are not transactional. 0 denotes invalid/partial bytes, 1 the
// retained pair, and 2 the newly rendered pair. A failed write may leave any
// of these bytes; a later check observes them rather than the prior exit code.
// No concurrent local writer is modeled. API grammar, restriction equivalence
// and canonical byte validation are predicates, not proved by this model.
// Cycle-directory staging/removal is separate in cycle_snapshot_publication.
module registry_snapshot_publication {
  var s: {phase:str,projectRevision:int,historyRevision:int,rendered:int,
    restriction:bool,coherent:bool,buildAllowed:bool,attempt:int,outcome:str,
    checkResult:str}
  action init = s'={phase:"old",projectRevision:1,historyRevision:1,rendered:0,
    restriction:false,coherent:true,buildAllowed:false,attempt:0,outcome:"none",
    checkResult:"unread"}
  action beginSync = all {s.phase=="old",s.checkResult=="unread",
    s'=s.with("phase","fetch")}
  action readPair(coherent,restricted) = all {s.phase=="fetch",coherent,
    s'=s.with("phase","rendered").with("rendered",2).with("restriction",restricted).with("buildAllowed",false)}
  action retryChangedPair = all {s.phase=="fetch",s.attempt<2,
    s'=s.with("attempt",s.attempt+1)}
  action exhaustedChangedPair = all {s.phase=="fetch",s.attempt==2,
    s'=s.with("phase","failed").with("outcome","failed")}
  action invalidOrUnavailableRead = all {s.phase=="fetch",
    s'=s.with("phase","failed").with("outcome","failed")}
  action missingApi = all {s.phase=="fetch",
    s'=if(s.attempt==0) s.with("phase","kept").with("outcome","kept")
      else s.with("phase","failed").with("outcome","failed")}
  action writeProject = all {s.phase=="rendered",s'=s.with("phase","project-written")
    .with("projectRevision",2).with("coherent",false).with("buildAllowed",false)}
  action writeHistory = all {s.phase=="project-written",s'=s.with("phase","written")
    .with("historyRevision",2).with("coherent",true).with("outcome","synced")}
  action failedProjectWrite(bytes) = all {s.phase=="rendered",Set(0,1,2).contains(bytes),
    s'=s.with("phase","failed").with("outcome","failed")
      .with("projectRevision",bytes).with("coherent",bytes==1)}
  action failedHistoryWrite(bytes) = all {s.phase=="project-written",Set(0,1,2).contains(bytes),
    s'=s.with("phase","failed").with("outcome","failed")
      .with("historyRevision",bytes).with("coherent",bytes==2)}
  val terminal = Set("old","written","failed","kept").contains(s.phase)
  val validPair = s.projectRevision!=0 and s.projectRevision==s.historyRevision and s.coherent
  action check = all {terminal,s.checkResult=="unread",validPair,
    s'=s.with("buildAllowed",true).with("checkResult","accepted")}
  action refuseCheck = all {terminal,s.checkResult=="unread",not(validPair),
    s'=s.with("checkResult","refused")}
  action step = {nondet a=Set(false,true).oneOf() nondet b=Set(false,true).oneOf()
    nondet bytes=Set(0,1,2).oneOf()
    any {beginSync,readPair(a,b),retryChangedPair,exhaustedChangedPair,
      invalidOrUnavailableRead,missingApi,writeProject,writeHistory,
      failedProjectWrite(bytes),failedHistoryWrite(bytes),check,refuseCheck,s'=s}}
  val invariant = all {s.attempt>=0,s.attempt<=2,
    s.buildAllowed implies (terminal and validPair and s.checkResult=="accepted"),
    s.outcome=="synced" implies (s.phase=="written" and s.projectRevision==2 and s.historyRevision==2),
    s.outcome=="kept" implies (s.phase=="kept" and s.attempt==0 and s.projectRevision==1 and s.historyRevision==1)}
  run inconsistentReadRefusedTest = init.then(beginSync).then(retryChangedPair)
    .then(retryChangedPair).then(exhaustedChangedPair).expect(s.outcome=="failed")
  run halfWriteCannotBuildTest = init.then(beginSync).then(readPair(true,false))
    .then(writeProject).then(failedHistoryWrite(1)).then(refuseCheck).expect(not(s.buildAllowed))
  run pairedFilesCanBuildTest = init.then(beginSync).then(readPair(true,true)).then(writeProject).then(writeHistory).then(check)
    .expect(s.buildAllowed and s.restriction and invariant)
  run refreshedPairCanSucceedTest = init.then(beginSync).then(retryChangedPair)
    .then(readPair(true,false)).then(writeProject).then(writeHistory).then(check)
    .expect(s.attempt==1 and s.outcome=="synced" and invariant)
  run firstDeploymentRetainsSnapshotTest = init.then(beginSync).then(missingApi)
    .then(check).expect(s.outcome=="kept" and s.buildAllowed and invariant)
  run disappearingApiIsNotBootstrapTest = init.then(beginSync).then(retryChangedPair)
    .then(missingApi).expect(s.outcome=="failed" and not(s.buildAllowed))
  run transportFailureDoesNotRewriteSnapshotTest = init.then(beginSync)
    .then(invalidOrUnavailableRead).expect(s.projectRevision==1 and s.historyRevision==1 and s.outcome=="failed")
  run partialProjectWriteIsRefusedTest = init.then(beginSync).then(readPair(true,false))
    .then(failedProjectWrite(0)).then(refuseCheck).expect(not(s.buildAllowed))
  run partialHistoryWriteIsRefusedTest = init.then(beginSync).then(readPair(true,false))
    .then(writeProject).then(failedHistoryWrite(0)).then(refuseCheck).expect(not(s.buildAllowed))
  run failedCloseMayLeaveValidPairTest = init.then(beginSync).then(readPair(true,false))
    .then(writeProject).then(failedHistoryWrite(2)).then(check)
    .expect(s.outcome=="failed" and s.buildAllowed and invariant)
}
