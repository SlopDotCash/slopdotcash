lemma revokeTriager_ensures(c: PrivateCase, by_: int, checkedEpoch: int, actor: int)
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysUnpaidHasNoAward(revokeTriager(c, by_, checkedEpoch, actor)))
  ensures (inv(c) ==> canRevokeTriager(c, by_, checkedEpoch, actor) ==> alwaysVerifiedReceiptValid(revokeTriager(c, by_, checkedEpoch, actor)))
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
