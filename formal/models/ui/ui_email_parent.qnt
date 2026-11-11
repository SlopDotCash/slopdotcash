// @source src/Points.tsx
// @source src/InboxEmail.tsx
// @source src/lib/project-api.ts
// @source src/lib/github-actor.ts
// Two known actors, an undecodable Points identity, two known and two unknown raw member IDs and
// three editor generations. Parsing is an external predicate. Parent identity
// and child preference checks complete independently; only local text survives
// checking. `mounted` is an actor-bound editor; a fresh blocked error-only
// child has no bound editor and is represented by failureVisible. E2E: email-editor-focus.spec.ts and real bounty-full-flow.spec.ts.
module ui_email_parent {
  type State = {actual:int,parent:str,parentActor:int,lastActor:int,lastRaw:int,
    points:int,raw:int,logout:int,lastLogout:int,mounted:int,generation:int,childReady:bool,childChecking:bool,
    pending:Set[int],draft:int,draftOwner:int,writes:int}
  var s: State
  action init = s'={actual:1,parent:"ready",parentActor:1,lastActor:1,lastRaw:0,
    points:0,raw:0,logout:0,lastLogout:0,mounted:1,generation:1,childReady:true,childChecking:false,
    pending:Set(),draft:1,draftOwner:1,writes:0}
  // points=0 means no membership; 3 means a non-null, undecodable member ID.
  pure def visible(phase:str,actor:int,last:int,points:int,raw:int,lastRaw:int,logout:int,lastLogout:int):int = {
    val sameMember=logout==lastLogout and (points==0 or (if(points==3) raw==lastRaw else points==last))
    val candidate=if(phase=="checking" or phase=="error") (if(sameMember) last else 0)
      else if(phase=="ready") actor else 0
    if(points==1 or points==2) (if(points==candidate) candidate else 0) else candidate
  }
  def mount(actor:int): State = s.with("mounted",actor)
    .with("generation",if(actor==s.mounted) s.generation else s.generation+1)
    .with("childReady",actor==s.mounted and s.childReady)
    .with("childChecking",if(actor==s.mounted) s.childChecking else actor>0)
    .with("draft",if(actor==s.mounted) s.draft else 0)
    .with("draftOwner",if(actor==s.mounted) s.draftOwner else 0)
  def allowed(actor:int):bool = actor==s.mounted or s.generation<3
  val canSubmit = s.mounted>0 and s.parent=="ready" and s.childReady and not(s.childChecking)
  val failureVisible = s.parent=="error" and (s.points!=0 or s.mounted>0)
  action parentStarts = {
    val actor=visible("checking",s.parentActor,s.lastActor,s.points,s.raw,s.lastRaw,s.logout,s.lastLogout)
    all {allowed(actor),s'=mount(actor).with("parent","checking")}
  }
  action childStarts = all {s.mounted>0,
    s'=s.with("childChecking",true).with("pending",s.pending.union(Set(s.generation)))}
  action typeDraft = all {s.mounted>0,s.childReady,s.parent!="error",
    s'=s.with("draft",2).with("draftOwner",s.mounted)}
  action sessionChanges(actor:int):bool = s'=s.with("actual",actor)
  action parentCompletes = {
    val phase=if(s.actual==0) "out" else "ready"
    val actor=visible(phase,s.actual,s.actual,s.points,s.raw,s.raw,s.logout,s.logout)
    all {s.parent=="checking",allowed(actor),
      s'=mount(actor).with("parent",phase).with("parentActor",s.actual)
        .with("lastActor",s.actual).with("lastRaw",s.raw).with("lastLogout",s.logout)}
  }
  action parentFails = {
    val actor=visible("error",s.parentActor,s.lastActor,s.points,s.raw,s.lastRaw,s.logout,s.lastLogout)
    all {s.parent=="checking",allowed(actor),s'=mount(actor).with("parent","error").with("parentActor",0)}
  }
  action childCompletes(generation:int):bool = all {s.pending.contains(generation),
    s'=if(generation==s.generation and s.mounted>0 and s.actual==s.mounted)
      s.with("pending",s.pending.exclude(Set(generation))).with("childReady",true).with("childChecking",false)
      else if(generation==s.generation)
        s.with("pending",s.pending.exclude(Set(generation))).with("childReady",false).with("childChecking",false)
          .with("draft",0).with("draftOwner",0)
      else s.with("pending",s.pending.exclude(Set(generation)))}
  action childUnauthorized = all {s.mounted>0,
    s'=s.with("childReady",false).with("childChecking",false).with("draft",0).with("draftOwner",0)}
  action pointsChanges(points:int,raw:int):bool = {
    // A changed membership key makes useProjectSession report checking in
    // this same render, before its replacement network read completes.
    val phase=if(raw!=s.raw) "checking" else s.parent
    val actor=visible(phase,s.parentActor,s.lastActor,points,raw,s.lastRaw,s.logout,s.lastLogout)
    all {allowed(actor),s'=mount(actor).with("parent",phase).with("points",points).with("raw",raw)}
  }
  action localSignout = all {s.logout==0,allowed(0),
    s'=mount(0).with("actual",0).with("points",0).with("raw",0).with("logout",1).with("parent","checking")}
  // Live identity preflight and expected-actor request header remain required.
  action submit = all {canSubmit,s.actual==s.mounted,s.writes<1,s'=s.with("writes",s.writes+1)}
  action step = any {parentStarts,childStarts,typeDraft,sessionChanges(0),sessionChanges(1),sessionChanges(2),
    parentCompletes,parentFails,localSignout,childUnauthorized,childCompletes(1),childCompletes(2),childCompletes(3),
    pointsChanges(0,0),pointsChanges(1,1),pointsChanges(2,2),pointsChanges(3,3),pointsChanges(3,4),submit,s'=s}
  val invariant = all {s.generation<=3,s.logout<=1,s.parent=="ready" implies s.lastRaw==s.raw,s.mounted==0 implies s.draft==0,
    s.draft>0 implies s.draftOwner==s.mounted,
    (s.parent=="checking" or s.parent=="error") implies not(canSubmit),
    (s.points==1 or s.points==2) and s.mounted>0 implies s.points==s.mounted}
  run sameActorPendingKeepsEditableDraftTest = init.then(parentStarts).then(childStarts).then(typeDraft)
    .expect(s.mounted==1 and s.draft==2 and not(canSubmit))
    .then(parentCompletes).then(childCompletes(1)).expect(canSubmit and s.draft==2)
  run parentPendingBlocksBeforeChildRefreshTest = init.then(parentStarts).expect(s.childReady and not(canSubmit))
  run childSignoutCannotRestoreItsOldDraftTest = init.then(childStarts).then(sessionChanges(0))
    .then(childCompletes(1)).then(sessionChanges(1)).then(childStarts).then(childCompletes(1))
    .expect(s.childReady and s.draft==0)
  run unauthorizedResponseCannotRestoreItsOldDraftTest = init.then(childUnauthorized)
    .then(childStarts).then(childCompletes(1)).expect(s.childReady and s.draft==0)
  run childMismatchWaitsForNewParentBindingTest = init.then(childStarts).then(sessionChanges(2))
    .then(childCompletes(1)).expect(not(s.childReady) and s.draft==0 and not(canSubmit))
    .then(parentStarts).then(parentCompletes).then(childStarts).then(childCompletes(2))
    .then(typeDraft).then(parentStarts).then(parentCompletes).expect(s.draft==2 and s.draftOwner==2)
  run knownOtherActorClearsOldDraftTest = init.then(parentStarts).then(childStarts).then(sessionChanges(2))
    .then(parentCompletes).expect(s.mounted==2 and s.draft==0)
    .then(childCompletes(1)).expect(not(s.childReady) and s.draft==0)
  run unboundFailureHasRecoveryWithoutEditorTest = init.then(localSignout).then(parentCompletes)
    .then(pointsChanges(1,1)).then(parentFails).expect(failureVisible and s.mounted==0 and not(canSubmit))
  run localSignoutClearsBeforeParentReadTest = init.then(localSignout)
    .expect(s.parent=="checking" and s.mounted==0 and s.draft==0 and not(canSubmit))
  run knownSignoutClearsDraftTest = init.then(parentStarts).then(sessionChanges(0)).then(parentCompletes)
    .expect(s.mounted==0 and s.draft==0 and not(canSubmit))
  run pointsActorCanRefuseRetainedParentTest = init.then(parentStarts).then(pointsChanges(2,2))
    .expect(s.mounted==0 and s.draft==0 and not(canSubmit))
  run laterMatchingPointsRestoresFreshEditorTest = init.then(pointsChanges(1,1)).then(parentCompletes).then(parentStarts)
    .then(sessionChanges(2)).then(parentCompletes).expect(s.mounted==0)
    .then(pointsChanges(2,2)).expect(s.parent=="checking" and s.mounted==2 and s.draft==0 and not(canSubmit))
  run samePointsActorKeepsDraftTest = init.then(parentStarts).then(pointsChanges(1,1)).then(parentCompletes)
    .expect(s.mounted==1 and s.draft==1)
  run failureRetainsDraftUntilSameActorRetryTest = init.then(pointsChanges(1,1)).then(parentStarts)
    .then(parentFails).expect(failureVisible and s.draft==1 and not(canSubmit))
    .then(parentStarts).then(parentCompletes).then(childStarts).then(childCompletes(1)).expect(canSubmit and s.draft==1)
  run failureRetryDifferentActorClearsDraftTest = init.then(parentStarts).then(parentFails)
    .then(sessionChanges(2)).then(parentStarts).then(parentCompletes).expect(s.mounted==2 and s.draft==0)
  run unchangedUnknownMemberRetainsOnlyItsConfirmedDraftTest = init.then(pointsChanges(3,3))
    .then(parentStarts).then(parentCompletes).then(childStarts).then(childCompletes(3))
    .then(typeDraft).then(parentStarts).expect(s.mounted==1 and s.draft==2 and not(canSubmit))
  run unknownMemberIdChangeDoesNotRetainDraftTest = init.then(pointsChanges(3,3)).then(parentStarts)
    .expect(s.mounted==0 and s.draft==0)
}
