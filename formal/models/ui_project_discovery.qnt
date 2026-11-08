// @source src/App.tsx
// @evidence tests/e2e/onboarding-clearance.spec.ts
// Project-keyed React subtree, two project generations and one read per mount.
// HTTP/schema validity and discovery membership are external predicates.
// A ready prompt is advice, not API authorization or permission to work.
module ui_project_discovery {
  var s: { project: int, phase: str, pending: Set[int], approved: int, mounted: bool }
  action init = s' = {project:1, phase:"loading", pending:Set(1), approved:0, mounted:true}
  action replaceProject = all {s.mounted, s.project == 1,
    s' = s.with("project",2).with("phase","loading").with("approved",0)
      .with("pending",s.pending.union(Set(2)))}
  action reply(generation:int, valid:bool, listed:bool):bool = all {
    s.pending.contains(generation),
    s' = if(s.mounted and generation == s.project)
      s.with("pending",s.pending.exclude(Set(generation)))
        .with("phase",if(not(valid)) "error" else if(listed) "ready" else "blocked")
        .with("approved",if(valid and listed) generation else 0)
      else s.with("pending",s.pending.exclude(Set(generation))) }
  action unmount = s' = s.with("mounted",false).with("approved",0)
  action step = any {replaceProject, reply(1,true,true), reply(1,true,false),
    reply(1,false,false), reply(2,true,true), reply(2,true,false), reply(2,false,false),
    unmount, s' = s}
  val invariant = all { s.approved != 0 implies
    (s.mounted and s.phase == "ready" and s.approved == s.project),
    s.mounted and s.phase == "ready" implies s.approved == s.project,
    s.phase != "ready" implies s.approved == 0 }
  run checkedProjectGetsSpecificPromptTest = init.then(reply(1,true,true))
    .expect(s.phase == "ready" and s.approved == 1)
  run unavailableUsesGenericPromptTest = init.then(reply(1,false,false))
    .expect(s.phase == "error" and s.approved == 0)
  run absentProjectUsesGenericPromptTest = init.then(reply(1,true,false))
    .expect(s.phase == "blocked" and s.approved == 0)
  run keyedNavigationResetsBeforeSecondReadTest = init.then(reply(1,true,true))
    .then(replaceProject).expect(s.phase == "loading" and s.approved == 0)
    .then(reply(2,true,false)).expect(s.phase == "blocked")
  run departedReplyCannotGrantCurrentPromptTest = init.then(replaceProject)
    .then(reply(1,true,true)).expect(s.phase == "loading" and s.approved == 0)
    .then(reply(2,true,true)).expect(s.approved == 2)
  run unmountedReplyCannotRestorePromptTest = init.then(unmount)
    .then(reply(1,true,true)).expect(not(s.mounted) and s.approved == 0)
}
