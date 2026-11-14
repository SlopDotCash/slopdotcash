// A singleton set union keeps the old members and admits only its argument.
lemma SingletonFilterBridge(values: seq<int>, value: int)
  ensures Std.Collections.Seq.Filter((set_x: int) => !((set_x in values)), [value]) == ProofLib.Filter((set_x: int) => !((set_x in values)), [value])
{
}

lemma SingletonUnionMembers(values: seq<int>, value: int)
  ensures forall x :: x in values + ProofLib.Filter((set_x: int) => !((set_x in values)), [value]) <==> x in values || x == value
{
  forall x: int
    ensures x in values + ProofLib.Filter((set_x: int) => !((set_x in values)), [value]) <==> x in values || x == value
  {
    ProofLib.FilterMember((set_x: int) => !((set_x in values)), [value], x);
  }
}

lemma recognizeFrozen_ensures(e: Enforcement, repository: int, frozenMember: bool)
  ensures (inv(e) ==> canRecognizeFrozen(e, repository, frozenMember) ==> alwaysFlagTimes(recognizeFrozen(e, repository, frozenMember)))
  ensures (inv(e) ==> canRecognizeFrozen(e, repository, frozenMember) ==> alwaysResolvedHistory(recognizeFrozen(e, repository, frozenMember)))
  ensures (inv(e) ==> canRecognizeFrozen(e, repository, frozenMember) ==> alwaysActiveActorsUnique(recognizeFrozen(e, repository, frozenMember)))
  ensures (inv(e) ==> canRecognizeFrozen(e, repository, frozenMember) ==> alwaysFlagPause(recognizeFrozen(e, repository, frozenMember)))
  ensures (inv(e) ==> canRecognizeFrozen(e, repository, frozenMember) ==> alwaysFlagNotice(recognizeFrozen(e, repository, frozenMember)))
  ensures (inv(e) ==> canRecognizeFrozen(e, repository, frozenMember) ==> alwaysBanNotice(recognizeFrozen(e, repository, frozenMember)))
  ensures (inv(e) ==> canRecognizeFrozen(e, repository, frozenMember) ==> alwaysFrozenOriginalOnly(recognizeFrozen(e, repository, frozenMember)))
  ensures (inv(e) ==> canRecognizeFrozen(e, repository, frozenMember) ==> alwaysRestrictionsBlockWork(recognizeFrozen(e, repository, frozenMember)))
  ensures (inv(e) ==> canRecognizeFrozen(e, repository, frozenMember) ==> stepRetainsExemptionHistory(e, recognizeFrozen(e, repository, frozenMember)))
{
  if inv(e) && canRecognizeFrozen(e, repository, frozenMember) {
    SingletonUnionMembers(e.frozenExemptions, repository);
    SingletonFilterBridge(e.frozenExemptions, repository);
    var after := recognizeFrozen(e, repository, frozenMember);
    assert forall id :: id in after.frozenExemptions ==> id in e.frozenExemptions || id == repository;
    assert forall id :: id in after.frozenExemptions ==> id in e.original;
  }
}
