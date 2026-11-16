// @source scripts/check-payout-readiness.ts
// Configuration readiness is distinct from probed readiness. --require needs
// --probe and exact chain/finality, registry DB, signer pins and execution switch.
module payout_readiness {
  type S={pins:bool,database:bool,enabled:bool,rpc:bool,probed:bool,finalized:bool,requiredPassed:bool}
  var s:S
  action init=s'={pins:false,database:false,enabled:false,rpc:false,probed:false,finalized:false,requiredPassed:false}
  action inspect(pins:bool,database:bool,isEnabled:bool,rpc:bool):bool=all{not(s.requiredPassed),s'=s.with("pins",pins).with("database",database).with("enabled",isEnabled).with("rpc",rpc).with("probed",false).with("finalized",false)}
  action probe(finalized:bool):bool=all{not(s.requiredPassed),s.rpc,s'=s.with("probed",true).with("finalized",finalized)}
  val configured=s.pins and s.database and s.enabled and s.rpc
  action requireNetwork=all{configured,s.probed,s.finalized,s'=s.with("requiredPassed",true)}
  action step={nondet a=Set(true,false).oneOf() nondet b=Set(true,false).oneOf() nondet c=Set(true,false).oneOf() nondet d=Set(true,false).oneOf() any{inspect(a,b,c,d),probe(true),probe(false),requireNetwork,s'=s}}
  val invariant=s.requiredPassed implies configured and s.probed and s.finalized
  run configuredNotProofTest=init.then(inspect(true,true,true,true)).then(requireNetwork.fail())
  run wrongChainRefusedTest=init.then(inspect(true,true,true,true)).then(probe(false)).then(requireNetwork.fail())
  run wrongRegistryRefusedTest=init.then(inspect(true,false,true,true)).then(probe(true)).then(requireNetwork.fail())
  run exactProbeReadyTest=init.then(inspect(true,true,true,true)).then(probe(true)).then(requireNetwork).expect(invariant)
  run changedConfigurationNeedsNewProbeTest=init.then(inspect(true,true,true,true)).then(probe(true)).then(inspect(true,true,true,true)).then(requireNetwork.fail())
}
