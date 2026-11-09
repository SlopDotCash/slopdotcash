// @source src/PointsDisputes.tsx
// @source src/Inbox.tsx
// @source src/Link.tsx
// @source src/App.tsx
// @source src/lib/browser-json.ts
// @evidence tests/e2e/points-disputes.spec.ts
// Two component lifetimes/actors, two read callbacks and two mutation callbacks.
// Request/result grammar and backend decisions are external predicates.
// No mutex or mutation-generation fence is assumed. Committed layout cleanup
// retires component and read ownership; HTTP/session observations are inputs,
// not continuous cookie truth. Authored without execution.
module ui_points_disputes {
  type Observation = {outcome:int,payload:int,draft:bool,decider:bool,actor:int,refused:bool}
  type Request = {epoch:int,actor:int,target:int,kind:str,phase:str}
  type State = {mounted:bool,epoch:int,actor:int,cookie:int,parent:str,url:int,keyTarget:int,
    selected:int,cursor:int,page:int,nextPage:bool,detail:int,detailId:int,privateOwner:int,
    draft:bool,mayDecide:bool,award:int,reason:bool,decision:bool,
    busy:bool,error:str,reload:bool,activeRead:int,reads:int->Request,
    mutations:int->Request,accepted:Set[int],parentNotifications:int,
    readObservations:int->Observation,mutationObservations:int->Observation}
  pure val ids=Set(1,2)
  pure val unused={epoch:0,actor:0,target:0,kind:"none",phase:"unused"}
  var s:State
  action init=s'={mounted:true,epoch:1,actor:1,cookie:1,parent:"ready",url:0,keyTarget:0,
    selected:0,cursor:0,page:0,nextPage:false,detail:0,detailId:0,privateOwner:0,
    draft:false,mayDecide:false,award:0,reason:false,decision:false,
    busy:false,error:"none",reload:true,activeRead:0,
    reads:ids.mapBy(_=>unused),mutations:ids.mapBy(_=>unused),
    accepted:Set(),parentNotifications:0,
    readObservations:ids.mapBy(_=>{outcome:0,payload:1,draft:false,decider:false,actor:0,refused:false}),
    mutationObservations:ids.mapBy(_=>{outcome:0,payload:1,draft:false,decider:false,actor:0,refused:false})}
  def clearPrivate(value:State):State=value.with("page",0).with("nextPage",false)
    .with("detail",0).with("detailId",0).with("draft",false).with("mayDecide",false)
    .with("award",0).with("reason",false).with("decision",false).with("privateOwner",0)
  def owns(request:Request):bool=s.mounted and request.epoch==s.epoch and request.actor==s.actor
  val visible=s.mounted and s.parent!="loading" and s.parent!="gone"
  val view=if(s.detail>0)"detail" else if(s.award>0)"form"
    else if(s.selected==0 and s.page==1)"empty"
    else if(s.selected==0 and s.page==2)"list" else "none"
  val maySubmit=visible and not(s.busy) and view=="form" and s.reason
  val mayResolve=visible and not(s.busy) and view=="detail" and s.mayDecide and s.decision
  val mayRetryTriage=visible and not(s.busy) and view=="detail" and not(s.draft) and s.detail!=3
  action parentLoads=all{s.mounted,s'=s.with("parent","loading")}
  action parentSameActor=all{s.mounted,s.cookie==s.actor,s.url==s.keyTarget,s'=s.with("parent","ready")}
  action parentUnavailableSameActor=all{s.mounted,s.cookie==s.actor,s.url==s.keyTarget,
    s'=s.with("parent","error")}
  // Link pushes a query URL and dispatches popstate. The Inbox key includes
  // recipient + complete search, so query navigation remounts this child.
  action remount(actor:int,target:int):bool=all{s.epoch==1,actor>=1,actor<=2,target>=0,target<=2,
    s'=clearPrivate(s).with("mounted",true).with("epoch",2).with("actor",actor)
      .with("cookie",actor).with("parent","ready").with("url",target)
      .with("keyTarget",target)
      .with("selected",target).with("cursor",0).with("busy",false)
      .with("error","none").with("reload",true).with("activeRead",0)}
  action depart=all{s.mounted,
    s'=clearPrivate(s).with("mounted",false).with("parent","gone").with("activeRead",0)}
  action cookieChanges(actor:int):bool=all{actor>=0,actor<=2,s'=s.with("cookie",actor)}
  action startRead(id:int):bool=all{s.mounted,s.reload,s.reads.get(id).phase=="unused",
    s'=s.with("reads",s.reads.set(id,{epoch:s.epoch,actor:s.actor,target:s.selected,kind:"read",phase:"pending"}))
      .with("activeRead",id).with("reload",false).with("busy",true)
      .with("error","none").with("detail",0).with("detailId",0)
      .with("draft",false).with("mayDecide",false)}
  // Header refusals clear cached payloads before either body parsing or the
  // later session lookup. They retain the request's current busy state.
  action refusedReadHeaders(id:int):bool={
    val request=s.reads.get(id)
    val waiting=s.with("reads",s.reads.set(id,request.with("phase","refused-body")))
    all{request.phase=="pending",
      s'=if(owns(request) and s.activeRead==id)clearPrivate(waiting) else waiting}
  }
  // Also represents a 409 account_changed recognized only after body parsing.
  // A body failure after refused headers still proceeds to the session check.
  action refusedReadBody(id:int):bool={
    val request=s.reads.get(id)
    val waiting=s.with("reads",s.reads.set(id,request.with("phase","refused-session")))
    all{Set("pending","refused-body").contains(request.phase),
      s'=if(owns(request) and s.activeRead==id)clearPrivate(waiting) else waiting}
  }
  // outcome: 0 same-actor transport failure; 1 accepted JSON; 2 authority
  // refusal after body; 3 session unavailable. A refused HTTP response cannot
  // become a successful payload because the later session happens to match.
  // The helper's session observation does not own the later caller callback.
  // Committed removal aborts the read before either can invalidate its parent.
  action observeRead(id:int,outcome:int,payload:int,draft:bool,decider:bool):bool={
    val request=s.reads.get(id)
    all{Set("pending","refused-session").contains(request.phase),
      outcome>=0,outcome<=3,payload>=1,payload<=3,
      request.phase!="pending" or outcome!=2,
      request.phase!="refused-session" or outcome!=1,
      s'=s.with("reads",s.reads.set(id,request.with("phase","session-observed")))
        .with("readObservations",s.readObservations.set(id,{outcome:outcome,payload:payload,
          draft:draft,decider:decider,actor:s.cookie,refused:request.phase=="refused-session"}))}
  }
  action returnRead(id:int):bool=all{s.reads.get(id).phase=="session-observed",
    s'=s.with("reads",s.reads.set(id,s.reads.get(id).with("phase","session-returned")))}
  action useRead(id:int):bool={
    val observation=s.readObservations.get(id)
    val outcome=observation.outcome
    val payload=observation.payload
    val draft=observation.draft
    val decider=observation.decider
    val request=s.reads.get(id)
    val current=owns(request) and s.activeRead==id
    val invalid=observation.refused or outcome==3 or observation.actor!=request.actor
    val changedIdentity=outcome!=3 and observation.actor!=request.actor
    val finished=s.with("reads",s.reads.set(id,request.with("phase","done")))
    all{request.phase=="session-returned",
      s'=if(not(current))finished
      else if(invalid)clearPrivate(finished).with("busy",false).with("error","identity")
        .with("parent","loading").with("parentNotifications",s.parentNotifications+1)
        .with("url",if(changedIdentity)0 else s.url)
      else if(outcome==0)finished.with("busy",false).with("error","request")
      else if(request.target==0)finished.with("busy",false)
        .with("page",if(payload==1)1 else 2).with("nextPage",payload!=1).with("privateOwner",s.actor)
      else finished.with("busy",false).with("detail",payload).with("detailId",request.target)
        .with("draft",draft).with("mayDecide",payload==2 and decider).with("privateOwner",s.actor)}
  }
  action readReply(id:int,outcome:int,payload:int,draft:bool,decider:bool):bool=
    observeRead(id,outcome,payload,draft,decider).then(returnRead(id)).then(useRead(id))
  action retryRead=all{visible,s.error!="none",s'=s.with("reload",true)}
  action olderRecords=all{visible,not(s.busy),view=="list",s.nextPage,s.cursor==0,
    s'=s.with("cursor",1).with("reload",true)}
  action chooseAward(id:int):bool=all{visible,not(s.busy),view=="list",ids.contains(id),
    s'=s.with("award",id).with("reason",false)}
  action editReason(valid:bool):bool=all{visible,not(s.busy),view=="form",s'=s.with("reason",valid)}
  action editDecision(valid:bool):bool=all{visible,not(s.busy),view=="detail",s.mayDecide,
    s'=s.with("decision",valid)}
  action back=all{visible,not(s.busy),view=="form",s'=s.with("award",0)}
  // The callback has no synchronous busy/ref guard. The model accepts at
  // most two delivered callbacks; their real DOM scheduling is not proved.
  action beginMutation(id:int,kind:str):bool={
    val admissible=(kind=="create" and view=="form" and s.reason)
      or (kind=="decision" and view=="detail" and s.mayDecide and s.decision)
      or (kind=="retry" and view=="detail" and not(s.draft) and s.detail!=3)
    val target=if(kind=="create")s.award else s.detailId
    all{visible,admissible,s.mutations.get(id).phase=="unused",
      s'=s.with("mutations",s.mutations.set(id,{epoch:s.epoch,actor:s.actor,target:target,kind:kind,phase:"pending"}))
        .with("busy",true).with("error","none")}
  }
  // A target denotes an award and its associated dispute, not equal literal
  // revision/dispute IDs. Server acceptance can precede a lost response or
  // departure; it is not a Points adjustment or a payment.
  action acceptMutation(id:int):bool=all{s.mutations.get(id).phase=="pending",
    s'=s.with("accepted",s.accepted.union(Set(id)))}
  action refusedMutationHeaders(id:int):bool={
    val request=s.mutations.get(id)
    val waiting=s.with("mutations",s.mutations.set(id,request.with("phase","refused-body")))
    all{request.phase=="pending",
      s'=if(owns(request))clearPrivate(waiting) else waiting}
  }
  action refusedMutationBody(id:int):bool={
    val request=s.mutations.get(id)
    val waiting=s.with("mutations",s.mutations.set(id,request.with("phase","refused-session")))
    all{Set("pending","refused-body").contains(request.phase),
      s'=if(owns(request))clearPrivate(waiting) else waiting}
  }
  action observeMutation(id:int,outcome:int):bool={
    val request=s.mutations.get(id)
    all{Set("pending","refused-session").contains(request.phase),outcome>=0,outcome<=3,
      request.phase!="pending" or outcome!=2,
      request.phase!="refused-session" or outcome!=1,
      outcome!=1 or s.accepted.contains(id),
      s'=s.with("mutations",s.mutations.set(id,request.with("phase","session-observed")))
        .with("mutationObservations",s.mutationObservations.set(id,{outcome:outcome,payload:1,
          draft:false,decider:false,actor:s.cookie,refused:request.phase=="refused-session"}))}
  }
  action returnMutation(id:int):bool=all{s.mutations.get(id).phase=="session-observed",
    s'=s.with("mutations",s.mutations.set(id,s.mutations.get(id).with("phase","session-returned")))}
  action useMutation(id:int):bool={
    val observation=s.mutationObservations.get(id)
    val outcome=observation.outcome
    val request=s.mutations.get(id)
    val invalid=observation.refused or outcome==3 or observation.actor!=request.actor
    val changedIdentity=outcome!=3 and observation.actor!=request.actor
    val finished=s.with("mutations",s.mutations.set(id,request.with("phase","done")))
    all{request.phase=="session-returned",
      s'=if(not(owns(request)))finished
      else if(invalid)clearPrivate(finished).with("busy",false).with("error","identity")
        .with("parent","loading").with("parentNotifications",s.parentNotifications+1)
        .with("url",if(changedIdentity)0 else s.url)
      else if(outcome==0)finished.with("busy",false).with("error","request")
      else finished.with("award",0).with("reason",false).with("decision",false)
        .with("selected",request.target).with("url",request.target)
        .with("busy",false).with("reload",true).with("parent","loading")}
  }
  action mutationReply(id:int,outcome:int):bool=observeMutation(id,outcome)
    .then(returnMutation(id)).then(useMutation(id))
  action step={nondet id=ids.oneOf() nondet actor=Set(0,1,2).oneOf()
    nondet target=Set(0,1,2).oneOf() nondet outcome=Set(0,1,2,3).oneOf()
    nondet payload=Set(1,2,3).oneOf() nondet yes=Set(false,true).oneOf()
    nondet draft=Set(false,true).oneOf() nondet decider=Set(false,true).oneOf()
    nondet kind=Set("create","decision","retry").oneOf()
    any{parentLoads,parentSameActor,parentUnavailableSameActor,remount(1,target),remount(2,target),depart,cookieChanges(actor),
      startRead(id),refusedReadHeaders(id),refusedReadBody(id),observeRead(id,outcome,payload,draft,decider),returnRead(id),useRead(id),retryRead,olderRecords,
      chooseAward(id),editReason(yes),editDecision(yes),back,beginMutation(id,kind),
      acceptMutation(id),refusedMutationHeaders(id),refusedMutationBody(id),observeMutation(id,outcome),returnMutation(id),useMutation(id),s'=s}}
  val invariant=all{s.epoch>=1,s.epoch<=2,s.cursor>=0,s.cursor<=1,
    s.page>=0,s.page<=2,s.detail>=0,s.detail<=3,s.accepted.subseteq(ids),
    s.mayDecide implies s.detail==2,
    (s.page>0 or s.detail>0 or s.award>0) implies s.privateOwner==s.actor,
    not(s.mounted) implies not(visible)}
  run initialListLoadingTest=init.then(startRead(1)).expect(s.busy and view=="none")
  run emptyListTest=init.then(startRead(1)).then(readReply(1,1,1,false,false)).expect(view=="empty" and not(s.busy))
  run listThenFormTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(chooseAward(1)).then(editReason(true)).expect(maySubmit and view=="form")
  run formBackKeepsLoadedListTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(chooseAward(1)).then(editReason(true)).then(back).expect(view=="list" and s.award==0)
  run oldListRemainsDuringPageLoadTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(olderRecords).then(startRead(2)).expect(view=="list" and s.busy and not(maySubmit))
  run sameActorReadFailureRetainsListTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(olderRecords).then(startRead(2)).then(readReply(2,0,1,false,false)).expect(view=="list" and s.error=="request")
  run retrySupersedesOldReadTest=init.then(startRead(1)).then(readReply(1,0,1,false,false))
    .then(retryRead).then(startRead(2)).then(readReply(2,1,2,false,false)).expect(view=="list" and s.error=="none")
  run queryNavigationIgnoresOldReadTest=init.then(startRead(1)).then(remount(1,1))
    .then(startRead(2)).then(readReply(1,1,2,false,false)).expect(s.detail==0 and s.busy)
  run reviewDecisionControlTest=init.then(remount(1,1)).then(startRead(1))
    .then(readReply(1,1,2,true,true)).then(editDecision(true)).expect(mayResolve and not(mayRetryTriage))
  run moderatorCanReviewWithoutMachineDraftTest=init.then(remount(1,1)).then(startRead(1))
    .then(readReply(1,1,2,false,true)).then(editDecision(true)).expect(mayResolve and mayRetryTriage)
  run resolvedDetailHasNoMutationControlsTest=init.then(remount(1,1)).then(startRead(1))
    .then(readReply(1,1,3,true,true)).expect(not(mayResolve) and not(mayRetryTriage))
  run requestFailureKeepsReasonTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(chooseAward(1)).then(editReason(true)).then(beginMutation(1,"create"))
    .then(mutationReply(1,0)).expect(view=="form" and s.reason and s.error=="request")
  run accountMismatchClearsOldFormTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(chooseAward(1)).then(editReason(true)).then(beginMutation(1,"create"))
    .then(cookieChanges(2)).then(acceptMutation(1)).then(mutationReply(1,1))
    .expect(s.error=="identity" and s.award==0 and s.page==0 and not(s.reason) and s.parentNotifications==1)
  run signoutClearsCachedPointsListTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(olderRecords).then(startRead(2)).then(cookieChanges(0)).then(readReply(2,1,2,false,false))
    .expect(s.page==0 and s.url==0 and s.error=="identity" and s.parentNotifications==1)
  run forbiddenReadClearsOldListTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(olderRecords).then(startRead(2)).then(refusedReadHeaders(2)).then(refusedReadBody(2))
    .then(readReply(2,2,1,false,false))
    .expect(s.page==0 and s.error=="identity" and s.parentNotifications==1)
  run unavailableSessionDoesNotRetainFormTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(chooseAward(1)).then(editReason(true)).then(beginMutation(1,"create"))
    .then(mutationReply(1,3)).expect(s.award==0 and s.error=="identity")
  run acceptedMutationLoadsDetailTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(chooseAward(1)).then(editReason(true)).then(beginMutation(1,"create"))
    .then(acceptMutation(1)).then(mutationReply(1,1)).expect(s.url==1 and s.selected==1 and s.reload and s.parent=="loading")
  run acceptedPostCanLoseItsResponseTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(chooseAward(1)).then(editReason(true)).then(beginMutation(1,"create"))
    .then(acceptMutation(1)).then(mutationReply(1,0)).expect(s.accepted==Set(1) and view=="form" and s.error=="request")
  run triageRetryDoesNotInventMachineDraftTest=init.then(remount(1,1)).then(startRead(1))
    .then(readReply(1,1,1,false,false)).then(beginMutation(1,"retry"))
    .then(acceptMutation(1)).then(mutationReply(1,1)).then(parentSameActor)
    .then(startRead(2)).then(readReply(2,1,1,false,false)).expect(s.detail==1 and not(s.draft) and mayRetryTriage)
  run departedMutationCannotRewriteNavigationTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(chooseAward(1)).then(editReason(true)).then(beginMutation(1,"create"))
    .then(remount(1,2)).then(acceptMutation(1)).then(mutationReply(1,1))
    .expect(s.url==2 and s.selected==2 and s.parentNotifications==0)
  run departedIdentityFailureCannotNotifyNewParentTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(chooseAward(1)).then(editReason(true)).then(beginMutation(1,"create"))
    .then(remount(2,0)).then(refusedMutationHeaders(1)).then(refusedMutationBody(1))
    .then(mutationReply(1,2)).expect(s.actor==2 and s.parentNotifications==0 and s.error=="none")
  run hiddenSameActorChildKeepsItsDraftTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(chooseAward(1)).then(editReason(true)).then(parentLoads).then(parentSameActor)
    .expect(s.reason and s.award==1 and maySubmit)
  run parentFailureKeepsRevalidatedSameActorChildTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(chooseAward(1)).then(editReason(true)).then(parentLoads).then(parentUnavailableSameActor)
    .expect(s.parent=="error" and s.reason and visible)
  run firstCompletionDoesNotOwnOtherBusyRequestTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(chooseAward(1)).then(editReason(true)).then(beginMutation(1,"create")).then(beginMutation(2,"create"))
    .then(mutationReply(1,0)).expect(not(s.busy) and s.mutations.get(2).phase=="pending")
  run refusedReadClearsBeforeSessionRecheckTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(olderRecords).then(startRead(2)).then(refusedReadHeaders(2))
    .expect(s.page==0 and s.detail==0 and s.busy and s.parentNotifications==0)
    .then(refusedReadBody(2))
    .expect(s.reads.get(2).phase=="refused-session" and s.page==0 and s.busy and s.parentNotifications==0)
    .then(observeRead(2,1,2,false,false).fail())
  run refusedMutationClearsBeforeSessionRecheckTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(chooseAward(1)).then(editReason(true)).then(beginMutation(1,"create")).then(acceptMutation(1))
    .then(refusedMutationHeaders(1))
    .expect(s.award==0 and not(s.reason) and s.page==0 and s.busy and s.parentNotifications==0)
    .then(refusedMutationBody(1))
    .expect(s.mutations.get(1).phase=="refused-session" and s.award==0 and s.busy and s.parentNotifications==0)
    .then(observeMutation(1,1).fail())
  run departedObservedReadCannotNotifyParentTest=init.then(startRead(1)).then(cookieChanges(2))
    .then(observeRead(1,1,2,false,false)).then(depart).then(returnRead(1)).then(useRead(1))
    .expect(s.parentNotifications==0 and s.page==0)
  run departedReturnedMutationCannotRewriteUrlTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(chooseAward(1)).then(editReason(true)).then(beginMutation(1,"create")).then(acceptMutation(1))
    .then(observeMutation(1,1)).then(returnMutation(1)).then(remount(1,2)).then(useMutation(1))
    .expect(s.url==2 and s.selected==2 and s.parentNotifications==0)
  // Historical passive cleanup leaves the stale callback's guard live; outside step.
  action oldPassiveCommit=s'=s.with("parent","gone").with("url",2)
  run oldPassiveCompletionCouldReplaceDestinationTest=init.then(startRead(1)).then(readReply(1,1,2,false,false))
    .then(chooseAward(1)).then(editReason(true)).then(beginMutation(1,"create")).then(acceptMutation(1))
    .then(observeMutation(1,1)).then(returnMutation(1)).then(oldPassiveCommit).then(useMutation(1))
    .expect(s.url==1 and s.parent=="loading")
}
