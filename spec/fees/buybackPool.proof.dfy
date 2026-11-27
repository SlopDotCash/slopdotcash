lemma LocalShareView(p: Pool)
  ensures alwaysLocalShareBounded(p) == !((exists c :: c in p.credits && !((((((c.asset > 0) && settlement__money_validAmount(c.income)) && settlement__money_validAmount(c.committed)) && (settlement__money_compareAmounts(c.committed, settlement__half_half(c.income).quotient) <= 0)) && (|ProofLib.Filter((x: AssetCredit) => (x.asset == c.asset), p.credits)| == 1)))))
{
}

lemma CreditsDistinct(p: Pool)
  requires alwaysLocalShareBounded(p)
  ensures ProofLib.DistinctBy(p.credits, (x: AssetCredit) => x.asset)
{
  LocalShareView(p);
  var key := (x: AssetCredit) => x.asset;
  forall i, j | 0 <= i < |p.credits| && 0 <= j < |p.credits| && i != j
    ensures key(p.credits[i]) != key(p.credits[j])
  {
    assert p.credits[i] in p.credits;
    var pred := (x: AssetCredit) => (x.asset == p.credits[i].asset);
    ProofLib.FilterCountOneIffUnique(pred, p.credits, key, i);
  }
}

lemma LocalShareFromDistinct(p: Pool)
  requires ProofLib.DistinctBy(p.credits, (x: AssetCredit) => x.asset)
  requires forall c :: c in p.credits ==>
    c.asset > 0 && settlement__money_validAmount(c.income) && settlement__money_validAmount(c.committed)
      && settlement__money_compareAmounts(c.committed, settlement__half_half(c.income).quotient) <= 0
  ensures alwaysLocalShareBounded(p)
{
  LocalShareView(p);
  forall c | c in p.credits
    ensures |ProofLib.Filter((x: AssetCredit) => (x.asset == c.asset), p.credits)| == 1
  {
    var i :| 0 <= i < |p.credits| && p.credits[i] == c;
    ProofLib.FilterOne((x: AssetCredit) => (x.asset == c.asset), p.credits, i);
  }
}

lemma CreditOfFoldAbsent(xs: seq<AssetCredit>, asset: int, init: AssetCredit)
  requires forall c :: c in xs ==> c.asset != asset
  ensures Std.Collections.Seq.FoldLeft((found: AssetCredit, c: AssetCredit) => (if (c.asset == asset) then c else found), init, xs) == init
  decreases |xs|
{
  if |xs| > 0 {
    assert xs[0] in xs;
    assert forall y :: y in xs[1..] ==> y in xs;
    CreditOfFoldAbsent(xs[1..], asset, init);
  }
}

lemma CreditOfFoldPresent(xs: seq<AssetCredit>, asset: int, init: AssetCredit, i: int)
  requires ProofLib.DistinctBy(xs, (x: AssetCredit) => x.asset)
  requires 0 <= i < |xs| && xs[i].asset == asset
  ensures Std.Collections.Seq.FoldLeft((found: AssetCredit, c: AssetCredit) => (if (c.asset == asset) then c else found), init, xs) == xs[i]
  decreases |xs|
{
  if i == 0 {
    forall y | y in xs[1..]
      ensures y.asset != asset
    {
      var j :| 0 <= j < |xs[1..]| && xs[1..][j] == y;
      assert xs[j + 1] == y;
    }
    CreditOfFoldAbsent(xs[1..], asset, xs[0]);
  } else {
    assert ProofLib.DistinctBy(xs[1..], (x: AssetCredit) => x.asset) by {
      forall a, b | 0 <= a < |xs[1..]| && 0 <= b < |xs[1..]| && a != b
        ensures xs[1..][a].asset != xs[1..][b].asset
      {
        assert xs[1..][a] == xs[a + 1] && xs[1..][b] == xs[b + 1];
      }
    }
    assert xs[1..][i - 1] == xs[i];
    CreditOfFoldPresent(xs[1..], asset, if xs[0].asset == asset then xs[0] else init, i - 1);
  }
}

lemma CreditOfUnique(p: Pool, asset: int)
  requires alwaysLocalShareBounded(p)
  ensures (exists c :: c in p.credits && c.asset == asset) ==> creditOf(p, asset) in p.credits && creditOf(p, asset).asset == asset
  ensures forall c :: c in p.credits && c.asset == asset ==> creditOf(p, asset) == c
  ensures !(exists c :: c in p.credits && c.asset == asset) ==> creditOf(p, asset) == noCredit(asset)
{
  CreditsDistinct(p);
  if exists c :: c in p.credits && c.asset == asset {
    var c :| c in p.credits && c.asset == asset;
    var i :| 0 <= i < |p.credits| && p.credits[i] == c;
    CreditOfFoldPresent(p.credits, asset, noCredit(asset), i);
    forall d | d in p.credits && d.asset == asset
      ensures creditOf(p, asset) == d
    {
      var j :| 0 <= j < |p.credits| && p.credits[j] == d;
      assert i == j;
    }
  } else {
    CreditOfFoldAbsent(p.credits, asset, noCredit(asset));
  }
}

lemma ZeroValidAndHalf()
  ensures settlement__money_validAmount(settlement__money_zero)
  ensures settlement__money_compareAmounts(settlement__money_zero, settlement__half_half(settlement__money_zero).quotient) <= 0
{
  settlement__half_lawHalfValid_ensures(settlement__money_zero);
  settlement__money_lawZeroOrder_ensures(settlement__half_half(settlement__money_zero).quotient);
}

lemma WithCreditReplace(p: Pool, after: Pool, c: AssetCredit)
  requires alwaysLocalShareBounded(p)
  requires forall x :: x in p.credits ==> x.credit >= 0
  requires exists x :: x in p.credits && x.asset == c.asset
  requires after.credits == withCredit(c, p)
  requires c.asset > 0 && c.credit >= 0
  requires settlement__money_validAmount(c.income) && settlement__money_validAmount(c.committed)
  requires settlement__money_compareAmounts(c.committed, settlement__half_half(c.income).quotient) <= 0
  ensures alwaysLocalShareBounded(after)
  ensures forall x :: x in after.credits ==> x.credit >= 0
  ensures creditOf(after, c.asset) == c
  ensures forall x :: x in p.credits && x.asset != c.asset ==> x in after.credits && creditOf(after, x.asset) == x
{
  CreditsDistinct(p);
  var cs := after.credits;
  assert |cs| == |p.credits|;
  assert forall i :: 0 <= i < |cs| ==> cs[i] == (if p.credits[i].asset == c.asset then c else p.credits[i]);
  assert ProofLib.DistinctBy(cs, (x: AssetCredit) => x.asset) by {
    forall i, j | 0 <= i < |cs| && 0 <= j < |cs| && i != j
      ensures cs[i].asset != cs[j].asset
    {
      assert cs[i].asset == p.credits[i].asset && cs[j].asset == p.credits[j].asset;
    }
  }
  forall x | x in cs
    ensures x.asset > 0 && x.credit >= 0 && settlement__money_validAmount(x.income) && settlement__money_validAmount(x.committed)
      && settlement__money_compareAmounts(x.committed, settlement__half_half(x.income).quotient) <= 0
  {
    var i :| 0 <= i < |cs| && cs[i] == x;
    if p.credits[i].asset == c.asset {
      assert x == c;
    } else {
      assert x == p.credits[i] && p.credits[i] in p.credits;
    }
  }
  LocalShareFromDistinct(after);
  var prev :| prev in p.credits && prev.asset == c.asset;
  var k :| 0 <= k < |p.credits| && p.credits[k] == prev;
  assert cs[k] == c && c in after.credits;
  CreditOfUnique(after, c.asset);
  forall x | x in p.credits && x.asset != c.asset
    ensures x in after.credits && creditOf(after, x.asset) == x
  {
    var i :| 0 <= i < |p.credits| && p.credits[i] == x;
    assert cs[i] == x && x in after.credits;
    CreditOfUnique(after, x.asset);
  }
}

lemma WithCreditAppend(p: Pool, after: Pool, c: AssetCredit)
  requires alwaysLocalShareBounded(p)
  requires forall x :: x in p.credits ==> x.credit >= 0
  requires !(exists x :: x in p.credits && x.asset == c.asset)
  requires after.credits == withCredit(c, p)
  requires c.asset > 0 && c.credit >= 0
  requires settlement__money_validAmount(c.income) && settlement__money_validAmount(c.committed)
  requires settlement__money_compareAmounts(c.committed, settlement__half_half(c.income).quotient) <= 0
  ensures alwaysLocalShareBounded(after)
  ensures forall x :: x in after.credits ==> x.credit >= 0
  ensures creditOf(after, c.asset) == c
  ensures forall x :: x in p.credits && x.asset != c.asset ==> x in after.credits && creditOf(after, x.asset) == x
{
  CreditsDistinct(p);
  var cs := after.credits;
  assert cs == p.credits + [c];
  assert ProofLib.DistinctBy(cs, (x: AssetCredit) => x.asset) by {
    forall i, j | 0 <= i < |cs| && 0 <= j < |cs| && i != j
      ensures cs[i].asset != cs[j].asset
    {
      if i < |p.credits| && j < |p.credits| {
        assert cs[i] == p.credits[i] && cs[j] == p.credits[j];
      } else if i < |p.credits| {
        assert cs[i] == p.credits[i] && p.credits[i] in p.credits && cs[j] == c;
      } else {
        assert cs[j] == p.credits[j] && p.credits[j] in p.credits && cs[i] == c;
      }
    }
  }
  forall x | x in cs
    ensures x.asset > 0 && x.credit >= 0 && settlement__money_validAmount(x.income) && settlement__money_validAmount(x.committed)
      && settlement__money_compareAmounts(x.committed, settlement__half_half(x.income).quotient) <= 0
  {
    if x != c {
      assert x in p.credits;
    }
  }
  LocalShareFromDistinct(after);
  assert c in after.credits;
  CreditOfUnique(after, c.asset);
  forall x | x in p.credits && x.asset != c.asset
    ensures x in after.credits && creditOf(after, x.asset) == x
  {
    assert x in after.credits;
    CreditOfUnique(after, x.asset);
  }
}

lemma WithCreditPreserves(p: Pool, after: Pool, c: AssetCredit)
  requires alwaysLocalShareBounded(p)
  requires forall x :: x in p.credits ==> x.credit >= 0
  requires after.credits == withCredit(c, p)
  requires c.asset > 0 && c.credit >= 0
  requires settlement__money_validAmount(c.income) && settlement__money_validAmount(c.committed)
  requires settlement__money_compareAmounts(c.committed, settlement__half_half(c.income).quotient) <= 0
  ensures alwaysLocalShareBounded(after)
  ensures forall x :: x in after.credits ==> x.credit >= 0
  ensures creditOf(after, c.asset) == c
  ensures forall x :: x in p.credits && x.asset != c.asset ==> x in after.credits && creditOf(after, x.asset) == x
{
  if exists x :: x in p.credits && x.asset == c.asset {
    WithCreditReplace(p, after, c);
  } else {
    WithCreditAppend(p, after, c);
  }
}

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

lemma UnchangedTotals(before: Pool, after: Pool)
  requires alwaysLocalShareBounded(before)
  requires after.purchased == before.purchased && after.burned == before.burned
  requires after.credits == before.credits && after.localSlopIncome == before.localSlopIncome
  ensures stepTotalsMonotonic(before, after)
{
  settlement__money_lawEqualReflexive_ensures(before.purchased);
  settlement__money_lawEqualReflexive_ensures(before.burned);
  settlement__money_lawEqualReflexive_ensures(before.localSlopIncome);
  forall c | c in before.credits
    ensures settlement__money_compareAmounts(creditOf(after, c.asset).income, c.income) >= 0
  {
    CreditOfUnique(before, c.asset);
    settlement__money_lawEqualReflexive_ensures(c.income);
  }
}

lemma WindowErasesOnly(xs: seq<fees__buyback_Spend>, from: int, through: int, prior: int, updated: int)
  requires from <= through && updated <= prior
  requires forall x :: x in xs ==> x.at <= from && x.amount > 0
  ensures Std.Collections.Seq.FoldLeft((total: int, spend: fees__buyback_Spend) => (total + (if ((!(spend.released) && (spend.at > (through - fees__buyback_dayMs))) && (spend.at <= through)) then spend.amount else 0)), updated, xs) <=
    Std.Collections.Seq.FoldLeft((total: int, spend: fees__buyback_Spend) => (total + (if ((!(spend.released) && (spend.at > (from - fees__buyback_dayMs))) && (spend.at <= from)) then spend.amount else 0)), prior, xs)
  decreases |xs|
{
  if |xs| > 0 {
    var x := xs[0];
    assert x in xs;
    assert forall y :: y in xs[1..] ==> y in xs;
    WindowErasesOnly(xs[1..], from, through,
      prior + (if !x.released && x.at > from - fees__buyback_dayMs && x.at <= from then x.amount else 0),
      updated + (if !x.released && x.at > through - fees__buyback_dayMs && x.at <= through then x.amount else 0));
  }
}

lemma WindowAfter(xs: seq<fees__buyback_Spend>, from: int, through: int)
  requires from <= through
  requires forall x :: x in xs ==> x.at <= from && x.amount > 0
  ensures fees__buyback_spentInWindow(xs, through) <= fees__buyback_spentInWindow(xs, from)
{
  WindowErasesOnly(xs, from, through, 0, 0);
}

lemma WindowAppendsNow(xs: seq<fees__buyback_Spend>, now: int, s: fees__buyback_Spend)
  requires s.at == now && !s.released
  ensures fees__buyback_spentInWindow(xs + [s], now) == fees__buyback_spentInWindow(xs, now) + s.amount
{
  ProofLib.FoldLeftAppend((total: int, spend: fees__buyback_Spend) => (total + (if ((!(spend.released) && (spend.at > (now - fees__buyback_dayMs))) && (spend.at <= now)) then spend.amount else 0)), 0, xs, s);
}

lemma WindowReleaseLowers(xs: seq<fees__buyback_Spend>, id: int, now: int, prior: int, updated: int)
  requires updated <= prior
  requires forall x :: x in xs ==> x.amount >= 0
  ensures Std.Collections.Seq.FoldLeft((total: int, spend: fees__buyback_Spend) => (total + (if ((!(spend.released) && (spend.at > (now - fees__buyback_dayMs))) && (spend.at <= now)) then spend.amount else 0)), updated, fees__buyback_release(xs, id)) <=
    Std.Collections.Seq.FoldLeft((total: int, spend: fees__buyback_Spend) => (total + (if ((!(spend.released) && (spend.at > (now - fees__buyback_dayMs))) && (spend.at <= now)) then spend.amount else 0)), prior, xs)
  decreases |xs|
{
  if |xs| > 0 {
    var x := xs[0];
    var r := fees__buyback_release(xs, id);
    assert r[0] == (if x.id == id then x.(released := true) else x);
    assert r[1..] == fees__buyback_release(xs[1..], id);
    assert x in xs;
    assert forall y :: y in xs[1..] ==> y in xs;
    WindowReleaseLowers(xs[1..], id, now,
      prior + (if !x.released && x.at > now - fees__buyback_dayMs && x.at <= now then x.amount else 0),
      updated + (if !r[0].released && r[0].at > now - fees__buyback_dayMs && r[0].at <= now then r[0].amount else 0));
  }
}

lemma WindowRelease(xs: seq<fees__buyback_Spend>, id: int, now: int)
  requires forall x :: x in xs ==> x.amount >= 0
  ensures fees__buyback_spentInWindow(fees__buyback_release(xs, id), now) <= fees__buyback_spentInWindow(xs, now)
  ensures forall s :: s in fees__buyback_release(xs, id) ==> exists x :: x in xs && x.at == s.at && x.amount == s.amount
{
  WindowReleaseLowers(xs, id, now, 0, 0);
  forall s | s in fees__buyback_release(xs, id)
    ensures exists x :: x in xs && x.at == s.at && x.amount == s.amount
  {
    var i :| 0 <= i < |fees__buyback_release(xs, id)| && fees__buyback_release(xs, id)[i] == s;
    assert xs[i] in xs;
  }
}

lemma advanceClock_ensures(p: Pool, now: int, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canAdvanceClock(p, now, by_) ==> alwaysArrivalsOnce(advanceClock(p, now, by_)))
  ensures (inv(p) ==> canAdvanceClock(p, now, by_) ==> alwaysLocalShareBounded(advanceClock(p, now, by_)))
  ensures (inv(p) ==> canAdvanceClock(p, now, by_) ==> alwaysRuntimeSound(advanceClock(p, now, by_)))
  ensures (inv(p) ==> canAdvanceClock(p, now, by_) ==> alwaysPoolBounded(advanceClock(p, now, by_)))
  ensures (inv(p) ==> canAdvanceClock(p, now, by_) ==> alwaysDecisionsSignNothing(advanceClock(p, now, by_)))
  ensures (inv(p) ==> canAdvanceClock(p, now, by_) ==> alwaysBurnBounded(advanceClock(p, now, by_)))
  ensures (inv(p) ==> canAdvanceClock(p, now, by_) ==> stepRetained(p, advanceClock(p, now, by_)))
  ensures (inv(p) ==> canAdvanceClock(p, now, by_) ==> stepTotalsMonotonic(p, advanceClock(p, now, by_)))
  ensures (inv(p) ==> canAdvanceClock(p, now, by_) ==> stepSignaturesNeedLiveBuyback(p, "advanceClock", advanceClock(p, now, by_)))
{
  if inv(p) && canAdvanceClock(p, now, by_) {
    var after := advanceClock(p, now, by_);
    UnchangedTotals(p, after);
    WindowAfter(p.purchaseSpends, p.clock, now);
  }
}

lemma creditArrival_ensures(p: Pool, arrival: ArrivalCredit, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canCreditArrival(p, arrival, by_) ==> alwaysArrivalsOnce(creditArrival(p, arrival, by_)))
  ensures (inv(p) ==> canCreditArrival(p, arrival, by_) ==> alwaysLocalShareBounded(creditArrival(p, arrival, by_)))
  ensures (inv(p) ==> canCreditArrival(p, arrival, by_) ==> alwaysRuntimeSound(creditArrival(p, arrival, by_)))
  ensures (inv(p) ==> canCreditArrival(p, arrival, by_) ==> alwaysPoolBounded(creditArrival(p, arrival, by_)))
  ensures (inv(p) ==> canCreditArrival(p, arrival, by_) ==> alwaysDecisionsSignNothing(creditArrival(p, arrival, by_)))
  ensures (inv(p) ==> canCreditArrival(p, arrival, by_) ==> alwaysBurnBounded(creditArrival(p, arrival, by_)))
  ensures (inv(p) ==> canCreditArrival(p, arrival, by_) ==> stepRetained(p, creditArrival(p, arrival, by_)))
  ensures (inv(p) ==> canCreditArrival(p, arrival, by_) ==> stepTotalsMonotonic(p, creditArrival(p, arrival, by_)))
  ensures (inv(p) ==> canCreditArrival(p, arrival, by_) ==> stepSignaturesNeedLiveBuyback(p, "creditArrival", creditArrival(p, arrival, by_)))
{
  if inv(p) && canCreditArrival(p, arrival, by_) {
    var after := creditArrival(p, arrival, by_);
    var c0 := creditOf(p, usdg);
    var c1 := c0.(credit := c0.credit + arrival.takeAmount);
    CreditOfUnique(p, usdg);
    ZeroValidAndHalf();
    WithCreditPreserves(p, after, c1);
    settlement__money_lawEqualReflexive_ensures(p.purchased);
    settlement__money_lawEqualReflexive_ensures(p.burned);
    settlement__money_lawEqualReflexive_ensures(p.localSlopIncome);
    forall c | c in p.credits
      ensures settlement__money_compareAmounts(creditOf(after, c.asset).income, c.income) >= 0
    {
      if c.asset == usdg {
        assert c == c0;
        settlement__money_lawEqualReflexive_ensures(c.income);
      } else {
        settlement__money_lawEqualReflexive_ensures(c.income);
      }
    }
  }
}

lemma recordRobinhoodFee_ensures(p: Pool, robinhoodFee: RobinhoodFee, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canRecordRobinhoodFee(p, robinhoodFee, by_) ==> alwaysArrivalsOnce(recordRobinhoodFee(p, robinhoodFee, by_)))
  ensures (inv(p) ==> canRecordRobinhoodFee(p, robinhoodFee, by_) ==> alwaysLocalShareBounded(recordRobinhoodFee(p, robinhoodFee, by_)))
  ensures (inv(p) ==> canRecordRobinhoodFee(p, robinhoodFee, by_) ==> alwaysRuntimeSound(recordRobinhoodFee(p, robinhoodFee, by_)))
  ensures (inv(p) ==> canRecordRobinhoodFee(p, robinhoodFee, by_) ==> alwaysPoolBounded(recordRobinhoodFee(p, robinhoodFee, by_)))
  ensures (inv(p) ==> canRecordRobinhoodFee(p, robinhoodFee, by_) ==> alwaysDecisionsSignNothing(recordRobinhoodFee(p, robinhoodFee, by_)))
  ensures (inv(p) ==> canRecordRobinhoodFee(p, robinhoodFee, by_) ==> alwaysBurnBounded(recordRobinhoodFee(p, robinhoodFee, by_)))
  ensures (inv(p) ==> canRecordRobinhoodFee(p, robinhoodFee, by_) ==> stepRetained(p, recordRobinhoodFee(p, robinhoodFee, by_)))
  ensures (inv(p) ==> canRecordRobinhoodFee(p, robinhoodFee, by_) ==> stepTotalsMonotonic(p, recordRobinhoodFee(p, robinhoodFee, by_)))
  ensures (inv(p) ==> canRecordRobinhoodFee(p, robinhoodFee, by_) ==> stepSignaturesNeedLiveBuyback(p, "recordRobinhoodFee", recordRobinhoodFee(p, robinhoodFee, by_)))
{
  if inv(p) && canRecordRobinhoodFee(p, robinhoodFee, by_) {
    var after := recordRobinhoodFee(p, robinhoodFee, by_);
    var c0 := creditOf(p, robinhoodFee.asset);
    var inc := settlement__money_smallAmount(robinhoodFee.amount);
    var c1 := c0.(income := settlement__money_addAmounts(c0.income, inc));
    CreditOfUnique(p, robinhoodFee.asset);
    ZeroValidAndHalf();
    SmallAmountNonnegativeValid(robinhoodFee.amount);
    Grows(c0.income, inc);
    ShareUnderLargerIncome(c0.committed, c0.income, c1.income);
    WithCreditPreserves(p, after, c1);
    settlement__money_lawEqualReflexive_ensures(p.purchased);
    settlement__money_lawEqualReflexive_ensures(p.burned);
    settlement__money_lawEqualReflexive_ensures(p.localSlopIncome);
    forall c | c in p.credits
      ensures settlement__money_compareAmounts(creditOf(after, c.asset).income, c.income) >= 0
    {
      if c.asset == robinhoodFee.asset {
        assert c == c0;
      } else {
        settlement__money_lawEqualReflexive_ensures(c.income);
      }
    }
  }
}

lemma reserveLocalShare_ensures(p: Pool, asset: int, amount: int, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canReserveLocalShare(p, asset, amount, by_) ==> alwaysArrivalsOnce(reserveLocalShare(p, asset, amount, by_)))
  ensures (inv(p) ==> canReserveLocalShare(p, asset, amount, by_) ==> alwaysLocalShareBounded(reserveLocalShare(p, asset, amount, by_)))
  ensures (inv(p) ==> canReserveLocalShare(p, asset, amount, by_) ==> alwaysRuntimeSound(reserveLocalShare(p, asset, amount, by_)))
  ensures (inv(p) ==> canReserveLocalShare(p, asset, amount, by_) ==> alwaysPoolBounded(reserveLocalShare(p, asset, amount, by_)))
  ensures (inv(p) ==> canReserveLocalShare(p, asset, amount, by_) ==> alwaysDecisionsSignNothing(reserveLocalShare(p, asset, amount, by_)))
  ensures (inv(p) ==> canReserveLocalShare(p, asset, amount, by_) ==> alwaysBurnBounded(reserveLocalShare(p, asset, amount, by_)))
  ensures (inv(p) ==> canReserveLocalShare(p, asset, amount, by_) ==> stepRetained(p, reserveLocalShare(p, asset, amount, by_)))
  ensures (inv(p) ==> canReserveLocalShare(p, asset, amount, by_) ==> stepTotalsMonotonic(p, reserveLocalShare(p, asset, amount, by_)))
  ensures (inv(p) ==> canReserveLocalShare(p, asset, amount, by_) ==> stepSignaturesNeedLiveBuyback(p, "reserveLocalShare", reserveLocalShare(p, asset, amount, by_)))
{
  if inv(p) && canReserveLocalShare(p, asset, amount, by_) {
    var after := reserveLocalShare(p, asset, amount, by_);
    var c0 := creditOf(p, asset);
    var inc := settlement__money_smallAmount(amount);
    var c1 := c0.(committed := settlement__money_addAmounts(c0.committed, inc), credit := c0.credit + amount);
    CreditOfUnique(p, asset);
    ZeroValidAndHalf();
    SmallAmountNonnegativeValid(amount);
    Grows(c0.committed, inc);
    WithCreditPreserves(p, after, c1);
    settlement__money_lawEqualReflexive_ensures(p.purchased);
    settlement__money_lawEqualReflexive_ensures(p.burned);
    settlement__money_lawEqualReflexive_ensures(p.localSlopIncome);
    forall c | c in p.credits
      ensures settlement__money_compareAmounts(creditOf(after, c.asset).income, c.income) >= 0
    {
      if c.asset == asset {
        assert c == c0;
        settlement__money_lawEqualReflexive_ensures(c.income);
      } else {
        settlement__money_lawEqualReflexive_ensures(c.income);
      }
    }
  }
}

lemma publishWorker_ensures(p: Pool, config: fees__runtime_WorkerConfig, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canPublishWorker(p, config, by_) ==> alwaysArrivalsOnce(publishWorker(p, config, by_)))
  ensures (inv(p) ==> canPublishWorker(p, config, by_) ==> alwaysLocalShareBounded(publishWorker(p, config, by_)))
  ensures (inv(p) ==> canPublishWorker(p, config, by_) ==> alwaysRuntimeSound(publishWorker(p, config, by_)))
  ensures (inv(p) ==> canPublishWorker(p, config, by_) ==> alwaysPoolBounded(publishWorker(p, config, by_)))
  ensures (inv(p) ==> canPublishWorker(p, config, by_) ==> alwaysDecisionsSignNothing(publishWorker(p, config, by_)))
  ensures (inv(p) ==> canPublishWorker(p, config, by_) ==> alwaysBurnBounded(publishWorker(p, config, by_)))
  ensures (inv(p) ==> canPublishWorker(p, config, by_) ==> stepRetained(p, publishWorker(p, config, by_)))
  ensures (inv(p) ==> canPublishWorker(p, config, by_) ==> stepTotalsMonotonic(p, publishWorker(p, config, by_)))
  ensures (inv(p) ==> canPublishWorker(p, config, by_) ==> stepSignaturesNeedLiveBuyback(p, "publishWorker", publishWorker(p, config, by_)))
{
  if inv(p) && canPublishWorker(p, config, by_) {
    UnchangedTotals(p, publishWorker(p, config, by_));
  }
}

lemma setReleaseVariable_ensures(p: Pool, variable: bool, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canSetReleaseVariable(p, variable, by_) ==> alwaysArrivalsOnce(setReleaseVariable(p, variable, by_)))
  ensures (inv(p) ==> canSetReleaseVariable(p, variable, by_) ==> alwaysLocalShareBounded(setReleaseVariable(p, variable, by_)))
  ensures (inv(p) ==> canSetReleaseVariable(p, variable, by_) ==> alwaysRuntimeSound(setReleaseVariable(p, variable, by_)))
  ensures (inv(p) ==> canSetReleaseVariable(p, variable, by_) ==> alwaysPoolBounded(setReleaseVariable(p, variable, by_)))
  ensures (inv(p) ==> canSetReleaseVariable(p, variable, by_) ==> alwaysDecisionsSignNothing(setReleaseVariable(p, variable, by_)))
  ensures (inv(p) ==> canSetReleaseVariable(p, variable, by_) ==> alwaysBurnBounded(setReleaseVariable(p, variable, by_)))
  ensures (inv(p) ==> canSetReleaseVariable(p, variable, by_) ==> stepRetained(p, setReleaseVariable(p, variable, by_)))
  ensures (inv(p) ==> canSetReleaseVariable(p, variable, by_) ==> stepTotalsMonotonic(p, setReleaseVariable(p, variable, by_)))
  ensures (inv(p) ==> canSetReleaseVariable(p, variable, by_) ==> stepSignaturesNeedLiveBuyback(p, "setReleaseVariable", setReleaseVariable(p, variable, by_)))
{
  if inv(p) && canSetReleaseVariable(p, variable, by_) {
    UnchangedTotals(p, setReleaseVariable(p, variable, by_));
  }
}

lemma verifyReadiness_ensures(p: Pool, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canVerifyReadiness(p, by_) ==> alwaysArrivalsOnce(verifyReadiness(p, by_)))
  ensures (inv(p) ==> canVerifyReadiness(p, by_) ==> alwaysLocalShareBounded(verifyReadiness(p, by_)))
  ensures (inv(p) ==> canVerifyReadiness(p, by_) ==> alwaysRuntimeSound(verifyReadiness(p, by_)))
  ensures (inv(p) ==> canVerifyReadiness(p, by_) ==> alwaysPoolBounded(verifyReadiness(p, by_)))
  ensures (inv(p) ==> canVerifyReadiness(p, by_) ==> alwaysDecisionsSignNothing(verifyReadiness(p, by_)))
  ensures (inv(p) ==> canVerifyReadiness(p, by_) ==> alwaysBurnBounded(verifyReadiness(p, by_)))
  ensures (inv(p) ==> canVerifyReadiness(p, by_) ==> stepRetained(p, verifyReadiness(p, by_)))
  ensures (inv(p) ==> canVerifyReadiness(p, by_) ==> stepTotalsMonotonic(p, verifyReadiness(p, by_)))
  ensures (inv(p) ==> canVerifyReadiness(p, by_) ==> stepSignaturesNeedLiveBuyback(p, "verifyReadiness", verifyReadiness(p, by_)))
{
  if inv(p) && canVerifyReadiness(p, by_) {
    UnchangedTotals(p, verifyReadiness(p, by_));
  }
}

lemma beginRun_ensures(p: Pool, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canBeginRun(p, by_) ==> alwaysArrivalsOnce(beginRun(p, by_)))
  ensures (inv(p) ==> canBeginRun(p, by_) ==> alwaysLocalShareBounded(beginRun(p, by_)))
  ensures (inv(p) ==> canBeginRun(p, by_) ==> alwaysRuntimeSound(beginRun(p, by_)))
  ensures (inv(p) ==> canBeginRun(p, by_) ==> alwaysPoolBounded(beginRun(p, by_)))
  ensures (inv(p) ==> canBeginRun(p, by_) ==> alwaysDecisionsSignNothing(beginRun(p, by_)))
  ensures (inv(p) ==> canBeginRun(p, by_) ==> alwaysBurnBounded(beginRun(p, by_)))
  ensures (inv(p) ==> canBeginRun(p, by_) ==> stepRetained(p, beginRun(p, by_)))
  ensures (inv(p) ==> canBeginRun(p, by_) ==> stepTotalsMonotonic(p, beginRun(p, by_)))
  ensures (inv(p) ==> canBeginRun(p, by_) ==> stepSignaturesNeedLiveBuyback(p, "beginRun", beginRun(p, by_)))
{
  if inv(p) && canBeginRun(p, by_) {
    UnchangedTotals(p, beginRun(p, by_));
  }
}

lemma purchase_ensures(p: Pool, quote: PurchaseQuote, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canPurchase(p, quote, by_) ==> alwaysArrivalsOnce(purchase(p, quote, by_)))
  ensures (inv(p) ==> canPurchase(p, quote, by_) ==> alwaysLocalShareBounded(purchase(p, quote, by_)))
  ensures (inv(p) ==> canPurchase(p, quote, by_) ==> alwaysRuntimeSound(purchase(p, quote, by_)))
  ensures (inv(p) ==> canPurchase(p, quote, by_) ==> alwaysPoolBounded(purchase(p, quote, by_)))
  ensures (inv(p) ==> canPurchase(p, quote, by_) ==> alwaysDecisionsSignNothing(purchase(p, quote, by_)))
  ensures (inv(p) ==> canPurchase(p, quote, by_) ==> alwaysBurnBounded(purchase(p, quote, by_)))
  ensures (inv(p) ==> canPurchase(p, quote, by_) ==> stepRetained(p, purchase(p, quote, by_)))
  ensures (inv(p) ==> canPurchase(p, quote, by_) ==> stepTotalsMonotonic(p, purchase(p, quote, by_)))
  ensures (inv(p) ==> canPurchase(p, quote, by_) ==> stepSignaturesNeedLiveBuyback(p, "purchase", purchase(p, quote, by_)))
{
  if inv(p) && canPurchase(p, quote, by_) {
    var after := purchase(p, quote, by_);
    var c0 := creditOf(p, quote.asset);
    var c1 := c0.(credit := c0.credit - quote.amountIn);
    CreditOfUnique(p, quote.asset);
    ZeroValidAndHalf();
    WithCreditPreserves(p, after, c1);
    var sp := fees__buyback_Spend(quote.tx, p.clock, quote.spent, false);
    WindowAppendsNow(p.purchaseSpends, p.clock, sp);
    assert sp in after.purchaseSpends;
    settlement__money_lawEqualReflexive_ensures(p.purchased);
    settlement__money_lawEqualReflexive_ensures(p.burned);
    settlement__money_lawEqualReflexive_ensures(p.localSlopIncome);
    forall c | c in p.credits
      ensures settlement__money_compareAmounts(creditOf(after, c.asset).income, c.income) >= 0
    {
      if c.asset == quote.asset {
        assert c == c0;
        settlement__money_lawEqualReflexive_ensures(c.income);
      } else {
        settlement__money_lawEqualReflexive_ensures(c.income);
      }
    }
  }
}

lemma decidePurchase_ensures(p: Pool, quote: PurchaseQuote, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canDecidePurchase(p, quote, by_) ==> alwaysArrivalsOnce(decidePurchase(p, quote, by_)))
  ensures (inv(p) ==> canDecidePurchase(p, quote, by_) ==> alwaysLocalShareBounded(decidePurchase(p, quote, by_)))
  ensures (inv(p) ==> canDecidePurchase(p, quote, by_) ==> alwaysRuntimeSound(decidePurchase(p, quote, by_)))
  ensures (inv(p) ==> canDecidePurchase(p, quote, by_) ==> alwaysPoolBounded(decidePurchase(p, quote, by_)))
  ensures (inv(p) ==> canDecidePurchase(p, quote, by_) ==> alwaysDecisionsSignNothing(decidePurchase(p, quote, by_)))
  ensures (inv(p) ==> canDecidePurchase(p, quote, by_) ==> alwaysBurnBounded(decidePurchase(p, quote, by_)))
  ensures (inv(p) ==> canDecidePurchase(p, quote, by_) ==> stepRetained(p, decidePurchase(p, quote, by_)))
  ensures (inv(p) ==> canDecidePurchase(p, quote, by_) ==> stepTotalsMonotonic(p, decidePurchase(p, quote, by_)))
  ensures (inv(p) ==> canDecidePurchase(p, quote, by_) ==> stepSignaturesNeedLiveBuyback(p, "decidePurchase", decidePurchase(p, quote, by_)))
{
  if inv(p) && canDecidePurchase(p, quote, by_) {
    UnchangedTotals(p, decidePurchase(p, quote, by_));
  }
}

lemma loseSend_ensures(p: Pool, tx: int, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canLoseSend(p, tx, by_) ==> alwaysArrivalsOnce(loseSend(p, tx, by_)))
  ensures (inv(p) ==> canLoseSend(p, tx, by_) ==> alwaysLocalShareBounded(loseSend(p, tx, by_)))
  ensures (inv(p) ==> canLoseSend(p, tx, by_) ==> alwaysRuntimeSound(loseSend(p, tx, by_)))
  ensures (inv(p) ==> canLoseSend(p, tx, by_) ==> alwaysPoolBounded(loseSend(p, tx, by_)))
  ensures (inv(p) ==> canLoseSend(p, tx, by_) ==> alwaysDecisionsSignNothing(loseSend(p, tx, by_)))
  ensures (inv(p) ==> canLoseSend(p, tx, by_) ==> alwaysBurnBounded(loseSend(p, tx, by_)))
  ensures (inv(p) ==> canLoseSend(p, tx, by_) ==> stepRetained(p, loseSend(p, tx, by_)))
  ensures (inv(p) ==> canLoseSend(p, tx, by_) ==> stepTotalsMonotonic(p, loseSend(p, tx, by_)))
  ensures (inv(p) ==> canLoseSend(p, tx, by_) ==> stepSignaturesNeedLiveBuyback(p, "loseSend", loseSend(p, tx, by_)))
{
  if inv(p) && canLoseSend(p, tx, by_) {
    UnchangedTotals(p, loseSend(p, tx, by_));
  }
}

lemma settlePurchase_ensures(p: Pool, swap: SwapReceipt, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canSettlePurchase(p, swap, by_) ==> alwaysArrivalsOnce(settlePurchase(p, swap, by_)))
  ensures (inv(p) ==> canSettlePurchase(p, swap, by_) ==> alwaysLocalShareBounded(settlePurchase(p, swap, by_)))
  ensures (inv(p) ==> canSettlePurchase(p, swap, by_) ==> alwaysRuntimeSound(settlePurchase(p, swap, by_)))
  ensures (inv(p) ==> canSettlePurchase(p, swap, by_) ==> alwaysPoolBounded(settlePurchase(p, swap, by_)))
  ensures (inv(p) ==> canSettlePurchase(p, swap, by_) ==> alwaysDecisionsSignNothing(settlePurchase(p, swap, by_)))
  ensures (inv(p) ==> canSettlePurchase(p, swap, by_) ==> alwaysBurnBounded(settlePurchase(p, swap, by_)))
  ensures (inv(p) ==> canSettlePurchase(p, swap, by_) ==> stepRetained(p, settlePurchase(p, swap, by_)))
  ensures (inv(p) ==> canSettlePurchase(p, swap, by_) ==> stepTotalsMonotonic(p, settlePurchase(p, swap, by_)))
  ensures (inv(p) ==> canSettlePurchase(p, swap, by_) ==> stepSignaturesNeedLiveBuyback(p, "settlePurchase", settlePurchase(p, swap, by_)))
{
  if inv(p) && canSettlePurchase(p, swap, by_) {
    var after := settlePurchase(p, swap, by_);
    if swap.succeeded {
      Grows(p.purchased, swap.output);
      settlement__money_lawAdditionValid_ensures(p.purchased, p.localSlopCommitted);
      settlement__money_lawAdditionValid_ensures(after.purchased, p.localSlopCommitted);
      settlement__money_lawAddOrder_ensures(p.purchased, after.purchased, p.localSlopCommitted);
      ShareUnderLargerIncome(p.burnCommitted, acquired(p), acquired(after));
      settlement__money_lawEqualReflexive_ensures(p.burned);
      settlement__money_lawEqualReflexive_ensures(p.localSlopIncome);
      forall c | c in p.credits
        ensures settlement__money_compareAmounts(creditOf(after, c.asset).income, c.income) >= 0
      {
        CreditOfUnique(p, c.asset);
        settlement__money_lawEqualReflexive_ensures(c.income);
      }
    } else {
      var c0 := creditOf(p, p.purchaseAsset);
      var c1 := c0.(credit := c0.credit + p.purchase.amount);
      CreditOfUnique(p, p.purchaseAsset);
      ZeroValidAndHalf();
      WithCreditPreserves(p, after, c1);
      WindowRelease(p.purchaseSpends, p.purchase.tx, p.clock);
      settlement__money_lawEqualReflexive_ensures(p.purchased);
      settlement__money_lawEqualReflexive_ensures(p.burned);
      settlement__money_lawEqualReflexive_ensures(p.localSlopIncome);
      forall c | c in p.credits
        ensures settlement__money_compareAmounts(creditOf(after, c.asset).income, c.income) >= 0
      {
        if c.asset == p.purchaseAsset {
          assert c == c0;
          settlement__money_lawEqualReflexive_ensures(c.income);
        } else {
          settlement__money_lawEqualReflexive_ensures(c.income);
        }
      }
    }
  }
}

lemma receiveSlopFee_ensures(p: Pool, fee: SlopFee, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canReceiveSlopFee(p, fee, by_) ==> alwaysArrivalsOnce(receiveSlopFee(p, fee, by_)))
  ensures (inv(p) ==> canReceiveSlopFee(p, fee, by_) ==> alwaysLocalShareBounded(receiveSlopFee(p, fee, by_)))
  ensures (inv(p) ==> canReceiveSlopFee(p, fee, by_) ==> alwaysRuntimeSound(receiveSlopFee(p, fee, by_)))
  ensures (inv(p) ==> canReceiveSlopFee(p, fee, by_) ==> alwaysPoolBounded(receiveSlopFee(p, fee, by_)))
  ensures (inv(p) ==> canReceiveSlopFee(p, fee, by_) ==> alwaysDecisionsSignNothing(receiveSlopFee(p, fee, by_)))
  ensures (inv(p) ==> canReceiveSlopFee(p, fee, by_) ==> alwaysBurnBounded(receiveSlopFee(p, fee, by_)))
  ensures (inv(p) ==> canReceiveSlopFee(p, fee, by_) ==> stepRetained(p, receiveSlopFee(p, fee, by_)))
  ensures (inv(p) ==> canReceiveSlopFee(p, fee, by_) ==> stepTotalsMonotonic(p, receiveSlopFee(p, fee, by_)))
  ensures (inv(p) ==> canReceiveSlopFee(p, fee, by_) ==> stepSignaturesNeedLiveBuyback(p, "receiveSlopFee", receiveSlopFee(p, fee, by_)))
{
  if inv(p) && canReceiveSlopFee(p, fee, by_) {
    var after := receiveSlopFee(p, fee, by_);
    Grows(p.localSlopIncome, fee.quantity);
    settlement__half_lawHalfValid_ensures(after.localSlopIncome);
    settlement__money_lawEqualReflexive_ensures(after.localSlopCommitted);
    ShareUnderLargerIncome(p.localSlopCommitted, p.localSlopIncome, after.localSlopIncome);
    settlement__money_lawAdditionValid_ensures(p.purchased, p.localSlopCommitted);
    settlement__money_lawAdditionValid_ensures(p.purchased, after.localSlopCommitted);
    settlement__money_lawAddCommutative_ensures(p.purchased, p.localSlopCommitted);
    settlement__money_lawAddCommutative_ensures(p.purchased, after.localSlopCommitted);
    settlement__money_lawAddOrder_ensures(p.localSlopCommitted, after.localSlopCommitted, p.purchased);
    ShareUnderLargerIncome(p.burnCommitted, acquired(p), acquired(after));
    settlement__money_lawEqualReflexive_ensures(p.purchased);
    settlement__money_lawEqualReflexive_ensures(p.burned);
    forall c | c in p.credits
      ensures settlement__money_compareAmounts(creditOf(after, c.asset).income, c.income) >= 0
    {
      CreditOfUnique(p, c.asset);
      settlement__money_lawEqualReflexive_ensures(c.income);
    }
  }
}

lemma burn_ensures(p: Pool, burnRequest: BurnRequest, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canBurn(p, burnRequest, by_) ==> alwaysArrivalsOnce(burn(p, burnRequest, by_)))
  ensures (inv(p) ==> canBurn(p, burnRequest, by_) ==> alwaysLocalShareBounded(burn(p, burnRequest, by_)))
  ensures (inv(p) ==> canBurn(p, burnRequest, by_) ==> alwaysRuntimeSound(burn(p, burnRequest, by_)))
  ensures (inv(p) ==> canBurn(p, burnRequest, by_) ==> alwaysPoolBounded(burn(p, burnRequest, by_)))
  ensures (inv(p) ==> canBurn(p, burnRequest, by_) ==> alwaysDecisionsSignNothing(burn(p, burnRequest, by_)))
  ensures (inv(p) ==> canBurn(p, burnRequest, by_) ==> alwaysBurnBounded(burn(p, burnRequest, by_)))
  ensures (inv(p) ==> canBurn(p, burnRequest, by_) ==> stepRetained(p, burn(p, burnRequest, by_)))
  ensures (inv(p) ==> canBurn(p, burnRequest, by_) ==> stepTotalsMonotonic(p, burn(p, burnRequest, by_)))
  ensures (inv(p) ==> canBurn(p, burnRequest, by_) ==> stepSignaturesNeedLiveBuyback(p, "burn", burn(p, burnRequest, by_)))
{
  if inv(p) && canBurn(p, burnRequest, by_) {
    var after := burn(p, burnRequest, by_);
    var h := settlement__half_half(acquired(p)).quotient;
    var due := burnDue(p);
    UnchangedTotals(p, after);
    settlement__money_lawAdditionValid_ensures(p.purchased, p.localSlopCommitted);
    settlement__half_lawHalfValid_ensures(acquired(p));
    settlement__money_lawAdditionValid_ensures(p.burnCommitted, burnRequest.quantity);
    settlement__money_lawNumericOrderTotal_ensures(p.burnCommitted, h);
    settlement__money_lawSubtractionValid_ensures(h, p.burnCommitted);
    settlement__money_lawSubtractionReconstructs_ensures(h, p.burnCommitted);
    settlement__money_lawAddCongruence_ensures(burnRequest.quantity, due, p.burnCommitted);
    settlement__money_lawAddCommutative_ensures(p.burnCommitted, burnRequest.quantity);
    settlement__money_lawEqualSubstitution_ensures(after.burnCommitted, settlement__money_addAmounts(due, p.burnCommitted), h);
    settlement__money_lawEqualReflexive_ensures(after.burnCommitted);
  }
}

lemma settleBurn_ensures(p: Pool, receipt: SendReceipt, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canSettleBurn(p, receipt, by_) ==> alwaysArrivalsOnce(settleBurn(p, receipt, by_)))
  ensures (inv(p) ==> canSettleBurn(p, receipt, by_) ==> alwaysLocalShareBounded(settleBurn(p, receipt, by_)))
  ensures (inv(p) ==> canSettleBurn(p, receipt, by_) ==> alwaysRuntimeSound(settleBurn(p, receipt, by_)))
  ensures (inv(p) ==> canSettleBurn(p, receipt, by_) ==> alwaysPoolBounded(settleBurn(p, receipt, by_)))
  ensures (inv(p) ==> canSettleBurn(p, receipt, by_) ==> alwaysDecisionsSignNothing(settleBurn(p, receipt, by_)))
  ensures (inv(p) ==> canSettleBurn(p, receipt, by_) ==> alwaysBurnBounded(settleBurn(p, receipt, by_)))
  ensures (inv(p) ==> canSettleBurn(p, receipt, by_) ==> stepRetained(p, settleBurn(p, receipt, by_)))
  ensures (inv(p) ==> canSettleBurn(p, receipt, by_) ==> stepTotalsMonotonic(p, settleBurn(p, receipt, by_)))
  ensures (inv(p) ==> canSettleBurn(p, receipt, by_) ==> stepSignaturesNeedLiveBuyback(p, "settleBurn", settleBurn(p, receipt, by_)))
{
  if inv(p) && canSettleBurn(p, receipt, by_) {
    var after := settleBurn(p, receipt, by_);
    var burnedTotal := settlement__money_addAmounts(p.burned, p.burnQuantity);
    var h := settlement__half_half(acquired(p)).quotient;
    ZeroValidAndHalf();
    Grows(p.burned, p.burnQuantity);
    settlement__money_lawAdditionValid_ensures(p.purchased, p.localSlopCommitted);
    settlement__half_lawHalfValid_ensures(acquired(p));
    settlement__money_lawEqualOrder_ensures(p.burnCommitted, burnedTotal, h);
    settlement__money_lawNumericOrderTransitive_ensures(p.burned, burnedTotal, h);
    settlement__money_lawEqualReflexive_ensures(p.purchased);
    settlement__money_lawEqualReflexive_ensures(p.burned);
    settlement__money_lawEqualReflexive_ensures(p.localSlopIncome);
    forall c | c in p.credits
      ensures settlement__money_compareAmounts(creditOf(after, c.asset).income, c.income) >= 0
    {
      CreditOfUnique(p, c.asset);
      settlement__money_lawEqualReflexive_ensures(c.income);
    }
  }
}

lemma decideBurn_ensures(p: Pool, burnRequest: BurnRequest, by_: fees__runtime_Sender)
  ensures (inv(p) ==> canDecideBurn(p, burnRequest, by_) ==> alwaysArrivalsOnce(decideBurn(p, burnRequest, by_)))
  ensures (inv(p) ==> canDecideBurn(p, burnRequest, by_) ==> alwaysLocalShareBounded(decideBurn(p, burnRequest, by_)))
  ensures (inv(p) ==> canDecideBurn(p, burnRequest, by_) ==> alwaysRuntimeSound(decideBurn(p, burnRequest, by_)))
  ensures (inv(p) ==> canDecideBurn(p, burnRequest, by_) ==> alwaysPoolBounded(decideBurn(p, burnRequest, by_)))
  ensures (inv(p) ==> canDecideBurn(p, burnRequest, by_) ==> alwaysDecisionsSignNothing(decideBurn(p, burnRequest, by_)))
  ensures (inv(p) ==> canDecideBurn(p, burnRequest, by_) ==> alwaysBurnBounded(decideBurn(p, burnRequest, by_)))
  ensures (inv(p) ==> canDecideBurn(p, burnRequest, by_) ==> stepRetained(p, decideBurn(p, burnRequest, by_)))
  ensures (inv(p) ==> canDecideBurn(p, burnRequest, by_) ==> stepTotalsMonotonic(p, decideBurn(p, burnRequest, by_)))
  ensures (inv(p) ==> canDecideBurn(p, burnRequest, by_) ==> stepSignaturesNeedLiveBuyback(p, "decideBurn", decideBurn(p, burnRequest, by_)))
{
  if inv(p) && canDecideBurn(p, burnRequest, by_) {
    UnchangedTotals(p, decideBurn(p, burnRequest, by_));
  }
}
