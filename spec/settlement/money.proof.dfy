lemma FoldComparisonStable(f: (CompareFold, int) -> CompareFold, initial: CompareFold, xs: seq<int>)
  requires forall acc, digit :: f(acc, digit).comparison == acc.comparison
  ensures Std.Collections.Seq.FoldLeft(f, initial, xs).comparison == initial.comparison
  decreases |xs|
{
  if |xs| > 0 {
    FoldComparisonStable(f, f(initial, xs[0]), xs[1..]);
  }
}

lemma lawEqualReflexive_ensures(a: seq<int>)
  ensures (lawEqualReflexive(a) == true)
{
  var f := (acc: CompareFold, ignored: int) => CompareFold(
    (acc.index + 1),
    (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) ==
         (if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0))
     then acc.comparison
     else (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) >
               (if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0))
           then 1 else -1)));
  FoldComparisonStable(f, CompareFold(0, 0), a);
}

lemma FoldCopiesDigits(f: (AddFold, int) -> AddFold, a: seq<int>, n: int)
  requires 0 <= n <= |a|
  requires forall k, digit :: 0 <= k < |a| ==>
    f(AddFold(k, 0, a[..k]), digit) == AddFold(k + 1, 0, a[..k + 1])
  ensures Std.Collections.Seq.FoldLeft(f, AddFold(0, 0, []), a[..n]) == AddFold(n, 0, a[..n])
  decreases n
{
  if n > 0 {
    FoldCopiesDigits(f, a, n - 1);
    assert a[..n] == a[..n - 1] + [a[n - 1]];
    ProofLib.FoldLeftAppend(f, AddFold(0, 0, []), a[..n - 1], a[n - 1]);
  }
}

lemma lawZeroIdentity_ensures(a: seq<int>)
  ensures (lawZeroIdentity(a) == true)
{
  if validAmount(a) {
    var f := (acc: AddFold, ignored: int) => AddFold((acc.index + 1), quotient_settlement__money((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |zero|)) then zero[acc.index] else 0)) + acc.carry), 1000), (acc.digits + [remainder_settlement__money((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |zero|)) then zero[acc.index] else 0)) + acc.carry), 1000)]));
    forall k, digit | 0 <= k < |a|
      ensures f(AddFold(k, 0, a[..k]), digit) == AddFold(k + 1, 0, a[..k + 1])
    {
      assert a[k] in a;
      assert 0 <= a[k] < 1000;
      assert a[k] / 1000 == 0;
      assert quotient_settlement__money(a[k], 1000) == 0;
      assert remainder_settlement__money(a[k], 1000) == a[k];
      assert a[..k] + [a[k]] == a[..k + 1];
    }
    FoldCopiesDigits(f, a, |a|);
    assert |a| >= 1;
    assert zero == [0];
    assert a[..|a|] == a;
    assert Std.Collections.Seq.FoldLeft(f, AddFold(0, 0, []), a) == AddFold(|a|, 0, a);
    assert (if |a| >= |zero| then a else zero) == a;
    assert addAmounts(a, zero) == a;
    lawEqualReflexive_ensures(a);
  }
}

// The selected fold input has the same length as the amount being copied.
lemma FoldLeftZero(f: (AddFold, int) -> AddFold, xs: seq<int>, a: seq<int>, n: int)
  requires |xs| == |a|
  requires 0 <= n <= |xs|
  requires forall k :: 0 <= k < |xs| ==>
    f(AddFold(k, 0, a[..k]), xs[k]) == AddFold(k + 1, 0, a[..k + 1])
  ensures Std.Collections.Seq.FoldLeft(f, AddFold(0, 0, []), xs[..n]) == AddFold(n, 0, a[..n])
  decreases n
{
  if n > 0 {
    FoldLeftZero(f, xs, a, n - 1);
    assert xs[..n] == xs[..n - 1] + [xs[n - 1]];
    ProofLib.FoldLeftAppend(f, AddFold(0, 0, []), xs[..n - 1], xs[n - 1]);
  }
}

lemma AddLeftZero(a: seq<int>)
  requires validAmount(a)
  ensures addAmounts(zero, a) == a
{
  var f := (acc: AddFold, ignored: int) => AddFold((acc.index + 1), quotient_settlement__money((((if ((0 <= acc.index) && (acc.index < |zero|)) then zero[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0)) + acc.carry), 1000), (acc.digits + [remainder_settlement__money((((if ((0 <= acc.index) && (acc.index < |zero|)) then zero[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0)) + acc.carry), 1000)]));
  var xs := if |zero| >= |a| then zero else a;
  assert |a| >= 1 && zero == [0];
  assert |xs| == |a|;
  forall k | 0 <= k < |xs|
    ensures f(AddFold(k, 0, a[..k]), xs[k]) == AddFold(k + 1, 0, a[..k + 1])
  {
    assert a[k] in a;
    assert 0 <= a[k] < 1000;
    assert a[k] / 1000 == 0;
    assert quotient_settlement__money(a[k], 1000) == 0;
    assert remainder_settlement__money(a[k], 1000) == a[k];
    assert a[..k] + [a[k]] == a[..k + 1];
  }
  FoldLeftZero(f, xs, a, |xs|);
  assert xs[..|xs|] == xs && a[..|a|] == a;
  assert Std.Collections.Seq.FoldLeft(f, AddFold(0, 0, []), xs) == AddFold(|xs|, 0, a);
  assert addAmounts(zero, a) == a;
}

lemma FoldScalesOne(f: (ScaleFold, int) -> ScaleFold, a: seq<int>, n: int)
  requires 0 <= n <= |a|
  requires forall k :: 0 <= k < |a| ==>
    f(ScaleFold(0, a[..k]), a[k]) == ScaleFold(0, a[..k + 1])
  ensures Std.Collections.Seq.FoldLeft(f, ScaleFold(0, []), a[..n]) == ScaleFold(0, a[..n])
  decreases n
{
  if n > 0 {
    FoldScalesOne(f, a, n - 1);
    assert a[..n] == a[..n - 1] + [a[n - 1]];
    ProofLib.FoldLeftAppend(f, ScaleFold(0, []), a[..n - 1], a[n - 1]);
  }
}

lemma ScaleByOne(a: seq<int>, factor: int)
  requires validAmount(a)
  requires factor == 1
  ensures multiplySmall(a, factor) == a
{
  var f := (acc: ScaleFold, digit: int) => ScaleFold(quotient_settlement__money(((digit * factor) + acc.carry), 1000), (acc.digits + [remainder_settlement__money(((digit * factor) + acc.carry), 1000)]));
  forall k | 0 <= k < |a|
    ensures f(ScaleFold(0, a[..k]), a[k]) == ScaleFold(0, a[..k + 1])
  {
    assert a[k] in a;
    assert 0 <= a[k] < 1000;
    assert a[k] / 1000 == 0;
    assert quotient_settlement__money(a[k], 1000) == 0;
    assert remainder_settlement__money(a[k], 1000) == a[k];
    assert a[..k] + [a[k]] == a[..k + 1];
  }
  FoldScalesOne(f, a, |a|);
  assert a[..|a|] == a;
  assert Std.Collections.Seq.FoldLeft(f, ScaleFold(0, []), a) == ScaleFold(0, a);
  assert multiplySmall(a, factor) == a;
}

lemma lawMultiplyOne_ensures(a: seq<int>)
  ensures (lawMultiplyOne(a) == true)
{
  if validAmount(a) {
    ScaleByOne(a, 1);
    AddLeftZero(a);
    var f := (acc: ProductFold, digit: int) => ProductFold((acc.prefix + [0]), addAmounts(acc.product, (acc.prefix + multiplySmall(a, digit))));
    var init := ProductFold([], zero);
    assert [1] == [] + [1];
    assert Std.Collections.Seq.FoldLeft(f, init, []) == init;
    ProofLib.FoldLeftAppend(f, init, [], 1);
    assert Std.Collections.Seq.FoldLeft(f, init, [1]) == f(init, 1);
    assert init.prefix == [] && init.product == zero;
    assert multiplySmall(a, 1) == a;
    assert init.prefix + multiplySmall(a, 1) == a;
    assert addAmounts(init.product, init.prefix + multiplySmall(a, 1)) == a;
    assert f(init, 1) == ProductFold([0], a);
    assert f(init, 1).product == a;
    assert Std.Collections.Seq.FoldLeft(f, init, [1]).product == a;
    assert multiplyAmounts(a, [1]) == a;
    lawEqualReflexive_ensures(a);
  }
}

lemma AddValidDigits(f: (AddFold, int) -> AddFold, current: AddFold, xs: seq<int>)
  requires 0 <= current.carry <= 1
  requires forall d :: d in current.digits ==> 0 <= d < 1000
  requires forall acc: AddFold, x: int :: (0 <= acc.carry <= 1 && (forall d :: d in acc.digits ==> 0 <= d < 1000)) ==>
    (0 <= f(acc, x).carry <= 1 && |f(acc, x).digits| == |acc.digits| + 1 && (forall d :: d in f(acc, x).digits ==> 0 <= d < 1000))
  ensures 0 <= Std.Collections.Seq.FoldLeft(f, current, xs).carry <= 1
  ensures |Std.Collections.Seq.FoldLeft(f, current, xs).digits| == |current.digits| + |xs|
  ensures forall d :: d in Std.Collections.Seq.FoldLeft(f, current, xs).digits ==> 0 <= d < 1000
  decreases |xs|
{
  if |xs| > 0 {
    var next := f(current, xs[0]);
    AddValidDigits(f, next, xs[1..]);
  }
}

lemma lawAdditionValid_ensures(a: seq<int>, b: seq<int>)
  ensures (lawAdditionValid(a, b) == true)
{
  if validAmount(a) && validAmount(b) {
    var f := (acc: AddFold, ignored: int) => AddFold((acc.index + 1), quotient_settlement__money((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) + acc.carry), 1000), (acc.digits + [remainder_settlement__money((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) + acc.carry), 1000)]));
    forall acc: AddFold, x: int | 0 <= acc.carry <= 1 && (forall d :: d in acc.digits ==> 0 <= d < 1000)
      ensures 0 <= f(acc, x).carry <= 1 && |f(acc, x).digits| == |acc.digits| + 1 && (forall d :: d in f(acc, x).digits ==> 0 <= d < 1000)
    {
      var da := if 0 <= acc.index < |a| then a[acc.index] else 0;
      var db := if 0 <= acc.index < |b| then b[acc.index] else 0;
      if 0 <= acc.index < |a| { assert da in a; }
      if 0 <= acc.index < |b| { assert db in b; }
      assert 0 <= da < 1000 && 0 <= db < 1000;
      var combined := da + db + acc.carry;
      assert 0 <= combined <= 1999;
      assert quotient_settlement__money(combined, 1000) == combined / 1000;
      assert remainder_settlement__money(combined, 1000) == combined % 1000;
    }
    var longest := if |a| >= |b| then a else b;
    AddValidDigits(f, AddFold(0, 0, []), longest);
    var result := Std.Collections.Seq.FoldLeft(f, AddFold(0, 0, []), longest);
    assert |result.digits| == |longest| > 0;
    assert addAmounts(a, b) == (if result.carry > 0 then result.digits + [result.carry] else result.digits);
  }
}

lemma SubtractValidDigits(f: (SubtractFold, int) -> SubtractFold, current: SubtractFold, xs: seq<int>)
  requires 0 <= current.borrow <= 1
  requires forall d :: d in current.digits ==> 0 <= d < 1000
  requires forall acc: SubtractFold, x: int :: (0 <= acc.borrow <= 1 && (forall d :: d in acc.digits ==> 0 <= d < 1000)) ==>
    (0 <= f(acc, x).borrow <= 1 && |f(acc, x).digits| == |acc.digits| + 1 && (forall d :: d in f(acc, x).digits ==> 0 <= d < 1000))
  ensures 0 <= Std.Collections.Seq.FoldLeft(f, current, xs).borrow <= 1
  ensures |Std.Collections.Seq.FoldLeft(f, current, xs).digits| == |current.digits| + |xs|
  ensures forall d :: d in Std.Collections.Seq.FoldLeft(f, current, xs).digits ==> 0 <= d < 1000
  decreases |xs|
{
  if |xs| > 0 {
    var next := f(current, xs[0]);
    SubtractValidDigits(f, next, xs[1..]);
  }
}

lemma lawSubtractionValid_ensures(a: seq<int>, b: seq<int>)
  ensures (lawSubtractionValid(a, b) == true)
{
  if validAmount(a) && validAmount(b) {
    var f := (acc: SubtractFold, ignored: int) => SubtractFold((acc.index + 1), (if ((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow) < 0) then 1 else 0), (acc.digits + [(if ((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow) < 0) then ((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow) + 1000) else (((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow))]));
    forall acc: SubtractFold, x: int | 0 <= acc.borrow <= 1 && (forall d :: d in acc.digits ==> 0 <= d < 1000)
      ensures 0 <= f(acc, x).borrow <= 1 && |f(acc, x).digits| == |acc.digits| + 1 && (forall d :: d in f(acc, x).digits ==> 0 <= d < 1000)
    {
      var da := if 0 <= acc.index < |a| then a[acc.index] else 0;
      var db := if 0 <= acc.index < |b| then b[acc.index] else 0;
      if 0 <= acc.index < |a| { assert da in a; }
      if 0 <= acc.index < |b| { assert db in b; }
      assert 0 <= da < 1000 && 0 <= db < 1000;
      var combined := da - db - acc.borrow;
      assert -1000 <= combined <= 999;
    }
    SubtractValidDigits(f, SubtractFold(0, 0, []), a);
    var result := Std.Collections.Seq.FoldLeft(f, SubtractFold(0, 0, []), a);
    assert |result.digits| == |a| > 0;
    assert subtractAmounts(a, b) == result.digits;
  }
}

lemma AmountEqualLimb(a: seq<int>, b: seq<int>)
  ensures equalAmounts(a, b) == (forall i :: (0 <= i < (if |a| >= |b| then |a| else |b|) ==> ((if i < |a| then a[i] else 0) == (if i < |b| then b[i] else 0))))
{
  var longest := (if (|a| >= |b|) then a else b);
  var f := (acc: CompareFold, ignored: int) => CompareFold((acc.index + 1), (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) == (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then acc.comparison else (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) > (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then 1 else -1)));
  var same := (i: int) => (if (0 <= i && i < |a|) then a[i] else 0) == (if (0 <= i && i < |b|) then b[i] else 0);
  forall acc: CompareFold, ignored: int
    ensures f(acc, ignored).index == acc.index + 1
    ensures (f(acc, ignored).comparison == 0) == (acc.comparison == 0 && same(acc.index))
  { }
  CompareFoldZero(f, same, CompareFold(0, 0), longest);
  assert |longest| == (if |a| >= |b| then |a| else |b|);
  assert compareAmounts(a, b) == Std.Collections.Seq.FoldLeft(f, CompareFold(0, 0), longest).comparison;
  assert forall i :: (0 <= i < |longest|) ==> (same(i) == ((if i < |a| then a[i] else 0) == (if i < |b| then b[i] else 0)));
}

lemma CompareFoldZero(f: (CompareFold, int) -> CompareFold, same: int -> bool,
  acc: CompareFold, xs: seq<int>)
  requires forall acc, x :: f(acc, x).index == acc.index + 1
  requires forall acc, x :: (f(acc, x).comparison == 0) == (acc.comparison == 0 && same(acc.index))
  ensures (Std.Collections.Seq.FoldLeft(f, acc, xs).comparison == 0) ==
    (acc.comparison == 0 && (forall i :: acc.index <= i < acc.index + |xs| ==> same(i)))
  decreases |xs|
{
  if |xs| > 0 {
    assert |xs[1..]| == |xs| - 1;
    CompareFoldZero(f, same, f(acc, xs[0]), xs[1..]);
  }
}



lemma CompareTailStable(f: (CompareFold, int) -> CompareFold, current: CompareFold, xs: seq<int>, fromIndex: int)
  requires current.index >= fromIndex
  requires forall acc: CompareFold, x: int :: acc.index >= fromIndex ==>
    f(acc, x).comparison == acc.comparison && f(acc, x).index == acc.index + 1
  ensures Std.Collections.Seq.FoldLeft(f, current, xs).comparison == current.comparison
  decreases |xs|
{
  if |xs| > 0 {
    CompareTailStable(f, f(current, xs[0]), xs[1..], fromIndex);
  }
}

lemma CompareDifferentLengths(f: (CompareFold, int) -> CompareFold, g: (CompareFold, int) -> CompareFold,
  current: CompareFold, xs: seq<int>, ys: seq<int>, xLimit: int, yLimit: int)
  requires current.index + |xs| == xLimit && current.index + |ys| == yLimit
  requires forall acc: CompareFold, x: int, y: int :: f(acc, x) == g(acc, y)
  requires forall acc: CompareFold, x: int :: f(acc, x).index == acc.index + 1
  requires forall acc: CompareFold, x: int :: acc.index >= xLimit ==>
    f(acc, x).comparison == acc.comparison && f(acc, x).index == acc.index + 1
  requires forall acc: CompareFold, y: int :: acc.index >= yLimit ==>
    g(acc, y).comparison == acc.comparison && g(acc, y).index == acc.index + 1
  ensures Std.Collections.Seq.FoldLeft(f, current, xs).comparison == Std.Collections.Seq.FoldLeft(g, current, ys).comparison
  decreases |xs| + |ys|
{
  if |xs| == 0 {
    assert current.index == xLimit;
    forall acc: CompareFold, y: int | acc.index >= xLimit
      ensures g(acc, y).comparison == acc.comparison && g(acc, y).index == acc.index + 1
    { assert g(acc, y) == f(acc, 0); }
    CompareTailStable(g, current, ys, xLimit);
  } else if |ys| == 0 {
    assert current.index == yLimit;
    forall acc: CompareFold, x: int | acc.index >= yLimit
      ensures f(acc, x).comparison == acc.comparison && f(acc, x).index == acc.index + 1
    { assert f(acc, x) == g(acc, 0); }
    CompareTailStable(f, current, xs, yLimit);
  } else {
    assert f(current, xs[0]) == g(current, ys[0]);
    CompareDifferentLengths(f, g, f(current, xs[0]), xs[1..], ys[1..], xLimit, yLimit);
  }
}

lemma PaddedAmountLookup(a: seq<int>, b: seq<int>)
  requires equalAmounts(a, b)
  ensures forall i :: (if 0 <= i < |a| then a[i] else 0) == (if 0 <= i < |b| then b[i] else 0)
{
  AmountEqualLimb(a, b);
  forall i: int
    ensures (if 0 <= i < |a| then a[i] else 0) == (if 0 <= i < |b| then b[i] else 0)
  {
    if 0 <= i < |a| || 0 <= i < |b| {
      assert 0 <= i < (if |a| >= |b| then |a| else |b|);
    }
  }
}

lemma lawEqualSymmetric_ensures(a: seq<int>, b: seq<int>)
  ensures (lawEqualSymmetric(a, b) == true)
{
  AmountEqualLimb(a, b);
  AmountEqualLimb(b, a);
  assert (if |a| >= |b| then |a| else |b|) == (if |b| >= |a| then |b| else |a|);
}

lemma CompareOperandReplacement(a: seq<int>, b: seq<int>, c: seq<int>, d: seq<int>)
  requires equalAmounts(a, c) && equalAmounts(b, d)
  ensures compareAmounts(a, b) == compareAmounts(c, d)
{
  PaddedAmountLookup(a, c);
  PaddedAmountLookup(b, d);
  var f := (acc: CompareFold, ignored: int) => CompareFold((acc.index + 1), (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) == (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then acc.comparison else (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) > (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then 1 else -1)));
  var g := (acc: CompareFold, ignored: int) => CompareFold((acc.index + 1), (if ((if ((0 <= acc.index) && (acc.index < |c|)) then c[acc.index] else 0) == (if ((0 <= acc.index) && (acc.index < |d|)) then d[acc.index] else 0)) then acc.comparison else (if ((if ((0 <= acc.index) && (acc.index < |c|)) then c[acc.index] else 0) > (if ((0 <= acc.index) && (acc.index < |d|)) then d[acc.index] else 0)) then 1 else -1)));
  forall acc: CompareFold, x: int, y: int
    ensures f(acc, x) == g(acc, y)
  {
    assert (if 0 <= acc.index < |a| then a[acc.index] else 0) == (if 0 <= acc.index < |c| then c[acc.index] else 0);
    assert (if 0 <= acc.index < |b| then b[acc.index] else 0) == (if 0 <= acc.index < |d| then d[acc.index] else 0);
  }
  var xs := if |a| >= |b| then a else b;
  var ys := if |c| >= |d| then c else d;
  forall acc: CompareFold, x: int | acc.index >= |xs|
    ensures f(acc, x).comparison == acc.comparison && f(acc, x).index == acc.index + 1
  { assert acc.index >= |a| && acc.index >= |b|; }
  forall acc: CompareFold, y: int | acc.index >= |ys|
    ensures g(acc, y).comparison == acc.comparison && g(acc, y).index == acc.index + 1
  { assert acc.index >= |c| && acc.index >= |d|; }
  CompareDifferentLengths(f, g, CompareFold(0, 0), xs, ys, |xs|, |ys|);
  assert compareAmounts(a, b) == Std.Collections.Seq.FoldLeft(f, CompareFold(0, 0), xs).comparison;
  assert compareAmounts(c, d) == Std.Collections.Seq.FoldLeft(g, CompareFold(0, 0), ys).comparison;
}

lemma lawEqualOrder_ensures(a: seq<int>, b: seq<int>, c: seq<int>)
  ensures (lawEqualOrder(a, b, c) == true)
{
  if equalAmounts(a, b) {
    lawEqualReflexive_ensures(c);
    CompareOperandReplacement(a, c, b, c);
    CompareOperandReplacement(c, a, c, b);
  }
}

lemma lawEqualSubstitution_ensures(a: seq<int>, b: seq<int>, c: seq<int>)
  ensures (lawEqualSubstitution(a, b, c) == true)
{
  lawEqualOrder_ensures(a, b, c);
}

lemma CompareNonnegativeFold(f: (CompareFold, int) -> CompareFold, current: CompareFold, xs: seq<int>)
  requires current.comparison >= 0
  requires forall acc: CompareFold, x: int :: acc.comparison >= 0 ==> f(acc, x).comparison >= 0
  ensures Std.Collections.Seq.FoldLeft(f, current, xs).comparison >= 0
  decreases |xs|
{
  if |xs| > 0 { CompareNonnegativeFold(f, f(current, xs[0]), xs[1..]); }
}

lemma CompareNonpositiveFold(f: (CompareFold, int) -> CompareFold, current: CompareFold, xs: seq<int>)
  requires current.comparison <= 0
  requires forall acc: CompareFold, x: int :: acc.comparison <= 0 ==> f(acc, x).comparison <= 0
  ensures Std.Collections.Seq.FoldLeft(f, current, xs).comparison <= 0
  decreases |xs|
{
  if |xs| > 0 { CompareNonpositiveFold(f, f(current, xs[0]), xs[1..]); }
}

lemma lawZeroOrder_ensures(a: seq<int>)
  ensures (lawZeroOrder(a) == true)
{
  if validAmount(a) {
    var f := (acc: CompareFold, ignored: int) => CompareFold((acc.index + 1), (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) == (if ((0 <= acc.index) && (acc.index < |zero|)) then zero[acc.index] else 0)) then acc.comparison else (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) > (if ((0 <= acc.index) && (acc.index < |zero|)) then zero[acc.index] else 0)) then 1 else -1)));
    var g := (acc: CompareFold, ignored: int) => CompareFold((acc.index + 1), (if ((if ((0 <= acc.index) && (acc.index < |zero|)) then zero[acc.index] else 0) == (if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0)) then acc.comparison else (if ((if ((0 <= acc.index) && (acc.index < |zero|)) then zero[acc.index] else 0) > (if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0)) then 1 else -1)));
    forall acc: CompareFold, x: int | acc.comparison >= 0
      ensures f(acc, x).comparison >= 0
    {
      if 0 <= acc.index < |a| { assert a[acc.index] in a; }
    }
    forall acc: CompareFold, x: int | acc.comparison <= 0
      ensures g(acc, x).comparison <= 0
    {
      if 0 <= acc.index < |a| { assert a[acc.index] in a; }
    }
    CompareNonnegativeFold(f, CompareFold(0, 0), a);
    var longest := if |zero| >= |a| then zero else a;
    CompareNonpositiveFold(g, CompareFold(0, 0), longest);
    assert compareAmounts(a, zero) == Std.Collections.Seq.FoldLeft(f, CompareFold(0, 0), a).comparison;
    assert compareAmounts(zero, a) == Std.Collections.Seq.FoldLeft(g, CompareFold(0, 0), longest).comparison;
  }
}

lemma lawAddCommutative_ensures(a: seq<int>, b: seq<int>)
  ensures (lawAddCommutative(a, b) == true)
{
  var f := (acc: AddFold, ignored: int) => AddFold((acc.index + 1), quotient_settlement__money((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) + acc.carry), 1000), (acc.digits + [remainder_settlement__money((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) + acc.carry), 1000)]));
  var g := (acc: AddFold, ignored: int) => AddFold((acc.index + 1), quotient_settlement__money((((if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0)) + acc.carry), 1000), (acc.digits + [remainder_settlement__money((((if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0)) + acc.carry), 1000)]));
  var xs := if |a| >= |b| then a else b;
  var ys := if |b| >= |a| then b else a;
  var start := AddFold(0, 0, []);
  assert |xs| == |ys|;
  forall acc: AddFold, x: int, y: int
    ensures f(acc, x) == g(acc, y)
  { }
  ProofLib.FoldLeftPointwise(f, g, start, xs, ys);
  var sum := Std.Collections.Seq.FoldLeft(f, start, xs);
  assert addAmounts(a, b) == (if sum.carry > 0 then sum.digits + [sum.carry] else sum.digits);
  assert addAmounts(b, a) == (if sum.carry > 0 then sum.digits + [sum.carry] else sum.digits);
}
