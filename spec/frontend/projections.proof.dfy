lemma lawUnreadVaultsNoCoverage_ensures(monthlyPool: bool, amount: seq<int>, vaults: seq<FreeRead>)
  ensures (lawUnreadVaultsNoCoverage(monthlyPool, amount, vaults) == true)
{
  var counted := (v: FreeRead) => ((v.recorded && v.read) && settlement__money_validAmount(v.free));
  if forall v :: v in vaults ==> !(v.recorded) || !(v.read) {
    ProofLib.FilterNone(counted, vaults);
    CoverageNeedsAReadVault(monthlyPool, amount, vaults);
  }
}

lemma CoverageNeedsAReadVault(monthlyPool: bool, amount: seq<int>, vaults: seq<FreeRead>)
  ensures |ProofLib.Filter((v: FreeRead) => ((v.recorded && v.read) && settlement__money_validAmount(v.free)), vaults)| == 0 ==> monthsCovered(monthlyPool, amount, vaults) == Coverage.NoCoverage
{
}

lemma lawAllocationRowIsTheViewersOwn_ensures(status: frontend__requests_ReadStatus, allocation: AllocationFile, viewer: int, allocationWallets: seq<AllocationWallet>, instant: int)
  ensures (lawAllocationRowIsTheViewersOwn(status, allocation, viewer, allocationWallets, instant) == true)
{
  var mine := (r: AllocationRecipient) => (r.actor == viewer);
  if viewer > 0 && 0 < |ProofLib.Filter(mine, allocation.recipients)| {
    var x := ProofLib.Filter(mine, allocation.recipients)[0];
    ProofLib.FilterMember(mine, allocation.recipients, x);
    assert x in allocation.recipients && x.actor == viewer;
  }
}

lemma lawProjectionNeverAboveTheAmount_ensures(amount: seq<int>, basisPoints: int)
  ensures (lawProjectionNeverAboveTheAmount(amount, basisPoints) == true)
{
  hide *;
  reveal lawProjectionNeverAboveTheAmount, contributorPool,
    settlement__maintainerShare_maxShareBasisPoints, settlement__maintainerShare_basisPointsDivisor,
    settlement__money_validAmount, settlement__money_zero,
    settlement__money_equalAmounts, settlement__money_positiveAmount,
    settlement__money_lawEqualReflexive, settlement__money_lawZeroOrder,
    settlement__money_lawEqualSymmetric, settlement__money_lawEqualOrder,
    settlement__money_lawEqualSubstitution,
    settlement__money_lawAdditionValid, settlement__money_lawNumericOrderTotal,
    settlement__money_lawNumericOrderTransitive, settlement__money_lawAddMonotone,
    settlement__money_lawSubtractionAtMost, settlement__money_lawMultiplyCongruence,
    settlement__money_lawMultiplyCommutative, settlement__money_lawMultiplyCancellation,
    settlement__money_lawMultiplyZero, settlement__money_lawDivisionReconstructs,
    settlement__money_lawMultiplyValid, settlement__money_lawDivisionValid;
  if settlement__money_validAmount(amount) && basisPoints <= settlement__maintainerShare_maxShareBasisPoints {
    if basisPoints <= 0 {
      settlement__money_lawEqualReflexive_ensures(amount);
    } else {
      var bp := settlement__money_smallAmount(basisPoints);
      var div := settlement__money_smallAmount(settlement__maintainerShare_basisPointsDivisor);
      SmallAmountValue(basisPoints);
      SmallAmountValue(settlement__maintainerShare_basisPointsDivisor);
      SmallAmountPositive(settlement__maintainerShare_basisPointsDivisor);
      assert settlement__money_validAmount(bp) && settlement__money_validAmount(div);
      assert settlement__money_positiveAmount(div);
      SmallAmountOrder(basisPoints, settlement__maintainerShare_basisPointsDivisor);
      assert settlement__money_compareAmounts(bp, div) <= 0;
      var prod := settlement__money_multiplyAmounts(amount, bp);
      var scaled := settlement__money_multiplyAmounts(amount, div);
      settlement__money_lawMultiplyValid_ensures(amount, bp);
      settlement__money_lawMultiplyValid_ensures(amount, div);
      var q := settlement__money_divideAmounts(prod, div).quotient;
      var r := settlement__money_divideAmounts(prod, div).remainder;
      settlement__money_lawDivisionValid_ensures(prod, div);
      settlement__money_lawDivisionReconstructs_ensures(prod, div);
      var qd := settlement__money_multiplyAmounts(q, div);
      settlement__money_lawMultiplyValid_ensures(q, div);
      settlement__money_lawAdditionValid_ensures(qd, r);
      settlement__money_lawAddMonotone_ensures(qd, r);
      settlement__money_lawNumericOrderTotal_ensures(qd, settlement__money_addAmounts(qd, r));
      settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(qd, r), prod, qd);
      assert settlement__money_compareAmounts(qd, prod) <= 0;
      if settlement__money_positiveAmount(amount) {
        settlement__money_lawMultiplyCancellation_ensures(bp, div, amount);
        settlement__money_lawMultiplyCommutative_ensures(amount, bp);
        settlement__money_lawMultiplyCommutative_ensures(amount, div);
        settlement__money_lawEqualOrder_ensures(prod, settlement__money_multiplyAmounts(bp, amount), settlement__money_multiplyAmounts(div, amount));
        settlement__money_lawEqualOrder_ensures(scaled, settlement__money_multiplyAmounts(div, amount), prod);
        assert settlement__money_compareAmounts(prod, scaled) <= 0;
      } else {
        settlement__money_lawZeroOrder_ensures(amount);
        settlement__money_lawNumericOrderTotal_ensures(amount, settlement__money_zero);
        assert settlement__money_equalAmounts(amount, settlement__money_zero);
        settlement__money_lawMultiplyCongruence_ensures(amount, settlement__money_zero, bp);
        settlement__money_lawMultiplyCongruence_ensures(amount, settlement__money_zero, div);
        settlement__money_lawMultiplyZero_ensures(bp);
        settlement__money_lawMultiplyZero_ensures(div);
        settlement__money_lawEqualSubstitution_ensures(settlement__money_multiplyAmounts(settlement__money_zero, bp), settlement__money_zero, prod);
        settlement__money_lawEqualSubstitution_ensures(settlement__money_multiplyAmounts(settlement__money_zero, div), settlement__money_zero, scaled);
        settlement__money_lawEqualOrder_ensures(prod, settlement__money_zero, scaled);
        settlement__money_lawEqualOrder_ensures(scaled, settlement__money_zero, settlement__money_zero);
        settlement__money_lawEqualReflexive_ensures(settlement__money_zero);
        assert settlement__money_compareAmounts(prod, scaled) <= 0;
      }
      settlement__money_lawNumericOrderTransitive_ensures(qd, prod, scaled);
      settlement__money_lawMultiplyCancellation_ensures(q, amount, div);
      settlement__money_lawNumericOrderTotal_ensures(amount, q);
      settlement__money_lawSubtractionAtMost_ensures(amount, q);
    }
  }
}

lemma SmallAmountValue(n: int)
  requires 0 <= n < 1000000
  ensures settlement__money_smallAmount(n) == [n % 1000, (n / 1000) % 1000, 0, 0, 0, 0]
  ensures settlement__money_validAmount(settlement__money_smallAmount(n))
{
  var f := (acc: settlement__money_SafeConversion, ignored: int) => settlement__money_SafeConversion(settlement__money_quotient_settlement__money(acc.remaining, 1000), (acc.digits + [settlement__money_remainder_settlement__money(acc.remaining, 1000)]));
  var s0 := settlement__money_SafeConversion(n, []);
  var s1 := f(s0, 0);
  var s2 := f(s1, 0);
  var s3 := f(s2, 0);
  var s4 := f(s3, 0);
  var s5 := f(s4, 0);
  var s6 := f(s5, 0);
  ProofLib.FoldLeftAppend(f, s0, [], 0);
  ProofLib.FoldLeftAppend(f, s0, [0], 0);
  ProofLib.FoldLeftAppend(f, s0, [0, 0], 0);
  ProofLib.FoldLeftAppend(f, s0, [0, 0, 0], 0);
  ProofLib.FoldLeftAppend(f, s0, [0, 0, 0, 0], 0);
  ProofLib.FoldLeftAppend(f, s0, [0, 0, 0, 0, 0], 0);
  assert [0, 0, 0, 0, 0, 0] == [0, 0, 0, 0, 0] + [0];
  assert s6.digits == [n % 1000, (n / 1000) % 1000, 0, 0, 0, 0];
}

lemma SmallAmountOrder(a: int, b: int)
  requires 0 <= a <= b < 1000000
  ensures settlement__money_compareAmounts(settlement__money_smallAmount(a), settlement__money_smallAmount(b)) <= 0
{
  SmallAmountValue(a);
  SmallAmountValue(b);
  var sa := settlement__money_smallAmount(a);
  var sb := settlement__money_smallAmount(b);
  var f := (acc: settlement__money_CompareFold, ignored: int) => settlement__money_CompareFold((acc.index + 1), (if ((if ((0 <= acc.index) && (acc.index < |sa|)) then sa[acc.index] else 0) == (if ((0 <= acc.index) && (acc.index < |sb|)) then sb[acc.index] else 0)) then acc.comparison else (if ((if ((0 <= acc.index) && (acc.index < |sa|)) then sa[acc.index] else 0) > (if ((0 <= acc.index) && (acc.index < |sb|)) then sb[acc.index] else 0)) then 1 else -1)));
  var z := settlement__money_CompareFold(0, 0);
  ProofLib.FoldLeftAppend(f, z, [], sa[0]);
  ProofLib.FoldLeftAppend(f, z, sa[..1], sa[1]);
  ProofLib.FoldLeftAppend(f, z, sa[..2], sa[2]);
  ProofLib.FoldLeftAppend(f, z, sa[..3], sa[3]);
  ProofLib.FoldLeftAppend(f, z, sa[..4], sa[4]);
  ProofLib.FoldLeftAppend(f, z, sa[..5], sa[5]);
  assert sa == sa[..5] + [sa[5]];
  assert sa[..5] == sa[..4] + [sa[4]];
  assert sa[..4] == sa[..3] + [sa[3]];
  assert sa[..3] == sa[..2] + [sa[2]];
  assert sa[..2] == sa[..1] + [sa[1]];
  assert sa[..1] == [] + [sa[0]];
}

lemma SmallAmountPositive(n: int)
  requires 0 < n < 1000000
  ensures settlement__money_positiveAmount(settlement__money_smallAmount(n))
{
  SmallAmountValue(n);
  var sa := settlement__money_smallAmount(n);
  var sb := settlement__money_zero;
  var f := (acc: settlement__money_CompareFold, ignored: int) => settlement__money_CompareFold((acc.index + 1), (if ((if ((0 <= acc.index) && (acc.index < |sa|)) then sa[acc.index] else 0) == (if ((0 <= acc.index) && (acc.index < |sb|)) then sb[acc.index] else 0)) then acc.comparison else (if ((if ((0 <= acc.index) && (acc.index < |sa|)) then sa[acc.index] else 0) > (if ((0 <= acc.index) && (acc.index < |sb|)) then sb[acc.index] else 0)) then 1 else -1)));
  var z := settlement__money_CompareFold(0, 0);
  ProofLib.FoldLeftAppend(f, z, [], sa[0]);
  ProofLib.FoldLeftAppend(f, z, sa[..1], sa[1]);
  ProofLib.FoldLeftAppend(f, z, sa[..2], sa[2]);
  ProofLib.FoldLeftAppend(f, z, sa[..3], sa[3]);
  ProofLib.FoldLeftAppend(f, z, sa[..4], sa[4]);
  ProofLib.FoldLeftAppend(f, z, sa[..5], sa[5]);
  assert sa == sa[..5] + [sa[5]];
  assert sa[..5] == sa[..4] + [sa[4]];
  assert sa[..4] == sa[..3] + [sa[3]];
  assert sa[..3] == sa[..2] + [sa[2]];
  assert sa[..2] == sa[..1] + [sa[1]];
  assert sa[..1] == [] + [sa[0]];
}
