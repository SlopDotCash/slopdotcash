// @evidence tests/e2e/solana-vault-actions.spec.ts
// @source scripts/local-solana-validator.mjs
// Caller composition with solana_container_lifecycle. Program/mint bytes and
// transaction semantics remain in their artifact, owner-action and chain tests.
// One fixture/launcher/cleanup attempt. No success is inferred from RPC polling.
module solana_vault_fixture {
  var s:{phase:str,inputs:bool,readonly:bool,owned:bool,qualified:bool,
    configured:bool,passed:bool,failed:bool,removed:bool}
  action init=s'={phase:"new",inputs:false,readonly:false,owned:false,qualified:false,
    configured:false,passed:false,failed:false,removed:false}
  action stageInputs=all{s.phase=="new",s'=s.with("phase","staged").with("inputs",true).with("readonly",true)}
  action requestStart=all{s.phase=="staged",s'=s.with("phase","starting")}
  // The helper returns only after inspecting owned loopback publication and
  // the pinned validator version/digest. Its failure path attempts cleanup.
  action ready=all{s.phase=="starting",s'=s.with("phase","ready").with("owned",true).with("qualified",true)}
  action startupRefused=all{s.phase=="starting",s'=s.with("phase","refused").with("failed",true)}
  action startupCleanupUnknown=all{s.phase=="starting",s'=s.with("phase","unknown").with("owned",true).with("failed",true)}
  action configure=all{s.phase=="ready",s'=s.with("phase","configured").with("configured",true)}
  action scenarioPass=all{s.phase=="configured",s'=s.with("phase","finished").with("passed",true)}
  action scenarioFail=all{Set("ready","configured").contains(s.phase),s'=s.with("phase","finished").with("failed",true)}
  action requestClose=all{Set("ready","configured","finished").contains(s.phase),s'=s.with("phase","closing")}
  action closeConfirmed=all{s.phase=="closing",s'=s.with("phase","closed").with("owned",false)}
  action closeUnknown=all{s.phase=="closing",s'=s.with("phase","unknown").with("failed",true)}
  action removeInputs=all{s.phase=="closed",not(s.owned),s'=s.with("inputs",false).with("removed",true)}
  action step=any{stageInputs,requestStart,ready,startupRefused,startupCleanupUnknown,
    configure,scenarioPass,scenarioFail,requestClose,closeConfirmed,closeUnknown,removeInputs,s'=s}
  val invariant=all{s.owned implies s.inputs,s.qualified implies s.readonly,
    s.passed implies(s.qualified and s.configured),s.removed implies not(s.owned),
    Set("unknown","refused").contains(s.phase) implies(s.inputs and s.failed and not(s.removed))}
  run configuredScenarioAndCleanupTest=init.then(stageInputs).then(requestStart).then(ready).then(configure)
    .then(scenarioPass).then(requestClose).then(closeConfirmed).then(removeInputs).expect(s.passed and s.removed)
  run startupFailureRetainsInputsWithoutHandleTest=init.then(stageInputs).then(requestStart).then(startupRefused)
    .expect(s.failed and s.inputs and not(s.passed)).then(removeInputs.fail())
  run setupFailureClosesOwnedValidatorTest=init.then(stageInputs).then(requestStart).then(ready).then(scenarioFail)
    .then(requestClose).then(closeConfirmed).then(removeInputs).expect(s.failed and not(s.passed) and s.removed)
  run cannotRemoveWhileLaunchPendingTest=init.then(stageInputs).then(requestStart).then(removeInputs.fail())
  run uncertainCleanupRetainsInputsTest=init.then(stageInputs).then(requestStart).then(ready)
    .then(requestClose).then(closeUnknown).expect(s.owned and s.inputs).then(removeInputs.fail())
}
