// Closure marks every unconsumed verification cancelled, so none is pending.
lemma lawClosureWithdrawsEverything_ensures(e: Enrollment, now: int)
  ensures (lawClosureWithdrawsEverything(e, now) == true)
{
  var xs := e.verifications;
  var ys := closeEnrollment(e).verifications;
  assert |ys| == |xs|;
  forall i | 0 <= i < |ys|
    ensures !pending(ys[i], now)
  {
    assert ys[i] == (if !(xs[i].consumed) then xs[i].(cancelled := true) else xs[i]);
  }
  forall v | v in ys
    ensures !pending(v, now)
  {
    var i :| 0 <= i < |ys| && ys[i] == v;
  }
  assert !(exists v :: v in ys && !(!(pending(v, now))));
}
