// @source backend/payments/chain-awards.ts
// @source backend/payments/monthly.ts
// @source backend/payments/handler.ts
// A public digest alone is insufficient: existing actor/gross/fee must all match.
// Fee is an abstract accepted-fee predicate (historical floor or current ceil).
// monthly.test.ts exercises both account projections against migrated SQLite.
module monthly_source_conflict {
  type S={existing:bool,actor:bool,gross:bool,fee:bool,chain:str,state:str,free:int,read:bool,visible:bool}
  var s:S
  action init=s'={existing:false,actor:false,gross:false,fee:false,chain:"evm",state:"awaiting",free:0,read:false,visible:false}
  action inspect(existing:bool,actor:bool,gross:bool,fee:bool,chain:str):bool=
    s'={existing:existing,actor:actor,gross:gross,fee:fee,chain:chain,state:"awaiting",free:0,read:false,visible:false}
  val matches=s.existing and s.actor and s.gross and s.fee
  action account=s'=s.with("read",true).with("visible",not(matches))
  action classify=s'=s.with("state",if(s.existing and not(matches)) "conflict" else if(matches and s.chain=="evm") "reserved" else "underfunded")
  action fund=s'=s.with("free",3)
  action reserve=all{s.state=="underfunded",s.free>=3,s'=s.with("state","reserved").with("free",0)}
  action choices={nondet e=Set(true,false).oneOf() nondet a=Set(true,false).oneOf() nondet g=Set(true,false).oneOf() nondet f=Set(true,false).oneOf()
    nondet chain=Set("evm","solana").oneOf() inspect(e,a,g,f,chain)}
  action step=any{choices,classify,account,fund,reserve,s'=s}
  val invariant=all{s.state=="conflict" implies(s.existing and not(matches)),s.read implies(s.visible==not(matches))}
  run differentActorRefusedTest=init.then(inspect(true,false,true,true,"evm")).then(classify).expect(s.state=="conflict" and invariant)
  run evmMatchingNeedsNoNewFundsTest=init.then(inspect(true,true,true,true,"evm")).then(classify).expect(s.state=="reserved" and s.free==0 and invariant)
  run solanaWholeMonthNeedsFundsTest=init.then(inspect(true,true,true,true,"solana")).then(classify).then(reserve.fail())
  run wrongFeeRemainsVisibleTest=init.then(inspect(true,true,true,false,"evm")).then(classify).then(account).expect(s.state=="conflict" and s.visible and invariant)
  run matchingFeeReplacesAwardTest=init.then(inspect(true,true,true,true,"evm")).then(account).expect(not(s.visible) and invariant)
  run unreservedAwardRemainsVisibleTest=init.then(account).expect(s.visible and invariant)
}
