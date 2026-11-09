// @source src/VettingEvidence.tsx
// @source src/lib/project-api.ts
// @source src/lib/browser-json.ts
// @evidence tests/e2e/evidence-download.spec.ts
// @evidence tests/e2e/admin-evidence-layout.spec.ts
// Two reader lifetimes/actors/objects and two request identities. Modes:
// 0=text, 1=buffered binary download, 2=native streamed download.
// Backend authorization, single-use grant acceptance and byte/hash checks are
// predicates; this model does not prove their cryptography or storage behavior.
// Authored without parser, test, simulation or verifier execution.
module ui_vetting_reader {
  type Request={epoch:int,actor:int,object:int,mode:int,phase:str}
  pure val ids=Set(1,2)
  pure val unused={epoch:0,actor:0,object:0,mode:0,phase:"unused"}
  var s:{mounted:bool,epoch:int,actor:int,object:int,cookie:int,active:int,
    requests:int->Request,aborted:Set[int],granted:Set[int],consumed:Set[int],hashed:Set[int],
    clicked:Set[int],clickActor:int->int,clickObject:int->int,
    text:int,error:bool,refreshes:int}
  action init=s'={mounted:true,epoch:1,actor:1,object:1,cookie:1,active:0,
    requests:ids.mapBy(_=>unused),aborted:Set(),granted:Set(),consumed:Set(),hashed:Set(),
    clicked:Set(),clickActor:ids.mapBy(_=>0),clickObject:ids.mapBy(_=>0),text:0,error:false,refreshes:0}
  def owns(id:int):bool=s.mounted and s.active==id and s.requests.get(id).epoch==s.epoch
    and s.requests.get(id).actor==s.actor and s.requests.get(id).object==s.object
  action cookieChanges(actor:int):bool=all{actor>=0,actor<=2,s'=s.with("cookie",actor)}
  action depart=s'=s.with("mounted",false).with("active",0).with("text",0)
    .with("aborted",if(s.active>0)s.aborted.union(Set(s.active)) else s.aborted)
  action remount(actor:int,object:int):bool=all{s.epoch==1,actor>=1,actor<=2,object>=1,object<=2,
    s'=s.with("mounted",true).with("epoch",2).with("actor",actor).with("cookie",actor)
      .with("aborted",if(s.active>0)s.aborted.union(Set(s.active)) else s.aborted)
      .with("object",object).with("active",0).with("text",0).with("error",false)}
  action start(id:int,mode:int):bool=all{s.mounted,s.requests.get(id).phase=="unused",mode>=0,mode<=2,
    s'=s.with("active",id).with("aborted",if(s.active>0)s.aborted.union(Set(s.active)) else s.aborted)
      .with("requests",s.requests.set(id,
      {epoch:s.epoch,actor:s.actor,object:s.object,mode:mode,phase:"check-grant"}))
      .with("text",0).with("error",false)}
  action checkGrant(id:int,available:bool):bool={
    val request=s.requests.get(id)
    val finished=s.with("requests",s.requests.set(id,request.with("phase","done")))
    all{request.phase=="check-grant",
      s'=if(not(owns(id)))finished
      else if(not(available) or s.cookie!=request.actor)finished.with("text",0).with("error",true)
        .with("refreshes",s.refreshes+1).with("active",0).with("mounted",false)
        .with("aborted",s.aborted.union(Set(id)))
      else s.with("requests",s.requests.set(id,request.with("phase","grant")))}
  }
  action grantReply(id:int,accepted:bool):bool={
    val request=s.requests.get(id)
    val received=s.with("granted",if(accepted)s.granted.union(Set(id)) else s.granted)
    all{request.phase=="grant",
      s'=if(not(owns(id)))received.with("requests",s.requests.set(id,request.with("phase","done")))
      else if(not(accepted))received.with("requests",s.requests.set(id,request.with("phase","failure-check")))
      else received.with("requests",s.requests.set(id,request.with("phase","check-use")))}
  }
  // This fresh identity check ends immediately before the synchronous next
  // side effect: body fetch or native anchor click.
  action checkUse(id:int,available:bool):bool={
    val request=s.requests.get(id)
    val finished=s.with("requests",s.requests.set(id,request.with("phase","done")))
    all{request.phase=="check-use",
      s'=if(not(owns(id)))finished
      else if(not(available) or s.cookie!=request.actor)finished.with("text",0).with("error",true)
        .with("refreshes",s.refreshes+1).with("active",0).with("mounted",false)
        .with("aborted",s.aborted.union(Set(id)))
      else if(request.mode==2)finished.with("clicked",s.clicked.union(Set(id)))
        .with("clickActor",s.clickActor.set(id,s.actor)).with("clickObject",s.clickObject.set(id,s.object))
      else s.with("requests",s.requests.set(id,request.with("phase","body")))}
  }
  // A server may consume the already-issued grant before the browser aborts.
  action consume(id:int,authorized:bool):bool=all{s.granted.contains(id),not(s.consumed.contains(id)),
    s.requests.get(id).phase=="body" or s.clicked.contains(id),authorized,
    s.cookie==s.requests.get(id).actor,s'=s.with("consumed",s.consumed.union(Set(id)))}
  action bodyReply(id:int,exact:bool):bool={
    val request=s.requests.get(id)
    all{request.phase=="body",
      s'=if(not(owns(id)))s.with("requests",s.requests.set(id,request.with("phase","done")))
      else if(not(exact) or not(s.consumed.contains(id)))s.with("requests",s.requests.set(id,request.with("phase","failure-check")))
      else s.with("requests",s.requests.set(id,request.with("phase","hash")))}
  }
  action hashReply(id:int,matches:bool):bool={
    val request=s.requests.get(id)
    all{request.phase=="hash",
      s'=if(not(owns(id)))s.with("requests",s.requests.set(id,request.with("phase","done")))
      else if(not(matches))s.with("requests",s.requests.set(id,request.with("phase","failure-check")))
      else s.with("hashed",s.hashed.union(Set(id))).with("requests",s.requests.set(id,request.with("phase","check-publish")))}
  }
  action publish(id:int,available:bool):bool={
    val request=s.requests.get(id)
    val finished=s.with("requests",s.requests.set(id,request.with("phase","done")))
    all{request.phase=="check-publish",s.hashed.contains(id),
      s'=if(not(owns(id)))finished
      else if(not(available) or s.cookie!=request.actor)finished.with("text",0).with("error",true)
        .with("refreshes",s.refreshes+1).with("active",0).with("mounted",false)
        .with("aborted",s.aborted.union(Set(id)))
      else if(request.mode==0)finished.with("text",id)
      else finished.with("clicked",s.clicked.union(Set(id)))
        .with("clickActor",s.clickActor.set(id,s.actor)).with("clickObject",s.clickObject.set(id,s.object))}
  }
  // Generic grant, body and hash failures await one more current-session
  // observation before retaining their error. No failure may publish bytes.
  action failureCheck(id:int,available:bool):bool={
    val request=s.requests.get(id)
    val finished=s.with("requests",s.requests.set(id,request.with("phase","done")))
    all{request.phase=="failure-check",
      s'=if(not(owns(id)))finished
      else if(not(available) or s.cookie!=request.actor)finished.with("text",0).with("error",true)
        .with("refreshes",s.refreshes+1).with("active",0).with("mounted",false)
        .with("aborted",s.aborted.union(Set(id)))
      else finished.with("error",true)}
  }
  // HTTP 401/403/404/410 are authoritative refusals, including a grant request
  // whose expected actor no longer matches. An owned refusal clears the parent
  // without first making another session request.
  action authorityRefusal(id:int):bool={
    val request=s.requests.get(id)
    val finished=s.with("requests",s.requests.set(id,request.with("phase","done")))
    all{request.phase=="grant" or request.phase=="body",
      s'=if(not(owns(id)))finished
      else finished.with("text",0).with("error",true).with("refreshes",s.refreshes+1)
        .with("active",0).with("mounted",false).with("aborted",s.aborted.union(Set(id)))}
  }
  action step={nondet id=ids.oneOf() nondet actor=Set(0,1,2).oneOf()
    nondet object=Set(1,2).oneOf() nondet mode=Set(0,1,2).oneOf() nondet ok=Set(false,true).oneOf()
    any{cookieChanges(actor),depart,remount(1,object),remount(2,object),start(id,mode),checkGrant(id,ok),
      grantReply(id,ok),checkUse(id,ok),consume(id,ok),bodyReply(id,ok),hashReply(id,ok),publish(id,ok),
      failureCheck(id,ok),authorityRefusal(id),s'=s}}
  val invariant=all{s.epoch>=1,s.epoch<=2,s.refreshes<=2,s.consumed.subseteq(s.granted),
    s.text>0 implies(owns(s.text) and s.hashed.contains(s.text) and s.requests.get(s.text).mode==0),
    s.clicked.forall(id=>s.requests.get(id).actor==s.clickActor.get(id) and s.requests.get(id).object==s.clickObject.get(id)),
    s.clicked.forall(id=>s.requests.get(id).mode==2 or s.hashed.contains(id))}
  run completeTextNeedsExactBytesTest=init.then(start(1,0)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(checkUse(1,true)).then(consume(1,true)).then(bodyReply(1,true)).then(hashReply(1,true)).then(publish(1,true))
    .expect(s.text==1 and s.clicked==Set())
  run wrongDigestNeverDisplaysTest=init.then(start(1,0)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(checkUse(1,true)).then(consume(1,true)).then(bodyReply(1,true)).then(hashReply(1,false)).then(failureCheck(1,true))
    .expect(s.text==0 and s.error)
  run departedGrantDoesNotFetchBodyTest=init.then(start(1,0)).then(checkGrant(1,true)).then(depart)
    .then(grantReply(1,true)).expect(s.granted==Set(1) and s.requests.get(1).phase=="done" and s.text==0)
  run departedNativeGrantCannotClickTest=init.then(start(1,2)).then(checkGrant(1,true)).then(depart)
    .then(grantReply(1,true)).expect(s.granted==Set(1) and s.clicked==Set() and s.aborted==Set(1))
  run selectedObjectChangeDoesNotDownloadTest=init.then(start(1,2)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(remount(1,2)).then(checkUse(1,true)).expect(s.clicked==Set())
  run actorChangeBeforeBodyRefusesTest=init.then(start(1,0)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(cookieChanges(2)).then(checkUse(1,true)).expect(s.error and s.text==0 and s.refreshes==1)
  run departedBufferedBytesCannotDownloadTest=init.then(start(1,1)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(checkUse(1,true)).then(consume(1,true)).then(bodyReply(1,true)).then(hashReply(1,true)).then(depart)
    .then(publish(1,true)).expect(s.clicked==Set() and s.consumed==Set(1))
  run abortedBodyCannotRestoreConsumedGrantTest=init.then(start(1,1)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(checkUse(1,true)).then(consume(1,true)).then(depart).then(bodyReply(1,true))
    .expect(s.aborted==Set(1) and s.consumed==Set(1) and s.clicked==Set() and s.text==0)
  run actorChangeDuringHashRefusesPublicationTest=init.then(start(1,1)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(checkUse(1,true)).then(consume(1,true)).then(bodyReply(1,true)).then(cookieChanges(2)).then(hashReply(1,true))
    .then(publish(1,true)).expect(s.clicked==Set() and s.error and s.refreshes==1)
  run nativeDownloadNeedsFreshIdentityTest=init.then(start(1,2)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(cookieChanges(0)).then(checkUse(1,true)).expect(s.clicked==Set() and s.refreshes==1)
  run nativeClickDoesNotProveDeliveryTest=init.then(start(1,2)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(checkUse(1,true)).expect(s.clicked==Set(1) and s.consumed==Set())
  run grantConsumptionCannotReplayTest=init.then(start(1,2)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(checkUse(1,true)).then(consume(1,true)).then(consume(1,true).fail())
  run newRequestOwnsLateReplyTest=init.then(start(1,0)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(start(2,0)).then(checkUse(1,true)).expect(s.active==2 and s.requests.get(1).phase=="done" and s.text==0)
  run genericGrantFailureWaitsForActorTest=init.then(start(1,0)).then(checkGrant(1,true)).then(grantReply(1,false))
    .expect(s.requests.get(1).phase=="failure-check" and not(s.error))
    .then(failureCheck(1,true)).expect(s.error and s.refreshes==0 and s.mounted and s.text==0)
  run genericBodyFailureWithDifferentActorInvalidatesTest=init.then(start(1,0)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(checkUse(1,true)).then(consume(1,true)).then(bodyReply(1,false)).then(cookieChanges(2)).then(failureCheck(1,true))
    .expect(s.refreshes==1 and not(s.mounted) and s.text==0 and s.consumed==Set(1))
  run genericHashFailureWithUnavailableSessionInvalidatesTest=init.then(start(1,0)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(checkUse(1,true)).then(consume(1,true)).then(bodyReply(1,true)).then(hashReply(1,false)).then(failureCheck(1,false))
    .expect(s.refreshes==1 and not(s.mounted) and s.text==0)
  run departedGenericFailureCannotRefreshTest=init.then(start(1,0)).then(checkGrant(1,true)).then(grantReply(1,false))
    .then(depart).then(cookieChanges(2)).then(failureCheck(1,true)).expect(s.refreshes==0 and not(s.error) and s.text==0)
  run authorityRefusalInvalidatesWithoutSessionCheckTest=init.then(start(1,0)).then(checkGrant(1,true)).then(authorityRefusal(1))
    .expect(s.requests.get(1).phase=="done" and s.refreshes==1 and not(s.mounted) and s.text==0)
  run departedAuthorityRefusalCannotRefreshTest=init.then(start(1,0)).then(checkGrant(1,true)).then(depart).then(authorityRefusal(1))
    .expect(s.refreshes==0 and not(s.error) and s.text==0)
  run authorityBodyRefusalInvalidatesSameActorTest=init.then(start(1,0)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(checkUse(1,true)).then(authorityRefusal(1))
    .expect(s.cookie==1 and s.refreshes==1 and not(s.mounted) and s.text==0)
  run supersededGenericFailureCannotReplaceCurrentRequestTest=init.then(start(1,0)).then(checkGrant(1,true)).then(grantReply(1,false))
    .then(start(2,0)).then(cookieChanges(2)).then(failureCheck(1,true))
    .expect(s.active==2 and s.refreshes==0 and not(s.error) and s.text==0)
}
