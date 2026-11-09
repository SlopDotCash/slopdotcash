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
// evm-upgrade.ts runs `execute` or `verify` against any stored record,
// including an "executing" record left by a killed process (`crash`). A
// Waiting error records "waiting", any other error "failed", a completed
// verification "passed", and each finished run appends one history entry.
// `execute` walks the planned transactions in order on every run, then the
// late vaults (ORDER: implementations, vault 1, factory, template, vault 2).
// For each key, EvmChain.send (scripts/escrow-acceptance/evm.ts) signs only
// when run.steps has no record for it, stores the signed bytes before
// broadcast, and otherwise rebroadcasts or awaits the recorded transaction.
// A step found already in its target state is recorded as alreadyDone
// without a signature; that skip is not modeled. `signs` counts signatures
// per step key; history is bounded by `runs` <= 6.
module evm_upgrade_qualification {
  val ORDER = ["impl", "v1", "factory", "template", "v2"]
  val KEYS = Set("impl", "v1", "factory", "template", "v2")
  def vaultKey(v: int): str = if (v == 1) "v1" else "v2"
  var s: { phase: str, live: bool, testNetwork: bool, exactPlan: bool, authority: bool,
    vaults: Set[int], steps: Set[str], signs: str -> int, pos: int,
    preservation: bool, laterActivity: str, runs: int, lastRun: str }
  action init = s'={ phase:"new",live:false,testNetwork:false,exactPlan:false,authority:false,
    vaults:Set(1),steps:Set(),signs:KEYS.mapBy(_ => 0),pos:0,
    preservation:false,laterActivity:"none",runs:0,lastRun:"none" }
  val stored = s.phase != "new"
  val upgradedAll = s.vaults.forall(v => s.steps.contains(vaultKey(v)))
  action plan(testNetwork) = all { s.phase=="new",
    s'=s.with("phase","planned").with("testNetwork",testNetwork).with("exactPlan",true) }
  // The `execute` command from any stored record when no process runs: the
  // authority check either refuses (recorded as failed) or sets executing
  // and starts at the first planned transaction. Recorded steps are kept.
  action authorize = all { stored, not(s.live), s.runs < 6,
    s.testNetwork,s.exactPlan,
    s'=s.with("phase","executing").with("live",true).with("authority",true).with("pos",0) }
  action refuseAuthority = all { stored, not(s.live), s.runs < 6,
    not(s.testNetwork),
    s'=s.with("phase","failed").with("runs",s.runs+1).with("lastRun","failed") }
  // One planned key: a vault that does not exist is skipped, a recorded key
  // is awaited without signing, and any other key is signed and recorded.
  action send = {
    val key = ORDER[s.pos]
    val skip = (key == "v2" and not(s.vaults.contains(2))) or s.steps.contains(key)
    all { s.live, s.phase=="executing", s.pos < ORDER.length(),
      s' = if (skip) s.with("pos", s.pos + 1)
        else s.with("steps", s.steps.union(Set(key)))
          .with("signs", s.signs.setBy(key, n => n + 1)).with("pos", s.pos + 1) }
  }
  // A vault created after the plan and before the new template is selected
  // still runs the old logic and joins the late-vault loop.
  action createLateVault = all { stored, not(s.steps.contains("template")),
    s'=s.with("vaults",s.vaults.union(Set(2))) }
  // A pending transaction (Waiting) or any other error ends the run.
  action interrupt(outcome) = all { s.live, s.phase=="executing",
    outcome.in(Set("waiting","failed")),
    s'=s.with("phase",outcome).with("live",false).with("runs",s.runs+1).with("lastRun",outcome) }
  // The process is killed: the file keeps "executing" and no history entry.
  action crash = all { s.live, s'=s.with("live",false) }
  action executeDone = all { s.live, s.phase=="executing", s.pos == ORDER.length(),
    s'=s.with("phase","executed").with("live",false).with("runs",s.runs+1)
      .with("lastRun","executed") }
  action preserve = all { s.phase=="executed", not(s.live),
    s'=s.with("preservation",true) }
  action later(activity) = all { s.phase=="executed", not(s.live), s.preservation,
    s'=s.with("laterActivity",activity) }
  val verifiable = all { s.preservation, s.steps.contains("template"), upgradedAll,
    Set("none","exact-payment").contains(s.laterActivity) }
  // The `verify` command from any stored record: passed only when every
  // check holds, otherwise the thrown check records failed.
  action verify = all { stored, not(s.live), s.runs < 6, verifiable,
    s'=s.with("phase","passed").with("runs",s.runs+1).with("lastRun","passed") }
  action verifyFails = all { stored, not(s.live), s.runs < 6,
    not(verifiable),
    s'=s.with("phase","failed").with("runs",s.runs+1).with("lastRun","failed") }
  action step = {
    nondet a=Set("none","exact-payment","unexplained-write").oneOf()
    nondet t=Set(false,true).oneOf()
    nondet o=Set("waiting","failed").oneOf()
    any { plan(t),authorize,refuseAuthority,send,createLateVault,
      interrupt(o),crash,executeDone,preserve,later(a),verify,verifyFails,
      s'=s } }
  val invariant = all {
    Set("new","planned","executing","waiting","executed","passed","failed").contains(s.phase),
    s.live implies s.phase == "executing",
    // A rerun, after any interruption or crash, never signs a key twice.
    KEYS.forall(k => s.signs.get(k) <= 1),
    KEYS.forall(k => s.steps.contains(k) iff s.signs.get(k) == 1),
    s.steps.contains("v2") implies s.vaults.contains(2),
    s.steps != Set() implies (s.authority and s.testNetwork),
    // Planned order: implementations, vaults, factory, then the template.
    s.steps.contains("v1") implies s.steps.contains("impl"),
    s.steps.contains("factory") implies s.steps.contains("v1"),
    s.steps.contains("template") implies s.steps.contains("factory"),
    s.phase == "executed" implies (s.steps.contains("template") and upgradedAll),
    s.phase == "passed" implies (s.preservation and s.steps.contains("template") and upgradedAll),
    s.phase == "passed" implies Set("none","exact-payment").contains(s.laterActivity),
    s.phase.in(Set("waiting","executed","passed","failed")) iff s.lastRun == s.phase,
    s.lastRun == "none" iff s.runs == 0,
  }
  action sendAll = send.then(send).then(send).then(send).then(send)
  run lateVaultRecoveredTest = init.then(plan(true)).then(authorize).then(send).then(send)
    .then(createLateVault).then(send).then(send).then(send).then(executeDone)
    .then(preserve).then(verify)
    .expect(s.phase == "passed" and s.steps.contains("v2") and invariant)
  run lateVaultAfterTemplateRefusedTest = init.then(plan(true)).then(authorize)
    .then(send).then(send).then(send).then(send).then(createLateVault.fail())
  run unexplainedChangeRefusedTest = init.then(plan(true)).then(authorize).then(sendAll)
    .then(executeDone).then(preserve).then(later("unexplained-write")).then(verifyFails)
    .expect(s.phase == "failed" and s.lastRun == "failed")
  run unexplainedChangeCannotPassTest = init.then(plan(true)).then(authorize).then(sendAll)
    .then(executeDone).then(preserve).then(later("unexplained-write")).then(verify.fail())
  run exactLaterPaymentAcceptedTest = init.then(plan(true)).then(authorize).then(sendAll)
    .then(executeDone).then(preserve).then(later("exact-payment")).then(verify)
    .expect(s.phase == "passed" and invariant)
  run mainnetRunnerRefusedTest = init.then(plan(false)).then(authorize.fail())
  run mainnetRunnerRecordsFailureTest = init.then(plan(false)).then(refuseAuthority)
    .expect(s.phase == "failed" and s.steps == Set() and s.runs == 1)
  // A pending transaction stops the run; the rerun walks every planned key
  // again, awaits the recorded implementation step and can still pass.
  run waitingResumesWithoutReplayTest = init.then(plan(true)).then(authorize)
    .then(send).then(interrupt("waiting")).then(authorize).then(sendAll)
    .then(executeDone).then(preserve).then(verify)
    .expect(s.phase == "passed" and s.signs.get("impl") == 1 and s.runs == 3)
  // A killed process leaves "executing"; execute and verify both accept it,
  // and the rerun signs only the steps the dead run did not record.
  run crashedExecutingRecordResumesTest = init.then(plan(true)).then(authorize)
    .then(send).then(send).then(crash).expect(s.phase == "executing" and s.runs == 0)
    .then(verifyFails).then(authorize).then(sendAll).then(executeDone)
    .expect(s.phase == "executed" and KEYS.forall(k => s.signs.get(k) <= 1)
      and s.runs == 2)
  run crashedRecordCanBeExecutedAgainTest = init.then(plan(true)).then(authorize)
    .then(send).then(crash).then(authorize).then(sendAll).then(executeDone)
    .expect(s.phase == "executed" and s.signs.get("impl") == 1)
  // A failed verification before execution is recorded and execution recovers.
  run failedReentersExecuteTest = init.then(plan(true)).then(verifyFails)
    .then(authorize).then(send).then(send).then(interrupt("failed"))
    .then(authorize).then(sendAll)
    .then(executeDone).expect(s.phase == "executed" and s.steps.size() == 4 and s.runs == 3)
  // A passed record can be executed and verified again without new signatures.
  run passedRerunStaysPassableTest = init.then(plan(true)).then(authorize).then(sendAll)
    .then(executeDone).then(preserve).then(verify).then(authorize).then(sendAll)
    .then(executeDone).then(verify)
    .expect(s.phase == "passed" and s.steps.size() == 4
      and KEYS.forall(k => s.signs.get(k) <= 1))
}
