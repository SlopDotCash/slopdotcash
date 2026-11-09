// @source src/lib/verified-money.ts
// @source contracts/solana/funding.ts
// @source src/lib/solana-vault-actions.ts
// @source contracts/solana/commitment.ts
// @source contracts/solana/native.ts
// @source src/lib/solana-commitment-actions.ts
// @source src/lib/monthly-commitment-actions.ts
// @source src/lib/monthly-release-actions.ts
// @source src/lib/solana-wire.ts
// Reviewed instruction bytes, wallet signature and finalized deltas are distinct stages.
module solana_owner_action {
  type S={operation:str,owner:bool,deployment:bool,asset:bool,funds:bool,phase:str,exact:bool}
  var s:S
  action init=s'={operation:"deposit",owner:false,deployment:false,asset:false,funds:false,phase:"input",exact:false}
  action inspect(operation:str,owner:bool,deployment:bool,asset:bool,funds:bool):bool=all{s.phase=="input",
    s'={operation:operation,owner:owner,deployment:deployment,asset:asset,funds:funds,phase:"input",exact:false}}
  action prepare=all{s.phase=="input",s.deployment,s.asset,s.funds,(s.operation=="deposit" or s.owner),s'=s.with("phase","reviewed")}
  action walletSigns=all{s.phase=="reviewed",s'=s.with("phase","submitted")}
  action finalized(exact:bool):bool=all{s.phase=="submitted",s'=s.with("phase",if(exact) "finalized" else "refused").with("exact",exact)}
  action step=any{inspect("deposit",false,true,true,true),inspect("withdraw",false,true,true,true),inspect("withdraw",true,true,true,true),
    inspect("commit",true,true,true,true),inspect("withdraw",true,true,true,false),prepare,walletSigns,finalized(true),finalized(false),s'=s}
  val invariant=all{s.phase=="finalized" implies s.exact,s.phase!="input" implies(s.deployment and s.asset and s.funds and(s.operation=="deposit" or s.owner))}
  run publicDepositTest=init.then(inspect("deposit",false,true,true,true)).then(prepare).then(walletSigns).then(finalized(true)).expect(invariant)
  run nonOwnerWithdrawTest=init.then(inspect("withdraw",false,true,true,true)).then(prepare.fail())
  run reservedNotFreeTest=init.then(inspect("withdraw",true,true,true,false)).then(prepare.fail())
  run wrongDeltasTest=init.then(inspect("commit",true,true,true,true)).then(prepare).then(walletSigns).then(finalized(false)).expect(s.phase=="refused" and invariant)
}
