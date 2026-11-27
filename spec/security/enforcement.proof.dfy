lemma CompletedAtPinMeaning(e: Enforcement, repository: int, pins: seq<PinRead>)
  ensures completedAtPin(e, repository, pins) ==
    (if pinUnavailable(pins, repository) then []
     else ProofLib.Filter((a: Assessment) => (((a.repository == repository) && (a.identity == identityOf(e, repository))) && atLivePin(pins, repository, a.id)), e.recorded))
{
}

lemma DecidingAtInRecorded(e: Enforcement, repository: int, pins: seq<PinRead>)
  requires decidingAt(e, repository, pins).state.AClean?
  ensures decidingAt(e, repository, pins) in e.recorded
  ensures decidingAt(e, repository, pins).repository == repository
{
  CompletedAtPinMeaning(e, repository, pins);
  var c := completedAtPin(e, repository, pins);
  assert !pinUnavailable(pins, repository) && |c| > 0;
  var a := c[|c| - 1];
  assert a == decidingAt(e, repository, pins);
  ProofLib.FilterMember((x: Assessment) => (((x.repository == repository) && (x.identity == identityOf(e, repository))) && atLivePin(pins, repository, x.id)), e.recorded, a);
}

lemma GrantByIdMeaning(e: Enforcement, grantId: int)
  ensures grantById(e, grantId) ==
    (if 0 < |ProofLib.Filter((g: Grant) => (g.id == grantId), e.grants)|
     then ProofLib.Filter((g: Grant) => (g.id == grantId), e.grants)[0]
     else noGrant)
{
}

lemma JournalReinstatementBans(e: Enforcement, by_: int, fence: Fence, accounts: seq<int>)
  ensures journalAccountReinstatement(e, by_, fence, accounts).liveBans ==
    ProofLib.Filter((b: AccountBan) => !((b.account in accounts)), e.liveBans)
{
}

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

lemma reinstate_ensures(e: Enforcement, by_: int, fence: Fence)
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysModeratorsAreAdministrators(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysRepositoriesRegistered(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysLatestIdsRequested(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysSequencedRequests(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysServiceBanFindings(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysMaliceBanned(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysRegisteredIdentities(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysFrozenOriginalOnly(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysGrantsAudited(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysExemptionGranted(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysRevocationsAudited(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysFlagTimes(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysResolvedFlagsExist(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysActiveActorsUnique(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysFlagPause(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysLiveBansRecorded(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysClearHoldsNoRestrictionState(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysRestrictedEpoch(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysRestrictedByModerators(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysAppealHasAppellant(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysFlagPauseHasNoRevision(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysUnbannedReviewedFindings(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysReviewedAreFindings(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysNoticesPerEntry(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysJournalNumbered(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysFlagReceiptsUnique(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysGrantIdsUnique(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> alwaysAccountBansDecided(reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> stepScanReinstatementNamesEveryRepository(e, "reinstate", reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> stepAccountEntriesKeepRestriction(e, "reinstate", reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> stepJournalsOnlyAppend(e, reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> stepRepositoriesOnlyAppend(e, reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> stepOnlyDecisionsLiftRestrictions(e, "reinstate", reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> stepCountersMonotone(e, reinstate(e, by_, fence)))
  ensures (inv(e) ==> canReinstate(e, by_, fence) ==> stepRecordedAssessmentsNeverChange(e, reinstate(e, by_, fence)))
{
  if inv(e) && canReinstate(e, by_, fence) {
    var after := reinstate(e, by_, fence);
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
    forall r | r in e.repositories
      ensures !latestOf(e, r).state.AMalicious?
    {
      DecidingAtInRecorded(e, r, e.pinReads);
      assert decidingAt(e, r, e.pinReads).requestEpoch == e.epoch;
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
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysRevocationsAudited(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysFlagTimes(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysResolvedFlagsExist(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysActiveActorsUnique(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysFlagPause(recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> alwaysLiveBansRecorded(recordResult(e, by_, scanOutcome, plan)))
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
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> stepScanReinstatementNamesEveryRepository(e, "recordResult", recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> stepAccountEntriesKeepRestriction(e, "recordResult", recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> stepJournalsOnlyAppend(e, recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> stepRepositoriesOnlyAppend(e, recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> stepOnlyDecisionsLiftRestrictions(e, "recordResult", recordResult(e, by_, scanOutcome, plan)))
  ensures (inv(e) ==> canRecordResult(e, by_, scanOutcome, plan) ==> stepCountersMonotone(e, recordResult(e, by_, scanOutcome, plan)))
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
    if scanOutcome.disposition.DMalicious? {
      assert scanOutcome.assessment in recordResult(e, by_, scanOutcome, plan).findings;
    }
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
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysModeratorsAreAdministrators(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysRepositoriesRegistered(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysLatestIdsRequested(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysSequencedRequests(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysServiceBanFindings(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysMaliceBanned(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysRegisteredIdentities(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysFrozenOriginalOnly(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysGrantsAudited(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysExemptionGranted(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysRevocationsAudited(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysFlagTimes(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysResolvedFlagsExist(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysActiveActorsUnique(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysFlagPause(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysLiveBansRecorded(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysClearHoldsNoRestrictionState(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysRestrictedEpoch(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysRestrictedByModerators(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysAppealHasAppellant(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysFlagPauseHasNoRevision(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysUnbannedReviewedFindings(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysReviewedAreFindings(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysNoticesPerEntry(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysJournalNumbered(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysFlagReceiptsUnique(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysGrantIdsUnique(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> alwaysAccountBansDecided(recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> stepScanReinstatementNamesEveryRepository(e, "recognizeFrozen", recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> stepAccountEntriesKeepRestriction(e, "recognizeFrozen", recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> stepJournalsOnlyAppend(e, recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> stepRepositoriesOnlyAppend(e, recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> stepOnlyDecisionsLiftRestrictions(e, "recognizeFrozen", recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> stepCountersMonotone(e, recognizeFrozen(e, by_, row)))
  ensures (inv(e) ==> canRecognizeFrozen(e, by_, row) ==> stepRecordedAssessmentsNeverChange(e, recognizeFrozen(e, by_, row)))
{
  if inv(e) && canRecognizeFrozen(e, by_, row) {
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
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysRevocationsAudited(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysFlagTimes(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysResolvedFlagsExist(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysActiveActorsUnique(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysFlagPause(grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> alwaysLiveBansRecorded(grantExemption(e, by_, fence, request)))
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
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> stepScanReinstatementNamesEveryRepository(e, "grantExemption", grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> stepAccountEntriesKeepRestriction(e, "grantExemption", grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> stepJournalsOnlyAppend(e, grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> stepRepositoriesOnlyAppend(e, grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> stepOnlyDecisionsLiftRestrictions(e, "grantExemption", grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> stepCountersMonotone(e, grantExemption(e, by_, fence, request)))
  ensures (inv(e) ==> canGrantExemption(e, by_, fence, request) ==> stepRecordedAssessmentsNeverChange(e, grantExemption(e, by_, fence, request)))
{
  if inv(e) && canGrantExemption(e, by_, fence, request) {
    SingletonUnionMembers(e.exempt, request.repository);
    var after := grantExemption(e, by_, fence, request);
    var added := after.grants[|e.grants|];
    assert after.grants == e.grants + [added];
    GrantByIdMeaning(after, request.id);
    ProofLib.FilterAppend((g: Grant) => (g.id == request.id), e.grants, added);
    ProofLib.FilterNone((g: Grant) => (g.id == request.id), e.grants);
    assert grantById(after, request.id) == added;
    forall r | r in e.exempt
      ensures grantById(after, activeGrantOf(e, r)) == grantById(e, activeGrantOf(e, r))
    {
      var gid := activeGrantOf(e, r);
      GrantByIdMeaning(e, gid);
      GrantByIdMeaning(after, gid);
      ProofLib.FilterAppend((g: Grant) => (g.id == gid), e.grants, added);
      assert |ProofLib.Filter((g: Grant) => (g.id == gid), e.grants)| > 0;
    }
    forall v | v in e.revocations
      ensures grantById(after, v.grant) == grantById(e, v.grant)
      ensures v.grant != request.id
    {
      GrantByIdMeaning(e, v.grant);
      GrantByIdMeaning(after, v.grant);
      ProofLib.FilterAppend((g: Grant) => (g.id == v.grant), e.grants, added);
      assert |ProofLib.Filter((g: Grant) => (g.id == v.grant), e.grants)| > 0;
      ProofLib.FilterMember((g: Grant) => (g.id == v.grant), e.grants, ProofLib.Filter((g: Grant) => (g.id == v.grant), e.grants)[0]);
    }
  }
}

lemma revokeExemption_ensures(e: Enforcement, by_: int, revoke: RevokeRequest)
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysModeratorsAreAdministrators(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysRepositoriesRegistered(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysLatestIdsRequested(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysSequencedRequests(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysServiceBanFindings(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysMaliceBanned(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysRegisteredIdentities(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysFrozenOriginalOnly(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysGrantsAudited(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysExemptionGranted(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysRevocationsAudited(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysFlagTimes(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysResolvedFlagsExist(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysActiveActorsUnique(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysFlagPause(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysLiveBansRecorded(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysClearHoldsNoRestrictionState(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysRestrictedEpoch(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysRestrictedByModerators(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysAppealHasAppellant(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysFlagPauseHasNoRevision(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysUnbannedReviewedFindings(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysReviewedAreFindings(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysNoticesPerEntry(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysJournalNumbered(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysFlagReceiptsUnique(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysGrantIdsUnique(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> alwaysAccountBansDecided(revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> stepScanReinstatementNamesEveryRepository(e, "revokeExemption", revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> stepAccountEntriesKeepRestriction(e, "revokeExemption", revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> stepJournalsOnlyAppend(e, revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> stepRepositoriesOnlyAppend(e, revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> stepOnlyDecisionsLiftRestrictions(e, "revokeExemption", revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> stepCountersMonotone(e, revokeExemption(e, by_, revoke)))
  ensures (inv(e) ==> canRevokeExemption(e, by_, revoke) ==> stepRecordedAssessmentsNeverChange(e, revokeExemption(e, by_, revoke)))
{
  if inv(e) && canRevokeExemption(e, by_, revoke) {
    ExcludeMembers(e.exempt, grantById(e, revoke.grant).repository);
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
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysRevocationsAudited(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysFlagTimes(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysResolvedFlagsExist(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysActiveActorsUnique(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysFlagPause(ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> alwaysLiveBansRecorded(ban(e, by_, fence, plan)))
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
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> stepScanReinstatementNamesEveryRepository(e, "ban", ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> stepAccountEntriesKeepRestriction(e, "ban", ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> stepJournalsOnlyAppend(e, ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> stepRepositoriesOnlyAppend(e, ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> stepOnlyDecisionsLiftRestrictions(e, "ban", ban(e, by_, fence, plan)))
  ensures (inv(e) ==> canBan(e, by_, fence, plan) ==> stepCountersMonotone(e, ban(e, by_, fence, plan)))
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
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysRevocationsAudited(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysFlagTimes(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysResolvedFlagsExist(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysActiveActorsUnique(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysFlagPause(decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> alwaysLiveBansRecorded(decideMalice(e, by_, fence, accounts)))
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
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> stepScanReinstatementNamesEveryRepository(e, "decideMalice", decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> stepAccountEntriesKeepRestriction(e, "decideMalice", decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> stepJournalsOnlyAppend(e, decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> stepRepositoriesOnlyAppend(e, decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> stepOnlyDecisionsLiftRestrictions(e, "decideMalice", decideMalice(e, by_, fence, accounts)))
  ensures (inv(e) ==> canDecideMalice(e, by_, fence, accounts) ==> stepCountersMonotone(e, decideMalice(e, by_, fence, accounts)))
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
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysRevocationsAudited(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysFlagTimes(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysResolvedFlagsExist(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysActiveActorsUnique(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysFlagPause(requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> alwaysLiveBansRecorded(requestAppeal(e, by_)))
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
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> stepScanReinstatementNamesEveryRepository(e, "requestAppeal", requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> stepAccountEntriesKeepRestriction(e, "requestAppeal", requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> stepJournalsOnlyAppend(e, requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> stepRepositoriesOnlyAppend(e, requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> stepOnlyDecisionsLiftRestrictions(e, "requestAppeal", requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> stepCountersMonotone(e, requestAppeal(e, by_)))
  ensures (inv(e) ==> canRequestAppeal(e, by_) ==> stepRecordedAssessmentsNeverChange(e, requestAppeal(e, by_)))
{
  if inv(e) && canRequestAppeal(e, by_) {
    SingletonUnionMembers(e.appellants, by_);
    assert by_ in requestAppeal(e, by_).appellants;
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
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysRevocationsAudited(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysFlagTimes(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysResolvedFlagsExist(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysActiveActorsUnique(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysFlagPause(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> alwaysLiveBansRecorded(requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
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
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> stepScanReinstatementNamesEveryRepository(e, "requestAssessment", requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> stepAccountEntriesKeepRestriction(e, "requestAssessment", requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> stepJournalsOnlyAppend(e, requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> stepRepositoriesOnlyAppend(e, requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> stepOnlyDecisionsLiftRestrictions(e, "requestAssessment", requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> stepCountersMonotone(e, requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
  ensures (inv(e) ==> canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) ==> stepRecordedAssessmentsNeverChange(e, requestAssessment(e, by_, repository, requestOrigin, assessmentId)))
{
  if inv(e) && canRequestAssessment(e, by_, repository, requestOrigin, assessmentId) {
    SingletonUnionMembers(e.assessmentIds, assessmentId);
  }
}

lemma requeueTemplate_ensures(e: Enforcement, by_: int, repository: int, assessmentId: int)
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysModeratorsAreAdministrators(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysRepositoriesRegistered(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysLatestIdsRequested(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysSequencedRequests(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysServiceBanFindings(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysMaliceBanned(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysRegisteredIdentities(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysFrozenOriginalOnly(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysGrantsAudited(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysExemptionGranted(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysRevocationsAudited(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysFlagTimes(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysResolvedFlagsExist(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysActiveActorsUnique(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysFlagPause(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysLiveBansRecorded(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysClearHoldsNoRestrictionState(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysRestrictedEpoch(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysRestrictedByModerators(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysAppealHasAppellant(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysFlagPauseHasNoRevision(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysUnbannedReviewedFindings(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysReviewedAreFindings(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysNoticesPerEntry(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysJournalNumbered(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysFlagReceiptsUnique(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysGrantIdsUnique(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> alwaysAccountBansDecided(requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> stepScanReinstatementNamesEveryRepository(e, "requeueTemplate", requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> stepAccountEntriesKeepRestriction(e, "requeueTemplate", requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> stepJournalsOnlyAppend(e, requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> stepRepositoriesOnlyAppend(e, requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> stepOnlyDecisionsLiftRestrictions(e, "requeueTemplate", requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> stepCountersMonotone(e, requeueTemplate(e, by_, repository, assessmentId)))
  ensures (inv(e) ==> canRequeueTemplate(e, by_, repository, assessmentId) ==> stepRecordedAssessmentsNeverChange(e, requeueTemplate(e, by_, repository, assessmentId)))
{
  if inv(e) && canRequeueTemplate(e, by_, repository, assessmentId) {
    SingletonUnionMembers(e.assessmentIds, assessmentId);
  }
}

lemma reinstateFlagPause_ensures(e: Enforcement, by_: int, pins: seq<PinRead>)
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysModeratorsAreAdministrators(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysRepositoriesRegistered(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysLatestIdsRequested(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysSequencedRequests(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysServiceBanFindings(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysMaliceBanned(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysRegisteredIdentities(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysFrozenOriginalOnly(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysGrantsAudited(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysExemptionGranted(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysRevocationsAudited(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysFlagTimes(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysResolvedFlagsExist(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysActiveActorsUnique(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysFlagPause(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysLiveBansRecorded(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysClearHoldsNoRestrictionState(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysRestrictedEpoch(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysRestrictedByModerators(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysAppealHasAppellant(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysFlagPauseHasNoRevision(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysUnbannedReviewedFindings(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysReviewedAreFindings(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysNoticesPerEntry(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysJournalNumbered(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysFlagReceiptsUnique(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysGrantIdsUnique(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> alwaysAccountBansDecided(reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> stepScanReinstatementNamesEveryRepository(e, "reinstateFlagPause", reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> stepAccountEntriesKeepRestriction(e, "reinstateFlagPause", reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> stepJournalsOnlyAppend(e, reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> stepRepositoriesOnlyAppend(e, reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> stepOnlyDecisionsLiftRestrictions(e, "reinstateFlagPause", reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> stepCountersMonotone(e, reinstateFlagPause(e, by_, pins)))
  ensures (inv(e) ==> canReinstateFlagPause(e, by_, pins) ==> stepRecordedAssessmentsNeverChange(e, reinstateFlagPause(e, by_, pins)))
{
  if inv(e) && canReinstateFlagPause(e, by_, pins) {
    var after := reinstateFlagPause(e, by_, pins);
    assert provenanceOf(after) == provenance(e, pins);
    forall i | 0 <= i < |e.repositories|
      ensures exists id :: id in provenanceOf(after) && exists a :: a in e.recorded && a.id == id && a.repository == e.repositories[i] && a.state.AClean?
    {
      var r := e.repositories[i];
      assert r in e.repositories;
      DecidingAtInRecorded(e, r, pins);
      assert provenanceOf(after)[i] == decidingAt(e, r, pins).id;
      assert provenanceOf(after)[i] in provenanceOf(after);
    }
  }
}

lemma journalAccountReinstatement_ensures(e: Enforcement, by_: int, fence: Fence, accounts: seq<int>)
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysModeratorsAreAdministrators(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysRepositoriesRegistered(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysLatestIdsRequested(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysSequencedRequests(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysServiceBanFindings(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysMaliceBanned(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysRegisteredIdentities(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysFrozenOriginalOnly(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysGrantsAudited(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysExemptionGranted(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysRevocationsAudited(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysFlagTimes(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysResolvedFlagsExist(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysActiveActorsUnique(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysFlagPause(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysLiveBansRecorded(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysClearHoldsNoRestrictionState(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysRestrictedEpoch(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysRestrictedByModerators(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysAppealHasAppellant(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysFlagPauseHasNoRevision(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysUnbannedReviewedFindings(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysReviewedAreFindings(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysNoticesPerEntry(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysJournalNumbered(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysFlagReceiptsUnique(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysGrantIdsUnique(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> alwaysAccountBansDecided(journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> stepScanReinstatementNamesEveryRepository(e, "journalAccountReinstatement", journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> stepAccountEntriesKeepRestriction(e, "journalAccountReinstatement", journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> stepJournalsOnlyAppend(e, journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> stepRepositoriesOnlyAppend(e, journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> stepOnlyDecisionsLiftRestrictions(e, "journalAccountReinstatement", journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> stepCountersMonotone(e, journalAccountReinstatement(e, by_, fence, accounts)))
  ensures (inv(e) ==> canJournalAccountReinstatement(e, by_, fence, accounts) ==> stepRecordedAssessmentsNeverChange(e, journalAccountReinstatement(e, by_, fence, accounts)))
{
  if inv(e) && canJournalAccountReinstatement(e, by_, fence, accounts) {
    var after := journalAccountReinstatement(e, by_, fence, accounts);
    JournalReinstatementBans(e, by_, fence, accounts);
    forall b | b in after.liveBans
      ensures b in e.liveBans
    {
      ProofLib.FilterMember((x: AccountBan) => !((x.account in accounts)), e.liveBans, b);
    }
  }
}
