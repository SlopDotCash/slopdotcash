lemma LockAddedFoldValid(amount: seq<int>, acc: seq<int>, rest: seq<settlement__monthPledges_ChainPledge>)
  requires settlement__money_validAmount(amount)
  requires settlement__money_validAmount(acc)
  requires forall e :: e in rest ==> settlement__money_validAmount(e.amount)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft(
    (total: settlement__money_Amount, month: settlement__monthPledges_ChainPledge) => settlement__money_addAmounts(total, (if !(month.open) then amount else (if (settlement__money_compareAmounts(amount, month.amount) > 0) then settlement__money_subtractAmounts(amount, month.amount) else settlement__money_zero))),
    acc,
    rest
  ))
  decreases |rest|
{
  if |rest| > 0 {
    var month := rest[0];
    var delta := if !(month.open) then amount else (if (settlement__money_compareAmounts(amount, month.amount) > 0) then settlement__money_subtractAmounts(amount, month.amount) else settlement__money_zero);
    if month.open && settlement__money_compareAmounts(amount, month.amount) > 0 {
      settlement__money_lawSubtractionValid_ensures(amount, month.amount);
    }
    settlement__money_lawAdditionValid_ensures(acc, delta);
    LockAddedFoldValid(amount, settlement__money_addAmounts(acc, delta), rest[1..]);
  }
}

lemma LockAddedValid(request: frontend__vaultLocks_LockRequest)
  requires settlement__money_validAmount(request.amount)
  requires forall e :: e in request.existing ==> settlement__money_validAmount(e.amount)
  ensures settlement__money_validAmount(frontend__vaultLocks_lockAdded(request))
{
  LockAddedFoldValid(request.amount, settlement__money_zero, request.existing);
}

lemma readVault_ensures(m: MonthLock, supported: bool, owner: int, free: seq<int>, locked: seq<int>, by_: int)
  ensures (inv(m) ==> canReadVault(m, supported, owner, free, locked, by_) ==> alwaysLocksWithinFreeFunds(readVault(m, supported, owner, free, locked, by_)))
  ensures (inv(m) ==> canReadVault(m, supported, owner, free, locked, by_) ==> alwaysChecksWithinLimit(readVault(m, supported, owner, free, locked, by_)))
  ensures (inv(m) ==> canReadVault(m, supported, owner, free, locked, by_) ==> alwaysValidAmounts(readVault(m, supported, owner, free, locked, by_)))
  ensures (inv(m) ==> canReadVault(m, supported, owner, free, locked, by_) ==> alwaysPendingLockFits(readVault(m, supported, owner, free, locked, by_)))
  ensures (inv(m) ==> canReadVault(m, supported, owner, free, locked, by_) ==> alwaysPendingReleaseIsLapsed(readVault(m, supported, owner, free, locked, by_)))
  ensures (inv(m) ==> canReadVault(m, supported, owner, free, locked, by_) ==> alwaysOnlyTheOwnerLocks(readVault(m, supported, owner, free, locked, by_)))
  ensures (inv(m) ==> canReadVault(m, supported, owner, free, locked, by_) ==> stepOnlyIncludedTransactionsMoveLocks(m, "readVault", readVault(m, supported, owner, free, locked, by_)))
{
  if inv(m) && canReadVault(m, supported, owner, free, locked, by_) && supported {
    settlement__money_lawZeroOrder_ensures(locked);
    settlement__money_lawEqualReflexive_ensures(locked);
  }
}

lemma review_ensures(m: MonthLock, count: int, amount: seq<int>, monthly: seq<int>, existing: seq<settlement__monthPledges_ChainPledge>, deposit: seq<int>, batches: bool, by_: int)
  ensures (inv(m) ==> canReview(m, count, amount, monthly, existing, deposit, batches, by_) ==> alwaysLocksWithinFreeFunds(review(m, count, amount, monthly, existing, deposit, batches, by_)))
  ensures (inv(m) ==> canReview(m, count, amount, monthly, existing, deposit, batches, by_) ==> alwaysChecksWithinLimit(review(m, count, amount, monthly, existing, deposit, batches, by_)))
  ensures (inv(m) ==> canReview(m, count, amount, monthly, existing, deposit, batches, by_) ==> alwaysValidAmounts(review(m, count, amount, monthly, existing, deposit, batches, by_)))
  ensures (inv(m) ==> canReview(m, count, amount, monthly, existing, deposit, batches, by_) ==> alwaysPendingLockFits(review(m, count, amount, monthly, existing, deposit, batches, by_)))
  ensures (inv(m) ==> canReview(m, count, amount, monthly, existing, deposit, batches, by_) ==> alwaysPendingReleaseIsLapsed(review(m, count, amount, monthly, existing, deposit, batches, by_)))
  ensures (inv(m) ==> canReview(m, count, amount, monthly, existing, deposit, batches, by_) ==> alwaysOnlyTheOwnerLocks(review(m, count, amount, monthly, existing, deposit, batches, by_)))
  ensures (inv(m) ==> canReview(m, count, amount, monthly, existing, deposit, batches, by_) ==> stepOnlyIncludedTransactionsMoveLocks(m, "review", review(m, count, amount, monthly, existing, deposit, batches, by_)))
{
  if inv(m) && canReview(m, count, amount, monthly, existing, deposit, batches, by_) {
    var req := frontend__vaultLocks_LockRequest(count, amount, monthly, existing, deposit, batches, (m.wallet == m.owner), m.free, m.locked);
    if frontend__vaultLocks_lockRefusal(req).NoLockRefusal? {
      LockAddedValid(req);
      var added := frontend__vaultLocks_lockAdded(req);
      settlement__money_lawAdditionValid_ensures(m.locked, added);
      settlement__money_lawAdditionValid_ensures(m.free, deposit);
      settlement__money_lawNumericOrderTotal_ensures(settlement__money_addAmounts(m.locked, added), settlement__money_addAmounts(m.free, deposit));
    }
  }
}

lemma lapse_ensures(m: MonthLock, monthAmount: seq<int>, by_: int)
  ensures (inv(m) ==> canLapse(m, monthAmount, by_) ==> alwaysLocksWithinFreeFunds(lapse(m, monthAmount, by_)))
  ensures (inv(m) ==> canLapse(m, monthAmount, by_) ==> alwaysChecksWithinLimit(lapse(m, monthAmount, by_)))
  ensures (inv(m) ==> canLapse(m, monthAmount, by_) ==> alwaysValidAmounts(lapse(m, monthAmount, by_)))
  ensures (inv(m) ==> canLapse(m, monthAmount, by_) ==> alwaysPendingLockFits(lapse(m, monthAmount, by_)))
  ensures (inv(m) ==> canLapse(m, monthAmount, by_) ==> alwaysPendingReleaseIsLapsed(lapse(m, monthAmount, by_)))
  ensures (inv(m) ==> canLapse(m, monthAmount, by_) ==> alwaysOnlyTheOwnerLocks(lapse(m, monthAmount, by_)))
  ensures (inv(m) ==> canLapse(m, monthAmount, by_) ==> stepOnlyIncludedTransactionsMoveLocks(m, "lapse", lapse(m, monthAmount, by_)))
{
  if inv(m) && canLapse(m, monthAmount, by_) {
    settlement__money_lawAdditionValid_ensures(m.lapsed, monthAmount);
  }
}

lemma check_ensures(m: MonthLock, result: LockResult, by_: int)
  ensures (inv(m) ==> canCheck(m, result, by_) ==> alwaysLocksWithinFreeFunds(check(m, result, by_)))
  ensures (inv(m) ==> canCheck(m, result, by_) ==> alwaysChecksWithinLimit(check(m, result, by_)))
  ensures (inv(m) ==> canCheck(m, result, by_) ==> alwaysValidAmounts(check(m, result, by_)))
  ensures (inv(m) ==> canCheck(m, result, by_) ==> alwaysPendingLockFits(check(m, result, by_)))
  ensures (inv(m) ==> canCheck(m, result, by_) ==> alwaysPendingReleaseIsLapsed(check(m, result, by_)))
  ensures (inv(m) ==> canCheck(m, result, by_) ==> alwaysOnlyTheOwnerLocks(check(m, result, by_)))
  ensures (inv(m) ==> canCheck(m, result, by_) ==> stepOnlyIncludedTransactionsMoveLocks(m, "check", check(m, result, by_)))
{
  if inv(m) && canCheck(m, result, by_) && result.ChainIncluded? {
    if m.kind.LockingMonths? {
      var newLocked := settlement__money_addAmounts(m.locked, m.added);
      settlement__money_lawAdditionValid_ensures(m.locked, m.added);
      settlement__money_lawAdditionValid_ensures(m.free, m.deposit);
      settlement__money_lawAddMonotone_ensures(m.locked, m.added);
      settlement__money_lawNumericOrderTotal_ensures(newLocked, m.locked);
      settlement__money_lawNumericOrderTransitive_ensures(m.lapsed, m.locked, newLocked);
      settlement__money_lawNumericOrderTransitive_ensures(m.shownLocked, m.locked, newLocked);
    } else {
      settlement__money_lawNumericOrderTransitive_ensures(m.released, m.lapsed, m.locked);
      settlement__money_lawNumericOrderTotal_ensures(m.locked, m.released);
      settlement__money_lawNumericOrderTotal_ensures(m.lapsed, m.released);
      var remaining := settlement__money_subtractAmounts(m.locked, m.released);
      var lapsedLeft := settlement__money_subtractAmounts(m.lapsed, m.released);
      settlement__money_lawSubtractionValid_ensures(m.locked, m.released);
      settlement__money_lawSubtractionValid_ensures(m.lapsed, m.released);
      settlement__money_lawSubtractionReconstructs_ensures(m.locked, m.released);
      settlement__money_lawSubtractionReconstructs_ensures(m.lapsed, m.released);
      settlement__money_lawAdditionValid_ensures(lapsedLeft, m.released);
      settlement__money_lawAdditionValid_ensures(remaining, m.released);
      settlement__money_lawAddOrder_ensures(lapsedLeft, remaining, m.released);
      settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(lapsedLeft, m.released), m.lapsed, settlement__money_addAmounts(remaining, m.released));
      settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(remaining, m.released), m.locked, m.lapsed);
      settlement__money_lawEqualReflexive_ensures(remaining);
    }
  }
}
