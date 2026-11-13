// @source src/Admin.tsx
// @source src/lib/project-api.ts
// Two editor instances sharing one project/revision draft slot, three draft
// values and one save per instance. API acceptance and actor authorization are
// external predicates; this models response ownership, not server revision CAS.
// Source-only model: no scenarios or verifier were run for this revision.
module ui_admin_editor_lifetime {
  var s:{alive:Set[int],local:List[int],submitted:List[int],pending:Set[int],
    stored:int,server:int,navigated:Set[int],retained:Set[int],errors:Set[int],
    storageErrors:Set[int],clearExpected:int,clearObserved:int,didClear:bool}
  action init=s'={alive:Set(1),local:List(1,0),submitted:List(0,0),pending:Set(),
    stored:1,server:0,navigated:Set(),retained:Set(),errors:Set(),storageErrors:Set(),
    clearExpected:0,clearObserved:0,didClear:false}
  action leave(id:int):bool=all{s.alive.contains(id),s'=s.with("alive",s.alive.exclude(Set(id)))}
  action remount=all{not(s.alive.contains(1)),not(s.alive.contains(2)),s.local[1]==0,
    s'=s.with("alive",s.alive.union(Set(2))).with("local",s.local.replaceAt(1,if(s.stored==0)1 else s.stored))}
  action edit(id:int,value:int):bool=all{s.alive.contains(id),value>=1,value<=3,
    s'=s.with("local",s.local.replaceAt(id-1,value))}
  action persist(id:int,works:bool):bool=all{s.alive.contains(id),
    s'=if(works)s.with("stored",s.local[id-1]).with("storageErrors",s.storageErrors.exclude(Set(id)))
    else s.with("storageErrors",s.storageErrors.union(Set(id)))}
  action save(id:int):bool=all{s.alive.contains(id),s.submitted[id-1]==0,
    s'=s.with("submitted",s.submitted.replaceAt(id-1,s.local[id-1]))
      .with("pending",s.pending.union(Set(id))).with("errors",s.errors.exclude(Set(id)))}
  action response(id:int,accepted:bool,removeWorks:bool):bool=all{s.pending.contains(id),
    s'=if(not(accepted))
      s.with("pending",s.pending.exclude(Set(id)))
        .with("errors",if(s.alive.contains(id))s.errors.union(Set(id)) else s.errors)
        .with("didClear",false)
    else s.with("pending",s.pending.exclude(Set(id))).with("server",s.submitted[id-1])
      .with("stored",if(s.stored==s.submitted[id-1] and removeWorks)0 else s.stored)
      .with("clearExpected",s.submitted[id-1]).with("clearObserved",s.stored)
      .with("didClear",s.stored==s.submitted[id-1] and removeWorks)
      .with("navigated",if(s.alive.contains(id) and s.local[id-1]==s.submitted[id-1])s.navigated.union(Set(id)) else s.navigated)
      .with("alive",if(s.alive.contains(id) and s.local[id-1]==s.submitted[id-1])s.alive.exclude(Set(id)) else s.alive)
      .with("retained",if(s.alive.contains(id) and s.local[id-1]!=s.submitted[id-1])s.retained.union(Set(id)) else s.retained)}
  action step={nondet id=Set(1,2).oneOf() nondet value=Set(1,2,3).oneOf()
    any{leave(id),remount,edit(id,value),persist(id,true),persist(id,false),save(id),
      response(id,true,true),response(id,true,false),response(id,false,true),s'=s}}
  val invariant=all{s.stored>=0,s.stored<=3,s.server>=0,s.server<=3,
    s.didClear implies s.clearExpected==s.clearObserved,
    s.navigated.forall(id=>s.local[id-1]==s.submitted[id-1] and not(s.alive.contains(id))),
    s.retained.intersect(s.pending)==Set()}
  run oldSavePreservesRemountedDraftTest=init.then(save(1)).then(leave(1)).then(remount)
    .then(edit(2,2)).then(persist(2,true)).then(response(1,true,true))
    .expect(s.stored==2 and s.local[1]==2 and s.alive.contains(2) and s.navigated==Set())
  run changedCurrentDraftStaysOpenTest=init.then(save(1)).then(edit(1,2)).then(persist(1,true))
    .then(response(1,true,true)).expect(s.stored==2 and s.server==1 and s.retained.contains(1)
      and not(s.pending.contains(1)) and s.alive.contains(1) and s.navigated==Set())
  run unstoredNewEditsStayInMemoryTest=init.then(save(1)).then(edit(1,2)).then(persist(1,false))
    .then(response(1,true,true)).expect(s.local[0]==2 and s.server==1 and s.retained.contains(1) and s.alive.contains(1))
  run unchangedCurrentSaveKeepsSuccessFlowTest=init.then(save(1)).then(response(1,true,true))
    .expect(s.stored==0 and s.server==1 and s.navigated==Set(1))
  run departedFailureCannotChangeNewEditorTest=init.then(save(1)).then(leave(1)).then(remount)
    .then(edit(2,3)).then(persist(2,true)).then(response(1,false,true))
    .expect(s.stored==3 and s.local[1]==3 and s.errors==Set() and s.alive.contains(2))
  run currentFailureRetainsDraftTest=init.then(save(1)).then(edit(1,2)).then(persist(1,true))
    .then(response(1,false,true)).expect(s.stored==2 and s.errors==Set(1) and not(s.pending.contains(1)))
  run storageRemovalFailureDoesNotUndoSavedRevisionTest=init.then(save(1)).then(response(1,true,false))
    .expect(s.stored==1 and s.server==1 and s.navigated==Set(1))
}
