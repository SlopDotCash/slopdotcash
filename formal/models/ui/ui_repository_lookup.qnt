// @source src/ProjectProposalPage.tsx
// @source src/lib/project-proposal.ts
// Two repositories/request epochs, one editable description. Schema and GitHub
// facts are external predicates; this models their application to the draft.
// E2E: tests/e2e/project-proposal.spec.ts (failed/partial lookup and branch choice).
module ui_repository_lookup {
  var s:{repo:int,epoch:int,pending:Set[int],accepted:int,phase:str,facts:int,
    branch:int,description:int,previousSuggestion:int,mounted:bool}
  action init = s'={repo:1,epoch:1,pending:Set(),accepted:0,phase:"idle",facts:0,
    branch:0,description:0,previousSuggestion:0,mounted:true}
  action lookup = all {s.mounted,s.repo>0,s.phase!="loading",
    s'=s.with("pending",s.pending.union(Set(s.epoch))).with("phase","loading")}
  action changeRepository = all {s.epoch==1,
    s'=s.with("repo",2).with("epoch",2).with("phase","idle").with("facts",0).with("branch",0)}
  action invalidRepository = all {s.epoch==1,
    s'=s.with("repo",0).with("epoch",2).with("phase","idle").with("facts",0).with("branch",0)}
  action editDescription = s'=s.with("description",2)
  action success(epoch:int):bool = all {s.pending.contains(epoch),
    s'=if(s.mounted and s.epoch==epoch and s.repo>0)
      s.with("pending",s.pending.exclude(Set(epoch))).with("accepted",epoch).with("phase","ready")
        .with("facts",s.repo).with("branch",s.repo)
        .with("description",if(s.description==0 or s.description==s.previousSuggestion) 1 else s.description)
        .with("previousSuggestion",1)
      else s.with("pending",s.pending.exclude(Set(epoch)))}
  action failed(epoch:int):bool = all {s.pending.contains(epoch),
    s'=if(s.mounted and s.epoch==epoch) s.with("phase","error").with("pending",s.pending.exclude(Set(epoch)))
      else s.with("pending",s.pending.exclude(Set(epoch)))}
  action depart = s'=s.with("mounted",false)
  action step = any {lookup,changeRepository,invalidRepository,editDescription,
    success(1),success(2),failed(1),failed(2),depart,s'=s}
  val invariant = all {s.facts>0 implies s.facts==s.repo and s.accepted==s.epoch,
    s.repo==0 implies s.facts==0 and s.branch==0}
  run obsoleteFactsTest = init.then(lookup).then(changeRepository).then(lookup)
    .then(success(1)).expect(s.facts==0 and s.phase=="loading")
  run currentFactsTest = init.then(lookup).then(changeRepository).then(lookup)
    .then(success(1)).then(success(2)).expect(s.facts==2 and s.branch==2)
  run typedDescriptionSurvivesTest = init.then(lookup).then(editDescription)
    .then(success(1)).expect(s.description==2)
  run invalidInputCancelsTest = init.then(lookup).then(invalidRepository)
    .then(success(1)).expect(s.facts==0)
}
