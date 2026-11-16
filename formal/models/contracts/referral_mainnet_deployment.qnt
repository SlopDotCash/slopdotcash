// @source contracts/evm/script/DeployReferralDistributorRobinhood.s.sol
// The mainnet referral distributor deploys only on Robinhood Chain, against the
// recorded program token, with present and distinct roles. The script then reads
// the deployed token, roles, limits and empty initial state back before it
// reports. Deployment transfers no tokens and activates nothing: funding and
// activation are separate later decisions that no action here can take.
module referral_mainnet_deployment {
  type S = { chain: bool, roles: bool, token: bool, deployed: bool, checked: bool, reported: bool, funded: bool, active: bool }
  var s: S
  action init = s' = { chain:false,roles:false,token:false,deployed:false,checked:false,reported:false,funded:false,active:false }
  action inspect(chain: bool, roles: bool, token: bool): bool = all { not(s.deployed),s'=s.with("chain",chain).with("roles",roles).with("token",token) }
  action deploy = all { s.chain,s.roles,s.token,not(s.deployed),s'=s.with("deployed",true) }
  action check(matches: bool): bool = all { s.deployed,matches,s'=s.with("checked",true) }
  action report = all { s.checked,s'=s.with("reported",true) }
  action step = any { inspect(true,true,true),inspect(false,true,true),inspect(true,false,true),inspect(true,true,false),deploy,check(true),report,s'=s }
  val invariant = all { s.deployed implies s.chain and s.roles and s.token,s.checked implies s.deployed,s.reported implies s.checked,not(s.funded),not(s.active) }
  run otherChainRefusedTest = init.then(inspect(false,true,true)).then(deploy.fail())
  run missingOrSharedRolesRefusedTest = init.then(inspect(true,false,true)).then(deploy.fail())
  run unrecordedTokenRefusedTest = init.then(inspect(true,true,false)).then(deploy.fail())
  run mismatchedDeploymentRefusedTest = init.then(inspect(true,true,true)).then(deploy).then(check(false).fail())
  run unreadDeploymentNotReportedTest = init.then(inspect(true,true,true)).then(deploy).then(report.fail())
  run secondDeploymentRefusedTest = init.then(inspect(true,true,true)).then(deploy).then(deploy.fail())
  run deployedEmptyAndInactiveTest = init.then(inspect(true,true,true)).then(deploy).then(check(true)).then(report).expect(s.reported and not(s.funded) and not(s.active) and invariant)
}
