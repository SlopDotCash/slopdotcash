// @source src/VettingEvidence.tsx
// @source src/lib/project-api.ts
// @source src/lib/browser-json.ts
// @evidence tests/e2e/evidence-download.spec.ts
// @evidence tests/e2e/admin-evidence-layout.spec.ts
// Two reader lifetimes/actors/objects and two request identities. Modes:
// 0=text, 1=buffered binary download, 2=native streamed download.
// Backend authorization, single-use grant acceptance and byte/hash checks are
// predicates; this model does not prove their cryptography or storage behavior.
// Layout cleanup retires committed readers. Each identity gate separates its
// session observation, helper return and outer caller use. Already-consumed
// server grants survive departure; a retired reader cannot start a new click.
// Authored without parser, test, simulation or verifier execution.
module ui_vetting_reader {
  type Request={epoch:int,actor:int,object:int,mode:int,phase:str,gate:str,observed:int}
  pure val ids=Set(1,2)
  pure val unused={epoch:0,actor:0,object:0,mode:0,phase:"unused",gate:"none",observed:-1}
  type State={present:bool,mounted:bool,epoch:int,actor:int,object:int,cookie:int,active:int,busy:int,
    requests:int->Request,aborted:Set[int],granted:Set[int],consumed:Set[int],hashed:Set[int],
    clicked:Set[int],clickActor:int->int,clickObject:int->int,
    text:int,error:bool,refreshes:int,badEffect:bool}
  var s:State
  action init=s'={present:true,mounted:true,epoch:1,actor:1,object:1,cookie:1,active:0,busy:0,
    requests:ids.mapBy(_=>unused),aborted:Set(),granted:Set(),consumed:Set(),hashed:Set(),
    clicked:Set(),clickActor:ids.mapBy(_=>0),clickObject:ids.mapBy(_=>0),text:0,error:false,refreshes:0,badEffect:false}
  def owns(id:int):bool=s.mounted and s.active==id and s.requests.get(id).epoch==s.epoch
    and s.requests.get(id).actor==s.actor and s.requests.get(id).object==s.object
  action cookieChanges(actor:int):bool=all{actor>=0,actor<=2,s'=s.with("cookie",actor)}
  def finished(value:State,id:int):State=value.with("requests",value.requests.set(id,value.requests.get(id).with("phase","done")))
    .with("busy",if(owns(id))0 else value.busy)
  action depart=s'=s.with("present",false).with("mounted",false).with("active",0).with("busy",0).with("text",0)
    .with("aborted",if(s.active>0)s.aborted.union(Set(s.active)) else s.aborted)
  action remount(actor:int,object:int):bool=all{s.epoch==1,actor>=1,actor<=2,object>=1,object<=2,
    s'=s.with("present",true).with("mounted",true).with("epoch",2).with("actor",actor).with("cookie",actor)
      .with("aborted",if(s.active>0)s.aborted.union(Set(s.active)) else s.aborted)
      .with("object",object).with("active",0).with("busy",0).with("text",0).with("error",false)}
  action start(id:int,mode:int):bool=all{s.mounted,s.busy==0,s.requests.get(id).phase=="unused",mode>=0,mode<=2,
    s'=s.with("active",id).with("busy",id).with("aborted",if(s.active>0)s.aborted.union(Set(s.active)) else s.aborted)
      .with("requests",s.requests.set(id,
      {epoch:s.epoch,actor:s.actor,object:s.object,mode:mode,phase:"check-grant",gate:"none",observed:-1}))
      .with("text",0).with("error",false)}
  action observeCheck(id:int,gate:str,available:bool):bool={
    val request=s.requests.get(id)
    val waiting=if(gate=="grant")"check-grant" else if(gate=="use")"check-use"
      else if(gate=="publish")"check-publish" else "failure-check"
    all{Set("grant","use","publish","failure").contains(gate),
      request.phase==waiting,
      s'=s.with("requests",s.requests.set(id,request.with("phase","observed")
        .with("gate",gate).with("observed",if(available)s.cookie else -1)))}
  }
  action returnCheck(id:int):bool=all{s.requests.get(id).phase=="observed",
    s'=s.with("requests",s.requests.set(id,s.requests.get(id).with("phase","returned")))}
  action consumeCheck(id:int):bool={
    val request=s.requests.get(id)
    val completed=finished(s,id)
    all{request.phase=="returned",
      s'=if(not(owns(id)))completed
      else if(request.observed==-1 or request.observed!=request.actor)
        completed.with("text",0).with("error",true).with("refreshes",s.refreshes+1)
          .with("active",0).with("busy",0).with("mounted",false).with("present",false)
          .with("aborted",s.aborted.union(Set(id)))
      else if(request.gate=="grant")s.with("requests",s.requests.set(id,request.with("phase","grant")))
      else if(request.gate=="use" and request.mode!=2)
        s.with("requests",s.requests.set(id,request.with("phase","body")))
      else if(request.gate=="failure")completed.with("error",true)
      else if(request.gate=="publish" and request.mode==0)completed.with("text",id)
      else completed.with("clicked",s.clicked.union(Set(id)))
        .with("clickActor",s.clickActor.set(id,request.actor)).with("clickObject",s.clickObject.set(id,request.object))}
  }
  // Convenience sequences preserve the earlier scenarios. Exploration uses
  // every boundary separately, including departure after a true return.
  action checkGrant(id:int,available:bool):bool=observeCheck(id,"grant",available).then(returnCheck(id)).then(consumeCheck(id))
  action grantReply(id:int,accepted:bool):bool={
    val request=s.requests.get(id)
    val received=s.with("granted",if(accepted)s.granted.union(Set(id)) else s.granted)
    all{request.phase=="grant",
      s'=if(not(owns(id)))finished(received,id)
      else if(not(accepted))received.with("requests",s.requests.set(id,request.with("phase","failure-check")))
      else received.with("requests",s.requests.set(id,request.with("phase","check-use")))}
  }
  action checkUse(id:int,available:bool):bool=observeCheck(id,"use",available).then(returnCheck(id)).then(consumeCheck(id))
  // A server may consume the already-issued grant before the browser aborts.
  action consume(id:int,authorized:bool):bool=all{s.granted.contains(id),not(s.consumed.contains(id)),
    s.requests.get(id).phase=="body" or s.clicked.contains(id),authorized,
    s.cookie==s.requests.get(id).actor,s'=s.with("consumed",s.consumed.union(Set(id)))}
  action bodyReply(id:int,exact:bool):bool={
    val request=s.requests.get(id)
    all{request.phase=="body",
      s'=if(not(owns(id)))finished(s,id)
      else if(not(exact) or not(s.consumed.contains(id)))s.with("requests",s.requests.set(id,request.with("phase","failure-check")))
      else s.with("requests",s.requests.set(id,request.with("phase","hash")))}
  }
  action hashReply(id:int,matches:bool):bool={
    val request=s.requests.get(id)
    all{request.phase=="hash",
      s'=if(not(owns(id)))finished(s,id)
      else if(not(matches))s.with("requests",s.requests.set(id,request.with("phase","failure-check")))
      else s.with("hashed",s.hashed.union(Set(id))).with("requests",s.requests.set(id,request.with("phase","check-publish")))}
  }
  action publish(id:int,available:bool):bool=observeCheck(id,"publish",available).then(returnCheck(id)).then(consumeCheck(id))
  // Generic grant, body and hash failures await one more current-session
  // observation before retaining their error. No failure may publish bytes.
  action failureCheck(id:int,available:bool):bool=observeCheck(id,"failure",available).then(returnCheck(id)).then(consumeCheck(id))
  // HTTP 401/403/404/410 are authoritative refusals, including a grant request
  // whose expected actor no longer matches. An owned refusal clears the parent
  // without first making another session request.
  action authorityRefusal(id:int):bool={
    val request=s.requests.get(id)
    val completed=finished(s,id)
    all{request.phase=="grant" or request.phase=="body",
      s'=if(not(owns(id)))completed
      else completed.with("text",0).with("error",true).with("refreshes",s.refreshes+1)
        .with("active",0).with("busy",0).with("mounted",false).with("present",false).with("aborted",s.aborted.union(Set(id)))}
  }
  action step={nondet id=ids.oneOf() nondet actor=Set(0,1,2).oneOf()
    nondet object=Set(1,2).oneOf() nondet mode=Set(0,1,2).oneOf() nondet ok=Set(false,true).oneOf()
    nondet gate=Set("grant","use","publish","failure").oneOf()
    any{cookieChanges(actor),depart,remount(1,object),remount(2,object),start(id,mode),observeCheck(id,gate,ok),
      returnCheck(id),consumeCheck(id),grantReply(id,ok),consume(id,ok),bodyReply(id,ok),hashReply(id,ok),
      authorityRefusal(id),s'=s}}
  val invariant=all{s.epoch>=1,s.epoch<=2,s.refreshes<=2,s.consumed.subseteq(s.granted),not(s.badEffect),
    not(s.present) implies not(s.mounted),s.busy>0 implies owns(s.busy),
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
    .then(remount(1,2)).then(start(2,0)).then(checkUse(1,true))
    .expect(s.active==2 and s.busy==2 and s.requests.get(1).phase=="done" and s.text==0)
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
    .then(remount(1,2)).then(start(2,0)).then(cookieChanges(2)).then(failureCheck(1,true))
    .expect(s.active==2 and s.busy==2 and s.refreshes==0 and not(s.error) and s.text==0)
  run synchronousBusyGuardRefusesDuplicateSubmitTest=init.then(start(1,2)).then(start(2,2).fail())
  run returnedInitialIdentityCannotGrantAfterDepartureTest=init.then(start(1,2))
    .then(observeCheck(1,"grant",true)).then(returnCheck(1)).then(depart).then(consumeCheck(1))
    .expect(s.requests.get(1).phase=="done" and s.granted==Set() and s.busy==0)
  run observedNativeIdentityCannotClickAfterCommitTest=init.then(start(1,2)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(observeCheck(1,"use",true)).then(depart).then(returnCheck(1)).then(consumeCheck(1))
    .expect(s.clicked==Set() and invariant)
  run returnedNativeIdentityCannotClickAfterCommitTest=init.then(start(1,2)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(observeCheck(1,"use",true)).then(returnCheck(1)).then(depart).then(consumeCheck(1))
    .expect(s.clicked==Set() and invariant)
  run replacedReaderKeepsItsBusyAfterOldIdentityReturnsTest=init.then(start(1,2)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(observeCheck(1,"use",true)).then(returnCheck(1)).then(remount(1,2)).then(start(2,2)).then(consumeCheck(1))
    .expect(s.clicked==Set() and s.busy==2 and invariant)
  run returnedBodyIdentityCannotFetchAfterCommitTest=init.then(start(1,1)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(observeCheck(1,"use",true)).then(returnCheck(1)).then(depart).then(consumeCheck(1))
    .expect(s.requests.get(1).phase=="done" and s.consumed==Set() and invariant)
  run returnedBufferedIdentityCannotDownloadAfterCommitTest=init.then(start(1,1)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(checkUse(1,true)).then(consume(1,true)).then(bodyReply(1,true)).then(hashReply(1,true))
    .then(observeCheck(1,"publish",true)).then(returnCheck(1)).then(depart).then(consumeCheck(1))
    .expect(s.clicked==Set() and s.consumed==Set(1) and invariant)
  run returnedFailureIdentityCannotResetReplacementTest=init.then(start(1,0)).then(checkGrant(1,true)).then(grantReply(1,false))
    .then(observeCheck(1,"failure",true)).then(returnCheck(1)).then(remount(1,2)).then(start(2,0)).then(consumeCheck(1))
    .expect(s.busy==2 and not(s.error) and s.refreshes==0 and invariant)
  // Historical controls are excluded from step. Old passive retirement can
  // leave the owned flag true after committed removal; missing outer guards
  // can use a true helper result even after timely retirement.
  action oldPassiveDepart=s'=s.with("present",false)
  action oldUseReturnedIdentity(id:int):bool=all{s.requests.get(id).phase=="returned",
    s'=s.with("clicked",s.clicked.union(Set(id))).with("badEffect",not(owns(id)))}
  run oldPassiveRetirementCouldDownloadTest=init.then(start(1,2)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(observeCheck(1,"use",true)).then(oldPassiveDepart).then(returnCheck(1)).then(consumeCheck(1))
    .expect(s.clicked==Set(1) and not(invariant))
  run oldMissingOuterGuardCouldDownloadTest=init.then(start(1,2)).then(checkGrant(1,true)).then(grantReply(1,true))
    .then(observeCheck(1,"use",true)).then(returnCheck(1)).then(depart).then(oldUseReturnedIdentity(1))
    .expect(s.clicked==Set(1) and s.badEffect)
}
