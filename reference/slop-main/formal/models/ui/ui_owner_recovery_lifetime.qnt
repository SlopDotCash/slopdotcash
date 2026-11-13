// @source src/OwnerCommitment.tsx
// @source src/OwnerReserveRelease.tsx
// @source src/VaultActions.tsx
// @source src/AutomaticMonthlyPayment.tsx
// @source src/lib/pending-attempt.ts
// @source src/lib/use-pending-wallet-attempt.ts
// Two component instances share one same-tab slot. Attempt 1 may be legacy;
// retry 2 always has a fresh ID. One check per instance, one wallet tail per
// attempt. Outcomes: 1 pending, 2 finalized failure, 3 finalized success,
// 4 token approval. Stored snapshots are separate from in-memory hashes.
// Exact chain evidence, UUID uniqueness and React unmount delivery are
// external predicates. Authored by source inspection; not executed.
module ui_owner_recovery_lifetime {
  type S = {kind:str,legacy:bool,alive:Set[int],locals:List[int],localHash:List[bool],storedHash:List[bool],checks:Set[int],
    captured:List[int],capturedHash:List[bool],outcomes:List[int],store:int,hashFor:int,retried:bool,
    preflights:Set[int],walletOpen:Set[int],walletOwner:List[int],ignored:Set[int],warnings:Set[int],cleared:Set[int],callbacks:int,moneyMoved:bool}
  def initial(kind:str,legacy:bool,liveTail:bool):S = {kind:kind,legacy:legacy,alive:Set(1),
    locals:List(1,0),localHash:List(false,false),storedHash:List(false,false),checks:Set(),captured:List(0,0),capturedHash:List(false,false),outcomes:List(0,0),
    store:1,hashFor:0,retried:false,preflights:Set(),walletOpen:if(liveTail)Set(1) else Set(),walletOwner:List(1,0),ignored:Set(),warnings:Set(),cleared:Set(),callbacks:0,moneyMoved:false}
  var s:S
  action init={nondet kind=Set("commitment","release","vault-approval","vault-transfer","monthly").oneOf()
    nondet legacy=Set(false,true).oneOf() nondet liveTail=Set(false,true).oneOf()
    s'=initial(kind,legacy,liveTail and not(legacy))}
  action commitment=s'=initial("commitment",false,false)
  action commitmentTail=s'=initial("commitment",false,true)
  action legacyRelease=s'=initial("release",true,false)
  action vaultApproval=s'=initial("vault-approval",false,false)
  action vaultTransfer=s'=initial("vault-transfer",false,false)
  action monthlySetting=s'=initial("monthly",false,false)
  // useAction's busy flag belongs to the instance awaiting its wallet. A
  // remounted second instance can still inspect the shared pending record.
  def walletBusy(id:int):bool=s.walletOpen.exists(attempt=>s.walletOwner[attempt-1]==id)
  action mountSecond=all{not(s.alive.contains(2)),s.locals[1]==0,
    s'=s.with("alive",s.alive.union(Set(2))).with("locals",s.locals.replaceAt(1,s.store))
      .with("localHash",s.localHash.replaceAt(1,s.store>0 and s.hashFor==s.store))
      .with("storedHash",s.storedHash.replaceAt(1,s.store>0 and s.hashFor==s.store))}
  action leave(id:int):bool=all{s.alive.contains(id),s'=s.with("alive",s.alive.exclude(Set(id)))}
  action check(id:int):bool=all{s.alive.contains(id),not(walletBusy(id)),s.locals[id-1]>0,not(s.checks.contains(id)),s.captured[id-1]==0,
    s'=s.with("checks",s.checks.union(Set(id))).with("captured",s.captured.replaceAt(id-1,s.locals[id-1]))
      .with("capturedHash",s.capturedHash.replaceAt(id-1,s.storedHash[id-1]))}
  action reply(id:int,outcome:int,storageWorks:bool):bool=all{s.checks.contains(id),outcome>=1,outcome<=4,
    outcome<3 or (outcome==4 and s.kind=="vault-approval") or (outcome==3 and s.kind!="vault-approval"),
    s'=if(not(s.alive.contains(id)))s.with("checks",s.checks.exclude(Set(id)))
    else if(outcome==1 and s.kind=="commitment")
      s.with("checks",s.checks.exclude(Set(id))).with("outcomes",s.outcomes.replaceAt(id-1,1))
    else if(s.store!=s.captured[id-1] or (s.hashFor==s.store)!=s.capturedHash[id-1] or not(storageWorks))
      s.with("checks",s.checks.exclude(Set(id))).with("outcomes",s.outcomes.replaceAt(id-1,5))
        .with("localHash",if(outcome==1 and not(storageWorks) and Set("vault-approval","vault-transfer","monthly").contains(s.kind))
          s.localHash.replaceAt(id-1,true) else s.localHash)
    else if(outcome==1)
      s.with("checks",s.checks.exclude(Set(id))).with("hashFor",s.store)
        .with("localHash",s.localHash.replaceAt(id-1,true)).with("storedHash",s.storedHash.replaceAt(id-1,true))
        .with("outcomes",s.outcomes.replaceAt(id-1,1))
    else s.with("checks",s.checks.exclude(Set(id))).with("store",0).with("hashFor",0)
      .with("locals",s.locals.replaceAt(id-1,0)).with("localHash",s.localHash.replaceAt(id-1,false))
      .with("storedHash",s.storedHash.replaceAt(id-1,false))
      .with("outcomes",s.outcomes.replaceAt(id-1,outcome))
      .with("cleared",s.cleared.union(Set(s.captured[id-1])))
      .with("callbacks",s.callbacks+(if(outcome==3 and Set("vault-transfer","monthly").contains(s.kind))1 else 0))
      .with("moneyMoved",s.moneyMoved or (outcome==3 and s.kind=="vault-transfer"))}
  // Remote review can outlive its component, but beforeSend checks the current
  // lifetime immediately before the synchronous record write and wallet call.
  action prepareRetry(id:int):bool=all{s.alive.contains(id),not(walletBusy(id)),s.locals[id-1]==0,not(s.retried),
    s'=s.with("preflights",s.preflights.union(Set(id)))}
  action rejectDepartedPreflight(id:int):bool=all{s.preflights.contains(id),not(s.alive.contains(id)),
    s'=s.with("preflights",s.preflights.exclude(Set(id)))}
  action retry(id:int,storageWorks:bool):bool=all{s.preflights.contains(id),s.alive.contains(id),not(walletBusy(id)),s.locals[id-1]==0,not(s.retried),
    s'=if(s.store==0 and storageWorks)
      s.with("store",2).with("hashFor",0).with("locals",s.locals.replaceAt(id-1,2))
        .with("localHash",s.localHash.replaceAt(id-1,false)).with("storedHash",s.storedHash.replaceAt(id-1,false))
        .with("walletOwner",s.walletOwner.replaceAt(1,id))
        .with("retried",true).with("preflights",s.preflights.exclude(Set(id))).with("walletOpen",s.walletOpen.union(Set(2)))
    else s.with("preflights",s.preflights.exclude(Set(id))).with("outcomes",s.outcomes.replaceAt(id-1,5))}
  // The wallet promise can return after its view leaves. It may update the
  // still-owned slot, but cannot recreate a cleared slot or replace a retry.
  action walletReturns(attempt:int,storageWorks:bool):bool=all{s.walletOpen.contains(attempt),
    s'=if(s.store!=attempt or (attempt==1 and s.legacy and s.hashFor!=0))
      s.with("walletOpen",s.walletOpen.exclude(Set(attempt))).with("ignored",s.ignored.union(Set(attempt)))
    else if(not(storageWorks))
      s.with("walletOpen",s.walletOpen.exclude(Set(attempt))).with("warnings",s.warnings.union(Set(attempt)))
        .with("localHash",if(s.alive.contains(s.walletOwner[attempt-1]) and s.locals[s.walletOwner[attempt-1]-1]==attempt)
          s.localHash.replaceAt(s.walletOwner[attempt-1]-1,true) else s.localHash)
    else s.with("walletOpen",s.walletOpen.exclude(Set(attempt))).with("hashFor",attempt)
      .with("storedHash",s.storedHash.replaceAt(s.walletOwner[attempt-1]-1,true))
      .with("localHash",if(s.alive.contains(s.walletOwner[attempt-1]) and s.locals[s.walletOwner[attempt-1]-1]==attempt)
        s.localHash.replaceAt(s.walletOwner[attempt-1]-1,true) else s.localHash)}
  // OwnerCommitment preserves its definitive 4001 cleanup after departure,
  // but only while the exact initial no-hash record is still present.
  action walletDeclines(attempt:int,storageWorks:bool):bool=all{s.kind!="release",s.walletOpen.contains(attempt),
    s'=if(s.store==attempt and s.hashFor==0 and storageWorks)
      s.with("walletOpen",s.walletOpen.exclude(Set(attempt))).with("store",0)
        .with("cleared",s.cleared.union(Set(attempt)))
        .with("locals",if(s.alive.contains(s.walletOwner[attempt-1]))
          s.locals.replaceAt(s.walletOwner[attempt-1]-1,0) else s.locals)
    else s.with("walletOpen",s.walletOpen.exclude(Set(attempt)))}
  action userClears(id:int,storageWorks:bool):bool=all{s.alive.contains(id),not(walletBusy(id)),s.locals[id-1]>0,not(s.localHash[id-1]),not(s.checks.contains(id)),
    s'=if(s.store==s.locals[id-1] and (s.hashFor==s.store)==s.storedHash[id-1] and storageWorks)
      s.with("store",0).with("hashFor",0).with("locals",s.locals.replaceAt(id-1,0))
        .with("localHash",s.localHash.replaceAt(id-1,false))
        .with("storedHash",s.storedHash.replaceAt(id-1,false))
        .with("cleared",s.cleared.union(Set(s.locals[id-1])))
    else s.with("outcomes",s.outcomes.replaceAt(id-1,5))}
  action step={nondet id=Set(1,2).oneOf() nondet outcome=Set(1,2,3,4).oneOf()
    nondet storageWorks=Set(false,true).oneOf()
    any{mountSecond,leave(id),check(id),reply(id,outcome,storageWorks),prepareRetry(id),rejectDepartedPreflight(id),retry(id,storageWorks),
      walletReturns(id,storageWorks),walletDeclines(id,storageWorks),userClears(id,storageWorks),s'=s}}
  val invariant=all{s.store>=0,s.store<=2,s.hashFor==0 or s.hashFor==s.store,
    s.store==2 implies s.retried,s.retried implies s.cleared.contains(1),
    s.locals.length()==2,s.localHash.length()==2,s.storedHash.length()==2,s.captured.length()==2,s.capturedHash.length()==2,s.outcomes.length()==2,
    s.moneyMoved implies s.kind=="vault-transfer",s.callbacks<=2,
    s.kind=="vault-approval" implies (not(s.moneyMoved) and s.callbacks==0)}
  run departedFailureCannotClearRetryTest=commitment.then(check(1)).then(leave(1)).then(mountSecond)
    .then(check(2)).then(reply(2,2,true)).then(prepareRetry(2)).then(retry(2,true)).then(reply(1,2,true))
    .expect(s.store==2 and s.locals[1]==2 and s.outcomes[0]==0)
  run activeStaleFailureCannotClearOtherAttemptTest=commitment.then(check(1)).then(mountSecond)
    .then(check(2)).then(reply(2,2,true)).then(prepareRetry(2)).then(retry(2,true)).then(reply(1,2,true))
    .expect(s.store==2 and s.outcomes[0]==5)
  run legacyFailureCannotClearFreshRetryTest=legacyRelease.then(check(1)).then(mountSecond)
    .then(check(2)).then(reply(2,2,true)).then(prepareRetry(2)).then(retry(2,true)).then(reply(1,2,true))
    .expect(s.legacy and s.store==2 and s.outcomes[0]==5)
  run departedPendingCannotOverwriteRetryTest=legacyRelease.then(check(1)).then(leave(1)).then(mountSecond)
    .then(check(2)).then(reply(2,2,true)).then(prepareRetry(2)).then(retry(2,true)).then(reply(1,1,true))
    .expect(s.store==2 and s.hashFor==0)
  run walletTailRetainsStillOwnedEvidenceTest=commitmentTail.then(leave(1)).then(walletReturns(1,true))
    .expect(s.store==1 and s.hashFor==1)
  run walletTailCannotReplaceRetryTest=commitmentTail.then(leave(1)).then(mountSecond).then(check(2))
    .then(reply(2,2,true)).then(prepareRetry(2)).then(retry(2,true)).then(walletReturns(1,true))
    .expect(s.store==2 and s.hashFor==0 and s.ignored.contains(1))
  run walletTailCannotRecreateExplicitlyClearedSlotTest=commitmentTail.then(leave(1)).then(mountSecond)
    .then(userClears(2,true)).then(walletReturns(1,true))
    .expect(s.store==0 and s.ignored.contains(1))
  run failedRemovalKeepsAttemptTest=commitment.then(check(1)).then(reply(1,3,false))
    .expect(s.store==1 and s.locals[0]==1 and not(s.retried))
  run failedHashWriteKeepsUnknownAttemptTest=commitmentTail.then(walletReturns(1,false))
    .expect(s.store==1 and s.hashFor==0 and s.warnings.contains(1))
  run changedEvidenceInSameAttemptIsNotClearedTest=commitmentTail.then(mountSecond).then(check(2)).then(walletReturns(1,true))
    .then(reply(2,2,true)).expect(s.store==1 and s.hashFor==1 and s.outcomes[1]==5)
  run departedDeclineClearsOnlyItsOwnRecordTest=commitmentTail.then(leave(1)).then(walletDeclines(1,true))
    .expect(s.store==0 and s.cleared.contains(1))
  run departedDeclineCannotClearRetryTest=commitmentTail.then(leave(1)).then(mountSecond).then(check(2))
    .then(reply(2,2,true)).then(prepareRetry(2)).then(retry(2,true)).then(walletDeclines(1,true)).expect(s.store==2)
  run failedCreationDoesNotPromptRetryTest=commitment.then(check(1)).then(reply(1,2,true)).then(prepareRetry(1)).then(retry(1,false))
    .expect(s.store==0 and not(s.retried) and not(s.walletOpen.contains(2)))
  run sameInstanceWalletBusyBlocksCheckTest=commitmentTail.then(check(1).fail())
  run sameInstanceWalletBusyBlocksClearTest=commitmentTail.then(userClears(1,true).fail())
  run sameInstanceWalletBusyBlocksPreparationTest=commitmentTail.then(prepareRetry(1).fail())
  run failedHashWriteCanResolveItsStoredSnapshotTest=commitmentTail.then(walletReturns(1,false)).then(check(1))
    .then(reply(1,3,true)).expect(s.store==0 and s.outcomes[0]==3)
  run approvalDoesNotReportMoneyMovedTest=vaultApproval.then(check(1)).then(reply(1,4,true))
    .expect(s.store==0 and not(s.moneyMoved) and s.callbacks==0)
  run transferSuccessCallsCompletionTest=vaultTransfer.then(check(1)).then(reply(1,3,true))
    .expect(s.store==0 and s.moneyMoved and s.callbacks==1)
  run departedApprovalCannotClearRetryTest=vaultApproval.then(check(1)).then(leave(1)).then(mountSecond)
    .then(check(2)).then(reply(2,4,true)).then(prepareRetry(2)).then(retry(2,true)).then(reply(1,4,true))
    .expect(s.store==2 and not(s.moneyMoved) and s.callbacks==0)
  run monthlySettingCompletionIsNotPaymentTest=monthlySetting.then(check(1)).then(reply(1,3,true))
    .expect(s.store==0 and not(s.moneyMoved) and s.callbacks==1)
  run departedPreflightCannotRecordOrPromptTest=commitment.then(check(1)).then(reply(1,2,true))
    .then(prepareRetry(1)).then(leave(1)).then(retry(1,true).fail())
  run departedPreflightSettlesWithoutPromptTest=commitment.then(check(1)).then(reply(1,2,true))
    .then(prepareRetry(1)).then(leave(1)).then(rejectDepartedPreflight(1))
    .expect(s.store==0 and not(s.walletOpen.contains(2)) and not(s.retried))
}
