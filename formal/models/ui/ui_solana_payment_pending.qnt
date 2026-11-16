// @source src/SolanaBountyPayment.tsx
// @source src/lib/pending-attempt.ts
// @source src/SecurityBounty.tsx
// @evidence tests/e2e/bounty-solana-flow.spec.ts
// Two same-tab component instances, two actor/message-scoped slots, one wallet
// prompt, one replacement, one reload and one site-data clear. Signature 1 is
// the wallet result; 2/3 are other valid evidence; 4 is invalid editor input.
// Draft -1 is unset; explicit empty draft 0 never falls back to a stored hash.
// Attempt 3 is an exact-match legacy record. A signature is not finality.
// Source-authored only: no parser, scenario, simulation or TLC was run.
// Finite reductions in `step` only (direct actions are unchanged):
// - `warnings` is write-only: no guard, invariant clause or other field reads
//   it. `step` passes track=false, which leaves it empty; named scenarios use
//   the tracking actions and still assert the exact warning set.
// - Draft 4 and draft 0 are indistinguishable. `draft` is read only by
//   `selected`; both values are >= 0 (no stored fallback) and both fail
//   `validSignature`, so `beginCheck` refuses either and never captures it.
//   `step` edits only 0..3; `invalidDraftMatchesExplicitEmptyTest` checks the
//   equivalence directly.
module ui_solana_payment_pending {
  type Record = {attempt:int,signature:int,candidate:int}
  type State = {alive:Set[int],keys:List[int],slots:List[Record],local:List[Record],ack:List[Record],
    draft:List[int],checks:Set[int],captured:List[Record],checkSignature:List[int],verified:List[int],
    preflight:bool,prepared:int,walletOpen:bool,walletKey:int,walletIntent:Record,
    warnings:Set[int],clears:int,replacements:int,reloads:int}
  pure val empty:Record={attempt:0,signature:0,candidate:0}
  pure val intent:Record={attempt:1,signature:0,candidate:0}
  pure val legacyRecord:Record={attempt:3,signature:0,candidate:0}
  pure val otherRecord:Record={attempt:2,signature:3,candidate:2}
  def initial(mode:int):State={alive:Set(1),keys:List(1,0),
    slots:List(if(mode==0)empty else if(mode==1)intent else legacyRecord,otherRecord),
    local:List(if(mode==0)empty else if(mode==1)intent else legacyRecord,empty),
    ack:List(if(mode==0)empty else if(mode==1)intent else legacyRecord,empty),
    draft:List(-1,-1),checks:Set(),captured:List(empty,empty),checkSignature:List(0,0),verified:List(0,0),
    preflight:false,prepared:if(mode==1)1 else 0,walletOpen:mode==1,walletKey:if(mode==1)1 else 0,
    walletIntent:if(mode==1)intent else empty,warnings:Set(),clears:0,replacements:0,reloads:0}
  var s:State
  action init={nondet mode=0.to(2).oneOf() s'=initial(mode)}
  action fresh=s'=initial(0)
  action pendingWallet=s'=initial(1)
  action legacy=s'=initial(2)
  def validSignature(value:int):bool=value>=1 and value<=3
  def selected(id:int):int=if(s.draft[id-1]>=0)s.draft[id-1]
    else if(s.local[id-1].candidate>0)s.local[id-1].candidate else s.local[id-1].signature
  def warn(state:State,id:int,track:bool):State=
    if(track and s.alive.contains(id))state.with("warnings",state.warnings.union(Set(id))) else state
  def finishedWallet(state:State):State=state.with("walletOpen",false).with("walletKey",0).with("walletIntent",empty)
  def finishedCheck(state:State,id:int):State=state.with("checks",state.checks.exclude(Set(id)))
    .with("captured",state.captured.replaceAt(id-1,empty)).with("checkSignature",state.checkSignature.replaceAt(id-1,0))
  action depart(id:int):bool=all{s.alive.contains(id),s'=s.with("alive",s.alive.exclude(Set(id)))}
  action mountSecond(key:int):bool=all{not(s.alive.contains(2)),s.keys[1]==0,key>=1,key<=2,
    s'=s.with("alive",s.alive.union(Set(2))).with("keys",s.keys.replaceAt(1,key))
      .with("local",s.local.replaceAt(1,s.slots[key-1])).with("ack",s.ack.replaceAt(1,s.slots[key-1]))}
  action reloadSecond={val key=if(s.keys[1]>0)s.keys[1] else 1
    all{s.alive.contains(2),not(s.checks.contains(2)),s.reloads==0,
    s'=s.with("local",s.local.replaceAt(1,s.slots[key-1]))
      .with("ack",s.ack.replaceAt(1,s.slots[key-1])).with("draft",s.draft.replaceAt(1,-1))
      .with("reloads",1)}}
  action edit(id:int,value:int):bool=all{s.alive.contains(id),s.local[id-1].attempt>0,value>=0,value<=4,
    s'=s.with("draft",s.draft.replaceAt(id-1,value))}
  action prepare=all{s.alive.contains(1),s.local[0].attempt==0,not(s.preflight),not(s.walletOpen),s.prepared==0,
    s'=s.with("preflight",true).with("prepared",1)}
  action rejectDepartedPreflight=all{s.preflight,not(s.alive.contains(1)),s'=s.with("preflight",false)}
  // beforeSend is a final mounted check followed by synchronous empty-slot creation.
  action beforePromptTracked(storageWorks:bool,track:bool):bool=all{s.preflight,s.alive.contains(1),
    s'=if(storageWorks and s.slots[0]==empty)
      s.with("preflight",false).with("walletOpen",true).with("walletKey",1).with("walletIntent",intent)
        .with("slots",s.slots.replaceAt(0,intent)).with("local",s.local.replaceAt(0,intent)).with("ack",s.ack.replaceAt(0,intent))
      else warn(s.with("preflight",false),1,track)}
  action beforePrompt(storageWorks:bool):bool=beforePromptTracked(storageWorks,true)
  // A wallet tail rereads its own slot and merges the signature with the latest
  // candidate. A different recorded signature is never silently replaced.
  action walletReturnsTracked(storageWorks:bool,track:bool):bool={
    val key=if(s.walletKey>0)s.walletKey else 1
    val current=s.slots[key-1]
    val owns=current.attempt==s.walletIntent.attempt and (current.signature==0 or current.signature==1)
    val updated=current.with("signature",1)
    all{s.walletOpen,
    s'=if(not(owns))finishedWallet(warn(s,1,track))
      else if(not(storageWorks))finishedWallet(warn(s,1,track)
        .with("local",if(s.alive.contains(1))s.local.replaceAt(0,s.walletIntent.with("signature",1)) else s.local))
      else finishedWallet(s.with("slots",s.slots.replaceAt(s.walletKey-1,updated))
        .with("ack",s.ack.replaceAt(0,updated)).with("local",if(s.alive.contains(1))s.local.replaceAt(0,updated) else s.local))}}
  action walletReturns(storageWorks:bool):bool=walletReturnsTracked(storageWorks,true)
  action walletDeclinesTracked(storageWorks:bool,track:bool):bool={val key=if(s.walletKey>0)s.walletKey else 1
    all{s.walletOpen,
    s'=if(storageWorks and s.slots[key-1]==s.walletIntent)
      finishedWallet(s.with("slots",s.slots.replaceAt(key-1,empty)).with("ack",s.ack.replaceAt(0,empty))
        .with("local",if(s.alive.contains(1))s.local.replaceAt(0,empty) else s.local))
      else finishedWallet(warn(s,1,track))}}
  action walletDeclines(storageWorks:bool):bool=walletDeclinesTracked(storageWorks,true)
  action beginCheck(id:int):bool=all{s.alive.contains(id),not(id==1 and s.walletOpen),not(s.checks.contains(id)),
    s.local[id-1].attempt>0,s.ack[id-1].attempt>0,validSignature(selected(id)),
    s'=s.with("checks",s.checks.union(Set(id))).with("captured",s.captured.replaceAt(id-1,s.ack[id-1]))
      .with("checkSignature",s.checkSignature.replaceAt(id-1,selected(id)))}
  // guard(true) is awaited before this point. The exact acknowledged snapshot
  // must still match; a failed H write leaves ack as the earlier no-H record.
  action finishCheckTracked(id:int,authorized:bool,storageWorks:bool,track:bool):bool={
    val key=if(s.keys[id-1]>0)s.keys[id-1] else 1
    val accepted=s.alive.contains(id) and authorized and storageWorks and s.slots[key-1]==s.captured[id-1]
    val updated=s.local[id-1].with("candidate",s.checkSignature[id-1])
    all{s.checks.contains(id),
    s'=if(accepted)finishedCheck(s.with("slots",s.slots.replaceAt(key-1,updated))
      .with("ack",s.ack.replaceAt(id-1,updated)).with("local",s.local.replaceAt(id-1,updated))
      .with("verified",s.verified.replaceAt(id-1,s.checkSignature[id-1])),id)
      else finishedCheck(warn(s,id,track),id)}}
  action finishCheck(id:int,authorized:bool,storageWorks:bool):bool=finishCheckTracked(id,authorized,storageWorks,true)
  // Explicit browser site-data removal and a new live document's later request
  // are environmental boundaries, not an added reset control in this component.
  action clearSiteData=all{s.clears==0,s'=s.with("slots",s.slots.replaceAt(0,empty)).with("clears",1)}
  action newDocumentRequest=all{s.slots[0]==empty,s.clears==1,s.replacements==0,
    s'=s.with("slots",s.slots.replaceAt(0,otherRecord)).with("replacements",1)}
  action chooseEdit={nondet id=1.to(2).oneOf() nondet value=0.to(3).oneOf() edit(id,value)}
  action chooseCheck={nondet id=1.to(2).oneOf() beginCheck(id)}
  // The two flags affect State only through their conjunction.
  action chooseFinish={nondet id=1.to(2).oneOf()
    any{finishCheckTracked(id,true,true,false),finishCheckTracked(id,false,false,false)}}
  action step=any{depart(1),depart(2),mountSecond(1),mountSecond(2),reloadSecond,chooseEdit,prepare,
    rejectDepartedPreflight,beforePromptTracked(true,false),beforePromptTracked(false,false),
    walletReturnsTracked(true,false),walletReturnsTracked(false,false),
    walletDeclinesTracked(true,false),walletDeclinesTracked(false,false),chooseCheck,chooseFinish,clearSiteData,newDocumentRequest,s'=s}
  val invariant=all{s.prepared<=1,s.clears<=1,s.replacements<=1,s.reloads<=1,
    s.slots.length()==2,s.local.length()==2,s.ack.length()==2,
    Set(0,1).forall(i=>s.slots[i].attempt>=0 and s.slots[i].attempt<=3 and s.slots[i].signature>=0 and s.slots[i].signature<=3 and s.slots[i].candidate>=0 and s.slots[i].candidate<=3),
    Set(0,1).forall(i=>s.slots[i].attempt==0 implies s.slots[i]==empty),
    s.walletOpen implies(s.walletIntent==intent and s.walletKey==1),
    Set(0,1).forall(i=>s.verified[i]>=0 and s.verified[i]<=3),
    s.slots[1].attempt==2,s.slots[1].signature==3}
  run staleCandidateCannotEraseReturnedSignatureTest=pendingWallet.then(depart(1)).then(mountSecond(1))
    .then(edit(2,2)).then(beginCheck(2)).then(walletReturns(true)).then(finishCheck(2,true,true))
    .expect(s.slots[0].signature==1 and s.slots[0].candidate==0 and s.verified[1]==0 and s.warnings.contains(2))
  run earlierCandidateSurvivesWalletTailMergeTest=pendingWallet.then(depart(1)).then(mountSecond(1))
    .then(edit(2,2)).then(beginCheck(2)).then(finishCheck(2,true,true)).then(walletReturns(true))
    .expect(s.slots[0].signature==1 and s.slots[0].candidate==2)
  run reloadFindsReturnedSignatureAfterConflictTest=pendingWallet.then(depart(1)).then(mountSecond(1))
    .then(edit(2,2)).then(beginCheck(2)).then(walletReturns(true)).then(finishCheck(2,true,true)).then(reloadSecond)
    .expect(s.local[1].signature==1 and s.ack[1]==s.slots[0])
  run failedSignatureSaveUsesAcknowledgedSnapshotTest=pendingWallet.then(walletReturns(false))
    .expect(s.local[0].signature==1 and s.ack[0].signature==0 and s.slots[0].signature==0)
    .then(beginCheck(1)).then(finishCheck(1,true,true)).expect(s.verified[0]==1 and s.slots[0].signature==1)
  run failedCandidateSaveDoesNotVerifyTest=legacy.then(edit(1,2)).then(beginCheck(1)).then(finishCheck(1,true,false))
    .expect(s.slots[0]==legacyRecord and s.verified[0]==0)
  run legacyExactSnapshotStillVerifiesTest=legacy.then(edit(1,2)).then(beginCheck(1)).then(finishCheck(1,true,true))
    .expect(s.slots[0].attempt==3 and s.slots[0].candidate==2 and s.verified[0]==2)
  run departedPreflightCannotOpenPromptTest=fresh.then(prepare).then(depart(1)).then(beforePrompt(true).fail())
  run departedPreflightSettlesWithoutPromptTest=fresh.then(prepare).then(depart(1))
    .then(rejectDepartedPreflight).expect(not(s.walletOpen) and s.slots[0]==empty)
  run occupiedSlotPreventsPromptTest=fresh.then(prepare).then(clearSiteData).then(newDocumentRequest).then(beforePrompt(true))
    .expect(not(s.walletOpen) and s.slots[0]==otherRecord)
  run failedCreationPreventsPromptTest=fresh.then(prepare).then(beforePrompt(false))
    .expect(not(s.walletOpen) and s.slots[0]==empty)
  run departedWalletCanSaveOwnSignatureTest=pendingWallet.then(depart(1)).then(walletReturns(true))
    .expect(s.slots[0].signature==1 and s.local[0].signature==0)
  run clearedSlotIsNotRecreatedTest=pendingWallet.then(clearSiteData).then(walletReturns(true)).expect(s.slots[0]==empty)
  run replacementIsNotOverwrittenTest=pendingWallet.then(clearSiteData).then(newDocumentRequest).then(walletReturns(true))
    .expect(s.slots[0]==otherRecord)
  run declineCannotClearNewerCandidateTest=pendingWallet.then(depart(1)).then(mountSecond(1)).then(edit(2,2))
    .then(beginCheck(2)).then(finishCheck(2,true,true)).then(walletDeclines(true))
    .expect(s.slots[0].candidate==2)
  run departedCheckCannotPersistOrVerifyTest=pendingWallet.then(depart(1)).then(mountSecond(1)).then(edit(2,2))
    .then(beginCheck(2)).then(depart(2)).then(finishCheck(2,true,true)).expect(s.slots[0]==intent and s.verified[1]==0)
  run actorOrPlanRefusalCannotPersistTest=legacy.then(edit(1,2)).then(beginCheck(1)).then(finishCheck(1,false,true))
    .expect(s.slots[0]==legacyRecord and s.verified[0]==0)
  run anotherActorMessageSlotIsIsolatedTest=pendingWallet.then(mountSecond(2)).then(edit(2,2)).then(beginCheck(2))
    .then(walletReturns(true)).then(finishCheck(2,true,true)).expect(s.slots[0].signature==1 and s.slots[1]==otherRecord)
  run invalidEditorInputDoesNotStartVerificationTest=legacy.then(edit(1,4)).then(beginCheck(1).fail())
  // Draft 4 and explicit empty 0 leave every other field equal, are both
  // refused by beginCheck, and are both replaced by the same later edit.
  run invalidDraftMatchesExplicitEmptyTest=pendingWallet.then(walletReturns(true)).then(edit(1,4))
    .expect(selected(1)==4 and not(validSignature(selected(1))) and s.local[0].signature==1)
    .then(beginCheck(1).fail())
  run invalidDraftIsReplacedLikeExplicitEmptyTest=pendingWallet.then(walletReturns(true)).then(edit(1,4))
    .then(edit(1,2)).then(beginCheck(1)).expect(s.checkSignature[0]==2)
  run explicitEmptyIsReplacedLikeInvalidDraftTest=pendingWallet.then(walletReturns(true)).then(edit(1,0))
    .expect(selected(1)==0 and not(validSignature(selected(1))) and s.local[0].signature==1)
    .then(edit(1,2)).then(beginCheck(1)).expect(s.checkSignature[0]==2)
  run untrackedWarningsLeaveOtherFieldsTest=pendingWallet.then(depart(1)).then(mountSecond(1))
    .then(edit(2,2)).then(beginCheck(2)).then(walletReturnsTracked(true,false)).then(finishCheckTracked(2,true,true,false))
    .expect(s.warnings==Set() and s.slots[0].signature==1 and s.slots[0].candidate==0 and s.verified[1]==0)
  run explicitEmptyDoesNotReuseWalletSignatureTest=pendingWallet.then(walletReturns(true))
    .then(edit(1,0)).then(beginCheck(1).fail())
}
