// @source scripts/verify-identity-schedules.mjs
// At most one explicit missing-schedule restoration. A successful PUT still
// requires a second GET; a mismatched nonempty schedule is never overwritten.
module identity_schedule_readback {
  var s: {phase:str,remote:str,restoreAllowed:bool,writes:int,reads:int,verified:bool}
  action init = s'={phase:"new",remote:"unknown",restoreAllowed:false,writes:0,reads:0,verified:false}
  action read(remote,allowed) = all {s.phase=="new",
    s'=s.with("phase","read").with("remote",remote).with("restoreAllowed",allowed).with("reads",1)}
  action restore = all {s.phase=="read",s.remote=="empty",s.restoreAllowed,s.writes==0,
    s'=s.with("phase","written").with("writes",1).with("restoreAllowed",false)}
  action reread(remote) = all {s.phase=="written",
    s'=s.with("phase","read").with("remote",remote).with("reads",2)}
  action verify = all {s.phase=="read",s.remote=="matching",
    s'=s.with("phase","verified").with("verified",true)}
  action step = {nondet r=Set("matching","empty","different").oneOf()
    nondet a=Set(false,true).oneOf()
    any {read(r,a),restore,reread(r),verify,s'=s}}
  val invariant = all {s.writes<=1,s.verified implies s.remote=="matching",
    s.verified and s.writes==1 implies s.reads==2}
  run existingMismatchCannotBeOverwrittenTest = init.then(read("different",true)).then(restore.fail())
  run successfulWriteNeedsReadbackTest = init.then(read("empty",true)).then(restore).then(verify.fail())
  run restorationIsNotRecursiveTest = init.then(read("empty",true)).then(restore).then(reread("empty")).then(restore.fail())
  run restoredScheduleVerifiedTest = init.then(read("empty",true)).then(restore).then(reread("matching"))
    .then(verify).expect(s.verified and invariant)
}
