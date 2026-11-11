// @source backend/projects/handler.ts
// @source backend/projects/cloudflare-persistence.ts
// @source src/ProjectProposalPage.tsx
// @evidence scripts/project-self-service.test.ts
// One own publication, one concurrent publication and a possible retry.
// Revision 1..3 and two local draft values. Authority/manifest validity and
// transactional writes are external predicates; scenarios are unexecuted.
module api_project_revision_receipt {
  var s:{head:int,phase:str,expected:int,committed:int,response:int,base:int,
    draft:int,submitted:int,conflict:bool,otherWritten:bool}
  action init=s'={head:1,phase:"idle",expected:0,committed:0,response:0,base:1,draft:1,submitted:0,conflict:false,otherWritten:false}
  action submit=all{s.phase=="idle",s'=s.with("expected",s.base).with("submitted",s.draft).with("phase","pending")}
  action commit=all{s.phase=="pending",s.expected==s.head,s.head<3,
    s'=s.with("head",s.head+1).with("committed",s.head+1).with("phase","committed")}
  action typeDuringSave=all{s.phase=="pending" or s.phase=="committed",s'=s.with("draft",2)}
  action anotherWriter=all{s.head<3,not(s.otherWritten),s'=s.with("head",s.head+1).with("otherWritten",true)}
  action reply=all{s.phase=="committed",s'=s.with("response",s.committed).with("base",s.committed).with("phase","replied")}
  action retry=all{s.phase=="replied",s.draft!=s.submitted,
    s'=s.with("conflict",s.base!=s.head).with("phase","retried")}
  action refuse=all{s.phase=="pending",s.expected!=s.head,s'=s.with("conflict",true).with("phase","refused")}
  action step=any{submit,commit,typeDuringSave,anotherWriter,reply,retry,refuse,s'=s}
  val invariant=all{s.head>=1,s.head<=3,s.base<=s.head,s.response>0 implies s.response==s.committed}
  run replyWithoutCompetingWriteTest=init.then(submit).then(commit).then(reply).expect(s.response==2 and s.head==2)
  run laterHeadCannotReplaceReceiptTest=init.then(submit).then(commit).then(anotherWriter).then(reply)
    .expect(s.head==3 and s.response==2 and s.base==2)
  run editedDraftCannotSilentlyUseLaterHeadTest=init.then(submit).then(typeDuringSave).then(commit).then(anotherWriter).then(reply).then(retry)
    .expect(s.conflict and s.head==3)
  run competingWriteBeforeCommitRefusesTest=init.then(submit).then(anotherWriter).then(refuse)
    .expect(s.conflict and s.committed==0 and s.response==0)
}
