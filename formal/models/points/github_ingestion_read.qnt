// @source scripts/github-ingestion-read.ts
// @source scripts/github-discussion-cache.ts
// @source scripts/restore-leaderboard-discussions.py
// @source workers/slopbot/github.ts
// @evidence scripts/github-ingestion-read.test.ts
// @evidence scripts/github-discussion-cache.test.ts
// Reads may wait for an observed rate limit: an exhausted primary window,
// Retry-After, a 429, or a 403 whose GitHub message names a secondary limit or
// abuse detection. Writes and authorization failures return immediately, and
// exhausted retries cannot manufacture a success. A PR file page can retry
// HTTP 500 twice and an exact commit file page can retry HTTP 422 once. Neither
// resets the quota retry count. Tests cover URLs, delays, and caller signals.
module github_ingestion_read {
  pure val limitSignals = Set("primary","retryAfter","status429","secondaryMessage")
  var s: {phase:str,read:bool,attempt:int,limited:bool,success:bool,
    cache:bool,conditional:bool,confirmed:bool,replayed:bool,signal:str,
    filePage:str,fileRetries:int}
  action init = s'={phase:"ready",read:true,attempt:0,limited:false,success:false,
    cache:false,conditional:false,confirmed:false,replayed:false,signal:"none",
    filePage:"none",fileRetries:0}
  action chooseWrite = all {s.phase=="ready",not(s.cache),s.filePage=="none",s'=s.with("read",false)}
  action chooseFilePage(page: str): bool = all {
    s.phase=="ready",s.read,not(s.cache),s'=s.with("filePage",page)}
  action choosePullFiles = chooseFilePage("pull")
  action chooseCommitFiles = chooseFilePage("commit")
  action restore = all {s.phase=="ready",s.read,not(s.cache),s.filePage=="none",s'=s.with("cache",true)}
  action request = all {Set("ready","wait","file-wait").contains(s.phase),
    s.phase=="file-wait" or s.attempt<5,
    s'=s.with("phase","request")
      .with("attempt",if(s.phase=="file-wait") s.attempt else s.attempt+1)
      .with("conditional",s.cache)}
  val fileRetryLimit = if(s.filePage=="commit") 1 else if(s.filePage=="pull") 2 else 0
  action fileError(status: int): bool = all {s.phase=="request",
    s'=if(s.read and s.fileRetries<fileRetryLimit and
          ((s.filePage=="pull" and status==500) or (s.filePage=="commit" and status==422)))
      s.with("phase","file-wait").with("fileRetries",s.fileRetries+1)
      else s.with("phase","failed")}
  action validatorMismatch = all {s.phase=="request",s.conditional,
    s'=s.with("conditional",false)}
  action revalidate = all {s.phase=="request",s.conditional,
    s'=s.with("phase","done").with("success",true).with("limited",false)
      .with("confirmed",true).with("replayed",true)}
  action limitBy(signal: str): bool = all {s.phase=="request",limitSignals.contains(signal),
    s'=s.with("limited",true).with("signal",signal)
      .with("phase",if(s.read and s.attempt<5) "wait" else "failed")}
  action limit = {
    nondet signal = limitSignals.oneOf()
    limitBy(signal)
  }
  // A 403 without any limit signal, including one whose message names no
  // secondary limit, is an authorization failure.
  action refuse = all {s.phase=="request",s'=s.with("phase","failed").with("signal","none")}
  action checkpoint = all {s.read,Set("ready","wait","file-wait","request").contains(s.phase),
    s'=s.with("phase","checkpoint")}
  action success = all {s.phase=="request",s'=s.with("phase","done").with("success",true).with("limited",false)}
  action step = any {chooseWrite,choosePullFiles,chooseCommitFiles,restore,request,
    validatorMismatch,revalidate,limit,refuse,fileError(500),fileError(422),checkpoint,success,s'=s}
  val invariant = all {s.attempt<=5,not(s.read) implies s.attempt<=1,
    s.fileRetries<=fileRetryLimit, s.fileRetries>0 implies s.read and s.filePage!="none",
    s.phase=="file-wait" implies s.fileRetries>0 and not(s.success),
    s.phase=="wait" implies s.read and s.limited and s.attempt<5 and limitSignals.contains(s.signal),
    s.replayed implies s.read and s.cache and s.confirmed and s.success,
    s.phase=="checkpoint" implies not(s.success) and not(s.replayed),
    s.success implies s.phase=="done" and not(s.limited)}
  run readResumesAfterLimitTest = init.then(request).then(limit).then(request).then(success).expect(s.attempt==2 and invariant)
  run secondaryLimitMessageResumesTest = init.then(request).then(limitBy("secondaryMessage"))
    .expect(s.phase=="wait" and invariant).then(request).then(success)
    .expect(s.attempt==2 and s.success and invariant)
  run writeDoesNotRetryTest = init.then(chooseWrite).then(request).then(limit).expect(invariant).then(request.fail())
  run authorizationDoesNotRetryTest = init.then(request).then(refuse).expect(invariant).then(request.fail())
  run repeatedLimitFailsTest = init.then(request).then(limit).then(request).then(limit)
    .then(request).then(limit).then(request).then(limit).then(request).then(limit)
    .expect(s.phase=="failed" and s.attempt==5 and invariant)
  run repeatedSecondaryLimitFailsTest = init.then(request).then(limitBy("secondaryMessage"))
    .then(request).then(limitBy("secondaryMessage")).then(request).then(limitBy("secondaryMessage"))
    .then(request).then(limitBy("secondaryMessage")).then(request).then(limitBy("secondaryMessage"))
    .expect(s.phase=="failed" and s.attempt==5 and not(s.success) and invariant)
  run prFileServerErrorRecoversTest = init.then(choosePullFiles).then(request)
    .then(fileError(500)).then(request).then(success)
    .expect(s.attempt==1 and s.fileRetries==1 and s.success and invariant)
  run prFileServerErrorsStayBoundedTest = init.then(choosePullFiles).then(request)
    .then(fileError(500)).then(request).then(fileError(500)).then(request).then(fileError(500))
    .expect(s.phase=="failed" and s.fileRetries==2 and invariant)
  run commitFileErrorRecoversTest = init.then(chooseCommitFiles).then(request)
    .then(fileError(422)).then(request).then(success)
    .expect(s.attempt==1 and s.fileRetries==1 and s.success and invariant)
  run commitFileErrorRetriesOnceTest = init.then(chooseCommitFiles).then(request)
    .then(fileError(422)).then(request).then(fileError(422))
    .expect(s.phase=="failed" and s.fileRetries==1 and invariant)
  run unrelatedServerErrorNeverRetriesTest = init.then(request).then(fileError(500))
    .expect(s.phase=="failed" and invariant).then(request.fail())
  run unrelatedValidationErrorNeverRetriesTest = init.then(choosePullFiles).then(request).then(fileError(422))
    .expect(s.phase=="failed" and invariant).then(request.fail())
  run serverRetryRespectsCheckpointTest = init.then(choosePullFiles).then(request)
    .then(fileError(500)).then(checkpoint).expect(invariant).then(request.fail())
  run confirmedCheckpointReadTest = init.then(restore).then(request).then(revalidate)
    .expect(s.replayed and invariant)
  run mismatchedValidatorReadsLiveTest = init.then(restore).then(request)
    .then(validatorMismatch).then(success).expect(not(s.replayed) and invariant)
  run mismatchedValidatorCannotReplayTest = init.then(restore).then(request)
    .then(validatorMismatch).then(revalidate.fail())
  run timedOutCheckpointCannotPublishTest = init.then(restore).then(request).then(limit)
    .then(checkpoint).expect(not(s.success) and invariant).then(request.fail())
}
