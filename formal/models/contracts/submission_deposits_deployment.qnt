// @source contracts/evm/script/DeploySubmissionDeposits.sol
// @source contracts/evm/script/DeploySubmissionDepositsBase.s.sol
// @source contracts/evm/script/DeploySubmissionDepositsRobinhood.s.sol
// @source contracts/evm/script/DeployStandingDeposits.sol
// @evidence contracts/evm/test/SubmissionDepositsDeploy.t.sol
// Each chain script deploys the submission deposit contract only on its own
// chain (Base 8453 or Robinhood Chain 4663), with a present owner and a present,
// different resolver, and with the fixed 30-day reclaim delay (365 days for
// the standing deposit script, Robinhood Chain only, operator decision of
// 23 November 2026). The script then
// reads the roles, the delay and the empty initial state back before it reports.
// Deployment moves no tokens, records no token list and activates nothing:
// recording the address for any Slop service is a separate later change that no
// action here can take. Chains are "base", "robinhood" and "other"; one run of
// one script is modeled.
module submission_deposits_deployment {
  type S = { script: str, chain: str, roles: bool, deployed: bool, checked: bool, reported: bool,
    moved: bool, recorded: bool }
  var s: S
  action init = s' = { script: "base", chain: "other", roles: false, deployed: false, checked: false,
    reported: false, moved: false, recorded: false }
  action choose(script: str): bool = all { not(s.deployed), Set("base", "robinhood").contains(script),
    s' = s.with("script", script) }
  action inspect(chain: str, roles: bool): bool = all { not(s.deployed), s' = s.with("chain", chain).with("roles", roles) }
  action deploy = all { s.chain == s.script, s.roles, not(s.deployed), s' = s.with("deployed", true) }
  action check(matches: bool): bool = all { s.deployed, matches, s' = s.with("checked", true) }
  action report = all { s.checked, s' = s.with("reported", true) }
  action step = {
    nondet script = oneOf(Set("base", "robinhood"))
    nondet chain = oneOf(Set("base", "robinhood", "other"))
    nondet flag = oneOf(Set(true, false))
    any { choose(script), inspect(chain, flag), deploy, check(flag), report, s' = s }
  }
  val invariant = all { s.deployed implies (s.chain == s.script and s.roles), s.checked implies s.deployed,
    s.reported implies s.checked, not(s.moved), not(s.recorded) }
  run otherChainRefusedTest = init.then(inspect("other", true)).then(deploy.fail())
  run baseScriptRefusesRobinhoodTest = init.then(choose("base")).then(inspect("robinhood", true)).then(deploy.fail())
  run robinhoodScriptRefusesBaseTest = init.then(choose("robinhood")).then(inspect("base", true)).then(deploy.fail())
  run missingOrSharedRolesRefusedTest = init.then(inspect("base", false)).then(deploy.fail())
  run mismatchedDeploymentRefusedTest = init.then(inspect("base", true)).then(deploy).then(check(false).fail())
  run unreadDeploymentNotReportedTest = init.then(inspect("base", true)).then(deploy).then(report.fail())
  run secondDeploymentRefusedTest = init.then(inspect("base", true)).then(deploy).then(deploy.fail())
  run deployedEmptyAndInactiveOnBaseTest = init.then(choose("base")).then(inspect("base", true)).then(deploy)
    .then(check(true)).then(report).expect(s.reported and not(s.moved) and not(s.recorded) and invariant)
  run deployedEmptyAndInactiveOnRobinhoodTest = init.then(choose("robinhood")).then(inspect("robinhood", true)).then(deploy)
    .then(check(true)).then(report).expect(s.reported and not(s.moved) and not(s.recorded) and invariant)
}
