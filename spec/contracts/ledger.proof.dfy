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

// The monthly window laws. A month start is the number of days from the civil
// epoch to the first of that month, counted from 1 March of a shifted year, so
// it grows with every following month, including across a year boundary.

// For a nonnegative numerator the generated quotient is Dafny's division.
lemma QuotientNonnegative(a: int, b: int)
  requires a >= 0 && b > 0
  ensures quotient_contracts__ledger(a, b) == a / b && remainder_contracts__ledger(a, b) == a % b
{
}

// A period whose year is positive is itself nonnegative.
lemma PeriodNonnegative(period: int)
  requires quotient_contracts__ledger(period, 100) >= 1
  ensures period >= 0
{
  if period < 0 {
    assert MathAbs(period) == -period;
  }
}

// The month start, written over the shifted year and the month counted from March.
lemma MonthStartOf(period: int)
  requires period >= 0 && period / 100 >= 1 && 1 <= period % 100 <= 12
  ensures var y := if period % 100 <= 2 then period / 100 - 1 else period / 100;
    var k := if period % 100 > 2 then period % 100 - 3 else period % 100 + 9;
    monthStart(period) == 86400 * ((y / 400) * 146097 + (y % 400) * 365 + (y % 400) / 4 - (y % 400) / 100 + (153 * k + 2) / 5 - 719468)
{
  QuotientNonnegative(period, 100);
  var y := if period % 100 <= 2 then period / 100 - 1 else period / 100;
  var k := if period % 100 > 2 then period % 100 - 3 else period % 100 + 9;
  QuotientNonnegative(y, 400);
  assert y - (y / 400) * 400 == y % 400;
  QuotientNonnegative(y % 400, 4);
  QuotientNonnegative(y % 400, 100);
  QuotientNonnegative(153 * k + 2, 5);
}

// Each shifted year adds at least 365 days: a year divisible by 100 is also
// divisible by 4, and the 400-year era boundary adds the remaining days.
lemma YearAddsDays(y: int)
  requires y >= 1
  ensures (y / 400) * 146097 + (y % 400) * 365 + (y % 400) / 4 - (y % 400) / 100
    >= ((y - 1) / 400) * 146097 + ((y - 1) % 400) * 365 + ((y - 1) % 400) / 4 - ((y - 1) % 400) / 100 + 365
{
  if y % 400 == 0 {
    assert (y - 1) / 400 == y / 400 - 1;
    assert (y - 1) % 400 == 399;
  } else {
    var r := y % 400;
    assert (y - 1) / 400 == y / 400;
    assert (y - 1) % 400 == r - 1;
    if r % 100 == 0 {
      assert r % 4 == 0;
      assert (r - 1) / 4 == r / 4 - 1;
      assert (r - 1) / 100 == r / 100 - 1;
    } else {
      assert (r - 1) / 100 == r / 100;
      assert (r - 1) / 4 <= r / 4;
    }
  }
}

// The next period has a positive year and a month from 1 to 12 again.
lemma NextPeriodShape(period: int)
  requires period >= 0 && period / 100 >= 1 && 1 <= period % 100 <= 12
  ensures nextPeriod(period) >= 0 && nextPeriod(period) / 100 >= 1 && 1 <= nextPeriod(period) % 100 <= 12
  ensures period % 100 == 12 ==> nextPeriod(period) / 100 == period / 100 + 1 && nextPeriod(period) % 100 == 1
  ensures period % 100 < 12 ==> nextPeriod(period) / 100 == period / 100 && nextPeriod(period) % 100 == period % 100 + 1
{
  QuotientNonnegative(period, 100);
}

// Each month starts after the one before it.
lemma MonthStartGrows(period: int)
  requires period >= 0 && period / 100 >= 1 && 1 <= period % 100 <= 12
  ensures monthStart(period) < monthStart(nextPeriod(period))
{
  NextPeriodShape(period);
  MonthStartOf(period);
  MonthStartOf(nextPeriod(period));
  if period % 100 == 2 {
    YearAddsDays(period / 100);
  }
}

lemma lawWindowNonEmpty_ensures(period: int)
  ensures (lawWindowNonEmpty(period) == true)
{
  if validPeriod(period) {
    PeriodNonnegative(period);
    QuotientNonnegative(period, 100);
    NextPeriodShape(period);
    MonthStartGrows(nextPeriod(period));
  }
}

lemma lawNextWindowFollows_ensures(period: int)
  ensures (lawNextWindowFollows(period) == true)
{
}
