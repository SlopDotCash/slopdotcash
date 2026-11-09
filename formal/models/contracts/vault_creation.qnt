// @source contracts/solana/owner-creation.ts
// @source src/lib/vault-setup.ts
// @source src/lib/solana-wire.ts
// @source backend/projects/vault-setup.ts
// @source contracts/solana/owner-instructions.ts
// @source contracts/solana/programs.ts
// @source contracts/evm/factories.ts
// @source contracts/evm/src/ProjectEscrow.sol
// Reviewed infrastructure, derived vault identity, wallet creation and registration.
module vault_creation {
  type S={reviewed:bool,existing:str,phase:str,signed:bool,finalized:bool}
  var s:S
  action init=s'={reviewed:false,existing:"absent",phase:"input",signed:false,finalized:false}
  action review=s'=s.with("reviewed",true)
  action existing(matches:bool):bool=all{s.phase=="input",s'=s.with("existing",if(matches) "matching" else "conflict")}
  action plan=all{s.reviewed,s.phase=="input",s.existing=="absent",s'=s.with("phase","planned")}
  action sign=all{s.phase=="planned",s'=s.with("signed",true).with("phase","submitted")}
  action finalized=all{s.signed,s'=s.with("finalized",true)}
  action register=all{s.reviewed,(s.existing=="matching" or s.finalized),s'=s.with("phase","registered")}
  action step=any{review,existing(true),existing(false),plan,sign,finalized,register,s'=s}
  val invariant=s.phase=="registered" implies(s.reviewed and(s.existing=="matching" or(s.finalized and s.signed)))
  run matchingExistingTest=init.then(review).then(existing(true)).then(register).expect(not(s.signed) and invariant)
  run conflictingExistingTest=init.then(review).then(existing(false)).then(plan.fail())
  run createdTest=init.then(review).then(plan).then(sign).then(finalized).then(register).expect(invariant)
}
