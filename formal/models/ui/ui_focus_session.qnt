// @source src/lib/project-api.ts
// @source src/Admin.tsx
// @source src/ProjectProposalPage.tsx
// Three request generations. A focus/visible/BFCache event immediately hides
// authority while the newest response is pending. Requests may finish out of
// order; endpoint identity/role results are external, not browser authority.
module ui_focus_session {
  var s:{current:int,accepted:int,phase:str,actor:int,role:bool,pending:Set[int],mounted:bool}
  action init = s'={current:1,accepted:0,phase:"checking",actor:0,role:false,pending:Set(1),mounted:true}
  action refresh = all {s.mounted,s.current<3,
    s'=s.with("current",s.current+1).with("phase","checking").with("actor",0)
      .with("role",false).with("pending",s.pending.union(Set(s.current+1)))}
  action focus = refresh
  action becomeVisible = refresh
  action restoreHistory = refresh
  action response(epoch:int,actor:int,role:bool):bool = all {s.pending.contains(epoch),
    s'=if(s.mounted and epoch==s.current)
      s.with("accepted",epoch).with("phase",if(actor==0) "signed-out" else "verified")
        .with("actor",actor).with("role",actor!=0 and role).with("pending",s.pending.exclude(Set(epoch)))
    else s.with("pending",s.pending.exclude(Set(epoch)))}
  action failLatest = all {s.pending.contains(s.current),s.mounted,
    s'=s.with("phase","error").with("actor",0).with("role",false)
      .with("pending",s.pending.exclude(Set(s.current)))}
  action unmount = s'=s.with("mounted",false).with("phase","departed").with("actor",0).with("role",false)
  val controls = s.mounted and s.phase=="verified" and s.role
  action step = any {focus,becomeVisible,restoreHistory,failLatest,unmount,
    response(1,1,true),response(1,0,false),response(2,1,true),response(2,0,false),
    response(3,1,false),response(3,0,false),s'=s}
  val invariant = all {controls implies s.accepted==s.current,
    s.phase=="checking" implies not(controls),s.actor==0 implies not(s.role)}
  run focusClosesAdminTest = init.then(response(1,1,true)).then(focus).expect(not(controls) and s.phase=="checking")
  run signedOutReturnTest = init.then(response(1,1,true)).then(becomeVisible).then(response(2,0,false)).expect(not(controls) and s.phase=="signed-out")
  run staleResponseCannotRestoreTest = init.then(response(1,1,true)).then(focus).then(focus)
    .then(response(3,0,false)).then(response(2,1,true)).expect(not(controls) and s.accepted==3)
  run restoredHistoryRechecksTest = init.then(response(1,1,true)).then(restoreHistory).then(failLatest).expect(not(controls) and s.phase=="error")
}
