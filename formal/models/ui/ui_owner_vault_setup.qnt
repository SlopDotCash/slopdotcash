// @source src/OwnerVaultSetup.tsx
// @source src/lib/pending-attempt.ts
// @source src/lib/solana-vault-actions.ts
// @source src/lib/use-payout-wallets.ts
// @evidence tests/e2e/vault-actions.spec.ts
// Two component lifetimes, seven monotonically identified actions, two hash
// values and one sessionStorage key. Review/chain/registration validity and
// synchronous browser storage success are external predicates. No execution
// of this authored model or its scenarios is claimed.
module ui_owner_vault_setup {
  type Record = {id:int,hash:int,terms:int,legacy:bool}
  type Work = {epoch:int,kind:str,phase:str,captured:Record}
  pure val ids = Set(1,2,3,4,5,6,7)
  pure val empty = {id:0,hash:0,terms:0,legacy:false}
  pure val unused = {epoch:0,kind:"none",phase:"unused",captured:empty}
  var s:{mounted:bool,epoch:int,started:int,active:int,connected:bool,review:int,
    store:Record,local:Record,inputHash:int,work:int->Work,prompts:Set[int],
    registered:Set[int],callbacks:Set[int],error:bool,notice:str}
  action init = s'={mounted:true,epoch:1,started:0,active:0,connected:false,review:0,
    store:empty,local:empty,inputHash:0,work:ids.mapBy(_=>unused),prompts:Set(),
    registered:Set(),callbacks:Set(),error:false,notice:"none"}
  def owns(id:int):bool = s.mounted and s.active==id and s.work.get(id).epoch==s.epoch
  action begin(id:int,kind:str):bool = all{s.mounted,id==s.started+1,ids.contains(id),
    Set("connect","review","recover","create").contains(kind),
    kind!="review" or s.connected,
    kind!="create" or (s.connected and s.review==1 and s.local.id==0),
    s'=s.with("started",id).with("active",id).with("error",false).with("notice","none")
      .with("work",s.work.set(id,{epoch:s.epoch,kind:kind,
        phase:if(kind=="create")"wallet-check" else "waiting",captured:empty}))}
  action connectReply(id:int,valid:bool):bool = {
    val request=s.work.get(id)
    val finished=s.with("work",s.work.set(id,request.with("phase","done")))
    all{request.kind=="connect",request.phase=="waiting",
      s'=if(not(owns(id)))finished
      else finished.with("connected",valid).with("review",0).with("error",not(valid))}
  }
  // review=1 creates a new vault; review=2 is the existing-vault recovery path.
  action reviewReply(id:int,valid:bool,existing:bool):bool = {
    val request=s.work.get(id)
    val accepted=valid and (request.kind!="recover" or existing)
    val finished=s.with("work",s.work.set(id,request.with("phase","done")))
    all{Set("review","recover").contains(request.kind),request.phase=="waiting",
      s'=if(not(owns(id)))finished
      else finished.with("review",if(not(accepted))0 else if(existing)2 else 1).with("error",not(accepted))}
  }
  action walletChecked(id:int,valid:bool):bool = {
    val request=s.work.get(id)
    all{request.kind=="create",request.phase=="wallet-check",
      s'=if(not(owns(id)) or not(valid))s.with("work",s.work.set(id,request.with("phase","done")))
        .with("error",s.error or (owns(id) and not(valid)))
      else s.with("work",s.work.set(id,request.with("phase","fresh-review")))}
  }
  action freshReviewReply(id:int,valid:bool):bool = {
    val request=s.work.get(id)
    all{request.phase=="fresh-review",
      s'=if(not(owns(id)) or not(valid))s.with("work",s.work.set(id,request.with("phase","done")))
        .with("error",s.error or (owns(id) and not(valid)))
      else s.with("work",s.work.set(id,request.with("phase","before-send")))}
  }
  // EVM calls this immediately before eth_sendTransaction; Wallet Standard
  // calls it immediately before signAndSendTransaction. Refused storage never
  // permits a prompt. A fresh ID makes an empty-record ABA distinguishable.
  action send(id:int,storageWorks:bool):bool = {
    val request=s.work.get(id)
    val reserved={id:id,hash:0,terms:1,legacy:false}
    all{request.phase=="before-send",
      s'=if(not(owns(id)))s.with("work",s.work.set(id,request.with("phase","done")))
      else if(not(storageWorks) or s.store.id!=0)s.with("work",s.work.set(id,request.with("phase","done"))).with("error",true)
      else s.with("store",reserved).with("local",reserved).with("inputHash",0)
        .with("prompts",s.prompts.union(Set(id)))
        .with("work",s.work.set(id,request.with("phase","wallet").with("captured",reserved)))}
  }
  // outcome: 1 valid hash, 2 authoritative 4001 refusal, 3 unknown result.
  // A late wallet reply may settle its exact record even after departure.
  action walletReply(id:int,outcome:int,storageWorks:bool):bool = {
    val request=s.work.get(id)
    val submitted=request.captured.with("hash",1)
    val same=s.store==request.captured
    val nextStore=if(same and storageWorks and outcome==1)submitted
      else if(same and storageWorks and outcome==2)empty else s.store
    val finished=s.with("store",nextStore).with("work",s.work.set(id,request.with("phase","done")))
    all{request.phase=="wallet",outcome>=1,outcome<=3,
      s'=if(not(owns(id)))finished
      else if(outcome==1)finished.with("local",if(same and storageWorks)submitted else s.local)
        .with("inputHash",1).with("review",0)
        .with("notice",if(same and storageWorks)"sent" else "keep-hash")
      else if(outcome==2)finished.with("local",if(same and storageWorks)empty else s.local).with("error",true)
      else finished.with("error",true)}
  }
  action depart = s'=s.with("mounted",false).with("active",0).with("connected",false).with("review",0)
  action changeChoice = all{s.mounted,s'=s.with("active",0).with("review",0)}
  action remount = all{s.epoch==1,
    s'=s.with("mounted",true).with("epoch",2).with("active",0).with("connected",false)
      .with("review",0).with("local",s.store).with("inputHash",s.store.hash).with("error",false).with("notice","none")}
  // The source requires the explicit wallet-activity acknowledgement. This
  // action represents that acknowledgement, not a timer or automatic retry.
  action userConfirmsUnsent = all{s.mounted,s.local.id!=0,s.local.hash==0,s.store==s.local,
    s'=s.with("store",empty).with("local",empty).with("review",0).with("inputHash",0).with("active",0)}
  // Legacy records remain recoverable and are compared in full, without
  // requiring an attemptId that an older client never wrote.
  action loadLegacy = all{s.started==0,s.store.id==0,
    s'=s.with("store",{id:7,hash:0,terms:1,legacy:true})
      .with("local",{id:7,hash:0,terms:1,legacy:true})}
  action beginRegister(id:int,hash:int,storageWorks:bool):bool = {
    val existing=s.local.id!=0
    val submitted=if(existing)s.local.with("hash",hash) else {id:id,hash:hash,terms:1,legacy:false}
    val allowed=if(existing)s.store==s.local else s.store.id==0
    all{s.mounted,id==s.started+1,ids.contains(id),hash>=1,hash<=2,existing or s.review==2,
      s'=if(not(storageWorks) or not(allowed))s.with("error",true)
        .with("started",id).with("active",id)
        .with("work",s.work.set(id,{epoch:s.epoch,kind:"register",phase:"done",captured:submitted}))
      else s.with("store",submitted).with("local",submitted).with("inputHash",hash)
        .with("started",id).with("active",id).with("error",false)
        .with("work",s.work.set(id,{epoch:s.epoch,kind:"register",phase:"registering",captured:submitted}))}
  }
  // outcome: 1 still pending, 2 validated registered result, 3 invalid/failure.
  action registerReply(id:int,outcome:int):bool = {
    val request=s.work.get(id)
    val finished=s.with("work",s.work.set(id,request.with("phase","done")))
    all{request.kind=="register",request.phase=="registering",outcome>=1,outcome<=3,
      s'=if(not(owns(id)))finished
      else if(s.store!=request.captured)finished.with("error",true)
      else if(outcome==2)s.with("registered",s.registered.union(Set(id))).with("callbacks",s.callbacks.union(Set(id)))
        .with("work",s.work.set(id,request.with("phase","callback")))
      else if(outcome==1)finished.with("notice","pending")
      else finished.with("error",true)}
  }
  action callbackSettled(id:int,storageWorks:bool):bool = {
    val request=s.work.get(id)
    val cleared=storageWorks and s.store==request.captured
    val finished=s.with("store",if(cleared)empty else s.store)
      .with("work",s.work.set(id,request.with("phase","done")))
    all{request.phase=="callback",
      s'=if(not(owns(id)))finished
      else finished.with("local",if(cleared)empty else s.local).with("review",0).with("error",not(cleared))}
  }
  action callbackFailed(id:int):bool = all{s.work.get(id).phase=="callback",
    s'=s.with("work",s.work.set(id,s.work.get(id).with("phase","done")))
      .with("error",s.error or owns(id))}
  action step={nondet id=ids.oneOf() nondet kind=Set("connect","review","recover","create").oneOf()
    nondet ok=Set(false,true).oneOf() nondet existing=Set(false,true).oneOf() nondet outcome=Set(1,2,3).oneOf()
    nondet hash=Set(1,2).oneOf()
    any{begin(id,kind),connectReply(id,ok),reviewReply(id,ok,existing),walletChecked(id,ok),freshReviewReply(id,ok),
      send(id,ok),walletReply(id,outcome,ok),depart,changeChoice,remount,userConfirmsUnsent,loadLegacy,
      beginRegister(id,hash,ok),registerReply(id,outcome),callbackSettled(id,ok),callbackFailed(id),s'=s}}
  val invariant=all{s.epoch>=1,s.epoch<=2,s.started>=0,s.started<=7,
    s.store.hash>=0,s.store.hash<=2,s.store.id==0 implies s.store==empty,
    s.callbacks.subseteq(s.registered),s.prompts.forall(id=>s.work.get(id).captured.id==id)}
  run connectReviewCreateRegisterTest=init.then(begin(1,"connect")).then(connectReply(1,true))
    .then(begin(2,"review")).then(reviewReply(2,true,false)).then(begin(3,"create")).then(walletChecked(3,true))
    .then(freshReviewReply(3,true)).then(send(3,true)).then(walletReply(3,1,true)).then(beginRegister(4,1,true))
    .then(registerReply(4,2)).then(callbackSettled(4,true)).expect(s.store==empty and s.callbacks==Set(4))
  run departedConnectDoesNotPublishWalletTest=init.then(begin(1,"connect")).then(depart).then(connectReply(1,true))
    .expect(not(s.connected) and s.prompts==Set())
  run departedReviewDoesNotPublishReviewTest=init.then(begin(1,"connect")).then(connectReply(1,true))
    .then(begin(2,"review")).then(depart).then(reviewReply(2,true,false)).expect(s.review==0)
  run departedWalletCheckDoesNotStartReviewTest=init.then(begin(1,"connect")).then(connectReply(1,true))
    .then(begin(2,"review")).then(reviewReply(2,true,false)).then(begin(3,"create")).then(depart)
    .then(walletChecked(3,true)).expect(s.work.get(3).phase=="done" and s.prompts==Set())
  run departedFreshReviewDoesNotPromptTest=init.then(begin(1,"connect")).then(connectReply(1,true))
    .then(begin(2,"review")).then(reviewReply(2,true,false)).then(begin(3,"create")).then(walletChecked(3,true))
    .then(depart).then(freshReviewReply(3,true)).expect(s.prompts==Set() and s.store==empty)
  run storageFailureDoesNotPromptTest=init.then(begin(1,"connect")).then(connectReply(1,true))
    .then(begin(2,"review")).then(reviewReply(2,true,false)).then(begin(3,"create")).then(walletChecked(3,true))
    .then(freshReviewReply(3,true)).then(send(3,false)).expect(s.prompts==Set() and s.store==empty and s.error)
  run departedWalletMayRetainOwnedHashTest=init.then(begin(1,"connect")).then(connectReply(1,true))
    .then(begin(2,"review")).then(reviewReply(2,true,false)).then(begin(3,"create")).then(walletChecked(3,true))
    .then(freshReviewReply(3,true)).then(send(3,true)).then(depart).then(walletReply(3,1,true))
    .expect(s.store.id==3 and s.store.hash==1 and s.notice=="none")
  run failedHashWriteKeepsRecoveryInputTest=init.then(begin(1,"connect")).then(connectReply(1,true))
    .then(begin(2,"review")).then(reviewReply(2,true,false)).then(begin(3,"create")).then(walletChecked(3,true))
    .then(freshReviewReply(3,true)).then(send(3,true)).then(walletReply(3,1,false))
    .expect(s.store.hash==0 and s.inputHash==1 and s.notice=="keep-hash")
  run oldDeclineDoesNotEraseNewReservationTest=init.then(begin(1,"connect")).then(connectReply(1,true))
    .then(begin(2,"review")).then(reviewReply(2,true,false)).then(begin(3,"create")).then(walletChecked(3,true))
    .then(freshReviewReply(3,true)).then(send(3,true)).then(depart).then(remount).then(userConfirmsUnsent)
    .then(begin(4,"connect")).then(connectReply(4,true)).then(begin(5,"review")).then(reviewReply(5,true,false))
    .then(begin(6,"create")).then(walletChecked(6,true)).then(freshReviewReply(6,true)).then(send(6,true))
    .then(walletReply(3,2,true)).expect(s.store.id==6 and s.store.hash==0)
  run oldHashDoesNotReplaceNewReservationTest=init.then(begin(1,"connect")).then(connectReply(1,true))
    .then(begin(2,"review")).then(reviewReply(2,true,false)).then(begin(3,"create")).then(walletChecked(3,true))
    .then(freshReviewReply(3,true)).then(send(3,true)).then(depart).then(remount).then(userConfirmsUnsent)
    .then(begin(4,"connect")).then(connectReply(4,true)).then(begin(5,"review")).then(reviewReply(5,true,false))
    .then(begin(6,"create")).then(walletChecked(6,true)).then(freshReviewReply(6,true)).then(send(6,true))
    .then(walletReply(3,1,true)).expect(s.store.id==6 and s.store.hash==0)
  run legacyRequestCanRegisterTest=init.then(loadLegacy).then(beginRegister(1,2,true)).then(registerReply(1,2))
    .then(callbackSettled(1,true)).expect(s.store==empty and s.callbacks==Set(1))
  run pendingRegistrationRetainsRequestTest=init.then(loadLegacy).then(beginRegister(1,2,true)).then(registerReply(1,1))
    .expect(s.store.legacy and s.store.hash==2 and s.notice=="pending" and s.callbacks==Set())
  run departedRegistrationDoesNotNotifyParentTest=init.then(loadLegacy).then(beginRegister(1,2,true)).then(depart)
    .then(registerReply(1,2)).expect(s.store.hash==2 and s.callbacks==Set())
  run supersededRegistrationCannotClearChangedHashTest=init.then(loadLegacy).then(beginRegister(1,1,true)).then(registerReply(1,2))
    .then(depart).then(remount).then(beginRegister(2,2,true)).then(callbackSettled(1,true)).expect(s.store.hash==2)
  run supersededReviewCannotReplaceCurrentReviewTest=init.then(begin(1,"connect")).then(connectReply(1,true))
    .then(begin(2,"review")).then(begin(3,"review")).then(reviewReply(3,true,true)).then(reviewReply(2,true,false))
    .expect(s.review==2)
  run existingVaultRecoversWithoutConnectingTest=init.then(begin(1,"recover")).then(reviewReply(1,true,true))
    .then(beginRegister(2,1,true)).then(registerReply(2,1)).expect(not(s.connected) and s.store.hash==1 and s.notice=="pending")
  run parentCallbackFailureKeepsRecoveryRecordTest=init.then(loadLegacy).then(beginRegister(1,2,true))
    .then(registerReply(1,2)).then(callbackFailed(1)).expect(s.store.hash==2 and s.error)
  run changedChoiceInvalidatesWaitingReviewTest=init.then(begin(1,"connect")).then(connectReply(1,true))
    .then(begin(2,"review")).then(changeChoice).then(reviewReply(2,true,false)).expect(s.review==0)
}
