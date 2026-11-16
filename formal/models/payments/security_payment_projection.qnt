// @source backend/security/payments.ts
// @source backend/security/handler.ts
// @source workers/security-payments/index.ts
// @evidence backend/security/handler.test.ts
// One private award, two append-ordered attempts (including equal timestamps),
// one old and one current authorized wallet claim. Retirement changes the
// actual attempt state. Chain finality remains an independently verified input.
module security_payment_projection {
  var s: {obligation:str, queue:str, attempts:List[str], transactions:List[int],
    claims:List[int], currentClaim:int, walletAuthorized:bool, owner:bool}
  action init = s'={obligation:"absent",queue:"absent",attempts:List(),
    transactions:List(),claims:List(),currentClaim:1,walletAuthorized:false,owner:false}
  val latest = if(s.attempts.length()==0) "none" else s.attempts.nth(s.attempts.length()-1)
  val oldClaimPending = s.attempts.indices().exists(i =>
    Set("prepared","unknown","submitted").contains(s.attempts.nth(i)) and s.claims.nth(i)!=s.currentClaim)
  val displayed = if(s.obligation=="paid") "paid"
    else if(s.obligation=="absent") "awaiting-owner-commitment"
    else if(s.queue=="held") "held"
    else if(Set("prepared","unknown").contains(latest)) "uncertain"
    else if(s.queue=="absent") "needs-wallet" else s.queue
  val knownTransaction = s.transactions.foldl(0,(last,tx)=>if(tx==0) last else tx)
  val nextAction = if(displayed=="paid") "none"
    else if(displayed=="held") "held"
    else if(displayed=="needs-wallet") "register-wallet"
    else if(displayed=="awaiting-owner-commitment") (if(s.owner) "sign-commitment" else "wait-owner")
    else "in-progress"
  action owner = s'=s.with("owner",true)
  action authorizeWallet = s'=s.with("walletAuthorized",true)
  action commit = all{s.obligation=="absent",s'=s.with("obligation","reserved")}
  action appendAttempt(state,tx) = all{s.obligation=="reserved",s.walletAuthorized,not(oldClaimPending),s.attempts.length()<2,
    s'=s.with("attempts",s.attempts.append(state)).with("transactions",s.transactions.append(tx))
      .with("claims",s.claims.append(s.currentClaim))}
  action queue(state) = all{s.obligation=="reserved",state!="ready" or not(oldClaimPending),
    s'=s.with("queue",state)}
  action changeWallet = all{s.obligation=="reserved",s.walletAuthorized,s.currentClaim==1,
    s.attempts.indices().exists(i=>Set("prepared","unknown","submitted").contains(s.attempts.nth(i))),
    s'=s.with("currentClaim",2).with("queue","held")}
  action retireOld = {
    nondet i = Set(0,1).oneOf()
    all{i<s.attempts.length(),s.claims.nth(i)!=s.currentClaim,
      Set("prepared","unknown","submitted").contains(s.attempts.nth(i)),
      s'=s.with("attempts",s.attempts.replaceAt(i,"failed"))}
  }
  action cron = all{s.obligation=="reserved",s.walletAuthorized,not(oldClaimPending),
    s'=if(Set("absent","held").contains(s.queue)) s.with("queue","ready") else s}
  action finalPayment = all{s.obligation=="reserved",s'=s.with("obligation","paid")}
  action step = {nondet state=Set("prepared","unknown","submitted","failed").oneOf()
    nondet tx=Set(0,1).oneOf() nondet q=Set("ready","held").oneOf()
    any{owner,authorizeWallet,commit,appendAttempt(state,tx),queue(q),changeWallet,retireOld,cron,finalPayment,s'=s}}
  val invariant = all{
    s.attempts.length()==s.transactions.length(),s.attempts.length()==s.claims.length(),s.attempts.length()<=2,
    s.obligation=="paid" implies displayed=="paid",
    s.obligation=="reserved" and s.queue=="held" implies displayed=="held" and nextAction=="held",
    displayed=="uncertain" implies s.queue!="held" and Set("prepared","unknown").contains(latest),
    displayed=="needs-wallet" implies nextAction=="register-wallet"
  }
  run heldOverridesUnknownTest = init.then(commit).then(authorizeWallet).then(appendAttempt("unknown",1)).then(changeWallet).expect(displayed=="held" and nextAction=="held")
  run heldOverridesPreparedTest = init.then(commit).then(authorizeWallet).then(appendAttempt("prepared",0)).then(changeWallet).expect(displayed=="held")
  run readyUnknownRemainsUncertainTest = init.then(commit).then(authorizeWallet).then(queue("ready")).then(appendAttempt("unknown",0)).expect(displayed=="uncertain")
  run priorClaimKeepsCronHeldTest = init.then(commit).then(authorizeWallet).then(appendAttempt("unknown",1)).then(changeWallet).then(cron.fail())
  run retiredPriorClaimCanResumeTest = init.then(commit).then(authorizeWallet).then(appendAttempt("unknown",1)).then(changeWallet).then(retireOld).then(cron).expect(s.queue=="ready" and displayed=="ready")
  run missingWalletHasActionTest = init.then(commit).expect(displayed=="needs-wallet" and nextAction=="register-wallet")
  run missingWalletCannotWakeQueueTest = init.then(commit).then(cron.fail())
  run ownerCommitmentHasActionTest = init.then(owner).expect(nextAction=="sign-commitment")
  run sameTimeReplacementIsLatestTest = init.then(commit).then(authorizeWallet).then(appendAttempt("failed",1)).then(appendAttempt("unknown",0)).then(queue("ready")).expect(displayed=="uncertain" and knownTransaction==1)
  run olderOpenAttemptStillBlocksCronTest = init.then(commit).then(authorizeWallet).then(appendAttempt("unknown",1)).then(appendAttempt("failed",0)).then(changeWallet).then(cron.fail())
  run paidProofOverridesOldHoldTest = init.then(commit).then(authorizeWallet).then(appendAttempt("unknown",1)).then(changeWallet).then(finalPayment).expect(displayed=="paid" and invariant)
}
