// @source migrations/0089_referral_claim_cache.sql
// @source backend/referrals/cache.ts
// @source backend/referrals/claims.ts
// @source workers/referral-accrual/index.ts
// Unknown is not zero; a failed refresh retains the last verified snapshot as stale.
module referral_claim_cache {
  type S={activated:bool,cached:bool,fresh:bool,amount:int,paused:bool,claimable:bool}
  var s:S
  action init=s'={activated:false,cached:false,fresh:false,amount:0,paused:false,claimable:false}
  action activate=s'=s.with("activated",true)
  action refresh(amount:int,paused:bool):bool=all{s.activated,s'=s.with("cached",true).with("fresh",true).with("amount",amount).with("paused",paused).with("claimable",not(paused) and amount>0)}
  action failRefresh=s'=s.with("fresh",false).with("claimable",false)
  action step=any{activate,refresh(0,false),refresh(2,false),refresh(2,true),failRefresh,s'=s}
  val invariant=all{s.claimable implies(s.cached and s.fresh and not(s.paused) and s.amount>0),not(s.cached) implies s.amount==0}
  run staleRetainsTest=init.then(activate).then(refresh(2,false)).then(failRefresh).expect(s.cached and s.amount==2 and not(s.claimable) and invariant)
  run neverActivatedNotReadTest=init.then(refresh(2,false).fail())
  run pausedNotClaimableTest=init.then(activate).then(refresh(2,true)).expect(not(s.claimable) and invariant)
}
