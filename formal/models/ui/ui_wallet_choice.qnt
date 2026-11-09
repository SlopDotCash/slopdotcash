// @source src/lib/use-payout-wallets.ts
// @source src/Earnings.tsx
// @evidence tests/e2e/payout-wallet-picker.spec.ts
// Earnings UI reconciliation only: three EVM chains and one Solana chain,
// two addresses, two provider choices and two sequential user operations.
// Discovery/trust/returned-account validity are external inputs refined by
// evm_wallet_discovery and solana_wallet_provider; actor/lifetime/HTTP checks
// remain in ui_earnings_actor_binding and ui_earnings_wallet_lifetime.
// Card state derives from the last validated account read, not provider
// selection or a successful individual request. A connection captures those
// rows for its consent comparison and immediate registration. If consent is
// required, its later Confirm click captures the then-current rows for skip
// decisions; it keeps the originally displayed before/after addresses.
// A different saved address requires consent even if it is unconfirmed.
// Matching authorized chains are skipped; other chains are visited in order.
// Partial outcomes request refresh and preserve the error. A success message
// requests reconciliation but does not itself make every card confirmed.
// No payment amount, signature, public registration or backend finality is
// proved here. One successful chain action is an abstract verified completion.
// Browser cases are definitions only; this model was not executed.
module ui_wallet_choice {
  val families=Set(1,2)
  val chains=Set(0,1,2,3)
  pure def members(family:int):Set[int]=if(family==1)Set(0,1,2) else Set(3)
  type S={visible:bool,rows:List[int],authorized:Set[int],captured:List[int],capturedAuthorized:Set[int],
    available:Set[int],phase:str,family:int,selected:int,address:int,different:int,cursor:int,
    operation:int,sent:int->Set[int],finished:int->Set[int],refresh:bool,error:bool,message:str,focus:int}
  var s:S
  action init=s'={visible:true,rows:List(0,0,0,0),authorized:Set(),captured:List(0,0,0,0),capturedAuthorized:Set(),
    available:Set(),phase:"idle",family:0,selected:0,address:0,different:0,cursor:0,
    operation:0,sent:Map(1->Set(),2->Set()),finished:Map(1->Set(),2->Set()),refresh:false,error:false,message:"none",focus:0}
  def addresses(family:int):Set[int]=members(family).map(chain=>s.rows[chain]).exclude(Set(0))
  def confirmed(family:int):bool=addresses(family).size()==1 and members(family).forall(chain=>s.authorized.contains(chain))
  def card(family:int):str=if(addresses(family).size()==0)"empty" else if(confirmed(family))"confirmed" else "attention"
  def changing(family:int):bool=members(family).exists(chain=>s.authorized.contains(chain))
  val installLinks=s.phase=="picker" and not(s.available.contains(s.family))
  action readRow(chain:int,address:int,authorized:bool):bool=all{chains.contains(chain),Set(0,1,2).contains(address),not(authorized) or address>0,
    s'=s.with("visible",true).with("rows",s.rows.replaceAt(chain,address))
      .with("authorized",if(authorized)s.authorized.union(Set(chain)) else s.authorized.exclude(Set(chain)))}
  action providers(available:Set[int]):bool=all{available.subseteq(families),s'=s.with("available",available)}
  action open(family:int):bool=all{s.visible,s.phase=="idle",families.contains(family),s.operation<2,
    s'=s.with("family",family).with("phase","picker").with("focus",0)}
  action cancelPicker=all{s.phase=="picker",s'=s.with("phase","idle").with("focus",s.family)}
  action choose(provider:int):bool=all{s.phase=="picker",provider==s.family,s.available.contains(provider),
    s'=s.with("phase","connecting").with("selected",provider).with("operation",s.operation+1)
      .with("captured",s.rows).with("capturedAuthorized",s.authorized).with("refresh",false).with("error",false).with("message","none")}
  action connection(address:int,accepted:bool):bool={
    val differs=members(s.family).filter(chain=>s.captured[chain]>0 and s.captured[chain]!=address)
    all{s.phase=="connecting",Set(1,2).contains(address),
      s'=if(not(accepted))s.with("phase","idle").with("error",true)
      else s.with("address",address).with("different",if(differs.size()>0)s.captured[differs.fold(4,(first,chain)=>if(chain<first)chain else first)] else 0)
        .with("cursor",if(s.family==1)0 else 3).with("phase",if(differs.size()>0)"consent" else "reconcile")}}
  action keepSaved=all{s.phase=="consent",s'=s.with("phase","idle").with("message","kept").with("focus",s.family)}
  action confirmChange=all{s.phase=="consent",s'=s.with("phase","reconcile")
    .with("captured",s.rows).with("capturedAuthorized",s.authorized)}
  val hasChain=s.phase=="reconcile" and (if(s.family==1)s.cursor<3 else s.cursor==3)
  action skip=all{hasChain,s.capturedAuthorized.contains(s.cursor),s.captured[s.cursor]==s.address,
    s'=s.with("cursor",s.cursor+1)}
  action request=all{hasChain,not(s.capturedAuthorized.contains(s.cursor) and s.captured[s.cursor]==s.address),
    s'=s.with("phase","request").with("sent",s.sent.put(s.operation,s.sent.get(s.operation).union(Set(s.cursor))))}
  action response(ok:bool):bool=all{s.phase=="request",
    s'=if(ok)s.with("phase","reconcile").with("finished",s.finished.put(s.operation,s.finished.get(s.operation).union(Set(s.cursor))))
      .with("cursor",s.cursor+1)
    else s.with("phase","idle").with("refresh",true).with("error",true)}
  action finish=all{s.phase=="reconcile",not(hasChain),s'=s.with("phase","idle").with("refresh",true).with("message","confirmed")}
  action clear=all{s.visible,s'=s.with("visible",false).with("rows",List(0,0,0,0)).with("authorized",Set())
    .with("phase","idle").with("message","none")}
  action step={nondet family=families.oneOf() nondet chain=chains.oneOf() nondet address=Set(0,1,2).oneOf()
    nondet yes=Set(false,true).oneOf() nondet choices=Set(Set(),Set(1),Set(2),Set(1,2)).oneOf()
    any{readRow(chain,address,yes),providers(choices),open(family),cancelPicker,choose(family),connection(family,yes),
      keepSaved,confirmChange,skip,request,response(yes),finish,clear,s'=s}}
  val invariant=all{s.operation<=2,s.authorized.forall(chain=>s.rows[chain]>0),
    families.forall(family=>confirmed(family) implies card(family)=="confirmed" and changing(family)),
    Set(1,2).forall(op=>s.finished.get(op).subseteq(s.sent.get(op))),
    s.phase=="consent" implies s.different>0 and s.different!=s.address,
    s.phase=="request" implies members(s.family).contains(s.cursor)}
  action evm=providers(Set(1)).then(open(1)).then(choose(1))
  action evmRows=readRow(0,1,true).then(readRow(1,1,true)).then(readRow(2,1,true))
  run emptyCardHasConnectAndNoProviderEffectTest=init.expect(card(1)=="empty" and not(changing(1)) and s.operation==0)
  run allThreeChainsRequiredForConfirmedTest=init.then(readRow(0,1,true)).then(readRow(1,1,true))
    .expect(card(1)=="attention" and changing(1)).then(readRow(2,1,true)).expect(card(1)=="confirmed")
  run distinctAuthorizedAddressesRemainAttentionTest=init.then(evmRows).then(readRow(2,2,true)).expect(card(1)=="attention" and changing(1))
  run unconfirmedAddressUsesConnectTest=init.then(readRow(0,1,false)).expect(card(1)=="attention" and not(changing(1)))
  run solanaUsesItsSingleChainTest=init.then(readRow(3,1,true)).expect(card(2)=="confirmed" and card(1)=="empty")
  run emptyPickerOffersInstallLinksTest=init.then(open(1)).expect(installLinks and s.operation==0)
  run lateDiscoveryChangesOpenPickerOnlyTest=init.then(open(2)).then(providers(Set(1))).expect(installLinks)
    .then(providers(Set(1,2))).expect(not(installLinks) and s.operation==0)
  run wrongFamilyChoiceCannotConnectTest=init.then(providers(Set(1,2))).then(open(1)).then(choose(2).fail())
  run pickerCancelCallsNoProviderTest=init.then(open(2)).then(cancelPicker).expect(s.operation==0 and s.focus==2)
  run unconfirmedDifferentAddressStillNeedsConsentTest=init.then(readRow(0,1,false)).then(evm).then(connection(2,true))
    .expect(s.phase=="consent" and s.sent.get(1)==Set())
  run mixedRowsRequireConsentForAnyDifferentAddressTest=init.then(evmRows).then(readRow(1,2,true)).then(evm).then(connection(1,true))
    .expect(s.phase=="consent" and s.different==2).then(keepSaved).expect(s.sent.get(1)==Set() and s.focus==1)
  run matchingConfirmedChainsNeedNoSignaturesTest=init.then(evmRows).then(evm).then(connection(1,true)).then(skip).then(skip).then(skip).then(finish)
    .expect(s.sent.get(1)==Set() and s.refresh and s.message=="confirmed" and invariant)
  run matchingPendingChainStillNeedsConfirmationTest=init.then(evmRows).then(readRow(1,1,false)).then(evm).then(connection(1,true))
    .then(skip).then(request).then(response(true)).then(skip).then(finish).expect(s.sent.get(1)==Set(1) and invariant)
  run successfulRequestsDoNotOptimisticallyRewriteCardTest=init.then(evm).then(connection(1,true)).then(request).then(response(true))
    .expect(card(1)=="empty" and s.finished.get(1)==Set(0)).then(readRow(0,1,true)).expect(card(1)=="attention")
  run partialFailureKeepsRefreshAndErrorTest=init.then(evm).then(connection(1,true)).then(request).then(response(true)).then(request).then(response(false))
    .expect(s.finished.get(1)==Set(0) and s.refresh and s.error and s.message=="none")
  run retrySkipsReconciledEarlierChainTest=init.then(evm).then(connection(1,true)).then(request).then(response(true)).then(request).then(response(false))
    .then(readRow(0,1,true)).then(open(1)).then(choose(1)).then(connection(1,true)).then(skip).then(request)
    .expect(s.sent.get(2)==Set(1) and invariant)
  run newReadDoesNotRewriteCapturedConsentTest=init.then(readRow(0,1,true)).then(evm).then(readRow(0,2,true)).then(connection(1,true))
    .expect(s.phase=="reconcile" and s.captured[0]==1 and s.rows[0]==2)
  run laterConsentUsesCurrentRowsForRegistrationTest=init.then(evmRows).then(readRow(1,2,false)).then(evm).then(connection(1,true))
    .then(readRow(1,1,true)).then(confirmChange).then(skip).then(skip).then(skip).then(finish)
    .expect(s.different==2 and s.sent.get(1)==Set() and s.captured[1]==1 and invariant)
  run removedProviderDoesNotAutomaticallyCancelCapturedConnectionTest=init.then(evm).then(providers(Set())).then(connection(1,true))
    .expect(s.phase=="reconcile" and s.selected==1)
  run rejectedConnectionDoesNotRegisterTest=init.then(evm).then(connection(1,false)).expect(s.error and s.sent.get(1)==Set())
  run pendingConsentBlocksOtherFamilyPickerTest=init.then(readRow(0,1,true)).then(evm).then(connection(2,true)).then(open(2).fail())
}
