// @source src/SolanaBountyRecovery.tsx
// @source src/SecurityBounty.tsx
// @source src/lib/use-action.ts
// One actor/case/generation-bound cache, two expired messages, at most four
// wallet prompts and two verification requests. Bounds disable further steps;
// they are not application retry limits. Foreign-key
// and wrong-body entries never satisfy the current exact-message cache lookup.
// Parent authorization includes its mounted/actor/generation/message fences.
// Wallet return precedes cache write; this component never sends or marks paid.
module ui_solana_history_recovery {
  var s: { phase:str, mounted:bool, actor:int, captured:int, generation:int,
    bodyVersion:int, allowed:bool, wallet:bool, index:int, saved:Set[int],
    wrongBody:Set[int], foreignCache:bool, signatures:Set[int], prompts:int,
    verifyRequests:int, verifiedAuthority:bool, cacheValid:bool }
  action init = s'={phase:"idle",mounted:true,actor:1,captured:0,generation:1,
    bodyVersion:1,allowed:true,wallet:false,index:1,saved:Set(),wrongBody:Set(),
    foreignCache:false,signatures:Set(),prompts:0,verifyRequests:0,
    verifiedAuthority:false,cacheValid:true}
  val fence = s.mounted and s.actor==1 and s.generation==1
    and s.bodyVersion==1 and s.allowed
  val canBegin = s.phase=="idle" or s.phase=="error"
  action connect = all {canBegin,s.mounted,
    s'=s.with("phase",if(fence) "connecting" else "error")}
  action walletReturns(valid:bool):bool = all {s.phase=="connecting",
    s'=s.with("wallet",valid).with("phase",if(valid) "idle" else "error")}
  action start = all {canBegin,s.mounted,s.wallet,
    s'=s.with("phase","identity").with("signatures",Set()).with("index",1)}
  action captureIdentity = all {s.phase=="identity",
    s'=if(s.actor!=0) s.with("captured",s.actor).with("phase","cache-read")
      else s.with("phase","error")}
  action readCache = all {s.phase=="cache-read",
    s'=s.with("phase",if(s.cacheValid) "preflight" else "error")}
  action preflight = all {s.phase=="preflight",
    not(fence) or s.actor!=s.captured or s.prompts<4
      or (s.saved.contains(s.index) and not(s.wrongBody.contains(s.index))),
    s'=if(fence and s.actor==s.captured)
      if(s.saved.contains(s.index) and not(s.wrongBody.contains(s.index)))
        s.with("signatures",s.signatures.union(Set(s.index))).with("phase","advance")
      else s.with("phase","signing").with("prompts",s.prompts+1)
      else s.with("phase","error")}
  // A wallet prompt cannot be canceled by this component. A returned signature
  // may still be cached under the old key after unmount; it grants no authority.
  action signatureReturns(success:bool):bool = all {s.phase=="signing",
    s'=s.with("phase",if(success) "cache-write" else "error")}
  action cacheWrite(success:bool):bool = all {s.phase=="cache-write",
    s'=if(success) s.with("saved",s.saved.union(Set(s.index)))
      .with("wrongBody",s.wrongBody.exclude(Set(s.index)))
      .with("signatures",s.signatures.union(Set(s.index))).with("phase","advance")
      else s.with("phase","error")}
  action advance = all {s.phase=="advance",
    s'=if(s.index==1) s.with("index",2).with("phase","preflight")
      else s.with("phase","final-authorize")}
  action finalAuthorize = all {s.phase=="final-authorize",
    s'=if(fence) s.with("phase","verify-preflight").with("verifiedAuthority",true)
      else s.with("phase","error")}
  // The final private POST rechecks actor/mount, while the server checks the
  // captured revision. A generation can change after authorize and before POST.
  action dispatch = all {s.phase=="verify-preflight",
    not(s.mounted) or s.actor!=1 or s.verifyRequests<2,
    s'=if(s.mounted and s.actor==1) s.with("phase","verify-pending")
      .with("verifyRequests",s.verifyRequests+1) else s.with("phase","error")}
  action verifyReturns(success:bool):bool = all {s.phase=="verify-pending",
    s'=s.with("phase",if(success and fence) "idle" else "error")}
  action accountChanges = s'=s.with("actor",2)
  action signOut = s'=s.with("actor",0)
  action generationChanges = s'=s.with("generation",2)
  action messagesChange = s'=s.with("bodyVersion",2)
  action accessLost = s'=s.with("allowed",false)
  action unmount = s'=s.with("mounted",false)
  action seedCache(entries:Set[int],wrong:Set[int]):bool = all {
    s.phase=="idle",s.prompts==0,s.verifyRequests==0,
    s'=s.with("saved",entries).with("wrongBody",wrong)}
  action seedForeignCache = all {s.phase=="idle",s'=s.with("foreignCache",true)}
  action corruptCache = all {s.phase=="idle",s'=s.with("cacheValid",false)}
  action step = any {connect,walletReturns(true),walletReturns(false),start,
    captureIdentity,readCache,preflight,signatureReturns(true),signatureReturns(false),
    cacheWrite(true),cacheWrite(false),advance,finalAuthorize,dispatch,verifyReturns(true),
    verifyReturns(false),accountChanges,signOut,generationChanges,messagesChange,
    accessLost,unmount,s'=s}
  val invariant = all {s.index>=1,s.index<=2,
    s.signatures.subseteq(Set(1,2)),s.saved.subseteq(Set(1,2)),
    s.verifyRequests>0 implies s.verifiedAuthority,
    s.phase=="verify-pending" implies s.signatures==Set(1,2),
    s.prompts>=0,s.prompts<=4,s.verifyRequests>=0,s.verifyRequests<=2}
  // These are state snapshots, not alternative production initialization.
  action connected = s'=s.with("wallet",true)
  action begin = all {s.phase=="idle",s.wallet,
    s'=s.with("phase","preflight").with("captured",s.actor)}
  run wrongPayerCannotConnectTest = init.then(connect).then(walletReturns(false))
    .expect(not(s.wallet) and s.phase=="error")
  run validOriginalPayerConnectsTest = init.then(connect).then(walletReturns(true))
    .expect(s.wallet and s.phase=="idle")
  run matchingCacheNeedsNoWalletPromptTest = init.then(connected)
    .then(seedCache(Set(1,2),Set())).then(begin).then(preflight).then(advance)
    .then(preflight).then(advance).then(finalAuthorize).then(dispatch)
    .expect(s.prompts==0 and s.verifyRequests==1)
  run foreignCacheCannotAvoidSigningTest = init.then(connected).then(seedForeignCache)
    .then(begin).then(preflight).expect(s.phase=="signing" and s.prompts==1)
  run alteredMessageCacheCannotAvoidSigningTest = init.then(connected)
    .then(seedCache(Set(1),Set(1))).then(begin).then(preflight)
    .expect(s.phase=="signing")
  run malformedCacheStopsBeforePromptTest = init.then(connected).then(corruptCache)
    .then(start).then(captureIdentity).then(readCache)
    .expect(s.phase=="error" and s.prompts==0)
  run signThenCacheFailureIsVisibleTest = init.then(connected).then(begin)
    .then(preflight).then(signatureReturns(true)).then(cacheWrite(false))
    .expect(s.phase=="error" and s.saved==Set() and s.verifyRequests==0)
  run partialCacheSurvivesSecondPromptRefusalTest = init.then(connected).then(begin)
    .then(preflight).then(signatureReturns(true)).then(cacheWrite(true)).then(advance)
    .then(preflight).then(signatureReturns(false))
    .expect(s.saved==Set(1) and s.phase=="error" and s.verifyRequests==0)
  run actorChangeAfterCaptureRefusesPromptTest = init.then(connected).then(begin)
    .then(accountChanges).then(preflight).expect(s.phase=="error" and s.prompts==0)
  run unmountDuringPromptMayCacheButCannotVerifyTest = init.then(connected).then(begin)
    .then(preflight).then(unmount).then(signatureReturns(true)).then(cacheWrite(true))
    .then(advance).then(preflight).expect(s.saved==Set(1) and s.verifyRequests==0)
  run generationChangeBeforeFinalAuthorizeRefusesRequestTest = init.then(connected)
    .then(seedCache(Set(1,2),Set())).then(begin).then(preflight).then(advance)
    .then(preflight).then(advance).then(generationChanges).then(finalAuthorize)
    .expect(s.verifyRequests==0 and s.phase=="error")
  run verificationFailureKeepsCacheForRetryTest = init.then(connected)
    .then(seedCache(Set(1,2),Set())).then(begin).then(preflight).then(advance)
    .then(preflight).then(advance).then(finalAuthorize).then(dispatch).then(verifyReturns(false))
    .expect(s.phase=="error" and s.saved==Set(1,2) and s.prompts==0)
  run revisionChangeAfterAuthorizationStillNeedsServerCheckTest = init.then(connected)
    .then(seedCache(Set(1,2),Set())).then(begin).then(preflight).then(advance)
    .then(preflight).then(advance).then(finalAuthorize).then(generationChanges)
    .then(dispatch).then(verifyReturns(true)).expect(s.verifyRequests==1 and s.phase=="error")
}
