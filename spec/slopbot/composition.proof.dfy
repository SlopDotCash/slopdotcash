lemma ReverseIfDuePreserves(p: points__penalties_Penalties, auth: points__penalties_ReversalAuthority)
  ensures var after := reverseIfDue(p, auth);
    (|after.rows| == |p.rows|) &&
    (forall r :: r in p.rows ==> exists x :: x in after.rows && points__penalties_sameDebit(x, r) && (!(r.reversed) || (x == r))) &&
    ((exists r :: r in p.rows && r.moderatorReview) ==> (exists x :: x in after.rows && x.moderatorReview))
{
  var after := reverseIfDue(p, auth);
  if points__penalties_canReversePenalty(p, auth) {
    forall r | r in p.rows
      ensures exists x :: x in after.rows && points__penalties_sameDebit(x, r) && (!(r.reversed) || (x == r))
    {
      var i :| 0 <= i < |p.rows| && p.rows[i] == r;
      assert after.rows[i] in after.rows;
    }
    if exists r :: r in p.rows && r.moderatorReview {
      var r :| r in p.rows && r.moderatorReview;
      var i :| 0 <= i < |p.rows| && p.rows[i] == r;
      assert after.rows[i] in after.rows && after.rows[i].moderatorReview;
    }
  }
}

lemma ReverseIfDueClearsAll(p: points__penalties_Penalties, auth: points__penalties_ReversalAuthority)
  requires auth.at > 0
  requires !auth.reason.MaintainerReopen? || points__penalties_reopenedRevision(p, auth.item, auth.revision)
  requires forall r :: r in p.rows ==> points__penalties_covers(r, auth)
  ensures !(exists r :: r in reverseIfDue(p, auth).rows && !(r.reversed))
{
  if exists r :: r in p.rows && !(r.reversed) {
    var r :| r in p.rows && !(r.reversed);
    assert points__penalties_covers(r, auth);
    assert points__penalties_canReversePenalty(p, auth);
  }
}

lemma confirmClose_ensures(c: Slopbot, by_: int, closeEvent: slopbot__closeAttempt_CloseEvidence)
  ensures (inv(c) ==> canConfirmClose(c, by_, closeEvent) ==> alwaysParticipationFromOpenedRun(confirmClose(c, by_, closeEvent)))
  ensures (inv(c) ==> canConfirmClose(c, by_, closeEvent) ==> alwaysClaimTracksAttempt(confirmClose(c, by_, closeEvent)))
  ensures (inv(c) ==> canConfirmClose(c, by_, closeEvent) ==> alwaysCompletedReviewSettledItsClose(confirmClose(c, by_, closeEvent)))
  ensures (inv(c) ==> canConfirmClose(c, by_, closeEvent) ==> alwaysDebitOnlyFromConfirmedClose(confirmClose(c, by_, closeEvent)))
  ensures (inv(c) ==> canConfirmClose(c, by_, closeEvent) ==> alwaysConfirmedReopenRecorded(confirmClose(c, by_, closeEvent)))
  ensures (inv(c) ==> canConfirmClose(c, by_, closeEvent) ==> alwaysRetainedSourceIsTheItem(confirmClose(c, by_, closeEvent)))
  ensures (inv(c) ==> canConfirmClose(c, by_, closeEvent) ==> alwaysUpheldOrReopenedLeavesNoDebit(confirmClose(c, by_, closeEvent)))
  ensures (inv(c) ==> canConfirmClose(c, by_, closeEvent) ==> alwaysUpheldAppealSeenByAttempt(confirmClose(c, by_, closeEvent)))
  ensures (inv(c) ==> canConfirmClose(c, by_, closeEvent) ==> alwaysAppealOnTheRevision(confirmClose(c, by_, closeEvent)))
  ensures (inv(c) ==> canConfirmClose(c, by_, closeEvent) ==> alwaysSlopbotReopensOnlyOwnClose(confirmClose(c, by_, closeEvent)))
  ensures (inv(c) ==> canConfirmClose(c, by_, closeEvent) ==> alwaysScamNoticesOnce(confirmClose(c, by_, closeEvent)))
  ensures (inv(c) ==> canConfirmClose(c, by_, closeEvent) ==> stepParticipationKept(c, confirmClose(c, by_, closeEvent)))
  ensures (inv(c) ==> canConfirmClose(c, by_, closeEvent) ==> stepCloseSentByLiveOwnerOnCompleteReview(c, "confirmClose", confirmClose(c, by_, closeEvent)))
  ensures (inv(c) ==> canConfirmClose(c, by_, closeEvent) ==> stepDebitRowsKept(c, confirmClose(c, by_, closeEvent)))
{
  if inv(c) && canConfirmClose(c, by_, closeEvent) {
    var confirmed := confirmedClose(c, closeEvent);
    var recorded := if points__penalties_canRecordPenalty(c.penalties, confirmed) then points__penalties_recordPenalty(c.penalties, confirmed) else c.penalties;
    if c.appeal.resolution.Upheld? {
      var auth := authority(c, c.now, points__penalties_ReversalReason.AppealUpheld);
      ReverseIfDuePreserves(recorded, auth);
      ReverseIfDueClearsAll(recorded, auth);
    }
  }
}

lemma confirmReopen_ensures(c: Slopbot, by_: int, evidence: slopbot__webhookDelivery_ReopenObservation)
  ensures (inv(c) ==> canConfirmReopen(c, by_, evidence) ==> alwaysParticipationFromOpenedRun(confirmReopen(c, by_, evidence)))
  ensures (inv(c) ==> canConfirmReopen(c, by_, evidence) ==> alwaysClaimTracksAttempt(confirmReopen(c, by_, evidence)))
  ensures (inv(c) ==> canConfirmReopen(c, by_, evidence) ==> alwaysCompletedReviewSettledItsClose(confirmReopen(c, by_, evidence)))
  ensures (inv(c) ==> canConfirmReopen(c, by_, evidence) ==> alwaysDebitOnlyFromConfirmedClose(confirmReopen(c, by_, evidence)))
  ensures (inv(c) ==> canConfirmReopen(c, by_, evidence) ==> alwaysConfirmedReopenRecorded(confirmReopen(c, by_, evidence)))
  ensures (inv(c) ==> canConfirmReopen(c, by_, evidence) ==> alwaysRetainedSourceIsTheItem(confirmReopen(c, by_, evidence)))
  ensures (inv(c) ==> canConfirmReopen(c, by_, evidence) ==> alwaysUpheldOrReopenedLeavesNoDebit(confirmReopen(c, by_, evidence)))
  ensures (inv(c) ==> canConfirmReopen(c, by_, evidence) ==> alwaysUpheldAppealSeenByAttempt(confirmReopen(c, by_, evidence)))
  ensures (inv(c) ==> canConfirmReopen(c, by_, evidence) ==> alwaysAppealOnTheRevision(confirmReopen(c, by_, evidence)))
  ensures (inv(c) ==> canConfirmReopen(c, by_, evidence) ==> alwaysSlopbotReopensOnlyOwnClose(confirmReopen(c, by_, evidence)))
  ensures (inv(c) ==> canConfirmReopen(c, by_, evidence) ==> alwaysScamNoticesOnce(confirmReopen(c, by_, evidence)))
  ensures (inv(c) ==> canConfirmReopen(c, by_, evidence) ==> stepParticipationKept(c, confirmReopen(c, by_, evidence)))
  ensures (inv(c) ==> canConfirmReopen(c, by_, evidence) ==> stepCloseSentByLiveOwnerOnCompleteReview(c, "confirmReopen", confirmReopen(c, by_, evidence)))
  ensures (inv(c) ==> canConfirmReopen(c, by_, evidence) ==> stepDebitRowsKept(c, confirmReopen(c, by_, evidence)))
{
  if inv(c) && canConfirmReopen(c, by_, evidence) {
    var recorded := points__penalties_confirmReopen(c.penalties, points__penalties_Reopen(c.retained.node, c.retained.revision, c.retained.occurred, c.retained.sender, points__penalties_ReopenRole.VerifiedMaintainer));
    var auth := points__penalties_ReversalAuthority(c.retained.node, c.retained.revision, c.retained.occurred, points__penalties_ReversalReason.MaintainerReopen);
    ReverseIfDuePreserves(recorded, auth);
    ReverseIfDueClearsAll(recorded, auth);
  }
}

lemma decideAppeal_ensures(c: Slopbot, by_: int, uphold: bool)
  ensures (inv(c) ==> canDecideAppeal(c, by_, uphold) ==> alwaysParticipationFromOpenedRun(decideAppeal(c, by_, uphold)))
  ensures (inv(c) ==> canDecideAppeal(c, by_, uphold) ==> alwaysClaimTracksAttempt(decideAppeal(c, by_, uphold)))
  ensures (inv(c) ==> canDecideAppeal(c, by_, uphold) ==> alwaysCompletedReviewSettledItsClose(decideAppeal(c, by_, uphold)))
  ensures (inv(c) ==> canDecideAppeal(c, by_, uphold) ==> alwaysDebitOnlyFromConfirmedClose(decideAppeal(c, by_, uphold)))
  ensures (inv(c) ==> canDecideAppeal(c, by_, uphold) ==> alwaysConfirmedReopenRecorded(decideAppeal(c, by_, uphold)))
  ensures (inv(c) ==> canDecideAppeal(c, by_, uphold) ==> alwaysRetainedSourceIsTheItem(decideAppeal(c, by_, uphold)))
  ensures (inv(c) ==> canDecideAppeal(c, by_, uphold) ==> alwaysUpheldOrReopenedLeavesNoDebit(decideAppeal(c, by_, uphold)))
  ensures (inv(c) ==> canDecideAppeal(c, by_, uphold) ==> alwaysUpheldAppealSeenByAttempt(decideAppeal(c, by_, uphold)))
  ensures (inv(c) ==> canDecideAppeal(c, by_, uphold) ==> alwaysAppealOnTheRevision(decideAppeal(c, by_, uphold)))
  ensures (inv(c) ==> canDecideAppeal(c, by_, uphold) ==> alwaysSlopbotReopensOnlyOwnClose(decideAppeal(c, by_, uphold)))
  ensures (inv(c) ==> canDecideAppeal(c, by_, uphold) ==> alwaysScamNoticesOnce(decideAppeal(c, by_, uphold)))
  ensures (inv(c) ==> canDecideAppeal(c, by_, uphold) ==> stepParticipationKept(c, decideAppeal(c, by_, uphold)))
  ensures (inv(c) ==> canDecideAppeal(c, by_, uphold) ==> stepCloseSentByLiveOwnerOnCompleteReview(c, "decideAppeal", decideAppeal(c, by_, uphold)))
  ensures (inv(c) ==> canDecideAppeal(c, by_, uphold) ==> stepDebitRowsKept(c, decideAppeal(c, by_, uphold)))
{
  if inv(c) && canDecideAppeal(c, by_, uphold) && uphold {
    var auth := authority(c, c.now, points__penalties_ReversalReason.AppealUpheld);
    ReverseIfDuePreserves(c.penalties, auth);
    ReverseIfDueClearsAll(c.penalties, auth);
  }
}

lemma NotifyModeratorFilter(c: slopbot__closeAttempt_CloseAttempt, recipient: int)
  ensures slopbot__closeAttempt_notifyModerator(c, recipient).moderatorNotices == c.moderatorNotices + ProofLib.Filter((set_x: int) => !((set_x in c.moderatorNotices)), [recipient])
{
}

lemma NotifyModeratorMembers(c: slopbot__closeAttempt_CloseAttempt, recipient: int)
  ensures forall x :: x in slopbot__closeAttempt_notifyModerator(c, recipient).moderatorNotices ==> x in c.moderatorNotices || x == recipient
{
  NotifyModeratorFilter(c, recipient);
  forall p: int -> bool, x | x in ProofLib.Filter(p, [recipient])
    ensures x == recipient
  {
    ProofLib.FilterMember(p, [recipient], x);
  }
}

lemma notifyModerator_ensures(c: Slopbot, by_: int, recipient: int)
  ensures (inv(c) ==> canNotifyModerator(c, by_, recipient) ==> alwaysParticipationFromOpenedRun(notifyModerator(c, by_, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, by_, recipient) ==> alwaysClaimTracksAttempt(notifyModerator(c, by_, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, by_, recipient) ==> alwaysCompletedReviewSettledItsClose(notifyModerator(c, by_, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, by_, recipient) ==> alwaysDebitOnlyFromConfirmedClose(notifyModerator(c, by_, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, by_, recipient) ==> alwaysConfirmedReopenRecorded(notifyModerator(c, by_, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, by_, recipient) ==> alwaysRetainedSourceIsTheItem(notifyModerator(c, by_, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, by_, recipient) ==> alwaysUpheldOrReopenedLeavesNoDebit(notifyModerator(c, by_, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, by_, recipient) ==> alwaysUpheldAppealSeenByAttempt(notifyModerator(c, by_, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, by_, recipient) ==> alwaysAppealOnTheRevision(notifyModerator(c, by_, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, by_, recipient) ==> alwaysSlopbotReopensOnlyOwnClose(notifyModerator(c, by_, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, by_, recipient) ==> alwaysScamNoticesOnce(notifyModerator(c, by_, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, by_, recipient) ==> stepParticipationKept(c, notifyModerator(c, by_, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, by_, recipient) ==> stepCloseSentByLiveOwnerOnCompleteReview(c, "notifyModerator", notifyModerator(c, by_, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, by_, recipient) ==> stepDebitRowsKept(c, notifyModerator(c, by_, recipient)))
{
  if inv(c) && canNotifyModerator(c, by_, recipient) {
    NotifyModeratorMembers(c.attempt, recipient);
  }
}
