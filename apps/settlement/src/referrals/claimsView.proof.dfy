lemma ageSeconds_ensures(nowMillis: int, thenMillis: int)
  ensures (ageSeconds(nowMillis, thenMillis) >= 0)
  ensures (((nowMillis - thenMillis) <= 0) ==> (ageSeconds(nowMillis, thenMillis) == 0))
  ensures (((nowMillis - thenMillis) > 0) ==> (((ageSeconds(nowMillis, thenMillis) * 1000) >= (nowMillis - thenMillis)) && (((ageSeconds(nowMillis, thenMillis) - 1) * 1000) < (nowMillis - thenMillis))))
{
  var elapsed := nowMillis - thenMillis;
  if elapsed > 0 {
    assert JSTruncDiv((elapsed + 999), 1000) == (elapsed + 999) / 1000;
    assert elapsed + 999 == ((elapsed + 999) / 1000) * 1000 + (elapsed + 999) % 1000;
  }
}
