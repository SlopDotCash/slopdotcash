// @source src/BountySubmittedPayments.tsx
// @source src/SecurityBounty.tsx
// @source src/lib/use-action.ts
// @evidence tests/e2e/bounty-full-flow.spec.ts
// @evidence tests/e2e/bounty-solana-flow.spec.ts
// One fallback instance, two actors/generations/rows, two storage reads.
// Values 0=empty/invalid syntax; 1..3 are syntactically valid identifiers.
// Exact chain receipt acceptance is an external predicate, never syntax.
// Authored by source inspection only; no check was run for this revision.
module ui_submitted_payment_recovery {
  var s:{parentAlive:bool,mounted:bool,boundActor:int,cookieActor:int,generation:int,
    loadScheduled:bool,activeRead:int,readActors:List[int],readGenerations:List[int],pendingReads:Set[int],
    rowActor:int,rowGeneration:int,values:List[int],stored:List[int],confirmed:Set[int],
    busy:bool,phase:str,checkActor:int,checkGeneration:int,checkRows:List[int],checkHashes:List[int],
    error:bool,postStarted:bool,postAuthorized:bool,recorded:bool,verified:bool}
  action init=s'={parentAlive:true,mounted:true,boundActor:1,cookieActor:1,generation:1,
    loadScheduled:true,activeRead:0,readActors:List(),readGenerations:List(),pendingReads:Set(),
    rowActor:0,rowGeneration:0,values:List(0,0),stored:List(0,0),confirmed:Set(),
    busy:false,phase:"idle",checkActor:0,checkGeneration:0,checkRows:List(0,0),checkHashes:List(),
    error:false,postStarted:false,postAuthorized:false,recorded:false,verified:false}
  val visibleHashes=s.values.filter(value=>value>0 and not(s.confirmed.contains(value)))
  val canVerify=s.mounted and not(s.busy) and visibleHashes.length()>0
  action readStorage=all{s.mounted,s.loadScheduled,s.readActors.length()<2,
    s'=s.with("loadScheduled",false).with("activeRead",s.readActors.length()+1)
      .with("readActors",s.readActors.append(s.cookieActor))
      .with("readGenerations",s.readGenerations.append(s.generation))
      .with("pendingReads",s.pendingReads.union(Set(s.readActors.length()+1)))}
  action storageReply(id:int,first:int,second:int):bool=all{s.pendingReads.contains(id),
    s'=if(s.mounted and id==s.activeRead and s.readActors[id-1]>0)
      s.with("pendingReads",s.pendingReads.exclude(Set(id))).with("activeRead",0)
        .with("rowActor",s.readActors[id-1]).with("rowGeneration",s.readGenerations[id-1])
        .with("values",List(first,second)).with("stored",List(first,second))
      else s.with("pendingReads",s.pendingReads.exclude(Set(id)))}
  // The effect cancels an old read but does not clear existing rows or actor.
  action storageReadFailure(id:int):bool=all{s.pendingReads.contains(id),
    s'=if(s.mounted and id==s.activeRead)
      s.with("pendingReads",s.pendingReads.exclude(Set(id))).with("activeRead",0).with("error",true)
      else s.with("pendingReads",s.pendingReads.exclude(Set(id)))}
  action generationChanges=all{s.generation==1,s.mounted,
    s'=s.with("generation",2).with("loadScheduled",true).with("activeRead",0)}
  action cookieChanges(actor:int):bool=all{actor>=0,actor<=2,s'=s.with("cookieActor",actor)}
  action confirmed(value:int):bool=all{value>0,value<=3,
    s'=s.with("confirmed",s.confirmed.union(Set(value)))}
  // Inputs stay editable while the async action runs. Its closure retains
  // the rows and visible hashes from the render that started the action.
  action edit(index:int,value:int):bool=all{s.mounted,index>=0,index<2,
    s'=s.with("values",s.values.replaceAt(index,value))}
  action beginVerify=all{canVerify,
    s'=s.with("busy",true).with("phase","identity").with("error",false)
      .with("checkActor",s.rowActor).with("checkGeneration",s.generation)
      .with("checkRows",s.values).with("checkHashes",visibleHashes)}
  action identityReply=all{s.phase=="identity",
    s'=if(s.checkActor>0 and s.checkActor==s.cookieActor)
      s.with("phase","authorize")
      else s.with("phase","idle").with("busy",false).with("error",true)}
  action authorityReply(allowed:bool,serverGeneration:int):bool=all{s.phase=="authorize",
    s'=if(s.parentAlive and s.cookieActor==s.boundActor and allowed and serverGeneration==s.checkGeneration)
      s.with("phase","persist-first")
      else s.with("phase","idle").with("busy",false).with("error",true)}
  action persistFirst=all{s.phase=="persist-first",
    s'=s.with("stored",s.stored.replaceAt(0,if(s.checkRows[0]>0)s.checkRows[0] else s.stored[0]))
      .with("phase","persist-second")}
  action persistSecond=all{s.phase=="persist-second",
    s'=s.with("stored",s.stored.replaceAt(1,if(s.checkRows[1]>0)s.checkRows[1] else s.stored[1]))
      .with("phase","verify-preflight")}
  action storageFailure=all{Set("persist-first","persist-second").contains(s.phase),
    s'=s.with("phase","idle").with("busy",false).with("error",true)}
  // verifyExistingPayment performs another actor-bound fresh GET before POST.
  action verifyPreflight(allowed:bool,serverGeneration:int):bool=all{s.phase=="verify-preflight",
    s'=if(s.parentAlive and s.cookieActor==s.boundActor and allowed and serverGeneration==s.checkGeneration)
      s.with("phase","post").with("postStarted",true).with("postAuthorized",true)
      else s.with("phase","idle").with("busy",false).with("error",true)}
  action verificationReply(exactReceipt:bool):bool=all{s.phase=="post",
    s'=s.with("phase","idle").with("busy",false)
      .with("recorded",s.recorded or exactReceipt)
      .with("error",not(exactReceipt and s.parentAlive and s.cookieActor==s.boundActor))
      .with("verified",exactReceipt and s.parentAlive and s.cookieActor==s.boundActor)}
  // Removing just the fallback does not cancel its already-started promise.
  // The enclosing provider, if alive, still checks the actor on API reads.
  action leaveFallback=s'=s.with("mounted",false).with("activeRead",0)
  action closePrivateParent=s'=s.with("parentAlive",false).with("mounted",false).with("activeRead",0)
  action step={nondet id=1.to(2).oneOf() nondet first=0.to(3).oneOf()
    nondet second=0.to(3).oneOf() nondet actor=0.to(2).oneOf()
    nondet generation=1.to(2).oneOf() nondet allowed=Set(false,true).oneOf()
    any{readStorage,storageReply(id,first,second),storageReadFailure(id),generationChanges,cookieChanges(actor),
      confirmed(1),confirmed(2),confirmed(3),edit(0,first),edit(1,second),beginVerify,identityReply,
      authorityReply(allowed,generation),persistFirst,persistSecond,storageFailure,
      verifyPreflight(allowed,generation),verificationReply(true),verificationReply(false),
      leaveFallback,closePrivateParent,s'=s}}
  val invariant=all{s.readActors.length()<=2,s.readActors.length()==s.readGenerations.length(),
    s.values.length()==2,s.stored.length()==2,s.checkRows.length()==2,
    s.postStarted implies s.postAuthorized,
    s.verified implies(s.postStarted and s.recorded),
    s.checkHashes.length()<=2,
    not(s.mounted) implies not(canVerify)}
  run staleStorageReplyDoesNotReplaceNewGenerationTest=init.then(readStorage).then(generationChanges).then(readStorage)
    .then(storageReply(2,2,0)).then(storageReply(1,1,0)).expect(s.rowGeneration==2 and s.values==List(2,0))
  run generationRefreshRetainsOldRowsUntilReplyTest=init.then(readStorage).then(storageReply(1,1,0)).then(generationChanges)
    .expect(s.rowGeneration==1 and s.generation==2 and s.values==List(1,0))
  run rawSessionMismatchStopsBeforeCandidateWritesTest=init.then(readStorage).then(storageReply(1,1,0))
    .then(beginVerify).then(cookieChanges(2)).then(identityReply)
    .expect(s.error and s.stored==List(1,0) and not(s.postStarted))
  run parentActorCheckRefusesNewCookieActorTest=init.then(cookieChanges(2)).then(readStorage).then(storageReply(1,2,0))
    .then(beginVerify).then(identityReply).then(authorityReply(true,1))
    .expect(s.error and not(s.postStarted))
  run generationChangeBetweenPreflightsRefusesPostTest=init.then(readStorage).then(storageReply(1,1,0))
    .then(beginVerify).then(identityReply).then(authorityReply(true,1)).then(persistFirst).then(persistSecond)
    .then(verifyPreflight(true,2)).expect(s.error and not(s.postStarted))
  run partialCandidateWriteDoesNotPostTest=init.then(readStorage).then(storageReply(1,1,1)).then(edit(0,2)).then(edit(1,3))
    .then(beginVerify).then(identityReply).then(authorityReply(true,1)).then(persistFirst).then(storageFailure)
    .expect(s.stored==List(2,1) and s.error and not(s.postStarted))
  run editDuringRequestDoesNotChangeCapturedHashesTest=init.then(readStorage).then(storageReply(1,1,0))
    .then(beginVerify).then(edit(0,2)).then(identityReply).then(authorityReply(true,1)).then(persistFirst).then(persistSecond)
    .expect(s.values==List(2,0) and s.checkHashes==List(1) and s.stored==List(1,0))
  run confirmedIdentifiersAreNotResubmittedTest=init.then(readStorage).then(storageReply(1,1,2)).then(confirmed(1))
    .then(beginVerify).expect(s.checkHashes==List(2))
  run fallbackDepartureMayFinishSameActorVerificationTest=init.then(readStorage).then(storageReply(1,2,0))
    .then(beginVerify).then(identityReply).then(authorityReply(true,1)).then(leaveFallback)
    .then(persistFirst).then(persistSecond).then(verifyPreflight(true,1)).then(verificationReply(true))
    .expect(s.verified and not(s.mounted))
  run parentDepartureStopsFinalPreflightTest=init.then(readStorage).then(storageReply(1,2,0))
    .then(beginVerify).then(identityReply).then(authorityReply(true,1)).then(persistFirst).then(persistSecond)
    .then(closePrivateParent).then(verifyPreflight(true,1)).expect(s.error and not(s.postStarted))
  run parentDepartureAfterPostDoesNotDeliverSuccessTest=init.then(readStorage).then(storageReply(1,2,0))
    .then(beginVerify).then(identityReply).then(authorityReply(true,1)).then(persistFirst).then(persistSecond)
    .then(verifyPreflight(true,1)).then(closePrivateParent).then(verificationReply(true))
    .expect(s.recorded and not(s.verified) and s.error)
  run failedReloadRetainsExistingRowsTest=init.then(readStorage).then(storageReply(1,1,0))
    .then(generationChanges).then(readStorage).then(storageReadFailure(2))
    .expect(s.rowGeneration==1 and s.values==List(1,0) and s.error)
}
