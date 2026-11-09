// @source scripts/escrow-acceptance/evm-upgrade.ts
// @source scripts/escrow-acceptance/upgrade-qualification.ts
// @source scripts/escrow-acceptance/upgrade-verification.ts
// @source scripts/escrow-acceptance/upgrade-verify.ts
// @source scripts/escrow-acceptance/upgrade-payments.ts
// @source contracts/evm/integration/upgrade.ts
// @source contracts/evm/integration/mainnet-upgrade-rehearsal.ts
// Two vaults: one in the original inventory, one created before template switch.
// Original storage preservation and explained later payment changes are separate.
// Actual slot layouts, digest computation and payment math are implementation checks.
// Qualification.status: planned, executing, waiting, executed, passed, failed.
// evm-upgrade.ts runs `execute` or `verify` against any stored record; a
// Waiting error records "waiting", any other error "failed", a completed
// verification "passed", and each run appends one history entry. A rerun
// skips every recorded step (run.steps), so a step is signed at most once.
// `signs` counts signatures per step kind (implementations, one per vault,
// factory, template); history is bounded by `runs` <= 6.
module evm_upgrade_qualification {
  var s: { phase: str, testNetwork: bool, exactPlan: bool, authority: bool,
    implementations: bool, factory: bool, template: bool, vaults: Set[int],
    upgraded: Set[int], preservation: bool, laterActivity: str,
    signs: int, runs: int, lastRun: str }
  action init = s'={ phase:"new",testNetwork:false,exactPlan:false,authority:false,
    implementations:false,factory:false,template:false,vaults:Set(1),upgraded:Set(),
    preservation:false,laterActivity:"none",signs:0,runs:0,lastRun:"none" }
  val stored = s.phase != "new"
  val signed = (if (s.implementations) 1 else 0) + s.upgraded.size()
    + (if (s.factory) 1 else 0) + (if (s.template) 1 else 0)
  action plan(testNetwork) = all { s.phase=="new",
    s'=s.with("phase","planned").with("testNetwork",testNetwork).with("exactPlan",true) }
  // The `execute` command from any stored record: the authority check either
  // refuses (recorded as failed) or sets executing. Recorded steps are kept.
  action authorize = all { stored, s.phase != "executing", s.runs < 6,
    s.testNetwork,s.exactPlan,
    s'=s.with("phase","executing").with("authority",true) }
  action refuseAuthority = all { stored, s.phase != "executing", s.runs < 6,
    not(s.testNetwork),
    s'=s.with("phase","failed").with("runs",s.runs+1).with("lastRun","failed") }
  action implementations = all { s.phase=="executing",s.authority,not(s.implementations),
    s'=s.with("implementations",true).with("signs",s.signs+1) }
  action createLateVault = all { s.phase=="executing",not(s.template),
    s'=s.with("vaults",s.vaults.union(Set(2))) }
  action upgrade(vault) = all { s.phase=="executing",s.implementations,
    s.vaults.contains(vault),not(s.upgraded.contains(vault)),
    s'=s.with("upgraded",s.upgraded.union(Set(vault))).with("signs",s.signs+1) }
  action factory = all { s.phase=="executing",s.upgraded.contains(1),s.implementations,
    not(s.factory),s'=s.with("factory",true).with("signs",s.signs+1) }
  action template = all { s.phase=="executing",s.factory,not(s.template),
    s'=s.with("template",true).with("signs",s.signs+1) }
  // A pending transaction (Waiting) or any other error ends the run.
  action interrupt(outcome) = all { s.phase=="executing",
    outcome.in(Set("waiting","failed")),
    s'=s.with("phase",outcome).with("runs",s.runs+1).with("lastRun",outcome) }
  action executeDone = all { s.phase=="executing",s.template,s.vaults.subseteq(s.upgraded),
    s'=s.with("phase","executed").with("runs",s.runs+1).with("lastRun","executed") }
  action preserve = all { s.phase=="executed",
    s'=s.with("preservation",true) }
  action later(activity) = all { s.phase=="executed",s.preservation,
    s'=s.with("laterActivity",activity) }
  val verifiable = all { s.preservation, s.template, s.vaults.subseteq(s.upgraded),
    Set("none","exact-payment").contains(s.laterActivity) }
  // The `verify` command from any stored record: passed only when every
  // check holds, otherwise the thrown check records failed.
  action verify = all { stored, s.phase != "executing", s.runs < 6, verifiable,
    s'=s.with("phase","passed").with("runs",s.runs+1).with("lastRun","passed") }
  action verifyFails = all { stored, s.phase != "executing", s.runs < 6,
    not(verifiable),
    s'=s.with("phase","failed").with("runs",s.runs+1).with("lastRun","failed") }
  action step = { nondet v=Set(1,2).oneOf()
    nondet a=Set("none","exact-payment","unexplained-write").oneOf()
    nondet t=Set(false,true).oneOf()
    nondet o=Set("waiting","failed").oneOf()
    any { plan(t),authorize,refuseAuthority,implementations,createLateVault,upgrade(v),
      factory,template,interrupt(o),executeDone,preserve,later(a),verify,verifyFails,
      s'=s } }
  val invariant = all {
    Set("new","planned","executing","waiting","executed","passed","failed").contains(s.phase),
    s.upgraded.subseteq(s.vaults),
    s.implementations implies (s.authority and s.testNetwork),
    s.template implies s.factory,
    s.phase == "passed" implies (s.preservation and s.template and s.vaults.subseteq(s.upgraded)),
    s.phase == "passed" implies Set("none","exact-payment").contains(s.laterActivity),
    // Re-entry never signs a recorded step again.
    s.signs == signed,
    s.phase.in(Set("waiting","executed","passed","failed")) iff s.lastRun == s.phase,
    s.lastRun == "none" iff s.runs == 0,
  }
  run lateVaultRecoveredTest = init.then(plan(true)).then(authorize).then(implementations)
    .then(upgrade(1)).then(createLateVault).then(factory).then(template)
    .then(upgrade(2)).then(executeDone).then(preserve).then(verify)
    .expect(s.phase == "passed" and invariant)
  run lateVaultStopsCompletionTest = init.then(plan(true)).then(authorize).then(implementations)
    .then(upgrade(1)).then(createLateVault).then(factory).then(template).then(executeDone.fail())
  run unexplainedChangeRefusedTest = init.then(plan(true)).then(authorize).then(implementations)
    .then(upgrade(1)).then(factory).then(template).then(executeDone).then(preserve)
    .then(later("unexplained-write")).then(verifyFails)
    .expect(s.phase == "failed" and s.lastRun == "failed")
  run unexplainedChangeCannotPassTest = init.then(plan(true)).then(authorize)
    .then(implementations).then(upgrade(1)).then(factory).then(template).then(executeDone)
    .then(preserve).then(later("unexplained-write")).then(verify.fail())
  run exactLaterPaymentAcceptedTest = init.then(plan(true)).then(authorize).then(implementations)
    .then(upgrade(1)).then(factory).then(template).then(executeDone).then(preserve)
    .then(later("exact-payment")).then(verify).expect(s.phase == "passed" and invariant)
  run mainnetRunnerRefusedTest = init.then(plan(false)).then(authorize.fail())
  run mainnetRunnerRecordsFailureTest = init.then(plan(false)).then(refuseAuthority)
    .expect(s.phase == "failed" and s.signs == 0 and s.runs == 1)
  // A pending transaction stops the run; the rerun resumes without re-signing
  // the recorded implementation step and can still pass.
  run waitingResumesWithoutReplayTest = init.then(plan(true)).then(authorize)
    .then(implementations).then(interrupt("waiting")).then(authorize)
    .then(upgrade(1)).then(factory).then(template)
    .then(executeDone).then(preserve).then(verify)
    .expect(s.phase == "passed" and s.signs == 4 and s.runs == 3)
  run waitingRerunDoesNotResignTest = init.then(plan(true)).then(authorize)
    .then(implementations).then(interrupt("waiting")).then(authorize)
    .then(implementations.fail())
  // A failed verification before execution is recorded and execution recovers.
  run failedReentersExecuteTest = init.then(plan(true)).then(verifyFails)
    .then(authorize).then(implementations).then(upgrade(1)).then(interrupt("failed"))
    .then(authorize).then(factory).then(template)
    .then(executeDone).expect(s.phase == "executed" and s.signs == 4 and s.runs == 3)
  // A passed record can be verified again after a later rerun of execute.
  run passedRerunStaysPassableTest = init.then(plan(true)).then(authorize)
    .then(implementations).then(upgrade(1)).then(factory).then(template).then(executeDone)
    .then(preserve).then(verify).then(authorize).then(executeDone).then(verify)
    .expect(s.phase == "passed" and s.signs == 4)
}
