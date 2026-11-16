// @source scripts/check-staging-order.mjs
// @source .github/workflows/deploy.yml
// @conformance scripts/staging-release.test.ts
// The staging concurrency lock is an external precondition. Failed newer
// releases count because a Worker/database may already have changed. Verified
// fixture/scan-only workflow records do not constitute a code release.
// Clock ticks abstract the retry deadline after reserving time for publication.
// The initial attempt has no retry deadline; time at and after that boundary
// collapses to the final tick. The delay flag abstracts response-header parsing.
// History actions represent rows from this attempt's deployment pages; finish
// represents a complete history read. Page counts, REST transport details and
// the later publication are outside this model.
module staging_release_order {
  val deadline = 4
  var s: {phase:str,candidate:int,tip:int,history:Set[int],blocking:Set[int],
    present:bool,ancestor:bool,allowed:bool,now:int,retries:int,wakeAt:int}
  action init = s'={phase:"new",candidate:1,tip:2,history:Set(),blocking:Set(),
    present:false,ancestor:false,allowed:false,now:0,retries:0,wakeAt:0}
  val withinGuard = s.retries==0 or s.now<deadline
  action inspect(ancestor:bool):bool = all {s.phase=="new",withinGuard,ancestor,
    s'=s.with("phase","history").with("ancestor",true)}
  action rejectAncestry = all {s.phase=="new",withinGuard,
    s'=s.with("phase","refused")}
  action history(revision:int,nonRelease:bool):bool = all {s.phase=="history",withinGuard,
    s'=s.with("history",s.history.union(Set(revision)))
      .with("blocking",if(nonRelease) s.blocking else s.blocking.union(Set(revision)))
      .with("present",s.present or revision==s.candidate)}
  action restFailure(status:int,validDelay:bool,delay:int):bool = {
    val retry = Set(403,429).contains(status) and validDelay and delay>=0 and
      s.retries==0 and s.now+delay<deadline
    all {s.phase=="history",withinGuard,s.blocking.forall(r=>r<=s.candidate),
      s'=if(retry) s.with("phase","waiting").with("retries",1).with("wakeAt",s.now+delay)
        .with("history",Set()).with("blocking",Set()).with("present",false).with("ancestor",false)
      else s.with("phase","refused")}
  }
  action tick = all {Set("new","history","waiting").contains(s.phase),s.now<deadline,
    s'=s.with("now",s.now+1)}
  action resume = all {s.phase=="waiting",s.now>=s.wakeAt,s.now<deadline,
    s'=s.with("phase","new")}
  action expire = all {Set("new","history","waiting").contains(s.phase),s.retries==1,s.now==deadline,
    s'=s.with("phase","refused")}
  action finish = all {s.phase=="history",withinGuard,s.present,
    s.blocking.forall(r=>r<=s.candidate),
    s'=s.with("phase","allowed").with("allowed",true)}
  action step = any {
    inspect(true),rejectAncestry,finish,tick,resume,expire,
    {nondet revision=Set(1,2).oneOf() nondet nonRelease=Set(false,true).oneOf()
      history(revision,nonRelease)},
    {nondet status=Set(403,429,500).oneOf() nondet validDelay=Set(false,true).oneOf()
      nondet delay=Set(0,1,2,4).oneOf() restFailure(status,validDelay,delay)},
    s'=s}
  val invariant = all {
    s.now>=0 and s.now<=deadline,Set(0,1).contains(s.retries),
    s.allowed implies (s.phase=="allowed" and s.ancestor and s.present and
      s.history.contains(s.candidate) and s.blocking.forall(r=>r<=s.candidate) and withinGuard),
    Set("new","waiting").contains(s.phase) implies (not(s.ancestor) and not(s.present) and
      s.history==Set() and s.blocking==Set()),
    s.phase=="waiting" implies (s.retries==1 and s.wakeAt>=0 and s.wakeAt<deadline),
    s.phase=="refused" implies not(s.allowed)
  }
  run newerFailedReleaseBlocksRollbackTest = init.then(inspect(true)).then(history(1,false))
    .then(history(2,false)).then(finish.fail())
  run nonReleaseFixtureIsNotRollbackTest = init.then(inspect(true)).then(history(1,false))
    .then(history(2,true)).then(finish).expect(s.allowed and invariant)
  run branchForcePushRefusedTest = init.then(inspect(false).fail())
  run qualificationDoesNotHideLaterReleaseTest = init.then(inspect(true)).then(history(1,false))
    .then(history(2,true)).then(history(2,false)).then(finish.fail())
  run qualificationDoesNotEraseEarlierReleaseTest = init.then(inspect(true)).then(history(1,false))
    .then(history(2,false)).then(history(2,true)).then(finish.fail())
  run retryCannotResumeBeforeValidatedDelayTest = init.then(inspect(true))
    .then(restFailure(403,true,2)).then(tick).then(resume.fail())
  run retryWaitsAndStartsFreshTest = init.then(inspect(true)).then(history(1,false))
    .then(history(2,true)).then(restFailure(403,true,2)).then(tick).then(tick).then(resume)
    .expect(s.phase=="new" and s.history==Set() and not(s.ancestor) and invariant)
    .then(inspect(true)).expect(not(s.present) and s.blocking==Set() and invariant)
    .then(history(1,false)).then(finish).expect(s.allowed and invariant)
  run retryChecksAncestryAgainTest = init.then(inspect(true)).then(restFailure(429,true,1))
    .then(tick).then(resume).then(rejectAncestry).expect(not(s.allowed) and invariant).then(finish.fail())
  run retryRechecksEarlierExemptionsTest = init.then(inspect(true)).then(history(1,false))
    .then(history(2,true)).then(restFailure(403,true,1)).then(tick).then(resume)
    .then(inspect(true)).then(history(1,false)).then(history(2,false)).expect(invariant).then(finish.fail())
  run secondQuotaFailureRefusesTest = init.then(inspect(true)).then(restFailure(403,true,1))
    .then(tick).then(resume).then(inspect(true)).then(restFailure(429,true,1))
    .expect(s.phase=="refused" and s.retries==1 and invariant).then(resume.fail())
  run invalidDelayRefusesTest = init.then(inspect(true)).then(restFailure(403,false,1))
    .expect(s.phase=="refused" and s.retries==0 and invariant)
  run nonQuotaFailureRefusesTest = init.then(inspect(true)).then(restFailure(500,true,1))
    .expect(s.phase=="refused" and s.retries==0 and invariant)
  run insufficientSharedDeadlineRefusesTest = init.then(inspect(true)).then(tick).then(tick)
    .then(restFailure(429,true,2)).expect(s.phase=="refused" and s.retries==0 and invariant)
  run expiredWaitCannotResumeTest = init.then(inspect(true)).then(restFailure(429,true,1))
    .then(tick).then(tick).then(tick).then(tick).then(expire)
    .expect(s.phase=="refused" and invariant).then(resume.fail())
  run zeroDelayStillRequiresFreshHistoryTest = init.then(inspect(true)).then(history(1,false))
    .then(restFailure(429,true,0)).then(resume).then(inspect(true))
    .expect(not(s.present) and s.history==Set() and invariant).then(finish.fail())
  run initialSuccessDoesNotSpendRetryBudgetTest = init.then(inspect(true))
    .then(tick).then(tick).then(tick).then(tick).then(history(1,false)).then(finish)
    .expect(s.allowed and s.retries==0 and invariant)
}
