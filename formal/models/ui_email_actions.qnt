// @source src/InboxEmail.tsx
// Token grammar/email delivery remain backend predicates. Two replacement
// links and two actors bound stale success, failure, discard and departure.
// E2E: tests/e2e/email-link-action.spec.ts and email-preference-actor-binding.spec.ts.
module ui_email_actions {
  var s:{generation:int,token:int,actor:int,expected:int,pending:Set[int],
    done:bool,error:bool,mounted:bool,stored:int,busy:bool}
  action init = s'={generation:1,token:1,actor:1,expected:1,pending:Set(),
    done:false,error:false,mounted:true,stored:1,busy:false}
  action submit = all {s.token>0,s.mounted,s.actor==s.expected,not(s.done),not(s.busy),
    s'=s.with("pending",s.pending.union(Set(s.generation))).with("busy",true)}
  action replacement = all {s.generation==1,
    s'=s.with("generation",2).with("token",2).with("stored",2).with("done",false).with("error",false)}
  action complete(epoch:int):bool = all {s.pending.contains(epoch),
    s'=if(s.generation==epoch and s.mounted and s.actor==s.expected)
      s.with("done",true).with("stored",0).with("pending",s.pending.exclude(Set(epoch))).with("busy",false)
      else s.with("pending",s.pending.exclude(Set(epoch))).with("busy",false)}
  action reject(epoch:int):bool = all {s.pending.contains(epoch),
    s'=if(s.generation==epoch and s.mounted) s.with("error",true).with("pending",s.pending.exclude(Set(epoch))).with("busy",false)
      else s.with("pending",s.pending.exclude(Set(epoch))).with("busy",false)}
  action actorChanges = s'=s.with("actor",2)
  action discard = all {s.generation==1,
    s'=s.with("generation",2).with("token",0).with("stored",0).with("done",false)}
  action depart = s'=s.with("mounted",false).with("generation",2)
  action step = any {submit,replacement,complete(1),complete(2),reject(1),reject(2),actorChanges,discard,depart,s'=s}
  val invariant = all {s.done implies s.stored==0,
    s.token==0 implies s.stored==0,
    s.stored>0 implies s.stored==s.token}
  run oldSuccessLeavesNewLinkTest = init.then(submit).then(replacement).then(complete(1)).expect(not(s.done) and s.stored==2)
  run oldFailureLeavesNewLinkTest = init.then(submit).then(replacement).then(reject(1)).expect(not(s.error) and s.stored==2)
  run newLinkCompletesTest = init.then(submit).then(replacement).then(complete(1)).then(submit).then(complete(2)).expect(s.done)
  run actorChangeRefusesCompletionTest = init.then(submit).then(actorChanges).then(complete(1)).expect(not(s.done))
  run discardedLinkStaysDiscardedTest = init.then(submit).then(discard).then(complete(1)).expect(s.stored==0 and not(s.done))
}
