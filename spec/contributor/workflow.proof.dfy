lemma DeclareChangeTypeFilter(c: Contribution, by_: int, changeType: slopbot__closure_ChangeType)
  ensures declareChangeType(c, by_, changeType).changeTypes == c.changeTypes + ProofLib.Filter((set_x: slopbot__closure_ChangeType) => !((set_x in c.changeTypes)), [changeType])
{
}

lemma declareChangeType_ensures(c: Contribution, by_: int, changeType: slopbot__closure_ChangeType)
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> alwaysStoppedHasCause(declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> alwaysActiveSelection(declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> alwaysWorkFollowsClearInspection(declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> alwaysNoForbiddenWrite(declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> alwaysSubmissionEvidence(declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> alwaysSubmittedDisclosed(declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> alwaysDocsStandsAlone(declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> alwaysSubmittedEvidenceComplete(declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> alwaysCreditNeedsMerge(declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> alwaysClosedHasCloser(declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> alwaysNoSelfReviewCredit(declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> stepStoppedDoesNotProgress(c, declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> stepRiskLiftedOnlyByFreshScan(c, "declareChangeType", declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> stepCleanScanMonotone(c, declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> stepSubmittedAttributionStable(c, declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> stepCreditNeedsClearStanding(c, declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> stepAcceptedFinal(c, declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> stepGitHubFactsFromCollector(c, "declareChangeType", declareChangeType(c, by_, changeType)))
  ensures (inv(c) ==> canDeclareChangeType(c, by_, changeType) ==> stepStandingFromService(c, "declareChangeType", declareChangeType(c, by_, changeType)))
{
  if inv(c) && canDeclareChangeType(c, by_, changeType) {
    var after := declareChangeType(c, by_, changeType);
    DeclareChangeTypeFilter(c, by_, changeType);
    var p := (set_x: slopbot__closure_ChangeType) => !((set_x in c.changeTypes));
    ProofLib.FilterCons(p, [changeType]);
    ProofLib.FilterNil(p, [changeType][1..]);
    assert after.changeTypes == c.changeTypes + [changeType];
    if changeType.Docs? {
      assert c.changeTypes == [];
      assert after.changeTypes == [changeType];
    }
  }
}
