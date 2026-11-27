lemma lawUiWithoutVideoIsAFinding_ensures(types: seq<ChangeType>, supplied: seq<EvidenceField>, guideScreenshots: bool)
  ensures (lawUiWithoutVideoIsAFinding(types, supplied, guideScreenshots) == true)
{
  if (typed0_slopbot__closure(ChangeType.Ui) in types) && !(typed1_slopbot__closure(EvidenceField.UiVideo) in supplied) {
    reveal Std.Collections.Seq.Filter();
    assert typed1_slopbot__closure(EvidenceField.UiVideo) in requiredEvidence(types, guideScreenshots);
  }
}
