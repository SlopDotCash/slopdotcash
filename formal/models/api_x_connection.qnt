// @source migrations/0009_points_social.sql
// @source backend/points/x.ts
// One actor/session, one X identity, two flow IDs and one active callback.
// Owner 2 is an identity reserved to another actor. boundLive captures expiry
// at verifiedAt, the timestamp bound into SQL; revocation checks row presence.
// Provider parsing/cryptography and atomic D1 batches are external predicates.
// Source-reviewed follow-up: these scenarios have not been executed.
module api_x_connection {
  type State = {phase:str,flow:int,flowState:str,flowExpired:bool,starts:int,
    sessionPresent:bool,sessionExpired:bool,callback:int,token:bool,verified:bool,
    boundLive:bool,owner:int,reservationVerified:bool,linked:bool,publicLink:bool,recorded:bool,
    outcome:str,response:str,revokeAttempted:bool,providerRevoked:bool,
    replayRejected:bool,invalidRejected:bool,points:int}
  var s:State
  action init=s'={phase:"idle",flow:0,flowState:"absent",flowExpired:false,starts:0,
    sessionPresent:true,sessionExpired:false,callback:0,token:false,verified:false,
    boundLive:false,owner:0,reservationVerified:false,linked:false,publicLink:false,recorded:false,
    outcome:"none",response:"none",revokeAttempted:false,providerRevoked:false,
    replayRejected:false,invalidRejected:false,points:0}
  def finished(state:State,response:str):State=state.with("phase","finished")
    .with("response",response).with("callback",0).with("token",false)
    .with("verified",false).with("boundLive",false).with("outcome","none")
  action priorClaim(owner:int):bool=all{s.phase=="idle",s.starts==0,s.owner==0,owner>=1,owner<=2,
    s'=s.with("owner",owner).with("reservationVerified",true)}
  // A new start deletes this actor's older flows, including processing ones.
  action start=all{s.sessionPresent,not(s.sessionExpired),s.starts<2,
    s'=s.with("starts",s.starts+1).with("flow",s.starts+1)
      .with("flowState","pending").with("flowExpired",false)}
  action expireFlow=all{s.flow>0,not(s.flowExpired),s'=s.with("flowExpired",true)}
  action expireSession=s'=s.with("sessionExpired",true)
  action signout=s'=s.with("sessionPresent",false)
  action callback=all{Set("idle","finished").contains(s.phase),s.flowState=="pending",
    not(s.flowExpired),s.sessionPresent,not(s.sessionExpired),
    s'=s.with("phase","claimed").with("flowState","processing").with("callback",s.flow)
      .with("recorded",false).with("response","none").with("outcome","none")
      .with("revokeAttempted",false).with("providerRevoked",false)}
  action rejectedExpiredCallback=all{Set("idle","finished").contains(s.phase),s.flowState=="pending",
    s.flowExpired or not(s.sessionPresent) or s.sessionExpired,
    s'=finished(s.with("recorded",false),"failed")}
  // Bad state/cookie and replay fail outside the active call's try/finally.
  action invalidCallback=s'=s.with("invalidRejected",true)
  action replay=all{s.flowState=="processing",s'=s.with("replayRejected",true)}
  action userCancel=all{s.phase=="claimed",s'=s.with("phase","cleanup").with("outcome","cancelled")}
  action invalidCodeOrVerifier=all{s.phase=="claimed",s'=s.with("phase","cleanup").with("outcome","failed")}
  action tokenReply(valid:bool):bool=all{s.phase=="claimed",
    s'=if(valid)s.with("phase","identity").with("token",true)
      else s.with("phase","cleanup").with("outcome","failed")}
  action identityReply(valid:bool):bool=all{s.phase=="identity",
    s'=if(valid)s.with("phase","write").with("verified",true).with("boundLive",not(s.sessionExpired))
      else s.with("phase","cleanup").with("outcome","failed")}
  // A deleted session or superseded flow refuses at execution. Time passing
  // after verifiedAt was bound is not another expiry check in this source.
  action commit(databaseWorks:bool):bool=all{s.phase=="write",
    val allowed=databaseWorks and s.verified and s.sessionPresent and s.boundLive and s.flow==s.callback
      and s.flowState=="processing" and s.owner!=2
    s'=if(allowed)s.with("phase","cleanup").with("owner",1).with("reservationVerified",true).with("linked",true)
      .with("publicLink",true).with("recorded",true).with("outcome","connected")
      else s.with("phase","cleanup").with("outcome","failed")}
  action cleanup(databaseWorks:bool):bool=all{s.phase=="cleanup",
    val cleaned=if(not(databaseWorks))s.with("outcome","error")
      else if(s.flow==s.callback)s.with("flow",0).with("flowState","absent") else s
    s'=if(s.token)cleaned.with("phase","revoke").with("callback",0)
      else finished(cleaned,cleaned.outcome)}
  // Revoke failure is swallowed. No provider token is persisted by this handler.
  action revoke(providerAccepted:bool):bool=all{s.phase=="revoke",
    s'=finished(s.with("revokeAttempted",true).with("providerRevoked",providerAccepted),s.outcome)}
  action disconnect=all{s.sessionPresent,not(s.sessionExpired),
    s'=s.with("linked",false).with("publicLink",false).with("flow",0).with("flowState","absent")}
  action step=any{priorClaim(1),priorClaim(2),start,expireFlow,expireSession,signout,
    callback,rejectedExpiredCallback,invalidCallback,replay,userCancel,invalidCodeOrVerifier,
    tokenReply(true),tokenReply(false),identityReply(true),identityReply(false),
    commit(true),commit(false),cleanup(true),cleanup(false),revoke(true),revoke(false),disconnect,s'=s}
  val invariant=all{s.starts<=2,s.owner>=0,s.owner<=2,s.points==0,
    s.owner>0 implies s.reservationVerified,
    s.linked implies(s.owner==1 and s.publicLink and s.reservationVerified),
    s.owner==2 implies not(s.recorded),
    s.response=="connected" implies s.recorded,
    s.phase=="finished" implies(not(s.token) and s.callback==0)}
  run reservationTest=init.then(start).then(callback).then(tokenReply(true)).then(identityReply(true))
    .then(commit(true)).then(cleanup(true)).then(revoke(true)).then(disconnect)
    .expect(s.owner==1 and not(s.linked) and s.points==0)
  run signoutRaceTest=init.then(start).then(callback).then(tokenReply(true)).then(identityReply(true))
    .then(signout).then(commit(true)).then(cleanup(true)).then(revoke(true))
    .expect(not(s.linked) and s.response=="failed")
  run expiredPendingCallbackRefusesTest=init.then(start).then(expireFlow).then(rejectedExpiredCallback)
    .expect(s.response=="failed" and s.flowState=="pending" and not(s.linked))
  run processingFlowCanFinishAfterFlowExpiryTest=init.then(start).then(callback).then(expireFlow)
    .then(tokenReply(true)).then(identityReply(true)).then(commit(true)).then(cleanup(true)).then(revoke(true))
    .expect(s.response=="connected" and s.linked)
  run sessionExpiryBeforePersistenceRefusesTest=init.then(start).then(callback).then(tokenReply(true))
    .then(expireSession).then(identityReply(true)).then(commit(true)).then(cleanup(true)).then(revoke(true))
    .expect(s.response=="failed" and not(s.linked))
  run timeAfterSqlBindingIsNotAnotherSessionReadTest=init.then(start).then(callback).then(tokenReply(true))
    .then(identityReply(true)).then(expireSession).then(commit(true)).then(cleanup(true)).then(revoke(true))
    .expect(s.response=="connected" and s.linked)
  run replayCannotDeleteClaimedFlowTest=init.then(start).then(callback).then(replay)
    .expect(s.flowState=="processing" and s.phase=="claimed" and s.replayRejected)
  run invalidCallbackLeavesPendingFlowTest=init.then(start).then(invalidCallback)
    .expect(s.flowState=="pending" and not(s.linked))
  run userCancellationCleansWithoutTokenTest=init.then(start).then(callback).then(userCancel).then(cleanup(true))
    .expect(s.response=="cancelled" and s.flow==0 and not(s.revokeAttempted))
  run invalidCodeCleansClaimTest=init.then(start).then(callback).then(invalidCodeOrVerifier).then(cleanup(true))
    .expect(s.response=="failed" and s.flow==0)
  run tokenFailureCleansWithoutLinkTest=init.then(start).then(callback).then(tokenReply(false)).then(cleanup(true))
    .expect(s.response=="failed" and not(s.linked) and not(s.revokeAttempted))
  run identityFailureRevokesTemporaryTokenTest=init.then(start).then(callback).then(tokenReply(true))
    .then(identityReply(false)).then(cleanup(true)).then(revoke(true))
    .expect(s.response=="failed" and s.revokeAttempted and not(s.token))
  run foreignIdentityClaimCannotBeReassignedTest=init.then(priorClaim(2)).then(start).then(callback)
    .then(tokenReply(true)).then(identityReply(true)).then(commit(true)).then(cleanup(true)).then(revoke(true))
    .expect(s.owner==2 and not(s.linked) and s.response=="failed")
  run supersededCallbackLeavesNewFlowTest=init.then(start).then(callback).then(tokenReply(true)).then(start)
    .then(identityReply(true)).then(commit(true)).then(cleanup(true)).then(revoke(true))
    .expect(s.flow==2 and s.flowState=="pending" and not(s.linked) and s.response=="failed")
  run databaseFailureDoesNotReserveIdentityTest=init.then(start).then(callback).then(tokenReply(true))
    .then(identityReply(true)).then(commit(false)).then(cleanup(true)).then(revoke(true))
    .expect(s.owner==0 and not(s.linked) and s.response=="failed")
  run cleanupFailureDoesNotUndoCommittedLinkTest=init.then(start).then(callback).then(tokenReply(true))
    .then(identityReply(true)).then(commit(true)).then(cleanup(false)).then(revoke(true))
    .expect(s.linked and s.recorded and s.response=="error" and s.revokeAttempted)
  run revokeFailureDoesNotUndoVerifiedLinkTest=init.then(start).then(callback).then(tokenReply(true))
    .then(identityReply(true)).then(commit(true)).then(cleanup(true)).then(revoke(false))
    .expect(s.linked and s.response=="connected" and s.revokeAttempted and not(s.providerRevoked))
  run disconnectDuringProviderWaitRefusesLateLinkTest=init.then(start).then(callback).then(tokenReply(true))
    .then(disconnect).then(identityReply(true)).then(commit(true)).then(cleanup(true)).then(revoke(true))
    .expect(not(s.linked) and s.response=="failed")
  run failedReconnectPreservesPriorLinkTest=init.then(start).then(callback).then(tokenReply(true))
    .then(identityReply(true)).then(commit(true)).then(cleanup(true)).then(revoke(true))
    .then(start).then(callback).then(tokenReply(false)).then(cleanup(true))
    .expect(s.linked and s.owner==1 and s.response=="failed")
  run newerFlowCanFinishAfterOldCallbackRefusalTest=init.then(start).then(callback).then(tokenReply(true)).then(start)
    .then(identityReply(true)).then(commit(true)).then(cleanup(true)).then(revoke(true))
    .then(callback).then(tokenReply(true)).then(identityReply(true)).then(commit(true)).then(cleanup(true)).then(revoke(true))
    .expect(s.linked and s.response=="connected" and s.starts==2 and s.flow==0)
  run cancellationCleanupFailureReportsErrorTest=init.then(start).then(callback).then(userCancel).then(cleanup(false))
    .expect(s.response=="error" and not(s.revokeAttempted))
  run failedRevokeDoesNotHideCleanupFailureTest=init.then(start).then(callback).then(tokenReply(true))
    .then(identityReply(true)).then(commit(true)).then(cleanup(false)).then(revoke(false))
    .expect(s.response=="error" and s.revokeAttempted and s.linked)
}
