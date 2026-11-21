// @source .github/workflows/daily-collection.yml
// @source .github/workflows/deploy.yml
// @source scripts/daily-collection.ts
// @evidence scripts/daily-collection.test.ts
// PRD section 9 (operator decision, 19 November 2026): published contribution
// data refreshes itself once a day. A daily tick dispatches one fresh
// collection only when no collection runs. A finished collection either
// published itself, was superseded (main moved, so it published nothing), or
// failed. A superseded collection is published by a retained-data release
// naming it; that release is superseded again at most twice more, and its
// freshness check never replaces newer live data with older. A failed
// collection with a checkpoint is resumed once, never a resume of a resume.
// Bounds: three ticks, data generation times are tick numbers, one external
// publication may land newer data at any time. A push release's collection
// shares the release workflow's single fresh-collection lane, so it queues
// behind a running one; it is abstracted as the same collecting flag. GitHub
// API retries, token renewal and wall clock waits are outside this model.
module daily_collection {
  type State = {tick:int, collecting:bool, collectedAt:int, live:int, peak:int,
    pendingPublish:bool, attempts:int, pendingResume:bool, resumedThisChain:bool,
    chainResumes:int, dispatches:int, published:int}
  var s: State
  action initialize = s'={tick:0, collecting:false, collectedAt:0, live:0, peak:0,
    pendingPublish:false, attempts:0, pendingResume:false, resumedThisChain:false,
    chainResumes:0, dispatches:0, published:0}
  action init = initialize

  // The release's freshness check: publish only data at least as new as live.
  pure def guarded(live:int, data:int): int = if(data>=live) data else live

  action dailyTick = all {s.tick<3,
    s'=if(s.collecting) s.with("tick",s.tick+1)
      else s.with("tick",s.tick+1).with("collecting",true).with("resumedThisChain",false)
        .with("chainResumes",0).with("dispatches",s.dispatches+1)}
  action finishPublished = all {s.collecting,
    val live=guarded(s.live,s.tick)
    s'=s.with("collecting",false).with("live",live).with("peak",live)
      .with("published",s.published+1)}
  action finishSuperseded = all {s.collecting,
    s'=s.with("collecting",false).with("collectedAt",s.tick)
      .with("pendingPublish",true).with("attempts",0)}
  action finishFailed(checkpoint:bool): bool = all {s.collecting,
    s'=s.with("collecting",false)
      .with("pendingResume",checkpoint and not(s.resumedThisChain))}
  action resume = all {s.pendingResume, not(s.collecting),
    s'=s.with("pendingResume",false).with("collecting",true)
      .with("resumedThisChain",true).with("chainResumes",s.chainResumes+1)
      .with("dispatches",s.dispatches+1)}
  action publish(superseded:bool): bool = all {s.pendingPublish, s.attempts<3,
    val attempts=s.attempts+1
    if(superseded) s'=s.with("attempts",attempts).with("pendingPublish",attempts<3)
    else {
      val live=guarded(s.live,s.collectedAt)
      s'=s.with("attempts",attempts).with("pendingPublish",false)
        .with("live",live).with("peak",live).with("published",s.published+1)
    }}
  // Another release publishes data collected at the current tick.
  action otherPublication = all {s.tick>0,
    val live=guarded(s.live,s.tick)
    s'=s.with("live",live).with("peak",live)}
  action advance = {
    nondet superseded=Set(false,true).oneOf()
    nondet checkpoint=Set(false,true).oneOf()
    any {dailyTick, finishPublished, finishSuperseded, finishFailed(checkpoint),
      resume, publish(superseded), otherPublication}
  }
  action step = any {advance, s'=s}
  val invariant = all {
    s.tick>=0, s.tick<=3, s.attempts>=0, s.attempts<=3,
    s.chainResumes>=0, s.chainResumes<=1,
    s.live==s.peak, s.live<=s.tick, s.collectedAt<=s.tick,
    s.pendingPublish implies s.attempts<3,
    s.pendingResume implies not(s.resumedThisChain),
    s.dispatches<=s.tick+s.tick}

  run supersededCollectionPublishesTest = initialize.then(dailyTick)
    .then(finishSuperseded).then(publish(false))
    .expect(s.live==1 and not(s.pendingPublish) and s.attempts==1 and invariant)
  run supersededPublishRetriesThenStopsTest = initialize.then(dailyTick)
    .then(finishSuperseded).then(publish(true)).then(publish(true)).then(publish(true))
    .expect(not(s.pendingPublish) and s.attempts==3 and s.live==0 and invariant)
    .then(publish(false).fail())
  run failedCollectionResumesOnceTest = initialize.then(dailyTick)
    .then(finishFailed(true)).then(resume).then(finishFailed(true))
    .expect(not(s.pendingResume) and s.chainResumes==1 and invariant)
    .then(resume.fail())
  run noCheckpointNoResumeTest = initialize.then(dailyTick).then(finishFailed(false))
    .expect(not(s.pendingResume)).then(resume.fail())
  run tickSkipsWhileCollectingTest = initialize.then(dailyTick).then(dailyTick)
    .expect(s.collecting and s.dispatches==1 and s.tick==2 and invariant)
  run resumeWaitsForRunningCollectionTest = initialize.then(dailyTick)
    .then(finishFailed(true)).then(dailyTick).expect(s.pendingResume and s.collecting)
    .then(resume.fail())
  run olderDataNeverReplacesNewerTest = initialize.then(dailyTick)
    .then(finishSuperseded).then(dailyTick).then(otherPublication)
    .then(publish(false))
    .expect(s.live==2 and s.collectedAt==1 and invariant)
  run newDayStartsNewResumeChainTest = initialize.then(dailyTick)
    .then(finishFailed(true)).then(resume).then(finishFailed(true)).then(dailyTick)
    .then(finishFailed(true)).expect(s.pendingResume and s.chainResumes==0)
    .then(resume).expect(s.chainResumes==1 and invariant)
}
