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

lemma WellFormedDistinct(a: AuthorSlots)
  requires alwaysSlotsWellFormed(a)
  ensures a.now > 0
  ensures ProofLib.DistinctBy(a.slots, (x: Slot) => x.key)
  ensures forall i :: 0 <= i < |a.slots| ==>
    a.slots[i].key > 0
    && (a.slots[i].status.SlotRunning? ==> a.slots[i].leaseUntil > 0)
    && (!a.slots[i].status.SlotRunning? ==> a.slots[i].leaseUntil == 0)
    && (a.slots[i].status.SlotCompleted? ==> a.slots[i].completedAt > 0)
    && (a.slots[i].close.CloseConfirmed? ==> a.slots[i].closedAt > 0)
{
  forall i, j | 0 <= i < |a.slots| && 0 <= j < |a.slots| && i != j
    ensures a.slots[i].key != a.slots[j].key
  {
    var s := a.slots[i];
    assert s in a.slots;
    ProofLib.FilterCountOneIffUnique((o: Slot) => (o.key == s.key), a.slots, (x: Slot) => x.key, i);
  }
}

lemma WellFormedFilter(a: AuthorSlots)
  ensures alwaysSlotsWellFormed(a) == (a.now > 0 && !((exists s :: s in a.slots && !(((((((s.key > 0) && (|ProofLib.Filter((o: Slot) => (o.key == s.key), a.slots)| == 1)) && (!(s.status.SlotRunning?) || (s.leaseUntil > 0))) && (!((!s.status.SlotRunning?)) || (s.leaseUntil == 0))) && (!(s.status.SlotCompleted?) || (s.completedAt > 0))) && (!(s.close.CloseConfirmed?) || (s.closedAt > 0)))))))
{
}

lemma DistinctImpliesWellFormed(a: AuthorSlots)
  requires a.now > 0
  requires ProofLib.DistinctBy(a.slots, (x: Slot) => x.key)
  requires forall i :: 0 <= i < |a.slots| ==>
    a.slots[i].key > 0
    && (a.slots[i].status.SlotRunning? ==> a.slots[i].leaseUntil > 0)
    && (!a.slots[i].status.SlotRunning? ==> a.slots[i].leaseUntil == 0)
    && (a.slots[i].status.SlotCompleted? ==> a.slots[i].completedAt > 0)
    && (a.slots[i].close.CloseConfirmed? ==> a.slots[i].closedAt > 0)
  ensures alwaysSlotsWellFormed(a)
{
  WellFormedFilter(a);
  forall s | s in a.slots
    ensures s.key > 0
      && |ProofLib.Filter((o: Slot) => (o.key == s.key), a.slots)| == 1
      && (s.status.SlotRunning? ==> s.leaseUntil > 0)
      && (!s.status.SlotRunning? ==> s.leaseUntil == 0)
      && (s.status.SlotCompleted? ==> s.completedAt > 0)
      && (s.close.CloseConfirmed? ==> s.closedAt > 0)
  {
    var i :| 0 <= i < |a.slots| && a.slots[i] == s;
    assert forall j :: 0 <= j < |a.slots| && j != i ==> a.slots[j].key != s.key;
    ProofLib.FilterOne((o: Slot) => (o.key == s.key), a.slots, i);
  }
}

lemma SlotOfFacts(a: AuthorSlots, key: int)
  requires alwaysSlotsWellFormed(a)
  ensures slotOf(a, key).key == 0 ==> (slotOf(a, key) == noSlot && forall i :: 0 <= i < |a.slots| ==> a.slots[i].key != key)
  ensures slotOf(a, key).key != 0 ==> (exists i :: 0 <= i < |a.slots| && a.slots[i] == slotOf(a, key) && a.slots[i].key == key && (forall j :: 0 <= j < |a.slots| && j != i ==> a.slots[j].key != key))
{
  WellFormedDistinct(a);
  var p := (s: Slot) => (s.key == key);
  var fs := ProofLib.Filter(p, a.slots);
  if |fs| == 0 {
    ProofLib.FilterNone(p, a.slots);
  } else {
    ProofLib.FilterMember(p, a.slots, fs[0]);
    var i :| 0 <= i < |a.slots| && a.slots[i] == fs[0];
    assert a.slots[i].key == key;
    assert a.slots[i].key > 0;
  }
}

lemma FilterPointwiseLeq<T>(p: T -> bool, q: T -> bool, xs: seq<T>, ys: seq<T>)
  requires |xs| == |ys|
  requires forall i :: 0 <= i < |xs| ==> (p(ys[i]) ==> q(xs[i]))
  ensures |ProofLib.Filter(p, ys)| <= |ProofLib.Filter(q, xs)|
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(p, ys);
    ProofLib.FilterNil(q, xs);
  } else {
    ProofLib.FilterCons(p, ys);
    ProofLib.FilterCons(q, xs);
    assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1] && ys[1..][i] == ys[i + 1];
    FilterPointwiseLeq(p, q, xs[1..], ys[1..]);
  }
}

lemma FilterPointwiseExceptOne<T>(p: T -> bool, q: T -> bool, xs: seq<T>, ys: seq<T>, idx: int)
  requires |xs| == |ys|
  requires 0 <= idx < |xs|
  requires forall i :: 0 <= i < |xs| && i != idx ==> (p(ys[i]) ==> q(xs[i]))
  ensures |ProofLib.Filter(p, ys)| <= |ProofLib.Filter(q, xs)| + 1
  decreases |xs|
{
  ProofLib.FilterCons(p, ys);
  ProofLib.FilterCons(q, xs);
  assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1] && ys[1..][i] == ys[i + 1];
  if idx == 0 {
    FilterPointwiseLeq(p, q, xs[1..], ys[1..]);
  } else {
    FilterPointwiseExceptOne(p, q, xs[1..], ys[1..], idx - 1);
  }
}

lemma PutSlotReplacePreserves(a: AuthorSlots, s: Slot, idx: int)
  requires alwaysSlotsWellFormed(a)
  requires 0 <= idx < |a.slots| && a.slots[idx] == slotOf(a, s.key) && a.slots[idx].key == s.key
  requires forall j :: 0 <= j < |a.slots| && j != idx ==> a.slots[j].key != s.key
  requires s.key > 0
  requires s.status.SlotRunning? ==> s.leaseUntil > 0
  requires !s.status.SlotRunning? ==> s.leaseUntil == 0
  requires s.status.SlotCompleted? ==> s.completedAt > 0
  requires s.close.CloseConfirmed? ==> s.closedAt > 0
  requires a.slots[idx].close.ClosePending? ==> !s.close.NoClose?
  ensures var b := putSlot(s, a);
    |b.slots| == |a.slots|
    && b.slots[idx] == s
    && (forall j :: 0 <= j < |a.slots| && j != idx ==> b.slots[j] == a.slots[j])
    && alwaysSlotsWellFormed(b)
    && stepPendingCloseNeverExpires(a, b)
{
  WellFormedDistinct(a);
  var b := putSlot(s, a);
  assert |b.slots| == |a.slots|;
  assert b.slots[idx] == s;
  assert forall j :: 0 <= j < |a.slots| && j != idx ==> b.slots[j] == a.slots[j];
  DistinctImpliesWellFormed(b);
  forall prev | prev in a.slots && prev.close.ClosePending?
    ensures exists o :: o in b.slots && o.key == prev.key && !o.close.NoClose?
  {
    var j :| 0 <= j < |a.slots| && a.slots[j] == prev;
    assert b.slots[j] in b.slots;
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

lemma start_ensures(a: AuthorSlots, key: int, leaseUntil: int, reviewing: bool)
  ensures (inv(a) ==> canStart(a, key, leaseUntil, reviewing) ==> alwaysLimitedClaimsWithinCap(start(a, key, leaseUntil, reviewing)))
  ensures (inv(a) ==> canStart(a, key, leaseUntil, reviewing) ==> alwaysSlotsWellFormed(start(a, key, leaseUntil, reviewing)))
  ensures (inv(a) ==> canStart(a, key, leaseUntil, reviewing) ==> stepPendingCloseNeverExpires(a, start(a, key, leaseUntil, reviewing)))
{
  if inv(a) && canStart(a, key, leaseUntil, reviewing) {
    WellFormedDistinct(a);
    SlotOfFacts(a, key);
    var prior := slotOf(a, key);
    var ns := prior.(key := key, status := SlotStatus.SlotRunning, leaseUntil := leaseUntil, completedAt := 0, limited := (reviewing && !(a.established)));
    var after := start(a, key, leaseUntil, reviewing);
    var pLim := (s: Slot) => (s.limited && occupies(s, after.now));
    var qLim := (s: Slot) => (s.limited && occupies(s, a.now));
    var qOth := (s: Slot) => ((s.key != key) && occupies(s, a.now));
    if prior.key == 0 {
      assert after.slots == a.slots + [ns];
      DistinctImpliesWellFormed(after);
      forall prev | prev in a.slots && prev.close.ClosePending?
        ensures exists o :: o in after.slots && o.key == prev.key && !o.close.NoClose?
      {
        assert prev in after.slots;
      }
      ProofLib.FilterAppend(pLim, a.slots, ns);
      if ns.limited {
        ProofLib.FilterImpLength(pLim, qOth, a.slots);
      } else {
        ProofLib.FilterSamePredicate(pLim, qLim, a.slots);
      }
    } else {
      var idx :| 0 <= idx < |a.slots| && a.slots[idx] == prior && a.slots[idx].key == key && forall j :: 0 <= j < |a.slots| && j != idx ==> a.slots[j].key != key;
      PutSlotReplacePreserves(a, ns, idx);
      if ns.limited {
        FilterPointwiseExceptOne(pLim, qOth, a.slots, after.slots, idx);
      } else {
        FilterPointwiseLeq(pLim, qLim, a.slots, after.slots);
      }
    }
  }
}

lemma finish_ensures(a: AuthorSlots, key: int, status: SlotStatus)
  ensures (inv(a) ==> canFinish(a, key, status) ==> alwaysLimitedClaimsWithinCap(finish(a, key, status)))
  ensures (inv(a) ==> canFinish(a, key, status) ==> alwaysSlotsWellFormed(finish(a, key, status)))
  ensures (inv(a) ==> canFinish(a, key, status) ==> stepPendingCloseNeverExpires(a, finish(a, key, status)))
{
  if inv(a) && canFinish(a, key, status) {
    WellFormedDistinct(a);
    SlotOfFacts(a, key);
    var prior := slotOf(a, key);
    assert prior != noSlot;
    var idx :| 0 <= idx < |a.slots| && a.slots[idx] == prior && a.slots[idx].key == key && forall j :: 0 <= j < |a.slots| && j != idx ==> a.slots[j].key != key;
    var ns := prior.(status := status, leaseUntil := 0, completedAt := (if status.SlotCompleted? then a.now else 0));
    var after := finish(a, key, status);
    PutSlotReplacePreserves(a, ns, idx);
    assert occupies(prior, a.now);
    FilterPointwiseLeq((s: Slot) => (s.limited && occupies(s, after.now)), (s: Slot) => (s.limited && occupies(s, a.now)), a.slots, after.slots);
  }
}

lemma reserveClose_ensures(a: AuthorSlots, key: int)
  ensures (inv(a) ==> canReserveClose(a, key) ==> alwaysLimitedClaimsWithinCap(reserveClose(a, key)))
  ensures (inv(a) ==> canReserveClose(a, key) ==> alwaysSlotsWellFormed(reserveClose(a, key)))
  ensures (inv(a) ==> canReserveClose(a, key) ==> stepPendingCloseNeverExpires(a, reserveClose(a, key)))
{
  if inv(a) && canReserveClose(a, key) {
    WellFormedDistinct(a);
    SlotOfFacts(a, key);
    var prior := slotOf(a, key);
    assert prior != noSlot;
    var idx :| 0 <= idx < |a.slots| && a.slots[idx] == prior && a.slots[idx].key == key && forall j :: 0 <= j < |a.slots| && j != idx ==> a.slots[j].key != key;
    var ns := prior.(close := CloseMark.ClosePending);
    var after := reserveClose(a, key);
    PutSlotReplacePreserves(a, ns, idx);
    assert occupies(prior, a.now);
    FilterPointwiseLeq((s: Slot) => (s.limited && occupies(s, after.now)), (s: Slot) => (s.limited && occupies(s, a.now)), a.slots, after.slots);
  }
}

lemma settleClose_ensures(a: AuthorSlots, key: int, confirmed: bool)
  ensures (inv(a) ==> canSettleClose(a, key, confirmed) ==> alwaysLimitedClaimsWithinCap(settleClose(a, key, confirmed)))
  ensures (inv(a) ==> canSettleClose(a, key, confirmed) ==> alwaysSlotsWellFormed(settleClose(a, key, confirmed)))
  ensures (inv(a) ==> canSettleClose(a, key, confirmed) ==> stepPendingCloseNeverExpires(a, settleClose(a, key, confirmed)))
{
  if inv(a) && canSettleClose(a, key, confirmed) {
    WellFormedDistinct(a);
    SlotOfFacts(a, key);
    var prior := slotOf(a, key);
    assert prior != noSlot;
    var idx :| 0 <= idx < |a.slots| && a.slots[idx] == prior && a.slots[idx].key == key && forall j :: 0 <= j < |a.slots| && j != idx ==> a.slots[j].key != key;
    var ns := prior.(close := (if confirmed then CloseMark.CloseConfirmed else CloseMark.CloseRejected), closedAt := (if confirmed then a.now else 0));
    var after := settleClose(a, key, confirmed);
    PutSlotReplacePreserves(a, ns, idx);
    assert occupies(prior, a.now);
    FilterPointwiseLeq((s: Slot) => (s.limited && occupies(s, after.now)), (s: Slot) => (s.limited && occupies(s, a.now)), a.slots, after.slots);
  }
}
