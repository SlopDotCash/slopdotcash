// @source src/Earnings.tsx
// @source backend/payments/handler.ts
// @source backend/payments/wallet-registration.ts
// @source backend/http.ts
// @evidence tests/e2e/earnings-wallet-lifetime.spec.ts
// @evidence backend/payments/wallet-replacement.test.ts
// One initiated wallet flow, two actors and two family chains. The existing
// ui_earnings_wallet_lifetime model covers multiple operation identities and
// departure. Signature validity, account parsing and D1 atomicity are external
// predicates. These new scenarios have not been executed.
module ui_earnings_actor_binding {
  var s:{mounted:bool,cookie:int,dataActor:int,actor:int,phase:str,chain:int,
    registered:Set[int],authorized:Set[int],prompts:Set[int],error:bool,
    readActor:int,reading:bool}
  action init=s'={mounted:true,cookie:1,dataActor:1,actor:0,phase:"idle",chain:1,
    registered:Set(),authorized:Set(),prompts:Set(),error:false,readActor:0,reading:false}
  def key(actor:int,chain:int):int=actor*10+chain
  action cookieChanges(actor:int):bool=all{actor>=0,actor<=2,s'=s.with("cookie",actor)}
  action begin=all{s.mounted,s.dataActor>0,s.actor==0,
    s'=s.with("actor",s.dataActor).with("phase","connect-check").with("error",false)}
  // Each client check is a fresh session observation. A network outage stops
  // the flow; an observed different/null actor additionally clears old data.
  action checkActor(available:bool):bool={
    val nextPhase=if(s.phase=="connect-check")"connecting"
      else if(s.phase=="register-check")"register-ready"
      else if(s.phase=="challenge-check")"challenge-ready"
      else if(s.phase=="sign-check")"sign-ready"
      else if(s.phase=="authorize-check")"authorize-ready" else "next-ready"
    all{s.mounted,Set("connect-check","register-check","challenge-check","sign-check","authorize-check","next-check").contains(s.phase),
      s'=if(not(available))s.with("phase","stopped").with("error",true)
      else if(s.cookie!=s.actor)s.with("phase","stopped").with("dataActor",0).with("error",true)
      else s.with("phase",nextPhase)}
  }
  action connectReply=all{s.mounted,s.phase=="connecting",s'=s.with("phase","register-check")}
  action requestRegistration=all{s.mounted,s.phase=="register-ready",s'=s.with("phase","register-http")}
  // requireActor consumes the captured UI actor header before registration.
  // A request already accepted for A stays an A fact after the cookie changes.
  action admitRegistration=all{s.phase=="register-http",
    s'=if(s.cookie==s.actor)s.with("registered",s.registered.union(Set(key(s.actor,s.chain)))).with("phase","register-reply")
      else s.with("phase","refused")}
  action registrationReply=all{s.mounted,s.phase=="register-reply",s'=s.with("phase","challenge-check")}
  action requestChallenge=all{s.mounted,s.phase=="challenge-ready",s'=s.with("phase","challenge-http")}
  action admitChallenge=all{s.phase=="challenge-http",
    s'=if(s.cookie==s.actor and s.registered.contains(key(s.actor,s.chain)))s.with("phase","challenge-reply")
      else s.with("phase","refused")}
  action challengeReply=all{s.mounted,s.phase=="challenge-reply",s'=s.with("phase","sign-check")}
  action sign=all{s.mounted,s.phase=="sign-ready",
    s'=s.with("prompts",s.prompts.union(Set(key(s.actor,s.chain)))).with("phase","signing")}
  action signatureReply=all{s.mounted,s.phase=="signing",s'=s.with("phase","authorize-check")}
  action requestAuthorization=all{s.mounted,s.phase=="authorize-ready",s'=s.with("phase","authorize-http")}
  action admitAuthorization=all{s.phase=="authorize-http",
    s'=if(s.cookie==s.actor and s.registered.contains(key(s.actor,s.chain)) and s.prompts.contains(key(s.actor,s.chain)))
        s.with("authorized",s.authorized.union(Set(key(s.actor,s.chain)))).with("phase","authorize-reply")
      else s.with("phase","refused")}
  action authorizationReply=all{s.mounted,s.phase=="authorize-reply",s'=s.with("phase","next-check")}
  action nextChain=all{s.mounted,s.phase=="next-ready",s.chain==1,
    s'=s.with("chain",2).with("phase","register-check")}
  action done=all{s.mounted,s.phase=="next-ready",s.chain==2,s'=s.with("phase","done")}
  action refusalReply=all{s.mounted,s.phase=="refused",s'=s.with("phase","stopped").with("dataActor",0).with("error",true)}
  action depart=s'=s.with("mounted",false)
  // The /me response and final session read are separate. A mismatched read
  // cannot keep A's prior private account, even if the wallet flow is idle.
  action startRead=all{s.mounted,not(s.reading),s.cookie>0,s'=s.with("reading",true).with("readActor",s.cookie)}
  action finishRead=all{s.mounted,s.reading,
    s'=if(s.cookie!=s.readActor)s.with("reading",false).with("dataActor",0).with("phase","stopped").with("error",true)
      else s.with("reading",false).with("dataActor",s.readActor)
        .with("phase",if(s.dataActor>0 and s.dataActor!=s.readActor)"stopped" else s.phase)}
  action step={nondet actor=Set(0,1,2).oneOf() nondet available=Set(false,true).oneOf()
    any{cookieChanges(actor),begin,checkActor(available),connectReply,requestRegistration,admitRegistration,
      registrationReply,requestChallenge,admitChallenge,challengeReply,sign,signatureReply,
      requestAuthorization,admitAuthorization,authorizationReply,nextChain,done,refusalReply,depart,startRead,finishRead,s'=s}}
  val invariant=all{s.chain>=1,s.chain<=2,
    s.authorized.subseteq(s.registered),s.authorized.subseteq(s.prompts),
    s.registered.forall(entry=>entry==key(s.actor,1) or entry==key(s.actor,2))}
  run connectionReturnAfterActorSwapStopsTest=init.then(begin).then(checkActor(true)).then(cookieChanges(2))
    .then(connectReply).then(checkActor(true)).expect(s.phase=="stopped" and s.dataActor==0 and s.registered==Set())
  run headerCatchesSwapAfterFreshCheckTest=init.then(begin).then(checkActor(true)).then(connectReply)
    .then(checkActor(true)).then(cookieChanges(2)).then(requestRegistration).then(admitRegistration).then(refusalReply)
    .expect(s.dataActor==0 and s.registered==Set())
  run acceptedRegistrationIsRetainedOnSwapTest=init.then(begin).then(checkActor(true)).then(connectReply)
    .then(checkActor(true)).then(requestRegistration).then(admitRegistration).then(cookieChanges(2))
    .then(registrationReply).then(checkActor(true)).expect(s.registered==Set(11) and s.prompts==Set() and s.dataActor==0)
  run changedChallengeActorCannotSignTest=init.then(begin).then(checkActor(true)).then(connectReply)
    .then(checkActor(true)).then(requestRegistration).then(admitRegistration).then(registrationReply)
    .then(checkActor(true)).then(requestChallenge).then(admitChallenge).then(cookieChanges(2))
    .then(challengeReply).then(checkActor(true)).expect(s.prompts==Set() and s.dataActor==0)
  run lateSignatureCannotAuthorizeBTest=init.then(begin).then(checkActor(true)).then(connectReply)
    .then(checkActor(true)).then(requestRegistration).then(admitRegistration).then(registrationReply)
    .then(checkActor(true)).then(requestChallenge).then(admitChallenge).then(challengeReply).then(checkActor(true))
    .then(sign).then(cookieChanges(2)).then(signatureReply).then(checkActor(true)).expect(s.authorized==Set() and s.dataActor==0)
  run acceptedAAuthorizationCannotStartBChainTest=init.then(begin).then(checkActor(true)).then(connectReply)
    .then(checkActor(true)).then(requestRegistration).then(admitRegistration).then(registrationReply)
    .then(checkActor(true)).then(requestChallenge).then(admitChallenge).then(challengeReply).then(checkActor(true))
    .then(sign).then(signatureReply).then(checkActor(true)).then(requestAuthorization).then(admitAuthorization)
    .then(cookieChanges(2)).then(authorizationReply).then(checkActor(true))
    .expect(s.authorized==Set(11) and s.chain==1 and s.dataActor==0)
  run signOutClearsAccountBeforePromptTest=init.then(begin).then(cookieChanges(0)).then(checkActor(true))
    .expect(s.dataActor==0 and s.prompts==Set() and s.phase=="stopped")
  run unavailableSessionDoesNotAdvanceTest=init.then(begin).then(checkActor(false))
    .expect(s.phase=="stopped" and s.registered==Set() and s.prompts==Set())
  run differentAccountReadClearsOldDataTest=init.then(startRead).then(cookieChanges(2)).then(finishRead)
    .expect(s.dataActor==0 and s.error)
  run sameAccountMayAuthorizeTest=init.then(begin).then(checkActor(true)).then(connectReply)
    .then(checkActor(true)).then(requestRegistration).then(admitRegistration).then(registrationReply)
    .then(checkActor(true)).then(requestChallenge).then(admitChallenge).then(challengeReply).then(checkActor(true))
    .then(sign).then(signatureReply).then(checkActor(true)).then(requestAuthorization).then(admitAuthorization)
    .then(authorizationReply).then(checkActor(true)).then(nextChain)
    .expect(s.authorized==Set(11) and s.phase=="register-check" and s.chain==2)
}
