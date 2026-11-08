// @source backend/payments/handler.ts
// @source backend/payments/wallet-registration.ts
// @source backend/payments/possession.ts
// @source backend/trace/cloudflare-persistence.ts
// @source migrations/0011_payments.sql
// @source migrations/0100_effective_payment_wallets.sql
// @source tests/authorize-fixture-wallet.ts
// One actor/chain partition, a foreign caller, two wallet addresses, two
// immutable claim/challenge slots, two concurrent requests, and time 0..2.
// Signature validity abstracts the exact server message and cryptography.
// Each HTTP request captures `now` once; crossing expiry after a successful
// read does not change the timestamp used by its later consumption query.
// Registration is the atomic successful CAS outcome; competing registration
// retries and legacy claim admission are covered outside this refinement.
// No action signs, broadcasts, dispatches, or marks a payment paid.
module api_payment_wallet_protocol {
  type Challenge = {claim:int, address:int, expires:int, consumed:bool}
  type Request = {phase:int, claim:int, challenge:int, at:int}
  type State = {claims:List[int], challenges:List[Challenge], proofs:Set[int],
    authorized:int->int, requests:int->Request, result:int->int, now:int,
    registered:int, issued:int}
  val idle = {phase:0,claim:0,challenge:0,at:0}
  val absent = {claim:0,address:0,expires:0,consumed:false}
  var s:State
  action init = s'={claims:List(),challenges:List(),proofs:Set(),
    authorized:Map(1->0,2->0),requests:Map(1->idle,2->idle),
    result:Map(1->0,2->0),now:0,registered:0,issued:0}
  val tip = s.claims.length()
  def address(claim:int):int = if(claim>0 and claim<=tip) s.claims[claim-1] else 0
  def challenge(id:int):Challenge = if(id>0 and id<=s.challenges.length()) s.challenges[id-1] else absent
  val authorizedClaims = Set(1,2).filter(c => s.authorized.get(c)>0)
  val effective = if(authorizedClaims.size()==0) tip else authorizedClaims.fold(0,(a,c)=>if(c>a)c else a)
  action register(actor:int,wallet:int):bool = all {
    actor==1, wallet>0, wallet<=2, tip<2 or address(tip)==wallet,
    s'=if(address(tip)==wallet) s.with("registered",tip)
      else s.with("claims",s.claims.append(wallet)).with("registered",tip+1)
  }
  action foreignRegistration = s'=s.with("registered",0)
  action issue(actor:int,claim:int):bool = all {
    actor==1,claim==tip,claim>0,s.challenges.length()<2,
    s'=s.with("challenges",s.challenges.append({claim:claim,address:address(claim),expires:s.now+1,consumed:false}))
      .with("issued",s.challenges.length()+1)
  }
  action refuseIssue(actor:int,claim:int):bool = all {
    actor!=1 or claim!=tip or claim==0,s'=s.with("issued",0)
  }
  // `signer` identifies the wallet whose valid signature was submitted;
  // exactMessage=false includes altered actor/claim/digest/nonce/chain bytes.
  action read(q:int,actor:int,claim:int,id:int,signer:int,exactMessage:bool):bool = {
    val c=challenge(id)
    val valid=actor==1 and claim==tip and claim>0 and c.claim==claim
      and not(c.consumed) and c.expires>s.now and signer==c.address and exactMessage
    all {s.requests.get(q).phase==0,
      s'=if(valid)
        s.with("requests",s.requests.set(q,{phase:1,claim:claim,challenge:id,at:s.now}))
          .with("proofs",s.proofs.union(Set(id))).with("result",s.result.set(q,0))
        else s.with("result",s.result.set(q,403))}
  }
  action consume(q:int):bool = {
    val r=s.requests.get(q)
    val c=challenge(r.challenge)
    all {r.phase==1,
      s'=if(not(c.consumed) and c.expires>r.at)
        s.with("challenges",s.challenges.replaceAt(r.challenge-1,c.with("consumed",true)))
          .with("requests",s.requests.set(q,r.with("phase",2)))
        else s.with("requests",s.requests.set(q,idle)).with("result",s.result.set(q,409))}
  }
  // D1 batch is transactional. A failure leaves the preceding consumption
  // committed. Successful insertion checks currentness again and is once-only.
  action batch(q:int,success:bool):bool = {
    val r=s.requests.get(q)
    all {r.phase==2,
      s'=if(not(success)) s.with("requests",s.requests.set(q,idle)).with("result",s.result.set(q,503))
        else s.with("authorized",if(r.claim==tip and s.authorized.get(r.claim)==0)
          s.authorized.set(r.claim,r.challenge) else s.authorized)
          .with("requests",s.requests.set(q,r.with("phase",3)))}
  }
  action finish(q:int):bool = {
    val r=s.requests.get(q)
    all {r.phase==3,
      s'=s.with("requests",s.requests.set(q,idle))
        .with("result",s.result.set(q,if(s.authorized.get(r.claim)>0 and effective==r.claim) 200 else 409))}
  }
  action loseResponse(q:int):bool = all {s.requests.get(q).phase==3,
    s'=s.with("requests",s.requests.set(q,idle)).with("result",s.result.set(q,-1))}
  action tick = all {s.now<2,s'=s.with("now",s.now+1)}
  action chooseRead(q:int):bool = {
    nondet c=Set(1,2).oneOf()
    nondet id=Set(1,2).oneOf()
    read(q,1,c,id,address(c),true)
  }
  action requestStep(q:int):bool = any {
    chooseRead(q),read(q,2,1,1,1,true),consume(q),batch(q,true),
    batch(q,false),finish(q),loseResponse(q)
  }
  // All rejected signature/actor/message combinations have the same state
  // transition as the representative foreign-actor refusal above. Named
  // scenarios below call the individual wrong-message/address cases too.
  action step = any {register(1,1),register(1,2),foreignRegistration,
    issue(1,1),issue(1,2),refuseIssue(2,1),requestStep(1),requestStep(2),tick,s'=s}
  val invariant = all {
    tip<=2,s.challenges.length()<=2,s.now<=2,
    s.claims.indices().forall(i=>s.claims[i]>0 and s.claims[i]<=2),
    s.challenges.indices().forall(i=>{
      val c=s.challenges[i]
      c.claim>0 and c.claim<=tip and c.address==address(c.claim) and c.expires>0 and c.expires<=3}),
    authorizedClaims.forall(c=>{
      val id=s.authorized.get(c)
      challenge(id).claim==c and challenge(id).consumed and s.proofs.contains(id)}),
    s.proofs.forall(id=>id>0 and id<=s.challenges.length()),
    Set(1,2).forall(q=>{
      val r=s.requests.get(q)
      r.phase>0 implies (r.claim==challenge(r.challenge).claim and s.proofs.contains(r.challenge))}),
    authorizedClaims.size()>0 implies s.authorized.get(effective)>0
  }
  run sameWalletRegistrationIsIdempotentTest = init.then(register(1,1)).then(register(1,1))
    .expect(tip==1 and s.registered==1)
  run replacementRetainsClaimHistoryTest = init.then(register(1,1)).then(register(1,2))
    .expect(s.claims==List(1,2) and s.authorized.get(1)==0 and s.authorized.get(2)==0)
  run foreignActorCannotRegisterOrUseChallengeTest = init.then(foreignRegistration).then(register(1,1))
    .then(issue(1,1)).then(read(1,2,1,1,1,true))
    .expect(s.result.get(1)==403 and not(challenge(1).consumed))
  run wrongWalletAndAlteredMessageDoNotConsumeTest = init.then(register(1,1)).then(issue(1,1))
    .then(read(1,1,1,1,2,true)).then(read(1,1,1,1,1,false))
    .expect(s.result.get(1)==403 and not(challenge(1).consumed))
    .then(read(1,1,1,1,1,true)).then(consume(1)).then(batch(1,true)).then(finish(1))
    .expect(s.result.get(1)==200 and s.authorized.get(1)==1)
  run exactExpiryRefusesNewRequestTest = init.then(register(1,1)).then(issue(1,1)).then(tick)
    .then(read(1,1,1,1,1,true)).expect(s.result.get(1)==403 and not(challenge(1).consumed))
  run requestUsesCapturedTimeAcrossAwaitTest = init.then(register(1,1)).then(issue(1,1))
    .then(read(1,1,1,1,1,true)).then(tick).then(consume(1)).then(batch(1,true)).then(finish(1))
    .expect(s.result.get(1)==200)
  run consumedBeforeAuthorizationTest = init.then(register(1,1)).then(issue(1,1))
    .then(read(1,1,1,1,1,true)).then(consume(1))
    .expect(challenge(1).consumed and s.authorized.get(1)==0)
  run replacementDuringConsumedGapCannotAuthorizeOldClaimTest = init.then(register(1,1)).then(issue(1,1))
    .then(read(1,1,1,1,1,true)).then(consume(1)).then(register(1,2)).then(batch(1,true)).then(finish(1))
    .expect(s.result.get(1)==409 and s.authorized.get(1)==0 and challenge(1).consumed)
  run replacementAfterReadStillConsumesButCannotAuthorizeTest = init.then(register(1,1)).then(issue(1,1))
    .then(read(1,1,1,1,1,true)).then(register(1,2)).then(consume(1)).then(batch(1,true)).then(finish(1))
    .expect(s.result.get(1)==409 and challenge(1).consumed and authorizedClaims.size()==0)
  run failedBatchRequiresFreshChallengeTest = init.then(register(1,1)).then(issue(1,1))
    .then(read(1,1,1,1,1,true)).then(consume(1)).then(batch(1,false))
    .then(read(1,1,1,1,1,true)).expect(s.result.get(1)==403 and s.authorized.get(1)==0)
    .then(issue(1,1)).then(read(1,1,1,2,1,true)).then(consume(1)).then(batch(1,true)).then(finish(1))
    .expect(s.result.get(1)==200 and s.authorized.get(1)==2)
  run simultaneousReplayHasOneConsumptionWinnerTest = init.then(register(1,1)).then(issue(1,1))
    .then(read(1,1,1,1,1,true)).then(read(2,1,1,1,1,true)).then(consume(1)).then(consume(2))
    .expect(s.result.get(2)==409).then(batch(1,true)).then(finish(1)).expect(s.result.get(1)==200)
  run completedReplayIsRefusedTest = init.then(register(1,1)).then(issue(1,1))
    .then(read(1,1,1,1,1,true)).then(consume(1)).then(batch(1,true)).then(finish(1))
    .then(read(2,1,1,1,1,true)).expect(s.result.get(2)==403)
  run unsignedSuccessorRetainsAuthorizedDestinationTest = init.then(register(1,1)).then(issue(1,1))
    .then(read(1,1,1,1,1,true)).then(consume(1)).then(batch(1,true)).then(finish(1)).then(register(1,2))
    .expect(effective==1 and tip==2 and s.authorized.get(2)==0)
  run signedSuccessorBecomesEffectiveWithoutErasingHistoryTest = init.then(register(1,1)).then(issue(1,1))
    .then(read(1,1,1,1,1,true)).then(consume(1)).then(batch(1,true)).then(finish(1))
    .then(register(1,2)).then(issue(1,2)).then(read(1,1,2,2,2,true)).then(consume(1)).then(batch(1,true)).then(finish(1))
    .expect(effective==2 and s.authorized==Map(1->1,2->2) and s.claims==List(1,2))
  run newConsentCannotRewriteFirstAuthorizationTest = init.then(register(1,1)).then(issue(1,1))
    .then(read(1,1,1,1,1,true)).then(consume(1)).then(batch(1,true)).then(finish(1))
    .then(issue(1,1)).then(read(1,1,1,2,1,true)).then(consume(1)).then(batch(1,true)).then(finish(1))
    .expect(s.result.get(1)==200 and s.authorized.get(1)==1 and challenge(2).consumed)
  run lostResponseRetainsAuthorizationTest = init.then(register(1,1)).then(issue(1,1))
    .then(read(1,1,1,1,1,true)).then(consume(1)).then(batch(1,true)).then(loseResponse(1))
    .expect(s.result.get(1)==-1 and s.authorized.get(1)==1 and effective==1)
  run oldClaimAndMismatchedChallengeRefusedTest = init.then(register(1,1)).then(issue(1,1))
    .then(register(1,2)).then(issue(1,2)).then(refuseIssue(1,1))
    .then(read(1,1,1,1,1,true)).then(read(1,1,2,1,1,true))
    .expect(s.result.get(1)==403 and not(challenge(1).consumed) and not(challenge(2).consumed))
}
