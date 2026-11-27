// spec/contributor/rendering.md, "Substitution is one pass over the four published placeholders and any other SLOP placeholder refuses"
lemma backtickRunEndingAt_ensures(value: string, end: int)
  requires (0 <= end)
  requires (end <= |value|)
  ensures (backtickRunEndingAt(value, end) >= 0)
{
  if end > 0 {
    backtickRunEndingAt_ensures(value, end - 1);
  }
}

lemma longestBacktickRun_ensures(value: string, end: int)
  requires (0 <= end)
  requires (end <= |value|)
  ensures (longestBacktickRun(value, end) >= 0)
  ensures ((longestBacktickRun(value, end) == 0) <==> forall j: int :: ((0 <= j) ==> (j < end) ==> ((value[j] as int) != 96)))
{
  if end > 0 {
    var k := end - 1;
    longestBacktickRun_ensures(value, k);
    backtickRunEndingAt_ensures(value, k);
    backtickRunEndingAt_ensures(value, end);
    assert (backtickRunEndingAt(value, end) == 0) <==> ((value[k] as int) != 96);
    assert (forall j: int :: ((0 <= j) ==> (j < end) ==> ((value[j] as int) != 96)))
      <==> ((forall j: int :: ((0 <= j) ==> (j < k) ==> ((value[j] as int) != 96))) && ((value[k] as int) != 96));
  }
}
