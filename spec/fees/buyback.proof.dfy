
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
// Advancing the clock can only expire entries from the retained window.
lemma WindowErasesOnly(xs: seq<Spend>, from: int, through: int, prior: int, updated: int)
  requires from <= through && updated <= prior
  requires forall x :: x in xs ==> x.at <= from && x.amount > 0
  ensures Std.Collections.Seq.FoldLeft((total: int, spend: Spend) => (total + (if ((spend.at > (through - 86400000)) && (spend.at <= through)) then spend.amount else 0)), updated, xs) <=
    Std.Collections.Seq.FoldLeft((total: int, spend: Spend) => (total + (if ((spend.at > (from - 86400000)) && (spend.at <= from)) then spend.amount else 0)), prior, xs)
  decreases |xs|
{
  if |xs| > 0 {
    var x := xs[0];
    assert x in xs;
    assert forall y :: y in xs[1..] ==> y in xs;
    WindowErasesOnly(xs[1..], from, through,
      prior + (if x.at > from - 86400000 && x.at <= from then x.amount else 0),
      updated + (if x.at > through - 86400000 && x.at <= through then x.amount else 0));
  }
}

lemma WindowAppendsNow(xs: seq<Spend>, now: int, amount: int)
  ensures spentInWindow(xs + [Spend(now, amount)], now) == spentInWindow(xs, now) + amount
{
  ProofLib.FoldLeftAppend((total: int, spend: Spend) => (total + (if ((spend.at > (now - 86400000)) && (spend.at <= now)) then spend.amount else 0)), 0, xs, Spend(now, amount));
}

lemma UnchangedCumulativeIncome(before: Buyback, after: Buyback)
  requires after.income == before.income && after.acquired == before.acquired && after.burnCommitted == before.burnCommitted
  ensures stepIncomeMonotonic(before, after)
{
  settlement__money_lawEqualReflexive_ensures(before.income);
  settlement__money_lawEqualReflexive_ensures(before.acquired);
  settlement__money_lawEqualReflexive_ensures(before.burnCommitted);
}

lemma activate_ensures(b: Buyback, converterLive: bool, robinhoodEnabled: bool, explicitLimits: bool, by_: string)
  ensures (inv(b) ==> canActivate(b, converterLive, robinhoodEnabled, explicitLimits, by_) ==> alwaysShareBounded(activate(b, converterLive, robinhoodEnabled, explicitLimits, by_)))
  ensures (inv(b) ==> canActivate(b, converterLive, robinhoodEnabled, explicitLimits, by_) ==> alwaysBurnBounded(activate(b, converterLive, robinhoodEnabled, explicitLimits, by_)))
  ensures (inv(b) ==> canActivate(b, converterLive, robinhoodEnabled, explicitLimits, by_) ==> alwaysWindowLimits(activate(b, converterLive, robinhoodEnabled, explicitLimits, by_)))
  ensures (inv(b) ==> canActivate(b, converterLive, robinhoodEnabled, explicitLimits, by_) ==> alwaysJournalPastAndPositive(activate(b, converterLive, robinhoodEnabled, explicitLimits, by_)))
  ensures (inv(b) ==> canActivate(b, converterLive, robinhoodEnabled, explicitLimits, by_) ==> alwaysPendingOrderReserved(activate(b, converterLive, robinhoodEnabled, explicitLimits, by_)))
  ensures (inv(b) ==> canActivate(b, converterLive, robinhoodEnabled, explicitLimits, by_) ==> alwaysLocalShareBounded(activate(b, converterLive, robinhoodEnabled, explicitLimits, by_)))
  ensures (inv(b) ==> canActivate(b, converterLive, robinhoodEnabled, explicitLimits, by_) ==> stepIncomeMonotonic(b, activate(b, converterLive, robinhoodEnabled, explicitLimits, by_)))
{
  if inv(b) && canActivate(b, converterLive, robinhoodEnabled, explicitLimits, by_) {
    var after := activate(b, converterLive, robinhoodEnabled, explicitLimits, by_);
    UnchangedCumulativeIncome(b, after);
  }
}

lemma order_ensures(b: Buyback, orderRequest: BridgeOrder)
  ensures (inv(b) ==> canOrder(b, orderRequest) ==> alwaysShareBounded(order(b, orderRequest)))
  ensures (inv(b) ==> canOrder(b, orderRequest) ==> alwaysBurnBounded(order(b, orderRequest)))
  ensures (inv(b) ==> canOrder(b, orderRequest) ==> alwaysWindowLimits(order(b, orderRequest)))
  ensures (inv(b) ==> canOrder(b, orderRequest) ==> alwaysJournalPastAndPositive(order(b, orderRequest)))
  ensures (inv(b) ==> canOrder(b, orderRequest) ==> alwaysPendingOrderReserved(order(b, orderRequest)))
  ensures (inv(b) ==> canOrder(b, orderRequest) ==> alwaysLocalShareBounded(order(b, orderRequest)))
  ensures (inv(b) ==> canOrder(b, orderRequest) ==> stepIncomeMonotonic(b, order(b, orderRequest)))
{
  if inv(b) && canOrder(b, orderRequest) {
    var after := order(b, orderRequest);
    UnchangedCumulativeIncome(b, after);
    WindowErasesOnly(b.purchaseSpends, b.clock, orderRequest.now, 0, 0);
    WindowAppendsNow(b.bridgeSpends, orderRequest.now, orderRequest.amount);
    assert alwaysWindowLimits(after);
    SmallAmountNonnegativeValid(orderRequest.amount);
    settlement__money_lawAdditionValid_ensures(b.committed, settlement__money_smallAmount(orderRequest.amount));
    settlement__half_lawHalfValid_ensures(b.income);
    settlement__money_lawPositiveAddition_ensures(b.committed, settlement__money_smallAmount(orderRequest.amount));
    var amount := settlement__money_smallAmount(orderRequest.amount);
    settlement__money_lawAddCommutative_ensures(b.committed, amount);
    settlement__money_lawAddMonotone_ensures(amount, b.committed);
  }
}

lemma broadcast_ensures(b: Buyback)
  ensures (inv(b) ==> canBroadcast(b) ==> alwaysShareBounded(broadcast(b)))
  ensures (inv(b) ==> canBroadcast(b) ==> alwaysBurnBounded(broadcast(b)))
  ensures (inv(b) ==> canBroadcast(b) ==> alwaysWindowLimits(broadcast(b)))
  ensures (inv(b) ==> canBroadcast(b) ==> alwaysJournalPastAndPositive(broadcast(b)))
  ensures (inv(b) ==> canBroadcast(b) ==> alwaysPendingOrderReserved(broadcast(b)))
  ensures (inv(b) ==> canBroadcast(b) ==> alwaysLocalShareBounded(broadcast(b)))
  ensures (inv(b) ==> canBroadcast(b) ==> stepIncomeMonotonic(b, broadcast(b)))
{
  if inv(b) && canBroadcast(b) {
    var after := broadcast(b);
    UnchangedCumulativeIncome(b, after);
  }
}

lemma observeArrival_ensures(b: Buyback, order: int, amount: int, receiver: string, height: int, finalized: bool)
  ensures (inv(b) ==> canObserveArrival(b, order, amount, receiver, height, finalized) ==> alwaysShareBounded(observeArrival(b, order, amount, receiver, height, finalized)))
  ensures (inv(b) ==> canObserveArrival(b, order, amount, receiver, height, finalized) ==> alwaysBurnBounded(observeArrival(b, order, amount, receiver, height, finalized)))
  ensures (inv(b) ==> canObserveArrival(b, order, amount, receiver, height, finalized) ==> alwaysWindowLimits(observeArrival(b, order, amount, receiver, height, finalized)))
  ensures (inv(b) ==> canObserveArrival(b, order, amount, receiver, height, finalized) ==> alwaysJournalPastAndPositive(observeArrival(b, order, amount, receiver, height, finalized)))
  ensures (inv(b) ==> canObserveArrival(b, order, amount, receiver, height, finalized) ==> alwaysPendingOrderReserved(observeArrival(b, order, amount, receiver, height, finalized)))
  ensures (inv(b) ==> canObserveArrival(b, order, amount, receiver, height, finalized) ==> alwaysLocalShareBounded(observeArrival(b, order, amount, receiver, height, finalized)))
  ensures (inv(b) ==> canObserveArrival(b, order, amount, receiver, height, finalized) ==> stepIncomeMonotonic(b, observeArrival(b, order, amount, receiver, height, finalized)))
{
  if inv(b) && canObserveArrival(b, order, amount, receiver, height, finalized) {
    var after := observeArrival(b, order, amount, receiver, height, finalized);
    UnchangedCumulativeIncome(b, after);
  }
}

lemma observeRefund_ensures(b: Buyback, order: int, amount: int, beneficiary: string, height: int, finalized: bool)
  ensures (inv(b) ==> canObserveRefund(b, order, amount, beneficiary, height, finalized) ==> alwaysShareBounded(observeRefund(b, order, amount, beneficiary, height, finalized)))
  ensures (inv(b) ==> canObserveRefund(b, order, amount, beneficiary, height, finalized) ==> alwaysBurnBounded(observeRefund(b, order, amount, beneficiary, height, finalized)))
  ensures (inv(b) ==> canObserveRefund(b, order, amount, beneficiary, height, finalized) ==> alwaysWindowLimits(observeRefund(b, order, amount, beneficiary, height, finalized)))
  ensures (inv(b) ==> canObserveRefund(b, order, amount, beneficiary, height, finalized) ==> alwaysJournalPastAndPositive(observeRefund(b, order, amount, beneficiary, height, finalized)))
  ensures (inv(b) ==> canObserveRefund(b, order, amount, beneficiary, height, finalized) ==> alwaysPendingOrderReserved(observeRefund(b, order, amount, beneficiary, height, finalized)))
  ensures (inv(b) ==> canObserveRefund(b, order, amount, beneficiary, height, finalized) ==> alwaysLocalShareBounded(observeRefund(b, order, amount, beneficiary, height, finalized)))
  ensures (inv(b) ==> canObserveRefund(b, order, amount, beneficiary, height, finalized) ==> stepIncomeMonotonic(b, observeRefund(b, order, amount, beneficiary, height, finalized)))
{
  if inv(b) && canObserveRefund(b, order, amount, beneficiary, height, finalized) {
    var after := observeRefund(b, order, amount, beneficiary, height, finalized);
    UnchangedCumulativeIncome(b, after);
    SmallAmountNonnegativeValid(b.orderAmount);
    settlement__money_lawSubtractionValid_ensures(b.committed, settlement__money_smallAmount(b.orderAmount));
    settlement__half_lawHalfValid_ensures(b.income);
    var amount := settlement__money_smallAmount(b.orderAmount);
    var half := settlement__half_half(b.income).quotient;
    settlement__money_lawSubtractionAtMost_ensures(b.committed, amount);
    settlement__money_lawNumericOrderTransitive_ensures(after.committed, b.committed, half);
  }
}

lemma purchase_ensures(b: Buyback, purchaseRequest: PurchaseQuote)
  ensures (inv(b) ==> canPurchase(b, purchaseRequest) ==> alwaysShareBounded(purchase(b, purchaseRequest)))
  ensures (inv(b) ==> canPurchase(b, purchaseRequest) ==> alwaysBurnBounded(purchase(b, purchaseRequest)))
  ensures (inv(b) ==> canPurchase(b, purchaseRequest) ==> alwaysWindowLimits(purchase(b, purchaseRequest)))
  ensures (inv(b) ==> canPurchase(b, purchaseRequest) ==> alwaysJournalPastAndPositive(purchase(b, purchaseRequest)))
  ensures (inv(b) ==> canPurchase(b, purchaseRequest) ==> alwaysPendingOrderReserved(purchase(b, purchaseRequest)))
  ensures (inv(b) ==> canPurchase(b, purchaseRequest) ==> alwaysLocalShareBounded(purchase(b, purchaseRequest)))
  ensures (inv(b) ==> canPurchase(b, purchaseRequest) ==> stepIncomeMonotonic(b, purchase(b, purchaseRequest)))
{
  if inv(b) && canPurchase(b, purchaseRequest) {
    var after := purchase(b, purchaseRequest);
    settlement__money_lawEqualReflexive_ensures(b.income);
    settlement__money_lawEqualReflexive_ensures(b.burnCommitted);
    WindowErasesOnly(b.bridgeSpends, b.clock, purchaseRequest.now, 0, 0);
    WindowAppendsNow(b.purchaseSpends, purchaseRequest.now, purchaseRequest.spent);
    assert alwaysWindowLimits(after);
    settlement__money_lawAdditionValid_ensures(b.acquired, purchaseRequest.acquired);
    settlement__half_lawHalfValid_ensures(b.acquired);
    settlement__half_lawHalfValid_ensures(after.acquired);
    settlement__money_lawPositiveAddition_ensures(b.acquired, purchaseRequest.acquired);
    settlement__money_lawAddMonotone_ensures(b.acquired, purchaseRequest.acquired);
    settlement__money_lawNumericOrderTotal_ensures(b.acquired, after.acquired);
    settlement__half_lawHalfOrder_ensures(b.acquired, after.acquired);
    var oldHalf := settlement__half_half(b.acquired).quotient;
    var newHalf := settlement__half_half(after.acquired).quotient;
    settlement__money_lawNumericOrderTransitive_ensures(b.burnCommitted, oldHalf, newHalf);
  }
}

lemma finalizeBurn_ensures(b: Buyback, quantity: seq<int>, height: int, finalized: bool)
  ensures (inv(b) ==> canFinalizeBurn(b, quantity, height, finalized) ==> alwaysShareBounded(finalizeBurn(b, quantity, height, finalized)))
  ensures (inv(b) ==> canFinalizeBurn(b, quantity, height, finalized) ==> alwaysBurnBounded(finalizeBurn(b, quantity, height, finalized)))
  ensures (inv(b) ==> canFinalizeBurn(b, quantity, height, finalized) ==> alwaysWindowLimits(finalizeBurn(b, quantity, height, finalized)))
  ensures (inv(b) ==> canFinalizeBurn(b, quantity, height, finalized) ==> alwaysJournalPastAndPositive(finalizeBurn(b, quantity, height, finalized)))
  ensures (inv(b) ==> canFinalizeBurn(b, quantity, height, finalized) ==> alwaysPendingOrderReserved(finalizeBurn(b, quantity, height, finalized)))
  ensures (inv(b) ==> canFinalizeBurn(b, quantity, height, finalized) ==> alwaysLocalShareBounded(finalizeBurn(b, quantity, height, finalized)))
  ensures (inv(b) ==> canFinalizeBurn(b, quantity, height, finalized) ==> stepIncomeMonotonic(b, finalizeBurn(b, quantity, height, finalized)))
{
  if inv(b) && canFinalizeBurn(b, quantity, height, finalized) {
    var after := finalizeBurn(b, quantity, height, finalized);
    UnchangedCumulativeIncome(b, after);
    var due := settlement__money_subtractAmounts(b.burnCommitted, b.burned);
    settlement__money_lawSubtractionValid_ensures(b.burnCommitted, b.burned);
    settlement__money_lawAdditionValid_ensures(b.burned, quantity);
    settlement__money_lawEqualOrder_ensures(quantity, due, b.burnCommitted);
    settlement__money_lawNumericOrderTotal_ensures(b.burnCommitted, b.burned);
    settlement__money_lawSubtractionReconstructs_ensures(b.burnCommitted, b.burned);
    settlement__money_lawAddCongruence_ensures(quantity, due, b.burned);
    settlement__money_lawAddCommutative_ensures(due, b.burned);
    settlement__money_lawEqualSubstitution_ensures(after.burned, settlement__money_addAmounts(due, b.burned), b.burnCommitted);
    settlement__money_lawEqualOrder_ensures(after.burned, b.burnCommitted, b.burnCommitted);
    settlement__money_lawEqualReflexive_ensures(b.burnCommitted);
  }
}

lemma continueCycle_ensures(b: Buyback)
  ensures (inv(b) ==> canContinueCycle(b) ==> alwaysShareBounded(continueCycle(b)))
  ensures (inv(b) ==> canContinueCycle(b) ==> alwaysBurnBounded(continueCycle(b)))
  ensures (inv(b) ==> canContinueCycle(b) ==> alwaysWindowLimits(continueCycle(b)))
  ensures (inv(b) ==> canContinueCycle(b) ==> alwaysJournalPastAndPositive(continueCycle(b)))
  ensures (inv(b) ==> canContinueCycle(b) ==> alwaysPendingOrderReserved(continueCycle(b)))
  ensures (inv(b) ==> canContinueCycle(b) ==> alwaysLocalShareBounded(continueCycle(b)))
  ensures (inv(b) ==> canContinueCycle(b) ==> stepIncomeMonotonic(b, continueCycle(b)))
{
  if inv(b) && canContinueCycle(b) {
    var after := continueCycle(b);
    UnchangedCumulativeIncome(b, after);
  }
}

lemma selectSource_ensures(b: Buyback, robinhood: bool)
  ensures (inv(b) ==> canSelectSource(b, robinhood) ==> alwaysShareBounded(selectSource(b, robinhood)))
  ensures (inv(b) ==> canSelectSource(b, robinhood) ==> alwaysBurnBounded(selectSource(b, robinhood)))
  ensures (inv(b) ==> canSelectSource(b, robinhood) ==> alwaysWindowLimits(selectSource(b, robinhood)))
  ensures (inv(b) ==> canSelectSource(b, robinhood) ==> alwaysJournalPastAndPositive(selectSource(b, robinhood)))
  ensures (inv(b) ==> canSelectSource(b, robinhood) ==> alwaysPendingOrderReserved(selectSource(b, robinhood)))
  ensures (inv(b) ==> canSelectSource(b, robinhood) ==> alwaysLocalShareBounded(selectSource(b, robinhood)))
  ensures (inv(b) ==> canSelectSource(b, robinhood) ==> stepIncomeMonotonic(b, selectSource(b, robinhood)))
{
  if inv(b) && canSelectSource(b, robinhood) {
    var after := selectSource(b, robinhood);
    UnchangedCumulativeIncome(b, after);
  }
}

lemma reserveLocalShare_ensures(b: Buyback, amount: int)
  ensures (inv(b) ==> canReserveLocalShare(b, amount) ==> alwaysShareBounded(reserveLocalShare(b, amount)))
  ensures (inv(b) ==> canReserveLocalShare(b, amount) ==> alwaysBurnBounded(reserveLocalShare(b, amount)))
  ensures (inv(b) ==> canReserveLocalShare(b, amount) ==> alwaysWindowLimits(reserveLocalShare(b, amount)))
  ensures (inv(b) ==> canReserveLocalShare(b, amount) ==> alwaysJournalPastAndPositive(reserveLocalShare(b, amount)))
  ensures (inv(b) ==> canReserveLocalShare(b, amount) ==> alwaysPendingOrderReserved(reserveLocalShare(b, amount)))
  ensures (inv(b) ==> canReserveLocalShare(b, amount) ==> alwaysLocalShareBounded(reserveLocalShare(b, amount)))
  ensures (inv(b) ==> canReserveLocalShare(b, amount) ==> stepIncomeMonotonic(b, reserveLocalShare(b, amount)))
{
  if inv(b) && canReserveLocalShare(b, amount) {
    var after := reserveLocalShare(b, amount);
    UnchangedCumulativeIncome(b, after);
    SmallAmountNonnegativeValid(amount);
    settlement__money_lawAdditionValid_ensures(b.committed, settlement__money_smallAmount(amount));
  }
}

lemma recordIncome_ensures(b: Buyback, receipt: int, incomeAmount: seq<int>, receivedAt: int, finalized: bool)
  ensures (inv(b) ==> canRecordIncome(b, receipt, incomeAmount, receivedAt, finalized) ==> alwaysShareBounded(recordIncome(b, receipt, incomeAmount, receivedAt, finalized)))
  ensures (inv(b) ==> canRecordIncome(b, receipt, incomeAmount, receivedAt, finalized) ==> alwaysBurnBounded(recordIncome(b, receipt, incomeAmount, receivedAt, finalized)))
  ensures (inv(b) ==> canRecordIncome(b, receipt, incomeAmount, receivedAt, finalized) ==> alwaysWindowLimits(recordIncome(b, receipt, incomeAmount, receivedAt, finalized)))
  ensures (inv(b) ==> canRecordIncome(b, receipt, incomeAmount, receivedAt, finalized) ==> alwaysJournalPastAndPositive(recordIncome(b, receipt, incomeAmount, receivedAt, finalized)))
  ensures (inv(b) ==> canRecordIncome(b, receipt, incomeAmount, receivedAt, finalized) ==> alwaysPendingOrderReserved(recordIncome(b, receipt, incomeAmount, receivedAt, finalized)))
  ensures (inv(b) ==> canRecordIncome(b, receipt, incomeAmount, receivedAt, finalized) ==> alwaysLocalShareBounded(recordIncome(b, receipt, incomeAmount, receivedAt, finalized)))
  ensures (inv(b) ==> canRecordIncome(b, receipt, incomeAmount, receivedAt, finalized) ==> stepIncomeMonotonic(b, recordIncome(b, receipt, incomeAmount, receivedAt, finalized)))
{
  if inv(b) && canRecordIncome(b, receipt, incomeAmount, receivedAt, finalized) {
    var after := recordIncome(b, receipt, incomeAmount, receivedAt, finalized);
    settlement__money_lawAdditionValid_ensures(b.income, incomeAmount);
    settlement__money_lawEqualReflexive_ensures(b.acquired);
    settlement__money_lawEqualReflexive_ensures(b.burnCommitted);
    settlement__half_lawHalfValid_ensures(b.income);
    settlement__half_lawHalfValid_ensures(after.income);
    settlement__money_lawPositiveAddition_ensures(b.income, incomeAmount);
    settlement__money_lawAddMonotone_ensures(b.income, incomeAmount);
    settlement__money_lawNumericOrderTotal_ensures(b.income, after.income);
    settlement__half_lawHalfOrder_ensures(b.income, after.income);
    var oldHalf := settlement__half_half(b.income).quotient;
    var newHalf := settlement__half_half(after.income).quotient;
    settlement__money_lawNumericOrderTransitive_ensures(b.committed, oldHalf, newHalf);
  }
}

lemma commitBurn_ensures(b: Buyback, quantity: seq<int>, value: int, destination: string, tokenPaused: bool)
  ensures (inv(b) ==> canCommitBurn(b, quantity, value, destination, tokenPaused) ==> alwaysShareBounded(commitBurn(b, quantity, value, destination, tokenPaused)))
  ensures (inv(b) ==> canCommitBurn(b, quantity, value, destination, tokenPaused) ==> alwaysBurnBounded(commitBurn(b, quantity, value, destination, tokenPaused)))
  ensures (inv(b) ==> canCommitBurn(b, quantity, value, destination, tokenPaused) ==> alwaysWindowLimits(commitBurn(b, quantity, value, destination, tokenPaused)))
  ensures (inv(b) ==> canCommitBurn(b, quantity, value, destination, tokenPaused) ==> alwaysJournalPastAndPositive(commitBurn(b, quantity, value, destination, tokenPaused)))
  ensures (inv(b) ==> canCommitBurn(b, quantity, value, destination, tokenPaused) ==> alwaysPendingOrderReserved(commitBurn(b, quantity, value, destination, tokenPaused)))
  ensures (inv(b) ==> canCommitBurn(b, quantity, value, destination, tokenPaused) ==> alwaysLocalShareBounded(commitBurn(b, quantity, value, destination, tokenPaused)))
  ensures (inv(b) ==> canCommitBurn(b, quantity, value, destination, tokenPaused) ==> stepIncomeMonotonic(b, commitBurn(b, quantity, value, destination, tokenPaused)))
{
  if inv(b) && canCommitBurn(b, quantity, value, destination, tokenPaused) {
    var after := commitBurn(b, quantity, value, destination, tokenPaused);
    settlement__money_lawAdditionValid_ensures(b.burnCommitted, quantity);
    settlement__money_lawEqualReflexive_ensures(b.income);
    settlement__money_lawEqualReflexive_ensures(b.acquired);
    settlement__half_lawHalfValid_ensures(b.acquired);
    settlement__money_lawPositiveAddition_ensures(b.burnCommitted, quantity);
    var half := settlement__half_half(b.acquired).quotient;
    var due := settlement__money_subtractAmounts(half, b.burnCommitted);
    settlement__money_lawSubtractionValid_ensures(half, b.burnCommitted);
    settlement__money_lawNumericOrderTotal_ensures(half, b.burnCommitted);
    settlement__money_lawSubtractionReconstructs_ensures(half, b.burnCommitted);
    settlement__money_lawAddCongruence_ensures(quantity, due, b.burnCommitted);
    settlement__money_lawAddCommutative_ensures(due, b.burnCommitted);
    settlement__money_lawEqualSubstitution_ensures(after.burnCommitted, settlement__money_addAmounts(due, b.burnCommitted), half);
    settlement__money_lawEqualOrder_ensures(after.burnCommitted, half, half);
    settlement__money_lawEqualReflexive_ensures(half);
    settlement__money_lawAddMonotone_ensures(b.burnCommitted, quantity);
    settlement__money_lawNumericOrderTotal_ensures(after.burnCommitted, b.burnCommitted);
    settlement__money_lawNumericOrderTransitive_ensures(b.burned, b.burnCommitted, after.burnCommitted);
  }
}

lemma receiveSlopFee_ensures(b: Buyback, receipt: int, quantity: seq<int>, receivedAt: int, finalized: bool)
  ensures (inv(b) ==> canReceiveSlopFee(b, receipt, quantity, receivedAt, finalized) ==> alwaysShareBounded(receiveSlopFee(b, receipt, quantity, receivedAt, finalized)))
  ensures (inv(b) ==> canReceiveSlopFee(b, receipt, quantity, receivedAt, finalized) ==> alwaysBurnBounded(receiveSlopFee(b, receipt, quantity, receivedAt, finalized)))
  ensures (inv(b) ==> canReceiveSlopFee(b, receipt, quantity, receivedAt, finalized) ==> alwaysWindowLimits(receiveSlopFee(b, receipt, quantity, receivedAt, finalized)))
  ensures (inv(b) ==> canReceiveSlopFee(b, receipt, quantity, receivedAt, finalized) ==> alwaysJournalPastAndPositive(receiveSlopFee(b, receipt, quantity, receivedAt, finalized)))
  ensures (inv(b) ==> canReceiveSlopFee(b, receipt, quantity, receivedAt, finalized) ==> alwaysPendingOrderReserved(receiveSlopFee(b, receipt, quantity, receivedAt, finalized)))
  ensures (inv(b) ==> canReceiveSlopFee(b, receipt, quantity, receivedAt, finalized) ==> alwaysLocalShareBounded(receiveSlopFee(b, receipt, quantity, receivedAt, finalized)))
  ensures (inv(b) ==> canReceiveSlopFee(b, receipt, quantity, receivedAt, finalized) ==> stepIncomeMonotonic(b, receiveSlopFee(b, receipt, quantity, receivedAt, finalized)))
{
  if inv(b) && canReceiveSlopFee(b, receipt, quantity, receivedAt, finalized) {
    var after := receiveSlopFee(b, receipt, quantity, receivedAt, finalized);
    settlement__money_lawAdditionValid_ensures(b.localSlopIncome, quantity);
    settlement__money_lawEqualReflexive_ensures(b.income);
    settlement__money_lawEqualReflexive_ensures(b.burnCommitted);
    settlement__half_lawHalfValid_ensures(b.acquired);
    settlement__half_lawHalfValid_ensures(b.localSlopIncome);
    settlement__half_lawHalfValid_ensures(after.localSlopIncome);
    var share := settlement__money_subtractAmounts(settlement__half_half(after.localSlopIncome).quotient, b.localSlopCommitted);
    settlement__money_lawSubtractionValid_ensures(settlement__half_half(after.localSlopIncome).quotient, b.localSlopCommitted);
    settlement__money_lawAdditionValid_ensures(b.acquired, share);
    settlement__half_lawHalfValid_ensures(after.acquired);
    settlement__money_lawEqualReflexive_ensures(after.localSlopCommitted);
    settlement__money_lawPositiveAddition_ensures(b.localSlopIncome, quantity);
    settlement__money_lawPositiveAddition_ensures(b.acquired, share);
    settlement__money_lawAddMonotone_ensures(b.acquired, share);
    settlement__money_lawNumericOrderTotal_ensures(b.acquired, after.acquired);
    settlement__half_lawHalfOrder_ensures(b.localSlopIncome, after.localSlopIncome);
    settlement__half_lawHalfOrder_ensures(b.acquired, after.acquired);
    settlement__money_lawAddMonotone_ensures(b.localSlopIncome, quantity);
    var oldHalf := settlement__half_half(b.acquired).quotient;
    var newHalf := settlement__half_half(after.acquired).quotient;
    settlement__money_lawNumericOrderTransitive_ensures(b.burnCommitted, oldHalf, newHalf);
  }
}
