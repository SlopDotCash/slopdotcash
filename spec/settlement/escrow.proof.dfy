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
  requires alwaysAwards(e) && alwaysReleasedLeavesAdmitted(e) && canReleaseReserve(e, release, ev, by_)
  requires forall q :: hasMonth(releaseReserve(e, release, ev, by_), q) == hasMonth(e, q)
  ensures alwaysAwards(releaseReserve(e, release, ev, by_))
  ensures alwaysReleasedLeavesAdmitted(releaseReserve(e, release, ev, by_))
  ensures stepAwardsRetained(e, releaseReserve(e, release, ev, by_))
{
  var after := releaseReserve(e, release, ev, by_);
  assert after.awards == e.awards && after.purpose == e.purpose && after.releasedLeaves == e.releasedLeaves;
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
  ensures (inv(e) ==> canReleaseReserve(e, release, ev, by_) ==> alwaysReleasedLeavesAdmitted(releaseReserve(e, release, ev, by_)))
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

// ---- Frames: what a transition leaves unchanged keeps every rule over it ----

// The gross and fee counters, unchanged: conservation, the splits and the counter step rules hold again.
lemma EscCountersSame(e: Escrow, a: Escrow, via: string)
  requires alwaysGrossConserved(e) && alwaysReservedSplit(e) && alwaysPaidSplit(e) && alwaysFeesConserved(e)
  requires a.deposited == e.deposited && a.held == e.held && a.committed == e.committed && a.spent == e.spent
  requires a.free == e.free && a.pending == e.pending && a.reserved == e.reserved && a.reservedPrincipal == e.reservedPrincipal
  requires a.reservedFees == e.reservedFees && a.paid == e.paid && a.paidNet == e.paidNet && a.payoutFees == e.payoutFees
  requires a.grossWithdrawn == e.grossWithdrawn && a.withdrawalFees == e.withdrawalFees && a.accruedFees == e.accruedFees
  requires a.claimedFees == e.claimedFees
  ensures alwaysGrossConserved(a) && alwaysReservedSplit(a) && alwaysPaidSplit(a) && alwaysFeesConserved(a)
  ensures stepCumulativeCounters(e, a)
  ensures stepPoolLeavesOnlyByLeafOrRelease(e, via, a) && stepFreeLeavesOnlyByOwnerOrRoot(e, via, a)
  ensures stepFreeEntersOnlyByDepositOrRelease(e, via, a)
{
  settlement__money_lawEqualReflexive_ensures(e.deposited);
  settlement__money_lawEqualReflexive_ensures(e.paid);
  settlement__money_lawEqualReflexive_ensures(e.paidNet);
  settlement__money_lawEqualReflexive_ensures(e.payoutFees);
  settlement__money_lawEqualReflexive_ensures(e.grossWithdrawn);
  settlement__money_lawEqualReflexive_ensures(e.withdrawalFees);
  settlement__money_lawEqualReflexive_ensures(e.claimedFees);
  settlement__money_lawEqualReflexive_ensures(e.pending);
  settlement__money_lawEqualReflexive_ensures(e.free);
}

// Valid counters, unchanged with the cap and the network.
lemma EscValidSame(e: Escrow, a: Escrow)
  requires alwaysValidCounters(e)
  requires a.deposited == e.deposited && a.held == e.held && a.committed == e.committed && a.spent == e.spent
  requires a.free == e.free && a.pending == e.pending && a.reserved == e.reserved && a.reservedPrincipal == e.reservedPrincipal
  requires a.reservedFees == e.reservedFees && a.paid == e.paid && a.paidNet == e.paidNet && a.payoutFees == e.payoutFees
  requires a.grossWithdrawn == e.grossWithdrawn && a.withdrawalFees == e.withdrawalFees && a.accruedFees == e.accruedFees
  requires a.claimedFees == e.claimedFees && a.monthlyCap == e.monthlyCap && a.asset.network == e.asset.network
  ensures alwaysValidCounters(a)
{
}

// Months, awards, released leaves and withdrawals, unchanged: the month, award and withdrawal rules hold again,
// and so do their step rules. An empty history needs no fixed asset or purpose.
lemma EscHistorySame(e: Escrow, a: Escrow, via: string)
  requires alwaysEvmReleaseWhole(e) && alwaysTouchedMonthsShrink(e) && alwaysReleaseWhole(e)
  requires alwaysWithdrawalFees(e) && alwaysMonths(e) && alwaysAwards(e) && alwaysReleasedLeavesAdmitted(e)
  requires a.months == e.months && a.awards == e.awards && a.releasedLeaves == e.releasedLeaves && a.withdrawals == e.withdrawals
  requires (|e.months| == 0 && |e.awards| == 0) || (a.asset == e.asset && a.purpose == e.purpose)
  requires via != "admitRoot" && via != "admitLegacyMonth"
  ensures alwaysEvmReleaseWhole(a) && alwaysTouchedMonthsShrink(a) && alwaysReleaseWhole(a)
  ensures alwaysWithdrawalFees(a) && alwaysMonths(a) && alwaysAwards(a) && alwaysReleasedLeavesAdmitted(a)
  ensures stepAwardsRetained(e, a) && stepMonthsRetained(e, a) && stepWithdrawalsRetained(e, a)
  ensures stepOneRootPerPeriod(e, via, a)
{
  forall x | x in e.awards ensures exists y :: y in a.awards && sameAwardTerms(x, y) && (!x.paid || x == y) {
    assert x in a.awards && sameAwardTerms(x, x);
  }
  forall x | x in e.months ensures exists y :: y in a.months && sameMonthTerms(x, y) {
    assert x in a.months && sameMonthTerms(x, x);
  }
  if |e.months| == 0 && |e.awards| == 0 {
    assert forall m :: m !in a.months;
    assert forall x :: x !in a.awards;
  } else {
    forall x | x in a.awards ensures validAward(a, x) {
      assert x in e.awards && validAward(e, x);
      if x.origin.MonthlyLeaf? { assert hasMonth(e, x.period); var m :| m in e.months && m.period == x.period; assert m in a.months; }
    }
  }
}

// Pledges and the pledged total unchanged, with free funds still covering them: the pledge rules hold again and no
// pledge falls.
lemma EscPledgesSame(e: Escrow, a: Escrow, via: string)
  requires alwaysPledgesCovered(e)
  requires a.pledges == e.pledges && a.pledged == e.pledged && settlement__money_compareAmounts(a.free, e.pledged) >= 0
  requires |e.pledges| == 0 || ((forall q :: hasMonth(a, q) == hasMonth(e, q)) && a.asset == e.asset && a.purpose == e.purpose && a.deployed == e.deployed)
  ensures alwaysPledgesCovered(a) && stepPledgeIrrevocable(e, via, a)
{
  forall x | x in e.pledges ensures pledgeOf(a, x.period) == x && settlement__money_compareAmounts(x.amount, x.amount) >= 0 {
    EscPledgeOf(e, x);
    assert pledgeOf(a, x.period) == pledgeOf(e, x.period);
    settlement__money_lawEqualReflexive_ensures(x.amount);
  }
  if |e.pledges| != 0 {
    forall p | p in a.pledges && p.open && hasMonth(a, p.period) ensures a.asset.network.Solana? {
      assert hasMonth(e, p.period);
    }
  }
}

// ---- Deploy: an empty vault takes its identity ----

lemma EscDeployValid(e: Escrow, asset: AssetIdentity, mint: MintFacts, purpose: VaultPurpose, delay: int, cap: seq<int>, turnOn: bool)
  requires alwaysValidCounters(e) && alwaysUndeployedEmpty(e) && canDeploy(e, asset, mint, purpose, delay, cap, turnOn)
  ensures alwaysValidCounters(deploy(e, asset, mint, purpose, delay, cap, turnOn))
{
  var mx := maxFor(asset.network);
  assert settlement__money_validAmount(mx);
  settlement__money_lawEqualOrder_ensures(e.deposited, settlement__money_zero, mx);
  settlement__money_lawZeroOrder_ensures(mx);
}

lemma EscDeployShape(e: Escrow, asset: AssetIdentity, mint: MintFacts, purpose: VaultPurpose, delay: int, cap: seq<int>, turnOn: bool)
  requires alwaysUndeployedEmpty(e) && canDeploy(e, asset, mint, purpose, delay, cap, turnOn)
  ensures alwaysBountyVaultHasNoMonths(deploy(e, asset, mint, purpose, delay, cap, turnOn))
  ensures alwaysUndeployedEmpty(deploy(e, asset, mint, purpose, delay, cap, turnOn))
  ensures stepEventOrder(e, deploy(e, asset, mint, purpose, delay, cap, turnOn))
  ensures stepIdentityFixed(e, deploy(e, asset, mint, purpose, delay, cap, turnOn))
  ensures stepImplementationOnlyUpgrades(e, deploy(e, asset, mint, purpose, delay, cap, turnOn))
  ensures stepManualBlockedWhilePoolPending(e, "deploy", deploy(e, asset, mint, purpose, delay, cap, turnOn))
  ensures stepReleaseNeedsUpgrade(e, "deploy", deploy(e, asset, mint, purpose, delay, cap, turnOn))
{
}

// ---- An advance that changes only the authority, the implementation, or the cap and opt-in ----

lemma EscAdvanceShape(e: Escrow, a: Escrow, ev: ChainEvent, via: string)
  requires later(e, ev) && alwaysBountyVaultHasNoMonths(e)
  requires a.deployed && a.at == ev && a.clock == ev.time && a.vault == e.vault && a.asset == e.asset && a.purpose == e.purpose
  requires a.owner == e.owner && a.feeRecipient == e.feeRecipient && a.bindingDelay == e.bindingDelay && |a.months| == |e.months|
  requires a.monthlyEnabled == e.monthlyEnabled || a.purpose.OrdinaryPurpose?
  requires e.implementation.ReleaseCapable? ==> a.implementation.ReleaseCapable?
  requires via == "commitAward" ==> !settlement__money_positiveAmount(e.pending)
  requires via == "releaseReserve" ==> e.implementation.ReleaseCapable?
  ensures alwaysBountyVaultHasNoMonths(a) && alwaysUndeployedEmpty(a)
  ensures stepEventOrder(e, a) && stepIdentityFixed(e, a) && stepImplementationOnlyUpgrades(e, a)
  ensures stepManualBlockedWhilePoolPending(e, via, a) && stepReleaseNeedsUpgrade(e, via, a)
{
}

// ---- Closing one open pledge lowers the pledged total by its amount ----

// Open pledge amounts add to a valid total.
lemma EscOpenFoldValid(f: (seq<int>, Pledge) -> seq<int>, init: seq<int>, xs: seq<Pledge>)
  requires forall t: seq<int>, p: Pledge :: f(t, p) == (if p.open then settlement__money_addAmounts(t, p.amount) else t)
  requires settlement__money_validAmount(init) && forall x :: x in xs ==> settlement__money_validAmount(x.amount)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft(f, init, xs))
  decreases |xs|
{
  if |xs| > 0 {
    assert xs[0] in xs;
    settlement__money_lawAdditionValid_ensures(init, xs[0].amount);
    assert forall x :: x in xs[1..] ==> x in xs;
    EscOpenFoldValid(f, f(init, xs[0]), xs[1..]);
  }
}

// Starting the total higher by an amount ends it higher by the same amount.
lemma EscOpenFoldShift(f: (seq<int>, Pledge) -> seq<int>, t: seq<int>, s: seq<int>, a: seq<int>, xs: seq<Pledge>)
  requires forall t: seq<int>, p: Pledge :: f(t, p) == (if p.open then settlement__money_addAmounts(t, p.amount) else t)
  requires settlement__money_validAmount(t) && settlement__money_validAmount(s) && settlement__money_validAmount(a)
  requires forall x :: x in xs ==> settlement__money_validAmount(x.amount)
  requires settlement__money_equalAmounts(t, settlement__money_addAmounts(s, a))
  ensures settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(f, t, xs), settlement__money_addAmounts(Std.Collections.Seq.FoldLeft(f, s, xs), a))
  decreases |xs|
{
  if |xs| > 0 {
    var y := xs[0];
    assert y in xs;
    assert forall x :: x in xs[1..] ==> x in xs;
    if y.open {
      EscAddLeft(t, s, a, y.amount);
      settlement__money_lawAdditionValid_ensures(t, y.amount);
      settlement__money_lawAdditionValid_ensures(s, y.amount);
      EscOpenFoldShift(f, f(t, y), f(s, y), a, xs[1..]);
    } else {
      EscOpenFoldShift(f, t, s, a, xs[1..]);
    }
  }
}

// Closing the one pledge of a period, open at position k, takes its amount out of the open total.
lemma EscOpenFoldClose(f: (seq<int>, Pledge) -> seq<int>, q: int, init: seq<int>, xs: seq<Pledge>, ys: seq<Pledge>, k: int)
  requires forall t: seq<int>, p: Pledge :: f(t, p) == (if p.open then settlement__money_addAmounts(t, p.amount) else t)
  requires settlement__money_validAmount(init) && forall x :: x in xs ==> settlement__money_validAmount(x.amount)
  requires 0 <= k < |xs| && xs[k].period == q && xs[k].open
  requires forall i :: 0 <= i < |xs| && xs[i].period == q ==> i == k
  requires |ys| == |xs| && forall i :: 0 <= i < |xs| ==> ys[i] == (if xs[i].period == q then xs[i].(open := false) else xs[i])
  ensures settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(f, init, xs), settlement__money_addAmounts(Std.Collections.Seq.FoldLeft(f, init, ys), xs[k].amount))
  decreases |xs|
{
  assert xs[0] in xs;
  assert forall x :: x in xs[1..] ==> x in xs;
  var a0 := xs[k].amount;
  assert xs[k] in xs;
  if k == 0 {
    assert forall i :: 0 <= i < |xs[1..]| ==> ys[1..][i] == xs[1..][i] by {
      forall i | 0 <= i < |xs[1..]| ensures ys[1..][i] == xs[1..][i] { assert xs[i + 1].period != q; }
    }
    assert ys[1..] == xs[1..];
    assert !ys[0].open;
    settlement__money_lawAdditionValid_ensures(init, a0);
    settlement__money_lawEqualReflexive_ensures(settlement__money_addAmounts(init, a0));
    EscOpenFoldShift(f, settlement__money_addAmounts(init, a0), init, a0, xs[1..]);
  } else {
    assert xs[0].period != q;
    assert ys[0] == xs[0];
    var next := f(init, xs[0]);
    settlement__money_lawAdditionValid_ensures(init, xs[0].amount);
    assert |ys[1..]| == |xs[1..]|;
    forall i | 0 <= i < |xs[1..]| ensures ys[1..][i] == (if xs[1..][i].period == q then xs[1..][i].(open := false) else xs[1..][i]) {
      assert ys[1..][i] == ys[i + 1] && xs[1..][i] == xs[i + 1];
    }
    forall i | 0 <= i < |xs[1..]| && xs[1..][i].period == q ensures i == k - 1 { assert xs[1..][i] == xs[i + 1]; }
    assert xs[1..][k - 1] == xs[k];
    EscOpenFoldClose(f, q, next, xs[1..], ys[1..], k - 1);
  }
}

// An open pledge of a period is the one pledge of that period, at some position.
lemma EscOpenPledgeAt(e: Escrow, q: int) returns (k: int)
  requires alwaysPledgesCovered(e) && pledgeOf(e, q).open
  ensures 0 <= k < |e.pledges| && e.pledges[k] == pledgeOf(e, q) && e.pledges[k].period == q
  ensures forall i :: 0 <= i < |e.pledges| && e.pledges[i].period == q ==> i == k
{
  var period := q;
  if forall y :: y in e.pledges ==> y.period != q {
    EscFoldNone((found: Pledge, p: Pledge) => (if (p.period == period) then p else found), period, noPledge, e.pledges);
    assert false;
  }
  var x :| x in e.pledges && x.period == q;
  EscPledgeOf(e, x);
  k :| 0 <= k < |e.pledges| && e.pledges[k] == x;
  forall i | 0 <= i < |e.pledges| && e.pledges[i].period == q ensures i == k {
    if i != k { ProofLib.FilterTwo((o: Pledge) => (o.period == x.period), e.pledges, i, k); }
  }
}

// After closing a period's open pledge, the pledged total is the open total again and has not grown.
lemma EscClosePledge(e: Escrow, q: int)
  requires alwaysPledgesCovered(e) && pledgeOf(e, q).open
  ensures settlement__money_validAmount(closePledge(q, e).pledged)
  ensures settlement__money_equalAmounts(closePledge(q, e).pledged, openPledged(closePledge(q, e).pledges))
  ensures settlement__money_compareAmounts(closePledge(q, e).pledged, e.pledged) <= 0
{
  var c := closePledge(q, e);
  var k := EscOpenPledgeAt(e, q);
  var a0 := e.pledges[k].amount;
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z);
  assert e.pledges[k] in e.pledges;
  var f := (t: settlement__money_Amount, p: Pledge) => (if p.open then settlement__money_addAmounts(t, p.amount) else t);
  assert forall x :: x in e.pledges ==> settlement__money_validAmount(x.amount);
  assert |c.pledges| == |e.pledges|;
  EscOpenFoldClose(f, q, z, e.pledges, c.pledges, k);
  assert forall x :: x in c.pledges ==> settlement__money_validAmount(x.amount) by {
    forall x | x in c.pledges ensures settlement__money_validAmount(x.amount) {
      var i :| 0 <= i < |c.pledges| && c.pledges[i] == x;
      assert e.pledges[i] in e.pledges;
    }
  }
  EscOpenFoldValid(f, z, c.pledges);
  var o := openPledged(c.pledges);
  // pledged = o + a0, so pledged - a0 = o
  EscChain(e.pledged, openPledged(e.pledges), settlement__money_addAmounts(o, a0));
  settlement__money_lawAddMonotone_ensures(a0, o);
  settlement__money_lawAddCommutative_ensures(a0, o);
  settlement__money_lawAdditionValid_ensures(o, a0);
  EscSym(e.pledged, settlement__money_addAmounts(o, a0));
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(o, a0), e.pledged, a0);
  settlement__money_lawEqualReflexive_ensures(a0);
  EscSubRight(e.pledged, o, a0, a0);
  EscSelfZero(a0, a0);
  settlement__money_lawSubtractionValid_ensures(a0, a0);
  settlement__money_lawAddCongruence_ensures(settlement__money_subtractAmounts(a0, a0), z, o);
  settlement__money_lawZeroIdentity_ensures(o);
  EscChain(settlement__money_subtractAmounts(e.pledged, a0), settlement__money_addAmounts(o, settlement__money_subtractAmounts(a0, a0)), settlement__money_addAmounts(o, z));
  EscChain(settlement__money_subtractAmounts(e.pledged, a0), settlement__money_addAmounts(o, z), o);
  settlement__money_lawSubtractionValid_ensures(e.pledged, a0);
  settlement__money_lawSubtractionAtMost_ensures(e.pledged, a0);
}

// ---- Commit an owner award ----

// The fee splits a valid gross: the remainder after it and the fee add back to the gross.
lemma EscFeeSplit(purpose: VaultPurpose, g: seq<int>)
  requires settlement__money_validAmount(g) && (purpose.OrdinaryPurpose? || settlement__money_privateSplitPossible(g))
  ensures settlement__money_validAmount(feeFor(purpose, g)) && settlement__money_compareAmounts(g, feeFor(purpose, g)) >= 0
  ensures settlement__money_validAmount(settlement__money_subtractAmounts(g, feeFor(purpose, g)))
  ensures settlement__money_equalAmounts(settlement__money_addAmounts(settlement__money_subtractAmounts(g, feeFor(purpose, g)), feeFor(purpose, g)), g)
{
  var f := feeFor(purpose, g);
  if purpose.OrdinaryPurpose? {
    settlement__money_lawOrdinaryAmountsValid_ensures(g);
    settlement__money_lawFullOrdinaryConservation_ensures(g);
    var n := settlement__money_ordinaryNetAmount(g);
    settlement__money_lawAddMonotone_ensures(f, n);
    settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(f, n), g, f);
  } else {
    settlement__money_lawPrivateAmountsValid_ensures(g);
    settlement__money_lawFullPrivateConservation_ensures(g);
    var r := settlement__money_privateResearcherAmount(g);
    settlement__money_lawAddMonotone_ensures(f, r);
    settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(f, r), g, f);
  }
  settlement__money_lawSubtractionValid_ensures(g, f);
  settlement__money_lawSubtractionReconstructs_ensures(g, f);
}

// Adding a gross to a split total, as remainder and fee, keeps it split.
lemma EscAddSplit(r: seq<int>, p: seq<int>, q: seq<int>, g: seq<int>, f: seq<int>)
  requires settlement__money_validAmount(r) && settlement__money_validAmount(p) && settlement__money_validAmount(q)
  requires settlement__money_validAmount(g) && settlement__money_validAmount(f)
  requires settlement__money_validAmount(settlement__money_subtractAmounts(g, f))
  requires settlement__money_equalAmounts(r, settlement__money_addAmounts(p, q))
  requires settlement__money_equalAmounts(settlement__money_addAmounts(settlement__money_subtractAmounts(g, f), f), g)
  ensures settlement__money_equalAmounts(settlement__money_addAmounts(r, g),
    settlement__money_addAmounts(settlement__money_addAmounts(p, settlement__money_subtractAmounts(g, f)), settlement__money_addAmounts(q, f)))
{
  var n := settlement__money_subtractAmounts(g, f);
  var r1 := settlement__money_addAmounts(r, n);
  var pn := settlement__money_addAmounts(p, n);
  settlement__money_lawAdditionValid_ensures(r, n);
  settlement__money_lawAdditionValid_ensures(p, n);
  settlement__money_lawAdditionValid_ensures(q, f);
  settlement__money_lawAdditionValid_ensures(r, g);
  settlement__money_lawAdditionValid_ensures(n, f);
  settlement__money_lawAdditionValid_ensures(r1, f);
  // r + n = (p + n) + q
  EscAddLeft(r, p, q, n);
  // (r + n) + f = (p + n) + (q + f)
  EscAddLeft(r1, pn, q, f);
  // (r + n) + f = r + (n + f) = r + g
  settlement__money_lawAddAssociative_ensures(r, n, f);
  settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(n, f), g, r);
  EscChain(settlement__money_addAmounts(r1, f), settlement__money_addAmounts(r, settlement__money_addAmounts(n, f)), settlement__money_addAmounts(r, g));
  EscSym(settlement__money_addAmounts(r1, f), settlement__money_addAmounts(r, g));
  EscChain(settlement__money_addAmounts(r, g), settlement__money_addAmounts(r1, f), settlement__money_addAmounts(pn, settlement__money_addAmounts(q, f)));
}

// The gross moves from free funds to an award reservation: conservation, the splits and the counter rules.
lemma EscCommitCounters(e: Escrow, source: SourceKey, actor: int, gross: seq<int>, ev: ChainEvent, by_: string)
  requires alwaysGrossConserved(e) && alwaysReservedSplit(e) && alwaysPaidSplit(e) && alwaysFeesConserved(e) && alwaysValidCounters(e)
  requires canCommitAward(e, source, actor, gross, ev, by_)
  ensures alwaysGrossConserved(commitAward(e, source, actor, gross, ev, by_)) && alwaysReservedSplit(commitAward(e, source, actor, gross, ev, by_))
  ensures alwaysPaidSplit(commitAward(e, source, actor, gross, ev, by_)) && alwaysFeesConserved(commitAward(e, source, actor, gross, ev, by_))
  ensures alwaysValidCounters(commitAward(e, source, actor, gross, ev, by_))
  ensures stepCumulativeCounters(e, commitAward(e, source, actor, gross, ev, by_))
  ensures stepPoolLeavesOnlyByLeafOrRelease(e, "commitAward", commitAward(e, source, actor, gross, ev, by_))
  ensures stepFreeLeavesOnlyByOwnerOrRoot(e, "commitAward", commitAward(e, source, actor, gross, ev, by_))
  ensures stepFreeEntersOnlyByDepositOrRelease(e, "commitAward", commitAward(e, source, actor, gross, ev, by_))
  ensures settlement__money_compareAmounts(commitAward(e, source, actor, gross, ev, by_).free, e.pledged) >= 0
{
  var a := commitAward(e, source, actor, gross, ev, by_);
  var f := feeFor(e.purpose, gross);
  EscFeeSplit(e.purpose, gross);
  // held = (free - g) + (committed + g); committed + g = pending + (reserved + g)
  settlement__money_lawAddCommutative_ensures(e.free, e.committed);
  EscMove(e.held, e.free, e.committed, gross);
  EscAddLeft(e.committed, e.pending, e.reserved, gross);
  // reserved + g = (principal + (g - f)) + (fees + f)
  EscAddSplit(e.reserved, e.reservedPrincipal, e.reservedFees, gross, f);
  settlement__money_lawSubtractionValid_ensures(e.free, gross);
  settlement__money_lawAdditionValid_ensures(e.committed, gross);
  settlement__money_lawAdditionValid_ensures(e.reserved, gross);
  settlement__money_lawAdditionValid_ensures(e.reservedFees, f);
  settlement__money_lawAdditionValid_ensures(e.reservedPrincipal, settlement__money_subtractAmounts(gross, f));
  settlement__money_lawSubtractionAtMost_ensures(e.free, gross);
  settlement__money_lawEqualReflexive_ensures(e.deposited);
  settlement__money_lawEqualReflexive_ensures(e.paid);
  settlement__money_lawEqualReflexive_ensures(e.paidNet);
  settlement__money_lawEqualReflexive_ensures(e.payoutFees);
  settlement__money_lawEqualReflexive_ensures(e.grossWithdrawn);
  settlement__money_lawEqualReflexive_ensures(e.withdrawalFees);
  settlement__money_lawEqualReflexive_ensures(e.claimedFees);
  settlement__money_lawEqualReflexive_ensures(e.pending);
  assert a.free == settlement__money_subtractAmounts(e.free, gross);
}

// One more owner award, with a source no award holds: the award and month rules hold again and nothing is lost.
lemma EscCommitHistory(e: Escrow, source: SourceKey, actor: int, gross: seq<int>, ev: ChainEvent, by_: string)
  requires alwaysEvmReleaseWhole(e) && alwaysTouchedMonthsShrink(e) && alwaysReleaseWhole(e)
  requires alwaysWithdrawalFees(e) && alwaysMonths(e) && alwaysAwards(e) && alwaysReleasedLeavesAdmitted(e)
  requires canCommitAward(e, source, actor, gross, ev, by_)
  ensures alwaysEvmReleaseWhole(commitAward(e, source, actor, gross, ev, by_)) && alwaysTouchedMonthsShrink(commitAward(e, source, actor, gross, ev, by_))
  ensures alwaysReleaseWhole(commitAward(e, source, actor, gross, ev, by_)) && alwaysWithdrawalFees(commitAward(e, source, actor, gross, ev, by_))
  ensures alwaysMonths(commitAward(e, source, actor, gross, ev, by_)) && alwaysAwards(commitAward(e, source, actor, gross, ev, by_))
  ensures alwaysReleasedLeavesAdmitted(commitAward(e, source, actor, gross, ev, by_))
  ensures stepAwardsRetained(e, commitAward(e, source, actor, gross, ev, by_)) && stepMonthsRetained(e, commitAward(e, source, actor, gross, ev, by_))
  ensures stepWithdrawalsRetained(e, commitAward(e, source, actor, gross, ev, by_))
  ensures stepOneRootPerPeriod(e, "commitAward", commitAward(e, source, actor, gross, ev, by_))
{
  var a := commitAward(e, source, actor, gross, ev, by_);
  var award := Award(source, actor, gross, feeFor(e.purpose, gross), AwardOrigin.ManualAward, 0, -1, ev.time, false, "", 0, "");
  assert a.awards == e.awards + [award];
  assert a.months == e.months && a.releasedLeaves == e.releasedLeaves && a.withdrawals == e.withdrawals;
  assert a.asset == e.asset && a.purpose == e.purpose;
  forall p ensures leafTouched(a, p) == leafTouched(e, p) {
    if exists x :: x in a.awards && x.origin.MonthlyLeaf? && x.period == p {
      var x :| x in a.awards && x.origin.MonthlyLeaf? && x.period == p;
      assert x != award && x in e.awards;
    }
  }
  forall m | m in a.months ensures (exists x :: x in a.awards && x.origin.MonthlyLeaf? && x.period == m.period) == (exists x :: x in e.awards && x.origin.MonthlyLeaf? && x.period == m.period) {
    if exists x :: x in a.awards && x.origin.MonthlyLeaf? && x.period == m.period {
      var x :| x in a.awards && x.origin.MonthlyLeaf? && x.period == m.period;
      assert x != award && x in e.awards;
    }
  }
  forall x | x in e.awards ensures exists y :: y in a.awards && sameAwardTerms(x, y) && (!x.paid || x == y) {
    assert x in a.awards && sameAwardTerms(x, x);
  }
  forall x | x in e.months ensures exists y :: y in a.months && sameMonthTerms(x, y) {
    assert x in a.months && sameMonthTerms(x, x);
  }
  forall x | x in a.awards ensures validAward(a, x) && |ProofLib.Filter((other: Award) => (other.source == x.source), a.awards)| == 1 {
    var key := x.source;
    ProofLib.FilterAppend((other: Award) => (other.source == key), e.awards, award);
    if x == award {
      ProofLib.FilterNone((other: Award) => (other.source == key), e.awards);
    } else {
      assert x in e.awards && validAward(e, x);
      assert award.source != key;
      if x.origin.MonthlyLeaf? { var m :| m in e.months && m.period == x.period; assert m in a.months; }
    }
  }
}

// ---- A proven leaf becomes one award ----

// Taking a positive amount from a remainder that holds it leaves strictly less.
lemma EscStrictlyLess(r: seq<int>, g: seq<int>)
  requires settlement__money_validAmount(r) && settlement__money_validAmount(g) && settlement__money_positiveAmount(g)
  requires settlement__money_compareAmounts(r, g) >= 0
  ensures settlement__money_validAmount(settlement__money_subtractAmounts(r, g))
  ensures settlement__money_compareAmounts(settlement__money_subtractAmounts(r, g), r) < 0
{
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z);
  var r1 := settlement__money_subtractAmounts(r, g);
  settlement__money_lawSubtractionValid_ensures(r, g);
  settlement__money_lawSubtractionReconstructs_ensures(r, g);
  settlement__money_lawAddOrder_ensures(g, z, r1);
  settlement__money_lawZeroIdentity_ensures(r1);
  settlement__money_lawAddCommutative_ensures(z, r1);
  settlement__money_lawAddCommutative_ensures(g, r1);
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(z, r1), r1, settlement__money_addAmounts(g, r1));
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(r1, g), r, r1);
  settlement__money_lawNumericOrderTotal_ensures(r, r1);
}

// The month a leaf proves holds no whole release: a released month's remainder is zero, which holds no leaf gross.
// Only a Solana month with a released leaf has released gross beside a remainder.
lemma EscLeafMonthOpen(e: Escrow, proof: LeafProof)
  requires alwaysMonths(e) && alwaysEvmReleaseWhole(e) && alwaysReleaseWhole(e) && provesLeaf(e, proof)
  ensures settlement__money_positiveAmount(monthFor(e, proof.period).released) ==>
    e.asset.network.Solana? && exists l :: l in e.releasedLeaves && l.period == proof.period
{
  var m0 := monthFor(e, proof.period);
  EscMonthFor(e, proof.period);
  if settlement__money_positiveAmount(m0.released) && !(e.asset.network.Solana? && exists l :: l in e.releasedLeaves && l.period == proof.period) {
    assert m0 in e.months;
    assert settlement__money_equalAmounts(m0.remaining, settlement__money_zero);
    assert settlement__money_validAmount(settlement__money_zero);
    settlement__money_lawEqualOrder_ensures(m0.remaining, settlement__money_zero, proof.gross);
    settlement__money_lawNumericOrderTotal_ensures(proof.gross, settlement__money_zero);
    assert false;
  }
}

// The months after a leaf: its month holds less remainder than it admitted and keeps its terms.
lemma EscMaterializeMonths(e: Escrow, proof: LeafProof, ev: ChainEvent)
  requires alwaysMonths(e) && alwaysTouchedMonthsShrink(e) && alwaysReleaseWhole(e) && alwaysEvmReleaseWhole(e)
  requires canMaterialize(e, proof, ev)
  ensures alwaysMonths(materialize(e, proof, ev))
  ensures alwaysEvmReleaseWhole(materialize(e, proof, ev))
  ensures alwaysTouchedMonthsShrink(materialize(e, proof, ev))
  ensures alwaysReleaseWhole(materialize(e, proof, ev))
  ensures forall q :: hasMonth(materialize(e, proof, ev), q) == hasMonth(e, q)
  ensures stepMonthsRetained(e, materialize(e, proof, ev))
{
  var after := materialize(e, proof, ev);
  var p := proof.period;
  var g := proof.gross;
  var m0 := monthFor(e, p);
  EscMonthFor(e, p);
  EscLeafMonthOpen(e, proof);
  assert m0 in e.months;
  var r1 := settlement__money_subtractAmounts(m0.remaining, g);
  EscStrictlyLess(m0.remaining, g);
  settlement__money_lawNumericOrderTransitive_ensures(r1, m0.remaining, m0.admittedGross);
  var up := m0.(remaining := r1);
  var award := Award(proof.source, proof.actor, g, feeFor(e.purpose, g), AwardOrigin.MonthlyLeaf, p, proof.index, ev.time, false, "", 0, "");
  assert after.awards == e.awards + [award];
  assert after.releasedLeaves == e.releasedLeaves && after.asset == e.asset;
  assert |after.months| == |e.months|;
  forall i | 0 <= i < |e.months| ensures after.months[i] == (if e.months[i].period == p then up else e.months[i]) {
    if e.months[i].period == p { assert e.months[i] in e.months; }
  }
  forall q | q != p ensures leafTouched(after, q) == leafTouched(e, q) {
    if exists x :: x in after.awards && x.origin.MonthlyLeaf? && x.period == q {
      var x :| x in after.awards && x.origin.MonthlyLeaf? && x.period == q;
      assert x != award && x in e.awards;
    }
  }
  forall m | m in e.months && m.period != p ensures (exists x :: x in after.awards && x.origin.MonthlyLeaf? && x.period == m.period) == (exists x :: x in e.awards && x.origin.MonthlyLeaf? && x.period == m.period) {
    if exists x :: x in after.awards && x.origin.MonthlyLeaf? && x.period == m.period {
      var x :| x in after.awards && x.origin.MonthlyLeaf? && x.period == m.period;
      assert x != award && x in e.awards;
    }
  }
  forall m | m in after.months ensures m == up || (m in e.months && m.period != p) {
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

// The pool gross of the leaf becomes the award's reservation: conservation, the splits and the counter rules.
lemma EscMaterializeCounters(e: Escrow, proof: LeafProof, ev: ChainEvent)
  requires alwaysGrossConserved(e) && alwaysReservedSplit(e) && alwaysPaidSplit(e) && alwaysFeesConserved(e) && alwaysValidCounters(e)
  requires canMaterialize(e, proof, ev)
  ensures alwaysGrossConserved(materialize(e, proof, ev)) && alwaysReservedSplit(materialize(e, proof, ev))
  ensures alwaysPaidSplit(materialize(e, proof, ev)) && alwaysFeesConserved(materialize(e, proof, ev))
  ensures alwaysValidCounters(materialize(e, proof, ev))
  ensures stepCumulativeCounters(e, materialize(e, proof, ev))
  ensures stepPoolLeavesOnlyByLeafOrRelease(e, "materialize", materialize(e, proof, ev))
  ensures stepFreeLeavesOnlyByOwnerOrRoot(e, "materialize", materialize(e, proof, ev))
  ensures stepFreeEntersOnlyByDepositOrRelease(e, "materialize", materialize(e, proof, ev))
  ensures materialize(e, proof, ev).free == e.free
{
  var g := proof.gross;
  var f := feeFor(e.purpose, g);
  EscFeeSplit(e.purpose, g);
  // committed = (pending - g) + (reserved + g)
  EscMove(e.committed, e.pending, e.reserved, g);
  EscAddSplit(e.reserved, e.reservedPrincipal, e.reservedFees, g, f);
  settlement__money_lawSubtractionValid_ensures(e.pending, g);
  settlement__money_lawAdditionValid_ensures(e.reserved, g);
  settlement__money_lawAdditionValid_ensures(e.reservedFees, f);
  settlement__money_lawAdditionValid_ensures(e.reservedPrincipal, settlement__money_subtractAmounts(g, f));
  settlement__money_lawEqualReflexive_ensures(e.deposited);
  settlement__money_lawEqualReflexive_ensures(e.paid);
  settlement__money_lawEqualReflexive_ensures(e.paidNet);
  settlement__money_lawEqualReflexive_ensures(e.payoutFees);
  settlement__money_lawEqualReflexive_ensures(e.grossWithdrawn);
  settlement__money_lawEqualReflexive_ensures(e.withdrawalFees);
  settlement__money_lawEqualReflexive_ensures(e.claimedFees);
  settlement__money_lawEqualReflexive_ensures(e.free);
}

// One more leaf award, with a source no award holds, in an admitted month.
lemma EscMaterializeAwards(e: Escrow, proof: LeafProof, ev: ChainEvent)
  requires alwaysWithdrawalFees(e) && alwaysAwards(e) && alwaysMonths(e) && alwaysReleasedLeavesAdmitted(e) && canMaterialize(e, proof, ev)
  requires forall q :: hasMonth(materialize(e, proof, ev), q) == hasMonth(e, q)
  ensures alwaysWithdrawalFees(materialize(e, proof, ev)) && alwaysAwards(materialize(e, proof, ev))
  ensures alwaysReleasedLeavesAdmitted(materialize(e, proof, ev))
  ensures stepAwardsRetained(e, materialize(e, proof, ev)) && stepWithdrawalsRetained(e, materialize(e, proof, ev))
  ensures stepOneRootPerPeriod(e, "materialize", materialize(e, proof, ev))
{
  var a := materialize(e, proof, ev);
  var award := Award(proof.source, proof.actor, proof.gross, feeFor(e.purpose, proof.gross), AwardOrigin.MonthlyLeaf, proof.period, proof.index, ev.time, false, "", 0, "");
  assert a.awards == e.awards + [award];
  assert a.withdrawals == e.withdrawals && a.purpose == e.purpose && a.releasedLeaves == e.releasedLeaves;
  EscMonthFor(e, proof.period);
  assert monthFor(e, proof.period) in e.months && hasMonth(e, proof.period);
  forall x | x in e.awards ensures exists y :: y in a.awards && sameAwardTerms(x, y) && (!x.paid || x == y) {
    assert x in a.awards && sameAwardTerms(x, x);
  }
  forall x | x in a.awards ensures validAward(a, x) && |ProofLib.Filter((other: Award) => (other.source == x.source), a.awards)| == 1 {
    var key := x.source;
    ProofLib.FilterAppend((other: Award) => (other.source == key), e.awards, award);
    if x == award {
      ProofLib.FilterNone((other: Award) => (other.source == key), e.awards);
    } else {
      assert x in e.awards && validAward(e, x);
      assert award.source != key;
    }
  }
}

// ---- Admit one attested root ----

// The admitted month a root adds.
lemma EscAdmitParts(e: Escrow, authorization: RootAuthorization, ev: ChainEvent)
  requires canAdmitRoot(e, authorization, ev)
  ensures admitRoot(e, authorization, ev).months == e.months + [MonthReserve(authorization.period, authorization.allocationDigest,
    authorization.root, authorization.wholeGross, authorization.remainingGross, authorization.remainingGross, settlement__money_zero,
    authorization.leafCount, ev.time, (if e.asset.network.Solana? then authorization.frozenAt else ev.time))]
  ensures admitRoot(e, authorization, ev).awards == e.awards && admitRoot(e, authorization, ev).releasedLeaves == e.releasedLeaves
  ensures admitRoot(e, authorization, ev).withdrawals == e.withdrawals && admitRoot(e, authorization, ev).asset == e.asset
  ensures admitRoot(e, authorization, ev).purpose == e.purpose && admitRoot(e, authorization, ev).deployed
  ensures admitRoot(e, authorization, ev).free == settlement__money_subtractAmounts(e.free, authorization.remainingGross)
  ensures closePledge(authorization.period, advance(ev, e)).pledges == closePledge(authorization.period, e).pledges
  ensures closePledge(authorization.period, advance(ev, e)).pledged == closePledge(authorization.period, e).pledged
  ensures admitRoot(e, authorization, ev).pledges == closeNamed(authorization.period, namesPledge(e, authorization), e).pledges
  ensures admitRoot(e, authorization, ev).pledged == closeNamed(authorization.period, namesPledge(e, authorization), e).pledged
{
  assert pledgeOf(advance(ev, e), authorization.period) == pledgeOf(e, authorization.period);
}

// The remainder moves from free funds into the pool reserve.
lemma EscAdmitCounters(e: Escrow, authorization: RootAuthorization, ev: ChainEvent)
  requires alwaysGrossConserved(e) && alwaysReservedSplit(e) && alwaysPaidSplit(e) && alwaysFeesConserved(e) && alwaysValidCounters(e)
  requires canAdmitRoot(e, authorization, ev)
  ensures alwaysGrossConserved(admitRoot(e, authorization, ev)) && alwaysReservedSplit(admitRoot(e, authorization, ev))
  ensures alwaysPaidSplit(admitRoot(e, authorization, ev)) && alwaysFeesConserved(admitRoot(e, authorization, ev))
  ensures alwaysValidCounters(admitRoot(e, authorization, ev))
  ensures stepCumulativeCounters(e, admitRoot(e, authorization, ev))
  ensures stepPoolLeavesOnlyByLeafOrRelease(e, "admitRoot", admitRoot(e, authorization, ev))
  ensures stepFreeLeavesOnlyByOwnerOrRoot(e, "admitRoot", admitRoot(e, authorization, ev))
  ensures stepFreeEntersOnlyByDepositOrRelease(e, "admitRoot", admitRoot(e, authorization, ev))
{
  var r := authorization.remainingGross;
  EscAdmitParts(e, authorization, ev);
  assert closeNamed(authorization.period, namesPledge(e, authorization), e).free == e.free;
  assert settlement__money_compareAmounts(e.free, r) >= 0;
  settlement__money_lawAddCommutative_ensures(e.free, e.committed);
  EscMove(e.held, e.free, e.committed, r);
  EscAddLeft(e.committed, e.pending, e.reserved, r);
  settlement__money_lawSubtractionValid_ensures(e.free, r);
  settlement__money_lawAdditionValid_ensures(e.pending, r);
  settlement__money_lawAdditionValid_ensures(e.committed, r);
  settlement__money_lawAddMonotone_ensures(e.pending, r);
  settlement__money_lawSubtractionAtMost_ensures(e.free, r);
  settlement__money_lawEqualReflexive_ensures(e.deposited);
  settlement__money_lawEqualReflexive_ensures(e.paid);
  settlement__money_lawEqualReflexive_ensures(e.paidNet);
  settlement__money_lawEqualReflexive_ensures(e.payoutFees);
  settlement__money_lawEqualReflexive_ensures(e.grossWithdrawn);
  settlement__money_lawEqualReflexive_ensures(e.withdrawalFees);
  settlement__money_lawEqualReflexive_ensures(e.claimedFees);
}

// The month a root adds, and how it extends the months.
lemma EscAdmitMonth(e: Escrow, authorization: RootAuthorization, ev: ChainEvent)
  requires canAdmitRoot(e, authorization, ev)
  ensures admitRoot(e, authorization, ev).months == e.months + [MonthReserve(authorization.period, authorization.allocationDigest,
    authorization.root, authorization.wholeGross, authorization.remainingGross, authorization.remainingGross, settlement__money_zero,
    authorization.leafCount, ev.time, (if e.asset.network.Solana? then authorization.frozenAt else ev.time))]
  ensures !hasMonth(e, authorization.period)
  ensures forall x :: hasMonth(admitRoot(e, authorization, ev), x) == (hasMonth(e, x) || x == authorization.period)
  ensures forall m :: m in admitRoot(e, authorization, ev).months ==> m in e.months || m.period == authorization.period
{
  var a := admitRoot(e, authorization, ev);
  EscAdmitParts(e, authorization, ev);
  forall x ensures hasMonth(a, x) == (hasMonth(e, x) || x == authorization.period) {
    if hasMonth(e, x) { var m :| m in e.months && m.period == x; assert m in a.months; }
    if x == authorization.period { assert a.months[|e.months|] in a.months; }
  }
}

// The new month is valid and unique by period; earlier months keep their terms.
lemma EscAdmitMonthsValid(e: Escrow, authorization: RootAuthorization, ev: ChainEvent)
  requires alwaysMonths(e) && canAdmitRoot(e, authorization, ev)
  ensures alwaysMonths(admitRoot(e, authorization, ev))
  ensures stepMonthsRetained(e, admitRoot(e, authorization, ev))
  ensures stepOneRootPerPeriod(e, "admitRoot", admitRoot(e, authorization, ev))
{
  var a := admitRoot(e, authorization, ev);
  var q := authorization.period;
  var r := authorization.remainingGross;
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z);
  EscAdmitMonth(e, authorization, ev);
  var nm := a.months[|e.months|];
  assert a.months == e.months + [nm] && nm.period == q && nm.remaining == r && nm.admittedGross == r && nm.released == z;
  settlement__money_lawEqualReflexive_ensures(r);
  forall x | x in e.months ensures exists y :: y in a.months && sameMonthTerms(x, y) {
    assert x in a.months && sameMonthTerms(x, x);
  }
  forall m | m in a.months ensures |ProofLib.Filter((other: MonthReserve) => (other.period == m.period), a.months)| == 1 {
    var key := m.period;
    ProofLib.FilterAppend((other: MonthReserve) => (other.period == key), e.months, nm);
    if m == nm {
      ProofLib.FilterNone((other: MonthReserve) => (other.period == key), e.months);
      forall i | 0 <= i < |e.months| ensures e.months[i].period != key { assert e.months[i] in e.months; }
    } else {
      assert m in e.months && nm.period != key;
    }
  }
}

// Nothing touched the new period, and it holds no release: every month rule over released and touched months holds.
lemma EscAdmitMonthsUntouched(e: Escrow, authorization: RootAuthorization, ev: ChainEvent)
  requires alwaysEvmReleaseWhole(e) && alwaysTouchedMonthsShrink(e) && alwaysReleaseWhole(e)
  requires alwaysAwards(e) && alwaysReleasedLeavesAdmitted(e) && canAdmitRoot(e, authorization, ev)
  ensures alwaysEvmReleaseWhole(admitRoot(e, authorization, ev)) && alwaysTouchedMonthsShrink(admitRoot(e, authorization, ev))
  ensures alwaysReleaseWhole(admitRoot(e, authorization, ev))
{
  var a := admitRoot(e, authorization, ev);
  var q := authorization.period;
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z);
  EscAdmitParts(e, authorization, ev);
  EscAdmitMonth(e, authorization, ev);
  var nm := a.months[|e.months|];
  assert nm.period == q && nm.released == z;
  settlement__money_lawEqualReflexive_ensures(z);
  assert !settlement__money_positiveAmount(z);
  assert !(exists x :: x in e.awards && x.origin.MonthlyLeaf? && x.period == q) by {
    forall x | x in e.awards && x.origin.MonthlyLeaf? ensures x.period != q { assert validAward(e, x); }
  }
  assert !(exists l :: l in e.releasedLeaves && l.period == q);
  assert !leafTouched(a, q);
  forall m | m in a.months ensures m == nm || (m in e.months && m.period != q) {
    if m != nm { assert m in e.months; }
  }
}

// Awards, released leaves and withdrawals are kept, and every award stays valid in the larger month list.
lemma EscAdmitAwards(e: Escrow, authorization: RootAuthorization, ev: ChainEvent)
  requires alwaysWithdrawalFees(e) && alwaysAwards(e) && alwaysReleasedLeavesAdmitted(e) && canAdmitRoot(e, authorization, ev)
  ensures alwaysWithdrawalFees(admitRoot(e, authorization, ev)) && alwaysAwards(admitRoot(e, authorization, ev))
  ensures alwaysReleasedLeavesAdmitted(admitRoot(e, authorization, ev))
  ensures stepAwardsRetained(e, admitRoot(e, authorization, ev)) && stepWithdrawalsRetained(e, admitRoot(e, authorization, ev))
{
  var a := admitRoot(e, authorization, ev);
  EscAdmitParts(e, authorization, ev);
  EscAdmitMonth(e, authorization, ev);
  forall x | x in e.awards ensures exists y :: y in a.awards && sameAwardTerms(x, y) && (!x.paid || x == y) {
    assert x in a.awards && sameAwardTerms(x, x);
  }
  forall x | x in a.awards ensures validAward(a, x) {
    assert x in e.awards && validAward(e, x);
  }
  forall l | l in a.releasedLeaves ensures hasMonth(a, l.period) { assert hasMonth(e, l.period); }
}

// Admission closes the period's own pledge, if it names it, and leaves every other pledge as it was.
lemma EscAdmitPledges(e: Escrow, authorization: RootAuthorization, ev: ChainEvent)
  requires alwaysPledgesCovered(e) && canAdmitRoot(e, authorization, ev)
  ensures alwaysPledgesCovered(admitRoot(e, authorization, ev))
  ensures stepPledgeIrrevocable(e, "admitRoot", admitRoot(e, authorization, ev))
{
  var a := admitRoot(e, authorization, ev);
  var q := authorization.period;
  var named := namesPledge(e, authorization);
  EscAdmitParts(e, authorization, ev);
  assert !hasMonth(e, q) && hasMonth(a, q);
  EscAdmitMonth(e, authorization, ev);
  var c := closeNamed(q, named, e);
  assert settlement__money_compareAmounts(a.free, c.pledged) >= 0;
  if named && pledgeOf(e, q).open {
    var k := EscOpenPledgeAt(e, q);
    EscClosePledge(e, q);
    assert c == closePledge(q, e);
    assert |a.pledges| == |e.pledges|;
    forall i | 0 <= i < |e.pledges| ensures a.pledges[i] == (if e.pledges[i].period == q then e.pledges[i].(open := false) else e.pledges[i]) {
    }
    forall p | p in a.pledges ensures validPeriod(p.period) && settlement__money_validAmount(p.amount) && settlement__money_positiveAmount(p.amount)
      && |ProofLib.Filter((o: Pledge) => (o.period == p.period), a.pledges)| == 1 && (!(p.open && hasMonth(a, p.period)) || a.asset.network.Solana?) {
      var i :| 0 <= i < |a.pledges| && a.pledges[i] == p;
      var po := e.pledges[i];
      assert po in e.pledges && po.period == p.period;
      ProofLib.FilterLengthPointwise((o: Pledge) => (o.period == p.period), (o: Pledge) => (o.period == p.period), e.pledges, a.pledges);
      ProofLib.FilterSamePredicate((o: Pledge) => (o.period == p.period), (o: Pledge) => (o.period == po.period), e.pledges);
      if p.open && hasMonth(a, p.period) { assert p.period != q && hasMonth(e, p.period); }
    }
    forall x | x in e.pledges && x.open ensures (pledgeOf(a, x.period).open && settlement__money_compareAmounts(pledgeOf(a, x.period).amount, x.amount) >= 0)
      || pledgeClosable(e, "admitRoot", a, x.period) {
      if x.period != q {
        var i :| 0 <= i < |e.pledges| && e.pledges[i] == x;
        assert a.pledges[i] == x && x in a.pledges;
        EscPledgeOf(a, x);
        settlement__money_lawEqualReflexive_ensures(x.amount);
      }
    }
  } else {
    assert c.pledges == e.pledges && c.pledged == e.pledged;
    forall p | p in a.pledges && p.open && hasMonth(a, p.period) ensures a.asset.network.Solana? {
      if p.period == q && named {
        EscPledgeOf(e, p);
        assert false;
      }
      if p.period != q { assert hasMonth(e, p.period); }
    }
    forall x | x in e.pledges ensures pledgeOf(a, x.period) == x && settlement__money_compareAmounts(x.amount, x.amount) >= 0 {
      EscPledgeOf(e, x);
      assert pledgeOf(a, x.period) == pledgeOf(e, x.period);
      settlement__money_lawEqualReflexive_ensures(x.amount);
    }
  }
}

lemma EscAdmitShape(e: Escrow, authorization: RootAuthorization, ev: ChainEvent)
  requires alwaysBountyVaultHasNoMonths(e) && canAdmitRoot(e, authorization, ev)
  ensures alwaysBountyVaultHasNoMonths(admitRoot(e, authorization, ev)) && alwaysUndeployedEmpty(admitRoot(e, authorization, ev))
  ensures stepEventOrder(e, admitRoot(e, authorization, ev)) && stepIdentityFixed(e, admitRoot(e, authorization, ev))
  ensures stepImplementationOnlyUpgrades(e, admitRoot(e, authorization, ev))
  ensures stepManualBlockedWhilePoolPending(e, "admitRoot", admitRoot(e, authorization, ev))
  ensures stepReleaseNeedsUpgrade(e, "admitRoot", admitRoot(e, authorization, ev))
{
  EscAdmitParts(e, authorization, ev);
}

// ---- After a whole release no leaf materializes ----

// A remainder of zero cannot hold a positive leaf gross, so a released month refuses every leaf.
lemma lawNoLeafAfterRelease_ensures(e: Escrow, proof: LeafProof, ev: ChainEvent)
  ensures (lawNoLeafAfterRelease(e, proof, ev) == true)
{
  var m := monthFor(e, proof.period);
  if settlement__money_positiveAmount(m.released) && settlement__money_equalAmounts(m.remaining, settlement__money_zero) && canMaterialize(e, proof, ev) {
    assert settlement__money_validAmount(settlement__money_zero);
    settlement__money_lawEqualOrder_ensures(m.remaining, settlement__money_zero, proof.gross);
    settlement__money_lawNumericOrderTotal_ensures(proof.gross, settlement__money_zero);
    assert false;
  }
}

// ---- A deposit joins free funds ----

lemma EscDepositCounters(e: Escrow, funds: Deposit, ev: ChainEvent)
  requires alwaysGrossConserved(e) && alwaysReservedSplit(e) && alwaysPaidSplit(e) && alwaysFeesConserved(e) && alwaysValidCounters(e)
  requires alwaysPledgesCovered(e) && canDeposit(e, funds, ev)
  ensures alwaysGrossConserved(deposit(e, funds, ev)) && alwaysReservedSplit(deposit(e, funds, ev))
  ensures alwaysPaidSplit(deposit(e, funds, ev)) && alwaysFeesConserved(deposit(e, funds, ev))
  ensures alwaysValidCounters(deposit(e, funds, ev))
  ensures stepCumulativeCounters(e, deposit(e, funds, ev))
  ensures stepPoolLeavesOnlyByLeafOrRelease(e, "deposit", deposit(e, funds, ev))
  ensures stepFreeLeavesOnlyByOwnerOrRoot(e, "deposit", deposit(e, funds, ev))
  ensures stepFreeEntersOnlyByDepositOrRelease(e, "deposit", deposit(e, funds, ev))
  ensures settlement__money_compareAmounts(deposit(e, funds, ev).free, e.pledged) >= 0
{
  var x := funds.amount;
  EscAddLeft(e.deposited, e.held, e.spent, x);
  EscAddLeft(e.held, e.free, e.committed, x);
  settlement__money_lawAdditionValid_ensures(e.free, x);
  settlement__money_lawAdditionValid_ensures(e.held, x);
  settlement__money_lawAdditionValid_ensures(e.deposited, x);
  settlement__money_lawAddMonotone_ensures(e.deposited, x);
  settlement__money_lawAddMonotone_ensures(e.free, x);
  settlement__money_lawNumericOrderTotal_ensures(settlement__money_addAmounts(e.free, x), e.free);
  settlement__money_lawNumericOrderTransitive_ensures(e.pledged, e.free, settlement__money_addAmounts(e.free, x));
  settlement__money_lawNumericOrderTotal_ensures(e.free, e.pledged);
  settlement__money_lawNumericOrderTotal_ensures(settlement__money_addAmounts(e.free, x), e.pledged);
  settlement__money_lawEqualReflexive_ensures(e.paid);
  settlement__money_lawEqualReflexive_ensures(e.paidNet);
  settlement__money_lawEqualReflexive_ensures(e.payoutFees);
  settlement__money_lawEqualReflexive_ensures(e.grossWithdrawn);
  settlement__money_lawEqualReflexive_ensures(e.withdrawalFees);
  settlement__money_lawEqualReflexive_ensures(e.claimedFees);
  settlement__money_lawEqualReflexive_ensures(e.pending);
}

// ---- The owner withdraws unpledged free funds less the fee ----

lemma EscWithdrawCounters(e: Escrow, gross: seq<int>, ev: ChainEvent, by_: string)
  requires alwaysGrossConserved(e) && alwaysReservedSplit(e) && alwaysPaidSplit(e) && alwaysFeesConserved(e) && alwaysValidCounters(e)
  requires canWithdraw(e, gross, ev, by_)
  ensures alwaysGrossConserved(withdraw(e, gross, ev, by_)) && alwaysReservedSplit(withdraw(e, gross, ev, by_))
  ensures alwaysPaidSplit(withdraw(e, gross, ev, by_)) && alwaysFeesConserved(withdraw(e, gross, ev, by_))
  ensures alwaysValidCounters(withdraw(e, gross, ev, by_))
  ensures stepCumulativeCounters(e, withdraw(e, gross, ev, by_))
  ensures stepPoolLeavesOnlyByLeafOrRelease(e, "withdraw", withdraw(e, gross, ev, by_))
  ensures stepFreeLeavesOnlyByOwnerOrRoot(e, "withdraw", withdraw(e, gross, ev, by_))
  ensures stepFreeEntersOnlyByDepositOrRelease(e, "withdraw", withdraw(e, gross, ev, by_))
  ensures settlement__money_compareAmounts(withdraw(e, gross, ev, by_).free, e.pledged) >= 0
{
  var g := gross;
  var f := settlement__money_ordinaryFeeAmount(g);
  settlement__money_lawOrdinaryAmountsValid_ensures(g);
  // deposited = (held - g) + (spent + g); held - g = (free - g) + committed; spent + g = paid + (withdrawn + g)
  EscMove(e.deposited, e.held, e.spent, g);
  EscSubLeft(e.held, e.free, e.committed, g);
  EscAddLeft(e.spent, e.paid, e.grossWithdrawn, g);
  // payout + (withdrawal fees + f) = (accrued + f) + claimed
  var pw := settlement__money_addAmounts(e.payoutFees, e.withdrawalFees);
  settlement__money_lawAdditionValid_ensures(e.payoutFees, e.withdrawalFees);
  EscAddLeft(pw, e.accruedFees, e.claimedFees, f);
  settlement__money_lawAddAssociative_ensures(e.payoutFees, e.withdrawalFees, f);
  EscSym(settlement__money_addAmounts(pw, f), settlement__money_addAmounts(e.payoutFees, settlement__money_addAmounts(e.withdrawalFees, f)));
  EscChain(settlement__money_addAmounts(e.payoutFees, settlement__money_addAmounts(e.withdrawalFees, f)), settlement__money_addAmounts(pw, f),
    settlement__money_addAmounts(settlement__money_addAmounts(e.accruedFees, f), e.claimedFees));
  settlement__money_lawSubtractionValid_ensures(e.free, g);
  settlement__money_lawSubtractionValid_ensures(e.held, g);
  settlement__money_lawAdditionValid_ensures(e.spent, g);
  settlement__money_lawAdditionValid_ensures(e.grossWithdrawn, g);
  settlement__money_lawAdditionValid_ensures(e.withdrawalFees, f);
  settlement__money_lawAdditionValid_ensures(e.accruedFees, f);
  settlement__money_lawAdditionValid_ensures(e.withdrawalFees, f);
  settlement__money_lawAddMonotone_ensures(e.grossWithdrawn, g);
  settlement__money_lawAddMonotone_ensures(e.withdrawalFees, f);
  settlement__money_lawSubtractionAtMost_ensures(e.free, g);
  settlement__money_lawEqualReflexive_ensures(e.deposited);
  settlement__money_lawEqualReflexive_ensures(e.paid);
  settlement__money_lawEqualReflexive_ensures(e.paidNet);
  settlement__money_lawEqualReflexive_ensures(e.payoutFees);
  settlement__money_lawEqualReflexive_ensures(e.claimedFees);
  settlement__money_lawEqualReflexive_ensures(e.pending);
}

lemma EscWithdrawFees(e: Escrow, gross: seq<int>, ev: ChainEvent, by_: string)
  requires alwaysWithdrawalFees(e) && canWithdraw(e, gross, ev, by_)
  ensures alwaysWithdrawalFees(withdraw(e, gross, ev, by_))
  ensures stepWithdrawalsRetained(e, withdraw(e, gross, ev, by_))
{
  var a := withdraw(e, gross, ev, by_);
  var w := Withdrawal(ev.transaction, gross, settlement__money_ordinaryFeeAmount(gross), settlement__money_positiveAmount(e.pending));
  assert a.withdrawals == e.withdrawals + [w];
  forall x | x in a.withdrawals ensures settlement__money_validAmount(x.gross) && settlement__money_positiveAmount(x.gross)
    && x.fee == settlement__money_ordinaryFeeAmount(x.gross) && x.transaction != "" {
    if x != w { assert x in e.withdrawals; }
  }
}

lemma EscWithdrawMonthsAwards(e: Escrow, a: Escrow)
  requires alwaysEvmReleaseWhole(e) && alwaysTouchedMonthsShrink(e) && alwaysReleaseWhole(e)
  requires alwaysMonths(e) && alwaysAwards(e) && alwaysReleasedLeavesAdmitted(e)
  requires a.months == e.months && a.awards == e.awards && a.releasedLeaves == e.releasedLeaves
  requires a.asset == e.asset && a.purpose == e.purpose
  ensures alwaysEvmReleaseWhole(a) && alwaysTouchedMonthsShrink(a) && alwaysReleaseWhole(a)
  ensures alwaysMonths(a) && alwaysAwards(a) && alwaysReleasedLeavesAdmitted(a)
  ensures stepAwardsRetained(e, a) && stepMonthsRetained(e, a)
  ensures stepOneRootPerPeriod(e, "withdraw", a)
{
  assert alwaysMonths(a) by {
    forall m | m in a.months ensures validPeriod(m.period) && m.root != "" && m.allocationDigest != ""
      && settlement__money_validAmount(m.remaining) && settlement__money_validAmount(m.released)
      && settlement__money_validAmount(m.admittedGross) && settlement__money_compareAmounts(m.remaining, m.admittedGross) <= 0
      && |Std.Collections.Seq.Filter((other: MonthReserve) => (other.period == m.period), a.months)| == 1 {
      assert m in e.months;
    }
  }
  assert alwaysAwards(a) by {
    forall x | x in a.awards ensures validAward(a, x)
      && |Std.Collections.Seq.Filter((other: Award) => (other.source == x.source), a.awards)| == 1 {
      assert x in e.awards && validAward(e, x);
      if x.origin.MonthlyLeaf? {
        var m :| m in e.months && m.period == x.period;
        assert m in a.months;
      }
    }
  }
  assert stepAwardsRetained(e, a) by {
    forall x | x in e.awards ensures exists y :: y in a.awards && sameAwardTerms(x, y) && (!x.paid || x == y) {
      assert x in a.awards && sameAwardTerms(x, x);
    }
  }
  assert stepMonthsRetained(e, a) by {
    forall x | x in e.months ensures exists y :: y in a.months && sameMonthTerms(x, y) {
      assert x in a.months && sameMonthTerms(x, x);
    }
  }
}

// ---- Accrued fees go to the fee recipient ----

lemma EscClaimCounters(e: Escrow, recipient: string, ev: ChainEvent)
  requires alwaysGrossConserved(e) && alwaysReservedSplit(e) && alwaysPaidSplit(e) && alwaysFeesConserved(e) && alwaysValidCounters(e)
  requires canClaimFees(e, recipient, ev)
  ensures alwaysGrossConserved(claimFees(e, recipient, ev)) && alwaysReservedSplit(claimFees(e, recipient, ev))
  ensures alwaysPaidSplit(claimFees(e, recipient, ev)) && alwaysFeesConserved(claimFees(e, recipient, ev))
  ensures alwaysValidCounters(claimFees(e, recipient, ev))
  ensures stepCumulativeCounters(e, claimFees(e, recipient, ev))
  ensures stepPoolLeavesOnlyByLeafOrRelease(e, "claimFees", claimFees(e, recipient, ev))
  ensures stepFreeLeavesOnlyByOwnerOrRoot(e, "claimFees", claimFees(e, recipient, ev))
  ensures stepFreeEntersOnlyByDepositOrRelease(e, "claimFees", claimFees(e, recipient, ev))
{
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z);
  var c := settlement__money_addAmounts(e.claimedFees, e.accruedFees);
  settlement__money_lawAdditionValid_ensures(e.claimedFees, e.accruedFees);
  // accrued + claimed = claimed + accrued = zero + (claimed + accrued)
  settlement__money_lawAddCommutative_ensures(e.accruedFees, e.claimedFees);
  settlement__money_lawZeroIdentity_ensures(c);
  settlement__money_lawAddCommutative_ensures(z, c);
  EscSym(settlement__money_addAmounts(z, c), c);
  EscChain(settlement__money_addAmounts(e.payoutFees, e.withdrawalFees), settlement__money_addAmounts(e.accruedFees, e.claimedFees), settlement__money_addAmounts(z, c));
  settlement__money_lawAddMonotone_ensures(e.claimedFees, e.accruedFees);
  settlement__money_lawEqualReflexive_ensures(e.deposited);
  settlement__money_lawEqualReflexive_ensures(e.paid);
  settlement__money_lawEqualReflexive_ensures(e.paidNet);
  settlement__money_lawEqualReflexive_ensures(e.payoutFees);
  settlement__money_lawEqualReflexive_ensures(e.grossWithdrawn);
  settlement__money_lawEqualReflexive_ensures(e.withdrawalFees);
  settlement__money_lawEqualReflexive_ensures(e.pending);
  settlement__money_lawEqualReflexive_ensures(e.free);
}

// ---- The vault before creation ----

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z);
  settlement__money_lawZeroIdentity_ensures(z);
  EscSym(settlement__money_addAmounts(z, z), z);
  settlement__money_lawEqualReflexive_ensures(z);
  assert settlement__money_validAmount(settlement__money_maxU128);
  settlement__money_lawZeroOrder_ensures(settlement__money_maxU128);
}

// ---- A lapsed pledge closes ----

lemma EscExpirePledges(e: Escrow, period: int, ev: ChainEvent)
  requires alwaysPledgesCovered(e) && alwaysValidCounters(e) && canExpirePledge(e, period, ev)
  ensures alwaysPledgesCovered(expirePledge(e, period, ev))
  ensures stepPledgeIrrevocable(e, "expirePledge", expirePledge(e, period, ev))
{
  var a := expirePledge(e, period, ev);
  var q := period;
  assert pledgeOf(advance(ev, e), q) == pledgeOf(e, q);
  var c := closePledge(q, e);
  assert a.pledges == c.pledges && a.pledged == c.pledged && a.free == e.free && a.months == e.months;
  var k := EscOpenPledgeAt(e, q);
  EscClosePledge(e, q);
  settlement__money_lawNumericOrderTotal_ensures(c.pledged, e.pledged);
  settlement__money_lawNumericOrderTotal_ensures(e.free, e.pledged);
  settlement__money_lawNumericOrderTransitive_ensures(c.pledged, e.pledged, e.free);
  settlement__money_lawNumericOrderTotal_ensures(e.free, c.pledged);
  assert |a.pledges| == |e.pledges|;
  forall i | 0 <= i < |e.pledges| ensures a.pledges[i] == (if e.pledges[i].period == q then e.pledges[i].(open := false) else e.pledges[i]) {
  }
  forall p | p in a.pledges ensures validPeriod(p.period) && settlement__money_validAmount(p.amount) && settlement__money_positiveAmount(p.amount)
    && |ProofLib.Filter((o: Pledge) => (o.period == p.period), a.pledges)| == 1 && (!(p.open && hasMonth(a, p.period)) || a.asset.network.Solana?) {
    var i :| 0 <= i < |a.pledges| && a.pledges[i] == p;
    var po := e.pledges[i];
    assert po in e.pledges && po.period == p.period;
    ProofLib.FilterLengthPointwise((o: Pledge) => (o.period == p.period), (o: Pledge) => (o.period == p.period), e.pledges, a.pledges);
    ProofLib.FilterSamePredicate((o: Pledge) => (o.period == p.period), (o: Pledge) => (o.period == po.period), e.pledges);
    if p.open && hasMonth(a, p.period) { assert po.open && hasMonth(e, po.period); }
  }
  forall x | x in e.pledges && x.open ensures (pledgeOf(a, x.period).open && settlement__money_compareAmounts(pledgeOf(a, x.period).amount, x.amount) >= 0)
    || pledgeClosable(e, "expirePledge", a, x.period) {
    if x.period != q {
      var i :| 0 <= i < |e.pledges| && e.pledges[i] == x;
      assert a.pledges[i] == x && x in a.pledges;
      EscPledgeOf(a, x);
      settlement__money_lawEqualReflexive_ensures(x.amount);
    }
  }
}

lemma expirePledge_ensures(e: Escrow, period: int, ev: ChainEvent)
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> alwaysEvmReleaseWhole(expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> alwaysTouchedMonthsShrink(expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> alwaysReleaseWhole(expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> alwaysGrossConserved(expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> alwaysReservedSplit(expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> alwaysPaidSplit(expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> alwaysFeesConserved(expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> alwaysValidCounters(expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> alwaysWithdrawalFees(expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> alwaysMonths(expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> alwaysBountyVaultHasNoMonths(expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> alwaysUndeployedEmpty(expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> alwaysReleasedLeavesAdmitted(expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> alwaysPledgesCovered(expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> alwaysAwards(expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> stepEventOrder(e, expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> stepIdentityFixed(e, expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> stepAwardsRetained(e, expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> stepMonthsRetained(e, expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> stepWithdrawalsRetained(e, expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> stepCumulativeCounters(e, expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "expirePledge", expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "expirePledge", expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> stepFreeEntersOnlyByDepositOrRelease(e, "expirePledge", expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> stepManualBlockedWhilePoolPending(e, "expirePledge", expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> stepImplementationOnlyUpgrades(e, expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> stepReleaseNeedsUpgrade(e, "expirePledge", expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> stepOneRootPerPeriod(e, "expirePledge", expirePledge(e, period, ev)))
  ensures (inv(e) ==> canExpirePledge(e, period, ev) ==> stepPledgeIrrevocable(e, "expirePledge", expirePledge(e, period, ev)))
{
  if inv(e) && canExpirePledge(e, period, ev) {
    var a := expirePledge(e, period, ev);
    assert pledgeOf(advance(ev, e), period) == pledgeOf(e, period);
    EscCountersSame(e, a, "expirePledge");
    EscValidSame(e, a);
    EscHistorySame(e, a, "expirePledge");
    EscExpirePledges(e, period, ev);
    EscAdvanceShape(e, a, ev, "expirePledge");
  }
}

// ---- On Solana an uncommittable leaf returns to free funds ----

lemma EscReleaseLeafMonths(e: Escrow, proof: LeafProof, ev: ChainEvent)
  requires alwaysMonths(e) && alwaysTouchedMonthsShrink(e) && alwaysReleaseWhole(e) && alwaysEvmReleaseWhole(e)
  requires alwaysReleasedLeavesAdmitted(e) && canReleaseLeaf(e, proof, ev)
  ensures alwaysMonths(releaseLeaf(e, proof, ev))
  ensures alwaysEvmReleaseWhole(releaseLeaf(e, proof, ev))
  ensures alwaysTouchedMonthsShrink(releaseLeaf(e, proof, ev))
  ensures alwaysReleaseWhole(releaseLeaf(e, proof, ev))
  ensures alwaysReleasedLeavesAdmitted(releaseLeaf(e, proof, ev))
  ensures forall q :: hasMonth(releaseLeaf(e, proof, ev), q) == hasMonth(e, q)
  ensures stepMonthsRetained(e, releaseLeaf(e, proof, ev))
{
  var after := releaseLeaf(e, proof, ev);
  var p := proof.period;
  var g := proof.gross;
  var m0 := monthFor(e, p);
  EscMonthFor(e, p);
  assert m0 in e.months;
  var r1 := settlement__money_subtractAmounts(m0.remaining, g);
  var d1 := settlement__money_addAmounts(m0.released, g);
  EscStrictlyLess(m0.remaining, g);
  settlement__money_lawNumericOrderTransitive_ensures(r1, m0.remaining, m0.admittedGross);
  settlement__money_lawAdditionValid_ensures(m0.released, g);
  var up := m0.(remaining := r1, released := d1);
  var leaf := LeafPosition(p, proof.index);
  assert after.releasedLeaves == e.releasedLeaves + [leaf];
  assert after.awards == e.awards && after.asset == e.asset;
  assert |after.months| == |e.months|;
  forall i | 0 <= i < |e.months| ensures after.months[i] == (if e.months[i].period == p then up else e.months[i]) {
    if e.months[i].period == p { assert e.months[i] in e.months; }
  }
  forall m | m in e.months && m.period != p ensures leafTouched(after, m.period) == leafTouched(e, m.period)
    && (exists l :: l in after.releasedLeaves && l.period == m.period) == (exists l :: l in e.releasedLeaves && l.period == m.period) {
    if exists l :: l in after.releasedLeaves && l.period == m.period {
      var l :| l in after.releasedLeaves && l.period == m.period;
      assert l != leaf && l in e.releasedLeaves;
    }
  }
  assert leaf in after.releasedLeaves && leafTouched(after, p);
  forall m | m in after.months ensures m == up || (m in e.months && m.period != p) {
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
  forall l | l in after.releasedLeaves ensures hasMonth(after, l.period) {
    if l != leaf { assert l in e.releasedLeaves; }
  }
  forall m | m in after.months ensures |ProofLib.Filter((other: MonthReserve) => (other.period == m.period), after.months)| == 1 {
    var i :| 0 <= i < |after.months| && after.months[i] == m;
    var mo := e.months[i];
    assert mo in e.months && mo.period == m.period;
    ProofLib.FilterLengthPointwise((other: MonthReserve) => (other.period == m.period), (other: MonthReserve) => (other.period == m.period), e.months, after.months);
    ProofLib.FilterSamePredicate((other: MonthReserve) => (other.period == m.period), (other: MonthReserve) => (other.period == mo.period), e.months);
  }
}

lemma EscReleaseLeafCounters(e: Escrow, proof: LeafProof, ev: ChainEvent)
  requires alwaysGrossConserved(e) && alwaysReservedSplit(e) && alwaysPaidSplit(e) && alwaysFeesConserved(e) && alwaysValidCounters(e)
  requires alwaysPledgesCovered(e) && canReleaseLeaf(e, proof, ev)
  ensures alwaysGrossConserved(releaseLeaf(e, proof, ev)) && alwaysReservedSplit(releaseLeaf(e, proof, ev))
  ensures alwaysPaidSplit(releaseLeaf(e, proof, ev)) && alwaysFeesConserved(releaseLeaf(e, proof, ev))
  ensures alwaysValidCounters(releaseLeaf(e, proof, ev))
  ensures stepCumulativeCounters(e, releaseLeaf(e, proof, ev))
  ensures stepPoolLeavesOnlyByLeafOrRelease(e, "releaseLeaf", releaseLeaf(e, proof, ev))
  ensures stepFreeLeavesOnlyByOwnerOrRoot(e, "releaseLeaf", releaseLeaf(e, proof, ev))
  ensures stepFreeEntersOnlyByDepositOrRelease(e, "releaseLeaf", releaseLeaf(e, proof, ev))
  ensures settlement__money_compareAmounts(releaseLeaf(e, proof, ev).free, e.pledged) >= 0
{
  var g := proof.gross;
  settlement__money_lawAddCommutative_ensures(e.free, e.committed);
  EscMove(e.held, e.committed, e.free, g);
  EscSubLeft(e.committed, e.pending, e.reserved, g);
  settlement__money_lawAdditionValid_ensures(e.free, g);
  settlement__money_lawSubtractionValid_ensures(e.pending, g);
  settlement__money_lawSubtractionValid_ensures(e.committed, g);
  settlement__money_lawAddMonotone_ensures(e.free, g);
  settlement__money_lawSubtractionAtMost_ensures(e.pending, g);
  settlement__money_lawNumericOrderTotal_ensures(settlement__money_addAmounts(e.free, g), e.free);
  settlement__money_lawNumericOrderTotal_ensures(e.free, e.pledged);
  settlement__money_lawNumericOrderTransitive_ensures(e.pledged, e.free, settlement__money_addAmounts(e.free, g));
  settlement__money_lawNumericOrderTotal_ensures(settlement__money_addAmounts(e.free, g), e.pledged);
  settlement__money_lawEqualReflexive_ensures(e.deposited);
  settlement__money_lawEqualReflexive_ensures(e.paid);
  settlement__money_lawEqualReflexive_ensures(e.paidNet);
  settlement__money_lawEqualReflexive_ensures(e.payoutFees);
  settlement__money_lawEqualReflexive_ensures(e.grossWithdrawn);
  settlement__money_lawEqualReflexive_ensures(e.withdrawalFees);
  settlement__money_lawEqualReflexive_ensures(e.claimedFees);
}

lemma EscReleaseLeafAwards(e: Escrow, proof: LeafProof, ev: ChainEvent)
  requires alwaysWithdrawalFees(e) && alwaysAwards(e) && canReleaseLeaf(e, proof, ev)
  requires forall q :: hasMonth(releaseLeaf(e, proof, ev), q) == hasMonth(e, q)
  ensures alwaysWithdrawalFees(releaseLeaf(e, proof, ev)) && alwaysAwards(releaseLeaf(e, proof, ev))
  ensures stepAwardsRetained(e, releaseLeaf(e, proof, ev)) && stepWithdrawalsRetained(e, releaseLeaf(e, proof, ev))
  ensures stepOneRootPerPeriod(e, "releaseLeaf", releaseLeaf(e, proof, ev))
{
  var a := releaseLeaf(e, proof, ev);
  assert a.awards == e.awards && a.withdrawals == e.withdrawals && a.purpose == e.purpose;
  forall x | x in e.awards ensures exists y :: y in a.awards && sameAwardTerms(x, y) && (!x.paid || x == y) {
    assert x in a.awards && sameAwardTerms(x, x);
  }
  forall x | x in a.awards ensures validAward(a, x) { assert validAward(e, x); }
}

lemma releaseLeaf_ensures(e: Escrow, proof: LeafProof, ev: ChainEvent)
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> alwaysEvmReleaseWhole(releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> alwaysTouchedMonthsShrink(releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> alwaysReleaseWhole(releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> alwaysGrossConserved(releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> alwaysReservedSplit(releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> alwaysPaidSplit(releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> alwaysFeesConserved(releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> alwaysValidCounters(releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> alwaysWithdrawalFees(releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> alwaysMonths(releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> alwaysBountyVaultHasNoMonths(releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> alwaysUndeployedEmpty(releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> alwaysReleasedLeavesAdmitted(releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> alwaysPledgesCovered(releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> alwaysAwards(releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> stepEventOrder(e, releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> stepIdentityFixed(e, releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> stepAwardsRetained(e, releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> stepMonthsRetained(e, releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> stepWithdrawalsRetained(e, releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> stepCumulativeCounters(e, releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "releaseLeaf", releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "releaseLeaf", releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> stepFreeEntersOnlyByDepositOrRelease(e, "releaseLeaf", releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> stepManualBlockedWhilePoolPending(e, "releaseLeaf", releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> stepImplementationOnlyUpgrades(e, releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> stepReleaseNeedsUpgrade(e, "releaseLeaf", releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> stepOneRootPerPeriod(e, "releaseLeaf", releaseLeaf(e, proof, ev)))
  ensures (inv(e) ==> canReleaseLeaf(e, proof, ev) ==> stepPledgeIrrevocable(e, "releaseLeaf", releaseLeaf(e, proof, ev)))
{
  if inv(e) && canReleaseLeaf(e, proof, ev) {
    var a := releaseLeaf(e, proof, ev);
    EscReleaseLeafMonths(e, proof, ev);
    EscReleaseLeafCounters(e, proof, ev);
    EscReleaseLeafAwards(e, proof, ev);
    EscPledgesSame(e, a, "releaseLeaf");
    EscAdvanceShape(e, a, ev, "releaseLeaf");
  }
}

// ---- Paying one award ----

// Taking a split amount out of a split total keeps it split.
lemma EscSubSplit(r: seq<int>, p: seq<int>, q: seq<int>, g: seq<int>, n: seq<int>, f: seq<int>)
  requires settlement__money_validAmount(r) && settlement__money_validAmount(p) && settlement__money_validAmount(q)
  requires settlement__money_validAmount(g) && settlement__money_validAmount(n) && settlement__money_validAmount(f)
  requires settlement__money_equalAmounts(r, settlement__money_addAmounts(p, q))
  requires settlement__money_equalAmounts(g, settlement__money_addAmounts(n, f))
  requires settlement__money_compareAmounts(p, n) >= 0 && settlement__money_compareAmounts(q, f) >= 0 && settlement__money_compareAmounts(r, g) >= 0
  ensures settlement__money_equalAmounts(settlement__money_subtractAmounts(r, g),
    settlement__money_addAmounts(settlement__money_subtractAmounts(p, n), settlement__money_subtractAmounts(q, f)))
{
  var p1 := settlement__money_subtractAmounts(p, n);
  var q1 := settlement__money_subtractAmounts(q, f);
  var x := settlement__money_addAmounts(p1, q1);
  var nf := settlement__money_addAmounts(n, f);
  var pn := settlement__money_addAmounts(p1, n);
  var qf := settlement__money_addAmounts(q1, f);
  settlement__money_lawSubtractionValid_ensures(p, n);
  settlement__money_lawSubtractionValid_ensures(q, f);
  settlement__money_lawAdditionValid_ensures(p1, q1);
  settlement__money_lawAdditionValid_ensures(n, f);
  settlement__money_lawAdditionValid_ensures(p1, n);
  settlement__money_lawAdditionValid_ensures(q1, f);
  settlement__money_lawAdditionValid_ensures(pn, q);
  settlement__money_lawAdditionValid_ensures(pn, qf);
  settlement__money_lawAdditionValid_ensures(x, nf);
  settlement__money_lawAdditionValid_ensures(x, g);
  settlement__money_lawSubtractionReconstructs_ensures(p, n);
  settlement__money_lawSubtractionReconstructs_ensures(q, f);
  // p + q = (p1 + n) + q = (p1 + n) + (q1 + f)
  settlement__money_lawAddCongruence_ensures(pn, p, q);
  settlement__money_lawAddCongruence_ensures(qf, q, pn);
  EscSym(settlement__money_addAmounts(pn, q), settlement__money_addAmounts(p, q));
  EscSym(settlement__money_addAmounts(pn, qf), settlement__money_addAmounts(pn, q));
  EscChain(settlement__money_addAmounts(p, q), settlement__money_addAmounts(pn, q), settlement__money_addAmounts(pn, qf));
  // (p1 + n) + (q1 + f) = p1 + (n + (q1 + f)) = p1 + ((n + q1) + f) = p1 + ((q1 + n) + f) = p1 + (q1 + (n + f)) = x + (n + f)
  var nqf := settlement__money_addAmounts(n, qf);
  var qnf := settlement__money_addAmounts(q1, nf);
  settlement__money_lawAdditionValid_ensures(n, qf);
  settlement__money_lawAdditionValid_ensures(q1, nf);
  settlement__money_lawAdditionValid_ensures(n, q1);
  settlement__money_lawAddAssociative_ensures(p1, n, qf);
  settlement__money_lawAddAssociative_ensures(n, q1, f);
  settlement__money_lawAddCommutative_ensures(n, q1);
  settlement__money_lawAddAssociative_ensures(q1, n, f);
  EscSym(settlement__money_addAmounts(settlement__money_addAmounts(n, q1), f), nqf);
  EscChain(nqf, settlement__money_addAmounts(settlement__money_addAmounts(n, q1), f), qnf);
  settlement__money_lawAddCongruence_ensures(nqf, qnf, p1);
  settlement__money_lawAddAssociative_ensures(p1, q1, nf);
  EscSym(settlement__money_addAmounts(x, nf), settlement__money_addAmounts(p1, qnf));
  EscChain(settlement__money_addAmounts(pn, qf), settlement__money_addAmounts(p1, nqf), settlement__money_addAmounts(p1, qnf));
  EscChain(settlement__money_addAmounts(pn, qf), settlement__money_addAmounts(p1, qnf), settlement__money_addAmounts(x, nf));
  // x + (n + f) = x + g
  EscSym(g, nf);
  settlement__money_lawAddCongruence_ensures(nf, g, x);
  EscChain(settlement__money_addAmounts(pn, qf), settlement__money_addAmounts(x, nf), settlement__money_addAmounts(x, g));
  EscChain(settlement__money_addAmounts(p, q), settlement__money_addAmounts(pn, qf), settlement__money_addAmounts(x, g));
  EscChain(r, settlement__money_addAmounts(p, q), settlement__money_addAmounts(x, g));
  // r - g = (x + g) - g = x
  settlement__money_lawSubtractCongruence_ensures(r, settlement__money_addAmounts(x, g), g);
  EscCancel(x, g);
  EscChain(settlement__money_subtractAmounts(r, g), settlement__money_subtractAmounts(settlement__money_addAmounts(x, g), g), x);
}

// The award a source names is the one award of that source.
lemma EscAwardFor(e: Escrow, source: SourceKey)
  requires alwaysAwards(e) && awardFor(e, source).source == source && validSource(source)
  ensures awardFor(e, source) in e.awards && validAward(e, awardFor(e, source))
  ensures forall x :: x in e.awards && x.source == source ==> x == awardFor(e, source)
{
  var s := source;
  var w := awardFor(e, s);
  if |ProofLib.Filter((a: Award) => (a.source == s), e.awards)| == 0 { assert w == noAward; assert noAward.source == noSource; assert false; }
  ProofLib.FilterMember((a: Award) => (a.source == s), e.awards, w);
  forall x | x in e.awards && x.source == s ensures x == w {
    ProofLib.FilterMember((a: Award) => (a.source == s), e.awards, x);
    ProofLib.FilterSamePredicate((other: Award) => (other.source == w.source), (a: Award) => (a.source == s), e.awards);
    var flt := ProofLib.Filter((a: Award) => (a.source == s), e.awards);
    assert |flt| == 1;
    assert x in flt && w in flt;
  }
}

lemma EscPayCounters(e: Escrow, source: SourceKey, binding: PayableBinding, ev: ChainEvent)
  requires alwaysGrossConserved(e) && alwaysReservedSplit(e) && alwaysPaidSplit(e) && alwaysFeesConserved(e) && alwaysValidCounters(e)
  requires alwaysAwards(e) && canPay(e, source, binding, ev)
  ensures alwaysGrossConserved(pay(e, source, binding, ev)) && alwaysReservedSplit(pay(e, source, binding, ev))
  ensures alwaysPaidSplit(pay(e, source, binding, ev)) && alwaysFeesConserved(pay(e, source, binding, ev))
  ensures alwaysValidCounters(pay(e, source, binding, ev))
  ensures stepCumulativeCounters(e, pay(e, source, binding, ev))
  ensures stepPoolLeavesOnlyByLeafOrRelease(e, "pay", pay(e, source, binding, ev))
  ensures stepFreeLeavesOnlyByOwnerOrRoot(e, "pay", pay(e, source, binding, ev))
  ensures stepFreeEntersOnlyByDepositOrRelease(e, "pay", pay(e, source, binding, ev))
  ensures pay(e, source, binding, ev).free == e.free
{
  var w := awardFor(e, source);
  EscAwardFor(e, source);
  var g := w.gross;
  var f := w.fee;
  EscFeeSplit(e.purpose, g);
  var n := settlement__money_subtractAmounts(g, f);
  EscSym(settlement__money_addAmounts(n, f), g);
  // deposited = (held - g) + (spent + g); held - g = free + (committed - g); committed - g = pending + (reserved - g)
  EscMove(e.deposited, e.held, e.spent, g);
  EscSubRight(e.held, e.free, e.committed, g);
  EscSubRight(e.committed, e.pending, e.reserved, g);
  EscAddLeft(e.spent, e.paid, e.grossWithdrawn, g);
  EscSubSplit(e.reserved, e.reservedPrincipal, e.reservedFees, g, n, f);
  EscAddSplit(e.paid, e.paidNet, e.payoutFees, g, f);
  // (payout + f) + withdrawal fees = (accrued + f) + claimed
  var pw := settlement__money_addAmounts(e.payoutFees, e.withdrawalFees);
  settlement__money_lawAdditionValid_ensures(e.payoutFees, e.withdrawalFees);
  settlement__money_lawEqualReflexive_ensures(pw);
  EscAddLeft(pw, e.payoutFees, e.withdrawalFees, f);
  EscAddLeft(pw, e.accruedFees, e.claimedFees, f);
  EscSym(settlement__money_addAmounts(pw, f), settlement__money_addAmounts(settlement__money_addAmounts(e.payoutFees, f), e.withdrawalFees));
  EscChain(settlement__money_addAmounts(settlement__money_addAmounts(e.payoutFees, f), e.withdrawalFees), settlement__money_addAmounts(pw, f),
    settlement__money_addAmounts(settlement__money_addAmounts(e.accruedFees, f), e.claimedFees));
  settlement__money_lawSubtractionValid_ensures(e.reserved, g);
  settlement__money_lawSubtractionValid_ensures(e.committed, g);
  settlement__money_lawSubtractionValid_ensures(e.held, g);
  settlement__money_lawSubtractionValid_ensures(e.reservedPrincipal, n);
  settlement__money_lawSubtractionValid_ensures(e.reservedFees, f);
  settlement__money_lawAdditionValid_ensures(e.paid, g);
  settlement__money_lawAdditionValid_ensures(e.spent, g);
  settlement__money_lawAdditionValid_ensures(e.paidNet, n);
  settlement__money_lawAdditionValid_ensures(e.payoutFees, f);
  settlement__money_lawAdditionValid_ensures(e.accruedFees, f);
  settlement__money_lawAddMonotone_ensures(e.paid, g);
  settlement__money_lawAddMonotone_ensures(e.paidNet, n);
  settlement__money_lawAddMonotone_ensures(e.payoutFees, f);
  settlement__money_lawEqualReflexive_ensures(e.deposited);
  settlement__money_lawEqualReflexive_ensures(e.grossWithdrawn);
  settlement__money_lawEqualReflexive_ensures(e.withdrawalFees);
  settlement__money_lawEqualReflexive_ensures(e.claimedFees);
  settlement__money_lawEqualReflexive_ensures(e.pending);
  settlement__money_lawEqualReflexive_ensures(e.free);
}

// Filtering out one source and appending its paid award keeps every other award and the count.
lemma EscFilterSplit(p: Award -> bool, q: Award -> bool, xs: seq<Award>)
  requires forall x :: q(x) == !p(x)
  ensures |ProofLib.Filter(p, xs)| + |ProofLib.Filter(q, xs)| == |xs|
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(p, xs);
    ProofLib.FilterNil(q, xs);
  } else {
    ProofLib.FilterCons(p, xs);
    ProofLib.FilterCons(q, xs);
    EscFilterSplit(p, q, xs[1..]);
  }
}

// The awards after a payment: the paid award replaces the one award of its source, and every other award is kept.
lemma EscPayList(e: Escrow, source: SourceKey, binding: PayableBinding, ev: ChainEvent)
  requires alwaysAwards(e) && canPay(e, source, binding, ev)
  ensures pay(e, source, binding, ev).awards ==
    ProofLib.Filter((x: Award) => (x.source != source), e.awards) + [markPaid(awardFor(e, source), binding.destination, binding.version, ev.transaction)]
  ensures |pay(e, source, binding, ev).awards| == |e.awards|
  ensures awardFor(e, source) in e.awards && validAward(e, awardFor(e, source)) && !awardFor(e, source).paid
  ensures forall x :: x in e.awards && x.source == source ==> x == awardFor(e, source)
  ensures forall x :: x in pay(e, source, binding, ev).awards ==>
    x == markPaid(awardFor(e, source), binding.destination, binding.version, ev.transaction) || (x in e.awards && x.source != source)
  ensures forall x :: x in e.awards && x.source != source ==> x in pay(e, source, binding, ev).awards
  ensures pay(e, source, binding, ev).months == e.months && pay(e, source, binding, ev).releasedLeaves == e.releasedLeaves
  ensures pay(e, source, binding, ev).withdrawals == e.withdrawals && pay(e, source, binding, ev).purpose == e.purpose
  ensures pay(e, source, binding, ev).asset == e.asset
{
  var a := pay(e, source, binding, ev);
  var s := source;
  var w := awardFor(e, s);
  EscAwardFor(e, s);
  var y := markPaid(w, binding.destination, binding.version, ev.transaction);
  var kept := ProofLib.Filter((x: Award) => (x.source != s), e.awards);
  assert a.awards == kept + [y];
  forall x | x in kept ensures x in e.awards && x.source != s {
    ProofLib.FilterMember((x: Award) => (x.source != s), e.awards, x);
  }
  forall x | x in e.awards && x.source != s ensures x in kept {
    ProofLib.FilterMember((x: Award) => (x.source != s), e.awards, x);
  }
  ProofLib.FilterSamePredicate((other: Award) => (other.source == w.source), (x: Award) => (x.source == s), e.awards);
  EscFilterSplit((x: Award) => (x.source == s), (x: Award) => (x.source != s), e.awards);
}

lemma EscPayRetained(e: Escrow, source: SourceKey, binding: PayableBinding, ev: ChainEvent)
  requires alwaysAwards(e) && canPay(e, source, binding, ev)
  ensures stepAwardsRetained(e, pay(e, source, binding, ev))
{
  var a := pay(e, source, binding, ev);
  EscPayList(e, source, binding, ev);
  var w := awardFor(e, source);
  var y := markPaid(w, binding.destination, binding.version, ev.transaction);
  assert y in a.awards && sameAwardTerms(w, y);
  forall x | x in e.awards ensures exists z :: z in a.awards && sameAwardTerms(x, z) && (!x.paid || x == z) {
    if x.source == source { assert x == w; } else { assert x in a.awards && sameAwardTerms(x, x); }
  }
}

lemma EscPayMonths(e: Escrow, source: SourceKey, binding: PayableBinding, ev: ChainEvent)
  requires alwaysWithdrawalFees(e) && alwaysMonths(e)
  ensures stepMonthsRetained(e, pay(e, source, binding, ev))
  ensures stepWithdrawalsRetained(e, pay(e, source, binding, ev)) && alwaysWithdrawalFees(pay(e, source, binding, ev))
  ensures alwaysMonths(pay(e, source, binding, ev))
  ensures stepOneRootPerPeriod(e, "pay", pay(e, source, binding, ev))
{
  var a := pay(e, source, binding, ev);
  assert a.months == e.months && a.withdrawals == e.withdrawals;
  forall x | x in e.months ensures exists z :: z in a.months && sameMonthTerms(x, z) {
    assert x in a.months && sameMonthTerms(x, x);
  }
}

lemma EscPayLeaves(e: Escrow, source: SourceKey, binding: PayableBinding, ev: ChainEvent)
  requires alwaysEvmReleaseWhole(e) && alwaysTouchedMonthsShrink(e) && alwaysReleaseWhole(e) && alwaysReleasedLeavesAdmitted(e)
  requires alwaysAwards(e) && canPay(e, source, binding, ev)
  ensures alwaysEvmReleaseWhole(pay(e, source, binding, ev)) && alwaysTouchedMonthsShrink(pay(e, source, binding, ev))
  ensures alwaysReleaseWhole(pay(e, source, binding, ev)) && alwaysReleasedLeavesAdmitted(pay(e, source, binding, ev))
{
  var a := pay(e, source, binding, ev);
  EscPayList(e, source, binding, ev);
  var w := awardFor(e, source);
  var y := markPaid(w, binding.destination, binding.version, ev.transaction);
  assert y in a.awards;
  forall m | m in e.months ensures (exists x :: x in a.awards && x.origin.MonthlyLeaf? && x.period == m.period) == (exists x :: x in e.awards && x.origin.MonthlyLeaf? && x.period == m.period) {
    if exists x :: x in a.awards && x.origin.MonthlyLeaf? && x.period == m.period {
      var x :| x in a.awards && x.origin.MonthlyLeaf? && x.period == m.period;
      if x == y { assert w in e.awards; } else { assert x in e.awards; }
    }
    if exists x :: x in e.awards && x.origin.MonthlyLeaf? && x.period == m.period {
      var x :| x in e.awards && x.origin.MonthlyLeaf? && x.period == m.period;
      if x.source == source { assert x == w; } else { assert x in a.awards; }
    }
  }
}

lemma EscPayValid(e: Escrow, source: SourceKey, binding: PayableBinding, ev: ChainEvent)
  requires alwaysAwards(e) && canPay(e, source, binding, ev)
  ensures alwaysAwards(pay(e, source, binding, ev))
{
  var a := pay(e, source, binding, ev);
  var s := source;
  EscPayList(e, source, binding, ev);
  var w := awardFor(e, s);
  var y := markPaid(w, binding.destination, binding.version, ev.transaction);
  var kept := ProofLib.Filter((x: Award) => (x.source != s), e.awards);
  forall x | x in kept ensures x in e.awards && x.source != s {
    ProofLib.FilterMember((x: Award) => (x.source != s), e.awards, x);
  }
  forall x | x in a.awards ensures validAward(a, x) && |ProofLib.Filter((other: Award) => (other.source == x.source), a.awards)| == 1 {
    var key := x.source;
    ProofLib.FilterAppend((other: Award) => (other.source == key), kept, y);
    if x == y {
      ProofLib.FilterNone((other: Award) => (other.source == key), kept);
      forall i | 0 <= i < |kept| ensures kept[i].source != key { assert kept[i] in kept; }
    } else {
      assert x in e.awards && validAward(e, x) && key != s;
      ProofLib.FilterOfFilterLength((z: Award) => (z.source != s), (other: Award) => (other.source == key), (other: Award) => (other.source == key), e.awards);
      ProofLib.FilterMember((other: Award) => (other.source == key), kept, x);
      assert x in kept;
    }
  }
}

lemma pay_ensures(e: Escrow, source: SourceKey, binding: PayableBinding, ev: ChainEvent)
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> alwaysEvmReleaseWhole(pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> alwaysTouchedMonthsShrink(pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> alwaysReleaseWhole(pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> alwaysGrossConserved(pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> alwaysReservedSplit(pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> alwaysPaidSplit(pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> alwaysFeesConserved(pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> alwaysValidCounters(pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> alwaysWithdrawalFees(pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> alwaysMonths(pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> alwaysBountyVaultHasNoMonths(pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> alwaysUndeployedEmpty(pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> alwaysReleasedLeavesAdmitted(pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> alwaysPledgesCovered(pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> alwaysAwards(pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> stepEventOrder(e, pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> stepIdentityFixed(e, pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> stepAwardsRetained(e, pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> stepMonthsRetained(e, pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> stepWithdrawalsRetained(e, pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> stepCumulativeCounters(e, pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "pay", pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "pay", pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> stepFreeEntersOnlyByDepositOrRelease(e, "pay", pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> stepManualBlockedWhilePoolPending(e, "pay", pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> stepImplementationOnlyUpgrades(e, pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> stepReleaseNeedsUpgrade(e, "pay", pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> stepOneRootPerPeriod(e, "pay", pay(e, source, binding, ev)))
  ensures (inv(e) ==> canPay(e, source, binding, ev) ==> stepPledgeIrrevocable(e, "pay", pay(e, source, binding, ev)))
{
  if inv(e) && canPay(e, source, binding, ev) {
    var a := pay(e, source, binding, ev);
    EscPayCounters(e, source, binding, ev);
    EscPayRetained(e, source, binding, ev);
    EscPayMonths(e, source, binding, ev);
    EscPayLeaves(e, source, binding, ev);
    EscPayValid(e, source, binding, ev);
    EscPledgesSame(e, a, "pay");
    EscAdvanceShape(e, a, ev, "pay");
  }
}

// ---- The generated obligations of the transitions proved here ----

lemma deploy_ensures(e: Escrow, asset: AssetIdentity, mint: MintFacts, purpose: VaultPurpose, delay: int, cap: seq<int>, turnOn: bool)
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> alwaysEvmReleaseWhole(deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> alwaysTouchedMonthsShrink(deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> alwaysReleaseWhole(deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> alwaysGrossConserved(deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> alwaysReservedSplit(deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> alwaysPaidSplit(deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> alwaysFeesConserved(deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> alwaysValidCounters(deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> alwaysWithdrawalFees(deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> alwaysMonths(deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> alwaysBountyVaultHasNoMonths(deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> alwaysUndeployedEmpty(deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> alwaysReleasedLeavesAdmitted(deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> alwaysPledgesCovered(deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> alwaysAwards(deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> stepEventOrder(e, deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> stepIdentityFixed(e, deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> stepAwardsRetained(e, deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> stepMonthsRetained(e, deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> stepWithdrawalsRetained(e, deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> stepCumulativeCounters(e, deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "deploy", deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "deploy", deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> stepFreeEntersOnlyByDepositOrRelease(e, "deploy", deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> stepManualBlockedWhilePoolPending(e, "deploy", deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> stepImplementationOnlyUpgrades(e, deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> stepReleaseNeedsUpgrade(e, "deploy", deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> stepOneRootPerPeriod(e, "deploy", deploy(e, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(e) ==> canDeploy(e, asset, mint, purpose, delay, cap, turnOn) ==> stepPledgeIrrevocable(e, "deploy", deploy(e, asset, mint, purpose, delay, cap, turnOn)))
{
  if inv(e) && canDeploy(e, asset, mint, purpose, delay, cap, turnOn) {
    var a := deploy(e, asset, mint, purpose, delay, cap, turnOn);
    EscCountersSame(e, a, "deploy");
    EscDeployValid(e, asset, mint, purpose, delay, cap, turnOn);
    EscHistorySame(e, a, "deploy");
    EscPledgesSame(e, a, "deploy");
    EscDeployShape(e, asset, mint, purpose, delay, cap, turnOn);
  }
}

lemma upgradeToRelease_ensures(e: Escrow, ev: ChainEvent)
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> alwaysEvmReleaseWhole(upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> alwaysTouchedMonthsShrink(upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> alwaysReleaseWhole(upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> alwaysGrossConserved(upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> alwaysReservedSplit(upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> alwaysPaidSplit(upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> alwaysFeesConserved(upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> alwaysValidCounters(upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> alwaysWithdrawalFees(upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> alwaysMonths(upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> alwaysBountyVaultHasNoMonths(upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> alwaysUndeployedEmpty(upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> alwaysReleasedLeavesAdmitted(upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> alwaysPledgesCovered(upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> alwaysAwards(upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> stepEventOrder(e, upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> stepIdentityFixed(e, upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> stepAwardsRetained(e, upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> stepMonthsRetained(e, upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> stepWithdrawalsRetained(e, upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> stepCumulativeCounters(e, upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "upgradeToRelease", upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "upgradeToRelease", upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> stepFreeEntersOnlyByDepositOrRelease(e, "upgradeToRelease", upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> stepManualBlockedWhilePoolPending(e, "upgradeToRelease", upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> stepImplementationOnlyUpgrades(e, upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> stepReleaseNeedsUpgrade(e, "upgradeToRelease", upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> stepOneRootPerPeriod(e, "upgradeToRelease", upgradeToRelease(e, ev)))
  ensures (inv(e) ==> canUpgradeToRelease(e, ev) ==> stepPledgeIrrevocable(e, "upgradeToRelease", upgradeToRelease(e, ev)))
{
  if inv(e) && canUpgradeToRelease(e, ev) {
    var a := upgradeToRelease(e, ev);
    EscCountersSame(e, a, "upgradeToRelease");
    EscValidSame(e, a);
    EscHistorySame(e, a, "upgradeToRelease");
    EscPledgesSame(e, a, "upgradeToRelease");
    EscAdvanceShape(e, a, ev, "upgradeToRelease");
  }
}

lemma observeAuthority_ensures(e: Escrow, authority: string, ev: ChainEvent)
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> alwaysEvmReleaseWhole(observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> alwaysTouchedMonthsShrink(observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> alwaysReleaseWhole(observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> alwaysGrossConserved(observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> alwaysReservedSplit(observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> alwaysPaidSplit(observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> alwaysFeesConserved(observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> alwaysValidCounters(observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> alwaysWithdrawalFees(observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> alwaysMonths(observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> alwaysBountyVaultHasNoMonths(observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> alwaysUndeployedEmpty(observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> alwaysReleasedLeavesAdmitted(observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> alwaysPledgesCovered(observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> alwaysAwards(observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> stepEventOrder(e, observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> stepIdentityFixed(e, observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> stepAwardsRetained(e, observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> stepMonthsRetained(e, observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> stepWithdrawalsRetained(e, observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> stepCumulativeCounters(e, observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "observeAuthority", observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "observeAuthority", observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> stepFreeEntersOnlyByDepositOrRelease(e, "observeAuthority", observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> stepManualBlockedWhilePoolPending(e, "observeAuthority", observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> stepImplementationOnlyUpgrades(e, observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> stepReleaseNeedsUpgrade(e, "observeAuthority", observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> stepOneRootPerPeriod(e, "observeAuthority", observeAuthority(e, authority, ev)))
  ensures (inv(e) ==> canObserveAuthority(e, authority, ev) ==> stepPledgeIrrevocable(e, "observeAuthority", observeAuthority(e, authority, ev)))
{
  if inv(e) && canObserveAuthority(e, authority, ev) {
    var a := observeAuthority(e, authority, ev);
    EscCountersSame(e, a, "observeAuthority");
    EscValidSame(e, a);
    EscHistorySame(e, a, "observeAuthority");
    EscPledgesSame(e, a, "observeAuthority");
    EscAdvanceShape(e, a, ev, "observeAuthority");
  }
}

lemma setMonthly_ensures(e: Escrow, cap: seq<int>, turnOn: bool, ev: ChainEvent, by_: string)
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> alwaysEvmReleaseWhole(setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> alwaysTouchedMonthsShrink(setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> alwaysReleaseWhole(setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> alwaysGrossConserved(setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> alwaysReservedSplit(setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> alwaysPaidSplit(setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> alwaysFeesConserved(setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> alwaysValidCounters(setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> alwaysWithdrawalFees(setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> alwaysMonths(setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> alwaysBountyVaultHasNoMonths(setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> alwaysUndeployedEmpty(setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> alwaysReleasedLeavesAdmitted(setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> alwaysPledgesCovered(setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> alwaysAwards(setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> stepEventOrder(e, setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> stepIdentityFixed(e, setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> stepAwardsRetained(e, setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> stepMonthsRetained(e, setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> stepWithdrawalsRetained(e, setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> stepCumulativeCounters(e, setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "setMonthly", setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "setMonthly", setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> stepFreeEntersOnlyByDepositOrRelease(e, "setMonthly", setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> stepManualBlockedWhilePoolPending(e, "setMonthly", setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> stepImplementationOnlyUpgrades(e, setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> stepReleaseNeedsUpgrade(e, "setMonthly", setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> stepOneRootPerPeriod(e, "setMonthly", setMonthly(e, cap, turnOn, ev, by_)))
  ensures (inv(e) ==> canSetMonthly(e, cap, turnOn, ev, by_) ==> stepPledgeIrrevocable(e, "setMonthly", setMonthly(e, cap, turnOn, ev, by_)))
{
  if inv(e) && canSetMonthly(e, cap, turnOn, ev, by_) {
    var a := setMonthly(e, cap, turnOn, ev, by_);
    EscCountersSame(e, a, "setMonthly");
    EscSetMonthlyValid(e, cap, turnOn, ev, by_);
    EscHistorySame(e, a, "setMonthly");
    EscPledgesSame(e, a, "setMonthly");
    EscAdvanceShape(e, a, ev, "setMonthly");
  }
}

lemma EscSetMonthlyValid(e: Escrow, cap: seq<int>, turnOn: bool, ev: ChainEvent, by_: string)
  requires alwaysValidCounters(e) && canSetMonthly(e, cap, turnOn, ev, by_)
  ensures alwaysValidCounters(setMonthly(e, cap, turnOn, ev, by_))
{
}

lemma commitAward_ensures(e: Escrow, source: SourceKey, actor: int, gross: seq<int>, ev: ChainEvent, by_: string)
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> alwaysEvmReleaseWhole(commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> alwaysTouchedMonthsShrink(commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> alwaysReleaseWhole(commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> alwaysGrossConserved(commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> alwaysReservedSplit(commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> alwaysPaidSplit(commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> alwaysFeesConserved(commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> alwaysValidCounters(commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> alwaysWithdrawalFees(commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> alwaysMonths(commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> alwaysBountyVaultHasNoMonths(commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> alwaysUndeployedEmpty(commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> alwaysReleasedLeavesAdmitted(commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> alwaysPledgesCovered(commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> alwaysAwards(commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> stepEventOrder(e, commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> stepIdentityFixed(e, commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> stepAwardsRetained(e, commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> stepMonthsRetained(e, commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> stepWithdrawalsRetained(e, commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> stepCumulativeCounters(e, commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "commitAward", commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "commitAward", commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> stepFreeEntersOnlyByDepositOrRelease(e, "commitAward", commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> stepManualBlockedWhilePoolPending(e, "commitAward", commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> stepImplementationOnlyUpgrades(e, commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> stepReleaseNeedsUpgrade(e, "commitAward", commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> stepOneRootPerPeriod(e, "commitAward", commitAward(e, source, actor, gross, ev, by_)))
  ensures (inv(e) ==> canCommitAward(e, source, actor, gross, ev, by_) ==> stepPledgeIrrevocable(e, "commitAward", commitAward(e, source, actor, gross, ev, by_)))
{
  if inv(e) && canCommitAward(e, source, actor, gross, ev, by_) {
    var a := commitAward(e, source, actor, gross, ev, by_);
    EscCommitCounters(e, source, actor, gross, ev, by_);
    EscCommitHistory(e, source, actor, gross, ev, by_);
    EscPledgesSame(e, a, "commitAward");
    EscAdvanceShape(e, a, ev, "commitAward");
  }
}

lemma materialize_ensures(e: Escrow, proof: LeafProof, ev: ChainEvent)
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> alwaysEvmReleaseWhole(materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> alwaysTouchedMonthsShrink(materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> alwaysReleaseWhole(materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> alwaysGrossConserved(materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> alwaysReservedSplit(materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> alwaysPaidSplit(materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> alwaysFeesConserved(materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> alwaysValidCounters(materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> alwaysWithdrawalFees(materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> alwaysMonths(materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> alwaysBountyVaultHasNoMonths(materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> alwaysUndeployedEmpty(materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> alwaysReleasedLeavesAdmitted(materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> alwaysPledgesCovered(materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> alwaysAwards(materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> stepEventOrder(e, materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> stepIdentityFixed(e, materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> stepAwardsRetained(e, materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> stepMonthsRetained(e, materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> stepWithdrawalsRetained(e, materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> stepCumulativeCounters(e, materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "materialize", materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "materialize", materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> stepFreeEntersOnlyByDepositOrRelease(e, "materialize", materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> stepManualBlockedWhilePoolPending(e, "materialize", materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> stepImplementationOnlyUpgrades(e, materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> stepReleaseNeedsUpgrade(e, "materialize", materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> stepOneRootPerPeriod(e, "materialize", materialize(e, proof, ev)))
  ensures (inv(e) ==> canMaterialize(e, proof, ev) ==> stepPledgeIrrevocable(e, "materialize", materialize(e, proof, ev)))
{
  if inv(e) && canMaterialize(e, proof, ev) {
    var a := materialize(e, proof, ev);
    EscMaterializeMonths(e, proof, ev);
    EscMaterializeCounters(e, proof, ev);
    EscMaterializeAwards(e, proof, ev);
    EscPledgesSame(e, a, "materialize");
    EscAdvanceShape(e, a, ev, "materialize");
  }
}

lemma admitRoot_ensures(e: Escrow, authorization: RootAuthorization, ev: ChainEvent)
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> alwaysEvmReleaseWhole(admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> alwaysTouchedMonthsShrink(admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> alwaysReleaseWhole(admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> alwaysGrossConserved(admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> alwaysReservedSplit(admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> alwaysPaidSplit(admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> alwaysFeesConserved(admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> alwaysValidCounters(admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> alwaysWithdrawalFees(admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> alwaysMonths(admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> alwaysBountyVaultHasNoMonths(admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> alwaysUndeployedEmpty(admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> alwaysReleasedLeavesAdmitted(admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> alwaysPledgesCovered(admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> alwaysAwards(admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> stepEventOrder(e, admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> stepIdentityFixed(e, admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> stepAwardsRetained(e, admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> stepMonthsRetained(e, admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> stepWithdrawalsRetained(e, admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> stepCumulativeCounters(e, admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "admitRoot", admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "admitRoot", admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> stepFreeEntersOnlyByDepositOrRelease(e, "admitRoot", admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> stepManualBlockedWhilePoolPending(e, "admitRoot", admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> stepImplementationOnlyUpgrades(e, admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> stepReleaseNeedsUpgrade(e, "admitRoot", admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> stepOneRootPerPeriod(e, "admitRoot", admitRoot(e, authorization, ev)))
  ensures (inv(e) ==> canAdmitRoot(e, authorization, ev) ==> stepPledgeIrrevocable(e, "admitRoot", admitRoot(e, authorization, ev)))
{
  if inv(e) && canAdmitRoot(e, authorization, ev) {
    EscAdmitCounters(e, authorization, ev);
    EscAdmitMonthsValid(e, authorization, ev);
    EscAdmitMonthsUntouched(e, authorization, ev);
    EscAdmitAwards(e, authorization, ev);
    EscAdmitPledges(e, authorization, ev);
    EscAdmitShape(e, authorization, ev);
  }
}

lemma deposit_ensures(e: Escrow, funds: Deposit, ev: ChainEvent)
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> alwaysEvmReleaseWhole(deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> alwaysTouchedMonthsShrink(deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> alwaysReleaseWhole(deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> alwaysGrossConserved(deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> alwaysReservedSplit(deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> alwaysPaidSplit(deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> alwaysFeesConserved(deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> alwaysValidCounters(deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> alwaysWithdrawalFees(deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> alwaysMonths(deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> alwaysBountyVaultHasNoMonths(deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> alwaysUndeployedEmpty(deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> alwaysReleasedLeavesAdmitted(deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> alwaysPledgesCovered(deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> alwaysAwards(deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> stepEventOrder(e, deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> stepIdentityFixed(e, deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> stepAwardsRetained(e, deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> stepMonthsRetained(e, deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> stepWithdrawalsRetained(e, deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> stepCumulativeCounters(e, deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "deposit", deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "deposit", deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> stepFreeEntersOnlyByDepositOrRelease(e, "deposit", deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> stepManualBlockedWhilePoolPending(e, "deposit", deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> stepImplementationOnlyUpgrades(e, deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> stepReleaseNeedsUpgrade(e, "deposit", deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> stepOneRootPerPeriod(e, "deposit", deposit(e, funds, ev)))
  ensures (inv(e) ==> canDeposit(e, funds, ev) ==> stepPledgeIrrevocable(e, "deposit", deposit(e, funds, ev)))
{
  if inv(e) && canDeposit(e, funds, ev) {
    var a := deposit(e, funds, ev);
    EscDepositCounters(e, funds, ev);
    EscHistorySame(e, a, "deposit");
    EscPledgesSame(e, a, "deposit");
    EscAdvanceShape(e, a, ev, "deposit");
  }
}

lemma withdraw_ensures(e: Escrow, gross: seq<int>, ev: ChainEvent, by_: string)
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> alwaysEvmReleaseWhole(withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> alwaysTouchedMonthsShrink(withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> alwaysReleaseWhole(withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> alwaysGrossConserved(withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> alwaysReservedSplit(withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> alwaysPaidSplit(withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> alwaysFeesConserved(withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> alwaysValidCounters(withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> alwaysWithdrawalFees(withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> alwaysMonths(withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> alwaysBountyVaultHasNoMonths(withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> alwaysUndeployedEmpty(withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> alwaysReleasedLeavesAdmitted(withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> alwaysPledgesCovered(withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> alwaysAwards(withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> stepEventOrder(e, withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> stepIdentityFixed(e, withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> stepAwardsRetained(e, withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> stepMonthsRetained(e, withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> stepWithdrawalsRetained(e, withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> stepCumulativeCounters(e, withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "withdraw", withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "withdraw", withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> stepFreeEntersOnlyByDepositOrRelease(e, "withdraw", withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> stepManualBlockedWhilePoolPending(e, "withdraw", withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> stepImplementationOnlyUpgrades(e, withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> stepReleaseNeedsUpgrade(e, "withdraw", withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> stepOneRootPerPeriod(e, "withdraw", withdraw(e, gross, ev, by_)))
  ensures (inv(e) ==> canWithdraw(e, gross, ev, by_) ==> stepPledgeIrrevocable(e, "withdraw", withdraw(e, gross, ev, by_)))
{
  if inv(e) && canWithdraw(e, gross, ev, by_) {
    var a := withdraw(e, gross, ev, by_);
    EscWithdrawCounters(e, gross, ev, by_);
    EscWithdrawFees(e, gross, ev, by_);
    EscWithdrawMonthsAwards(e, a);
    EscPledgesSame(e, a, "withdraw");
    EscAdvanceShape(e, a, ev, "withdraw");
  }
}

lemma claimFees_ensures(e: Escrow, recipient: string, ev: ChainEvent)
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> alwaysEvmReleaseWhole(claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> alwaysTouchedMonthsShrink(claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> alwaysReleaseWhole(claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> alwaysGrossConserved(claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> alwaysReservedSplit(claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> alwaysPaidSplit(claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> alwaysFeesConserved(claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> alwaysValidCounters(claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> alwaysWithdrawalFees(claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> alwaysMonths(claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> alwaysBountyVaultHasNoMonths(claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> alwaysUndeployedEmpty(claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> alwaysReleasedLeavesAdmitted(claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> alwaysPledgesCovered(claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> alwaysAwards(claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> stepEventOrder(e, claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> stepIdentityFixed(e, claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> stepAwardsRetained(e, claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> stepMonthsRetained(e, claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> stepWithdrawalsRetained(e, claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> stepCumulativeCounters(e, claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "claimFees", claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "claimFees", claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> stepFreeEntersOnlyByDepositOrRelease(e, "claimFees", claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> stepManualBlockedWhilePoolPending(e, "claimFees", claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> stepImplementationOnlyUpgrades(e, claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> stepReleaseNeedsUpgrade(e, "claimFees", claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> stepOneRootPerPeriod(e, "claimFees", claimFees(e, recipient, ev)))
  ensures (inv(e) ==> canClaimFees(e, recipient, ev) ==> stepPledgeIrrevocable(e, "claimFees", claimFees(e, recipient, ev)))
{
  if inv(e) && canClaimFees(e, recipient, ev) {
    var a := claimFees(e, recipient, ev);
    EscClaimCounters(e, recipient, ev);
    EscHistorySame(e, a, "claimFees");
    EscPledgesSame(e, a, "claimFees");
    EscAdvanceShape(e, a, ev, "claimFees");
  }
}


lemma EscPledgePeriodsPrefix(step: (seq<int>, int) -> seq<int>, fromPeriod: int, ps: seq<int>, xs: seq<int>)
  requires forall s: seq<int>, i: int :: step(s, i) == (s + [(if |s| == 0 then fromPeriod else nextPeriod((if 0 <= |s| - 1 && |s| - 1 < |s| then s[|s| - 1] else fromPeriod)))])
  ensures |Std.Collections.Seq.FoldLeft(step, ps, xs)| >= |ps|
  ensures forall k :: 0 <= k < |ps| ==> Std.Collections.Seq.FoldLeft(step, ps, xs)[k] == ps[k]
  decreases |xs|
{
  if |xs| > 0 {
    var ps1 := step(ps, xs[0]);
    EscPledgePeriodsPrefix(step, fromPeriod, ps1, xs[1..]);
  }
}

lemma EscPledgePeriodsInc(step: (seq<int>, int) -> seq<int>, fromPeriod: int, ps: seq<int>, xs: seq<int>)
  requires forall s: seq<int>, i: int :: step(s, i) == (s + [(if |s| == 0 then fromPeriod else nextPeriod((if 0 <= |s| - 1 && |s| - 1 < |s| then s[|s| - 1] else fromPeriod)))])
  requires forall i, j :: 0 <= i < j < |ps| ==> ps[i] < ps[j]
  requires forall p :: p in Std.Collections.Seq.FoldLeft(step, ps, xs) ==> validPeriod(p)
  ensures forall i, j :: 0 <= i < j < |Std.Collections.Seq.FoldLeft(step, ps, xs)| ==> Std.Collections.Seq.FoldLeft(step, ps, xs)[i] < Std.Collections.Seq.FoldLeft(step, ps, xs)[j]
  decreases |xs|
{
  if |xs| > 0 {
    var ps1 := step(ps, xs[0]);
    EscPledgePeriodsPrefix(step, fromPeriod, ps1, xs[1..]);
    if |ps| > 0 {
      var last := ps[|ps| - 1];
      assert ps1[|ps| - 1] == last;
      assert last in Std.Collections.Seq.FoldLeft(step, ps1, xs[1..]);
      assert validPeriod(last);
      assert nextPeriod(last) > last;
    }
    EscPledgePeriodsInc(step, fromPeriod, ps1, xs[1..]);
  }
}

lemma EscPledgePeriodsDistinct(fromPeriod: int, count: int)
  requires forall p :: p in pledgePeriods(fromPeriod, count) ==> validPeriod(p)
  ensures ProofLib.Distinct(pledgePeriods(fromPeriod, count))
{
  var step1 := (ps: seq<int>, i: int) => (ps + [(if (|ps| == 0) then fromPeriod else nextPeriod((if ((0 <= (|ps| - 1)) && ((|ps| - 1) < |ps|)) then ps[(|ps| - 1)] else fromPeriod)))]);
  var xs := ProofLib.Filter((i: int) => (i <= count), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  ProofLib.FilterSamePredicate((i: int) => (i <= count), (i: int) => (i <= count), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  ProofLib.FoldLeftPointwise(
    (ps: seq<int>, i: int) => (ps + [(if (|ps| == 0) then fromPeriod else nextPeriod((if ((0 <= (|ps| - 1)) && ((|ps| - 1) < |ps|)) then ps[(|ps| - 1)] else fromPeriod)))]),
    step1, [], xs, xs);
  assert pledgePeriods(fromPeriod, count) == Std.Collections.Seq.FoldLeft(step1, [], xs);
  EscPledgePeriodsInc(step1, fromPeriod, [], xs);
}

lemma EscAppendPledgesFold(base: seq<Pledge>, qs: seq<int>, amount: seq<int>)
  ensures var res := Std.Collections.Seq.FoldLeft((ps: seq<Pledge>, period: int) => (ps + [Pledge(period, amount, true)]), base, qs);
    |res| == |base| + |qs|
    && (forall i :: 0 <= i < |base| ==> res[i] == base[i])
    && (forall i :: 0 <= i < |qs| ==> res[|base| + i] == Pledge(qs[i], amount, true))
  decreases |qs|
{
  if |qs| > 0 {
    var f := (ps: seq<Pledge>, period: int) => (ps + [Pledge(period, amount, true)]);
    var next := base + [Pledge(qs[0], amount, true)];
    EscAppendPledgesFold(next, qs[1..], amount);
    var res := Std.Collections.Seq.FoldLeft(f, next, qs[1..]);
    forall i | 0 <= i < |qs| ensures res[|base| + i] == Pledge(qs[i], amount, true) {
      if i > 0 { assert qs[1..][i - 1] == qs[i]; }
    }
  }
}

lemma EscFoldLeftConcat<A, T>(f: (A, T) -> A, init: A, xs: seq<T>, ys: seq<T>)
  ensures Std.Collections.Seq.FoldLeft(f, init, xs + ys) == Std.Collections.Seq.FoldLeft(f, Std.Collections.Seq.FoldLeft(f, init, xs), ys)
  decreases |xs|
{
  if |xs| == 0 {
    assert xs + ys == ys;
  } else {
    assert (xs + ys)[0] == xs[0] && (xs + ys)[1..] == xs[1..] + ys;
    EscFoldLeftConcat(f, f(init, xs[0]), xs[1..], ys);
  }
}

lemma EscOpenPledgedConcat(xs: seq<Pledge>, ys: seq<Pledge>)
  requires forall x :: x in xs ==> settlement__money_validAmount(x.amount)
  requires forall y :: y in ys ==> settlement__money_validAmount(y.amount)
  ensures settlement__money_validAmount(openPledged(xs)) && settlement__money_validAmount(openPledged(ys))
  ensures settlement__money_validAmount(openPledged(xs + ys))
  ensures settlement__money_equalAmounts(openPledged(xs + ys), settlement__money_addAmounts(openPledged(xs), openPledged(ys)))
{
  var f := (t: settlement__money_Amount, p: Pledge) => (if p.open then settlement__money_addAmounts(t, p.amount) else t);
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z);
  assert forall w :: w in xs + ys ==> settlement__money_validAmount(w.amount);
  ProofLib.FoldLeftPointwise((t: settlement__money_Amount, p: Pledge) => (if p.open then settlement__money_addAmounts(t, p.amount) else t), f, z, xs, xs);
  ProofLib.FoldLeftPointwise((t: settlement__money_Amount, p: Pledge) => (if p.open then settlement__money_addAmounts(t, p.amount) else t), f, z, ys, ys);
  ProofLib.FoldLeftPointwise((t: settlement__money_Amount, p: Pledge) => (if p.open then settlement__money_addAmounts(t, p.amount) else t), f, z, xs + ys, xs + ys);
  EscOpenFoldValid(f, z, xs);
  EscOpenFoldValid(f, z, ys);
  EscOpenFoldValid(f, z, xs + ys);
  EscFoldLeftConcat(f, z, xs, ys);
  var sx := openPledged(xs);
  assert sx == Std.Collections.Seq.FoldLeft(f, z, xs);
  assert openPledged(ys) == Std.Collections.Seq.FoldLeft(f, z, ys);
  assert openPledged(xs + ys) == Std.Collections.Seq.FoldLeft(f, sx, ys);
  settlement__money_lawZeroIdentity_ensures(sx);
  settlement__money_lawAddCommutative_ensures(z, sx);
  EscSym(settlement__money_addAmounts(z, sx), sx);
  EscOpenFoldShift(f, sx, z, sx, ys);
  settlement__money_lawAddCommutative_ensures(openPledged(ys), sx);
  assert settlement__money_addAmounts(openPledged(ys), sx) == settlement__money_addAmounts(sx, openPledged(ys));
}

lemma EscOpenPledgedSingleton(p: Pledge)
  requires settlement__money_validAmount(p.amount)
  ensures settlement__money_validAmount(openPledged([p]))
  ensures p.open ==> settlement__money_equalAmounts(openPledged([p]), p.amount)
  ensures !p.open ==> openPledged([p]) == settlement__money_zero
{
  var f := (t: settlement__money_Amount, x: Pledge) => (if x.open then settlement__money_addAmounts(t, x.amount) else t);
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z);
  ProofLib.FoldLeftPointwise((t: settlement__money_Amount, x: Pledge) => (if x.open then settlement__money_addAmounts(t, x.amount) else t), f, z, [p], [p]);
  assert [p][0] == p && [p][1..] == [];
  assert Std.Collections.Seq.FoldLeft(f, z, [p]) == Std.Collections.Seq.FoldLeft(f, f(z, p), []);
  assert openPledged([p]) == f(z, p);
  if p.open {
    settlement__money_lawAdditionValid_ensures(z, p.amount);
    settlement__money_lawZeroIdentity_ensures(p.amount);
    settlement__money_lawAddCommutative_ensures(z, p.amount);
  }
}

lemma EscOpenPledgedDropOne(xs: seq<Pledge>, q: int)
  requires forall x :: x in xs ==> settlement__money_validAmount(x.amount)
  requires ProofLib.DistinctBy(xs, (p: Pledge) => p.period)
  ensures var ys := ProofLib.Filter((p: Pledge) => (p.period != q), xs);
    settlement__money_validAmount(openPledged(xs)) && settlement__money_validAmount(openPledged(ys))
    && ((exists k :: 0 <= k < |xs| && xs[k].period == q && xs[k].open) ==>
          (forall k :: 0 <= k < |xs| && xs[k].period == q && xs[k].open ==>
            settlement__money_equalAmounts(openPledged(xs), settlement__money_addAmounts(openPledged(ys), xs[k].amount))))
    && (!(exists k :: 0 <= k < |xs| && xs[k].period == q && xs[k].open) ==>
          settlement__money_equalAmounts(openPledged(xs), openPledged(ys)))
  decreases |xs|
{
  hide *;
  reveal ProofLib.DistinctBy, Std.Collections.Seq.FoldLeft, settlement__money_lawAddCommutative, settlement__money_lawAddAssociative, settlement__money_lawZeroIdentity, settlement__money_lawAddCongruence, settlement__money_lawEqualReflexive, settlement__money_lawAdditionValid;
  var pred := (p: Pledge) => (p.period != q);
  var ys := ProofLib.Filter(pred, xs);
  ProofLib.FilterSamePredicate((p: Pledge) => (p.period != q), pred, xs);
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z) by { reveal settlement__money_validAmount, settlement__money_zero; }
  ProofLib.FilterSubset(pred, xs);
  if |xs| == 0 {
    ProofLib.FilterNil(pred, xs);
    assert openPledged(xs) == z by { reveal openPledged; }
    settlement__money_lawEqualReflexive_ensures(z);
  } else {
    ProofLib.FilterCons(pred, xs);
    var head := xs[0];
    var tail := xs[1..];
    assert xs == [head] + tail;
    assert ProofLib.DistinctBy(tail, (p: Pledge) => p.period) by {
      forall i, j | 0 <= i < |tail| && 0 <= j < |tail| && i != j ensures tail[i].period != tail[j].period {
        assert tail[i] == xs[i + 1] && tail[j] == xs[j + 1];
      }
    }
    EscOpenPledgedDropOne(tail, q);
    var ytail := ProofLib.Filter(pred, tail);
    ProofLib.FilterSamePredicate((p: Pledge) => (p.period != q), pred, tail);
    ProofLib.FilterSubset(pred, tail);
    if head.period == q {
      assert ys == ytail;
      assert forall i :: 0 <= i < |tail| ==> tail[i].period != q by {
        forall i | 0 <= i < |tail| ensures tail[i].period != q { assert tail[i] == xs[i + 1]; }
      }
      assert !(exists k :: 0 <= k < |tail| && tail[k].period == q && tail[k].open);
      EscOpenPledgedConcat([head], tail);
      EscOpenPledgedSingleton(head);
      if head.open {
        settlement__money_lawAddCongruence_ensures(openPledged([head]), head.amount, openPledged(tail));
        settlement__money_lawAddCommutative_ensures(openPledged([head]), openPledged(tail));
        settlement__money_lawAddCommutative_ensures(head.amount, openPledged(tail));
        EscChain(openPledged(xs), settlement__money_addAmounts(openPledged(tail), openPledged([head])), settlement__money_addAmounts(openPledged(tail), head.amount));
        settlement__money_lawAddCongruence_ensures(openPledged(tail), openPledged(ytail), head.amount);
        settlement__money_lawAddCommutative_ensures(openPledged(tail), head.amount);
        settlement__money_lawAddCommutative_ensures(openPledged(ytail), head.amount);
        EscChain(openPledged(xs), settlement__money_addAmounts(head.amount, openPledged(tail)), settlement__money_addAmounts(head.amount, openPledged(ytail)));
      } else {
        settlement__money_lawZeroIdentity_ensures(openPledged(tail));
        settlement__money_lawAddCommutative_ensures(z, openPledged(tail));
        EscChain(openPledged(xs), settlement__money_addAmounts(openPledged(tail), z), openPledged(tail));
        EscChain(openPledged(xs), openPledged(tail), openPledged(ytail));
      }
    } else {
      assert ys == [head] + ytail;
      EscOpenPledgedConcat([head], tail);
      EscOpenPledgedConcat([head], ytail);
      var h := openPledged([head]);
      if exists k :: 0 <= k < |xs| && xs[k].period == q && xs[k].open {
        forall k | 0 <= k < |xs| && xs[k].period == q && xs[k].open
          ensures settlement__money_equalAmounts(openPledged(xs), settlement__money_addAmounts(openPledged(ys), xs[k].amount))
        {
          assert k > 0 && tail[k - 1] == xs[k];
          settlement__money_lawAdditionValid_ensures(openPledged(ytail), xs[k].amount);
          settlement__money_lawAdditionValid_ensures(h, openPledged(ytail));
          settlement__money_lawAddCongruence_ensures(openPledged(tail), settlement__money_addAmounts(openPledged(ytail), xs[k].amount), h);
          EscChain(openPledged(xs), settlement__money_addAmounts(h, openPledged(tail)), settlement__money_addAmounts(h, settlement__money_addAmounts(openPledged(ytail), xs[k].amount)));
          settlement__money_lawAddAssociative_ensures(h, openPledged(ytail), xs[k].amount);
          EscSym(settlement__money_addAmounts(settlement__money_addAmounts(h, openPledged(ytail)), xs[k].amount), settlement__money_addAmounts(h, settlement__money_addAmounts(openPledged(ytail), xs[k].amount)));
          EscChain(openPledged(xs), settlement__money_addAmounts(h, settlement__money_addAmounts(openPledged(ytail), xs[k].amount)), settlement__money_addAmounts(settlement__money_addAmounts(h, openPledged(ytail)), xs[k].amount));
          EscSym(openPledged(ys), settlement__money_addAmounts(h, openPledged(ytail)));
          settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(h, openPledged(ytail)), openPledged(ys), xs[k].amount);
          settlement__money_lawAddCommutative_ensures(settlement__money_addAmounts(h, openPledged(ytail)), xs[k].amount);
          settlement__money_lawAddCommutative_ensures(openPledged(ys), xs[k].amount);
          EscChain(openPledged(xs), settlement__money_addAmounts(xs[k].amount, settlement__money_addAmounts(h, openPledged(ytail))), settlement__money_addAmounts(xs[k].amount, openPledged(ys)));
        }
      } else {
        assert !(exists k :: 0 <= k < |tail| && tail[k].period == q && tail[k].open) by {
          if exists k :: 0 <= k < |tail| && tail[k].period == q && tail[k].open {
            var k :| 0 <= k < |tail| && tail[k].period == q && tail[k].open;
            assert xs[k + 1] == tail[k];
          }
        }
        settlement__money_lawAddCongruence_ensures(openPledged(tail), openPledged(ytail), h);
        EscChain(openPledged(xs), settlement__money_addAmounts(h, openPledged(tail)), settlement__money_addAmounts(h, openPledged(ytail)));
        EscSym(openPledged(ys), settlement__money_addAmounts(h, openPledged(ytail)));
        EscChain(openPledged(xs), settlement__money_addAmounts(h, openPledged(ytail)), openPledged(ys));
      }
    }
  }
}

lemma EscFilterDropCons(xs: seq<Pledge>, q: int, rest: seq<int>)
  ensures ProofLib.Filter((p: Pledge) => !(p.period in ([q] + rest)), xs) == ProofLib.Filter((p: Pledge) => (p.period != q), ProofLib.Filter((p: Pledge) => !(p.period in rest), xs))
  decreases |xs|
{
  hide *;
  var p1 := (p: Pledge) => !(p.period in ([q] + rest));
  var p2 := (p: Pledge) => !(p.period in rest);
  var pq := (p: Pledge) => (p.period != q);
  ProofLib.FilterSamePredicate((p: Pledge) => !(p.period in ([q] + rest)), p1, xs);
  ProofLib.FilterSamePredicate((p: Pledge) => !(p.period in rest), p2, xs);
  ProofLib.FilterSamePredicate((p: Pledge) => (p.period != q), pq, ProofLib.Filter(p2, xs));
  if |xs| == 0 {
    ProofLib.FilterNil(p1, xs);
    ProofLib.FilterNil(p2, xs);
    ProofLib.FilterNil(pq, []);
  } else {
    ProofLib.FilterCons(p1, xs);
    ProofLib.FilterCons(p2, xs);
    EscFilterDropCons(xs[1..], q, rest);
    ProofLib.FilterSamePredicate((p: Pledge) => !(p.period in ([q] + rest)), p1, xs[1..]);
    ProofLib.FilterSamePredicate((p: Pledge) => !(p.period in rest), p2, xs[1..]);
    ProofLib.FilterSamePredicate((p: Pledge) => (p.period != q), pq, ProofLib.Filter(p2, xs[1..]));
    assert (xs[0].period in ([q] + rest)) <==> (xs[0].period == q || xs[0].period in rest);
    if p2(xs[0]) {
      ProofLib.FilterCons(pq, [xs[0]] + ProofLib.Filter(p2, xs[1..]));
      assert ([xs[0]] + ProofLib.Filter(p2, xs[1..]))[0] == xs[0];
      assert ([xs[0]] + ProofLib.Filter(p2, xs[1..]))[1..] == ProofLib.Filter(p2, xs[1..]);
      if pq(xs[0]) {
        assert p1(xs[0]);
      } else {
        assert !p1(xs[0]);
        assert [] + ProofLib.Filter(p1, xs[1..]) == ProofLib.Filter(p1, xs[1..]);
        assert [] + ProofLib.Filter(pq, ProofLib.Filter(p2, xs[1..])) == ProofLib.Filter(pq, ProofLib.Filter(p2, xs[1..]));
      }
    } else {
      assert !p1(xs[0]);
      assert [] + ProofLib.Filter(p1, xs[1..]) == ProofLib.Filter(p1, xs[1..]);
      assert [] + ProofLib.Filter(p2, xs[1..]) == ProofLib.Filter(p2, xs[1..]);
    }
  }
}

lemma EscAddedByShift(e: Escrow, t: seq<int>, s: seq<int>, a: seq<int>, qs: seq<int>, amount: seq<int>)
  requires alwaysPledgesCovered(e) && settlement__money_validAmount(t) && settlement__money_validAmount(s) && settlement__money_validAmount(a) && settlement__money_validAmount(amount)
  requires forall q :: q in qs ==> (!pledgeOf(e, q).open || settlement__money_compareAmounts(pledgeOf(e, q).amount, amount) <= 0)
  requires settlement__money_equalAmounts(t, settlement__money_addAmounts(s, a))
  ensures var f := (t: settlement__money_Amount, period: int) => settlement__money_addAmounts(t, raisedBy(e, period, amount));
    settlement__money_validAmount(Std.Collections.Seq.FoldLeft(f, t, qs))
    && settlement__money_validAmount(Std.Collections.Seq.FoldLeft(f, s, qs))
    && settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(f, t, qs), settlement__money_addAmounts(Std.Collections.Seq.FoldLeft(f, s, qs), a))
  decreases |qs|
{
  var f := (t: settlement__money_Amount, period: int) => settlement__money_addAmounts(t, raisedBy(e, period, amount));
  if |qs| > 0 {
    var q := qs[0];
    assert q in qs;
    if pledgeOf(e, q).open {
      var k := EscOpenPledgeAt(e, q);
      assert e.pledges[k] in e.pledges;
      settlement__money_lawSubtractionValid_ensures(amount, pledgeOf(e, q).amount);
    }
    var r := raisedBy(e, q, amount);
    assert settlement__money_validAmount(r);
    EscAddLeft(t, s, a, r);
    settlement__money_lawAdditionValid_ensures(t, r);
    settlement__money_lawAdditionValid_ensures(s, r);
    EscAddedByShift(e, f(t, q), f(s, q), a, qs[1..], amount);
  }
}

lemma EscPledgeMonthsSumCombine(oAll: seq<int>, oRest: seq<int>, oKept: seq<int>, oKeptRest: seq<int>, oAppRest: seq<int>, oSingle: seq<int>, oE: seq<int>, addAll: seq<int>, addRest: seq<int>, r: seq<int>, amt: seq<int>)
  requires settlement__money_validAmount(oAll) && settlement__money_validAmount(oRest)
  requires settlement__money_validAmount(oKept) && settlement__money_validAmount(oKeptRest)
  requires settlement__money_validAmount(oAppRest) && settlement__money_validAmount(oSingle)
  requires settlement__money_validAmount(oE) && settlement__money_validAmount(addAll)
  requires settlement__money_validAmount(addRest) && settlement__money_validAmount(r) && settlement__money_validAmount(amt)
  requires settlement__money_equalAmounts(settlement__money_addAmounts(oKeptRest, r), settlement__money_addAmounts(oKept, amt))
  requires settlement__money_equalAmounts(addAll, settlement__money_addAmounts(addRest, r))
  requires settlement__money_equalAmounts(oSingle, settlement__money_addAmounts(oKept, amt))
  requires settlement__money_equalAmounts(oAll, settlement__money_addAmounts(oSingle, oAppRest))
  requires settlement__money_equalAmounts(oRest, settlement__money_addAmounts(oKeptRest, oAppRest))
  requires settlement__money_equalAmounts(settlement__money_addAmounts(oE, addRest), oRest)
  ensures settlement__money_equalAmounts(settlement__money_addAmounts(oE, addAll), oAll)
{
  hide *;
  reveal settlement__money_lawAddCommutative, settlement__money_lawAddAssociative, settlement__money_lawAddCongruence, settlement__money_lawAdditionValid;
  settlement__money_lawAdditionValid_ensures(oKeptRest, r);
  settlement__money_lawAdditionValid_ensures(oKept, amt);
  settlement__money_lawAdditionValid_ensures(oKeptRest, oAppRest);
  settlement__money_lawAdditionValid_ensures(oE, addRest);
  settlement__money_lawAdditionValid_ensures(addRest, r);
  EscSym(settlement__money_addAmounts(oKeptRest, r), settlement__money_addAmounts(oKept, amt));
  EscChain(oSingle, settlement__money_addAmounts(oKept, amt), settlement__money_addAmounts(oKeptRest, r));
  settlement__money_lawAddCongruence_ensures(oSingle, settlement__money_addAmounts(oKeptRest, r), oAppRest);
  settlement__money_lawAddCommutative_ensures(oSingle, oAppRest);
  settlement__money_lawAddCommutative_ensures(settlement__money_addAmounts(oKeptRest, r), oAppRest);
  EscChain(oAll, settlement__money_addAmounts(oAppRest, oSingle), settlement__money_addAmounts(oAppRest, settlement__money_addAmounts(oKeptRest, r)));
  settlement__money_lawAddCommutative_ensures(oKeptRest, r);
  settlement__money_lawAddAssociative_ensures(r, oKeptRest, oAppRest);
  EscChain(oAll, settlement__money_addAmounts(settlement__money_addAmounts(r, oKeptRest), oAppRest), settlement__money_addAmounts(r, settlement__money_addAmounts(oKeptRest, oAppRest)));
  EscSym(oRest, settlement__money_addAmounts(oKeptRest, oAppRest));
  settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(oKeptRest, oAppRest), oRest, r);
  EscChain(oAll, settlement__money_addAmounts(r, settlement__money_addAmounts(oKeptRest, oAppRest)), settlement__money_addAmounts(r, oRest));
  settlement__money_lawAddCommutative_ensures(r, oRest);
  EscSym(oAll, settlement__money_addAmounts(oRest, r));
  settlement__money_lawAddCongruence_ensures(addAll, settlement__money_addAmounts(addRest, r), oE);
  settlement__money_lawAddAssociative_ensures(oE, addRest, r);
  EscSym(settlement__money_addAmounts(settlement__money_addAmounts(oE, addRest), r), settlement__money_addAmounts(oE, settlement__money_addAmounts(addRest, r)));
  EscChain(settlement__money_addAmounts(oE, addAll), settlement__money_addAmounts(oE, settlement__money_addAmounts(addRest, r)), settlement__money_addAmounts(settlement__money_addAmounts(oE, addRest), r));
  settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(oE, addRest), oRest, r);
  settlement__money_lawAddCommutative_ensures(settlement__money_addAmounts(oE, addRest), r);
  settlement__money_lawAddCommutative_ensures(oRest, r);
  EscChain(settlement__money_addAmounts(oE, addAll), settlement__money_addAmounts(r, settlement__money_addAmounts(oE, addRest)), settlement__money_addAmounts(r, oRest));
  EscChain(settlement__money_addAmounts(oE, addAll), settlement__money_addAmounts(oRest, r), oAll);
}

lemma EscPledgeMonthsSum(e: Escrow, qs: seq<int>, amount: seq<int>)
  requires alwaysPledgesCovered(e) && settlement__money_validAmount(amount)
  requires ProofLib.Distinct(qs)
  requires forall q :: q in qs ==> (!pledgeOf(e, q).open || settlement__money_compareAmounts(pledgeOf(e, q).amount, amount) <= 0)
  ensures var kept := ProofLib.Filter((p: Pledge) => !(p.period in qs), e.pledges);
    var res := Std.Collections.Seq.FoldLeft((ps: seq<Pledge>, period: int) => (ps + [Pledge(period, amount, true)]), kept, qs);
    settlement__money_validAmount(openPledged(e.pledges))
    && settlement__money_validAmount(addedBy(e, qs, amount))
    && settlement__money_validAmount(openPledged(res))
    && settlement__money_equalAmounts(settlement__money_addAmounts(openPledged(e.pledges), addedBy(e, qs, amount)), openPledged(res))
  decreases |qs|
{
  hide *;
  reveal ProofLib.Distinct, ProofLib.DistinctBy, Std.Collections.Seq.FoldLeft, settlement__money_lawAddCommutative, settlement__money_lawAddAssociative, settlement__money_lawZeroIdentity, settlement__money_lawAddCongruence, settlement__money_lawEqualReflexive, settlement__money_lawAdditionValid, settlement__money_lawSubtractionValid, settlement__money_lawSubtractionReconstructs, settlement__money_lawNumericOrderTotal;
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z) by { reveal settlement__money_validAmount, settlement__money_zero; }
  var f := (t: settlement__money_Amount, p: Pledge) => (if p.open then settlement__money_addAmounts(t, p.amount) else t);
  var predQs := (p: Pledge) => !(p.period in qs);
  var kept := ProofLib.Filter(predQs, e.pledges);
  ProofLib.FilterSamePredicate((p: Pledge) => !(p.period in qs), predQs, e.pledges);
  var res := Std.Collections.Seq.FoldLeft((ps: seq<Pledge>, period: int) => (ps + [Pledge(period, amount, true)]), kept, qs);
  assert forall x :: x in e.pledges ==> settlement__money_validAmount(x.amount) by { reveal alwaysPledgesCovered; }
  assert settlement__money_validAmount(openPledged(e.pledges)) by {
    ProofLib.FoldLeftPointwise((t: settlement__money_Amount, p: Pledge) => (if p.open then settlement__money_addAmounts(t, p.amount) else t), f, z, e.pledges, e.pledges);
    reveal openPledged;
    EscOpenFoldValid(f, z, e.pledges);
  }
  if |qs| == 0 {
    ProofLib.FilterSamePredicate(predQs, (p: Pledge) => true, e.pledges);
    EscPledgeFilterAll(e.pledges);
    assert kept == e.pledges;
    assert res == e.pledges;
    assert addedBy(e, qs, amount) == z by { reveal addedBy; }
    settlement__money_lawZeroIdentity_ensures(openPledged(e.pledges));
  } else {
    var q := qs[0];
    var rest := qs[1..];
    assert qs == [q] + rest;
    assert q in qs && !(q in rest);
    assert ProofLib.Distinct(rest) by {
      forall i, j | 0 <= i < j < |rest| ensures rest[i] != rest[j] {
        assert rest[i] == qs[i + 1] && rest[j] == qs[j + 1];
      }
    }
    EscPledgeMonthsSum(e, rest, amount);
    var predRest := (p: Pledge) => !(p.period in rest);
    var keptRest := ProofLib.Filter(predRest, e.pledges);
    ProofLib.FilterSamePredicate((p: Pledge) => !(p.period in rest), predRest, e.pledges);
    var resRest := Std.Collections.Seq.FoldLeft((ps: seq<Pledge>, period: int) => (ps + [Pledge(period, amount, true)]), keptRest, rest);
    var appRest := Std.Collections.Seq.FoldLeft((ps: seq<Pledge>, period: int) => (ps + [Pledge(period, amount, true)]), [], rest);
    EscAppendPledgesFold(kept, qs, amount);
    EscAppendPledgesFold(keptRest, rest, amount);
    EscAppendPledgesFold([], rest, amount);
    assert res == kept + [Pledge(q, amount, true)] + appRest by {
      var rhs := kept + [Pledge(q, amount, true)] + appRest;
      assert |res| == |rhs|;
      forall i | 0 <= i < |res| ensures res[i] == rhs[i] {
        if i > |kept| {
          assert qs[i - |kept|] == rest[i - |kept| - 1];
        }
      }
    }
    assert resRest == keptRest + appRest by {
      var rhs := keptRest + appRest;
      assert |resRest| == |rhs|;
      forall i | 0 <= i < |resRest| ensures resRest[i] == rhs[i] {
        if i >= |keptRest| {
          assert appRest[i - |keptRest|] == Pledge(rest[i - |keptRest|], amount, true);
        }
      }
    }
    assert forall y :: y in appRest ==> settlement__money_validAmount(y.amount) by {
      forall y | y in appRest ensures settlement__money_validAmount(y.amount) {
        var i :| 0 <= i < |appRest| && appRest[i] == y;
        assert y == Pledge(rest[i], amount, true);
      }
    }
    ProofLib.FilterSubset(predRest, e.pledges);
    ProofLib.FilterSubset(predQs, e.pledges);
    assert ProofLib.DistinctBy(e.pledges, (p: Pledge) => p.period) by {
      reveal alwaysPledgesCovered, ProofLib.Filter;
      forall i, j | 0 <= i < |e.pledges| && 0 <= j < |e.pledges| && i != j ensures e.pledges[i].period != e.pledges[j].period {
        assert e.pledges[i] in e.pledges;
        if e.pledges[i].period == e.pledges[j].period {
          ProofLib.FilterTwo((o: Pledge) => (o.period == e.pledges[i].period), e.pledges, i, j);
        }
      }
    }
    ProofLib.FilterKeepsDistinctBy(predRest, e.pledges, (p: Pledge) => p.period);
    EscFilterDropCons(e.pledges, q, rest);
    ProofLib.FilterSamePredicate((p: Pledge) => !(p.period in ([q] + rest)), predQs, e.pledges);
    assert kept == ProofLib.Filter((p: Pledge) => (p.period != q), keptRest);
    EscOpenPledgedDropOne(keptRest, q);
    if pledgeOf(e, q).open {
      var k := EscOpenPledgeAt(e, q);
      assert e.pledges[k] in e.pledges;
      settlement__money_lawSubtractionValid_ensures(amount, pledgeOf(e, q).amount);
    }
    var r := raisedBy(e, q, amount);
    assert settlement__money_validAmount(r) by { reveal raisedBy; }
    assert settlement__money_equalAmounts(settlement__money_addAmounts(openPledged(keptRest), r), settlement__money_addAmounts(openPledged(kept), amount)) by {
      reveal raisedBy;
      if pledgeOf(e, q).open {
        var k := EscOpenPledgeAt(e, q);
        var x := e.pledges[k];
        ProofLib.FilterMember(predRest, e.pledges, x);
        assert x in keptRest;
        var j :| 0 <= j < |keptRest| && keptRest[j] == x;
        assert settlement__money_equalAmounts(openPledged(keptRest), settlement__money_addAmounts(openPledged(kept), x.amount));
        settlement__money_lawAdditionValid_ensures(openPledged(kept), x.amount);
        settlement__money_lawAddCongruence_ensures(openPledged(keptRest), settlement__money_addAmounts(openPledged(kept), x.amount), r);
        settlement__money_lawAddCommutative_ensures(openPledged(keptRest), r);
        settlement__money_lawAddCommutative_ensures(settlement__money_addAmounts(openPledged(kept), x.amount), r);
        settlement__money_lawAddAssociative_ensures(openPledged(kept), x.amount, r);
        EscChain(settlement__money_addAmounts(openPledged(keptRest), r), settlement__money_addAmounts(settlement__money_addAmounts(openPledged(kept), x.amount), r), settlement__money_addAmounts(openPledged(kept), settlement__money_addAmounts(x.amount, r)));
        settlement__money_lawNumericOrderTotal_ensures(x.amount, amount);
        settlement__money_lawSubtractionReconstructs_ensures(amount, x.amount);
        settlement__money_lawAddCommutative_ensures(x.amount, r);
        settlement__money_lawAdditionValid_ensures(x.amount, r);
        assert settlement__money_equalAmounts(settlement__money_addAmounts(x.amount, r), amount);
        settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(x.amount, r), amount, openPledged(kept));
        EscChain(settlement__money_addAmounts(openPledged(keptRest), r), settlement__money_addAmounts(openPledged(kept), settlement__money_addAmounts(x.amount, r)), settlement__money_addAmounts(openPledged(kept), amount));
      } else {
        assert !(exists j :: 0 <= j < |keptRest| && keptRest[j].period == q && keptRest[j].open) by {
          if exists j :: 0 <= j < |keptRest| && keptRest[j].period == q && keptRest[j].open {
            var j :| 0 <= j < |keptRest| && keptRest[j].period == q && keptRest[j].open;
            ProofLib.FilterMember(predRest, e.pledges, keptRest[j]);
            EscPledgeOf(e, keptRest[j]);
          }
        }
        assert settlement__money_equalAmounts(openPledged(keptRest), openPledged(kept));
        settlement__money_lawAddCongruence_ensures(openPledged(keptRest), openPledged(kept), amount);
        settlement__money_lawAddCommutative_ensures(openPledged(keptRest), amount);
        settlement__money_lawAddCommutative_ensures(openPledged(kept), amount);
      }
    }
    var addF := (t: settlement__money_Amount, period: int) => settlement__money_addAmounts(t, raisedBy(e, period, amount));
    settlement__money_lawAdditionValid_ensures(z, r);
    settlement__money_lawEqualReflexive_ensures(settlement__money_addAmounts(z, r));
    EscAddedByShift(e, settlement__money_addAmounts(z, r), z, r, rest, amount);
    assert addedBy(e, qs, amount) == Std.Collections.Seq.FoldLeft(addF, settlement__money_addAmounts(z, r), rest) by {
      reveal addedBy;
      ProofLib.FoldLeftPointwise((t: settlement__money_Amount, period: int) => settlement__money_addAmounts(t, raisedBy(e, period, amount)), addF, z, qs, qs);
      assert Std.Collections.Seq.FoldLeft(addF, z, qs) == Std.Collections.Seq.FoldLeft(addF, addF(z, q), rest);
    }
    assert addedBy(e, rest, amount) == Std.Collections.Seq.FoldLeft(addF, z, rest) by {
      reveal addedBy;
      ProofLib.FoldLeftPointwise((t: settlement__money_Amount, period: int) => settlement__money_addAmounts(t, raisedBy(e, period, amount)), addF, z, rest, rest);
    }
    EscOpenPledgedConcat(kept, [Pledge(q, amount, true)]);
    EscOpenPledgedConcat(kept + [Pledge(q, amount, true)], appRest);
    EscOpenPledgedConcat(keptRest, appRest);
    EscOpenPledgedSingleton(Pledge(q, amount, true));
    settlement__money_lawAddCongruence_ensures(openPledged([Pledge(q, amount, true)]), amount, openPledged(kept));
    EscChain(openPledged(kept + [Pledge(q, amount, true)]), settlement__money_addAmounts(openPledged(kept), openPledged([Pledge(q, amount, true)])), settlement__money_addAmounts(openPledged(kept), amount));
    EscPledgeMonthsSumCombine(
      openPledged(res), openPledged(resRest), openPledged(kept), openPledged(keptRest), openPledged(appRest),
      openPledged(kept + [Pledge(q, amount, true)]), openPledged(e.pledges), addedBy(e, qs, amount), addedBy(e, rest, amount), r, amount);
  }
}

lemma EscPledgeFilterAll(xs: seq<Pledge>)
  ensures ProofLib.Filter((p: Pledge) => true, xs) == xs
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil((p: Pledge) => true, xs);
  } else {
    ProofLib.FilterCons((p: Pledge) => true, xs);
    EscPledgeFilterAll(xs[1..]);
  }
}

lemma EscPledgeMonthsPledgesView(e: Escrow, fromPeriod: int, count: int, amount: seq<int>, ev: ChainEvent, by_: string)
  ensures var qs := pledgePeriods(fromPeriod, count);
    var kept := ProofLib.Filter((p: Pledge) => !(p.period in qs), e.pledges);
    pledgeMonths(e, fromPeriod, count, amount, ev, by_).pledges == Std.Collections.Seq.FoldLeft((ps: seq<Pledge>, period: int) => (ps + [Pledge(period, amount, true)]), kept, qs)
{
  hide *;
  reveal pledgeMonths, ProofLib.Filter;
  var qs := pledgePeriods(fromPeriod, count);
  ProofLib.FilterSamePredicate((p: Pledge) => !((p.period in qs)), (p: Pledge) => !(p.period in qs), e.pledges);
}

lemma EscPledgeMonthsDistinctPledges(e: Escrow, fromPeriod: int, count: int, amount: seq<int>, ev: ChainEvent, by_: string)
  requires alwaysPledgesCovered(e) && canPledgeMonths(e, fromPeriod, count, amount, ev, by_)
  ensures var a := pledgeMonths(e, fromPeriod, count, amount, ev, by_);
    ProofLib.DistinctBy(a.pledges, (p: Pledge) => p.period)
    && (forall p :: p in a.pledges ==> (validPeriod(p.period) && settlement__money_validAmount(p.amount) && settlement__money_positiveAmount(p.amount)
        && |ProofLib.Filter((o: Pledge) => (o.period == p.period), a.pledges)| == 1
        && (!(p.open && hasMonth(a, p.period)) || a.asset.network.Solana?)))
{
  hide *;
  reveal ProofLib.Distinct, ProofLib.DistinctBy, canPledgeMonths, pledgeable, positiveInRange, pledgeMonths, advance, alwaysPledgesCovered, hasMonth, ProofLib.Filter;
  var a := pledgeMonths(e, fromPeriod, count, amount, ev, by_);
  var qs := pledgePeriods(fromPeriod, count);
  var pred := (p: Pledge) => !(p.period in qs);
  var kept := ProofLib.Filter(pred, e.pledges);
  ProofLib.FilterSamePredicate((p: Pledge) => !(p.period in qs), pred, e.pledges);
  EscPledgeMonthsPledgesView(e, fromPeriod, count, amount, ev, by_);
  EscPledgePeriodsDistinct(fromPeriod, count);
  EscAppendPledgesFold(kept, qs, amount);
  ProofLib.FilterSubset(pred, e.pledges);
  assert ProofLib.DistinctBy(e.pledges, (p: Pledge) => p.period) by {
    forall i, j | 0 <= i < |e.pledges| && 0 <= j < |e.pledges| && i != j ensures e.pledges[i].period != e.pledges[j].period {
      assert e.pledges[i] in e.pledges;
      if e.pledges[i].period == e.pledges[j].period {
        ProofLib.FilterTwo((o: Pledge) => (o.period == e.pledges[i].period), e.pledges, i, j);
      }
    }
  }
  ProofLib.FilterKeepsDistinctBy(pred, e.pledges, (p: Pledge) => p.period);
  assert ProofLib.DistinctBy(a.pledges, (p: Pledge) => p.period) by {
    forall i, j | 0 <= i < |a.pledges| && 0 <= j < |a.pledges| && i != j ensures a.pledges[i].period != a.pledges[j].period {
      if i < |kept| && j < |kept| {
        assert a.pledges[i] == kept[i] && a.pledges[j] == kept[j];
      } else if i < |kept| && j >= |kept| {
        ProofLib.FilterMember(pred, e.pledges, kept[i]);
        assert a.pledges[j].period == qs[j - |kept|];
        assert qs[j - |kept|] in qs;
      } else if i >= |kept| && j < |kept| {
        ProofLib.FilterMember(pred, e.pledges, kept[j]);
        assert a.pledges[i].period == qs[i - |kept|];
        assert qs[i - |kept|] in qs;
      } else {
        assert a.pledges[i].period == qs[i - |kept|] && a.pledges[j].period == qs[j - |kept|];
      }
    }
  }
  forall p | p in a.pledges ensures (validPeriod(p.period) && settlement__money_validAmount(p.amount) && settlement__money_positiveAmount(p.amount)
    && |ProofLib.Filter((o: Pledge) => (o.period == p.period), a.pledges)| == 1 && (!(p.open && hasMonth(a, p.period)) || a.asset.network.Solana?)) {
    var i :| 0 <= i < |a.pledges| && a.pledges[i] == p;
    ProofLib.FilterOne((o: Pledge) => (o.period == p.period), a.pledges, i);
    if i < |kept| {
      assert p in e.pledges;
      if p.open && hasMonth(a, p.period) { assert hasMonth(e, p.period); }
    } else {
      assert qs[i - |kept|] in qs;
      assert pledgeable(e, p.period, ev.time);
      assert !hasMonth(e, p.period);
    }
  }
}

lemma EscPledgeMonthsCovered(e: Escrow, fromPeriod: int, count: int, amount: seq<int>, ev: ChainEvent, by_: string)
  requires alwaysPledgesCovered(e) && canPledgeMonths(e, fromPeriod, count, amount, ev, by_)
  ensures alwaysPledgesCovered(pledgeMonths(e, fromPeriod, count, amount, ev, by_))
{
  hide *;
  reveal canPledgeMonths, pledgeable, later, pledgeMonths, advance, alwaysPledgesCovered, ProofLib.Filter, settlement__money_lawAddCommutative, settlement__money_lawAddCongruence, settlement__money_lawAdditionValid;
  var a := pledgeMonths(e, fromPeriod, count, amount, ev, by_);
  var qs := pledgePeriods(fromPeriod, count);
  EscPledgeMonthsPledgesView(e, fromPeriod, count, amount, ev, by_);
  EscPledgePeriodsDistinct(fromPeriod, count);
  EscPledgeMonthsSum(e, qs, amount);
  var kept := ProofLib.Filter((p: Pledge) => !(p.period in qs), e.pledges);
  assert a.pledges == Std.Collections.Seq.FoldLeft((ps: seq<Pledge>, period: int) => (ps + [Pledge(period, amount, true)]), kept, qs);
  settlement__money_lawAdditionValid_ensures(e.pledged, addedBy(e, qs, amount));
  settlement__money_lawAddCongruence_ensures(e.pledged, openPledged(e.pledges), addedBy(e, qs, amount));
  settlement__money_lawAddCommutative_ensures(e.pledged, addedBy(e, qs, amount));
  settlement__money_lawAddCommutative_ensures(openPledged(e.pledges), addedBy(e, qs, amount));
  EscChain(a.pledged, settlement__money_addAmounts(openPledged(e.pledges), addedBy(e, qs, amount)), openPledged(a.pledges));
  EscPledgeMonthsDistinctPledges(e, fromPeriod, count, amount, ev, by_);
}

lemma EscPledgeMonthsIrrevocable(e: Escrow, fromPeriod: int, count: int, amount: seq<int>, ev: ChainEvent, by_: string)
  requires alwaysPledgesCovered(e) && canPledgeMonths(e, fromPeriod, count, amount, ev, by_)
  requires alwaysPledgesCovered(pledgeMonths(e, fromPeriod, count, amount, ev, by_))
  ensures stepPledgeIrrevocable(e, "pledgeMonths", pledgeMonths(e, fromPeriod, count, amount, ev, by_))
{
  hide *;
  reveal canPledgeMonths, pledgeMonths, advance, stepPledgeIrrevocable, alwaysPledgesCovered, settlement__money_lawNumericOrderTotal, settlement__money_lawEqualReflexive, settlement__money_lawEqualOrder;
  var a := pledgeMonths(e, fromPeriod, count, amount, ev, by_);
  var qs := pledgePeriods(fromPeriod, count);
  var pred := (p: Pledge) => !(p.period in qs);
  var kept := ProofLib.Filter(pred, e.pledges);
  ProofLib.FilterSamePredicate((p: Pledge) => !(p.period in qs), pred, e.pledges);
  EscPledgeMonthsPledgesView(e, fromPeriod, count, amount, ev, by_);
  EscAppendPledgesFold(kept, qs, amount);
  forall x | x in e.pledges && x.open ensures (pledgeOf(a, x.period).open && settlement__money_compareAmounts(pledgeOf(a, x.period).amount, x.amount) >= 0)
    || pledgeClosable(e, "pledgeMonths", a, x.period) {
    if x.period in qs {
      var j :| 0 <= j < |qs| && qs[j] == x.period;
      var np := Pledge(qs[j], amount, true);
      assert a.pledges[|kept| + j] == np && np in a.pledges;
      EscPledgeOf(a, np);
      EscPledgeOf(e, x);
      settlement__money_lawNumericOrderTotal_ensures(x.amount, amount);
    } else {
      ProofLib.FilterMember(pred, e.pledges, x);
      assert x in kept;
      var j :| 0 <= j < |kept| && kept[j] == x;
      assert a.pledges[j] == x && x in a.pledges;
      EscPledgeOf(a, x);
      settlement__money_lawEqualReflexive_ensures(x.amount);
      settlement__money_lawNumericOrderTotal_ensures(x.amount, x.amount);
    }
  }
}

lemma pledgeMonths_ensures(e: Escrow, fromPeriod: int, count: int, amount: seq<int>, ev: ChainEvent, by_: string)
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> alwaysEvmReleaseWhole(pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> alwaysTouchedMonthsShrink(pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> alwaysReleaseWhole(pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> alwaysGrossConserved(pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> alwaysReservedSplit(pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> alwaysPaidSplit(pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> alwaysFeesConserved(pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> alwaysValidCounters(pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> alwaysWithdrawalFees(pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> alwaysMonths(pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> alwaysBountyVaultHasNoMonths(pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> alwaysUndeployedEmpty(pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> alwaysReleasedLeavesAdmitted(pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> alwaysPledgesCovered(pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> alwaysAwards(pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> stepEventOrder(e, pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> stepIdentityFixed(e, pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> stepAwardsRetained(e, pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> stepMonthsRetained(e, pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> stepWithdrawalsRetained(e, pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> stepCumulativeCounters(e, pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "pledgeMonths", pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "pledgeMonths", pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> stepFreeEntersOnlyByDepositOrRelease(e, "pledgeMonths", pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> stepManualBlockedWhilePoolPending(e, "pledgeMonths", pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> stepImplementationOnlyUpgrades(e, pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> stepReleaseNeedsUpgrade(e, "pledgeMonths", pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> stepOneRootPerPeriod(e, "pledgeMonths", pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
  ensures (inv(e) ==> canPledgeMonths(e, fromPeriod, count, amount, ev, by_) ==> stepPledgeIrrevocable(e, "pledgeMonths", pledgeMonths(e, fromPeriod, count, amount, ev, by_)))
{
  if inv(e) && canPledgeMonths(e, fromPeriod, count, amount, ev, by_) {
    var a := pledgeMonths(e, fromPeriod, count, amount, ev, by_);
    EscCountersSame(e, a, "pledgeMonths");
    EscValidSame(e, a);
    EscHistorySame(e, a, "pledgeMonths");
    EscPledgeMonthsCovered(e, fromPeriod, count, amount, ev, by_);
    EscPledgeMonthsIrrevocable(e, fromPeriod, count, amount, ev, by_);
    EscAdvanceShape(e, a, ev, "pledgeMonths");
  }
}

lemma EscLegacyNewTotalShift(e0: Escrow, t: seq<int>, s: seq<int>, a: seq<int>, xs: seq<LegacyEntry>)
  requires settlement__money_validAmount(t) && settlement__money_validAmount(s) && settlement__money_validAmount(a)
  requires forall x :: x in xs ==> settlement__money_validAmount(x.gross)
  requires settlement__money_equalAmounts(t, settlement__money_addAmounts(s, a))
  ensures var f := (sum: settlement__money_Amount, x: LegacyEntry) => settlement__money_addAmounts(sum, (if sourceFree(e0, x.source) then x.gross else settlement__money_zero));
    settlement__money_validAmount(Std.Collections.Seq.FoldLeft(f, t, xs))
    && settlement__money_validAmount(Std.Collections.Seq.FoldLeft(f, s, xs))
    && settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(f, t, xs), settlement__money_addAmounts(Std.Collections.Seq.FoldLeft(f, s, xs), a))
  decreases |xs|
{
  var f := (sum: settlement__money_Amount, x: LegacyEntry) => settlement__money_addAmounts(sum, (if sourceFree(e0, x.source) then x.gross else settlement__money_zero));
  if |xs| > 0 {
    assert xs[0] in xs;
    var add := if sourceFree(e0, xs[0].source) then xs[0].gross else settlement__money_zero;
    assert settlement__money_validAmount(add);
    EscAddLeft(t, s, a, add);
    settlement__money_lawAdditionValid_ensures(t, add);
    settlement__money_lawAdditionValid_ensures(s, add);
    EscLegacyNewTotalShift(e0, f(t, xs[0]), f(s, xs[0]), a, xs[1..]);
  }
}

lemma EscLegacyNewTotalStep(e0: Escrow, x: LegacyEntry, xs: seq<LegacyEntry>)
  requires settlement__money_validAmount(x.gross)
  requires forall y :: y in xs ==> settlement__money_validAmount(y.gross)
  ensures settlement__money_validAmount(legacyNewTotal(e0, xs))
  ensures settlement__money_validAmount(legacyNewTotal(e0, [x] + xs))
  ensures settlement__money_equalAmounts(legacyNewTotal(e0, [x] + xs), settlement__money_addAmounts(legacyNewTotal(e0, xs), (if sourceFree(e0, x.source) then x.gross else settlement__money_zero)))
{
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z);
  var add := if sourceFree(e0, x.source) then x.gross else z;
  assert settlement__money_validAmount(add);
  settlement__money_lawAdditionValid_ensures(z, add);
  settlement__money_lawEqualReflexive_ensures(settlement__money_addAmounts(z, add));
  EscLegacyNewTotalShift(e0, settlement__money_addAmounts(z, add), z, add, xs);
  assert ([x] + xs)[0] == x && ([x] + xs)[1..] == xs;
}

lemma EscLegacyOneStep(e0: Escrow, period: int, time: int, acc: LegacyFold, x0: LegacyEntry)
  requires acc.index >= 0 && acc.vault.purpose.OrdinaryPurpose? && hasMonth(acc.vault, period)
  requires alwaysValidCounters(acc.vault) && alwaysReservedSplit(acc.vault) && alwaysAwards(acc.vault)
  requires validSource(x0.source) && x0.actor > 0 && settlement__money_validAmount(x0.gross) && settlement__money_positiveAmount(x0.gross)
  requires sourceFree(acc.vault, x0.source) == sourceFree(e0, x0.source)
  ensures var nv := legacyStep(period, time, acc, x0).vault;
    var add := if sourceFree(e0, x0.source) then x0.gross else settlement__money_zero;
    alwaysValidCounters(nv) && alwaysReservedSplit(nv) && alwaysAwards(nv)
    && settlement__money_validAmount(add)
    && settlement__money_equalAmounts(nv.reserved, settlement__money_addAmounts(acc.vault.reserved, add))
    && nv.deposited == acc.vault.deposited && nv.held == acc.vault.held && nv.free == acc.vault.free
    && nv.committed == acc.vault.committed && nv.pending == acc.vault.pending
    && nv.paid == acc.vault.paid && nv.paidNet == acc.vault.paidNet && nv.payoutFees == acc.vault.payoutFees
    && nv.grossWithdrawn == acc.vault.grossWithdrawn && nv.withdrawalFees == acc.vault.withdrawalFees
    && nv.accruedFees == acc.vault.accruedFees && nv.claimedFees == acc.vault.claimedFees && nv.spent == acc.vault.spent
    && nv.monthlyCap == acc.vault.monthlyCap && nv.monthlyEnabled == acc.vault.monthlyEnabled
    && nv.months == acc.vault.months && nv.releasedLeaves == acc.vault.releasedLeaves && nv.withdrawals == acc.vault.withdrawals
    && nv.pledges == acc.vault.pledges && nv.pledged == acc.vault.pledged
    && nv.asset == acc.vault.asset && nv.purpose == acc.vault.purpose && nv.deployed == acc.vault.deployed
    && nv.vault == acc.vault.vault && nv.owner == acc.vault.owner && nv.feeRecipient == acc.vault.feeRecipient
    && nv.bindingDelay == acc.vault.bindingDelay && nv.at == acc.vault.at && nv.clock == acc.vault.clock
    && nv.implementation == acc.vault.implementation && nv.authority == acc.vault.authority
    && |nv.awards| >= |acc.vault.awards|
    && (forall a :: a in acc.vault.awards ==> a in nv.awards)
    && (forall a :: a in nv.awards ==> a in acc.vault.awards || (a.origin.MonthlyLeaf? && a.period == period && a.source == x0.source))
{
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z);
  var v := acc.vault;
  var nv := legacyStep(period, time, acc, x0).vault;
  if sourceFree(v, x0.source) {
    var aw := legacyAward(v, x0, period, acc.index, time);
    var f := feeFor(v.purpose, x0.gross);
    EscFeeSplit(v.purpose, x0.gross);
    EscAddSplit(v.reserved, v.reservedPrincipal, v.reservedFees, x0.gross, f);
    settlement__money_lawAdditionValid_ensures(v.reserved, x0.gross);
    settlement__money_lawAdditionValid_ensures(v.reservedPrincipal, settlement__money_subtractAmounts(x0.gross, f));
    settlement__money_lawAdditionValid_ensures(v.reservedFees, f);
    settlement__money_lawEqualReflexive_ensures(nv.reserved);
    assert nv.awards == v.awards + [aw];
    assert alwaysAwards(nv) by {
      forall a | a in nv.awards ensures validAward(nv, a) && |ProofLib.Filter((other: Award) => (other.source == a.source), nv.awards)| == 1 {
        var key := a.source;
        ProofLib.FilterAppend((other: Award) => (other.source == key), v.awards, aw);
        if a == aw {
          ProofLib.FilterNone((other: Award) => (other.source == key), v.awards);
        } else {
          assert a in v.awards && validAward(v, a);
          assert aw.source != key;
        }
      }
    }
  } else {
    assert nv == v;
    settlement__money_lawZeroIdentity_ensures(v.reserved);
    EscSym(settlement__money_addAmounts(v.reserved, z), v.reserved);
  }
}

lemma EscLegacyFoldFrame(period: int, time: int, acc: LegacyFold, xs: seq<LegacyEntry>)
  ensures var res := Std.Collections.Seq.FoldLeft((acc: LegacyFold, x: LegacyEntry) => legacyStep(period, time, acc, x), acc, xs).vault;
    res.deposited == acc.vault.deposited && res.held == acc.vault.held && res.free == acc.vault.free
    && res.committed == acc.vault.committed && res.pending == acc.vault.pending
    && res.paid == acc.vault.paid && res.paidNet == acc.vault.paidNet && res.payoutFees == acc.vault.payoutFees
    && res.grossWithdrawn == acc.vault.grossWithdrawn && res.withdrawalFees == acc.vault.withdrawalFees
    && res.accruedFees == acc.vault.accruedFees && res.claimedFees == acc.vault.claimedFees && res.spent == acc.vault.spent
    && res.monthlyCap == acc.vault.monthlyCap && res.monthlyEnabled == acc.vault.monthlyEnabled
    && res.months == acc.vault.months && res.releasedLeaves == acc.vault.releasedLeaves && res.withdrawals == acc.vault.withdrawals
    && res.pledges == acc.vault.pledges && res.pledged == acc.vault.pledged
    && res.asset == acc.vault.asset && res.purpose == acc.vault.purpose && res.deployed == acc.vault.deployed
    && res.vault == acc.vault.vault && res.owner == acc.vault.owner && res.feeRecipient == acc.vault.feeRecipient
    && res.bindingDelay == acc.vault.bindingDelay && res.at == acc.vault.at && res.clock == acc.vault.clock
    && res.implementation == acc.vault.implementation && res.authority == acc.vault.authority
  decreases |xs|
{
  hide *;
  reveal Std.Collections.Seq.FoldLeft, legacyStep, withAward;
  if |xs| > 0 {
    EscLegacyFoldFrame(period, time, legacyStep(period, time, acc, xs[0]), xs[1..]);
  }
}

lemma EscLegacyFold(e0: Escrow, period: int, time: int, acc: LegacyFold, xs: seq<LegacyEntry>)
  requires acc.index >= 0 && acc.vault.purpose.OrdinaryPurpose? && hasMonth(acc.vault, period)
  requires alwaysValidCounters(acc.vault) && alwaysReservedSplit(acc.vault) && alwaysAwards(acc.vault)
  requires forall x :: x in xs ==> validSource(x.source) && x.actor > 0 && settlement__money_validAmount(x.gross) && settlement__money_positiveAmount(x.gross)
  requires ProofLib.DistinctBy(xs, (x: LegacyEntry) => x.source)
  requires forall x :: x in xs ==> sourceFree(acc.vault, x.source) == sourceFree(e0, x.source)
  ensures var res := Std.Collections.Seq.FoldLeft((acc: LegacyFold, x: LegacyEntry) => legacyStep(period, time, acc, x), acc, xs).vault;
    alwaysValidCounters(res) && alwaysReservedSplit(res) && alwaysAwards(res)
    && settlement__money_validAmount(legacyNewTotal(e0, xs))
    && settlement__money_equalAmounts(res.reserved, settlement__money_addAmounts(acc.vault.reserved, legacyNewTotal(e0, xs)))
    && |res.awards| >= |acc.vault.awards|
    && (forall a :: a in acc.vault.awards ==> a in res.awards)
    && (forall a :: a in res.awards ==> a in acc.vault.awards || (a.origin.MonthlyLeaf? && a.period == period))
  decreases |xs|
{
  hide *;
  reveal ProofLib.DistinctBy, Std.Collections.Seq.FoldLeft, settlement__money_lawZeroIdentity, settlement__money_lawAddCommutative, settlement__money_lawAddAssociative, settlement__money_lawAddCongruence, settlement__money_lawAdditionValid;
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z) by { reveal settlement__money_validAmount, settlement__money_zero; }
  assert settlement__money_validAmount(acc.vault.reserved) by { reveal alwaysValidCounters; }
  if |xs| == 0 {
    assert legacyNewTotal(e0, xs) == z by { reveal legacyNewTotal; }
    settlement__money_lawZeroIdentity_ensures(acc.vault.reserved);
    EscSym(settlement__money_addAmounts(acc.vault.reserved, z), acc.vault.reserved);
  } else {
    var x0 := xs[0];
    var rest := xs[1..];
    assert xs == [x0] + rest;
    assert x0 in xs;
    EscLegacyOneStep(e0, period, time, acc, x0);
    var next := legacyStep(period, time, acc, x0);
    assert next.index == acc.index + 1 by { reveal legacyStep; }
    var v := acc.vault;
    var nv := next.vault;
    assert hasMonth(nv, period) by { reveal hasMonth; }
    var add := if sourceFree(e0, x0.source) then x0.gross else z;
    assert ProofLib.DistinctBy(rest, (x: LegacyEntry) => x.source) by {
      forall i, j | 0 <= i < |rest| && 0 <= j < |rest| && i != j ensures rest[i].source != rest[j].source {
        assert rest[i] == xs[i + 1] && rest[j] == xs[j + 1];
      }
    }
    forall x | x in rest ensures sourceFree(nv, x.source) == sourceFree(e0, x.source) {
      reveal sourceFree;
      var idx :| 0 <= idx < |rest| && rest[idx] == x;
      assert xs[idx + 1] == x && x.source != x0.source;
      assert sourceFree(v, x.source) == sourceFree(e0, x.source);
    }
    EscLegacyFold(e0, period, time, next, rest);
    EscLegacyNewTotalStep(e0, x0, rest);
    var res := Std.Collections.Seq.FoldLeft((acc: LegacyFold, x: LegacyEntry) => legacyStep(period, time, acc, x), acc, xs).vault;
    assert settlement__money_validAmount(nv.reserved) && settlement__money_validAmount(res.reserved) by { reveal alwaysValidCounters; }
    var restTot := legacyNewTotal(e0, rest);
    settlement__money_lawAdditionValid_ensures(v.reserved, add);
    settlement__money_lawAdditionValid_ensures(add, restTot);
    settlement__money_lawAddCongruence_ensures(nv.reserved, settlement__money_addAmounts(v.reserved, add), restTot);
    settlement__money_lawAddCommutative_ensures(nv.reserved, restTot);
    settlement__money_lawAddCommutative_ensures(settlement__money_addAmounts(v.reserved, add), restTot);
    EscChain(res.reserved, settlement__money_addAmounts(restTot, nv.reserved), settlement__money_addAmounts(restTot, settlement__money_addAmounts(v.reserved, add)));
    settlement__money_lawAddAssociative_ensures(v.reserved, add, restTot);
    EscChain(res.reserved, settlement__money_addAmounts(settlement__money_addAmounts(v.reserved, add), restTot), settlement__money_addAmounts(v.reserved, settlement__money_addAmounts(add, restTot)));
    settlement__money_lawAddCommutative_ensures(add, restTot);
    EscSym(legacyNewTotal(e0, xs), settlement__money_addAmounts(restTot, add));
    settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(restTot, add), legacyNewTotal(e0, xs), v.reserved);
    EscChain(res.reserved, settlement__money_addAmounts(v.reserved, settlement__money_addAmounts(restTot, add)), settlement__money_addAmounts(v.reserved, legacyNewTotal(e0, xs)));
  }
}

lemma EscLegacyDistinctEntries(e: Escrow, legacy: LegacyCommitment, ev: ChainEvent)
  requires canAdmitLegacyMonth(e, legacy, ev)
  ensures ProofLib.DistinctBy(legacy.entries, (x: LegacyEntry) => x.source)
  ensures settlement__money_validAmount(legacyNewTotal(e, legacy.entries))
{
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z);
  settlement__money_lawZeroIdentity_ensures(z);
  EscLegacyNewTotalShift(e, z, z, z, legacy.entries);
  forall i, j | 0 <= i < |legacy.entries| && 0 <= j < |legacy.entries| && i != j ensures legacy.entries[i].source != legacy.entries[j].source {
    assert legacy.entries[i] in legacy.entries;
    if legacy.entries[i].source == legacy.entries[j].source {
      ProofLib.FilterTwo((o: LegacyEntry) => (o.source == legacy.entries[i].source), legacy.entries, i, j);
    }
  }
}

lemma EscLegacyPrepare(e: Escrow, legacy: LegacyCommitment, ev: ChainEvent)
  requires alwaysValidCounters(e) && alwaysReservedSplit(e) && alwaysAwards(e) && canAdmitLegacyMonth(e, legacy, ev)
  ensures var newTotal := legacyNewTotal(e, legacy.entries);
    var w := closePledge(legacy.period, advance(ev, e)).(
      free := settlement__money_subtractAmounts(e.free, newTotal),
      committed := settlement__money_addAmounts(e.committed, newTotal),
      admissionsWhileOff := offAdmission(e),
      months := (e.months + [MonthReserve(legacy.period, "v1", legacy.root, legacyTotal(legacy.entries), settlement__money_zero, settlement__money_zero, settlement__money_zero, |legacy.entries|, ev.time, ev.time)])
    );
    settlement__money_validAmount(newTotal)
    && alwaysValidCounters(w) && alwaysReservedSplit(w) && alwaysAwards(w)
    && hasMonth(w, legacy.period)
    && ProofLib.DistinctBy(legacy.entries, (x: LegacyEntry) => x.source)
    && (forall x :: x in legacy.entries ==> sourceFree(w, x.source) == sourceFree(e, x.source))
{
  EscLegacyDistinctEntries(e, legacy, ev);
  var newTotal := legacyNewTotal(e, legacy.entries);
  assert closePledge(legacy.period, e).free == e.free;
  assert settlement__money_compareAmounts(e.free, newTotal) >= 0;
  settlement__money_lawSubtractionValid_ensures(e.free, newTotal);
  settlement__money_lawAdditionValid_ensures(e.committed, newTotal);
  var w := closePledge(legacy.period, advance(ev, e)).(
    free := settlement__money_subtractAmounts(e.free, newTotal),
    committed := settlement__money_addAmounts(e.committed, newTotal),
    admissionsWhileOff := offAdmission(e),
    months := (e.months + [MonthReserve(legacy.period, "v1", legacy.root, legacyTotal(legacy.entries), settlement__money_zero, settlement__money_zero, settlement__money_zero, |legacy.entries|, ev.time, ev.time)])
  );
  assert w.months[|e.months|] in w.months;
  assert hasMonth(w, legacy.period);
  assert alwaysAwards(w) by {
    forall a | a in w.awards ensures validAward(w, a) && |ProofLib.Filter((other: Award) => (other.source == a.source), w.awards)| == 1 {
      assert a in e.awards && validAward(e, a);
      if a.origin.MonthlyLeaf? {
        var m :| m in e.months && m.period == a.period;
        assert m in w.months;
      }
    }
  }
}

lemma EscLegacyMonthsValid(e: Escrow, legacy: LegacyCommitment, ev: ChainEvent, a: Escrow)
  requires alwaysMonths(e) && alwaysWithdrawalFees(e) && alwaysReleasedLeavesAdmitted(e) && canAdmitLegacyMonth(e, legacy, ev)
  requires a.months == e.months + [MonthReserve(legacy.period, "v1", legacy.root, legacyTotal(legacy.entries), settlement__money_zero, settlement__money_zero, settlement__money_zero, |legacy.entries|, ev.time, ev.time)]
  requires a.releasedLeaves == e.releasedLeaves && a.withdrawals == e.withdrawals
  ensures alwaysMonths(a) && alwaysWithdrawalFees(a) && alwaysReleasedLeavesAdmitted(a)
  ensures stepMonthsRetained(e, a) && stepWithdrawalsRetained(e, a)
  ensures stepOneRootPerPeriod(e, "admitLegacyMonth", a)
  ensures forall x :: hasMonth(a, x) == (hasMonth(e, x) || x == legacy.period)
{
  var q := legacy.period;
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z);
  settlement__money_lawEqualReflexive_ensures(z);
  var nm := a.months[|e.months|];
  forall x ensures hasMonth(a, x) == (hasMonth(e, x) || x == q) {
    if hasMonth(e, x) { var m :| m in e.months && m.period == x; assert m in a.months; }
    if x == q { assert nm in a.months; }
  }
  forall x | x in e.months ensures exists y :: y in a.months && sameMonthTerms(x, y) {
    assert x in a.months && sameMonthTerms(x, x);
  }
  forall m | m in a.months ensures |ProofLib.Filter((other: MonthReserve) => (other.period == m.period), a.months)| == 1 {
    var key := m.period;
    ProofLib.FilterAppend((other: MonthReserve) => (other.period == key), e.months, nm);
    if m == nm {
      ProofLib.FilterNone((other: MonthReserve) => (other.period == key), e.months);
      forall i | 0 <= i < |e.months| ensures e.months[i].period != key { assert e.months[i] in e.months; }
    } else {
      assert m in e.months && nm.period != key;
    }
  }
  forall l | l in a.releasedLeaves ensures hasMonth(a, l.period) { assert hasMonth(e, l.period); }
}

lemma EscLegacyMonthsRelease(e: Escrow, legacy: LegacyCommitment, ev: ChainEvent, a: Escrow)
  requires alwaysEvmReleaseWhole(e) && alwaysTouchedMonthsShrink(e) && alwaysReleaseWhole(e) && canAdmitLegacyMonth(e, legacy, ev)
  requires a.months == e.months + [MonthReserve(legacy.period, "v1", legacy.root, legacyTotal(legacy.entries), settlement__money_zero, settlement__money_zero, settlement__money_zero, |legacy.entries|, ev.time, ev.time)]
  requires a.releasedLeaves == e.releasedLeaves && a.asset == e.asset
  requires forall x :: x in a.awards ==> x in e.awards || (x.origin.MonthlyLeaf? && x.period == legacy.period)
  requires forall x :: x in e.awards ==> x in a.awards
  ensures alwaysEvmReleaseWhole(a) && alwaysTouchedMonthsShrink(a) && alwaysReleaseWhole(a)
{
  var q := legacy.period;
  var z := settlement__money_zero;
  assert settlement__money_validAmount(z);
  var nm := a.months[|e.months|];
  assert !settlement__money_positiveAmount(nm.released) && !settlement__money_positiveAmount(nm.admittedGross);
  forall m | m in e.months ensures m.period != q && leafTouched(a, m.period) == leafTouched(e, m.period)
    && (exists x :: x in a.awards && x.origin.MonthlyLeaf? && x.period == m.period) == (exists x :: x in e.awards && x.origin.MonthlyLeaf? && x.period == m.period) {
    if exists x :: x in a.awards && x.origin.MonthlyLeaf? && x.period == m.period {
      var x :| x in a.awards && x.origin.MonthlyLeaf? && x.period == m.period;
      assert x in e.awards;
    }
  }
}

lemma EscLegacyPledges(e: Escrow, legacy: LegacyCommitment, ev: ChainEvent, a: Escrow)
  requires alwaysPledgesCovered(e) && canAdmitLegacyMonth(e, legacy, ev)
  requires a.free == settlement__money_subtractAmounts(e.free, legacyNewTotal(e, legacy.entries))
  requires a.pledges == closePledge(legacy.period, advance(ev, e)).pledges
  requires a.pledged == closePledge(legacy.period, advance(ev, e)).pledged
  requires a.asset == e.asset && a.purpose == e.purpose && a.deployed
  requires forall x :: hasMonth(a, x) == (hasMonth(e, x) || x == legacy.period)
  ensures alwaysPledgesCovered(a) && stepPledgeIrrevocable(e, "admitLegacyMonth", a)
{
  var q := legacy.period;
  assert pledgeOf(advance(ev, e), q) == pledgeOf(e, q);
  var c := closePledge(q, e);
  assert a.pledges == c.pledges && a.pledged == c.pledged;
  assert settlement__money_compareAmounts(a.free, c.pledged) >= 0;
  if pledgeOf(e, q).open {
    var k := EscOpenPledgeAt(e, q);
    EscClosePledge(e, q);
    assert |a.pledges| == |e.pledges|;
    forall i | 0 <= i < |e.pledges| ensures a.pledges[i] == (if e.pledges[i].period == q then e.pledges[i].(open := false) else e.pledges[i]) {
    }
    forall p | p in a.pledges ensures validPeriod(p.period) && settlement__money_validAmount(p.amount) && settlement__money_positiveAmount(p.amount)
      && |ProofLib.Filter((o: Pledge) => (o.period == p.period), a.pledges)| == 1 && (!(p.open && hasMonth(a, p.period)) || a.asset.network.Solana?) {
      var i :| 0 <= i < |a.pledges| && a.pledges[i] == p;
      var po := e.pledges[i];
      assert po in e.pledges && po.period == p.period;
      ProofLib.FilterLengthPointwise((o: Pledge) => (o.period == p.period), (o: Pledge) => (o.period == p.period), e.pledges, a.pledges);
      ProofLib.FilterSamePredicate((o: Pledge) => (o.period == p.period), (o: Pledge) => (o.period == po.period), e.pledges);
      if p.open && hasMonth(a, p.period) { assert p.period != q && hasMonth(e, p.period); }
    }
    forall x | x in e.pledges && x.open ensures (pledgeOf(a, x.period).open && settlement__money_compareAmounts(pledgeOf(a, x.period).amount, x.amount) >= 0)
      || pledgeClosable(e, "admitLegacyMonth", a, x.period) {
      if x.period != q {
        var i :| 0 <= i < |e.pledges| && e.pledges[i] == x;
        assert a.pledges[i] == x && x in a.pledges;
        EscPledgeOf(a, x);
        settlement__money_lawEqualReflexive_ensures(x.amount);
      }
    }
  } else {
    assert c.pledges == e.pledges && c.pledged == e.pledged;
    forall p | p in a.pledges && p.open && hasMonth(a, p.period) ensures a.asset.network.Solana? {
      if p.period == q {
        EscPledgeOf(e, p);
        assert false;
      } else {
        assert hasMonth(e, p.period);
      }
    }
    forall x | x in e.pledges ensures pledgeOf(a, x.period) == x && settlement__money_compareAmounts(x.amount, x.amount) >= 0 {
      EscPledgeOf(e, x);
      assert pledgeOf(a, x.period) == pledgeOf(e, x.period);
      settlement__money_lawEqualReflexive_ensures(x.amount);
    }
  }
}

lemma EscLegacyCounters(e: Escrow, legacy: LegacyCommitment, ev: ChainEvent, a: Escrow)
  requires alwaysGrossConserved(e) && alwaysPaidSplit(e) && alwaysFeesConserved(e) && alwaysValidCounters(e)
  requires canAdmitLegacyMonth(e, legacy, ev)
  requires settlement__money_validAmount(legacyNewTotal(e, legacy.entries))
  requires a.deposited == e.deposited && a.held == e.held && a.spent == e.spent
  requires a.free == settlement__money_subtractAmounts(e.free, legacyNewTotal(e, legacy.entries))
  requires a.committed == settlement__money_addAmounts(e.committed, legacyNewTotal(e, legacy.entries))
  requires a.pending == e.pending
  requires settlement__money_validAmount(a.reserved)
  requires settlement__money_equalAmounts(a.reserved, settlement__money_addAmounts(e.reserved, legacyNewTotal(e, legacy.entries)))
  requires a.paid == e.paid && a.paidNet == e.paidNet && a.payoutFees == e.payoutFees
  requires a.grossWithdrawn == e.grossWithdrawn && a.withdrawalFees == e.withdrawalFees
  requires a.accruedFees == e.accruedFees && a.claimedFees == e.claimedFees
  ensures alwaysGrossConserved(a) && alwaysPaidSplit(a) && alwaysFeesConserved(a)
  ensures stepCumulativeCounters(e, a)
  ensures stepPoolLeavesOnlyByLeafOrRelease(e, "admitLegacyMonth", a)
  ensures stepFreeLeavesOnlyByOwnerOrRoot(e, "admitLegacyMonth", a)
  ensures stepFreeEntersOnlyByDepositOrRelease(e, "admitLegacyMonth", a)
{
  var nt := legacyNewTotal(e, legacy.entries);
  assert closePledge(legacy.period, e).free == e.free;
  assert settlement__money_compareAmounts(e.free, nt) >= 0;
  settlement__money_lawAddCommutative_ensures(e.free, e.committed);
  EscMove(e.held, e.free, e.committed, nt);
  EscAddLeft(e.committed, e.pending, e.reserved, nt);
  settlement__money_lawAdditionValid_ensures(e.reserved, nt);
  EscSym(a.reserved, settlement__money_addAmounts(e.reserved, nt));
  settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(e.reserved, nt), a.reserved, e.pending);
  EscChain(a.committed, settlement__money_addAmounts(e.pending, settlement__money_addAmounts(e.reserved, nt)), settlement__money_addAmounts(e.pending, a.reserved));
  settlement__money_lawSubtractionAtMost_ensures(e.free, nt);
  settlement__money_lawEqualReflexive_ensures(e.deposited);
  settlement__money_lawEqualReflexive_ensures(e.paid);
  settlement__money_lawEqualReflexive_ensures(e.paidNet);
  settlement__money_lawEqualReflexive_ensures(e.payoutFees);
  settlement__money_lawEqualReflexive_ensures(e.grossWithdrawn);
  settlement__money_lawEqualReflexive_ensures(e.withdrawalFees);
  settlement__money_lawEqualReflexive_ensures(e.claimedFees);
  settlement__money_lawEqualReflexive_ensures(e.pending);
}

lemma EscAdmitLegacyRun(e: Escrow, legacy: LegacyCommitment, ev: ChainEvent)
  requires alwaysValidCounters(e) && alwaysReservedSplit(e) && alwaysAwards(e) && canAdmitLegacyMonth(e, legacy, ev)
  ensures var a := admitLegacyMonth(e, legacy, ev);
    alwaysValidCounters(a) && alwaysReservedSplit(a) && alwaysAwards(a)
    && settlement__money_validAmount(legacyNewTotal(e, legacy.entries))
    && settlement__money_validAmount(a.reserved)
    && settlement__money_equalAmounts(a.reserved, settlement__money_addAmounts(e.reserved, legacyNewTotal(e, legacy.entries)))
    && a.deposited == e.deposited && a.held == e.held && a.spent == e.spent
    && a.free == settlement__money_subtractAmounts(e.free, legacyNewTotal(e, legacy.entries))
    && a.committed == settlement__money_addAmounts(e.committed, legacyNewTotal(e, legacy.entries))
    && a.pending == e.pending
    && a.paid == e.paid && a.paidNet == e.paidNet && a.payoutFees == e.payoutFees
    && a.grossWithdrawn == e.grossWithdrawn && a.withdrawalFees == e.withdrawalFees
    && a.accruedFees == e.accruedFees && a.claimedFees == e.claimedFees
    && a.monthlyCap == e.monthlyCap && a.monthlyEnabled == e.monthlyEnabled
    && a.months == e.months + [MonthReserve(legacy.period, "v1", legacy.root, legacyTotal(legacy.entries), settlement__money_zero, settlement__money_zero, settlement__money_zero, |legacy.entries|, ev.time, ev.time)]
    && a.releasedLeaves == e.releasedLeaves && a.withdrawals == e.withdrawals
    && a.pledges == closePledge(legacy.period, advance(ev, e)).pledges
    && a.pledged == closePledge(legacy.period, advance(ev, e)).pledged
    && a.asset == e.asset && a.purpose == e.purpose && a.deployed
    && a.vault == e.vault && a.owner == e.owner && a.feeRecipient == e.feeRecipient
    && a.bindingDelay == e.bindingDelay && a.at == ev && a.clock == ev.time
    && a.implementation == e.implementation && a.authority == e.authority
    && (forall x :: x in e.awards ==> x in a.awards)
    && (forall x :: x in a.awards ==> x in e.awards || (x.origin.MonthlyLeaf? && x.period == legacy.period))
    && stepAwardsRetained(e, a)
{
  hide *;
  reveal admitLegacyMonth, canAdmitLegacyMonth, legacyEntryAdmissible, closePledge, advance, stepAwardsRetained, sameAwardTerms;
  EscLegacyPrepare(e, legacy, ev);
  var nt := legacyNewTotal(e, legacy.entries);
  var w := closePledge(legacy.period, advance(ev, e)).(
    free := settlement__money_subtractAmounts(e.free, nt),
    committed := settlement__money_addAmounts(e.committed, nt),
    admissionsWhileOff := offAdmission(e),
    months := (e.months + [MonthReserve(legacy.period, "v1", legacy.root, legacyTotal(legacy.entries), settlement__money_zero, settlement__money_zero, settlement__money_zero, |legacy.entries|, ev.time, ev.time)])
  );
  EscLegacyFoldFrame(legacy.period, ev.time, LegacyFold(w, 0), legacy.entries);
  EscLegacyFold(e, legacy.period, ev.time, LegacyFold(w, 0), legacy.entries);
  var a := admitLegacyMonth(e, legacy, ev);
  assert settlement__money_validAmount(a.reserved) by { reveal alwaysValidCounters; }
  assert a.deployed by { reveal later; }
  forall x | x in e.awards ensures exists y :: y in a.awards && sameAwardTerms(x, y) && (!x.paid || x == y) {
    assert x in a.awards && sameAwardTerms(x, x);
  }
}

lemma EscLegacyShape(e: Escrow, legacy: LegacyCommitment, ev: ChainEvent, a: Escrow)
  requires alwaysBountyVaultHasNoMonths(e) && canAdmitLegacyMonth(e, legacy, ev)
  requires a.deployed && a.at == ev && a.clock == ev.time && a.vault == e.vault && a.asset == e.asset && a.purpose == e.purpose
  requires a.owner == e.owner && a.feeRecipient == e.feeRecipient && a.bindingDelay == e.bindingDelay
  requires a.implementation == e.implementation
  ensures alwaysBountyVaultHasNoMonths(a) && alwaysUndeployedEmpty(a)
  ensures stepEventOrder(e, a) && stepIdentityFixed(e, a) && stepImplementationOnlyUpgrades(e, a)
  ensures stepManualBlockedWhilePoolPending(e, "admitLegacyMonth", a) && stepReleaseNeedsUpgrade(e, "admitLegacyMonth", a)
{
}

lemma admitLegacyMonth_ensures(e: Escrow, legacy: LegacyCommitment, ev: ChainEvent)
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> alwaysEvmReleaseWhole(admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> alwaysTouchedMonthsShrink(admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> alwaysReleaseWhole(admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> alwaysGrossConserved(admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> alwaysReservedSplit(admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> alwaysPaidSplit(admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> alwaysFeesConserved(admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> alwaysValidCounters(admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> alwaysWithdrawalFees(admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> alwaysMonths(admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> alwaysBountyVaultHasNoMonths(admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> alwaysUndeployedEmpty(admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> alwaysReleasedLeavesAdmitted(admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> alwaysPledgesCovered(admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> alwaysAwards(admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> stepEventOrder(e, admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> stepIdentityFixed(e, admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> stepAwardsRetained(e, admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> stepMonthsRetained(e, admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> stepWithdrawalsRetained(e, admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> stepCumulativeCounters(e, admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> stepPoolLeavesOnlyByLeafOrRelease(e, "admitLegacyMonth", admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> stepFreeLeavesOnlyByOwnerOrRoot(e, "admitLegacyMonth", admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> stepFreeEntersOnlyByDepositOrRelease(e, "admitLegacyMonth", admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> stepManualBlockedWhilePoolPending(e, "admitLegacyMonth", admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> stepImplementationOnlyUpgrades(e, admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> stepReleaseNeedsUpgrade(e, "admitLegacyMonth", admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> stepOneRootPerPeriod(e, "admitLegacyMonth", admitLegacyMonth(e, legacy, ev)))
  ensures (inv(e) ==> canAdmitLegacyMonth(e, legacy, ev) ==> stepPledgeIrrevocable(e, "admitLegacyMonth", admitLegacyMonth(e, legacy, ev)))
{
  if inv(e) && canAdmitLegacyMonth(e, legacy, ev) {
    hide *;
    reveal inv;
    EscAdmitLegacyRun(e, legacy, ev);
    var a := admitLegacyMonth(e, legacy, ev);
    EscLegacyCounters(e, legacy, ev, a);
    EscLegacyMonthsValid(e, legacy, ev, a);
    EscLegacyMonthsRelease(e, legacy, ev, a);
    EscLegacyPledges(e, legacy, ev, a);
    EscLegacyShape(e, legacy, ev, a);
  }
}
