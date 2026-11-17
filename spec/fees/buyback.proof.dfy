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

// Unchanged cumulative totals satisfy the monotonic step rule.
lemma UnchangedCumulative(before: Buyback, after: Buyback)
  requires after.income == before.income
  ensures stepIncomeMonotonic(before, after)
{
  settlement__money_lawEqualReflexive_ensures(before.income);
}

// Advancing the clock can only expire entries from the rolling window.
lemma WindowErasesOnly(xs: seq<Spend>, from: int, through: int, prior: int, updated: int)
  requires from <= through && updated <= prior
  requires forall x :: x in xs ==> x.at <= from && x.amount > 0
  ensures Std.Collections.Seq.FoldLeft((total: int, spend: Spend) => (total + (if ((!(spend.released) && (spend.at > (through - dayMs))) && (spend.at <= through)) then spend.amount else 0)), updated, xs) <=
    Std.Collections.Seq.FoldLeft((total: int, spend: Spend) => (total + (if ((!(spend.released) && (spend.at > (from - dayMs))) && (spend.at <= from)) then spend.amount else 0)), prior, xs)
  decreases |xs|
{
  if |xs| > 0 {
    var x := xs[0];
    assert x in xs;
    assert forall y :: y in xs[1..] ==> y in xs;
    WindowErasesOnly(xs[1..], from, through,
      prior + (if !x.released && x.at > from - dayMs && x.at <= from then x.amount else 0),
      updated + (if !x.released && x.at > through - dayMs && x.at <= through then x.amount else 0));
  }
}

lemma WindowAfter(xs: seq<Spend>, from: int, through: int)
  requires from <= through
  requires forall x :: x in xs ==> x.at <= from && x.amount > 0
  ensures unreleased(xs, through) <= unreleased(xs, from)
{
  WindowErasesOnly(xs, from, through, 0, 0);
}

lemma WindowAppendsNow(xs: seq<Spend>, now: int, s: Spend)
  requires s.at == now && !s.released
  ensures unreleased(xs + [s], now) == unreleased(xs, now) + s.amount
{
  ProofLib.FoldLeftAppend((total: int, spend: Spend) => (total + (if ((!(spend.released) && (spend.at > (now - dayMs))) && (spend.at <= now)) then spend.amount else 0)), 0, xs, s);
}

// Releasing entries never increases the window.
lemma WindowReleaseLowers(xs: seq<Spend>, id: int, now: int, prior: int, updated: int)
  requires updated <= prior
  requires forall x :: x in xs ==> x.amount >= 0
  ensures Std.Collections.Seq.FoldLeft((total: int, spend: Spend) => (total + (if ((!(spend.released) && (spend.at > (now - dayMs))) && (spend.at <= now)) then spend.amount else 0)), updated, release(xs, id)) <=
    Std.Collections.Seq.FoldLeft((total: int, spend: Spend) => (total + (if ((!(spend.released) && (spend.at > (now - dayMs))) && (spend.at <= now)) then spend.amount else 0)), prior, xs)
  decreases |xs|
{
  if |xs| > 0 {
    var x := xs[0];
    var r := release(xs, id);
    assert r[0] == (if x.id == id then x.(released := true) else x);
    assert r[1..] == release(xs[1..], id);
    assert x in xs;
    assert forall y :: y in xs[1..] ==> y in xs;
    WindowReleaseLowers(xs[1..], id, now,
      prior + (if !x.released && x.at > now - dayMs && x.at <= now then x.amount else 0),
      updated + (if !r[0].released && r[0].at > now - dayMs && r[0].at <= now then r[0].amount else 0));
  }
}

lemma WindowRelease(xs: seq<Spend>, id: int, now: int)
  requires forall x :: x in xs ==> x.amount >= 0
  ensures unreleased(release(xs, id), now) <= unreleased(xs, now)
  ensures forall s :: s in release(xs, id) ==> exists x :: x in xs && x.at == s.at && x.amount == s.amount
{
  WindowReleaseLowers(xs, id, now, 0, 0);
  forall s | s in release(xs, id)
    ensures exists x :: x in xs && x.at == s.at && x.amount == s.amount
  {
    var i :| 0 <= i < |release(xs, id)| && release(xs, id)[i] == s;
    assert xs[i] in xs;
  }
}

lemma DayMonotone(a: int, b: int)
  requires 0 <= a <= b
  ensures quotient_fees__buyback(a, dayMs) == a / dayMs
  ensures quotient_fees__buyback(b, dayMs) == b / dayMs
  ensures a / dayMs <= b / dayMs
{
}

// Advancing the clock keeps only entries of the same UTC day.
lemma DayErasesOnly(xs: seq<Spend>, from: int, through: int, prior: int, updated: int)
  requires 0 <= from <= through && updated <= prior
  requires forall x :: x in xs ==> 0 <= x.at <= from && x.amount > 0
  ensures Std.Collections.Seq.FoldLeft((total: int, spend: Spend) => (total + (if (!(spend.released) && (quotient_fees__buyback(spend.at, dayMs) == quotient_fees__buyback(through, dayMs))) then spend.amount else 0)), updated, xs) <=
    Std.Collections.Seq.FoldLeft((total: int, spend: Spend) => (total + (if (!(spend.released) && (quotient_fees__buyback(spend.at, dayMs) == quotient_fees__buyback(from, dayMs))) then spend.amount else 0)), prior, xs)
  decreases |xs|
{
  if |xs| > 0 {
    var x := xs[0];
    assert x in xs;
    assert forall y :: y in xs[1..] ==> y in xs;
    DayMonotone(x.at, from);
    DayMonotone(from, through);
    DayErasesOnly(xs[1..], from, through,
      prior + (if !x.released && quotient_fees__buyback(x.at, dayMs) == quotient_fees__buyback(from, dayMs) then x.amount else 0),
      updated + (if !x.released && quotient_fees__buyback(x.at, dayMs) == quotient_fees__buyback(through, dayMs) then x.amount else 0));
  }
}

lemma DayAfter(xs: seq<Spend>, from: int, through: int)
  requires 0 <= from <= through
  requires forall x :: x in xs ==> 0 <= x.at <= from && x.amount > 0
  ensures nativeToday(xs, through) <= nativeToday(xs, from)
{
  DayErasesOnly(xs, from, through, 0, 0);
}

lemma DayAppendsNow(xs: seq<Spend>, now: int, s: Spend)
  requires s.at == now && !s.released
  ensures nativeToday(xs + [s], now) == nativeToday(xs, now) + s.amount
{
  ProofLib.FoldLeftAppend((total: int, spend: Spend) => (total + (if (!(spend.released) && (quotient_fees__buyback(spend.at, dayMs) == quotient_fees__buyback(now, dayMs))) then spend.amount else 0)), 0, xs, s);
}

lemma DayReleaseLowers(xs: seq<Spend>, id: int, now: int, prior: int, updated: int)
  requires updated <= prior
  requires forall x :: x in xs ==> x.amount >= 0
  ensures Std.Collections.Seq.FoldLeft((total: int, spend: Spend) => (total + (if (!(spend.released) && (quotient_fees__buyback(spend.at, dayMs) == quotient_fees__buyback(now, dayMs))) then spend.amount else 0)), updated, release(xs, id)) <=
    Std.Collections.Seq.FoldLeft((total: int, spend: Spend) => (total + (if (!(spend.released) && (quotient_fees__buyback(spend.at, dayMs) == quotient_fees__buyback(now, dayMs))) then spend.amount else 0)), prior, xs)
  decreases |xs|
{
  if |xs| > 0 {
    var x := xs[0];
    var r := release(xs, id);
    assert r[0] == (if x.id == id then x.(released := true) else x);
    assert r[1..] == release(xs[1..], id);
    assert x in xs;
    assert forall y :: y in xs[1..] ==> y in xs;
    DayReleaseLowers(xs[1..], id, now,
      prior + (if !x.released && quotient_fees__buyback(x.at, dayMs) == quotient_fees__buyback(now, dayMs) then x.amount else 0),
      updated + (if !r[0].released && quotient_fees__buyback(r[0].at, dayMs) == quotient_fees__buyback(now, dayMs) then r[0].amount else 0));
  }
}

lemma DayRelease(xs: seq<Spend>, id: int, now: int)
  requires forall x :: x in xs ==> x.amount >= 0
  ensures nativeToday(release(xs, id), now) <= nativeToday(xs, now)
{
  DayReleaseLowers(xs, id, now, 0, 0);
}

// Committed share stays below half of a larger income.
lemma ShareUnderLargerIncome(committed: seq<int>, income: seq<int>, larger: seq<int>)
  requires settlement__money_validAmount(committed) && settlement__money_validAmount(income) && settlement__money_validAmount(larger)
  requires settlement__money_compareAmounts(committed, settlement__half_half(income).quotient) <= 0
  requires settlement__money_compareAmounts(income, larger) <= 0
  ensures settlement__money_compareAmounts(committed, settlement__half_half(larger).quotient) <= 0
{
  settlement__half_lawHalfValid_ensures(income);
  settlement__half_lawHalfValid_ensures(larger);
  settlement__half_lawHalfOrder_ensures(income, larger);
  settlement__money_lawNumericOrderTransitive_ensures(committed, settlement__half_half(income).quotient, settlement__half_half(larger).quotient);
}

// Adding a valid amount never decreases a valid amount.
lemma Grows(a: seq<int>, b: seq<int>)
  requires settlement__money_validAmount(a) && settlement__money_validAmount(b)
  ensures settlement__money_validAmount(settlement__money_addAmounts(a, b))
  ensures settlement__money_compareAmounts(a, settlement__money_addAmounts(a, b)) <= 0
  ensures settlement__money_compareAmounts(settlement__money_addAmounts(a, b), a) >= 0
{
  settlement__money_lawAdditionValid_ensures(a, b);
  settlement__money_lawAddMonotone_ensures(a, b);
  settlement__money_lawNumericOrderTotal_ensures(a, settlement__money_addAmounts(a, b));
}

// Subtracting a smaller amount yields a valid amount no larger than the original.
lemma Shrinks(a: seq<int>, b: seq<int>)
  requires settlement__money_validAmount(a) && settlement__money_validAmount(b)
  requires settlement__money_compareAmounts(a, b) >= 0
  ensures settlement__money_validAmount(settlement__money_subtractAmounts(a, b))
  ensures settlement__money_compareAmounts(settlement__money_subtractAmounts(a, b), a) <= 0
{
  settlement__money_lawSubtractionValid_ensures(a, b);
  settlement__money_lawSubtractionAtMost_ensures(a, b);
}

// A larger acquisition has a half no smaller than before.
lemma selectSource_ensures(b: Buyback, sourceNetwork: fees__runtime_Network)
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork) ==> alwaysSourcesOnce(selectSource(b, sourceNetwork)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork) ==> alwaysRuntimeSound(selectSource(b, sourceNetwork)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork) ==> alwaysShareBounded(selectSource(b, sourceNetwork)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork) ==> alwaysWindowLimits(selectSource(b, sourceNetwork)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork) ==> alwaysJournalPastAndPositive(selectSource(b, sourceNetwork)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork) ==> alwaysPendingOrderReserved(selectSource(b, sourceNetwork)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork) ==> alwaysPoolNonNegative(selectSource(b, sourceNetwork)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork) ==> alwaysLocalShareBounded(selectSource(b, sourceNetwork)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork) ==> alwaysSourceLegsOnly(selectSource(b, sourceNetwork)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork) ==> alwaysBurnBounded(selectSource(b, sourceNetwork)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork) ==> stepNewSourceUnseen(b, selectSource(b, sourceNetwork)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork) ==> stepOrderOutcomeOnce(b, selectSource(b, sourceNetwork)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork) ==> stepIncomeMonotonic(b, selectSource(b, sourceNetwork)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork) ==> stepJournalRetained(b, selectSource(b, sourceNetwork)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork) ==> stepSignaturesNeedLiveBuyback(b, "selectSource", selectSource(b, sourceNetwork)))
{
  if inv(b) && canSelectSource(b, sourceNetwork) {
    var after := selectSource(b, sourceNetwork);
    UnchangedCumulative(b, after);
  }
}

lemma advanceClock_ensures(b: Buyback, now: int)
  ensures (inv(b) ==> canAdvanceClock(b, now) ==> alwaysSourcesOnce(advanceClock(b, now)))
  ensures (inv(b) ==> canAdvanceClock(b, now) ==> alwaysRuntimeSound(advanceClock(b, now)))
  ensures (inv(b) ==> canAdvanceClock(b, now) ==> alwaysShareBounded(advanceClock(b, now)))
  ensures (inv(b) ==> canAdvanceClock(b, now) ==> alwaysWindowLimits(advanceClock(b, now)))
  ensures (inv(b) ==> canAdvanceClock(b, now) ==> alwaysJournalPastAndPositive(advanceClock(b, now)))
  ensures (inv(b) ==> canAdvanceClock(b, now) ==> alwaysPendingOrderReserved(advanceClock(b, now)))
  ensures (inv(b) ==> canAdvanceClock(b, now) ==> alwaysPoolNonNegative(advanceClock(b, now)))
  ensures (inv(b) ==> canAdvanceClock(b, now) ==> alwaysLocalShareBounded(advanceClock(b, now)))
  ensures (inv(b) ==> canAdvanceClock(b, now) ==> alwaysSourceLegsOnly(advanceClock(b, now)))
  ensures (inv(b) ==> canAdvanceClock(b, now) ==> alwaysBurnBounded(advanceClock(b, now)))
  ensures (inv(b) ==> canAdvanceClock(b, now) ==> stepNewSourceUnseen(b, advanceClock(b, now)))
  ensures (inv(b) ==> canAdvanceClock(b, now) ==> stepOrderOutcomeOnce(b, advanceClock(b, now)))
  ensures (inv(b) ==> canAdvanceClock(b, now) ==> stepIncomeMonotonic(b, advanceClock(b, now)))
  ensures (inv(b) ==> canAdvanceClock(b, now) ==> stepJournalRetained(b, advanceClock(b, now)))
  ensures (inv(b) ==> canAdvanceClock(b, now) ==> stepSignaturesNeedLiveBuyback(b, "advanceClock", advanceClock(b, now)))
{
  if inv(b) && canAdvanceClock(b, now) {
    var after := advanceClock(b, now);
    UnchangedCumulative(b, after);
    WindowAfter(b.bridgeSpends, b.clock, now);
    DayAfter(b.bridgeNative, b.clock, now);
  }
}

lemma recordIncome_ensures(b: Buyback, key: IncomeKey, incomeAmount: seq<int>, chainTime: int)
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime) ==> alwaysSourcesOnce(recordIncome(b, key, incomeAmount, chainTime)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime) ==> alwaysRuntimeSound(recordIncome(b, key, incomeAmount, chainTime)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime) ==> alwaysShareBounded(recordIncome(b, key, incomeAmount, chainTime)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime) ==> alwaysWindowLimits(recordIncome(b, key, incomeAmount, chainTime)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime) ==> alwaysJournalPastAndPositive(recordIncome(b, key, incomeAmount, chainTime)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime) ==> alwaysPendingOrderReserved(recordIncome(b, key, incomeAmount, chainTime)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime) ==> alwaysPoolNonNegative(recordIncome(b, key, incomeAmount, chainTime)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime) ==> alwaysLocalShareBounded(recordIncome(b, key, incomeAmount, chainTime)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime) ==> alwaysSourceLegsOnly(recordIncome(b, key, incomeAmount, chainTime)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime) ==> alwaysBurnBounded(recordIncome(b, key, incomeAmount, chainTime)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime) ==> stepNewSourceUnseen(b, recordIncome(b, key, incomeAmount, chainTime)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime) ==> stepOrderOutcomeOnce(b, recordIncome(b, key, incomeAmount, chainTime)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime) ==> stepIncomeMonotonic(b, recordIncome(b, key, incomeAmount, chainTime)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime) ==> stepJournalRetained(b, recordIncome(b, key, incomeAmount, chainTime)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime) ==> stepSignaturesNeedLiveBuyback(b, "recordIncome", recordIncome(b, key, incomeAmount, chainTime)))
{
  if inv(b) && canRecordIncome(b, key, incomeAmount, chainTime) {
    var after := recordIncome(b, key, incomeAmount, chainTime);
    Grows(b.income, incomeAmount);
    ShareUnderLargerIncome(b.committed, b.income, after.income);
  }
}

lemma publishWorker_ensures(b: Buyback, config: fees__runtime_WorkerConfig, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysSourcesOnce(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysRuntimeSound(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysShareBounded(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysWindowLimits(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysJournalPastAndPositive(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysPendingOrderReserved(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysPoolNonNegative(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysLocalShareBounded(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysSourceLegsOnly(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysBurnBounded(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> stepNewSourceUnseen(b, publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> stepOrderOutcomeOnce(b, publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> stepIncomeMonotonic(b, publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> stepJournalRetained(b, publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> stepSignaturesNeedLiveBuyback(b, "publishWorker", publishWorker(b, config, by_)))
{
  if inv(b) && canPublishWorker(b, config, by_) {
    var after := publishWorker(b, config, by_);
    UnchangedCumulative(b, after);
  }
}

lemma setReleaseVariable_ensures(b: Buyback, variable: bool, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysSourcesOnce(setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysRuntimeSound(setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysShareBounded(setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysWindowLimits(setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysJournalPastAndPositive(setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysPendingOrderReserved(setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysPoolNonNegative(setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysLocalShareBounded(setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysSourceLegsOnly(setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysBurnBounded(setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> stepNewSourceUnseen(b, setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> stepOrderOutcomeOnce(b, setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> stepIncomeMonotonic(b, setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> stepJournalRetained(b, setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> stepSignaturesNeedLiveBuyback(b, "setReleaseVariable", setReleaseVariable(b, variable, by_)))
{
  if inv(b) && canSetReleaseVariable(b, variable, by_) {
    var after := setReleaseVariable(b, variable, by_);
    UnchangedCumulative(b, after);
  }
}

lemma verifyReadiness_ensures(b: Buyback, readyNetwork: fees__runtime_Network, listedWallet: int, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, listedWallet, by_) ==> alwaysSourcesOnce(verifyReadiness(b, readyNetwork, listedWallet, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, listedWallet, by_) ==> alwaysRuntimeSound(verifyReadiness(b, readyNetwork, listedWallet, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, listedWallet, by_) ==> alwaysShareBounded(verifyReadiness(b, readyNetwork, listedWallet, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, listedWallet, by_) ==> alwaysWindowLimits(verifyReadiness(b, readyNetwork, listedWallet, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, listedWallet, by_) ==> alwaysJournalPastAndPositive(verifyReadiness(b, readyNetwork, listedWallet, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, listedWallet, by_) ==> alwaysPendingOrderReserved(verifyReadiness(b, readyNetwork, listedWallet, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, listedWallet, by_) ==> alwaysPoolNonNegative(verifyReadiness(b, readyNetwork, listedWallet, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, listedWallet, by_) ==> alwaysLocalShareBounded(verifyReadiness(b, readyNetwork, listedWallet, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, listedWallet, by_) ==> alwaysSourceLegsOnly(verifyReadiness(b, readyNetwork, listedWallet, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, listedWallet, by_) ==> alwaysBurnBounded(verifyReadiness(b, readyNetwork, listedWallet, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, listedWallet, by_) ==> stepNewSourceUnseen(b, verifyReadiness(b, readyNetwork, listedWallet, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, listedWallet, by_) ==> stepOrderOutcomeOnce(b, verifyReadiness(b, readyNetwork, listedWallet, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, listedWallet, by_) ==> stepIncomeMonotonic(b, verifyReadiness(b, readyNetwork, listedWallet, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, listedWallet, by_) ==> stepJournalRetained(b, verifyReadiness(b, readyNetwork, listedWallet, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, listedWallet, by_) ==> stepSignaturesNeedLiveBuyback(b, "verifyReadiness", verifyReadiness(b, readyNetwork, listedWallet, by_)))
{
  if inv(b) && canVerifyReadiness(b, readyNetwork, listedWallet, by_) {
    var after := verifyReadiness(b, readyNetwork, listedWallet, by_);
    UnchangedCumulative(b, after);
  }
}

lemma approveOrder_ensures(b: Buyback, request: BridgeOrder)
  ensures (inv(b) ==> canApproveOrder(b, request) ==> alwaysSourcesOnce(approveOrder(b, request)))
  ensures (inv(b) ==> canApproveOrder(b, request) ==> alwaysRuntimeSound(approveOrder(b, request)))
  ensures (inv(b) ==> canApproveOrder(b, request) ==> alwaysShareBounded(approveOrder(b, request)))
  ensures (inv(b) ==> canApproveOrder(b, request) ==> alwaysWindowLimits(approveOrder(b, request)))
  ensures (inv(b) ==> canApproveOrder(b, request) ==> alwaysJournalPastAndPositive(approveOrder(b, request)))
  ensures (inv(b) ==> canApproveOrder(b, request) ==> alwaysPendingOrderReserved(approveOrder(b, request)))
  ensures (inv(b) ==> canApproveOrder(b, request) ==> alwaysPoolNonNegative(approveOrder(b, request)))
  ensures (inv(b) ==> canApproveOrder(b, request) ==> alwaysLocalShareBounded(approveOrder(b, request)))
  ensures (inv(b) ==> canApproveOrder(b, request) ==> alwaysSourceLegsOnly(approveOrder(b, request)))
  ensures (inv(b) ==> canApproveOrder(b, request) ==> alwaysBurnBounded(approveOrder(b, request)))
  ensures (inv(b) ==> canApproveOrder(b, request) ==> stepNewSourceUnseen(b, approveOrder(b, request)))
  ensures (inv(b) ==> canApproveOrder(b, request) ==> stepOrderOutcomeOnce(b, approveOrder(b, request)))
  ensures (inv(b) ==> canApproveOrder(b, request) ==> stepIncomeMonotonic(b, approveOrder(b, request)))
  ensures (inv(b) ==> canApproveOrder(b, request) ==> stepJournalRetained(b, approveOrder(b, request)))
  ensures (inv(b) ==> canApproveOrder(b, request) ==> stepSignaturesNeedLiveBuyback(b, "approveOrder", approveOrder(b, request)))
{
  if inv(b) && canApproveOrder(b, request) {
    var after := approveOrder(b, request);
    UnchangedCumulative(b, after);
  }
}

lemma settleApproval_ensures(b: Buyback, receipt: SendReceipt)
  ensures (inv(b) ==> canSettleApproval(b, receipt) ==> alwaysSourcesOnce(settleApproval(b, receipt)))
  ensures (inv(b) ==> canSettleApproval(b, receipt) ==> alwaysRuntimeSound(settleApproval(b, receipt)))
  ensures (inv(b) ==> canSettleApproval(b, receipt) ==> alwaysShareBounded(settleApproval(b, receipt)))
  ensures (inv(b) ==> canSettleApproval(b, receipt) ==> alwaysWindowLimits(settleApproval(b, receipt)))
  ensures (inv(b) ==> canSettleApproval(b, receipt) ==> alwaysJournalPastAndPositive(settleApproval(b, receipt)))
  ensures (inv(b) ==> canSettleApproval(b, receipt) ==> alwaysPendingOrderReserved(settleApproval(b, receipt)))
  ensures (inv(b) ==> canSettleApproval(b, receipt) ==> alwaysPoolNonNegative(settleApproval(b, receipt)))
  ensures (inv(b) ==> canSettleApproval(b, receipt) ==> alwaysLocalShareBounded(settleApproval(b, receipt)))
  ensures (inv(b) ==> canSettleApproval(b, receipt) ==> alwaysSourceLegsOnly(settleApproval(b, receipt)))
  ensures (inv(b) ==> canSettleApproval(b, receipt) ==> alwaysBurnBounded(settleApproval(b, receipt)))
  ensures (inv(b) ==> canSettleApproval(b, receipt) ==> stepNewSourceUnseen(b, settleApproval(b, receipt)))
  ensures (inv(b) ==> canSettleApproval(b, receipt) ==> stepOrderOutcomeOnce(b, settleApproval(b, receipt)))
  ensures (inv(b) ==> canSettleApproval(b, receipt) ==> stepIncomeMonotonic(b, settleApproval(b, receipt)))
  ensures (inv(b) ==> canSettleApproval(b, receipt) ==> stepJournalRetained(b, settleApproval(b, receipt)))
  ensures (inv(b) ==> canSettleApproval(b, receipt) ==> stepSignaturesNeedLiveBuyback(b, "settleApproval", settleApproval(b, receipt)))
{
  if inv(b) && canSettleApproval(b, receipt) {
    var after := settleApproval(b, receipt);
    UnchangedCumulative(b, after);
  }
}

lemma order_ensures(b: Buyback, request: BridgeOrder)
  ensures (inv(b) ==> canOrder(b, request) ==> alwaysSourcesOnce(order(b, request)))
  ensures (inv(b) ==> canOrder(b, request) ==> alwaysRuntimeSound(order(b, request)))
  ensures (inv(b) ==> canOrder(b, request) ==> alwaysShareBounded(order(b, request)))
  ensures (inv(b) ==> canOrder(b, request) ==> alwaysWindowLimits(order(b, request)))
  ensures (inv(b) ==> canOrder(b, request) ==> alwaysJournalPastAndPositive(order(b, request)))
  ensures (inv(b) ==> canOrder(b, request) ==> alwaysPendingOrderReserved(order(b, request)))
  ensures (inv(b) ==> canOrder(b, request) ==> alwaysPoolNonNegative(order(b, request)))
  ensures (inv(b) ==> canOrder(b, request) ==> alwaysLocalShareBounded(order(b, request)))
  ensures (inv(b) ==> canOrder(b, request) ==> alwaysSourceLegsOnly(order(b, request)))
  ensures (inv(b) ==> canOrder(b, request) ==> alwaysBurnBounded(order(b, request)))
  ensures (inv(b) ==> canOrder(b, request) ==> stepNewSourceUnseen(b, order(b, request)))
  ensures (inv(b) ==> canOrder(b, request) ==> stepOrderOutcomeOnce(b, order(b, request)))
  ensures (inv(b) ==> canOrder(b, request) ==> stepIncomeMonotonic(b, order(b, request)))
  ensures (inv(b) ==> canOrder(b, request) ==> stepJournalRetained(b, order(b, request)))
  ensures (inv(b) ==> canOrder(b, request) ==> stepSignaturesNeedLiveBuyback(b, "order", order(b, request)))
{
  if inv(b) && canOrder(b, request) {
    var after := order(b, request);
    UnchangedCumulative(b, after);
    SmallAmountNonnegativeValid(request.amount);
    Grows(b.committed, settlement__money_smallAmount(request.amount));
    settlement__half_lawHalfValid_ensures(b.income);
    settlement__money_lawAddCommutative_ensures(b.committed, settlement__money_smallAmount(request.amount));
    settlement__money_lawAddMonotone_ensures(settlement__money_smallAmount(request.amount), b.committed);
    WindowAppendsNow(b.bridgeSpends, b.clock, Spend(request.orderId, b.clock, request.amount, false));
    DayAppendsNow(b.bridgeNative, b.clock, Spend(request.orderId, b.clock, request.nativeFee, false));
  }
}

lemma loseSend_ensures(b: Buyback, tx: int)
  ensures (inv(b) ==> canLoseSend(b, tx) ==> alwaysSourcesOnce(loseSend(b, tx)))
  ensures (inv(b) ==> canLoseSend(b, tx) ==> alwaysRuntimeSound(loseSend(b, tx)))
  ensures (inv(b) ==> canLoseSend(b, tx) ==> alwaysShareBounded(loseSend(b, tx)))
  ensures (inv(b) ==> canLoseSend(b, tx) ==> alwaysWindowLimits(loseSend(b, tx)))
  ensures (inv(b) ==> canLoseSend(b, tx) ==> alwaysJournalPastAndPositive(loseSend(b, tx)))
  ensures (inv(b) ==> canLoseSend(b, tx) ==> alwaysPendingOrderReserved(loseSend(b, tx)))
  ensures (inv(b) ==> canLoseSend(b, tx) ==> alwaysPoolNonNegative(loseSend(b, tx)))
  ensures (inv(b) ==> canLoseSend(b, tx) ==> alwaysLocalShareBounded(loseSend(b, tx)))
  ensures (inv(b) ==> canLoseSend(b, tx) ==> alwaysSourceLegsOnly(loseSend(b, tx)))
  ensures (inv(b) ==> canLoseSend(b, tx) ==> alwaysBurnBounded(loseSend(b, tx)))
  ensures (inv(b) ==> canLoseSend(b, tx) ==> stepNewSourceUnseen(b, loseSend(b, tx)))
  ensures (inv(b) ==> canLoseSend(b, tx) ==> stepOrderOutcomeOnce(b, loseSend(b, tx)))
  ensures (inv(b) ==> canLoseSend(b, tx) ==> stepIncomeMonotonic(b, loseSend(b, tx)))
  ensures (inv(b) ==> canLoseSend(b, tx) ==> stepJournalRetained(b, loseSend(b, tx)))
  ensures (inv(b) ==> canLoseSend(b, tx) ==> stepSignaturesNeedLiveBuyback(b, "loseSend", loseSend(b, tx)))
{
  if inv(b) && canLoseSend(b, tx) {
    var after := loseSend(b, tx);
    UnchangedCumulative(b, after);
  }
}

lemma settleOrder_ensures(b: Buyback, receipt: SendReceipt)
  ensures (inv(b) ==> canSettleOrder(b, receipt) ==> alwaysSourcesOnce(settleOrder(b, receipt)))
  ensures (inv(b) ==> canSettleOrder(b, receipt) ==> alwaysRuntimeSound(settleOrder(b, receipt)))
  ensures (inv(b) ==> canSettleOrder(b, receipt) ==> alwaysShareBounded(settleOrder(b, receipt)))
  ensures (inv(b) ==> canSettleOrder(b, receipt) ==> alwaysWindowLimits(settleOrder(b, receipt)))
  ensures (inv(b) ==> canSettleOrder(b, receipt) ==> alwaysJournalPastAndPositive(settleOrder(b, receipt)))
  ensures (inv(b) ==> canSettleOrder(b, receipt) ==> alwaysPendingOrderReserved(settleOrder(b, receipt)))
  ensures (inv(b) ==> canSettleOrder(b, receipt) ==> alwaysPoolNonNegative(settleOrder(b, receipt)))
  ensures (inv(b) ==> canSettleOrder(b, receipt) ==> alwaysLocalShareBounded(settleOrder(b, receipt)))
  ensures (inv(b) ==> canSettleOrder(b, receipt) ==> alwaysSourceLegsOnly(settleOrder(b, receipt)))
  ensures (inv(b) ==> canSettleOrder(b, receipt) ==> alwaysBurnBounded(settleOrder(b, receipt)))
  ensures (inv(b) ==> canSettleOrder(b, receipt) ==> stepNewSourceUnseen(b, settleOrder(b, receipt)))
  ensures (inv(b) ==> canSettleOrder(b, receipt) ==> stepOrderOutcomeOnce(b, settleOrder(b, receipt)))
  ensures (inv(b) ==> canSettleOrder(b, receipt) ==> stepIncomeMonotonic(b, settleOrder(b, receipt)))
  ensures (inv(b) ==> canSettleOrder(b, receipt) ==> stepJournalRetained(b, settleOrder(b, receipt)))
  ensures (inv(b) ==> canSettleOrder(b, receipt) ==> stepSignaturesNeedLiveBuyback(b, "settleOrder", settleOrder(b, receipt)))
{
  if inv(b) && canSettleOrder(b, receipt) {
    var after := settleOrder(b, receipt);
    UnchangedCumulative(b, after);
    SmallAmountNonnegativeValid(b.orderAmount);
    settlement__half_lawHalfValid_ensures(b.income);
    if !receipt.succeeded {
      Shrinks(b.committed, settlement__money_smallAmount(b.orderAmount));
      settlement__money_lawNumericOrderTransitive_ensures(after.committed, b.committed, settlement__half_half(b.income).quotient);
      WindowRelease(b.bridgeSpends, b.order, b.clock);
      DayRelease(b.bridgeNative, b.order, b.clock);
      WindowRelease(b.bridgeNative, b.order, b.clock);
    }
  }
}

lemma observeArrival_ensures(b: Buyback, arrival: ArrivalEvidence)
  ensures (inv(b) ==> canObserveArrival(b, arrival) ==> alwaysSourcesOnce(observeArrival(b, arrival)))
  ensures (inv(b) ==> canObserveArrival(b, arrival) ==> alwaysRuntimeSound(observeArrival(b, arrival)))
  ensures (inv(b) ==> canObserveArrival(b, arrival) ==> alwaysShareBounded(observeArrival(b, arrival)))
  ensures (inv(b) ==> canObserveArrival(b, arrival) ==> alwaysWindowLimits(observeArrival(b, arrival)))
  ensures (inv(b) ==> canObserveArrival(b, arrival) ==> alwaysJournalPastAndPositive(observeArrival(b, arrival)))
  ensures (inv(b) ==> canObserveArrival(b, arrival) ==> alwaysPendingOrderReserved(observeArrival(b, arrival)))
  ensures (inv(b) ==> canObserveArrival(b, arrival) ==> alwaysPoolNonNegative(observeArrival(b, arrival)))
  ensures (inv(b) ==> canObserveArrival(b, arrival) ==> alwaysLocalShareBounded(observeArrival(b, arrival)))
  ensures (inv(b) ==> canObserveArrival(b, arrival) ==> alwaysSourceLegsOnly(observeArrival(b, arrival)))
  ensures (inv(b) ==> canObserveArrival(b, arrival) ==> alwaysBurnBounded(observeArrival(b, arrival)))
  ensures (inv(b) ==> canObserveArrival(b, arrival) ==> stepNewSourceUnseen(b, observeArrival(b, arrival)))
  ensures (inv(b) ==> canObserveArrival(b, arrival) ==> stepOrderOutcomeOnce(b, observeArrival(b, arrival)))
  ensures (inv(b) ==> canObserveArrival(b, arrival) ==> stepIncomeMonotonic(b, observeArrival(b, arrival)))
  ensures (inv(b) ==> canObserveArrival(b, arrival) ==> stepJournalRetained(b, observeArrival(b, arrival)))
  ensures (inv(b) ==> canObserveArrival(b, arrival) ==> stepSignaturesNeedLiveBuyback(b, "observeArrival", observeArrival(b, arrival)))
{
  if inv(b) && canObserveArrival(b, arrival) {
    var after := observeArrival(b, arrival);
    UnchangedCumulative(b, after);
  }
}

lemma observeCancelling_ensures(b: Buyback, order: int)
  ensures (inv(b) ==> canObserveCancelling(b, order) ==> alwaysSourcesOnce(observeCancelling(b, order)))
  ensures (inv(b) ==> canObserveCancelling(b, order) ==> alwaysRuntimeSound(observeCancelling(b, order)))
  ensures (inv(b) ==> canObserveCancelling(b, order) ==> alwaysShareBounded(observeCancelling(b, order)))
  ensures (inv(b) ==> canObserveCancelling(b, order) ==> alwaysWindowLimits(observeCancelling(b, order)))
  ensures (inv(b) ==> canObserveCancelling(b, order) ==> alwaysJournalPastAndPositive(observeCancelling(b, order)))
  ensures (inv(b) ==> canObserveCancelling(b, order) ==> alwaysPendingOrderReserved(observeCancelling(b, order)))
  ensures (inv(b) ==> canObserveCancelling(b, order) ==> alwaysPoolNonNegative(observeCancelling(b, order)))
  ensures (inv(b) ==> canObserveCancelling(b, order) ==> alwaysLocalShareBounded(observeCancelling(b, order)))
  ensures (inv(b) ==> canObserveCancelling(b, order) ==> alwaysSourceLegsOnly(observeCancelling(b, order)))
  ensures (inv(b) ==> canObserveCancelling(b, order) ==> alwaysBurnBounded(observeCancelling(b, order)))
  ensures (inv(b) ==> canObserveCancelling(b, order) ==> stepNewSourceUnseen(b, observeCancelling(b, order)))
  ensures (inv(b) ==> canObserveCancelling(b, order) ==> stepOrderOutcomeOnce(b, observeCancelling(b, order)))
  ensures (inv(b) ==> canObserveCancelling(b, order) ==> stepIncomeMonotonic(b, observeCancelling(b, order)))
  ensures (inv(b) ==> canObserveCancelling(b, order) ==> stepJournalRetained(b, observeCancelling(b, order)))
  ensures (inv(b) ==> canObserveCancelling(b, order) ==> stepSignaturesNeedLiveBuyback(b, "observeCancelling", observeCancelling(b, order)))
{
  if inv(b) && canObserveCancelling(b, order) {
    var after := observeCancelling(b, order);
    UnchangedCumulative(b, after);
  }
}

lemma observeRefund_ensures(b: Buyback, refund: RefundEvidence)
  ensures (inv(b) ==> canObserveRefund(b, refund) ==> alwaysSourcesOnce(observeRefund(b, refund)))
  ensures (inv(b) ==> canObserveRefund(b, refund) ==> alwaysRuntimeSound(observeRefund(b, refund)))
  ensures (inv(b) ==> canObserveRefund(b, refund) ==> alwaysShareBounded(observeRefund(b, refund)))
  ensures (inv(b) ==> canObserveRefund(b, refund) ==> alwaysWindowLimits(observeRefund(b, refund)))
  ensures (inv(b) ==> canObserveRefund(b, refund) ==> alwaysJournalPastAndPositive(observeRefund(b, refund)))
  ensures (inv(b) ==> canObserveRefund(b, refund) ==> alwaysPendingOrderReserved(observeRefund(b, refund)))
  ensures (inv(b) ==> canObserveRefund(b, refund) ==> alwaysPoolNonNegative(observeRefund(b, refund)))
  ensures (inv(b) ==> canObserveRefund(b, refund) ==> alwaysLocalShareBounded(observeRefund(b, refund)))
  ensures (inv(b) ==> canObserveRefund(b, refund) ==> alwaysSourceLegsOnly(observeRefund(b, refund)))
  ensures (inv(b) ==> canObserveRefund(b, refund) ==> alwaysBurnBounded(observeRefund(b, refund)))
  ensures (inv(b) ==> canObserveRefund(b, refund) ==> stepNewSourceUnseen(b, observeRefund(b, refund)))
  ensures (inv(b) ==> canObserveRefund(b, refund) ==> stepOrderOutcomeOnce(b, observeRefund(b, refund)))
  ensures (inv(b) ==> canObserveRefund(b, refund) ==> stepIncomeMonotonic(b, observeRefund(b, refund)))
  ensures (inv(b) ==> canObserveRefund(b, refund) ==> stepJournalRetained(b, observeRefund(b, refund)))
  ensures (inv(b) ==> canObserveRefund(b, refund) ==> stepSignaturesNeedLiveBuyback(b, "observeRefund", observeRefund(b, refund)))
{
  if inv(b) && canObserveRefund(b, refund) {
    var after := observeRefund(b, refund);
    UnchangedCumulative(b, after);
    SmallAmountNonnegativeValid(b.orderAmount);
    settlement__half_lawHalfValid_ensures(b.income);
    Shrinks(b.committed, settlement__money_smallAmount(b.orderAmount));
    settlement__money_lawNumericOrderTransitive_ensures(after.committed, b.committed, settlement__half_half(b.income).quotient);
    WindowRelease(b.bridgeSpends, b.order, b.clock);
  }
}

lemma reportUnfilled_ensures(b: Buyback)
  ensures (inv(b) ==> canReportUnfilled(b) ==> alwaysSourcesOnce(reportUnfilled(b)))
  ensures (inv(b) ==> canReportUnfilled(b) ==> alwaysRuntimeSound(reportUnfilled(b)))
  ensures (inv(b) ==> canReportUnfilled(b) ==> alwaysShareBounded(reportUnfilled(b)))
  ensures (inv(b) ==> canReportUnfilled(b) ==> alwaysWindowLimits(reportUnfilled(b)))
  ensures (inv(b) ==> canReportUnfilled(b) ==> alwaysJournalPastAndPositive(reportUnfilled(b)))
  ensures (inv(b) ==> canReportUnfilled(b) ==> alwaysPendingOrderReserved(reportUnfilled(b)))
  ensures (inv(b) ==> canReportUnfilled(b) ==> alwaysPoolNonNegative(reportUnfilled(b)))
  ensures (inv(b) ==> canReportUnfilled(b) ==> alwaysLocalShareBounded(reportUnfilled(b)))
  ensures (inv(b) ==> canReportUnfilled(b) ==> alwaysSourceLegsOnly(reportUnfilled(b)))
  ensures (inv(b) ==> canReportUnfilled(b) ==> alwaysBurnBounded(reportUnfilled(b)))
  ensures (inv(b) ==> canReportUnfilled(b) ==> stepNewSourceUnseen(b, reportUnfilled(b)))
  ensures (inv(b) ==> canReportUnfilled(b) ==> stepOrderOutcomeOnce(b, reportUnfilled(b)))
  ensures (inv(b) ==> canReportUnfilled(b) ==> stepIncomeMonotonic(b, reportUnfilled(b)))
  ensures (inv(b) ==> canReportUnfilled(b) ==> stepJournalRetained(b, reportUnfilled(b)))
  ensures (inv(b) ==> canReportUnfilled(b) ==> stepSignaturesNeedLiveBuyback(b, "reportUnfilled", reportUnfilled(b)))
{
  if inv(b) && canReportUnfilled(b) {
    var after := reportUnfilled(b);
    UnchangedCumulative(b, after);
  }
}

lemma closeOrder_ensures(b: Buyback)
  ensures (inv(b) ==> canCloseOrder(b) ==> alwaysSourcesOnce(closeOrder(b)))
  ensures (inv(b) ==> canCloseOrder(b) ==> alwaysRuntimeSound(closeOrder(b)))
  ensures (inv(b) ==> canCloseOrder(b) ==> alwaysShareBounded(closeOrder(b)))
  ensures (inv(b) ==> canCloseOrder(b) ==> alwaysWindowLimits(closeOrder(b)))
  ensures (inv(b) ==> canCloseOrder(b) ==> alwaysJournalPastAndPositive(closeOrder(b)))
  ensures (inv(b) ==> canCloseOrder(b) ==> alwaysPendingOrderReserved(closeOrder(b)))
  ensures (inv(b) ==> canCloseOrder(b) ==> alwaysPoolNonNegative(closeOrder(b)))
  ensures (inv(b) ==> canCloseOrder(b) ==> alwaysLocalShareBounded(closeOrder(b)))
  ensures (inv(b) ==> canCloseOrder(b) ==> alwaysSourceLegsOnly(closeOrder(b)))
  ensures (inv(b) ==> canCloseOrder(b) ==> alwaysBurnBounded(closeOrder(b)))
  ensures (inv(b) ==> canCloseOrder(b) ==> stepNewSourceUnseen(b, closeOrder(b)))
  ensures (inv(b) ==> canCloseOrder(b) ==> stepOrderOutcomeOnce(b, closeOrder(b)))
  ensures (inv(b) ==> canCloseOrder(b) ==> stepIncomeMonotonic(b, closeOrder(b)))
  ensures (inv(b) ==> canCloseOrder(b) ==> stepJournalRetained(b, closeOrder(b)))
  ensures (inv(b) ==> canCloseOrder(b) ==> stepSignaturesNeedLiveBuyback(b, "closeOrder", closeOrder(b)))
{
  if inv(b) && canCloseOrder(b) {
    var after := closeOrder(b);
    UnchangedCumulative(b, after);
  }
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  var b := initialHolds();
  var z := settlement__money_zero;
  assert b.income == z && b.committed == z;
  assert settlement__money_validAmount(z);
  settlement__half_lawHalfValid_ensures(z);
  settlement__money_lawZeroOrder_ensures(settlement__half_half(z).quotient);
  assert alwaysShareBounded(b);
  assert alwaysWindowLimits(b);
}
