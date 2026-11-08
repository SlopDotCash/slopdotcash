// @source contracts/solana/integration/deployment.mjs
// @source contracts/solana/integration/program-genesis.mjs
// Synthetic local genesis pins executable Program and non-executable ProgramData
// bytes. Config reuse requires the three public fixture roles to match.
module solana_fixture_config {
  type S={genesis:bool,programExecutable:bool,dataExecutable:bool,exists:bool,initialized:bool,roles:bool,confirmed:bool,verified:bool}
  var s:S
  action init=s'={genesis:false,programExecutable:false,dataExecutable:false,exists:false,initialized:false,roles:false,confirmed:false,verified:false}
  action preload=s'=s.with("genesis",true).with("programExecutable",true).with("dataExecutable",false)
  action inspect(hasConfig:bool,roles:bool):bool=all{not(s.initialized),not(s.verified),s'=s.with("exists",hasConfig).with("roles",roles)}
  action initialize=all{s.genesis,not(s.exists),s'=s.with("initialized",true).with("exists",true).with("roles",true)}
  action confirm=all{s.initialized,s'=s.with("confirmed",true)}
  action verify=all{s.exists,s.roles,not(s.initialized) or s.confirmed,s'=s.with("verified",true)}
  action step=any{preload,inspect(true,true),inspect(true,false),inspect(false,false),initialize,confirm,verify,s'=s}
  val invariant=all{not(s.dataExecutable),s.genesis implies s.programExecutable,s.verified implies s.exists and s.roles}
  run existingConfigReusedTest=init.then(preload).then(inspect(true,true)).then(verify).expect(not(s.initialized) and invariant)
  run wrongFixtureRolesRefusedTest=init.then(preload).then(inspect(true,false)).then(verify.fail())
  run initializeConfirmReadTest=init.then(preload).then(inspect(false,false)).then(initialize).then(confirm).then(verify).expect(invariant)
}
