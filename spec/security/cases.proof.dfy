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

lemma decide_ensures(c: PrivateCase, by_: int, checkedEpoch: int, finding: Finding, related: bool)
  ensures (inv(c) ==> canDecide(c, by_, checkedEpoch, finding, related) ==> alwaysScreeningIsAdvisory(decide(c, by_, checkedEpoch, finding, related)))
  ensures (inv(c) ==> canDecide(c, by_, checkedEpoch, finding, related) ==> alwaysAwardHasAcceptance(decide(c, by_, checkedEpoch, finding, related)))
  ensures (inv(c) ==> canDecide(c, by_, checkedEpoch, finding, related) ==> alwaysAppealState(decide(c, by_, checkedEpoch, finding, related)))
  ensures (inv(c) ==> canDecide(c, by_, checkedEpoch, finding, related) ==> alwaysAppealSource(decide(c, by_, checkedEpoch, finding, related)))
  ensures (inv(c) ==> canDecide(c, by_, checkedEpoch, finding, related) ==> alwaysRelatedApproval(decide(c, by_, checkedEpoch, finding, related)))
  ensures (inv(c) ==> canDecide(c, by_, checkedEpoch, finding, related) ==> alwaysVerifiedPatchMatches(decide(c, by_, checkedEpoch, finding, related)))
  ensures (inv(c) ==> canDecide(c, by_, checkedEpoch, finding, related) ==> alwaysExactDisclosure(decide(c, by_, checkedEpoch, finding, related)))
  ensures (inv(c) ==> canDecide(c, by_, checkedEpoch, finding, related) ==> stepPreservesApprovedAward(c, decide(c, by_, checkedEpoch, finding, related)))
{
  if inv(c) && canDecide(c, by_, checkedEpoch, finding, related) {
    SingletonUnionMembers(c.deciders, by_);
    var after := decide(c, by_, checkedEpoch, finding, related);
    assert after.deciders == c.deciders + ProofLib.Filter((set_x: int) => !((set_x in c.deciders)), [by_]);
    assert by_ in after.deciders;
    assert |after.deciders| > 0;
  }
}
