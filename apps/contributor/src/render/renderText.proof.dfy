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
  ensures ((longestBacktickRun(value, end) == 0) <==> forall j: int :: ((0 <= j) ==> (j < end) ==> (value[j..(j + 1)] != "`")))
{
  if end > 0 {
    var k := end - 1;
    longestBacktickRun_ensures(value, k);
    backtickRunEndingAt_ensures(value, k);
    backtickRunEndingAt_ensures(value, end);
    assert value[k..(k + 1)] == value[(end - 1)..end];
    assert (backtickRunEndingAt(value, end) == 0) <==> (value[k..(k + 1)] != "`");
    assert (forall j: int :: ((0 <= j) ==> (j < end) ==> (value[j..(j + 1)] != "`")))
      <==> ((forall j: int :: ((0 <= j) ==> (j < k) ==> (value[j..(j + 1)] != "`"))) && value[k..(k + 1)] != "`");
  }
}
