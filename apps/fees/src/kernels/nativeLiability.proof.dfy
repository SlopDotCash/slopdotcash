// Each fold is proved by induction on how many entries it has read: the step adds a nonnegative amount, or keeps the
// larger of the previous maximum and the entry's own.

lemma settledThrough_ensures(entries: seq<NativeLiabilityEntry>, day: string, count: int)
  requires (0 <= count)
  requires (count <= |entries|)
  requires forall i: int :: ((0 <= i) ==> (i < |entries|) ==> entries[i].actual? ==> (entries[i].amount >= 0))
  ensures (settledThrough(entries, day, count) >= 0)
{
  if count > 0 {
    settledThrough_ensures(entries, day, count - 1);
    assert entries[count - 1].actual? ==> entries[count - 1].amount >= 0;
  }
}

lemma pendingMaximum_ensures(entries: seq<NativeLiabilityEntry>, bucket: int, count: int)
  requires (0 <= count)
  requires (count <= |entries|)
  ensures (pendingMaximum(entries, bucket, count) >= 0)
  ensures forall j: int :: ((0 <= j) ==> (j < count) ==> entries[j].unsettled? ==> (entries[j].bucket == bucket) ==> (entries[j].maximum <= pendingMaximum(entries, bucket, count)))
{
  if count > 0 {
    pendingMaximum_ensures(entries, bucket, count - 1);
    var before := pendingMaximum(entries, bucket, count - 1);
    var after := pendingMaximum(entries, bucket, count);
    assert after >= before;
    forall j: int | 0 <= j < count && entries[j].unsettled? && entries[j].bucket == bucket
      ensures entries[j].maximum <= after
    {
      if j < count - 1 {
        assert entries[j].maximum <= before;
      }
    }
  }
}

lemma pendingTotal_ensures(entries: seq<NativeLiabilityEntry>, buckets: int)
  requires (0 <= buckets)
  ensures (pendingTotal(entries, buckets) >= 0)
{
  if buckets > 0 {
    pendingTotal_ensures(entries, buckets - 1);
    pendingMaximum_ensures(entries, buckets - 1, |entries|);
  }
}
