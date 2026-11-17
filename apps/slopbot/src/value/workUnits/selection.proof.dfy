// spec/slopbot/workUnits.md, "A claim is one changed path in one commit and belongs to its first accepted carrier"
lemma stringsContain_ensures(values: seq<string>, target: string, count: int)
  requires (0 <= count)
  requires (count <= |values|)
  ensures (stringsContain(values, target, count) <==> exists k: int :: ((0 <= k) && (k < count) && (values[k] == target)))
  decreases count
{
  if count > 0 {
    stringsContain_ensures(values, target, count - 1);
    if values[count - 1] == target {
      assert (0 <= count - 1) && (count - 1 < count) && (values[count - 1] == target);
    } else {
      forall k: int | 0 <= k < count && values[k] == target
        ensures k < count - 1
      {
      }
    }
  }
}
