// @source src/PayoutConsent.tsx
// @source src/lib/payout-consent.ts
// @evidence tests/e2e/payout-consent.spec.ts
// Presentation refinement only: two review contexts/operations, EVM and
// Solana families, three provider classes (EVM, Solana with transaction signing,
// Solana message-only). ui_payout_consent_lifetime owns async actor/operation
// checks; solana_binding_wire and provider/API models own byte and admission
// predicates. A successful EVM response saves consent; a successful Solana
// response acknowledges binding submission. Neither proves payment.
// Eligibility requires known network, authorized same-chain claim, vault and
// reserved award. A missing signer links to Account wallets. Provider removal
// while open does not auto-close the modal; Cancel remains available when idle.
// Modal effect delivery is explicit; this finite projection assumes native
// show/close events settle before another user-open action. It is not a model
// of browser top-layer event scheduling, chain finality or focus theft.
// No runtime/browser/parser execution is claimed.
module ui_payout_consent {
  val providerIds=Set(1,2,3)
  type Operation={context:int,phase:str,family:str}
  type S={present:bool,context:int,family:str,network:bool,claim:bool,vault:bool,reserved:bool,
    providers:Set[int],open:bool,dialog:bool,wasOpen:bool,active:int,operations:int->Operation,
    error:bool,notice:str,focus:str,accepted:Set[int],paid:bool}
  var s:S
  action init=s'={present:true,context:1,family:"evm",network:true,claim:true,vault:true,reserved:true,
    providers:Set(),open:false,dialog:false,wasOpen:false,active:0,
    operations:Set(1,2).mapBy(_=>{context:0,phase:"unused",family:"evm"}),
    error:false,notice:"none",focus:"none",accepted:Set(),paid:false}
  val eligible=s.present and s.network and s.claim and s.vault and s.reserved
  val choices=s.providers.filter(id=>if(s.family=="evm")id==1 else id==2)
  val trigger=if(not(eligible) or s.open or s.notice!="none")"none" else if(choices.size()==0)"link" else "button"
  val busy=s.active!=0
  action configure(family:str,network:bool,claim:bool,vault:bool,reserved:bool):bool=all{
    s.context==1,Set(1,2).forall(id=>s.operations.get(id).phase=="unused"),not(s.open),Set("evm","solana").contains(family),
    s'=s.with("family",family).with("network",network).with("claim",claim).with("vault",vault).with("reserved",reserved)}
  action discover(providers:Set[int]):bool=all{providers.subseteq(providerIds),s'=s.with("providers",providers)}
  action openReview=all{trigger=="button",not(s.dialog),s'=s.with("open",true)}
  action modalEffect=s'=s.with("dialog",eligible and s.open).with("wasOpen",eligible and s.open)
    .with("focus",if(eligible and s.open)"heading" else if(s.wasOpen and eligible)
      (if(s.notice!="none")"notice" else if(trigger=="button")"trigger" else "none") else s.focus)
  action begin(id:int,provider:int):bool=all{eligible,s.open,not(busy),Set(1,2).contains(id),choices.contains(provider),
    s.operations.get(id).phase=="unused",s'=s.with("active",id).with("error",false).with("notice","none")
      .with("operations",s.operations.put(id,{context:s.context,phase:"pending",family:s.family}))}
  action cancel=all{s.open,not(busy),s'=s.with("open",false).with("error",false)}
  // Native Escape calls preventDefault while busy; it is not operation abort.
  action escape=all{s.open,s'=if(busy)s else s.with("open",false).with("error",false)}
  action settle(id:int,outcome:str):bool={val op=s.operations.get(id)
    val current=s.active==id and s.context==op.context and s.present
    all{op.phase=="pending",Set("error","accepted","access-lost").contains(outcome),
      s'=if(not(current))s.with("operations",s.operations.put(id,op.with("phase","ignored")))
      else if(outcome=="error")s.with("active",0).with("error",true).with("operations",s.operations.put(id,op.with("phase","error")))
      else if(outcome=="access-lost")s.with("active",0).with("open",false).with("present",false)
        .with("operations",s.operations.put(id,op.with("phase","access-lost")))
      else s.with("active",0).with("open",false).with("notice",if(op.family=="evm")"saved" else "submitted")
        .with("accepted",s.accepted.union(Set(id))).with("operations",s.operations.put(id,op.with("phase","accepted")))}}
  action contextChange(eligible:bool):bool=all{s.context==1,s'=s.with("context",2).with("claim",eligible)
    .with("open",false).with("active",0).with("error",false).with("notice","none")}
  action depart=s'=s.with("present",false).with("open",false).with("active",0)
  action step={nondet id=Set(1,2).oneOf() nondet provider=providerIds.oneOf()
    nondet family=Set("evm","solana").oneOf() nondet yes=Set(false,true).oneOf()
    nondet knownNetwork=Set(false,true).oneOf() nondet claim=Set(false,true).oneOf()
    nondet vault=Set(false,true).oneOf() nondet reserved=Set(false,true).oneOf()
    nondet outcome=Set("error","accepted","access-lost").oneOf()
    nondet providers=Set(Set(),Set(1),Set(2),Set(3),Set(1,2,3)).oneOf()
    any{configure(family,knownNetwork,claim,vault,reserved),discover(providers),openReview,modalEffect,begin(id,provider),
      cancel,escape,settle(id,outcome),contextChange(yes),depart,s'=s}}
  val invariant=all{not(s.paid),s.accepted.forall(id=>s.operations.get(id).phase=="accepted"),
    busy implies s.open and eligible and s.operations.get(s.active).context==s.context,
    s.notice!="none" implies not(s.open) and not(busy) and s.accepted.size()>0,
    s.family=="solana" implies not(choices.contains(3))}
  action evm=discover(Set(1)).then(openReview).then(modalEffect)
  action solana=configure("solana",true,true,true,true).then(discover(Set(2,3))).then(openReview).then(modalEffect)
  run unknownNetworkRendersNothingTest=init.then(configure("evm",false,true,true,true)).expect(not(eligible) and trigger=="none")
  run unconfirmedClaimRendersNothingTest=init.then(configure("evm",true,false,true,true)).expect(trigger=="none")
  run missingVaultRendersNothingTest=init.then(configure("evm",true,true,false,true)).expect(trigger=="none")
  run paidAwardDoesNotOfferConsentTest=init.then(configure("evm",true,true,true,false)).expect(trigger=="none")
  run noSignerLinksToAccountWalletsTest=init.expect(trigger=="link")
  run messageOnlySolanaWalletCannotOpenBindingTest=init.then(configure("solana",true,true,true,true)).then(discover(Set(3)))
    .expect(choices==Set() and trigger=="link")
  run lateSignerMakesReviewButtonAvailableTest=init.then(discover(Set(1))).expect(trigger=="button" and not(s.open))
  run openModalFocusesReviewHeadingTest=init.then(evm).expect(s.dialog and s.focus=="heading")
  run cancelRestoresTriggerFocusTest=init.then(evm).then(cancel).then(modalEffect).expect(not(s.dialog) and s.focus=="trigger")
  run idleEscapeClearsRetryErrorTest=init.then(evm).then(begin(1,1)).then(settle(1,"error")).then(escape).then(modalEffect)
    .expect(not(s.error) and not(s.dialog) and s.focus=="trigger")
  run busyEscapeDoesNotAbortConsentTest=init.then(evm).then(begin(1,1)).then(escape).expect(busy and s.open and invariant)
  run busyCancelRefusedTest=init.then(evm).then(begin(1,1)).then(cancel.fail())
  run providerRemovalKeepsIdleCancelAvailableTest=init.then(evm).then(discover(Set())).then(cancel).then(modalEffect)
    .expect(trigger=="link" and s.focus=="none")
  run genericErrorKeepsReviewRetryableTest=init.then(evm).then(begin(1,1)).then(settle(1,"error"))
    .expect(s.open and s.error and not(busy)).then(begin(2,1)).expect(not(s.error) and busy)
  run evmSavedNoticeIsNotPaymentTest=init.then(evm).then(begin(1,1)).then(settle(1,"accepted")).then(modalEffect)
    .expect(s.notice=="saved" and trigger=="none" and s.focus=="notice" and invariant)
  run solanaSubmittedNoticeIsNotPaymentTest=init.then(solana).then(begin(1,2)).then(settle(1,"accepted")).then(modalEffect)
    .expect(s.notice=="submitted" and s.focus=="notice" and invariant)
  run changedContextClearsOldResultTest=init.then(evm).then(begin(1,1)).then(settle(1,"accepted")).then(contextChange(true))
    .expect(s.notice=="none" and trigger=="button" and invariant)
  run departedOperationCannotPublishNoticeTest=init.then(evm).then(begin(1,1)).then(depart).then(settle(1,"accepted"))
    .expect(s.notice=="none" and not(s.present) and invariant)
}
}
