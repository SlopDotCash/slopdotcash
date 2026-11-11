// @source scripts/readme-proof-binding.ts
// README login reuse cannot create actor authority. Only exact prior canonical
// proof bytes keyed by actor ID or the exact legacy pin qualify.
module readme_proof_binding {
  type S={actor:int,proof:int,prior:int,legacy:bool,loginReused:bool,bound:bool}
  var s:S
  action init=s'={actor:1,proof:1,prior:1,legacy:false,loginReused:false,bound:false}
  action choose(actor:int,proof:int,prior:int,legacy:bool,reused:bool):bool=all{not(s.bound),s'={actor:actor,proof:proof,prior:prior,legacy:legacy,loginReused:reused,bound:false}}
  action bind=all{(s.actor==1 and s.proof==s.prior and s.prior>0) or s.legacy,s'=s.with("bound",true)}
  action step=any{choose(1,1,1,false,false),choose(2,1,0,false,true),choose(1,2,1,false,false),choose(2,1,0,true,false),bind,s'=s}
  val invariant=s.bound implies (s.actor==1 and s.proof==s.prior and s.prior>0) or s.legacy
  run frozenProofSurvivesRenameTest=init.then(choose(1,1,1,false,true)).then(bind).expect(invariant)
  run reusedLoginNotAuthorityTest=init.then(choose(2,1,0,false,true)).then(bind.fail())
  run alteredProofRefusedTest=init.then(choose(1,2,1,false,false)).then(bind.fail())
}
