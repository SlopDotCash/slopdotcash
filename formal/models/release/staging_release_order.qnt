// @source scripts/check-staging-order.mjs
// The staging concurrency lock is an external precondition. Failed newer
// releases count because a Worker/database may already have changed. Verified
// fixture/scan-only workflow records do not constitute a code release.
module staging_release_order {
  var s: {phase:str,candidate:int,tip:int,history:Set[int],blocking:Set[int],
    present:bool,ancestor:bool,allowed:bool}
  action init = s'={phase:"new",candidate:1,tip:2,history:Set(),blocking:Set(),present:false,ancestor:false,allowed:false}
  action inspect(ancestor) = all {s.phase=="new",ancestor,
    s'=s.with("phase","history").with("ancestor",true)}
  action history(revision,nonRelease) = all {s.phase=="history",
    s'=s.with("history",s.history.union(Set(revision)))
      .with("blocking",if(nonRelease) s.blocking else s.blocking.union(Set(revision)))
      .with("present",s.present or revision==s.candidate)}
  action finish = all {s.phase=="history",s.present,
    s.blocking.forall(r=>r<=s.candidate),
    s'=s.with("phase","allowed").with("allowed",true)}
  action step = {nondet revision=Set(1,2).oneOf() nondet a=Set(false,true).oneOf()
    any {inspect(a),history(revision,a),finish,s'=s}}
  val invariant = s.allowed implies (s.ancestor and s.present and
    s.blocking.forall(r=>r<=s.candidate))
  run newerFailedReleaseBlocksRollbackTest = init.then(inspect(true)).then(history(1,false))
    .then(history(2,false)).then(finish.fail())
  run nonReleaseFixtureIsNotRollbackTest = init.then(inspect(true)).then(history(1,false))
    .then(history(2,true)).then(finish).expect(s.allowed and invariant)
  run branchForcePushRefusedTest = init.then(inspect(false).fail())
  run qualificationDoesNotHideLaterReleaseTest = init.then(inspect(true)).then(history(1,false))
    .then(history(2,true)).then(history(2,false)).then(finish.fail())
  run qualificationDoesNotEraseEarlierReleaseTest = init.then(inspect(true)).then(history(1,false))
    .then(history(2,false)).then(history(2,true)).then(finish.fail())
}
