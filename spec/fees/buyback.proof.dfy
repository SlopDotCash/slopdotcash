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
lemma selectSource_ensures(b: Buyback, sourceNetwork: fees__runtime_Network, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork, by_) ==> alwaysSourcesOnce(selectSource(b, sourceNetwork, by_)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork, by_) ==> alwaysRuntimeSound(selectSource(b, sourceNetwork, by_)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork, by_) ==> alwaysDecisionsSignNothing(selectSource(b, sourceNetwork, by_)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork, by_) ==> alwaysOutcomesOfOrders(selectSource(b, sourceNetwork, by_)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork, by_) ==> alwaysShareBounded(selectSource(b, sourceNetwork, by_)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork, by_) ==> alwaysWindowLimits(selectSource(b, sourceNetwork, by_)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork, by_) ==> alwaysJournalPastAndPositive(selectSource(b, sourceNetwork, by_)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork, by_) ==> alwaysPendingOrderReserved(selectSource(b, sourceNetwork, by_)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork, by_) ==> stepNewSourceUnseen(b, selectSource(b, sourceNetwork, by_)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork, by_) ==> stepOrderOutcomeOnce(b, selectSource(b, sourceNetwork, by_)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork, by_) ==> stepIncomeMonotonic(b, selectSource(b, sourceNetwork, by_)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork, by_) ==> stepJournalRetained(b, selectSource(b, sourceNetwork, by_)))
  ensures (inv(b) ==> canSelectSource(b, sourceNetwork, by_) ==> stepSignaturesNeedLiveBuyback(b, "selectSource", selectSource(b, sourceNetwork, by_)))
{
  if inv(b) && canSelectSource(b, sourceNetwork, by_) {
    var after := selectSource(b, sourceNetwork, by_);
    UnchangedCumulative(b, after);
  }
}

lemma advanceClock_ensures(b: Buyback, now: int, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canAdvanceClock(b, now, by_) ==> alwaysSourcesOnce(advanceClock(b, now, by_)))
  ensures (inv(b) ==> canAdvanceClock(b, now, by_) ==> alwaysRuntimeSound(advanceClock(b, now, by_)))
  ensures (inv(b) ==> canAdvanceClock(b, now, by_) ==> alwaysDecisionsSignNothing(advanceClock(b, now, by_)))
  ensures (inv(b) ==> canAdvanceClock(b, now, by_) ==> alwaysOutcomesOfOrders(advanceClock(b, now, by_)))
  ensures (inv(b) ==> canAdvanceClock(b, now, by_) ==> alwaysShareBounded(advanceClock(b, now, by_)))
  ensures (inv(b) ==> canAdvanceClock(b, now, by_) ==> alwaysWindowLimits(advanceClock(b, now, by_)))
  ensures (inv(b) ==> canAdvanceClock(b, now, by_) ==> alwaysJournalPastAndPositive(advanceClock(b, now, by_)))
  ensures (inv(b) ==> canAdvanceClock(b, now, by_) ==> alwaysPendingOrderReserved(advanceClock(b, now, by_)))
  ensures (inv(b) ==> canAdvanceClock(b, now, by_) ==> stepNewSourceUnseen(b, advanceClock(b, now, by_)))
  ensures (inv(b) ==> canAdvanceClock(b, now, by_) ==> stepOrderOutcomeOnce(b, advanceClock(b, now, by_)))
  ensures (inv(b) ==> canAdvanceClock(b, now, by_) ==> stepIncomeMonotonic(b, advanceClock(b, now, by_)))
  ensures (inv(b) ==> canAdvanceClock(b, now, by_) ==> stepJournalRetained(b, advanceClock(b, now, by_)))
  ensures (inv(b) ==> canAdvanceClock(b, now, by_) ==> stepSignaturesNeedLiveBuyback(b, "advanceClock", advanceClock(b, now, by_)))
{
  if inv(b) && canAdvanceClock(b, now, by_) {
    var after := advanceClock(b, now, by_);
    UnchangedCumulative(b, after);
    WindowAfter(b.bridgeSpends, b.clock, now);
    DayAfter(b.bridgeNative, b.clock, now);
  }
}

lemma recordIncome_ensures(b: Buyback, key: IncomeKey, incomeAmount: seq<int>, chainTime: int, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime, by_) ==> alwaysSourcesOnce(recordIncome(b, key, incomeAmount, chainTime, by_)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime, by_) ==> alwaysRuntimeSound(recordIncome(b, key, incomeAmount, chainTime, by_)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime, by_) ==> alwaysDecisionsSignNothing(recordIncome(b, key, incomeAmount, chainTime, by_)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime, by_) ==> alwaysOutcomesOfOrders(recordIncome(b, key, incomeAmount, chainTime, by_)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime, by_) ==> alwaysShareBounded(recordIncome(b, key, incomeAmount, chainTime, by_)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime, by_) ==> alwaysWindowLimits(recordIncome(b, key, incomeAmount, chainTime, by_)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime, by_) ==> alwaysJournalPastAndPositive(recordIncome(b, key, incomeAmount, chainTime, by_)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime, by_) ==> alwaysPendingOrderReserved(recordIncome(b, key, incomeAmount, chainTime, by_)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime, by_) ==> stepNewSourceUnseen(b, recordIncome(b, key, incomeAmount, chainTime, by_)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime, by_) ==> stepOrderOutcomeOnce(b, recordIncome(b, key, incomeAmount, chainTime, by_)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime, by_) ==> stepIncomeMonotonic(b, recordIncome(b, key, incomeAmount, chainTime, by_)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime, by_) ==> stepJournalRetained(b, recordIncome(b, key, incomeAmount, chainTime, by_)))
  ensures (inv(b) ==> canRecordIncome(b, key, incomeAmount, chainTime, by_) ==> stepSignaturesNeedLiveBuyback(b, "recordIncome", recordIncome(b, key, incomeAmount, chainTime, by_)))
{
  if inv(b) && canRecordIncome(b, key, incomeAmount, chainTime, by_) {
    var after := recordIncome(b, key, incomeAmount, chainTime, by_);
    Grows(b.income, incomeAmount);
    ShareUnderLargerIncome(b.committed, b.income, after.income);
  }
}

lemma publishWorker_ensures(b: Buyback, config: fees__runtime_WorkerConfig, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysSourcesOnce(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysRuntimeSound(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysDecisionsSignNothing(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysOutcomesOfOrders(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysShareBounded(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysWindowLimits(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysJournalPastAndPositive(publishWorker(b, config, by_)))
  ensures (inv(b) ==> canPublishWorker(b, config, by_) ==> alwaysPendingOrderReserved(publishWorker(b, config, by_)))
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
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysDecisionsSignNothing(setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysOutcomesOfOrders(setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysShareBounded(setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysWindowLimits(setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysJournalPastAndPositive(setReleaseVariable(b, variable, by_)))
  ensures (inv(b) ==> canSetReleaseVariable(b, variable, by_) ==> alwaysPendingOrderReserved(setReleaseVariable(b, variable, by_)))
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

lemma verifyReadiness_ensures(b: Buyback, readyNetwork: fees__runtime_Network, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, by_) ==> alwaysSourcesOnce(verifyReadiness(b, readyNetwork, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, by_) ==> alwaysRuntimeSound(verifyReadiness(b, readyNetwork, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, by_) ==> alwaysDecisionsSignNothing(verifyReadiness(b, readyNetwork, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, by_) ==> alwaysOutcomesOfOrders(verifyReadiness(b, readyNetwork, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, by_) ==> alwaysShareBounded(verifyReadiness(b, readyNetwork, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, by_) ==> alwaysWindowLimits(verifyReadiness(b, readyNetwork, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, by_) ==> alwaysJournalPastAndPositive(verifyReadiness(b, readyNetwork, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, by_) ==> alwaysPendingOrderReserved(verifyReadiness(b, readyNetwork, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, by_) ==> stepNewSourceUnseen(b, verifyReadiness(b, readyNetwork, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, by_) ==> stepOrderOutcomeOnce(b, verifyReadiness(b, readyNetwork, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, by_) ==> stepIncomeMonotonic(b, verifyReadiness(b, readyNetwork, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, by_) ==> stepJournalRetained(b, verifyReadiness(b, readyNetwork, by_)))
  ensures (inv(b) ==> canVerifyReadiness(b, readyNetwork, by_) ==> stepSignaturesNeedLiveBuyback(b, "verifyReadiness", verifyReadiness(b, readyNetwork, by_)))
{
  if inv(b) && canVerifyReadiness(b, readyNetwork, by_) {
    var after := verifyReadiness(b, readyNetwork, by_);
    UnchangedCumulative(b, after);
  }
}

lemma decide_ensures(b: Buyback, quote: BridgeQuote, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canDecide(b, quote, by_) ==> alwaysSourcesOnce(decide(b, quote, by_)))
  ensures (inv(b) ==> canDecide(b, quote, by_) ==> alwaysRuntimeSound(decide(b, quote, by_)))
  ensures (inv(b) ==> canDecide(b, quote, by_) ==> alwaysDecisionsSignNothing(decide(b, quote, by_)))
  ensures (inv(b) ==> canDecide(b, quote, by_) ==> alwaysOutcomesOfOrders(decide(b, quote, by_)))
  ensures (inv(b) ==> canDecide(b, quote, by_) ==> alwaysShareBounded(decide(b, quote, by_)))
  ensures (inv(b) ==> canDecide(b, quote, by_) ==> alwaysWindowLimits(decide(b, quote, by_)))
  ensures (inv(b) ==> canDecide(b, quote, by_) ==> alwaysJournalPastAndPositive(decide(b, quote, by_)))
  ensures (inv(b) ==> canDecide(b, quote, by_) ==> alwaysPendingOrderReserved(decide(b, quote, by_)))
  ensures (inv(b) ==> canDecide(b, quote, by_) ==> stepNewSourceUnseen(b, decide(b, quote, by_)))
  ensures (inv(b) ==> canDecide(b, quote, by_) ==> stepOrderOutcomeOnce(b, decide(b, quote, by_)))
  ensures (inv(b) ==> canDecide(b, quote, by_) ==> stepIncomeMonotonic(b, decide(b, quote, by_)))
  ensures (inv(b) ==> canDecide(b, quote, by_) ==> stepJournalRetained(b, decide(b, quote, by_)))
  ensures (inv(b) ==> canDecide(b, quote, by_) ==> stepSignaturesNeedLiveBuyback(b, "decide", decide(b, quote, by_)))
{
  if inv(b) && canDecide(b, quote, by_) {
    var after := decide(b, quote, by_);
    UnchangedCumulative(b, after);
  }
}

lemma approveOrder_ensures(b: Buyback, request: BridgeOrder, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canApproveOrder(b, request, by_) ==> alwaysSourcesOnce(approveOrder(b, request, by_)))
  ensures (inv(b) ==> canApproveOrder(b, request, by_) ==> alwaysRuntimeSound(approveOrder(b, request, by_)))
  ensures (inv(b) ==> canApproveOrder(b, request, by_) ==> alwaysDecisionsSignNothing(approveOrder(b, request, by_)))
  ensures (inv(b) ==> canApproveOrder(b, request, by_) ==> alwaysOutcomesOfOrders(approveOrder(b, request, by_)))
  ensures (inv(b) ==> canApproveOrder(b, request, by_) ==> alwaysShareBounded(approveOrder(b, request, by_)))
  ensures (inv(b) ==> canApproveOrder(b, request, by_) ==> alwaysWindowLimits(approveOrder(b, request, by_)))
  ensures (inv(b) ==> canApproveOrder(b, request, by_) ==> alwaysJournalPastAndPositive(approveOrder(b, request, by_)))
  ensures (inv(b) ==> canApproveOrder(b, request, by_) ==> alwaysPendingOrderReserved(approveOrder(b, request, by_)))
  ensures (inv(b) ==> canApproveOrder(b, request, by_) ==> stepNewSourceUnseen(b, approveOrder(b, request, by_)))
  ensures (inv(b) ==> canApproveOrder(b, request, by_) ==> stepOrderOutcomeOnce(b, approveOrder(b, request, by_)))
  ensures (inv(b) ==> canApproveOrder(b, request, by_) ==> stepIncomeMonotonic(b, approveOrder(b, request, by_)))
  ensures (inv(b) ==> canApproveOrder(b, request, by_) ==> stepJournalRetained(b, approveOrder(b, request, by_)))
  ensures (inv(b) ==> canApproveOrder(b, request, by_) ==> stepSignaturesNeedLiveBuyback(b, "approveOrder", approveOrder(b, request, by_)))
{
  if inv(b) && canApproveOrder(b, request, by_) {
    var after := approveOrder(b, request, by_);
    UnchangedCumulative(b, after);
  }
}

lemma settleApproval_ensures(b: Buyback, receipt: BridgeReceipt, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canSettleApproval(b, receipt, by_) ==> alwaysSourcesOnce(settleApproval(b, receipt, by_)))
  ensures (inv(b) ==> canSettleApproval(b, receipt, by_) ==> alwaysRuntimeSound(settleApproval(b, receipt, by_)))
  ensures (inv(b) ==> canSettleApproval(b, receipt, by_) ==> alwaysDecisionsSignNothing(settleApproval(b, receipt, by_)))
  ensures (inv(b) ==> canSettleApproval(b, receipt, by_) ==> alwaysOutcomesOfOrders(settleApproval(b, receipt, by_)))
  ensures (inv(b) ==> canSettleApproval(b, receipt, by_) ==> alwaysShareBounded(settleApproval(b, receipt, by_)))
  ensures (inv(b) ==> canSettleApproval(b, receipt, by_) ==> alwaysWindowLimits(settleApproval(b, receipt, by_)))
  ensures (inv(b) ==> canSettleApproval(b, receipt, by_) ==> alwaysJournalPastAndPositive(settleApproval(b, receipt, by_)))
  ensures (inv(b) ==> canSettleApproval(b, receipt, by_) ==> alwaysPendingOrderReserved(settleApproval(b, receipt, by_)))
  ensures (inv(b) ==> canSettleApproval(b, receipt, by_) ==> stepNewSourceUnseen(b, settleApproval(b, receipt, by_)))
  ensures (inv(b) ==> canSettleApproval(b, receipt, by_) ==> stepOrderOutcomeOnce(b, settleApproval(b, receipt, by_)))
  ensures (inv(b) ==> canSettleApproval(b, receipt, by_) ==> stepIncomeMonotonic(b, settleApproval(b, receipt, by_)))
  ensures (inv(b) ==> canSettleApproval(b, receipt, by_) ==> stepJournalRetained(b, settleApproval(b, receipt, by_)))
  ensures (inv(b) ==> canSettleApproval(b, receipt, by_) ==> stepSignaturesNeedLiveBuyback(b, "settleApproval", settleApproval(b, receipt, by_)))
{
  if inv(b) && canSettleApproval(b, receipt, by_) {
    var after := settleApproval(b, receipt, by_);
    UnchangedCumulative(b, after);
  }
}

lemma order_ensures(b: Buyback, request: BridgeOrder, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canOrder(b, request, by_) ==> alwaysSourcesOnce(order(b, request, by_)))
  ensures (inv(b) ==> canOrder(b, request, by_) ==> alwaysRuntimeSound(order(b, request, by_)))
  ensures (inv(b) ==> canOrder(b, request, by_) ==> alwaysDecisionsSignNothing(order(b, request, by_)))
  ensures (inv(b) ==> canOrder(b, request, by_) ==> alwaysOutcomesOfOrders(order(b, request, by_)))
  ensures (inv(b) ==> canOrder(b, request, by_) ==> alwaysShareBounded(order(b, request, by_)))
  ensures (inv(b) ==> canOrder(b, request, by_) ==> alwaysWindowLimits(order(b, request, by_)))
  ensures (inv(b) ==> canOrder(b, request, by_) ==> alwaysJournalPastAndPositive(order(b, request, by_)))
  ensures (inv(b) ==> canOrder(b, request, by_) ==> alwaysPendingOrderReserved(order(b, request, by_)))
  ensures (inv(b) ==> canOrder(b, request, by_) ==> stepNewSourceUnseen(b, order(b, request, by_)))
  ensures (inv(b) ==> canOrder(b, request, by_) ==> stepOrderOutcomeOnce(b, order(b, request, by_)))
  ensures (inv(b) ==> canOrder(b, request, by_) ==> stepIncomeMonotonic(b, order(b, request, by_)))
  ensures (inv(b) ==> canOrder(b, request, by_) ==> stepJournalRetained(b, order(b, request, by_)))
  ensures (inv(b) ==> canOrder(b, request, by_) ==> stepSignaturesNeedLiveBuyback(b, "order", order(b, request, by_)))
{
  if inv(b) && canOrder(b, request, by_) {
    var after := order(b, request, by_);
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

lemma loseSend_ensures(b: Buyback, tx: int, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canLoseSend(b, tx, by_) ==> alwaysSourcesOnce(loseSend(b, tx, by_)))
  ensures (inv(b) ==> canLoseSend(b, tx, by_) ==> alwaysRuntimeSound(loseSend(b, tx, by_)))
  ensures (inv(b) ==> canLoseSend(b, tx, by_) ==> alwaysDecisionsSignNothing(loseSend(b, tx, by_)))
  ensures (inv(b) ==> canLoseSend(b, tx, by_) ==> alwaysOutcomesOfOrders(loseSend(b, tx, by_)))
  ensures (inv(b) ==> canLoseSend(b, tx, by_) ==> alwaysShareBounded(loseSend(b, tx, by_)))
  ensures (inv(b) ==> canLoseSend(b, tx, by_) ==> alwaysWindowLimits(loseSend(b, tx, by_)))
  ensures (inv(b) ==> canLoseSend(b, tx, by_) ==> alwaysJournalPastAndPositive(loseSend(b, tx, by_)))
  ensures (inv(b) ==> canLoseSend(b, tx, by_) ==> alwaysPendingOrderReserved(loseSend(b, tx, by_)))
  ensures (inv(b) ==> canLoseSend(b, tx, by_) ==> stepNewSourceUnseen(b, loseSend(b, tx, by_)))
  ensures (inv(b) ==> canLoseSend(b, tx, by_) ==> stepOrderOutcomeOnce(b, loseSend(b, tx, by_)))
  ensures (inv(b) ==> canLoseSend(b, tx, by_) ==> stepIncomeMonotonic(b, loseSend(b, tx, by_)))
  ensures (inv(b) ==> canLoseSend(b, tx, by_) ==> stepJournalRetained(b, loseSend(b, tx, by_)))
  ensures (inv(b) ==> canLoseSend(b, tx, by_) ==> stepSignaturesNeedLiveBuyback(b, "loseSend", loseSend(b, tx, by_)))
{
  if inv(b) && canLoseSend(b, tx, by_) {
    var after := loseSend(b, tx, by_);
    UnchangedCumulative(b, after);
  }
}

lemma settleOrder_ensures(b: Buyback, receipt: BridgeReceipt, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canSettleOrder(b, receipt, by_) ==> alwaysSourcesOnce(settleOrder(b, receipt, by_)))
  ensures (inv(b) ==> canSettleOrder(b, receipt, by_) ==> alwaysRuntimeSound(settleOrder(b, receipt, by_)))
  ensures (inv(b) ==> canSettleOrder(b, receipt, by_) ==> alwaysDecisionsSignNothing(settleOrder(b, receipt, by_)))
  ensures (inv(b) ==> canSettleOrder(b, receipt, by_) ==> alwaysOutcomesOfOrders(settleOrder(b, receipt, by_)))
  ensures (inv(b) ==> canSettleOrder(b, receipt, by_) ==> alwaysShareBounded(settleOrder(b, receipt, by_)))
  ensures (inv(b) ==> canSettleOrder(b, receipt, by_) ==> alwaysWindowLimits(settleOrder(b, receipt, by_)))
  ensures (inv(b) ==> canSettleOrder(b, receipt, by_) ==> alwaysJournalPastAndPositive(settleOrder(b, receipt, by_)))
  ensures (inv(b) ==> canSettleOrder(b, receipt, by_) ==> alwaysPendingOrderReserved(settleOrder(b, receipt, by_)))
  ensures (inv(b) ==> canSettleOrder(b, receipt, by_) ==> stepNewSourceUnseen(b, settleOrder(b, receipt, by_)))
  ensures (inv(b) ==> canSettleOrder(b, receipt, by_) ==> stepOrderOutcomeOnce(b, settleOrder(b, receipt, by_)))
  ensures (inv(b) ==> canSettleOrder(b, receipt, by_) ==> stepIncomeMonotonic(b, settleOrder(b, receipt, by_)))
  ensures (inv(b) ==> canSettleOrder(b, receipt, by_) ==> stepJournalRetained(b, settleOrder(b, receipt, by_)))
  ensures (inv(b) ==> canSettleOrder(b, receipt, by_) ==> stepSignaturesNeedLiveBuyback(b, "settleOrder", settleOrder(b, receipt, by_)))
{
  if inv(b) && canSettleOrder(b, receipt, by_) {
    var after := settleOrder(b, receipt, by_);
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

lemma observeArrival_ensures(b: Buyback, arrival: ArrivalEvidence, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canObserveArrival(b, arrival, by_) ==> alwaysSourcesOnce(observeArrival(b, arrival, by_)))
  ensures (inv(b) ==> canObserveArrival(b, arrival, by_) ==> alwaysRuntimeSound(observeArrival(b, arrival, by_)))
  ensures (inv(b) ==> canObserveArrival(b, arrival, by_) ==> alwaysDecisionsSignNothing(observeArrival(b, arrival, by_)))
  ensures (inv(b) ==> canObserveArrival(b, arrival, by_) ==> alwaysOutcomesOfOrders(observeArrival(b, arrival, by_)))
  ensures (inv(b) ==> canObserveArrival(b, arrival, by_) ==> alwaysShareBounded(observeArrival(b, arrival, by_)))
  ensures (inv(b) ==> canObserveArrival(b, arrival, by_) ==> alwaysWindowLimits(observeArrival(b, arrival, by_)))
  ensures (inv(b) ==> canObserveArrival(b, arrival, by_) ==> alwaysJournalPastAndPositive(observeArrival(b, arrival, by_)))
  ensures (inv(b) ==> canObserveArrival(b, arrival, by_) ==> alwaysPendingOrderReserved(observeArrival(b, arrival, by_)))
  ensures (inv(b) ==> canObserveArrival(b, arrival, by_) ==> stepNewSourceUnseen(b, observeArrival(b, arrival, by_)))
  ensures (inv(b) ==> canObserveArrival(b, arrival, by_) ==> stepOrderOutcomeOnce(b, observeArrival(b, arrival, by_)))
  ensures (inv(b) ==> canObserveArrival(b, arrival, by_) ==> stepIncomeMonotonic(b, observeArrival(b, arrival, by_)))
  ensures (inv(b) ==> canObserveArrival(b, arrival, by_) ==> stepJournalRetained(b, observeArrival(b, arrival, by_)))
  ensures (inv(b) ==> canObserveArrival(b, arrival, by_) ==> stepSignaturesNeedLiveBuyback(b, "observeArrival", observeArrival(b, arrival, by_)))
{
  if inv(b) && canObserveArrival(b, arrival, by_) {
    var after := observeArrival(b, arrival, by_);
    UnchangedCumulative(b, after);
  }
}

lemma observeCancelling_ensures(b: Buyback, cancellation: CancellationEvidence, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canObserveCancelling(b, cancellation, by_) ==> alwaysSourcesOnce(observeCancelling(b, cancellation, by_)))
  ensures (inv(b) ==> canObserveCancelling(b, cancellation, by_) ==> alwaysRuntimeSound(observeCancelling(b, cancellation, by_)))
  ensures (inv(b) ==> canObserveCancelling(b, cancellation, by_) ==> alwaysDecisionsSignNothing(observeCancelling(b, cancellation, by_)))
  ensures (inv(b) ==> canObserveCancelling(b, cancellation, by_) ==> alwaysOutcomesOfOrders(observeCancelling(b, cancellation, by_)))
  ensures (inv(b) ==> canObserveCancelling(b, cancellation, by_) ==> alwaysShareBounded(observeCancelling(b, cancellation, by_)))
  ensures (inv(b) ==> canObserveCancelling(b, cancellation, by_) ==> alwaysWindowLimits(observeCancelling(b, cancellation, by_)))
  ensures (inv(b) ==> canObserveCancelling(b, cancellation, by_) ==> alwaysJournalPastAndPositive(observeCancelling(b, cancellation, by_)))
  ensures (inv(b) ==> canObserveCancelling(b, cancellation, by_) ==> alwaysPendingOrderReserved(observeCancelling(b, cancellation, by_)))
  ensures (inv(b) ==> canObserveCancelling(b, cancellation, by_) ==> stepNewSourceUnseen(b, observeCancelling(b, cancellation, by_)))
  ensures (inv(b) ==> canObserveCancelling(b, cancellation, by_) ==> stepOrderOutcomeOnce(b, observeCancelling(b, cancellation, by_)))
  ensures (inv(b) ==> canObserveCancelling(b, cancellation, by_) ==> stepIncomeMonotonic(b, observeCancelling(b, cancellation, by_)))
  ensures (inv(b) ==> canObserveCancelling(b, cancellation, by_) ==> stepJournalRetained(b, observeCancelling(b, cancellation, by_)))
  ensures (inv(b) ==> canObserveCancelling(b, cancellation, by_) ==> stepSignaturesNeedLiveBuyback(b, "observeCancelling", observeCancelling(b, cancellation, by_)))
{
  if inv(b) && canObserveCancelling(b, cancellation, by_) {
    var after := observeCancelling(b, cancellation, by_);
    UnchangedCumulative(b, after);
  }
}

lemma observeRefund_ensures(b: Buyback, refund: RefundEvidence, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canObserveRefund(b, refund, by_) ==> alwaysSourcesOnce(observeRefund(b, refund, by_)))
  ensures (inv(b) ==> canObserveRefund(b, refund, by_) ==> alwaysRuntimeSound(observeRefund(b, refund, by_)))
  ensures (inv(b) ==> canObserveRefund(b, refund, by_) ==> alwaysDecisionsSignNothing(observeRefund(b, refund, by_)))
  ensures (inv(b) ==> canObserveRefund(b, refund, by_) ==> alwaysOutcomesOfOrders(observeRefund(b, refund, by_)))
  ensures (inv(b) ==> canObserveRefund(b, refund, by_) ==> alwaysShareBounded(observeRefund(b, refund, by_)))
  ensures (inv(b) ==> canObserveRefund(b, refund, by_) ==> alwaysWindowLimits(observeRefund(b, refund, by_)))
  ensures (inv(b) ==> canObserveRefund(b, refund, by_) ==> alwaysJournalPastAndPositive(observeRefund(b, refund, by_)))
  ensures (inv(b) ==> canObserveRefund(b, refund, by_) ==> alwaysPendingOrderReserved(observeRefund(b, refund, by_)))
  ensures (inv(b) ==> canObserveRefund(b, refund, by_) ==> stepNewSourceUnseen(b, observeRefund(b, refund, by_)))
  ensures (inv(b) ==> canObserveRefund(b, refund, by_) ==> stepOrderOutcomeOnce(b, observeRefund(b, refund, by_)))
  ensures (inv(b) ==> canObserveRefund(b, refund, by_) ==> stepIncomeMonotonic(b, observeRefund(b, refund, by_)))
  ensures (inv(b) ==> canObserveRefund(b, refund, by_) ==> stepJournalRetained(b, observeRefund(b, refund, by_)))
  ensures (inv(b) ==> canObserveRefund(b, refund, by_) ==> stepSignaturesNeedLiveBuyback(b, "observeRefund", observeRefund(b, refund, by_)))
{
  if inv(b) && canObserveRefund(b, refund, by_) {
    var after := observeRefund(b, refund, by_);
    UnchangedCumulative(b, after);
    SmallAmountNonnegativeValid(b.orderAmount);
    settlement__half_lawHalfValid_ensures(b.income);
    Shrinks(b.committed, settlement__money_smallAmount(b.orderAmount));
    settlement__money_lawNumericOrderTransitive_ensures(after.committed, b.committed, settlement__half_half(b.income).quotient);
    WindowRelease(b.bridgeSpends, b.order, b.clock);
  }
}

lemma reportUnfilled_ensures(b: Buyback, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canReportUnfilled(b, by_) ==> alwaysSourcesOnce(reportUnfilled(b, by_)))
  ensures (inv(b) ==> canReportUnfilled(b, by_) ==> alwaysRuntimeSound(reportUnfilled(b, by_)))
  ensures (inv(b) ==> canReportUnfilled(b, by_) ==> alwaysDecisionsSignNothing(reportUnfilled(b, by_)))
  ensures (inv(b) ==> canReportUnfilled(b, by_) ==> alwaysOutcomesOfOrders(reportUnfilled(b, by_)))
  ensures (inv(b) ==> canReportUnfilled(b, by_) ==> alwaysShareBounded(reportUnfilled(b, by_)))
  ensures (inv(b) ==> canReportUnfilled(b, by_) ==> alwaysWindowLimits(reportUnfilled(b, by_)))
  ensures (inv(b) ==> canReportUnfilled(b, by_) ==> alwaysJournalPastAndPositive(reportUnfilled(b, by_)))
  ensures (inv(b) ==> canReportUnfilled(b, by_) ==> alwaysPendingOrderReserved(reportUnfilled(b, by_)))
  ensures (inv(b) ==> canReportUnfilled(b, by_) ==> stepNewSourceUnseen(b, reportUnfilled(b, by_)))
  ensures (inv(b) ==> canReportUnfilled(b, by_) ==> stepOrderOutcomeOnce(b, reportUnfilled(b, by_)))
  ensures (inv(b) ==> canReportUnfilled(b, by_) ==> stepIncomeMonotonic(b, reportUnfilled(b, by_)))
  ensures (inv(b) ==> canReportUnfilled(b, by_) ==> stepJournalRetained(b, reportUnfilled(b, by_)))
  ensures (inv(b) ==> canReportUnfilled(b, by_) ==> stepSignaturesNeedLiveBuyback(b, "reportUnfilled", reportUnfilled(b, by_)))
{
  if inv(b) && canReportUnfilled(b, by_) {
    var after := reportUnfilled(b, by_);
    UnchangedCumulative(b, after);
  }
}

lemma closeOrder_ensures(b: Buyback, by_: fees__runtime_Sender)
  ensures (inv(b) ==> canCloseOrder(b, by_) ==> alwaysSourcesOnce(closeOrder(b, by_)))
  ensures (inv(b) ==> canCloseOrder(b, by_) ==> alwaysRuntimeSound(closeOrder(b, by_)))
  ensures (inv(b) ==> canCloseOrder(b, by_) ==> alwaysDecisionsSignNothing(closeOrder(b, by_)))
  ensures (inv(b) ==> canCloseOrder(b, by_) ==> alwaysOutcomesOfOrders(closeOrder(b, by_)))
  ensures (inv(b) ==> canCloseOrder(b, by_) ==> alwaysShareBounded(closeOrder(b, by_)))
  ensures (inv(b) ==> canCloseOrder(b, by_) ==> alwaysWindowLimits(closeOrder(b, by_)))
  ensures (inv(b) ==> canCloseOrder(b, by_) ==> alwaysJournalPastAndPositive(closeOrder(b, by_)))
  ensures (inv(b) ==> canCloseOrder(b, by_) ==> alwaysPendingOrderReserved(closeOrder(b, by_)))
  ensures (inv(b) ==> canCloseOrder(b, by_) ==> stepNewSourceUnseen(b, closeOrder(b, by_)))
  ensures (inv(b) ==> canCloseOrder(b, by_) ==> stepOrderOutcomeOnce(b, closeOrder(b, by_)))
  ensures (inv(b) ==> canCloseOrder(b, by_) ==> stepIncomeMonotonic(b, closeOrder(b, by_)))
  ensures (inv(b) ==> canCloseOrder(b, by_) ==> stepJournalRetained(b, closeOrder(b, by_)))
  ensures (inv(b) ==> canCloseOrder(b, by_) ==> stepSignaturesNeedLiveBuyback(b, "closeOrder", closeOrder(b, by_)))
{
  if inv(b) && canCloseOrder(b, by_) {
    var after := closeOrder(b, by_);
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
