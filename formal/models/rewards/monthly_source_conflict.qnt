// @source backend/payments/chain-awards.ts
// @source backend/payments/monthly.ts
// A public digest alone is insufficient: existing actor/gross/fee must all match.
module monthly_source_conflict {
  type S={existing:bool,actor:bool,gross:bool,fee:bool,chain:str,state:str,free:int}
  var s:S
  action init=s'={existing:false,actor:false,gross:false,fee:false,chain:"evm",state:"awaiting",free:0}
  action inspect(existing:bool,actor:bool,gross:bool,fee:bool,chain:str):bool=
    s'={existing:existing,actor:actor,gross:gross,fee:fee,chain:chain,state:"awaiting",free:0}
  val matches=s.existing and s.actor and s.gross and s.fee
  action classify=s'=s.with("state",if(s.existing and not(matches)) "conflict" else if(matches and s.chain=="evm") "reserved" else "underfunded")
  action fund=s'=s.with("free",3)
  action reserve=all{s.state=="underfunded",s.free>=3,s'=s.with("state","reserved").with("free",0)}
  action choices={nondet e=Set(true,false).oneOf() nondet a=Set(true,false).oneOf() nondet g=Set(true,false).oneOf() nondet f=Set(true,false).oneOf()
    nondet chain=Set("evm","solana").oneOf() inspect(e,a,g,f,chain)}
  action step=any{choices,classify,fund,reserve,s'=s}
  val invariant=s.state=="conflict" implies(s.existing and not(matches))
  run differentActorRefusedTest=init.then(inspect(true,false,true,true,"evm")).then(classify).expect(s.state=="conflict" and invariant)
  run evmMatchingNeedsNoNewFundsTest=init.then(inspect(true,true,true,true,"evm")).then(classify).expect(s.state=="reserved" and s.free==0 and invariant)
  run solanaWholeMonthNeedsFundsTest=init.then(inspect(true,true,true,true,"solana")).then(classify).then(reserve.fail())
}
