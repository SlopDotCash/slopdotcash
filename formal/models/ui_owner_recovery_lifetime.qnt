// @source src/OwnerCommitment.tsx
// @source src/OwnerReserveRelease.tsx
// @source src/lib/pending-attempt.ts
// Two component instances share one same-tab slot. Attempt 1 may be legacy;
// retry 2 always has a fresh ID. One check per instance, one wallet tail per
// attempt. Outcomes: 1 pending, 2 finalized failure, 3 finalized success.
// Exact chain evidence, UUID uniqueness and React unmount delivery are
// external predicates. Authored by source inspection; not executed.
module ui_owner_recovery_lifetime {
  type S = {kind:str,legacy:bool,alive:Set[int],locals:List[int],localHash:List[bool],checks:Set[int],
    captured:List[int],capturedHash:List[bool],outcomes:List[int],store:int,hashFor:int,retried:bool,
    walletOpen:Set[int],walletOwner:List[int],ignored:Set[int],warnings:Set[int],cleared:Set[int]}
  def initial(kind:str,legacy:bool):S = {kind:kind,legacy:legacy,alive:Set(1),
    locals:List(1,0),localHash:List(false,false),checks:Set(),captured:List(0,0),capturedHash:List(false,false),outcomes:List(0,0),
    store:1,hashFor:0,retried:false,walletOpen:if(legacy)Set() else Set(1),walletOwner:List(1,0),ignored:Set(),warnings:Set(),cleared:Set()}
  var s:S
  action init={nondet kind=Set("commitment","release").oneOf()
    nondet legacy=Set(false,true).oneOf() s'=initial(kind,legacy)}
  action commitment=s'=initial("commitment",false)
  action legacyRelease=s'=initial("release",true)
  action mountSecond=all{not(s.alive.contains(2)),s.locals[1]==0,
    s'=s.with("alive",s.alive.union(Set(2))).with("locals",s.locals.replaceAt(1,s.store))
      .with("localHash",s.localHash.replaceAt(1,s.store>0 and s.hashFor==s.store))}
  action leave(id:int):bool=all{s.alive.contains(id),s'=s.with("alive",s.alive.exclude(Set(id)))}
  action check(id:int):bool=all{s.alive.contains(id),s.locals[id-1]>0,not(s.checks.contains(id)),s.captured[id-1]==0,
    s'=s.with("checks",s.checks.union(Set(id))).with("captured",s.captured.replaceAt(id-1,s.locals[id-1]))
      .with("capturedHash",s.capturedHash.replaceAt(id-1,s.localHash[id-1]))}
  action reply(id:int,outcome:int,storageWorks:bool):bool=all{s.checks.contains(id),outcome>=1,outcome<=3,
    s'=if(not(s.alive.contains(id)))s.with("checks",s.checks.exclude(Set(id)))
    else if(outcome==1 and s.kind=="commitment")
      s.with("checks",s.checks.exclude(Set(id))).with("outcomes",s.outcomes.replaceAt(id-1,1))
    else if(s.store!=s.captured[id-1] or (s.hashFor==s.store)!=s.capturedHash[id-1] or not(storageWorks))
      s.with("checks",s.checks.exclude(Set(id))).with("outcomes",s.outcomes.replaceAt(id-1,4))
    else if(outcome==1)
      s.with("checks",s.checks.exclude(Set(id))).with("hashFor",s.store)
        .with("localHash",s.localHash.replaceAt(id-1,true)).with("outcomes",s.outcomes.replaceAt(id-1,1))
    else s.with("checks",s.checks.exclude(Set(id))).with("store",0).with("hashFor",0)
      .with("locals",s.locals.replaceAt(id-1,0)).with("localHash",s.localHash.replaceAt(id-1,false))
      .with("outcomes",s.outcomes.replaceAt(id-1,outcome))
      .with("cleared",s.cleared.union(Set(s.captured[id-1])))}
  // A start represents the already-authorized preflight reaching beforeSend.
  action retry(id:int,storageWorks:bool):bool=all{s.alive.contains(id),s.locals[id-1]==0,not(s.retried),
    s'=if(s.store==0 and storageWorks)
      s.with("store",2).with("hashFor",0).with("locals",s.locals.replaceAt(id-1,2))
        .with("localHash",s.localHash.replaceAt(id-1,false)).with("walletOwner",s.walletOwner.replaceAt(1,id))
        .with("retried",true).with("walletOpen",s.walletOpen.union(Set(2)))
    else s.with("outcomes",s.outcomes.replaceAt(id-1,4))}
  // The wallet promise can return after its view leaves. It may update the
  // still-owned slot, but cannot recreate a cleared slot or replace a retry.
  action walletReturns(attempt:int,storageWorks:bool):bool=all{s.walletOpen.contains(attempt),
    s'=if(s.store!=attempt or (attempt==1 and s.legacy and s.hashFor!=0))
      s.with("walletOpen",s.walletOpen.exclude(Set(attempt))).with("ignored",s.ignored.union(Set(attempt)))
    else if(not(storageWorks))
      s.with("walletOpen",s.walletOpen.exclude(Set(attempt))).with("warnings",s.warnings.union(Set(attempt)))
    else s.with("walletOpen",s.walletOpen.exclude(Set(attempt))).with("hashFor",attempt)
      .with("localHash",if(s.alive.contains(s.walletOwner[attempt-1]) and s.locals[s.walletOwner[attempt-1]-1]==attempt)
        s.localHash.replaceAt(s.walletOwner[attempt-1]-1,true) else s.localHash)}
  // OwnerCommitment preserves its definitive 4001 cleanup after departure,
  // but only while the exact initial no-hash record is still present.
  action walletDeclines(attempt:int,storageWorks:bool):bool=all{s.kind=="commitment",s.walletOpen.contains(attempt),
    s'=if(s.store==attempt and s.hashFor==0 and storageWorks)
      s.with("walletOpen",s.walletOpen.exclude(Set(attempt))).with("store",0)
        .with("cleared",s.cleared.union(Set(attempt)))
        .with("locals",if(s.alive.contains(s.walletOwner[attempt-1]))
          s.locals.replaceAt(s.walletOwner[attempt-1]-1,0) else s.locals)
    else s.with("walletOpen",s.walletOpen.exclude(Set(attempt)))}
  action userClears(id:int,storageWorks:bool):bool=all{s.alive.contains(id),s.locals[id-1]>0,not(s.localHash[id-1]),not(s.checks.contains(id)),
    s'=if(s.store==s.locals[id-1] and (s.hashFor==s.store)==s.localHash[id-1] and storageWorks)
      s.with("store",0).with("hashFor",0).with("locals",s.locals.replaceAt(id-1,0))
        .with("localHash",s.localHash.replaceAt(id-1,false))
        .with("cleared",s.cleared.union(Set(s.locals[id-1])))
    else s.with("outcomes",s.outcomes.replaceAt(id-1,4))}
  action step={nondet id=Set(1,2).oneOf() nondet outcome=Set(1,2,3).oneOf()
    nondet storageWorks=Set(false,true).oneOf()
    any{mountSecond,leave(id),check(id),reply(id,outcome,storageWorks),retry(id,storageWorks),
      walletReturns(id,storageWorks),walletDeclines(id,storageWorks),userClears(id,storageWorks),s'=s}}
  val invariant=all{s.store>=0,s.store<=2,s.hashFor==0 or s.hashFor==s.store,
    s.store==2 implies s.retried,s.retried implies s.cleared.contains(1),
    s.locals.length()==2,s.localHash.length()==2,s.captured.length()==2,s.capturedHash.length()==2,s.outcomes.length()==2}
  run departedFailureCannotClearRetryTest=commitment.then(check(1)).then(leave(1)).then(mountSecond)
    .then(check(2)).then(reply(2,2,true)).then(retry(2,true)).then(reply(1,2,true))
    .expect(s.store==2 and s.locals[1]==2 and s.outcomes[0]==0)
  run activeStaleFailureCannotClearOtherAttemptTest=commitment.then(check(1)).then(mountSecond)
    .then(check(2)).then(reply(2,2,true)).then(retry(2,true)).then(reply(1,2,true))
    .expect(s.store==2 and s.outcomes[0]==4)
  run legacyFailureCannotClearFreshRetryTest=legacyRelease.then(check(1)).then(mountSecond)
    .then(check(2)).then(reply(2,2,true)).then(retry(2,true)).then(reply(1,2,true))
    .expect(s.legacy and s.store==2 and s.outcomes[0]==4)
  run departedPendingCannotOverwriteRetryTest=legacyRelease.then(check(1)).then(leave(1)).then(mountSecond)
    .then(check(2)).then(reply(2,2,true)).then(retry(2,true)).then(reply(1,1,true))
    .expect(s.store==2 and s.hashFor==0)
  run walletTailRetainsStillOwnedEvidenceTest=commitment.then(leave(1)).then(walletReturns(1,true))
    .expect(s.store==1 and s.hashFor==1)
  run walletTailCannotReplaceRetryTest=commitment.then(leave(1)).then(mountSecond).then(check(2))
    .then(reply(2,2,true)).then(retry(2,true)).then(walletReturns(1,true))
    .expect(s.store==2 and s.hashFor==0 and s.ignored.contains(1))
  run walletTailCannotRecreateExplicitlyClearedSlotTest=commitment.then(userClears(1,true)).then(walletReturns(1,true))
    .expect(s.store==0 and s.ignored.contains(1))
  run failedRemovalKeepsAttemptTest=commitment.then(check(1)).then(reply(1,3,false))
    .expect(s.store==1 and s.locals[0]==1 and not(s.retried))
  run failedHashWriteKeepsUnknownAttemptTest=commitment.then(walletReturns(1,false))
    .expect(s.store==1 and s.hashFor==0 and s.warnings.contains(1))
  run changedEvidenceInSameAttemptIsNotClearedTest=commitment.then(check(1)).then(walletReturns(1,true))
    .then(reply(1,2,true)).expect(s.store==1 and s.hashFor==1 and s.outcomes[0]==4)
  run departedDeclineClearsOnlyItsOwnRecordTest=commitment.then(leave(1)).then(walletDeclines(1,true))
    .expect(s.store==0 and s.cleared.contains(1))
  run departedDeclineCannotClearRetryTest=commitment.then(leave(1)).then(mountSecond).then(check(2))
    .then(reply(2,2,true)).then(retry(2,true)).then(walletDeclines(1,true)).expect(s.store==2)
  run failedCreationDoesNotPromptRetryTest=commitment.then(check(1)).then(reply(1,2,true)).then(retry(1,false))
    .expect(s.store==0 and not(s.retried) and not(s.walletOpen.contains(2)))
}
