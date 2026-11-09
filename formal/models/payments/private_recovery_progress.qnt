// @source backend/security/direct-payments.ts
// @source backend/security/direct-solana-recovery.ts
// @source backend/security/handler.ts
// @source migrations/0112_direct_payment_recovery.sql
// @source migrations/0113_direct_unpaid_leg_recovery.sql
// @evidence backend/security/direct-solana-api.integration.ts
// @evidence formal/tests/direct-solana-retirement.test.ts
// Caller composition for Solana recovery, not another chain/crypto model.
// Two retained plan IDs, two HTTP requests/keys, two generations and destinations,
// case revisions 1..5; each of eight generation/plan/provider scan slots has at
// most two immutable revisions. Signature 0=omitted, 1=valid, 2=well-shaped but
// cryptographically invalid. New input overrides prior input for the same ID.
// Unknown IDs/duplicate input are a separate rejection class. Exact message
// bytes, expiry, provider independence and retained-history truth are supplied
// by solana_history_retirement/direct_solana_retirement. No model signs or pays.
// The case's latest recovery event is adopted only for the captured generation
// AND target. Its messages may remain after signatures arrive; history-check
// preserves prior messages rather than replacing them with the missing set.
// Scan writes are independent of the case transaction and may finish after a
// stale case request. They preserve old-generation evidence without authorizing
// a successor. Only a matching current case/generation/target and the lower
// completion fence can append progress or a successor. Identity/role admission
// precedes this model; completionFence represents the existing wallet/consent
// predicate in direct_recovery_completion, not continuous session authority.
// A replay of the same actor/kind/key returns the current view without planning
// again. Response loss/view failure cannot undo an event or restore its key.
// Existing native API source covers one-message progress/signature reuse. Its
// new lost-reply definition and this two-message composition are unexecuted;
// concurrent two-message caller conformance remains a gap. No checks ran.
module private_recovery_progress {
  val requests=Set(1,2)
  val requestKeys=Set(1,2)
  val plans=Set(1,2)
  val scanSlots=1.to(8)
  type Event={present:bool,revision:int,generation:int,target:int,result:str,sig1:int,sig2:int,messages:Set[int]}
  type Call={phase:str,key:int,revision:int,generation:int,target:int,sig1:int,sig2:int,
    merged1:int,merged2:int,adopted:bool,priorMessages:Set[int],messages:Set[int],result:str,
    proof:bool,committed:bool,replayed:bool,response:int,scanPhase:str,scanIndex:int,scanPrior:int}
  val noEvent={present:false,revision:0,generation:0,target:0,result:"none",sig1:0,sig2:0,messages:Set()}
  val noCall={phase:"unused",key:1,revision:1,generation:0,target:1,sig1:0,sig2:0,
    merged1:0,merged2:0,adopted:false,priorMessages:Set(),messages:Set(),result:"none",
    proof:false,committed:false,replayed:false,response:0,scanPhase:"none",scanIndex:1,scanPrior:0}
  var s:{revision:int,generation:int,target:int,completionFence:bool,latest:int,
    events:int->Event,calls:int->Call,scans:int->int,successors:int}
  action init=s'={revision:1,generation:0,target:1,completionFence:true,latest:0,
    events:Set(0,1,2).mapBy(_=>noEvent),calls:requests.mapBy(_=>noCall),scans:scanSlots.mapBy(_=>0),successors:0}
  action begin(id:int,key:int,sig1:int,sig2:int):bool=all{
    requestKeys.contains(key),Set(0,1,2).contains(sig1),Set(0,1,2).contains(sig2),s.calls.get(id).phase=="unused",
    s'=s.with("calls",s.calls.set(id,noCall.with("phase","lookup").with("key",key)
      .with("revision",s.revision).with("sig1",sig1).with("sig2",sig2)))}
  action lookup(id:int,sameActorAndKind:bool):bool={
    val call=s.calls.get(id)
    val event=s.events.get(call.key)
    all{call.phase=="lookup",s'=s.with("calls",s.calls.set(id,
      if(not(event.present))call.with("phase","context")
      else if(sameActorAndKind)call.with("phase","reply").with("replayed",true)
      else call.with("phase","done").with("response",409)))}
  }
  action context(id:int):bool={
    val call=s.calls.get(id)
    all{call.phase=="context",s'=s.with("calls",s.calls.set(id,
      call.with("phase","adopt").with("generation",s.generation).with("target",s.target)))}
  }
  action adopt(id:int):bool={
    val call=s.calls.get(id)
    val event=s.events.get(s.latest)
    val matching=event.present and event.generation==call.generation and event.target==call.target
    all{call.phase=="adopt",s'=s.with("calls",s.calls.set(id,
      call.with("phase","retirement").with("adopted",matching)
        .with("priorMessages",if(matching)event.messages else Set())
        .with("merged1",if(call.sig1>0)call.sig1 else if(matching)event.sig1 else 0)
        .with("merged2",if(call.sig2>0)call.sig2 else if(matching)event.sig2 else 0)))}
  }
  action malformedInput(id:int):bool={
    val call=s.calls.get(id)
    all{call.phase=="retirement",call.scanPhase=="none",
      s'=s.with("calls",s.calls.set(id,call.with("phase","done").with("response",400)))}
  }
  action captureScan(id:int,pair:int):bool={
    val call=s.calls.get(id)
    val slot=call.generation*4+pair
    all{call.phase=="retirement",call.merged1==1,call.merged2==1,
      1.to(4).contains(pair),Set("none","done").contains(call.scanPhase),
      s.scans.get(slot)<2,s'=s.with("calls",s.calls.set(id,call.with("scanPhase","pending")
        .with("scanIndex",slot).with("scanPrior",s.scans.get(slot))))}
  }
  action scanCommit(id:int):bool={
    val call=s.calls.get(id)
    val matched=s.scans.get(call.scanIndex)==call.scanPrior
    all{Set("pending","unknown").contains(call.scanPhase),s'=s.with("calls",s.calls.set(id,call.with("scanPhase",
      if(not(matched))"failed" else if(call.scanPhase=="unknown")"settled-late" else "committed")))
      .with("scans",if(matched)s.scans.set(call.scanIndex,call.scanPrior+1) else s.scans)}
  }
  action scanReply(id:int,received:bool):bool={
    val call=s.calls.get(id)
    all{call.scanPhase=="committed",
      s'=s.with("calls",s.calls.set(id,call.with("scanPhase",if(received)"done" else "reply-lost")))}
  }
  action unknownScanReply(id:int):bool={
    val call=s.calls.get(id)
    all{call.scanPhase=="pending",
      s'=s.with("calls",s.calls.set(id,call.with("scanPhase","unknown")))}
  }
  action retirement(id:int,result:str):bool={
    val call=s.calls.get(id)
    val signed=call.merged1==1 and call.merged2==1
    val invalid=call.merged1==2 or call.merged2==2
    val missing=(if(call.merged1==0)Set(1) else Set()).union(if(call.merged2==0)Set(2) else Set())
    all{call.phase=="retirement",
      not(Set("pending","committed").contains(call.scanPhase)),
      not(Set("unknown","failed","reply-lost","settled-late").contains(call.scanPhase)) or result=="history-check",
      Set("expiry-required","history-check","signature-required","payment-found","retired","invalid-signature").contains(result),
      (result!="signature-required" or (not(invalid) and missing.size()>0)),
      (not(Set("payment-found","retired").contains(result)) or signed),
      (result!="invalid-signature" or invalid),
      s'=s.with("calls",s.calls.set(id,call.with("result",result).with("proof",result=="retired")
        .with("messages",if(result=="signature-required")missing else call.priorMessages)
        .with("phase",if(result=="invalid-signature")"done" else if(result=="retired")"prepare" else "batch")
        .with("response",if(result=="invalid-signature")400 else 0)))}
  }
  action prepareReply(id:int,kind:str):bool={
    val call=s.calls.get(id)
    all{call.phase=="prepare",Set("ok","payer-refused","error").contains(kind),
      s'=s.with("calls",s.calls.set(id,call.with("phase",if(kind=="ok")"batch" else "done")
        .with("response",if(kind=="ok")0 else if(kind=="payer-refused")409 else 500)))}
  }
  action caseCommit(id:int):bool={
    val call=s.calls.get(id)
    val matched=s.revision==call.revision and s.generation==call.generation and s.target==call.target
      and s.completionFence and not(s.events.get(call.key).present)
    val successor=call.result=="retired"
    val event={present:true,revision:s.revision+1,generation:if(successor)call.generation+1 else call.generation,
      target:if(successor)0 else call.target,result:if(successor)"successor" else call.result,
      sig1:if(successor)0 else call.merged1,sig2:if(successor)0 else call.merged2,
      messages:if(successor)Set() else call.messages}
    all{call.phase=="batch",s.revision<5,not(successor) or s.generation==0,
      s'=s.with("calls",s.calls.set(id,call.with("phase",if(matched)"reply" else "done")
        .with("committed",matched).with("response",if(matched)0 else 409)))
        .with("revision",if(matched)s.revision+1 else s.revision)
        .with("generation",if(matched and successor)s.generation+1 else s.generation)
        .with("successors",if(matched and successor)s.successors+1 else s.successors)
        .with("events",if(matched)s.events.set(call.key,event) else s.events)
        .with("latest",if(matched)call.key else s.latest)}
  }
  action caseFailure(id:int):bool={
    val call=s.calls.get(id)
    all{call.phase=="batch",s'=s.with("calls",s.calls.set(id,call.with("phase","done").with("response",500)))}
  }
  action response(id:int,kind:str):bool={
    val call=s.calls.get(id)
    all{call.phase=="reply",Set("ok","lost","view-failure").contains(kind),
      s'=s.with("calls",s.calls.set(id,call.with("phase","done")
        .with("response",if(kind=="ok")200 else if(kind=="lost")0 else 500)))}
  }
  action walletChange=all{s.target==1,s'=s.with("target",2)}
  action otherGeneration=all{s.generation==0,s.revision<5,
    s'=s.with("generation",1).with("revision",s.revision+1)}
  action otherCaseWrite=all{s.revision<5,s'=s.with("revision",s.revision+1)}
  action loseCompletionFence=s'=s.with("completionFence",false)
  action ready(id:int,key:int,sig1:int,sig2:int):bool=begin(id,key,sig1,sig2).then(lookup(id,true)).then(context(id)).then(adopt(id))
  action progress(id:int,key:int,sig1:int,sig2:int,result:str):bool=ready(id,key,sig1,sig2).then(retirement(id,result)).then(caseCommit(id)).then(response(id,"ok"))
  action step={
    nondet id=requests.oneOf()
    nondet key=requestKeys.oneOf()
    nondet first=Set(0,1,2).oneOf()
    nondet second=Set(0,1,2).oneOf()
    nondet pair=1.to(4).oneOf()
    nondet yes=Set(false,true).oneOf()
    nondet result=Set("expiry-required","history-check","signature-required","payment-found","retired","invalid-signature").oneOf()
    nondet prepared=Set("ok","payer-refused","error").oneOf()
    nondet reply=Set("ok","lost","view-failure").oneOf()
    any{begin(id,key,first,second),lookup(id,yes),context(id),adopt(id),malformedInput(id),captureScan(id,pair),scanCommit(id),scanReply(id,yes),unknownScanReply(id),
      retirement(id,result),prepareReply(id,prepared),caseCommit(id),caseFailure(id),response(id,reply),walletChange,
      otherGeneration,otherCaseWrite,loseCompletionFence,s'=s}
  }
  val invariant=all{s.revision>=1 and s.revision<=5,s.generation>=0 and s.generation<=1,s.successors<=1,
    scanSlots.forall(slot=>s.scans.get(slot)>=0 and s.scans.get(slot)<=2),
    requests.forall(id=>{val call=s.calls.get(id)
      (call.committed implies s.events.get(call.key).present) and
      (call.replayed implies s.events.get(call.key).present) and
      (call.response==200 implies call.committed or call.replayed) and
      (call.committed and call.result=="retired" implies call.proof and call.merged1==1 and call.merged2==1)}),
    requestKeys.forall(key=>{val event=s.events.get(key)
      event.present implies event.revision<=s.revision and event.messages.subseteq(plans)})}
  run secondRequestReusesFirstSignatureTest=init.then(progress(1,1,1,0,"signature-required")).then(ready(2,2,0,1))
    .expect(s.calls.get(2).adopted and s.calls.get(2).merged1==1 and s.calls.get(2).merged2==1)
    .then(retirement(2,"retired")).then(prepareReply(2,"ok")).then(caseCommit(2)).then(response(2,"ok"))
    .expect(s.generation==1 and s.successors==1 and invariant)
  run lostProgressReplyKeepsIdempotentEventTest=init.then(ready(1,1,1,0)).then(retirement(1,"signature-required")).then(caseCommit(1))
    .then(response(1,"lost")).then(begin(2,1,0,1)).then(lookup(2,true)).then(response(2,"ok"))
    .expect(s.calls.get(2).replayed and not(s.calls.get(2).committed) and s.revision==2 and s.events.get(1).sig1==1 and invariant)
  run replayCannotBeReusedByDifferentActorOrKindTest=init.then(progress(1,1,0,0,"signature-required"))
    .then(begin(2,1,0,0)).then(lookup(2,false)).expect(s.calls.get(2).response==409 and s.revision==2 and invariant)
  run replacementTargetRejectsOldProgressAdoptionTest=init.then(progress(1,1,1,0,"signature-required")).then(walletChange).then(ready(2,2,0,1))
    .expect(not(s.calls.get(2).adopted) and s.calls.get(2).merged1==0 and s.calls.get(2).priorMessages==Set() and invariant)
  run successorGenerationRejectsOldProgressAdoptionTest=init.then(progress(1,1,1,0,"signature-required")).then(otherGeneration).then(ready(2,2,0,1))
    .expect(not(s.calls.get(2).adopted) and s.calls.get(2).merged1==0 and invariant)
  run newInvalidSignatureCannotBorrowPriorValidityTest=init.then(progress(1,1,1,0,"signature-required")).then(ready(2,2,2,1))
    .then(retirement(2,"invalid-signature")).expect(s.calls.get(2).response==400 and s.events.get(1).sig1==1 and s.generation==0 and invariant)
  run expiryBeforeValidationCanRetainInvalidCandidateTest=init.then(progress(1,1,2,0,"expiry-required")).then(ready(2,2,0,1))
    .then(retirement(2,"invalid-signature")).expect(s.calls.get(2).merged1==2 and s.calls.get(2).response==400 and invariant)
  run historyProgressPreservesEarlierMessagesTest=init.then(progress(1,1,0,0,"signature-required")).then(progress(2,2,1,1,"history-check"))
    .expect(s.events.get(2).messages==plans and s.events.get(2).sig1==1 and s.events.get(2).sig2==1 and invariant)
  run partialReplyNeverCreatesSuccessorTest=init.then(progress(1,1,1,1,"payment-found"))
    .expect(s.events.get(1).result=="payment-found" and s.generation==0 and s.successors==0 and invariant)
  run staleConcurrentProgressCannotReplaceWinnerTest=init.then(ready(1,1,1,0)).then(ready(2,2,0,1))
    .then(retirement(1,"signature-required")).then(retirement(2,"signature-required")).then(caseCommit(1)).then(caseCommit(2))
    .expect(s.calls.get(2).response==409 and s.latest==1 and not(s.events.get(2).present) and invariant)
  run scanSurvivesFailedCaseTransactionTest=init.then(ready(1,1,1,1)).then(captureScan(1,1)).then(scanCommit(1))
    .then(scanReply(1,false)).then(retirement(1,"history-check")).then(caseFailure(1))
    .expect(s.scans.get(1)==1 and not(s.events.get(1).present) and s.revision==1 and invariant)
  run oldGenerationScanMayFinishAfterAnotherRecoveryTest=init.then(ready(1,1,1,1)).then(captureScan(1,1)).then(otherGeneration)
    .then(scanCommit(1)).then(scanReply(1,true)).then(retirement(1,"history-check")).then(caseCommit(1))
    .expect(s.scans.get(1)==1 and s.calls.get(1).response==409 and not(s.events.get(1).present) and invariant)
  run concurrentScanCASPreservesFirstPageTest=init.then(ready(1,1,1,1)).then(ready(2,2,1,1)).then(captureScan(1,1)).then(captureScan(2,1))
    .then(scanCommit(1)).then(scanCommit(2)).expect(s.scans.get(1)==1 and s.calls.get(2).scanPhase=="failed" and invariant)
  run failedSuccessorPreparationKeepsHistoryTest=init.then(ready(1,1,1,1)).then(captureScan(1,1)).then(scanCommit(1))
    .then(scanReply(1,true)).then(retirement(1,"retired")).then(prepareReply(1,"payer-refused"))
    .expect(s.scans.get(1)==1 and s.generation==0 and not(s.events.get(1).present) and invariant)
  run walletChangeBeforeCommitRejectsCapturedProgressTest=init.then(ready(1,1,1,0)).then(retirement(1,"signature-required")).then(walletChange).then(caseCommit(1))
    .expect(s.calls.get(1).response==409 and s.revision==1 and invariant)
  run lostSuccessorReplyKeepsOneNewGenerationTest=init.then(ready(1,1,1,1)).then(retirement(1,"retired")).then(prepareReply(1,"ok")).then(caseCommit(1))
    .then(response(1,"lost")).then(begin(2,1,0,0)).then(lookup(2,true)).then(response(2,"ok"))
    .expect(s.successors==1 and s.generation==1 and s.calls.get(2).replayed and invariant)
  run revokedCompletionFenceKeepsPartialProgressUncommittedTest=init.then(ready(1,1,1,0)).then(retirement(1,"signature-required")).then(loseCompletionFence).then(caseCommit(1))
    .expect(not(s.events.get(1).present) and s.calls.get(1).response==409 and invariant)
  run viewFailureDoesNotUndoProgressTest=init.then(ready(1,1,1,0)).then(retirement(1,"signature-required")).then(caseCommit(1)).then(response(1,"view-failure"))
    .expect(s.calls.get(1).response==500 and s.events.get(1).present and s.revision==2 and invariant)
  run delayedScanMayCommitAfterFailedCaseWriteTest=init.then(ready(1,1,1,1)).then(captureScan(1,1)).then(unknownScanReply(1))
    .then(retirement(1,"history-check")).then(caseFailure(1)).then(scanCommit(1))
    .expect(s.scans.get(1)==1 and s.calls.get(1).scanPhase=="settled-late" and not(s.events.get(1).present) and invariant)
}
