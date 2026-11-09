// @source src/SecurityBounty.tsx
// @source backend/security/handler.ts
// @source backend/security/direct-payments.ts
// @source backend/payments/wallet-registration.ts
// @evidence tests/e2e/security-bounty.spec.ts
// One mounted case/actor; case revisions 1..3, two action requests and three
// reads. Projection 1 has the original direct-payment wallet; projection 2
// has a registered successor and a held payment, without a case revision.
// Transport scheduling and the current-actor checks are external predicates.
// Source-only follow-up: no scenarios, simulation or verifier were run.
module ui_private_case_revisions {
  var s:{mounted:bool,serverRevision:int,serverProjection:int,
    acceptedRevision:int,acceptedProjection:int,paintedRevision:int,paintedProjection:int,
    epoch:int,activeRead:int,readEpochs:List[int],readRevisions:List[int],readProjections:List[int],pendingReads:Set[int],
    actionBases:List[int],actionRevisions:List[int],actionProjections:List[int],pendingActions:Set[int],readyActions:Set[int],warning:bool}
  action init=s'={mounted:true,serverRevision:1,serverProjection:1,
    acceptedRevision:1,acceptedProjection:1,paintedRevision:1,paintedProjection:1,
    epoch:0,activeRead:0,readEpochs:List(),readRevisions:List(),readProjections:List(),pendingReads:Set(),
    actionBases:List(),actionRevisions:List(),actionProjections:List(),pendingActions:Set(),readyActions:Set(),warning:false}
  // The screen may not yet have painted an already accepted response.
  action paint=all{s.mounted,
    s'=s.with("paintedRevision",s.acceptedRevision).with("paintedProjection",s.acceptedProjection)}
  val newRead=s.with("epoch",s.epoch+1).with("activeRead",s.readRevisions.length()+1)
    .with("readEpochs",s.readEpochs.append(s.epoch+1))
    .with("readRevisions",s.readRevisions.append(s.serverRevision))
    .with("readProjections",s.readProjections.append(s.serverProjection))
    .with("pendingReads",s.pendingReads.union(Set(s.readRevisions.length()+1)))
  action readCase=all{s.mounted,s.readRevisions.length()<3,s'=newRead}
  action readReply(id:int):bool=all{s.pendingReads.contains(id),
    s'=if(s.mounted and s.activeRead==id and s.readEpochs[id-1]==s.epoch)
      s.with("pendingReads",s.pendingReads.exclude(Set(id))).with("activeRead",0)
        .with("acceptedRevision",s.readRevisions[id-1]).with("acceptedProjection",s.readProjections[id-1])
        .with("warning",false)
      else s.with("pendingReads",s.pendingReads.exclude(Set(id)))}
  action readError(id:int):bool=all{s.pendingReads.contains(id),
    s'=if(s.mounted and s.activeRead==id and s.readEpochs[id-1]==s.epoch)
      s.with("pendingReads",s.pendingReads.exclude(Set(id))).with("activeRead",0).with("warning",true)
      else s.with("pendingReads",s.pendingReads.exclude(Set(id)))}
  action startAction=all{s.mounted,s.actionBases.length()<2,
    s'=s.with("actionBases",s.actionBases.append(s.paintedRevision))
      .with("actionRevisions",s.actionRevisions.append(0)).with("actionProjections",s.actionProjections.append(0))
      .with("pendingActions",s.pendingActions.union(Set(s.actionBases.length()+1)))}
  // The server accepts the action only at the captured expected revision.
  // The response can then remain in flight while other reads/actions finish.
  action commitAction(id:int):bool=all{s.pendingActions.contains(id),not(s.readyActions.contains(id)),
    s.actionBases[id-1]==s.serverRevision,s.serverRevision<3,
    s'=s.with("serverRevision",s.serverRevision+1)
      .with("actionRevisions",s.actionRevisions.replaceAt(id-1,s.serverRevision+1))
      .with("actionProjections",s.actionProjections.replaceAt(id-1,s.serverProjection))
      .with("readyActions",s.readyActions.union(Set(id)))}
  action refuseStaleAction(id:int):bool=all{s.pendingActions.contains(id),not(s.readyActions.contains(id)),
    s.actionBases[id-1]!=s.serverRevision,s'=s.with("pendingActions",s.pendingActions.exclude(Set(id)))}
  action actionReply(id:int):bool=all{s.readyActions.contains(id),
    // The read cutoff disables only a transition that would start a fourth
    // read. Joining a current read remains possible at the cutoff.
    not(s.mounted and s.actionRevisions[id-1]==s.acceptedRevision and s.activeRead==0) or s.readRevisions.length()<3,
    s'=if(s.mounted and s.actionRevisions[id-1]>s.acceptedRevision)
      s.with("readyActions",s.readyActions.exclude(Set(id))).with("pendingActions",s.pendingActions.exclude(Set(id)))
        .with("acceptedRevision",s.actionRevisions[id-1]).with("acceptedProjection",s.actionProjections[id-1])
        .with("epoch",s.epoch+1).with("activeRead",0).with("warning",false)
      else if(s.mounted and s.actionRevisions[id-1]==s.acceptedRevision and s.activeRead==0)
        newRead.with("readyActions",s.readyActions.exclude(Set(id))).with("pendingActions",s.pendingActions.exclude(Set(id)))
      else s.with("readyActions",s.readyActions.exclude(Set(id))).with("pendingActions",s.pendingActions.exclude(Set(id)))}
  // Other CaseDetail callbacks can return an equal-revision projection too.
  // Keep the accepted value and join the latest read, or start a fresh one.
  action equalRevisionCallback=all{s.mounted,s.activeRead>0 or s.readRevisions.length()<3,
    s'=if(s.activeRead>0)s else newRead}
  action projectionChanges=all{s.serverProjection==1,s'=s.with("serverProjection",2)}
  action depart=all{s.mounted,s'=s.with("mounted",false).with("epoch",s.epoch+1).with("activeRead",0)}
  action step={nondet read=1.to(3).oneOf() nondet actionId=1.to(2).oneOf()
    any{paint,readCase,readReply(read),readError(read),startAction,commitAction(actionId),refuseStaleAction(actionId),
      actionReply(actionId),equalRevisionCallback,projectionChanges,depart,s'=s}}
  val invariant=all{s.serverRevision>=1,s.serverRevision<=3,s.acceptedRevision>=s.paintedRevision,
    s.acceptedRevision<=s.serverRevision,s.readRevisions.length()<=3,s.actionBases.length()<=2,s.epoch<=6,
    s.readEpochs.length()==s.readRevisions.length(),s.readProjections.length()==s.readRevisions.length(),
    s.actionBases.length()==s.actionRevisions.length(),s.actionBases.length()==s.actionProjections.length(),
    s.activeRead>0 implies(s.pendingReads.contains(s.activeRead) and s.readEpochs[s.activeRead-1]==s.epoch)}
  run newerAcceptedValueBeforePaintRefusesOlderActionTest=init.then(startAction).then(commitAction(1))
    .then(readCase).then(readReply(1)).then(paint).then(startAction).then(commitAction(2)).then(actionReply(2))
    .then(actionReply(1)).expect(s.acceptedRevision==3 and s.paintedRevision==2)
  run rejectedOldActionKeepsNewReadActiveTest=init.then(startAction).then(commitAction(1))
    .then(readCase).then(readReply(1)).then(paint).then(startAction).then(commitAction(2)).then(actionReply(2))
    .then(readCase).then(actionReply(1)).expect(s.activeRead==2).then(readReply(2)).expect(s.acceptedRevision==3)
  run acceptedActionInvalidatesEarlierReadTest=init.then(readCase).then(startAction).then(commitAction(1))
    .then(actionReply(1)).then(readReply(1)).expect(s.acceptedRevision==2 and not(s.warning))
  run acceptedActionInvalidatesEarlierReadErrorTest=init.then(readCase).then(startAction).then(commitAction(1))
    .then(actionReply(1)).then(readError(1)).expect(s.acceptedRevision==2 and not(s.warning))
  run walletProjectionIsNotOverwrittenByEqualActionTest=init.then(startAction).then(commitAction(1)).then(projectionChanges)
    .then(readCase).then(readReply(1)).expect(s.acceptedRevision==2 and s.acceptedProjection==2)
    .then(actionReply(1)).expect(s.acceptedRevision==2 and s.acceptedProjection==2 and s.activeRead==2)
    .then(readReply(2)).expect(s.acceptedProjection==2)
  run staleExpectedRevisionCannotCommitSecondActionTest=init.then(startAction).then(startAction).then(commitAction(1))
    .then(refuseStaleAction(2)).expect(s.serverRevision==2 and not(s.pendingActions.contains(2)))
  run departedActionCannotChangeAcceptedViewTest=init.then(startAction).then(commitAction(1)).then(depart)
    .then(actionReply(1)).expect(s.acceptedRevision==1 and not(s.mounted))
  run equalActionJoinsCurrentReadWithoutRestartingTest=init.then(startAction).then(commitAction(1)).then(projectionChanges)
    .then(readCase).then(readReply(1)).then(readCase).then(actionReply(1))
    .expect(s.activeRead==2 and s.readRevisions.length()==2).then(readReply(2)).expect(s.acceptedProjection==2)
  run equalCallbackCanRetryAfterReadFailureTest=init.then(equalRevisionCallback).then(readError(1))
    .expect(s.activeRead==0 and s.warning).then(projectionChanges).then(equalRevisionCallback).then(readReply(2))
    .expect(s.activeRead==0 and s.acceptedProjection==2 and not(s.warning))
  run explicitReloadStillSupersedesCurrentReadTest=init.then(equalRevisionCallback).then(projectionChanges).then(readCase)
    .then(readReply(1)).expect(s.activeRead==2 and s.acceptedProjection==1)
    .then(readReply(2)).expect(s.activeRead==0 and s.acceptedProjection==2)
  run departureClearsActiveEqualRefreshTest=init.then(equalRevisionCallback).then(depart).then(readReply(1))
    .expect(s.activeRead==0 and s.acceptedProjection==1 and not(s.mounted))
  run departedEqualActionDoesNotStartAnotherReadTest=init.then(startAction).then(commitAction(1))
    .then(readCase).then(readReply(1)).then(depart).then(actionReply(1))
    .expect(not(s.mounted) and s.readRevisions.length()==1 and s.activeRead==0)
}
