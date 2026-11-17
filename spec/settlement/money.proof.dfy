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

lemma ComparePositiveFold(f: (CompareFold, int) -> CompareFold, a: seq<int>, start: CompareFold, xs: seq<int>)
  requires forall acc, d :: f(acc, d).index == acc.index + 1
  requires forall acc, d :: (f(acc, d).comparison > 0) == (acc.comparison > 0 || (0 <= acc.index < |a| && a[acc.index] > 0))
  ensures (Std.Collections.Seq.FoldLeft(f, start, xs).comparison > 0) ==
    (start.comparison > 0 || (exists i :: (start.index <= i < start.index + |xs| && 0 <= i < |a| && a[i] > 0)))
  decreases |xs|
{
  if |xs| > 0 {
    ComparePositiveFold(f, a, f(start, xs[0]), xs[1..]);
    assert start.index + |xs| == f(start, xs[0]).index + |xs[1..]|;
  }
}

lemma PositiveLimb(a: seq<int>)
  requires validAmount(a)
  ensures positiveAmount(a) == (exists i :: (0 <= i < |a| && a[i] > 0))
{
  var compare := (acc: CompareFold, ignored: int) => CompareFold((acc.index + 1), (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) == (if ((0 <= acc.index) && (acc.index < |zero|)) then zero[acc.index] else 0)) then acc.comparison else (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) > (if ((0 <= acc.index) && (acc.index < |zero|)) then zero[acc.index] else 0)) then 1 else -1)));
  forall acc: CompareFold, digit: int
    ensures compare(acc, digit).index == acc.index + 1
    ensures (compare(acc, digit).comparison > 0) == (acc.comparison > 0 || (0 <= acc.index < |a| && a[acc.index] > 0))
  {
    if 0 <= acc.index < |a| { assert a[acc.index] in a; }
  }
  assert |a| >= |zero|;
  assert compareAmounts(a, zero) == Std.Collections.Seq.FoldLeft(compare, CompareFold(0, 0), a).comparison;
  ComparePositiveFold(compare, a, CompareFold(0, 0), a);
}

lemma AddPositiveFold(f: (AddFold, int) -> AddFold, a: seq<int>, b: seq<int>, start: AddFold, xs: seq<int>)
  requires start.carry >= 0
  requires forall acc: AddFold, d: int :: acc.carry >= 0 ==> (f(acc, d).index == acc.index + 1 && f(acc, d).carry >= 0)
  requires forall acc: AddFold, d: int :: (acc.carry >= 0 ==> ((f(acc, d).carry > 0 || (exists k :: (0 <= k < |f(acc, d).digits| && f(acc, d).digits[k] > 0))) ==
    (acc.carry > 0 || (exists k :: (0 <= k < |acc.digits| && acc.digits[k] > 0)) || (0 <= acc.index < |a| && a[acc.index] > 0) || (0 <= acc.index < |b| && b[acc.index] > 0))))
  ensures var end := Std.Collections.Seq.FoldLeft(f, start, xs);
    (end.carry > 0 || (exists k :: (0 <= k < |end.digits| && end.digits[k] > 0))) ==
      (start.carry > 0 || (exists k :: (0 <= k < |start.digits| && start.digits[k] > 0)) ||
        (exists i :: (start.index <= i < start.index + |xs| &&
          ((0 <= i < |a| && a[i] > 0) || (0 <= i < |b| && b[i] > 0)))))
  decreases |xs|
{
  if |xs| > 0 {
    var next := f(start, xs[0]);
    AddPositiveFold(f, a, b, next, xs[1..]);
    assert next.index + |xs[1..]| == start.index + |xs|;
  }
}

lemma lawPositiveAddition_ensures(a: seq<int>, b: seq<int>)
  ensures (lawPositiveAddition(a, b) == true)
{
  if validAmount(a) && validAmount(b) {
    var add := (acc: AddFold, ignored: int) => AddFold((acc.index + 1), quotient_settlement__money((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) + acc.carry), 1000), (acc.digits + [remainder_settlement__money((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) + acc.carry), 1000)]));
    var longest := if |a| >= |b| then a else b;
    var start := AddFold(0, 0, []);
    forall acc: AddFold, digit: int | acc.carry >= 0
      ensures add(acc, digit).index == acc.index + 1 && add(acc, digit).carry >= 0
      ensures (add(acc, digit).carry > 0 || (exists k :: (0 <= k < |add(acc, digit).digits| && add(acc, digit).digits[k] > 0))) ==
        (acc.carry > 0 || (exists k :: (0 <= k < |acc.digits| && acc.digits[k] > 0)) || (0 <= acc.index < |a| && a[acc.index] > 0) || (0 <= acc.index < |b| && b[acc.index] > 0))
    {
      var x := if 0 <= acc.index < |a| then a[acc.index] else 0;
      var y := if 0 <= acc.index < |b| then b[acc.index] else 0;
      if 0 <= acc.index < |a| { assert a[acc.index] in a; }
      if 0 <= acc.index < |b| { assert b[acc.index] in b; }
      var total := x + y + acc.carry;
      assert total >= 0;
      assert (total > 0) == (x > 0 || y > 0 || acc.carry > 0);
      var carry := quotient_settlement__money(total, 1000);
      var limb := remainder_settlement__money(total, 1000);
      assert carry == total / 1000 && limb == total % 1000;
      assert total == carry * 1000 + limb;
      assert carry >= 0 && 0 <= limb < 1000;
      assert (total > 0) == (carry > 0 || limb > 0);
      assert add(acc, digit).digits == acc.digits + [limb];
      assert |add(acc, digit).digits| == |acc.digits| + 1;
      assert forall i :: (0 <= i < |acc.digits| ==> add(acc, digit).digits[i] == acc.digits[i]);
      assert add(acc, digit).digits[|acc.digits|] == limb;
    }
    AddPositiveFold(add, a, b, start, longest);
    var end := Std.Collections.Seq.FoldLeft(add, start, longest);
    var total := addAmounts(a, b);
    assert total == (if end.carry > 0 then end.digits + [end.carry] else end.digits);
    assert (exists k :: (0 <= k < |total| && total[k] > 0)) == (end.carry > 0 || (exists k :: (0 <= k < |end.digits| && end.digits[k] > 0))) by {
      if end.carry > 0 { assert total[|end.digits|] == end.carry; }
    }
    lawAdditionValid_ensures(a, b);
    PositiveLimb(a);
    PositiveLimb(b);
    PositiveLimb(total);
    assert |longest| >= |a| && |longest| >= |b|;
  }
}

lemma lawMultiplySmallValid_ensures(a: seq<int>, factor: int)
  ensures (lawMultiplySmallValid(a, factor) == true)
{
  if validAmount(a) && 0 <= factor < 1000 {
    var advance := (acc: ScaleFold, digit: int) => ScaleFold(quotient_settlement__money(((digit * factor) + acc.carry), 1000), (acc.digits + [remainder_settlement__money(((digit * factor) + acc.carry), 1000)]));
    forall acc: ScaleFold, digit: int | 0 <= acc.carry < 1000 && 0 <= digit < 1000
      ensures 0 <= advance(acc, digit).carry < 1000
      ensures advance(acc, digit).digits == acc.digits + [remainder_settlement__money(digit * factor + acc.carry, 1000)]
      ensures 0 <= remainder_settlement__money(digit * factor + acc.carry, 1000) < 1000
    {
      var raw := digit * factor + acc.carry;
      assert 0 <= digit * factor <= 998001 by {
        calc {
          digit * factor;
          <= 999 * factor;
          <= 999 * 999;
        }
      }
      assert 0 <= raw < 1000000;
      assert quotient_settlement__money(raw, 1000) == raw / 1000;
      assert remainder_settlement__money(raw, 1000) == raw % 1000;
      var limb := raw % 1000;
      assert 0 <= limb < 1000 && advance(acc, digit).digits == acc.digits + [limb];
    }
    forall acc: ScaleFold, digit: int | 0 <= acc.carry < 1000 && 0 <= digit < 1000
      ensures |advance(acc, digit).digits| == |acc.digits| + 1
      ensures forall limb :: limb in advance(acc, digit).digits ==> limb in acc.digits || 0 <= limb < 1000
    {
      var limb := remainder_settlement__money(digit * factor + acc.carry, 1000);
      assert advance(acc, digit).digits == acc.digits + [limb];
      assert 0 <= limb < 1000;
    }
    ValidScaleFold(advance, ScaleFold(0, []), a);
  }
}

lemma ValidScaleFold(advance: (ScaleFold, int) -> ScaleFold, acc: ScaleFold, xs: seq<int>)
  requires 0 <= acc.carry < 1000
  requires forall d :: d in acc.digits ==> 0 <= d < 1000
  requires forall d :: d in xs ==> 0 <= d < 1000
  requires forall s: ScaleFold, d: int :: 0 <= s.carry < 1000 && 0 <= d < 1000 ==> 0 <= advance(s, d).carry < 1000
  requires forall s: ScaleFold, d: int :: (0 <= s.carry < 1000 && 0 <= d < 1000 ==>
    |advance(s, d).digits| == |s.digits| + 1 &&
    (forall limb :: limb in advance(s, d).digits ==> limb in s.digits || 0 <= limb < 1000))
  ensures 0 <= Std.Collections.Seq.FoldLeft(advance, acc, xs).carry < 1000
  ensures forall d :: d in Std.Collections.Seq.FoldLeft(advance, acc, xs).digits ==> 0 <= d < 1000
  ensures |Std.Collections.Seq.FoldLeft(advance, acc, xs).digits| == |acc.digits| + |xs|
  decreases |xs|
{
  if |xs| > 0 {
    var next := advance(acc, xs[0]);
    assert xs[0] in xs;
    assert 0 <= xs[0] < 1000;
    assert forall d :: d in next.digits ==> 0 <= d < 1000;
    assert forall d :: d in xs[1..] ==> d in xs;
    ValidScaleFold(advance, next, xs[1..]);
  }
}

lemma lawMultiplyValid_ensures(a: seq<int>, b: seq<int>)
  ensures (lawMultiplyValid(a, b) == true)
{
  if validAmount(a) && validAmount(b) {
    ValidProductFold(a, ProductFold([], zero), b);
  }
}

lemma ValidProductFold(a: seq<int>, acc: ProductFold, xs: seq<int>)
  requires validAmount(a) && validAmount(acc.product)
  requires forall d :: d in acc.prefix ==> d == 0
  requires forall d :: d in xs ==> 0 <= d < 1000
  ensures validAmount(Std.Collections.Seq.FoldLeft((acc: ProductFold, digit: int) => ProductFold((acc.prefix + [0]), addAmounts(acc.product, (acc.prefix + multiplySmall(a, digit)))), acc, xs).product)
  decreases |xs|
{
  if |xs| > 0 {
    var digit := xs[0];
    assert digit in xs;
    lawMultiplySmallValid_ensures(a, digit);
    var scaled := multiplySmall(a, digit);
    assert validAmount(acc.prefix + scaled) by {
      assert forall d :: d in acc.prefix + scaled ==> d in acc.prefix || d in scaled;
    }
    lawAdditionValid_ensures(acc.product, acc.prefix + scaled);
    assert forall d :: d in acc.prefix + [0] ==> d == 0;
    assert forall d :: d in xs[1..] ==> d in xs;
    ValidProductFold(a, ProductFold(acc.prefix + [0], addAmounts(acc.product, acc.prefix + scaled)), xs[1..]);
  }
}

lemma lawDivisionValid_ensures(a: seq<int>, b: seq<int>)
  ensures (lawDivisionValid(a, b) == true)
{
  if validAmount(a) && validAmount(b) && positiveAmount(b) {
    ValidReverse([], a);
    var reversed := reverseAmount(a);
    IndexedDigitsValid(reversed);
    assert validAmount(reversed);
    ValidDivisionFold(b, Division([], zero), reversed);
    var result := Std.Collections.Seq.FoldLeft((acc: Division, digit: int) => divisionStep(acc, digit, b), Division([], zero), reversed);
    IndexedDigitsValid(result.quotient);
    assert validAmount(result.quotient);
    ValidReverse([], result.quotient);
    IndexedDigitsValid(reverseAmount(result.quotient));
  }
}

lemma IndexedDigitsValid(xs: seq<int>)
  requires forall i :: 0 <= i < |xs| ==> 0 <= xs[i] < 1000
  ensures forall d :: d in xs ==> 0 <= d < 1000
{
  forall d | d in xs ensures 0 <= d < 1000 {
    var i :| 0 <= i < |xs| && xs[i] == d;
  }
}

lemma ValidReverse(prefix: seq<int>, xs: seq<int>)
  requires forall i :: 0 <= i < |prefix| ==> 0 <= prefix[i] < 1000
  requires forall d :: d in xs ==> 0 <= d < 1000
  ensures |Std.Collections.Seq.FoldLeft((acc: seq<int>, digit: int) => ([digit] + acc), prefix, xs)| == |prefix| + |xs|
  ensures var result := Std.Collections.Seq.FoldLeft((acc: seq<int>, digit: int) => ([digit] + acc), prefix, xs);
    forall i :: 0 <= i < |result| ==> 0 <= result[i] < 1000
  decreases |xs|
{
  if |xs| > 0 {
    assert xs[0] in xs;
    var next := [xs[0]] + prefix;
    forall i | 0 <= i < |next| ensures 0 <= next[i] < 1000 {
      if i == 0 { assert next[i] == xs[0]; }
      else { assert next[i] == prefix[i - 1]; }
    }
    assert forall d :: d in xs[1..] ==> d in xs;
    ValidReverse(next, xs[1..]);
  } else {
    assert Std.Collections.Seq.FoldLeft((acc: seq<int>, digit: int) => ([digit] + acc), prefix, xs) == prefix;
  }
}

lemma ValidDivisionFold(divisor: seq<int>, acc: Division, xs: seq<int>)
  requires validAmount(divisor) && validAmount(acc.remainder)
  requires forall i :: 0 <= i < |acc.quotient| ==> 0 <= acc.quotient[i] < 1000
  requires forall d :: d in xs ==> 0 <= d < 1000
  ensures validAmount(Std.Collections.Seq.FoldLeft((acc: Division, digit: int) => divisionStep(acc, digit, divisor), acc, xs).remainder)
  ensures |Std.Collections.Seq.FoldLeft((acc: Division, digit: int) => divisionStep(acc, digit, divisor), acc, xs).quotient| == |acc.quotient| + |xs|
  ensures var result := Std.Collections.Seq.FoldLeft((acc: Division, digit: int) => divisionStep(acc, digit, divisor), acc, xs).quotient;
    forall i :: 0 <= i < |result| ==> 0 <= result[i] < 1000
  decreases |xs|
{
  if |xs| > 0 {
    assert xs[0] in xs;
    var partial := [xs[0]] + acc.remainder;
    assert validAmount(partial) by {
      assert forall d :: d in partial ==> d == xs[0] || d in acc.remainder;
    }
    var selected := quotientDigit(partial, divisor);
    BoundedQuotientDigit(partial, divisor);
    lawMultiplySmallValid_ensures(divisor, selected);
    lawSubtractionValid_ensures(partial, multiplySmall(divisor, selected));
    var next := divisionStep(acc, xs[0], divisor);
    assert next.remainder == subtractAmounts(partial, multiplySmall(divisor, selected));
    assert next.quotient == acc.quotient + [selected];
    forall i | 0 <= i < |next.quotient| ensures 0 <= next.quotient[i] < 1000 {
      if i == |acc.quotient| { assert next.quotient[i] == selected; }
      else { assert next.quotient[i] == acc.quotient[i]; }
    }
    assert forall d :: d in xs[1..] ==> d in xs;
    ValidDivisionFold(divisor, next, xs[1..]);
  } else {
    assert Std.Collections.Seq.FoldLeft((acc: Division, digit: int) => divisionStep(acc, digit, divisor), acc, xs) == acc;
  }
}

lemma BoundedQuotientDigit(partial: seq<int>, divisor: seq<int>)
  ensures 0 <= quotientDigit(partial, divisor) < 1000
{
  assert quotientBits == [512, 256, 128, 64, 32, 16, 8, 4, 2, 1];
  assert forall bit :: bit in quotientBits ==> bit >= 0;
  QuotientLimb(partial, divisor, 0, quotientBits);
}

lemma QuotientLimb(partial: seq<int>, divisor: seq<int>, digit: int, bits: seq<int>)
  requires 0 <= digit < 1000
  requires forall bit :: bit in bits ==> bit >= 0
  ensures 0 <= Std.Collections.Seq.FoldLeft((digit: int, bit: int) => quotientCandidate(digit, bit, partial, divisor), digit, bits) < 1000
  decreases |bits|
{
  if |bits| > 0 {
    assert bits[0] in bits;
    assert forall bit :: bit in bits[1..] ==> bit in bits;
    var next := quotientCandidate(digit, bits[0], partial, divisor);
    assert 0 <= next < 1000;
    QuotientLimb(partial, divisor, next, bits[1..]);
  }
}

lemma lawOrdinaryAmountsValid_ensures(a: seq<int>)
  ensures (lawOrdinaryAmountsValid(a) == true)
{
  if validAmount(a) {
    lawDivisionValid_ensures(a, [50]);
    lawAdditionValid_ensures(divideAmounts(a, [50]).quotient, [1]);
    lawSubtractionValid_ensures(a, ordinaryFeeAmount(a));
  }
}

lemma lawPrivateAmountsValid_ensures(a: seq<int>)
  ensures (lawPrivateAmountsValid(a) == true)
{
  if validAmount(a) {
    lawDivisionValid_ensures(a, [4]);
    lawMultiplySmallValid_ensures(privateFeeAmount(a), 3);
  }
}

// The valuation exists only in proofs. Executable amounts retain their digits.
lemma AmountValueCons(digit: int, xs: seq<int>)
  ensures Std.Collections.Seq.FoldLeft((acc: int, limb: int) => 1000 * acc + limb, 0, reverseAmount([digit] + xs)) ==
    1000 * Std.Collections.Seq.FoldLeft((acc: int, limb: int) => 1000 * acc + limb, 0, reverseAmount(xs)) + digit
{
  var reverse := (acc: seq<int>, digit: int) => ([digit] + acc);
  assert |[digit] + xs| > 0 && ([digit] + xs)[0] == digit && ([digit] + xs)[1..] == xs;
  assert reverse([], digit) == [digit];
  assert reverseAmount([digit] + xs) == Std.Collections.Seq.FoldLeft(reverse, [digit], xs);
  ReverseOneAtEnd(reverse, xs, digit);
  assert reverseAmount([digit] + xs) == reverseAmount(xs) + [digit];
  ProofLib.FoldLeftAppend((acc: int, limb: int) => 1000 * acc + limb, 0, reverseAmount(xs), digit);
}

lemma ReverseOneAtEnd(reverse: (seq<int>, int) -> seq<int>, xs: seq<int>, digit: int)
  requires forall acc, limb :: reverse(acc, limb) == [limb] + acc
  ensures Std.Collections.Seq.FoldLeft(reverse, [digit], xs) == Std.Collections.Seq.FoldLeft(reverse, [], xs) + [digit]
{
  ReverseRetainsTail(reverse, [], [digit], xs);
  assert [] + [digit] == [digit];
}

lemma ReverseRetainsTail(reverse: (seq<int>, int) -> seq<int>, first: seq<int>, tail: seq<int>, xs: seq<int>)
  requires forall acc, limb :: reverse(acc, limb) == [limb] + acc
  ensures Std.Collections.Seq.FoldLeft(reverse, first + tail, xs) == Std.Collections.Seq.FoldLeft(reverse, first, xs) + tail
  decreases |xs|
{
  if |xs| > 0 {
    assert reverse(first + tail, xs[0]) == reverse(first, xs[0]) + tail;
    ReverseRetainsTail(reverse, reverse(first, xs[0]), tail, xs[1..]);
  }
}

lemma AmountValueConsRange(xs: seq<int>)
  requires forall d :: d in xs ==> 0 <= d < 1000
  ensures 0 <= Std.Collections.Seq.FoldLeft((n: int, x: int) => 1000*n + x, 0, reverseAmount(xs))
  ensures Std.Collections.Seq.FoldLeft((n: int, x: int) => 1000*n + x, 0, reverseAmount(xs)) <
    Std.Collections.Seq.FoldLeft((n: int, x: int) => 1000*n, 1, xs)
  decreases |xs|
{
  var h := (n: int, x: int) => 1000*n + x;
  var power := (n: int, x: int) => 1000*n;
  if |xs| > 0 {
    var d := xs[0];
    var tail := xs[1..];
    assert d in xs;
    forall x | x in tail ensures x in xs { }
    AmountValueConsRange(tail);
    assert xs == [d] + tail;
    AmountValueCons(d, tail);
    PowerInitialScale(tail, 1, 1000);
    assert Std.Collections.Seq.FoldLeft(power, 1, xs) == Std.Collections.Seq.FoldLeft(power, 1000, tail);
    assert 0 <= d < 1000;
    assert 0 <= Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(tail)) < Std.Collections.Seq.FoldLeft(power, 1, tail);
  }
}

lemma PowerInitialScale(xs: seq<int>, initial: int, factor: int)
  ensures Std.Collections.Seq.FoldLeft((n: int, d: int) => 1000*n, factor * initial, xs) ==
    factor * Std.Collections.Seq.FoldLeft((n: int, d: int) => 1000*n, initial, xs)
  decreases |xs|
{
  if |xs| > 0 {
    PowerInitialScale(xs[1..], 1000 * initial, factor);
    assert 1000 * (factor * initial) == factor * (1000 * initial);
  }
}

lemma HornerFromInitial(xs: seq<int>, initial: int)
  ensures Std.Collections.Seq.FoldLeft((n: int, x: int) => 1000*n + x, initial, xs) ==
    initial * Std.Collections.Seq.FoldLeft((n: int, x: int) => 1000*n, 1, xs) +
    Std.Collections.Seq.FoldLeft((n: int, x: int) => 1000*n + x, 0, xs)
  decreases |xs|
{
  if |xs| > 0 {
    var h := (n: int, x: int) => 1000*n + x;
    var power := (n: int, x: int) => 1000*n;
    var tail := xs[1..];
    var digit := xs[0];
    HornerFromInitial(tail, 1000 * initial + digit);
    HornerFromInitial(tail, digit);
    PowerInitialScale(tail, 1, 1000);
    var w := Std.Collections.Seq.FoldLeft(power, 1, tail);
    assert (1000 * initial + digit) * w == initial * (1000 * w) + digit * w;
  }
}

lemma ReverseAmountAppend(xs: seq<int>, digit: int)
  ensures reverseAmount(xs + [digit]) == [digit] + reverseAmount(xs)
{
  var step := (r: seq<int>, d: int) => [d] + r;
  ProofLib.FoldLeftAppend(step, [], xs, digit);
}

lemma AmountValueAppend(xs: seq<int>, digit: int)
  ensures Std.Collections.Seq.FoldLeft((n: int, x: int) => 1000*n + x, 0, reverseAmount(xs + [digit])) ==
    Std.Collections.Seq.FoldLeft((n: int, x: int) => 1000*n + x, 0, reverseAmount(xs)) +
    digit * Std.Collections.Seq.FoldLeft((n: int, x: int) => 1000*n, 1, xs)
{
  var h := (n: int, x: int) => 1000*n + x;
  var power := (n: int, x: int) => 1000*n;
  ReverseAmountAppend(xs, digit);
  HornerFromInitial(reverseAmount(xs), digit);
  ReverseAmountLength(xs, []);
  PowerLengthOnly(xs, reverseAmount(xs), 1);
  assert ([digit] + reverseAmount(xs))[1..] == reverseAmount(xs);
  assert Std.Collections.Seq.FoldLeft(h, 0, [digit] + reverseAmount(xs)) ==
    Std.Collections.Seq.FoldLeft(h, digit, reverseAmount(xs));
}

lemma ReverseAmountLength(xs: seq<int>, acc: seq<int>)
  ensures |Std.Collections.Seq.FoldLeft((r: seq<int>, d: int) => [d] + r, acc, xs)| == |xs| + |acc|
  decreases |xs|
{
  if |xs| > 0 {
    ReverseAmountLength(xs[1..], [xs[0]] + acc);
  }
}

lemma PowerLengthOnly(xs: seq<int>, ys: seq<int>, initial: int)
  requires |xs| == |ys|
  ensures Std.Collections.Seq.FoldLeft((n: int, d: int) => 1000*n, initial, xs) ==
    Std.Collections.Seq.FoldLeft((n: int, d: int) => 1000*n, initial, ys)
  decreases |xs|
{
  if |xs| > 0 {
    PowerLengthOnly(xs[1..], ys[1..], 1000 * initial);
  }
}

lemma CompareSuffixValue(a: seq<int>, b: seq<int>, work: seq<int>, index: int, previous: int)
  requires 0 <= index <= (if |a| >= |b| then |a| else |b|)
  requires index + |work| == (if |a| >= |b| then |a| else |b|)
  requires forall d :: d in a ==> 0 <= d < 1000
  requires forall d :: d in b ==> 0 <= d < 1000
  ensures var h := (n: int, d: int) => 1000*n + d;
    var u := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(a[if index < |a| then index else |a|..]));
    var v := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(b[if index < |b| then index else |b|..]));
    (Std.Collections.Seq.FoldLeft((acc: CompareFold, ignored: int) => CompareFold((acc.index + 1), (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) == (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then acc.comparison else (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) > (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then 1 else -1))), CompareFold(index, previous), work).comparison ==
      (if u > v then 1 else if u < v then -1 else previous))
  decreases |work|
{
  if |work| > 0 {
    var da := if index < |a| then a[index] else 0;
    var db := if index < |b| then b[index] else 0;
    var k := index + 1;
    var at := a[if index < |a| then index else |a|..];
    var bt := b[if index < |b| then index else |b|..];
    var atNext := a[if k < |a| then k else |a|..];
    var btNext := b[if k < |b| then k else |b|..];
    var h := (n: int, d: int) => 1000*n + d;
    if index < |a| {
      assert da in a;
      assert at == [da] + atNext;
      AmountValueCons(da, atNext);
    } else {
      assert at == [] && atNext == [];
    }
    if index < |b| {
      assert db in b;
      assert bt == [db] + btNext;
      AmountValueCons(db, btNext);
    } else {
      assert bt == [] && btNext == [];
    }
    assert 0 <= da < 1000 && 0 <= db < 1000;
    var u := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(at));
    var v := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(bt));
    var tailA := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(atNext));
    var tailB := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(btNext));
    assert u == da + 1000 * tailA && v == db + 1000 * tailB;
    var next := if da == db then previous else if da > db then 1 else -1;
    CompareSuffixValue(a, b, work[1..], k, next);
    if tailA > tailB { assert u > v; }
    else if tailA < tailB { assert u < v; }
    else { assert next == (if u > v then 1 else if u < v then -1 else previous); }
  }
}

lemma AmountValueOrder(a: seq<int>, b: seq<int>)
  requires forall d :: d in a ==> 0 <= d < 1000
  requires forall d :: d in b ==> 0 <= d < 1000
  ensures var h := (n: int, d: int) => 1000*n + d;
    var u := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(a));
    var v := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(b));
    compareAmounts(a, b) == (if u > v then 1 else if u < v then -1 else 0)
{
  var work := if |a| >= |b| then a else b;
  CompareSuffixValue(a, b, work, 0, 0);
  assert a[if 0 < |a| then 0 else |a|..] == a;
  assert b[if 0 < |b| then 0 else |b|..] == b;
}

lemma AddSuffixValue(a: seq<int>, b: seq<int>, work: seq<int>, current: AddFold)
  requires 0 <= current.index && current.index + |work| == (if |a| >= |b| then |a| else |b|)
  requires 0 <= current.carry <= 1
  requires forall d :: d in a ==> 0 <= d < 1000
  requires forall d :: d in b ==> 0 <= d < 1000
  ensures var h := (n: int, d: int) => 1000*n + d;
    var remainderA := a[if current.index < |a| then current.index else |a|..];
    var remainderB := b[if current.index < |b| then current.index else |b|..];
    var result := Std.Collections.Seq.FoldLeft((acc: AddFold, ignored: int) => AddFold((acc.index + 1), quotient_settlement__money((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) + acc.carry), 1000), (acc.digits + [remainder_settlement__money((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) + acc.carry), 1000)])), current, work);
    |result.digits| == |current.digits| + |work| && result.digits[..|current.digits|] == current.digits &&
    (var tail := result.digits[|current.digits|..];
     var out := if result.carry > 0 then tail + [result.carry] else tail;
     Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(out)) ==
       Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(remainderA)) +
       Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(remainderB)) + current.carry)
  decreases |work|
{
  var f := (acc: AddFold, ignored: int) => AddFold((acc.index + 1), quotient_settlement__money((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) + acc.carry), 1000), (acc.digits + [remainder_settlement__money((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) + acc.carry), 1000)]));
  var full := Std.Collections.Seq.FoldLeft(f, current, work);
  var h := (n: int, d: int) => 1000*n + d;
  var ra := a[if current.index < |a| then current.index else |a|..];
  var rb := b[if current.index < |b| then current.index else |b|..];
  var va := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(ra));
  var vb := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(rb));
  if |work| > 0 {
    var i := current.index;
    var j := i + 1;
    var da := if i < |a| then a[i] else 0;
    var db := if i < |b| then b[i] else 0;
    if i < |a| { assert da in a; }
    if i < |b| { assert db in b; }
    assert 0 <= da < 1000 && 0 <= db < 1000;
    var total := da + db + current.carry;
    var digit := total % 1000;
    var next := f(current, work[0]);
    assert 0 <= total < 2000;
    assert next.index == j && next.carry == total / 1000 && next.digits == current.digits + [digit];
    AddSuffixValue(a, b, work[1..], next);
    assert full == Std.Collections.Seq.FoldLeft(f, next, work[1..]);
    assert |full.digits| == |current.digits| + |work|;
    assert full.digits[..|next.digits|] == next.digits;
    assert full.digits[|current.digits|] == digit;
    var rest := full.digits[|next.digits|..];
    var outRest := if full.carry > 0 then rest + [full.carry] else rest;
    assert |next.digits| == |current.digits| + 1;
    assert full.digits[|current.digits|..] == full.digits[|current.digits|..|next.digits|] + rest;
    assert full.digits[|current.digits|..|next.digits|] == [digit];
    var tail := full.digits[|current.digits|..];
    var out := if full.carry > 0 then tail + [full.carry] else tail;
    assert out == [digit] + outRest;
    AmountValueCons(digit, outRest);
    AmountSuffixValue(a, i);
    AmountSuffixValue(b, i);
    var ta := a[if j < |a| then j else |a|..];
    var tb := b[if j < |b| then j else |b|..];
    var vta := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(ta));
    var vtb := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(tb));
    var remaining := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(outRest));
    assert remaining == vta + vtb + next.carry;
    assert total == digit + 1000 * next.carry;
    calc {
      Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(out));
      == digit + 1000 * remaining;
      == total + 1000*vta + 1000*vtb;
      == va + vb + current.carry;
    }
  } else {
    assert full == current;
    assert current.index >= |a| && current.index >= |b|;
    assert a[|a|..] == [] && b[|b|..] == [];
    assert full.digits[|current.digits|..] == [];
    assert reverseAmount([]) == [] && Std.Collections.Seq.FoldLeft(h, 0, []) == 0;
    assert ra == [] && rb == [] && va == 0 && vb == 0;
    var tail := full.digits[|current.digits|..];
    var out := if full.carry > 0 then tail + [full.carry] else tail;
    if current.carry == 1 {
      assert out == [1];
      AmountValueCons(1, []);
      assert out == [1] + [];
      calc {
        Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(out));
        == 1 + 1000 * Std.Collections.Seq.FoldLeft(h, 0, reverseAmount([]));
        == 1;
      }
    } else {
      assert out == [] && current.carry == 0;
    }
    assert Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(out)) == va + vb + current.carry;
  }
}

lemma AmountSuffixValue(a: seq<int>, i: int)
  requires i >= 0
  ensures var h := (n: int, d: int) => 1000*n + d;
    var next := i + 1;
    var da := if i < |a| then a[i] else 0;
    var at := a[if i < |a| then i else |a|..];
    var atNext := a[if next < |a| then next else |a|..];
    Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(at)) == da + 1000 * Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(atNext))
{
  if i < |a| {
    var da := a[i];
    var next := i + 1;
    var at := a[i..];
    var atNext := a[if next < |a| then next else |a|..];
    assert at == [da] + atNext;
    AmountValueCons(da, atNext);
  }
}

lemma AmountValueAdd(a: seq<int>, b: seq<int>)
  requires forall d :: d in a ==> 0 <= d < 1000
  requires forall d :: d in b ==> 0 <= d < 1000
  ensures var h := (n: int, d: int) => 1000*n + d;
    Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(addAmounts(a, b))) ==
      Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(a)) + Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(b))
{
  var f := (acc: AddFold, ignored: int) => AddFold((acc.index + 1), quotient_settlement__money((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) + acc.carry), 1000), (acc.digits + [remainder_settlement__money((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) + acc.carry), 1000)]));
  var work := if |a| >= |b| then a else b;
  var current := AddFold(0, 0, []);
  AddSuffixValue(a, b, work, current);
  assert a[if 0 < |a| then 0 else |a|..] == a;
  assert b[if 0 < |b| then 0 else |b|..] == b;
}

lemma AmountValueConcat(a: seq<int>, b: seq<int>)
  ensures var h := (n: int, d: int) => 1000*n + d;
    var p := (n: int, d: int) => 1000*n;
    Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(a+b)) ==
      Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(a)) +
      Std.Collections.Seq.FoldLeft(p, 1, a) * Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(b))
  decreases |a|
{
  if |a| > 0 {
    var d := a[0];
    var tail := a[1..];
    var h := (n: int, x: int) => 1000*n + x;
    var p := (n: int, x: int) => 1000*n;
    assert a == [d] + tail;
    assert a + b == [d] + (tail + b);
    AmountValueCons(d, tail);
    AmountValueCons(d, tail+b);
    AmountValueConcat(tail, b);
    PowerInitialScale(tail, 1, 1000);
    var w := Std.Collections.Seq.FoldLeft(p, 1, tail);
    var right := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(b));
    assert Std.Collections.Seq.FoldLeft(p, 1, a) == 1000 * w;
    assert 1000 * (w * right) == (1000 * w) * right;
    var left := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(tail));
    var joined := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(tail+b));
    assert joined == left + w*right;
    calc {
      Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(a+b));
      == d + 1000*joined;
      == d + 1000*left + (1000*w)*right;
      == Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(a)) + Std.Collections.Seq.FoldLeft(p, 1, a) * right;
    }
  } else {
    assert a == [] && a+b == b;
    assert reverseAmount(a) == [];

  }
}

lemma SubtractSuffixValue(a: seq<int>, b: seq<int>, work: seq<int>, current: SubtractFold)
  requires 0 <= current.index && current.index + |work| == |a|
  requires 0 <= current.borrow <= 1
  requires forall d :: d in a ==> 0 <= d < 1000
  requires forall d :: d in b ==> 0 <= d < 1000
  requires Std.Collections.Seq.FoldLeft((n: int, d: int) => 1000*n+d, 0, reverseAmount(b[if |a| < |b| then |a| else |b|..])) == 0
  ensures var h := (n: int, d: int) => 1000*n + d;
    var p := (n: int, d: int) => 1000*n;
    var remainingA := a[current.index..];
    var remainingB := b[if current.index < |b| then current.index else |b|..];
    var result := Std.Collections.Seq.FoldLeft((acc: SubtractFold, ignored: int) => SubtractFold((acc.index + 1), (if ((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow) < 0) then 1 else 0), (acc.digits + [(if ((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow) < 0) then ((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow) + 1000) else (((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow))])), current, work);
    |result.digits| == |current.digits| + |work| && result.digits[..|current.digits|] == current.digits &&
    0 <= result.borrow <= 1 &&
    (var tail := result.digits[|current.digits|..];
     Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(tail)) - result.borrow * Std.Collections.Seq.FoldLeft(p, 1, work) ==
       Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(remainingA)) -
       Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(remainingB)) - current.borrow)
  decreases |work|
{
  var f := (acc: SubtractFold, ignored: int) => SubtractFold((acc.index + 1), (if ((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow) < 0) then 1 else 0), (acc.digits + [(if ((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow) < 0) then ((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow) + 1000) else (((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow))]));
  var result := Std.Collections.Seq.FoldLeft(f, current, work);
  if |work| > 0 {
    var i := current.index;
    var j := i + 1;
    var da := a[i];
    var db := if i < |b| then b[i] else 0;
    assert da in a;
    if i < |b| { assert db in b; }
    assert 0 <= da < 1000 && 0 <= db < 1000;
    var difference := da - db - current.borrow;
    var borrow := if difference < 0 then 1 else 0;
    var digit := difference + 1000 * borrow;
    var next := f(current, work[0]);
    assert next.index == j && next.borrow == borrow && next.digits == current.digits + [digit];
    SubtractSuffixValue(a, b, work[1..], next);
    assert result == Std.Collections.Seq.FoldLeft(f, next, work[1..]);
    assert |result.digits| == |current.digits| + |work|;
    assert result.digits[..|next.digits|] == next.digits;
    assert result.digits[|current.digits|] == digit;
    var rest := result.digits[|next.digits|..];
    assert result.digits[|current.digits|..] == [digit] + rest;
    AmountValueCons(digit, rest);
    AmountSuffixValue(a, i);
    AmountSuffixValue(b, i);
    PowerInitialScale(work[1..], 1, 1000);
    var p := (n: int, d: int) => 1000*n;
    var w := Std.Collections.Seq.FoldLeft(p, 1, work[1..]);
    assert Std.Collections.Seq.FoldLeft(p, 1, work) == 1000 * w;
    assert result.borrow * (1000 * w) == 1000 * (result.borrow * w);
  }
}

lemma AmountValueSubtract(a: seq<int>, b: seq<int>)
  requires validAmount(a) && validAmount(b) && compareAmounts(a, b) >= 0
  ensures var h := (n: int, d: int) => 1000*n + d;
    Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(subtractAmounts(a, b))) ==
      Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(a)) - Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(b))
{
  var h := (n: int, d: int) => 1000*n + d;
  var p := (n: int, d: int) => 1000*n;
  var wa := Std.Collections.Seq.FoldLeft(p, 1, a);
  var va := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(a));
  var vb := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(b));
  AmountValueOrder(a, b);
  assert vb <= va;
  AmountValueConsRange(a);
  if |a| < |b| {
    var lo := b[..|a|];
    var hi := b[|a|..];
    assert lo + hi == b;
    assert forall d :: d in lo ==> d in b;
    assert forall d :: d in hi ==> d in b;
    PowerLengthOnly(a, lo, 1);
    AmountValueConsRange(lo);
    AmountValueConsRange(hi);
    AmountValueConcat(lo, hi);
    var vl := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(lo));
    var vh := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(hi));
    assert 0 <= vl && 0 <= vh;
    assert vb == vl + wa * vh;
    if vh > 0 { assert wa * vh >= wa; }
    assert vh == 0;
  }
  var f := (acc: SubtractFold, ignored: int) => SubtractFold((acc.index + 1), (if ((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow) < 0) then 1 else 0), (acc.digits + [(if ((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow) < 0) then ((((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow) + 1000) else (((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) - (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) - acc.borrow))]));
  var result := Std.Collections.Seq.FoldLeft(f, SubtractFold(0, 0, []), a);
  SubtractSuffixValue(a, b, a, SubtractFold(0, 0, []));
  assert a[0..] == a && b[if 0 < |b| then 0 else |b|..] == b;
  assert result.digits == subtractAmounts(a, b) && |result.digits| == |a|;
  lawSubtractionValid_ensures(a, b);
  AmountValueConsRange(result.digits);
  PowerLengthOnly(result.digits, a, 1);
  assert Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(result.digits)) < wa;
  assert result.borrow == 0;
}

lemma lawNumericOrderTotal_ensures(a: seq<int>, b: seq<int>)
  ensures (lawNumericOrderTotal(a, b) == true)
{
  if validAmount(a) && validAmount(b) {
    AmountValueOrder(a, b);
    AmountValueOrder(b, a);
  }
}

lemma lawNumericOrderTransitive_ensures(a: seq<int>, b: seq<int>, c: seq<int>)
  ensures (lawNumericOrderTransitive(a, b, c) == true)
{
  if validAmount(a) && validAmount(b) && validAmount(c) {
    AmountValueOrder(a, b);
    AmountValueOrder(b, c);
    AmountValueOrder(a, c);
  }
}

lemma lawAddOrder_ensures(a: seq<int>, b: seq<int>, c: seq<int>)
  ensures (lawAddOrder(a, b, c) == true)
{
  if validAmount(a) && validAmount(b) && validAmount(c) {
    lawAdditionValid_ensures(a, c);
    lawAdditionValid_ensures(b, c);
    AmountValueAdd(a, c);
    AmountValueAdd(b, c);
    AmountValueOrder(a, b);
    AmountValueOrder(addAmounts(a, c), addAmounts(b, c));
  }
}

lemma lawAddMonotone_ensures(a: seq<int>, b: seq<int>)
  ensures (lawAddMonotone(a, b) == true)
{
  if validAmount(a) && validAmount(b) {
    lawAdditionValid_ensures(a, b);
    AmountValueAdd(a, b);
    AmountValueConsRange(b);
    AmountValueOrder(addAmounts(a, b), a);
  }
}

lemma lawAddCongruence_ensures(a: seq<int>, b: seq<int>, c: seq<int>)
  ensures (lawAddCongruence(a, b, c) == true)
{
  if validAmount(a) && validAmount(b) && validAmount(c) && equalAmounts(a,b) {
    lawAddOrder_ensures(a, b, c);
    lawAddCommutative_ensures(c, a);
    lawAddCommutative_ensures(c, b);
  }
}

lemma lawAddAssociative_ensures(a: seq<int>, b: seq<int>, c: seq<int>)
  ensures (lawAddAssociative(a, b, c) == true)
{
  if validAmount(a) && validAmount(b) && validAmount(c) {
    var ab := addAmounts(a, b);
    var bc := addAmounts(b, c);
    lawAdditionValid_ensures(a, b);
    lawAdditionValid_ensures(b, c);
    lawAdditionValid_ensures(ab, c);
    lawAdditionValid_ensures(a, bc);
    AmountValueAdd(a, b);
    AmountValueAdd(b, c);
    AmountValueAdd(ab, c);
    AmountValueAdd(a, bc);
    AmountValueOrder(addAmounts(ab, c), addAmounts(a, bc));
  }
}

lemma lawSubtractionReconstructs_ensures(a: seq<int>, b: seq<int>)
  ensures (lawSubtractionReconstructs(a, b) == true)
{
  if validAmount(a) && validAmount(b) && compareAmounts(a,b) >= 0 {
    var difference := subtractAmounts(a,b);
    lawSubtractionValid_ensures(a,b);
    lawAdditionValid_ensures(difference,b);
    AmountValueSubtract(a,b);
    AmountValueAdd(difference,b);
    AmountValueOrder(addAmounts(difference,b),a);
  }
}

lemma lawSubtractCongruence_ensures(a: seq<int>, b: seq<int>, c: seq<int>)
  ensures (lawSubtractCongruence(a, b, c) == true)
{
  if validAmount(a) && validAmount(b) && validAmount(c) && equalAmounts(a,b) {
    lawEqualOrder_ensures(a,b,c);
    AmountValueOrder(a,b);
    if compareAmounts(a,c) >= 0 {
      lawSubtractionValid_ensures(a,c);
      lawSubtractionValid_ensures(b,c);
      AmountValueSubtract(a,c);
      AmountValueSubtract(b,c);
      AmountValueOrder(subtractAmounts(a,c),subtractAmounts(b,c));
    }
    if compareAmounts(c,a) >= 0 {
      lawSubtractionValid_ensures(c,a);
      lawSubtractionValid_ensures(c,b);
      AmountValueSubtract(c,a);
      AmountValueSubtract(c,b);
      AmountValueOrder(subtractAmounts(c,a),subtractAmounts(c,b));
    }
  }
}

lemma lawSubtractionAtMost_ensures(a: seq<int>, b: seq<int>)
  ensures (lawSubtractionAtMost(a, b) == true)
{
  if validAmount(a) && validAmount(b) && compareAmounts(a,b) >= 0 {
    lawSubtractionValid_ensures(a,b);
    AmountValueSubtract(a,b);
    AmountValueConsRange(b);
    AmountValueOrder(subtractAmounts(a,b),a);
  }
}
lemma ScaleSuffixValue(work: seq<int>, factor: int, current: ScaleFold)
  requires 0 <= factor < 1000 && 0 <= current.carry < 1000
  requires forall d :: d in work ==> 0 <= d < 1000
  ensures var h := (n: int, d: int) => 1000 * n + d;
    var result := Std.Collections.Seq.FoldLeft((acc: ScaleFold, digit: int) => ScaleFold(quotient_settlement__money(((digit * factor) + acc.carry), 1000), (acc.digits + [remainder_settlement__money(((digit * factor) + acc.carry), 1000)])), current, work);
    |result.digits| == |current.digits| + |work| && result.digits[..|current.digits|] == current.digits &&
    (var tail := result.digits[|current.digits|..];
      var out := if result.carry > 0 then tail + [result.carry] else tail;
      Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(out)) == factor * Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(work)) + current.carry)
  decreases |work|
{
  var h := (n: int, d: int) => 1000*n + d;
  var f := (acc: ScaleFold, digit: int) => ScaleFold(quotient_settlement__money(((digit * factor) + acc.carry), 1000), (acc.digits + [remainder_settlement__money(((digit * factor) + acc.carry), 1000)]));
  var full := Std.Collections.Seq.FoldLeft(f, current, work);
  if |work| > 0 {
    var digit := work[0];
    var rest := work[1..];
    assert digit in work;
    assert 0 <= digit < 1000;
    assert forall d :: d in rest ==> d in work;
    var combined := digit*factor + current.carry;
    assert 0 <= combined < 1000000;
    var low := combined % 1000;
    var next := f(current, digit);
    assert next.carry == combined / 1000 && next.digits == current.digits + [low];
    ScaleSuffixValue(rest, factor, next);
    assert full == Std.Collections.Seq.FoldLeft(f, next, rest);
    var k := |current.digits|;
    assert |next.digits| == k + 1;
    assert full.digits[..k+1] == current.digits + [low];
    assert full.digits[k] == low;
    var tail := full.digits[k..];
    var nextTail := full.digits[k+1..];
    assert tail == full.digits[k..k+1] + nextTail;
    assert full.digits[k..k+1] == [low];
    var out := if full.carry > 0 then tail + [full.carry] else tail;
    var nextOut := if full.carry > 0 then nextTail + [full.carry] else nextTail;
    assert out == [low] + nextOut;
    assert work == [digit] + rest;
    AmountValueCons(low, nextOut);
    AmountValueCons(digit, rest);
    var sub := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(rest));
    assert Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(nextOut)) == factor*sub + next.carry;
    assert combined == low + 1000*next.carry;
    LinearScaleStep(digit,factor,sub,current.carry,low,next.carry);
    var scaled := Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(out));
    assert scaled == low + 1000*(factor*sub + next.carry);
    assert Std.Collections.Seq.FoldLeft(h,0,reverseAmount(work)) == digit+1000*sub;
    assert scaled == factor*Std.Collections.Seq.FoldLeft(h,0,reverseAmount(work)) + current.carry;
  } else {
    assert work == [] && full == current;
    var tail := full.digits[|current.digits|..];
    var out := if full.carry > 0 then tail + [full.carry] else tail;
    assert tail == [] && reverseAmount([]) == [];
    if current.carry > 0 {
      assert out == [current.carry]+[];
      AmountValueCons(current.carry, []);
    }
    assert Std.Collections.Seq.FoldLeft(h,0,reverseAmount(out)) == current.carry;
  }
}

lemma AmountValueMultiplySmall(a: seq<int>, factor: int)
  requires forall d :: d in a ==> 0 <= d < 1000
  requires 0 <= factor < 1000
  ensures var h := (n: int, d: int) => 1000*n+d;
    Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(multiplySmall(a,factor))) ==
      factor * Std.Collections.Seq.FoldLeft(h, 0, reverseAmount(a))
{
  ScaleSuffixValue(a, factor, ScaleFold(0, []));
}

lemma PaddedValueZero(xs: seq<int>)
  requires forall d :: d in xs ==> d == 0
  ensures Std.Collections.Seq.FoldLeft((n: int, d: int) => 1000*n+d, 0, reverseAmount(xs)) == 0
  decreases |xs|
{
  if |xs| > 0 {
    assert xs[0] in xs;
    var rest := xs[1..];
    assert forall d :: d in rest ==> d in xs;
    PaddedValueZero(rest);
    assert xs == [0] + rest;
    AmountValueCons(0, rest);
  }
}

lemma AmountValueProductFold(a: seq<int>, work: seq<int>, current: ProductFold)
  requires validAmount(a) && validAmount(current.product)
  requires forall z :: z in current.prefix ==> z == 0
  requires forall d :: d in work ==> 0 <= d < 1000
  ensures var h := (n: int, d: int) => 1000*n+d;
    var w := (n: int, d: int) => 1000*n;
    var result := Std.Collections.Seq.FoldLeft((acc: ProductFold, digit: int) => ProductFold((acc.prefix + [0]), addAmounts(acc.product, (acc.prefix + multiplySmall(a, digit)))), current, work);
    Std.Collections.Seq.FoldLeft(h,0,reverseAmount(result.product)) ==
      Std.Collections.Seq.FoldLeft(h,0,reverseAmount(current.product)) + Std.Collections.Seq.FoldLeft(w,1,current.prefix) *
        Std.Collections.Seq.FoldLeft(h,0,reverseAmount(a)) * Std.Collections.Seq.FoldLeft(h,0,reverseAmount(work))
  decreases |work|
{
  if |work| > 0 {
    var f := (acc: ProductFold, digit: int) => ProductFold((acc.prefix + [0]), addAmounts(acc.product, (acc.prefix + multiplySmall(a, digit))));
    var h := (n: int, d: int) => 1000*n+d;
    var w := (n: int, d: int) => 1000*n;
    var digit := work[0];
    var rest := work[1..];
    assert digit in work;
    assert forall d :: d in rest ==> d in work;
    var next := f(current, digit);
    var scale := multiplySmall(a,digit);
    var shifted := current.prefix + scale;
    lawMultiplySmallValid_ensures(a,digit);
    forall d | d in shifted ensures 0 <= d < 1000 { if d in current.prefix { assert d == 0; } else { assert d in scale; } }
    assert validAmount(shifted);
    lawAdditionValid_ensures(current.product,shifted);
    assert next.product == addAmounts(current.product,shifted) && validAmount(next.product);
    assert forall d :: d in next.prefix ==> d in current.prefix || d == 0;
    AmountValueProductFold(a, rest, next);
    AmountValueAdd(current.product,shifted);
    AmountValueConcat(current.prefix,scale);
    PaddedValueZero(current.prefix);
    AmountValueMultiplySmall(a,digit);
    ProofLib.FoldLeftAppend(w,1,current.prefix,0);
    assert work == [digit] + rest;
    AmountValueCons(digit,rest);
    var result := Std.Collections.Seq.FoldLeft(f,current,work);
    assert result == Std.Collections.Seq.FoldLeft(f,next,rest);
    var shift := Std.Collections.Seq.FoldLeft(w,1,current.prefix);
    var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(a));
    var tail := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(rest));
    var prior := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(current.product));
    calc {
      Std.Collections.Seq.FoldLeft(h,0,reverseAmount(result.product));
      == prior + shift*digit*base + (1000*shift)*base*tail;
      == prior + shift*base*(digit+1000*tail);
      == prior + shift*base*Std.Collections.Seq.FoldLeft(h,0,reverseAmount(work));
    }
  }
}

lemma AmountValueMultiply(a: seq<int>, b: seq<int>)
  requires validAmount(a) && validAmount(b)
  ensures var h := (n: int, d: int) => 1000*n+d;
    Std.Collections.Seq.FoldLeft(h,0,reverseAmount(multiplyAmounts(a,b))) ==
      Std.Collections.Seq.FoldLeft(h,0,reverseAmount(a)) * Std.Collections.Seq.FoldLeft(h,0,reverseAmount(b))
{
  assert zero == [0] && validAmount(zero);
  PaddedValueZero(zero);
  AmountValueProductFold(a,b,ProductFold([],zero));
}

lemma LinearScaleStep(digit: int, factor: int, rest: int, incoming: int, low: int, outgoing: int)
  requires digit*factor+incoming == low+1000*outgoing
  ensures low+1000*(factor*rest+outgoing) == factor*(digit+1000*rest)+incoming
{
}
lemma QuotientCandidateNumeric(digit: int, bit: int, partial: seq<int>, divisor: seq<int>)
  requires validAmount(partial) && validAmount(divisor)
  requires digit >= 0 && bit >= 0
  ensures var h := (n: int, d: int) => 1000*n+d;
    var amount := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(partial));
    var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(divisor));
    quotientCandidate(digit,bit,partial,divisor) == (if digit+bit < 1000 && (digit+bit)*base <= amount then digit+bit else digit)
{
  if digit+bit < 1000 {
    var n := digit+bit;
    lawMultiplySmallValid_ensures(divisor,n);
    AmountValueMultiplySmall(divisor,n);
    AmountValueOrder(multiplySmall(divisor,n),partial);
  }
}

lemma QuotientCandidateFloor(digit: int, bit: int, partial: seq<int>, divisor: seq<int>, expected: int)
  requires validAmount(partial) && validAmount(divisor)
  requires var h := (n: int, d: int) => 1000*n+d;
    var amount := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(partial));
    var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(divisor));
    base > 0 && expected*base <= amount < (expected+1)*base
  requires 0 <= expected < 1000 && 0 <= digit <= expected && 0 < bit && expected < digit+2*bit
  ensures digit <= quotientCandidate(digit,bit,partial,divisor) <= expected
  ensures expected < quotientCandidate(digit,bit,partial,divisor)+bit
{
  var h := (n: int, d: int) => 1000*n+d;
  var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(divisor));
  var amount := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(partial));
  QuotientCandidateNumeric(digit,bit,partial,divisor);
  CandidateFitsFloor(digit,bit,expected,base,amount);
  var candidate := digit+bit;
  assert (candidate*base <= amount) == (candidate <= expected);
  if candidate <= expected {
    assert candidate < 1000;
    assert quotientCandidate(digit,bit,partial,divisor) == candidate;
  } else {
    assert quotientCandidate(digit,bit,partial,divisor) == digit;
  }
}

lemma QuotientFloor(partial: seq<int>, divisor: seq<int>)
  requires validAmount(partial) && validAmount(divisor)
  requires var h := (n: int, d: int) => 1000*n+d;
    var amount := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(partial));
    var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(divisor));
    base > 0 && 0 <= amount < 1000*base
  ensures var h := (n: int, d: int) => 1000*n+d;
    var amount := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(partial));
    var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(divisor));
    quotientDigit(partial,divisor) * base <= amount < (quotientDigit(partial,divisor)+1)*base
{
  var h := (n: int, d: int) => 1000*n+d;
  var f := (digit: int, bit: int) => quotientCandidate(digit, bit, partial, divisor);
  var amount := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(partial));
  var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(divisor));
  var expected := amount / base;
  assert expected*base <= amount < (expected+1)*base;
  assert 0 <= expected < 1000;
  QuotientCandidateFloor(0,512,partial,divisor,expected);
  var b512 := f(0,512);
  QuotientCandidateFloor(b512,256,partial,divisor,expected);
  var b256 := f(b512,256);
  QuotientCandidateFloor(b256,128,partial,divisor,expected);
  var b128 := f(b256,128);
  QuotientCandidateFloor(b128,64,partial,divisor,expected);
  var b64 := f(b128,64);
  QuotientCandidateFloor(b64,32,partial,divisor,expected);
  var b32 := f(b64,32);
  QuotientCandidateFloor(b32,16,partial,divisor,expected);
  var b16 := f(b32,16);
  QuotientCandidateFloor(b16,8,partial,divisor,expected);
  var b8 := f(b16,8);
  QuotientCandidateFloor(b8,4,partial,divisor,expected);
  var b4 := f(b8,4);
  QuotientCandidateFloor(b4,2,partial,divisor,expected);
  var b2 := f(b4,2);
  QuotientCandidateFloor(b2,1,partial,divisor,expected);
  assert f(b2,1) == expected;
  assert quotientBits == [512,256,128,64,32,16,8,4,2,1];
  QuotientFixedFold(f, 0, b512, b256, b128, b64, b32, b16, b8, b4, b2);
}

lemma QuotientFixedFold(f: (int,int) -> int, initial: int, b512: int, b256: int, b128: int, b64: int,
  b32: int, b16: int, b8: int, b4: int, b2: int)
  requires b512 == f(initial,512) && b256 == f(b512,256) && b128 == f(b256,128) && b64 == f(b128,64)
  requires b32 == f(b64,32) && b16 == f(b32,16) && b8 == f(b16,8) && b4 == f(b8,4) && b2 == f(b4,2)
  ensures Std.Collections.Seq.FoldLeft(f,initial,[512,256,128,64,32,16,8,4,2,1]) == f(b2,1)
{
  calc {
    Std.Collections.Seq.FoldLeft(f,initial,[512,256,128,64,32,16,8,4,2,1]);
    == Std.Collections.Seq.FoldLeft(f,b512,[256,128,64,32,16,8,4,2,1]);
    == Std.Collections.Seq.FoldLeft(f,b256,[128,64,32,16,8,4,2,1]);
    == Std.Collections.Seq.FoldLeft(f,b128,[64,32,16,8,4,2,1]);
    == Std.Collections.Seq.FoldLeft(f,b64,[32,16,8,4,2,1]);
    == Std.Collections.Seq.FoldLeft(f,b32,[16,8,4,2,1]);
    == Std.Collections.Seq.FoldLeft(f,b16,[8,4,2,1]);
    == Std.Collections.Seq.FoldLeft(f,b8,[4,2,1]);
    == Std.Collections.Seq.FoldLeft(f,b4,[2,1]);
    == Std.Collections.Seq.FoldLeft(f,b2,[1]);
    == f(b2,1);
  }
}

lemma CandidateFitsFloor(digit: int, bit: int, expected: int, base: int, amount: int)
  requires base > 0 && expected*base <= amount < (expected+1)*base
  ensures (digit+bit)*base <= amount <==> digit+bit <= expected
{
  var candidate := digit+bit;
  if candidate <= expected {
    assert candidate*base <= expected*base;
  } else {
    assert expected+1 <= candidate;
    assert (expected+1)*base <= candidate*base;
  }
}
lemma ReverseAmountInvolution(xs: seq<int>)
  ensures reverseAmount(reverseAmount(xs)) == xs
  decreases |xs|
{
  if |xs| > 0 {
    var d := xs[0];
    var rest := xs[1..];
    var push := (acc: seq<int>, digit: int) => ([digit] + acc);
    assert xs == [d] + rest;
    assert push([], d) == [d];
    assert reverseAmount(xs) == Std.Collections.Seq.FoldLeft(push, [d], rest);
    ReverseOneAtEnd(push, rest, d);
    assert reverseAmount(xs) == reverseAmount(rest) + [d];
    ReverseAmountAppend(reverseAmount(rest), d);
    ReverseAmountInvolution(rest);
  }
}

lemma DivisionNumericalStep(current: Division, digit: int, divisor: seq<int>)
  requires validAmount(current.remainder) && validAmount(divisor)
  requires 0 <= digit < 1000
  requires var h := (n: int, d: int) => 1000*n+d;
    var rem := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(current.remainder));
    var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(divisor));
    0 <= rem < base
  ensures var h := (n: int, d: int) => 1000*n+d;
    var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(divisor));
    var rem := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(current.remainder));
    var next := divisionStep(current,digit,divisor);
    var nextRem := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(next.remainder));
    validAmount(next.remainder) && 0 <= nextRem < base &&
    next.quotient == current.quotient + [quotientDigit([digit]+current.remainder,divisor)] &&
    1000*rem+digit == quotientDigit([digit]+current.remainder,divisor)*base + nextRem
{
  var h := (n: int, d: int) => 1000*n+d;
  var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(divisor));
  var rem := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(current.remainder));
  var partial := [digit] + current.remainder;
  assert validAmount(partial);
  AmountValueCons(digit,current.remainder);
  var value := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(partial));
  assert value == 1000*rem+digit;
  assert 0 <= value < 1000*base;
  QuotientFloor(partial,divisor);
  var q := quotientDigit(partial,divisor);
  BoundedQuotientDigit(partial,divisor);
  var product := multiplySmall(divisor,q);
  lawMultiplySmallValid_ensures(divisor,q);
  AmountValueMultiplySmall(divisor,q);
  AmountValueOrder(partial,product);
  assert compareAmounts(partial,product) >= 0;
  AmountValueSubtract(partial,product);
  lawSubtractionValid_ensures(partial,product);
}

// Separate the induction over an opaque step from its arithmetic contract.
lemma DivisionReconstructFold(work: seq<int>, current: Division, divisor: seq<int>, original: int)
  requires validAmount(current.remainder) && validAmount(divisor)
  requires forall d :: d in work ==> 0 <= d < 1000
  requires var h := (n: int, d: int) => 1000*n+d;
    var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(divisor));
    var rem := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(current.remainder));
    0 <= rem < base && original == base*Std.Collections.Seq.FoldLeft(h,0,current.quotient) + rem
  ensures var h := (n: int, d: int) => 1000*n+d;
    var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(divisor));
    var result := Std.Collections.Seq.FoldLeft((acc: Division, digit: int) => divisionStep(acc,digit,divisor),current,work);
    var rem := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(result.remainder));
    0 <= rem < base && Std.Collections.Seq.FoldLeft(h,original,work) == base*Std.Collections.Seq.FoldLeft(h,0,result.quotient) + rem
{
  var h := (n: int, d: int) => 1000*n+d;
  var f := (acc: Division, digit: int) => divisionStep(acc,digit,divisor);
  var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(divisor));
  var num := (acc: Division) => Std.Collections.Seq.FoldLeft(h,0,reverseAmount(acc.remainder));
  var q := (acc: Division) => Std.Collections.Seq.FoldLeft(h,0,acc.quotient);
  var stateOk := (acc: Division) => validAmount(acc.remainder) && 0 <= num(acc) < base;
  var value := (acc: Division) => base*q(acc) + num(acc);
  forall acc: Division, d: int | stateOk(acc) && 0 <= d < 1000
    ensures stateOk(f(acc,d)) && value(f(acc,d)) == h(value(acc),d)
  {
    DivisionStepValue(acc,d,divisor);
  }
  FoldTracksHorner(f,stateOk,value,current,work);
  var result := Std.Collections.Seq.FoldLeft(f,current,work);
  assert value(current) == original && stateOk(result);
}

lemma DivisionStepValue(current: Division, digit: int, divisor: seq<int>)
  requires validAmount(current.remainder) && validAmount(divisor)
  requires 0 <= digit < 1000
  requires var h := (n: int, d: int) => 1000*n+d;
    var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(divisor));
    var rem := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(current.remainder));
    0 <= rem < base
  ensures var h := (n: int, d: int) => 1000*n+d;
    var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(divisor));
    var after := divisionStep(current,digit,divisor);
    var rem := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(after.remainder));
    var priorRem := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(current.remainder));
    validAmount(after.remainder) && 0 <= rem < base &&
    base*Std.Collections.Seq.FoldLeft(h,0,after.quotient)+rem ==
      1000*(base*Std.Collections.Seq.FoldLeft(h,0,current.quotient)+priorRem)+digit
{
  var h := (n: int, d: int) => 1000*n+d;
  var next := divisionStep(current,digit,divisor);
  var q := quotientDigit([digit]+current.remainder,divisor);
  DivisionNumericalStep(current,digit,divisor);
  ProofLib.FoldLeftAppend(h,0,current.quotient,q);
  var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(divisor));
  var nextRem := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(next.remainder));
  var prior := Std.Collections.Seq.FoldLeft(h,0,current.quotient);
  var priorRem := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(current.remainder));
  assert 1000*priorRem+digit == q*base+nextRem;
  FoldQuotientEquation(base,prior,q,base*prior+priorRem,priorRem,nextRem,digit);
}

lemma FoldTracksHorner<T>(step: (T,int) -> T, good: T -> bool, value: T -> int, current: T, work: seq<int>)
  requires good(current)
  requires forall d :: d in work ==> 0 <= d < 1000
  requires forall acc, d :: good(acc) && 0 <= d < 1000 ==>
    good(step(acc,d)) && value(step(acc,d)) == 1000*value(acc)+d
  ensures good(Std.Collections.Seq.FoldLeft(step,current,work))
  ensures value(Std.Collections.Seq.FoldLeft(step,current,work)) ==
    Std.Collections.Seq.FoldLeft((n: int, d: int) => 1000*n+d,value(current),work)
  decreases |work|
{
  if |work| > 0 {
    var d := work[0];
    var tail := work[1..];
    assert d in work;
    assert forall x :: x in tail ==> x in work;
    assert good(step(current,d));
    assert value(step(current,d)) == 1000*value(current)+d;
    FoldTracksHorner(step,good,value,step(current,d),tail);
  }
}

lemma FoldQuotientEquation(base: int, prior: int, q: int, original: int, priorRem: int, nextRem: int, digit: int)
  requires original == base*prior + priorRem
  requires 1000*priorRem+digit == q*base+nextRem
  ensures 1000*original+digit == base*(1000*prior+q)+nextRem
{
}

lemma DivisionValue(a: seq<int>, b: seq<int>)
  requires validAmount(a) && validAmount(b) && positiveAmount(b)
  ensures var h := (n: int, d: int) => 1000*n+d;
    var result := divideAmounts(a,b);
    var base := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(b));
    var quotient := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(result.quotient));
    var rem := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(result.remainder));
    0 <= rem < base && Std.Collections.Seq.FoldLeft(h,0,reverseAmount(a)) == quotient*base + rem
{
  var h := (n: int, d: int) => 1000*n+d;
  assert zero == [0] && validAmount(zero);
  PaddedValueZero(zero);
  AmountValueOrder(b,zero);
  assert Std.Collections.Seq.FoldLeft(h,0,reverseAmount(b)) > 0;
  ValidReverse([],a);
  var digits := reverseAmount(a);
  IndexedDigitsValid(digits);
  var start := Division([],zero);
  var result := Std.Collections.Seq.FoldLeft((acc: Division, digit: int) => divisionStep(acc,digit,b),start,digits);
  DivisionReconstructFold(digits,start,b,0);
  ReverseAmountInvolution(result.quotient);
}

lemma lawDivisionRemainder_ensures(a: seq<int>, b: seq<int>)
  ensures (lawDivisionRemainder(a, b) == true)
{
  if validAmount(a) && validAmount(b) && positiveAmount(b) {
    lawDivisionValid_ensures(a,b);
    DivisionValue(a,b);
    AmountValueOrder(divideAmounts(a,b).remainder,b);
  }
}

lemma lawDivisionReconstructs_ensures(a: seq<int>, b: seq<int>)
  ensures (lawDivisionReconstructs(a, b) == true)
{
  if validAmount(a) && validAmount(b) && positiveAmount(b) {
    var result := divideAmounts(a,b);
    lawDivisionValid_ensures(a,b);
    DivisionValue(a,b);
    var product := multiplyAmounts(result.quotient,b);
    lawMultiplyValid_ensures(result.quotient,b);
    AmountValueMultiply(result.quotient,b);
    lawAdditionValid_ensures(product,result.remainder);
    AmountValueAdd(product,result.remainder);
    AmountValueOrder(addAmounts(product,result.remainder),a);
  }
}
lemma lawFullPrivateConservation_ensures(a: seq<int>)
  ensures (lawFullPrivateConservation(a) == true)
{
  if privateSplitPossible(a) {
    var b := [4];
    var h := (n: int, d: int) => 1000*n+d;
    var result := divideAmounts(a,b);
    assert validAmount(a) && validAmount(b);
    AmountValueCons(4,[]);
    PaddedValueZero(zero);
    AmountValueOrder(b,zero);
    assert positiveAmount(b);
    lawDivisionValid_ensures(a,b);
    DivisionValue(a,b);
    AmountValueOrder(result.remainder,zero);
    var fee := privateFeeAmount(a);
    var principal := privateResearcherAmount(a);
    assert fee == result.quotient;
    lawPrivateAmountsValid_ensures(a);
    AmountValueMultiplySmall(fee,3);
    AmountValueAdd(fee,principal);
    lawAdditionValid_ensures(fee,principal);
    AmountValueOrder(addAmounts(fee,principal),a);
  }
}

lemma lawFullOrdinaryConservation_ensures(a: seq<int>)
  ensures (lawFullOrdinaryConservation(a) == true)
{
  if validAmount(a) {
    var b := [50];
    var h := (n: int, d: int) => 1000*n+d;
    var result := divideAmounts(a,b);
    assert validAmount(b);
    AmountValueCons(50,[]);
    AmountValueCons(1,[]);
    PaddedValueZero(zero);
    AmountValueOrder(b,zero);
    assert positiveAmount(b);
    lawDivisionValid_ensures(a,b);
    DivisionValue(a,b);
    AmountValueOrder(result.remainder,zero);
    lawOrdinaryAmountsValid_ensures(a);
    var fee := ordinaryFeeAmount(a);
    var q := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(result.quotient));
    var rem := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(result.remainder));
    var amount := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(a));
    var charged := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(fee));
    AmountValueConsRange(result.quotient);
    if rem > 0 {
      assert positiveAmount(result.remainder);
      AmountValueAdd(result.quotient,[1]);
      assert charged == q+1;
    } else {
      assert rem == 0 && !positiveAmount(result.remainder);
      assert charged == q;
    }
    assert amount == 50*q+rem && charged <= amount;
    AmountValueOrder(a,fee);
    assert compareAmounts(a,fee) >= 0;
    lawSubtractionReconstructs_ensures(a,fee);
    lawAddCommutative_ensures(fee,ordinaryNetAmount(a));
  }
}
lemma lawMultiplyCongruence_ensures(a: seq<int>, b: seq<int>, c: seq<int>)
  ensures (lawMultiplyCongruence(a, b, c) == true)
{
  if validAmount(a) && validAmount(b) && validAmount(c) && equalAmounts(a,b) {
    AmountValueOrder(a,b);
    lawMultiplyValid_ensures(a,c);
    lawMultiplyValid_ensures(b,c);
    lawMultiplyValid_ensures(c,a);
    lawMultiplyValid_ensures(c,b);
    AmountValueMultiply(a,c);
    AmountValueMultiply(b,c);
    AmountValueMultiply(c,a);
    AmountValueMultiply(c,b);
    AmountValueOrder(multiplyAmounts(a,c),multiplyAmounts(b,c));
    AmountValueOrder(multiplyAmounts(c,a),multiplyAmounts(c,b));
  }
}

lemma lawMultiplyCommutative_ensures(a: seq<int>, b: seq<int>)
  ensures (lawMultiplyCommutative(a, b) == true)
{
  if validAmount(a) && validAmount(b) {
    lawMultiplyValid_ensures(a,b);
    lawMultiplyValid_ensures(b,a);
    AmountValueMultiply(a,b);
    AmountValueMultiply(b,a);
    AmountValueOrder(multiplyAmounts(a,b),multiplyAmounts(b,a));
  }
}

lemma lawMultiplyAddition_ensures(a: seq<int>, b: seq<int>, c: seq<int>)
  ensures (lawMultiplyAddition(a, b, c) == true)
{
  if validAmount(a) && validAmount(b) && validAmount(c) {
    var sum := addAmounts(b,c);
    var ab := multiplyAmounts(a,b);
    var ac := multiplyAmounts(a,c);
    lawAdditionValid_ensures(b,c);
    lawMultiplyValid_ensures(a,b);
    lawMultiplyValid_ensures(a,c);
    lawMultiplyValid_ensures(a,sum);
    lawAdditionValid_ensures(ab,ac);
    AmountValueAdd(b,c);
    AmountValueMultiply(a,sum);
    AmountValueMultiply(a,b);
    AmountValueMultiply(a,c);
    AmountValueAdd(ab,ac);
    AmountValueOrder(multiplyAmounts(a,sum),addAmounts(ab,ac));
  }
}

lemma lawMultiplyCancellation_ensures(a: seq<int>, b: seq<int>, c: seq<int>)
  ensures (lawMultiplyCancellation(a, b, c) == true)
{
  if validAmount(a) && validAmount(b) && validAmount(c) && positiveAmount(c) {
    var h := (n: int, d: int) => 1000*n+d;
    PaddedValueZero(zero);
    AmountValueOrder(c,zero);
    AmountValueOrder(a,b);
    lawMultiplyValid_ensures(a,c);
    lawMultiplyValid_ensures(b,c);
    AmountValueMultiply(a,c);
    AmountValueMultiply(b,c);
    AmountValueOrder(multiplyAmounts(a,c),multiplyAmounts(b,c));
    var first := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(a));
    var second := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(b));
    var factor := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(c));
    if first < second { assert first*factor < second*factor; }
    else if first > second { assert first*factor > second*factor; }
  }
}

lemma lawDivisionByOne_ensures(a: seq<int>)
  ensures (lawDivisionByOne(a) == true)
{
  if validAmount(a) {
    var h := (n: int, d: int) => 1000*n+d;
    var result := divideAmounts(a,[1]);
    assert [1] == [1]+[];
    AmountValueCons(1,[]);
    PaddedValueZero(zero);
    AmountValueOrder([1],zero);
    assert validAmount([1]) && positiveAmount([1]);
    lawDivisionValid_ensures(a,[1]);
    DivisionValue(a,[1]);
    var value := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(a));
    var quot := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(result.quotient));
    var rem := Std.Collections.Seq.FoldLeft(h,0,reverseAmount(result.remainder));
    assert value == quot+rem && 0 <= rem < 1;
    AmountValueOrder(result.quotient,a);
    AmountValueOrder(result.remainder,zero);
  }
}

lemma lawMultiplyZero_ensures(a: seq<int>)
  ensures (lawMultiplyZero(a) == true)
{
  if validAmount(a) {
    assert zero == [0] && validAmount(zero);
    PaddedValueZero(zero);
    lawMultiplyCommutative_ensures(a,zero);
    lawMultiplyValid_ensures(a,zero);
    lawMultiplyValid_ensures(zero,a);
    AmountValueMultiply(a,zero);
    AmountValueMultiply(zero,a);
    AmountValueOrder(multiplyAmounts(a,zero),zero);
    AmountValueOrder(multiplyAmounts(zero,a),zero);
  }
}

lemma lawUnitGap_ensures(a: seq<int>, b: seq<int>)
  ensures (lawUnitGap(a, b) == true)
{
  if validAmount(a) && validAmount(b) && compareAmounts(a,b) < 0 {
    var h := (n: int, d: int) => 1000*n+d;
    assert validAmount([1]) && [1] == [1]+[];
    assert reverseAmount([]) == [];
    AmountValueCons(1,[]);
    assert Std.Collections.Seq.FoldLeft(h,0,reverseAmount([1])) == 1;
    lawAdditionValid_ensures(a,[1]);
    AmountValueAdd(a,[1]);
    AmountValueOrder(a,b);
    AmountValueOrder(addAmounts(a,[1]),b);
  }
}

lemma lawLegacyFloorOneBelow_ensures(a: seq<int>)
  ensures (lawLegacyFloorOneBelow(a) == true)
{
  lawEqualReflexive_ensures(ordinaryFeeAmount(a));
}
