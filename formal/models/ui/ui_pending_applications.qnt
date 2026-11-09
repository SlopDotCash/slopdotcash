// @source src/PendingProjectApplications.tsx
// @source src/lib/project-api.ts
// @source backend/projects/handler.ts
// @evidence tests/e2e/registry.spec.ts
// Two view lifetimes, two actors and one immutable application per actor.
// Admission, delivery and the following identity observation are separate.
// Backend publication CAS, repository authority and setup checks are external
// predicates covered by their existing models. These scenarios are unexecuted.
module ui_pending_applications {
  type View = { actor:int, load:str, publish:str, visible:bool, fetched:bool, loadCookie:int, publishCookie:int }
  pure val ids = Set(1,2)
  pure val unused = {actor:0,load:"idle",publish:"idle",visible:false,fetched:false,loadCookie:0,publishCookie:0}
  var s:{current:int,cookie:int,views:int->View,sent:Set[int],published:Set[int]}
  action init = s'={current:1,cookie:1,
    views:Map(1->unused.with("actor",1),2->unused),sent:Set(),published:Set()}
  def owns(v:int):bool = s.current==v
  action cookieChanges(actor:int):bool = all{actor>=0,actor<=2,s'=s.with("cookie",actor)}
  action load(v:int):bool = all{owns(v),Set("idle","error").contains(s.views.get(v).load),
    s'=s.with("views",s.views.set(v,s.views.get(v).with("load","http").with("visible",false).with("loadCookie",s.cookie)))}
  action admitLoad(v:int,hasPending:bool):bool = {
    val view=s.views.get(v)
    all{view.load=="http",s'=s.with("views",s.views.set(v,view.with("load",
      if(view.loadCookie==view.actor)"body" else "refused").with("fetched",hasPending and not(s.published.contains(view.actor)))))}
  }
  action loadReply(v:int):bool = {
    val view=s.views.get(v)
    all{Set("body","refused").contains(view.load),
      s'=s.with("views",s.views.set(v,view.with("load",
        if(not(owns(v)))"gone" else if(view.load=="refused")"error" else "identity")))}
  }
  action loadIdentity(v:int,available:bool):bool = {
    val view=s.views.get(v)
    val matching=available and s.cookie==view.actor
    all{view.load=="identity",s'=s.with("views",s.views.set(v,view
      .with("load",if(not(owns(v)))"gone" else if(matching)"ready" else "error")
      .with("visible",owns(v) and matching and view.fetched)))}
  }
  action loadFailure(v:int):bool = all{s.views.get(v).load=="http",
    s'=s.with("views",s.views.set(v,s.views.get(v).with("load",if(owns(v))"error" else "gone")))}
  action beginPublish(v:int):bool = {
    val view=s.views.get(v)
    all{owns(v),view.visible,Set("idle","error").contains(view.publish),
      s'=s.with("views",s.views.set(v,view.with("publish","preflight")))}
  }
  action preflight(v:int,available:bool):bool = {
    val view=s.views.get(v)
    val matching=available and s.cookie==view.actor
    all{view.publish=="preflight",s'=s.with("views",s.views.set(v,view
      .with("publish",if(not(owns(v)))"gone" else if(not(available))"error-identity" else if(matching)"ready-to-send" else "error")
      .with("visible",view.visible and owns(v) and (not(available) or matching))
      .with("load",if(owns(v) and available and not(matching))"error" else view.load)))}
  }
  // Browser Cookie headers are fixed at dispatch. A later cookie change
  // affects a following observation, never the actor of this sent request.
  action dispatchPublish(v:int):bool = {
    val view=s.views.get(v)
    all{view.publish=="ready-to-send",
      s'=s.with("views",s.views.set(v,view
        .with("publish",if(owns(v))"http" else "gone").with("publishCookie",s.cookie)))
        .with("sent",if(owns(v))s.sent.union(Set(v)) else s.sent)}
  }
  // outcome retry is an ordinary refusal such as missing Slopbot; access
  // refusal clears the parent list. Publication acceptance is durable even
  // when the old browser later disconnects or receives an error.
  action admitPublish(v:int,outcome:str):bool = {
    val view=s.views.get(v)
    val nextValue=if(view.publishCookie!=view.actor)"refused"
      else if(s.published.contains(view.actor))"retry" else outcome
    all{view.publish=="http",Set("accepted","retry","refused").contains(outcome),
      s'=s.with("views",s.views.set(v,view.with("publish",nextValue)))
        .with("published",if(nextValue=="accepted")s.published.union(Set(view.actor)) else s.published)}
  }
  action publishReply(v:int):bool = {
    val view=s.views.get(v)
    val refused=view.publish=="refused"
    all{Set("accepted","retry","refused").contains(view.publish),
      s'=s.with("views",s.views.set(v,view
        .with("publish",if(not(owns(v)))"gone" else if(refused)"error"
          else if(view.publish=="accepted")"success-identity" else "error-identity")
        .with("visible",view.visible and owns(v) and not(refused))
        .with("load",if(owns(v) and refused)"error" else view.load)))}
  }
  action publishIdentity(v:int,available:bool):bool = {
    val view=s.views.get(v)
    val matching=available and s.cookie==view.actor
    val retryRead=not(available) and view.publish=="success-identity"
    all{Set("success-identity","error-identity").contains(view.publish),
      s'=s.with("views",s.views.set(v,view
        .with("publish",if(not(owns(v)))"gone" else if(retryRead)"error-identity" else if(matching and view.publish=="success-identity")"done" else "error")
        .with("visible",view.visible and owns(v) and (retryRead or matching))
        .with("load",if(owns(v) and not(retryRead) and not(matching))"error" else view.load)))}
  }
  action lostReply(v:int):bool = all{s.views.get(v).publish=="accepted",
    s'=s.with("views",s.views.set(v,s.views.get(v).with("publish",if(owns(v))"error-identity" else "gone")))}
  action depart = all{s.current>0,
    s'=s.with("views",s.views.set(s.current,s.views.get(s.current).with("visible",false))).with("current",0)}
  action remount(actor:int):bool = all{s.current==0,s.views.get(2).actor==0,ids.contains(actor),
    s'=s.with("current",2).with("views",s.views.set(2,unused.with("actor",actor)))}
  action step={nondet v=ids.oneOf() nondet actor=Set(0,1,2).oneOf()
    nondet ok=Set(false,true).oneOf() nondet outcome=Set("accepted","retry","refused").oneOf()
    any{cookieChanges(actor),load(v),admitLoad(v,ok),loadReply(v),loadIdentity(v,ok),loadFailure(v),
      beginPublish(v),preflight(v,ok),dispatchPublish(v),admitPublish(v,outcome),publishReply(v),publishIdentity(v,ok),
      lostReply(v),depart,remount(actor),s'=s}}
  val invariant=all{s.published.subseteq(ids),
    ids.forall(v=>s.views.get(v).visible implies owns(v)),
    ids.forall(v=>s.views.get(v).publish=="done" implies s.published.contains(s.views.get(v).actor)),
    s.sent.forall(v=>ids.contains(s.views.get(v).actor))}
  run emptyInventoryIsOrdinaryTest=init.then(load(1)).then(admitLoad(1,false)).then(loadReply(1)).then(loadIdentity(1,true))
    .expect(s.views.get(1).load=="ready" and not(s.views.get(1).visible))
  run departedAfterCheckDoesNotDispatchTest=init.then(load(1)).then(admitLoad(1,true)).then(loadReply(1)).then(loadIdentity(1,true))
    .then(beginPublish(1)).then(preflight(1,true)).then(depart).then(dispatchPublish(1))
    .expect(s.sent==Set() and s.views.get(1).publish=="gone")
  run sameActorPublicationTest=init.then(load(1)).then(admitLoad(1,true)).then(loadReply(1)).then(loadIdentity(1,true)).then(beginPublish(1)).then(preflight(1,true)).then(dispatchPublish(1))
    .then(admitPublish(1,"accepted")).then(publishReply(1)).then(publishIdentity(1,true))
    .expect(s.published==Set(1) and s.views.get(1).publish=="done" and invariant)
  run changedActorAtLoadAdmissionTest=init.then(cookieChanges(2)).then(load(1)).then(admitLoad(1,true))
    .then(loadReply(1)).expect(not(s.views.get(1).visible) and s.views.get(1).load=="error")
  run changedActorAtLoadDeliveryTest=init.then(load(1)).then(admitLoad(1,true)).then(cookieChanges(2))
    .then(loadReply(1)).then(loadIdentity(1,true)).expect(not(s.views.get(1).visible))
  run unknownIdentityDoesNotPublishListTest=init.then(load(1)).then(admitLoad(1,true)).then(loadReply(1))
    .then(loadIdentity(1,false)).expect(not(s.views.get(1).visible))
  run failedLoadCanRetryTest=init.then(load(1)).then(loadFailure(1)).then(load(1)).then(admitLoad(1,true)).then(loadReply(1)).then(loadIdentity(1,true))
    .expect(s.views.get(1).visible and invariant)
  run changedActorBeforePublishTest=init.then(load(1)).then(admitLoad(1,true)).then(loadReply(1)).then(loadIdentity(1,true)).then(beginPublish(1)).then(cookieChanges(2))
    .then(preflight(1,true)).expect(s.sent==Set() and not(s.views.get(1).visible))
  run headerCatchesPostCheckSwapTest=init.then(load(1)).then(admitLoad(1,true)).then(loadReply(1)).then(loadIdentity(1,true)).then(beginPublish(1)).then(preflight(1,true))
    .then(cookieChanges(2)).then(dispatchPublish(1)).then(admitPublish(1,"accepted")).then(publishReply(1))
    .expect(s.published==Set() and not(s.views.get(1).visible))
  run changedActorAfterAcceptedWriteTest=init.then(load(1)).then(admitLoad(1,true)).then(loadReply(1)).then(loadIdentity(1,true)).then(beginPublish(1)).then(preflight(1,true)).then(dispatchPublish(1))
    .then(admitPublish(1,"accepted")).then(cookieChanges(2)).then(publishReply(1)).then(publishIdentity(1,true))
    .expect(s.published==Set(1) and not(s.views.get(1).visible))
  run sameActorRefusalKeepsRetryTest=init.then(load(1)).then(admitLoad(1,true)).then(loadReply(1)).then(loadIdentity(1,true)).then(beginPublish(1)).then(preflight(1,true)).then(dispatchPublish(1))
    .then(admitPublish(1,"retry")).then(publishReply(1)).then(publishIdentity(1,true))
    .expect(s.views.get(1).visible and s.views.get(1).publish=="error")
  run changedActorAfterRefusalClearsListTest=init.then(load(1)).then(admitLoad(1,true)).then(loadReply(1)).then(loadIdentity(1,true)).then(beginPublish(1)).then(preflight(1,true)).then(dispatchPublish(1))
    .then(admitPublish(1,"retry")).then(cookieChanges(2)).then(publishReply(1)).then(publishIdentity(1,true))
    .expect(not(s.views.get(1).visible))
  run duplicateClickCannotIssueTwoWritesTest=init.then(load(1)).then(admitLoad(1,true)).then(loadReply(1)).then(loadIdentity(1,true)).then(beginPublish(1)).then(beginPublish(1).fail())
  run departedPreflightCannotIssueWriteTest=init.then(load(1)).then(admitLoad(1,true)).then(loadReply(1)).then(loadIdentity(1,true)).then(beginPublish(1)).then(depart)
    .then(preflight(1,true)).expect(s.sent==Set())
  run departedReplyKeepsAcceptedFactTest=init.then(load(1)).then(admitLoad(1,true)).then(loadReply(1)).then(loadIdentity(1,true)).then(beginPublish(1)).then(preflight(1,true)).then(dispatchPublish(1))
    .then(depart).then(admitPublish(1,"accepted")).then(publishReply(1))
    .expect(s.published==Set(1) and s.views.get(1).publish=="gone")
  run oldReplyCannotChangeNewViewTest=init.then(load(1)).then(admitLoad(1,true)).then(loadReply(1)).then(loadIdentity(1,true)).then(beginPublish(1)).then(preflight(1,true)).then(dispatchPublish(1))
    .then(depart).then(remount(2)).then(cookieChanges(2)).then(load(2)).then(admitLoad(2,true))
    .then(loadReply(2)).then(loadIdentity(2,true)).then(admitPublish(1,"accepted")).then(publishReply(1))
    .expect(s.views.get(2).visible and s.published==Set(1) and invariant)
  run lostAcceptedReplyDoesNotUndoWriteTest=init.then(load(1)).then(admitLoad(1,true)).then(loadReply(1)).then(loadIdentity(1,true)).then(beginPublish(1)).then(preflight(1,true)).then(dispatchPublish(1))
    .then(admitPublish(1,"accepted")).then(lostReply(1)).then(publishIdentity(1,true))
    .expect(s.published==Set(1) and s.views.get(1).publish=="error")
  run unknownPublishIdentityClearsListTest=init.then(load(1)).then(admitLoad(1,true)).then(loadReply(1)).then(loadIdentity(1,true)).then(beginPublish(1)).then(preflight(1,true)).then(dispatchPublish(1))
    .then(admitPublish(1,"accepted")).then(publishReply(1)).then(publishIdentity(1,false)).then(publishIdentity(1,false))
    .expect(s.published==Set(1) and not(s.views.get(1).visible))
  run remountedPublishedApplicationIsAbsentTest=init.then(load(1)).then(admitLoad(1,true)).then(loadReply(1)).then(loadIdentity(1,true)).then(beginPublish(1)).then(preflight(1,true)).then(dispatchPublish(1))
    .then(admitPublish(1,"accepted")).then(depart).then(remount(1)).then(load(2)).then(admitLoad(2,true))
    .then(loadReply(2)).then(loadIdentity(2,true)).expect(not(s.views.get(2).visible))
}
