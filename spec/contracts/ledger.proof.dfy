// Paying the one award with a source changes only that position of the list,
// so each running total moves by what that one award contributes.

lemma SumFoldShift<T>(f: (int, T) -> int, w: T -> int, init: int, xs: seq<T>)
  requires forall t, a :: f(t, a) == t + w(a)
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) == init + Std.Collections.Seq.FoldLeft(f, 0, xs)
  decreases |xs|
{
  if |xs| > 0 {
    SumFoldShift(f, w, f(init, xs[0]), xs[1..]);
    SumFoldShift(f, w, f(0, xs[0]), xs[1..]);
  }
}

lemma SumFoldChangeOne<T>(f: (int, T) -> int, w: T -> int, init: int, xs: seq<T>, ys: seq<T>, i: int)
  requires forall t, a :: f(t, a) == t + w(a)
  requires |xs| == |ys| && 0 <= i < |xs|
  requires forall j :: 0 <= j < |xs| && j != i ==> xs[j] == ys[j]
  ensures Std.Collections.Seq.FoldLeft(f, init, ys) == Std.Collections.Seq.FoldLeft(f, init, xs) + w(ys[i]) - w(xs[i])
  decreases |xs|
{
  if i == 0 {
    assert xs[1..] == ys[1..];
    SumFoldShift(f, w, f(init, xs[0]), xs[1..]);
    SumFoldShift(f, w, f(init, ys[0]), ys[1..]);
  } else {
    assert xs[0] == ys[0];
    forall j | 0 <= j < |xs[1..]| && j != i - 1
      ensures xs[1..][j] == ys[1..][j]
    {
      assert xs[j + 1] == ys[j + 1];
    }
    SumFoldChangeOne(f, w, f(init, xs[0]), xs[1..], ys[1..], i - 1);
  }
}

lemma LastMatchNone<T>(f: (T, T) -> T, p: T -> bool, init: T, xs: seq<T>)
  requires forall found, a :: f(found, a) == (if p(a) then a else found)
  requires forall j :: 0 <= j < |xs| ==> !p(xs[j])
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) == init
  decreases |xs|
{
  if |xs| > 0 {
    LastMatchNone(f, p, init, xs[1..]);
  }
}

lemma LastMatch<T>(f: (T, T) -> T, p: T -> bool, init: T, xs: seq<T>, i: int)
  requires forall found, a :: f(found, a) == (if p(a) then a else found)
  requires 0 <= i < |xs| && p(xs[i])
  requires forall j :: i < j < |xs| ==> !p(xs[j])
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) == xs[i]
  decreases |xs|
{
  if i == 0 {
    LastMatchNone(f, p, xs[0], xs[1..]);
  } else {
    LastMatch(f, p, f(init, xs[0]), xs[1..], i - 1);
  }
}

lemma UniqueSourcesFilter(awards: seq<Award>)
  ensures uniqueSources(awards) == !((exists a :: a in awards && !((|ProofLib.Filter((b: Award) => (b.source == a.source), awards)| == 1))))
{
}

lemma OnlyIndex(awards: seq<Award>, source: int) returns (i: int)
  requires uniqueSources(awards) && hasSource(awards, source)
  ensures 0 <= i < |awards| && awards[i].source == source
  ensures forall j :: 0 <= j < |awards| && j != i ==> awards[j].source != source
{
  UniqueSourcesFilter(awards);
  var a :| a in awards && a.source == source;
  i :| 0 <= i < |awards| && awards[i] == a;
  assert |ProofLib.Filter((b: Award) => (b.source == a.source), awards)| == 1;
  forall j | 0 <= j < |awards| && j != i
    ensures awards[j].source != source
  {
    if awards[j].source == source {
      ProofLib.FilterTwo((b: Award) => (b.source == a.source), awards, i, j);
    }
  }
}

lemma MarkPaidKeepsUnique(awards: seq<Award>, source: int, recipient: string, version: int)
  requires uniqueSources(awards)
  ensures uniqueSources(markPaid(awards, source, recipient, version))
{
  var after := markPaid(awards, source, recipient, version);
  UniqueSourcesFilter(awards);
  UniqueSourcesFilter(after);
  forall a | a in after
    ensures |ProofLib.Filter((b: Award) => (b.source == a.source), after)| == 1
  {
    var k :| 0 <= k < |after| && after[k] == a;
    var orig := awards[k];
    assert orig in awards;
    assert |ProofLib.Filter((b: Award) => (b.source == orig.source), awards)| == 1;
    ProofLib.FilterLengthPointwise((b: Award) => (b.source == a.source), (b: Award) => (b.source == orig.source), after, awards);
  }
}

lemma lawPayMovesOneAward_ensures(awards: seq<Award>, source: int, recipient: string, version: int)
  ensures (lawPayMovesOneAward(awards, source, recipient, version) == true)
{
  var chosen := awardFor(awards, source);
  var after := markPaid(awards, source, recipient, version);
  if uniqueSources(awards) && hasSource(awards, source) && !chosen.paid {
    var i := OnlyIndex(awards, source);
    LastMatch((found: Award, a: Award) => (if (a.source == source) then a else found), (a: Award) => a.source == source, noAward, awards, i);
    assert chosen == awards[i];
    assert after[i] == chosen.(paid := true, paidTo := recipient, paidVersion := version);
    forall j | 0 <= j < |awards| && j != i
      ensures awards[j] == after[j]
    {
    }
    SumFoldChangeOne((t: int, a: Award) => (if a.paid then t else ((t + a.gross) - a.fee)), (a: Award) => (if a.paid then 0 else a.gross - a.fee), 0, awards, after, i);
    SumFoldChangeOne((t: int, a: Award) => (if a.paid then t else (t + a.fee)), (a: Award) => (if a.paid then 0 else a.fee), 0, awards, after, i);
    SumFoldChangeOne((t: int, a: Award) => (if a.paid then ((t + a.gross) - a.fee) else t), (a: Award) => (if a.paid then a.gross - a.fee else 0), 0, awards, after, i);
    SumFoldChangeOne((t: int, a: Award) => (if a.paid then (t + a.fee) else t), (a: Award) => (if a.paid then a.fee else 0), 0, awards, after, i);
    MarkPaidKeepsUnique(awards, source, recipient, version);
  }
}
