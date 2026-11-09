// @source src/lib/browser-json.ts
// @source src/lib/project-api.ts
// @evidence scripts/project-api-response.test.ts
// Two requests; raw (fetchWithDeadline/apiRequest) and project wrapper modes,
// statuses 200/409/503, object/array/scalar JSON and independent error fields.
// Native fetch honoring AbortSignal for unread bodies, timer scheduling and
// DOMException identity are external assumptions. raw returns at headers;
// its body phases below belong to its consumer, with no error remapping.
// project has no caller AbortSignal argument; raw may combine one with its
// deadline. Cancellation is explicit, not implied by component departure.
// HTTP status is considered after JSON decoding. Body abort/timeout becomes
// status 0; other unreadable bodies retain HTTP status as invalid_response.
// Generic JSON passes through, including null/scalars. Session schema and
// publication belong to ui_session/ui_focus_session/ui_project_authority.
// No authentication transition or completed-body rollback. Source-only.
module ui_transport {
  val ids=Set(1,2)
  type Request={phase:str,mode:str,external:bool,signal:str,status:int,
    body:str,codeField:bool,messageField:bool,result:str,resultStatus:int,code:str,message:str}
  type S={requests:int->Request}
  val empty:Request={phase:"unused",mode:"raw",external:false,signal:"none",status:0,
    body:"none",codeField:false,messageField:false,result:"none",resultStatus:0,code:"none",message:"none"}
  var s:S
  action init=s'={requests:ids.mapBy(_=>empty)}
  action begin(id:int,mode:str,external:bool):bool=all{ids.contains(id),s.requests.get(id).phase=="unused",
    Set("raw","project").contains(mode),not(external) or mode=="raw",
    s'=s.with("requests",s.requests.put(id,empty.with("phase","headers").with("mode",mode).with("external",external)))}
  action signal(id:int,reason:str):bool={val r=s.requests.get(id)
    all{Set("headers","body","parsed","done").contains(r.phase),r.signal=="none",
      Set("deadline","owner").contains(reason),reason!="owner" or r.external,
      s'=s.with("requests",s.requests.put(id,r.with("signal",reason)))}}
  action headers(id:int,status:int):bool={val r=s.requests.get(id)
    all{r.phase=="headers",r.signal=="none",Set(200,409,503).contains(status),
      s'=s.with("requests",s.requests.put(id,r.with("phase","body").with("status",status)))}}
  action reject(id:int,reason:str):bool={val r=s.requests.get(id)
    val timed=Set("abort","timeout").contains(reason)
    val project=r.mode=="project"
    val before=r.phase=="headers"
    all{Set("headers","body").contains(r.phase),Set("abort","timeout","network","syntax").contains(reason),
      before implies reason!="syntax",
      s'=s.with("requests",s.requests.put(id,r.with("phase","done").with("result","error")
        .with("resultStatus",if(project and not(before) and not(timed))r.status else 0)
        .with("code",if(not(project))"raw-error" else if(before or timed)"network_error" else "invalid_response")
        .with("message",if(not(project))reason else if(timed)"timeout" else if(before)"network" else "unreadable")))}}
  action interrupted(id:int):bool={val r=s.requests.get(id)
    all{r.signal!="none",reject(id,if(r.signal=="deadline")"timeout" else "abort")}}
  action parsed(id:int,body:str,codeField:bool,messageField:bool):bool={val r=s.requests.get(id)
    all{r.phase=="body",r.signal=="none",Set("object","array","scalar").contains(body),
      body=="object" or (not(codeField) and not(messageField)),
      s'=s.with("requests",s.requests.put(id,r.with("phase","parsed").with("body",body)
        .with("codeField",codeField).with("messageField",messageField)))}}
  action deliver(id:int):bool={val r=s.requests.get(id)
    val error=r.mode=="project" and r.status!=200
    all{r.phase=="parsed",
      s'=s.with("requests",s.requests.put(id,r.with("phase","done").with("result",if(error)"error" else "value")
        .with("resultStatus",if(error)r.status else 0)
        .with("code",if(error and r.codeField)"server-code" else if(error)"request_failed" else "none")
        .with("message",if(error and r.messageField)"server-message" else if(error)"http-status" else "none")))}}
  action step={nondet id=ids.oneOf()
    nondet mode=Set("raw","project").oneOf()
    nondet yes=Set(false,true).oneOf()
    nondet other=Set(false,true).oneOf()
    nondet status=Set(200,409,503).oneOf()
    nondet reason=Set("abort","timeout","network","syntax").oneOf()
    nondet body=Set("object","array","scalar").oneOf()
    any{begin(id,mode,yes),signal(id,"deadline"),signal(id,"owner"),headers(id,status),reject(id,reason),
      interrupted(id),parsed(id,body,yes,other),deliver(id),s'=s}}
  val invariant=ids.forall(id=>{val r=s.requests.get(id)
    all{r.mode=="project" implies not(r.external),
      r.code=="invalid_response" implies r.mode=="project" and r.status==r.resultStatus and r.status!=0,
      r.code=="network_error" implies r.resultStatus==0,
      Set("request_failed","server-code").contains(r.code) implies r.resultStatus==r.status and r.status!=200,
      r.mode=="project" and r.result=="value" implies r.status==200,
      r.result=="value" implies r.body!="none"}})
  action project=begin(1,"project",false)
  action raw=begin(1,"raw",true)
  action body(status:int):bool=project.then(headers(1,status))
  run successValueIsNotSessionAuthorityTest=body(200).then(parsed(1,"scalar",false,false)).then(deliver(1))
    .expect(s.requests.get(1).result=="value" and invariant)
  run apiErrorRetainsStatusAndDetailsTest=body(409).then(parsed(1,"object",true,true)).then(deliver(1))
    .expect(s.requests.get(1).resultStatus==409 and s.requests.get(1).code=="server-code" and invariant)
  run missingErrorCodeFallsBackIndependentlyTest=body(503).then(parsed(1,"object",false,true)).then(deliver(1))
    .expect(s.requests.get(1).code=="request_failed" and s.requests.get(1).message=="server-message" and invariant)
  run missingErrorMessageFallsBackIndependentlyTest=body(409).then(parsed(1,"object",true,false)).then(deliver(1))
    .expect(s.requests.get(1).code=="server-code" and s.requests.get(1).message=="http-status" and invariant)
  run primitiveHttpErrorKeepsStatusTest=body(503).then(parsed(1,"scalar",false,false)).then(deliver(1))
    .expect(s.requests.get(1).resultStatus==503 and s.requests.get(1).code=="request_failed" and invariant)
  run arrayHttpErrorKeepsStatusTest=body(409).then(parsed(1,"array",false,false)).then(deliver(1))
    .expect(s.requests.get(1).resultStatus==409 and invariant)
  run malformedErrorBodyIsUnreadableFirstTest=body(503).then(reject(1,"syntax"))
    .expect(s.requests.get(1).code=="invalid_response" and s.requests.get(1).resultStatus==503 and invariant)
  run malformedSuccessBodyIsUnreadableTest=body(200).then(reject(1,"syntax"))
    .expect(s.requests.get(1).code=="invalid_response" and s.requests.get(1).resultStatus==200 and invariant)
  run headerDeadlineMapsToNetworkErrorTest=project.then(signal(1,"deadline")).then(interrupted(1))
    .expect(s.requests.get(1).code=="network_error" and s.requests.get(1).message=="timeout" and invariant)
  run bodyDeadlineDoesNotBecomeHttpRefusalTest=body(409).then(signal(1,"deadline")).then(interrupted(1))
    .expect(s.requests.get(1).resultStatus==0 and s.requests.get(1).code=="network_error" and invariant)
  run bodyAbortMapsLikeTimeoutTest=body(503).then(reject(1,"abort"))
    .expect(s.requests.get(1).resultStatus==0 and s.requests.get(1).message=="timeout" and invariant)
  run headerNetworkErrorRetainsNetworkClassificationTest=project.then(reject(1,"network"))
    .expect(s.requests.get(1).message=="network" and s.requests.get(1).resultStatus==0 and invariant)
  run bodyNetworkFailureIsUnreadableHttpResponseTest=body(503).then(reject(1,"network"))
    .expect(s.requests.get(1).code=="invalid_response" and s.requests.get(1).resultStatus==503 and invariant)
  run rawHeaderErrorIsNotMappedTest=raw.then(reject(1,"network"))
    .expect(s.requests.get(1).code=="raw-error" and invariant)
  run ownerAbortSurvivesResponseHeadersTest=raw.then(headers(1,200)).then(signal(1,"owner")).then(interrupted(1))
    .expect(s.requests.get(1).code=="raw-error" and s.requests.get(1).message=="abort" and invariant)
  run rawHttpErrorStillReturnsReadableBodyTest=raw.then(headers(1,503)).then(parsed(1,"object",true,true)).then(deliver(1))
    .expect(s.requests.get(1).result=="value" and invariant)
  run timeoutAfterConsumedBodyCannotUndoValueTest=body(200).then(parsed(1,"object",false,false))
    .then(signal(1,"deadline")).then(deliver(1)).expect(s.requests.get(1).result=="value" and invariant)
  run timeoutAfterDeliveryCannotUndoValueTest=body(200).then(parsed(1,"object",false,false)).then(deliver(1))
    .then(signal(1,"deadline")).expect(s.requests.get(1).result=="value" and invariant)
  run callerCannotInjectCancellationIntoProjectWrapperTest=project.then(signal(1,"owner").fail())
  run abortedOlderRequestDoesNotAbortIndependentRetryTest=raw.then(begin(2,"raw",true)).then(signal(1,"owner"))
    .then(interrupted(1)).then(headers(2,200)).then(parsed(2,"object",false,false)).then(deliver(2))
    .expect(s.requests.get(1).result=="error" and s.requests.get(2).result=="value" and invariant)
}
