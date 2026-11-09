// @source src/OwnerVaultSetup.tsx
// @source src/lib/pending-attempt.ts
// @source src/lib/solana-vault-actions.ts
// @source src/lib/use-payout-wallets.ts
// @evidence tests/e2e/vault-actions.spec.ts
// Two component lifetimes, seven monotonically identified actions, two hash
// values and one sessionStorage key. Review/chain/registration validity and
// synchronous browser storage success are external predicates. No execution
// of this authored model or its scenarios is claimed.
//
// Finite step reductions. Each action has a *With(..., reduce) form; direct
// actions and named scenarios pass false and keep the exact state. step
// passes true, which applies settle to every successor:
// - inputHash, notice and error are write-only: no guard, update of another
//   field or invariant reads them (error is only OR-ed into itself), so step
//   records them as 0, "none" and false. Scenarios keep the exact values.
// - Ownership of a request is absorbing-false: active only names a fresh id,
//   depart, changeChoice and userConfirmsUnsent clear it and remount moves to
//   epoch 2. An unowned request in waiting, wallet-check, fresh-review,
//   before-send or registering only marks itself done. An unowned wallet
//   request changes store only while store equals its captured record, and
//   store returns to a reserved hash-0 record only through send of a fresh id.
//   Such requests, and done requests, become one fixed retired record. Other
//   unowned wallet and callback requests keep their captured record; their
//   epoch and kind are never read again and become 0 and "none".
// - active naming a retired request is replaced by 0: owns(id) is only read
//   for requests that are not done, and begin always names a fresh id.
// - prompts, registered and callbacks are read only by the invariant. They
//   only grow, and each member's conjunct (captured.id == id, membership in
//   registered) is fixed when the member is added by an owned send or
//   registerReply, whose successor keeps it. step therefore keeps only members
//   whose request is still owned and live; the conjunct for every member is
//   still checked in the first state that contains it.
// - Choices with identical successors under these projections are offered
//   once: begin and beginRegister use the fresh id, a refused review ignores
//   existing, an unowned/mismatched reply ignores storage success, a failed
//   register ignores its hash, and outcome 3 equals outcome 2 (wallet) or 1
//   (register) once error and notice are projected.
module ui_owner_vault_setup {
  type Record = {id:int,hash:int,terms:int,legacy:bool}
  type Work = {epoch:int,kind:str,phase:str,captured:Record}
  pure val ids = Set(1,2,3,4,5,6,7)
  pure val empty = {id:0,hash:0,terms:0,legacy:false}
  pure val unused = {epoch:0,kind:"none",phase:"unused",captured:empty}
  type State = {mounted:bool,epoch:int,started:int,active:int,connected:bool,review:int,
    store:Record,local:Record,inputHash:int,work:int->Work,prompts:Set[int],
    registered:Set[int],callbacks:Set[int],error:bool,notice:str}
  var s:State
  action init = s'={mounted:true,epoch:1,started:0,active:0,connected:false,review:0,
    store:empty,local:empty,inputHash:0,work:ids.mapBy(_=>unused),prompts:Set(),
    registered:Set(),callbacks:Set(),error:false,notice:"none"}
  def ownsIn(st:State,id:int):bool = st.mounted and st.active==id and st.work.get(id).epoch==st.epoch
  def owns(id:int):bool = ownsIn(s,id)
  // Finite-step canonical form; see the header. Direct actions pass false.
  pure val retired = {epoch:0,kind:"none",phase:"done",captured:empty}
  def settledWork(st:State,id:int):Work = {
    val w=st.work.get(id)
    if(w.phase=="unused" or (ownsIn(st,id) and w.phase!="done"))w
    else if(w.phase=="done" or not(Set("wallet","callback").contains(w.phase))
      or (w.phase=="wallet" and st.store!=w.captured))retired
    else w.with("epoch",0).with("kind","none")
  }
  def settle(reduce:bool,st:State):State = if(not(reduce))st else {
    val work=ids.mapBy(id=>settledWork(st,id))
    val live=ids.filter(id=>work.get(id).phase!="done")
    val owned=live.filter(id=>st.mounted and st.active==id and work.get(id).epoch==st.epoch)
    st.with("inputHash",0).with("notice","none").with("error",false).with("work",work)
      .with("active",if(live.contains(st.active))st.active else 0)
      .with("prompts",st.prompts.intersect(owned)).with("registered",st.registered.intersect(owned))
      .with("callbacks",st.callbacks.intersect(owned))
  }
  action beginWith(id:int, kind:str, reduce: bool): bool = all{s.mounted,id==s.started+1,ids.contains(id),
    Set("connect","review","recover","create").contains(kind),
    kind!="review" or s.connected,
    kind!="create" or (s.connected and s.review==1 and s.local.id==0),
    s'=settle(reduce, s.with("started",id).with("active",id).with("error",false).with("notice","none")
      .with("work",s.work.set(id,{epoch:s.epoch,kind:kind,
        phase:if(kind=="create")"wallet-check" else "waiting",captured:empty})))}
  action begin(id:int,kind:str): bool = beginWith(id, kind, false)
  action connectReplyWith(id:int, valid:bool, reduce: bool): bool = {
    val request=s.work.get(id)
    val finished=s.with("work",s.work.set(id,request.with("phase","done")))
    all{request.kind=="connect",request.phase=="waiting",
      s'=settle(reduce, if(not(owns(id)))finished
      else finished.with("connected",valid).with("review",0).with("error",not(valid)))}
  }
  action connectReply(id:int,valid:bool): bool = connectReplyWith(id, valid, false)
  // review=1 creates a new vault; review=2 is the existing-vault recovery path.
  action reviewReplyWith(id:int, valid:bool, existing:bool, reduce: bool): bool = {
    val request=s.work.get(id)
    val accepted=valid and (request.kind!="recover" or existing)
    val finished=s.with("work",s.work.set(id,request.with("phase","done")))
    all{Set("review","recover").contains(request.kind),request.phase=="waiting",
      s'=settle(reduce, if(not(owns(id)))finished
      else finished.with("review",if(not(accepted))0 else if(existing)2 else 1).with("error",not(accepted)))}
  }
  action reviewReply(id:int,valid:bool,existing:bool): bool = reviewReplyWith(id, valid, existing, false)
  action walletCheckedWith(id:int, valid:bool, reduce: bool): bool = {
    val request=s.work.get(id)
    all{request.kind=="create",request.phase=="wallet-check",
      s'=settle(reduce, if(not(owns(id)) or not(valid))s.with("work",s.work.set(id,request.with("phase","done")))
        .with("error",s.error or (owns(id) and not(valid)))
      else s.with("work",s.work.set(id,request.with("phase","fresh-review"))))}
  }
  action walletChecked(id:int,valid:bool): bool = walletCheckedWith(id, valid, false)
  action freshReviewReplyWith(id:int, valid:bool, reduce: bool): bool = {
    val request=s.work.get(id)
    all{request.phase=="fresh-review",
      s'=settle(reduce, if(not(owns(id)) or not(valid))s.with("work",s.work.set(id,request.with("phase","done")))
        .with("error",s.error or (owns(id) and not(valid)))
      else s.with("work",s.work.set(id,request.with("phase","before-send"))))}
  }
  action freshReviewReply(id:int,valid:bool): bool = freshReviewReplyWith(id, valid, false)
  // EVM calls this immediately before eth_sendTransaction; Wallet Standard
  // calls it immediately before signAndSendTransaction. Refused storage never
  // permits a prompt. A fresh ID makes an empty-record ABA distinguishable.
  action sendWith(id:int, storageWorks:bool, reduce: bool): bool = {
    val request=s.work.get(id)
    val reserved={id:id,hash:0,terms:1,legacy:false}
    all{request.phase=="before-send",
      s'=settle(reduce, if(not(owns(id)))s.with("work",s.work.set(id,request.with("phase","done")))
      else if(not(storageWorks) or s.store.id!=0)s.with("work",s.work.set(id,request.with("phase","done"))).with("error",true)
      else s.with("store",reserved).with("local",reserved).with("inputHash",0)
        .with("prompts",s.prompts.union(Set(id)))
        .with("work",s.work.set(id,request.with("phase","wallet").with("captured",reserved))))}
  }
  action send(id:int,storageWorks:bool): bool = sendWith(id, storageWorks, false)
  // outcome: 1 valid hash, 2 authoritative 4001 refusal, 3 unknown result.
  // A late wallet reply may settle its exact record even after departure.
  action walletReplyWith(id:int, outcome:int, storageWorks:bool, reduce: bool): bool = {
    val request=s.work.get(id)
    val submitted=request.captured.with("hash",1)
    val same=s.store==request.captured
    val nextStore=if(same and storageWorks and outcome==1)submitted
      else if(same and storageWorks and outcome==2)empty else s.store
    val finished=s.with("store",nextStore).with("work",s.work.set(id,request.with("phase","done")))
    all{request.phase=="wallet",outcome>=1,outcome<=3,
      s'=settle(reduce, if(not(owns(id)))finished
      else if(outcome==1)finished.with("local",if(same and storageWorks)submitted else s.local)
        .with("inputHash",1).with("review",0)
        .with("notice",if(same and storageWorks)"sent" else "keep-hash")
      else if(outcome==2)finished.with("local",if(same and storageWorks)empty else s.local).with("error",true)
      else finished.with("error",true))}
  }
  action walletReply(id:int,outcome:int,storageWorks:bool): bool = walletReplyWith(id, outcome, storageWorks, false)
  action departWith(reduce: bool): bool = s'=settle(reduce, s.with("mounted",false).with("active",0).with("connected",false).with("review",0))
  action depart = departWith(false)
  action changeChoiceWith(reduce: bool): bool = all{s.mounted,s'=settle(reduce, s.with("active",0).with("review",0))}
  action changeChoice = changeChoiceWith(false)
  action remountWith(reduce: bool): bool = all{s.epoch==1,
    s'=settle(reduce, s.with("mounted",true).with("epoch",2).with("active",0).with("connected",false)
      .with("review",0).with("local",s.store).with("inputHash",s.store.hash).with("error",false).with("notice","none"))}
  action remount = remountWith(false)
  // The source requires the explicit wallet-activity acknowledgement. This
  // action represents that acknowledgement, not a timer or automatic retry.
  action userConfirmsUnsentWith(reduce: bool): bool = all{s.mounted,s.local.id!=0,s.local.hash==0,s.store==s.local,
    s'=settle(reduce, s.with("store",empty).with("local",empty).with("review",0).with("inputHash",0).with("active",0))}
  action userConfirmsUnsent = userConfirmsUnsentWith(false)
  // Legacy records remain recoverable and are compared in full, without
  // requiring an attemptId that an older client never wrote.
  action loadLegacyWith(reduce: bool): bool = all{s.started==0,s.store.id==0,
    s'=settle(reduce, s.with("store",{id:7,hash:0,terms:1,legacy:true})
      .with("local",{id:7,hash:0,terms:1,legacy:true}))}
  action loadLegacy = loadLegacyWith(false)
  action beginRegisterWith(id:int, hash:int, storageWorks:bool, reduce: bool): bool = {
    val existing=s.local.id!=0
    val submitted=if(existing)s.local.with("hash",hash) else {id:id,hash:hash,terms:1,legacy:false}
    val allowed=if(existing)s.store==s.local else s.store.id==0
    all{s.mounted,id==s.started+1,ids.contains(id),hash>=1,hash<=2,existing or s.review==2,
      s'=settle(reduce, if(not(storageWorks) or not(allowed))s.with("error",true)
        .with("started",id).with("active",id)
        .with("work",s.work.set(id,{epoch:s.epoch,kind:"register",phase:"done",captured:submitted}))
      else s.with("store",submitted).with("local",submitted).with("inputHash",hash)
        .with("started",id).with("active",id).with("error",false)
        .with("work",s.work.set(id,{epoch:s.epoch,kind:"register",phase:"registering",captured:submitted})))}
  }
  action beginRegister(id:int,hash:int,storageWorks:bool): bool = beginRegisterWith(id, hash, storageWorks, false)
  // outcome: 1 still pending, 2 validated registered result, 3 invalid/failure.
  action registerReplyWith(id:int, outcome:int, reduce: bool): bool = {
    val request=s.work.get(id)
    val finished=s.with("work",s.work.set(id,request.with("phase","done")))
    all{request.kind=="register",request.phase=="registering",outcome>=1,outcome<=3,
      s'=settle(reduce, if(not(owns(id)))finished
      else if(s.store!=request.captured)finished.with("error",true)
      else if(outcome==2)s.with("registered",s.registered.union(Set(id))).with("callbacks",s.callbacks.union(Set(id)))
        .with("work",s.work.set(id,request.with("phase","callback")))
      else if(outcome==1)finished.with("notice","pending")
      else finished.with("error",true))}
  }
  action registerReply(id:int,outcome:int): bool = registerReplyWith(id, outcome, false)
  action callbackSettledWith(id:int, storageWorks:bool, reduce: bool): bool = {
    val request=s.work.get(id)
    val cleared=storageWorks and s.store==request.captured
    val finished=s.with("store",if(cleared)empty else s.store)
      .with("work",s.work.set(id,request.with("phase","done")))
    all{request.phase=="callback",
      s'=settle(reduce, if(not(owns(id)))finished
      else finished.with("local",if(cleared)empty else s.local).with("review",0).with("error",not(cleared)))}
  }
  action callbackSettled(id:int,storageWorks:bool): bool = callbackSettledWith(id, storageWorks, false)
  action callbackFailedWith(id:int, reduce: bool): bool = all{s.work.get(id).phase=="callback",
    s'=settle(reduce, s.with("work",s.work.set(id,s.work.get(id).with("phase","done")))
      .with("error",s.error or owns(id)))}
  action callbackFailed(id:int): bool = callbackFailedWith(id, false)
  action step = any {
    { nondet kind = Set("connect","review","recover","create").oneOf() beginWith(s.started+1,kind, true) },
    { nondet id = ids.oneOf() nondet ok = Set(false,true).oneOf() connectReplyWith(id,ok, true) },
    { nondet id = ids.oneOf() nondet ok = Set(false,true).oneOf() nondet existing = Set(false,true).oneOf()
      all { ok or not(existing), reviewReplyWith(id,ok,existing, true) } },
    { nondet id = ids.oneOf() nondet ok = Set(false,true).oneOf() walletCheckedWith(id,ok, true) },
    { nondet id = ids.oneOf() nondet ok = Set(false,true).oneOf() freshReviewReplyWith(id,ok, true) },
    { nondet id = ids.oneOf() nondet ok = Set(false,true).oneOf() all { ok or s.store.id==0, sendWith(id,ok, true) } },
    { nondet id = ids.oneOf() nondet ok = Set(false,true).oneOf() nondet outcome = Set(1,2).oneOf()
      all { ok or s.store==s.work.get(id).captured, walletReplyWith(id,outcome,ok, true) } },
    departWith(true),
    changeChoiceWith(true),
    remountWith(true),
    userConfirmsUnsentWith(true),
    loadLegacyWith(true),
    { nondet ok = Set(false,true).oneOf() nondet hash = Set(1,2).oneOf()
      all { ok or hash==1, beginRegisterWith(s.started+1,hash,ok, true) } },
    { nondet id = ids.oneOf() nondet outcome = Set(1,2).oneOf() registerReplyWith(id,outcome, true) },
    { nondet id = ids.oneOf() nondet ok = Set(false,true).oneOf()
      all { ok or s.store==s.work.get(id).captured, callbackSettledWith(id,ok, true) } },
    { nondet id = ids.oneOf() callbackFailedWith(id, true) },
    s'=s,
  }
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
