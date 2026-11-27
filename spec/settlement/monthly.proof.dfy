lemma ValidMonthlySum(shares: seq<settlement__allocation_Share>, start: seq<int>)
  requires settlement__money_validAmount(start)
  requires forall share :: share in shares ==> settlement__money_validAmount(share.amount)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((sum: settlement__money_Amount, share: settlement__allocation_Share) => settlement__money_addAmounts(sum, share.amount), start, shares))
  decreases |shares|
{
  if |shares| > 0 {
    settlement__money_lawAdditionValid_ensures(start, shares[0].amount);
    ValidMonthlySum(shares[1..], settlement__money_addAmounts(start, shares[0].amount));
  }
}

lemma MonthlySumPositivity(shares: seq<settlement__allocation_Share>, start: seq<int>)
  requires settlement__money_validAmount(start)
  requires forall share :: share in shares ==> settlement__money_validAmount(share.amount)
  ensures settlement__money_positiveAmount(Std.Collections.Seq.FoldLeft((sum: settlement__money_Amount, share: settlement__allocation_Share) => settlement__money_addAmounts(sum, share.amount), start, shares)) ==
    (settlement__money_positiveAmount(start) || (exists share :: (share in shares && settlement__money_positiveAmount(share.amount))))
  decreases |shares|
{
  if |shares| > 0 {
    var next := settlement__money_addAmounts(start, shares[0].amount);
    settlement__money_lawAdditionValid_ensures(start, shares[0].amount);
    settlement__money_lawPositiveAddition_ensures(start, shares[0].amount);
    MonthlySumPositivity(shares[1..], next);
    assert shares == [shares[0]] + shares[1..];
  }
}

lemma MonthlyAllocatedTotalValid(shares: seq<settlement__allocation_Share>)
  requires forall s :: s in shares ==> settlement__money_validAmount(s.amount)
  ensures settlement__money_validAmount(settlement__allocation_allocatedTotal(shares))
{
  hide *;
  reveal settlement__allocation_allocatedTotal, settlement__money_validAmount, settlement__money_zero;
  ValidMonthlySum(shares, settlement__money_zero);
}

lemma MonthlyEqualTrans(a: seq<int>, b: seq<int>, c: seq<int>)
  requires settlement__money_equalAmounts(a, b) && settlement__money_equalAmounts(b, c)
  ensures settlement__money_equalAmounts(a, c)
{
  hide *;
  reveal settlement__money_lawEqualSubstitution;
  settlement__money_lawEqualSubstitution_ensures(a, b, c);
}

lemma MonthlyZeroValid()
  ensures settlement__money_validAmount(settlement__money_zero)
  ensures settlement__money_equalAmounts(settlement__money_zero, settlement__money_zero)
{
  hide *;
  reveal settlement__money_validAmount, settlement__money_zero, settlement__money_lawEqualReflexive;
  settlement__money_lawEqualReflexive_ensures(settlement__money_zero);
}

lemma MonthlyAllocatedTotalSingleton(s: settlement__allocation_Share)
  ensures settlement__allocation_allocatedTotal([s]) == settlement__money_addAmounts(settlement__money_zero, s.amount)
{
  hide *;
  reveal Std.Collections.Seq.FoldLeft, settlement__allocation_allocatedTotal;
  var f := (sum: settlement__money_Amount, share: settlement__allocation_Share) => settlement__money_addAmounts(sum, share.amount);
  assert [s][0] == s && [s][1..] == [];
  assert Std.Collections.Seq.FoldLeft(f, settlement__money_zero, [s]) == Std.Collections.Seq.FoldLeft(f, f(settlement__money_zero, s), []);
}

lemma MonthlyFoldLeftConcat<A, T>(f: (A, T) -> A, init: A, a: seq<T>, b: seq<T>)
  ensures Std.Collections.Seq.FoldLeft(f, init, a + b) == Std.Collections.Seq.FoldLeft(f, Std.Collections.Seq.FoldLeft(f, init, a), b)
  decreases |a|
{
  hide *;
  reveal Std.Collections.Seq.FoldLeft;
  if |a| == 0 {
    assert a + b == b;
  } else {
    assert (a + b)[0] == a[0];
    assert (a + b)[1..] == a[1..] + b;
    MonthlyFoldLeftConcat(f, f(init, a[0]), a[1..], b);
  }
}

lemma MonthlyAllocatedTotalShift(shares: seq<settlement__allocation_Share>, start: seq<int>)
  requires settlement__money_validAmount(start)
  requires forall s :: s in shares ==> settlement__money_validAmount(s.amount)
  ensures settlement__money_equalAmounts(
    Std.Collections.Seq.FoldLeft((sum: settlement__money_Amount, share: settlement__allocation_Share) => settlement__money_addAmounts(sum, share.amount), start, shares),
    settlement__money_addAmounts(start, settlement__allocation_allocatedTotal(shares)))
  decreases |shares|
{
  hide *;
  reveal Std.Collections.Seq.FoldLeft, settlement__allocation_allocatedTotal, settlement__money_lawZeroIdentity, settlement__money_lawEqualSymmetric, settlement__money_lawAdditionValid, settlement__money_lawAddCommutative, settlement__money_lawAddCongruence, settlement__money_lawAddAssociative;
  MonthlyZeroValid();
  var f := (sum: settlement__money_Amount, share: settlement__allocation_Share) => settlement__money_addAmounts(sum, share.amount);
  if |shares| == 0 {
    settlement__money_lawZeroIdentity_ensures(start);
    settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(start, settlement__money_zero), start);
  } else {
    var s0 := shares[0].amount;
    var rest := shares[1..];
    var next := settlement__money_addAmounts(start, s0);
    var z0 := settlement__money_addAmounts(settlement__money_zero, s0);
    settlement__money_lawAdditionValid_ensures(start, s0);
    settlement__money_lawAdditionValid_ensures(settlement__money_zero, s0);
    MonthlyAllocatedTotalValid(rest);
    var rtot := settlement__allocation_allocatedTotal(rest);
    MonthlyAllocatedTotalShift(rest, next);
    MonthlyAllocatedTotalShift(rest, z0);
    settlement__money_lawAddCommutative_ensures(settlement__money_zero, s0);
    settlement__money_lawZeroIdentity_ensures(s0);
    settlement__money_lawAddCongruence_ensures(z0, s0, rtot);
    var tot := settlement__allocation_allocatedTotal(shares);
    MonthlyEqualTrans(tot, settlement__money_addAmounts(z0, rtot), settlement__money_addAmounts(s0, rtot));
    settlement__money_lawEqualSymmetric_ensures(tot, settlement__money_addAmounts(s0, rtot));
    settlement__money_lawAdditionValid_ensures(s0, rtot);
    MonthlyAllocatedTotalValid(shares);
    settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(s0, rtot), tot, start);
    settlement__money_lawAddAssociative_ensures(start, s0, rtot);
    MonthlyEqualTrans(Std.Collections.Seq.FoldLeft(f, start, shares), settlement__money_addAmounts(next, rtot), settlement__money_addAmounts(start, settlement__money_addAmounts(s0, rtot)));
    MonthlyEqualTrans(Std.Collections.Seq.FoldLeft(f, start, shares), settlement__money_addAmounts(start, settlement__money_addAmounts(s0, rtot)), settlement__money_addAmounts(start, tot));
  }
}

lemma MonthlyAllocatedTotalConcat(a: seq<settlement__allocation_Share>, b: seq<settlement__allocation_Share>)
  requires forall s :: s in a ==> settlement__money_validAmount(s.amount)
  requires forall s :: s in b ==> settlement__money_validAmount(s.amount)
  ensures settlement__money_equalAmounts(
    settlement__allocation_allocatedTotal(a + b),
    settlement__money_addAmounts(settlement__allocation_allocatedTotal(a), settlement__allocation_allocatedTotal(b)))
{
  hide *;
  reveal settlement__allocation_allocatedTotal;
  var f := (sum: settlement__money_Amount, share: settlement__allocation_Share) => settlement__money_addAmounts(sum, share.amount);
  MonthlyFoldLeftConcat(f, settlement__money_zero, a, b);
  MonthlyAllocatedTotalValid(a);
  MonthlyAllocatedTotalShift(b, settlement__allocation_allocatedTotal(a));
}

lemma MonthlyAllocatedTotalPointwiseEqual(a: seq<settlement__allocation_Share>, b: seq<settlement__allocation_Share>)
  requires |a| == |b|
  requires forall i :: 0 <= i < |a| ==> settlement__money_validAmount(a[i].amount) && settlement__money_validAmount(b[i].amount)
  requires forall i :: 0 <= i < |a| ==> settlement__money_equalAmounts(a[i].amount, b[i].amount)
  ensures settlement__money_equalAmounts(settlement__allocation_allocatedTotal(a), settlement__allocation_allocatedTotal(b))
  decreases |a|
{
  hide *;
  reveal Std.Collections.Seq.FoldLeft, settlement__allocation_allocatedTotal, settlement__money_lawEqualReflexive, settlement__money_lawAddCongruence, settlement__money_lawAdditionValid, settlement__money_lawAddCommutative, settlement__money_lawZeroIdentity, settlement__money_lawEqualSymmetric;
  MonthlyZeroValid();
  if |a| > 0 {
    var a1 := a[1..];
    var b1 := b[1..];
    assert forall i :: 0 <= i < |a1| ==> a1[i] == a[i + 1] && b1[i] == b[i + 1];
    MonthlyAllocatedTotalPointwiseEqual(a1, b1);
    MonthlyAllocatedTotalValid(a1);
    MonthlyAllocatedTotalValid(b1);
    var za := settlement__money_addAmounts(settlement__money_zero, a[0].amount);
    var zb := settlement__money_addAmounts(settlement__money_zero, b[0].amount);
    settlement__money_lawAdditionValid_ensures(settlement__money_zero, a[0].amount);
    settlement__money_lawAdditionValid_ensures(settlement__money_zero, b[0].amount);
    MonthlyAllocatedTotalShift(a1, za);
    MonthlyAllocatedTotalShift(b1, zb);
    settlement__money_lawAddCongruence_ensures(a[0].amount, b[0].amount, settlement__money_zero);
    settlement__money_lawAddCongruence_ensures(za, zb, settlement__allocation_allocatedTotal(a1));
    settlement__money_lawAddCongruence_ensures(settlement__allocation_allocatedTotal(a1), settlement__allocation_allocatedTotal(b1), zb);
    MonthlyEqualTrans(settlement__money_addAmounts(za, settlement__allocation_allocatedTotal(a1)), settlement__money_addAmounts(zb, settlement__allocation_allocatedTotal(a1)), settlement__money_addAmounts(zb, settlement__allocation_allocatedTotal(b1)));
    MonthlyEqualTrans(settlement__allocation_allocatedTotal(a), settlement__money_addAmounts(za, settlement__allocation_allocatedTotal(a1)), settlement__money_addAmounts(zb, settlement__allocation_allocatedTotal(b1)));
    settlement__money_lawEqualSymmetric_ensures(settlement__allocation_allocatedTotal(b), settlement__money_addAmounts(zb, settlement__allocation_allocatedTotal(b1)));
    MonthlyEqualTrans(settlement__allocation_allocatedTotal(a), settlement__money_addAmounts(zb, settlement__allocation_allocatedTotal(b1)), settlement__allocation_allocatedTotal(b));
  }
}

lemma MonthlyAllocatedTotalBumpOne(a: seq<settlement__allocation_Share>, b: seq<settlement__allocation_Share>, idx: int, delta: seq<int>)
  requires |a| == |b| && 0 <= idx < |a| && settlement__money_validAmount(delta)
  requires forall i :: 0 <= i < |a| ==> settlement__money_validAmount(a[i].amount) && settlement__money_validAmount(b[i].amount)
  requires forall i :: 0 <= i < |a| && i != idx ==> settlement__money_equalAmounts(b[i].amount, a[i].amount)
  requires settlement__money_equalAmounts(b[idx].amount, settlement__money_addAmounts(a[idx].amount, delta))
  ensures settlement__money_equalAmounts(settlement__allocation_allocatedTotal(b), settlement__money_addAmounts(settlement__allocation_allocatedTotal(a), delta))
{
  hide *;
  reveal Std.Collections.Seq.FoldLeft, settlement__allocation_allocatedTotal, settlement__money_lawEqualReflexive, settlement__money_lawAddCongruence, settlement__money_lawAdditionValid, settlement__money_lawAddCommutative, settlement__money_lawAddAssociative, settlement__money_lawZeroIdentity, settlement__money_lawEqualSymmetric;
  MonthlyZeroValid();
  var aPre := a[..idx];
  var aPost := a[idx + 1..];
  var bPre := b[..idx];
  var bPost := b[idx + 1..];
  assert a == aPre + [a[idx]] + aPost;
  assert b == bPre + [b[idx]] + bPost;
  MonthlyAllocatedTotalValid(aPre);
  MonthlyAllocatedTotalValid(aPost);
  MonthlyAllocatedTotalValid(bPre);
  MonthlyAllocatedTotalValid(bPost);
  MonthlyAllocatedTotalValid([a[idx]]);
  MonthlyAllocatedTotalValid([b[idx]]);
  MonthlyAllocatedTotalValid(aPre + [a[idx]]);
  MonthlyAllocatedTotalValid(bPre + [b[idx]]);
  MonthlyAllocatedTotalPointwiseEqual(bPre, aPre);
  MonthlyAllocatedTotalPointwiseEqual(bPost, aPost);
  MonthlyAllocatedTotalConcat(aPre + [a[idx]], aPost);
  MonthlyAllocatedTotalConcat(aPre, [a[idx]]);
  MonthlyAllocatedTotalConcat(bPre + [b[idx]], bPost);
  MonthlyAllocatedTotalConcat(bPre, [b[idx]]);
  var taPre := settlement__allocation_allocatedTotal(aPre);
  var taPost := settlement__allocation_allocatedTotal(aPost);
  var tbPre := settlement__allocation_allocatedTotal(bPre);
  var tbPost := settlement__allocation_allocatedTotal(bPost);
  var taOne := settlement__allocation_allocatedTotal([a[idx]]);
  var tbOne := settlement__allocation_allocatedTotal([b[idx]]);
  MonthlyAllocatedTotalSingleton(a[idx]);
  MonthlyAllocatedTotalSingleton(b[idx]);
  settlement__money_lawAddCommutative_ensures(settlement__money_zero, a[idx].amount);
  settlement__money_lawZeroIdentity_ensures(a[idx].amount);
  settlement__money_lawAddCommutative_ensures(settlement__money_zero, b[idx].amount);
  settlement__money_lawZeroIdentity_ensures(b[idx].amount);
  settlement__money_lawAdditionValid_ensures(a[idx].amount, delta);
  MonthlyEqualTrans(tbOne, b[idx].amount, settlement__money_addAmounts(a[idx].amount, delta));
  settlement__money_lawEqualSymmetric_ensures(taOne, a[idx].amount);
  settlement__money_lawAddCongruence_ensures(a[idx].amount, taOne, delta);
  MonthlyEqualTrans(tbOne, settlement__money_addAmounts(a[idx].amount, delta), settlement__money_addAmounts(taOne, delta));
  settlement__money_lawAddCongruence_ensures(tbPre, taPre, tbOne);
  settlement__money_lawAdditionValid_ensures(taOne, delta);
  settlement__money_lawAddCongruence_ensures(tbOne, settlement__money_addAmounts(taOne, delta), taPre);
  MonthlyEqualTrans(settlement__money_addAmounts(tbPre, tbOne), settlement__money_addAmounts(taPre, tbOne), settlement__money_addAmounts(taPre, settlement__money_addAmounts(taOne, delta)));
  settlement__money_lawAddAssociative_ensures(taPre, taOne, delta);
  settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(settlement__money_addAmounts(taPre, taOne), delta), settlement__money_addAmounts(taPre, settlement__money_addAmounts(taOne, delta)));
  MonthlyEqualTrans(settlement__money_addAmounts(tbPre, tbOne), settlement__money_addAmounts(taPre, settlement__money_addAmounts(taOne, delta)), settlement__money_addAmounts(settlement__money_addAmounts(taPre, taOne), delta));
  settlement__money_lawEqualSymmetric_ensures(settlement__allocation_allocatedTotal(aPre + [a[idx]]), settlement__money_addAmounts(taPre, taOne));
  settlement__money_lawAdditionValid_ensures(taPre, taOne);
  settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(taPre, taOne), settlement__allocation_allocatedTotal(aPre + [a[idx]]), delta);
  MonthlyEqualTrans(settlement__allocation_allocatedTotal(bPre + [b[idx]]), settlement__money_addAmounts(tbPre, tbOne), settlement__money_addAmounts(settlement__money_addAmounts(taPre, taOne), delta));
  MonthlyEqualTrans(settlement__allocation_allocatedTotal(bPre + [b[idx]]), settlement__money_addAmounts(settlement__money_addAmounts(taPre, taOne), delta), settlement__money_addAmounts(settlement__allocation_allocatedTotal(aPre + [a[idx]]), delta));
  var taL := settlement__allocation_allocatedTotal(aPre + [a[idx]]);
  var tbL := settlement__allocation_allocatedTotal(bPre + [b[idx]]);
  settlement__money_lawAdditionValid_ensures(taL, delta);
  settlement__money_lawAddCongruence_ensures(tbL, settlement__money_addAmounts(taL, delta), tbPost);
  settlement__money_lawAddCongruence_ensures(tbPost, taPost, settlement__money_addAmounts(taL, delta));
  MonthlyEqualTrans(settlement__allocation_allocatedTotal(b), settlement__money_addAmounts(tbL, tbPost), settlement__money_addAmounts(settlement__money_addAmounts(taL, delta), tbPost));
  MonthlyEqualTrans(settlement__allocation_allocatedTotal(b), settlement__money_addAmounts(settlement__money_addAmounts(taL, delta), tbPost), settlement__money_addAmounts(settlement__money_addAmounts(taL, delta), taPost));
  settlement__money_lawAddAssociative_ensures(taL, delta, taPost);
  settlement__money_lawAddCommutative_ensures(delta, taPost);
  settlement__money_lawAdditionValid_ensures(taPost, delta);
  settlement__money_lawAddAssociative_ensures(taL, taPost, delta);
  settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(settlement__money_addAmounts(taL, taPost), delta), settlement__money_addAmounts(taL, settlement__money_addAmounts(taPost, delta)));
  MonthlyEqualTrans(settlement__allocation_allocatedTotal(b), settlement__money_addAmounts(settlement__money_addAmounts(taL, delta), taPost), settlement__money_addAmounts(taL, settlement__money_addAmounts(delta, taPost)));
  MonthlyEqualTrans(settlement__allocation_allocatedTotal(b), settlement__money_addAmounts(taL, settlement__money_addAmounts(taPost, delta)), settlement__money_addAmounts(settlement__money_addAmounts(taL, taPost), delta));
  settlement__money_lawEqualSymmetric_ensures(settlement__allocation_allocatedTotal(a), settlement__money_addAmounts(taL, taPost));
  settlement__money_lawAdditionValid_ensures(taL, taPost);
  MonthlyAllocatedTotalValid(a);
  settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(taL, taPost), settlement__allocation_allocatedTotal(a), delta);
  MonthlyEqualTrans(settlement__allocation_allocatedTotal(b), settlement__money_addAmounts(settlement__money_addAmounts(taL, taPost), delta), settlement__money_addAmounts(settlement__allocation_allocatedTotal(a), delta));
}

lemma MonthlyAmountForFoldValid(shares: seq<settlement__allocation_Share>, actor: int, start: seq<int>)
  requires settlement__money_validAmount(start)
  requires forall s :: s in shares ==> settlement__money_validAmount(s.amount)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, share: settlement__allocation_Share) => settlement__money_addAmounts(total, (if (share.actor == actor) then share.amount else settlement__money_zero)), start, shares))
  decreases |shares|
{
  hide *;
  reveal Std.Collections.Seq.FoldLeft, settlement__money_lawAdditionValid;
  MonthlyZeroValid();
  if |shares| > 0 {
    var addend := if shares[0].actor == actor then shares[0].amount else settlement__money_zero;
    settlement__money_lawAdditionValid_ensures(start, addend);
    MonthlyAmountForFoldValid(shares[1..], actor, settlement__money_addAmounts(start, addend));
  }
}

lemma MonthlyAmountForValid(shares: seq<settlement__allocation_Share>, actor: int)
  requires forall s :: s in shares ==> settlement__money_validAmount(s.amount)
  ensures settlement__money_validAmount(amountFor(shares, actor))
{
  hide *;
  reveal amountFor;
  MonthlyZeroValid();
  MonthlyAmountForFoldValid(shares, actor, settlement__money_zero);
}

lemma MonthlyAmountForShift(shares: seq<settlement__allocation_Share>, actor: int, start: seq<int>)
  requires settlement__money_validAmount(start)
  requires forall s :: s in shares ==> settlement__money_validAmount(s.amount)
  ensures settlement__money_equalAmounts(
    Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, share: settlement__allocation_Share) => settlement__money_addAmounts(total, (if (share.actor == actor) then share.amount else settlement__money_zero)), start, shares),
    settlement__money_addAmounts(start, amountFor(shares, actor)))
  decreases |shares|
{
  hide *;
  reveal Std.Collections.Seq.FoldLeft, amountFor, settlement__money_lawZeroIdentity, settlement__money_lawEqualSymmetric, settlement__money_lawAdditionValid, settlement__money_lawAddCommutative, settlement__money_lawAddCongruence, settlement__money_lawAddAssociative;
  MonthlyZeroValid();
  var f := (total: settlement__money_Amount, share: settlement__allocation_Share) => settlement__money_addAmounts(total, (if (share.actor == actor) then share.amount else settlement__money_zero));
  if |shares| == 0 {
    settlement__money_lawZeroIdentity_ensures(start);
    settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(start, settlement__money_zero), start);
  } else {
    var s0 := if shares[0].actor == actor then shares[0].amount else settlement__money_zero;
    var rest := shares[1..];
    var next := settlement__money_addAmounts(start, s0);
    var z0 := settlement__money_addAmounts(settlement__money_zero, s0);
    settlement__money_lawAdditionValid_ensures(start, s0);
    settlement__money_lawAdditionValid_ensures(settlement__money_zero, s0);
    MonthlyAmountForValid(rest, actor);
    var rtot := amountFor(rest, actor);
    MonthlyAmountForShift(rest, actor, next);
    MonthlyAmountForShift(rest, actor, z0);
    settlement__money_lawAddCommutative_ensures(settlement__money_zero, s0);
    settlement__money_lawZeroIdentity_ensures(s0);
    settlement__money_lawAddCongruence_ensures(z0, s0, rtot);
    var tot := amountFor(shares, actor);
    MonthlyEqualTrans(tot, settlement__money_addAmounts(z0, rtot), settlement__money_addAmounts(s0, rtot));
    settlement__money_lawEqualSymmetric_ensures(tot, settlement__money_addAmounts(s0, rtot));
    settlement__money_lawAdditionValid_ensures(s0, rtot);
    MonthlyAmountForValid(shares, actor);
    settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(s0, rtot), tot, start);
    settlement__money_lawAddAssociative_ensures(start, s0, rtot);
    MonthlyEqualTrans(Std.Collections.Seq.FoldLeft(f, start, shares), settlement__money_addAmounts(next, rtot), settlement__money_addAmounts(start, settlement__money_addAmounts(s0, rtot)));
    MonthlyEqualTrans(Std.Collections.Seq.FoldLeft(f, start, shares), settlement__money_addAmounts(start, settlement__money_addAmounts(s0, rtot)), settlement__money_addAmounts(start, tot));
  }
}

lemma MonthlyAmountForCons(s0: settlement__allocation_Share, rest: seq<settlement__allocation_Share>, actor: int)
  requires settlement__money_validAmount(s0.amount)
  requires forall s :: s in rest ==> settlement__money_validAmount(s.amount)
  ensures settlement__money_equalAmounts(
    amountFor([s0] + rest, actor),
    if s0.actor == actor then settlement__money_addAmounts(s0.amount, amountFor(rest, actor)) else amountFor(rest, actor))
{
  hide *;
  reveal Std.Collections.Seq.FoldLeft, amountFor, settlement__money_lawZeroIdentity, settlement__money_lawAddCommutative, settlement__money_lawAdditionValid, settlement__money_lawAddCongruence, settlement__money_lawEqualSymmetric;
  MonthlyZeroValid();
  var xs := [s0] + rest;
  assert xs[0] == s0 && xs[1..] == rest;
  var addend := if s0.actor == actor then s0.amount else settlement__money_zero;
  var z0 := settlement__money_addAmounts(settlement__money_zero, addend);
  settlement__money_lawAdditionValid_ensures(settlement__money_zero, addend);
  MonthlyAmountForValid(rest, actor);
  MonthlyAmountForShift(rest, actor, z0);
  settlement__money_lawAddCommutative_ensures(settlement__money_zero, addend);
  settlement__money_lawZeroIdentity_ensures(addend);
  settlement__money_lawAddCongruence_ensures(z0, addend, amountFor(rest, actor));
  MonthlyEqualTrans(amountFor(xs, actor), settlement__money_addAmounts(z0, amountFor(rest, actor)), settlement__money_addAmounts(addend, amountFor(rest, actor)));
  if s0.actor != actor {
    settlement__money_lawAddCommutative_ensures(settlement__money_zero, amountFor(rest, actor));
    settlement__money_lawZeroIdentity_ensures(amountFor(rest, actor));
    MonthlyEqualTrans(amountFor(xs, actor), settlement__money_addAmounts(settlement__money_zero, amountFor(rest, actor)), amountFor(rest, actor));
  }
}

lemma MonthlyAmountForAbsent(shares: seq<settlement__allocation_Share>, actor: int)
  requires forall s :: s in shares ==> settlement__money_validAmount(s.amount) && s.actor != actor
  ensures settlement__money_equalAmounts(amountFor(shares, actor), settlement__money_zero)
  decreases |shares|
{
  hide *;
  reveal Std.Collections.Seq.FoldLeft, amountFor;
  MonthlyZeroValid();
  if |shares| > 0 {
    assert shares == [shares[0]] + shares[1..];
    MonthlyAmountForCons(shares[0], shares[1..], actor);
    MonthlyAmountForAbsent(shares[1..], actor);
    MonthlyEqualTrans(amountFor(shares, actor), amountFor(shares[1..], actor), settlement__money_zero);
  }
}

lemma MonthlyAmountForUnique(shares: seq<settlement__allocation_Share>, actor: int, idx: int)
  requires 0 <= idx < |shares| && shares[idx].actor == actor
  requires forall j :: 0 <= j < |shares| && j != idx ==> shares[j].actor != actor
  requires forall s :: s in shares ==> settlement__money_validAmount(s.amount)
  ensures settlement__money_equalAmounts(amountFor(shares, actor), shares[idx].amount)
  decreases |shares|
{
  hide *;
  reveal settlement__money_lawAddCongruence, settlement__money_lawZeroIdentity;
  MonthlyZeroValid();
  assert shares == [shares[0]] + shares[1..];
  MonthlyAmountForCons(shares[0], shares[1..], actor);
  if idx == 0 {
    assert forall j :: 0 <= j < |shares[1..]| ==> shares[1..][j] == shares[j + 1];
    MonthlyAmountForAbsent(shares[1..], actor);
    MonthlyAmountForValid(shares[1..], actor);
    settlement__money_lawAddCongruence_ensures(amountFor(shares[1..], actor), settlement__money_zero, shares[0].amount);
    settlement__money_lawZeroIdentity_ensures(shares[0].amount);
    MonthlyEqualTrans(amountFor(shares, actor), settlement__money_addAmounts(shares[0].amount, amountFor(shares[1..], actor)), settlement__money_addAmounts(shares[0].amount, settlement__money_zero));
    MonthlyEqualTrans(amountFor(shares, actor), settlement__money_addAmounts(shares[0].amount, settlement__money_zero), shares[0].amount);
  } else {
    assert forall j :: 0 <= j < |shares[1..]| ==> shares[1..][j] == shares[j + 1];
    MonthlyAmountForUnique(shares[1..], actor, idx - 1);
    MonthlyEqualTrans(amountFor(shares, actor), amountFor(shares[1..], actor), shares[idx].amount);
  }
}

lemma MonthlyMergedTotal(points: seq<settlement__allocation_Share>, maintainers: seq<settlement__allocation_Share>)
  requires forall s :: s in points ==> settlement__money_validAmount(s.amount)
  requires ProofLib.DistinctBy(points, (s: settlement__allocation_Share) => s.actor)
  requires forall s :: s in maintainers ==> settlement__money_validAmount(s.amount)
  ensures settlement__money_equalAmounts(
    settlement__allocation_allocatedTotal(mergedShares(points, maintainers)),
    settlement__money_addAmounts(settlement__allocation_allocatedTotal(points), settlement__allocation_allocatedTotal(maintainers)))
  decreases |maintainers|
{
  hide *;
  reveal ProofLib.Filter, ProofLib.DistinctBy, mergedShares, hasActor, Std.Collections.Seq.FoldLeft, settlement__allocation_allocatedTotal, settlement__money_lawZeroIdentity, settlement__money_lawAddCommutative, settlement__money_lawAddAssociative, settlement__money_lawAddCongruence, settlement__money_lawAdditionValid, settlement__money_lawEqualSymmetric, settlement__money_lawEqualReflexive;
  MonthlyZeroValid();
  var mapped := seq(|points|, i_map requires 0 <= i_map < |points| => var s := points[i_map]; s.(amount := settlement__money_addAmounts(s.amount, amountFor(maintainers, s.actor))));
  var pTail := (x: settlement__allocation_Share) => !(hasActor(points, x.actor));
  var tail := ProofLib.Filter(pTail, maintainers);
  assert mergedShares(points, maintainers) == mapped + tail;
  forall s | s in mapped ensures settlement__money_validAmount(s.amount) {
    var i :| 0 <= i < |points| && mapped[i] == s;
    MonthlyAmountForValid(maintainers, points[i].actor);
    settlement__money_lawAdditionValid_ensures(points[i].amount, amountFor(maintainers, points[i].actor));
  }
  forall s | s in tail ensures settlement__money_validAmount(s.amount) {
    ProofLib.FilterMember(pTail, maintainers, s);
  }
  MonthlyAllocatedTotalValid(points);
  MonthlyAllocatedTotalValid(maintainers);
  if |maintainers| == 0 {
    ProofLib.FilterNil(pTail, maintainers);
    assert tail == [] && mergedShares(points, maintainers) == mapped;
    forall i | 0 <= i < |points| ensures settlement__money_equalAmounts(mapped[i].amount, points[i].amount) {
      MonthlyAmountForAbsent(maintainers, points[i].actor);
      MonthlyAmountForValid(maintainers, points[i].actor);
      settlement__money_lawAddCongruence_ensures(amountFor(maintainers, points[i].actor), settlement__money_zero, points[i].amount);
      settlement__money_lawZeroIdentity_ensures(points[i].amount);
      MonthlyEqualTrans(mapped[i].amount, settlement__money_addAmounts(points[i].amount, settlement__money_zero), points[i].amount);
    }
    MonthlyAllocatedTotalPointwiseEqual(mapped, points);
    settlement__money_lawZeroIdentity_ensures(settlement__allocation_allocatedTotal(points));
    settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(settlement__allocation_allocatedTotal(points), settlement__money_zero), settlement__allocation_allocatedTotal(points));
    MonthlyEqualTrans(settlement__allocation_allocatedTotal(mergedShares(points, maintainers)), settlement__allocation_allocatedTotal(points), settlement__money_addAmounts(settlement__allocation_allocatedTotal(points), settlement__money_zero));
  } else {
    var m0 := maintainers[0];
    var rest := maintainers[1..];
    assert maintainers == [m0] + rest;
    MonthlyMergedTotal(points, rest);
    var mappedR := seq(|points|, i_map requires 0 <= i_map < |points| => var s := points[i_map]; s.(amount := settlement__money_addAmounts(s.amount, amountFor(rest, s.actor))));
    var tailR := ProofLib.Filter(pTail, rest);
    assert mergedShares(points, rest) == mappedR + tailR;
    forall s | s in mappedR ensures settlement__money_validAmount(s.amount) {
      var i :| 0 <= i < |points| && mappedR[i] == s;
      MonthlyAmountForValid(rest, points[i].actor);
      settlement__money_lawAdditionValid_ensures(points[i].amount, amountFor(rest, points[i].actor));
    }
    forall s | s in tailR ensures settlement__money_validAmount(s.amount) {
      ProofLib.FilterMember(pTail, rest, s);
    }
    MonthlyAllocatedTotalValid(mapped);
    MonthlyAllocatedTotalValid(tail);
    MonthlyAllocatedTotalValid(mappedR);
    MonthlyAllocatedTotalValid(tailR);
    MonthlyAllocatedTotalValid(rest);
    MonthlyAllocatedTotalValid(mergedShares(points, rest));
    MonthlyAllocatedTotalConcat(mapped, tail);
    MonthlyAllocatedTotalConcat(mappedR, tailR);
    ProofLib.FilterCons(pTail, maintainers);
    var tm := settlement__allocation_allocatedTotal(mapped);
    var tt := settlement__allocation_allocatedTotal(tail);
    var tmR := settlement__allocation_allocatedTotal(mappedR);
    var ttR := settlement__allocation_allocatedTotal(tailR);
    if hasActor(points, m0.actor) {
      assert tail == tailR;
      var idx :| 0 <= idx < |points| && points[idx].actor == m0.actor;
      forall i | 0 <= i < |points| && i != idx ensures settlement__money_equalAmounts(mapped[i].amount, mappedR[i].amount) {
        assert points[i].actor != m0.actor;
        MonthlyAmountForCons(m0, rest, points[i].actor);
        MonthlyAmountForValid(maintainers, points[i].actor);
        MonthlyAmountForValid(rest, points[i].actor);
        settlement__money_lawAddCongruence_ensures(amountFor(maintainers, points[i].actor), amountFor(rest, points[i].actor), points[i].amount);
      }
      MonthlyAmountForCons(m0, rest, m0.actor);
      MonthlyAmountForValid(maintainers, m0.actor);
      MonthlyAmountForValid(rest, m0.actor);
      settlement__money_lawAdditionValid_ensures(m0.amount, amountFor(rest, m0.actor));
      settlement__money_lawAddCongruence_ensures(amountFor(maintainers, m0.actor), settlement__money_addAmounts(m0.amount, amountFor(rest, m0.actor)), points[idx].amount);
      settlement__money_lawAddCommutative_ensures(m0.amount, amountFor(rest, m0.actor));
      settlement__money_lawAddAssociative_ensures(points[idx].amount, amountFor(rest, m0.actor), m0.amount);
      settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(mappedR[idx].amount, m0.amount), settlement__money_addAmounts(points[idx].amount, settlement__money_addAmounts(amountFor(rest, m0.actor), m0.amount)));
      MonthlyEqualTrans(mapped[idx].amount, settlement__money_addAmounts(points[idx].amount, settlement__money_addAmounts(amountFor(rest, m0.actor), m0.amount)), settlement__money_addAmounts(mappedR[idx].amount, m0.amount));
      MonthlyAllocatedTotalBumpOne(mappedR, mapped, idx, m0.amount);
      settlement__money_lawAdditionValid_ensures(tmR, m0.amount);
      settlement__money_lawAddCongruence_ensures(tm, settlement__money_addAmounts(tmR, m0.amount), ttR);
      settlement__money_lawAddAssociative_ensures(tmR, m0.amount, ttR);
      settlement__money_lawAddCommutative_ensures(m0.amount, ttR);
      settlement__money_lawAddAssociative_ensures(tmR, ttR, m0.amount);
      settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(settlement__money_addAmounts(tmR, ttR), m0.amount), settlement__money_addAmounts(tmR, settlement__money_addAmounts(ttR, m0.amount)));
      MonthlyEqualTrans(settlement__allocation_allocatedTotal(mergedShares(points, maintainers)), settlement__money_addAmounts(tm, ttR), settlement__money_addAmounts(settlement__money_addAmounts(tmR, m0.amount), ttR));
      MonthlyEqualTrans(settlement__allocation_allocatedTotal(mergedShares(points, maintainers)), settlement__money_addAmounts(settlement__money_addAmounts(tmR, m0.amount), ttR), settlement__money_addAmounts(tmR, settlement__money_addAmounts(ttR, m0.amount)));
      MonthlyEqualTrans(settlement__allocation_allocatedTotal(mergedShares(points, maintainers)), settlement__money_addAmounts(tmR, settlement__money_addAmounts(ttR, m0.amount)), settlement__money_addAmounts(settlement__money_addAmounts(tmR, ttR), m0.amount));
      settlement__money_lawAdditionValid_ensures(tmR, ttR);
      settlement__money_lawEqualSymmetric_ensures(settlement__allocation_allocatedTotal(mergedShares(points, rest)), settlement__money_addAmounts(tmR, ttR));
      settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(tmR, ttR), settlement__allocation_allocatedTotal(mergedShares(points, rest)), m0.amount);
      MonthlyEqualTrans(settlement__allocation_allocatedTotal(mergedShares(points, maintainers)), settlement__money_addAmounts(settlement__money_addAmounts(tmR, ttR), m0.amount), settlement__money_addAmounts(settlement__allocation_allocatedTotal(mergedShares(points, rest)), m0.amount));
    } else {
      assert tail == [m0] + tailR;
      forall i | 0 <= i < |points| ensures settlement__money_equalAmounts(mapped[i].amount, mappedR[i].amount) {
        assert points[i].actor != m0.actor;
        MonthlyAmountForCons(m0, rest, points[i].actor);
        MonthlyAmountForValid(maintainers, points[i].actor);
        MonthlyAmountForValid(rest, points[i].actor);
        settlement__money_lawAddCongruence_ensures(amountFor(maintainers, points[i].actor), amountFor(rest, points[i].actor), points[i].amount);
      }
      MonthlyAllocatedTotalPointwiseEqual(mapped, mappedR);
      MonthlyAllocatedTotalValid([m0]);
      MonthlyAllocatedTotalConcat([m0], tailR);
      MonthlyAllocatedTotalSingleton(m0);
      settlement__money_lawAddCommutative_ensures(settlement__money_zero, m0.amount);
      settlement__money_lawZeroIdentity_ensures(m0.amount);
      settlement__money_lawAddCongruence_ensures(settlement__allocation_allocatedTotal([m0]), m0.amount, ttR);
      MonthlyEqualTrans(tt, settlement__money_addAmounts(settlement__allocation_allocatedTotal([m0]), ttR), settlement__money_addAmounts(m0.amount, ttR));
      settlement__money_lawAddCommutative_ensures(m0.amount, ttR);
      settlement__money_lawAdditionValid_ensures(ttR, m0.amount);
      settlement__money_lawAddCongruence_ensures(tm, tmR, tt);
      settlement__money_lawAddCongruence_ensures(tt, settlement__money_addAmounts(ttR, m0.amount), tmR);
      settlement__money_lawAddAssociative_ensures(tmR, ttR, m0.amount);
      settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(settlement__money_addAmounts(tmR, ttR), m0.amount), settlement__money_addAmounts(tmR, settlement__money_addAmounts(ttR, m0.amount)));
      MonthlyEqualTrans(settlement__allocation_allocatedTotal(mergedShares(points, maintainers)), settlement__money_addAmounts(tm, tt), settlement__money_addAmounts(tmR, tt));
      MonthlyEqualTrans(settlement__allocation_allocatedTotal(mergedShares(points, maintainers)), settlement__money_addAmounts(tmR, tt), settlement__money_addAmounts(tmR, settlement__money_addAmounts(ttR, m0.amount)));
      MonthlyEqualTrans(settlement__allocation_allocatedTotal(mergedShares(points, maintainers)), settlement__money_addAmounts(tmR, settlement__money_addAmounts(ttR, m0.amount)), settlement__money_addAmounts(settlement__money_addAmounts(tmR, ttR), m0.amount));
      settlement__money_lawAdditionValid_ensures(tmR, ttR);
      settlement__money_lawEqualSymmetric_ensures(settlement__allocation_allocatedTotal(mergedShares(points, rest)), settlement__money_addAmounts(tmR, ttR));
      settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(tmR, ttR), settlement__allocation_allocatedTotal(mergedShares(points, rest)), m0.amount);
      MonthlyEqualTrans(settlement__allocation_allocatedTotal(mergedShares(points, maintainers)), settlement__money_addAmounts(settlement__money_addAmounts(tmR, ttR), m0.amount), settlement__money_addAmounts(settlement__allocation_allocatedTotal(mergedShares(points, rest)), m0.amount));
    }
    var tp := settlement__allocation_allocatedTotal(points);
    var tr := settlement__allocation_allocatedTotal(rest);
    settlement__money_lawAdditionValid_ensures(tp, tr);
    settlement__money_lawAddCongruence_ensures(settlement__allocation_allocatedTotal(mergedShares(points, rest)), settlement__money_addAmounts(tp, tr), m0.amount);
    MonthlyEqualTrans(settlement__allocation_allocatedTotal(mergedShares(points, maintainers)), settlement__money_addAmounts(settlement__allocation_allocatedTotal(mergedShares(points, rest)), m0.amount), settlement__money_addAmounts(settlement__money_addAmounts(tp, tr), m0.amount));
    settlement__money_lawAddAssociative_ensures(tp, tr, m0.amount);
    settlement__money_lawAddCommutative_ensures(tr, m0.amount);
    MonthlyEqualTrans(settlement__allocation_allocatedTotal(mergedShares(points, maintainers)), settlement__money_addAmounts(settlement__money_addAmounts(tp, tr), m0.amount), settlement__money_addAmounts(tp, settlement__money_addAmounts(m0.amount, tr)));
    MonthlyAllocatedTotalValid([m0]);
    MonthlyAllocatedTotalConcat([m0], rest);
    MonthlyAllocatedTotalSingleton(m0);
    settlement__money_lawAddCommutative_ensures(settlement__money_zero, m0.amount);
    settlement__money_lawZeroIdentity_ensures(m0.amount);
    settlement__money_lawAddCongruence_ensures(settlement__allocation_allocatedTotal([m0]), m0.amount, tr);
    MonthlyEqualTrans(settlement__allocation_allocatedTotal(maintainers), settlement__money_addAmounts(settlement__allocation_allocatedTotal([m0]), tr), settlement__money_addAmounts(m0.amount, tr));
    settlement__money_lawEqualSymmetric_ensures(settlement__allocation_allocatedTotal(maintainers), settlement__money_addAmounts(m0.amount, tr));
    settlement__money_lawAdditionValid_ensures(m0.amount, tr);
    settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(m0.amount, tr), settlement__allocation_allocatedTotal(maintainers), tp);
    MonthlyEqualTrans(settlement__allocation_allocatedTotal(mergedShares(points, maintainers)), settlement__money_addAmounts(tp, settlement__money_addAmounts(m0.amount, tr)), settlement__money_addAmounts(tp, settlement__allocation_allocatedTotal(maintainers)));
  }
}

lemma MonthlyMergedSharesValidUnique(points: seq<settlement__allocation_Share>, maintainers: seq<settlement__allocation_Share>)
  requires forall s :: s in points ==> settlement__money_validAmount(s.amount) && s.actor > 0
  requires ProofLib.DistinctBy(points, (s: settlement__allocation_Share) => s.actor)
  requires forall s :: s in maintainers ==> settlement__money_validAmount(s.amount) && s.actor > 0
  requires ProofLib.DistinctBy(maintainers, (s: settlement__allocation_Share) => s.actor)
  ensures var ms := mergedShares(points, maintainers);
    (forall s :: s in ms ==> settlement__money_validAmount(s.amount) && s.actor > 0 && |ProofLib.Filter((o: settlement__allocation_Share) => o.actor == s.actor, ms)| == 1)
    && ProofLib.DistinctBy(ms, (s: settlement__allocation_Share) => s.actor)
{
  hide *;
  reveal ProofLib.Filter, ProofLib.DistinctBy, mergedShares, hasActor, settlement__money_lawAdditionValid;
  var mapped := seq(|points|, i_map requires 0 <= i_map < |points| => var s := points[i_map]; s.(amount := settlement__money_addAmounts(s.amount, amountFor(maintainers, s.actor))));
  var pTail := (x: settlement__allocation_Share) => !(hasActor(points, x.actor));
  var tail := ProofLib.Filter(pTail, maintainers);
  var ms := mapped + tail;
  assert ms == mergedShares(points, maintainers);
  var key := (s: settlement__allocation_Share) => s.actor;
  assert ProofLib.DistinctBy(mapped, key) by {
    forall i, j | 0 <= i < |mapped| && 0 <= j < |mapped| && i != j ensures mapped[i].actor != mapped[j].actor {
      assert mapped[i].actor == points[i].actor && mapped[j].actor == points[j].actor;
    }
  }
  ProofLib.FilterKeepsDistinctBy(pTail, maintainers, key);
  forall x, y | x in mapped && y in tail ensures key(x) != key(y) {
    var i :| 0 <= i < |points| && mapped[i] == x;
    ProofLib.FilterMember(pTail, maintainers, y);
  }
  ProofLib.DistinctByConcat(mapped, tail, key);
  forall s | s in ms
    ensures settlement__money_validAmount(s.amount) && s.actor > 0 && |ProofLib.Filter((o: settlement__allocation_Share) => o.actor == s.actor, ms)| == 1
  {
    var i :| 0 <= i < |ms| && ms[i] == s;
    if i < |mapped| {
      assert s == mapped[i];
      MonthlyAmountForValid(maintainers, points[i].actor);
      settlement__money_lawAdditionValid_ensures(points[i].amount, amountFor(maintainers, points[i].actor));
    } else {
      assert s == tail[i - |mapped|];
      ProofLib.FilterMember(pTail, maintainers, s);
    }
    ProofLib.FilterCountOneIffUnique((o: settlement__allocation_Share) => o.actor == s.actor, ms, key, i);
  }
}

lemma MonthlyAllocatedSharesProps(total: seq<int>, weights: seq<settlement__allocation_Weight>)
  requires settlement__allocation_canAllocate(total, weights)
  ensures var shares := settlement__allocation_allocateAmounts(total, weights);
    settlement__money_equalAmounts(settlement__allocation_allocatedTotal(shares), total)
    && (forall s :: s in shares ==> settlement__money_validAmount(s.amount) && s.actor > 0)
    && ProofLib.DistinctBy(shares, (s: settlement__allocation_Share) => s.actor)
{
  hide *;
  reveal ProofLib.Filter, ProofLib.DistinctBy, settlement__allocation_canAllocate, settlement__allocation_validWeights, settlement__allocation_allocateAmounts, settlement__allocation_weightedPortion, settlement__allocation_lawAllocatedSharesValid, settlement__allocation_lawAllocationConserves;
  settlement__allocation_lawAllocatedSharesValid_ensures(total, weights);
  settlement__allocation_lawAllocationConserves_ensures(total, weights);
  var shares := settlement__allocation_allocateAmounts(total, weights);
  var wkey := (w: settlement__allocation_Weight) => w.actor;
  var skey := (s: settlement__allocation_Share) => s.actor;
  if |weights| == 0 {
  } else if |weights| == 1 {
    assert |shares| == 1 && shares[0].actor == weights[0].actor;
  } else {
    assert ProofLib.DistinctBy(weights, wkey) by {
      forall i, j | 0 <= i < |weights| && 0 <= j < |weights| && i != j ensures weights[i].actor != weights[j].actor {
        ProofLib.FilterCountOneIffUnique((other: settlement__allocation_Weight) => other.actor == weights[i].actor, weights, wkey, i);
      }
    }
    assert |shares| == |weights|;
    forall i | 0 <= i < |shares| ensures shares[i].actor == weights[i].actor && shares[i].actor > 0 {
    }
    assert ProofLib.DistinctBy(shares, skey);
  }
}

lemma MonthlySmallDigitsValid(f: (settlement__money_SafeConversion, int) -> settlement__money_SafeConversion,
  current: settlement__money_SafeConversion, xs: seq<int>)
  requires current.remaining >= 0
  requires forall digit :: digit in current.digits ==> 0 <= digit < 1000
  requires forall acc: settlement__money_SafeConversion, digit: int :: acc.remaining >= 0 ==>
    f(acc, digit).remaining >= 0 && |f(acc, digit).digits| == |acc.digits| + 1 &&
    (forall d :: d in acc.digits ==> d in f(acc, digit).digits) &&
    (forall d :: d in f(acc, digit).digits && d !in acc.digits ==> 0 <= d < 1000)
  ensures |Std.Collections.Seq.FoldLeft(f, current, xs).digits| == |current.digits| + |xs|
  ensures forall d :: d in Std.Collections.Seq.FoldLeft(f, current, xs).digits ==> 0 <= d < 1000
  decreases |xs|
{
  if |xs| > 0 {
    MonthlySmallDigitsValid(f, f(current, xs[0]), xs[1..]);
  }
}

lemma MonthlySmallAmountValid(n: int)
  requires n >= 0
  ensures settlement__money_validAmount(settlement__money_smallAmount(n))
{
  var f := (acc: settlement__money_SafeConversion, ignored: int) => settlement__money_SafeConversion(settlement__money_quotient_settlement__money(acc.remaining, 1000), (acc.digits + [settlement__money_remainder_settlement__money(acc.remaining, 1000)]));
  MonthlySmallDigitsValid(f, settlement__money_SafeConversion(n, []), [0, 0, 0, 0, 0, 0]);
}

lemma MonthlyPoolValid(amount: seq<int>, basisPoints: int, weights: seq<settlement__allocation_Weight>)
  requires settlement__money_validAmount(amount) && basisPoints >= 0
  ensures settlement__money_validAmount(settlement__maintainerShare_sharePool(amount, basisPoints, weights))
{
  hide *;
  reveal settlement__maintainerShare_sharePool, settlement__maintainerShare_basisPointsDivisor, settlement__money_lawMultiplyValid, settlement__money_lawDivisionValid;
  MonthlyZeroValid();
  if |weights| > 0 && basisPoints > 0 {
    MonthlySmallAmountValid(basisPoints);
    MonthlySmallAmountValid(settlement__maintainerShare_basisPointsDivisor);
    settlement__money_lawMultiplyValid_ensures(amount, settlement__money_smallAmount(basisPoints));
    settlement__money_lawDivisionValid_ensures(
      settlement__money_multiplyAmounts(amount, settlement__money_smallAmount(basisPoints)),
      settlement__money_smallAmount(settlement__maintainerShare_basisPointsDivisor));
  }
}

lemma MonthlySameFieldsPart1(m: Monthly, after: Monthly)
  requires inv(m)
  requires after.project == m.project && after.period == m.period && after.phase == m.phase
  requires after.earlyCloseAt == m.earlyCloseAt && after.changes == m.changes && after.cuts == m.cuts
  requires after.total == m.total && after.cap == m.cap && after.shares == m.shares && after.proposedShares == m.proposedShares
  requires after.obligations == m.obligations && after.sequence == m.sequence && after.latestCutAt == m.latestCutAt
  requires after.reviewedOctober == m.reviewedOctober && after.revision == m.revision && after.notices == m.notices
  requires after.publicCuts == m.publicCuts && after.banned == m.banned && after.trigger == m.trigger
  requires after.frozenSequence == m.frozenSequence && after.frozenBy == m.frozenBy && after.exclusions == m.exclusions
  requires after.snapshotDigest == m.snapshotDigest && after.underfundedNotice == m.underfundedNotice
  ensures alwaysCloseoutOnlyForTheReviewedMonth(after)
  ensures alwaysCloseoutUnchanged(after)
  ensures alwaysAllocationConserved(after)
  ensures alwaysUnproposedEmpty(after)
  ensures alwaysCapFromRevision(after)
  ensures alwaysPublicCutsCurrent(after)
  ensures alwaysEveryPayableShareAccounted(after)
  ensures alwaysBannedHadShares(after)
  ensures alwaysNoObligationsBeforeFunding(after)
  ensures alwaysCompletedPaid(after)
  ensures alwaysFrozenRecord(after)
  ensures alwaysObligationsMatchShares(after)
  ensures alwaysExclusionsFromRevision(after)
{
  hide *;
  reveal inv;
  assert alwaysCloseoutOnlyForTheReviewedMonth(after) && alwaysCloseoutUnchanged(after) by {
    reveal alwaysCloseoutOnlyForTheReviewedMonth, alwaysCloseoutUnchanged;
  }
  assert alwaysAllocationConserved(after) && alwaysUnproposedEmpty(after) && alwaysCapFromRevision(after) by {
    reveal alwaysAllocationConserved, alwaysUnproposedEmpty, alwaysCapFromRevision, reviewedOctoberPool;
  }
  assert alwaysPublicCutsCurrent(after) && alwaysEveryPayableShareAccounted(after) && alwaysBannedHadShares(after) by {
    reveal alwaysPublicCutsCurrent, alwaysEveryPayableShareAccounted, alwaysBannedHadShares, belowProposal, banFor;
  }
  assert alwaysNoObligationsBeforeFunding(after) && alwaysCompletedPaid(after) && alwaysFrozenRecord(after) by {
    reveal alwaysNoObligationsBeforeFunding, alwaysCompletedPaid, alwaysFrozenRecord;
  }
  assert alwaysObligationsMatchShares(after) && alwaysExclusionsFromRevision(after) by {
    reveal alwaysObligationsMatchShares, alwaysExclusionsFromRevision, keyFor, hasActor, banFor;
  }
}

lemma MonthlySameFieldsSteps(m: Monthly, via: string, after: Monthly)
  requires via != "adjust" && via != "cut"
  requires after.project == m.project && after.period == m.period && after.phase == m.phase
  requires after.total == m.total && after.cap == m.cap && after.shares == m.shares && after.proposedShares == m.proposedShares
  requires after.obligations == m.obligations && after.sequence == m.sequence && after.latestCutAt == m.latestCutAt
  requires after.changes == m.changes && after.cuts == m.cuts && after.notices == m.notices
  requires after.banned == m.banned && after.trigger == m.trigger && after.frozenSequence == m.frozenSequence
  requires after.exclusions == m.exclusions && after.revision == m.revision && after.snapshotDigest == m.snapshotDigest
  requires after.underfundedNotice == m.underfundedNotice
  ensures stepNoCutInNoticeWindow(m, via, after)
  ensures stepFrozenStable(m, after)
  ensures stepObligationsMonotone(m, after)
  ensures stepSequenceCounts(m, via, after)
  ensures stepChangesAndCutsRetained(m, after)
  ensures stepProposalWrittenOnce(m, after)
  ensures stepUnderfundedNoticeOnce(m, after)
  ensures stepPeriodFixed(m, after)
{
  hide *;
  reveal stepNoCutInNoticeWindow, stepFrozenStable, stepObligationsMonotone, stepSequenceCounts, stepChangesAndCutsRetained, stepProposalWrittenOnce, stepUnderfundedNoticeOnce, stepPeriodFixed;
}

lemma observeClock_ensures(m: Monthly, now: int)
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysCloseoutOnlyForTheReviewedMonth(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysCloseoutUnchanged(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysAllocationConserved(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysUnproposedEmpty(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysCapFromRevision(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysCutsRecorded(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysPublicCutsCurrent(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysAutomaticHonoursCutNotice(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysFreezeAfterCutNotice(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysEveryPayableShareAccounted(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysBannedHadShares(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysNoObligationsBeforeFunding(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysCompletedPaid(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysFrozenRecord(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysObligationsMatchShares(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> alwaysExclusionsFromRevision(observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> stepNoCutInNoticeWindow(m, "observeClock", observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> stepPledgeKept(m, observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> stepFrozenStable(m, observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> stepObligationsMonotone(m, observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> stepSequenceCounts(m, "observeClock", observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> stepChangesAndCutsRetained(m, observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> stepProposalWrittenOnce(m, observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> stepUnderfundedNoticeOnce(m, observeClock(m, now)))
  ensures (inv(m) ==> canObserveClock(m, now) ==> stepPeriodFixed(m, observeClock(m, now)))
{
  hide *;
  if inv(m) && canObserveClock(m, now) {
    reveal canObserveClock, observeClock, inv;
    var after := observeClock(m, now);
    MonthlySameFieldsPart1(m, after);
    MonthlySameFieldsSteps(m, "observeClock", after);
    assert alwaysCutsRecorded(after) && alwaysAutomaticHonoursCutNotice(after) && alwaysFreezeAfterCutNotice(after) && stepPledgeKept(m, after) by {
      reveal alwaysCutsRecorded, alwaysAutomaticHonoursCutNotice, alwaysFreezeAfterCutNotice, stepPledgeKept, cutoff;
    }
  }
}

lemma observeEligibility_ensures(m: Monthly, eligibility: Eligibility)
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysCloseoutOnlyForTheReviewedMonth(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysCloseoutUnchanged(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysAllocationConserved(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysUnproposedEmpty(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysCapFromRevision(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysCutsRecorded(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysPublicCutsCurrent(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysAutomaticHonoursCutNotice(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysFreezeAfterCutNotice(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysEveryPayableShareAccounted(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysBannedHadShares(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysNoObligationsBeforeFunding(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysCompletedPaid(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysFrozenRecord(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysObligationsMatchShares(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> alwaysExclusionsFromRevision(observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> stepNoCutInNoticeWindow(m, "observeEligibility", observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> stepPledgeKept(m, observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> stepFrozenStable(m, observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> stepObligationsMonotone(m, observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> stepSequenceCounts(m, "observeEligibility", observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> stepChangesAndCutsRetained(m, observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> stepProposalWrittenOnce(m, observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> stepUnderfundedNoticeOnce(m, observeEligibility(m, eligibility)))
  ensures (inv(m) ==> canObserveEligibility(m, eligibility) ==> stepPeriodFixed(m, observeEligibility(m, eligibility)))
{
  hide *;
  if inv(m) && canObserveEligibility(m, eligibility) {
    reveal canObserveEligibility, observeEligibility, inv;
    var after := observeEligibility(m, eligibility);
    MonthlySameFieldsPart1(m, after);
    MonthlySameFieldsSteps(m, "observeEligibility", after);
    assert alwaysCutsRecorded(after) && alwaysAutomaticHonoursCutNotice(after) && alwaysFreezeAfterCutNotice(after) && stepPledgeKept(m, after) by {
      reveal alwaysCutsRecorded, alwaysAutomaticHonoursCutNotice, alwaysFreezeAfterCutNotice, stepPledgeKept, cutoff;
    }
  }
}

lemma observeRevision_ensures(m: Monthly, revision: RevisionFact)
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysCloseoutOnlyForTheReviewedMonth(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysCloseoutUnchanged(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysAllocationConserved(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysUnproposedEmpty(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysCapFromRevision(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysCutsRecorded(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysPublicCutsCurrent(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysAutomaticHonoursCutNotice(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysFreezeAfterCutNotice(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysEveryPayableShareAccounted(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysBannedHadShares(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysNoObligationsBeforeFunding(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysCompletedPaid(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysFrozenRecord(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysObligationsMatchShares(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> alwaysExclusionsFromRevision(observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> stepNoCutInNoticeWindow(m, "observeRevision", observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> stepPledgeKept(m, observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> stepFrozenStable(m, observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> stepObligationsMonotone(m, observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> stepSequenceCounts(m, "observeRevision", observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> stepChangesAndCutsRetained(m, observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> stepProposalWrittenOnce(m, observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> stepUnderfundedNoticeOnce(m, observeRevision(m, revision)))
  ensures (inv(m) ==> canObserveRevision(m, revision) ==> stepPeriodFixed(m, observeRevision(m, revision)))
{
  hide *;
  if inv(m) && canObserveRevision(m, revision) {
    reveal canObserveRevision, observeRevision, inv;
    var after := observeRevision(m, revision);
    MonthlySameFieldsPart1(m, after);
    MonthlySameFieldsSteps(m, "observeRevision", after);
    assert alwaysCutsRecorded(after) && alwaysAutomaticHonoursCutNotice(after) && alwaysFreezeAfterCutNotice(after) && stepPledgeKept(m, after) by {
      reveal alwaysCutsRecorded, alwaysAutomaticHonoursCutNotice, alwaysFreezeAfterCutNotice, stepPledgeKept, cutoff;
    }
  }
}

lemma observeSettings_ensures(m: Monthly, automatic: bool, settingsSequence: int)
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysCloseoutOnlyForTheReviewedMonth(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysCloseoutUnchanged(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysAllocationConserved(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysUnproposedEmpty(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysCapFromRevision(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysCutsRecorded(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysPublicCutsCurrent(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysAutomaticHonoursCutNotice(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysFreezeAfterCutNotice(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysEveryPayableShareAccounted(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysBannedHadShares(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysNoObligationsBeforeFunding(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysCompletedPaid(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysFrozenRecord(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysObligationsMatchShares(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> alwaysExclusionsFromRevision(observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> stepNoCutInNoticeWindow(m, "observeSettings", observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> stepPledgeKept(m, observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> stepFrozenStable(m, observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> stepObligationsMonotone(m, observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> stepSequenceCounts(m, "observeSettings", observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> stepChangesAndCutsRetained(m, observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> stepProposalWrittenOnce(m, observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> stepUnderfundedNoticeOnce(m, observeSettings(m, automatic, settingsSequence)))
  ensures (inv(m) ==> canObserveSettings(m, automatic, settingsSequence) ==> stepPeriodFixed(m, observeSettings(m, automatic, settingsSequence)))
{
  hide *;
  if inv(m) && canObserveSettings(m, automatic, settingsSequence) {
    reveal canObserveSettings, observeSettings, inv;
    var after := observeSettings(m, automatic, settingsSequence);
    MonthlySameFieldsPart1(m, after);
    MonthlySameFieldsSteps(m, "observeSettings", after);
    assert alwaysCutsRecorded(after) && alwaysAutomaticHonoursCutNotice(after) && alwaysFreezeAfterCutNotice(after) && stepPledgeKept(m, after) by {
      reveal alwaysCutsRecorded, alwaysAutomaticHonoursCutNotice, alwaysFreezeAfterCutNotice, stepPledgeKept, cutNoticeOutlastsCutoff, lateCutNoticeAt, cutoff;
    }
  }
}

lemma observePledge_ensures(m: Monthly, pledgeVault: string)
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysCloseoutOnlyForTheReviewedMonth(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysCloseoutUnchanged(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysAllocationConserved(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysUnproposedEmpty(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysCapFromRevision(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysCutsRecorded(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysPublicCutsCurrent(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysAutomaticHonoursCutNotice(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysFreezeAfterCutNotice(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysEveryPayableShareAccounted(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysBannedHadShares(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysNoObligationsBeforeFunding(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysCompletedPaid(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysFrozenRecord(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysObligationsMatchShares(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> alwaysExclusionsFromRevision(observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> stepNoCutInNoticeWindow(m, "observePledge", observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> stepPledgeKept(m, observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> stepFrozenStable(m, observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> stepObligationsMonotone(m, observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> stepSequenceCounts(m, "observePledge", observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> stepChangesAndCutsRetained(m, observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> stepProposalWrittenOnce(m, observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> stepUnderfundedNoticeOnce(m, observePledge(m, pledgeVault)))
  ensures (inv(m) ==> canObservePledge(m, pledgeVault) ==> stepPeriodFixed(m, observePledge(m, pledgeVault)))
{
  hide *;
  if inv(m) && canObservePledge(m, pledgeVault) {
    reveal canObservePledge, observePledge, inv;
    var after := observePledge(m, pledgeVault);
    MonthlySameFieldsPart1(m, after);
    MonthlySameFieldsSteps(m, "observePledge", after);
    assert alwaysCutsRecorded(after) && alwaysAutomaticHonoursCutNotice(after) && alwaysFreezeAfterCutNotice(after) && stepPledgeKept(m, after) by {
      reveal alwaysCutsRecorded, alwaysAutomaticHonoursCutNotice, alwaysFreezeAfterCutNotice, stepPledgeKept, cutoff;
    }
  }
}

lemma MonthlySelfNotBelow(after: Monthly)
  requires after.shares == after.proposedShares
  requires after.publicCuts == []
  requires forall s :: s in after.shares ==> settlement__money_validAmount(s.amount)
  requires ProofLib.DistinctBy(after.shares, (s: settlement__allocation_Share) => s.actor)
  ensures alwaysPublicCutsCurrent(after)
{
  hide *;
  reveal ProofLib.DistinctBy, alwaysPublicCutsCurrent, belowProposal, settlement__money_lawNumericOrderTotal;
  forall s | s in after.shares ensures !belowProposal(after, s.actor, s.amount) {
    var i :| 0 <= i < |after.shares| && after.shares[i] == s;
    forall p | p in after.proposedShares && p.actor == s.actor
      ensures !(settlement__money_compareAmounts(s.amount, p.amount) < 0)
    {
      var j :| 0 <= j < |after.shares| && after.shares[j] == p;
      assert i == j && p == s;
      settlement__money_lawNumericOrderTotal_ensures(s.amount, s.amount);
    }
  }
}

lemma MonthlyProposeAlloc(m: Monthly, snapshot: settlement__payoutExclusions_WorkSnapshot, exclusions: seq<settlement__payoutExclusions_Exclusion>, revision: RevisionFact, basisPoints: int, record: settlement__maintainerShare_DecisionRecord)
  requires alwaysUnproposedEmpty(m) && alwaysPublicCutsCurrent(m)
  requires canPropose(m, snapshot, exclusions, revision, basisPoints, record)
  ensures alwaysAllocationConserved(propose(m, snapshot, exclusions, revision, basisPoints, record))
  ensures alwaysPublicCutsCurrent(propose(m, snapshot, exclusions, revision, basisPoints, record))
{
  hide *;
  reveal ProofLib.Filter, ProofLib.DistinctBy, canPropose, propose, proposalShares, maintainerPool, shareRecordFits, alwaysAllocationConserved, alwaysUnproposedEmpty, alwaysPublicCutsCurrent, proposedPhase, settlement__allocation_canCommitAllocation, settlement__maintainerShare_maintainerShares, settlement__allocation_allocateAmounts, settlement__allocation_allocatedTotal, Std.Collections.Seq.FoldLeft, settlement__money_lawEqualReflexive, settlement__money_lawEqualSymmetric, settlement__money_lawEqualOrder, settlement__money_lawZeroOrder, settlement__money_lawZeroIdentity, settlement__money_lawSubtractionValid, settlement__money_lawSubtractionAtMost, settlement__money_lawSubtractionReconstructs, settlement__money_lawAddCongruence, settlement__money_lawAdditionValid, settlement__money_lawAddCommutative, settlement__money_lawNumericOrderTransitive;
  MonthlyZeroValid();
  var after := propose(m, snapshot, exclusions, revision, basisPoints, record);
  var weights := settlement__payoutExclusions_rewardWeights(snapshot, exclusions);
  var pool := maintainerPool(revision, exclusions, basisPoints, record);
  var mWeights := settlement__maintainerShare_shareWeights(record, exclusions);
  var rem := settlement__money_subtractAmounts(revision.monthlyAmount, pool);
  var points := if |weights| == 0 then [] else settlement__allocation_allocateAmounts(rem, weights);
  var maintainers := settlement__maintainerShare_maintainerShares(pool, mWeights);
  var shares := mergedShares(points, maintainers);
  assert after.shares == shares && after.proposedShares == shares && after.cap == revision.monthlyAmount;
  MonthlyPoolValid(revision.monthlyAmount, basisPoints, mWeights);
  settlement__money_lawSubtractionValid_ensures(revision.monthlyAmount, pool);
  if |weights| > 0 {
    MonthlyAllocatedSharesProps(rem, weights);
  }
  if settlement__money_positiveAmount(pool) && settlement__allocation_canAllocate(pool, mWeights) {
    MonthlyAllocatedSharesProps(pool, mWeights);
  } else {
    assert maintainers == [];
  }
  MonthlyMergedSharesValidUnique(points, maintainers);
  MonthlyMergedTotal(points, maintainers);
  MonthlyAllocatedTotalValid(points);
  MonthlyAllocatedTotalValid(maintainers);
  MonthlyAllocatedTotalValid(shares);
  var tp := settlement__allocation_allocatedTotal(points);
  var tm := settlement__allocation_allocatedTotal(maintainers);
  var ts := settlement__allocation_allocatedTotal(shares);
  var cap := revision.monthlyAmount;
  if |shares| == 0 {
    assert after.total == settlement__money_zero;
    assert ts == settlement__money_zero;
    settlement__money_lawZeroOrder_ensures(cap);
    reveal settlement__money_lawNumericOrderTotal;
    settlement__money_lawNumericOrderTotal_ensures(settlement__money_zero, cap);
  } else {
    assert after.total == ts;
    settlement__money_lawEqualReflexive_ensures(ts);
    reveal settlement__money_lawNumericOrderTotal;
    if |weights| == 0 {
      assert tp == settlement__money_zero;
      settlement__money_lawAddCommutative_ensures(settlement__money_zero, tm);
      settlement__money_lawZeroIdentity_ensures(tm);
      MonthlyEqualTrans(ts, settlement__money_addAmounts(settlement__money_zero, tm), tm);
      if settlement__money_positiveAmount(pool) && settlement__allocation_canAllocate(pool, mWeights) {
        MonthlyEqualTrans(ts, tm, pool);
        settlement__money_lawNumericOrderTotal_ensures(pool, cap);
        settlement__money_lawEqualOrder_ensures(ts, pool, cap);
      } else {
        assert tm == settlement__money_zero;
        settlement__money_lawZeroOrder_ensures(cap);
        settlement__money_lawNumericOrderTotal_ensures(settlement__money_zero, cap);
        settlement__money_lawEqualOrder_ensures(ts, settlement__money_zero, cap);
      }
    } else {
      if settlement__money_positiveAmount(pool) && settlement__allocation_canAllocate(pool, mWeights) {
        settlement__money_lawAddCongruence_ensures(tp, rem, tm);
        settlement__money_lawAddCongruence_ensures(tm, pool, rem);
        settlement__money_lawSubtractionReconstructs_ensures(cap, pool);
        MonthlyEqualTrans(ts, settlement__money_addAmounts(tp, tm), settlement__money_addAmounts(rem, tm));
        MonthlyEqualTrans(ts, settlement__money_addAmounts(rem, tm), settlement__money_addAmounts(rem, pool));
        MonthlyEqualTrans(ts, settlement__money_addAmounts(rem, pool), cap);
        settlement__money_lawEqualOrder_ensures(ts, cap, cap);
        settlement__money_lawNumericOrderTotal_ensures(cap, cap);
      } else {
        assert tm == settlement__money_zero;
        settlement__money_lawZeroIdentity_ensures(tp);
        MonthlyEqualTrans(ts, settlement__money_addAmounts(tp, settlement__money_zero), tp);
        MonthlyEqualTrans(ts, tp, rem);
        settlement__money_lawSubtractionAtMost_ensures(cap, pool);
        settlement__money_lawEqualOrder_ensures(ts, rem, cap);
      }
    }
  }
  assert after.publicCuts == [] by {
    assert |m.cuts| == 0;
    if |m.publicCuts| > 0 {
      assert m.publicCuts[0] in m.cuts;
    }
  }
  MonthlySelfNotBelow(after);
}

lemma propose_ensures(m: Monthly, snapshot: settlement__payoutExclusions_WorkSnapshot, exclusions: seq<settlement__payoutExclusions_Exclusion>, revision: RevisionFact, basisPoints: int, record: settlement__maintainerShare_DecisionRecord)
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysCloseoutOnlyForTheReviewedMonth(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysCloseoutUnchanged(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysAllocationConserved(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysUnproposedEmpty(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysCapFromRevision(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysCutsRecorded(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysPublicCutsCurrent(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysAutomaticHonoursCutNotice(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysFreezeAfterCutNotice(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysEveryPayableShareAccounted(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysBannedHadShares(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysNoObligationsBeforeFunding(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysCompletedPaid(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysFrozenRecord(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysObligationsMatchShares(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> alwaysExclusionsFromRevision(propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> stepNoCutInNoticeWindow(m, "propose", propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> stepPledgeKept(m, propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> stepFrozenStable(m, propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> stepObligationsMonotone(m, propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> stepSequenceCounts(m, "propose", propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> stepChangesAndCutsRetained(m, propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> stepProposalWrittenOnce(m, propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> stepUnderfundedNoticeOnce(m, propose(m, snapshot, exclusions, revision, basisPoints, record)))
  ensures (inv(m) ==> canPropose(m, snapshot, exclusions, revision, basisPoints, record) ==> stepPeriodFixed(m, propose(m, snapshot, exclusions, revision, basisPoints, record)))
{
  hide *;
  if inv(m) && canPropose(m, snapshot, exclusions, revision, basisPoints, record) {
    reveal inv, canPropose, propose;
    var after := propose(m, snapshot, exclusions, revision, basisPoints, record);
    MonthlyProposeAlloc(m, snapshot, exclusions, revision, basisPoints, record);
    assert alwaysCloseoutOnlyForTheReviewedMonth(after) && alwaysCloseoutUnchanged(after) && alwaysUnproposedEmpty(after) && alwaysCapFromRevision(after) by {
      reveal alwaysCloseoutOnlyForTheReviewedMonth, alwaysCloseoutUnchanged, alwaysUnproposedEmpty, alwaysCapFromRevision, reviewedOctoberPool, proposedPhase;
    }
    assert alwaysCutsRecorded(after) && alwaysAutomaticHonoursCutNotice(after) && alwaysFreezeAfterCutNotice(after) && alwaysExclusionsFromRevision(after) by {
      reveal alwaysCutsRecorded, alwaysAutomaticHonoursCutNotice, alwaysFreezeAfterCutNotice, alwaysExclusionsFromRevision, alwaysUnproposedEmpty, proposedPhase, frozenPhase;
    }
    assert alwaysEveryPayableShareAccounted(after) && alwaysBannedHadShares(after) && alwaysNoObligationsBeforeFunding(after) && alwaysCompletedPaid(after) && alwaysFrozenRecord(after) && alwaysObligationsMatchShares(after) by {
      reveal alwaysEveryPayableShareAccounted, alwaysBannedHadShares, alwaysNoObligationsBeforeFunding, alwaysCompletedPaid, alwaysFrozenRecord, alwaysObligationsMatchShares;
    }
    assert stepNoCutInNoticeWindow(m, "propose", after) && stepPledgeKept(m, after) && stepFrozenStable(m, after) && stepObligationsMonotone(m, after) && stepSequenceCounts(m, "propose", after) && stepChangesAndCutsRetained(m, after) && stepProposalWrittenOnce(m, after) && stepUnderfundedNoticeOnce(m, after) && stepPeriodFixed(m, after) by {
      reveal stepNoCutInNoticeWindow, stepPledgeKept, stepFrozenStable, stepObligationsMonotone, stepSequenceCounts, stepChangesAndCutsRetained, stepProposalWrittenOnce, stepUnderfundedNoticeOnce, stepPeriodFixed, alwaysNoObligationsBeforeFunding, proposedPhase, frozenPhase;
    }
  }
}

lemma MonthlyProposeCloseoutAlloc(m: Monthly, snapshot: settlement__payoutExclusions_WorkSnapshot, exclusions: seq<settlement__payoutExclusions_Exclusion>, revision: RevisionFact)
  requires alwaysUnproposedEmpty(m) && alwaysPublicCutsCurrent(m)
  requires canProposeCloseout(m, snapshot, exclusions, revision)
  ensures alwaysAllocationConserved(proposeCloseout(m, snapshot, exclusions, revision))
  ensures alwaysPublicCutsCurrent(proposeCloseout(m, snapshot, exclusions, revision))
{
  hide *;
  reveal ProofLib.Filter, ProofLib.DistinctBy, canProposeCloseout, proposeCloseout, alwaysAllocationConserved, alwaysUnproposedEmpty, alwaysPublicCutsCurrent, proposedPhase, settlement__allocation_canCommitAllocation, settlement__allocation_allocatedTotal, Std.Collections.Seq.FoldLeft, settlement__asiNovemberCloseout_closeoutCap, settlement__money_validAmount, settlement__money_lawEqualReflexive, settlement__money_lawEqualOrder, settlement__money_lawZeroOrder, settlement__money_lawNumericOrderTotal;
  MonthlyZeroValid();
  var after := proposeCloseout(m, snapshot, exclusions, revision);
  var weights := settlement__payoutExclusions_rewardWeights(snapshot, exclusions);
  var cap := settlement__asiNovemberCloseout_closeoutCap;
  var shares := after.shares;
  assert settlement__money_validAmount(cap);
  if |weights| == 0 {
    assert shares == [] && after.total == settlement__money_zero;
    settlement__money_lawZeroOrder_ensures(cap);
  } else {
    MonthlyAllocatedSharesProps(cap, weights);
    MonthlyAllocatedTotalValid(shares);
    var key := (s: settlement__allocation_Share) => s.actor;
    forall s | s in shares ensures |ProofLib.Filter((o: settlement__allocation_Share) => o.actor == s.actor, shares)| == 1 {
      var i :| 0 <= i < |shares| && shares[i] == s;
      ProofLib.FilterCountOneIffUnique((o: settlement__allocation_Share) => o.actor == s.actor, shares, key, i);
    }
    if |shares| == 0 {
      settlement__money_lawZeroOrder_ensures(cap);
    } else {
      settlement__money_lawEqualReflexive_ensures(after.total);
      settlement__money_lawNumericOrderTotal_ensures(cap, cap);
      settlement__money_lawEqualOrder_ensures(after.total, cap, cap);
    }
  }
  assert after.publicCuts == [] by {
    assert |m.cuts| == 0;
    if |m.publicCuts| > 0 {
      assert m.publicCuts[0] in m.cuts;
    }
  }
  MonthlySelfNotBelow(after);
}

lemma MonthlyCloseoutCapPositive()
  ensures settlement__money_positiveAmount(settlement__asiNovemberCloseout_closeoutCap)
{
}

lemma proposeCloseout_ensures(m: Monthly, snapshot: settlement__payoutExclusions_WorkSnapshot, exclusions: seq<settlement__payoutExclusions_Exclusion>, revision: RevisionFact)
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysCloseoutOnlyForTheReviewedMonth(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysCloseoutUnchanged(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysAllocationConserved(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysUnproposedEmpty(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysCapFromRevision(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysCutsRecorded(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysPublicCutsCurrent(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysAutomaticHonoursCutNotice(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysFreezeAfterCutNotice(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysEveryPayableShareAccounted(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysBannedHadShares(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysNoObligationsBeforeFunding(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysCompletedPaid(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysFrozenRecord(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysObligationsMatchShares(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> alwaysExclusionsFromRevision(proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> stepNoCutInNoticeWindow(m, "proposeCloseout", proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> stepPledgeKept(m, proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> stepFrozenStable(m, proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> stepObligationsMonotone(m, proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> stepSequenceCounts(m, "proposeCloseout", proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> stepChangesAndCutsRetained(m, proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> stepProposalWrittenOnce(m, proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> stepUnderfundedNoticeOnce(m, proposeCloseout(m, snapshot, exclusions, revision)))
  ensures (inv(m) ==> canProposeCloseout(m, snapshot, exclusions, revision) ==> stepPeriodFixed(m, proposeCloseout(m, snapshot, exclusions, revision)))
{
  hide *;
  if inv(m) && canProposeCloseout(m, snapshot, exclusions, revision) {
    reveal inv, canProposeCloseout, proposeCloseout;
    var after := proposeCloseout(m, snapshot, exclusions, revision);
    MonthlyProposeCloseoutAlloc(m, snapshot, exclusions, revision);
    assert alwaysCloseoutOnlyForTheReviewedMonth(after) && alwaysCloseoutUnchanged(after) && alwaysUnproposedEmpty(after) && alwaysCapFromRevision(after) by {
      MonthlyCloseoutCapPositive();
      reveal alwaysCloseoutOnlyForTheReviewedMonth, alwaysCloseoutUnchanged, alwaysUnproposedEmpty, alwaysCapFromRevision, reviewedOctoberPool, proposedPhase, settlement__asiNovemberCloseout_closeoutCap, settlement__asiNovemberCloseout_closeoutCutoff;
    }
    assert alwaysCutsRecorded(after) && alwaysAutomaticHonoursCutNotice(after) && alwaysFreezeAfterCutNotice(after) && alwaysExclusionsFromRevision(after) by {
      reveal alwaysCutsRecorded, alwaysAutomaticHonoursCutNotice, alwaysFreezeAfterCutNotice, alwaysExclusionsFromRevision, alwaysUnproposedEmpty, proposedPhase, frozenPhase;
    }
    assert alwaysEveryPayableShareAccounted(after) && alwaysBannedHadShares(after) && alwaysNoObligationsBeforeFunding(after) && alwaysCompletedPaid(after) && alwaysFrozenRecord(after) && alwaysObligationsMatchShares(after) by {
      reveal alwaysEveryPayableShareAccounted, alwaysBannedHadShares, alwaysNoObligationsBeforeFunding, alwaysCompletedPaid, alwaysFrozenRecord, alwaysObligationsMatchShares;
    }
    assert stepNoCutInNoticeWindow(m, "proposeCloseout", after) && stepPledgeKept(m, after) && stepFrozenStable(m, after) && stepObligationsMonotone(m, after) && stepSequenceCounts(m, "proposeCloseout", after) && stepChangesAndCutsRetained(m, after) && stepProposalWrittenOnce(m, after) && stepUnderfundedNoticeOnce(m, after) && stepPeriodFixed(m, after) by {
      reveal stepNoCutInNoticeWindow, stepPledgeKept, stepFrozenStable, stepObligationsMonotone, stepSequenceCounts, stepChangesAndCutsRetained, stepProposalWrittenOnce, stepUnderfundedNoticeOnce, stepPeriodFixed, alwaysNoObligationsBeforeFunding, proposedPhase, frozenPhase;
    }
  }
}

lemma MonthlyReplaceShareProps(shares: seq<settlement__allocation_Share>, actor: int, amount: seq<int>)
  requires settlement__money_validAmount(amount)
  requires forall s :: s in shares ==> settlement__money_validAmount(s.amount) && s.actor > 0 && |ProofLib.Filter((o: settlement__allocation_Share) => o.actor == s.actor, shares)| == 1
  ensures var rs := replaceShare(shares, actor, amount);
    |rs| == |shares|
    && (forall i :: 0 <= i < |rs| ==> rs[i].actor == shares[i].actor && (if shares[i].actor == actor then rs[i].amount == amount else rs[i] == shares[i]))
    && (forall s :: s in rs ==> settlement__money_validAmount(s.amount) && s.actor > 0 && |ProofLib.Filter((o: settlement__allocation_Share) => o.actor == s.actor, rs)| == 1)
{
  hide *;
  reveal ProofLib.Filter, replaceShare;
  var rs := replaceShare(shares, actor, amount);
  forall s | s in rs
    ensures settlement__money_validAmount(s.amount) && s.actor > 0 && |ProofLib.Filter((o: settlement__allocation_Share) => o.actor == s.actor, rs)| == 1
  {
    var i :| 0 <= i < |rs| && rs[i] == s;
    assert shares[i] in shares && shares[i].actor == s.actor;
    ProofLib.FilterLengthPointwise((o: settlement__allocation_Share) => o.actor == s.actor, (o: settlement__allocation_Share) => o.actor == shares[i].actor, rs, shares);
  }
}

lemma MonthlyChangesAppendUnique(changes: seq<Change>, seqNum: int, ch: Change)
  requires seqNum >= 0 && ch.sequence == seqNum + 1
  requires forall x :: x in changes ==> x.sequence > 0 && x.sequence <= seqNum && |ProofLib.Filter((o: Change) => o.sequence == x.sequence, changes)| == 1
  ensures forall x :: x in (changes + [ch]) ==> x.sequence > 0 && x.sequence <= seqNum + 1 && |ProofLib.Filter((o: Change) => o.sequence == x.sequence, changes + [ch])| == 1
{
  hide *;
  reveal ProofLib.Filter;
  var xs := changes + [ch];
  forall x | x in xs
    ensures x.sequence > 0 && x.sequence <= seqNum + 1 && |ProofLib.Filter((o: Change) => o.sequence == x.sequence, xs)| == 1
  {
    var p := (o: Change) => o.sequence == x.sequence;
    ProofLib.FilterAppend(p, changes, ch);
    if x == ch {
      ProofLib.FilterNone(p, changes);
    } else {
      assert x in changes && x.sequence <= seqNum;
    }
  }
}

lemma MonthlyPublicCutsFilter(publicCuts: seq<Cut>, actor: int)
  requires forall c :: c in publicCuts ==> |ProofLib.Filter((o: Cut) => o.actor == c.actor, publicCuts)| == 1
  ensures var fc := ProofLib.Filter((c: Cut) => c.actor != actor, publicCuts);
    (forall c :: c in fc <==> c in publicCuts && c.actor != actor)
    && (forall c :: c in fc ==> |ProofLib.Filter((o: Cut) => o.actor == c.actor, fc)| == 1)
{
  hide *;
  reveal ProofLib.Filter, ProofLib.DistinctBy;
  var p := (c: Cut) => c.actor != actor;
  var key := (c: Cut) => c.actor;
  var fc := ProofLib.Filter(p, publicCuts);
  forall c ensures c in fc <==> c in publicCuts && c.actor != actor {
    ProofLib.FilterMember(p, publicCuts, c);
  }
  assert ProofLib.DistinctBy(publicCuts, key) by {
    forall i, j | 0 <= i < |publicCuts| && 0 <= j < |publicCuts| && i != j ensures publicCuts[i].actor != publicCuts[j].actor {
      ProofLib.FilterCountOneIffUnique((o: Cut) => o.actor == publicCuts[i].actor, publicCuts, key, i);
    }
  }
  ProofLib.FilterKeepsDistinctBy(p, publicCuts, key);
  forall c | c in fc ensures |ProofLib.Filter((o: Cut) => o.actor == c.actor, fc)| == 1 {
    var i :| 0 <= i < |fc| && fc[i] == c;
    ProofLib.FilterCountOneIffUnique((o: Cut) => o.actor == c.actor, fc, key, i);
  }
}

lemma MonthlyPublicCutsAppend(fc: seq<Cut>, record: Cut)
  requires forall c :: c in fc ==> c.actor != record.actor && |ProofLib.Filter((o: Cut) => o.actor == c.actor, fc)| == 1
  ensures forall c :: c in (fc + [record]) ==> |ProofLib.Filter((o: Cut) => o.actor == c.actor, fc + [record])| == 1
{
  hide *;
  reveal ProofLib.Filter;
  var xs := fc + [record];
  forall c | c in xs ensures |ProofLib.Filter((o: Cut) => o.actor == c.actor, xs)| == 1 {
    var p := (o: Cut) => o.actor == c.actor;
    ProofLib.FilterAppend(p, fc, record);
    if c == record {
      ProofLib.FilterNone(p, fc);
    } else {
      assert c in fc && c.actor != record.actor;
    }
  }
}

lemma MonthlyAdjustCore(m: Monthly, actor: int, amount: seq<int>, expectedSequence: int, fact: AuthorityFact)
  requires alwaysAllocationConserved(m) && alwaysCutsRecorded(m) && alwaysPublicCutsCurrent(m)
  requires canAdjust(m, actor, amount, expectedSequence, fact)
  ensures alwaysAllocationConserved(adjust(m, actor, amount, expectedSequence, fact))
  ensures alwaysCutsRecorded(adjust(m, actor, amount, expectedSequence, fact))
  ensures alwaysPublicCutsCurrent(adjust(m, actor, amount, expectedSequence, fact))
{
  hide *;
  reveal ProofLib.Filter, canAdjust, changeAllowed, adjust, alwaysAllocationConserved, alwaysCutsRecorded, alwaysPublicCutsCurrent, belowProposal, settlement__money_lawEqualReflexive;
  var after := adjust(m, actor, amount, expectedSequence, fact);
  MonthlyReplaceShareProps(m.shares, actor, amount);
  MonthlyAllocatedTotalValid(after.shares);
  settlement__money_lawEqualReflexive_ensures(after.total);
  var ch := Change(actor, fact.actor, amount, m.sequence + 1, m.now, false);
  MonthlyChangesAppendUnique(m.changes, m.sequence, ch);
  MonthlyPublicCutsFilter(m.publicCuts, actor);
  forall c | c in after.publicCuts
    ensures c in after.cuts
    ensures |ProofLib.Filter((o: Cut) => o.actor == c.actor, after.publicCuts)| == 1
    ensures exists s :: s in after.shares && s.actor == c.actor && s.amount == c.amount
    ensures forall x :: x in after.changes && x.actor == c.actor ==> x.sequence <= c.sequence
  {
    assert c in m.publicCuts && c.actor != actor;
    var s0 :| s0 in m.shares && s0.actor == c.actor && s0.amount == c.amount;
    var i :| 0 <= i < |m.shares| && m.shares[i] == s0;
    assert after.shares[i] == s0 && after.shares[i] in after.shares;
  }
  forall s | s in after.shares && belowProposal(after, s.actor, s.amount)
    ensures exists c :: c in after.publicCuts && c.actor == s.actor
  {
    var i :| 0 <= i < |after.shares| && after.shares[i] == s;
    assert s.actor != actor;
    assert m.shares[i] == s && belowProposal(m, s.actor, s.amount);
    var c :| c in m.publicCuts && c.actor == s.actor;
    assert c in after.publicCuts;
  }
}

lemma adjust_ensures(m: Monthly, actor: int, amount: seq<int>, expectedSequence: int, fact: AuthorityFact)
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysCloseoutOnlyForTheReviewedMonth(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysCloseoutUnchanged(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysAllocationConserved(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysUnproposedEmpty(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysCapFromRevision(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysCutsRecorded(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysPublicCutsCurrent(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysAutomaticHonoursCutNotice(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysFreezeAfterCutNotice(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysEveryPayableShareAccounted(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysBannedHadShares(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysNoObligationsBeforeFunding(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysCompletedPaid(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysFrozenRecord(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysObligationsMatchShares(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> alwaysExclusionsFromRevision(adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> stepNoCutInNoticeWindow(m, "adjust", adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> stepPledgeKept(m, adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> stepFrozenStable(m, adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> stepObligationsMonotone(m, adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> stepSequenceCounts(m, "adjust", adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> stepChangesAndCutsRetained(m, adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> stepProposalWrittenOnce(m, adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> stepUnderfundedNoticeOnce(m, adjust(m, actor, amount, expectedSequence, fact)))
  ensures (inv(m) ==> canAdjust(m, actor, amount, expectedSequence, fact) ==> stepPeriodFixed(m, adjust(m, actor, amount, expectedSequence, fact)))
{
  hide *;
  if inv(m) && canAdjust(m, actor, amount, expectedSequence, fact) {
    reveal inv, canAdjust, changeAllowed, adjust;
    var after := adjust(m, actor, amount, expectedSequence, fact);
    MonthlyAdjustCore(m, actor, amount, expectedSequence, fact);
    assert alwaysCloseoutOnlyForTheReviewedMonth(after) && alwaysCloseoutUnchanged(after) && alwaysUnproposedEmpty(after) && alwaysCapFromRevision(after) by {
      reveal alwaysCloseoutOnlyForTheReviewedMonth, alwaysCloseoutUnchanged, alwaysUnproposedEmpty, alwaysCapFromRevision, reviewedOctoberPool, proposedPhase;
    }
    assert alwaysAutomaticHonoursCutNotice(after) && alwaysFreezeAfterCutNotice(after) && alwaysExclusionsFromRevision(after) by {
      reveal alwaysAutomaticHonoursCutNotice, alwaysFreezeAfterCutNotice, alwaysExclusionsFromRevision, cutoff, frozenPhase;
    }
    assert alwaysEveryPayableShareAccounted(after) && alwaysBannedHadShares(after) && alwaysNoObligationsBeforeFunding(after) && alwaysCompletedPaid(after) && alwaysFrozenRecord(after) && alwaysObligationsMatchShares(after) by {
      reveal alwaysEveryPayableShareAccounted, alwaysBannedHadShares, alwaysNoObligationsBeforeFunding, alwaysCompletedPaid, alwaysFrozenRecord, alwaysObligationsMatchShares;
    }
    assert stepNoCutInNoticeWindow(m, "adjust", after) && stepPledgeKept(m, after) && stepFrozenStable(m, after) && stepObligationsMonotone(m, after) && stepSequenceCounts(m, "adjust", after) && stepChangesAndCutsRetained(m, after) && stepProposalWrittenOnce(m, after) && stepUnderfundedNoticeOnce(m, after) && stepPeriodFixed(m, after) by {
      reveal stepNoCutInNoticeWindow, stepPledgeKept, stepFrozenStable, stepObligationsMonotone, stepSequenceCounts, stepChangesAndCutsRetained, stepProposalWrittenOnce, stepUnderfundedNoticeOnce, stepPeriodFixed, alwaysNoObligationsBeforeFunding, frozenPhase;
    }
  }
}

lemma MonthlyCutCore(m: Monthly, actor: int, amount: seq<int>, reasonLength: int, expectedSequence: int, fact: AuthorityFact)
  requires alwaysAllocationConserved(m) && alwaysCutsRecorded(m) && alwaysPublicCutsCurrent(m)
  requires canCut(m, actor, amount, reasonLength, expectedSequence, fact)
  ensures alwaysAllocationConserved(cut(m, actor, amount, reasonLength, expectedSequence, fact))
  ensures alwaysCutsRecorded(cut(m, actor, amount, reasonLength, expectedSequence, fact))
  ensures alwaysPublicCutsCurrent(cut(m, actor, amount, reasonLength, expectedSequence, fact))
{
  hide *;
  reveal ProofLib.Filter, ProofLib.DistinctBy, canCut, changeAllowed, cut, proposedFor, hasActor, belowProposal, alwaysAllocationConserved, alwaysCutsRecorded, alwaysPublicCutsCurrent, settlement__money_lawEqualReflexive, settlement__money_lawEqualOrder;
  var after := cut(m, actor, amount, reasonLength, expectedSequence, fact);
  MonthlyReplaceShareProps(m.shares, actor, amount);
  MonthlyAllocatedTotalValid(after.shares);
  settlement__money_lawEqualReflexive_ensures(after.total);
  var ch := Change(actor, fact.actor, amount, m.sequence + 1, m.now, true);
  MonthlyChangesAppendUnique(m.changes, m.sequence, ch);
  var p :| p in m.proposedShares && p.actor == actor && settlement__money_compareAmounts(amount, p.amount) < 0;
  var pidx :| 0 <= pidx < |m.proposedShares| && m.proposedShares[pidx] == p;
  var key := (s: settlement__allocation_Share) => s.actor;
  ProofLib.FilterCountOneIffUnique((o: settlement__allocation_Share) => o.actor == p.actor, m.proposedShares, key, pidx);
  MonthlyAmountForUnique(m.proposedShares, actor, pidx);
  settlement__money_lawEqualOrder_ensures(proposedFor(m, actor), p.amount, amount);
  var record := Cut(actor, fact.actor, proposedFor(m, actor), amount, reasonLength, m.now, m.sequence + 1);
  assert ch in after.changes && record in after.cuts;
  assert CutNotice(m.project, m.period, actor, m.sequence + 1) in after.notices;
  MonthlyPublicCutsFilter(m.publicCuts, actor);
  var fc := ProofLib.Filter((c: Cut) => c.actor != actor, m.publicCuts);
  MonthlyPublicCutsAppend(fc, record);
  assert after.publicCuts == fc + [record];
  forall c | c in after.publicCuts
    ensures c in after.cuts
    ensures |ProofLib.Filter((o: Cut) => o.actor == c.actor, after.publicCuts)| == 1
    ensures exists s :: s in after.shares && s.actor == c.actor && s.amount == c.amount
    ensures forall x :: x in after.changes && x.actor == c.actor ==> x.sequence <= c.sequence
  {
    if c == record {
      var s0 :| s0 in m.shares && s0.actor == actor;
      var i :| 0 <= i < |m.shares| && m.shares[i] == s0;
      assert after.shares[i].actor == actor && after.shares[i].amount == amount && after.shares[i] in after.shares;
    } else {
      assert c in fc && c in m.publicCuts && c.actor != actor;
      var s0 :| s0 in m.shares && s0.actor == c.actor && s0.amount == c.amount;
      var i :| 0 <= i < |m.shares| && m.shares[i] == s0;
      assert after.shares[i] == s0 && after.shares[i] in after.shares;
    }
  }
  forall s | s in after.shares && belowProposal(after, s.actor, s.amount)
    ensures exists c :: c in after.publicCuts && c.actor == s.actor
  {
    if s.actor == actor {
      assert record in after.publicCuts && record.actor == s.actor;
    } else {
      var i :| 0 <= i < |after.shares| && after.shares[i] == s;
      assert m.shares[i] == s && belowProposal(m, s.actor, s.amount);
      var c :| c in m.publicCuts && c.actor == s.actor;
      assert c in fc && c in after.publicCuts;
    }
  }
}

lemma cut_ensures(m: Monthly, actor: int, amount: seq<int>, reasonLength: int, expectedSequence: int, fact: AuthorityFact)
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysCloseoutOnlyForTheReviewedMonth(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysCloseoutUnchanged(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysAllocationConserved(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysUnproposedEmpty(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysCapFromRevision(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysCutsRecorded(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysPublicCutsCurrent(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysAutomaticHonoursCutNotice(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysFreezeAfterCutNotice(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysEveryPayableShareAccounted(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysBannedHadShares(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysNoObligationsBeforeFunding(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysCompletedPaid(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysFrozenRecord(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysObligationsMatchShares(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> alwaysExclusionsFromRevision(cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> stepNoCutInNoticeWindow(m, "cut", cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> stepPledgeKept(m, cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> stepFrozenStable(m, cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> stepObligationsMonotone(m, cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> stepSequenceCounts(m, "cut", cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> stepChangesAndCutsRetained(m, cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> stepProposalWrittenOnce(m, cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> stepUnderfundedNoticeOnce(m, cut(m, actor, amount, reasonLength, expectedSequence, fact)))
  ensures (inv(m) ==> canCut(m, actor, amount, reasonLength, expectedSequence, fact) ==> stepPeriodFixed(m, cut(m, actor, amount, reasonLength, expectedSequence, fact)))
{
  hide *;
  if inv(m) && canCut(m, actor, amount, reasonLength, expectedSequence, fact) {
    reveal inv, canCut, changeAllowed, cut;
    var after := cut(m, actor, amount, reasonLength, expectedSequence, fact);
    MonthlyCutCore(m, actor, amount, reasonLength, expectedSequence, fact);
    assert alwaysCloseoutOnlyForTheReviewedMonth(after) && alwaysCloseoutUnchanged(after) && alwaysUnproposedEmpty(after) && alwaysCapFromRevision(after) by {
      reveal alwaysCloseoutOnlyForTheReviewedMonth, alwaysCloseoutUnchanged, alwaysUnproposedEmpty, alwaysCapFromRevision, reviewedOctoberPool, proposedPhase;
    }
    assert alwaysAutomaticHonoursCutNotice(after) && alwaysFreezeAfterCutNotice(after) && alwaysExclusionsFromRevision(after) by {
      reveal alwaysAutomaticHonoursCutNotice, alwaysFreezeAfterCutNotice, alwaysExclusionsFromRevision, cutWindowOpen, freezesAtCutoff, cutoff, frozenPhase;
    }
    assert alwaysEveryPayableShareAccounted(after) && alwaysBannedHadShares(after) && alwaysNoObligationsBeforeFunding(after) && alwaysCompletedPaid(after) && alwaysFrozenRecord(after) && alwaysObligationsMatchShares(after) by {
      reveal alwaysEveryPayableShareAccounted, alwaysBannedHadShares, alwaysNoObligationsBeforeFunding, alwaysCompletedPaid, alwaysFrozenRecord, alwaysObligationsMatchShares;
    }
    assert stepNoCutInNoticeWindow(m, "cut", after) && stepPledgeKept(m, after) && stepFrozenStable(m, after) && stepObligationsMonotone(m, after) && stepSequenceCounts(m, "cut", after) && stepChangesAndCutsRetained(m, after) && stepProposalWrittenOnce(m, after) && stepUnderfundedNoticeOnce(m, after) && stepPeriodFixed(m, after) by {
      reveal stepNoCutInNoticeWindow, stepPledgeKept, stepFrozenStable, stepObligationsMonotone, stepSequenceCounts, stepChangesAndCutsRetained, stepProposalWrittenOnce, stepUnderfundedNoticeOnce, stepPeriodFixed, alwaysNoObligationsBeforeFunding, alwaysCutsRecorded, cutWindowOpen, freezesAtCutoff, cutoff, frozenPhase;
    }
  }
}

lemma MonthlyCreateObligationsCore(m: Monthly, observation: VaultObservation, bans: seq<BanExclusion>)
  requires alwaysAllocationConserved(m)
  requires canCreateObligations(m, observation, bans)
  ensures alwaysObligationsMatchShares(createObligations(m, observation, bans))
  ensures alwaysEveryPayableShareAccounted(createObligations(m, observation, bans))
{
  hide *;
  reveal ProofLib.Filter, ProofLib.DistinctBy, canCreateObligations, createObligations, payable, alwaysAllocationConserved, alwaysObligationsMatchShares, alwaysEveryPayableShareAccounted, hasActor, banFor, keyFor;
  var after := createObligations(m, observation, bans);
  var pPay := (s: settlement__allocation_Share) => (settlement__money_positiveAmount(s.amount) && !(banFor(bans, s.actor)));
  var pBan := (b: BanExclusion) => (exists s :: s in m.shares && ((s.actor == b.actor) && settlement__money_positiveAmount(s.amount)));
  var ps := payable(m, bans);
  ProofLib.FilterSamePredicate(pPay, (s: settlement__allocation_Share) => (settlement__money_positiveAmount(s.amount) && !(banFor(bans, s.actor))), m.shares);
  ProofLib.FilterSamePredicate(pBan, (b: BanExclusion) => (exists s :: s in m.shares && ((s.actor == b.actor) && settlement__money_positiveAmount(s.amount))), bans);
  assert ps == ProofLib.Filter(pPay, m.shares);
  assert after.banned == ProofLib.Filter(pBan, bans);
  var skey := (s: settlement__allocation_Share) => s.actor;
  var okey := (o: Obligation) => o.actor;
  assert ProofLib.DistinctBy(m.shares, skey) by {
    forall i, j | 0 <= i < |m.shares| && 0 <= j < |m.shares| && i != j ensures m.shares[i].actor != m.shares[j].actor {
      ProofLib.FilterCountOneIffUnique((o: settlement__allocation_Share) => o.actor == m.shares[i].actor, m.shares, skey, i);
    }
  }
  ProofLib.FilterKeepsDistinctBy(pPay, m.shares, skey);
  assert ProofLib.DistinctBy(after.obligations, okey) by {
    forall i, j | 0 <= i < |after.obligations| && 0 <= j < |after.obligations| && i != j
      ensures after.obligations[i].actor != after.obligations[j].actor
    {
      assert after.obligations[i].actor == ps[i].actor && after.obligations[j].actor == ps[j].actor;
    }
  }
  forall o | o in after.obligations
    ensures o.actor > 0 && hasActor(after.shares, o.actor) && settlement__money_positiveAmount(o.amount)
    ensures o.source == keyFor(after, o.actor)
    ensures exists s :: s in after.shares && s.actor == o.actor && s.amount == o.amount
    ensures !banFor(after.banned, o.actor)
    ensures |ProofLib.Filter((x: Obligation) => x.actor == o.actor, after.obligations)| == 1
  {
    var i :| 0 <= i < |after.obligations| && after.obligations[i] == o;
    ProofLib.FilterMember(pPay, m.shares, ps[i]);
    if banFor(after.banned, o.actor) {
      var b :| b in after.banned && b.actor == o.actor;
      ProofLib.FilterMember(pBan, bans, b);
    }
    ProofLib.FilterCountOneIffUnique((x: Obligation) => x.actor == o.actor, after.obligations, okey, i);
  }
  forall s | s in after.shares && settlement__money_positiveAmount(s.amount) && !banFor(after.banned, s.actor)
    ensures exists o :: o in after.obligations && o.actor == s.actor
  {
    if banFor(bans, s.actor) {
      var b :| b in bans && b.actor == s.actor;
      ProofLib.FilterMember(pBan, bans, b);
      assert b in after.banned;
    } else {
      ProofLib.FilterMember(pPay, m.shares, s);
      var i :| 0 <= i < |ps| && ps[i] == s;
      assert after.obligations[i] in after.obligations && after.obligations[i].actor == s.actor;
    }
  }
}

lemma createObligations_ensures(m: Monthly, observation: VaultObservation, bans: seq<BanExclusion>)
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysCloseoutOnlyForTheReviewedMonth(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysCloseoutUnchanged(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysAllocationConserved(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysUnproposedEmpty(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysCapFromRevision(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysCutsRecorded(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysPublicCutsCurrent(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysAutomaticHonoursCutNotice(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysFreezeAfterCutNotice(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysEveryPayableShareAccounted(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysBannedHadShares(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysNoObligationsBeforeFunding(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysCompletedPaid(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysFrozenRecord(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysObligationsMatchShares(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> alwaysExclusionsFromRevision(createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> stepNoCutInNoticeWindow(m, "createObligations", createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> stepPledgeKept(m, createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> stepFrozenStable(m, createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> stepObligationsMonotone(m, createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> stepSequenceCounts(m, "createObligations", createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> stepChangesAndCutsRetained(m, createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> stepProposalWrittenOnce(m, createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> stepUnderfundedNoticeOnce(m, createObligations(m, observation, bans)))
  ensures (inv(m) ==> canCreateObligations(m, observation, bans) ==> stepPeriodFixed(m, createObligations(m, observation, bans)))
{
  hide *;
  if inv(m) && canCreateObligations(m, observation, bans) {
    reveal inv, canCreateObligations, createObligations;
    var after := createObligations(m, observation, bans);
    MonthlyCreateObligationsCore(m, observation, bans);
    assert alwaysCloseoutOnlyForTheReviewedMonth(after) && alwaysCloseoutUnchanged(after) && alwaysAllocationConserved(after) && alwaysUnproposedEmpty(after) && alwaysCapFromRevision(after) by {
      reveal alwaysCloseoutOnlyForTheReviewedMonth, alwaysCloseoutUnchanged, alwaysAllocationConserved, alwaysUnproposedEmpty, alwaysCapFromRevision, reviewedOctoberPool, proposedPhase;
    }
    assert alwaysCutsRecorded(after) && alwaysPublicCutsCurrent(after) && alwaysAutomaticHonoursCutNotice(after) && alwaysFreezeAfterCutNotice(after) && alwaysExclusionsFromRevision(after) by {
      reveal alwaysCutsRecorded, alwaysPublicCutsCurrent, alwaysAutomaticHonoursCutNotice, alwaysFreezeAfterCutNotice, alwaysExclusionsFromRevision, proposedPhase, frozenPhase, belowProposal, cutoff;
    }
    assert alwaysBannedHadShares(after) && alwaysNoObligationsBeforeFunding(after) && alwaysCompletedPaid(after) && alwaysFrozenRecord(after) by {
      reveal ProofLib.Filter, alwaysBannedHadShares, alwaysNoObligationsBeforeFunding, alwaysCompletedPaid, alwaysFrozenRecord;
      var pBan := (b: BanExclusion) => (exists s :: s in m.shares && ((s.actor == b.actor) && settlement__money_positiveAmount(s.amount)));
      ProofLib.FilterSamePredicate(pBan, (b: BanExclusion) => (exists s :: s in m.shares && ((s.actor == b.actor) && settlement__money_positiveAmount(s.amount))), bans);
      forall b | b in after.banned ensures exists s :: s in after.shares && s.actor == b.actor && settlement__money_positiveAmount(s.amount) {
        ProofLib.FilterMember(pBan, bans, b);
      }
    }
    assert stepNoCutInNoticeWindow(m, "createObligations", after) && stepPledgeKept(m, after) && stepFrozenStable(m, after) && stepObligationsMonotone(m, after) && stepSequenceCounts(m, "createObligations", after) && stepChangesAndCutsRetained(m, after) && stepProposalWrittenOnce(m, after) && stepUnderfundedNoticeOnce(m, after) && stepPeriodFixed(m, after) by {
      reveal stepNoCutInNoticeWindow, stepPledgeKept, stepFrozenStable, stepObligationsMonotone, stepSequenceCounts, stepChangesAndCutsRetained, stepProposalWrittenOnce, stepUnderfundedNoticeOnce, stepPeriodFixed, alwaysNoObligationsBeforeFunding, frozenPhase;
    }
  }
}

lemma MonthlyObligationUpdateMatch(m: Monthly, after: Monthly)
  requires alwaysObligationsMatchShares(m)
  requires after.shares == m.shares && after.banned == m.banned && after.project == m.project && after.period == m.period
  requires |after.obligations| == |m.obligations|
  requires forall i :: 0 <= i < |m.obligations| ==>
    after.obligations[i].actor == m.obligations[i].actor
    && after.obligations[i].amount == m.obligations[i].amount
    && after.obligations[i].source == m.obligations[i].source
  ensures alwaysObligationsMatchShares(after)
{
  hide *;
  reveal ProofLib.Filter, alwaysObligationsMatchShares, keyFor, hasActor, banFor;
  forall o | o in after.obligations
    ensures o.actor > 0 && hasActor(after.shares, o.actor) && settlement__money_positiveAmount(o.amount)
    ensures o.source == keyFor(after, o.actor)
    ensures exists s :: s in after.shares && s.actor == o.actor && s.amount == o.amount
    ensures !banFor(after.banned, o.actor)
    ensures |ProofLib.Filter((x: Obligation) => x.actor == o.actor, after.obligations)| == 1
  {
    var i :| 0 <= i < |after.obligations| && after.obligations[i] == o;
    var o0 := m.obligations[i];
    assert o0 in m.obligations && o0.actor == o.actor;
    ProofLib.FilterLengthPointwise((x: Obligation) => x.actor == o.actor, (x: Obligation) => x.actor == o0.actor, after.obligations, m.obligations);
  }
}

lemma MonthlyObligationUpdateMonotone(m: Monthly, after: Monthly)
  requires after.banned == m.banned && |after.obligations| == |m.obligations|
  requires forall i :: 0 <= i < |m.obligations| ==>
    after.obligations[i].actor == m.obligations[i].actor
    && after.obligations[i].amount == m.obligations[i].amount
    && after.obligations[i].source == m.obligations[i].source
    && rank(after.obligations[i].progress) >= rank(m.obligations[i].progress)
    && ((m.obligations[i].progress.Conflicted? == after.obligations[i].progress.Conflicted?) || m.obligations[i].progress.Created?)
  ensures stepObligationsMonotone(m, after)
{
  hide *;
  reveal stepObligationsMonotone;
  forall o | o in m.obligations
    ensures exists n :: n in after.obligations && n.actor == o.actor && n.amount == o.amount && n.source == o.source && rank(n.progress) >= rank(o.progress) && ((o.progress.Conflicted? == n.progress.Conflicted?) || o.progress.Created?)
  {
    var i :| 0 <= i < |m.obligations| && m.obligations[i] == o;
    assert after.obligations[i] in after.obligations;
  }
}

lemma MonthlyObligationUpdateAccounted(m: Monthly, after: Monthly)
  requires alwaysEveryPayableShareAccounted(m) && m.phase.Funded?
  requires after.shares == m.shares && after.banned == m.banned && |after.obligations| == |m.obligations|
  requires forall i :: 0 <= i < |m.obligations| ==> after.obligations[i].actor == m.obligations[i].actor
  ensures alwaysEveryPayableShareAccounted(after)
{
  hide *;
  reveal alwaysEveryPayableShareAccounted, banFor;
  forall s | s in after.shares && settlement__money_positiveAmount(s.amount) && !banFor(after.banned, s.actor)
    ensures exists o :: o in after.obligations && o.actor == s.actor
  {
    var o0 :| o0 in m.obligations && o0.actor == s.actor;
    var i :| 0 <= i < |m.obligations| && m.obligations[i] == o0;
    assert after.obligations[i] in after.obligations && after.obligations[i].actor == s.actor;
  }
}

lemma MonthlyObligationUpdateFrame(m: Monthly, via: string, after: Monthly)
  requires inv(m) && m.phase.Funded? && (after.phase.Funded? || after.phase.Completed?)
  requires via != "adjust" && via != "cut"
  requires after.project == m.project && after.period == m.period && after.now == m.now && after.automatic == m.automatic
  requires after.earlyCloseAt == m.earlyCloseAt && after.changes == m.changes && after.cuts == m.cuts
  requires after.total == m.total && after.cap == m.cap && after.shares == m.shares && after.proposedShares == m.proposedShares
  requires after.sequence == m.sequence && after.latestCutAt == m.latestCutAt && after.frozenAt == m.frozenAt
  requires after.reviewedOctober == m.reviewedOctober && after.revision == m.revision && after.notices == m.notices
  requires after.publicCuts == m.publicCuts && after.banned == m.banned && after.trigger == m.trigger
  requires after.frozenSequence == m.frozenSequence && after.frozenBy == m.frozenBy && after.exclusions == m.exclusions
  requires after.snapshotDigest == m.snapshotDigest && after.underfundedNotice == m.underfundedNotice && after.pledgedVault == m.pledgedVault
  ensures alwaysCloseoutOnlyForTheReviewedMonth(after)
  ensures alwaysCloseoutUnchanged(after)
  ensures alwaysAllocationConserved(after)
  ensures alwaysUnproposedEmpty(after)
  ensures alwaysCapFromRevision(after)
  ensures alwaysCutsRecorded(after)
  ensures alwaysPublicCutsCurrent(after)
  ensures alwaysAutomaticHonoursCutNotice(after)
  ensures alwaysFreezeAfterCutNotice(after)
  ensures alwaysBannedHadShares(after)
  ensures alwaysNoObligationsBeforeFunding(after)
  ensures alwaysFrozenRecord(after)
  ensures alwaysExclusionsFromRevision(after)
  ensures stepNoCutInNoticeWindow(m, via, after)
  ensures stepPledgeKept(m, after)
  ensures stepFrozenStable(m, after)
  ensures stepSequenceCounts(m, via, after)
  ensures stepChangesAndCutsRetained(m, after)
  ensures stepProposalWrittenOnce(m, after)
  ensures stepUnderfundedNoticeOnce(m, after)
  ensures stepPeriodFixed(m, after)
{
  hide *;
  reveal inv;
  assert alwaysCloseoutOnlyForTheReviewedMonth(after) && alwaysCloseoutUnchanged(after) && alwaysAllocationConserved(after) && alwaysUnproposedEmpty(after) && alwaysCapFromRevision(after) by {
    reveal alwaysCloseoutOnlyForTheReviewedMonth, alwaysCloseoutUnchanged, alwaysAllocationConserved, alwaysUnproposedEmpty, alwaysCapFromRevision, reviewedOctoberPool, proposedPhase;
  }
  assert alwaysCutsRecorded(after) && alwaysPublicCutsCurrent(after) && alwaysAutomaticHonoursCutNotice(after) && alwaysFreezeAfterCutNotice(after) by {
    reveal alwaysCutsRecorded, alwaysPublicCutsCurrent, alwaysAutomaticHonoursCutNotice, alwaysFreezeAfterCutNotice, belowProposal, frozenPhase, cutoff;
  }
  assert alwaysBannedHadShares(after) && alwaysNoObligationsBeforeFunding(after) && alwaysFrozenRecord(after) && alwaysExclusionsFromRevision(after) by {
    reveal alwaysBannedHadShares, alwaysNoObligationsBeforeFunding, alwaysFrozenRecord, alwaysExclusionsFromRevision, proposedPhase;
  }
  assert stepNoCutInNoticeWindow(m, via, after) && stepPledgeKept(m, after) && stepFrozenStable(m, after) && stepSequenceCounts(m, via, after) && stepChangesAndCutsRetained(m, after) && stepProposalWrittenOnce(m, after) && stepUnderfundedNoticeOnce(m, after) && stepPeriodFixed(m, after) by {
    reveal stepNoCutInNoticeWindow, stepPledgeKept, stepFrozenStable, stepSequenceCounts, stepChangesAndCutsRetained, stepProposalWrittenOnce, stepUnderfundedNoticeOnce, stepPeriodFixed, proposedPhase, frozenPhase;
  }
}

lemma MonthlyRecordReservedCore(m: Monthly, award: AwardFact)
  requires alwaysObligationsMatchShares(m) && alwaysEveryPayableShareAccounted(m)
  requires canRecordReserved(m, award)
  ensures alwaysObligationsMatchShares(recordReserved(m, award))
  ensures stepObligationsMonotone(m, recordReserved(m, award))
  ensures alwaysEveryPayableShareAccounted(recordReserved(m, award))
{
  hide *;
  reveal ProofLib.Filter, ProofLib.DistinctBy, canRecordReserved, recordReserved, obligationFor, alwaysObligationsMatchShares, rank;
  var after := recordReserved(m, award);
  var p := (o: Obligation) => (o.actor == award.actor);
  var f := ProofLib.Filter(p, m.obligations);
  ProofLib.FilterSamePredicate(p, (o: Obligation) => (o.actor == award.actor), m.obligations);
  assert |f| > 0;
  ProofLib.FilterMember(p, m.obligations, f[0]);
  var j :| 0 <= j < |m.obligations| && m.obligations[j] == f[0];
  var okey := (o: Obligation) => o.actor;
  ProofLib.FilterCountOneIffUnique((x: Obligation) => (x.actor == f[0].actor), m.obligations, okey, j);
  forall i | 0 <= i < |m.obligations|
    ensures rank(after.obligations[i].progress) >= rank(m.obligations[i].progress)
    ensures (m.obligations[i].progress.Conflicted? == after.obligations[i].progress.Conflicted?) || m.obligations[i].progress.Created?
  {
    if m.obligations[i].actor == award.actor {
      assert i == j && m.obligations[i] == f[0] && m.obligations[i].progress.Created?;
    }
  }
  MonthlyObligationUpdateMatch(m, after);
  MonthlyObligationUpdateMonotone(m, after);
  MonthlyObligationUpdateAccounted(m, after);
}

lemma recordReserved_ensures(m: Monthly, award: AwardFact)
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysCloseoutOnlyForTheReviewedMonth(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysCloseoutUnchanged(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysAllocationConserved(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysUnproposedEmpty(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysCapFromRevision(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysCutsRecorded(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysPublicCutsCurrent(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysAutomaticHonoursCutNotice(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysFreezeAfterCutNotice(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysEveryPayableShareAccounted(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysBannedHadShares(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysNoObligationsBeforeFunding(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysCompletedPaid(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysFrozenRecord(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysObligationsMatchShares(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> alwaysExclusionsFromRevision(recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> stepNoCutInNoticeWindow(m, "recordReserved", recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> stepPledgeKept(m, recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> stepFrozenStable(m, recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> stepObligationsMonotone(m, recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> stepSequenceCounts(m, "recordReserved", recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> stepChangesAndCutsRetained(m, recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> stepProposalWrittenOnce(m, recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> stepUnderfundedNoticeOnce(m, recordReserved(m, award)))
  ensures (inv(m) ==> canRecordReserved(m, award) ==> stepPeriodFixed(m, recordReserved(m, award)))
{
  hide *;
  if inv(m) && canRecordReserved(m, award) {
    reveal inv, canRecordReserved, recordReserved;
    var after := recordReserved(m, award);
    MonthlyObligationUpdateFrame(m, "recordReserved", after);
    MonthlyRecordReservedCore(m, award);
    assert alwaysCompletedPaid(after) by {
      reveal alwaysCompletedPaid;
    }
  }
}

lemma MonthlyRecordConflictCore(m: Monthly, award: AwardFact)
  requires alwaysObligationsMatchShares(m) && alwaysEveryPayableShareAccounted(m)
  requires canRecordConflict(m, award)
  ensures alwaysObligationsMatchShares(recordConflict(m, award))
  ensures stepObligationsMonotone(m, recordConflict(m, award))
  ensures alwaysEveryPayableShareAccounted(recordConflict(m, award))
{
  hide *;
  reveal ProofLib.Filter, ProofLib.DistinctBy, canRecordConflict, recordConflict, obligationBySource, alwaysObligationsMatchShares, keyFor, rank;
  var after := recordConflict(m, award);
  var p := (o: Obligation) => (o.source == award.source);
  var f := ProofLib.Filter(p, m.obligations);
  ProofLib.FilterSamePredicate(p, (o: Obligation) => (o.source == award.source), m.obligations);
  assert |f| > 0;
  ProofLib.FilterMember(p, m.obligations, f[0]);
  var j :| 0 <= j < |m.obligations| && m.obligations[j] == f[0];
  var okey := (o: Obligation) => o.actor;
  ProofLib.FilterCountOneIffUnique((x: Obligation) => (x.actor == f[0].actor), m.obligations, okey, j);
  forall i | 0 <= i < |m.obligations|
    ensures rank(after.obligations[i].progress) >= rank(m.obligations[i].progress)
    ensures (m.obligations[i].progress.Conflicted? == after.obligations[i].progress.Conflicted?) || m.obligations[i].progress.Created?
  {
    if m.obligations[i].source == award.source {
      assert m.obligations[i].source == keyFor(m, m.obligations[i].actor) && f[0].source == keyFor(m, f[0].actor);
      assert m.obligations[i].actor == f[0].actor;
      assert i == j && m.obligations[i] == f[0] && m.obligations[i].progress.Created?;
    }
  }
  MonthlyObligationUpdateMatch(m, after);
  MonthlyObligationUpdateMonotone(m, after);
  MonthlyObligationUpdateAccounted(m, after);
}

lemma recordConflict_ensures(m: Monthly, award: AwardFact)
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysCloseoutOnlyForTheReviewedMonth(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysCloseoutUnchanged(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysAllocationConserved(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysUnproposedEmpty(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysCapFromRevision(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysCutsRecorded(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysPublicCutsCurrent(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysAutomaticHonoursCutNotice(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysFreezeAfterCutNotice(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysEveryPayableShareAccounted(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysBannedHadShares(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysNoObligationsBeforeFunding(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysCompletedPaid(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysFrozenRecord(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysObligationsMatchShares(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> alwaysExclusionsFromRevision(recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> stepNoCutInNoticeWindow(m, "recordConflict", recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> stepPledgeKept(m, recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> stepFrozenStable(m, recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> stepObligationsMonotone(m, recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> stepSequenceCounts(m, "recordConflict", recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> stepChangesAndCutsRetained(m, recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> stepProposalWrittenOnce(m, recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> stepUnderfundedNoticeOnce(m, recordConflict(m, award)))
  ensures (inv(m) ==> canRecordConflict(m, award) ==> stepPeriodFixed(m, recordConflict(m, award)))
{
  hide *;
  if inv(m) && canRecordConflict(m, award) {
    reveal inv, canRecordConflict, recordConflict;
    var after := recordConflict(m, award);
    MonthlyObligationUpdateFrame(m, "recordConflict", after);
    MonthlyRecordConflictCore(m, award);
    assert alwaysCompletedPaid(after) by {
      reveal alwaysCompletedPaid;
    }
  }
}

lemma MonthlyRecordPaidCore(m: Monthly, award: AwardFact)
  requires alwaysObligationsMatchShares(m) && alwaysEveryPayableShareAccounted(m)
  requires canRecordPaid(m, award)
  ensures alwaysObligationsMatchShares(recordPaid(m, award))
  ensures stepObligationsMonotone(m, recordPaid(m, award))
  ensures alwaysEveryPayableShareAccounted(recordPaid(m, award))
{
  hide *;
  reveal ProofLib.Filter, ProofLib.DistinctBy, canRecordPaid, recordPaid, obligationFor, alwaysObligationsMatchShares, rank;
  var after := recordPaid(m, award);
  var p := (o: Obligation) => (o.actor == award.actor);
  var f := ProofLib.Filter(p, m.obligations);
  ProofLib.FilterSamePredicate(p, (o: Obligation) => (o.actor == award.actor), m.obligations);
  assert |f| > 0;
  ProofLib.FilterMember(p, m.obligations, f[0]);
  var j :| 0 <= j < |m.obligations| && m.obligations[j] == f[0];
  var okey := (o: Obligation) => o.actor;
  ProofLib.FilterCountOneIffUnique((x: Obligation) => (x.actor == f[0].actor), m.obligations, okey, j);
  forall i | 0 <= i < |m.obligations|
    ensures rank(after.obligations[i].progress) >= rank(m.obligations[i].progress)
    ensures (m.obligations[i].progress.Conflicted? == after.obligations[i].progress.Conflicted?) || m.obligations[i].progress.Created?
  {
    if m.obligations[i].actor == award.actor {
      assert i == j && m.obligations[i] == f[0] && m.obligations[i].progress.Reserved?;
    }
  }
  MonthlyObligationUpdateMatch(m, after);
  MonthlyObligationUpdateMonotone(m, after);
  MonthlyObligationUpdateAccounted(m, after);
}

lemma recordPaid_ensures(m: Monthly, award: AwardFact)
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysCloseoutOnlyForTheReviewedMonth(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysCloseoutUnchanged(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysAllocationConserved(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysUnproposedEmpty(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysCapFromRevision(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysCutsRecorded(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysPublicCutsCurrent(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysAutomaticHonoursCutNotice(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysFreezeAfterCutNotice(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysEveryPayableShareAccounted(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysBannedHadShares(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysNoObligationsBeforeFunding(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysCompletedPaid(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysFrozenRecord(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysObligationsMatchShares(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> alwaysExclusionsFromRevision(recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> stepNoCutInNoticeWindow(m, "recordPaid", recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> stepPledgeKept(m, recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> stepFrozenStable(m, recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> stepObligationsMonotone(m, recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> stepSequenceCounts(m, "recordPaid", recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> stepChangesAndCutsRetained(m, recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> stepProposalWrittenOnce(m, recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> stepUnderfundedNoticeOnce(m, recordPaid(m, award)))
  ensures (inv(m) ==> canRecordPaid(m, award) ==> stepPeriodFixed(m, recordPaid(m, award)))
{
  hide *;
  if inv(m) && canRecordPaid(m, award) {
    reveal inv, canRecordPaid, recordPaid;
    var after := recordPaid(m, award);
    MonthlyObligationUpdateFrame(m, "recordPaid", after);
    MonthlyRecordPaidCore(m, award);
    assert alwaysCompletedPaid(after) by {
      reveal alwaysCompletedPaid;
    }
  }
}

lemma finalize_ensures(m: Monthly, expectedSequence: int, fact: AuthorityFact)
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysCloseoutOnlyForTheReviewedMonth(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysCloseoutUnchanged(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysAllocationConserved(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysUnproposedEmpty(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysCapFromRevision(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysCutsRecorded(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysPublicCutsCurrent(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysAutomaticHonoursCutNotice(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysFreezeAfterCutNotice(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysEveryPayableShareAccounted(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysBannedHadShares(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysNoObligationsBeforeFunding(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysCompletedPaid(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysFrozenRecord(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysObligationsMatchShares(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> alwaysExclusionsFromRevision(finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> stepNoCutInNoticeWindow(m, "finalize", finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> stepPledgeKept(m, finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> stepFrozenStable(m, finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> stepObligationsMonotone(m, finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> stepSequenceCounts(m, "finalize", finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> stepChangesAndCutsRetained(m, finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> stepProposalWrittenOnce(m, finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> stepUnderfundedNoticeOnce(m, finalize(m, expectedSequence, fact)))
  ensures (inv(m) ==> canFinalize(m, expectedSequence, fact) ==> stepPeriodFixed(m, finalize(m, expectedSequence, fact)))
{
  hide *;
  if inv(m) && canFinalize(m, expectedSequence, fact) {
    reveal inv, canFinalize, finalize;
    var after := finalize(m, expectedSequence, fact);
    assert alwaysCloseoutOnlyForTheReviewedMonth(after) && alwaysCloseoutUnchanged(after) && alwaysAllocationConserved(after) && alwaysUnproposedEmpty(after) && alwaysCapFromRevision(after) by {
      reveal alwaysCloseoutOnlyForTheReviewedMonth, alwaysCloseoutUnchanged, alwaysAllocationConserved, alwaysUnproposedEmpty, alwaysCapFromRevision, reviewedOctoberPool, proposedPhase;
    }
    assert alwaysCutsRecorded(after) && alwaysPublicCutsCurrent(after) && alwaysAutomaticHonoursCutNotice(after) && alwaysFreezeAfterCutNotice(after) && alwaysExclusionsFromRevision(after) by {
      reveal alwaysCutsRecorded, alwaysPublicCutsCurrent, alwaysAutomaticHonoursCutNotice, alwaysFreezeAfterCutNotice, alwaysExclusionsFromRevision, belowProposal, cutNoticeElapsed, frozenPhase, proposedPhase;
    }
    assert alwaysEveryPayableShareAccounted(after) && alwaysBannedHadShares(after) && alwaysNoObligationsBeforeFunding(after) && alwaysCompletedPaid(after) && alwaysFrozenRecord(after) && alwaysObligationsMatchShares(after) by {
      reveal alwaysEveryPayableShareAccounted, alwaysBannedHadShares, alwaysNoObligationsBeforeFunding, alwaysCompletedPaid, alwaysFrozenRecord, alwaysObligationsMatchShares, manages, keyFor, hasActor, banFor;
    }
    assert stepNoCutInNoticeWindow(m, "finalize", after) && stepPledgeKept(m, after) && stepFrozenStable(m, after) && stepObligationsMonotone(m, after) && stepSequenceCounts(m, "finalize", after) && stepChangesAndCutsRetained(m, after) && stepProposalWrittenOnce(m, after) && stepUnderfundedNoticeOnce(m, after) && stepPeriodFixed(m, after) by {
      reveal stepNoCutInNoticeWindow, stepPledgeKept, stepFrozenStable, stepObligationsMonotone, stepSequenceCounts, stepChangesAndCutsRetained, stepProposalWrittenOnce, stepUnderfundedNoticeOnce, stepPeriodFixed, frozenPhase, proposedPhase;
    }
  }
}

lemma noteUnderfunded_ensures(m: Monthly, observation: VaultObservation, bans: seq<BanExclusion>)
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysCloseoutOnlyForTheReviewedMonth(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysCloseoutUnchanged(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysAllocationConserved(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysUnproposedEmpty(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysCapFromRevision(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysCutsRecorded(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysPublicCutsCurrent(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysAutomaticHonoursCutNotice(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysFreezeAfterCutNotice(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysEveryPayableShareAccounted(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysBannedHadShares(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysNoObligationsBeforeFunding(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysCompletedPaid(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysFrozenRecord(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysObligationsMatchShares(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> alwaysExclusionsFromRevision(noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> stepNoCutInNoticeWindow(m, "noteUnderfunded", noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> stepPledgeKept(m, noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> stepFrozenStable(m, noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> stepObligationsMonotone(m, noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> stepSequenceCounts(m, "noteUnderfunded", noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> stepChangesAndCutsRetained(m, noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> stepProposalWrittenOnce(m, noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> stepUnderfundedNoticeOnce(m, noteUnderfunded(m, observation, bans)))
  ensures (inv(m) ==> canNoteUnderfunded(m, observation, bans) ==> stepPeriodFixed(m, noteUnderfunded(m, observation, bans)))
{
  hide *;
  if inv(m) && canNoteUnderfunded(m, observation, bans) {
    reveal inv, canNoteUnderfunded, noteUnderfunded;
    var after := noteUnderfunded(m, observation, bans);
    assert alwaysCloseoutOnlyForTheReviewedMonth(after) && alwaysCloseoutUnchanged(after) && alwaysAllocationConserved(after) && alwaysUnproposedEmpty(after) && alwaysCapFromRevision(after) by {
      reveal alwaysCloseoutOnlyForTheReviewedMonth, alwaysCloseoutUnchanged, alwaysAllocationConserved, alwaysUnproposedEmpty, alwaysCapFromRevision, reviewedOctoberPool, proposedPhase;
    }
    assert alwaysCutsRecorded(after) && alwaysPublicCutsCurrent(after) && alwaysAutomaticHonoursCutNotice(after) && alwaysFreezeAfterCutNotice(after) && alwaysExclusionsFromRevision(after) by {
      reveal alwaysCutsRecorded, alwaysPublicCutsCurrent, alwaysAutomaticHonoursCutNotice, alwaysFreezeAfterCutNotice, alwaysExclusionsFromRevision, belowProposal, frozenPhase, proposedPhase, cutoff;
    }
    assert alwaysEveryPayableShareAccounted(after) && alwaysBannedHadShares(after) && alwaysNoObligationsBeforeFunding(after) && alwaysCompletedPaid(after) && alwaysFrozenRecord(after) && alwaysObligationsMatchShares(after) by {
      reveal alwaysEveryPayableShareAccounted, alwaysBannedHadShares, alwaysNoObligationsBeforeFunding, alwaysCompletedPaid, alwaysFrozenRecord, alwaysObligationsMatchShares, keyFor, hasActor, banFor;
    }
    assert stepNoCutInNoticeWindow(m, "noteUnderfunded", after) && stepPledgeKept(m, after) && stepFrozenStable(m, after) && stepObligationsMonotone(m, after) && stepSequenceCounts(m, "noteUnderfunded", after) && stepChangesAndCutsRetained(m, after) && stepProposalWrittenOnce(m, after) && stepUnderfundedNoticeOnce(m, after) && stepPeriodFixed(m, after) by {
      reveal stepNoCutInNoticeWindow, stepPledgeKept, stepFrozenStable, stepObligationsMonotone, stepSequenceCounts, stepChangesAndCutsRetained, stepProposalWrittenOnce, stepUnderfundedNoticeOnce, stepPeriodFixed, frozenPhase, proposedPhase;
    }
  }
}
