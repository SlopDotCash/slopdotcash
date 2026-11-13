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
// This row/projection model serializes one action. ui_submitted_payment_lifetime
// separately explores simultaneous retired/current tokens and nested awaits.
module ui_submitted_payment_recovery {
  type State = {parentAlive:bool,mounted:bool,boundActor:int,cookieActor:int,generation:int,
    loadScheduled:bool,activeRead:int,readActors:List[int],readGenerations:List[int],pendingReads:Set[int],
    rowActor:int,rowGeneration:int,values:List[int],store:List[List[int]],confirmed:Set[int],
    busy:bool,phase:str,checkActor:int,checkGeneration:int,checkRowActor:int,checkRowGeneration:int,checkSlot:int,checkRows:List[int],checkHashes:List[int],
    error:bool,postStarted:bool,postAuthorized:bool,recorded:bool,responseDelivered:bool,checks:int}
  var s: State
  action init=s'={parentAlive:true,mounted:true,boundActor:1,cookieActor:1,generation:1,
    loadScheduled:true,activeRead:0,readActors:List(),readGenerations:List(),pendingReads:Set(),
    rowActor:0,rowGeneration:0,values:List(0,0),store:List(List(0,0),List(0,0),List(0,0),List(0,0)),confirmed:Set(),
    busy:false,phase:"idle",checkActor:0,checkGeneration:0,checkRowActor:0,checkRowGeneration:0,checkSlot:0,checkRows:List(0,0),checkHashes:List(),
    error:false,postStarted:false,postAuthorized:false,recorded:false,responseDelivered:false,checks:0}
  // Each slot is one captured actor/generation group, with two stable row
  // keys. Initial storage contents are admitted by its first successful read.
  def slot(actor:int,generation:int):int=(actor-1)*2+generation-1
  // The default finite relation projects this write-only display flag.
  // Concrete scenarios retain it; ownership/generation guards are unchanged.
  def reportError(state:State,project:bool,value:bool):State=state.with("error",value and not(project))
  val rowStored=if(s.rowActor>0)s.store[slot(s.rowActor,s.rowGeneration)] else List(0,0)
  val visibleHashes=s.values.select(value=>value>0 and not(s.confirmed.contains(value)))
  val canVerify=s.mounted and s.phase=="idle" and not(s.busy) and visibleHashes.length()>0
  val currentCheck=s.mounted and s.checkGeneration==s.generation
  // Async captures live only until that invocation returns. Clearing them
  // preserves behavior without retaining obsolete callback history.
  def finishedCheck(state:State):State=state.with("phase","idle").with("busy",false)
    .with("checkActor",0).with("checkGeneration",0).with("checkRowActor",0)
    .with("checkRowGeneration",0).with("checkSlot",0)
    .with("checkRows",List(0,0)).with("checkHashes",List())
  // Finished read IDs cannot be reused; retain only their counter positions.
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
        .with("values",List(first,second))
        .with("store",s.store.replaceAt(slot(s.readActors[id-1],s.readGenerations[id-1]),
          if(project)List(0,0) else List(first,second)))
      else s,id)}
  action storageReply(id:int,first:int,second:int):bool=storageReplyWithProjection(id,first,second,false)
  // Layout replacement clears old rows before the new context's read.
  action storageReadFailureWithProjection(id:int,project:bool):bool=all{s.pendingReads.contains(id),
    s'=finishedRead(if(s.mounted and id==s.activeRead)
      reportError(s.with("activeRead",0),project,true)
      else s,id)}
  action storageReadFailure(id:int):bool=storageReadFailureWithProjection(id,false)
  action generationChanges=all{s.generation==1,s.mounted,
    s'=s.with("generation",2).with("loadScheduled",true).with("activeRead",0)
      .with("rowActor",0).with("rowGeneration",0).with("values",List(0,0)).with("error",false)}
  action cookieChanges(actor:int):bool=all{actor>=0,actor<=2,s'=s.with("cookieActor",actor)}
  action confirmed(value:int):bool=all{value>0,value<=3,
    s'=s.with("confirmed",s.confirmed.union(Set(value)))}
  // Inputs stay editable while the async action runs. Its closure retains
  // the rows and visible hashes from the render that started the action.
  action edit(index:int,value:int):bool=all{s.mounted,s.rowActor>0,index>=0,index<2,
    s'=s.with("values",s.values.replaceAt(index,value))}
  action beginVerify=all{canVerify,s.rowActor>0,
    s'=s.with("busy",true).with("phase","identity").with("error",false)
      .with("checks",s.checks+1)
      .with("checkActor",s.rowActor).with("checkGeneration",s.generation)
      .with("checkRowActor",s.rowActor).with("checkRowGeneration",s.rowGeneration)
      .with("checkSlot",slot(s.rowActor,s.rowGeneration)).with("checkRows",s.values).with("checkHashes",visibleHashes)}
  action boundedBeginVerify=all{s.checks<2,beginVerify}
  action identityReplyWithProjection(project:bool):bool=all{s.phase=="identity",
    s'=if(not(currentCheck))finishedCheck(s)
      else if(s.checkActor>0 and s.checkActor==s.cookieActor)
      s.with("phase","authorize")
      else reportError(finishedCheck(s),project,true)}
  action identityReply=identityReplyWithProjection(false)
  action authorityReplyWithProjection(allowed:bool,serverGeneration:int,project:bool):bool=all{s.phase=="authorize",
    s'=if(not(currentCheck))finishedCheck(s)
      else if(s.parentAlive and s.cookieActor==s.boundActor and allowed and serverGeneration==s.checkGeneration)
      s.with("phase","persist")
      else reportError(finishedCheck(s),project,true)}
  action authorityReply(allowed:bool,serverGeneration:int):bool=authorityReplyWithProjection(allowed,serverGeneration,false)
  // The actual storage loop has no await. Represent it as one action, while
  // retaining a failure before any write or after its first valid row write.
  def writtenRows(writes:int):List[int]=List(
    if(writes>=1 and s.checkRows[0]>0)s.checkRows[0] else s.store[s.checkSlot][0],
    if(writes==2 and s.checkRows[1]>0)s.checkRows[1] else s.store[s.checkSlot][1])
  action persistCandidatesWithProjection(writes:int,project:bool):bool=all{s.phase=="persist",writes>=0,writes<=2,
    val stored=s.with("store",s.store.replaceAt(s.checkSlot,
      if(project)List(0,0) else writtenRows(writes)))
    s'=if(not(currentCheck))finishedCheck(s)
      else if(writes==2)stored.with("phase","verify-preflight")
      else reportError(finishedCheck(stored),project,true)}
  action persistCandidates(writes:int):bool=persistCandidatesWithProjection(writes,false)
  // verifyExistingPayment performs another actor-bound fresh GET before POST.
  action verifyPreflightWithProjection(allowed:bool,serverGeneration:int,project:bool):bool=all{s.phase=="verify-preflight",
    s'=if(not(currentCheck))finishedCheck(s)
      else if(s.parentAlive and s.cookieActor==s.boundActor and allowed and serverGeneration==s.checkGeneration)
      s.with("phase","post").with("postStarted",true).with("postAuthorized",true)
      else reportError(finishedCheck(s),project,true)}
  action verifyPreflight(allowed:bool,serverGeneration:int):bool=verifyPreflightWithProjection(allowed,serverGeneration,false)
  action verificationReplyWithProjection(exactReceipt:bool,project:bool):bool=all{s.phase=="post",
    s'=reportError(finishedCheck(s)
      .with("recorded",s.recorded or exactReceipt)
      .with("responseDelivered",currentCheck and exactReceipt and s.parentAlive and s.cookieActor==s.boundActor),
      project,currentCheck and not(exactReceipt and s.parentAlive and s.cookieActor==s.boundActor))}
  action verificationReply(exactReceipt:bool):bool=verificationReplyWithProjection(exactReceipt,false)
  // A retired child may retain an already-dispatched backend effect, but it
  // cannot start candidate writes or a new verification request.
  action leaveFallback=s'=s.with("mounted",false).with("activeRead",0)
  action closePrivateParent=s'=s.with("parentAlive",false).with("mounted",false).with("activeRead",0)
  action chooseStorageReply(maxHash:int,project:bool):bool={nondet id=1.to(2).oneOf() nondet first=0.to(maxHash).oneOf()
    nondet second=0.to(maxHash).oneOf() storageReplyWithProjection(id,first,second,project)}
  action chooseStorageFailure(project:bool):bool={nondet id=1.to(2).oneOf() storageReadFailureWithProjection(id,project)}
  action chooseCookie={nondet actor=0.to(2).oneOf() cookieChanges(actor)}
  action chooseEdit(maxHash:int):bool={nondet index=0.to(1).oneOf() nondet value=0.to(maxHash).oneOf() edit(index,value)}
  action chooseAuthorityReply(project:bool):bool={nondet generation=1.to(2).oneOf() nondet allowed=Set(false,true).oneOf()
    authorityReplyWithProjection(allowed,generation,project)}
  action choosePreflight(project:bool):bool={nondet generation=1.to(2).oneOf() nondet allowed=Set(false,true).oneOf()
    verifyPreflightWithProjection(allowed,generation,project)}
  action choosePersistence(project:bool):bool={nondet writes=0.to(2).oneOf() persistCandidatesWithProjection(writes,project)}
  // Factor independent choices so parameter-free actions are explored once.
  action commonSteps(maxHash:int,project:bool):bool=any{readStorage,chooseStorageReply(maxHash,project),chooseStorageFailure(project),generationChanges,chooseCookie,
    confirmed(1),confirmed(2),all{maxHash==3,confirmed(3)},chooseEdit(maxHash),identityReplyWithProjection(project),
    chooseAuthorityReply(project),choosePersistence(project),choosePreflight(project),
    verificationReplyWithProjection(true,project),verificationReplyWithProjection(false,project),
    leaveFallback,closePrivateParent,s'=s}
  action concreteStep=any{commonSteps(2,false),boundedBeginVerify}
  // The finite invariant check quotients exact stored cell values and the
  // write-only error flag; concrete relations retain both.
  // Those values feed their own writes, never a guard or another field.
  // Actor/generation slot identity and captured write targets are retained;
  // named scenarios and both concrete relations retain actual cell values.
  // Every writer applies this quotient without TLC action composition.
  action step=any{commonSteps(2,true),boundedBeginVerify}
  action unboundedStep=any{commonSteps(3,false),beginVerify}
  val invariant=all{s.readActors.length()<=2,s.readActors.length()==s.readGenerations.length(),
    s.values.length()==2,s.store.length()==4,s.checkRows.length()==2,
    s.checkSlot>=0,s.checkSlot<4,
    s.phase!="idle" implies(s.checkActor==s.checkRowActor and s.checkActor>0
      and s.checkSlot==slot(s.checkRowActor,s.checkRowGeneration)),
    s.postStarted implies s.postAuthorized,
    s.responseDelivered implies(s.postStarted and s.recorded),
    s.checkHashes.length()<=2,s.checks>=0,
    not(s.mounted) implies not(canVerify)}
  run staleStorageReplyDoesNotReplaceNewGenerationTest=init.then(readStorage).then(generationChanges).then(readStorage)
    .then(storageReply(2,2,0)).then(storageReply(1,1,0)).expect(s.rowGeneration==2 and s.values==List(2,0))
  run generationRefreshClearsOldRowsBeforeReplyTest=init.then(readStorage).then(storageReply(1,1,0)).then(generationChanges)
    .expect(s.rowGeneration==0 and s.generation==2 and s.values==List(0,0))
  run rawSessionMismatchStopsBeforeCandidateWritesTest=init.then(readStorage).then(storageReply(1,1,0))
    .then(beginVerify).then(cookieChanges(2)).then(identityReply)
    .expect(s.error and rowStored==List(1,0) and not(s.postStarted))
  run parentActorCheckRefusesNewCookieActorTest=init.then(cookieChanges(2)).then(readStorage).then(storageReply(1,2,0))
    .then(beginVerify).then(identityReply).then(authorityReply(true,1))
    .expect(s.error and not(s.postStarted))
  run generationChangeBetweenPreflightsRefusesPostTest=init.then(readStorage).then(storageReply(1,1,0))
    .then(beginVerify).then(identityReply).then(authorityReply(true,1)).then(persistCandidates(2))
    .then(verifyPreflight(true,2)).expect(s.error and not(s.postStarted))
  run partialCandidateWriteDoesNotPostTest=init.then(readStorage).then(storageReply(1,1,1)).then(edit(0,2)).then(edit(1,3))
    .then(beginVerify).then(identityReply).then(authorityReply(true,1)).then(persistCandidates(1))
    .expect(rowStored==List(2,1) and s.error and not(s.postStarted))
  run editDuringRequestDoesNotChangeCapturedHashesTest=init.then(readStorage).then(storageReply(1,1,0))
    .then(beginVerify).then(edit(0,2)).then(identityReply).then(authorityReply(true,1)).then(persistCandidates(2))
    .expect(s.values==List(2,0) and s.checkHashes==List(1) and rowStored==List(1,0))
  run confirmedIdentifiersAreNotResubmittedTest=init.then(readStorage).then(storageReply(1,1,2)).then(confirmed(1))
    .then(beginVerify).expect(s.checkHashes==List(2))
  run fallbackDeparturePreventsCandidateWritesTest=init.then(readStorage).then(storageReply(1,2,0))
    .then(beginVerify).then(identityReply).then(authorityReply(true,1)).then(leaveFallback)
    .then(persistCandidates(2)).expect(not(s.postStarted) and not(s.mounted) and s.store[0]==List(2,0))
  run parentDepartureStopsFinalPreflightTest=init.then(readStorage).then(storageReply(1,2,0))
    .then(beginVerify).then(identityReply).then(authorityReply(true,1)).then(persistCandidates(2))
    .then(closePrivateParent).then(verifyPreflight(true,1)).expect(not(s.postStarted))
  run parentDepartureAfterPostDoesNotDeliverSuccessTest=init.then(readStorage).then(storageReply(1,2,0))
    .then(beginVerify).then(identityReply).then(authorityReply(true,1)).then(persistCandidates(2))
    .then(verifyPreflight(true,1)).then(closePrivateParent).then(verificationReply(true))
    .expect(s.recorded and not(s.responseDelivered))
  run failedNewGenerationReadCannotRestoreOldRowsTest=init.then(readStorage).then(storageReply(1,1,0))
    .then(generationChanges).then(readStorage).then(storageReadFailure(2))
    .expect(s.rowGeneration==0 and s.values==List(0,0) and s.error)
  run oldActionCannotWriteAfterNewGenerationReadTest=init.then(readStorage).then(storageReply(1,1,0))
    .then(edit(0,2)).then(beginVerify).then(identityReply).then(generationChanges).then(readStorage)
    .then(storageReply(2,3,0)).then(authorityReply(true,1))
    .expect(s.rowGeneration==2 and s.values==List(3,0) and s.store[0]==List(1,0)
      and s.store[1]==List(3,0) and not(s.postStarted))
  run editsDuringVerificationKeepCapturedPostBodyTest=init.then(readStorage).then(storageReply(1,1,0))
    .then(beginVerify).then(identityReply).then(authorityReply(true,1)).then(persistCandidates(2))
    .then(verifyPreflight(true,1)).then(edit(0,2))
    .expect(s.values==List(2,0) and s.checkHashes==List(1) and s.store[0]==List(1,0))
    .then(verificationReply(true)).expect(s.responseDelivered and s.checkHashes==List() and s.checkActor==0)
  run deliveredResponseDoesNotKeepPrivateViewAuthorizedTest=init.then(readStorage).then(storageReply(1,2,0))
    .then(beginVerify).then(identityReply).then(authorityReply(true,1)).then(persistCandidates(2))
    .then(verifyPreflight(true,1)).then(verificationReply(true)).then(closePrivateParent)
    .expect(s.responseDelivered and s.recorded and not(s.mounted) and not(canVerify))
  run failedAuthorizationCanRetryTest=init.then(readStorage).then(storageReply(1,1,0))
    .then(boundedBeginVerify).then(identityReply).then(authorityReply(false,1))
    .expect(s.checkActor==0 and s.checkHashes==List())
    .then(edit(0,2)).then(boundedBeginVerify).then(identityReply).then(authorityReply(true,1))
    .then(persistCandidates(2)).then(verifyPreflight(true,1)).then(verificationReply(true))
    .expect(s.checks==2 and s.responseDelivered and s.store[0]==List(2,0))
  run partialFailureKeepsCapturedGenerationSlotTest=init.then(readStorage).then(storageReply(1,1,0))
    .then(generationChanges).then(readStorage).then(storageReply(2,2,2)).then(edit(0,3))
    .then(beginVerify).then(identityReply).then(authorityReply(true,2)).then(persistCandidates(1))
    .expect(s.phase=="idle" and s.checkSlot==0 and s.error and not(s.postStarted)
      and s.store[0]==List(1,0) and s.store[1]==List(3,2))
}
