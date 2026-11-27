// A fresh immutable ID keeps one record per ID.
lemma observe_ensures(w: Window, e: LedgerEvent)
  ensures (inv(w) ==> canObserve(w, e) ==> alwaysExactWindow(observe(w, e)))
  ensures (inv(w) ==> canObserve(w, e) ==> alwaysBuildingAhead(observe(w, e)))
  ensures (inv(w) ==> canObserve(w, e) ==> alwaysIdsDistinct(observe(w, e)))
  ensures (inv(w) ==> canObserve(w, e) ==> alwaysBuildingCensusReset(observe(w, e)))
  ensures (inv(w) ==> canObserve(w, e) ==> alwaysPublishedCountExact(observe(w, e)))
  ensures (inv(w) ==> canObserve(w, e) ==> alwaysRecordsInInventory(observe(w, e)))
  ensures (inv(w) ==> canObserve(w, e) ==> stepFailureKeepsPublished(w, observe(w, e)))
  ensures (inv(w) ==> canObserve(w, e) ==> stepWindowNeverRegresses(w, observe(w, e)))
{
  if inv(w) && canObserve(w, e) {
    IdsMeaning(w);
    if !(exists r :: r in w.records && (r.id == e.id)) {
      AppendUniqueRecord(w.records, Recorded(e.id, e.source, e.actor, outcomeOf(w, e)));
    }
    IdsMeaning(observe(w, e));
  }
}

lemma IdsMeaning(w: Window)
  ensures alwaysIdsDistinct(w) == !((exists r :: r in w.records && !(((r.id > 0) && (|ProofLib.Filter((o: Recorded) => (o.id == r.id), w.records)| == 1)))))
{
}

lemma AppendUniqueRecord(xs: seq<Recorded>, n: Recorded)
  requires forall r :: r in xs ==> r.id > 0 && |ProofLib.Filter((o: Recorded) => (o.id == r.id), xs)| == 1
  requires n.id > 0
  requires forall r :: r in xs ==> r.id != n.id
  ensures forall r :: r in xs + [n] ==> r.id > 0 && |ProofLib.Filter((o: Recorded) => (o.id == r.id), xs + [n])| == 1
{
  forall r | r in xs + [n]
    ensures r.id > 0 && |ProofLib.Filter((o: Recorded) => (o.id == r.id), xs + [n])| == 1
  {
    ProofLib.FilterAppend((o: Recorded) => (o.id == r.id), xs, n);
    if r.id == n.id {
      ProofLib.FilterNone((o: Recorded) => (o.id == r.id), xs);
    }
  }
}

lemma CensusItemsMatchTotal(xs: seq<points__census_Census>, accItems: seq<points__census_Item>, accTotal: int)
  requires |accItems| == accTotal && accTotal >= 0
  requires forall c :: c in xs ==> |c.items| == c.totalCount && c.totalCount >= 0
  ensures var items := Std.Collections.Seq.FoldLeft((acc: seq<points__census_Item>, c: points__census_Census) => (acc + c.items), accItems, xs);
    var total := Std.Collections.Seq.FoldLeft((acc: int, c: points__census_Census) => (acc + c.totalCount), accTotal, xs);
    |items| == total && total >= 0
  decreases |xs|
{
  if |xs| > 0 {
    CensusItemsMatchTotal(xs[1..], accItems + xs[0].items, accTotal + xs[0].totalCount);
  }
}

lemma completeCensus_ensures(w: Window, censuses: seq<points__census_Census>)
  ensures (inv(w) ==> canCompleteCensus(w, censuses) ==> alwaysExactWindow(completeCensus(w, censuses)))
  ensures (inv(w) ==> canCompleteCensus(w, censuses) ==> alwaysBuildingAhead(completeCensus(w, censuses)))
  ensures (inv(w) ==> canCompleteCensus(w, censuses) ==> alwaysIdsDistinct(completeCensus(w, censuses)))
  ensures (inv(w) ==> canCompleteCensus(w, censuses) ==> alwaysBuildingCensusReset(completeCensus(w, censuses)))
  ensures (inv(w) ==> canCompleteCensus(w, censuses) ==> alwaysPublishedCountExact(completeCensus(w, censuses)))
  ensures (inv(w) ==> canCompleteCensus(w, censuses) ==> alwaysRecordsInInventory(completeCensus(w, censuses)))
  ensures (inv(w) ==> canCompleteCensus(w, censuses) ==> stepFailureKeepsPublished(w, completeCensus(w, censuses)))
  ensures (inv(w) ==> canCompleteCensus(w, censuses) ==> stepWindowNeverRegresses(w, completeCensus(w, censuses)))
{
  hide *;
  reveal inv, canCompleteCensus, completeCensus, censusVerified, points__census_alwaysCompleteWhenReady, censusItems, censusesTotal, inInventory, alwaysExactWindow, alwaysBuildingAhead, alwaysIdsDistinct, alwaysBuildingCensusReset, alwaysPublishedCountExact, alwaysRecordsInInventory, stepFailureKeepsPublished, stepWindowNeverRegresses;
  if inv(w) && canCompleteCensus(w, censuses) {
    CensusItemsMatchTotal(censuses, [], 0);
  }
}

lemma CountedRecordsMeaning(w: Window)
  ensures countedRecords(w) == |ProofLib.Filter((r: Recorded) => r.outcome.Counted?, w.records)|
{
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  hide *;
  reveal initial, windowDays, initialHolds, inv, alwaysExactWindow, alwaysBuildingAhead, alwaysIdsDistinct, alwaysBuildingCensusReset, alwaysPublishedCountExact, alwaysRecordsInInventory;
  CountedRecordsMeaning(initial);
  ProofLib.FilterNil((r: Recorded) => r.outcome.Counted?, initial.records);
}
