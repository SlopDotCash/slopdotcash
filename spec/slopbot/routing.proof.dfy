// Proofs for the author slots: time passing and a merge observation keep the slots, so only
// the occupancy filter needs help.
lemma SameSlotsKeepPendingCloses(a: AuthorSlots, b: AuthorSlots)
  requires b.slots == a.slots
  ensures stepPendingCloseNeverExpires(a, b)
{
  forall s | s in a.slots && s.close.ClosePending?
    ensures exists o :: o in b.slots && o.key == s.key && !o.close.NoClose?
  {
    assert s in b.slots;
  }
}

lemma elapse_ensures(a: AuthorSlots, seconds: int)
  ensures (inv(a) ==> canElapse(a, seconds) ==> alwaysLimitedClaimsWithinCap(elapse(a, seconds)))
  ensures (inv(a) ==> canElapse(a, seconds) ==> alwaysSlotsWellFormed(elapse(a, seconds)))
  ensures (inv(a) ==> canElapse(a, seconds) ==> stepPendingCloseNeverExpires(a, elapse(a, seconds)))
{
  if inv(a) && canElapse(a, seconds) {
    var b := elapse(a, seconds);
    ProofLib.FilterImpLength((s: Slot) => (s.limited && occupies(s, b.now)), (s: Slot) => (s.limited && occupies(s, a.now)), a.slots);
    SameSlotsKeepPendingCloses(a, b);
  }
}

lemma observeMerges_ensures(a: AuthorSlots, history: MergeHistory)
  ensures (inv(a) ==> canObserveMerges(a, history) ==> alwaysLimitedClaimsWithinCap(observeMerges(a, history)))
  ensures (inv(a) ==> canObserveMerges(a, history) ==> alwaysSlotsWellFormed(observeMerges(a, history)))
  ensures (inv(a) ==> canObserveMerges(a, history) ==> stepPendingCloseNeverExpires(a, observeMerges(a, history)))
{
  if inv(a) && canObserveMerges(a, history) {
    SameSlotsKeepPendingCloses(a, observeMerges(a, history));
  }
}
