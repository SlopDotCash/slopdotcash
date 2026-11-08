// @source scripts/escrow-acceptance/evm-upgrade.ts
// @source scripts/escrow-acceptance/upgrade-verification.ts
// @source scripts/escrow-acceptance/upgrade-verify.ts
// @source scripts/escrow-acceptance/upgrade-payments.ts
// @source contracts/evm/integration/upgrade.ts
// @source contracts/evm/integration/mainnet-upgrade-rehearsal.ts
// Two vaults: one in the original inventory, one created before template switch.
// Original storage preservation and explained later payment changes are separate.
// Actual slot layouts, digest computation and payment math are implementation checks.
module evm_upgrade_qualification {
  var s: { phase: str, testNetwork: bool, exactPlan: bool, authority: bool,
    implementations: bool, factory: bool, template: bool, vaults: Set[int],
    upgraded: Set[int], preservation: bool, laterActivity: str, verified: bool }
  action init = s'={ phase:"new",testNetwork:false,exactPlan:false,authority:false,
    implementations:false,factory:false,template:false,vaults:Set(1),upgraded:Set(),
    preservation:false,laterActivity:"none",verified:false }
  action plan(testNetwork) = all { s.phase=="new",
    s'=s.with("phase","planned").with("testNetwork",testNetwork).with("exactPlan",true) }
  action authorize = all { s.phase=="planned",s.testNetwork,s.exactPlan,
    s'=s.with("phase","executing").with("authority",true) }
  action implementations = all { s.phase=="executing",s.authority,
    s'=s.with("implementations",true) }
  action createLateVault = all { s.phase=="executing",not(s.template),
    s'=s.with("vaults",s.vaults.union(Set(2))) }
  action upgrade(vault) = all { s.phase=="executing",s.implementations,
    s.vaults.contains(vault),s'=s.with("upgraded",s.upgraded.union(Set(vault))) }
  action factory = all { s.phase=="executing",s.upgraded.contains(1),s.implementations,
    s'=s.with("factory",true) }
  action template = all { s.phase=="executing",s.factory,
    s'=s.with("template",true) }
  action executeDone = all { s.phase=="executing",s.template,s.vaults.subseteq(s.upgraded),
    s'=s.with("phase","executed") }
  action preserve = all { s.phase=="executed",
    s'=s.with("preservation",true) }
  action later(activity) = all { s.phase=="executed",s.preservation,
    s'=s.with("laterActivity",activity) }
  action verify = all { s.phase=="executed",s.preservation,
    Set("none","exact-payment").contains(s.laterActivity),s.vaults.subseteq(s.upgraded),
    s'=s.with("phase","verified").with("verified",true) }
  action step = { nondet v=Set(1,2).oneOf()
    nondet a=Set("none","exact-payment","unexplained-write").oneOf()
    nondet t=Set(false,true).oneOf()
    any { plan(t),authorize,implementations,createLateVault,upgrade(v),factory,template,
      executeDone,preserve,later(a),verify,s'=s } }
  val invariant = all {
    s.upgraded.subseteq(s.vaults),
    s.implementations implies (s.authority and s.testNetwork),
    s.template implies s.factory,
    s.verified implies (s.preservation and s.template and s.vaults.subseteq(s.upgraded)),
    s.verified implies Set("none","exact-payment").contains(s.laterActivity),
  }
  run lateVaultRecoveredTest = init.then(plan(true)).then(authorize).then(implementations)
    .then(upgrade(1)).then(createLateVault).then(factory).then(template)
    .then(upgrade(2)).then(executeDone).then(preserve).then(verify).expect(s.verified and invariant)
  run lateVaultStopsCompletionTest = init.then(plan(true)).then(authorize).then(implementations)
    .then(upgrade(1)).then(createLateVault).then(factory).then(template).then(executeDone.fail())
  run unexplainedChangeRefusedTest = init.then(plan(true)).then(authorize).then(implementations)
    .then(upgrade(1)).then(factory).then(template).then(executeDone).then(preserve)
    .then(later("unexplained-write")).then(verify.fail())
  run exactLaterPaymentAcceptedTest = init.then(plan(true)).then(authorize).then(implementations)
    .then(upgrade(1)).then(factory).then(template).then(executeDone).then(preserve)
    .then(later("exact-payment")).then(verify).expect(s.verified and invariant)
  run mainnetRunnerRefusedTest = init.then(plan(false)).then(authorize.fail())
}
