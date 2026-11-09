// @source backend/notifications/email.ts
// @source workers/notify/enrollment.ts
// @source migrations/0111_verified_notification_email.sql
// @source migrations/0116_email_preference_revision.sql
// @evidence backend/notifications/email-enrollment.test.ts
// One actor, two immutable request keys/payload fingerprints, three HTTP slots,
// 0/2 other address-history requests and the listed second boundary classes.
// Reused slots have no pending operation. Lookup, capability response, captured
// time, atomic insertion/cancellation, batch reply and private handoff are distinct.
// Only the initial committed request owns the raw token for a handoff. A lost
// committed batch reply leaves a queued row but no scheduled mail; same-key
// replay cannot reconstruct that token. Fresh-key enrollment after cooldown
// recovers. A delivered private request can outlive its caller's failed response.
// One pending private-row read handle is modeled; claimed rows may finish
// independently. Destination denotes the verified payload fingerprint, not a
// random production destination-version string. Token possession at verification
// is an input, not proof of mail delivery. Other-actor history is a fixed input.
// Verification expiry/revision semantics are refined by email_verification_completion.
// Retry-After arithmetic, entropy, hash collisions, HTTP grammar and view snapshot
// composition are excluded. Existing named scenarios now include handoff stages.
// This refinement and its added scenarios are source-authored, not executed.
module email_enrollment_delivery {
  type Row = {state:str,payload:int,created:int,cancelled:bool,consumed:bool,handed:bool,called:bool,admitted:bool}
  type Read = {id:int,revision:int}
  type Request = {phase:str,key:int,payload:int,stamp:int,committed:bool,response:int}
  val ids=Set(1,2)
  val requestIds=Set(1,2,3)
  val empty={state:"absent",payload:0,created:0,cancelled:false,consumed:false,handed:false,called:false,admitted:false}
  val unused={phase:"unused",key:1,payload:1,stamp:0,committed:false,response:0}
  val noRead={id:0,revision:0}
  var s:{rows:int->Row,now:int,available:bool,others:int,result:int,destination:int,revision:int,mail:Read,verification:Read,requests:int->Request}
  action init=s'={rows:Set(0,1,2).mapBy(_=>empty),now:0,available:true,others:0,result:0,destination:0,revision:0,mail:noRead,verification:noRead,requests:requestIds.mapBy(_=>unused)}
  def live(row:Row,at:int):bool=row.state!="absent" and not(row.cancelled) and not(row.consumed) and row.created+1800>at
  def active(row:Row):bool=row.state!="absent" and not(row.cancelled) and not(row.consumed)
  val existing=ids.filter(id=>s.rows.get(id).state!="absent")
  def recent(at:int):int=existing.filter(id=>s.rows.get(id).created>at-3600).size()+(if(at<3600)s.others else 0)
  def tooSoon(at:int):bool=existing.exists(id=>s.rows.get(id).created>at-60)
  action otherAddressHistory=all{existing.size()==0,s'=s.with("others",2)}
  action malformedRequest=s'=s.with("result",400)
  action availability(value:bool):bool=s'=s.with("available",value)
  action advance(at:int):bool=all{Set(59,60,120,1800,1860,3600).contains(at),at>s.now,s'=s.with("now",at)}
  action begin(requestId:int,key:int,payload:int):bool=all{
    requestIds.contains(requestId),ids.contains(key),ids.contains(payload),
    Set("unused","done").contains(s.requests.get(requestId).phase),
    s'=s.with("requests",s.requests.set(requestId,unused.with("phase","lookup").with("key",key).with("payload",payload)))}
  action lookup(requestId:int):bool={
    val request=s.requests.get(requestId)
    val row=s.rows.get(request.key)
    val response=if(row.payload==request.payload)202 else 409
    all{request.phase=="lookup",s'=if(row.state=="absent")
      s.with("requests",s.requests.set(requestId,request.with("phase","capabilities")))
      else s.with("result",response).with("requests",s.requests.set(requestId,request.with("phase","done").with("response",response)))}
  }
  action capabilityReply(requestId:int,received:bool):bool={
    val request=s.requests.get(requestId)
    val accepted=received and s.available
    all{request.phase=="capabilities",s'=s.with("requests",s.requests.set(requestId,
      request.with("phase",if(accepted)"capture-time" else "done").with("response",if(accepted)0 else 503)))
      .with("result",if(accepted)s.result else 503)}
  }
  action captureTime(requestId:int):bool={
    val request=s.requests.get(requestId)
    all{request.phase=="capture-time",s'=s.with("requests",s.requests.set(requestId,request.with("phase","batch").with("stamp",s.now)))}
  }
  action insert(requestId:int):bool={
    val request=s.requests.get(requestId)
    val accepted=s.rows.get(request.key).state=="absent" and not(tooSoon(request.stamp)) and recent(request.stamp)<3
    val otherRow=s.rows.get(3-request.key)
    val inserted=s.rows.set(request.key,empty.with("state","queued")
      .with("payload",request.payload).with("created",request.stamp))
      .set(3-request.key,if(active(otherRow))otherRow.with("cancelled",true) else otherRow)
    all{request.phase=="batch",s'=s.with("requests",s.requests.set(requestId,request.with("phase","batch-reply").with("committed",accepted)))
      .with("rows",if(accepted)inserted else s.rows)}
  }
  action batchReply(requestId:int,received:bool):bool={
    val request=s.requests.get(requestId)
    all{request.phase=="batch-reply",s'=s.with("requests",s.requests.set(requestId,
      request.with("phase",if(not(received))"done" else if(request.committed)"handoff" else "classify")
        .with("response",if(received)0 else 500))).with("result",if(received)s.result else 500)}
  }
  action classify(requestId:int):bool={
    val request=s.requests.get(requestId)
    val row=s.rows.get(request.key)
    val response=if(row.state=="absent")429 else if(row.payload==request.payload)202 else 409
    all{request.phase=="classify",s'=s.with("result",response).with("requests",s.requests.set(requestId,request.with("phase","done").with("response",response)))}
  }
  action precommitFailure(requestId:int):bool={
    val request=s.requests.get(requestId)
    all{Set("capture-time","batch").contains(request.phase),s'=s.with("result",500)
      .with("requests",s.requests.set(requestId,request.with("phase","done").with("response",500)))}
  }
  action handoff(requestId:int,delivered:bool):bool={
    val request=s.requests.get(requestId)
    val row=s.rows.get(request.key)
    all{request.phase=="handoff",request.committed,
      s'=s.with("requests",s.requests.set(requestId,request.with("phase","service-reply")))
        .with("rows",s.rows.set(request.key,row.with("handed",row.handed or delivered)))}
  }
  action serviceReply(requestId:int,ok:bool):bool={
    val request=s.requests.get(requestId)
    val row=s.rows.get(request.key)
    // Cancellation/consumption between the private SELECT and UPDATE makes
    // the zero-change claim an acknowledged no-send, retaining the row state.
    val noClaim=s.mail.id==request.key and not(active(row))
    all{request.phase=="service-reply",not(ok) or (row.handed and (Set("sent","unknown").contains(row.state) or noClaim)),
      s'=s.with("result",202).with("requests",s.requests.set(requestId,request.with("phase","done").with("response",202)))
        .with("rows",s.rows.set(request.key,if(not(ok) and row.state=="queued")row.with("state","unknown") else row))}
  }
  action readMail(id:int):bool=all{s.available,s.rows.get(id).handed,live(s.rows.get(id),s.now),s'=s.with("mail",{id:id,revision:0})}
  action claimMail=all{s.mail.id>0,s.rows.get(s.mail.id).state=="queued",active(s.rows.get(s.mail.id)),
    s'=s.with("rows",s.rows.set(s.mail.id,s.rows.get(s.mail.id).with("state","sending").with("admitted",true)))}
  action replayMail(id:int):bool=all{s.rows.get(id).handed,live(s.rows.get(id),s.now),s.rows.get(id).state!="queued",s'=s}
  action callProvider(id:int):bool=all{s.rows.get(id).state=="sending",not(s.rows.get(id).called),
    s'=s.with("rows",s.rows.set(id,s.rows.get(id).with("called",true)))}
  action complete(id:int,sent:bool):bool=all{s.rows.get(id).state=="sending",s.rows.get(id).called,
    s'=s.with("rows",s.rows.set(id,s.rows.get(id).with("state",if(sent)"sent" else "unknown")))}
  action readVerification(id:int,owner:bool):bool=all{owner,live(s.rows.get(id),s.now),s'=s.with("verification",{id:id,revision:s.revision})}
  action commitVerification=all{s.verification.id>0,s.revision<2,s.revision==s.verification.revision,active(s.rows.get(s.verification.id)),
    s'=s.with("rows",s.rows.set(s.verification.id,s.rows.get(s.verification.id).with("consumed",true)))
      .with("destination",s.rows.get(s.verification.id).payload).with("revision",s.revision+1)}
  action optOut=all{s.revision<2,s'=s.with("revision",s.revision+1)}
  action prepared(requestId:int,key:int,payload:int):bool=begin(requestId,key,payload).then(lookup(requestId)).then(capabilityReply(requestId,true)).then(captureTime(requestId))
  action stored(requestId:int,key:int,payload:int):bool=prepared(requestId,key,payload).then(insert(requestId)).then(batchReply(requestId,true))
  action dispatched(requestId:int,key:int,payload:int):bool=stored(requestId,key,payload).then(handoff(requestId,true))
  action delivered(requestId:int,key:int,payload:int):bool=dispatched(requestId,key,payload).then(readMail(key)).then(claimMail).then(callProvider(key)).then(complete(key,true)).then(serviceReply(requestId,true))
  action replay(requestId:int,key:int,payload:int):bool=begin(requestId,key,payload).then(lookup(requestId))
  action step={
    nondet requestId=requestIds.oneOf()
    nondet id=ids.oneOf()
    nondet payload=ids.oneOf()
    nondet yes=Set(false,true).oneOf()
    nondet at=Set(59,60,120,1800,1860,3600).oneOf()
    any{otherAddressHistory,malformedRequest,availability(yes),advance(at),begin(requestId,id,payload),lookup(requestId),
      capabilityReply(requestId,yes),captureTime(requestId),insert(requestId),batchReply(requestId,yes),classify(requestId),
      precommitFailure(requestId),handoff(requestId,yes),serviceReply(requestId,yes),readMail(id),replayMail(id),claimMail,
      callProvider(id),complete(id,yes),readVerification(id,yes),commitVerification,optOut,s'=s}
  }
  val invariant=all{s.destination>=0,s.destination<=2,s.revision<=2,
    ids.forall(id=>{val row=s.rows.get(id)
      (row.called implies row.handed and row.admitted and row.state!="absent") and (row.handed implies row.state!="absent")}),
    requestIds.forall(id=>{val request=s.requests.get(id)
      request.committed implies s.rows.get(request.key).state!="absent" and s.rows.get(request.key).payload==request.payload}),
    s.destination>0 implies ids.exists(id=>s.rows.get(id).consumed and s.rows.get(id).payload==s.destination)}
  run replayDuringPauseDoesNotResendTest=init.then(delivered(1,1,1)).then(availability(false)).then(replay(2,1,1)).expect(s.result==202)
    .then(replay(2,1,2)).expect(s.result==409).then(begin(2,2,2)).then(lookup(2)).then(capabilityReply(2,true))
    .expect(s.result==503 and s.rows.get(1).called and not(s.rows.get(2).handed))
  run unknownIsNotVerifiedTest=init.then(dispatched(1,1,1)).then(readMail(1)).then(claimMail).then(callProvider(1)).then(complete(1,false))
    .then(serviceReply(1,true)).then(replayMail(1)).expect(s.rows.get(1).state=="unknown" and s.destination==0).then(claimMail.fail())
  run lostServiceResponseDoesNotOverwriteClaimTest=init.then(dispatched(1,1,1)).then(readMail(1)).then(claimMail).then(serviceReply(1,false))
    .expect(s.rows.get(1).state=="sending").then(callProvider(1)).then(complete(1,true)).expect(s.rows.get(1).state=="sent" and invariant)
  run replacementCancelsOldLinkTest=init.then(stored(1,1,1)).then(advance(60)).then(stored(2,2,2))
    .expect(s.rows.get(1).cancelled and s.destination==0).then(readVerification(1,true).fail())
  run lateCompletionCannotChangeVerifiedDestinationTest=init.then(dispatched(1,1,1)).then(readMail(1)).then(claimMail).then(callProvider(1))
    .then(advance(60)).then(stored(2,2,2)).then(readVerification(2,true)).then(commitVerification).then(complete(1,true)).expect(s.destination==2 and invariant)
  run expiredReadCannotStartTest=init.then(stored(1,1,1)).then(advance(1800)).then(readVerification(1,true).fail())
  run expiredMailReadCannotStartTest=init.then(dispatched(1,1,1)).then(advance(1800)).then(readMail(1).fail())
  run admittedBeforeExpiryCanCommitAfterTest=init.then(stored(1,1,1)).then(readVerification(1,true)).then(advance(1800)).then(commitVerification).expect(s.destination==1 and invariant)
  run preferenceRevisionFencesVerificationTest=init.then(stored(1,1,1)).then(readVerification(1,true)).then(optOut).then(commitVerification.fail())
  run recentAddressHistoryLimitsNewRequestTest=init.then(otherAddressHistory).then(stored(1,1,1)).then(advance(60)).then(prepared(2,2,2))
    .then(insert(2)).then(batchReply(2,true)).then(classify(2)).expect(s.result==429)
  run wrongActorDoesNotConsumeTest=init.then(stored(1,1,1)).then(readVerification(1,false).fail())
  run malformedDoesNotCreateTest=init.then(malformedRequest).expect(existing.size()==0 and s.result==400)
  run lostCommittedBatchReplyCannotReconstructRawTokenTest=init.then(prepared(1,1,1)).then(insert(1)).then(batchReply(1,false)).then(replay(2,1,1))
    .expect(s.result==202 and s.rows.get(1).state=="queued" and not(s.rows.get(1).handed)).then(readMail(1).fail())
  run freshKeyRecoversAfterLostBatchReplyTest=init.then(prepared(1,1,1)).then(insert(1)).then(batchReply(1,false)).then(advance(60)).then(delivered(2,2,2))
    .expect(s.rows.get(1).cancelled and not(s.rows.get(1).called) and s.rows.get(2).called and invariant)
  run sameKeyConcurrentReplayDoesNotDuplicateHandoffTest=init.then(prepared(1,1,1)).then(prepared(2,1,1)).then(insert(1)).then(insert(2))
    .then(batchReply(2,true)).then(classify(2)).then(batchReply(1,true)).then(handoff(1,true))
    .expect(s.requests.get(2).response==202 and not(s.requests.get(2).committed) and existing.size()==1 and invariant)
  run sameKeyConcurrentChangedPayloadConflictsTest=init.then(prepared(1,1,1)).then(prepared(2,1,2)).then(insert(1)).then(insert(2))
    .then(batchReply(2,true)).then(classify(2)).expect(s.result==409 and s.rows.get(1).payload==1 and invariant)
  run precommitStorageFailureCreatesNothingTest=init.then(prepared(1,1,1)).then(precommitFailure(1)).expect(existing.size()==0 and s.result==500 and invariant)
  run senderPauseAfterCapabilityStillRetainsEnrollmentTest=init.then(prepared(1,1,1)).then(availability(false)).then(insert(1)).then(batchReply(1,true))
    .then(handoff(1,false)).then(serviceReply(1,false)).expect(s.result==202 and s.rows.get(1).state=="unknown" and not(s.rows.get(1).called))
  run lostServiceReplyBeforeClaimPreventsLateNewSendTest=init.then(dispatched(1,1,1)).then(serviceReply(1,false)).then(readMail(1)).then(replayMail(1))
    .expect(s.rows.get(1).state=="unknown" and not(s.rows.get(1).called)).then(claimMail.fail())
  run queuedMailClaimUsesCapturedExpiryTest=init.then(dispatched(1,1,1)).then(readMail(1)).then(advance(1800)).then(claimMail).then(callProvider(1)).then(complete(1,true))
    .expect(s.rows.get(1).called and invariant)
  run replacementBetweenPrivateReadAndClaimAcknowledgesNoSendTest=init.then(dispatched(1,1,1)).then(readMail(1))
    .then(advance(60)).then(stored(2,2,2)).then(serviceReply(1,true))
    .expect(s.rows.get(1).cancelled and s.rows.get(1).state=="queued" and not(s.rows.get(1).called) and s.requests.get(1).response==202 and invariant)
}
