// A notice is added only for a configured moderator, so every notice stays a moderator.
lemma notifyModerator_ensures(c: CloseAttempt, recipient: int)
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> alwaysAtMostOneRequest(notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> alwaysAttemptBoundToReservation(notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> alwaysBlockedNeverAttempts(notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> alwaysLabelOnlyAfterBlock(notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> alwaysConfirmedHasCloseTime(notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> alwaysRejectedIdsOrdered(notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> alwaysCandidateStaysEligible(notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> alwaysNoticesToModerators(notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> alwaysNoticesOnlyForConfirmedScam(notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> alwaysSlopbotReopensOnlyOwnClose(notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> stepReserveOnlyAfterFreshRecheck(c, "notifyModerator", notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> stepNoResend(c, notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> stepRecheckAdvances(c, notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> stepCandidateFixed(c, notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> stepRequestOnlyByReservingLease(c, "notifyModerator", notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> stepBlockIsFinal(c, notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> stepRejectedHistoryRetained(c, notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> stepConfirmedIsFinal(c, notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> stepPendingLeavesOnlyOnEvidence(c, "notifyModerator", notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> stepDisputeIsPermanent(c, notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> stepNoReservationAfterDispute(c, notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> stepNoRequestAfterDispute(c, "notifyModerator", notifyModerator(c, recipient)))
  ensures (inv(c) ==> canNotifyModerator(c, recipient) ==> stepItemReadsAdvance(c, notifyModerator(c, recipient)))
{
  if inv(c) && canNotifyModerator(c, recipient) {
    var added := Std.Collections.Seq.Filter((set_x: int) => !((set_x in c.moderatorNotices)), [recipient]);
    forall x | x in added
      ensures x == recipient
    {
      ProofLib.FilterMember((set_x: int) => !((set_x in c.moderatorNotices)), [recipient], x);
    }
    assert notifyModerator(c, recipient).moderatorNotices == c.moderatorNotices + added;
  }
}
