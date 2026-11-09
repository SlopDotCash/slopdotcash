// @source scripts/sync-project-registry.mjs
// Related files are validated together before a build may use them. Individual
// file writes are not a transaction: a failed second write is represented by a
// detectable mismatch. The deployment pipeline must not publish that build.
// Cycle-directory staging/removal is separate in cycle_snapshot_publication.
module registry_snapshot_publication {
  var s: {phase:str,projectRevision:int,historyRevision:int,rendered:int,
    restriction:bool,coherent:bool,buildAllowed:bool}
  action init = s'={phase:"old",projectRevision:1,historyRevision:1,rendered:0,
    restriction:false,coherent:true,buildAllowed:false}
  action readPair(coherent,restricted) = all {s.phase=="old",coherent,
    s'=s.with("phase","rendered").with("rendered",2).with("restriction",restricted).with("buildAllowed",false)}
  action writeProject = all {s.phase=="rendered",s'=s.with("phase","project-written")
    .with("projectRevision",2).with("coherent",false).with("buildAllowed",false)}
  action writeHistory = all {s.phase=="project-written",s'=s.with("phase","written")
    .with("historyRevision",2).with("coherent",true)}
  action check = all {s.projectRevision==s.historyRevision,s.coherent,
    s'=s.with("buildAllowed",true)}
  action step = {nondet a=Set(false,true).oneOf() nondet b=Set(false,true).oneOf()
    any {readPair(a,b),writeProject,writeHistory,check,s'=s}}
  val invariant = s.buildAllowed implies (s.coherent and s.projectRevision==s.historyRevision)
  run inconsistentReadRefusedTest = init.then(readPair(false,false).fail())
  run halfWriteCannotBuildTest = init.then(readPair(true,false)).then(writeProject).then(check.fail())
  run pairedFilesCanBuildTest = init.then(readPair(true,true)).then(writeProject).then(writeHistory).then(check)
    .expect(s.buildAllowed and s.restriction and invariant)
}
