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
