lemma ownerSign_ensures(r: ReserveRelease, attempt: int, by_: string)
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysAbsentEmpty(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysNoSettlementOnRelease(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysWholeRelease(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysBoundApproval(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysSignedIdentity(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysLiveAttemptFresh(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysFinalizedHeight(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysObservedAfterSignature(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysApprovedEvm(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysRefusalNamed(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysNetworkPinned(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysUntouchedBalances(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysSettlementHistory(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysOwnerRevision(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysQualifiedAgainstPin(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysValidAmounts(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysConserved(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> stepAttemptHistoryRetained(r, ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> stepSignedAttemptRetained(r, ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> stepNetworkFixed(r, ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> stepRefusalRetained(r, ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> stepPinFixed(r, ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> stepOriginalTermsRetained(r, ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> stepSettlementHistoryRetained(r, ownerSign(r, attempt, by_)))
{
  if inv(r) && canOwnerSign(r, attempt, by_) {
    RetiredFoldComplement(r.retiredAttempts, attempt, false);
    var signed := ownerSign(r, attempt, by_);
    assert signed.signedAttempt == attempt;
    assert signed.retiredAttempts == r.retiredAttempts;
    assert alwaysLiveAttemptFresh(signed);
  }
}

lemma RetiredFoldComplement(history: seq<RetiredReleaseAttempt>, attempt: int, used: bool)
  ensures Std.Collections.Seq.FoldLeft((used: bool, prior: RetiredReleaseAttempt) => (used || (prior.attempt == attempt)), used, history)
    == !Std.Collections.Seq.FoldLeft((fresh_: bool, prior: RetiredReleaseAttempt) => (fresh_ && (prior.attempt != attempt)), !used, history)
  decreases |history|
{
  if |history| > 0 {
    RetiredFoldComplement(history[1..], attempt, used || history[0].attempt == attempt);
  }
}

lemma check_ensures(r: ReserveRelease, root: string, total: seq<int>, height: int, requestRevision: int, by_: string)
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysAbsentEmpty(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysNoSettlementOnRelease(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysWholeRelease(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysBoundApproval(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysSignedIdentity(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysLiveAttemptFresh(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysFinalizedHeight(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysObservedAfterSignature(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysApprovedEvm(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysRefusalNamed(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysNetworkPinned(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysUntouchedBalances(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysSettlementHistory(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysOwnerRevision(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysQualifiedAgainstPin(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysValidAmounts(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> alwaysConserved(check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> stepAttemptHistoryRetained(r, check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> stepSignedAttemptRetained(r, check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> stepNetworkFixed(r, check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> stepRefusalRetained(r, check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> stepPinFixed(r, check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> stepOriginalTermsRetained(r, check(r, root, total, height, requestRevision, by_)))
  ensures (inv(r) ==> canCheck(r, root, total, height, requestRevision, by_) ==> stepSettlementHistoryRetained(r, check(r, root, total, height, requestRevision, by_)))
{
  if inv(r) && canCheck(r, root, total, height, requestRevision, by_) {
    assert r.reserved == r.originalReserve;
    if settlement__money_equalAmounts(r.allocationTotal, r.originalReserve) {
      PaddedAmountSubstitution(total, r.allocationTotal, r.originalReserve);
      assert false;
    }
  }
}

lemma PaddedAmountSubstitution(a: seq<int>, b: seq<int>, c: seq<int>)
  requires settlement__money_equalAmounts(a, b)
  requires settlement__money_equalAmounts(b, c)
  ensures settlement__money_equalAmounts(a, c)
{
  AmountEqualLimb(a, b);
  AmountEqualLimb(b, c);
  AmountEqualLimb(a, c);
  forall i | 0 <= i < (if |a| >= |c| then |a| else |c|)
    ensures (if i < |a| then a[i] else 0) == (if i < |c| then c[i] else 0)
  {
    assert (if i < |a| then a[i] else 0) == (if i < |b| then b[i] else 0) by {
      if i >= (if |a| >= |b| then |a| else |b|) { assert i >= |a| && i >= |b|; }
    }
    assert (if i < |b| then b[i] else 0) == (if i < |c| then c[i] else 0) by {
      if i >= (if |b| >= |c| then |b| else |c|) { assert i >= |b| && i >= |c|; }
    }
  }
}

lemma AmountEqualLimb(a: seq<int>, b: seq<int>)
  ensures settlement__money_equalAmounts(a, b) == (forall i :: (0 <= i < (if |a| >= |b| then |a| else |b|) ==> ((if i < |a| then a[i] else 0) == (if i < |b| then b[i] else 0))))
{
  var longest := (if (|a| >= |b|) then a else b);
  var f := (acc: settlement__money_CompareFold, ignored: int) => settlement__money_CompareFold((acc.index + 1), (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) == (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then acc.comparison else (if ((if ((0 <= acc.index) && (acc.index < |a|)) then a[acc.index] else 0) > (if ((0 <= acc.index) && (acc.index < |b|)) then b[acc.index] else 0)) then 1 else -1)));
  var same := (i: int) => (if (0 <= i && i < |a|) then a[i] else 0) == (if (0 <= i && i < |b|) then b[i] else 0);
  forall acc: settlement__money_CompareFold, ignored: int
    ensures f(acc, ignored).index == acc.index + 1
    ensures (f(acc, ignored).comparison == 0) == (acc.comparison == 0 && same(acc.index))
  { }
  CompareFoldZero(f, same, settlement__money_CompareFold(0, 0), longest);
  assert |longest| == (if |a| >= |b| then |a| else |b|);
  assert settlement__money_compareAmounts(a, b) == Std.Collections.Seq.FoldLeft(f, settlement__money_CompareFold(0, 0), longest).comparison;
  assert forall i :: (0 <= i < |longest|) ==> (same(i) == ((if i < |a| then a[i] else 0) == (if i < |b| then b[i] else 0)));
}

lemma CompareFoldZero(f: (settlement__money_CompareFold, int) -> settlement__money_CompareFold, same: int -> bool,
  acc: settlement__money_CompareFold, xs: seq<int>)
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

lemma finalize_ensures(r: ReserveRelease, receipt: ReleaseReceipt)
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysAbsentEmpty(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysNoSettlementOnRelease(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysWholeRelease(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysBoundApproval(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysSignedIdentity(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysLiveAttemptFresh(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysFinalizedHeight(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysObservedAfterSignature(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysApprovedEvm(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysRefusalNamed(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysNetworkPinned(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysUntouchedBalances(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysSettlementHistory(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysOwnerRevision(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysQualifiedAgainstPin(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysValidAmounts(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> alwaysConserved(finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> stepAttemptHistoryRetained(r, finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> stepSignedAttemptRetained(r, finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> stepNetworkFixed(r, finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> stepRefusalRetained(r, finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> stepPinFixed(r, finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> stepOriginalTermsRetained(r, finalize(r, receipt)))
  ensures (inv(r) ==> canFinalize(r, receipt) ==> stepSettlementHistoryRetained(r, finalize(r, receipt)))
{
  if inv(r) && canFinalize(r, receipt) {
    assert !r.hasSettled;
    assert r.free == r.originalFree && r.reserved == r.originalReserve;
    settlement__money_lawAdditionValid_ensures(r.free, r.reserved);
    var released := finalize(r, receipt);
    var total := settlement__money_addAmounts(r.originalFree, r.originalReserve);
    assert released.reserved == settlement__money_zero && released.free == total;
    AmountEqualLimb(settlement__money_zero, settlement__money_zero);
    AmountEqualLimb(total, total);
    assert alwaysWholeRelease(released);
    assert r.settledAmount == settlement__money_zero;
    var once := settlement__money_addAmounts(total, settlement__money_zero);
    var twice := settlement__money_addAmounts(once, settlement__money_zero);
    settlement__money_lawAdditionValid_ensures(total, settlement__money_zero);
    settlement__money_lawZeroIdentity_ensures(total);
    settlement__money_lawZeroIdentity_ensures(once);
    PaddedAmountSubstitution(twice, once, total);
    assert alwaysConserved(released);
  }
}

lemma settlePart_ensures(r: ReserveRelease, amount: seq<int>)
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysAbsentEmpty(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysNoSettlementOnRelease(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysWholeRelease(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysBoundApproval(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysSignedIdentity(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysLiveAttemptFresh(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysFinalizedHeight(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysObservedAfterSignature(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysApprovedEvm(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysRefusalNamed(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysNetworkPinned(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysUntouchedBalances(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysSettlementHistory(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysOwnerRevision(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysQualifiedAgainstPin(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysValidAmounts(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> alwaysConserved(settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> stepAttemptHistoryRetained(r, settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> stepSignedAttemptRetained(r, settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> stepNetworkFixed(r, settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> stepRefusalRetained(r, settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> stepPinFixed(r, settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> stepOriginalTermsRetained(r, settlePart(r, amount)))
  ensures (inv(r) ==> canSettlePart(r, amount) ==> stepSettlementHistoryRetained(r, settlePart(r, amount)))
{
  if inv(r) && canSettlePart(r, amount) {
    settlement__money_lawAdditionValid_ensures(r.settledAmount, amount);
    settlement__money_lawSubtractionValid_ensures(r.reserved, amount);
    var rest := settlement__money_subtractAmounts(r.reserved, amount);
    var restored := settlement__money_addAmounts(rest, amount);
    var prior := settlement__money_addAmounts(r.free, r.reserved);
    var head := settlement__money_addAmounts(r.free, rest);
    var lifted := settlement__money_addAmounts(r.free, restored);
    var withAmount := settlement__money_addAmounts(head, amount);
    var oldTotal := settlement__money_addAmounts(prior, r.settledAmount);
    var newSettlement := settlement__money_addAmounts(r.settledAmount, amount);
    var newTotal := settlement__money_addAmounts(head, newSettlement);
    settlement__money_lawNumericOrderTotal_ensures(r.reserved, amount);
    assert settlement__money_compareAmounts(r.reserved, amount) >= 0;
    settlement__money_lawSubtractionReconstructs_ensures(r.reserved, amount);
    settlement__money_lawAdditionValid_ensures(rest, amount);
    settlement__money_lawAdditionValid_ensures(r.free, r.reserved);
    settlement__money_lawAdditionValid_ensures(r.free, rest);
    settlement__money_lawAdditionValid_ensures(r.free, restored);
    settlement__money_lawAdditionValid_ensures(head, amount);
    assert settlement__money_equalAmounts(restored, r.reserved);
    settlement__money_lawAddCongruence_ensures(restored, r.reserved, r.free);
    assert settlement__money_equalAmounts(lifted, prior) by {
      settlement__money_lawAddCommutative_ensures(restored, r.free);
      settlement__money_lawAddCommutative_ensures(r.reserved, r.free);
    }
    settlement__money_lawAddAssociative_ensures(r.free, rest, amount);
    PaddedAmountSubstitution(withAmount, lifted, prior);
    settlement__money_lawAddCongruence_ensures(withAmount, prior, r.settledAmount);
    settlement__money_lawAddAssociative_ensures(head, amount, r.settledAmount);
    settlement__money_lawAddCommutative_ensures(amount, r.settledAmount);
    settlement__money_lawEqualSymmetric_ensures(newTotal, settlement__money_addAmounts(withAmount, r.settledAmount));
    PaddedAmountSubstitution(newTotal, settlement__money_addAmounts(withAmount, r.settledAmount), oldTotal);
    PaddedAmountSubstitution(newTotal, oldTotal, settlement__money_addAmounts(r.originalFree, r.originalReserve));
    assert alwaysConserved(settlePart(r, amount));
  }
}

lemma admitRetained_ensures(r: ReserveRelease, evidence: RetainedAllocation)
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysAbsentEmpty(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysNoSettlementOnRelease(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysWholeRelease(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysBoundApproval(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysSignedIdentity(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysLiveAttemptFresh(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysFinalizedHeight(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysObservedAfterSignature(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysApprovedEvm(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysRefusalNamed(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysNetworkPinned(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysUntouchedBalances(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysSettlementHistory(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysOwnerRevision(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysQualifiedAgainstPin(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysValidAmounts(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> alwaysConserved(admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> stepAttemptHistoryRetained(r, admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> stepSignedAttemptRetained(r, admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> stepNetworkFixed(r, admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> stepRefusalRetained(r, admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> stepPinFixed(r, admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> stepOriginalTermsRetained(r, admitRetained(r, evidence)))
  ensures (inv(r) ==> canAdmitRetained(r, evidence) ==> stepSettlementHistoryRetained(r, admitRetained(r, evidence)))
{
  if inv(r) && canAdmitRetained(r, evidence) {
    var admitted := admitRetained(r, evidence);
    assert r.settledAmount == settlement__money_zero;
    var total := settlement__money_addAmounts(evidence.free, evidence.reserve);
    settlement__money_lawAdditionValid_ensures(evidence.free, evidence.reserve);
    settlement__money_lawZeroIdentity_ensures(total);
    assert alwaysConserved(admitted);
  }
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  var zero := settlement__money_zero;
  var total := settlement__money_addAmounts(zero, zero);
  settlement__money_lawAdditionValid_ensures(zero, zero);
  settlement__money_lawZeroIdentity_ensures(total);
  assert alwaysConserved(initialHolds());
}
