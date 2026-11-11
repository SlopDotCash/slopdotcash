// @source scripts/pull-request-git-files.ts
// Immutable two-parent merge evidence, one submitted merge-base and identical raw
// change digest precede streamed numstat publication. No source checkout/execution.
module git_file_recovery {
  type S={merge:bool,parents:bool,base:bool,delta:bool,files:Set[int],complete:bool,published:bool,executed:bool}
  var s:S
  action init=s'={merge:false,parents:false,base:false,delta:false,files:Set(),complete:false,published:false,executed:false}
  action inspect(merge:bool,parents:bool,base:bool,delta:bool):bool=all{not(s.published),s.files.size()==0,s'=s.with("merge",merge).with("parents",parents).with("base",base).with("delta",delta)}
  action file(id:int):bool=all{s.merge,s.parents,s.base,s.delta,not(s.files.contains(id)),not(s.published),s'=s.with("files",s.files.union(Set(id)))}
  action endStream=all{s.files==Set(1,2),s'=s.with("complete",true)}
  action publish=all{s.merge,s.parents,s.base,s.delta,s.complete,s'=s.with("published",true)}
  action step=any{inspect(true,true,true,true),inspect(true,true,false,true),inspect(true,true,true,false),file(1),file(2),endStream,publish,s'=s}
  val invariant=all{not(s.executed),s.published implies s.merge and s.parents and s.base and s.delta and s.complete}
  run matchingMergePublishesTest=init.then(inspect(true,true,true,true)).then(file(1)).then(file(2)).then(endStream).then(publish).expect(invariant)
  run alteredMergeRefusedTest=init.then(inspect(true,true,true,false)).then(file(1).fail())
  run incompleteNumstatRefusedTest=init.then(inspect(true,true,true,true)).then(file(1)).then(publish.fail())
  run duplicatePathRefusedTest=init.then(inspect(true,true,true,true)).then(file(1)).then(file(1).fail())
}
