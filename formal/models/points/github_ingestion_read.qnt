// @source scripts/github-ingestion-read.ts
// @source workers/slopbot/github.ts
// @evidence scripts/github-ingestion-read.test.ts
// Reads may wait for an observed rate limit. Writes and authorization failures
// return immediately, and exhausted retries cannot manufacture a success.
module github_ingestion_read {
  var s: {phase:str,read:bool,attempt:int,limited:bool,success:bool}
  action init = s'={phase:"ready",read:true,attempt:0,limited:false,success:false}
  action chooseWrite = all {s.phase=="ready",s'=s.with("read",false)}
  action request = all {Set("ready","wait").contains(s.phase),s.attempt<5,
    s'=s.with("phase","request").with("attempt",s.attempt+1)}
  action limit = all {s.phase=="request",
    s'=s.with("limited",true).with("phase",if(s.read and s.attempt<5) "wait" else "failed")}
  action refuse = all {s.phase=="request",s'=s.with("phase","failed")}
  action success = all {s.phase=="request",s'=s.with("phase","done").with("success",true).with("limited",false)}
  action step = any {chooseWrite,request,limit,refuse,success,s'=s}
  val invariant = all {s.attempt<=5,not(s.read) implies s.attempt<=1,
    s.phase=="wait" implies s.read and s.limited and s.attempt<5,
    s.success implies s.phase=="done" and not(s.limited)}
  run readResumesAfterLimitTest = init.then(request).then(limit).then(request).then(success).expect(s.attempt==2 and invariant)
  run writeDoesNotRetryTest = init.then(chooseWrite).then(request).then(limit).expect(invariant).then(request.fail())
  run authorizationDoesNotRetryTest = init.then(request).then(refuse).expect(invariant).then(request.fail())
  run repeatedLimitFailsTest = init.then(request).then(limit).then(request).then(limit)
    .then(request).then(limit).then(request).then(limit).then(request).then(limit)
    .expect(s.phase=="failed" and s.attempt==5 and invariant)
}
