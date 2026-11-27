lemma CompareFoldAntiSym(a: seq<int>, b: seq<int>, idx: int, cmp: int, xs: seq<int>, ys: seq<int>)
  requires |xs| == |ys|
  ensures Std.Collections.Seq.FoldLeft(
    (acc: settlement__money_CompareFold, ignored: int) => settlement__money_CompareFold((acc.index + 1), (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) == (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then acc.comparison else (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) > (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then 1 else -1))),
    settlement__money_CompareFold(idx, cmp),
    xs
  ).comparison == -Std.Collections.Seq.FoldLeft(
    (acc: settlement__money_CompareFold, ignored: int) => settlement__money_CompareFold((acc.index + 1), (if ((if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0) == (if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0)) then acc.comparison else (if ((if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0) > (if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0)) then 1 else -1))),
    settlement__money_CompareFold(idx, -cmp),
    ys
  ).comparison
  decreases |xs|
{
  if |xs| > 0 {
    var da := if 0 <= idx && idx < |a| then a[idx] else 0;
    var db := if 0 <= idx && idx < |b| then b[idx] else 0;
    var nextCmp := if da == db then cmp else if da > db then 1 else -1;
    CompareFoldAntiSym(a, b, idx + 1, nextCmp, xs[1..], ys[1..]);
  }
}

lemma CompareAmountsAntiSym(a: seq<int>, b: seq<int>)
  ensures settlement__money_compareAmounts(a, b) == -settlement__money_compareAmounts(b, a)
{
  var xs := if |a| >= |b| then a else b;
  var ys := if |b| >= |a| then b else a;
  CompareFoldAntiSym(a, b, 0, 0, xs, ys);
}

lemma lawHomeOrderIsIrreflexive_ensures(left: HomeCard)
  ensures (lawHomeOrderIsIrreflexive(left) == true)
{
  CompareAmountsAntiSym(left.amount, left.amount);
}

lemma lawHomeOrderIsAsymmetric_ensures(left: HomeCard, right: HomeCard)
  ensures (lawHomeOrderIsAsymmetric(left, right) == true)
{
  CompareAmountsAntiSym(left.amount, right.amount);
}

lemma lawHomeOrderSeparatesEntries_ensures(left: HomeCard, right: HomeCard)
  ensures (lawHomeOrderSeparatesEntries(left, right) == true)
{
  CompareAmountsAntiSym(left.amount, right.amount);
}
