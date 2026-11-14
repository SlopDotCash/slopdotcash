// Source and decision keys remain unique through append and appeal reversal.
lemma addAccepted_ensures(m: MonthlyPoints, sourceId: int, points: int, period: int)
  ensures (inv(m) ==> canAddAccepted(m, sourceId, points, period) ==> alwaysPositiveSources(addAccepted(m, sourceId, points, period)))
  ensures (inv(m) ==> canAddAccepted(m, sourceId, points, period) ==> alwaysUniqueSources(addAccepted(m, sourceId, points, period)))
  ensures (inv(m) ==> canAddAccepted(m, sourceId, points, period) ==> alwaysNonnegativeStanding(addAccepted(m, sourceId, points, period)))
  ensures (inv(m) ==> canAddAccepted(m, sourceId, points, period) ==> alwaysDebitsBounded(addAccepted(m, sourceId, points, period)))
  ensures (inv(m) ==> canAddAccepted(m, sourceId, points, period) ==> alwaysUniqueDecisions(addAccepted(m, sourceId, points, period)))
  ensures (inv(m) ==> canAddAccepted(m, sourceId, points, period) ==> stepSourcesRetained(m, addAccepted(m, sourceId, points, period)))
  ensures (inv(m) ==> canAddAccepted(m, sourceId, points, period) ==> stepFrozenRewardStable(m, addAccepted(m, sourceId, points, period)))
{
  if inv(m) && canAddAccepted(m, sourceId, points, period) {
    UniqueSourcesMeaning(m);
    AppendUniqueSources(m.sources, MonthSource(sourceId, points));
    UniqueSourcesMeaning(addAccepted(m, sourceId, points, period));
  }
}

lemma applyPenalty_ensures(m: MonthlyPoints, receipt: int, period: int, finding: Finding, authenticatedMember: bool, exactOwnRun: bool, nonMaintainer: bool, qualifiedDecision: bool)
  ensures (inv(m) ==> canApplyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision) ==> alwaysPositiveSources(applyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision)))
  ensures (inv(m) ==> canApplyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision) ==> alwaysUniqueSources(applyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision)))
  ensures (inv(m) ==> canApplyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision) ==> alwaysNonnegativeStanding(applyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision)))
  ensures (inv(m) ==> canApplyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision) ==> alwaysDebitsBounded(applyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision)))
  ensures (inv(m) ==> canApplyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision) ==> alwaysUniqueDecisions(applyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision)))
  ensures (inv(m) ==> canApplyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision) ==> stepSourcesRetained(m, applyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision)))
  ensures (inv(m) ==> canApplyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision) ==> stepFrozenRewardStable(m, applyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision)))
{
  if inv(m) && canApplyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision) {
    UniqueDecisionsMeaning(m);
    var requested := requestedDebit(finding);
    var applied := if requested > standingPoints(m) then standingPoints(m) else requested;
    AppendUniqueDecisions(m.penalties, AppliedPenalty(receipt, requested, applied, false));
    UniqueDecisionsMeaning(applyPenalty(m, receipt, period, finding, authenticatedMember, exactOwnRun, nonMaintainer, qualifiedDecision));
  }
}

lemma reversePenalty_ensures(m: MonthlyPoints, receipt: int, moderatorUpheld: bool)
  ensures (inv(m) ==> canReversePenalty(m, receipt, moderatorUpheld) ==> alwaysPositiveSources(reversePenalty(m, receipt, moderatorUpheld)))
  ensures (inv(m) ==> canReversePenalty(m, receipt, moderatorUpheld) ==> alwaysUniqueSources(reversePenalty(m, receipt, moderatorUpheld)))
  ensures (inv(m) ==> canReversePenalty(m, receipt, moderatorUpheld) ==> alwaysNonnegativeStanding(reversePenalty(m, receipt, moderatorUpheld)))
  ensures (inv(m) ==> canReversePenalty(m, receipt, moderatorUpheld) ==> alwaysDebitsBounded(reversePenalty(m, receipt, moderatorUpheld)))
  ensures (inv(m) ==> canReversePenalty(m, receipt, moderatorUpheld) ==> alwaysUniqueDecisions(reversePenalty(m, receipt, moderatorUpheld)))
  ensures (inv(m) ==> canReversePenalty(m, receipt, moderatorUpheld) ==> stepSourcesRetained(m, reversePenalty(m, receipt, moderatorUpheld)))
  ensures (inv(m) ==> canReversePenalty(m, receipt, moderatorUpheld) ==> stepFrozenRewardStable(m, reversePenalty(m, receipt, moderatorUpheld)))
{
  if inv(m) && canReversePenalty(m, receipt, moderatorUpheld) {
    UniqueDecisionsMeaning(m);
    var after := reversePenalty(m, receipt, moderatorUpheld);
    assert |m.penalties| == |after.penalties|;
    assert forall i :: 0 <= i < |m.penalties| ==> m.penalties[i].receipt == after.penalties[i].receipt;
    PreserveDecisionKeys(m.penalties, after.penalties);
    UniqueDecisionsMeaning(after);
  }
}

lemma UniqueSourcesMeaning(m: MonthlyPoints)
  ensures alwaysUniqueSources(m) == !(exists s :: s in m.sources && !(|ProofLib.Filter((other: MonthSource) => (other.source == s.source), m.sources)| == 1))
{
}

lemma UniqueDecisionsMeaning(m: MonthlyPoints)
  ensures alwaysUniqueDecisions(m) == !(exists p :: p in m.penalties && !(|ProofLib.Filter((other: AppliedPenalty) => (other.receipt == p.receipt), m.penalties)| == 1))
{
}

lemma AppendUniqueSources(xs: seq<MonthSource>, added: MonthSource)
  requires forall value :: value in xs ==> |ProofLib.Filter((other: MonthSource) => (other.source == value.source), xs)| == 1
  requires forall value :: value in xs ==> value.source != added.source
  ensures forall value :: value in xs + [added] ==> |ProofLib.Filter((other: MonthSource) => (other.source == value.source), xs + [added])| == 1
{
  forall value | value in xs + [added]
    ensures |ProofLib.Filter((other: MonthSource) => (other.source == value.source), xs + [added])| == 1
  {
    ProofLib.FilterAppend((other: MonthSource) => (other.source == value.source), xs, added);
    if value.source == added.source {
      ProofLib.FilterNone((other: MonthSource) => (other.source == value.source), xs);
    }
  }
}

lemma AppendUniqueDecisions(xs: seq<AppliedPenalty>, added: AppliedPenalty)
  requires forall value :: value in xs ==> |ProofLib.Filter((other: AppliedPenalty) => (other.receipt == value.receipt), xs)| == 1
  requires forall value :: value in xs ==> value.receipt != added.receipt
  ensures forall value :: value in xs + [added] ==> |ProofLib.Filter((other: AppliedPenalty) => (other.receipt == value.receipt), xs + [added])| == 1
{
  forall value | value in xs + [added]
    ensures |ProofLib.Filter((other: AppliedPenalty) => (other.receipt == value.receipt), xs + [added])| == 1
  {
    ProofLib.FilterAppend((other: AppliedPenalty) => (other.receipt == value.receipt), xs, added);
    if value.receipt == added.receipt {
      ProofLib.FilterNone((other: AppliedPenalty) => (other.receipt == value.receipt), xs);
    }
  }
}

lemma PreserveDecisionKeys(before: seq<AppliedPenalty>, after: seq<AppliedPenalty>)
  requires |before| == |after|
  requires forall i :: 0 <= i < |before| ==> before[i].receipt == after[i].receipt
  requires forall p :: p in before ==> |ProofLib.Filter((other: AppliedPenalty) => (other.receipt == p.receipt), before)| == 1
  ensures forall p :: p in after ==> |ProofLib.Filter((other: AppliedPenalty) => (other.receipt == p.receipt), after)| == 1
{
  forall p | p in after
    ensures |ProofLib.Filter((other: AppliedPenalty) => (other.receipt == p.receipt), after)| == 1
  {
    var i :| 0 <= i < |after| && after[i] == p;
    ProofLib.FilterLengthPointwise((other: AppliedPenalty) => (other.receipt == p.receipt), (other: AppliedPenalty) => (other.receipt == p.receipt), before, after);
  }
}
