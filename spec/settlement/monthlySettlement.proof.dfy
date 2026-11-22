// Proof of the monthly settlement composition. Every event is one of the
// monthly allocation's or the escrow's own events under its own guard, or
// leaves both unchanged, so their proved rules carry over (MsChildInv and
// MsChildInvBack around each imported lemma). The helpers below prove the
// composition's own rules for the events that change what they read.

lemma MsChildInv(s: MonthlySettlement)
  requires inv(s)
  ensures settlement__monthly_inv(s.month) && settlement__escrow_inv(s.escrow)
{
  assert alwaysChildInvariants(s);
}

lemma MsChildInvBack(s: MonthlySettlement, t: MonthlySettlement)
  requires settlement__monthly_inv(t.month) && settlement__escrow_inv(t.escrow)
  ensures alwaysChildInvariants(t) && alwaysChildRules(t) && alwaysChildLifecycle(t)
{
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

// The vault covered the created obligations: they total the payable shares, which the coordinator covered.
lemma MsCovered(s: MonthlySettlement, earlierUnreserved: seq<int>, bans: seq<settlement__monthly_BanExclusion>)
  requires inv(s) && canCreateObligations(s, earlierUnreserved, bans)
  ensures settlement__money_compareAmounts(s.escrow.free, settlement__monthly_obligationTotal(createObligations(s, earlierUnreserved, bans).month)) >= 0
{
  var after := createObligations(s, earlierUnreserved, bans);
  var o := observation(s, earlierUnreserved);
  var p := settlement__monthly_payable(s.month, bans);
  var total := settlement__monthly_payableTotal(p);
  assert alwaysChildInvariants(s);
  ProofLib.FilterSubset((sh: settlement__allocation_Share) => (settlement__money_positiveAmount(sh.amount) && !(settlement__monthly_banFor(bans, sh.actor))), s.month.shares);
  assert forall sh :: sh in p ==> sh in s.month.shares;
  assert forall sh :: sh in p ==> settlement__money_validAmount(sh.amount);
  assert settlement__money_validAmount(settlement__money_zero);
  MsShareSumValid(p, settlement__money_zero);
  assert |after.month.obligations| == |p|;
  ProofLib.FoldLeftPointwise((sum: settlement__money_Amount, ob: settlement__monthly_Obligation) => settlement__money_addAmounts(sum, ob.amount),
    (sum: settlement__money_Amount, share: settlement__allocation_Share) => settlement__money_addAmounts(sum, share.amount),
    settlement__money_zero, after.month.obligations, p);
  assert settlement__monthly_obligationTotal(after.month) == total;
  var held := otherOpenPledges(s);
  MsChildInv(s);
  assert settlement__escrow_alwaysPledgesCovered(s.escrow);
  MsHeldValid(s.escrow.pledges, s.month.period, settlement__money_zero);
  var needed := settlement__money_addAmounts(total, earlierUnreserved);
  var free := s.escrow.free;
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
  var t := admitRoot(s, authorization, ev);
  assert alwaysChildInvariants(s);
  var p := (o: settlement__monthly_Obligation) => o.progress.Created?;
  var created := Std.Collections.Seq.Filter(p, s.month.obligations);
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
  assert alwaysChildInvariants(s);
  MsMonthValid(s.escrow, s.month.period);
  MsPositiveBelow(proof.gross, admittedMonth(s).remaining);
}

// A reserve release leaves no more of the month pending than before.
lemma MsReleaseShrinks(s: MonthlySettlement, release: settlement__escrow_ReleaseAuthorization, ev: settlement__escrow_ChainEvent, by_: string)
  requires inv(s) && canReleaseReserve(s, release, ev, by_)
  requires settlement__escrow_alwaysMonths(releaseReserve(s, release, ev, by_).escrow)
  ensures settlement__money_positiveAmount(admittedMonth(releaseReserve(s, release, ev, by_)).remaining) ==> settlement__money_positiveAmount(admittedMonth(s).remaining)
{
  var t := releaseReserve(s, release, ev, by_);
  var period := s.month.period;
  assert alwaysChildInvariants(s);
  var p := (x: settlement__escrow_MonthReserve) => (x.period == period);
  var kept := Std.Collections.Seq.Filter(p, t.escrow.months);
  if settlement__money_positiveAmount(admittedMonth(t).remaining) && 0 < |kept| {
    ProofLib.FilterMember(p, t.escrow.months, kept[0]);
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
    settlement__money_lawEqualReflexive_ensures(settlement__money_zero);
  }
}

// An observed conflict is of an obligation the pool does not hold.
lemma MsConflictUnpooled(s: MonthlySettlement, actor: int)
  requires inv(s) && canObserveConflict(s, actor)
  ensures !settlement__money_positiveAmount(admittedMonth(s).remaining)
{
  assert alwaysChildInvariants(s);
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
    var kept := Std.Collections.Seq.Filter(p, s.month.obligations);
    assert 0 < |kept|;
    ProofLib.FilterMember(p, s.month.obligations, kept[0]);
    assert b in s.month.obligations && b.source == source;
    assert b.source == settlement__monthly_keyFor(s.month, b.actor);
    assert b.actor == actor;
    MsTheObligation(s.month, b);
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
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
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
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
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
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
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
  if inv(s) && canCommitObligation(s, actor, ev, by_) {
    var after := commitObligation(s, actor, ev, by_);
    MsChildInv(s);
    settlement__escrow_commitAward_ensures(s.escrow, sourceOf(s, actor), actor, obligationOf(s, actor).amount, ev, by_);
    settlement__monthly_recordReserved_ensures(s.month, awardFact(s, actor, false));
    MsChildInvBack(s, after);
    MsCommitObligation(s, actor, ev, by_);
    MsChildInvBack(s, after);
    MsOneAward(after);
    assert alwaysPoolIsTheMonthRemainder(s);
    settlement__money_lawEqualOrder_ensures(s.escrow.pending, admittedMonth(s).remaining, settlement__money_zero);
    assert after.escrow.months == s.escrow.months;
    MsLeavesVacuous(after);
  }
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
  if inv(s) && canCommitManualAward(s, source, actor, gross, ev, by_) {
    var after := commitManualAward(s, source, actor, gross, ev, by_);
    MsChildInv(s);
    settlement__escrow_commitAward_ensures(s.escrow, source, actor, gross, ev, by_);
    MsManual(s, source, actor, gross, ev, by_);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
  }
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
  if inv(s) && canPayAward(s, actor, destination, version, ev) {
    var after := payAward(s, actor, destination, version, ev);
    MsChildInv(s);
    settlement__escrow_pay_ensures(s.escrow, sourceOf(s, actor), settlement__escrow_PayableBinding(actor, destination, version), ev);
    MsPay(s, actor, destination, version, ev);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
  }
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
  if inv(s) && canObserveExistingAward(s, actor) {
    var after := observeExistingAward(s, actor);
    MsChildInv(s);
    settlement__monthly_recordReserved_ensures(s.month, awardFact(s, actor, false));
    MsChildInvBack(s, after);
    MsObserveExisting(s, actor);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsNoRemainderWhenHeld(s, actor);
    MsLeavesVacuous(after);
  }
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
  if inv(s) && canObservePaid(s, actor) {
    var after := observePaid(s, actor);
    MsChildInv(s);
    settlement__monthly_recordPaid_ensures(s.month, awardFact(s, actor, true));
    MsObservePaid(s, actor);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesRecorded(s, after, actor, settlement__monthly_ObligationState.Paid);
    MsLeavesNeverConflict(after);
  }
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
  if inv(s) && canObserveConflict(s, actor) {
    var after := observeConflict(s, actor);
    MsChildInv(s);
    settlement__monthly_recordConflict_ensures(s.month, observedFact(s, actor));
    MsObserveConflict(s, actor);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsConflictUnpooled(s, actor);
    MsLeavesVacuous(after);
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
  if inv(s) && canAdmitRoot(s, authorization, ev) {
    var after := admitRoot(s, authorization, ev);
    MsChildInv(s);
    settlement__escrow_admitRoot_ensures(s.escrow, authorization, ev);
    MsFrame(s, after);
    MsAdmit(s, authorization, ev);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsAdmitLeaves(s, authorization, ev);
    MsLeavesNeverConflict(after);
  }
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
  if inv(s) && canMaterialize(s, proof, ev) {
    var after := materialize(s, proof, ev);
    MsChildInv(s);
    settlement__escrow_materialize_ensures(s.escrow, proof, ev);
    settlement__monthly_recordReserved_ensures(s.month, awardFact(s, proof.actor, false));
    MsMaterialize(s, proof, ev);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeafFromPositive(s, proof, ev);
    MsLeavesRecorded(s, after, proof.actor, settlement__monthly_ObligationState.Reserved);
    MsLeavesNeverConflict(after);
  }
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
  if inv(s) && canAdvanceCursor(s, proof, nonceSettled) {
    var after := advanceCursor(s, proof, nonceSettled);
    MsChildInv(s);
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
  }
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
  if inv(s) && canAdvanceZeroRemaining(s, proof, nonceSettled) {
    var after := advanceZeroRemaining(s, proof, nonceSettled);
    MsChildInv(s);
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
  }
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
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
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
    MsFrame(s, after);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
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
  if inv(s) && canReleaseReserve(s, release, ev, by_) {
    var after := releaseReserve(s, release, ev, by_);
    MsChildInv(s);
    settlement__escrow_releaseReserve_ensures(s.escrow, release, ev, by_);
    MsFrame(s, after);
    MsRelease(s, release, ev, by_);
    MsChildInvBack(s, after);
    MsOneAward(after);
    MsReleaseShrinks(s, release, ev, by_);
    MsLeavesFrame(s, after);
    MsLeavesNeverConflict(after);
  }
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
