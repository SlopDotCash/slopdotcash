// @source scripts/check-formal.mjs
// @source scripts/run-e2e-phase.mjs
// @source scripts/browser-process-ownership.mjs
// @source scripts/run-e2e.mjs
// @source scripts/check-lemmascript.mjs
// One launcher, one inherited process-group child and one detached managed
// group. Ownership is captured while the launcher is alive and rechecked before
// forced cleanup. Process-table or identity failure cannot authorize a signal.
// SIGKILL, OOM or machine
// death of the supervisor itself are external failures, not caught cancellation.
module formal_process {
  var s: {phase:str, launcher:bool, child:bool, pipes:bool,
    failed:bool, temporary:bool, external:bool, captured:bool, sameOwner:bool,
    requiresHandshake:bool, acknowledged:bool, result:str}
  action init = s'={phase:"new",launcher:false,child:false,pipes:false,
    failed:false,temporary:false,external:false,captured:false,sameOwner:true,
    requiresHandshake:false,acknowledged:false,result:"none"}
  action start = all {s.phase=="new",s'=s.with("phase","running")
    .with("launcher",true).with("child",true).with("temporary",true)}
  action startBrowser = all {s.phase=="new",s'=s.with("phase","running")
    .with("launcher",true).with("child",true).with("temporary",true).with("requiresHandshake",true)}
  action launcherExit(ok) = all {s.phase=="running",s'=s.with("phase","cleanup")
    .with("launcher",false).with("failed",s.failed or not(ok) or (s.requiresHandshake and not(s.acknowledged)))}
  // The controlled Node launcher waits synchronously at exit while its
  // descendant identities can still be observed. Acknowledgement publication
  // is atomic; unknown requesters refuse.
  action exitCheckpoint = all {s.phase=="running",s.launcher,s.requiresHandshake,s.sameOwner,
    s'=s.with("acknowledged",true).with("captured",s.captured or s.external)}
  action invalidCheckpoint = all {s.phase=="running",s.requiresHandshake,
    s'=s.with("failed",true)}
  action cancel = all {Set("running","cleanup").contains(s.phase),
    s'=s.with("phase","cleanup").with("failed",true)}
  // Playwright owns web servers in separate process groups. On cancellation or
  // timeout its SIGINT handler can close these before exiting. Otherwise only
  // an unchanged, captured descendant group can be killed by the fallback.
  // Controlled launchers do not spawn after their final exit checkpoint.
  // Native double-forks or later exit listeners that spawn are not modeled.
  action managedServer = all {s.phase=="running",not(s.acknowledged),s'=s.with("external",true)}
  action captureManaged = all {s.phase=="running",s.launcher,s.external,
    s'=s.with("captured",true)}
  action changedOwner = all {s.captured,s'=s.with("sameOwner",false)}
  action managedServerClosed = all {s.external,s'=s.with("external",false)}
  action interrupt = all {s.phase=="running",s'=s.with("phase","interrupting").with("failed",true)}
  action cooperativeExit = all {s.phase=="interrupting",s'=s.with("phase","cleanup")
    .with("launcher",false).with("external",false)}
  action interruptDeadline = all {s.phase=="interrupting",s'=s.with("phase","cleanup")}
  action killGroup = all {s.phase=="cleanup",s'=s.with("launcher",false).with("child",false)}
  action killManaged = all {s.phase=="cleanup",s.external,s.captured,s.sameOwner,
    s'=s.with("external",false)}
  action drain = all {not(s.launcher),not(s.child),s'=s.with("pipes",true)}
  action cleanup = all {s.phase=="cleanup",s.pipes,not(s.child),not(s.external),
    s'=s.with("phase","done").with("temporary",false)}
  action cleanupDeadline = all {s.phase=="cleanup",
    s'=s.with("phase","done").with("failed",true).with("temporary",false)}
  action report = all {s.phase=="done",s'=s.with("result",if(s.failed) "fail" else "pass")}
  action step = {nondet ok=Set(false,true).oneOf()
    any {start,startBrowser,launcherExit(ok),exitCheckpoint,invalidCheckpoint,cancel,managedServer,captureManaged,changedOwner,
      managedServerClosed,interrupt,cooperativeExit,
      interruptDeadline,killGroup,killManaged,drain,cleanup,cleanupDeadline,report,s'=s}}
  val invariant = all {s.result=="pass" implies all {not(s.failed),not(s.launcher),
    not(s.child),not(s.external),s.pipes,not(s.temporary),
    s.requiresHandshake implies s.acknowledged},s.failed implies s.result!="pass"}
  run cleanSuccessTest = init.then(start).then(launcherExit(true)).then(killGroup)
    .then(drain).then(cleanup).then(report).expect(s.result=="pass")
  run timeoutKillsDescendantTest = init.then(start).then(cancel).then(killGroup)
    .then(drain).then(cleanup).then(report).expect(s.result=="fail" and not(s.child))
  run exitedLauncherStillOwnsChildTest = init.then(start).then(launcherExit(true))
    .expect(s.child and s.result=="none").then(drain.fail())
  run canceledCleanupCannotPassTest = init.then(start).then(launcherExit(true)).then(cancel)
    .then(killGroup).then(drain).then(cleanup).then(report).expect(s.result=="fail")
  run failureCannotPublishSuccessTest = init.then(start).then(launcherExit(false)).then(killGroup)
    .then(drain).then(cleanup).then(report).expect(s.result=="fail")
  run cleanupFailureIsExplicitTest = init.then(start).then(cancel).then(cleanupDeadline)
    .then(report).expect(s.result=="fail" and s.child)
  run cooperativeBrowserInterruptClosesServerTest = init.then(start).then(managedServer)
    .then(interrupt).then(cooperativeExit).then(killGroup).then(drain).then(cleanup)
    .then(report).expect(s.result=="fail" and not(s.external))
  run uncooperativeBrowserCannotClaimCleanupTest = init.then(start).then(managedServer)
    .then(interrupt).then(interruptDeadline).then(killGroup).then(drain).then(cleanupDeadline)
    .then(report).expect(s.result=="fail" and s.external)
  run normalBrowserClosesManagedServerTest = init.then(start).then(managedServer)
    .then(managedServerClosed).then(launcherExit(true)).then(killGroup).then(drain)
    .then(cleanup).then(report).expect(s.result=="pass" and not(s.external))
  run forcedBrowserCleanupStopsCapturedGroupTest = init.then(start).then(managedServer)
    .then(captureManaged).then(interrupt).then(interruptDeadline).then(killManaged)
    .then(killGroup).then(drain).then(cleanup).then(report)
    .expect(s.result=="fail" and not(s.external))
  run unknownGroupCannotBeKilledTest = init.then(start).then(managedServer)
    .then(interrupt).then(interruptDeadline).then(killManaged.fail())
  run changedGroupCannotBeKilledTest = init.then(start).then(managedServer)
    .then(captureManaged).then(changedOwner).then(interrupt).then(interruptDeadline)
    .then(killManaged.fail())
  run normalExitCheckpointRetainsDetachedServerTest = init.then(startBrowser).then(managedServer)
    .then(exitCheckpoint).then(launcherExit(true)).then(killManaged).then(killGroup)
    .then(drain).then(cleanup).then(report).expect(s.result=="pass" and not(s.external))
  run missingExitCheckpointCannotPassTest = init.then(startBrowser).then(launcherExit(true))
    .then(killGroup).then(drain).then(cleanup).then(report).expect(s.result=="fail")
  run refusedCheckpointCannotPassTest = init.then(startBrowser).then(invalidCheckpoint)
    .then(exitCheckpoint).then(launcherExit(true)).then(killGroup).then(drain)
    .then(cleanup).then(report).expect(s.result=="fail")
  run changedNormalExitOwnerCannotBeKilledTest = init.then(startBrowser).then(managedServer)
    .then(exitCheckpoint).then(changedOwner).then(launcherExit(true)).then(killManaged.fail())
  run changedNormalExitOwnerRefusesSuccessTest = init.then(startBrowser).then(managedServer)
    .then(exitCheckpoint).then(changedOwner).then(launcherExit(true))
    .then(cleanupDeadline).then(report).expect(s.result=="fail" and s.external)
}
