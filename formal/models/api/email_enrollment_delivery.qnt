// @source backend/notifications/email.ts
// @source workers/notify/enrollment.ts
// @source migrations/0111_verified_notification_email.sql
// @source migrations/0116_email_preference_revision.sql
// @evidence backend/notifications/email-enrollment.test.ts
// One actor, two request keys/payload fingerprints, clock boundary classes in
// seconds, and 0/2 other address-history requests. Read handles witness a
// successful admission-time expiry check; copied timestamps are quotiented out
// because request rows never change their created/expiry time. First stored
// key/payload/time are normalized to 1/1/0; identifiers and clock origin carry
// no authority. Shape/token cryptography is
// outside the model. SQL compares expiry with captured request admission time.
module email_enrollment_delivery {
  type Row = {state:str,payload:int,created:int,cancelled:bool,consumed:bool,called:bool,admitted:bool}
  type Read = {id:int,revision:int}
  var s:{rows:int->Row,now:int,available:bool,others:int,result:int,destination:int,revision:int,mail:Read,verification:Read}
  val empty={state:"absent",payload:0,created:0,cancelled:false,consumed:false,called:false,admitted:false}
  val noRead={id:0,revision:0}
  val ids=Set(1,2)
  action init=s'={rows:ids.mapBy(_=>empty),now:0,available:true,others:0,result:0,destination:0,revision:0,mail:noRead,verification:noRead}
  def live(r:Row,at:int):bool = r.state!="absent" and not(r.cancelled) and not(r.consumed) and r.created+1800>at
  def active(r:Row):bool = r.state!="absent" and not(r.cancelled) and not(r.consumed)
  val existing=ids.filter(id=>s.rows.get(id).state!="absent")
  val recent=existing.filter(id=>s.rows.get(id).created>s.now-3600).size()+(if(s.now<3600)s.others else 0)
  val tooSoon=existing.exists(id=>s.rows.get(id).created>s.now-60)
  action otherAddressHistory=all{existing.size()==0,s'=s.with("others",2)}
  action malformedRequest=s'=s.with("result",400)
  action availability(value:bool):bool=s'=s.with("available",value)
  action advance(at:int):bool=all{existing.size()>0,Set(59,60,120,1800,1860,3600).contains(at),at>s.now,s'=s.with("now",at)}
  action request(id:int,payload:int):bool={
    val row=s.rows.get(id)
    all { existing.size()>0 or (id==1 and payload==1),
    s'=if(row.state!="absent")s.with("result",if(row.payload==payload)202 else 409)
      else if(not(s.available))s.with("result",503)
      else if(tooSoon or recent>=3)s.with("result",429)
      else s.with("rows",ids.mapBy(key=>if(key==id){state:"queued",payload:payload,created:s.now,cancelled:false,consumed:false,called:false,admitted:false}
        else {val prior=s.rows.get(key) if(prior.state!="absent" and not(prior.consumed))prior.with("cancelled",true) else prior})).with("result",202)
    }
  }
  action readMail(id:int):bool=all{s.available,live(s.rows.get(id),s.now),s'=s.with("mail",{id:id,revision:0})}
  action claimMail=all{s.mail.id>0,s.rows.get(s.mail.id).state=="queued",active(s.rows.get(s.mail.id)),
    s'=s.with("rows",s.rows.set(s.mail.id,s.rows.get(s.mail.id).with("state","sending").with("admitted",true)))}
  action replayMail(id:int):bool=all{live(s.rows.get(id),s.now),s.rows.get(id).state!="queued",s'=s}
  action callProvider(id:int):bool=all{s.rows.get(id).state=="sending",not(s.rows.get(id).called),
    s'=s.with("rows",s.rows.set(id,s.rows.get(id).with("called",true)))}
  action complete(id:int,sent:bool):bool=all{s.rows.get(id).state=="sending",s.rows.get(id).called,
    s'=s.with("rows",s.rows.set(id,s.rows.get(id).with("state",if(sent)"sent" else "unknown")))}
  action serviceFailure(id:int):bool=s'=if(s.rows.get(id).state=="queued")s.with("rows",s.rows.set(id,s.rows.get(id).with("state","unknown")))else s
  action readVerification(id:int,owner:bool):bool=all{owner,live(s.rows.get(id),s.now),s'=s.with("verification",{id:id,revision:s.revision})}
  action commitVerification=all{s.verification.id>0,s.revision<2,s.revision==s.verification.revision,
    active(s.rows.get(s.verification.id)),
    s'=s.with("rows",s.rows.set(s.verification.id,s.rows.get(s.verification.id).with("consumed",true)))
      .with("destination",s.rows.get(s.verification.id).payload).with("revision",s.revision+1)}
  action optOut=all{s.revision<2,s'=s.with("revision",s.revision+1)}
  action step=any{otherAddressHistory,malformedRequest,availability(true),availability(false),
    nondet at=oneOf(Set(59,60,120,1800,1860,3600)) advance(at),
    nondet id=oneOf(ids) nondet payload=oneOf(Set(1,2)) request(id,payload),
    nondet id=oneOf(ids) any{readMail(id),replayMail(id),callProvider(id),complete(id,true),complete(id,false),serviceFailure(id),readVerification(id,true),readVerification(id,false)},
    claimMail,commitVerification,optOut,s'=s}
  val invariant=all{s.destination>=0,s.destination<=2,s.revision<=2,
    ids.forall(id=>{val r=s.rows.get(id) r.called implies r.state!="absent" and r.admitted}),
    s.destination>0 implies ids.exists(id=>s.rows.get(id).consumed and s.rows.get(id).payload==s.destination)}
  run replayDuringPauseDoesNotResendTest=init.then(request(1,1)).then(readMail(1)).then(claimMail).then(callProvider(1)).then(complete(1,true))
    .then(availability(false)).then(request(1,1)).expect(s.result==202 and s.rows.get(1).called)
    .then(request(1,2)).expect(s.result==409).then(request(2,2)).expect(s.result==503)
  run unknownIsNotVerifiedTest=init.then(request(1,1)).then(readMail(1)).then(claimMail).then(callProvider(1)).then(complete(1,false))
    .then(replayMail(1)).expect(s.rows.get(1).state=="unknown" and s.destination==0).then(claimMail.fail())
  run lostServiceResponseDoesNotOverwriteClaimTest=init.then(request(1,1)).then(readMail(1)).then(claimMail).then(serviceFailure(1))
    .expect(s.rows.get(1).state=="sending").then(callProvider(1)).then(complete(1,true)).expect(s.rows.get(1).state=="sent")
  run replacementCancelsOldLinkTest=init.then(request(1,1)).then(advance(60)).then(request(2,2)).expect(s.rows.get(1).cancelled and s.destination==0).then(readVerification(1,true).fail())
  run lateCompletionCannotChangeVerifiedDestinationTest=init.then(request(1,1)).then(readMail(1)).then(claimMail).then(callProvider(1))
    .then(advance(60)).then(request(2,2)).then(readVerification(2,true)).then(commitVerification).then(complete(1,true)).expect(s.destination==2)
  run expiredReadCannotStartTest=init.then(request(1,1)).then(advance(1800)).then(readVerification(1,true).fail())
  run expiredMailReadCannotStartTest=init.then(request(1,1)).then(advance(1800)).then(readMail(1).fail())
  run admittedBeforeExpiryCanCommitAfterTest=init.then(request(1,1)).then(readVerification(1,true)).then(advance(1800)).then(commitVerification).expect(s.destination==1)
  run preferenceRevisionFencesVerificationTest=init.then(request(1,1)).then(readVerification(1,true)).then(optOut).then(commitVerification.fail())
  run recentAddressHistoryLimitsNewRequestTest=init.then(otherAddressHistory).then(request(1,1)).then(advance(60)).then(request(2,2)).expect(s.result==429)
  run wrongActorDoesNotConsumeTest=init.then(request(1,1)).then(readVerification(1,false).fail())
  run malformedDoesNotCreateTest=init.then(malformedRequest).expect(existing.size()==0 and s.result==400)
}
