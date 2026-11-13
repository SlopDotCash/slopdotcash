// @source backend/security/direct-solana-recovery.ts
// @source backend/security/direct-payments.ts
// @evidence formal/tests/direct-solana-retirement.test.ts
// @evidence backend/security/direct-solana-api.integration.ts
// Two retained messages, two independent providers. Cryptographic and RPC
// observations are inputs; no provider truth or signature security is proved.
// Begins after retained-message shape/count/uniqueness and payer validation.
// sign means a successful exact-message Ed25519 check; parsing and invalid
// signatures are outside this model (the linked implementation test exercises them).
// Each observation aggregates both providers. trustedPair includes recognized
// independent operators, genesis, anchor and expiry observations. Each retained
// page represents progress on both histories, whose final digests must agree.
// Absence coverage has two pages here (the implementation persists 32 per provider/call).
module direct_solana_retirement {
  type Plan = {expired: bool, signed: bool, observation: str, pages: int, historyMatches: bool}
  var plans: List[Plan]
  var trustedPair: bool
  var mode: str
  val blank = {expired:false,signed:false,observation:"unknown",pages:0,historyMatches:false}
  action init = all {plans'=List(blank,blank), trustedPair'=false, mode'="unchecked"}
  val allExpired = plans.indices().forall(i => plans[i].expired)
  val allSigned = plans.indices().forall(i => plans[i].signed)
  val malformed = plans.indices().exists(i => plans[i].observation=="malformed")
  val found = plans.indices().exists(i => plans[i].observation=="found")
  val proved = plans.indices().forall(i => plans[i].observation=="matching-failure" or (plans[i].observation=="absent" and plans[i].pages==2 and plans[i].historyMatches))
  action providers(valid:bool):bool = all {mode!="retired",trustedPair'=valid,plans'=plans,mode'=mode}
  action expire(i:int):bool = all {mode!="retired",plans'=plans.replaceAt(i,plans[i].with("expired",true)),trustedPair'=trustedPair,mode'=mode}
  action sign(i:int):bool = all {mode=="signature-required",trustedPair,allExpired,
    plans'=plans.replaceAt(i,plans[i].with("signed",true)),trustedPair'=trustedPair,mode'=mode}
  action observe(i:int,result:str):bool = all {mode!="retired",allSigned,
    plans'=plans.replaceAt(i,plans[i].with("observation",result)),trustedPair'=trustedPair,mode'=mode}
  action retainPage(i:int):bool = all {mode!="retired",trustedPair,allExpired,allSigned,
    plans[i].observation=="absent",plans[i].pages<2,
    plans'=plans.replaceAt(i,plans[i].with("pages",plans[i].pages+1)),trustedPair'=trustedPair,mode'=mode}
  action compareHistory(i:int,matches:bool):bool = all {mode!="retired",plans[i].pages==2,
    plans'=plans.replaceAt(i,plans[i].with("historyMatches",matches)),trustedPair'=trustedPair,mode'=mode}
  action check = all {mode!="retired",plans'=plans,trustedPair'=trustedPair,
    mode'=if(not(trustedPair)) "history-check"
      else if(not(allExpired)) "expiry-required"
      else if(not(allSigned)) "signature-required"
      else if(malformed) "history-check"
      else if(found) "payment-found"
      else if(proved) "retired" else "history-check"}
  action step = any {providers(true),providers(false),expire(0),expire(1),sign(0),sign(1),
    nondet i=oneOf(Set(0,1)) nondet result=oneOf(Set("absent","matching-failure","disagreement","found","malformed")) observe(i,result),
    retainPage(0),retainPage(1),compareHistory(0,true),compareHistory(1,true),compareHistory(0,false),compareHistory(1,false),check,all{plans'=plans,trustedPair'=trustedPair,mode'=mode}}
  val invariant = all {
    mode=="retired" implies trustedPair and allExpired and allSigned and proved and not(found) and not(malformed),
    plans.indices().forall(i=>plans[i].pages>=0 and plans[i].pages<=2),
    plans.indices().exists(i=>plans[i].signed) implies allExpired,
  }
  run oneLiveMessageBlocksChallengeTest = init.then(providers(true)).then(expire(0)).then(check)
    .expect(mode=="expiry-required").then(sign(0).fail())
  run challengeThenRetainedAbsenceTest = init.then(providers(true)).then(expire(0)).then(expire(1)).then(check)
    .then(sign(0)).then(sign(1)).then(observe(0,"absent")).then(observe(1,"absent"))
    .then(retainPage(0)).then(retainPage(1)).then(check).expect(mode=="history-check")
    .then(retainPage(0)).then(retainPage(1)).then(check).expect(mode=="history-check")
    .then(compareHistory(0,true)).then(compareHistory(1,true)).then(check).expect(mode=="retired" and invariant)
  run matchingFailuresRetireTest = init.then(providers(true)).then(expire(0)).then(expire(1)).then(check)
    .then(sign(0)).then(sign(1)).then(observe(0,"matching-failure")).then(observe(1,"matching-failure"))
    .then(check).expect(mode=="retired")
  run providerDisagreementHoldsTest = init.then(providers(true)).then(expire(0)).then(expire(1)).then(check)
    .then(sign(0)).then(sign(1)).then(observe(0,"matching-failure")).then(observe(1,"disagreement"))
    .then(check).expect(mode=="history-check")
  run foundWinsOverIncompleteCoverageTest = init.then(providers(true)).then(expire(0)).then(expire(1)).then(check)
    .then(sign(0)).then(sign(1)).then(observe(0,"found")).then(observe(1,"absent"))
    .then(check).expect(mode=="payment-found")
  run malformedRpcOverridesFoundTest = init.then(providers(true)).then(expire(0)).then(expire(1)).then(check)
    .then(sign(0)).then(sign(1)).then(observe(0,"found")).then(observe(1,"malformed"))
    .then(check).expect(mode=="history-check")
}
