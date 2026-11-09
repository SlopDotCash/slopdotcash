// @source src/lib/project-draft-store.ts
// @source src/ProjectProposalPage.tsx
// Two documents/slots, payloads 0..2, revision labels 0..3. A write action is
// the synchronous callback under the project lock; ui_draft_save_progress
// models its asynchronous queue and acknowledgement. Slot Web Locks and
// distinct UUIDs are platform assumptions, not claims about arbitrary storage.
// E2E: tests/e2e/project-draft-storage.spec.ts. JSON/schema grammar is separate.
module ui_draft_slots {
  pure val tabs = Set(1,2)
  pure val slots = Set(1,2)
  var s:{owner:int->int,value:int->int,revision:int->int,pointer:int->int,
    current:int->int,memory:int->int,alive:Set[int],clock:int,legacy:int,imported:bool}
  action init = s'={owner:slots.mapBy(_=>0),value:slots.mapBy(_=>0),revision:slots.mapBy(_=>0),
    pointer:tabs.mapBy(_=>0),current:tabs.mapBy(_=>0),memory:tabs.mapBy(_=>0),
    alive:Set(),clock:0,legacy:0,imported:false}
  val newest = slots.fold(0,(best,slot)=>
    if(s.value.get(slot)>0 and (best==0 or s.revision.get(slot)>s.revision.get(best))) slot else best)
  def selected(tab:int):int = if(s.pointer.get(tab)== -1) 0
    else if(s.pointer.get(tab)>0) s.pointer.get(tab) else newest
  action open(tab:int):bool = {
    val source=selected(tab)
    val reusable=if(source>0) s.owner.get(source)==0 else false
    nondet target=(if(reusable) Set(source)
      else slots.filter(slot=>s.owner.get(slot)==0 and s.value.get(slot)==0)).oneOf()
    val value=if(source>0) s.value.get(source) else if(not(s.imported) and s.pointer.get(tab)==0) s.legacy else 0
    all {not(s.alive.contains(tab)),reusable or value==0 or s.clock<3,
      s'=s.with("alive",s.alive.union(Set(tab))).with("owner",s.owner.set(target,tab))
        .with("current",s.current.set(tab,target)).with("pointer",s.pointer.set(tab,target))
        .with("memory",s.memory.set(tab,value)).with("value",s.value.set(target,value))
        .with("revision",if(reusable) s.revision else s.revision.set(target,if(value>0) s.clock+1 else 0))
        .with("clock",if(value>0 and not(reusable)) s.clock+1 else s.clock)
        .with("imported",s.imported or (value>0 and not(reusable)))}
  }
  // A fork can persist before marker/pointer failure. Its abandoned slot is
  // unlocked; the current form keeps its value in memory and reports failure.
  action openCopyFailure(tab:int,markerWritten:bool):bool = {
    val source=selected(tab)
    val value=if(source>0) s.value.get(source) else if(not(s.imported) and s.pointer.get(tab)==0) s.legacy else 0
    nondet target=slots.filter(slot=>s.owner.get(slot)==0 and s.value.get(slot)==0).oneOf()
    all {not(s.alive.contains(tab)),value>0,s.clock<3,
      if(source==0) true else s.owner.get(source)!=0,
      s'=s.with("value",s.value.set(target,value)).with("revision",s.revision.set(target,s.clock+1))
        .with("clock",s.clock+1).with("memory",s.memory.set(tab,value))
        .with("imported",s.imported or markerWritten)}
  }
  action legacyWrite = s'=s.with("legacy",1)
  action clonePointer = all {s.alive.contains(1),not(s.alive.contains(2)),s'=s.with("pointer",s.pointer.set(2,s.pointer.get(1)))}
  action edit(tab:int,value:int):bool = all {s.alive.contains(tab),s'=s.with("memory",s.memory.set(tab,value))}
  action write(tab:int,value:int,partial:bool):bool = {
    val slot=if(s.current.get(tab)>0) s.current.get(tab) else 1
    all {s.alive.contains(tab),s.owner.get(slot)==tab,value==0 or s.clock<3,
      s'=s.with("value",s.value.set(slot,value))
        .with("revision",s.revision.set(slot,if(value>0) s.clock+1 else 0))
        .with("clock",if(value>0) s.clock+1 else s.clock)
        .with("pointer",if(partial) s.pointer else s.pointer.set(tab,if(value==0) -1 else slot))
        .with("imported",s.imported or not(partial))}
  }
  // A failed call before the first storage mutation retains both copies.
  action failedBeforeWrite(tab:int):bool = all {s.alive.contains(tab),s'=s}
  action close(tab:int):bool = all {s.alive.contains(tab),
    s'=s.with("alive",s.alive.exclude(Set(tab))).with("current",s.current.set(tab,0))
      .with("owner",slots.mapBy(slot=>if(s.owner.get(slot)==tab) 0 else s.owner.get(slot)))}
  action newTab = all {not(s.alive.contains(1)),s'=s.with("pointer",s.pointer.set(1,0))}
  action clockMovesBackward = s'=s
  action step = any {legacyWrite,openCopyFailure(1,false),openCopyFailure(1,true),openCopyFailure(2,false),openCopyFailure(2,true),open(1),open(2),clonePointer,edit(1,1),edit(1,2),edit(1,0),edit(2,1),edit(2,2),edit(2,0),
    write(1,0,false),write(1,1,false),write(1,2,false),write(2,0,false),write(2,1,false),write(2,2,false),
    write(1,0,true),write(1,1,true),write(1,2,true),write(2,0,true),write(2,1,true),write(2,2,true),
    failedBeforeWrite(1),failedBeforeWrite(2),close(1),close(2),newTab,clockMovesBackward,s'=s}
  val invariant = all {s.clock<=3,
    s.alive.forall(tab=>s.current.get(tab)>0 and s.owner.get(s.current.get(tab))==tab),
    s.alive==Set(1,2) implies s.current.get(1)!=s.current.get(2),
    slots.forall(slot=>s.revision.get(slot)<=s.clock)}
  run legacyImportDoesNotResurrectAfterDiscardTest = init.then(legacyWrite).then(open(1)).then(write(1,0,false))
    .then(close(1)).then(newTab).then(legacyWrite).then(open(1)).expect(s.memory.get(1)==0 and s.legacy==1)
  run serializedEditsHaveDifferentRevisionsTest = init.then(open(1)).then(open(2)).then(edit(1,1)).then(edit(2,2))
    .then(write(1,1,false)).then(write(2,2,false)).expect(s.revision.get(1)!=s.revision.get(2))
  run delayedPublishKeepsSecondDraftTest = init.then(open(1)).then(edit(1,1)).then(write(1,1,false))
    .then(clonePointer).then(open(2)).then(edit(2,2)).then(write(2,2,false))
    .then(edit(1,0)).then(write(1,0,false)).then(close(2)).then(open(2)).expect(s.memory.get(2)==2)
  run newestDoesNotUseWallClockTest = init.then(open(1)).then(edit(1,1)).then(write(1,1,false)).then(close(1)).then(newTab)
    .then(open(1)).then(clockMovesBackward).then(edit(1,2)).then(write(1,2,false)).then(close(1)).then(newTab).then(open(1))
    .expect(s.memory.get(1)==2)
  run partialWriteRemainsRecoverableTest = init.then(open(1)).then(edit(1,2)).then(write(1,2,true))
    .then(close(1)).then(open(1)).expect(s.memory.get(1)==2)
  run failedForkStillRetainsRecoverableBytesTest = init.then(legacyWrite).then(openCopyFailure(1,true))
    .then(newTab).then(open(1)).expect(s.memory.get(1)==1)
  run cloneNeverGrantsOwnerTest = init.then(open(1)).then(clonePointer).then(open(2)).expect(s.current.get(1)!=s.current.get(2))
}
