// @source scripts/escrow-acceptance/solana-local.ts
// @source contracts/solana/scripts/acceptance.ts
// @source contracts/solana/scripts/acceptance-extended.ts
// @evidence scripts/escrow-acceptance/solana-local.test.ts
// Local harness admission/composition only. Contract, ledger, executor,
// uncertain receipts and container cleanup have separate models and real runs.
module local_solana_acceptance {
  var s: { phase:str, local:bool, loopback:bool, publicGenesis:bool,
    sameRun:bool, liveGenesis:bool, callerRun:int, boundRun:int, envMatches:bool, finalized:bool,
    immutable:Set[int], declared:Set[int],
    verified:bool, active:Set[int], scanned:Set[int], dispatched:Set[int],
    errors:Set[str], tick:int }
  action initial(local:bool,loopback:bool,publicGenesis:bool):bool = s'={
    phase:"new",local:local,loopback:loopback,publicGenesis:publicGenesis,
    sameRun:true,liveGenesis:true,callerRun:1,boundRun:1,envMatches:true,finalized:false,immutable:Set(),declared:Set(),verified:false,
    active:Set(),scanned:Set(),dispatched:Set(),errors:Set(),tick:0}
  action init = s'={phase:"new",local:true,loopback:true,publicGenesis:false,
    sameRun:true,liveGenesis:true,callerRun:1,boundRun:1,envMatches:true,finalized:false,immutable:Set(),declared:Set(),verified:false,
    active:Set(),scanned:Set(),dispatched:Set(),errors:Set(),tick:0}
  val admitted = s.local and s.loopback and not(s.publicGenesis) and s.sameRun
  action open = all {s.phase=="new",s'=s.with("phase",if(admitted) "idle" else "refused")}
  // SQL transaction records the whole batch, or retains the old declarations.
  action record(id:int,matches:bool):bool = all {s.phase=="idle",Set(1,2).contains(id),
    s'=if(matches) s.with("immutable",s.immutable.union(Set(id)))
      .with("declared",s.declared.union(Set(id)))
      .with("finalized",s.finalized and s.declared.contains(id)) else s}
  action resume(matches:bool):bool = all {s.phase=="idle",
    s'=if(matches) s else s.with("sameRun",false).with("phase","refused")}
  action mutateCaller = all {s.phase=="idle",s'=s.with("callerRun",2)}
  action changeEnvironment = all {s.phase=="idle",s'=s.with("envMatches",false)}
  action changeGenesis = all {s.phase=="idle",s'=s.with("liveGenesis",false)}
  // The section-21 caller waits for the last commit's finality before the
  // helper verifies its newly initialized project at finalized commitment.
  action awaitFinality = all {s.phase=="idle",not(s.finalized),s'=s.with("phase","waiting")}
  action observeFinality = all {Set("idle","waiting").contains(s.phase),
    s'=s.with("finalized",true).with("phase","idle")}
  action beginTick = all {s.phase=="idle",s.finalized,s.tick<2,
    s'=s.with("phase",if(admitted and s.liveGenesis and s.envMatches) "checking" else "refused")
      .with("verified",false).with("active",s.declared).with("scanned",Set())
      .with("dispatched",Set()).with("errors",Set()).with("tick",s.tick+1)}
  action verify(ok:bool):bool = all {s.phase=="checking",
    s'=s.with("phase",if(ok) "snapshots" else "refused").with("verified",ok)}
  action snapshots(ok:bool):bool = all {s.phase=="snapshots",
    s'=s.with("phase","scan").with("errors",if(ok) s.errors else s.errors.union(Set("snapshot")))}
  action scan(id:int,ok:bool):bool = all {s.phase=="scan",s.active.contains(id),not(s.scanned.contains(id)),
    s'=s.with("scanned",s.scanned.union(Set(id)))
      .with("errors",if(ok) s.errors else s.errors.union(Set("scan")))}
  action scanned = all {s.phase=="scan",s.scanned==s.active,s'=s.with("phase","recover")}
  action recover(ok:bool):bool = all {s.phase=="recover",
    s'=s.with("phase","reconcile").with("errors",if(ok) s.errors else s.errors.union(Set("recover")))}
  action reconcile(ok:bool):bool = all {s.phase=="reconcile",
    s'=s.with("phase","dispatch").with("errors",if(ok) s.errors else s.errors.union(Set("reconcile")))}
  // Actual dispatchPayment decides wallet/lease/attempt eligibility, and the
  // executor checks fresh chain identity. This action records only delegation.
  action dispatch(id:int,ok:bool):bool = all {s.phase=="dispatch",s.active.contains(id),not(s.dispatched.contains(id)),
    s'=s.with("dispatched",s.dispatched.union(Set(id)))
      .with("errors",if(ok) s.errors else s.errors.union(Set("dispatch")))}
  action finish = all {s.phase=="dispatch",s.dispatched==s.active,s'=s.with("phase","done")}
  action again = all {s.phase=="done",s'=s.with("phase","idle")}
  action step = any {open,record(1,true),record(2,true),record(1,false),resume(true),resume(false),
    mutateCaller,changeEnvironment,changeGenesis,awaitFinality,observeFinality,beginTick,verify(true),verify(false),snapshots(true),snapshots(false),
    scan(1,true),scan(1,false),scan(2,true),scan(2,false),scanned,
    recover(true),recover(false),reconcile(true),reconcile(false),
    dispatch(1,true),dispatch(1,false),dispatch(2,true),dispatch(2,false),finish,again,s'=s}
  val invariant = all {
    s.declared==s.immutable,s.boundRun==1,
    s.active.subseteq(s.declared),s.scanned.subseteq(s.active),s.dispatched.subseteq(s.active),
    Set("snapshots","scan","recover","reconcile","dispatch","done").contains(s.phase)
      implies (admitted and s.liveGenesis and s.envMatches and s.finalized and s.verified),
    s.dispatched.size()>0 implies s.verified,
    s.tick>=0 and s.tick<=2
  }
  action opened = initial(true,true,false).then(open).then(record(1,true)).then(record(2,true)).then(observeFinality)
  action checked = beginTick.then(verify(true))
  action throughScan = snapshots(true).then(scan(1,true)).then(scan(2,true)).then(scanned)
  run confirmedProjectWaitsBeforeFinalizedVerificationTest = initial(true,true,false)
    .then(open).then(record(1,true)).then(awaitFinality)
    .expect(s.phase=="waiting" and not(s.verified) and s.dispatched.size()==0)
    .then(observeFinality).then(beginTick).then(verify(true))
    .expect(s.phase=="snapshots" and s.finalized)
  run previousProjectFinalityCannotAdmitNewProjectTest = initial(true,true,false)
    .then(open).then(record(1,true)).then(observeFinality).then(record(2,true)).then(awaitFinality)
    .expect(not(s.finalized) and s.phase=="waiting" and s.dispatched.size()==0)
  run localWorkflowDelegatesEachDeclaredProjectTest = opened.then(checked).then(throughScan)
    .then(recover(true)).then(reconcile(true)).then(dispatch(1,true)).then(dispatch(2,true)).then(finish)
    .expect(s.phase=="done" and s.dispatched==Set(1,2) and s.errors.size()==0)
  run publicNetworkCannotUseLocalPathTest = initial(false,true,false).then(open).expect(s.phase=="refused")
  run remoteRpcCannotUseLocalPathTest = initial(true,false,false).then(open).expect(s.phase=="refused")
  run publicGenesisCannotUseLocalPathTest = initial(true,true,true).then(open).expect(s.phase=="refused")
  run changedRunCannotResumeTest = opened.then(resume(false)).expect(s.phase=="refused" and s.declared==Set(1,2))
  run changedDeclarationRollsBackTest = opened.then(record(1,false)).expect(s.declared==Set(1,2))
  run changedGenesisStopsBeforeDelegationTest = opened.then(changeGenesis).then(beginTick)
    .expect(s.phase=="refused" and s.dispatched.size()==0 and not(s.verified))
  run callerMutationCannotRetargetBoundRunTest = opened.then(mutateCaller).then(checked)
    .expect(s.boundRun==1 and s.callerRun==2 and s.phase=="snapshots")
  run mismatchedEnvironmentStopsBeforeDelegationTest = opened.then(changeEnvironment).then(beginTick)
    .expect(s.phase=="refused" and s.dispatched.size()==0)
  run invalidProgramStopsBeforeDelegationTest = opened.then(beginTick).then(verify(false))
    .expect(s.phase=="refused" and s.dispatched.size()==0)
  run snapshotFailureDoesNotFabricateSuccessfulTickTest = opened.then(checked).then(snapshots(false))
    .then(scan(1,true)).then(scan(2,true)).then(scanned).then(recover(true)).then(reconcile(true))
    .then(dispatch(1,true)).then(dispatch(2,true)).then(finish)
    .expect(s.errors==Set("snapshot") and s.dispatched==Set(1,2))
  run oneProjectFailurePreservesOtherDelegationTest = opened.then(checked).then(throughScan)
    .then(recover(true)).then(reconcile(true)).then(dispatch(1,false)).then(dispatch(2,true)).then(finish)
    .expect(s.errors==Set("dispatch") and s.dispatched==Set(1,2))
}
