// @source scripts/github-ingestion-read.ts
// @source scripts/github-discussion-cache.ts
// @source scripts/restore-leaderboard-discussions.py
// @source workers/slopbot/github.ts
// @evidence scripts/github-ingestion-read.test.ts
// @evidence scripts/github-discussion-cache.test.ts
// Reads may wait for an observed rate limit. Writes and authorization failures
// return immediately, and exhausted retries cannot manufacture a success.
module github_ingestion_read {
  var s: {phase:str,read:bool,attempt:int,limited:bool,success:bool,
    cache:bool,conditional:bool,confirmed:bool,replayed:bool}
  action init = s'={phase:"ready",read:true,attempt:0,limited:false,success:false,
    cache:false,conditional:false,confirmed:false,replayed:false}
  action chooseWrite = all {s.phase=="ready",not(s.cache),s'=s.with("read",false)}
  action restore = all {s.phase=="ready",s.read,not(s.cache),s'=s.with("cache",true)}
  action request = all {Set("ready","wait").contains(s.phase),s.attempt<5,
    s'=s.with("phase","request").with("attempt",s.attempt+1).with("conditional",s.cache)}
  action validatorMismatch = all {s.phase=="request",s.conditional,
    s'=s.with("conditional",false)}
  action revalidate = all {s.phase=="request",s.conditional,
    s'=s.with("phase","done").with("success",true).with("limited",false)
      .with("confirmed",true).with("replayed",true)}
  action limit = all {s.phase=="request",
    s'=s.with("limited",true).with("phase",if(s.read and s.attempt<5) "wait" else "failed")}
  action refuse = all {s.phase=="request",s'=s.with("phase","failed")}
  action checkpoint = all {s.read,Set("ready","wait","request").contains(s.phase),
    s'=s.with("phase","checkpoint")}
  action success = all {s.phase=="request",s'=s.with("phase","done").with("success",true).with("limited",false)}
  action step = any {chooseWrite,restore,request,validatorMismatch,revalidate,limit,refuse,checkpoint,success,s'=s}
  val invariant = all {s.attempt<=5,not(s.read) implies s.attempt<=1,
    s.phase=="wait" implies s.read and s.limited and s.attempt<5,
    s.replayed implies s.read and s.cache and s.confirmed and s.success,
    s.phase=="checkpoint" implies not(s.success) and not(s.replayed),
    s.success implies s.phase=="done" and not(s.limited)}
  run readResumesAfterLimitTest = init.then(request).then(limit).then(request).then(success).expect(s.attempt==2 and invariant)
  run writeDoesNotRetryTest = init.then(chooseWrite).then(request).then(limit).expect(invariant).then(request.fail())
  run authorizationDoesNotRetryTest = init.then(request).then(refuse).expect(invariant).then(request.fail())
  run repeatedLimitFailsTest = init.then(request).then(limit).then(request).then(limit)
    .then(request).then(limit).then(request).then(limit).then(request).then(limit)
    .expect(s.phase=="failed" and s.attempt==5 and invariant)
  run confirmedCheckpointReadTest = init.then(restore).then(request).then(revalidate)
    .expect(s.replayed and invariant)
  run mismatchedValidatorReadsLiveTest = init.then(restore).then(request)
    .then(validatorMismatch).then(success).expect(not(s.replayed) and invariant)
  run mismatchedValidatorCannotReplayTest = init.then(restore).then(request)
    .then(validatorMismatch).then(revalidate.fail())
  run timedOutCheckpointCannotPublishTest = init.then(restore).then(request).then(limit)
    .then(checkpoint).expect(not(s.success) and invariant).then(request.fail())
}
