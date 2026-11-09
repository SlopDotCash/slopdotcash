// @source contracts/evm/script/DeployReferralDistributorRobinhoodTestnet.s.sol
// @source contracts/solana/scripts/deploy-testnet.sh
// Test deployments require the selected test chain and isolated reviewed roles.
// Solana additionally requires clean source/pinned identity before building, then
// verifies the deployed ELF prefix and zero-only allocation padding afterwards.
module test_contract_deployment {
  type S = { solana: bool, chain: bool, roles: bool, source: bool, built: bool, deployed: bool, bytes: bool, reported: bool }
  var s: S
  action init = s' = { solana:true,chain:false,roles:false,source:false,built:false,deployed:false,bytes:false,reported:false }
  action evm = all { not(s.built),s'=s.with("solana",false) }
  action inspect(chain: bool, roles: bool, source: bool): bool = all { not(s.deployed),s'=s.with("chain",chain).with("roles",roles).with("source",source) }
  action build = all { s.chain,s.roles,not(s.solana) or s.source,s'=s.with("built",true) }
  action deploy = all { s.built,s.chain,s.roles,not(s.solana) or s.source,s'=s.with("deployed",true) }
  action verify(matches: bool): bool = all { s.solana,s.deployed,matches,s'=s.with("bytes",true) }
  action report = all { s.deployed,not(s.solana) or s.bytes,s'=s.with("reported",true) }
  action step = any { evm,inspect(true,true,true),inspect(false,true,true),inspect(true,false,true),inspect(true,true,false),build,deploy,verify(true),report,s'=s }
  val invariant = all { s.deployed implies s.chain and s.roles and(not(s.solana) or s.source),s.reported implies s.deployed and(not(s.solana) or s.bytes) }
  run mainnetRefusedTest = init.then(inspect(false,true,true)).then(build.fail())
  run dirtySourceRefusedTest = init.then(inspect(true,true,false)).then(build.fail())
  run bytesMismatchCannotPassTest = init.then(inspect(true,true,true)).then(build).then(deploy).then(verify(false).fail())
  run verifiedTestDeployTest = init.then(inspect(true,true,true)).then(build).then(deploy).then(verify(true)).then(report).expect(invariant)
  run evmEmitsWithoutByteComparisonTest = init.then(evm).then(inspect(true,true,false)).then(build).then(deploy).then(report).expect(not(s.bytes) and invariant)
}
