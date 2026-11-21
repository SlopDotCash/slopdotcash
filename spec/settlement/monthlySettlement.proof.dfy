// Frame lemmas for the monthly settlement composition: events that touch only
// the month's clock, or only the vault's deployment, leave every view the
// invariants read unchanged.

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

lemma observeClock_ensures(s: MonthlySettlement, now: int)
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysOneAwardPerObligation(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysPoolWithinUnreserved(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysChildRules(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysAdmittedOnlyWhenFunded(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysPoolOnlyWhenAdmitted(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysCursorInRange(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysReleasedMonthHasNoLeafAward(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysPendingPoolIsExactlyUnreserved(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysUnreservedSourcesFreeWhilePooled(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysLeafAwardsAreObligations(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysCursorSourceBacked(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysLeafAwardsReserveTheirObligation(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> alwaysObligationsMatchVault(observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> stepObligationsOnFreshCoveringHead(s, "observeClock", observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> stepUnderfundedOnFreshHead(s, "observeClock", observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> stepCursorMonotoneByOne(s, observeClock(s, now)))
  ensures (inv(s) ==> canObserveClock(s, now) ==> stepRootAdmitsOnlyFreeSources(s, "observeClock", observeClock(s, now)))
{
  if inv(s) && canObserveClock(s, now) {
    var after := observeClock(s, now);
    MsMonthFrame(s, after);
  }
}

lemma openMonth_ensures(s: MonthlySettlement, period: int)
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysOneAwardPerObligation(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysPoolWithinUnreserved(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysChildRules(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysAdmittedOnlyWhenFunded(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysPoolOnlyWhenAdmitted(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysCursorInRange(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysReleasedMonthHasNoLeafAward(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysPendingPoolIsExactlyUnreserved(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysUnreservedSourcesFreeWhilePooled(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysLeafAwardsAreObligations(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysCursorSourceBacked(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysLeafAwardsReserveTheirObligation(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> alwaysObligationsMatchVault(openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> stepObligationsOnFreshCoveringHead(s, "openMonth", openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> stepUnderfundedOnFreshHead(s, "openMonth", openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> stepCursorMonotoneByOne(s, openMonth(s, period)))
  ensures (inv(s) ==> canOpenMonth(s, period) ==> stepRootAdmitsOnlyFreeSources(s, "openMonth", openMonth(s, period)))
{
  if inv(s) && canOpenMonth(s, period) {
    var after := openMonth(s, period);
    assert alwaysChildRules(s);
    assert settlement__monthly_alwaysNoObligationsBeforeFunding(s.month);
    assert s.month.obligations == [];
    assert after.month.obligations == [];
    assert settlement__monthly_obligationActors(after.month) == [];
    assert alwaysAdmittedOnlyWhenFunded(s);
    assert |s.escrow.months| == 0;
    MsNoLeafAwards(s.escrow);
    assert after.escrow == s.escrow;
    assert alwaysLeafAwardsAreObligations(after);
    assert alwaysObligationsMatchVault(after);
    assert settlement__monthly_alwaysObligationsMatchShares(after.month);
    assert settlement__monthly_alwaysNoObligationsBeforeFunding(after.month);
  }
}

lemma deploy_ensures(s: MonthlySettlement, asset: settlement__escrow_AssetIdentity, mint: settlement__escrow_MintFacts, purpose: settlement__escrow_VaultPurpose, delay: int, cap: seq<int>, turnOn: bool)
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysOneAwardPerObligation(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysPoolWithinUnreserved(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysChildRules(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysAdmittedOnlyWhenFunded(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysPoolOnlyWhenAdmitted(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysCursorInRange(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysReleasedMonthHasNoLeafAward(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysPendingPoolIsExactlyUnreserved(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysUnreservedSourcesFreeWhilePooled(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysLeafAwardsAreObligations(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysCursorSourceBacked(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysLeafAwardsReserveTheirObligation(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> alwaysObligationsMatchVault(deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> stepObligationsOnFreshCoveringHead(s, "deploy", deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> stepUnderfundedOnFreshHead(s, "deploy", deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> stepCursorMonotoneByOne(s, deploy(s, asset, mint, purpose, delay, cap, turnOn)))
  ensures (inv(s) ==> canDeploy(s, asset, mint, purpose, delay, cap, turnOn) ==> stepRootAdmitsOnlyFreeSources(s, "deploy", deploy(s, asset, mint, purpose, delay, cap, turnOn)))
{
  if inv(s) && canDeploy(s, asset, mint, purpose, delay, cap, turnOn) {
    var after := deploy(s, asset, mint, purpose, delay, cap, turnOn);
    assert alwaysChildRules(s);
    assert s.escrow.awards == [];
    assert after.month == s.month && after.cursor == s.cursor && after.headTime == s.headTime;
    assert after.escrow.awards == [] && after.escrow.months == s.escrow.months && after.escrow.pending == s.escrow.pending;
    assert after.escrow.deployed;
  }
}
