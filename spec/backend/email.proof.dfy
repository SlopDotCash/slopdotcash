// Closure marks every unconsumed verification cancelled, so none is pending.
lemma lawClosureWithdrawsEverything_ensures(e: Enrollment, now: int)
  ensures (lawClosureWithdrawsEverything(e, now) == true)
{
  var after := closeEnrollment(e);
  assert |after.verifications| == |e.verifications|;
  forall v | v in after.verifications
    ensures !pending(v, now)
  {
    var i :| 0 <= i < |after.verifications| && after.verifications[i] == v;
    assert v == (if !(e.verifications[i].consumed) then e.verifications[i].(cancelled := true) else e.verifications[i]);
  }
}
