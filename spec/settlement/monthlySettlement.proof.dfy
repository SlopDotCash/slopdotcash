// Proof of the monthly settlement composition. Every event is one of the
// monthly allocation's or the escrow's own events under its own guard, or
// leaves both unchanged, so their proved rules carry over (MsChildInv and
// MsChildInvBack around each imported lemma). The helpers below prove the
// composition's own rules for the events that change what they read.

lemma MsChildInv(s: MonthlySettlement)
  requires inv(s)
  ensures settlement__monthly_inv(s.month) && settlement__escrow_inv(s.escrow)
{
  hide *;
  reveal inv, alwaysChildInvariants, settlement__monthly_inv, settlement__escrow_inv;
}

lemma MsChildInvBack(s: MonthlySettlement, t: MonthlySettlement)
  requires settlement__monthly_inv(t.month) && settlement__escrow_inv(t.escrow)
  ensures alwaysChildInvariants(t) && alwaysChildRules(t) && alwaysChildLifecycle(t)
{
  hide *;
  reveal alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
}

lemma MsMonthsInv(s: MonthlySettlement)
  requires inv(s)
  ensures settlement__escrow_alwaysMonths(s.escrow)
{
  hide *;
  reveal inv, alwaysChildInvariants;
}

lemma MsObligationsMatchInv(s: MonthlySettlement)
  requires inv(s)
  ensures settlement__monthly_alwaysObligationsMatchShares(s.month)
{
  hide *;
  reveal inv, alwaysChildInvariants;
}

lemma MsAllocationAndPledgesInv(s: MonthlySettlement)
  requires inv(s)
  ensures settlement__monthly_alwaysAllocationConserved(s.month)
  ensures settlement__escrow_alwaysPledgesCovered(s.escrow)
  ensures settlement__escrow_alwaysGrossConserved(s.escrow)
  ensures settlement__escrow_alwaysValidCounters(s.escrow)
{
  hide *;
  reveal inv, alwaysChildInvariants;
}

lemma MsAwardsInv(s: MonthlySettlement)
  requires inv(s)
  ensures settlement__escrow_alwaysAwards(s.escrow)
{
  hide *;
  reveal inv, alwaysChildInvariants;
}

lemma MsObligationsMatchVaultInv(s: MonthlySettlement)
  requires inv(s)
  ensures alwaysObligationsMatchVault(s)
{
  hide *;
  reveal inv;
}

lemma MsEscrowAwards(e: settlement__escrow_Escrow)
  requires settlement__escrow_inv(e)
  ensures settlement__escrow_alwaysAwards(e)
{
  hide *;
  reveal settlement__escrow_inv;
}

lemma MsEscrowMonths(e: settlement__escrow_Escrow)
  requires settlement__escrow_inv(e)
  ensures settlement__escrow_alwaysMonths(e)
{
  hide *;
  reveal settlement__escrow_inv;
}

lemma MsMonthlyObligationsMatch(m: settlement__monthly_Monthly)
  requires settlement__monthly_inv(m)
  ensures settlement__monthly_alwaysObligationsMatchShares(m)
{
  hide *;
  reveal settlement__monthly_inv;
}

lemma MsReleaseRulesInv(s: MonthlySettlement)
  requires inv(s)
  ensures settlement__escrow_alwaysTouchedMonthsShrink(s.escrow)
  ensures settlement__escrow_alwaysReleaseWhole(s.escrow)
  ensures settlement__escrow_alwaysValidCounters(s.escrow)
  ensures settlement__monthly_alwaysAllocationConserved(s.month)
{
  hide *;
  reveal inv, alwaysChildInvariants;
}

lemma MsEscrowValidCounters(e: settlement__escrow_Escrow)
  requires settlement__escrow_inv(e)
  ensures settlement__escrow_alwaysValidCounters(e)
{
  hide *;
  reveal settlement__escrow_inv;
}

lemma MsMonthlyAlloc(m: settlement__monthly_Monthly)
  requires settlement__monthly_inv(m)
  ensures settlement__monthly_alwaysAllocationConserved(m)
{
  hide *;
  reveal settlement__monthly_inv;
}

lemma MsPoolInvs(s: MonthlySettlement)
  requires inv(s)
  ensures alwaysAdmittedOnlyWhenFunded(s)
  ensures alwaysPoolIsTheMonthRemainder(s)
  ensures alwaysPendingPoolIsExactlyUnreserved(s)
{
  hide *;
  reveal inv;
}

lemma MsLeafReservesInv(s: MonthlySettlement)
  requires inv(s)
  ensures alwaysLeafAwardsReserveTheirObligation(s)
{
  hide *;
  reveal inv;
}

lemma MsMonthFrame(s: MonthlySettlement, t: MonthlySettlement)
  requires t.escrow == s.escrow && t.cursor == s.cursor
  requires t.month.project == s.month.project && t.month.period == s.month.period && t.month.obligations == s.month.obligations
  ensures settlement__monthly_obligationActors(t.month) == settlement__monthly_obligationActors(s.month)
  ensures forall actor :: sourceOf(t, actor) == sourceOf(s, actor)
  ensures forall actor :: obligationOf(t, actor) == obligationOf(s, actor)
  ensures alwaysOneAwardPerObligation(t) == alwaysOneAwardPerObligation(s)
  ensures alwaysUnreservedSourcesFreeWhilePooled(t) == alwaysUnreservedSourcesFreeWhilePooled(s)
  ensures alwaysObligationsMatchVault(t) == alwaysObligationsMatchVault(s)
{
  forall actor ensures obligationOf(t, actor) == obligationOf(s, actor) {
    assert settlement__monthly_keyFor(t.month, 0) == settlement__monthly_keyFor(s.month, 0);
  }
  forall actor ensures chainHolds(t, actor) == chainHolds(s, actor) && chainMatches(t, actor) == chainMatches(s, actor)
    && chainPaid(t, actor) == chainPaid(s, actor) && obligationMatches(t, actor) == obligationMatches(s, actor) {
    assert sourceOf(t, actor) == sourceOf(s, actor);
  }
}

lemma MsFrame(s: MonthlySettlement, t: MonthlySettlement)
  requires t.month.project == s.month.project && t.month.period == s.month.period && t.month.obligations == s.month.obligations
  requires t.escrow.awards == s.escrow.awards
  ensures settlement__monthly_obligationActors(t.month) == settlement__monthly_obligationActors(s.month)
  ensures forall actor :: sourceOf(t, actor) == sourceOf(s, actor) && obligationOf(t, actor) == obligationOf(s, actor)
  ensures forall actor :: (chainHolds(t, actor) == chainHolds(s, actor) && chainMatches(t, actor) == chainMatches(s, actor)
    && chainPaid(t, actor) == chainPaid(s, actor) && obligationMatches(t, actor) == obligationMatches(s, actor)
    && leafAwardReserves(t, actor) == leafAwardReserves(s, actor))
  ensures alwaysOneAwardPerObligation(t) == alwaysOneAwardPerObligation(s)
  ensures alwaysObligationsMatchVault(t) == alwaysObligationsMatchVault(s)
  ensures alwaysLeafAwardsAreObligations(t) == alwaysLeafAwardsAreObligations(s)
  ensures alwaysLeafAwardsReserveTheirObligation(t) == alwaysLeafAwardsReserveTheirObligation(s)
  ensures t.escrow.pending == s.escrow.pending ==> alwaysUnreservedSourcesFreeWhilePooled(t) == alwaysUnreservedSourcesFreeWhilePooled(s)
{
  assert settlement__escrow_awardActorsFor(t.escrow, t.month.project, t.month.period) == settlement__escrow_awardActorsFor(s.escrow, s.month.project, s.month.period);
  forall actor ensures obligationOf(t, actor) == obligationOf(s, actor) {
    assert settlement__monthly_keyFor(t.month, 0) == settlement__monthly_keyFor(s.month, 0);
  }
  forall actor ensures chainHolds(t, actor) == chainHolds(s, actor) && chainMatches(t, actor) == chainMatches(s, actor)
    && chainPaid(t, actor) == chainPaid(s, actor) && obligationMatches(t, actor) == obligationMatches(s, actor)
    && leafAwardReserves(t, actor) == leafAwardReserves(s, actor) {
    assert sourceOf(t, actor) == sourceOf(s, actor);
    assert settlement__escrow_awardFor(t.escrow, sourceOf(t, actor)) == settlement__escrow_awardFor(s.escrow, sourceOf(s, actor));
  }
}

lemma MsNoLeafAwards(e: settlement__escrow_Escrow)
  requires settlement__escrow_alwaysAwards(e)
  requires |e.months| == 0
  ensures forall source :: !settlement__escrow_awardFor(e, source).origin.MonthlyLeaf?
{
  forall source ensures !settlement__escrow_awardFor(e, source).origin.MonthlyLeaf? {
    var kept := ProofLib.Filter((a: settlement__escrow_Award) => (a.source == source), e.awards);
    if 0 < |kept| {
      ProofLib.FilterSubset((a: settlement__escrow_Award) => (a.source == source), e.awards);
      assert kept[0] in e.awards;
      assert settlement__escrow_validAward(e, kept[0]);
    }
  }
}

lemma MsAwardsDistinct(e: settlement__escrow_Escrow)
  requires settlement__escrow_alwaysAwards(e)
  ensures ProofLib.DistinctBy(e.awards, (a: settlement__escrow_Award) => a.source)
{
  forall i, j | 0 <= i < |e.awards| && 0 <= j < |e.awards| && i != j
    ensures e.awards[i].source != e.awards[j].source {
    var a := e.awards[i];
    assert a in e.awards;
    ProofLib.FilterCountOneIffUnique((other: settlement__escrow_Award) => (other.source == a.source), e.awards, (x: settlement__escrow_Award) => x.source, i);
  }
}

lemma MsOneAward(s: MonthlySettlement)
  requires settlement__escrow_alwaysAwards(s.escrow)
  ensures alwaysOneAwardPerObligation(s)
{
  var p := (a: settlement__escrow_Award) => ((a.source.origin == s.month.project) && (a.source.period == s.month.period));
  var xs := ProofLib.Filter(p, s.escrow.awards);
  MsAwardsDistinct(s.escrow);
  ProofLib.FilterKeepsDistinctBy(p, s.escrow.awards, (x: settlement__escrow_Award) => x.source);
  var actors := settlement__escrow_awardActorsFor(s.escrow, s.month.project, s.month.period);
  assert |actors| == |xs| && forall i :: 0 <= i < |actors| ==> actors[i] == xs[i].source.actor;
  forall i | 0 <= i < |xs| ensures p(xs[i]) { ProofLib.FilterMember(p, s.escrow.awards, xs[i]); }
  assert ProofLib.Distinct(actors) by {
    forall i, j | 0 <= i < j < |actors| ensures actors[i] != actors[j] {
      assert xs[i].source != xs[j].source;
    }
  }
  forall actor | actor in settlement__monthly_obligationActors(s.month)
    ensures |ProofLib.Filter((a: int) => (a == actor), actors)| <= 1 {
    if actor in actors {
      ProofLib.FilterDistinctCountOne((a: int) => (a == actor), actors, actor);
    } else {
      ProofLib.FilterNone((a: int) => (a == actor), actors);
    }
  }
}

lemma MsOpenMonth(s: MonthlySettlement, period: int)
  requires inv(s) && canOpenMonth(s, period)
  ensures alwaysLeafAwardsAreObligations(openMonth(s, period)) && alwaysObligationsMatchVault(openMonth(s, period))
{
  var after := openMonth(s, period);
  assert alwaysChildLifecycle(s);
  assert settlement__monthly_alwaysNoObligationsBeforeFunding(s.month);
  assert s.month.obligations == [];
  assert after.month.obligations == [];
  assert settlement__monthly_obligationActors(after.month) == [];
  assert alwaysAdmittedOnlyWhenFunded(s);
  assert |s.escrow.months| == 0;
  MsNoLeafAwards(s.escrow);
  assert after.escrow == s.escrow;
}

lemma MsDeploy(s: MonthlySettlement, asset: settlement__escrow_AssetIdentity, mint: settlement__escrow_MintFacts, purpose: settlement__escrow_VaultPurpose, delay: int, cap: seq<int>, turnOn: bool)
  requires inv(s) && canDeploy(s, asset, mint, purpose, delay, cap, turnOn)
  ensures deploy(s, asset, mint, purpose, delay, cap, turnOn).escrow.awards == []
{
  assert alwaysChildLifecycle(s);
  assert s.escrow.awards == [];
}

lemma MsCreatedValid(obs: seq<settlement__monthly_Obligation>, start: seq<int>)
  requires settlement__money_validAmount(start)
  requires forall o :: o in obs ==> settlement__money_validAmount(o.amount)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((sum: settlement__money_Amount, o: settlement__monthly_Obligation) => settlement__money_addAmounts(sum, (if o.progress.Created? then o.amount else settlement__money_zero)), start, obs))
  decreases |obs|
{
  if |obs| > 0 {
    var term := if obs[0].progress.Created? then obs[0].amount else settlement__money_zero;
    assert obs[0] in obs;
    assert settlement__money_validAmount(settlement__money_zero);
    settlement__money_lawAdditionValid_ensures(start, term);
    assert forall o :: o in obs[1..] ==> o in obs;
    MsCreatedValid(obs[1..], settlement__money_addAmounts(start, term));
  }
}

lemma MsShareSumValid(shares: seq<settlement__allocation_Share>, start: seq<int>)
  requires settlement__money_validAmount(start)
  requires forall share :: share in shares ==> settlement__money_validAmount(share.amount)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((sum: settlement__money_Amount, share: settlement__allocation_Share) => settlement__money_addAmounts(sum, share.amount), start, shares))
  decreases |shares|
{
  if |shares| > 0 {
    assert shares[0] in shares;
    settlement__money_lawAdditionValid_ensures(start, shares[0].amount);
    assert forall share :: share in shares[1..] ==> share in shares;
    MsShareSumValid(shares[1..], settlement__money_addAmounts(start, shares[0].amount));
  }
}

lemma MsAmountsValid(m: settlement__monthly_Monthly)
  requires settlement__monthly_alwaysAllocationConserved(m) && settlement__monthly_alwaysObligationsMatchShares(m)
  ensures forall o :: o in m.obligations ==> settlement__money_validAmount(o.amount)
{
  forall o | o in m.obligations ensures settlement__money_validAmount(o.amount) {
    var sh :| sh in m.shares && sh.actor == o.actor && sh.amount == o.amount;
  }
}

lemma MsMonthValid(e: settlement__escrow_Escrow, period: int)
  requires settlement__escrow_alwaysMonths(e)
  ensures settlement__money_validAmount(settlement__escrow_monthFor(e, period).remaining)
{
  var kept := ProofLib.Filter((m: settlement__escrow_MonthReserve) => (m.period == period), e.months);
  if 0 < |kept| {
    ProofLib.FilterSubset((m: settlement__escrow_MonthReserve) => (m.period == period), e.months);
    assert kept[0] in e.months;
  } else {
    assert settlement__money_validAmount(settlement__money_zero);
  }
}

lemma MsNoMonth(e: settlement__escrow_Escrow, period: int)
  requires |e.months| == 0
  ensures settlement__escrow_monthFor(e, period) == settlement__escrow_noMonth
{
  ProofLib.FilterNil((m: settlement__escrow_MonthReserve) => (m.period == period), e.months);
}

// With no positive remainder, the pool is within the unreserved gross.
lemma MsPoolBound(t: MonthlySettlement)
  requires !settlement__money_positiveAmount(settlement__escrow_monthFor(t.escrow, t.month.period).remaining)
  requires settlement__money_validAmount(settlement__escrow_monthFor(t.escrow, t.month.period).remaining)
  requires forall o :: o in t.month.obligations ==> settlement__money_validAmount(o.amount)
  ensures alwaysPoolWithinUnreserved(t)
{
  var r := settlement__escrow_monthFor(t.escrow, t.month.period).remaining;
  var ct := settlement__monthly_createdTotal(t.month);
  MsCreatedValid(t.month.obligations, settlement__money_zero);
  assert settlement__money_validAmount(ct);
  assert settlement__money_validAmount(settlement__money_zero);
  settlement__money_lawZeroOrder_ensures(ct);
  settlement__money_lawZeroOrder_ensures(r);
  settlement__money_lawNumericOrderTransitive_ensures(r, settlement__money_zero, ct);
}

// A created obligation is found by its actor, or the default, also created.
lemma MsAllCreated(m: settlement__monthly_Monthly)
  requires forall o :: o in m.obligations ==> o.progress.Created?
  ensures forall actor :: settlement__monthly_obligationFor(m, actor).progress.Created?
{
  forall actor ensures settlement__monthly_obligationFor(m, actor).progress.Created? {
    var kept := ProofLib.Filter((o: settlement__monthly_Obligation) => (o.actor == actor), m.obligations);
    if 0 < |kept| {
      ProofLib.FilterSubset((o: settlement__monthly_Obligation) => (o.actor == actor), m.obligations);
      assert kept[0] in m.obligations;
    }
  }
}

// An obligation found by a positive actor is one of the month's, so its actor is listed.
lemma MsListed(m: settlement__monthly_Monthly, actor: int)
  requires settlement__monthly_obligationFor(m, actor).actor > 0
  ensures settlement__monthly_obligationFor(m, actor) in m.obligations
  ensures actor in settlement__monthly_obligationActors(m)
{
  var kept := ProofLib.Filter((o: settlement__monthly_Obligation) => (o.actor == actor), m.obligations);
  if 0 < |kept| {
    ProofLib.FilterSubset((o: settlement__monthly_Obligation) => (o.actor == actor), m.obligations);
    assert kept[0] in m.obligations;
    ProofLib.FilterMember((o: settlement__monthly_Obligation) => (o.actor == actor), m.obligations, kept[0]);
    var i :| 0 <= i < |m.obligations| && m.obligations[i] == kept[0];
    assert settlement__monthly_obligationActors(m)[i] == actor;
  }
}

// Every other month's open pledge is a valid amount, so the held-back sum is one too.
lemma MsHeldValid(ps: seq<settlement__escrow_Pledge>, period: int, start: seq<int>)
  requires settlement__money_validAmount(start)
  requires forall p :: p in ps ==> settlement__money_validAmount(p.amount)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((t: settlement__money_Amount, p: settlement__escrow_Pledge) => (if (p.open && (p.period != period)) then settlement__money_addAmounts(t, p.amount) else t), start, ps))
  decreases |ps|
{
  if |ps| > 0 {
    assert ps[0] in ps;
    var next := if (ps[0].open && (ps[0].period != period)) then settlement__money_addAmounts(start, ps[0].amount) else start;
    settlement__money_lawAdditionValid_ensures(start, ps[0].amount);
    assert forall p :: p in ps[1..] ==> p in ps;
    MsHeldValid(ps[1..], period, next);
  }
}

lemma MsObligationTotalIsPayable(m: settlement__monthly_Monthly, obs: settlement__monthly_VaultObservation, bans: seq<settlement__monthly_BanExclusion>)
  requires settlement__monthly_alwaysAllocationConserved(m)
  ensures settlement__monthly_obligationTotal(settlement__monthly_createObligations(m, obs, bans)) == settlement__monthly_payableTotal(settlement__monthly_payable(m, bans))
  ensures settlement__money_validAmount(settlement__monthly_payableTotal(settlement__monthly_payable(m, bans)))
{
  var after := settlement__monthly_createObligations(m, obs, bans);
  var p := settlement__monthly_payable(m, bans);
  var pred := (sh: settlement__allocation_Share) => (settlement__money_positiveAmount(sh.amount) && !(settlement__monthly_banFor(bans, sh.actor)));
  assert p == ProofLib.Filter(pred, m.shares);
  forall sh | sh in p ensures sh in m.shares {
    ProofLib.FilterMember(pred, m.shares, sh);
  }
  assert forall sh :: sh in p ==> settlement__money_validAmount(sh.amount);
  assert settlement__money_validAmount(settlement__money_zero);
  MsShareSumValid(p, settlement__money_zero);
  assert |after.obligations| == |p|;
  ProofLib.FoldLeftPointwise((sum: settlement__money_Amount, ob: settlement__monthly_Obligation) => settlement__money_addAmounts(sum, ob.amount),
    (sum: settlement__money_Amount, share: settlement__allocation_Share) => settlement__money_addAmounts(sum, share.amount),
    settlement__money_zero, after.obligations, p);
}

lemma MsCoveredArith(total: seq<int>, earlierUnreserved: seq<int>, held: seq<int>, free: seq<int>)
  requires settlement__money_validAmount(total) && settlement__money_validAmount(earlierUnreserved)
  requires settlement__money_validAmount(held) && settlement__money_validAmount(free)
  requires !settlement__money_positiveAmount(settlement__money_addAmounts(total, earlierUnreserved))
    || settlement__money_compareAmounts(free, settlement__money_addAmounts(settlement__money_addAmounts(total, earlierUnreserved), held)) >= 0
  ensures settlement__money_compareAmounts(free, total) >= 0
{
  var needed := settlement__money_addAmounts(total, earlierUnreserved);
  settlement__money_lawAdditionValid_ensures(total, earlierUnreserved);
  settlement__money_lawAdditionValid_ensures(needed, held);
  settlement__money_lawAddMonotone_ensures(total, earlierUnreserved);
  settlement__money_lawAddMonotone_ensures(needed, held);
  settlement__money_lawNumericOrderTotal_ensures(total, needed);
  settlement__money_lawNumericOrderTotal_ensures(needed, settlement__money_addAmounts(needed, held));
  settlement__money_lawNumericOrderTotal_ensures(total, free);
  settlement__money_lawNumericOrderTotal_ensures(free, settlement__money_addAmounts(needed, held));
  settlement__money_lawZeroOrder_ensures(free);
  settlement__money_lawZeroOrder_ensures(needed);
  if settlement__money_positiveAmount(needed) {
    settlement__money_lawNumericOrderTransitive_ensures(total, needed, settlement__money_addAmounts(needed, held));
    settlement__money_lawNumericOrderTransitive_ensures(total, settlement__money_addAmounts(needed, held), free);
  } else {
    settlement__money_lawNumericOrderTransitive_ensures(total, needed, settlement__money_zero);
    settlement__money_lawNumericOrderTransitive_ensures(total, settlement__money_zero, free);
  }
}

// The vault covered the created obligations: they total the payable shares, which the coordinator covered.
lemma MsCovered(s: MonthlySettlement, earlierUnreserved: seq<int>, bans: seq<settlement__monthly_BanExclusion>)
  requires inv(s) && canCreateObligations(s, earlierUnreserved, bans)
  ensures settlement__money_compareAmounts(s.escrow.free, settlement__monthly_obligationTotal(createObligations(s, earlierUnreserved, bans).month)) >= 0
{
  hide inv, alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  MsAllocationAndPledgesInv(s);
  MsObligationTotalIsPayable(s.month, observation(s, earlierUnreserved), bans);
  var total := settlement__monthly_payableTotal(settlement__monthly_payable(s.month, bans));
  var held := otherOpenPledges(s);
  MsHeldValid(s.escrow.pledges, s.month.period, settlement__money_zero);
  MsCoveredArith(total, earlierUnreserved, held, s.escrow.free);
}

lemma MsCreate(s: MonthlySettlement, earlierUnreserved: seq<int>, bans: seq<settlement__monthly_BanExclusion>)
  requires inv(s) && canCreateObligations(s, earlierUnreserved, bans)
  requires settlement__monthly_inv(createObligations(s, earlierUnreserved, bans).month)
  ensures alwaysPoolWithinUnreserved(createObligations(s, earlierUnreserved, bans))
  ensures alwaysObligationsMatchVault(createObligations(s, earlierUnreserved, bans))
  ensures alwaysLeafAwardsAreObligations(createObligations(s, earlierUnreserved, bans))
  ensures alwaysLeafAwardsReserveTheirObligation(createObligations(s, earlierUnreserved, bans))
  ensures stepObligationsOnFreshCoveringHead(s, "createObligations", createObligations(s, earlierUnreserved, bans))
{
  var after := createObligations(s, earlierUnreserved, bans);
  assert alwaysChildInvariants(s);
  assert s.month.phase.Frozen?;
  assert alwaysAdmittedOnlyWhenFunded(s);
  assert |s.escrow.months| == 0;
  MsNoMonth(s.escrow, s.month.period);
  MsNoLeafAwards(s.escrow);
  assert after.escrow == s.escrow;
  MsAmountsValid(after.month);
  assert settlement__money_validAmount(settlement__money_zero);
  MsPoolBound(after);
  assert forall o :: o in after.month.obligations ==> o.progress.Created?;
  MsAllCreated(after.month);
  MsCovered(s, earlierUnreserved, bans);
}

lemma MsAdmit(s: MonthlySettlement, authorization: settlement__escrow_RootAuthorization, ev: settlement__escrow_ChainEvent)
{
}

lemma MsRelease(s: MonthlySettlement, release: settlement__escrow_ReleaseAuthorization, ev: settlement__escrow_ChainEvent, by_: string)
{
}

lemma MsManual(s: MonthlySettlement, source: settlement__escrow_SourceKey, actor: int, gross: seq<int>, ev: settlement__escrow_ChainEvent, by_: string)
{
}

lemma MsPay(s: MonthlySettlement, actor: int, destination: string, version: int, ev: settlement__escrow_ChainEvent)
{
}

lemma MsCommitObligation(s: MonthlySettlement, actor: int, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canCommitObligation(s, actor, ev, by_)
  requires settlement__monthly_inv(commitObligation(s, actor, ev, by_).month) && settlement__escrow_inv(commitObligation(s, actor, ev, by_).escrow)
  ensures alwaysPoolWithinUnreserved(commitObligation(s, actor, ev, by_))
  ensures alwaysPendingPoolIsExactlyUnreserved(commitObligation(s, actor, ev, by_))
{
  var after := commitObligation(s, actor, ev, by_);
  assert alwaysChildInvariants(s);
  var r := settlement__escrow_monthFor(s.escrow, s.month.period).remaining;
  assert alwaysPoolIsTheMonthRemainder(s);
  settlement__money_lawEqualOrder_ensures(s.escrow.pending, r, settlement__money_zero);
  assert !settlement__money_positiveAmount(r);
  assert after.escrow.months == s.escrow.months && after.month.period == s.month.period;
  assert settlement__escrow_monthFor(after.escrow, after.month.period) == settlement__escrow_monthFor(s.escrow, s.month.period);
  MsMonthValid(s.escrow, s.month.period);
  MsAmountsValid(after.month);
  MsPoolBound(after);
}

lemma MsMaterialize(s: MonthlySettlement, proof: settlement__escrow_LeafProof, ev: settlement__escrow_ChainEvent)
{
}

// While the pool holds a positive remainder, every created obligation's source is free on chain.
lemma MsNoRemainderWhenHeld(s: MonthlySettlement, actor: int)
  requires inv(s)
  requires obligationOf(s, actor).actor > 0 && obligationOf(s, actor).progress.Created? && chainHolds(s, actor)
  ensures !settlement__money_positiveAmount(settlement__escrow_monthFor(s.escrow, s.month.period).remaining)
{
  MsListed(s.month, actor);
  assert alwaysPoolIsTheMonthRemainder(s);
  assert alwaysUnreservedSourcesFreeWhilePooled(s);
  settlement__money_lawEqualOrder_ensures(s.escrow.pending, settlement__escrow_monthFor(s.escrow, s.month.period).remaining, settlement__money_zero);
}

lemma MsObserveExisting(s: MonthlySettlement, actor: int)
  requires inv(s) && canObserveExistingAward(s, actor)
  requires settlement__monthly_inv(observeExistingAward(s, actor).month)
  ensures alwaysPoolWithinUnreserved(observeExistingAward(s, actor))
  ensures alwaysPendingPoolIsExactlyUnreserved(observeExistingAward(s, actor))
{
  var after := observeExistingAward(s, actor);
  assert alwaysChildInvariants(s);
  MsNoRemainderWhenHeld(s, actor);
  assert after.escrow == s.escrow && after.month.period == s.month.period;
  MsMonthValid(s.escrow, s.month.period);
  MsAmountsValid(after.month);
  MsPoolBound(after);
}

lemma MsObservePaid(s: MonthlySettlement, actor: int)
{
}

lemma MsObserveConflict(s: MonthlySettlement, actor: int)
{
}

// The one obligation of an actor is the one obligationFor finds.
lemma MsTheObligation(m: settlement__monthly_Monthly, o: settlement__monthly_Obligation)
  requires settlement__monthly_alwaysObligationsMatchShares(m) && o in m.obligations
  ensures settlement__monthly_obligationFor(m, o.actor) == o
{
  var p := (x: settlement__monthly_Obligation) => (x.actor == o.actor);
  assert |Std.Collections.Seq.Filter(p, m.obligations)| == 1;
  ProofLib.FilterMember(p, m.obligations, o);
}

// The obligation found by a positive actor has that actor.
lemma MsFoundActor(m: settlement__monthly_Monthly, actor: int)
  requires settlement__monthly_obligationFor(m, actor).actor > 0
  ensures settlement__monthly_obligationFor(m, actor).actor == actor
{
  var p := (o: settlement__monthly_Obligation) => (o.actor == actor);
  var kept := Std.Collections.Seq.Filter(p, m.obligations);
  if 0 < |kept| { ProofLib.FilterMember(p, m.obligations, kept[0]); }
}

// The admitted month of a period is the one month the vault holds for it.
lemma MsMonthIs(e: settlement__escrow_Escrow, i: int)
  requires settlement__escrow_alwaysMonths(e) && 0 <= i < |e.months|
  ensures settlement__escrow_monthFor(e, e.months[i].period) == e.months[i]
{
  var m := e.months[i];
  var p := (x: settlement__escrow_MonthReserve) => (x.period == m.period);
  assert m in e.months;
  assert |Std.Collections.Seq.Filter(p, e.months)| == 1;
  ProofLib.FilterMember(p, e.months, m);
}

// A positive amount at most another valid amount makes that one positive too.
lemma MsPositiveBelow(a: seq<int>, b: seq<int>)
  requires settlement__money_validAmount(a) && settlement__money_validAmount(b)
  requires settlement__money_positiveAmount(a) && settlement__money_compareAmounts(a, b) <= 0
  ensures settlement__money_positiveAmount(b)
{
  assert settlement__money_validAmount(settlement__money_zero);
  settlement__money_lawNumericOrderTotal_ensures(a, settlement__money_zero);
  settlement__money_lawNumericOrderTotal_ensures(b, settlement__money_zero);
  settlement__money_lawNumericOrderTransitive_ensures(settlement__money_zero, a, b);
}

// The admitted leaves keep their obligations while the leaves and the obligations stay and the remainder grows no larger.
lemma MsLeavesFrame(s: MonthlySettlement, t: MonthlySettlement)
  requires alwaysAdmittedLeavesUnconflicted(s)
  requires t.leaves == s.leaves && t.month.project == s.month.project && t.month.period == s.month.period && t.month.obligations == s.month.obligations
  requires settlement__money_positiveAmount(admittedMonth(t).remaining) ==> settlement__money_positiveAmount(admittedMonth(s).remaining)
  ensures alwaysAdmittedLeavesUnconflicted(t)
{
  forall actor ensures obligationOf(t, actor) == obligationOf(s, actor) {
    assert settlement__monthly_keyFor(t.month, 0) == settlement__monthly_keyFor(s.month, 0);
  }
}

// With nothing of the admitted month pending, both leaf rules hold.
lemma MsLeavesVacuous(t: MonthlySettlement)
  requires !settlement__money_positiveAmount(admittedMonth(t).remaining)
  ensures alwaysAdmittedLeavesUnconflicted(t) && alwaysAdmittedLeavesNeverConflict(t)
{
}

// A vault without months holds back no remainder.
lemma MsNoMonthVacuous(t: MonthlySettlement)
  requires |t.escrow.months| == 0
  ensures alwaysAdmittedLeavesUnconflicted(t) && alwaysAdmittedLeavesNeverConflict(t)
{
  MsNoMonth(t.escrow, t.month.period);
  settlement__money_lawEqualReflexive_ensures(settlement__money_zero);
  MsLeavesVacuous(t);
}

// While the pool is pending, an unconflicted leaf's source is free or holds its matching award.
lemma MsLeavesNeverConflict(t: MonthlySettlement)
  requires alwaysAdmittedLeavesUnconflicted(t) && alwaysObligationsMatchVault(t)
  requires alwaysUnreservedSourcesFreeWhilePooled(t) && alwaysPoolIsTheMonthRemainder(t)
  ensures alwaysAdmittedLeavesNeverConflict(t)
{
  var r := admittedMonth(t).remaining;
  if settlement__money_positiveAmount(r) {
    settlement__money_lawEqualOrder_ensures(t.escrow.pending, r, settlement__money_zero);
    assert settlement__money_positiveAmount(t.escrow.pending);
    forall actor | actor in t.leaves ensures !chainHolds(t, actor) || chainMatches(t, actor) {
      MsListed(t.month, actor);
      assert obligationMatches(t, actor);
    }
  }
}

// One obligation's progress changes to an unconflicted state: the admitted leaves stay unconflicted.
lemma MsLeavesRecorded(s: MonthlySettlement, t: MonthlySettlement, w: int, q: settlement__monthly_ObligationState)
  requires alwaysAdmittedLeavesUnconflicted(s)
  requires settlement__monthly_alwaysObligationsMatchShares(t.month)
  requires !q.Conflicted?
  requires t.leaves == s.leaves
  requires |t.month.obligations| == |s.month.obligations|
  requires forall i :: 0 <= i < |s.month.obligations| ==> t.month.obligations[i] == (if s.month.obligations[i].actor == w then s.month.obligations[i].(progress := q) else s.month.obligations[i])
  requires settlement__money_positiveAmount(admittedMonth(t).remaining) ==> settlement__money_positiveAmount(admittedMonth(s).remaining)
  ensures alwaysAdmittedLeavesUnconflicted(t)
{
  if settlement__money_positiveAmount(admittedMonth(t).remaining) {
    forall a | a in t.leaves ensures obligationOf(t, a).actor > 0 && !obligationOf(t, a).progress.Conflicted? {
      var o := obligationOf(s, a);
      MsListed(s.month, a);
      MsFoundActor(s.month, a);
      var i :| 0 <= i < |s.month.obligations| && s.month.obligations[i] == o;
      var n := t.month.obligations[i];
      assert n in t.month.obligations;
      assert n.actor == a;
      MsTheObligation(t.month, n);
    }
  }
}

// The root admits the month's created obligations as its leaves, none conflicted.
lemma MsAdmitLeaves(s: MonthlySettlement, authorization: settlement__escrow_RootAuthorization, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canAdmitRoot(s, authorization, ev)
  ensures alwaysAdmittedLeavesUnconflicted(admitRoot(s, authorization, ev))
{
  hide inv, alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  MsObligationsMatchInv(s);
  var t := admitRoot(s, authorization, ev);
  var p := (o: settlement__monthly_Obligation) => o.progress.Created?;
  var created := ProofLib.Filter(p, s.month.obligations);
  assert t.leaves == createdActors(s);
  forall actor | actor in t.leaves ensures obligationOf(t, actor).actor > 0 && !obligationOf(t, actor).progress.Conflicted? {
    var i :| 0 <= i < |created| && created[i].actor == actor;
    var o := created[i];
    ProofLib.FilterMember(p, s.month.obligations, o);
    MsTheObligation(s.month, o);
    assert t.month == s.month;
  }
}

// A proven leaf is drawn from a positive remainder.
lemma MsLeafFromPositive(s: MonthlySettlement, proof: settlement__escrow_LeafProof, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canMaterialize(s, proof, ev)
  ensures settlement__money_positiveAmount(admittedMonth(s).remaining)
{
  hide inv, alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  MsMonthsInv(s);
  MsMonthValid(s.escrow, s.month.period);
  settlement__money_lawNumericOrderTotal_ensures(proof.gross, admittedMonth(s).remaining);
  MsPositiveBelow(proof.gross, admittedMonth(s).remaining);
}

// A reserve release leaves no more of the month pending than before.
lemma MsReleaseShrinks(s: MonthlySettlement, release: settlement__escrow_ReleaseAuthorization, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canReleaseReserve(s, release, ev, by_)
  requires settlement__escrow_alwaysMonths(releaseReserve(s, release, ev, by_).escrow)
  ensures settlement__money_positiveAmount(admittedMonth(releaseReserve(s, release, ev, by_)).remaining) ==> settlement__money_positiveAmount(admittedMonth(s).remaining)
{
  hide inv, alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  MsMonthsInv(s);
  var t := releaseReserve(s, release, ev, by_);
  var period := s.month.period;
  var p := (x: settlement__escrow_MonthReserve) => (x.period == period);
  var kept := ProofLib.Filter(p, t.escrow.months);
  assert |t.escrow.months| == |s.escrow.months|;
  if settlement__money_positiveAmount(admittedMonth(t).remaining) && 0 < |kept| {
    ProofLib.FilterMember(p, t.escrow.months, kept[0]);
    assert kept[0] in t.escrow.months;
    var i :| 0 <= i < |t.escrow.months| && t.escrow.months[i] == kept[0];
    var before := s.escrow.months[i];
    MsMonthIs(s.escrow, i);
    MsMonthValid(s.escrow, period);
    if before.period == release.period {
      settlement__money_lawSubtractionAtMost_ensures(before.remaining, release.releasedGross);
      settlement__money_lawEqualOrder_ensures(release.releasedGross, before.remaining, before.remaining);
      settlement__money_lawEqualReflexive_ensures(before.remaining);
      settlement__money_lawSubtractionValid_ensures(before.remaining, release.releasedGross);
      MsPositiveBelow(t.escrow.months[i].remaining, before.remaining);
    }
  } else if settlement__money_positiveAmount(admittedMonth(t).remaining) {
    assert admittedMonth(t) == settlement__escrow_noMonth;
    settlement__money_lawEqualReflexive_ensures(settlement__money_zero);
    settlement__money_lawZeroOrder_ensures(settlement__money_zero);
  }
}

// An observed conflict is of an obligation the pool does not hold.
lemma MsConflictUnpooled(s: MonthlySettlement, actor: int)
  requires inv(s) && canObserveConflict(s, actor)
  ensures !settlement__money_positiveAmount(admittedMonth(s).remaining)
{
  hide inv, alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  MsObligationsMatchInv(s);
  MsObligationsMatchVaultInv(s);
  var o := obligationOf(s, actor);
  MsListed(s.month, actor);
  MsFoundActor(s.month, actor);
  assert obligationMatches(s, actor);
  if o.progress.Created? {
    MsNoRemainderWhenHeld(s, actor);
  } else {
    var source := observedFact(s, actor).source;
    var p := (x: settlement__monthly_Obligation) => (x.source == source);
    var b := settlement__monthly_obligationBySource(s.month, source);
    var kept := ProofLib.Filter(p, s.month.obligations);
    assert o.source == settlement__monthly_keyFor(s.month, o.actor);
    assert p(o);
    ProofLib.FilterMember(p, s.month.obligations, o);
    assert o in kept;
    assert 0 < |kept|;
    ProofLib.FilterMember(p, s.month.obligations, kept[0]);
    assert b == kept[0];
    assert b in s.month.obligations && b.source == source;
    assert b.source == settlement__monthly_keyFor(s.month, b.actor);
    assert b.actor == actor;
    MsTheObligation(s.month, b);
  }
}

// An escrow event that keeps the awards, months and pool gives every view the composition reads the same value.
lemma MsEscrowViewsSame(e: settlement__escrow_Escrow, f: settlement__escrow_Escrow)
  requires f.awards == e.awards && f.months == e.months && f.pending == e.pending
  ensures forall source :: settlement__escrow_awardFor(f, source) == settlement__escrow_awardFor(e, source)
  ensures forall source :: settlement__escrow_sourceFree(f, source) == settlement__escrow_sourceFree(e, source)
  ensures forall origin :: settlement__escrow_hasAwardOf(f, origin) == settlement__escrow_hasAwardOf(e, origin)
  ensures forall origin, period :: settlement__escrow_awardActorsFor(f, origin, period) == settlement__escrow_awardActorsFor(e, origin, period)
  ensures forall period :: settlement__escrow_monthFor(f, period) == settlement__escrow_monthFor(e, period)
{
}

// With the month, the leaves, the cursor and those escrow views unchanged, every rule of the composition holds again.
lemma MsEscrowOnlyFrame(s: MonthlySettlement, t: MonthlySettlement)
  requires inv(s)
  requires settlement__monthly_inv(t.month) && settlement__escrow_inv(t.escrow)
  requires t.month == s.month && t.leaves == s.leaves && t.cursor == s.cursor
  requires t.escrow.awards == s.escrow.awards && t.escrow.months == s.escrow.months && t.escrow.pending == s.escrow.pending && t.escrow.releasedLeaves == s.escrow.releasedLeaves
  ensures alwaysOneAwardPerObligation(t) && alwaysPoolWithinUnreserved(t) && alwaysAdmittedOnlyWhenFunded(t)
  ensures alwaysPoolOnlyWhenAdmitted(t) && alwaysPoolIsTheMonthRemainder(t) && alwaysCursorInRange(t)
  ensures alwaysReleasedMonthHasNoLeafAward(t) && alwaysPendingPoolIsExactlyUnreserved(t)
  ensures alwaysAdmittedLeavesUnconflicted(t) && alwaysUnreservedSourcesFreeWhilePooled(t)
  ensures alwaysLeafAwardsAreObligations(t) && alwaysCursorSourceBacked(t) && alwaysLeafAwardsReserveTheirObligation(t)
  ensures alwaysAdmittedLeavesNeverConflict(t) && alwaysObligationsMatchVault(t)
{
  MsEscrowViewsSame(s.escrow, t.escrow);
  assert admittedMonth(t) == admittedMonth(s);
  forall actor ensures sourceOf(t, actor) == sourceOf(s, actor) && obligationOf(t, actor) == obligationOf(s, actor)
    && chainHolds(t, actor) == chainHolds(s, actor) && chainMatches(t, actor) == chainMatches(s, actor)
    && chainPaid(t, actor) == chainPaid(s, actor) && obligationMatches(t, actor) == obligationMatches(s, actor)
    && leafAwardReserves(t, actor) == leafAwardReserves(s, actor) {
    assert settlement__escrow_awardFor(t.escrow, sourceOf(t, actor)) == settlement__escrow_awardFor(s.escrow, sourceOf(s, actor));
  }
  assert alwaysOneAwardPerObligation(s) && alwaysPoolWithinUnreserved(s) && alwaysAdmittedOnlyWhenFunded(s);
  assert alwaysPoolOnlyWhenAdmitted(s) && alwaysPoolIsTheMonthRemainder(s) && alwaysCursorInRange(s);
  assert alwaysReleasedMonthHasNoLeafAward(s) && alwaysPendingPoolIsExactlyUnreserved(s);
  assert alwaysAdmittedLeavesUnconflicted(s) && alwaysUnreservedSourcesFreeWhilePooled(s);
  assert alwaysLeafAwardsAreObligations(s) && alwaysCursorSourceBacked(s) && alwaysLeafAwardsReserveTheirObligation(s);
  assert alwaysAdmittedLeavesNeverConflict(s) && alwaysObligationsMatchVault(s);
}

lemma MsFilterEqAppend<T>(p: T -> bool, xs: seq<T>, x: T)
  ensures ProofLib.Filter(p, xs + [x]) == (if p(x) then ProofLib.Filter(p, xs) + [x] else ProofLib.Filter(p, xs))
  decreases |xs|
{
  if |xs| == 0 {
    assert xs + [x] == [x];
    ProofLib.FilterNil(p, xs);
    ProofLib.FilterCons(p, [x]);
    ProofLib.FilterNil(p, [x][1..]);
  } else {
    assert (xs + [x])[0] == xs[0] && (xs + [x])[1..] == xs[1..] + [x];
    ProofLib.FilterCons(p, xs);
    ProofLib.FilterCons(p, xs + [x]);
    MsFilterEqAppend(p, xs[1..], x);
  }
}

lemma MsWithAwardFacts(e: settlement__escrow_Escrow, nw: settlement__escrow_Award, e2: settlement__escrow_Escrow)
  requires settlement__escrow_sourceFree(e, nw.source)
  requires e2.awards == e.awards + [nw]
  ensures forall k :: k != nw.source ==> settlement__escrow_awardFor(e2, k) == settlement__escrow_awardFor(e, k) && settlement__escrow_sourceFree(e2, k) == settlement__escrow_sourceFree(e, k)
  ensures settlement__escrow_awardFor(e2, nw.source) == nw && !settlement__escrow_sourceFree(e2, nw.source)
  ensures forall origin, period, a :: a in settlement__escrow_awardActorsFor(e2, origin, period) <==> (a in settlement__escrow_awardActorsFor(e, origin, period) || (nw.source.origin == origin && nw.source.period == period && a == nw.source.actor))
  ensures forall o :: settlement__escrow_hasAwardOf(e2, o) <==> (settlement__escrow_hasAwardOf(e, o) || nw.origin == o)
{
  forall k ensures (k != nw.source ==> settlement__escrow_awardFor(e2, k) == settlement__escrow_awardFor(e, k) && settlement__escrow_sourceFree(e2, k) == settlement__escrow_sourceFree(e, k)) {
    if k != nw.source {
      var pk := (a: settlement__escrow_Award) => (a.source == k);
      MsFilterEqAppend(pk, e.awards, nw);
      assert !pk(nw);
    }
  }
  var pnw := (a: settlement__escrow_Award) => (a.source == nw.source);
  ProofLib.FilterNone(pnw, e.awards);
  MsFilterEqAppend(pnw, e.awards, nw);
  assert ProofLib.Filter(pnw, e2.awards) == [nw];
  forall origin, period, a ensures a in settlement__escrow_awardActorsFor(e2, origin, period) <==> (a in settlement__escrow_awardActorsFor(e, origin, period) || (nw.source.origin == origin && nw.source.period == period && a == nw.source.actor)) {
    var pf := (x: settlement__escrow_Award) => (x.source.origin == origin && x.source.period == period);
    MsFilterEqAppend(pf, e.awards, nw);
    var xs1 := ProofLib.Filter(pf, e.awards);
    var xs2 := ProofLib.Filter(pf, e2.awards);
    if a in settlement__escrow_awardActorsFor(e2, origin, period) {
      var i :| 0 <= i < |xs2| && xs2[i].source.actor == a;
      if i < |xs1| {
        assert settlement__escrow_awardActorsFor(e, origin, period)[i] == a;
      }
    }
    if a in settlement__escrow_awardActorsFor(e, origin, period) {
      var i :| 0 <= i < |xs1| && xs1[i].source.actor == a;
      assert xs2[i] == xs1[i];
      assert settlement__escrow_awardActorsFor(e2, origin, period)[i] == a;
    }
    if nw.source.origin == origin && nw.source.period == period && a == nw.source.actor {
      assert xs2[|xs1|] == nw;
      assert settlement__escrow_awardActorsFor(e2, origin, period)[|xs1|] == a;
    }
  }
  forall o ensures settlement__escrow_hasAwardOf(e2, o) <==> (settlement__escrow_hasAwardOf(e, o) || nw.origin == o) {
    if settlement__escrow_hasAwardOf(e, o) {
      var a :| a in e.awards && a.origin == o;
      assert a in e2.awards;
    }
    if nw.origin == o {
      assert nw in e2.awards;
    }
  }
}

lemma MsFilterCommute<T>(p: T -> bool, q: T -> bool, xs: seq<T>)
  requires forall x :: x in xs && p(x) ==> q(x)
  ensures ProofLib.Filter(p, ProofLib.Filter(q, xs)) == ProofLib.Filter(p, xs)
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(q, xs);
    ProofLib.FilterNil(p, xs);
  } else {
    ProofLib.FilterCons(q, xs);
    ProofLib.FilterCons(p, xs);
    assert xs[0] in xs;
    assert forall y :: y in xs[1..] ==> y in xs;
    MsFilterCommute(p, q, xs[1..]);
    var rest := ProofLib.Filter(q, xs[1..]);
    if q(xs[0]) {
      assert ProofLib.Filter(q, xs) == [xs[0]] + rest;
      assert ([xs[0]] + rest)[0] == xs[0] && ([xs[0]] + rest)[1..] == rest;
      ProofLib.FilterCons(p, [xs[0]] + rest);
    } else {
      assert !p(xs[0]);
      assert ProofLib.Filter(q, xs) == rest;
    }
  }
}

lemma MsPayAwardOther(e: settlement__escrow_Escrow, source: settlement__escrow_SourceKey, binding: settlement__escrow_PayableBinding, ev: settlement__escrow_ChainEvent)
  requires settlement__escrow_alwaysAwards(e) && settlement__escrow_canPay(e, source, binding, ev)
  ensures var e2 := settlement__escrow_pay(e, source, binding, ev);
    forall k :: k != source ==> settlement__escrow_awardFor(e2, k) == settlement__escrow_awardFor(e, k) && settlement__escrow_sourceFree(e2, k) == settlement__escrow_sourceFree(e, k)
{
  var e2 := settlement__escrow_pay(e, source, binding, ev);
  var a0 := settlement__escrow_awardFor(e, source);
  var paid := settlement__escrow_markPaid(a0, binding.destination, binding.version, ev.transaction);
  var keep := (a: settlement__escrow_Award) => (a.source != source);
  var kept := ProofLib.Filter(keep, e.awards);
  assert e2.awards == kept + [paid];
  var ps := (a: settlement__escrow_Award) => (a.source == source);
  var matches := ProofLib.Filter(ps, e.awards);
  assert 0 < |matches|;
  ProofLib.FilterMember(ps, e.awards, matches[0]);
  assert a0 in e.awards && a0.source == source && paid.source == source;
  forall x ensures x in kept <==> x in e.awards && x.source != source {
    ProofLib.FilterMember(keep, e.awards, x);
  }
  forall k | k != source ensures settlement__escrow_awardFor(e2, k) == settlement__escrow_awardFor(e, k) && settlement__escrow_sourceFree(e2, k) == settlement__escrow_sourceFree(e, k) {
    var pk := (a: settlement__escrow_Award) => (a.source == k);
    MsFilterEqAppend(pk, kept, paid);
    MsFilterCommute(pk, keep, e.awards);
    assert ProofLib.Filter(pk, e2.awards) == ProofLib.Filter(pk, e.awards);
  }
}

lemma MsPayAwardSelfOnly(e: settlement__escrow_Escrow, source: settlement__escrow_SourceKey, binding: settlement__escrow_PayableBinding, ev: settlement__escrow_ChainEvent)
  requires settlement__escrow_alwaysAwards(e) && settlement__escrow_canPay(e, source, binding, ev)
  ensures var e2 := settlement__escrow_pay(e, source, binding, ev);
    !settlement__escrow_sourceFree(e, source)
    && !settlement__escrow_sourceFree(e2, source)
    && settlement__escrow_awardFor(e2, source).paid
    && settlement__escrow_awardFor(e2, source).actor == settlement__escrow_awardFor(e, source).actor
    && settlement__escrow_awardFor(e2, source).gross == settlement__escrow_awardFor(e, source).gross
    && settlement__escrow_awardFor(e2, source).origin == settlement__escrow_awardFor(e, source).origin
{
  var e2 := settlement__escrow_pay(e, source, binding, ev);
  var a0 := settlement__escrow_awardFor(e, source);
  var paid := settlement__escrow_markPaid(a0, binding.destination, binding.version, ev.transaction);
  var keep := (a: settlement__escrow_Award) => (a.source != source);
  var kept := ProofLib.Filter(keep, e.awards);
  assert e2.awards == kept + [paid];
  var ps := (a: settlement__escrow_Award) => (a.source == source);
  var matches := ProofLib.Filter(ps, e.awards);
  assert 0 < |matches|;
  ProofLib.FilterMember(ps, e.awards, matches[0]);
  assert a0 in e.awards && a0.source == source && paid.source == source;
  forall x ensures x in kept <==> x in e.awards && x.source != source {
    ProofLib.FilterMember(keep, e.awards, x);
  }
  ProofLib.FilterNone(ps, kept);
  MsFilterEqAppend(ps, kept, paid);
  assert ProofLib.Filter(ps, e2.awards) == [paid];
  assert paid in e2.awards;
}

lemma MsPayAwardHasOrigin(e: settlement__escrow_Escrow, source: settlement__escrow_SourceKey, binding: settlement__escrow_PayableBinding, ev: settlement__escrow_ChainEvent)
  requires settlement__escrow_alwaysAwards(e) && settlement__escrow_canPay(e, source, binding, ev)
  ensures var e2 := settlement__escrow_pay(e, source, binding, ev);
    forall o :: settlement__escrow_hasAwardOf(e2, o) == settlement__escrow_hasAwardOf(e, o)
{
  hide *;
  reveal settlement__escrow_pay, settlement__escrow_markPaid, settlement__escrow_hasAwardOf, settlement__escrow_awardFor, settlement__escrow_noAward, settlement__escrow_noSource, settlement__escrow_validSource, settlement__escrow_canPay, settlement__escrow_sourceFree, ProofLib.Filter, ProofLib.DistinctBy;
  MsAwardsDistinct(e);
  var e2 := settlement__escrow_pay(e, source, binding, ev);
  var a0 := settlement__escrow_awardFor(e, source);
  var paid := settlement__escrow_markPaid(a0, binding.destination, binding.version, ev.transaction);
  var keep := (a: settlement__escrow_Award) => (a.source != source);
  var kept := ProofLib.Filter(keep, e.awards);
  assert e2.awards == kept + [paid];
  var ps := (a: settlement__escrow_Award) => (a.source == source);
  var matches := ProofLib.Filter(ps, e.awards);
  assert 0 < |matches|;
  ProofLib.FilterMember(ps, e.awards, matches[0]);
  assert a0 in e.awards && a0.source == source && paid.source == source && paid.origin == a0.origin;
  var ia :| 0 <= ia < |e.awards| && e.awards[ia] == a0;
  forall x ensures x in kept <==> x in e.awards && x.source != source {
    ProofLib.FilterMember(keep, e.awards, x);
  }
  forall o ensures settlement__escrow_hasAwardOf(e2, o) == settlement__escrow_hasAwardOf(e, o) {
    if settlement__escrow_hasAwardOf(e2, o) {
      var x :| x in e2.awards && x.origin == o;
      if x == paid { assert a0 in e.awards && a0.origin == o; }
      else { assert x in e.awards; }
    }
    if settlement__escrow_hasAwardOf(e, o) {
      var x :| x in e.awards && x.origin == o;
      if x.source == source {
        var ix :| 0 <= ix < |e.awards| && e.awards[ix] == x;
        assert ix == ia && x == a0;
        assert paid in e2.awards && paid.origin == o;
      } else {
        assert x in kept && x in e2.awards;
      }
    }
  }
}

lemma MsPayAwardSelf(e: settlement__escrow_Escrow, source: settlement__escrow_SourceKey, binding: settlement__escrow_PayableBinding, ev: settlement__escrow_ChainEvent)
  requires settlement__escrow_alwaysAwards(e) && settlement__escrow_canPay(e, source, binding, ev)
  ensures var e2 := settlement__escrow_pay(e, source, binding, ev);
    !settlement__escrow_sourceFree(e, source)
    && !settlement__escrow_sourceFree(e2, source)
    && settlement__escrow_awardFor(e2, source).paid
    && settlement__escrow_awardFor(e2, source).actor == settlement__escrow_awardFor(e, source).actor
    && settlement__escrow_awardFor(e2, source).gross == settlement__escrow_awardFor(e, source).gross
    && settlement__escrow_awardFor(e2, source).origin == settlement__escrow_awardFor(e, source).origin
    && (forall o :: settlement__escrow_hasAwardOf(e2, o) == settlement__escrow_hasAwardOf(e, o))
{
  hide *;
  MsPayAwardSelfOnly(e, source, binding, ev);
  MsPayAwardHasOrigin(e, source, binding, ev);
}

lemma MsPayAwardCore(e: settlement__escrow_Escrow, source: settlement__escrow_SourceKey, binding: settlement__escrow_PayableBinding, ev: settlement__escrow_ChainEvent)
  requires settlement__escrow_alwaysAwards(e) && settlement__escrow_canPay(e, source, binding, ev)
  ensures var e2 := settlement__escrow_pay(e, source, binding, ev);
    (forall k :: settlement__escrow_sourceFree(e2, k) == settlement__escrow_sourceFree(e, k))
    && (forall k :: k != source ==> settlement__escrow_awardFor(e2, k) == settlement__escrow_awardFor(e, k))
    && !settlement__escrow_sourceFree(e2, source)
    && settlement__escrow_awardFor(e2, source).paid
    && settlement__escrow_awardFor(e2, source).actor == settlement__escrow_awardFor(e, source).actor
    && settlement__escrow_awardFor(e2, source).gross == settlement__escrow_awardFor(e, source).gross
    && settlement__escrow_awardFor(e2, source).origin == settlement__escrow_awardFor(e, source).origin
    && (forall o :: settlement__escrow_hasAwardOf(e2, o) == settlement__escrow_hasAwardOf(e, o))
{
  hide *;
  MsPayAwardOther(e, source, binding, ev);
  MsPayAwardSelf(e, source, binding, ev);
}

lemma MsPayAwardActors(e: settlement__escrow_Escrow, source: settlement__escrow_SourceKey, binding: settlement__escrow_PayableBinding, ev: settlement__escrow_ChainEvent)
  requires settlement__escrow_alwaysAwards(e) && settlement__escrow_canPay(e, source, binding, ev)
  ensures var e2 := settlement__escrow_pay(e, source, binding, ev);
    forall origin, period, a :: a in settlement__escrow_awardActorsFor(e2, origin, period) <==> a in settlement__escrow_awardActorsFor(e, origin, period)
{
  var e2 := settlement__escrow_pay(e, source, binding, ev);
  var a0 := settlement__escrow_awardFor(e, source);
  var paid := settlement__escrow_markPaid(a0, binding.destination, binding.version, ev.transaction);
  var keep := (a: settlement__escrow_Award) => (a.source != source);
  var kept := ProofLib.Filter(keep, e.awards);
  assert e2.awards == kept + [paid];
  var ps := (a: settlement__escrow_Award) => (a.source == source);
  var matches := ProofLib.Filter(ps, e.awards);
  assert 0 < |matches|;
  ProofLib.FilterMember(ps, e.awards, matches[0]);
  assert a0 in e.awards && a0.source == source && paid.source == source;
  forall x ensures x in kept <==> x in e.awards && x.source != source {
    ProofLib.FilterMember(keep, e.awards, x);
  }
  forall origin, period, a ensures a in settlement__escrow_awardActorsFor(e2, origin, period) <==> a in settlement__escrow_awardActorsFor(e, origin, period) {
    var pf := (x: settlement__escrow_Award) => (x.source.origin == origin && x.source.period == period);
    var xs1 := ProofLib.Filter(pf, e.awards);
    var xs2 := ProofLib.Filter(pf, e2.awards);
    if a in settlement__escrow_awardActorsFor(e2, origin, period) {
      var i :| 0 <= i < |xs2| && xs2[i].source.actor == a;
      ProofLib.FilterMember(pf, e2.awards, xs2[i]);
      if xs2[i] == paid {
        ProofLib.FilterMember(pf, e.awards, a0);
        var j :| 0 <= j < |xs1| && xs1[j] == a0;
        assert settlement__escrow_awardActorsFor(e, origin, period)[j] == a;
      } else {
        ProofLib.FilterMember(pf, e.awards, xs2[i]);
        var j :| 0 <= j < |xs1| && xs1[j] == xs2[i];
        assert settlement__escrow_awardActorsFor(e, origin, period)[j] == a;
      }
    }
    if a in settlement__escrow_awardActorsFor(e, origin, period) {
      var i :| 0 <= i < |xs1| && xs1[i].source.actor == a;
      ProofLib.FilterMember(pf, e.awards, xs1[i]);
      if xs1[i].source == source {
        ProofLib.FilterMember(pf, e2.awards, paid);
        var j :| 0 <= j < |xs2| && xs2[j] == paid;
        assert settlement__escrow_awardActorsFor(e2, origin, period)[j] == a;
      } else {
        ProofLib.FilterMember(pf, e2.awards, xs1[i]);
        var j :| 0 <= j < |xs2| && xs2[j] == xs1[i];
        assert settlement__escrow_awardActorsFor(e2, origin, period)[j] == a;
      }
    }
  }
}

lemma MsPayAwardFacts(e: settlement__escrow_Escrow, source: settlement__escrow_SourceKey, binding: settlement__escrow_PayableBinding, ev: settlement__escrow_ChainEvent)
  requires settlement__escrow_alwaysAwards(e) && settlement__escrow_canPay(e, source, binding, ev)
  ensures var e2 := settlement__escrow_pay(e, source, binding, ev);
    (forall k :: settlement__escrow_sourceFree(e2, k) == settlement__escrow_sourceFree(e, k))
    && (forall k :: k != source ==> settlement__escrow_awardFor(e2, k) == settlement__escrow_awardFor(e, k))
    && !settlement__escrow_sourceFree(e2, source)
    && settlement__escrow_awardFor(e2, source).paid
    && settlement__escrow_awardFor(e2, source).actor == settlement__escrow_awardFor(e, source).actor
    && settlement__escrow_awardFor(e2, source).gross == settlement__escrow_awardFor(e, source).gross
    && settlement__escrow_awardFor(e2, source).origin == settlement__escrow_awardFor(e, source).origin
    && (forall origin, period, a :: a in settlement__escrow_awardActorsFor(e2, origin, period) <==> a in settlement__escrow_awardActorsFor(e, origin, period))
    && (forall o :: settlement__escrow_hasAwardOf(e2, o) == settlement__escrow_hasAwardOf(e, o))
{
  hide *;
  MsPayAwardCore(e, source, binding, ev);
  MsPayAwardActors(e, source, binding, ev);
}

lemma MsFilterObligationsEq(xs: seq<settlement__monthly_Obligation>, ys: seq<settlement__monthly_Obligation>, a: int)
  requires |ys| == |xs|
  requires forall i :: 0 <= i < |xs| ==> (ys[i].actor == xs[i].actor && (xs[i].actor == a ==> ys[i] == xs[i]))
  ensures ProofLib.Filter((o: settlement__monthly_Obligation) => (o.actor == a), ys) == ProofLib.Filter((o: settlement__monthly_Obligation) => (o.actor == a), xs)
  decreases |xs|
{
  var p := (o: settlement__monthly_Obligation) => (o.actor == a);
  if |xs| == 0 {
    ProofLib.FilterNil(p, xs);
    ProofLib.FilterNil(p, ys);
  } else {
    ProofLib.FilterCons(p, xs);
    ProofLib.FilterCons(p, ys);
    MsFilterObligationsEq(xs[1..], ys[1..], a);
  }
}

lemma MsObligationUpdated(m: settlement__monthly_Monthly, m2: settlement__monthly_Monthly, w: int, q: settlement__monthly_ObligationState)
  requires settlement__monthly_alwaysObligationsMatchShares(m) && settlement__monthly_alwaysObligationsMatchShares(m2)
  requires m2.project == m.project && m2.period == m.period && |m2.obligations| == |m.obligations|
  requires forall i :: 0 <= i < |m.obligations| ==> m2.obligations[i] == (if m.obligations[i].actor == w then m.obligations[i].(progress := q) else m.obligations[i])
  ensures settlement__monthly_obligationActors(m2) == settlement__monthly_obligationActors(m)
  ensures forall a :: a != w ==> settlement__monthly_obligationFor(m2, a) == settlement__monthly_obligationFor(m, a)
  ensures settlement__monthly_obligationFor(m, w).actor > 0 ==> settlement__monthly_obligationFor(m2, w) == settlement__monthly_obligationFor(m, w).(progress := q)
  ensures (!settlement__monthly_obligationFor(m, w).progress.Created? && !q.Created?) ==> settlement__monthly_createdTotal(m2) == settlement__monthly_createdTotal(m)
{
  forall a | a != w ensures settlement__monthly_obligationFor(m2, a) == settlement__monthly_obligationFor(m, a) {
    MsFilterObligationsEq(m.obligations, m2.obligations, a);
  }
  if settlement__monthly_obligationFor(m, w).actor > 0 {
    var o := settlement__monthly_obligationFor(m, w);
    MsListed(m, w);
    MsFoundActor(m, w);
    var i :| 0 <= i < |m.obligations| && m.obligations[i] == o;
    assert m2.obligations[i] == o.(progress := q);
    MsTheObligation(m2, m2.obligations[i]);
  }
  if !settlement__monthly_obligationFor(m, w).progress.Created? && !q.Created? {
    forall i | 0 <= i < |m.obligations| ensures (if m2.obligations[i].progress.Created? then m2.obligations[i].amount else settlement__money_zero) == (if m.obligations[i].progress.Created? then m.obligations[i].amount else settlement__money_zero) {
      if m.obligations[i].actor == w {
        MsTheObligation(m, m.obligations[i]);
      }
    }
    ProofLib.FoldLeftPointwise((sum: settlement__money_Amount, o: settlement__monthly_Obligation) => settlement__money_addAmounts(sum, (if o.progress.Created? then o.amount else settlement__money_zero)),
      (sum: settlement__money_Amount, o: settlement__monthly_Obligation) => settlement__money_addAmounts(sum, (if o.progress.Created? then o.amount else settlement__money_zero)),
      settlement__money_zero, m2.obligations, m.obligations);
  }
}

lemma MsFoldCreatedShift(obs: seq<settlement__monthly_Obligation>, a: seq<int>, b: seq<int>)
  requires settlement__money_validAmount(a) && settlement__money_validAmount(b)
  requires forall o :: o in obs ==> settlement__money_validAmount(o.amount)
  ensures var f := (sum: settlement__money_Amount, o: settlement__monthly_Obligation) => settlement__money_addAmounts(sum, (if o.progress.Created? then o.amount else settlement__money_zero));
    settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(f, settlement__money_addAmounts(a, b), obs), settlement__money_addAmounts(Std.Collections.Seq.FoldLeft(f, a, obs), b))
  decreases |obs|
{
  var f := (sum: settlement__money_Amount, o: settlement__monthly_Obligation) => settlement__money_addAmounts(sum, (if o.progress.Created? then o.amount else settlement__money_zero));
  settlement__money_lawAdditionValid_ensures(a, b);
  if |obs| == 0 {
    settlement__money_lawEqualReflexive_ensures(settlement__money_addAmounts(a, b));
  } else {
    var t := if obs[0].progress.Created? then obs[0].amount else settlement__money_zero;
    assert obs[0] in obs && settlement__money_validAmount(t);
    assert forall o :: o in obs[1..] ==> o in obs;
    settlement__money_lawAdditionValid_ensures(a, t);
    settlement__money_lawAdditionValid_ensures(settlement__money_addAmounts(a, b), t);
    settlement__money_lawAdditionValid_ensures(settlement__money_addAmounts(a, t), b);
    settlement__money_lawAdditionValid_ensures(b, t);
    settlement__money_lawAdditionValid_ensures(a, settlement__money_addAmounts(b, t));
    settlement__money_lawAddAssociative_ensures(a, b, t);
    settlement__money_lawAddCommutative_ensures(b, t);
    settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(b, t), settlement__money_addAmounts(t, b), a);
    settlement__money_lawAddCommutative_ensures(a, settlement__money_addAmounts(b, t));
    settlement__money_lawAddCommutative_ensures(a, settlement__money_addAmounts(t, b));
    settlement__money_lawAddAssociative_ensures(a, t, b);
    MsFoldCreatedShift(obs[1..], settlement__money_addAmounts(a, t), b);
    var lhs := settlement__money_addAmounts(settlement__money_addAmounts(a, b), t);
    var rhs := settlement__money_addAmounts(settlement__money_addAmounts(a, t), b);
    settlement__money_lawEqualOrder_ensures(lhs, settlement__money_addAmounts(a, settlement__money_addAmounts(b, t)), rhs);
    settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(a, settlement__money_addAmounts(b, t)), settlement__money_addAmounts(settlement__money_addAmounts(b, t), a), rhs);
    settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(settlement__money_addAmounts(b, t), a), settlement__money_addAmounts(settlement__money_addAmounts(t, b), a), rhs);
    settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(settlement__money_addAmounts(t, b), a), settlement__money_addAmounts(a, settlement__money_addAmounts(t, b)), rhs);
    settlement__money_lawEqualSymmetric_ensures(rhs, settlement__money_addAmounts(a, settlement__money_addAmounts(t, b)));
    settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(a, settlement__money_addAmounts(t, b)), rhs, rhs);
    settlement__money_lawEqualReflexive_ensures(rhs);
    assert settlement__money_equalAmounts(lhs, rhs);
    MsFoldCreatedCongruence(obs[1..], lhs, rhs);
    var v1 := Std.Collections.Seq.FoldLeft(f, lhs, obs[1..]);
    var v2 := Std.Collections.Seq.FoldLeft(f, rhs, obs[1..]);
    var v3 := settlement__money_addAmounts(Std.Collections.Seq.FoldLeft(f, settlement__money_addAmounts(a, t), obs[1..]), b);
    MsCreatedValid(obs[1..], lhs);
    MsCreatedValid(obs[1..], rhs);
    MsCreatedValid(obs[1..], settlement__money_addAmounts(a, t));
    settlement__money_lawAdditionValid_ensures(Std.Collections.Seq.FoldLeft(f, settlement__money_addAmounts(a, t), obs[1..]), b);
    settlement__money_lawEqualOrder_ensures(v1, v2, v3);
    settlement__money_lawEqualReflexive_ensures(v3);
  }
}

lemma MsFoldCreatedCongruence(obs: seq<settlement__monthly_Obligation>, a: seq<int>, b: seq<int>)
  requires settlement__money_validAmount(a) && settlement__money_validAmount(b) && settlement__money_equalAmounts(a, b)
  requires forall o :: o in obs ==> settlement__money_validAmount(o.amount)
  ensures var f := (sum: settlement__money_Amount, o: settlement__monthly_Obligation) => settlement__money_addAmounts(sum, (if o.progress.Created? then o.amount else settlement__money_zero));
    settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(f, a, obs), Std.Collections.Seq.FoldLeft(f, b, obs))
  decreases |obs|
{
  if |obs| > 0 {
    var t := if obs[0].progress.Created? then obs[0].amount else settlement__money_zero;
    assert obs[0] in obs && settlement__money_validAmount(t);
    assert forall o :: o in obs[1..] ==> o in obs;
    settlement__money_lawAdditionValid_ensures(a, t);
    settlement__money_lawAdditionValid_ensures(b, t);
    settlement__money_lawAddCongruence_ensures(a, b, t);
    MsFoldCreatedCongruence(obs[1..], settlement__money_addAmounts(a, t), settlement__money_addAmounts(b, t));
  }
}

lemma MsCreatedTotalShrinks(obs: seq<settlement__monthly_Obligation>, obs2: seq<settlement__monthly_Obligation>, idx: int, acc: seq<int>)
  requires 0 <= idx < |obs| && |obs2| == |obs|
  requires settlement__money_validAmount(acc)
  requires forall o :: o in obs ==> settlement__money_validAmount(o.amount)
  requires obs[idx].progress.Created? && !obs2[idx].progress.Created? && obs2[idx].amount == obs[idx].amount
  requires forall i :: 0 <= i < |obs| && i != idx ==> obs2[i] == obs[i]
  ensures var f := (sum: settlement__money_Amount, o: settlement__monthly_Obligation) => settlement__money_addAmounts(sum, (if o.progress.Created? then o.amount else settlement__money_zero));
    settlement__money_equalAmounts(settlement__money_addAmounts(Std.Collections.Seq.FoldLeft(f, acc, obs2), obs[idx].amount), Std.Collections.Seq.FoldLeft(f, acc, obs))
  decreases |obs|
{
  var f := (sum: settlement__money_Amount, o: settlement__monthly_Obligation) => settlement__money_addAmounts(sum, (if o.progress.Created? then o.amount else settlement__money_zero));
  assert forall o :: o in obs[1..] ==> o in obs;
  assert forall o :: o in obs2 ==> settlement__money_validAmount(o.amount);
  assert forall o :: o in obs2[1..] ==> o in obs2;
  assert obs[0] in obs && obs[idx] in obs;
  if idx == 0 {
    var amt := obs[0].amount;
    settlement__money_lawZeroIdentity_ensures(acc);
    settlement__money_lawAdditionValid_ensures(acc, settlement__money_zero);
    settlement__money_lawAdditionValid_ensures(acc, amt);
    MsFoldCreatedCongruence(obs[1..], settlement__money_addAmounts(acc, settlement__money_zero), acc);
    assert obs2[1..] == obs[1..];
    MsFoldCreatedShift(obs[1..], acc, amt);
    var s0 := Std.Collections.Seq.FoldLeft(f, settlement__money_addAmounts(acc, settlement__money_zero), obs[1..]);
    var s1 := Std.Collections.Seq.FoldLeft(f, acc, obs[1..]);
    var s2 := Std.Collections.Seq.FoldLeft(f, settlement__money_addAmounts(acc, amt), obs[1..]);
    MsCreatedValid(obs[1..], settlement__money_addAmounts(acc, settlement__money_zero));
    MsCreatedValid(obs[1..], acc);
    MsCreatedValid(obs[1..], settlement__money_addAmounts(acc, amt));
    settlement__money_lawAdditionValid_ensures(s0, amt);
    settlement__money_lawAdditionValid_ensures(s1, amt);
    settlement__money_lawAddCongruence_ensures(s0, s1, amt);
    settlement__money_lawEqualSymmetric_ensures(s2, settlement__money_addAmounts(s1, amt));
    settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(s0, amt), settlement__money_addAmounts(s1, amt), s2);
    settlement__money_lawEqualReflexive_ensures(s2);
  } else {
    var t := if obs[0].progress.Created? then obs[0].amount else settlement__money_zero;
    settlement__money_lawAdditionValid_ensures(acc, t);
    MsCreatedTotalShrinks(obs[1..], obs2[1..], idx - 1, settlement__money_addAmounts(acc, t));
  }
}

lemma MsUniqueAdmittedMonth(s: MonthlySettlement)
  requires alwaysAdmittedOnlyWhenFunded(s) && settlement__escrow_alwaysMonths(s.escrow)
  requires settlement__escrow_monthFor(s.escrow, s.month.period).period > 0
  ensures |s.escrow.months| == 1 && s.escrow.months[0].period == s.month.period && admittedMonth(s) == s.escrow.months[0]
{
  var p := (m: settlement__escrow_MonthReserve) => (m.period == s.month.period);
  var kept := ProofLib.Filter(p, s.escrow.months);
  assert 0 < |kept|;
  ProofLib.FilterMember(p, s.escrow.months, kept[0]);
  assert |s.escrow.months| > 0;
  assert s.escrow.months[0] in s.escrow.months;
  assert s.escrow.months[0].period == s.month.period;
  if |s.escrow.months| > 1 {
    assert s.escrow.months[1] in s.escrow.months && s.escrow.months[1].period == s.month.period;
    ProofLib.FilterCountOneIffUnique(p, s.escrow.months, (m: settlement__escrow_MonthReserve) => m.period, 0);
  }
  MsMonthIs(s.escrow, 0);
}

lemma MsNoAdmittedMonth(s: MonthlySettlement)
  requires alwaysAdmittedOnlyWhenFunded(s)
  requires !settlement__escrow_hasMonth(s.escrow, s.month.period)
  ensures |s.escrow.months| == 0 && admittedMonth(s) == settlement__escrow_noMonth
{
  if |s.escrow.months| > 0 {
    assert s.escrow.months[0] in s.escrow.months;
    assert s.escrow.months[0].period == s.month.period;
  } else {
    MsNoMonth(s.escrow, s.month.period);
  }
}

lemma MsMaterializeArith(pending: seq<int>, r: seq<int>, ct: seq<int>, ct2: seq<int>, oAmt: seq<int>, gross: seq<int>)
  requires settlement__money_validAmount(pending) && settlement__money_validAmount(r)
  requires settlement__money_validAmount(ct) && settlement__money_validAmount(ct2)
  requires settlement__money_validAmount(oAmt) && settlement__money_validAmount(gross)
  requires settlement__money_compareAmounts(r, gross) >= 0 && settlement__money_compareAmounts(pending, gross) >= 0
  requires settlement__money_equalAmounts(pending, r)
  requires settlement__money_equalAmounts(r, ct)
  requires settlement__money_equalAmounts(gross, oAmt)
  requires settlement__money_equalAmounts(settlement__money_addAmounts(ct2, oAmt), ct)
  ensures settlement__money_equalAmounts(settlement__money_subtractAmounts(pending, gross), settlement__money_subtractAmounts(r, gross))
  ensures settlement__money_equalAmounts(settlement__money_subtractAmounts(r, gross), ct2)
{
  var r2 := settlement__money_subtractAmounts(r, gross);
  settlement__money_lawSubtractCongruence_ensures(pending, r, gross);
  settlement__money_lawSubtractionValid_ensures(r, gross);
  settlement__money_lawSubtractionReconstructs_ensures(r, gross);
  settlement__money_lawAdditionValid_ensures(r2, gross);
  settlement__money_lawAdditionValid_ensures(ct2, oAmt);
  settlement__money_lawAdditionValid_ensures(ct2, gross);
  settlement__money_lawAddCommutative_ensures(ct2, oAmt);
  settlement__money_lawAddCommutative_ensures(ct2, gross);
  settlement__money_lawAddCongruence_ensures(gross, oAmt, ct2);
  settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(ct2, oAmt), ct);
  settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(gross, ct2), settlement__money_addAmounts(ct2, gross));
  settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(oAmt, ct2), settlement__money_addAmounts(ct2, oAmt));
  settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(ct2, oAmt), settlement__money_addAmounts(ct2, gross));
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(r2, gross), r, ct);
  settlement__money_lawEqualOrder_ensures(r, ct, settlement__money_addAmounts(ct2, oAmt));
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(r2, gross), ct, settlement__money_addAmounts(ct2, oAmt));
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(ct2, gross), settlement__money_addAmounts(gross, ct2), settlement__money_addAmounts(oAmt, ct2));
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(gross, ct2), settlement__money_addAmounts(oAmt, ct2), settlement__money_addAmounts(ct2, oAmt));
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(ct2, gross), settlement__money_addAmounts(oAmt, ct2), settlement__money_addAmounts(ct2, oAmt));
  settlement__money_lawEqualReflexive_ensures(settlement__money_addAmounts(ct2, oAmt));
  assert settlement__money_equalAmounts(settlement__money_addAmounts(ct2, gross), settlement__money_addAmounts(ct2, oAmt));
  settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(ct2, gross), settlement__money_addAmounts(ct2, oAmt));
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(r2, gross), settlement__money_addAmounts(ct2, oAmt), settlement__money_addAmounts(ct2, gross));
  settlement__money_lawEqualReflexive_ensures(settlement__money_addAmounts(ct2, gross));
  assert settlement__money_equalAmounts(settlement__money_addAmounts(r2, gross), settlement__money_addAmounts(ct2, gross));
  settlement__money_lawAddOrder_ensures(r2, ct2, gross);
}

lemma MsMaterializeCreated(m: settlement__monthly_Monthly, m2: settlement__monthly_Monthly, actor: int)
  requires settlement__monthly_alwaysAllocationConserved(m) && settlement__monthly_alwaysObligationsMatchShares(m)
  requires settlement__monthly_alwaysAllocationConserved(m2) && settlement__monthly_alwaysObligationsMatchShares(m2)
  requires settlement__monthly_obligationFor(m, actor).actor > 0
  requires settlement__monthly_obligationFor(m, actor).progress.Created?
  requires |m2.obligations| == |m.obligations|
  requires forall i :: 0 <= i < |m.obligations| ==> m2.obligations[i] == (if m.obligations[i].actor == actor then m.obligations[i].(progress := settlement__monthly_ObligationState.Reserved) else m.obligations[i])
  ensures settlement__money_validAmount(settlement__monthly_createdTotal(m))
  ensures settlement__money_validAmount(settlement__monthly_createdTotal(m2))
  ensures settlement__money_validAmount(settlement__monthly_obligationFor(m, actor).amount)
  ensures settlement__money_equalAmounts(settlement__money_addAmounts(settlement__monthly_createdTotal(m2), settlement__monthly_obligationFor(m, actor).amount), settlement__monthly_createdTotal(m))
{
  var o := settlement__monthly_obligationFor(m, actor);
  MsListed(m, actor);
  MsFoundActor(m, actor);
  var idx :| 0 <= idx < |m.obligations| && m.obligations[idx] == o;
  forall i | 0 <= i < |m.obligations| && i != idx ensures m2.obligations[i] == m.obligations[i] {
    if m.obligations[i].actor == actor {
      MsTheObligation(m, m.obligations[i]);
      ProofLib.FilterCountOneIffUnique((x: settlement__monthly_Obligation) => (x.actor == actor), m.obligations, (x: settlement__monthly_Obligation) => x.actor, idx);
    }
  }
  MsAmountsValid(m);
  MsAmountsValid(m2);
  MsCreatedValid(m.obligations, settlement__money_zero);
  MsCreatedValid(m2.obligations, settlement__money_zero);
  MsCreatedTotalShrinks(m.obligations, m2.obligations, idx, settlement__money_zero);
}

lemma MsMaterializeRemaining(s: MonthlySettlement, proof: settlement__escrow_LeafProof, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canMaterialize(s, proof, ev)
  requires settlement__monthly_inv(materialize(s, proof, ev).month) && settlement__escrow_inv(materialize(s, proof, ev).escrow)
  ensures var after := materialize(s, proof, ev);
    |s.escrow.months| == 1 && |after.escrow.months| == 1
    && admittedMonth(after) == after.escrow.months[0]
    && admittedMonth(after).remaining == settlement__money_subtractAmounts(admittedMonth(s).remaining, proof.gross)
    && admittedMonth(after).released == admittedMonth(s).released
    && admittedMonth(after).root == admittedMonth(s).root
    && admittedMonth(after).leafCount == admittedMonth(s).leafCount
    && settlement__money_equalAmounts(after.escrow.pending, admittedMonth(after).remaining)
    && settlement__money_equalAmounts(admittedMonth(after).remaining, settlement__monthly_createdTotal(after.month))
{
  hide inv, alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := materialize(s, proof, ev);
  MsPoolInvs(s);
  MsMonthsInv(s);
  MsEscrowMonths(after.escrow);
  MsObligationsMatchInv(s);
  MsMonthlyObligationsMatch(after.month);
  MsReleaseRulesInv(s);
  MsMonthlyAlloc(after.month);
  MsUniqueAdmittedMonth(s);
  MsMonthIs(after.escrow, 0);
  MsLeafFromPositive(s, proof, ev);
  MsMaterializeCreated(s.month, after.month, proof.actor);
  MsMaterializeArith(s.escrow.pending, admittedMonth(s).remaining, settlement__monthly_createdTotal(s.month), settlement__monthly_createdTotal(after.month), obligationOf(s, proof.actor).amount, proof.gross);
}

lemma MsMaterializeUnreleased(s: MonthlySettlement, proof: settlement__escrow_LeafProof, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canMaterialize(s, proof, ev)
  ensures !settlement__money_positiveAmount(admittedMonth(s).released)
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  MsMonthsInv(s);
  MsReleaseRulesInv(s);
  MsUniqueAdmittedMonth(s);
  MsLeafFromPositive(s, proof, ev);
  if settlement__money_positiveAmount(admittedMonth(s).released) {
    assert s.escrow.months[0] in s.escrow.months;
    assert |s.escrow.releasedLeaves| == 0;
    assert settlement__money_equalAmounts(admittedMonth(s).remaining, settlement__money_zero);
    settlement__money_lawEqualOrder_ensures(admittedMonth(s).remaining, settlement__money_zero, settlement__money_zero);
    settlement__money_lawZeroOrder_ensures(settlement__money_zero);
  }
}

lemma MsReleaseArith(pending: seq<int>, r: seq<int>, g: seq<int>, admitted: seq<int>)
  requires settlement__money_validAmount(pending) && settlement__money_validAmount(r)
  requires settlement__money_validAmount(g) && settlement__money_validAmount(admitted)
  requires settlement__money_positiveAmount(g)
  requires settlement__money_equalAmounts(pending, r)
  requires settlement__money_equalAmounts(g, r)
  requires settlement__money_equalAmounts(r, admitted)
  requires settlement__money_compareAmounts(pending, g) >= 0
  ensures !settlement__money_positiveAmount(settlement__money_subtractAmounts(r, g))
  ensures !settlement__money_positiveAmount(settlement__money_subtractAmounts(pending, g))
  ensures settlement__money_equalAmounts(settlement__money_subtractAmounts(pending, g), settlement__money_subtractAmounts(r, g))
  ensures settlement__money_positiveAmount(admitted) && !(settlement__money_compareAmounts(r, admitted) < 0)
{
  var r2 := settlement__money_subtractAmounts(r, g);
  var p2 := settlement__money_subtractAmounts(pending, g);
  settlement__money_lawSubtractionValid_ensures(r, g);
  settlement__money_lawSubtractionValid_ensures(pending, g);
  settlement__money_lawSubtractCongruence_ensures(pending, r, g);
  settlement__money_lawEqualSymmetric_ensures(g, r);
  settlement__money_lawEqualOrder_ensures(r, g, g);
  settlement__money_lawEqualReflexive_ensures(g);
  settlement__money_lawSubtractionReconstructs_ensures(r, g);
  settlement__money_lawZeroIdentity_ensures(g);
  settlement__money_lawAddCommutative_ensures(g, settlement__money_zero);
  settlement__money_lawAdditionValid_ensures(r2, g);
  settlement__money_lawAdditionValid_ensures(settlement__money_zero, g);
  settlement__money_lawAdditionValid_ensures(g, settlement__money_zero);
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(r2, g), r, g);
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(settlement__money_zero, g), settlement__money_addAmounts(g, settlement__money_zero), g);
  settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(settlement__money_zero, g), g);
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(r2, g), g, settlement__money_addAmounts(settlement__money_zero, g));
  settlement__money_lawEqualReflexive_ensures(settlement__money_addAmounts(settlement__money_zero, g));
  settlement__money_lawAddOrder_ensures(r2, settlement__money_zero, g);
  settlement__money_lawEqualOrder_ensures(p2, r2, settlement__money_zero);
  settlement__money_lawEqualOrder_ensures(g, r, settlement__money_zero);
  settlement__money_lawEqualOrder_ensures(r, admitted, settlement__money_zero);
  settlement__money_lawNumericOrderTotal_ensures(r, admitted);
}

lemma MsReleaseZero(s: MonthlySettlement, release: settlement__escrow_ReleaseAuthorization, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canReleaseReserve(s, release, ev, by_)
  requires settlement__escrow_inv(releaseReserve(s, release, ev, by_).escrow)
  ensures var after := releaseReserve(s, release, ev, by_);
    |s.escrow.months| == 1 && |after.escrow.months| == 1
    && admittedMonth(after) == after.escrow.months[0]
    && admittedMonth(after).root == admittedMonth(s).root
    && admittedMonth(after).leafCount == admittedMonth(s).leafCount
    && !settlement__money_positiveAmount(admittedMonth(after).remaining)
    && !settlement__money_positiveAmount(after.escrow.pending)
    && settlement__money_equalAmounts(after.escrow.pending, admittedMonth(after).remaining)
    && !settlement__escrow_hasAwardOf(after.escrow, settlement__escrow_AwardOrigin.MonthlyLeaf)
{
  hide inv, alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := releaseReserve(s, release, ev, by_);
  MsPoolInvs(s);
  MsMonthsInv(s);
  MsEscrowMonths(after.escrow);
  MsAwardsInv(s);
  MsReleaseRulesInv(s);
  var pr := (x: settlement__escrow_MonthReserve) => (x.period == release.period);
  var kpr := ProofLib.Filter(pr, s.escrow.months);
  assert 0 < |kpr|;
  ProofLib.FilterMember(pr, s.escrow.months, kpr[0]);
  assert kpr[0] in s.escrow.months && kpr[0].period == s.month.period;
  assert release.period == s.month.period;
  MsUniqueAdmittedMonth(s);
  MsMonthIs(after.escrow, 0);
  var m := s.escrow.months[0];
  MsReleaseArith(s.escrow.pending, m.remaining, release.releasedGross, m.admittedGross);
  assert !settlement__escrow_leafTouched(s.escrow, m.period);
  if settlement__escrow_hasAwardOf(after.escrow, settlement__escrow_AwardOrigin.MonthlyLeaf) {
    var a :| a in after.escrow.awards && a.origin.MonthlyLeaf?;
    assert a in s.escrow.awards;
    assert settlement__escrow_validAward(s.escrow, a);
    var p := (x: settlement__escrow_MonthReserve) => (x.period == a.period);
    var kept := ProofLib.Filter(p, s.escrow.months);
    assert 0 < |kept|;
    ProofLib.FilterMember(p, s.escrow.months, kept[0]);
    assert a.period == m.period;
  }
}

lemma deploy_ensures(s: MonthlySettlement, asset: settlement__escrow_AssetIdentity, mint: settlement__escrow_MintFacts, purpose: settlement__escrow_VaultPurpose, delay: int, cap: seq<int>, turnOn: bool)
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysOneAwardPerObligation(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysPoolWithinUnreserved(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysChildRules(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysChildLifecycle(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysChildInvariants(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysAdmittedOnlyWhenFunded(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysPoolOnlyWhenAdmitted(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysPoolIsTheMonthRemainder(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysCursorInRange(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysReleasedMonthHasNoLeafAward(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysPendingPoolIsExactlyUnreserved(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysAdmittedLeavesUnconflicted(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysUnreservedSourcesFreeWhilePooled(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysLeafAwardsAreObligations(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysCursorSourceBacked(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysLeafAwardsReserveTheirObligation(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysAdmittedLeavesNeverConflict(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysObligationsMatchVault(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> stepObligationsOnFreshCoveringHead(s, "deploy", deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> stepUnderfundedOnFreshHead(s, "deploy", deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> stepCursorMonotoneByOne(s, deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> stepRootAdmitsOnlyFreeSources(s, "deploy", deploy(s, asset, mint, purpose, delay, cap, turnOn)))
{
  if inv(s) && canDeploy(s, asset, mint, purpose, delay, cap, turnOn) {
    var after := deploy(s, asset, mint, purpose, delay, cap, turnOn);
    MsChildInv(s);
    settlement__escrow_deploy_ensures(s.escrow, asset, mint, purpose, delay, cap, turnOn);
    MsDeploy(s, asset, mint, purpose, delay, cap, turnOn);
    MsChildInvBack(s, after);
    MsOneAward(after);
    assert alwaysChildLifecycle(s);
    MsNoMonthVacuous(after);
  }
}

lemma openMonth_ensures(s: MonthlySettlement, period: int)
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysOneAwardPerObligation(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysPoolWithinUnreserved(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysChildRules(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysChildLifecycle(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysChildInvariants(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysAdmittedOnlyWhenFunded(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysPoolOnlyWhenAdmitted(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysPoolIsTheMonthRemainder(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysCursorInRange(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysReleasedMonthHasNoLeafAward(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysPendingPoolIsExactlyUnreserved(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysAdmittedLeavesUnconflicted(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysUnreservedSourcesFreeWhilePooled(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysLeafAwardsAreObligations(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysCursorSourceBacked(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysLeafAwardsReserveTheirObligation(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysAdmittedLeavesNeverConflict(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysObligationsMatchVault(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> stepObligationsOnFreshCoveringHead(s, "openMonth", openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> stepUnderfundedOnFreshHead(s, "openMonth", openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> stepCursorMonotoneByOne(s, openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> stepRootAdmitsOnlyFreeSources(s, "openMonth", openMonth(s, period)))
{
  if inv(s) && canOpenMonth(s, period) {
    var after := openMonth(s, period);
    MsChildInv(s);
    settlement__monthly_openMonth_ensures(s.month, s.month.project, period);
    MsOpenMonth(s, period);
    MsChildInvBack(s, after);
    MsOneAward(after);
    assert alwaysAdmittedOnlyWhenFunded(s);
    assert |s.escrow.months| == 0;
    MsNoMonthVacuous(after);
  }
}

lemma observeClock_ensures(s: MonthlySettlement, now: int)
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysOneAwardPerObligation(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysPoolWithinUnreserved(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysChildRules(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysChildLifecycle(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysChildInvariants(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysAdmittedOnlyWhenFunded(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysPoolOnlyWhenAdmitted(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysPoolIsTheMonthRemainder(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysCursorInRange(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysReleasedMonthHasNoLeafAward(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysPendingPoolIsExactlyUnreserved(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysAdmittedLeavesUnconflicted(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysUnreservedSourcesFreeWhilePooled(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysLeafAwardsAreObligations(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysCursorSourceBacked(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysLeafAwardsReserveTheirObligation(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysAdmittedLeavesNeverConflict(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysObligationsMatchVault(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> stepObligationsOnFreshCoveringHead(s, "observeClock", observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> stepUnderfundedOnFreshHead(s, "observeClock", observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> stepCursorMonotoneByOne(s, observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> stepRootAdmitsOnlyFreeSources(s, "observeClock", observeClock(s, now)))
{
  if inv(s) && canObserveClock(s, now) {
    var after := observeClock(s, now);
    MsChildInv(s);
    settlement__monthly_observeClock_ensures(s.month, now);
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
  }
}

lemma observeEligibility_ensures(s: MonthlySettlement, eligibility: settlement__monthly_Eligibility)
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysOneAwardPerObligation(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysPoolWithinUnreserved(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysChildRules(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysChildLifecycle(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysChildInvariants(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysAdmittedOnlyWhenFunded(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysPoolOnlyWhenAdmitted(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysPoolIsTheMonthRemainder(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysCursorInRange(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysReleasedMonthHasNoLeafAward(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysPendingPoolIsExactlyUnreserved(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysAdmittedLeavesUnconflicted(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysUnreservedSourcesFreeWhilePooled(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysLeafAwardsAreObligations(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysCursorSourceBacked(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysLeafAwardsReserveTheirObligation(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysAdmittedLeavesNeverConflict(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> alwaysObligationsMatchVault(observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> stepObligationsOnFreshCoveringHead(s, "observeEligibility", observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> stepUnderfundedOnFreshHead(s, "observeEligibility", observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> stepCursorMonotoneByOne(s, observeEligibility(s, eligibility)))
  ensures (inv(s) ==> canObserveEligibility(s, eligibility) ==> stepRootAdmitsOnlyFreeSources(s, "observeEligibility", observeEligibility(s, eligibility)))
{
  if inv(s) && canObserveEligibility(s, eligibility) {
    var after := observeEligibility(s, eligibility);
    MsChildInv(s);
    settlement__monthly_observeEligibility_ensures(s.month, eligibility);
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
  }
}

lemma observeRevision_ensures(s: MonthlySettlement, revision: settlement__monthly_RevisionFact)
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysOneAwardPerObligation(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysPoolWithinUnreserved(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysChildRules(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysChildLifecycle(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysChildInvariants(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysAdmittedOnlyWhenFunded(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysPoolOnlyWhenAdmitted(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysPoolIsTheMonthRemainder(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysCursorInRange(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysReleasedMonthHasNoLeafAward(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysPendingPoolIsExactlyUnreserved(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysAdmittedLeavesUnconflicted(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysUnreservedSourcesFreeWhilePooled(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysLeafAwardsAreObligations(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysCursorSourceBacked(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysLeafAwardsReserveTheirObligation(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysAdmittedLeavesNeverConflict(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> alwaysObligationsMatchVault(observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> stepObligationsOnFreshCoveringHead(s, "observeRevision", observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> stepUnderfundedOnFreshHead(s, "observeRevision", observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> stepCursorMonotoneByOne(s, observeRevision(s, revision)))
  ensures (inv(s) ==> canObserveRevision(s, revision) ==> stepRootAdmitsOnlyFreeSources(s, "observeRevision", observeRevision(s, revision)))
{
  if inv(s) && canObserveRevision(s, revision) {
    var after := observeRevision(s, revision);
    MsChildInv(s);
    settlement__monthly_observeRevision_ensures(s.month, revision);
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
  }
}

lemma observeSettings_ensures(s: MonthlySettlement, automatic: bool, settingsSequence: int)
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysOneAwardPerObligation(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysPoolWithinUnreserved(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysChildRules(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysChildLifecycle(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysChildInvariants(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysAdmittedOnlyWhenFunded(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysPoolOnlyWhenAdmitted(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysPoolIsTheMonthRemainder(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysCursorInRange(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysReleasedMonthHasNoLeafAward(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysPendingPoolIsExactlyUnreserved(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysAdmittedLeavesUnconflicted(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysUnreservedSourcesFreeWhilePooled(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysLeafAwardsAreObligations(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysCursorSourceBacked(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysLeafAwardsReserveTheirObligation(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysAdmittedLeavesNeverConflict(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> alwaysObligationsMatchVault(observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> stepObligationsOnFreshCoveringHead(s, "observeSettings", observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> stepUnderfundedOnFreshHead(s, "observeSettings", observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> stepCursorMonotoneByOne(s, observeSettings(s, automatic, settingsSequence)))
  ensures (inv(s) ==> canObserveSettings(s, automatic, settingsSequence) ==> stepRootAdmitsOnlyFreeSources(s, "observeSettings", observeSettings(s, automatic, settingsSequence)))
{
  if inv(s) && canObserveSettings(s, automatic, settingsSequence) {
    var after := observeSettings(s, automatic, settingsSequence);
    MsChildInv(s);
    settlement__monthly_observeSettings_ensures(s.month, automatic, settingsSequence);
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
  }
}

lemma adjust_ensures(s: MonthlySettlement, actor: int, amount: seq<int>, expectedSequence: int, fact: settlement__monthly_AuthorityFact)
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysOneAwardPerObligation(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysPoolWithinUnreserved(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysChildRules(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysChildLifecycle(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysChildInvariants(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysAdmittedOnlyWhenFunded(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysPoolOnlyWhenAdmitted(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysPoolIsTheMonthRemainder(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysCursorInRange(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysReleasedMonthHasNoLeafAward(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysPendingPoolIsExactlyUnreserved(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysAdmittedLeavesUnconflicted(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysUnreservedSourcesFreeWhilePooled(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysLeafAwardsAreObligations(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysCursorSourceBacked(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysLeafAwardsReserveTheirObligation(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysAdmittedLeavesNeverConflict(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> alwaysObligationsMatchVault(adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> stepObligationsOnFreshCoveringHead(s, "adjust", adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> stepUnderfundedOnFreshHead(s, "adjust", adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> stepCursorMonotoneByOne(s, adjust(s, actor, amount, expectedSequence, fact)))
  ensures (inv(s) ==> canAdjust(s, actor, amount, expectedSequence, fact) ==> stepRootAdmitsOnlyFreeSources(s, "adjust", adjust(s, actor, amount, expectedSequence, fact)))
{
  if inv(s) && canAdjust(s, actor, amount, expectedSequence, fact) {
    var after := adjust(s, actor, amount, expectedSequence, fact);
    MsChildInv(s);
    settlement__monthly_adjust_ensures(s.month, actor, amount, expectedSequence, fact);
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
  }
}

lemma finalize_ensures(s: MonthlySettlement, expectedSequence: int, fact: settlement__monthly_AuthorityFact)
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysOneAwardPerObligation(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysPoolWithinUnreserved(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysChildRules(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysChildLifecycle(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysChildInvariants(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysAdmittedOnlyWhenFunded(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysPoolOnlyWhenAdmitted(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysPoolIsTheMonthRemainder(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysCursorInRange(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysReleasedMonthHasNoLeafAward(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysPendingPoolIsExactlyUnreserved(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysAdmittedLeavesUnconflicted(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysUnreservedSourcesFreeWhilePooled(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysLeafAwardsAreObligations(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysCursorSourceBacked(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysLeafAwardsReserveTheirObligation(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysAdmittedLeavesNeverConflict(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> alwaysObligationsMatchVault(finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> stepObligationsOnFreshCoveringHead(s, "finalize", finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> stepUnderfundedOnFreshHead(s, "finalize", finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> stepCursorMonotoneByOne(s, finalize(s, expectedSequence, fact)))
  ensures (inv(s) ==> canFinalize(s, expectedSequence, fact) ==> stepRootAdmitsOnlyFreeSources(s, "finalize", finalize(s, expectedSequence, fact)))
{
  if inv(s) && canFinalize(s, expectedSequence, fact) {
    var after := finalize(s, expectedSequence, fact);
    MsChildInv(s);
    settlement__monthly_finalize_ensures(s.month, expectedSequence, fact);
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
  }
}

lemma propose_ensures(s: MonthlySettlement, snapshot: settlement__payoutExclusions_WorkSnapshot, exclusions: seq<settlement__payoutExclusions_Exclusion>, revision: settlement__monthly_RevisionFact)
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysOneAwardPerObligation(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysPoolWithinUnreserved(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysChildRules(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysChildLifecycle(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysChildInvariants(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysAdmittedOnlyWhenFunded(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysPoolOnlyWhenAdmitted(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysPoolIsTheMonthRemainder(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysCursorInRange(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysReleasedMonthHasNoLeafAward(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysPendingPoolIsExactlyUnreserved(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysAdmittedLeavesUnconflicted(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysUnreservedSourcesFreeWhilePooled(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysLeafAwardsAreObligations(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysCursorSourceBacked(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysLeafAwardsReserveTheirObligation(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysAdmittedLeavesNeverConflict(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> alwaysObligationsMatchVault(propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> stepObligationsOnFreshCoveringHead(s, "propose", propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> stepUnderfundedOnFreshHead(s, "propose", propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> stepCursorMonotoneByOne(s, propose(s, snapshot, exclusions, revision)))
  ensures (inv(s) ==> canPropose(s, snapshot, exclusions, revision) ==> stepRootAdmitsOnlyFreeSources(s, "propose", propose(s, snapshot, exclusions, revision)))
{
  if inv(s) && canPropose(s, snapshot, exclusions, revision) {
    var after := propose(s, snapshot, exclusions, revision);
    MsChildInv(s);
    settlement__monthly_propose_ensures(s.month, snapshot, exclusions, revision, 0, settlement__monthly_noShareRecord);
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
  }
}

lemma autoFreeze_ensures(s: MonthlySettlement)
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysOneAwardPerObligation(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysPoolWithinUnreserved(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysChildRules(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysChildLifecycle(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysChildInvariants(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysAdmittedOnlyWhenFunded(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysPoolOnlyWhenAdmitted(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysPoolIsTheMonthRemainder(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysCursorInRange(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysReleasedMonthHasNoLeafAward(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysPendingPoolIsExactlyUnreserved(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysAdmittedLeavesUnconflicted(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysUnreservedSourcesFreeWhilePooled(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysLeafAwardsAreObligations(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysCursorSourceBacked(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysLeafAwardsReserveTheirObligation(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysAdmittedLeavesNeverConflict(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> alwaysObligationsMatchVault(autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> stepObligationsOnFreshCoveringHead(s, "autoFreeze", autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> stepUnderfundedOnFreshHead(s, "autoFreeze", autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> stepCursorMonotoneByOne(s, autoFreeze(s)))
  ensures (inv(s) ==> canAutoFreeze(s) ==> stepRootAdmitsOnlyFreeSources(s, "autoFreeze", autoFreeze(s)))
{
  if inv(s) && canAutoFreeze(s) {
    var after := autoFreeze(s);
    MsChildInv(s);
    settlement__monthly_autoFreeze_ensures(s.month);
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
  }
}

lemma deposit_ensures(s: MonthlySettlement, funds: settlement__escrow_Deposit, ev: settlement__escrow_ChainEvent)
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysOneAwardPerObligation(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysPoolWithinUnreserved(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysChildRules(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysChildLifecycle(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysChildInvariants(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysAdmittedOnlyWhenFunded(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysPoolOnlyWhenAdmitted(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysPoolIsTheMonthRemainder(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysCursorInRange(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysReleasedMonthHasNoLeafAward(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysPendingPoolIsExactlyUnreserved(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysAdmittedLeavesUnconflicted(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysUnreservedSourcesFreeWhilePooled(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysLeafAwardsAreObligations(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysCursorSourceBacked(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysLeafAwardsReserveTheirObligation(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysAdmittedLeavesNeverConflict(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> alwaysObligationsMatchVault(deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> stepObligationsOnFreshCoveringHead(s, "deposit", deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> stepUnderfundedOnFreshHead(s, "deposit", deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> stepCursorMonotoneByOne(s, deposit(s, funds, ev)))
  ensures (inv(s) ==> canDeposit(s, funds, ev) ==> stepRootAdmitsOnlyFreeSources(s, "deposit", deposit(s, funds, ev)))
{
  if inv(s) && canDeposit(s, funds, ev) {
    var after := deposit(s, funds, ev);
    MsChildInv(s);
    settlement__escrow_deposit_ensures(s.escrow, funds, ev);
    MsChildInvBack(s, after);
    MsEscrowOnlyFrame(s, after);
  }
}

lemma setMonthly_ensures(s: MonthlySettlement, cap: seq<int>, turnOn: bool, ev: settlement__escrow_ChainEvent, by_: string)
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysOneAwardPerObligation(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysPoolWithinUnreserved(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysChildRules(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysChildLifecycle(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysChildInvariants(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysAdmittedOnlyWhenFunded(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysPoolOnlyWhenAdmitted(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysPoolIsTheMonthRemainder(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysCursorInRange(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysReleasedMonthHasNoLeafAward(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysPendingPoolIsExactlyUnreserved(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysAdmittedLeavesUnconflicted(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysUnreservedSourcesFreeWhilePooled(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysLeafAwardsAreObligations(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysCursorSourceBacked(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysLeafAwardsReserveTheirObligation(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysAdmittedLeavesNeverConflict(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> alwaysObligationsMatchVault(setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> stepObligationsOnFreshCoveringHead(s, "setMonthly", setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> stepUnderfundedOnFreshHead(s, "setMonthly", setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> stepCursorMonotoneByOne(s, setMonthly(s, cap, turnOn, ev, by_)))
  ensures (inv(s) ==> canSetMonthly(s, cap, turnOn, ev, by_) ==> stepRootAdmitsOnlyFreeSources(s, "setMonthly", setMonthly(s, cap, turnOn, ev, by_)))
{
  if inv(s) && canSetMonthly(s, cap, turnOn, ev, by_) {
    var after := setMonthly(s, cap, turnOn, ev, by_);
    MsChildInv(s);
    settlement__escrow_setMonthly_ensures(s.escrow, cap, turnOn, ev, by_);
    MsChildInvBack(s, after);
    MsEscrowOnlyFrame(s, after);
  }
}

lemma pledgeMonths_ensures(s: MonthlySettlement, fromPeriod: int, count: int, pledge: seq<int>, ev: settlement__escrow_ChainEvent, by_: string)
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysOneAwardPerObligation(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysPoolWithinUnreserved(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysChildRules(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysChildLifecycle(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysChildInvariants(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysAdmittedOnlyWhenFunded(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysPoolOnlyWhenAdmitted(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysPoolIsTheMonthRemainder(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysCursorInRange(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysReleasedMonthHasNoLeafAward(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysPendingPoolIsExactlyUnreserved(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysAdmittedLeavesUnconflicted(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysUnreservedSourcesFreeWhilePooled(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysLeafAwardsAreObligations(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysCursorSourceBacked(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysLeafAwardsReserveTheirObligation(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysAdmittedLeavesNeverConflict(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> alwaysObligationsMatchVault(pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> stepObligationsOnFreshCoveringHead(s, "pledgeMonths", pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> stepUnderfundedOnFreshHead(s, "pledgeMonths", pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> stepCursorMonotoneByOne(s, pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
  ensures (inv(s) ==> canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) ==> stepRootAdmitsOnlyFreeSources(s, "pledgeMonths", pledgeMonths(s, fromPeriod, count, pledge, ev, by_)))
{
  if inv(s) && canPledgeMonths(s, fromPeriod, count, pledge, ev, by_) {
    var after := pledgeMonths(s, fromPeriod, count, pledge, ev, by_);
    MsChildInv(s);
    settlement__escrow_pledgeMonths_ensures(s.escrow, fromPeriod, count, pledge, ev, by_);
    MsChildInvBack(s, after);
    MsEscrowOnlyFrame(s, after);
  }
}

lemma observeHead_ensures(s: MonthlySettlement, time: int)
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysOneAwardPerObligation(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysPoolWithinUnreserved(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysChildRules(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysChildLifecycle(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysChildInvariants(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysAdmittedOnlyWhenFunded(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysPoolOnlyWhenAdmitted(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysPoolIsTheMonthRemainder(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysCursorInRange(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysReleasedMonthHasNoLeafAward(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysPendingPoolIsExactlyUnreserved(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysAdmittedLeavesUnconflicted(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysUnreservedSourcesFreeWhilePooled(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysLeafAwardsAreObligations(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysCursorSourceBacked(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysLeafAwardsReserveTheirObligation(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysAdmittedLeavesNeverConflict(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> alwaysObligationsMatchVault(observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> stepObligationsOnFreshCoveringHead(s, "observeHead", observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> stepUnderfundedOnFreshHead(s, "observeHead", observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> stepCursorMonotoneByOne(s, observeHead(s, time)))
  ensures (inv(s) ==> canObserveHead(s, time) ==> stepRootAdmitsOnlyFreeSources(s, "observeHead", observeHead(s, time)))
{
  if inv(s) && canObserveHead(s, time) {
    var after := observeHead(s, time);
    MsChildInv(s);
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
  }
}

lemma createObligations_ensures(s: MonthlySettlement, earlierUnreserved: seq<int>, bans: seq<settlement__monthly_BanExclusion>)
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysOneAwardPerObligation(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysPoolWithinUnreserved(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysChildRules(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysChildLifecycle(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysChildInvariants(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysAdmittedOnlyWhenFunded(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysPoolOnlyWhenAdmitted(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysPoolIsTheMonthRemainder(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysCursorInRange(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysReleasedMonthHasNoLeafAward(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysPendingPoolIsExactlyUnreserved(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysAdmittedLeavesUnconflicted(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysUnreservedSourcesFreeWhilePooled(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysLeafAwardsAreObligations(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysCursorSourceBacked(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysLeafAwardsReserveTheirObligation(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysAdmittedLeavesNeverConflict(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> alwaysObligationsMatchVault(createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> stepObligationsOnFreshCoveringHead(s, "createObligations", createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> stepUnderfundedOnFreshHead(s, "createObligations", createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> stepCursorMonotoneByOne(s, createObligations(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canCreateObligations(s, earlierUnreserved, bans) ==> stepRootAdmitsOnlyFreeSources(s, "createObligations", createObligations(s, earlierUnreserved, bans)))
{
  if inv(s) && canCreateObligations(s, earlierUnreserved, bans) {
    var after := createObligations(s, earlierUnreserved, bans);
    MsChildInv(s);
    settlement__monthly_createObligations_ensures(s.month, observation(s, earlierUnreserved), bans);
    MsChildInvBack(s, after);
    MsCreate(s, earlierUnreserved, bans);
    MsChildInvBack(s, after);
    MsOneAward(after);
    assert alwaysAdmittedOnlyWhenFunded(s);
    assert s.month.phase.Frozen?;
    assert |after.escrow.months| == 0;
    MsNoMonthVacuous(after);
  }
}

lemma noteUnderfunded_ensures(s: MonthlySettlement, earlierUnreserved: seq<int>, bans: seq<settlement__monthly_BanExclusion>)
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysOneAwardPerObligation(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysPoolWithinUnreserved(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysChildRules(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysChildLifecycle(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysChildInvariants(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysAdmittedOnlyWhenFunded(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysPoolOnlyWhenAdmitted(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysPoolIsTheMonthRemainder(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysCursorInRange(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysReleasedMonthHasNoLeafAward(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysPendingPoolIsExactlyUnreserved(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysAdmittedLeavesUnconflicted(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysUnreservedSourcesFreeWhilePooled(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysLeafAwardsAreObligations(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysCursorSourceBacked(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysLeafAwardsReserveTheirObligation(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysAdmittedLeavesNeverConflict(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> alwaysObligationsMatchVault(noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> stepObligationsOnFreshCoveringHead(s, "noteUnderfunded", noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> stepUnderfundedOnFreshHead(s, "noteUnderfunded", noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> stepCursorMonotoneByOne(s, noteUnderfunded(s, earlierUnreserved, bans)))
  ensures (inv(s) ==> canNoteUnderfunded(s, earlierUnreserved, bans) ==> stepRootAdmitsOnlyFreeSources(s, "noteUnderfunded", noteUnderfunded(s, earlierUnreserved, bans)))
{
  if inv(s) && canNoteUnderfunded(s, earlierUnreserved, bans) {
    var after := noteUnderfunded(s, earlierUnreserved, bans);
    MsChildInv(s);
    settlement__monthly_noteUnderfunded_ensures(s.month, observation(s, earlierUnreserved), bans);
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
  }
}

lemma commitObligation_ensures(s: MonthlySettlement, actor: int, ev: settlement__escrow_ChainEvent, by_: string)
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysOneAwardPerObligation(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysPoolWithinUnreserved(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysChildRules(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysChildLifecycle(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysChildInvariants(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysAdmittedOnlyWhenFunded(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysPoolOnlyWhenAdmitted(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysPoolIsTheMonthRemainder(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysCursorInRange(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysReleasedMonthHasNoLeafAward(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysPendingPoolIsExactlyUnreserved(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysAdmittedLeavesUnconflicted(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysUnreservedSourcesFreeWhilePooled(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysLeafAwardsAreObligations(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysCursorSourceBacked(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysLeafAwardsReserveTheirObligation(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysAdmittedLeavesNeverConflict(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> alwaysObligationsMatchVault(commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> stepObligationsOnFreshCoveringHead(s, "commitObligation", commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> stepUnderfundedOnFreshHead(s, "commitObligation", commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> stepCursorMonotoneByOne(s, commitObligation(s, actor, ev, by_)))
  ensures (inv(s) ==> canCommitObligation(s, actor, ev, by_) ==> stepRootAdmitsOnlyFreeSources(s, "commitObligation", commitObligation(s, actor, ev, by_)))
{
  hide *;
  if inv(s) && canCommitObligation(s, actor, ev, by_) {
    CommitObligationChild(s, actor, ev, by_);
    CommitObligationPart1a(s, actor, ev, by_);
    CommitObligationPart1b(s, actor, ev, by_);
    CommitObligationPart2a(s, actor, ev, by_);
    CommitObligationPart2b(s, actor, ev, by_);
  }
}

lemma CommitObligationChild(s: MonthlySettlement, actor: int, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canCommitObligation(s, actor, ev, by_)
  ensures alwaysChildRules(commitObligation(s, actor, ev, by_))
  ensures alwaysChildLifecycle(commitObligation(s, actor, ev, by_))
  ensures alwaysChildInvariants(commitObligation(s, actor, ev, by_))
  ensures settlement__monthly_inv(commitObligation(s, actor, ev, by_).month) && settlement__escrow_inv(commitObligation(s, actor, ev, by_).escrow)
{
  hide *;
  reveal canCommitObligation, commitObligation, settlement__monthly_inv, settlement__escrow_inv;
  var after := commitObligation(s, actor, ev, by_);
  MsChildInv(s);
  settlement__escrow_commitAward_ensures(s.escrow, sourceOf(s, actor), actor, obligationOf(s, actor).amount, ev, by_);
  settlement__monthly_recordReserved_ensures(s.month, awardFact(s, actor, false));
  MsChildInvBack(s, after);
}

lemma CommitObligationPart1a(s: MonthlySettlement, actor: int, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canCommitObligation(s, actor, ev, by_)
  requires settlement__monthly_inv(commitObligation(s, actor, ev, by_).month) && settlement__escrow_inv(commitObligation(s, actor, ev, by_).escrow)
  ensures alwaysOneAwardPerObligation(commitObligation(s, actor, ev, by_))
  ensures alwaysPoolWithinUnreserved(commitObligation(s, actor, ev, by_))
  ensures alwaysAdmittedOnlyWhenFunded(commitObligation(s, actor, ev, by_))
  ensures alwaysPoolOnlyWhenAdmitted(commitObligation(s, actor, ev, by_))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := commitObligation(s, actor, ev, by_);
  MsEscrowAwards(after.escrow);
  MsCommitObligation(s, actor, ev, by_);
  MsOneAward(after);
}

lemma CommitObligationPart1b(s: MonthlySettlement, actor: int, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canCommitObligation(s, actor, ev, by_)
  requires settlement__monthly_inv(commitObligation(s, actor, ev, by_).month) && settlement__escrow_inv(commitObligation(s, actor, ev, by_).escrow)
  ensures alwaysPoolIsTheMonthRemainder(commitObligation(s, actor, ev, by_))
  ensures alwaysCursorInRange(commitObligation(s, actor, ev, by_))
  ensures alwaysReleasedMonthHasNoLeafAward(commitObligation(s, actor, ev, by_))
  ensures alwaysPendingPoolIsExactlyUnreserved(commitObligation(s, actor, ev, by_))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := commitObligation(s, actor, ev, by_);
  var nw := after.escrow.awards[|s.escrow.awards|];
  assert after.escrow.awards == s.escrow.awards + [nw];
  MsWithAwardFacts(s.escrow, nw, after.escrow);
  MsCommitObligation(s, actor, ev, by_);
}

lemma CommitObligationPart2a(s: MonthlySettlement, actor: int, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canCommitObligation(s, actor, ev, by_)
  requires settlement__monthly_inv(commitObligation(s, actor, ev, by_).month) && settlement__escrow_inv(commitObligation(s, actor, ev, by_).escrow)
  ensures alwaysAdmittedLeavesUnconflicted(commitObligation(s, actor, ev, by_))
  ensures alwaysUnreservedSourcesFreeWhilePooled(commitObligation(s, actor, ev, by_))
  ensures alwaysLeafAwardsAreObligations(commitObligation(s, actor, ev, by_))
  ensures alwaysCursorSourceBacked(commitObligation(s, actor, ev, by_))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := commitObligation(s, actor, ev, by_);
  MsObligationsMatchInv(s);
  MsMonthlyObligationsMatch(after.month);
  var nw := after.escrow.awards[|s.escrow.awards|];
  assert after.escrow.awards == s.escrow.awards + [nw];
  MsWithAwardFacts(s.escrow, nw, after.escrow);
  MsObligationUpdated(s.month, after.month, actor, settlement__monthly_ObligationState.Reserved);
  assert alwaysPoolIsTheMonthRemainder(s);
  settlement__money_lawEqualOrder_ensures(s.escrow.pending, admittedMonth(s).remaining, settlement__money_zero);
  assert after.escrow.months == s.escrow.months;
  MsLeavesVacuous(after);
}

lemma CommitObligationPart2b(s: MonthlySettlement, actor: int, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canCommitObligation(s, actor, ev, by_)
  requires settlement__monthly_inv(commitObligation(s, actor, ev, by_).month) && settlement__escrow_inv(commitObligation(s, actor, ev, by_).escrow)
  ensures alwaysLeafAwardsReserveTheirObligation(commitObligation(s, actor, ev, by_))
  ensures alwaysAdmittedLeavesNeverConflict(commitObligation(s, actor, ev, by_))
  ensures alwaysObligationsMatchVault(commitObligation(s, actor, ev, by_))
  ensures stepObligationsOnFreshCoveringHead(s, "commitObligation", commitObligation(s, actor, ev, by_))
  ensures stepUnderfundedOnFreshHead(s, "commitObligation", commitObligation(s, actor, ev, by_))
  ensures stepCursorMonotoneByOne(s, commitObligation(s, actor, ev, by_))
  ensures stepRootAdmitsOnlyFreeSources(s, "commitObligation", commitObligation(s, actor, ev, by_))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := commitObligation(s, actor, ev, by_);
  MsObligationsMatchInv(s);
  MsMonthlyObligationsMatch(after.month);
  var nw := after.escrow.awards[|s.escrow.awards|];
  assert after.escrow.awards == s.escrow.awards + [nw];
  MsWithAwardFacts(s.escrow, nw, after.escrow);
  MsObligationUpdated(s.month, after.month, actor, settlement__monthly_ObligationState.Reserved);
  settlement__money_lawEqualReflexive_ensures(obligationOf(s, actor).amount);
  assert alwaysPoolIsTheMonthRemainder(s);
  settlement__money_lawEqualOrder_ensures(s.escrow.pending, admittedMonth(s).remaining, settlement__money_zero);
  assert after.escrow.months == s.escrow.months;
  MsLeavesVacuous(after);
}

lemma commitManualAward_ensures(s: MonthlySettlement, source: settlement__escrow_SourceKey, actor: int, gross: seq<int>, ev: settlement__escrow_ChainEvent, by_: string)
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysOneAwardPerObligation(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysPoolWithinUnreserved(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysChildRules(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysChildLifecycle(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysChildInvariants(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysAdmittedOnlyWhenFunded(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysPoolOnlyWhenAdmitted(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysPoolIsTheMonthRemainder(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysCursorInRange(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysReleasedMonthHasNoLeafAward(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysPendingPoolIsExactlyUnreserved(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysAdmittedLeavesUnconflicted(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysUnreservedSourcesFreeWhilePooled(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysLeafAwardsAreObligations(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysCursorSourceBacked(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysLeafAwardsReserveTheirObligation(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysAdmittedLeavesNeverConflict(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> alwaysObligationsMatchVault(commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> stepObligationsOnFreshCoveringHead(s, "commitManualAward", commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> stepUnderfundedOnFreshHead(s, "commitManualAward", commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> stepCursorMonotoneByOne(s, commitManualAward(s, source, actor, gross, ev, by_)))
  ensures (inv(s) ==> canCommitManualAward(s, source, actor, gross, ev, by_) ==> stepRootAdmitsOnlyFreeSources(s, "commitManualAward", commitManualAward(s, source, actor, gross, ev, by_)))
{
  hide *;
  if inv(s) && canCommitManualAward(s, source, actor, gross, ev, by_) {
    CommitManualAwardChild(s, source, actor, gross, ev, by_);
    CommitManualAwardPart1(s, source, actor, gross, ev, by_);
    CommitManualAwardPart2a(s, source, actor, gross, ev, by_);
    CommitManualAwardPart2b(s, source, actor, gross, ev, by_);
  }
}

lemma CommitManualAwardChild(s: MonthlySettlement, source: settlement__escrow_SourceKey, actor: int, gross: seq<int>, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canCommitManualAward(s, source, actor, gross, ev, by_)
  ensures alwaysChildRules(commitManualAward(s, source, actor, gross, ev, by_))
  ensures alwaysChildLifecycle(commitManualAward(s, source, actor, gross, ev, by_))
  ensures alwaysChildInvariants(commitManualAward(s, source, actor, gross, ev, by_))
  ensures settlement__monthly_inv(commitManualAward(s, source, actor, gross, ev, by_).month) && settlement__escrow_inv(commitManualAward(s, source, actor, gross, ev, by_).escrow)
{
  hide *;
  reveal canCommitManualAward, commitManualAward, settlement__monthly_inv, settlement__escrow_inv;
  var after := commitManualAward(s, source, actor, gross, ev, by_);
  MsChildInv(s);
  settlement__escrow_commitAward_ensures(s.escrow, source, actor, gross, ev, by_);
  MsChildInvBack(s, after);
}

lemma CommitManualAwardPart1(s: MonthlySettlement, source: settlement__escrow_SourceKey, actor: int, gross: seq<int>, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canCommitManualAward(s, source, actor, gross, ev, by_)
  requires settlement__monthly_inv(commitManualAward(s, source, actor, gross, ev, by_).month) && settlement__escrow_inv(commitManualAward(s, source, actor, gross, ev, by_).escrow)
  ensures alwaysOneAwardPerObligation(commitManualAward(s, source, actor, gross, ev, by_))
  ensures alwaysPoolWithinUnreserved(commitManualAward(s, source, actor, gross, ev, by_))
  ensures alwaysAdmittedOnlyWhenFunded(commitManualAward(s, source, actor, gross, ev, by_))
  ensures alwaysPoolOnlyWhenAdmitted(commitManualAward(s, source, actor, gross, ev, by_))
  ensures alwaysPoolIsTheMonthRemainder(commitManualAward(s, source, actor, gross, ev, by_))
  ensures alwaysCursorInRange(commitManualAward(s, source, actor, gross, ev, by_))
  ensures alwaysReleasedMonthHasNoLeafAward(commitManualAward(s, source, actor, gross, ev, by_))
  ensures alwaysPendingPoolIsExactlyUnreserved(commitManualAward(s, source, actor, gross, ev, by_))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := commitManualAward(s, source, actor, gross, ev, by_);
  var nw := after.escrow.awards[|s.escrow.awards|];
  assert after.escrow.awards == s.escrow.awards + [nw];
  MsWithAwardFacts(s.escrow, nw, after.escrow);
  MsEscrowAwards(after.escrow);
  MsOneAward(after);
}

lemma CommitManualAwardPart2a(s: MonthlySettlement, source: settlement__escrow_SourceKey, actor: int, gross: seq<int>, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canCommitManualAward(s, source, actor, gross, ev, by_)
  requires settlement__monthly_inv(commitManualAward(s, source, actor, gross, ev, by_).month) && settlement__escrow_inv(commitManualAward(s, source, actor, gross, ev, by_).escrow)
  ensures alwaysAdmittedLeavesUnconflicted(commitManualAward(s, source, actor, gross, ev, by_))
  ensures alwaysUnreservedSourcesFreeWhilePooled(commitManualAward(s, source, actor, gross, ev, by_))
  ensures alwaysLeafAwardsAreObligations(commitManualAward(s, source, actor, gross, ev, by_))
  ensures alwaysCursorSourceBacked(commitManualAward(s, source, actor, gross, ev, by_))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := commitManualAward(s, source, actor, gross, ev, by_);
  var nw := after.escrow.awards[|s.escrow.awards|];
  assert after.escrow.awards == s.escrow.awards + [nw];
  MsWithAwardFacts(s.escrow, nw, after.escrow);
  MsLeavesFrame(s, after);
}

lemma CommitManualAwardPart2b(s: MonthlySettlement, source: settlement__escrow_SourceKey, actor: int, gross: seq<int>, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canCommitManualAward(s, source, actor, gross, ev, by_)
  requires settlement__monthly_inv(commitManualAward(s, source, actor, gross, ev, by_).month) && settlement__escrow_inv(commitManualAward(s, source, actor, gross, ev, by_).escrow)
  ensures alwaysLeafAwardsReserveTheirObligation(commitManualAward(s, source, actor, gross, ev, by_))
  ensures alwaysAdmittedLeavesNeverConflict(commitManualAward(s, source, actor, gross, ev, by_))
  ensures alwaysObligationsMatchVault(commitManualAward(s, source, actor, gross, ev, by_))
  ensures stepObligationsOnFreshCoveringHead(s, "commitManualAward", commitManualAward(s, source, actor, gross, ev, by_))
  ensures stepUnderfundedOnFreshHead(s, "commitManualAward", commitManualAward(s, source, actor, gross, ev, by_))
  ensures stepCursorMonotoneByOne(s, commitManualAward(s, source, actor, gross, ev, by_))
  ensures stepRootAdmitsOnlyFreeSources(s, "commitManualAward", commitManualAward(s, source, actor, gross, ev, by_))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := commitManualAward(s, source, actor, gross, ev, by_);
  var nw := after.escrow.awards[|s.escrow.awards|];
  assert after.escrow.awards == s.escrow.awards + [nw];
  MsWithAwardFacts(s.escrow, nw, after.escrow);
  assert alwaysPoolIsTheMonthRemainder(s);
  settlement__money_lawEqualOrder_ensures(s.escrow.pending, admittedMonth(s).remaining, settlement__money_zero);
  MsLeavesVacuous(after);
}

lemma payAward_ensures(s: MonthlySettlement, actor: int, destination: string, version: int, ev: settlement__escrow_ChainEvent)
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysOneAwardPerObligation(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysPoolWithinUnreserved(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysChildRules(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysChildLifecycle(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysChildInvariants(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysAdmittedOnlyWhenFunded(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysPoolOnlyWhenAdmitted(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysPoolIsTheMonthRemainder(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysCursorInRange(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysReleasedMonthHasNoLeafAward(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysPendingPoolIsExactlyUnreserved(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysAdmittedLeavesUnconflicted(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysUnreservedSourcesFreeWhilePooled(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysLeafAwardsAreObligations(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysCursorSourceBacked(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysLeafAwardsReserveTheirObligation(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysAdmittedLeavesNeverConflict(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> alwaysObligationsMatchVault(payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> stepObligationsOnFreshCoveringHead(s, "payAward", payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> stepUnderfundedOnFreshHead(s, "payAward", payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> stepCursorMonotoneByOne(s, payAward(s, actor, destination, version, ev)))
  ensures (inv(s) ==> canPayAward(s, actor, destination, version, ev) ==> stepRootAdmitsOnlyFreeSources(s, "payAward", payAward(s, actor, destination, version, ev)))
{
  hide *;
  if inv(s) && canPayAward(s, actor, destination, version, ev) {
    PayAwardChild(s, actor, destination, version, ev);
    PayAwardPart1(s, actor, destination, version, ev);
    PayAwardPart2a(s, actor, destination, version, ev);
    PayAwardPart2b(s, actor, destination, version, ev);
  }
}

lemma PayAwardChild(s: MonthlySettlement, actor: int, destination: string, version: int, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canPayAward(s, actor, destination, version, ev)
  ensures alwaysChildRules(payAward(s, actor, destination, version, ev))
  ensures alwaysChildLifecycle(payAward(s, actor, destination, version, ev))
  ensures alwaysChildInvariants(payAward(s, actor, destination, version, ev))
  ensures settlement__monthly_inv(payAward(s, actor, destination, version, ev).month) && settlement__escrow_inv(payAward(s, actor, destination, version, ev).escrow)
{
  hide *;
  reveal canPayAward, payAward, settlement__monthly_inv, settlement__escrow_inv;
  var after := payAward(s, actor, destination, version, ev);
  MsChildInv(s);
  settlement__escrow_pay_ensures(s.escrow, sourceOf(s, actor), settlement__escrow_PayableBinding(actor, destination, version), ev);
  MsChildInvBack(s, after);
}

lemma PayAwardPart1(s: MonthlySettlement, actor: int, destination: string, version: int, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canPayAward(s, actor, destination, version, ev)
  requires settlement__monthly_inv(payAward(s, actor, destination, version, ev).month) && settlement__escrow_inv(payAward(s, actor, destination, version, ev).escrow)
  ensures alwaysOneAwardPerObligation(payAward(s, actor, destination, version, ev))
  ensures alwaysPoolWithinUnreserved(payAward(s, actor, destination, version, ev))
  ensures alwaysAdmittedOnlyWhenFunded(payAward(s, actor, destination, version, ev))
  ensures alwaysPoolOnlyWhenAdmitted(payAward(s, actor, destination, version, ev))
  ensures alwaysPoolIsTheMonthRemainder(payAward(s, actor, destination, version, ev))
  ensures alwaysCursorInRange(payAward(s, actor, destination, version, ev))
  ensures alwaysReleasedMonthHasNoLeafAward(payAward(s, actor, destination, version, ev))
  ensures alwaysPendingPoolIsExactlyUnreserved(payAward(s, actor, destination, version, ev))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := payAward(s, actor, destination, version, ev);
  MsAwardsInv(s);
  MsEscrowAwards(after.escrow);
  MsPayAwardFacts(s.escrow, sourceOf(s, actor), settlement__escrow_PayableBinding(actor, destination, version), ev);
  MsOneAward(after);
}

lemma PayAwardPart2a(s: MonthlySettlement, actor: int, destination: string, version: int, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canPayAward(s, actor, destination, version, ev)
  requires settlement__monthly_inv(payAward(s, actor, destination, version, ev).month) && settlement__escrow_inv(payAward(s, actor, destination, version, ev).escrow)
  ensures alwaysAdmittedLeavesUnconflicted(payAward(s, actor, destination, version, ev))
  ensures alwaysUnreservedSourcesFreeWhilePooled(payAward(s, actor, destination, version, ev))
  ensures alwaysLeafAwardsAreObligations(payAward(s, actor, destination, version, ev))
  ensures alwaysCursorSourceBacked(payAward(s, actor, destination, version, ev))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := payAward(s, actor, destination, version, ev);
  MsAwardsInv(s);
  MsPayAwardFacts(s.escrow, sourceOf(s, actor), settlement__escrow_PayableBinding(actor, destination, version), ev);
  MsLeavesFrame(s, after);
}

lemma PayAwardPart2b(s: MonthlySettlement, actor: int, destination: string, version: int, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canPayAward(s, actor, destination, version, ev)
  requires settlement__monthly_inv(payAward(s, actor, destination, version, ev).month) && settlement__escrow_inv(payAward(s, actor, destination, version, ev).escrow)
  requires alwaysUnreservedSourcesFreeWhilePooled(payAward(s, actor, destination, version, ev))
  requires alwaysPoolIsTheMonthRemainder(payAward(s, actor, destination, version, ev))
  ensures alwaysLeafAwardsReserveTheirObligation(payAward(s, actor, destination, version, ev))
  ensures alwaysAdmittedLeavesNeverConflict(payAward(s, actor, destination, version, ev))
  ensures alwaysObligationsMatchVault(payAward(s, actor, destination, version, ev))
  ensures stepObligationsOnFreshCoveringHead(s, "payAward", payAward(s, actor, destination, version, ev))
  ensures stepUnderfundedOnFreshHead(s, "payAward", payAward(s, actor, destination, version, ev))
  ensures stepCursorMonotoneByOne(s, payAward(s, actor, destination, version, ev))
  ensures stepRootAdmitsOnlyFreeSources(s, "payAward", payAward(s, actor, destination, version, ev))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := payAward(s, actor, destination, version, ev);
  MsAwardsInv(s);
  MsPayAwardFacts(s.escrow, sourceOf(s, actor), settlement__escrow_PayableBinding(actor, destination, version), ev);
  MsLeavesFrame(s, after);
  assert alwaysObligationsMatchVault(after);
  MsLeavesNeverConflict(after);
}

lemma observeExistingAward_ensures(s: MonthlySettlement, actor: int)
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysOneAwardPerObligation(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysPoolWithinUnreserved(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysChildRules(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysChildLifecycle(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysChildInvariants(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysAdmittedOnlyWhenFunded(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysPoolOnlyWhenAdmitted(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysPoolIsTheMonthRemainder(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysCursorInRange(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysReleasedMonthHasNoLeafAward(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysPendingPoolIsExactlyUnreserved(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysAdmittedLeavesUnconflicted(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysUnreservedSourcesFreeWhilePooled(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysLeafAwardsAreObligations(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysCursorSourceBacked(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysLeafAwardsReserveTheirObligation(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysAdmittedLeavesNeverConflict(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> alwaysObligationsMatchVault(observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> stepObligationsOnFreshCoveringHead(s, "observeExistingAward", observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> stepUnderfundedOnFreshHead(s, "observeExistingAward", observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> stepCursorMonotoneByOne(s, observeExistingAward(s, actor)))
  ensures (inv(s) ==> canObserveExistingAward(s, actor) ==> stepRootAdmitsOnlyFreeSources(s, "observeExistingAward", observeExistingAward(s, actor)))
{
  hide *;
  if inv(s) && canObserveExistingAward(s, actor) {
    ObserveExistingAwardChild(s, actor);
    ObserveExistingAwardPart1(s, actor);
    ObserveExistingAwardPart2a(s, actor);
    ObserveExistingAwardPart2b(s, actor);
  }
}

lemma ObserveExistingAwardChild(s: MonthlySettlement, actor: int)
  requires inv(s) && canObserveExistingAward(s, actor)
  ensures alwaysChildRules(observeExistingAward(s, actor))
  ensures alwaysChildLifecycle(observeExistingAward(s, actor))
  ensures alwaysChildInvariants(observeExistingAward(s, actor))
  ensures settlement__monthly_inv(observeExistingAward(s, actor).month) && settlement__escrow_inv(observeExistingAward(s, actor).escrow)
{
  hide *;
  reveal canObserveExistingAward, observeExistingAward, settlement__monthly_inv, settlement__escrow_inv;
  var after := observeExistingAward(s, actor);
  MsChildInv(s);
  settlement__monthly_recordReserved_ensures(s.month, awardFact(s, actor, false));
  MsChildInvBack(s, after);
}

lemma ObserveExistingAwardPart1(s: MonthlySettlement, actor: int)
  requires inv(s) && canObserveExistingAward(s, actor)
  requires settlement__monthly_inv(observeExistingAward(s, actor).month) && settlement__escrow_inv(observeExistingAward(s, actor).escrow)
  ensures alwaysOneAwardPerObligation(observeExistingAward(s, actor))
  ensures alwaysPoolWithinUnreserved(observeExistingAward(s, actor))
  ensures alwaysAdmittedOnlyWhenFunded(observeExistingAward(s, actor))
  ensures alwaysPoolOnlyWhenAdmitted(observeExistingAward(s, actor))
  ensures alwaysPoolIsTheMonthRemainder(observeExistingAward(s, actor))
  ensures alwaysCursorInRange(observeExistingAward(s, actor))
  ensures alwaysReleasedMonthHasNoLeafAward(observeExistingAward(s, actor))
  ensures alwaysPendingPoolIsExactlyUnreserved(observeExistingAward(s, actor))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := observeExistingAward(s, actor);
  MsAwardsInv(s);
  MsObserveExisting(s, actor);
  MsOneAward(after);
}

lemma ObserveExistingAwardPart2a(s: MonthlySettlement, actor: int)
  requires inv(s) && canObserveExistingAward(s, actor)
  requires settlement__monthly_inv(observeExistingAward(s, actor).month) && settlement__escrow_inv(observeExistingAward(s, actor).escrow)
  ensures alwaysAdmittedLeavesUnconflicted(observeExistingAward(s, actor))
  ensures alwaysUnreservedSourcesFreeWhilePooled(observeExistingAward(s, actor))
  ensures alwaysLeafAwardsAreObligations(observeExistingAward(s, actor))
  ensures alwaysCursorSourceBacked(observeExistingAward(s, actor))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := observeExistingAward(s, actor);
  MsObligationsMatchInv(s);
  MsMonthlyObligationsMatch(after.month);
  MsObligationUpdated(s.month, after.month, actor, settlement__monthly_ObligationState.Reserved);
  MsNoRemainderWhenHeld(s, actor);
  settlement__money_lawEqualOrder_ensures(s.escrow.pending, admittedMonth(s).remaining, settlement__money_zero);
  MsLeavesVacuous(after);
}

lemma ObserveExistingAwardPart2b(s: MonthlySettlement, actor: int)
  requires inv(s) && canObserveExistingAward(s, actor)
  requires settlement__monthly_inv(observeExistingAward(s, actor).month) && settlement__escrow_inv(observeExistingAward(s, actor).escrow)
  ensures alwaysLeafAwardsReserveTheirObligation(observeExistingAward(s, actor))
  ensures alwaysAdmittedLeavesNeverConflict(observeExistingAward(s, actor))
  ensures alwaysObligationsMatchVault(observeExistingAward(s, actor))
  ensures stepObligationsOnFreshCoveringHead(s, "observeExistingAward", observeExistingAward(s, actor))
  ensures stepUnderfundedOnFreshHead(s, "observeExistingAward", observeExistingAward(s, actor))
  ensures stepCursorMonotoneByOne(s, observeExistingAward(s, actor))
  ensures stepRootAdmitsOnlyFreeSources(s, "observeExistingAward", observeExistingAward(s, actor))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := observeExistingAward(s, actor);
  MsObligationsMatchInv(s);
  MsMonthlyObligationsMatch(after.month);
  MsObligationUpdated(s.month, after.month, actor, settlement__monthly_ObligationState.Reserved);
  MsNoRemainderWhenHeld(s, actor);
  MsLeavesVacuous(after);
}

lemma observePaid_ensures(s: MonthlySettlement, actor: int)
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysOneAwardPerObligation(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysPoolWithinUnreserved(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysChildRules(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysChildLifecycle(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysChildInvariants(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysAdmittedOnlyWhenFunded(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysPoolOnlyWhenAdmitted(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysPoolIsTheMonthRemainder(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysCursorInRange(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysReleasedMonthHasNoLeafAward(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysPendingPoolIsExactlyUnreserved(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysAdmittedLeavesUnconflicted(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysUnreservedSourcesFreeWhilePooled(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysLeafAwardsAreObligations(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysCursorSourceBacked(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysLeafAwardsReserveTheirObligation(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysAdmittedLeavesNeverConflict(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> alwaysObligationsMatchVault(observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> stepObligationsOnFreshCoveringHead(s, "observePaid", observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> stepUnderfundedOnFreshHead(s, "observePaid", observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> stepCursorMonotoneByOne(s, observePaid(s, actor)))
  ensures (inv(s) ==> canObservePaid(s, actor) ==> stepRootAdmitsOnlyFreeSources(s, "observePaid", observePaid(s, actor)))
{
  hide *;
  if inv(s) && canObservePaid(s, actor) {
    ObservePaidChild(s, actor);
    ObservePaidPart1(s, actor);
    ObservePaidPart2a(s, actor);
    ObservePaidPart2b(s, actor);
  }
}

lemma ObservePaidChild(s: MonthlySettlement, actor: int)
  requires inv(s) && canObservePaid(s, actor)
  ensures alwaysChildRules(observePaid(s, actor))
  ensures alwaysChildLifecycle(observePaid(s, actor))
  ensures alwaysChildInvariants(observePaid(s, actor))
  ensures settlement__monthly_inv(observePaid(s, actor).month) && settlement__escrow_inv(observePaid(s, actor).escrow)
{
  hide *;
  reveal canObservePaid, observePaid, settlement__monthly_inv, settlement__escrow_inv;
  var after := observePaid(s, actor);
  MsChildInv(s);
  settlement__monthly_recordPaid_ensures(s.month, awardFact(s, actor, true));
  MsChildInvBack(s, after);
}

lemma ObservePaidPart1(s: MonthlySettlement, actor: int)
  requires inv(s) && canObservePaid(s, actor)
  requires settlement__monthly_inv(observePaid(s, actor).month) && settlement__escrow_inv(observePaid(s, actor).escrow)
  ensures alwaysOneAwardPerObligation(observePaid(s, actor))
  ensures alwaysPoolWithinUnreserved(observePaid(s, actor))
  ensures alwaysAdmittedOnlyWhenFunded(observePaid(s, actor))
  ensures alwaysPoolOnlyWhenAdmitted(observePaid(s, actor))
  ensures alwaysPoolIsTheMonthRemainder(observePaid(s, actor))
  ensures alwaysCursorInRange(observePaid(s, actor))
  ensures alwaysReleasedMonthHasNoLeafAward(observePaid(s, actor))
  ensures alwaysPendingPoolIsExactlyUnreserved(observePaid(s, actor))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := observePaid(s, actor);
  MsAwardsInv(s);
  MsObligationsMatchInv(s);
  MsMonthlyObligationsMatch(after.month);
  MsObligationUpdated(s.month, after.month, actor, settlement__monthly_ObligationState.Paid);
  MsOneAward(after);
}

lemma ObservePaidPart2a(s: MonthlySettlement, actor: int)
  requires inv(s) && canObservePaid(s, actor)
  requires settlement__monthly_inv(observePaid(s, actor).month) && settlement__escrow_inv(observePaid(s, actor).escrow)
  ensures alwaysAdmittedLeavesUnconflicted(observePaid(s, actor))
  ensures alwaysUnreservedSourcesFreeWhilePooled(observePaid(s, actor))
  ensures alwaysLeafAwardsAreObligations(observePaid(s, actor))
  ensures alwaysCursorSourceBacked(observePaid(s, actor))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := observePaid(s, actor);
  MsObligationsMatchInv(s);
  MsMonthlyObligationsMatch(after.month);
  MsObligationUpdated(s.month, after.month, actor, settlement__monthly_ObligationState.Paid);
  MsLeavesRecorded(s, after, actor, settlement__monthly_ObligationState.Paid);
}

lemma ObservePaidPart2b(s: MonthlySettlement, actor: int)
  requires inv(s) && canObservePaid(s, actor)
  requires settlement__monthly_inv(observePaid(s, actor).month) && settlement__escrow_inv(observePaid(s, actor).escrow)
  requires alwaysUnreservedSourcesFreeWhilePooled(observePaid(s, actor))
  requires alwaysPoolIsTheMonthRemainder(observePaid(s, actor))
  ensures alwaysLeafAwardsReserveTheirObligation(observePaid(s, actor))
  ensures alwaysAdmittedLeavesNeverConflict(observePaid(s, actor))
  ensures alwaysObligationsMatchVault(observePaid(s, actor))
  ensures stepObligationsOnFreshCoveringHead(s, "observePaid", observePaid(s, actor))
  ensures stepUnderfundedOnFreshHead(s, "observePaid", observePaid(s, actor))
  ensures stepCursorMonotoneByOne(s, observePaid(s, actor))
  ensures stepRootAdmitsOnlyFreeSources(s, "observePaid", observePaid(s, actor))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := observePaid(s, actor);
  MsObligationsMatchInv(s);
  MsMonthlyObligationsMatch(after.month);
  MsObligationUpdated(s.month, after.month, actor, settlement__monthly_ObligationState.Paid);
  MsLeavesRecorded(s, after, actor, settlement__monthly_ObligationState.Paid);
  assert alwaysObligationsMatchVault(after);
  MsLeavesNeverConflict(after);
}

lemma observeConflict_ensures(s: MonthlySettlement, actor: int)
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysOneAwardPerObligation(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysPoolWithinUnreserved(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysChildRules(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysChildLifecycle(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysChildInvariants(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysAdmittedOnlyWhenFunded(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysPoolOnlyWhenAdmitted(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysPoolIsTheMonthRemainder(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysCursorInRange(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysReleasedMonthHasNoLeafAward(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysPendingPoolIsExactlyUnreserved(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysAdmittedLeavesUnconflicted(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysUnreservedSourcesFreeWhilePooled(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysLeafAwardsAreObligations(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysCursorSourceBacked(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysLeafAwardsReserveTheirObligation(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysAdmittedLeavesNeverConflict(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> alwaysObligationsMatchVault(observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> stepObligationsOnFreshCoveringHead(s, "observeConflict", observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> stepUnderfundedOnFreshHead(s, "observeConflict", observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> stepCursorMonotoneByOne(s, observeConflict(s, actor)))
  ensures (inv(s) ==> canObserveConflict(s, actor) ==> stepRootAdmitsOnlyFreeSources(s, "observeConflict", observeConflict(s, actor)))
{
  hide *;
  if inv(s) && canObserveConflict(s, actor) {
    ObserveConflictChild(s, actor);
    ObserveConflictPart1(s, actor);
    ObserveConflictPart2a(s, actor);
    ObserveConflictPart2b(s, actor);
  }
}

lemma ObserveConflictChild(s: MonthlySettlement, actor: int)
  requires inv(s) && canObserveConflict(s, actor)
  ensures alwaysChildRules(observeConflict(s, actor))
  ensures alwaysChildLifecycle(observeConflict(s, actor))
  ensures alwaysChildInvariants(observeConflict(s, actor))
  ensures settlement__monthly_inv(observeConflict(s, actor).month) && settlement__escrow_inv(observeConflict(s, actor).escrow)
{
  hide *;
  reveal canObserveConflict, observeConflict, settlement__monthly_inv, settlement__escrow_inv;
  var after := observeConflict(s, actor);
  MsChildInv(s);
  settlement__monthly_recordConflict_ensures(s.month, observedFact(s, actor));
  MsChildInvBack(s, after);
}

lemma ObserveConflictPart1(s: MonthlySettlement, actor: int)
  requires inv(s) && canObserveConflict(s, actor)
  requires settlement__monthly_inv(observeConflict(s, actor).month) && settlement__escrow_inv(observeConflict(s, actor).escrow)
  ensures alwaysOneAwardPerObligation(observeConflict(s, actor))
  ensures alwaysPoolWithinUnreserved(observeConflict(s, actor))
  ensures alwaysAdmittedOnlyWhenFunded(observeConflict(s, actor))
  ensures alwaysPoolOnlyWhenAdmitted(observeConflict(s, actor))
  ensures alwaysPoolIsTheMonthRemainder(observeConflict(s, actor))
  ensures alwaysCursorInRange(observeConflict(s, actor))
  ensures alwaysReleasedMonthHasNoLeafAward(observeConflict(s, actor))
  ensures alwaysPendingPoolIsExactlyUnreserved(observeConflict(s, actor))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := observeConflict(s, actor);
  MsAwardsInv(s);
  MsMonthsInv(s);
  MsMonthlyAlloc(after.month);
  MsMonthlyObligationsMatch(after.month);
  MsOneAward(after);
  MsConflictUnpooled(s, actor);
  MsMonthValid(s.escrow, s.month.period);
  MsAmountsValid(after.month);
  MsPoolBound(after);
}

lemma ObserveConflictPart2a(s: MonthlySettlement, actor: int)
  requires inv(s) && canObserveConflict(s, actor)
  requires settlement__monthly_inv(observeConflict(s, actor).month) && settlement__escrow_inv(observeConflict(s, actor).escrow)
  ensures alwaysAdmittedLeavesUnconflicted(observeConflict(s, actor))
  ensures alwaysUnreservedSourcesFreeWhilePooled(observeConflict(s, actor))
  ensures alwaysLeafAwardsAreObligations(observeConflict(s, actor))
  ensures alwaysCursorSourceBacked(observeConflict(s, actor))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := observeConflict(s, actor);
  MsObligationsMatchInv(s);
  MsMonthlyObligationsMatch(after.month);
  MsObligationUpdated(s.month, after.month, actor, settlement__monthly_ObligationState.Conflicted);
  MsConflictUnpooled(s, actor);
  assert alwaysPoolIsTheMonthRemainder(s);
  settlement__money_lawEqualOrder_ensures(s.escrow.pending, admittedMonth(s).remaining, settlement__money_zero);
  MsLeavesVacuous(after);
}

lemma ObserveConflictPart2b(s: MonthlySettlement, actor: int)
  requires inv(s) && canObserveConflict(s, actor)
  requires settlement__monthly_inv(observeConflict(s, actor).month) && settlement__escrow_inv(observeConflict(s, actor).escrow)
  ensures alwaysLeafAwardsReserveTheirObligation(observeConflict(s, actor))
  ensures alwaysAdmittedLeavesNeverConflict(observeConflict(s, actor))
  ensures alwaysObligationsMatchVault(observeConflict(s, actor))
  ensures stepObligationsOnFreshCoveringHead(s, "observeConflict", observeConflict(s, actor))
  ensures stepUnderfundedOnFreshHead(s, "observeConflict", observeConflict(s, actor))
  ensures stepCursorMonotoneByOne(s, observeConflict(s, actor))
  ensures stepRootAdmitsOnlyFreeSources(s, "observeConflict", observeConflict(s, actor))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := observeConflict(s, actor);
  MsObligationsMatchInv(s);
  MsMonthlyObligationsMatch(after.month);
  MsObligationUpdated(s.month, after.month, actor, settlement__monthly_ObligationState.Conflicted);
  MsConflictUnpooled(s, actor);
  MsLeavesVacuous(after);
  forall a | a in settlement__escrow_awardActorsFor(after.escrow, after.month.project, after.month.period) ensures leafAwardReserves(after, a) {
    assert leafAwardReserves(s, a);
    if a == actor && settlement__escrow_awardFor(s.escrow, sourceOf(s, a)).origin.MonthlyLeaf? {
      assert alwaysLeafAwardsAreObligations(s);
      assert chainActor(s, actor) == actor;
      assert chainMatches(s, actor);
    }
  }
}

lemma admitRoot_ensures(s: MonthlySettlement, authorization: settlement__escrow_RootAuthorization, ev: settlement__escrow_ChainEvent)
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysOneAwardPerObligation(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysPoolWithinUnreserved(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysChildRules(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysChildLifecycle(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysChildInvariants(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysAdmittedOnlyWhenFunded(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysPoolOnlyWhenAdmitted(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysPoolIsTheMonthRemainder(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysCursorInRange(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysReleasedMonthHasNoLeafAward(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysPendingPoolIsExactlyUnreserved(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysAdmittedLeavesUnconflicted(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysUnreservedSourcesFreeWhilePooled(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysLeafAwardsAreObligations(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysCursorSourceBacked(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysLeafAwardsReserveTheirObligation(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysAdmittedLeavesNeverConflict(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> alwaysObligationsMatchVault(admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> stepObligationsOnFreshCoveringHead(s, "admitRoot", admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> stepUnderfundedOnFreshHead(s, "admitRoot", admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> stepCursorMonotoneByOne(s, admitRoot(s, authorization, ev)))
  ensures (inv(s) ==> canAdmitRoot(s, authorization, ev) ==> stepRootAdmitsOnlyFreeSources(s, "admitRoot", admitRoot(s, authorization, ev)))
{
  hide *;
  if inv(s) && canAdmitRoot(s, authorization, ev) {
    AdmitRootChild(s, authorization, ev);
    AdmitRootPart1a(s, authorization, ev);
    AdmitRootPart1b(s, authorization, ev);
    AdmitRootPart2a(s, authorization, ev);
    AdmitRootPart2b(s, authorization, ev);
  }
}

lemma AdmitRootChild(s: MonthlySettlement, authorization: settlement__escrow_RootAuthorization, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canAdmitRoot(s, authorization, ev)
  ensures alwaysChildRules(admitRoot(s, authorization, ev))
  ensures alwaysChildLifecycle(admitRoot(s, authorization, ev))
  ensures alwaysChildInvariants(admitRoot(s, authorization, ev))
  ensures settlement__monthly_inv(admitRoot(s, authorization, ev).month) && settlement__escrow_inv(admitRoot(s, authorization, ev).escrow)
{
  hide *;
  reveal canAdmitRoot, admitRoot, settlement__monthly_inv, settlement__escrow_inv;
  var after := admitRoot(s, authorization, ev);
  MsChildInv(s);
  settlement__escrow_admitRoot_ensures(s.escrow, authorization, ev);
  MsChildInvBack(s, after);
}

lemma AdmitRootPart1a(s: MonthlySettlement, authorization: settlement__escrow_RootAuthorization, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canAdmitRoot(s, authorization, ev)
  requires settlement__monthly_inv(admitRoot(s, authorization, ev).month) && settlement__escrow_inv(admitRoot(s, authorization, ev).escrow)
  ensures alwaysOneAwardPerObligation(admitRoot(s, authorization, ev))
  ensures alwaysPoolWithinUnreserved(admitRoot(s, authorization, ev))
  ensures alwaysAdmittedOnlyWhenFunded(admitRoot(s, authorization, ev))
  ensures alwaysPoolOnlyWhenAdmitted(admitRoot(s, authorization, ev))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := admitRoot(s, authorization, ev);
  MsMonthsInv(s);
  MsEscrowMonths(after.escrow);
  MsEscrowAwards(after.escrow);
  MsNoAdmittedMonth(s);
  MsMonthIs(after.escrow, 0);
  MsFrame(s, after);
  MsOneAward(after);
}

lemma AdmitRootPart1b(s: MonthlySettlement, authorization: settlement__escrow_RootAuthorization, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canAdmitRoot(s, authorization, ev)
  requires settlement__monthly_inv(admitRoot(s, authorization, ev).month) && settlement__escrow_inv(admitRoot(s, authorization, ev).escrow)
  ensures alwaysPoolIsTheMonthRemainder(admitRoot(s, authorization, ev))
  ensures alwaysCursorInRange(admitRoot(s, authorization, ev))
  ensures alwaysReleasedMonthHasNoLeafAward(admitRoot(s, authorization, ev))
  ensures alwaysPendingPoolIsExactlyUnreserved(admitRoot(s, authorization, ev))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := admitRoot(s, authorization, ev);
  MsMonthsInv(s);
  MsEscrowMonths(after.escrow);
  MsReleaseRulesInv(s);
  MsNoAdmittedMonth(s);
  MsMonthIs(after.escrow, 0);
  var g := authorization.remainingGross;
  settlement__money_lawAddCongruence_ensures(s.escrow.pending, settlement__money_zero, g);
  settlement__money_lawAddCommutative_ensures(settlement__money_zero, g);
  settlement__money_lawZeroIdentity_ensures(g);
  settlement__money_lawAdditionValid_ensures(s.escrow.pending, g);
  settlement__money_lawAdditionValid_ensures(settlement__money_zero, g);
  settlement__money_lawAdditionValid_ensures(g, settlement__money_zero);
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(s.escrow.pending, g), settlement__money_addAmounts(settlement__money_zero, g), settlement__money_addAmounts(g, settlement__money_zero));
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(s.escrow.pending, g), settlement__money_addAmounts(g, settlement__money_zero), g);
  settlement__money_lawEqualReflexive_ensures(g);
  settlement__money_lawEqualReflexive_ensures(settlement__money_zero);
  settlement__money_lawZeroOrder_ensures(settlement__money_zero);
}

lemma AdmitRootPart2a(s: MonthlySettlement, authorization: settlement__escrow_RootAuthorization, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canAdmitRoot(s, authorization, ev)
  requires settlement__monthly_inv(admitRoot(s, authorization, ev).month) && settlement__escrow_inv(admitRoot(s, authorization, ev).escrow)
  ensures alwaysAdmittedLeavesUnconflicted(admitRoot(s, authorization, ev))
  ensures alwaysUnreservedSourcesFreeWhilePooled(admitRoot(s, authorization, ev))
  ensures alwaysLeafAwardsAreObligations(admitRoot(s, authorization, ev))
  ensures alwaysCursorSourceBacked(admitRoot(s, authorization, ev))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := admitRoot(s, authorization, ev);
  MsNoAdmittedMonth(s);
  assert s.cursor.root == "";
  MsFrame(s, after);
  MsAdmitLeaves(s, authorization, ev);
}

lemma AdmitRootPart2b(s: MonthlySettlement, authorization: settlement__escrow_RootAuthorization, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canAdmitRoot(s, authorization, ev)
  requires settlement__monthly_inv(admitRoot(s, authorization, ev).month) && settlement__escrow_inv(admitRoot(s, authorization, ev).escrow)
  requires alwaysUnreservedSourcesFreeWhilePooled(admitRoot(s, authorization, ev))
  requires alwaysPoolIsTheMonthRemainder(admitRoot(s, authorization, ev))
  ensures alwaysLeafAwardsReserveTheirObligation(admitRoot(s, authorization, ev))
  ensures alwaysAdmittedLeavesNeverConflict(admitRoot(s, authorization, ev))
  ensures alwaysObligationsMatchVault(admitRoot(s, authorization, ev))
  ensures stepObligationsOnFreshCoveringHead(s, "admitRoot", admitRoot(s, authorization, ev))
  ensures stepUnderfundedOnFreshHead(s, "admitRoot", admitRoot(s, authorization, ev))
  ensures stepCursorMonotoneByOne(s, admitRoot(s, authorization, ev))
  ensures stepRootAdmitsOnlyFreeSources(s, "admitRoot", admitRoot(s, authorization, ev))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := admitRoot(s, authorization, ev);
  MsFrame(s, after);
  MsAdmitLeaves(s, authorization, ev);
  MsLeavesNeverConflict(after);
}

lemma materialize_ensures(s: MonthlySettlement, proof: settlement__escrow_LeafProof, ev: settlement__escrow_ChainEvent)
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysOneAwardPerObligation(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysPoolWithinUnreserved(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysChildRules(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysChildLifecycle(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysChildInvariants(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysAdmittedOnlyWhenFunded(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysPoolOnlyWhenAdmitted(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysPoolIsTheMonthRemainder(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysCursorInRange(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysReleasedMonthHasNoLeafAward(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysPendingPoolIsExactlyUnreserved(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysAdmittedLeavesUnconflicted(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysUnreservedSourcesFreeWhilePooled(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysLeafAwardsAreObligations(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysCursorSourceBacked(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysLeafAwardsReserveTheirObligation(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysAdmittedLeavesNeverConflict(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> alwaysObligationsMatchVault(materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> stepObligationsOnFreshCoveringHead(s, "materialize", materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> stepUnderfundedOnFreshHead(s, "materialize", materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> stepCursorMonotoneByOne(s, materialize(s, proof, ev)))
  ensures (inv(s) ==> canMaterialize(s, proof, ev) ==> stepRootAdmitsOnlyFreeSources(s, "materialize", materialize(s, proof, ev)))
{
  hide *;
  if inv(s) && canMaterialize(s, proof, ev) {
    MaterializeChild(s, proof, ev);
    MaterializePart1a(s, proof, ev);
    MaterializePart1b(s, proof, ev);
    MaterializePart2a(s, proof, ev);
    MaterializePart2b(s, proof, ev);
    MaterializePart2d(s, proof, ev);
    MaterializePart2c(s, proof, ev);
  }
}

lemma MaterializeChild(s: MonthlySettlement, proof: settlement__escrow_LeafProof, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canMaterialize(s, proof, ev)
  ensures alwaysChildRules(materialize(s, proof, ev))
  ensures alwaysChildLifecycle(materialize(s, proof, ev))
  ensures alwaysChildInvariants(materialize(s, proof, ev))
  ensures settlement__monthly_inv(materialize(s, proof, ev).month) && settlement__escrow_inv(materialize(s, proof, ev).escrow)
{
  hide *;
  reveal canMaterialize, materialize, settlement__monthly_inv, settlement__escrow_inv;
  var after := materialize(s, proof, ev);
  MsChildInv(s);
  settlement__escrow_materialize_ensures(s.escrow, proof, ev);
  settlement__monthly_recordReserved_ensures(s.month, awardFact(s, proof.actor, false));
  MsChildInvBack(s, after);
}

lemma MaterializePart1a(s: MonthlySettlement, proof: settlement__escrow_LeafProof, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canMaterialize(s, proof, ev)
  requires settlement__monthly_inv(materialize(s, proof, ev).month) && settlement__escrow_inv(materialize(s, proof, ev).escrow)
  ensures alwaysOneAwardPerObligation(materialize(s, proof, ev))
  ensures alwaysPoolWithinUnreserved(materialize(s, proof, ev))
  ensures alwaysAdmittedOnlyWhenFunded(materialize(s, proof, ev))
  ensures alwaysPoolOnlyWhenAdmitted(materialize(s, proof, ev))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := materialize(s, proof, ev);
  MsEscrowAwards(after.escrow);
  MsMaterializeRemaining(s, proof, ev);
  MsOneAward(after);
}

lemma MaterializePart1b(s: MonthlySettlement, proof: settlement__escrow_LeafProof, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canMaterialize(s, proof, ev)
  requires settlement__monthly_inv(materialize(s, proof, ev).month) && settlement__escrow_inv(materialize(s, proof, ev).escrow)
  ensures alwaysPoolIsTheMonthRemainder(materialize(s, proof, ev))
  ensures alwaysCursorInRange(materialize(s, proof, ev))
  ensures alwaysReleasedMonthHasNoLeafAward(materialize(s, proof, ev))
  ensures alwaysPendingPoolIsExactlyUnreserved(materialize(s, proof, ev))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  MsMaterializeRemaining(s, proof, ev);
  MsMaterializeUnreleased(s, proof, ev);
}

lemma MaterializePart2a(s: MonthlySettlement, proof: settlement__escrow_LeafProof, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canMaterialize(s, proof, ev)
  requires settlement__monthly_inv(materialize(s, proof, ev).month) && settlement__escrow_inv(materialize(s, proof, ev).escrow)
  ensures alwaysAdmittedLeavesUnconflicted(materialize(s, proof, ev))
  ensures alwaysUnreservedSourcesFreeWhilePooled(materialize(s, proof, ev))
  ensures alwaysLeafAwardsAreObligations(materialize(s, proof, ev))
  ensures alwaysCursorSourceBacked(materialize(s, proof, ev))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := materialize(s, proof, ev);
  MsObligationsMatchInv(s);
  MsMonthlyObligationsMatch(after.month);
  var nw := after.escrow.awards[|s.escrow.awards|];
  assert after.escrow.awards == s.escrow.awards + [nw];
  MsWithAwardFacts(s.escrow, nw, after.escrow);
  MsObligationUpdated(s.month, after.month, proof.actor, settlement__monthly_ObligationState.Reserved);
  MsLeafFromPositive(s, proof, ev);
  MsLeavesRecorded(s, after, proof.actor, settlement__monthly_ObligationState.Reserved);
  assert alwaysPoolIsTheMonthRemainder(s);
  settlement__money_lawEqualOrder_ensures(s.escrow.pending, admittedMonth(s).remaining, settlement__money_zero);
  MsListed(s.month, proof.actor);
}

lemma MaterializePart2b(s: MonthlySettlement, proof: settlement__escrow_LeafProof, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canMaterialize(s, proof, ev)
  requires settlement__monthly_inv(materialize(s, proof, ev).month) && settlement__escrow_inv(materialize(s, proof, ev).escrow)
  ensures alwaysLeafAwardsReserveTheirObligation(materialize(s, proof, ev))
{
  hide inv, alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := materialize(s, proof, ev);
  MsLeafReservesInv(s);
  MsObligationsMatchInv(s);
  MsMonthlyObligationsMatch(after.month);
  var nw := after.escrow.awards[|s.escrow.awards|];
  assert after.escrow.awards == s.escrow.awards + [nw];
  MsWithAwardFacts(s.escrow, nw, after.escrow);
  MsObligationUpdated(s.month, after.month, proof.actor, settlement__monthly_ObligationState.Reserved);
}

lemma MaterializePart2d(s: MonthlySettlement, proof: settlement__escrow_LeafProof, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canMaterialize(s, proof, ev)
  requires settlement__monthly_inv(materialize(s, proof, ev).month) && settlement__escrow_inv(materialize(s, proof, ev).escrow)
  ensures alwaysObligationsMatchVault(materialize(s, proof, ev))
{
  hide inv, alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := materialize(s, proof, ev);
  MsObligationsMatchVaultInv(s);
  MsObligationsMatchInv(s);
  MsMonthlyObligationsMatch(after.month);
  var nw := after.escrow.awards[|s.escrow.awards|];
  assert after.escrow.awards == s.escrow.awards + [nw];
  MsWithAwardFacts(s.escrow, nw, after.escrow);
  MsObligationUpdated(s.month, after.month, proof.actor, settlement__monthly_ObligationState.Reserved);
}

lemma MaterializePart2c(s: MonthlySettlement, proof: settlement__escrow_LeafProof, ev: settlement__escrow_ChainEvent)
  requires inv(s) && canMaterialize(s, proof, ev)
  requires alwaysAdmittedLeavesUnconflicted(materialize(s, proof, ev))
  requires alwaysObligationsMatchVault(materialize(s, proof, ev))
  requires alwaysUnreservedSourcesFreeWhilePooled(materialize(s, proof, ev))
  requires alwaysPoolIsTheMonthRemainder(materialize(s, proof, ev))
  ensures alwaysAdmittedLeavesNeverConflict(materialize(s, proof, ev))
  ensures stepObligationsOnFreshCoveringHead(s, "materialize", materialize(s, proof, ev))
  ensures stepUnderfundedOnFreshHead(s, "materialize", materialize(s, proof, ev))
  ensures stepCursorMonotoneByOne(s, materialize(s, proof, ev))
  ensures stepRootAdmitsOnlyFreeSources(s, "materialize", materialize(s, proof, ev))
{
  hide *;
  reveal materialize, stepObligationsOnFreshCoveringHead, stepUnderfundedOnFreshHead, stepCursorMonotoneByOne, stepRootAdmitsOnlyFreeSources;
  MsLeavesNeverConflict(materialize(s, proof, ev));
}

lemma advanceCursor_ensures(s: MonthlySettlement, proof: settlement__escrow_LeafProof, nonceSettled: bool)
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysOneAwardPerObligation(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysPoolWithinUnreserved(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysChildRules(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysChildLifecycle(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysChildInvariants(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysAdmittedOnlyWhenFunded(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysPoolOnlyWhenAdmitted(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysPoolIsTheMonthRemainder(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysCursorInRange(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysReleasedMonthHasNoLeafAward(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysPendingPoolIsExactlyUnreserved(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysAdmittedLeavesUnconflicted(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysUnreservedSourcesFreeWhilePooled(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysLeafAwardsAreObligations(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysCursorSourceBacked(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysLeafAwardsReserveTheirObligation(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysAdmittedLeavesNeverConflict(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> alwaysObligationsMatchVault(advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> stepObligationsOnFreshCoveringHead(s, "advanceCursor", advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> stepUnderfundedOnFreshHead(s, "advanceCursor", advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> stepCursorMonotoneByOne(s, advanceCursor(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceCursor(s, proof, nonceSettled) ==> stepRootAdmitsOnlyFreeSources(s, "advanceCursor", advanceCursor(s, proof, nonceSettled)))
{
  hide *;
  if inv(s) && canAdvanceCursor(s, proof, nonceSettled) {
    AdvanceCursorChild(s, proof, nonceSettled);
    AdvanceCursorPart1(s, proof, nonceSettled);
    AdvanceCursorPart2(s, proof, nonceSettled);
  }
}

lemma AdvanceCursorChild(s: MonthlySettlement, proof: settlement__escrow_LeafProof, nonceSettled: bool)
  requires inv(s) && canAdvanceCursor(s, proof, nonceSettled)
  ensures alwaysChildRules(advanceCursor(s, proof, nonceSettled))
  ensures alwaysChildLifecycle(advanceCursor(s, proof, nonceSettled))
  ensures alwaysChildInvariants(advanceCursor(s, proof, nonceSettled))
{
  hide *;
  reveal advanceCursor;
  var after := advanceCursor(s, proof, nonceSettled);
  MsChildInv(s);
  MsChildInvBack(s, after);
}

lemma AdvanceCursorPart1(s: MonthlySettlement, proof: settlement__escrow_LeafProof, nonceSettled: bool)
  requires inv(s) && canAdvanceCursor(s, proof, nonceSettled)
  ensures alwaysOneAwardPerObligation(advanceCursor(s, proof, nonceSettled))
  ensures alwaysPoolWithinUnreserved(advanceCursor(s, proof, nonceSettled))
  ensures alwaysAdmittedOnlyWhenFunded(advanceCursor(s, proof, nonceSettled))
  ensures alwaysPoolOnlyWhenAdmitted(advanceCursor(s, proof, nonceSettled))
  ensures alwaysPoolIsTheMonthRemainder(advanceCursor(s, proof, nonceSettled))
  ensures alwaysCursorInRange(advanceCursor(s, proof, nonceSettled))
  ensures alwaysReleasedMonthHasNoLeafAward(advanceCursor(s, proof, nonceSettled))
  ensures alwaysPendingPoolIsExactlyUnreserved(advanceCursor(s, proof, nonceSettled))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := advanceCursor(s, proof, nonceSettled);
  MsMonthsInv(s);
  MsUniqueAdmittedMonth(s);
  MsFrame(s, after);
}

lemma AdvanceCursorPart2(s: MonthlySettlement, proof: settlement__escrow_LeafProof, nonceSettled: bool)
  requires inv(s) && canAdvanceCursor(s, proof, nonceSettled)
  ensures alwaysAdmittedLeavesUnconflicted(advanceCursor(s, proof, nonceSettled))
  ensures alwaysUnreservedSourcesFreeWhilePooled(advanceCursor(s, proof, nonceSettled))
  ensures alwaysLeafAwardsAreObligations(advanceCursor(s, proof, nonceSettled))
  ensures alwaysCursorSourceBacked(advanceCursor(s, proof, nonceSettled))
  ensures alwaysLeafAwardsReserveTheirObligation(advanceCursor(s, proof, nonceSettled))
  ensures alwaysAdmittedLeavesNeverConflict(advanceCursor(s, proof, nonceSettled))
  ensures alwaysObligationsMatchVault(advanceCursor(s, proof, nonceSettled))
  ensures stepObligationsOnFreshCoveringHead(s, "advanceCursor", advanceCursor(s, proof, nonceSettled))
  ensures stepUnderfundedOnFreshHead(s, "advanceCursor", advanceCursor(s, proof, nonceSettled))
  ensures stepCursorMonotoneByOne(s, advanceCursor(s, proof, nonceSettled))
  ensures stepRootAdmitsOnlyFreeSources(s, "advanceCursor", advanceCursor(s, proof, nonceSettled))
{
  var after := advanceCursor(s, proof, nonceSettled);
  MsChildInv(s);
  MsFrame(s, after);
  MsLeavesFrame(s, after);
  MsLeavesNeverConflict(after);
}

lemma advanceZeroRemaining_ensures(s: MonthlySettlement, proof: settlement__escrow_LeafProof, nonceSettled: bool)
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysOneAwardPerObligation(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysPoolWithinUnreserved(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysChildRules(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysChildLifecycle(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysChildInvariants(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysAdmittedOnlyWhenFunded(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysPoolOnlyWhenAdmitted(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysPoolIsTheMonthRemainder(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysCursorInRange(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysReleasedMonthHasNoLeafAward(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysPendingPoolIsExactlyUnreserved(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysAdmittedLeavesUnconflicted(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysUnreservedSourcesFreeWhilePooled(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysLeafAwardsAreObligations(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysCursorSourceBacked(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysLeafAwardsReserveTheirObligation(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysAdmittedLeavesNeverConflict(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> alwaysObligationsMatchVault(advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> stepObligationsOnFreshCoveringHead(s, "advanceZeroRemaining", advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> stepUnderfundedOnFreshHead(s, "advanceZeroRemaining", advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> stepCursorMonotoneByOne(s, advanceZeroRemaining(s, proof, nonceSettled)))
  ensures (inv(s) ==> canAdvanceZeroRemaining(s, proof, nonceSettled) ==> stepRootAdmitsOnlyFreeSources(s, "advanceZeroRemaining", advanceZeroRemaining(s, proof, nonceSettled)))
{
  hide *;
  if inv(s) && canAdvanceZeroRemaining(s, proof, nonceSettled) {
    AdvanceZeroRemainingChild(s, proof, nonceSettled);
    AdvanceZeroRemainingPart1(s, proof, nonceSettled);
    AdvanceZeroRemainingPart2(s, proof, nonceSettled);
  }
}

lemma AdvanceZeroRemainingChild(s: MonthlySettlement, proof: settlement__escrow_LeafProof, nonceSettled: bool)
  requires inv(s) && canAdvanceZeroRemaining(s, proof, nonceSettled)
  ensures alwaysChildRules(advanceZeroRemaining(s, proof, nonceSettled))
  ensures alwaysChildLifecycle(advanceZeroRemaining(s, proof, nonceSettled))
  ensures alwaysChildInvariants(advanceZeroRemaining(s, proof, nonceSettled))
{
  hide *;
  reveal advanceZeroRemaining;
  var after := advanceZeroRemaining(s, proof, nonceSettled);
  MsChildInv(s);
  MsChildInvBack(s, after);
}

lemma AdvanceZeroRemainingPart1(s: MonthlySettlement, proof: settlement__escrow_LeafProof, nonceSettled: bool)
  requires inv(s) && canAdvanceZeroRemaining(s, proof, nonceSettled)
  ensures alwaysOneAwardPerObligation(advanceZeroRemaining(s, proof, nonceSettled))
  ensures alwaysPoolWithinUnreserved(advanceZeroRemaining(s, proof, nonceSettled))
  ensures alwaysAdmittedOnlyWhenFunded(advanceZeroRemaining(s, proof, nonceSettled))
  ensures alwaysPoolOnlyWhenAdmitted(advanceZeroRemaining(s, proof, nonceSettled))
  ensures alwaysPoolIsTheMonthRemainder(advanceZeroRemaining(s, proof, nonceSettled))
  ensures alwaysCursorInRange(advanceZeroRemaining(s, proof, nonceSettled))
  ensures alwaysReleasedMonthHasNoLeafAward(advanceZeroRemaining(s, proof, nonceSettled))
  ensures alwaysPendingPoolIsExactlyUnreserved(advanceZeroRemaining(s, proof, nonceSettled))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := advanceZeroRemaining(s, proof, nonceSettled);
  MsMonthsInv(s);
  MsUniqueAdmittedMonth(s);
  MsFrame(s, after);
}

lemma AdvanceZeroRemainingPart2(s: MonthlySettlement, proof: settlement__escrow_LeafProof, nonceSettled: bool)
  requires inv(s) && canAdvanceZeroRemaining(s, proof, nonceSettled)
  ensures alwaysAdmittedLeavesUnconflicted(advanceZeroRemaining(s, proof, nonceSettled))
  ensures alwaysUnreservedSourcesFreeWhilePooled(advanceZeroRemaining(s, proof, nonceSettled))
  ensures alwaysLeafAwardsAreObligations(advanceZeroRemaining(s, proof, nonceSettled))
  ensures alwaysCursorSourceBacked(advanceZeroRemaining(s, proof, nonceSettled))
  ensures alwaysLeafAwardsReserveTheirObligation(advanceZeroRemaining(s, proof, nonceSettled))
  ensures alwaysAdmittedLeavesNeverConflict(advanceZeroRemaining(s, proof, nonceSettled))
  ensures alwaysObligationsMatchVault(advanceZeroRemaining(s, proof, nonceSettled))
  ensures stepObligationsOnFreshCoveringHead(s, "advanceZeroRemaining", advanceZeroRemaining(s, proof, nonceSettled))
  ensures stepUnderfundedOnFreshHead(s, "advanceZeroRemaining", advanceZeroRemaining(s, proof, nonceSettled))
  ensures stepCursorMonotoneByOne(s, advanceZeroRemaining(s, proof, nonceSettled))
  ensures stepRootAdmitsOnlyFreeSources(s, "advanceZeroRemaining", advanceZeroRemaining(s, proof, nonceSettled))
{
  var after := advanceZeroRemaining(s, proof, nonceSettled);
  MsChildInv(s);
  MsFrame(s, after);
  MsLeavesFrame(s, after);
  MsLeavesNeverConflict(after);
}

lemma withdraw_ensures(s: MonthlySettlement, gross: seq<int>, ev: settlement__escrow_ChainEvent, by_: string)
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysOneAwardPerObligation(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysPoolWithinUnreserved(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysChildRules(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysChildLifecycle(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysChildInvariants(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysAdmittedOnlyWhenFunded(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysPoolOnlyWhenAdmitted(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysPoolIsTheMonthRemainder(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysCursorInRange(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysReleasedMonthHasNoLeafAward(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysPendingPoolIsExactlyUnreserved(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysAdmittedLeavesUnconflicted(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysUnreservedSourcesFreeWhilePooled(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysLeafAwardsAreObligations(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysCursorSourceBacked(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysLeafAwardsReserveTheirObligation(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysAdmittedLeavesNeverConflict(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> alwaysObligationsMatchVault(withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> stepObligationsOnFreshCoveringHead(s, "withdraw", withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> stepUnderfundedOnFreshHead(s, "withdraw", withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> stepCursorMonotoneByOne(s, withdraw(s, gross, ev, by_)))
  ensures (inv(s) ==> canWithdraw(s, gross, ev, by_) ==> stepRootAdmitsOnlyFreeSources(s, "withdraw", withdraw(s, gross, ev, by_)))
{
  if inv(s) && canWithdraw(s, gross, ev, by_) {
    var after := withdraw(s, gross, ev, by_);
    MsChildInv(s);
    settlement__escrow_withdraw_ensures(s.escrow, gross, ev, by_);
    MsChildInvBack(s, after);
    MsEscrowOnlyFrame(s, after);
  }
}

lemma upgradeToRelease_ensures(s: MonthlySettlement, ev: settlement__escrow_ChainEvent)
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysOneAwardPerObligation(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysPoolWithinUnreserved(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysChildRules(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysChildLifecycle(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysChildInvariants(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysAdmittedOnlyWhenFunded(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysPoolOnlyWhenAdmitted(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysPoolIsTheMonthRemainder(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysCursorInRange(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysReleasedMonthHasNoLeafAward(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysPendingPoolIsExactlyUnreserved(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysAdmittedLeavesUnconflicted(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysUnreservedSourcesFreeWhilePooled(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysLeafAwardsAreObligations(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysCursorSourceBacked(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysLeafAwardsReserveTheirObligation(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysAdmittedLeavesNeverConflict(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> alwaysObligationsMatchVault(upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> stepObligationsOnFreshCoveringHead(s, "upgradeToRelease", upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> stepUnderfundedOnFreshHead(s, "upgradeToRelease", upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> stepCursorMonotoneByOne(s, upgradeToRelease(s, ev)))
  ensures (inv(s) ==> canUpgradeToRelease(s, ev) ==> stepRootAdmitsOnlyFreeSources(s, "upgradeToRelease", upgradeToRelease(s, ev)))
{
  if inv(s) && canUpgradeToRelease(s, ev) {
    var after := upgradeToRelease(s, ev);
    MsChildInv(s);
    settlement__escrow_upgradeToRelease_ensures(s.escrow, ev);
    MsChildInvBack(s, after);
    MsEscrowOnlyFrame(s, after);
  }
}

lemma releaseReserve_ensures(s: MonthlySettlement, release: settlement__escrow_ReleaseAuthorization, ev: settlement__escrow_ChainEvent, by_: string)
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysOneAwardPerObligation(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysPoolWithinUnreserved(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysChildRules(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysChildLifecycle(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysChildInvariants(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysAdmittedOnlyWhenFunded(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysPoolOnlyWhenAdmitted(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysPoolIsTheMonthRemainder(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysCursorInRange(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysReleasedMonthHasNoLeafAward(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysPendingPoolIsExactlyUnreserved(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysAdmittedLeavesUnconflicted(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysUnreservedSourcesFreeWhilePooled(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysLeafAwardsAreObligations(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysCursorSourceBacked(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysLeafAwardsReserveTheirObligation(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysAdmittedLeavesNeverConflict(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> alwaysObligationsMatchVault(releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> stepObligationsOnFreshCoveringHead(s, "releaseReserve", releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> stepUnderfundedOnFreshHead(s, "releaseReserve", releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> stepCursorMonotoneByOne(s, releaseReserve(s, release, ev, by_)))
  ensures (inv(s) ==> canReleaseReserve(s, release, ev, by_) ==> stepRootAdmitsOnlyFreeSources(s, "releaseReserve", releaseReserve(s, release, ev, by_)))
{
  hide *;
  if inv(s) && canReleaseReserve(s, release, ev, by_) {
    ReleaseReserveChild(s, release, ev, by_);
    ReleaseReservePart1a(s, release, ev, by_);
    ReleaseReservePart1b(s, release, ev, by_);
    ReleaseReservePart2a(s, release, ev, by_);
    ReleaseReservePart2b(s, release, ev, by_);
  }
}

lemma ReleaseReserveChild(s: MonthlySettlement, release: settlement__escrow_ReleaseAuthorization, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canReleaseReserve(s, release, ev, by_)
  ensures alwaysChildRules(releaseReserve(s, release, ev, by_))
  ensures alwaysChildLifecycle(releaseReserve(s, release, ev, by_))
  ensures alwaysChildInvariants(releaseReserve(s, release, ev, by_))
  ensures settlement__monthly_inv(releaseReserve(s, release, ev, by_).month) && settlement__escrow_inv(releaseReserve(s, release, ev, by_).escrow)
{
  hide *;
  reveal canReleaseReserve, releaseReserve, settlement__monthly_inv, settlement__escrow_inv;
  var after := releaseReserve(s, release, ev, by_);
  MsChildInv(s);
  settlement__escrow_releaseReserve_ensures(s.escrow, release, ev, by_);
  MsChildInvBack(s, after);
}

lemma ReleaseReservePart1a(s: MonthlySettlement, release: settlement__escrow_ReleaseAuthorization, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canReleaseReserve(s, release, ev, by_)
  requires settlement__monthly_inv(releaseReserve(s, release, ev, by_).month) && settlement__escrow_inv(releaseReserve(s, release, ev, by_).escrow)
  ensures alwaysOneAwardPerObligation(releaseReserve(s, release, ev, by_))
  ensures alwaysPoolWithinUnreserved(releaseReserve(s, release, ev, by_))
  ensures alwaysAdmittedOnlyWhenFunded(releaseReserve(s, release, ev, by_))
  ensures alwaysPoolOnlyWhenAdmitted(releaseReserve(s, release, ev, by_))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := releaseReserve(s, release, ev, by_);
  MsEscrowMonths(after.escrow);
  MsEscrowAwards(after.escrow);
  MsReleaseRulesInv(s);
  MsObligationsMatchInv(s);
  MsReleaseZero(s, release, ev, by_);
  MsMonthValid(after.escrow, after.month.period);
  MsAmountsValid(after.month);
  MsPoolBound(after);
  MsFrame(s, after);
  MsOneAward(after);
}

lemma ReleaseReservePart1b(s: MonthlySettlement, release: settlement__escrow_ReleaseAuthorization, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canReleaseReserve(s, release, ev, by_)
  requires settlement__monthly_inv(releaseReserve(s, release, ev, by_).month) && settlement__escrow_inv(releaseReserve(s, release, ev, by_).escrow)
  ensures alwaysPoolIsTheMonthRemainder(releaseReserve(s, release, ev, by_))
  ensures alwaysCursorInRange(releaseReserve(s, release, ev, by_))
  ensures alwaysReleasedMonthHasNoLeafAward(releaseReserve(s, release, ev, by_))
  ensures alwaysPendingPoolIsExactlyUnreserved(releaseReserve(s, release, ev, by_))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  MsReleaseZero(s, release, ev, by_);
}

lemma ReleaseReservePart2a(s: MonthlySettlement, release: settlement__escrow_ReleaseAuthorization, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canReleaseReserve(s, release, ev, by_)
  requires settlement__monthly_inv(releaseReserve(s, release, ev, by_).month) && settlement__escrow_inv(releaseReserve(s, release, ev, by_).escrow)
  ensures alwaysAdmittedLeavesUnconflicted(releaseReserve(s, release, ev, by_))
  ensures alwaysUnreservedSourcesFreeWhilePooled(releaseReserve(s, release, ev, by_))
  ensures alwaysLeafAwardsAreObligations(releaseReserve(s, release, ev, by_))
  ensures alwaysCursorSourceBacked(releaseReserve(s, release, ev, by_))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := releaseReserve(s, release, ev, by_);
  MsReleaseZero(s, release, ev, by_);
  MsFrame(s, after);
  MsLeavesVacuous(after);
}

lemma ReleaseReservePart2b(s: MonthlySettlement, release: settlement__escrow_ReleaseAuthorization, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canReleaseReserve(s, release, ev, by_)
  requires settlement__monthly_inv(releaseReserve(s, release, ev, by_).month) && settlement__escrow_inv(releaseReserve(s, release, ev, by_).escrow)
  ensures alwaysLeafAwardsReserveTheirObligation(releaseReserve(s, release, ev, by_))
  ensures alwaysAdmittedLeavesNeverConflict(releaseReserve(s, release, ev, by_))
  ensures alwaysObligationsMatchVault(releaseReserve(s, release, ev, by_))
  ensures stepObligationsOnFreshCoveringHead(s, "releaseReserve", releaseReserve(s, release, ev, by_))
  ensures stepUnderfundedOnFreshHead(s, "releaseReserve", releaseReserve(s, release, ev, by_))
  ensures stepCursorMonotoneByOne(s, releaseReserve(s, release, ev, by_))
  ensures stepRootAdmitsOnlyFreeSources(s, "releaseReserve", releaseReserve(s, release, ev, by_))
{
  hide alwaysChildInvariants, alwaysChildRules, alwaysChildLifecycle, settlement__monthly_inv, settlement__escrow_inv;
  var after := releaseReserve(s, release, ev, by_);
  MsReleaseZero(s, release, ev, by_);
  MsFrame(s, after);
  MsLeavesVacuous(after);
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  InitialMsPart1();
  InitialMsPart2();
}

lemma InitialMsPart1()
  ensures alwaysOneAwardPerObligation(initialHolds())
  ensures alwaysPoolWithinUnreserved(initialHolds())
  ensures alwaysChildRules(initialHolds())
  ensures alwaysChildLifecycle(initialHolds())
  ensures alwaysChildInvariants(initialHolds())
  ensures alwaysAdmittedOnlyWhenFunded(initialHolds())
  ensures alwaysPoolOnlyWhenAdmitted(initialHolds())
  ensures alwaysPoolIsTheMonthRemainder(initialHolds())
  ensures alwaysCursorInRange(initialHolds())
{
  settlement__escrow_initialHolds_ensures();
  settlement__monthly_initialHolds_ensures();
}

lemma InitialMsPart2()
  ensures alwaysReleasedMonthHasNoLeafAward(initialHolds())
  ensures alwaysPendingPoolIsExactlyUnreserved(initialHolds())
  ensures alwaysAdmittedLeavesUnconflicted(initialHolds())
  ensures alwaysUnreservedSourcesFreeWhilePooled(initialHolds())
  ensures alwaysLeafAwardsAreObligations(initialHolds())
  ensures alwaysCursorSourceBacked(initialHolds())
  ensures alwaysLeafAwardsReserveTheirObligation(initialHolds())
  ensures alwaysAdmittedLeavesNeverConflict(initialHolds())
  ensures alwaysObligationsMatchVault(initialHolds())
{
}

lemma lawMonthLeafNeverStranded_ensures(s: MonthlySettlement, proof: settlement__escrow_LeafProof)
  ensures (lawMonthLeafNeverStranded(s, proof) == true)
{
  if alwaysUnreservedSourcesFreeWhilePooled(s) && settlement__money_positiveAmount(s.escrow.pending) && proof.source == sourceOf(s, proof.actor)
    && obligationOf(s, proof.actor).actor > 0 && obligationOf(s, proof.actor).progress.Created? {
    MsListed(s.month, proof.actor);
    assert !chainHolds(s, proof.actor);
  }
}
