// @source src/lib/project-draft-store.ts
// @source src/ProjectProposalPage.tsx
// Three rendered payload epochs (including A -> B -> A and discard), and a
// FIFO project-lock write queue. The payload/epoch pair abstracts React's
// acknowledgement reset; older completions never acknowledge the new view.
// E2E: project-proposal.spec.ts and project-draft-storage.spec.ts.
module ui_draft_save_progress {
  var s:{epoch:int,payload:int,captured:int->int,queue:List[int],begun:Set[int],
    acknowledged:int,failed:bool,stored:int}
  action init = s'={epoch:1,payload:1,captured:Map(1->1,2->2,3->0),queue:List(),
    begun:Set(),acknowledged:0,failed:false,stored:0}
  action differentPayload = all {s.epoch==1,
    s'=s.with("epoch",2).with("payload",2).with("acknowledged",0).with("failed",false)}
  action returnToFirstPayload = all {s.epoch==2,
    s'=s.with("epoch",3).with("payload",1).with("captured",s.captured.set(3,1))
      .with("acknowledged",0).with("failed",false)}
  action discard = all {s.epoch==2,
    s'=s.with("epoch",3).with("payload",0).with("acknowledged",0).with("failed",false)}
  action enqueue = all {not(s.begun.contains(s.epoch)),
    s'=s.with("queue",s.queue.append(s.epoch)).with("begun",s.begun.union(Set(s.epoch)))}
  action deliver(success:bool,written:bool):bool = {
    val job=if(s.queue.length()>0) s.queue[0] else 1
    all {s.queue.length()>0,
      s'=s.with("queue",s.queue.slice(1,s.queue.length()))
        .with("stored",if(written) s.captured.get(job) else s.stored)
        .with("acknowledged",if(job==s.epoch) job else s.acknowledged)
        .with("failed",if(job==s.epoch) not(success) else s.failed)}
  }
  val savedLabel = s.acknowledged==s.epoch and not(s.failed)
  action step = any {differentPayload,returnToFirstPayload,discard,enqueue,deliver(true,true),deliver(false,false),deliver(false,true),s'=s}
  val invariant = savedLabel implies s.stored==s.payload
  run renderImmediatelyClosesSavedTest = init.then(enqueue).then(deliver(true,true)).then(differentPayload).expect(not(savedLabel))
  run olderFailureCannotAcknowledgeNewPayloadTest = init.then(enqueue).then(differentPayload).then(enqueue)
    .then(deliver(false,false)).expect(not(savedLabel) and not(s.failed))
  run returningPayloadStillWaitsTest = init.then(enqueue).then(deliver(true,true)).then(differentPayload).then(enqueue)
    .then(returnToFirstPayload).then(enqueue).expect(not(savedLabel))
    .then(deliver(true,true)).expect(not(savedLabel)).then(deliver(true,true)).expect(savedLabel and s.stored==1)
  run partialStorageFailureDoesNotClaimSavedTest = init.then(enqueue).then(deliver(false,true))
    .expect(not(savedLabel) and s.failed and s.stored==s.payload)
  run discardIsAcknowledgedTest = init.then(enqueue).then(deliver(true,true)).then(differentPayload).then(discard)
    .then(enqueue).expect(not(savedLabel)).then(deliver(true,true)).expect(savedLabel and s.stored==0)
}
