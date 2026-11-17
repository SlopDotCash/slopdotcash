// spec/slopbot/review.md, "Each item carries one Slopbot review comment, found again only through the App's own actor, and echoed text is neutralized"

lemma neutralize_ensures(text: string)
  ensures (|neutralize(text)| <= echoLimit)
  ensures isNeutral(neutralize(text))
{
  var t := boundedSource(text);
  NeutralizedFromFacts(t, 0);
  var n := neutralizedFrom(t, 0);
  var out := cut(n);
  assert neutralize(text) == out;
  forall k: int | 0 <= k < |out|
    ensures !unsafeAt(out, k)
  {
    if |n| > echoLimit {
      assert out == n[0..echoLimit];
      PrefixUnsafe(n, echoLimit, k);
    }
  }
  NeutralFromAll(out, 0);
}

lemma NeutralFromAll(s: string, i: int)
  requires 0 <= i <= |s|
  ensures neutralFrom(s, i) <==> (forall k: int :: i <= k < |s| ==> !unsafeAt(s, k))
  decreases |s| - i
{
  if i < |s| {
    NeutralFromAll(s, i + 1);
  }
}

lemma PrefixUnsafe(s: string, m: int, k: int)
  requires 0 <= k < m <= |s|
  ensures !unsafeAt(s, k) ==> !unsafeAt(s[0..m], k)
{
  var p := s[0..m];
  assert |p| == m;
  assert forall d: int :: 0 <= d < m ==> p[d] == s[d];
}

lemma ShiftUnsafe(p: string, r: string, j: int)
  requires 0 <= j < |r|
  ensures unsafeAt(p + r, |p| + j) == unsafeAt(r, j)
{
  var s := p + r;
  assert |s| == |p| + |r|;
  assert forall d: int :: 0 <= d < |r| ==> s[|p| + d] == r[d];
}

lemma ZeroWidthSpaceIs()
  ensures |zeroWidthSpace| == 1
  ensures (zeroWidthSpace[0] as int) == 8203
{
}

lemma PieceFacts(t: string, i: int)
  requires 0 <= i < |t|
  ensures (t[i] as int) == 64 ==> |piece(t, i)| == 2 && (piece(t, i)[0] as int) == 64 && (piece(t, i)[1] as int) == 8203
  ensures (t[i] as int) == 60 ==> |piece(t, i)| == 4 && (piece(t, i)[0] as int) == 38 && (piece(t, i)[1] as int) == 108 && (piece(t, i)[2] as int) == 116 && (piece(t, i)[3] as int) == 59
  ensures (t[i] as int) == 93 && i + 1 < |t| && ((t[i + 1] as int) == 40 || (t[i + 1] as int) == 58) ==> |piece(t, i)| == 2 && (piece(t, i)[0] as int) == 93 && (piece(t, i)[1] as int) == 32
  ensures (t[i] as int) == 58 && i + 2 < |t| && (t[i + 1] as int) == 47 && (t[i + 2] as int) == 47 ==> |piece(t, i)| == 2 && (piece(t, i)[0] as int) == 58 && (piece(t, i)[1] as int) == 8203
  ensures (t[i] as int) != 64 && (t[i] as int) != 60
    && !((t[i] as int) == 93 && i + 1 < |t| && ((t[i + 1] as int) == 40 || (t[i + 1] as int) == 58))
    && !((t[i] as int) == 58 && i + 2 < |t| && (t[i + 1] as int) == 47 && (t[i + 2] as int) == 47)
    ==> |piece(t, i)| == 1 && (piece(t, i)[0] as int) == (t[i] as int)
{
  ZeroWidthSpaceIs();
  var c := t[i] as int;
  if c == 64 {
    assert piece(t, i) == "@" + zeroWidthSpace;
    assert ("@"[0] as int) == 64;
  } else if c == 60 {
    assert piece(t, i) == "&lt;";
    assert ("&lt;"[0] as int) == 38;
    assert ("&lt;"[1] as int) == 108;
    assert ("&lt;"[2] as int) == 116;
    assert ("&lt;"[3] as int) == 59;
  } else if c == 93 && i + 1 < |t| && ((t[i + 1] as int) == 40 || (t[i + 1] as int) == 58) {
    assert piece(t, i) == "] ";
    assert ("] "[0] as int) == 93;
    assert ("] "[1] as int) == 32;
  } else if c == 58 && i + 2 < |t| && (t[i + 1] as int) == 47 && (t[i + 2] as int) == 47 {
    assert piece(t, i) == ":" + zeroWidthSpace;
    assert (":"[0] as int) == 58;
  } else {
    assert piece(t, i) == t[i..(i + 1)];
  }
}

lemma NeutralizedFromFacts(t: string, i: int)
  requires 0 <= i <= |t|
  ensures i == |t| ==> |neutralizedFrom(t, i)| == 0
  ensures i < |t| ==> |neutralizedFrom(t, i)| > 0
  ensures i < |t| && (t[i] as int) == 60 ==> (neutralizedFrom(t, i)[0] as int) == 38
  ensures i < |t| && (t[i] as int) != 60 ==> (neutralizedFrom(t, i)[0] as int) == (t[i] as int)
  ensures i < |t| && (t[i] as int) == 47 ==> (|neutralizedFrom(t, i)| >= 2 <==> i + 1 < |t|)
  ensures i + 1 < |t| && (t[i] as int) == 47 && (t[i + 1] as int) == 60 ==> (neutralizedFrom(t, i)[1] as int) == 38
  ensures i + 1 < |t| && (t[i] as int) == 47 && (t[i + 1] as int) != 60 ==> (neutralizedFrom(t, i)[1] as int) == (t[i + 1] as int)
  ensures forall k: int :: 0 <= k < |neutralizedFrom(t, i)| ==> !unsafeAt(neutralizedFrom(t, i), k)
  decreases |t| - i
{
  if i < |t| {
    NeutralizedFromFacts(t, i + 1);
    PieceFacts(t, i);
    ZeroWidthSpaceIs();
    var p := piece(t, i);
    var r := neutralizedFrom(t, i + 1);
    var n := neutralizedFrom(t, i);
    assert n == p + r;
    assert |n| == |p| + |r|;
    var c := t[i] as int;
    forall k: int | 0 <= k < |n|
      ensures !unsafeAt(n, k)
    {
      if k >= |p| {
        ShiftUnsafe(p, r, k - |p|);
      } else {
        assert n[k] == p[k];
        if k + 1 < |p| {
          assert n[k + 1] == p[k + 1];
        }
        if |p| == 1 {
          assert k == 0;
          if c == 93 && |n| > 1 {
            assert i + 1 < |t|;
            assert n[1] == r[0];
            assert (t[i + 1] as int) != 40 && (t[i + 1] as int) != 58;
          }
          if c == 58 && |n| > 2 && (n[1] as int) == 47 {
            assert n[1] == r[0];
            assert i + 1 < |t|;
            assert (t[i + 1] as int) == 47;
            assert |r| >= 2;
            assert i + 2 < |t|;
            assert n[2] == r[1];
            assert (t[i + 2] as int) != 47;
          }
        }
      }
    }
  }
}
