// @source src/BountySubmittedPayments.tsx
// @source src/DirectBountyPayment.tsx
// @source src/SolanaBountyPayment.tsx
// @source src/lib/use-action.ts
// One selected recovery row, a separate nonce/actor row, two submissions.
// Parent identity/generation checks and the synchronous partial-write loop
// remain in ui_submitted_payment_recovery. This model retains record identity.
// Source-authored only: scenarios and verification have not been executed.
module ui_submitted_candidate_ownership {
  type Record = {present:bool,attempt:int,hash:int,candidate:int}
  type State = {store:Record,other:Record,ack:Record,draft:int,phase:str,checks:int,
    captured:Record,value:int,submitted:int,error:bool,cleared:bool,replaced:bool,
    lastWrite:bool,observed:Record,expected:Record,otherBefore:Record}
  pure val empty:Record={present:false,attempt:0,hash:0,candidate:0}
  pure val initial:Record={present:true,attempt:1,hash:0,candidate:0}
  pure val replacement:Record={present:true,attempt:2,hash:0,candidate:0}
  pure val otherInitial:Record={present:true,attempt:2,hash:1,candidate:0}
  var s:State
  action init=s'={store:initial,other:otherInitial,ack:initial,draft:2,phase:"idle",checks:0,
    captured:empty,value:0,submitted:0,error:false,cleared:false,replaced:false,
    lastWrite:false,observed:empty,expected:empty,otherBefore:otherInitial}
  def finish(state:State):State=state.with("phase","idle").with("captured",empty).with("value",0)
  action edit(value:int):bool=all{value>=0,value<=2,
    s'=s.with("draft",value).with("lastWrite",false)}
  action begin=all{s.phase=="idle",s.checks<2,s.draft>0,
    s'=s.with("phase","authorize").with("checks",s.checks+1)
      .with("captured",s.ack).with("value",s.draft).with("error",false).with("lastWrite",false)}
  action authorized(allowed:bool):bool=all{s.phase=="authorize",
    s'=if(allowed)s.with("phase","persist") else finish(s).with("error",true)}
  // A late wallet decline may remove only its still-empty original request.
  action walletDecline=all{s.store==initial,not(s.cleared),
    s'=s.with("store",empty).with("cleared",true).with("lastWrite",false)}
  action newAttempt=all{not(s.store.present),not(s.replaced),
    s'=s.with("store",replacement).with("replaced",true).with("lastWrite",false)}
  action walletHash=all{s.store.present,s.store.attempt==1,s.store.hash==0,
    s'=s.with("store",s.store.with("hash",1)).with("lastWrite",false)}
  action newerCandidate=all{s.store.present,s.store.attempt==1,s.store.candidate==0,
    s'=s.with("store",s.store.with("candidate",1)).with("lastWrite",false)}
  action otherNonceChanges=all{s.other.candidate==0,
    s'=s.with("other",s.other.with("candidate",1)).with("lastWrite",false)}
  action persist(storageWorks:bool):bool=all{s.phase=="persist",
    val owns=s.store.present and s.store==s.captured
    val updated=s.store.with("candidate",s.value)
    s'=if(owns and storageWorks)s.with("store",updated).with("ack",updated)
      .with("phase","posting").with("submitted",s.value).with("lastWrite",true)
      .with("observed",s.store).with("expected",s.captured).with("otherBefore",s.other)
      else finish(s).with("error",true).with("lastWrite",false)}
  action verificationReply(ok:bool):bool=all{s.phase=="posting",
    s'=finish(s).with("error",not(ok)).with("lastWrite",false)}
  // Reload explicitly adopts the current stored record after an ownership refusal.
  action reload=all{s.phase=="idle",s.store.present,
    s'=s.with("ack",s.store).with("lastWrite",false)}
  action chooseEdit={nondet value=0.to(2).oneOf() edit(value)}
  action step=any{chooseEdit,begin,authorized(true),authorized(false),walletDecline,newAttempt,
    walletHash,newerCandidate,otherNonceChanges,persist(true),persist(false),
    verificationReply(true),verificationReply(false),reload,s'=s}
  val invariant=all{s.checks<=2,s.submitted>=0,s.submitted<=2,
    not(s.store.present) implies s.store==empty,
    s.lastWrite implies(s.observed.present and s.observed==s.expected and s.other==s.otherBefore),
    s.store.attempt==2 implies s.store.hash==0,
    s.phase=="posting" implies s.submitted>0}
  run declinedRowCannotBeRecreatedTest=init.then(begin).then(authorized(true)).then(walletDecline)
    .then(persist(true)).expect(s.store==empty and s.submitted==0 and s.error)
  run replacementRequestCannotReceiveOldCandidateTest=init.then(begin).then(authorized(true))
    .then(walletDecline).then(newAttempt).then(persist(true))
    .expect(s.store==replacement and s.submitted==0 and s.error)
  run returnedWalletHashInvalidatesOldSnapshotTest=init.then(begin).then(authorized(true))
    .then(walletHash).then(persist(true)).expect(s.store.hash==1 and s.store.candidate==0 and s.submitted==0)
  run newerCandidateInvalidatesOldSnapshotTest=init.then(begin).then(authorized(true))
    .then(newerCandidate).then(persist(true)).expect(s.store.candidate==1 and s.submitted==0)
  run independentNonceRemainsIntactTest=init.then(begin).then(authorized(true)).then(otherNonceChanges)
    .then(persist(true)).expect(s.store.candidate==2 and s.other.candidate==1 and s.submitted==2)
  run candidateBeforeWalletHashIsPreservedTest=init.then(begin).then(authorized(true)).then(persist(true))
    .then(walletHash).expect(s.store.hash==1 and s.store.candidate==2)
  run failedStorageCanRetryWithoutPhantomAcknowledgementTest=init.then(begin).then(authorized(true))
    .then(persist(false)).expect(s.ack==initial and s.submitted==0)
    .then(begin).then(authorized(true)).then(persist(true)).expect(s.submitted==2)
  run successfulStorageIsAcknowledgedForEditedRetryTest=init.then(begin).then(authorized(true)).then(persist(true))
    .then(verificationReply(false)).then(edit(1)).then(begin).then(authorized(true)).then(persist(true))
    .expect(s.store.candidate==1 and s.submitted==1 and s.checks==2)
  run editingDuringAuthorizationKeepsCapturedSubmissionTest=init.then(begin).then(edit(1))
    .then(authorized(true)).then(persist(true)).expect(s.draft==1 and s.submitted==2 and s.ack.candidate==2)
  run authorityRefusalLeavesStorageAloneTest=init.then(begin).then(authorized(false))
    .expect(s.store==initial and s.submitted==0 and s.error)
  run explicitEmptyDoesNotStartTest=init.then(edit(0)).then(begin.fail())
}
