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

