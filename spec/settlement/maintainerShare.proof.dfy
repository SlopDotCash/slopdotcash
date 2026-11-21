// The proposal splits a positive share only among the month's weights, which leave out every excluded account.
lemma propose_ensures(m: ShareMonth, by_: string)
  ensures (inv(m) ==> canPropose(m, by_) ==> alwaysExcludedReceivesNothing(propose(m, by_)))
  ensures (inv(m) ==> canPropose(m, by_) ==> alwaysReadOnlyForAShare(propose(m, by_)))
  ensures (inv(m) ==> canPropose(m, by_) ==> alwaysShareWithinLimits(propose(m, by_)))
  ensures (inv(m) ==> canPropose(m, by_) ==> alwaysAmountValid(propose(m, by_)))
  ensures (inv(m) ==> canPropose(m, by_) ==> alwaysProposalIsTheAmount(propose(m, by_)))
  ensures (inv(m) ==> canPropose(m, by_) ==> alwaysMaintainersSplitTheShare(propose(m, by_)))
  ensures (inv(m) ==> canPropose(m, by_) ==> alwaysShareOnlyFromCompleteRead(propose(m, by_)))
  ensures (inv(m) ==> canPropose(m, by_) ==> alwaysCompleteReadIsTheMonth(propose(m, by_)))
  ensures (inv(m) ==> canPropose(m, by_) ==> stepShareStartsNextMonth(m, "propose", propose(m, by_)))
{
  if inv(m) && canPropose(m, by_) {
    var pool := proposedPool(m);
    var weights := shareWeights(m.record, m.exclusions);
    var after := propose(m, by_);
    settlement__money_lawEqualReflexive_ensures(settlement__money_zero);
    PoolValid(m);
    settlement__money_lawSubtractionReconstructs_ensures(m.amount, pool);
    if settlement__money_positiveAmount(pool) {
      assert m.read.ReadComplete? && m.record.period == m.period;
      assert after.maintainers == settlement__allocation_allocateAmounts(pool, weights);
      AllocatedOnlyWhenAdmitted(pool, weights);
      settlement__allocation_lawAllocationConserves_ensures(pool, weights);
      settlement__allocation_lawShareWithinOneOfQuota_ensures(pool, weights);
      WeightsLeaveOutExcluded(m.record, m.exclusions);
    } else {
      assert after.maintainers == [];
    }
  }
}

// The proposed share is a valid amount, positive only for a month with a share.
lemma PoolValid(m: ShareMonth)
  requires settlement__money_validAmount(m.amount) && m.monthShare >= 0
  ensures settlement__money_validAmount(proposedPool(m))
  ensures settlement__money_positiveAmount(proposedPool(m)) ==> m.monthShare > 0
{
  settlement__money_lawEqualReflexive_ensures(settlement__money_zero);
  if m.monthShare > 0 && |shareWeights(m.record, m.exclusions)| > 0 {
    SmallAmountNonnegativeValid(m.monthShare);
    SmallAmountNonnegativeValid(basisPointsDivisor);
    settlement__money_lawMultiplyValid_ensures(m.amount, settlement__money_smallAmount(m.monthShare));
    settlement__money_lawDivisionValid_ensures(settlement__money_multiplyAmounts(m.amount, settlement__money_smallAmount(m.monthShare)), settlement__money_smallAmount(basisPointsDivisor));
  }
}

// Only admitted weights receive an allocation.
lemma AllocatedOnlyWhenAdmitted(total: seq<int>, weights: seq<settlement__allocation_Weight>)
  ensures |settlement__allocation_allocateAmounts(total, weights)| > 0 ==> settlement__allocation_canAllocate(total, weights)
{
}

// Every weight belongs to a deciding account that is not excluded in the record's month.
lemma WeightsLeaveOutExcluded(record: DecisionRecord, exclusions: seq<settlement__payoutExclusions_Exclusion>)
  ensures forall w :: w in shareWeights(record, exclusions) ==> !(settlement__payoutExclusions_excludedIn(exclusions, w.actor, record.period))
{
  WeightActors(record, exclusions);
  forall w | w in shareWeights(record, exclusions)
    ensures !(settlement__payoutExclusions_excludedIn(exclusions, w.actor, record.period))
  {
    var i :| 0 <= i < |shareWeights(record, exclusions)| && shareWeights(record, exclusions)[i] == w;
    var s_map := ProofLib.Filter((a: int) => (((a > 0) && (decisionsBy(record, a) > 0)) && !(settlement__payoutExclusions_excludedIn(exclusions, a, record.period))), record.deciders);
    ProofLib.FilterMember((a: int) => (((a > 0) && (decisionsBy(record, a) > 0)) && !(settlement__payoutExclusions_excludedIn(exclusions, a, record.period))), record.deciders, s_map[i]);
  }
}

// The weights are the counted deciders, in order.
lemma WeightActors(record: DecisionRecord, exclusions: seq<settlement__payoutExclusions_Exclusion>)
  ensures var s_map := ProofLib.Filter((a: int) => (((a > 0) && (decisionsBy(record, a) > 0)) && !(settlement__payoutExclusions_excludedIn(exclusions, a, record.period))), record.deciders); |shareWeights(record, exclusions)| == |s_map| && forall i :: 0 <= i < |s_map| ==> shareWeights(record, exclusions)[i].actor == s_map[i]
{
}
// The fixed six digit extraction yields a positive-length valid Amount.
lemma SmallAmountNonnegativeValid(n: int)
  requires n >= 0
  ensures settlement__money_validAmount(settlement__money_smallAmount(n))
{
  var f := (acc: settlement__money_SafeConversion, ignored: int) => settlement__money_SafeConversion(settlement__money_quotient_settlement__money(acc.remaining, 1000), (acc.digits + [settlement__money_remainder_settlement__money(acc.remaining, 1000)]));
  SmallDigitsValid(f, settlement__money_SafeConversion(n, []), [0, 0, 0, 0, 0, 0]);
}

lemma SmallDigitsValid(f: (settlement__money_SafeConversion, int) -> settlement__money_SafeConversion,
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
    SmallDigitsValid(f, f(current, xs[0]), xs[1..]);
  }
}
