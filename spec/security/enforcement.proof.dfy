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

lemma reinstate_ensures(e: Enforcement, by_: int, fence: Fence, pins: seq<PinRead>)
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysModeratorsAreAdministrators(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysRepositoriesRegistered(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysLatestIdsRequested(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysSequencedRequests(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysServiceBanFindings(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysMaliceBanned(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysRegisteredIdentities(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysFrozenOriginalOnly(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysGrantsAudited(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysExemptionGranted(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysFlagTimes(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysResolvedFlagsExist(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysActiveActorsUnique(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysFlagPause(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysClearHoldsNoRestrictionState(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysRestrictedEpoch(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysRestrictedByModerators(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysAppealHasAppellant(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysFlagPauseHasNoRevision(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysUnbannedReviewedFindings(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysReviewedAreFindings(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysNoticesPerEntry(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysJournalNumbered(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysFlagReceiptsUnique(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysGrantIdsUnique(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> alwaysAccountBansDecided(reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> stepJournalsOnlyAppend(e, reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> stepCountersMonotone(e, reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> stepRepositoriesOnlyAppend(e, reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> stepOnlyDecisionsLiftRestrictions(e, "reinstate", reinstate(e, by_, fence, pins)))
  ensures (inv(e) ==> canReinstate(e, by_, fence, pins) ==> stepRecordedAssessmentsNeverChange(e, reinstate(e, by_, fence, pins)))
{
  if inv(e) && canReinstate(e, by_, fence, pins) {
    var after := reinstate(e, by_, fence, pins);
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

lemma recordResult_ensures(e: Enforcement, by_: int, scanOutcome: security__admission_Outcome, plan: RevisionPlan)
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysModeratorsAreAdministrators(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysRepositoriesRegistered(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysLatestIdsRequested(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysSequencedRequests(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysServiceBanFindings(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysMaliceBanned(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysRegisteredIdentities(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysFrozenOriginalOnly(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysGrantsAudited(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysExemptionGranted(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysFlagTimes(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysResolvedFlagsExist(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysActiveActorsUnique(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysFlagPause(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysClearHoldsNoRestrictionState(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysRestrictedEpoch(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysRestrictedByModerators(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysAppealHasAppellant(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysFlagPauseHasNoRevision(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysUnbannedReviewedFindings(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysReviewedAreFindings(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysNoticesPerEntry(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysJournalNumbered(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysFlagReceiptsUnique(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysGrantIdsUnique(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysAccountBansDecided(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> stepJournalsOnlyAppend(e, recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> stepCountersMonotone(e, recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> stepRepositoriesOnlyAppend(e, recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> stepOnlyDecisionsLiftRestrictions(e, "recordResult", recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> stepRecordedAssessmentsNeverChange(e, recordResult(e, by_, scanOutcome, plan)))
{
  if inv(e) && canRecordResult(e, by_, scanOutcome, plan) {
    var updated := withResult(scanOutcome, e);
    forall x | x in newlyResolved(updated)
      ensures exists f :: f in updated.flags && f.receipt == x
    {
      NewlyResolvedFromFlags(updated, x);
    }
    SingletonUnionMembers(e.findings, scanOutcome.assessment);
  }
}

// Removing one value keeps every other member and nothing else.
lemma ExcludeMembers(values: seq<int>, value: int)
  ensures forall x :: x in ProofLib.Filter((set_x: int) => !((set_x in [value])), values) <==> x in values && x != value
{
  forall x: int
    ensures x in ProofLib.Filter((set_x: int) => !((set_x in [value])), values) <==> x in values && x != value
  {
    ProofLib.FilterMember((set_x: int) => !((set_x in [value])), values, x);
  }
}

lemma recognizeFrozen_ensures(e: Enforcement, by_: int, row: FrozenRow)
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysModeratorsAreAdministrators(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysRepositoriesRegistered(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysLatestIdsRequested(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysSequencedRequests(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysServiceBanFindings(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysMaliceBanned(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysRegisteredIdentities(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysFrozenOriginalOnly(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysGrantsAudited(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysExemptionGranted(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysFlagTimes(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysResolvedFlagsExist(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysActiveActorsUnique(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysFlagPause(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysClearHoldsNoRestrictionState(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysRestrictedEpoch(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysRestrictedByModerators(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysAppealHasAppellant(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysFlagPauseHasNoRevision(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysUnbannedReviewedFindings(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysReviewedAreFindings(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysNoticesPerEntry(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysJournalNumbered(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysFlagReceiptsUnique(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysGrantIdsUnique(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysAccountBansDecided(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> stepJournalsOnlyAppend(e, recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> stepCountersMonotone(e, recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> stepRepositoriesOnlyAppend(e, recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> stepOnlyDecisionsLiftRestrictions(e, "recognizeFrozen", recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> stepRecordedAssessmentsNeverChange(e, recognizeFrozen(e, by_, row)))
{
  if inv(e) && canRecognizeFrozen(e, row) {
    SingletonUnionMembers(e.frozen, row.repository);
  }
}

lemma grantExemption_ensures(e: Enforcement, by_: int, fence: Fence, request: GrantRequest)
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysModeratorsAreAdministrators(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysRepositoriesRegistered(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysLatestIdsRequested(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysSequencedRequests(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysServiceBanFindings(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysMaliceBanned(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysRegisteredIdentities(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysFrozenOriginalOnly(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysGrantsAudited(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysExemptionGranted(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysFlagTimes(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysResolvedFlagsExist(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysActiveActorsUnique(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysFlagPause(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysClearHoldsNoRestrictionState(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysRestrictedEpoch(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysRestrictedByModerators(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysAppealHasAppellant(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysFlagPauseHasNoRevision(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysUnbannedReviewedFindings(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysReviewedAreFindings(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysNoticesPerEntry(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysJournalNumbered(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysFlagReceiptsUnique(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysGrantIdsUnique(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysAccountBansDecided(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> stepJournalsOnlyAppend(e, grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> stepCountersMonotone(e, grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> stepRepositoriesOnlyAppend(e, grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> stepOnlyDecisionsLiftRestrictions(e, "grantExemption", grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> stepRecordedAssessmentsNeverChange(e, grantExemption(e, by_, fence, request)))
{
  if inv(e) && canGrantExemption(e, by_, fence, request) {
    SingletonUnionMembers(e.exempt, request.repository);
  }
}

lemma revokeExemption_ensures(e: Enforcement, by_: int, repository: int, grantId: int, decision: int)
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysModeratorsAreAdministrators(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysRepositoriesRegistered(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysLatestIdsRequested(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysSequencedRequests(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysServiceBanFindings(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysMaliceBanned(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysRegisteredIdentities(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysFrozenOriginalOnly(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysGrantsAudited(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysExemptionGranted(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysFlagTimes(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysResolvedFlagsExist(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysActiveActorsUnique(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysFlagPause(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysClearHoldsNoRestrictionState(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysRestrictedEpoch(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysRestrictedByModerators(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysAppealHasAppellant(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysFlagPauseHasNoRevision(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysUnbannedReviewedFindings(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysReviewedAreFindings(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysNoticesPerEntry(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysJournalNumbered(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysFlagReceiptsUnique(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysGrantIdsUnique(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> alwaysAccountBansDecided(revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> stepJournalsOnlyAppend(e, revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> stepCountersMonotone(e, revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> stepRepositoriesOnlyAppend(e, revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> stepOnlyDecisionsLiftRestrictions(e, "revokeExemption", revokeExemption(e, by_, repository, grantId, decision)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, repository, grantId, decision) ==> stepRecordedAssessmentsNeverChange(e, revokeExemption(e, by_, repository, grantId, decision)))
{
  if inv(e) && canRevokeExemption(e, by_, repository, grantId, decision) {
    ExcludeMembers(e.exempt, repository);
  }
}

lemma ban_ensures(e: Enforcement, by_: int, fence: Fence, plan: RevisionPlan)
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysModeratorsAreAdministrators(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysRepositoriesRegistered(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysLatestIdsRequested(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysSequencedRequests(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysServiceBanFindings(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysMaliceBanned(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysRegisteredIdentities(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysFrozenOriginalOnly(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysGrantsAudited(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysExemptionGranted(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysFlagTimes(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysResolvedFlagsExist(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysActiveActorsUnique(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysFlagPause(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysClearHoldsNoRestrictionState(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysRestrictedEpoch(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysRestrictedByModerators(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysAppealHasAppellant(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysFlagPauseHasNoRevision(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysUnbannedReviewedFindings(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysReviewedAreFindings(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysNoticesPerEntry(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysJournalNumbered(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysFlagReceiptsUnique(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysGrantIdsUnique(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysAccountBansDecided(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> stepJournalsOnlyAppend(e, ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> stepCountersMonotone(e, ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> stepRepositoriesOnlyAppend(e, ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> stepOnlyDecisionsLiftRestrictions(e, "ban", ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> stepRecordedAssessmentsNeverChange(e, ban(e, by_, fence, plan)))
{
  if inv(e) && canBan(e, by_, fence, plan) {
    SingletonUnionMembers(e.restrictedBy, by_);
  }
}

lemma decideMalice_ensures(e: Enforcement, by_: int, fence: Fence, accounts: seq<int>)
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysModeratorsAreAdministrators(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysRepositoriesRegistered(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysLatestIdsRequested(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysSequencedRequests(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysServiceBanFindings(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysMaliceBanned(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysRegisteredIdentities(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysFrozenOriginalOnly(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysGrantsAudited(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysExemptionGranted(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysFlagTimes(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysResolvedFlagsExist(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysActiveActorsUnique(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysFlagPause(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysClearHoldsNoRestrictionState(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysRestrictedEpoch(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysRestrictedByModerators(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysAppealHasAppellant(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysFlagPauseHasNoRevision(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysUnbannedReviewedFindings(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysReviewedAreFindings(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysNoticesPerEntry(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysJournalNumbered(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysFlagReceiptsUnique(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysGrantIdsUnique(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysAccountBansDecided(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> stepJournalsOnlyAppend(e, decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> stepCountersMonotone(e, decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> stepRepositoriesOnlyAppend(e, decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> stepOnlyDecisionsLiftRestrictions(e, "decideMalice", decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> stepRecordedAssessmentsNeverChange(e, decideMalice(e, by_, fence, accounts)))
{
  if inv(e) && canDecideMalice(e, by_, fence, accounts) {
    SingletonUnionMembers(e.restrictedBy, by_);
  }
}

lemma requestAppeal_ensures(e: Enforcement, by_: int)
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysModeratorsAreAdministrators(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysRepositoriesRegistered(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysLatestIdsRequested(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysSequencedRequests(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysServiceBanFindings(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysMaliceBanned(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysRegisteredIdentities(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysFrozenOriginalOnly(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysGrantsAudited(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysExemptionGranted(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysFlagTimes(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysResolvedFlagsExist(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysActiveActorsUnique(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysFlagPause(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysClearHoldsNoRestrictionState(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysRestrictedEpoch(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysRestrictedByModerators(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysAppealHasAppellant(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysFlagPauseHasNoRevision(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysUnbannedReviewedFindings(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysReviewedAreFindings(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysNoticesPerEntry(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysJournalNumbered(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysFlagReceiptsUnique(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysGrantIdsUnique(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysAccountBansDecided(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> stepJournalsOnlyAppend(e, requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> stepCountersMonotone(e, requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> stepRepositoriesOnlyAppend(e, requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> stepOnlyDecisionsLiftRestrictions(e, "requestAppeal", requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> stepRecordedAssessmentsNeverChange(e, requestAppeal(e, by_)))
{
  if inv(e) && canRequestAppeal(e, by_) {
    SingletonUnionMembers(e.appellants, by_);
  }
}

lemma requestAssessment_ensures(e: Enforcement, by_: int, repository: int, requestOrigin: RequestOrigin, assessmentId: int)
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysModeratorsAreAdministrators(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysRepositoriesRegistered(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysLatestIdsRequested(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysSequencedRequests(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysServiceBanFindings(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysMaliceBanned(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysRegisteredIdentities(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysFrozenOriginalOnly(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysGrantsAudited(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysExemptionGranted(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysFlagTimes(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysResolvedFlagsExist(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysActiveActorsUnique(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysFlagPause(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysClearHoldsNoRestrictionState(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysRestrictedEpoch(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysRestrictedByModerators(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysAppealHasAppellant(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysFlagPauseHasNoRevision(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysUnbannedReviewedFindings(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysReviewedAreFindings(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysNoticesPerEntry(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysJournalNumbered(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysFlagReceiptsUnique(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysGrantIdsUnique(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysAccountBansDecided(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> stepJournalsOnlyAppend(e, requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> stepCountersMonotone(e, requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> stepRepositoriesOnlyAppend(e, requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> stepOnlyDecisionsLiftRestrictions(e, "requestAssessment", requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> stepRecordedAssessmentsNeverChange(e, requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
{
  if inv(e) && canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) {
    SingletonUnionMembers(e.assessmentIds, assessmentId);
  }
}
