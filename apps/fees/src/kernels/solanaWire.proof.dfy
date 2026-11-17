// The loaded account count adds two nonnegative span lengths per lookup, so it stays nonnegative by induction.

lemma lookupAccounts_ensures(records: seq<WireLookup>, count: int)
  requires (0 <= count)
  requires (count <= |records|)
  requires forall i: int :: ((0 <= i) ==> (i < |records|) ==> ((records[i].writable.start <= records[i].writable.end) && (records[i].readonly.start <= records[i].readonly.end)))
  ensures (lookupAccounts(records, count) >= 0)
{
  if count > 0 {
    lookupAccounts_ensures(records, count - 1);
    assert records[count - 1].writable.start <= records[count - 1].writable.end;
    assert records[count - 1].readonly.start <= records[count - 1].readonly.end;
  }
}
