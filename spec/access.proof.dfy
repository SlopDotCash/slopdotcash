// Reserving appends an award with a fresh ID; paying changes only the paid flag.
lemma reserveAward_ensures(a: Access, by_: int, awardId: int, recipient: int)
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysProjectBansConfirmed(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysBansDecidedOnConfirmedMalice(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysReleasesIndependent(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysAppealsDecidedByModerators(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysAwardsIdentified(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> stepBanRecordsPermanent(a, reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> stepFundedAwardsPreserved(a, reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> stepNewAwardOnlyWhenAllowed(a, reserveAward(a, by_, awardId, recipient)))
{
  if inv(a) && canReserveAward(a, by_, awardId, recipient) {
    var added := Award(awardId, recipient, true, false);
    var xs := a.awards;
    forall w | w in xs + [added]
      ensures |ProofLib.Filter((x: Award) => (x.id == w.id), xs + [added])| == 1
    {
      ProofLib.FilterAppend((x: Award) => (x.id == w.id), xs, added);
      if w.id == awardId {
        ProofLib.FilterNone((x: Award) => (x.id == w.id), xs);
      }
    }
  }
}

lemma payAward_ensures(a: Access, by_: int, awardId: int)
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysProjectBansConfirmed(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysBansDecidedOnConfirmedMalice(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysReleasesIndependent(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysAppealsDecidedByModerators(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysAwardsIdentified(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> stepBanRecordsPermanent(a, payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> stepFundedAwardsPreserved(a, payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> stepNewAwardOnlyWhenAllowed(a, payAward(a, by_, awardId)))
{
  if inv(a) && canPayAward(a, by_, awardId) {
    var xs := a.awards;
    var ys := payAward(a, by_, awardId).awards;
    assert |ys| == |xs|;
    assert forall i :: 0 <= i < |xs| ==> ys[i].id == xs[i].id && ys[i].recipient == xs[i].recipient && ys[i].funded == xs[i].funded && (xs[i].paid ==> ys[i].paid);
    forall w | w in xs
      ensures exists x :: x in ys && x.id == w.id && x.recipient == w.recipient && x.funded && (!(w.paid) || x.paid)
    {
      var i :| 0 <= i < |xs| && xs[i] == w;
      assert ys[i] in ys;
    }
    forall w | w in ys
      ensures w.id > 0 && w.recipient > 0 && w.funded && |ProofLib.Filter((x: Award) => (x.id == w.id), ys)| == 1
    {
      var i :| 0 <= i < |ys| && ys[i] == w;
      assert xs[i] in xs;
      ProofLib.FilterLengthPointwise((x: Award) => (x.id == w.id), (x: Award) => (x.id == w.id), xs, ys);
    }
    forall w | w in ys
      ensures exists x :: x in xs && x.id == w.id
    {
      var i :| 0 <= i < |ys| && ys[i] == w;
      assert xs[i] in xs;
    }
  }
}
