// An active flag's receipt is among the receipts a reinstatement resolves.
lemma ActiveReceiptsCover(e: Enforcement, g: Flag)
  requires g in e.flags && activeFlag(e, g)
  ensures g.receipt in activeReceipts(e)
{
  var s := ProofLib.Filter((f: Flag) => activeFlag(e, f), e.flags);
  ProofLib.FilterMember((f: Flag) => activeFlag(e, f), e.flags, g);
  assert g in s;
  var i :| 0 <= i < |s| && s[i] == g;
  assert activeReceipts(e)[i] == g.receipt;
}

// Every receipt a reinstatement resolves names a filed flag.
lemma ActiveReceiptsFromFlags(e: Enforcement, x: int)
  requires x in activeReceipts(e)
  ensures exists f :: f in e.flags && f.receipt == x
{
  var s := ProofLib.Filter((f: Flag) => activeFlag(e, f), e.flags);
  var i :| 0 <= i < |s| && s[i].receipt == x;
  ProofLib.FilterMember((f: Flag) => activeFlag(e, f), e.flags, s[i]);
}

// Every receipt a clean result resolves names a filed flag.
lemma NewlyResolvedFromFlags(e: Enforcement, x: int)
  requires x in newlyResolved(e)
  ensures exists f :: f in e.flags && f.receipt == x
{
  var p := (f: Flag) => (!((f.receipt in e.resolved)) && !((exists r :: r in e.repositories && !((latestOf(e, r).state.AClean? && (f.receipt in latestOf(e, r).snapshot))))));
  var s := ProofLib.Filter(p, e.flags);
  var i :| 0 <= i < |s| && s[i].receipt == x;
  ProofLib.FilterMember(p, e.flags, s[i]);
}

lemma reinstate_ensures(e: Enforcement, by_: int, pins: seq<PinRead>)
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysModeratorsAreAdministrators(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysRepositoriesRegistered(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysLatestIdsRequested(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysSequencedRequests(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysServiceBanFindings(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysMaliceBanned(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysRegisteredIdentities(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysFrozenOriginalOnly(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysGrantsAudited(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysExemptionGranted(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysFlagTimes(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysResolvedFlagsExist(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysActiveActorsUnique(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysFlagPause(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysClearHoldsNoRestrictionState(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysRestrictedEpoch(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysRestrictedByModerators(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysAppealHasAppellant(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysFlagPauseHasNoRevision(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysUnbannedReviewedFindings(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysReviewedAreFindings(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysNoticesPerEntry(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysJournalNumbered(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysFlagReceiptsUnique(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysGrantIdsUnique(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> alwaysAccountBansDecided(reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> stepJournalsOnlyAppend(e, reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> stepCountersMonotone(e, reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> stepRepositoriesOnlyAppend(e, reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> stepOnlyDecisionsLiftRestrictions(e, "reinstate", reinstate(e, by_, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, pins) ==> stepRecordedAssessmentsNeverChange(e, reinstate(e, by_, pins)))
{
  if inv(e) && canReinstate(e, by_, pins) {
    var after := reinstate(e, by_, pins);
    forall f | f in after.flags
      ensures !activeFlag(after, f)
    {
      if activeFlag(e, f) {
        ActiveReceiptsCover(e, f);
      }
    }
    forall x | x in activeReceipts(e)
      ensures exists f :: f in e.flags && f.receipt == x
    {
      ActiveReceiptsFromFlags(e, x);
    }
  }
}

// A singleton set union keeps the old members and admits only its argument.
lemma SingletonUnionMembers(values: seq<int>, value: int)
  ensures forall x :: x in values + ProofLib.Filter((set_x: int) => !((set_x in values)), [value]) <==> x in values || x == value
{
  forall x: int
    ensures x in values + ProofLib.Filter((set_x: int) => !((set_x in values)), [value]) <==> x in values || x == value
  {
    ProofLib.FilterMember((set_x: int) => !((set_x in values)), [value], x);
  }
}

lemma recordResult_ensures(e: Enforcement, scanOutcome: security__admission_Outcome, plan: RevisionPlan)
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysModeratorsAreAdministrators(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysRepositoriesRegistered(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysLatestIdsRequested(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysSequencedRequests(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysServiceBanFindings(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysMaliceBanned(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysRegisteredIdentities(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysFrozenOriginalOnly(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysGrantsAudited(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysExemptionGranted(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysFlagTimes(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysResolvedFlagsExist(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysActiveActorsUnique(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysFlagPause(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysClearHoldsNoRestrictionState(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysRestrictedEpoch(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysRestrictedByModerators(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysAppealHasAppellant(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysFlagPauseHasNoRevision(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysUnbannedReviewedFindings(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysReviewedAreFindings(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysNoticesPerEntry(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysJournalNumbered(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysFlagReceiptsUnique(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysGrantIdsUnique(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> alwaysAccountBansDecided(recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> stepJournalsOnlyAppend(e, recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> stepCountersMonotone(e, recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> stepRepositoriesOnlyAppend(e, recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> stepOnlyDecisionsLiftRestrictions(e, "recordResult", recordResult(e, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, scanOutcome, plan) ==> stepRecordedAssessmentsNeverChange(e, recordResult(e, scanOutcome, plan)))
{
  if inv(e) && canRecordResult(e, scanOutcome, plan) {
    var updated := withResult(scanOutcome, e);
    forall x | x in newlyResolved(updated)
      ensures exists f :: f in updated.flags && f.receipt == x
    {
      NewlyResolvedFromFlags(updated, x);
    }
    SingletonUnionMembers(e.findings, scanOutcome.assessment);
  }
}
