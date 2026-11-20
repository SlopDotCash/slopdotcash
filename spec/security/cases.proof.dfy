lemma revokeTriager_ensures(c: PrivateCase, by_: int, checkedEpoch: int, actor: int)
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysUnpaidHasNoAward(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysVerifiedReceiptValid(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysUnreceivedBlank(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysTriagersExcludeReporter(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysMembershipAudited(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysDecidersExcludeReporter(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysConfirmedHasRootCause(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysRelatedApproval(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysProposalCommitsNothing(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysCommitmentMatchesAward(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysApprovedWithinTerms(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysFullAwardHeld(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysStandardAwardRail(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysCommittedFindingStands(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysTriageEscalates(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysTriageBoundToAppeal(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysAppealState(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysAppealSource(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> stepReceiptFrozen(c, revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> stepMembershipHistoryRetained(c, revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> stepRelatedPermanent(c, revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> stepDecidersRetained(c, revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> stepCommittedAwardPermanent(c, revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> stepTriageIsAdvice(c, "revokeTriager", revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> stepAppealHistoryAppendOnly(c, revokeTriager(c, by_, checkedEpoch, actor)))
{
  if inv(c) && canRevokeTriager(c, by_, checkedEpoch, actor) {
    var keep := (t: int) => (t != actor);
    var after := revokeTriager(c, by_, checkedEpoch, actor);
    RevokedTriagers(c, by_, checkedEpoch, actor);
    ProofLib.FilterMember(keep, c.triagers, c.reporter);
    assert !(c.reporter in after.triagers);
  }
}

// A revocation keeps exactly the other triagers, through the library's filter view.
lemma RevokedTriagers(c: PrivateCase, by_: int, checkedEpoch: int, actor: int)
  ensures revokeTriager(c, by_, checkedEpoch, actor).triagers == ProofLib.Filter((t: int) => (t != actor), c.triagers)
{
}

// A new snapshot leaves every receipt, appeal and triage field as it was; an unreceived case has no triager to revoke.
lemma observeAuthority_ensures(c: PrivateCase, snapshot: Authority)
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysUnpaidHasNoAward(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysVerifiedReceiptValid(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysUnreceivedBlank(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysTriagersExcludeReporter(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysMembershipAudited(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysTriagersAssignedUnderCurrentSnapshot(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysDecidersExcludeReporter(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysConfirmedHasRootCause(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysRoutineClockOnItsRequest(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysRoutineReturnRecorded(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysRoutineCloseIsUnappealedRefusal(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysRelatedApproval(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysProposalCommitsNothing(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysCommitmentMatchesAward(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysApprovedWithinTerms(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysFullAwardHeld(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysStandardAwardRail(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysCommittedFindingStands(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysTriageEscalates(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysTriageUsesReceiptExclusions(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysTriageBoundToAppeal(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysAppealState(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> alwaysAppealSource(observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> stepReceiptFrozen(c, observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> stepMembershipHistoryRetained(c, observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> stepRelatedPermanent(c, observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> stepDecidersRetained(c, observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> stepCommittedAwardPermanent(c, observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> stepTriageIsAdvice(c, "observeAuthority", observeAuthority(c, snapshot)))
  ensures (inv(c) ==> canObserveAuthority(c, snapshot) ==> stepAppealHistoryAppendOnly(c, observeAuthority(c, snapshot)))
{
  if inv(c) && canObserveAuthority(c, snapshot) {
    var after := observeAuthority(c, snapshot);
    assert !c.submission.Verified? ==> |c.triagers| == 0;
    assert after.submission == c.submission && after.receipt == c.receipt && after.appeal == c.appeal;
    assert after.commitment == c.commitment && after.payment == c.payment && after.related == c.related;
    assert after.relatedReview == c.relatedReview && after.triage == c.triage && after.routine == c.routine;
  }
}
