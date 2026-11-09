// @source backend/points/handler.ts
// @source migrations/0008_points.sql
// @source migrations/0009_points_social.sql
// @source migrations/0056_points_telegram.sql
// @source migrations/0063_account_closure_notification_events.sql
// @source migrations/0116_email_preference_revision.sql
// @evidence backend/points/publication.test.ts
// @evidence backend/points/join-close-race.test.ts
// @evidence backend/points/membership-identity.test.ts
// @evidence scripts/account-closure.test.ts
// One numeric GitHub identity, two immutable node spellings, two join requests,
// two closure requests and three session identities (0 is the existing session).
// Identity assertions have already been accepted by identity_consumer_exchange;
// a failed local transaction does not restore those remote assertions.
// An initial active/private membership models historical visibility. Atomic
// join publishes an existing link but never recreates a removed link. Every
// closure batch hides membership, deletes all sessions/links and disables email,
// while its immutable membership identity, claim and unrelated history remain.
// Request admission, member lookup, atomic writes, result metadata, view read
// and cookie delivery are separate. A delivered cookie can already be invalid;
// closure replies retain the browser cookie, so a late reply cannot clear a
// cookie created by a subsequent explicit reopen. Revoked tokens remain inert.
// Closure is actor-bound at admission, not generation-bound: a second already
// admitted closure can close a membership that reopened before its batch.
// Legacy visibility admission can outlive its session: the closed-private SQL
// trigger, rather than continuous authorization, prevents closed publication.
// No current-session equality is claimed after awaits. Request-start expiry,
// cryptography, rate limits, login grammar and X provider flows have other models.
// Missing metadata and response loss are explicit; returned metadata is otherwise
// accurate and D1 batches atomic. Session timestamps are abstracted to explicit
// expiry/removal events. Wallet/case/award history is a preserved opaque fact.
// All new scenarios and regression definitions are unexecuted source work.
module account_session_publication {
  val ids = Set(1, 2)
  val tokenIds = Set(0, 1, 2)
  type Join = {phase:str,node:int,login:int,reopen:bool,chosen:int,
    committed:bool,admitted:bool,snapshotVisible:bool,response:int,cookieDelivered:bool}
  type Close = {phase:str,admitted:bool,changed:bool,response:int,replyDelivered:bool,cookieMutation:bool}
  val noJoin = {phase:"unused",node:1,login:1,reopen:false,chosen:0,
    committed:false,admitted:false,snapshotVisible:false,response:0,cookieDelivered:false}
  val noClose = {phase:"unused",admitted:false,changed:false,response:0,replyDelivered:false,cookieMutation:false}
  var s:{configured:bool,present:bool,closed:bool,visible:bool,actor:int,firstActor:int,login:int,
    xLinked:bool,xPublic:bool,xReserved:bool,email:bool,pendingVerification:bool,
    history:int,sessions:Set[int],browserCookie:int,closedStamp:int,
    joins:int->Join,closes:int->Close,visibilityPending:bool,visibilityResponse:int,publicObserved:bool}
  action init=s'={configured:false,present:false,closed:false,visible:false,actor:0,firstActor:0,login:0,
    xLinked:false,xPublic:false,xReserved:false,email:false,pendingVerification:false,
    history:1,sessions:Set(),browserCookie:-1,closedStamp:0,
    joins:ids.mapBy(_=>noJoin),closes:ids.mapBy(_=>noClose),visibilityPending:false,visibilityResponse:0,publicObserved:false}
  action seed(mode:str):bool=all{not(s.configured),Set("absent","private","public").contains(mode),
    s'=s.with("configured",true).with("present",mode!="absent").with("visible",mode=="public")
      .with("actor",if(mode=="absent")0 else 1).with("firstActor",if(mode=="absent")0 else 1)
      .with("login",if(mode=="absent")0 else 1).with("xLinked",mode!="absent").with("xPublic",mode=="public")
      .with("xReserved",mode!="absent").with("email",mode!="absent").with("pendingVerification",mode!="absent")
      .with("sessions",if(mode=="absent")Set() else Set(0)).with("browserCookie",if(mode=="absent")-1 else 0)}
  action beginJoin(id:int,node:int,login:int,reopen:bool):bool=all{s.configured,ids.contains(node),ids.contains(login),s.joins.get(id).phase=="unused",
    s'=s.with("joins",s.joins.set(id,noJoin.with("phase","member-read").with("node",node).with("login",login).with("reopen",reopen).with("admitted",true)))}
  action readMember(id:int):bool={
    val request=s.joins.get(id)
    val refused=s.closed and not(request.reopen)
    all{request.phase=="member-read",s'=s.with("joins",s.joins.set(id,request.with("chosen",if(s.present)s.actor else request.node)
      .with("phase",if(refused)"done" else "batch").with("response",if(refused)409 else 0)))}
  }
  action joinBatch(id:int):bool={
    val request=s.joins.get(id)
    val collision=s.present and request.chosen!=s.actor
    val accepted=not(collision) and (not(s.closed) or request.reopen)
    all{request.phase=="batch",s'=s.with("joins",s.joins.set(id,request.with("phase",if(collision)"done" else "batch-reply")
      .with("committed",accepted).with("response",if(collision)503 else 0)))
      .with("present",s.present or accepted).with("closed",if(accepted)false else s.closed)
      .with("visible",s.visible or accepted).with("actor",if(accepted)request.chosen else s.actor)
      .with("firstActor",if(accepted and not(s.present))request.chosen else s.firstActor)
      .with("login",if(accepted)request.login else s.login).with("xPublic",if(accepted)s.xLinked else s.xPublic)
      .with("sessions",if(accepted)s.sessions.union(Set(id)) else s.sessions)}
  }
  action joinBatchReply(id:int,received:bool,countVisible:bool):bool={
    val request=s.joins.get(id)
    all{request.phase=="batch-reply",s'=s.with("joins",s.joins.set(id,request
      .with("phase",if(not(received))"done" else if(request.committed and countVisible)"view" else "refusal-read")
      .with("response",if(received)0 else 503)))}
  }
  action joinRefusalRead(id:int):bool={
    val request=s.joins.get(id)
    all{request.phase=="refusal-read",s'=s.with("joins",s.joins.set(id,request.with("phase","done").with("response",if(s.closed)409 else 503)))}
  }
  action joinView(id:int):bool={
    val request=s.joins.get(id)
    all{request.phase=="view",s.present,s'=s.with("joins",s.joins.set(id,request.with("phase","cookie").with("snapshotVisible",s.visible)))}
  }
  action joinResponse(id:int,delivered:bool):bool={
    val request=s.joins.get(id)
    all{request.phase=="cookie",s'=s.with("joins",s.joins.set(id,request.with("phase","done").with("response",200).with("cookieDelivered",delivered)))
      .with("browserCookie",if(delivered)id else s.browserCookie)}
  }
  action joinFailure(id:int):bool={
    val request=s.joins.get(id)
    all{Set("member-read","batch","view").contains(request.phase),
      s'=s.with("joins",s.joins.set(id,request.with("phase","done").with("response",503)))}
  }
  action beginClose(id:int,token:int):bool=all{s.configured,tokenIds.contains(token),s.sessions.contains(token),s.closes.get(id).phase=="unused",
    s'=s.with("closes",s.closes.set(id,noClose.with("phase","confirmation").with("admitted",true)))}
  action confirmClose(id:int,matches:bool):bool={
    val request=s.closes.get(id)
    all{request.phase=="confirmation",s'=s.with("closes",s.closes.set(id,request.with("phase",if(matches)"batch" else "done").with("response",if(matches)0 else 400)))}
  }
  action closeBatch(id:int):bool={
    val request=s.closes.get(id)
    all{request.phase=="batch",s'=s.with("closed",true).with("visible",false).with("xLinked",false).with("xPublic",false)
      .with("email",false).with("pendingVerification",false).with("sessions",Set())
      .with("closedStamp",if(s.closed)s.closedStamp else id)
      .with("closes",s.closes.set(id,request.with("phase","batch-reply").with("changed",not(s.closed))))}
  }
  action closeBatchReply(id:int,received:bool,countVisible:bool):bool={
    val request=s.closes.get(id)
    all{request.phase=="batch-reply",s'=s.with("closes",s.closes.set(id,request
      .with("phase",if(not(received))"done" else if(request.changed and countVisible)"response" else "read")
      .with("response",if(received)0 else 503)))}
  }
  action closeRead(id:int):bool={
    val request=s.closes.get(id)
    all{request.phase=="read",s'=s.with("closes",s.closes.set(id,request
      .with("phase",if(s.closed)"response" else "done").with("response",if(s.closed)0 else 503)))}
  }
  action closeResponse(id:int,delivered:bool):bool={
    val request=s.closes.get(id)
    all{request.phase=="response",s'=s.with("closes",s.closes.set(id,request.with("phase","done").with("response",200).with("replyDelivered",delivered)))}
  }
  action closeFailure(id:int):bool={
    val request=s.closes.get(id)
    all{Set("confirmation","batch","read").contains(request.phase),
      s'=s.with("closes",s.closes.set(id,request.with("phase","done").with("response",503)))}
  }
  action removeSession(token:int):bool=all{tokenIds.contains(token),s'=s.with("sessions",s.sessions.exclude(Set(token)))}
  action observePublic=s'=s.with("publicObserved",s.visible)
  action beginVisibility(token:int):bool=all{tokenIds.contains(token),s.sessions.contains(token),not(s.visibilityPending),
    s'=s.with("visibilityPending",true)}
  action publishVisibility=all{s.visibilityPending,s'=s.with("visibilityPending",false)
    .with("visible",if(s.closed)s.visible else true).with("visibilityResponse",if(s.closed)503 else 200)}
  action preparedJoin(id:int,node:int,reopen:bool):bool=beginJoin(id,node,node,reopen).then(readMember(id))
  action joined(id:int,node:int,reopen:bool):bool=preparedJoin(id,node,reopen).then(joinBatch(id)).then(joinBatchReply(id,true,true)).then(joinView(id)).then(joinResponse(id,true))
  action preparedClose(id:int,token:int):bool=beginClose(id,token).then(confirmClose(id,true))
  action closed(id:int,token:int):bool=preparedClose(id,token).then(closeBatch(id)).then(closeBatchReply(id,true,true)).then(closeResponse(id,true))
  action step={
    nondet id=ids.oneOf()
    nondet node=ids.oneOf()
    nondet login=ids.oneOf()
    nondet yes=Set(false,true).oneOf()
    nondet other=Set(false,true).oneOf()
    nondet token=tokenIds.oneOf()
    any{seed("absent"),seed("private"),seed("public"),beginJoin(id,node,login,yes),readMember(id),joinBatch(id),joinBatchReply(id,yes,other),
      joinRefusalRead(id),joinView(id),joinResponse(id,yes),joinFailure(id),beginClose(id,token),confirmClose(id,yes),closeBatch(id),
      closeBatchReply(id,yes,other),closeRead(id),closeResponse(id,yes),closeFailure(id),removeSession(token),observePublic,
      beginVisibility(token),publishVisibility,s'=s}
  }
  val invariant=all{s.history==1,s.sessions.subseteq(tokenIds),
    s.present implies s.actor==s.firstActor and ids.contains(s.actor),
    s.closed implies not(s.visible) and not(s.xLinked) and not(s.xPublic) and not(s.email) and not(s.pendingVerification) and s.sessions==Set(),
    s.xPublic implies s.xLinked and s.visible and s.xReserved,
    s.visible implies s.present and not(s.closed),
    ids.forall(id=>s.joins.get(id).response==200 implies s.joins.get(id).committed),
    ids.forall(id=>s.closes.get(id).phase!="unused" implies s.closes.get(id).admitted),
    ids.forall(id=>not(s.closes.get(id).cookieMutation))}
  run historicalPrivateReadDoesNotPublishTest=init.then(seed("private")).then(observePublic)
    .expect(not(s.publicObserved) and not(s.visible) and not(s.xPublic) and invariant)
  run signInPublishesExistingMembershipAndLinkTest=init.then(seed("private")).then(joined(1,2,false))
    .expect(s.visible and s.xPublic and s.actor==1 and s.sessions==Set(0,1) and invariant)
  run closurePreservesIdentityClaimsAndHistoryTest=init.then(seed("public")).then(closed(1,0))
    .expect(s.closed and s.xReserved and s.actor==1 and s.history==1 and invariant)
  run ordinarySignInCannotReopenTest=init.then(seed("public")).then(closed(1,0)).then(preparedJoin(1,2,false))
    .expect(s.joins.get(1).response==409 and s.sessions==Set() and invariant)
  run explicitReopenNeverRecreatesDisconnectedLinkTest=init.then(seed("public")).then(closed(1,0)).then(joined(1,2,true))
    .expect(s.visible and not(s.xLinked) and not(s.xPublic) and not(s.email) and s.actor==1 and invariant)
  run closeBetweenJoinReadAndBatchRefusesSessionTest=init.then(seed("public")).then(preparedJoin(1,2,false)).then(closed(1,0))
    .then(joinBatch(1)).then(joinBatchReply(1,true,true)).then(joinRefusalRead(1))
    .expect(s.joins.get(1).response==409 and s.sessions==Set() and invariant)
  run explicitReopenCapturedBeforeClosureMayCommitAfterTest=init.then(seed("public")).then(preparedJoin(1,2,true)).then(closed(1,0))
    .then(joinBatch(1)).then(joinBatchReply(1,true,true)).then(joinView(1)).then(joinResponse(1,true))
    .expect(not(s.closed) and s.visible and not(s.xLinked) and invariant)
  run lostJoinBatchReplyKeepsUndisclosedSessionTest=init.then(seed("private")).then(preparedJoin(1,2,false)).then(joinBatch(1))
    .then(joinBatchReply(1,false,true)).expect(s.visible and s.sessions.contains(1) and not(s.joins.get(1).cookieDelivered) and s.joins.get(1).response==503 and invariant)
  run lostClosureBatchReplyKeepsAccountClosedTest=init.then(seed("public")).then(preparedClose(1,0)).then(closeBatch(1)).then(closeBatchReply(1,false,true))
    .expect(s.closed and s.sessions==Set() and s.browserCookie==0 and s.closes.get(1).response==503 and invariant)
  run closeBeforeJoinViewReturnsAlreadyInvalidCookieTest=init.then(seed("private")).then(preparedJoin(1,2,false)).then(joinBatch(1)).then(joinBatchReply(1,true,true))
    .then(closed(1,0)).then(joinView(1)).then(joinResponse(1,true))
    .expect(s.closed and not(s.joins.get(1).snapshotVisible) and s.browserCookie==1 and not(s.sessions.contains(1)) and invariant)
  run closeAfterJoinViewDoesNotRewriteSnapshotTest=init.then(seed("private")).then(preparedJoin(1,2,false)).then(joinBatch(1)).then(joinBatchReply(1,true,true))
    .then(joinView(1)).then(closed(1,0)).then(joinResponse(1,true))
    .expect(s.closed and s.joins.get(1).snapshotVisible and s.browserCookie==1 and s.sessions==Set() and invariant)
  run lateClosureReplyPreservesReopenedBrowserCookieTest=init.then(seed("public")).then(preparedClose(1,0)).then(closeBatch(1))
    .then(closeBatchReply(1,true,true)).then(joined(1,2,true)).then(closeResponse(1,true))
    .expect(not(s.closed) and s.browserCookie == 1 and s.sessions==Set(1) and invariant)
  run concurrentFirstNodeSpellingsFailClosedTest=init.then(seed("absent")).then(preparedJoin(1,1,false)).then(preparedJoin(2,2,false))
    .then(joinBatch(1)).then(joinBatch(2)).expect(s.actor==1 and s.sessions==Set(1) and s.joins.get(2).response==503 and invariant)
  run concurrentSameActorJoinsKeepBothSessionsTest=init.then(seed("absent")).then(preparedJoin(1,1,false)).then(preparedJoin(2,1,false))
    .then(joinBatch(1)).then(joinBatch(2)).expect(s.actor==1 and s.sessions==Set(1,2) and invariant)
  run failedJoinBatchLeavesPrivateStateTest=init.then(seed("private")).then(preparedJoin(1,2,false)).then(joinFailure(1))
    .expect(not(s.visible) and not(s.xPublic) and s.sessions==Set(0) and invariant)
  run failedClosureBatchLeavesAccountStateTest=init.then(seed("public")).then(preparedClose(1,0)).then(closeFailure(1))
    .expect(not(s.closed) and s.visible and s.email and s.sessions==Set(0) and invariant)
  run repeatedAdmittedClosuresReportSameClosureTest=init.then(seed("public")).then(preparedClose(1,0)).then(preparedClose(2,0))
    .then(closeBatch(1)).then(closeBatch(2)).then(closeBatchReply(2,true,true)).then(closeRead(2)).then(closeResponse(2,true))
    .expect(s.closedStamp==1 and s.closes.get(2).response==200 and invariant)
  run memberReadFailureDoesNotUndoPublicationTest=init.then(seed("private")).then(preparedJoin(1,2,false)).then(joinBatch(1)).then(joinBatchReply(1,true,true)).then(joinFailure(1))
    .expect(s.visible and s.sessions.contains(1) and s.joins.get(1).response==503 and invariant)
  run closedPrivateTriggerRefusesStaleVisibilityTest=init.then(seed("private")).then(beginVisibility(0)).then(closed(1,0)).then(publishVisibility)
    .expect(s.visibilityResponse==503 and not(s.visible) and invariant)
  run laterSessionExpiryDoesNotEraseMembershipTest=init.then(seed("absent")).then(joined(1,1,false)).then(removeSession(1))
    .expect(s.visible and s.present and s.sessions==Set() and s.browserCookie==1 and invariant)
  run alreadyAdmittedClosureCanCloseAnExplicitReopenTest=init.then(seed("public")).then(preparedClose(1,0)).then(preparedClose(2,0))
    .then(closeBatch(1)).then(closeBatchReply(1,true,true)).then(closeResponse(1,true)).then(joined(1,2,true))
    .then(closeBatch(2)).then(closeBatchReply(2,true,true)).then(closeResponse(2,true))
    .expect(s.closed and s.sessions==Set() and not(s.xLinked) and invariant)

  // Excluded pre-fix behavior: a response's fixed-name expiry affected the
  // current jar even when that cookie came from a newer explicit reopen.
  action oldCloseResponse(id:int):bool={
    val request=s.closes.get(id)
    all{request.phase=="response",s'=s.with("browserCookie",-1)
      .with("closes",s.closes.set(id,request.with("phase","done").with("response",200)
        .with("replyDelivered",true).with("cookieMutation",true)))}
  }
  run oldLateClosureExpiryErasedReopenedCookieTest=init.then(seed("public")).then(preparedClose(1,0)).then(closeBatch(1))
    .then(closeBatchReply(1,true,true)).then(joined(1,2,true)).then(oldCloseResponse(1))
    .expect(not(s.closed) and s.sessions==Set(1) and s.browserCookie == -1 and not(invariant))
}
