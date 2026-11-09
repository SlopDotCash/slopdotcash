// @source src/GeneratedSkillPreview.tsx
// @source src/lib/project-skill.mjs
// @evidence tests/e2e/project-proposal.spec.ts
// GeneratedSkillPreview only. VettingEvidence is refined separately by
// ui_vetting_inventory, ui_vetting_reader and ui_evidence_blob_download.
// Two manifest texts and two asynchronous digest requests; roles contributor/
// reviewer and paths SKILL.md/project.json. Current callers use draft+compact
// (proposal) or registry+full (admin), never both provenance modes together.
// Renderer validation is a predicate. Preview files are a synchronous pure
// projection of current manifest+provenance; their bytes are not reimplemented.
// A source change does not cancel crypto. Before passive cleanup a stale digest
// may still write its tagged state; the source comparison refuses to show it.
// After cleanup its continuation is ignored. Digest work can finish after exit.
// Hash identity, UTF-8 rendering and React scheduling are external assumptions.
// No session/authority, private grant, download or installation claim is made.
// Authored by source inspection, not executed.
module ui_artifacts {
  val ids=Set(1,2)
  type Digest={source:int,phase:str}
  type S={present:bool,mode:str,source:int,generated:bool,renderer:bool,compact:bool,
    active:int,cachedSource:int,digest:bool,digestError:bool,role:int,path:int,requests:int->Digest}
  var s:S
  def initial(mode:str):S={present:true,mode:mode,source:1,generated:true,renderer:true,compact:mode=="draft",
    active:0,cachedSource:0,digest:false,digestError:false,role:1,path:1,
    requests:ids.mapBy(_=>{source:0,phase:"unused"})}
  action init={nondet mode=Set("draft","registry").oneOf();s'=initial(mode)}
  action draft=s'=initial("draft")
  action registry=s'=initial("registry")
  val provenance=s.mode=="registry" or (s.cachedSource==s.source and s.digest)
  val view=if(not(s.present))"absent"
    else if(s.mode=="draft" and s.cachedSource==s.source and s.digestError)"digest-error"
    else if(not(provenance))"preparing" else if(not(s.generated))"committed"
    else if(not(s.renderer))"render-error" else "preview"
  val visibleSource=if(view=="preview")s.source else 0
  val visiblePath=if(s.compact)1 else s.path
  action begin(id:int):bool=all{s.present,s.mode=="draft",s.active==0,s.requests.get(id).phase=="unused",
    s'=s.with("active",id).with("requests",s.requests.put(id,{source:s.source,phase:"pending"}))}
  action changeSource(generated:bool,renderer:bool):bool=all{s.present,s.source==1,
    s'=s.with("source",2).with("generated",generated).with("renderer",renderer)}
  action cleanup=all{s.active!=0,not(s.present) or s.requests.get(s.active).source!=s.source,
    s'=s.with("active",0)}
  action reply(id:int,ok:bool):bool={val r=s.requests.get(id)
    all{r.phase=="pending",
      s'=(if(s.active==id)s.with("cachedSource",r.source).with("digest",ok).with("digestError",not(ok)) else s)
        .with("requests",s.requests.put(id,r.with("phase","done")))}}
  action depart=all{s.present,s'=s.with("present",false)}
  action selectRole(role:int):bool=all{view=="preview",ids.contains(role),s'=s.with("role",role)}
  action selectPath(path:int):bool=all{view=="preview",not(s.compact),ids.contains(path),s'=s.with("path",path)}
  action step={nondet id=ids.oneOf() nondet yes=Set(false,true).oneOf() nondet other=Set(false,true).oneOf()
    any{begin(id),changeSource(yes,other),cleanup,reply(id,yes),depart,selectRole(id),selectPath(id),s'=s}}
  val invariant=all{visibleSource>0 implies provenance and visibleSource==s.source,
    s.mode=="draft" and visibleSource>0 implies s.cachedSource==s.source and s.digest and not(s.digestError),
    s.compact implies visiblePath==1,ids.contains(s.role),ids.contains(visiblePath)}
  run draftWaitsForDigestTest=draft.then(begin(1)).expect(view=="preparing" and visibleSource==0)
  run matchingDigestShowsCurrentManifestTest=draft.then(begin(1)).then(reply(1,true)).expect(view=="preview" and visibleSource==1 and invariant)
  run failedDigestShowsCurrentErrorTest=draft.then(begin(1)).then(reply(1,false)).expect(view=="digest-error" and visibleSource==0)
  run oldDigestCanWriteBeforePassiveCleanupTest=draft.then(begin(1)).then(changeSource(true,true)).then(reply(1,true))
    .expect(s.cachedSource==1 and s.source==2 and view=="preparing" and invariant)
  run oldDigestErrorIsHiddenForNewSourceTest=draft.then(begin(1)).then(changeSource(true,true)).then(reply(1,false))
    .expect(s.digestError and view=="preparing" and invariant)
  run oldDigestAfterCleanupIsIgnoredTest=draft.then(begin(1)).then(changeSource(true,true)).then(cleanup).then(begin(2)).then(reply(1,true))
    .expect(s.cachedSource==0 and view=="preparing" and invariant)
  run newDigestOutranksOldCompletionTest=draft.then(begin(1)).then(changeSource(true,true)).then(cleanup).then(begin(2))
    .then(reply(2,true)).then(reply(1,false)).expect(s.cachedSource==2 and view=="preview" and visibleSource==2 and invariant)
  run changedManifestCanRecoverDigestErrorTest=draft.then(begin(1)).then(reply(1,false)).then(changeSource(true,true)).then(cleanup)
    .then(begin(2)).then(reply(2,true)).expect(view=="preview" and visibleSource==2 and invariant)
  run departingDoesNotCancelCryptoTest=draft.then(begin(1)).then(depart).then(reply(1,true))
    .expect(s.requests.get(1).phase=="done" and view=="absent" and invariant)
  run cleanupAfterDepartureIgnoresDigestTest=draft.then(begin(1)).then(depart).then(cleanup).then(reply(1,true))
    .expect(s.cachedSource==0 and view=="absent" and invariant)
  run registryPreviewNeedsNoDigestTest=registry.expect(view=="preview" and s.active==0 and s.cachedSource==0 and invariant)
  run registryReplacementIsSynchronousTest=registry.then(changeSource(true,true)).expect(visibleSource==2 and invariant)
  run committedSkillUsesExistingSourceMessageTest=registry.then(changeSource(false,true)).expect(view=="committed" and visibleSource==0)
  run invalidRendererDoesNotExposePartialFilesTest=registry.then(changeSource(true,false)).expect(view=="render-error" and visibleSource==0)
  run draftCommittedSkillStillWaitsForProvenanceTest=draft.then(changeSource(false,true)).then(begin(1))
    .expect(view=="preparing").then(reply(1,true)).expect(view=="committed")
  run fullPreviewSelectsEachRoleAndFileTest=registry.then(selectRole(2)).then(selectPath(2))
    .expect(s.role==2 and visiblePath==2 and visibleSource==1 and invariant)
  run compactPreviewKeepsSkillFileTest=draft.then(begin(1)).then(reply(1,true)).then(selectRole(2))
    .expect(s.role==2 and visiblePath==1 and invariant).then(selectPath(2).fail())
}
