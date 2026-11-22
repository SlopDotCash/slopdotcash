// Generic limb-amount rearrangements used by the escrow conservation proofs.

lemma EscChain(a: seq<int>, b: seq<int>, c: seq<int>)
  requires settlement__money_equalAmounts(a, b) && settlement__money_equalAmounts(b, c)
  ensures settlement__money_equalAmounts(a, c)
{
  settlement__money_lawEqualSubstitution_ensures(a, b, c);
}

lemma EscSym(a: seq<int>, b: seq<int>)
  requires settlement__money_equalAmounts(a, b)
  ensures settlement__money_equalAmounts(b, a)
{
  settlement__money_lawEqualSymmetric_ensures(a, b);
}

lemma EscMove(t: seq<int>, a: seq<int>, b: seq<int>, x: seq<int>)
  requires settlement__money_validAmount(t) && settlement__money_validAmount(a) && settlement__money_validAmount(b) && settlement__money_validAmount(x)
  requires settlement__money_compareAmounts(a, x) >= 0
  requires settlement__money_equalAmounts(t, settlement__money_addAmounts(a, b))
  ensures settlement__money_equalAmounts(t, settlement__money_addAmounts(settlement__money_subtractAmounts(a, x), settlement__money_addAmounts(b, x)))
  ensures settlement__money_equalAmounts(t, settlement__money_addAmounts(settlement__money_addAmounts(b, x), settlement__money_subtractAmounts(a, x)))
{
  var rest := settlement__money_subtractAmounts(a, x);
  var reconstructed := settlement__money_addAmounts(rest, x);
  settlement__money_lawSubtractionValid_ensures(a, x);
  settlement__money_lawAdditionValid_ensures(rest, x);
  settlement__money_lawAdditionValid_ensures(b, x);
  settlement__money_lawSubtractionReconstructs_ensures(a, x);
  settlement__money_lawAddCongruence_ensures(reconstructed, a, b);
  settlement__money_lawAddAssociative_ensures(rest, x, b);
  settlement__money_lawAddCommutative_ensures(x, b);
  var sum := settlement__money_addAmounts(a, b);
  var equivalent := settlement__money_addAmounts(reconstructed, b);
  EscSym(equivalent, sum);
  EscChain(sum, equivalent, settlement__money_addAmounts(rest, settlement__money_addAmounts(b, x)));
  EscChain(t, sum, settlement__money_addAmounts(rest, settlement__money_addAmounts(b, x)));
  settlement__money_lawAddCommutative_ensures(rest, settlement__money_addAmounts(b, x));
}

lemma EscAddLeft(t: seq<int>, a: seq<int>, b: seq<int>, x: seq<int>)
  requires settlement__money_validAmount(t) && settlement__money_validAmount(a) && settlement__money_validAmount(b) && settlement__money_validAmount(x)
  requires settlement__money_equalAmounts(t, settlement__money_addAmounts(a, b))
  ensures settlement__money_equalAmounts(settlement__money_addAmounts(t, x), settlement__money_addAmounts(settlement__money_addAmounts(a, x), b))
  ensures settlement__money_equalAmounts(settlement__money_addAmounts(t, x), settlement__money_addAmounts(a, settlement__money_addAmounts(b, x)))
{
  var ab := settlement__money_addAmounts(a, b);
  settlement__money_lawAdditionValid_ensures(a, b);
  settlement__money_lawAdditionValid_ensures(a, x);
  settlement__money_lawAdditionValid_ensures(b, x);
  settlement__money_lawAddCongruence_ensures(t, ab, x);
  settlement__money_lawAddAssociative_ensures(a, b, x);
  EscChain(settlement__money_addAmounts(t, x), settlement__money_addAmounts(ab, x), settlement__money_addAmounts(a, settlement__money_addAmounts(b, x)));
  settlement__money_lawAddCommutative_ensures(b, x);
  settlement__money_lawAddAssociative_ensures(a, x, b);
  EscSym(settlement__money_addAmounts(settlement__money_addAmounts(a, x), b), settlement__money_addAmounts(a, settlement__money_addAmounts(x, b)));
  EscChain(settlement__money_addAmounts(t, x), settlement__money_addAmounts(a, settlement__money_addAmounts(x, b)), settlement__money_addAmounts(settlement__money_addAmounts(a, x), b));
}

lemma EscCancel(y: seq<int>, x: seq<int>)
  requires settlement__money_validAmount(y) && settlement__money_validAmount(x)
  ensures settlement__money_compareAmounts(settlement__money_addAmounts(y, x), x) >= 0
  ensures settlement__money_equalAmounts(settlement__money_subtractAmounts(settlement__money_addAmounts(y, x), x), y)
{
  var yx := settlement__money_addAmounts(y, x);
  settlement__money_lawAdditionValid_ensures(y, x);
  settlement__money_lawAddCommutative_ensures(y, x);
  settlement__money_lawAddMonotone_ensures(x, y);
  settlement__money_lawSubtractionValid_ensures(yx, x);
  settlement__money_lawSubtractionReconstructs_ensures(yx, x);
  var r := settlement__money_subtractAmounts(yx, x);
  settlement__money_lawAddOrder_ensures(r, y, x);
}

lemma EscSubLeft(t: seq<int>, a: seq<int>, b: seq<int>, x: seq<int>)
  requires settlement__money_validAmount(t) && settlement__money_validAmount(a) && settlement__money_validAmount(b) && settlement__money_validAmount(x)
  requires settlement__money_compareAmounts(a, x) >= 0 && settlement__money_compareAmounts(t, x) >= 0
  requires settlement__money_equalAmounts(t, settlement__money_addAmounts(a, b))
  ensures settlement__money_equalAmounts(settlement__money_subtractAmounts(t, x), settlement__money_addAmounts(settlement__money_subtractAmounts(a, x), b))
{
  var rest := settlement__money_subtractAmounts(a, x);
  var y := settlement__money_addAmounts(rest, b);
  settlement__money_lawSubtractionValid_ensures(a, x);
  settlement__money_lawAdditionValid_ensures(rest, b);
  settlement__money_lawAdditionValid_ensures(rest, x);
  settlement__money_lawSubtractionReconstructs_ensures(a, x);
  // t = a + b = (rest + x) + b = (rest + b) + x
  settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(rest, x), a, b);
  EscSym(settlement__money_addAmounts(settlement__money_addAmounts(rest, x), b), settlement__money_addAmounts(a, b));
  EscChain(t, settlement__money_addAmounts(a, b), settlement__money_addAmounts(settlement__money_addAmounts(rest, x), b));
  settlement__money_lawEqualReflexive_ensures(y);
  EscAddLeft(y, rest, b, x);
  settlement__money_lawEqualReflexive_ensures(y);
  EscSym(settlement__money_addAmounts(y, x), settlement__money_addAmounts(settlement__money_addAmounts(rest, x), b));
  EscChain(t, settlement__money_addAmounts(settlement__money_addAmounts(rest, x), b), settlement__money_addAmounts(y, x));
  settlement__money_lawAdditionValid_ensures(y, x);
  settlement__money_lawSubtractCongruence_ensures(t, settlement__money_addAmounts(y, x), x);
  EscCancel(y, x);
  EscChain(settlement__money_subtractAmounts(t, x), settlement__money_subtractAmounts(settlement__money_addAmounts(y, x), x), y);
}

lemma EscSubRight(t: seq<int>, a: seq<int>, b: seq<int>, x: seq<int>)
  requires settlement__money_validAmount(t) && settlement__money_validAmount(a) && settlement__money_validAmount(b) && settlement__money_validAmount(x)
  requires settlement__money_compareAmounts(b, x) >= 0 && settlement__money_compareAmounts(t, x) >= 0
  requires settlement__money_equalAmounts(t, settlement__money_addAmounts(a, b))
  ensures settlement__money_equalAmounts(settlement__money_subtractAmounts(t, x), settlement__money_addAmounts(a, settlement__money_subtractAmounts(b, x)))
{
  settlement__money_lawAddCommutative_ensures(a, b);
  EscSubLeft(t, b, a, x);
  settlement__money_lawAddCommutative_ensures(settlement__money_subtractAmounts(b, x), a);
}

// ---- The whole reserve release (plan item 12) ----

// The month a period names is in the list, and it is the only month of that period.
lemma EscMonthFor(e: Escrow, p: int)
  requires alwaysMonths(e)
  ensures monthFor(e, p).period > 0 ==> monthFor(e, p) in e.months && monthFor(e, p).period == p
  ensures monthFor(e, p).period > 0 ==> forall y :: y in e.months && y.period == p ==> y == monthFor(e, p)
{
  var period := p;
  ProofLib.FilterMember((m: MonthReserve) => (m.period == period), e.months, monthFor(e, p));
  if monthFor(e, p).period > 0 {
    var m0 := monthFor(e, p);
    assert m0 in e.months;
    forall y | y in e.months && y.period == p ensures y == m0 {
      ProofLib.FilterMember((other: MonthReserve) => (other.period == m0.period), e.months, y);
      ProofLib.FilterMember((other: MonthReserve) => (other.period == m0.period), e.months, m0);
    }
  }
}

// A fold that keeps the last pledge of a period returns the one pledge of that period.
lemma EscFoldPick(f: (Pledge, Pledge) -> Pledge, q: int, init: Pledge, xs: seq<Pledge>, x: Pledge)
  requires forall acc: Pledge, y: Pledge :: f(acc, y) == (if y.period == q then y else acc)
  requires x in xs && x.period == q
  requires forall i, j :: 0 <= i < |xs| && 0 <= j < |xs| && xs[i].period == q && xs[j].period == q ==> i == j
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) == x
  decreases |xs|
{
  if xs[0] == x {
    assert forall y :: y in xs[1..] ==> y.period != q;
    EscFoldNone(f, q, f(init, xs[0]), xs[1..]);
  } else {
    assert x in xs[1..];
    EscFoldPick(f, q, f(init, xs[0]), xs[1..], x);
  }
}

lemma EscFoldNone(f: (Pledge, Pledge) -> Pledge, q: int, init: Pledge, xs: seq<Pledge>)
  requires forall acc: Pledge, y: Pledge :: f(acc, y) == (if y.period == q then y else acc)
  requires forall y :: y in xs ==> y.period != q
  ensures Std.Collections.Seq.FoldLeft(f, init, xs) == init
  decreases |xs|
{
  if |xs| > 0 { assert xs[0] in xs; EscFoldNone(f, q, f(init, xs[0]), xs[1..]); }
}

// With one pledge per period, the pledge of a period is that pledge.
lemma EscPledgeOf(e: Escrow, x: Pledge)
  requires alwaysPledgesCovered(e) && x in e.pledges
  ensures pledgeOf(e, x.period) == x
{
  var period := x.period;
  forall i, j | 0 <= i < |e.pledges| && 0 <= j < |e.pledges| && e.pledges[i].period == period && e.pledges[j].period == period
    ensures i == j
  {
    if i != j {
      ProofLib.FilterTwo((o: Pledge) => (o.period == x.period), e.pledges, i, j);
    }
  }
  EscFoldPick((found: Pledge, p: Pledge) => (if (p.period == period) then p else found), period, noPledge, e.pledges, x);
}

// An amount equal to another leaves zero when it is subtracted from it.
lemma EscSelfZero(r: seq<int>, g: seq<int>)
  requires settlement__money_validAmount(r) && settlement__money_validAmount(g) && settlement__money_equalAmounts(g, r)
  ensures settlement__money_validAmount(settlement__money_subtractAmounts(r, g))
  ensures settlement__money_equalAmounts(settlement__money_subtractAmounts(r, g), settlement__money_zero)
{
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z);
  var d := settlement__money_subtractAmounts(r, g);
  settlement__money_lawSubtractionValid_ensures(r, g);
  EscSym(g, r);
  settlement__money_lawSubtractionReconstructs_ensures(r, g);
  settlement__money_lawZeroIdentity_ensures(g);
  settlement__money_lawAddCommutative_ensures(g, z);
  EscChain(settlement__money_addAmounts(z, g), g, r);
  EscSym(settlement__money_addAmounts(z, g), r);
  EscChain(settlement__money_addAmounts(d, g), r, settlement__money_addAmounts(z, g));
  settlement__money_lawAddOrder_ensures(d, z, g);
}

// A valid amount that is not positive adds nothing.
lemma EscZeroAdd(z0: seq<int>, g: seq<int>)
  requires settlement__money_validAmount(z0) && settlement__money_validAmount(g) && !settlement__money_positiveAmount(z0)
  ensures settlement__money_equalAmounts(settlement__money_addAmounts(z0, g), g)
  ensures settlement__money_validAmount(settlement__money_addAmounts(z0, g))
{
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z);
  settlement__money_lawZeroOrder_ensures(z0);
  assert settlement__money_equalAmounts(z0, z);
  settlement__money_lawAddCongruence_ensures(z0, z, g);
  settlement__money_lawZeroIdentity_ensures(g);
  settlement__money_lawAddCommutative_ensures(g, z);
  EscChain(settlement__money_addAmounts(z0, g), settlement__money_addAmounts(z, g), g);
  settlement__money_lawAdditionValid_ensures(z0, g);
}

// The months after a whole release: the released month holds no remainder and its whole admitted gross as released.
lemma EscReleaseMonths(e: Escrow, release: ReleaseAuthorization, ev: ChainEvent, by_: string)
  requires alwaysMonths(e) && alwaysTouchedMonthsShrink(e) && alwaysReleaseWhole(e) && alwaysEvmReleaseWhole(e)
  requires canReleaseReserve(e, release, ev, by_)
  ensures alwaysMonths(releaseReserve(e, release, ev, by_))
  ensures alwaysEvmReleaseWhole(releaseReserve(e, release, ev, by_))
  ensures alwaysTouchedMonthsShrink(releaseReserve(e, release, ev, by_))
  ensures alwaysReleaseWhole(releaseReserve(e, release, ev, by_))
  ensures forall q :: hasMonth(releaseReserve(e, release, ev, by_), q) == hasMonth(e, q)
  ensures stepMonthsRetained(e, releaseReserve(e, release, ev, by_))
{
  var after := releaseReserve(e, release, ev, by_);
  var p := release.period;
  var g := release.releasedGross;
  var m0 := monthFor(e, p);
  EscMonthFor(e, p);
  assert m0 in e.months;
  var r1 := settlement__money_subtractAmounts(m0.remaining, g);
  var d1 := settlement__money_addAmounts(m0.released, g);
  EscSelfZero(m0.remaining, g);
  EscZeroAdd(m0.released, g);
  EscChain(d1, g, m0.remaining);
  EscChain(d1, m0.remaining, m0.admittedGross);
  EscChain(g, m0.remaining, m0.admittedGross);
  settlement__money_lawEqualOrder_ensures(g, m0.admittedGross, settlement__money_zero);
  assert settlement__money_positiveAmount(m0.admittedGross);
  assert !leafTouched(e, p);
  settlement__money_lawZeroOrder_ensures(m0.admittedGross);
  settlement__money_lawNumericOrderTotal_ensures(m0.admittedGross, settlement__money_zero);
  settlement__money_lawEqualOrder_ensures(r1, settlement__money_zero, m0.admittedGross);
  assert settlement__money_compareAmounts(r1, m0.admittedGross) < 0;
  var up := m0.(remaining := r1, released := d1);
  assert |after.months| == |e.months|;
  forall i | 0 <= i < |e.months| ensures after.months[i] == (if e.months[i].period == p then up else e.months[i]) {
    if e.months[i].period == p { assert e.months[i] in e.months; }
  }
  assert after.awards == e.awards && after.releasedLeaves == e.releasedLeaves && after.asset == e.asset;
  forall m | m in after.months ensures m == up || m in e.months {
    var i :| 0 <= i < |after.months| && after.months[i] == m;
    assert e.months[i] in e.months;
  }
  forall a | a in e.months ensures exists b :: b in after.months && sameMonthTerms(a, b) {
    var i :| 0 <= i < |e.months| && e.months[i] == a;
    assert after.months[i] in after.months;
  }
  forall q ensures hasMonth(after, q) == hasMonth(e, q) {
    if hasMonth(e, q) {
      var a :| a in e.months && a.period == q;
      var i :| 0 <= i < |e.months| && e.months[i] == a;
      assert after.months[i] in after.months;
    }
  }
  forall m | m in after.months ensures |ProofLib.Filter((other: MonthReserve) => (other.period == m.period), after.months)| == 1 {
    var i :| 0 <= i < |after.months| && after.months[i] == m;
    var mo := e.months[i];
    assert mo in e.months && mo.period == m.period;
    ProofLib.FilterLengthPointwise((other: MonthReserve) => (other.period == m.period), (other: MonthReserve) => (other.period == m.period), e.months, after.months);
    ProofLib.FilterSamePredicate((other: MonthReserve) => (other.period == m.period), (other: MonthReserve) => (other.period == mo.period), e.months);
  }
}

// The conservation identities after a whole release: the released gross moves from the pool reserve to free funds.
lemma EscReleaseGross(e: Escrow, release: ReleaseAuthorization, ev: ChainEvent, by_: string)
  requires alwaysGrossConserved(e) && alwaysValidCounters(e) && canReleaseReserve(e, release, ev, by_)
  ensures alwaysGrossConserved(releaseReserve(e, release, ev, by_))
  ensures alwaysValidCounters(releaseReserve(e, release, ev, by_))
  ensures settlement__money_compareAmounts(releaseReserve(e, release, ev, by_).free, e.free) >= 0
  ensures settlement__money_compareAmounts(releaseReserve(e, release, ev, by_).pending, e.pending) <= 0
{
  var after := releaseReserve(e, release, ev, by_);
  var g := release.releasedGross;
  settlement__money_lawAddCommutative_ensures(e.free, e.committed);
  EscMove(e.held, e.committed, e.free, g);
  EscSubLeft(e.committed, e.pending, e.reserved, g);
  settlement__money_lawAdditionValid_ensures(e.free, g);
  settlement__money_lawSubtractionValid_ensures(e.pending, g);
  settlement__money_lawSubtractionValid_ensures(e.committed, g);
  settlement__money_lawAddMonotone_ensures(e.free, g);
  settlement__money_lawSubtractionAtMost_ensures(e.pending, g);
}

// A whole release keeps free funds above every open pledge, since it only raises them.
lemma EscReleasePledges(e: Escrow, release: ReleaseAuthorization, ev: ChainEvent, by_: string)
  requires alwaysPledgesCovered(e) && alwaysValidCounters(e) && canReleaseReserve(e, release, ev, by_)
  requires forall q :: hasMonth(releaseReserve(e, release, ev, by_), q) == hasMonth(e, q)
  requires settlement__money_compareAmounts(releaseReserve(e, release, ev, by_).free, e.free) >= 0
  requires settlement__money_validAmount(releaseReserve(e, release, ev, by_).free)
  ensures alwaysPledgesCovered(releaseReserve(e, release, ev, by_))
  ensures stepPledgeIrrevocable(e, "releaseReserve", releaseReserve(e, release, ev, by_))
{
  var after := releaseReserve(e, release, ev, by_);
  assert after.pledges == e.pledges && after.pledged == e.pledged;
  settlement__money_lawNumericOrderTotal_ensures(after.free, e.free);
  settlement__money_lawNumericOrderTotal_ensures(e.free, e.pledged);
  settlement__money_lawNumericOrderTransitive_ensures(e.pledged, e.free, after.free);
  settlement__money_lawNumericOrderTotal_ensures(after.free, e.pledged);
  forall x | x in e.pledges ensures pledgeOf(after, x.period) == x && settlement__money_compareAmounts(x.amount, x.amount) >= 0 {
    EscPledgeOf(e, x);
    settlement__money_lawEqualReflexive_ensures(x.amount);
  }
}

// Awards keep their validity: months keep their periods.
lemma EscReleaseAwards(e: Escrow, release: ReleaseAuthorization, ev: ChainEvent, by_: string)
  requires alwaysAwards(e) && canReleaseReserve(e, release, ev, by_)
  requires forall q :: hasMonth(releaseReserve(e, release, ev, by_), q) == hasMonth(e, q)
  ensures alwaysAwards(releaseReserve(e, release, ev, by_))
  ensures stepAwardsRetained(e, releaseReserve(e, release, ev, by_))
{
  var after := releaseReserve(e, release, ev, by_);
  assert after.awards == e.awards && after.purpose == e.purpose;
  forall a | a in after.awards ensures validAward(after, a) { assert validAward(e, a); }
}

// The cumulative counters do not move.
lemma EscReleaseCounters(e: Escrow, release: ReleaseAuthorization, ev: ChainEvent, by_: string)
  ensures stepCumulativeCounters(e, releaseReserve(e, release, ev, by_))
{
  settlement__money_lawEqualReflexive_ensures(e.deposited);
  settlement__money_lawEqualReflexive_ensures(e.paid);
  settlement__money_lawEqualReflexive_ensures(e.paidNet);
  settlement__money_lawEqualReflexive_ensures(e.payoutFees);
  settlement__money_lawEqualReflexive_ensures(e.grossWithdrawn);
  settlement__money_lawEqualReflexive_ensures(e.withdrawalFees);
  settlement__money_lawEqualReflexive_ensures(e.claimedFees);
}

lemma releaseReserve_ensures(e: Escrow, release: ReleaseAuthorization, ev: ChainEvent, by_: string)
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> alwaysEvmReleaseWhole(releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> alwaysTouchedMonthsShrink(releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> alwaysReleaseWhole(releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> alwaysGrossConserved(releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> alwaysReservedSplit(releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> alwaysPaidSplit(releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> alwaysFeesConserved(releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> alwaysValidCounters(releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> alwaysWithdrawalFees(releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> alwaysMonths(releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> alwaysBountyVaultHasNoMonths(releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> alwaysUndeployedEmpty(releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> alwaysPledgesCovered(releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> alwaysAwards(releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> stepEventOrder(e, releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> stepIdentityFixed(e, releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> stepAwardsRetained(e, releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> stepMonthsRetained(e, releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> stepWithdrawalsRetained(e, releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> stepCumulativeCounters(e, releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "releaseReserve", releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "releaseReserve", releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> stepFreeEntersOnlyByDepositOrRelease(e, "releaseReserve", releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> stepManualBlockedWhilePoolPending(e, "releaseReserve", releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> stepImplementationOnlyUpgrades(e, releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> stepReleaseNeedsUpgrade(e, "releaseReserve", releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> stepOneRootPerPeriod(e, "releaseReserve", releaseReserve(e, release, ev, by_)))
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> stepPledgeIrrevocable(e, "releaseReserve", releaseReserve(e, release, ev, by_)))
{
  if inv(e) && canReleaseReserve(e, release, ev, by_) {
    EscReleaseMonths(e, release, ev, by_);
    EscReleaseGross(e, release, ev, by_);
    EscReleasePledges(e, release, ev, by_);
    EscReleaseAwards(e, release, ev, by_);
    EscReleaseCounters(e, release, ev, by_);
  }
}
