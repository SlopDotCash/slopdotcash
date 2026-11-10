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
//
// Finite step reductions. Each action has a *With(..., reduce) form; direct
// actions and named scenarios (including readReply and mutationReply) pass
// false and keep the exact state. step passes true, which applies settle:
// - parentNotifications is write-only and error is read only as != "none",
//   so step stores 0 and one non-"none" error value.
// - Reads and mutations lose ownership for good: epoch only increases, actor
//   changes only at remount, departure never remounts, and activeRead only
//   names a fresh read. An unowned or non-current request only advances its
//   own phase, and an observation is used only by a current request. step
//   stores such requests, done requests and their observations in one fixed
//   form; accepted keeps only unobserved live mutations, the only ones whose
//   observe guard reads it, and activeRead naming a done read becomes 0.
// - A mutation's kind is read only by beginMutation, so step stores "none".
// - The cookie and observed actors are compared only with the current or
//   request actor (1 or 2), and remount overwrites the cookie, so step stores
//   0 for every non-actor value and offers that cookie choice once. url is
//   compared only with keyTarget and otherwise overwritten, so step stores
//   keyTarget or one fixed other value.
// - reload is read only by startRead, which needs a mounted component and an
//   unused read slot; slots never return to unused, so step stores false when
//   neither holds. draft is read only through a detail other than 3, and only
//   startRead or clearPrivate change detail, both resetting draft, so step
//   stores false while detail is 3.
// - A departed component never reads its view, cookie or actor again: depart
//   clears private state, every request is unowned and so retired, only
//   remount re-enables reads and it overwrites busy, error, selected, cursor,
//   url, keyTarget, actor and cookie. step stores fixed values for them.
// - parent is read only by visible, which treats "error" like "ready", so
//   step stores "ready" for both and offers the parent revalidation once.
// - Observation choices that settle maps to one successor are offered once
//   (observationRepresentative), and a payload-3 read is offered without a
//   draft because the draft is then unread.
// - Observation outcomes and payloads are kept only where useRead or
//   useMutation can read them: invalid replies keep only whether the identity
//   changed, list reads keep payload 1 or 2, and decider only for payload 2.
// - privateOwner is read only while page, detail or award is present, and
//   every transition that makes one present sets privateOwner or requires a
//   present page; reason is read only in the form view, entered only through
//   chooseAward, which resets it. step stores 0/false when they are unread.
// - Read and mutation IDs are opaque, so step starts the lowest unused one,
//   and nothing names a mutation slot outside mutations, mutationObservations
//   and accepted, so step orders the two settled mutation slots by rank.
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
  def ownsIn(st:State,request:Request):bool=st.mounted and request.epoch==st.epoch and request.actor==st.actor
  def owns(request:Request):bool=ownsIn(s,request)
  // Finite-step canonical form; see the header. Direct actions pass false.
  pure val blank={outcome:0,payload:1,draft:false,decider:false,actor:0,refused:false}
  pure val retired={epoch:0,actor:0,target:0,kind:"none",phase:"done"}
  pure def canonicalObservation(request:Request,o:Observation):Observation={
    val mismatch=o.actor!=request.actor
    if(o.refused or o.outcome==3 or mismatch)
      (if(o.outcome!=3 and mismatch)blank.with("outcome",2) else blank.with("outcome",3).with("actor",request.actor))
    else if(o.outcome!=1)blank.with("outcome",o.outcome).with("actor",request.actor)
    else if(request.kind!="read")blank.with("outcome",1).with("actor",request.actor)
    else if(request.target==0)blank.with("outcome",1).with("actor",request.actor)
      .with("payload",if(o.payload==1)1 else 2)
    else o.with("decider",o.payload==2 and o.decider)
  }
  pure def settledRead(st:State,id:int):Request={
    val r=st.reads.get(id)
    if(r.phase=="unused" or (r.phase!="done" and ownsIn(st,r) and st.activeRead==id))r else retired
  }
  pure def settledMutation(st:State,id:int):Request={
    val m=st.mutations.get(id)
    if(m.phase=="unused")m else if(m.phase!="done" and ownsIn(st,m))m.with("kind","none") else retired
  }
  pure val observedPhases=Set("session-observed","session-returned")
  pure val unobservedPhases=Set("pending","refused-body","refused-session")
  pure def settledReadObservation(st:State,id:int):Observation={
    val r=settledRead(st,id)
    if(observedPhases.contains(r.phase))canonicalObservation(r,st.readObservations.get(id)) else blank
  }
  pure def settledMutationObservation(st:State,id:int):Observation={
    val m=settledMutation(st,id)
    if(observedPhases.contains(m.phase))canonicalObservation(m,st.mutationObservations.get(id)) else blank
  }
  pure def settledAccepted(st:State,id:int):bool=
    st.accepted.contains(id) and unobservedPhases.contains(settledMutation(st,id).phase)
  pure def phaseIndex(phase:str):int=if(phase=="unused")0 else if(phase=="pending")1
    else if(phase=="refused-body")2 else if(phase=="refused-session")3
    else if(phase=="session-observed")4 else if(phase=="session-returned")5 else 6
  // Injective on settled mutation slots: kind is "none", owned slots share
  // epoch and actor, and observations are canonical.
  pure def mutationRank(st:State,id:int):int={
    val m=settledMutation(st,id)
    val o=settledMutationObservation(st,id)
    phaseIndex(m.phase)*1000+m.target*100+(if(settledAccepted(st,id))10 else 0)
      +o.outcome*2+(if(o.actor!=0)1 else 0)
  }
  // One representative outcome per class that settle maps to one successor:
  // an observation of a request that settle retires is blank (outcome 0);
  // a cookie that differs from the request actor keeps only 0 (identity
  // changed) versus 3 (session unavailable); a refused-session reply with
  // the request actor always becomes outcome 3.
  def observationRepresentative(request:Request,current:bool,outcome:int):bool=
    if(not(current))outcome==0
    else if(s.cookie!=request.actor)Set(0,3).contains(outcome)
    else if(request.phase=="refused-session")outcome==0
    else true
  def settle(reduce:bool,st:State):State=if(not(reduce))st else {
    // Mutation slots are interchangeable: nothing else names a mutation ID.
    val swap=mutationRank(st,1)>mutationRank(st,2)
    def slot(id:int):int=if(swap)3-id else id
    val kept=st.with("parentNotifications",0)
      .with("reads",ids.mapBy(id=>settledRead(st,id)))
      .with("mutations",ids.mapBy(id=>settledMutation(st,slot(id))))
      .with("accepted",ids.filter(id=>settledAccepted(st,slot(id))))
      .with("error",if(st.error=="none")"none" else "request")
      .with("parent",if(st.parent=="error")"ready" else st.parent)
      .with("cookie",if(st.cookie==st.actor)st.cookie else 0)
      .with("privateOwner",if(st.page>0 or st.detail>0 or st.award>0)st.privateOwner else 0)
      .with("reason",st.reason and st.award>0)
      .with("draft",st.draft and st.detail!=3)
      .with("url",if(st.url==st.keyTarget)st.url else if(st.keyTarget==0)1 else 0)
      .with("activeRead",if(st.activeRead!=0 and settledRead(st,st.activeRead).phase=="done")0 else st.activeRead)
      .with("readObservations",ids.mapBy(id=>settledReadObservation(st,id)))
      .with("mutationObservations",ids.mapBy(id=>settledMutationObservation(st,slot(id))))
      .with("reload",st.reload and st.mounted and ids.exists(id=>st.reads.get(id).phase=="unused"))
    // Departed: every request is retired and remount overwrites the rest.
    if(st.mounted)kept else kept.with("busy",false).with("error","none").with("selected",0)
      .with("cursor",0).with("url",0).with("keyTarget",0).with("actor",1).with("cookie",0)
  }
  val visible=s.mounted and s.parent!="loading" and s.parent!="gone"
  val view=if(s.detail>0)"detail" else if(s.award>0)"form"
    else if(s.selected==0 and s.page==1)"empty"
    else if(s.selected==0 and s.page==2)"list" else "none"
  val maySubmit=visible and not(s.busy) and view=="form" and s.reason
  val mayResolve=visible and not(s.busy) and view=="detail" and s.mayDecide and s.decision
  val mayRetryTriage=visible and not(s.busy) and view=="detail" and not(s.draft) and s.detail!=3
  action parentLoadsWith(reduce: bool): bool =all{s.mounted,s'=settle(reduce, s.with("parent","loading"))}
  action parentLoads = parentLoadsWith(false)
  action parentSameActorWith(reduce: bool): bool =all{s.mounted,s.cookie==s.actor,s.url==s.keyTarget,s'=settle(reduce, s.with("parent","ready"))}
  action parentSameActor = parentSameActorWith(false)
  action parentUnavailableSameActorWith(reduce: bool): bool =all{s.mounted,s.cookie==s.actor,s.url==s.keyTarget,
    s'=settle(reduce, s.with("parent","error"))}
  action parentUnavailableSameActor = parentUnavailableSameActorWith(false)
  // Link pushes a query URL and dispatches popstate. The Inbox key includes
  // recipient + complete search, so query navigation remounts this child.
  action remountWith(actor:int, target:int, reduce: bool): bool =all{s.epoch==1,actor>=1,actor<=2,target>=0,target<=2,
    s'=settle(reduce, clearPrivate(s).with("mounted",true).with("epoch",2).with("actor",actor)
      .with("cookie",actor).with("parent","ready").with("url",target)
      .with("keyTarget",target)
      .with("selected",target).with("cursor",0).with("busy",false)
      .with("error","none").with("reload",true).with("activeRead",0))}
  action remount(actor:int,target:int): bool = remountWith(actor, target, false)
  action departWith(reduce: bool): bool =all{s.mounted,
    s'=settle(reduce, clearPrivate(s).with("mounted",false).with("parent","gone").with("activeRead",0))}
  action depart = departWith(false)
  action cookieChangesWith(actor:int, reduce: bool): bool =all{actor>=0,actor<=2,s'=settle(reduce, s.with("cookie",actor))}
  action cookieChanges(actor:int): bool = cookieChangesWith(actor, false)
  action startReadWith(id:int, reduce: bool): bool =all{s.mounted,s.reload,s.reads.get(id).phase=="unused",
    s'=settle(reduce, s.with("reads",s.reads.set(id,{epoch:s.epoch,actor:s.actor,target:s.selected,kind:"read",phase:"pending"}))
      .with("activeRead",id).with("reload",false).with("busy",true)
      .with("error","none").with("detail",0).with("detailId",0)
      .with("draft",false).with("mayDecide",false))}
  action startRead(id:int): bool = startReadWith(id, false)
  // Header refusals clear cached payloads before either body parsing or the
  // later session lookup. They retain the request's current busy state.
  action refusedReadHeadersWith(id:int, reduce: bool): bool ={
    val request=s.reads.get(id)
    val waiting=s.with("reads",s.reads.set(id,request.with("phase","refused-body")))
    all{request.phase=="pending",
      s'=settle(reduce, if(owns(request) and s.activeRead==id)clearPrivate(waiting) else waiting)}
  }
  action refusedReadHeaders(id:int): bool = refusedReadHeadersWith(id, false)
  // Also represents a 409 account_changed recognized only after body parsing.
  // A body failure after refused headers still proceeds to the session check.
  action refusedReadBodyWith(id:int, reduce: bool): bool ={
    val request=s.reads.get(id)
    val waiting=s.with("reads",s.reads.set(id,request.with("phase","refused-session")))
    all{Set("pending","refused-body").contains(request.phase),
      s'=settle(reduce, if(owns(request) and s.activeRead==id)clearPrivate(waiting) else waiting)}
  }
  action refusedReadBody(id:int): bool = refusedReadBodyWith(id, false)
  // outcome: 0 same-actor transport failure; 1 accepted JSON; 2 authority
  // refusal after body; 3 session unavailable. A refused HTTP response cannot
  // become a successful payload because the later session happens to match.
  // The helper's session observation does not own the later caller callback.
  // Committed removal aborts the read before either can invalidate its parent.
  action observeReadWith(id:int, outcome:int, payload:int, draft:bool, decider:bool, reduce: bool): bool ={
    val request=s.reads.get(id)
    all{Set("pending","refused-session").contains(request.phase),
      outcome>=0,outcome<=3,payload>=1,payload<=3,
      request.phase!="pending" or outcome!=2,
      request.phase!="refused-session" or outcome!=1,
      s'=settle(reduce, s.with("reads",s.reads.set(id,request.with("phase","session-observed")))
        .with("readObservations",s.readObservations.set(id,{outcome:outcome,payload:payload,
          draft:draft,decider:decider,actor:s.cookie,refused:request.phase=="refused-session"})))}
  }
  action observeRead(id:int,outcome:int,payload:int,draft:bool,decider:bool): bool = observeReadWith(id, outcome, payload, draft, decider, false)
  action returnReadWith(id:int, reduce: bool): bool =all{s.reads.get(id).phase=="session-observed",
    s'=settle(reduce, s.with("reads",s.reads.set(id,s.reads.get(id).with("phase","session-returned"))))}
  action returnRead(id:int): bool = returnReadWith(id, false)
  action useReadWith(id:int, reduce: bool): bool ={
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
      s'=settle(reduce, if(not(current))finished
      else if(invalid)clearPrivate(finished).with("busy",false).with("error","identity")
        .with("parent","loading").with("parentNotifications",s.parentNotifications+1)
        .with("url",if(changedIdentity)0 else s.url)
      else if(outcome==0)finished.with("busy",false).with("error","request")
      else if(request.target==0)finished.with("busy",false)
        .with("page",if(payload==1)1 else 2).with("nextPage",payload!=1).with("privateOwner",s.actor)
      else finished.with("busy",false).with("detail",payload).with("detailId",request.target)
        .with("draft",draft).with("mayDecide",payload==2 and decider).with("privateOwner",s.actor))}
  }
  action useRead(id:int): bool = useReadWith(id, false)
  action readReply(id:int,outcome:int,payload:int,draft:bool,decider:bool):bool=
    observeRead(id,outcome,payload,draft,decider).then(returnRead(id)).then(useRead(id))
  action retryReadWith(reduce: bool): bool =all{visible,s.error!="none",s'=settle(reduce, s.with("reload",true))}
  action retryRead = retryReadWith(false)
  action olderRecordsWith(reduce: bool): bool =all{visible,not(s.busy),view=="list",s.nextPage,s.cursor==0,
    s'=settle(reduce, s.with("cursor",1).with("reload",true))}
  action olderRecords = olderRecordsWith(false)
  action chooseAwardWith(id:int, reduce: bool): bool =all{visible,not(s.busy),view=="list",ids.contains(id),
    s'=settle(reduce, s.with("award",id).with("reason",false))}
  action chooseAward(id:int): bool = chooseAwardWith(id, false)
  action editReasonWith(valid:bool, reduce: bool): bool =all{visible,not(s.busy),view=="form",s'=settle(reduce, s.with("reason",valid))}
  action editReason(valid:bool): bool = editReasonWith(valid, false)
  action editDecisionWith(valid:bool, reduce: bool): bool =all{visible,not(s.busy),view=="detail",s.mayDecide,
    s'=settle(reduce, s.with("decision",valid))}
  action editDecision(valid:bool): bool = editDecisionWith(valid, false)
  action backWith(reduce: bool): bool =all{visible,not(s.busy),view=="form",s'=settle(reduce, s.with("award",0))}
  action back = backWith(false)
  // The callback has no synchronous busy/ref guard. The model accepts at
  // most two delivered callbacks; their real DOM scheduling is not proved.
  action beginMutationWith(id:int, kind:str, reduce: bool): bool ={
    val admissible=(kind=="create" and view=="form" and s.reason)
      or (kind=="decision" and view=="detail" and s.mayDecide and s.decision)
      or (kind=="retry" and view=="detail" and not(s.draft) and s.detail!=3)
    val target=if(kind=="create")s.award else s.detailId
    all{visible,admissible,s.mutations.get(id).phase=="unused",
      s'=settle(reduce, s.with("mutations",s.mutations.set(id,{epoch:s.epoch,actor:s.actor,target:target,kind:kind,phase:"pending"}))
        .with("busy",true).with("error","none"))}
  }
  action beginMutation(id:int,kind:str): bool = beginMutationWith(id, kind, false)
  // A target denotes an award and its associated dispute, not equal literal
  // revision/dispute IDs. Server acceptance can precede a lost response or
  // departure; it is not a Points adjustment or a payment.
  action acceptMutationWith(id:int, reduce: bool): bool =all{s.mutations.get(id).phase=="pending",
    s'=settle(reduce, s.with("accepted",s.accepted.union(Set(id))))}
  action acceptMutation(id:int): bool = acceptMutationWith(id, false)
  action refusedMutationHeadersWith(id:int, reduce: bool): bool ={
    val request=s.mutations.get(id)
    val waiting=s.with("mutations",s.mutations.set(id,request.with("phase","refused-body")))
    all{request.phase=="pending",
      s'=settle(reduce, if(owns(request))clearPrivate(waiting) else waiting)}
  }
  action refusedMutationHeaders(id:int): bool = refusedMutationHeadersWith(id, false)
  action refusedMutationBodyWith(id:int, reduce: bool): bool ={
    val request=s.mutations.get(id)
    val waiting=s.with("mutations",s.mutations.set(id,request.with("phase","refused-session")))
    all{Set("pending","refused-body").contains(request.phase),
      s'=settle(reduce, if(owns(request))clearPrivate(waiting) else waiting)}
  }
  action refusedMutationBody(id:int): bool = refusedMutationBodyWith(id, false)
  action observeMutationWith(id:int, outcome:int, reduce: bool): bool ={
    val request=s.mutations.get(id)
    all{Set("pending","refused-session").contains(request.phase),outcome>=0,outcome<=3,
      request.phase!="pending" or outcome!=2,
      request.phase!="refused-session" or outcome!=1,
      outcome!=1 or s.accepted.contains(id),
      s'=settle(reduce, s.with("mutations",s.mutations.set(id,request.with("phase","session-observed")))
        .with("mutationObservations",s.mutationObservations.set(id,{outcome:outcome,payload:1,
          draft:false,decider:false,actor:s.cookie,refused:request.phase=="refused-session"})))}
  }
  action observeMutation(id:int,outcome:int): bool = observeMutationWith(id, outcome, false)
  action returnMutationWith(id:int, reduce: bool): bool =all{s.mutations.get(id).phase=="session-observed",
    s'=settle(reduce, s.with("mutations",s.mutations.set(id,s.mutations.get(id).with("phase","session-returned"))))}
  action returnMutation(id:int): bool = returnMutationWith(id, false)
  action useMutationWith(id:int, reduce: bool): bool ={
    val observation=s.mutationObservations.get(id)
    val outcome=observation.outcome
    val request=s.mutations.get(id)
    val invalid=observation.refused or outcome==3 or observation.actor!=request.actor
    val changedIdentity=outcome!=3 and observation.actor!=request.actor
    val finished=s.with("mutations",s.mutations.set(id,request.with("phase","done")))
    all{request.phase=="session-returned",
      s'=settle(reduce, if(not(owns(request)))finished
      else if(invalid)clearPrivate(finished).with("busy",false).with("error","identity")
        .with("parent","loading").with("parentNotifications",s.parentNotifications+1)
        .with("url",if(changedIdentity)0 else s.url)
      else if(outcome==0)finished.with("busy",false).with("error","request")
      else finished.with("award",0).with("reason",false).with("decision",false)
        .with("selected",request.target).with("url",request.target)
        .with("busy",false).with("reload",true).with("parent","loading"))}
  }
  action useMutation(id:int): bool = useMutationWith(id, false)
  action mutationReply(id:int,outcome:int):bool=observeMutation(id,outcome)
    .then(returnMutation(id)).then(useMutation(id))
  // Request IDs are opaque, so step starts the lowest unused read/mutation.
  // Reply payload fields are offered only where useRead can read them.
  // parentUnavailableSameActorWith(true) settles to the same successor as
  // parentSameActorWith(true), so step offers that choice once.
  action step=any{parentLoadsWith(true),parentSameActorWith(true),
    {nondet target=Set(0,1,2).oneOf() remountWith(1,target, true)},
    {nondet target=Set(0,1,2).oneOf() remountWith(2,target, true)},
    departWith(true),
    {nondet actor=Set(0,1,2).oneOf() all{actor==0 or actor==s.actor,cookieChangesWith(actor, true)}},
    {nondet id=ids.oneOf() all{id==1 or s.reads.get(1).phase!="unused",startReadWith(id, true)}},
    {nondet id=ids.oneOf() refusedReadHeadersWith(id, true)},
    {nondet id=ids.oneOf() refusedReadBodyWith(id, true)},
    {nondet id=ids.oneOf() all{Set("pending","refused-session").contains(s.reads.get(id).phase),
      {nondet outcome=Set(0,1,2,3).oneOf() nondet payload=Set(1,2,3).oneOf()
        nondet draft=Set(false,true).oneOf() nondet decider=Set(false,true).oneOf()
        all{observationRepresentative(s.reads.get(id),
              ownsIn(s,s.reads.get(id)) and s.activeRead==id,outcome),
          outcome==1 or (payload==1 and not(draft) and not(decider)),
          payload!=3 or not(draft),
          s.reads.get(id).target!=0 or (payload<=2 and not(draft) and not(decider)),
          payload==2 or not(decider),
          observeReadWith(id,outcome,payload,draft,decider, true)}}}},
    {nondet id=ids.oneOf() returnReadWith(id, true)},
    {nondet id=ids.oneOf() useReadWith(id, true)},
    retryReadWith(true),olderRecordsWith(true),
    {nondet id=ids.oneOf() chooseAwardWith(id, true)},
    {nondet yes=Set(false,true).oneOf() editReasonWith(yes, true)},
    {nondet yes=Set(false,true).oneOf() editDecisionWith(yes, true)},
    backWith(true),
    {nondet id=ids.oneOf() nondet kind=Set("create","decision","retry").oneOf()
      all{id==1 or s.mutations.get(1).phase!="unused",beginMutationWith(id,kind, true)}},
    {nondet id=ids.oneOf() acceptMutationWith(id, true)},
    {nondet id=ids.oneOf() refusedMutationHeadersWith(id, true)},
    {nondet id=ids.oneOf() refusedMutationBodyWith(id, true)},
    {nondet id=ids.oneOf() nondet outcome=Set(0,1,2,3).oneOf()
      all{observationRepresentative(s.mutations.get(id),ownsIn(s,s.mutations.get(id)),outcome),
        observeMutationWith(id,outcome, true)}},
    {nondet id=ids.oneOf() returnMutationWith(id, true)},
    {nondet id=ids.oneOf() useMutationWith(id, true)},
    s'=s}
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
