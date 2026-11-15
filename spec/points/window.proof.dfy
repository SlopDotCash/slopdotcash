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
