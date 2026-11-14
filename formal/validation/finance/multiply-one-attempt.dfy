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

lemma ScaleOne(a: seq<int>)
  requires validAmount(a)
  ensures multiplySmall(a, 1) == a
{
  var f := (acc: ScaleFold, digit: int) => ScaleFold(quotient_settlement__money(((digit * 1) + acc.carry), 1000), (acc.digits + [remainder_settlement__money(((digit * 1) + acc.carry), 1000)]));
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
  assert Std.Collections.Seq.FoldLeft(f, ScaleFold(0, []), a) == ScaleFold(0, a);
  reveal multiplySmall();
  assert multiplySmall(a, 1) ==
    (if Std.Collections.Seq.FoldLeft(f, ScaleFold(0, []), a).carry > 0
     then Std.Collections.Seq.FoldLeft(f, ScaleFold(0, []), a).digits + [Std.Collections.Seq.FoldLeft(f, ScaleFold(0, []), a).carry]
     else Std.Collections.Seq.FoldLeft(f, ScaleFold(0, []), a).digits);
  assert multiplySmall(a, 1) == a;
}

lemma AddZeroOnLeft(a: seq<int>)
  requires validAmount(a)
  ensures addAmounts(zero, a) == a
{
  var f := (acc: AddFold, ignored: int) => AddFold((acc.index + 1), quotient_settlement__money((((if ((0 <= acc.index) && (acc.index < |zero|)) then zero[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0)) + acc.carry), 1000), (acc.digits + [remainder_settlement__money((((if ((0 <= acc.index) && (acc.index < |zero|)) then zero[acc.index] else 0) + (if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0)) + acc.carry), 1000)]));
  forall k, digit | 0 <= k < |a|
    ensures f(AddFold(k, 0, a[..k]), digit) == AddFold(k + 1, 0, a[..k + 1])
  {
    assert a[k] in a;
    assert 0 <= a[k] < 1000;
    assert quotient_settlement__money(a[k], 1000) == 0;
    assert remainder_settlement__money(a[k], 1000) == a[k];
    assert a[..k] + [a[k]] == a[..k + 1];
  }
  FoldCopiesDigits(f, a, |a|);
  if |a| == 1 {
    assert a == [a[0]];
  }
  assert |a| >= 1 && |zero| == 1;
  assert (if |zero| >= |a| then zero else a) == (if |a| == 1 then zero else a);
  if |a| == 1 {
    ProofLib.FoldLeftAppend(f, AddFold(0, 0, []), [], 0);
    ProofLib.FoldLeftAppend(f, AddFold(0, 0, []), [], a[0]);
    assert Std.Collections.Seq.FoldLeft(f, AddFold(0, 0, []), zero) == f(AddFold(0, 0, []), 0);
    assert Std.Collections.Seq.FoldLeft(f, AddFold(0, 0, []), a) == f(AddFold(0, 0, []), a[0]);
    assert f(AddFold(0, 0, []), 0) == f(AddFold(0, 0, []), a[0]);
  }
  reveal addAmounts();
  assert addAmounts(zero, a) ==
    (if Std.Collections.Seq.FoldLeft(f, AddFold(0, 0, []), (if |zero| >= |a| then zero else a)).carry > 0
     then Std.Collections.Seq.FoldLeft(f, AddFold(0, 0, []), (if |zero| >= |a| then zero else a)).digits + [Std.Collections.Seq.FoldLeft(f, AddFold(0, 0, []), (if |zero| >= |a| then zero else a)).carry]
     else Std.Collections.Seq.FoldLeft(f, AddFold(0, 0, []), (if |zero| >= |a| then zero else a)).digits);
  assert addAmounts(zero, a) == a;
}

lemma lawMultiplyOne_ensures(a: seq<int>)
  ensures (lawMultiplyOne(a) == true)
{
  if validAmount(a) {
    ScaleOne(a);
    AddZeroOnLeft(a);
    var f := (acc: ProductFold, digit: int) => ProductFold((acc.prefix + [0]), addAmounts(acc.product, (acc.prefix + multiplySmall(a, digit))));
    ProofLib.FoldLeftAppend(f, ProductFold([], zero), [], 1);
    assert Std.Collections.Seq.FoldLeft(f, ProductFold([], zero), []) == ProductFold([], zero);
    reveal multiplyAmounts();
    assert multiplyAmounts(a, [1]) == addAmounts(zero, a);
    lawEqualReflexive_ensures(a);
  }
}
