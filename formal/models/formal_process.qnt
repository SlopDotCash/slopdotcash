// @source scripts/check-formal.mjs
// @source scripts/run-e2e-phase.mjs
// One launcher and one inherited process-group child. SIGKILL, OOM or machine
// death of the supervisor itself are external failures, not caught cancellation.
module formal_process {
  var s: {phase:str, launcher:bool, child:bool, pipes:bool,
    failed:bool, temporary:bool, result:str}
  action init = s'={phase:"new",launcher:false,child:false,pipes:false,
    failed:false,temporary:false,result:"none"}
  action start = all {s.phase=="new",s'=s.with("phase","running")
    .with("launcher",true).with("child",true).with("temporary",true)}
  action launcherExit(ok) = all {s.phase=="running",s'=s.with("phase","cleanup")
    .with("launcher",false).with("failed",not(ok))}
  action cancel = all {Set("running","cleanup").contains(s.phase),
    s'=s.with("phase","cleanup").with("failed",true)}
  action killGroup = all {s.phase=="cleanup",s'=s.with("launcher",false).with("child",false)}
  action drain = all {not(s.launcher),not(s.child),s'=s.with("pipes",true)}
  action cleanup = all {s.phase=="cleanup",s.pipes,not(s.child),
    s'=s.with("phase","done").with("temporary",false)}
  action cleanupDeadline = all {s.phase=="cleanup",
    s'=s.with("phase","done").with("failed",true).with("temporary",false)}
  action report = all {s.phase=="done",s'=s.with("result",if(s.failed) "fail" else "pass")}
  action step = {nondet ok=Set(false,true).oneOf()
    any {start,launcherExit(ok),cancel,killGroup,drain,cleanup,cleanupDeadline,report,s'=s}}
  val invariant = all {s.result=="pass" implies all {not(s.failed),not(s.launcher),
    not(s.child),s.pipes,not(s.temporary)},s.failed implies s.result!="pass"}
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
}
