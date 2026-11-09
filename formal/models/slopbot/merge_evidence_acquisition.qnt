// @source scripts/value-merge-ingestion.ts
// @source scripts/value-merge-objects.ts
// @source scripts/value-merge-resolution.ts
// @source scripts/collect-value-evidence.ts
// @source scripts/create-value-merge-bundle.ts
// Two commits and two blobs abstract a complete parent/tree/changed-object
// closure. Native Git/fsck/merge-tree semantics are tested separately. Export
// never enters the checkout, never executes source, and never overwrites evidence.
// Public hydration verifies remote identity and pins its Git acquisition tool.
// Export from a caller's existing local object store only proves the required
// immutable graph/parent closure, not public hosting or the acquisition tool.
module merge_evidence_acquisition {
  var s: {phase:str,mode:str,publicRepository:bool,identity:bool,pinnedGit:bool,
    parents:bool,objects:Set[int],needed:Set[int],isolated:bool,
    outside:bool,verified:bool,published:bool,cleaned:bool,executedSource:bool}
  action init = s'={phase:"new",mode:"public-fetch",publicRepository:false,identity:false,pinnedGit:false,
    parents:false,objects:Set(),needed:Set(1,2,3,4),isolated:false,
    outside:false,verified:false,published:false,cleaned:false,executedSource:false}
  action localExport = all {s.phase=="new",s'=s.with("mode","local-export")}
  action inspect(publicRepository,identity,pinnedGit,outside) = all {s.phase=="new",
    s'=s.with("phase","inspected").with("publicRepository",publicRepository)
      .with("identity",identity).with("pinnedGit",pinnedGit).with("outside",outside)}
  action acquire = all {s.phase=="inspected",s.identity,
    s.mode=="local-export" or (s.publicRepository and s.pinnedGit),
    s'=s.with("phase","acquiring").with("isolated",true)}
  action object(id) = all {s.phase=="acquiring",s.needed.contains(id),
    s'=s.with("objects",s.objects.union(Set(id)))}
  action inspectParents(matches) = all {s.phase=="acquiring",matches,
    s'=s.with("parents",true)}
  action verify = all {s.phase=="acquiring",s.parents,s.needed.subseteq(s.objects),
    s'=s.with("phase","verified").with("verified",true)}
  action publish(newPath) = all {s.phase=="verified",s.outside,newPath,
    s'=s.with("phase","published").with("published",true)}
  action cleanup = all {s.isolated,s.phase!="cleaned",
    s'=s.with("phase","cleaned").with("cleaned",true)}
  action step = {nondet id=Set(1,2,3,4).oneOf() nondet a=Set(false,true).oneOf()
    nondet b=Set(false,true).oneOf() nondet c=Set(false,true).oneOf() nondet d=Set(false,true).oneOf()
    any {localExport,inspect(a,b,c,d),acquire,object(id),inspectParents(a),verify,publish(a),cleanup,s'=s}}
  val invariant = all {
    not(s.executedSource),s.objects.subseteq(s.needed),
    s.verified implies (s.identity and s.parents and s.needed.subseteq(s.objects)),
    s.verified and s.mode=="public-fetch" implies (s.publicRepository and s.pinnedGit),
    s.published implies (s.verified and s.outside),
  }
  run incompleteObjectsRefusedTest = init.then(inspect(true,true,true,true)).then(acquire)
    .then(object(1)).then(inspectParents(true)).then(verify.fail())
  run privateRepositoryRefusedTest = init.then(inspect(false,true,true,true)).then(acquire.fail())
  run completeExportTest = init.then(inspect(true,true,true,true)).then(acquire).then(object(1))
    .then(object(2)).then(object(3)).then(object(4)).then(inspectParents(true)).then(verify)
    .then(publish(true)).then(cleanup).expect(s.published and s.cleaned and invariant)
  run exportCannotOverwriteTest = init.then(inspect(true,true,true,true)).then(acquire).then(object(1))
    .then(object(2)).then(object(3)).then(object(4)).then(inspectParents(true)).then(verify).then(publish(false).fail())
  run localExportVerifiesClosureWithoutPublicAuthorityTest = init.then(localExport)
    .then(inspect(false,true,false,true)).then(acquire).then(object(1)).then(object(2))
    .then(object(3)).then(object(4)).then(inspectParents(true)).then(verify).then(publish(true))
    .then(cleanup).expect(s.published and s.cleaned and invariant)
}
