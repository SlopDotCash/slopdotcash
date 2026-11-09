// @source scripts/value-ingestion.ts
// @source scripts/generate-leaderboard.ts
// One hosted feed request. Transport can report EOF after the deadline, so
// fulfilled text alone cannot distinguish an outage from malformed content.
module value_feed_deadline {
  var s: {phase:str, expired:bool, valid:bool, outcome:str, published:int}
  action init = s'={phase:"request",expired:false,valid:false,outcome:"pending",published:1}
  action headers = all {s.phase=="request",not(s.expired),s'=s.with("phase","body")}
  action expire = all {Set("request","body").contains(s.phase),s'=s.with("expired",true)}
  action body(valid) = all {s.phase=="body",s'=s.with("phase","received").with("valid",valid)}
  action networkFailure = all {Set("request","body").contains(s.phase),s'=s.with("phase","done").with("outcome","unavailable")}
  action lateHeaders = all {s.phase=="request",s.expired,s'=s.with("phase","done").with("outcome","unavailable")}
  action classify = all {s.phase=="received",s'=s.with("phase","done")
    .with("outcome",if(s.expired) "unavailable" else if(s.valid) "validated" else "integrity")}
  action publish = all {s.phase=="done",s.outcome=="validated",s'=s.with("published",2)}
  action step = {nondet valid=Set(false,true).oneOf()
    any {headers,expire,body(valid),networkFailure,lateHeaders,classify,publish,s'=s}}
  val invariant = all {s.published==2 implies s.outcome=="validated",
    s.outcome=="integrity" implies not(s.expired),
    s.expired implies s.published==1}
  run expiredPartialBodyTest = init.then(headers).then(expire).then(body(false)).then(classify)
    .expect(s.outcome=="unavailable" and s.published==1)
  run expiredCompleteBodyTest = init.then(headers).then(expire).then(body(true)).then(classify)
    .expect(s.outcome=="unavailable" and s.published==1)
  run malformedCompleteBodyTest = init.then(headers).then(body(false)).then(classify)
    .expect(s.outcome=="integrity" and s.published==1)
  run verifiedFeedPublishesTest = init.then(headers).then(body(true)).then(classify).then(publish)
    .expect(s.published==2)
  run timeoutBeforeHeadersTest = init.then(expire).then(lateHeaders).expect(s.outcome=="unavailable")
  run resetKeepsSnapshotTest = init.then(headers).then(networkFailure).expect(s.published==1)
}
