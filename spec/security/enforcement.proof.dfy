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

lemma recognizeFrozen_ensures(e: Enforcement, row: FrozenRow)
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysModeratorsAreAdministrators(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysRepositoriesRegistered(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysLatestIdsRequested(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysSequencedRequests(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysServiceBanFindings(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysMaliceBanned(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysRegisteredIdentities(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysFrozenOriginalOnly(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysGrantsAudited(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysExemptionGranted(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysFlagTimes(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysResolvedFlagsExist(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysActiveActorsUnique(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysFlagPause(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysClearHoldsNoRestrictionState(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysRestrictedEpoch(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysRestrictedByModerators(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysAppealHasAppellant(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysFlagPauseHasNoRevision(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysUnbannedReviewedFindings(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysReviewedAreFindings(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysNoticesPerEntry(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysJournalNumbered(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysFlagReceiptsUnique(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysGrantIdsUnique(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> alwaysAccountBansDecided(recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> stepJournalsOnlyAppend(e, recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> stepCountersMonotone(e, recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> stepRepositoriesOnlyAppend(e, recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> stepOnlyDecisionsLiftRestrictions(e, "recognizeFrozen", recognizeFrozen(e, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, row) ==> stepRecordedAssessmentsNeverChange(e, recognizeFrozen(e, row)))
{
  if inv(e) && canRecognizeFrozen(e, row) {
    SingletonUnionMembers(e.frozen, row.repository);
  }
}

lemma grantExemption_ensures(e: Enforcement, by_: int, request: GrantRequest)
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysModeratorsAreAdministrators(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysRepositoriesRegistered(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysLatestIdsRequested(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysSequencedRequests(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysServiceBanFindings(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysMaliceBanned(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysRegisteredIdentities(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysFrozenOriginalOnly(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysGrantsAudited(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysExemptionGranted(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysFlagTimes(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysResolvedFlagsExist(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysActiveActorsUnique(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysFlagPause(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysClearHoldsNoRestrictionState(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysRestrictedEpoch(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysRestrictedByModerators(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysAppealHasAppellant(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysFlagPauseHasNoRevision(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysUnbannedReviewedFindings(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysReviewedAreFindings(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysNoticesPerEntry(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysJournalNumbered(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysFlagReceiptsUnique(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysGrantIdsUnique(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> alwaysAccountBansDecided(grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> stepJournalsOnlyAppend(e, grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> stepCountersMonotone(e, grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> stepRepositoriesOnlyAppend(e, grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> stepOnlyDecisionsLiftRestrictions(e, "grantExemption", grantExemption(e, by_, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, request) ==> stepRecordedAssessmentsNeverChange(e, grantExemption(e, by_, request)))
{
  if inv(e) && canGrantExemption(e, by_, request) {
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

lemma ban_ensures(e: Enforcement, by_: int, plan: RevisionPlan)
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysModeratorsAreAdministrators(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysRepositoriesRegistered(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysLatestIdsRequested(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysSequencedRequests(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysServiceBanFindings(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysMaliceBanned(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysRegisteredIdentities(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysFrozenOriginalOnly(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysGrantsAudited(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysExemptionGranted(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysFlagTimes(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysResolvedFlagsExist(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysActiveActorsUnique(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysFlagPause(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysClearHoldsNoRestrictionState(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysRestrictedEpoch(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysRestrictedByModerators(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysAppealHasAppellant(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysFlagPauseHasNoRevision(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysUnbannedReviewedFindings(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysReviewedAreFindings(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysNoticesPerEntry(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysJournalNumbered(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysFlagReceiptsUnique(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysGrantIdsUnique(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> alwaysAccountBansDecided(ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> stepJournalsOnlyAppend(e, ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> stepCountersMonotone(e, ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> stepRepositoriesOnlyAppend(e, ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> stepOnlyDecisionsLiftRestrictions(e, "ban", ban(e, by_, plan)))
  ensures (inv(e) ==> canBan(e, by_, plan) ==> stepRecordedAssessmentsNeverChange(e, ban(e, by_, plan)))
{
  if inv(e) && canBan(e, by_, plan) {
    SingletonUnionMembers(e.restrictedBy, by_);
  }
}

lemma decideMalice_ensures(e: Enforcement, by_: int, accounts: seq<int>)
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysModeratorsAreAdministrators(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysRepositoriesRegistered(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysLatestIdsRequested(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysSequencedRequests(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysServiceBanFindings(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysMaliceBanned(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysRegisteredIdentities(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysFrozenOriginalOnly(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysGrantsAudited(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysExemptionGranted(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysFlagTimes(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysResolvedFlagsExist(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysActiveActorsUnique(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysFlagPause(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysClearHoldsNoRestrictionState(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysRestrictedEpoch(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysRestrictedByModerators(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysAppealHasAppellant(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysFlagPauseHasNoRevision(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysUnbannedReviewedFindings(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysReviewedAreFindings(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysNoticesPerEntry(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysJournalNumbered(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysFlagReceiptsUnique(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysGrantIdsUnique(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> alwaysAccountBansDecided(decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> stepJournalsOnlyAppend(e, decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> stepCountersMonotone(e, decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> stepRepositoriesOnlyAppend(e, decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> stepOnlyDecisionsLiftRestrictions(e, "decideMalice", decideMalice(e, by_, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, accounts) ==> stepRecordedAssessmentsNeverChange(e, decideMalice(e, by_, accounts)))
{
  if inv(e) && canDecideMalice(e, by_, accounts) {
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
