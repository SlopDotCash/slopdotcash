// @source src/Inbox.tsx
// @source src/lib/use-action.ts
// @evidence tests/e2e/site.spec.ts
// @evidence tests/e2e/registry.spec.ts
// One notification, two actors/cursors, four live epochs and one departure.
// A read/acknowledge POST is modeled as one mutation. Receipt, transport and
// current-session checks remain external observations, not cookie ownership.
// No checks were run for this source-only follow-up.
module ui_inbox_mutation_focus {
  type State = {mounted:bool,actor:int,recipient:int,cursor:int,epoch:int,
    active:bool,phase:str,actionEpoch:int,actionActor:int,actionCursor:int,
    state:str,serverRead:Set[int],viewRead:bool,previousRead:bool,
    readEpoch:int,readActor:int,readCursor:int,snapshot:bool,
    success:bool,error:bool}
  var s:State
  action init=s'={mounted:true,actor:1,recipient:1,cursor:0,epoch:0,
    active:false,phase:"idle",actionEpoch:0,actionActor:0,actionCursor:0,
    state:"ready",serverRead:Set(),viewRead:false,previousRead:false,
    readEpoch:0,readActor:0,readCursor:0,snapshot:false,success:false,error:false}
  val ownsView=s.mounted and s.epoch==s.actionEpoch and s.actor==s.actionActor and s.actor>0
  val privateVisible=s.mounted and s.state=="ready" and s.recipient>0
  def beginRead(cursor:int):State=s.with("epoch",s.epoch+1).with("readEpoch",s.epoch+1)
    .with("readActor",s.actor).with("readCursor",cursor).with("cursor",cursor)
    .with("snapshot",s.serverRead.contains(s.actor)).with("state","loading")
  action focus=all{s.mounted,
    s'=if(s.active)s else beginRead(s.cursor)}
  action idleFocus=all{s.mounted,not(s.active),s.epoch<4,focus}
  action activeFocus=all{s.mounted,s.active,focus}
  action beginMutation=all{s.mounted,not(s.active),s.state=="ready",s.recipient>0,s.epoch<4,
    s'=s.with("active",true).with("phase","before").with("epoch",s.epoch+1)
      .with("actionEpoch",s.epoch+1).with("actionActor",s.recipient).with("actionCursor",s.cursor)
      .with("previousRead",s.viewRead).with("state","loading").with("success",false).with("error",false)}
  action confirmBefore=all{s.phase=="before",ownsView,s'=s.with("phase","post")}
  // The request was admitted for actionActor before its response. A later
  // cookie change does not undo a server write to that original actor.
  action postSuccess=all{s.phase=="post",s'=s.with("serverRead",s.serverRead.union(Set(s.actionActor))).with("phase","after")}
  action postFailure(committed:bool):bool=all{s.phase=="post",
    s'=s.with("phase","catch").with("serverRead",if(committed)s.serverRead.union(Set(s.actionActor)) else s.serverRead)}
  action readbackFailed=all{s.phase=="readback",s'=s.with("phase","catch").with("readEpoch",0)}
  action identityUnavailable=all{Set("before","after","catch").contains(s.phase),
    s'=if(s.mounted and s.epoch==s.actionEpoch)
      s.with("phase","finish").with("recipient",0).with("state","error").with("error",true)
      else s.with("phase","finish")}
  action confirmAfter=all{s.phase=="after",ownsView,
    s'=s.with("phase","readback").with("readEpoch",s.epoch).with("readActor",s.actionActor)
      .with("readCursor",s.actionCursor).with("snapshot",s.serverRead.contains(s.actionActor))}
  action refuseChangedOwner=all{Set("before","after","catch").contains(s.phase),not(ownsView),
    s'=if(s.mounted and s.epoch==s.actionEpoch)
      s.with("phase","finish").with("recipient",s.actor).with("cursor",0)
        .with("state",if(s.actor==0)"signed-out" else "error").with("error",true)
      else s.with("phase","finish")}
  action restoreSameActorFailure=all{s.phase=="catch",ownsView,
    s'=s.with("phase","finish").with("state","ready").with("viewRead",s.previousRead).with("error",true)}
  action readReply=all{s.readEpoch>0,
    s'=if(s.mounted and s.epoch==s.readEpoch)
      (if(s.actor==s.readActor and s.actor>0)
        s.with("state","ready").with("recipient",s.actor).with("viewRead",s.snapshot)
          .with("success",if(s.active and s.phase=="readback")s.actor==s.actionActor else s.success)
          .with("phase",if(s.active and s.phase=="readback")"finish" else s.phase)
          .with("readEpoch",0)
      else s.with("state",if(s.actor==0)"signed-out" else "error").with("recipient",s.actor)
        .with("cursor",0).with("error",true).with("readEpoch",0)
        .with("phase",if(s.active and s.phase=="readback")"finish" else s.phase))
      else s.with("readEpoch",0).with("phase",if(s.active and s.phase=="readback")"finish" else s.phase)}
  // A known identity callback is intentionally not suppressed by actionActive.
  action identityReload=all{s.mounted,s.epoch<4,
    s'=beginRead(0).with("recipient",s.actor)}
  action cookieChanges(actor:int):bool=all{actor>=0,actor<=2,s'=s.with("actor",actor)}
  action changeCursor=all{s.mounted,not(s.active),s.state=="ready",s.epoch<4,
    s'=beginRead(1-s.cursor)}
  action finishSuperseded=all{s.active,s.epoch!=s.actionEpoch,s.phase!="post",s'=s.with("phase","finish")}
  action finish=all{s.active,s.phase=="finish",s'=s.with("active",false).with("phase","idle")}
  action depart=s'=s.with("mounted",false).with("epoch",5).with("state","departed").with("recipient",0)
  action step=any{idleFocus,activeFocus,beginMutation,confirmBefore,postSuccess,postFailure(false),postFailure(true),readbackFailed,identityUnavailable,
    confirmAfter,refuseChangedOwner,restoreSameActorFailure,readReply,identityReload,
    cookieChanges(0),cookieChanges(1),cookieChanges(2),changeCursor,finishSuperseded,finish,depart,s'=s}
  val invariant=all{s.epoch>=0,s.epoch<=5,s.cursor>=0,s.cursor<=1,
    s.success implies s.serverRead.contains(s.actionActor),
    not(s.mounted) implies not(privateVisible),
    s.state=="signed-out" implies not(privateVisible)}
  run focusDuringPostKeepsFinalReadOwnedTest=init.then(beginMutation).then(confirmBefore).then(activeFocus)
    .expect(s.epoch==s.actionEpoch and s.readEpoch==0).then(postSuccess).then(confirmAfter).then(readReply).then(finish)
    .expect(s.viewRead and s.success and not(s.active))
  run focusDuringReadbackDoesNotReplaceItsSnapshotTest=init.then(beginMutation).then(confirmBefore).then(postSuccess)
    .then(confirmAfter).then(activeFocus).then(readReply).then(finish).expect(s.viewRead and s.success)
  run accountSwitchDuringPostCannotRestoreOldViewTest=init.then(beginMutation).then(confirmBefore)
    .then(cookieChanges(2)).then(activeFocus).then(postSuccess).then(refuseChangedOwner).then(finish)
    .expect(s.serverRead.contains(1) and s.recipient==2 and not(privateVisible) and not(s.success))
  run signedOutBeforePostPreventsSendTest=init.then(beginMutation).then(cookieChanges(0)).then(activeFocus)
    .then(refuseChangedOwner).then(finish).expect(s.serverRead.size()==0 and s.state=="signed-out")
  run failedPostChecksActorBeforeRestoringViewTest=init.then(beginMutation).then(confirmBefore).then(postFailure(false))
    .then(restoreSameActorFailure).then(finish).expect(s.error and privateVisible and not(s.viewRead))
  run failedPostAfterAccountSwitchDoesNotRestoreViewTest=init.then(beginMutation).then(confirmBefore)
    .then(cookieChanges(2)).then(postFailure(false)).then(refuseChangedOwner).then(finish)
    .expect(s.error and not(privateVisible) and s.recipient==2)
  run explicitIdentityReloadStillSupersedesOldActionTest=init.then(beginMutation).then(confirmBefore)
    .then(cookieChanges(2)).then(identityReload).then(postSuccess).then(refuseChangedOwner).then(finish).then(readReply)
    .expect(s.recipient==2 and s.state=="ready" and not(s.success))
  run departureCannotReceiveActionReadbackTest=init.then(beginMutation).then(confirmBefore).then(postSuccess)
    .then(confirmAfter).then(depart).then(readReply).then(finish)
    .expect(not(privateVisible) and not(s.success) and not(s.active))
  run cursorCannotChangeDuringMutationTest=init.then(beginMutation).then(changeCursor.fail())
  run focusResumesAfterMutationTest=init.then(beginMutation).then(confirmBefore).then(postSuccess)
    .then(confirmAfter).then(readReply).then(finish).then(idleFocus)
    .expect(s.epoch==2 and s.state=="loading")
  run committedPostTransportFailureKeepsExplicitErrorTest=init.then(beginMutation).then(confirmBefore).then(postFailure(true))
    .then(restoreSameActorFailure).then(finish)
    .expect(s.serverRead.contains(1) and not(s.viewRead) and s.error and not(s.success))
  run failedFinalReadReleasesActionAndKeepsExplicitErrorTest=init.then(beginMutation).then(confirmBefore).then(postSuccess)
    .then(confirmAfter).then(readbackFailed).then(restoreSameActorFailure).then(finish)
    .expect(s.serverRead.contains(1) and s.error and not(s.active) and not(s.success))
  run unavailableIdentityHidesPrivateViewAndReleasesActionTest=init.then(beginMutation).then(identityUnavailable).then(finish)
    .expect(s.recipient==0 and not(privateVisible) and s.error and not(s.active))
}
