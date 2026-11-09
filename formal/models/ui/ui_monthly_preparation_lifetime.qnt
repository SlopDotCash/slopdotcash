// @source src/OwnerCommitment.tsx
// @source src/AutomaticMonthlyPayment.tsx
// @source src/lib/monthly-commitment-actions.ts
// @source src/lib/owner-commitment-actions.ts
// @source src/lib/solana-commitment-actions.ts
// @source src/lib/use-pending-wallet-attempt.ts
// @evidence tests/e2e/solana-vault-actions.spec.ts
// Source-only refinement of private Solana preparation, not chain proof.
// Three entry points: award inspect, award authorize with an existing review,
// and monthly-setting inspect. Two component lifetimes, one action per lifetime.
// A parent replacement retires the old child at the layout commit; sign-out or
// navigation that removes it has the same boundary. Cookie changes alone do
// not imply removal or a continuously bound GitHub actor. Backend admission,
// schema/identity/amount checks, exact wire verification and chain finality are
// predicates supplied by their own implementations/models. No money is paid
// by a review or wallet prompt: an award is reserved, or a setting is changed.
// Phase bounds per lifetime: 0 idle, 1 first request, 2 observed first reply,
// 3 returned first reply, 4 second request, 5 observed second reply, 6 returned
// second reply, 7 displayed review, 8 ready to send, 9 refused, 10 wallet open,
// 11 returned wallet result, 12 unchanged-setting helper returned. Observation/return/consumption are separate so
// departure between promise fulfillment and the caller is represented.
// For monthly settings the first read and dispatch gate live in the helper;
// unchanged settings have no second POST. For awards the gates are the two
// callers immediately after requestOwnerCommitment. There is no await between
// a gate and its second POST. Already-dispatched work may complete after exit.
// Hash storage, CAS, declined/unknown wallet outcomes and retries in the same
// mounted instance are intentionally left to ui_owner_recovery_lifetime and
// ui_monthly_setting_recovery. Historical unguarded actions are outside step.
// Authored by reading source; no parser, simulation or browser run is claimed.
module ui_monthly_preparation_lifetime {
  type S = {kind:str,alive:Set[int],current:int,phase:List[int],
    firstValid:List[bool],matches:List[bool],changes:List[bool],secondValid:List[bool],
    firstRequests:Set[int],secondRequests:Set[int],secondOwned:Set[int],
    accepted:Set[int],published:Set[int],publishedOwned:Set[int],
    wallet:Set[int],walletOwned:Set[int],returnedWallet:Set[int],refused:Set[int]}
  def initial(kind:str):S = {kind:kind,alive:Set(1),current:1,phase:List(0,0),
    firstValid:List(false,false),matches:List(false,false),changes:List(false,false),secondValid:List(false,false),
    firstRequests:Set(),secondRequests:Set(),secondOwned:Set(),accepted:Set(),
    published:Set(),publishedOwned:Set(),wallet:Set(),walletOwned:Set(),returnedWallet:Set(),refused:Set()}
  var s:S
  action init={nondet kind=Set("inspect","authorize","monthly").oneOf();s'=initial(kind)}
  action inspect=s'=initial("inspect")
  action authorize=s'=initial("authorize")
  action monthly=s'=initial("monthly")
  def owns(id:int):bool=s.current==id and s.alive.contains(id)
  action begin(id:int):bool=all{owns(id),s.phase[id-1]==0,
    s'=s.with("phase",s.phase.replaceAt(id-1,1)).with("firstRequests",s.firstRequests.union(Set(id)))}
  action leave(id:int):bool=all{owns(id),s'=s.with("alive",s.alive.exclude(Set(id)))}
  action replace=all{s.current==1,s.phase[1]==0,
    s'=s.with("current",2).with("alive",Set(2))}
  action observeFirst(id:int,valid:bool,matches:bool,changes:bool):bool=all{s.phase[id-1]==1,
    s'=s.with("phase",s.phase.replaceAt(id-1,2))
      .with("firstValid",s.firstValid.replaceAt(id-1,valid))
      .with("matches",s.matches.replaceAt(id-1,s.kind!="authorize" or matches))
      .with("changes",s.changes.replaceAt(id-1,s.kind!="monthly" or changes))}
  action returnFirst(id:int):bool=all{s.phase[id-1]==2,
    s'=s.with("phase",s.phase.replaceAt(id-1,3))}
  action consumeFirst(id:int):bool=all{s.phase[id-1]==3,
    s'=if(not(owns(id)) or not(s.firstValid[id-1]) or not(s.matches[id-1]))
      s.with("phase",s.phase.replaceAt(id-1,9)).with("refused",s.refused.union(Set(id)))
    else if(not(s.changes[id-1]))s.with("phase",s.phase.replaceAt(id-1,12))
    else s.with("phase",s.phase.replaceAt(id-1,4))
      .with("secondRequests",s.secondRequests.union(Set(id)))
      .with("secondOwned",s.secondOwned.union(Set(id)))}
  // Even the no-change helper result crosses a final await before the
  // component's independent mounted check can publish its review.
  action consumeUnchanged(id:int):bool=all{s.phase[id-1]==12,
    s'=if(not(owns(id)))s.with("phase",s.phase.replaceAt(id-1,9)).with("refused",s.refused.union(Set(id)))
    else s.with("phase",s.phase.replaceAt(id-1,7)).with("published",s.published.union(Set(id)))
      .with("publishedOwned",s.publishedOwned.union(Set(id)))}
  action readFailure(id:int):bool=all{s.phase[id-1]==1,
    s'=s.with("phase",s.phase.replaceAt(id-1,9)).with("refused",s.refused.union(Set(id)))}
  // The server may finish a request it already admitted even if the client
  // has left. Retaining that fact never licenses a fresh client dispatch.
  action observeSecond(id:int,valid:bool):bool=all{s.phase[id-1]==4,
    s'=s.with("phase",s.phase.replaceAt(id-1,5)).with("secondValid",s.secondValid.replaceAt(id-1,valid))
      .with("accepted",if(valid)s.accepted.union(Set(id)) else s.accepted)}
  action returnSecond(id:int):bool=all{s.phase[id-1]==5,
    s'=s.with("phase",s.phase.replaceAt(id-1,6))}
  action consumeSecond(id:int):bool=all{s.phase[id-1]==6,
    s'=if(not(owns(id)) or not(s.secondValid[id-1]))
      s.with("phase",s.phase.replaceAt(id-1,9)).with("refused",s.refused.union(Set(id)))
    else if(s.kind=="authorize")s.with("phase",s.phase.replaceAt(id-1,8))
    else s.with("phase",s.phase.replaceAt(id-1,7)).with("published",s.published.union(Set(id)))
      .with("publishedOwned",s.publishedOwned.union(Set(id)))}
  action prompt(id:int):bool=all{s.phase[id-1]==8,owns(id),
    s'=s.with("phase",s.phase.replaceAt(id-1,10)).with("wallet",s.wallet.union(Set(id)))
      .with("walletOwned",s.walletOwned.union(Set(id)))}
  action rejectPrompt(id:int):bool=all{s.phase[id-1]==8,not(owns(id)),
    s'=s.with("phase",s.phase.replaceAt(id-1,9)).with("refused",s.refused.union(Set(id)))}
  action walletReturns(id:int):bool=all{s.phase[id-1]==10,
    s'=s.with("phase",s.phase.replaceAt(id-1,11)).with("returnedWallet",s.returnedWallet.union(Set(id)))}
  action step={nondet id=Set(1,2).oneOf()
    nondet valid=Set(false,true).oneOf()
    nondet matches=Set(false,true).oneOf()
    nondet changes=Set(false,true).oneOf()
    any{begin(id),leave(id),replace,observeFirst(id,valid,matches,changes),returnFirst(id),consumeFirst(id),
      consumeUnchanged(id),readFailure(id),observeSecond(id,valid),returnSecond(id),consumeSecond(id),prompt(id),rejectPrompt(id),walletReturns(id),s'=s}}
  val invariant=all{s.secondRequests.subseteq(s.firstRequests),s.secondRequests.subseteq(s.secondOwned),
    s.accepted.subseteq(s.secondRequests),s.published.subseteq(s.publishedOwned),
    s.wallet.subseteq(s.walletOwned),s.wallet.subseteq(s.accepted),s.returnedWallet.subseteq(s.wallet),
    s.kind!="authorize" implies s.wallet.size()==0,
    1.to(2).forall(id=>s.secondRequests.contains(id) implies
      (s.changes[id-1] and s.firstValid[id-1] and s.matches[id-1]))}
  // Convenience compositions used only in named traces, not step.
  action first(id:int,valid:bool,matches:bool,changes:bool):bool=
    begin(id).then(observeFirst(id,valid,matches,changes)).then(returnFirst(id))
  action second(id:int,valid:bool):bool=observeSecond(id,valid).then(returnSecond(id)).then(consumeSecond(id))
  action historicalUnguardedConsume(id:int):bool=all{s.phase[id-1]==3,s.firstValid[id-1],s.matches[id-1],s.changes[id-1],
    s'=s.with("phase",s.phase.replaceAt(id-1,4)).with("secondRequests",s.secondRequests.union(Set(id)))
      .with("secondOwned",if(owns(id))s.secondOwned.union(Set(id)) else s.secondOwned)}
  run liveAwardInspectionTest=inspect.then(first(1,true,true,true)).then(consumeFirst(1)).then(second(1,true))
    .expect(s.published==Set(1) and s.wallet.size()==0 and invariant)
  run liveAwardAuthorizationTest=authorize.then(first(1,true,true,true)).then(consumeFirst(1)).then(second(1,true)).then(prompt(1))
    .expect(s.wallet==Set(1) and s.accepted==Set(1) and invariant)
  run changedMonthlySettingTest=monthly.then(first(1,true,true,true)).then(consumeFirst(1)).then(second(1,true))
    .expect(s.published==Set(1) and s.secondRequests==Set(1) and invariant)
  run unchangedMonthlySettingHasNoSecondPostTest=monthly.then(first(1,true,true,false)).then(consumeFirst(1)).then(consumeUnchanged(1))
    .expect(s.published==Set(1) and s.secondRequests.size()==0 and s.wallet.size()==0 and invariant)
  run inspectDepartureBeforeObservationTest=inspect.then(begin(1)).then(leave(1)).then(observeFirst(1,true,true,true))
    .then(returnFirst(1)).then(consumeFirst(1)).expect(s.secondRequests.size()==0 and s.refused==Set(1) and invariant)
  run inspectDepartureBetweenObservationAndReturnTest=inspect.then(begin(1)).then(observeFirst(1,true,true,true)).then(leave(1))
    .then(returnFirst(1)).then(consumeFirst(1)).expect(s.secondRequests.size()==0 and invariant)
  run inspectDepartureAfterReturnTest=inspect.then(first(1,true,true,true)).then(leave(1)).then(consumeFirst(1))
    .expect(s.secondRequests.size()==0 and invariant)
  run authorizeDepartureBeforeObservationTest=authorize.then(begin(1)).then(leave(1)).then(observeFirst(1,true,true,true))
    .then(returnFirst(1)).then(consumeFirst(1)).expect(s.secondRequests.size()==0 and s.wallet.size()==0 and invariant)
  run authorizeDepartureAfterReturnTest=authorize.then(first(1,true,true,true)).then(leave(1)).then(consumeFirst(1))
    .expect(s.secondRequests.size()==0 and s.refused==Set(1) and invariant)
  run monthlyDepartureBetweenObservationAndReturnTest=monthly.then(begin(1)).then(observeFirst(1,true,true,true)).then(leave(1))
    .then(returnFirst(1)).then(consumeFirst(1)).expect(s.secondRequests.size()==0 and invariant)
  run monthlyDepartureAfterReturnTest=monthly.then(first(1,true,true,true)).then(leave(1)).then(consumeFirst(1))
    .expect(s.secondRequests.size()==0 and invariant)
  run unchangedMonthlyDepartureDoesNotPublishTest=monthly.then(first(1,true,true,false)).then(leave(1)).then(consumeFirst(1))
    .expect(s.published.size()==0 and s.secondRequests.size()==0 and invariant)
  run unchangedHelperReturnThenDepartureDoesNotPublishTest=monthly.then(first(1,true,true,false)).then(consumeFirst(1))
    .then(leave(1)).then(consumeUnchanged(1)).expect(s.published.size()==0 and s.secondRequests.size()==0 and invariant)
  run replacementCannotReviveOldAwardPreparationTest=inspect.then(first(1,true,true,true)).then(replace)
    .then(first(2,true,true,true)).then(consumeFirst(1)).then(consumeFirst(2)).then(second(2,true))
    .expect(s.secondRequests==Set(2) and s.published==Set(2) and invariant)
  run replacementCannotReviveOldMonthlyPreparationTest=monthly.then(first(1,true,true,true)).then(replace)
    .then(consumeFirst(1)).then(first(2,true,true,false)).then(consumeFirst(2)).then(consumeUnchanged(2))
    .expect(s.secondRequests.size()==0 and s.published==Set(2) and invariant)
  run changedAwardClearsReviewWithoutSecondPostTest=authorize.then(first(1,true,false,true)).then(consumeFirst(1))
    .expect(s.refused==Set(1) and s.secondRequests.size()==0 and invariant)
  run invalidInitialResponseRefusedTest=inspect.then(first(1,false,true,true)).then(consumeFirst(1))
    .expect(s.refused==Set(1) and s.secondRequests.size()==0 and invariant)
  run firstRequestFailureDoesNotDispatchTest=monthly.then(begin(1)).then(readFailure(1))
    .expect(s.refused==Set(1) and s.secondRequests.size()==0 and invariant)
  run invalidSecondResponseDoesNotPublishTest=monthly.then(first(1,true,true,true)).then(consumeFirst(1)).then(second(1,false))
    .expect(s.refused==Set(1) and s.published.size()==0 and invariant)
  run alreadyDispatchedReviewCanBeAcceptedAfterDepartureTest=inspect.then(first(1,true,true,true)).then(consumeFirst(1))
    .then(leave(1)).then(second(1,true)).expect(s.accepted==Set(1) and s.published.size()==0 and invariant)
  run departureBetweenSecondObservationAndReturnTest=authorize.then(first(1,true,true,true)).then(consumeFirst(1))
    .then(observeSecond(1,true)).then(leave(1)).then(returnSecond(1)).then(consumeSecond(1))
    .expect(s.accepted==Set(1) and s.wallet.size()==0 and invariant)
  run departureAfterSecondReturnDoesNotPublishTest=inspect.then(first(1,true,true,true)).then(consumeFirst(1))
    .then(observeSecond(1,true)).then(returnSecond(1)).then(leave(1)).then(consumeSecond(1))
    .expect(s.published.size()==0 and s.accepted==Set(1) and invariant)
  run finalPromptRetainsIndependentLifetimeFenceTest=authorize.then(first(1,true,true,true)).then(consumeFirst(1))
    .then(second(1,true)).then(leave(1)).then(rejectPrompt(1)).expect(s.wallet.size()==0 and invariant)
  run alreadyOpenedWalletCanReturnAfterDepartureTest=authorize.then(first(1,true,true,true)).then(consumeFirst(1))
    .then(second(1,true)).then(prompt(1)).then(leave(1)).then(walletReturns(1))
    .expect(s.returnedWallet==Set(1) and invariant)
  run departedInstanceCannotStartFirstRequestTest=inspect.then(leave(1)).then(begin(1).fail())
  run oldInspectMissingGateNegativeControlTest=inspect.then(first(1,true,true,true)).then(leave(1))
    .then(historicalUnguardedConsume(1)).expect(not(invariant))
  run oldAuthorizeMissingGateNegativeControlTest=authorize.then(first(1,true,true,true)).then(replace)
    .then(historicalUnguardedConsume(1)).expect(not(invariant))
  run oldMonthlyMissingGateNegativeControlTest=monthly.then(first(1,true,true,true)).then(leave(1))
    .then(historicalUnguardedConsume(1)).expect(not(invariant))
}
