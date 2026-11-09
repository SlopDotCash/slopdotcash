// @source src/BountySubmittedPayments.tsx
// @source src/SecurityBounty.tsx
// @source src/lib/use-action.ts
// @evidence tests/e2e/bounty-full-flow.spec.ts
// @evidence tests/e2e/bounty-solana-flow.spec.ts
// One fallback instance, two actors/generations/rows, two storage reads.
// Finite step explores two verification attempts and valid identifiers 1..2;
// unboundedStep retains repeated attempts and all three identifier classes.
// Value 0 means empty/invalid syntax. These are model bounds, not UI limits.
// Exact chain receipt acceptance is an external predicate, never syntax.
// Current verification bounds and evidence are in the composition audit.
module ui_submitted_payment_recovery {
  type State = {parentAlive:bool,mounted:bool,boundActor:int,cookieActor:int,generation:int,
    loadScheduled:bool,activeRead:int,readActors:List[int],readGenerations:List[int],pendingReads:Set[int],
    rowActor:int,rowGeneration:int,values:List[int],stored:List[int],confirmed:Set[int],
    busy:bool,phase:str,checkActor:int,checkGeneration:int,checkRows:List[int],checkHashes:List[int],
    error:bool,postStarted:bool,postAuthorized:bool,recorded:bool,verified:bool,checks:int}
  var s: State
  action init=s'={parentAlive:true,mounted:true,boundActor:1,cookieActor:1,generation:1,
    loadScheduled:true,activeRead:0,readActors:List(),readGenerations:List(),pendingReads:Set(),
    rowActor:0,rowGeneration:0,values:List(0,0),stored:List(0,0),confirmed:Set(),
    busy:false,phase:"idle",checkActor:0,checkGeneration:0,checkRows:List(0,0),checkHashes:List(),
    error:false,postStarted:false,postAuthorized:false,recorded:false,verified:false,checks:0}
  val visibleHashes=s.values.select(value=>value>0 and not(s.confirmed.contains(value)))
  val canVerify=s.mounted and not(s.busy) and visibleHashes.length()>0
  // Captured rows/identity belong to one async call. After that call returns,
  // keeping them would add history which the implementation does not retain.
  def finishedCheck(state:State):State=state.with("phase","idle").with("busy",false)
    .with("checkActor",0).with("checkGeneration",0).with("checkRows",List(0,0)).with("checkHashes",List())
  // A completed storage read also releases its captured metadata. Keep the
  // list length as the request counter; no future action can reuse this ID.
  def finishedRead(state:State,id:int):State=state.with("pendingReads",state.pendingReads.exclude(Set(id)))
    .with("readActors",state.readActors.replaceAt(id-1,0))
    .with("readGenerations",state.readGenerations.replaceAt(id-1,0))
  action readStorage=all{s.mounted,s.loadScheduled,s.readActors.length()<2,
    s'=s.with("loadScheduled",false).with("activeRead",s.readActors.length()+1)
      .with("readActors",s.readActors.append(s.cookieActor))
      .with("readGenerations",s.readGenerations.append(s.generation))
      .with("pendingReads",s.pendingReads.union(Set(s.readActors.length()+1)))}
  action storageReplyWithProjection(id:int,first:int,second:int,project:bool):bool=all{s.pendingReads.contains(id),
    s'=finishedRead(if(s.mounted and id==s.activeRead and s.readActors[id-1]>0)
      s.with("activeRead",0)
        .with("rowActor",s.readActors[id-1]).with("rowGeneration",s.readGenerations[id-1])
        .with("values",List(first,second)).with("stored",if(project)List(0,0) else List(first,second))
      else s,id)}
  action storageReply(id:int,first:int,second:int):bool=storageReplyWithProjection(id,first,second,false)
  // The effect cancels an old read but does not clear existing rows or actor.
  action storageReadFailure(id:int):bool=all{s.pendingReads.contains(id),
    s'=finishedRead(if(s.mounted and id==s.activeRead)
      s.with("activeRead",0).with("error",true)
      else s,id)}
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
      .with("checks",s.checks+1)
      .with("checkActor",s.rowActor).with("checkGeneration",s.generation)
      .with("checkRows",s.values).with("checkHashes",visibleHashes)}
  action boundedBeginVerify=all{s.checks<2,beginVerify}
  action identityReply=all{s.phase=="identity",
    s'=if(s.checkActor>0 and s.checkActor==s.cookieActor)
      s.with("phase","authorize")
      else finishedCheck(s).with("error",true)}
  action authorityReply(allowed:bool,serverGeneration:int):bool=all{s.phase=="authorize",
    s'=if(s.parentAlive and s.cookieActor==s.boundActor and allowed and serverGeneration==s.checkGeneration)
      s.with("phase","persist-first")
      else finishedCheck(s).with("error",true)}
  action persistFirstWithProjection(project:bool):bool=all{s.phase=="persist-first",
    s'=s.with("stored",if(project)List(0,0) else s.stored.replaceAt(0,if(s.checkRows[0]>0)s.checkRows[0] else s.stored[0]))
      .with("phase","persist-second")}
  action persistSecondWithProjection(project:bool):bool=all{s.phase=="persist-second",
    s'=s.with("stored",if(project)List(0,0) else s.stored.replaceAt(1,if(s.checkRows[1]>0)s.checkRows[1] else s.stored[1]))
      .with("phase","verify-preflight")}
  action persistFirst=persistFirstWithProjection(false)
  action persistSecond=persistSecondWithProjection(false)
  action storageFailure=all{Set("persist-first","persist-second").contains(s.phase),
    s'=finishedCheck(s).with("error",true)}
  // verifyExistingPayment performs another actor-bound fresh GET before POST.
  action verifyPreflight(allowed:bool,serverGeneration:int):bool=all{s.phase=="verify-preflight",
    s'=if(s.parentAlive and s.cookieActor==s.boundActor and allowed and serverGeneration==s.checkGeneration)
      s.with("phase","post").with("postStarted",true).with("postAuthorized",true)
      else finishedCheck(s).with("error",true)}
  action verificationReply(exactReceipt:bool):bool=all{s.phase=="post",
    s'=finishedCheck(s)
      .with("recorded",s.recorded or exactReceipt)
      .with("error",not(exactReceipt and s.parentAlive and s.cookieActor==s.boundActor))
      .with("verified",exactReceipt and s.parentAlive and s.cookieActor==s.boundActor)}
  // Removing just the fallback does not cancel its already-started promise.
  // The enclosing provider, if alive, still checks the actor on API reads.
  action leaveFallback=s'=s.with("mounted",false).with("activeRead",0)
  action closePrivateParent=s'=s.with("parentAlive",false).with("mounted",false).with("activeRead",0)
  action chooseStorageReply(maxHash:int,project:bool):bool={nondet id=1.to(2).oneOf() nondet first=0.to(maxHash).oneOf()
    nondet second=0.to(maxHash).oneOf() storageReplyWithProjection(id,first,second,project)}
  action chooseStorageFailure={nondet id=1.to(2).oneOf() storageReadFailure(id)}
  action chooseCookie={nondet actor=0.to(2).oneOf() cookieChanges(actor)}
  action chooseEdit(maxHash:int):bool={nondet index=0.to(1).oneOf() nondet value=0.to(maxHash).oneOf() edit(index,value)}
  action chooseAuthorityReply={nondet generation=1.to(2).oneOf() nondet allowed=Set(false,true).oneOf()
    authorityReply(allowed,generation)}
  action choosePreflight={nondet generation=1.to(2).oneOf() nondet allowed=Set(false,true).oneOf()
    verifyPreflight(allowed,generation)}
  // Do not multiply every parameter-free transition by unrelated choices.
  action commonSteps(maxHash:int,project:bool):bool=any{readStorage,chooseStorageReply(maxHash,project),chooseStorageFailure,generationChanges,chooseCookie,
    confirmed(1),confirmed(2),all{maxHash==3,confirmed(3)},chooseEdit(maxHash),identityReply,
    chooseAuthorityReply,persistFirstWithProjection(project),persistSecondWithProjection(project),storageFailure,
    choosePreflight,verificationReply(true),verificationReply(false),
    leaveFallback,closePrivateParent,s'=s}
  action concreteStep=any{commonSteps(2,false),boundedBeginVerify}
  // Only the finite invariant check quotients exact stored cell contents.
  // They feed their own writes, never a guard or another observed field.
  // Concrete scenarios and both concrete step relations retain those values.
  // Initial cells are zero; projecting every writer keeps them zero without
  // relying on action composition, which the TLC backend does not support.
  action step=any{commonSteps(2,true),boundedBeginVerify}
  action unboundedStep=any{commonSteps(3,false),beginVerify}
  val invariant=all{s.readActors.length()<=2,s.readActors.length()==s.readGenerations.length(),
    s.values.length()==2,s.stored.length()==2,s.checkRows.length()==2,
    s.postStarted implies s.postAuthorized,
    s.verified implies(s.postStarted and s.recorded),
    s.checkHashes.length()<=2,s.checks>=0,
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
  run partialCandidateWriteDoesNotPostTest=init.then(readStorage).then(storageReply(1,1,1)).then(edit(0,2)).then(edit(1,2))
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
  run failedAuthorizationCanRetryTest=init.then(readStorage).then(storageReply(1,1,0))
    .then(boundedBeginVerify).then(identityReply).then(authorityReply(false,1))
    .then(edit(0,2)).then(boundedBeginVerify).then(identityReply).then(authorityReply(true,1))
    .then(persistFirst).then(persistSecond).then(verifyPreflight(true,1)).then(verificationReply(true))
    .expect(s.checks==2 and s.verified and s.stored==List(2,0))
}
