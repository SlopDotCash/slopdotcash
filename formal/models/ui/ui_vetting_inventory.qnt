// @source src/VettingEvidence.tsx
// @source src/lib/project-api.ts
// @source src/App.tsx
// @evidence tests/e2e/admin-evidence-layout.spec.ts
// Two actors, two lookups and two inventory request identities. The session
// response is observed separately from the cookie and inventory HTTP reply.
// Source-authored model; no parser, scenario or verifier execution is claimed.
module ui_vetting_inventory {
  type Request={actor:int,lookup:int,phase:str}
  pure val ids=Set(1,2)
  pure val emptyRequest={actor:0,lookup:0,phase:"unused"}
  var s:{mounted:bool,session:str,actor:int,cookie:int,lookup:int,active:int,
    requests:int->Request,dataActor:int,dataLookup:int,selected:bool,
    busy:bool,error:bool,refreshes:int}
  action init=s'={mounted:true,session:"checking",actor:0,cookie:1,lookup:1,active:0,
    requests:ids.mapBy(_=>emptyRequest),dataActor:0,dataLookup:0,selected:false,
    busy:false,error:false,refreshes:0}
  val visible=s.mounted and s.session=="signed-in" and s.dataActor==s.actor and s.dataLookup==s.lookup
  def owns(id:int):bool=s.mounted and s.active==id and s.session=="signed-in"
    and s.requests.get(id).actor==s.actor and s.requests.get(id).lookup==s.lookup
  action cookieChanges(actor:int):bool=all{actor>=0,actor<=2,s'=s.with("cookie",actor)}
  action sessionChecking=all{s.mounted,s'=s.with("session","checking").with("actor",0).with("active",0)}
  action sessionObserved=all{s.mounted,
    s'=s.with("session",if(s.cookie==0)"signed-out" else "signed-in").with("actor",s.cookie)}
  action sessionUnavailable=all{s.mounted,s'=s.with("session","error").with("actor",0).with("active",0)}
  action changeLookup=all{s.mounted,s.lookup==1,
    s'=s.with("lookup",2).with("active",0).with("selected",false)}
  action start(id:int):bool=all{s.mounted,s.session=="signed-in",s.requests.get(id).phase=="unused",
    s'=s.with("requests",s.requests.set(id,{actor:s.actor,lookup:s.lookup,phase:"http"}))
      .with("active",id).with("dataActor",0).with("dataLookup",0)
      .with("selected",false).with("busy",true).with("error",false)}
  action response(id:int):bool=all{s.requests.get(id).phase=="http",
    s'=s.with("requests",s.requests.set(id,s.requests.get(id).with("phase","identity")))}
  // A response must still own its view and have a freshly matching session.
  action confirm(id:int,available:bool):bool={
    val request=s.requests.get(id)
    val finished=s.with("requests",s.requests.set(id,request.with("phase","done")))
    all{request.phase=="identity",
      s'=if(not(owns(id)))finished
      else if(not(available))finished.with("busy",false).with("error",true)
      else if(s.cookie!=request.actor)finished.with("dataActor",0).with("dataLookup",0)
        .with("selected",false)
        .with("active",0).with("session","checking").with("actor",0).with("refreshes",s.refreshes+1)
      else finished.with("dataActor",request.actor).with("dataLookup",request.lookup)
        .with("busy",false).with("error",false)}
  }
  action requestFailed(id:int):bool=all{s.requests.get(id).phase=="http",
    s'=if(owns(id))s.with("requests",s.requests.set(id,s.requests.get(id).with("phase","done")))
      .with("busy",false).with("error",true)
      else s.with("requests",s.requests.set(id,s.requests.get(id).with("phase","done")))}
  action selectRequest=all{visible,s'=s.with("selected",true)}
  // A current reader reports a changed or unavailable session. The parent
  // clears its inventory and increments the hook revision; busy is unchanged.
  action invalidateFromReader=all{visible,s.selected,
    s'=s.with("dataActor",0).with("dataLookup",0).with("selected",false)
      .with("active",0).with("session","checking").with("actor",0).with("refreshes",s.refreshes+1)}
  action depart=s'=s.with("mounted",false).with("active",0)
  action step={nondet id=ids.oneOf() nondet actor=Set(0,1,2).oneOf() nondet available=Set(false,true).oneOf()
    any{cookieChanges(actor),sessionChecking,sessionObserved,sessionUnavailable,changeLookup,start(id),
      response(id),confirm(id,available),requestFailed(id),selectRequest,invalidateFromReader,depart,s'=s}}
  val invariant=all{s.lookup>=1,s.lookup<=2,s.refreshes<=2,
    visible implies(s.session=="signed-in" and s.actor>0 and s.dataActor==s.actor and s.dataLookup==s.lookup),
    s.dataActor==0 implies s.dataLookup==0}
  run signedOutDoesNotStartInventoryTest=init.then(cookieChanges(0)).then(sessionObserved).then(start(1).fail())
  run matchingInventoryBecomesVisibleTest=init.then(sessionObserved).then(start(1)).then(response(1))
    .then(confirm(1,true)).then(selectRequest).expect(visible and s.selected)
  run cookieChangedBeforePublishInvalidatesTest=init.then(sessionObserved).then(start(1)).then(response(1))
    .then(cookieChanges(2)).then(confirm(1,true)).expect(not(visible) and s.dataActor==0 and s.refreshes==1)
  run oldActorInventoryDoesNotRenderForNewActorTest=init.then(sessionObserved).then(start(1)).then(response(1))
    .then(confirm(1,true)).then(sessionChecking).then(cookieChanges(2)).then(sessionObserved)
    .expect(s.dataActor==1 and s.actor==2 and not(visible))
  run newActorLoadsItsOwnInventoryTest=init.then(sessionObserved).then(start(1)).then(response(1)).then(confirm(1,true))
    .then(sessionChecking).then(cookieChanges(2)).then(sessionObserved).then(start(2)).then(response(2)).then(confirm(2,true))
    .expect(visible and s.dataActor==2)
  run previousLookupReplyCannotReplaceNewRequestTest=init.then(sessionObserved).then(start(1)).then(changeLookup)
    .then(start(2)).then(response(2)).then(confirm(2,true)).then(response(1)).then(confirm(1,true))
    .expect(visible and s.dataLookup==2)
  run sessionFailureStaysLocalErrorTest=init.then(sessionObserved).then(start(1)).then(response(1)).then(confirm(1,false))
    .expect(s.dataActor==0 and s.error and s.refreshes==0 and s.session=="signed-in" and not(s.busy))
  run retryAfterSessionCheckOutageTest=init.then(sessionObserved).then(start(1)).then(response(1)).then(confirm(1,false))
    .then(start(2)).then(response(2)).then(confirm(2,true)).expect(visible and not(s.error))
  run readerIdentityLossClearsInventoryTest=init.then(sessionObserved).then(start(1)).then(response(1))
    .then(confirm(1,true)).then(selectRequest).then(invalidateFromReader)
    .expect(s.dataActor==0 and not(s.selected) and s.refreshes==1 and s.session=="checking")
  run inventoryFailureDoesNotInventEmptySuccessTest=init.then(sessionObserved).then(start(1)).then(requestFailed(1))
    .expect(s.error and s.dataActor==0 and not(visible))
  run departedReplyCannotPublishOrRefreshTest=init.then(sessionObserved).then(start(1)).then(response(1)).then(depart)
    .then(cookieChanges(2)).then(confirm(1,true)).expect(not(visible) and s.refreshes==0 and s.dataActor==0)
}
