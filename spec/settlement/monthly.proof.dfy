lemma adjust_ensures(m: Monthly, shares: seq<settlement__allocation_Share>, revision: int, by_: string)
  ensures (inv(m) ==> canAdjust(m, shares, revision, by_) ==> alwaysAllocationConserved(adjust(m, shares, revision, by_)))
  ensures (inv(m) ==> canAdjust(m, shares, revision, by_) ==> alwaysCompletedPaid(adjust(m, shares, revision, by_)))
  ensures (inv(m) ==> canAdjust(m, shares, revision, by_) ==> alwaysPaidMember(adjust(m, shares, revision, by_)))
  ensures (inv(m) ==> canAdjust(m, shares, revision, by_) ==> alwaysCollectingEmpty(adjust(m, shares, revision, by_)))
  ensures (inv(m) ==> canAdjust(m, shares, revision, by_) ==> alwaysUnfundedUnpaid(adjust(m, shares, revision, by_)))
  ensures (inv(m) ==> canAdjust(m, shares, revision, by_) ==> stepFrozenAmountsStable(m, adjust(m, shares, revision, by_)))
  ensures (inv(m) ==> canAdjust(m, shares, revision, by_) ==> stepPaidNeverReverts(m, adjust(m, shares, revision, by_)))
{
  if inv(m) && canAdjust(m, shares, revision, by_) {
    ValidMonthlySum(shares, settlement__money_zero);
    settlement__money_lawEqualReflexive_ensures(settlement__allocation_allocatedTotal(shares));
  }
}

lemma setCap_ensures(m: Monthly, cap: seq<int>, by_: string)
  ensures (inv(m) ==> canSetCap(m, cap, by_) ==> alwaysAllocationConserved(setCap(m, cap, by_)))
  ensures (inv(m) ==> canSetCap(m, cap, by_) ==> alwaysCompletedPaid(setCap(m, cap, by_)))
  ensures (inv(m) ==> canSetCap(m, cap, by_) ==> alwaysPaidMember(setCap(m, cap, by_)))
  ensures (inv(m) ==> canSetCap(m, cap, by_) ==> alwaysCollectingEmpty(setCap(m, cap, by_)))
  ensures (inv(m) ==> canSetCap(m, cap, by_) ==> alwaysUnfundedUnpaid(setCap(m, cap, by_)))
  ensures (inv(m) ==> canSetCap(m, cap, by_) ==> stepFrozenAmountsStable(m, setCap(m, cap, by_)))
  ensures (inv(m) ==> canSetCap(m, cap, by_) ==> stepPaidNeverReverts(m, setCap(m, cap, by_)))
{
  if inv(m) && canSetCap(m, cap, by_) {
    assert settlement__money_equalAmounts(m.total, settlement__money_zero);
    settlement__money_lawEqualOrder_ensures(m.total, settlement__money_zero, cap);
    settlement__money_lawZeroOrder_ensures(cap);
  }
}

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

lemma fund_ensures(m: Monthly, available: seq<int>)
  ensures (inv(m) ==> canFund(m, available) ==> alwaysAllocationConserved(fund(m, available)))
  ensures (inv(m) ==> canFund(m, available) ==> alwaysCompletedPaid(fund(m, available)))
  ensures (inv(m) ==> canFund(m, available) ==> alwaysPaidMember(fund(m, available)))
  ensures (inv(m) ==> canFund(m, available) ==> alwaysCollectingEmpty(fund(m, available)))
  ensures (inv(m) ==> canFund(m, available) ==> alwaysUnfundedUnpaid(fund(m, available)))
  ensures (inv(m) ==> canFund(m, available) ==> stepFrozenAmountsStable(m, fund(m, available)))
  ensures (inv(m) ==> canFund(m, available) ==> stepPaidNeverReverts(m, fund(m, available)))
{
  if inv(m) && canFund(m, available) {
    if !settlement__money_positiveAmount(m.total) {
      var sum := settlement__allocation_allocatedTotal(m.shares);
      assert settlement__money_equalAmounts(sum, m.total);
      settlement__money_lawEqualOrder_ensures(sum, m.total, settlement__money_zero);
      MonthlySumPositivity(m.shares, settlement__money_zero);
    }
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

lemma propose_ensures(m: Monthly, amount: seq<int>, weights: seq<settlement__allocation_Weight>, closed: bool, complete: bool, eligibility: ProjectEligibility)
  ensures (inv(m) ==> canPropose(m, amount, weights, closed, complete, eligibility) ==> alwaysAllocationConserved(propose(m, amount, weights, closed, complete, eligibility)))
  ensures (inv(m) ==> canPropose(m, amount, weights, closed, complete, eligibility) ==> alwaysCompletedPaid(propose(m, amount, weights, closed, complete, eligibility)))
  ensures (inv(m) ==> canPropose(m, amount, weights, closed, complete, eligibility) ==> alwaysPaidMember(propose(m, amount, weights, closed, complete, eligibility)))
  ensures (inv(m) ==> canPropose(m, amount, weights, closed, complete, eligibility) ==> alwaysCollectingEmpty(propose(m, amount, weights, closed, complete, eligibility)))
  ensures (inv(m) ==> canPropose(m, amount, weights, closed, complete, eligibility) ==> alwaysUnfundedUnpaid(propose(m, amount, weights, closed, complete, eligibility)))
  ensures (inv(m) ==> canPropose(m, amount, weights, closed, complete, eligibility) ==> stepFrozenAmountsStable(m, propose(m, amount, weights, closed, complete, eligibility)))
  ensures (inv(m) ==> canPropose(m, amount, weights, closed, complete, eligibility) ==> stepPaidNeverReverts(m, propose(m, amount, weights, closed, complete, eligibility)))
{
  if inv(m) && canPropose(m, amount, weights, closed, complete, eligibility) {
    settlement__allocation_lawAllocatedSharesValid_ensures(amount, weights);
  }
}
