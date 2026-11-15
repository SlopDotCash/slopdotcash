// The retirement batch appends one zero revision of an evaluated key; spelling it out keeps the proof small.
lemma recordRetirementBatch_ensures(l: Ledger, k: AwardKey)
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> alwaysNextIdPositive(recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> alwaysRevisionsWellFormed(recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> alwaysDecisionsReconcile(recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> alwaysNoUpheldDisputeCorrection(recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> alwaysFrozenPeriodsValid(recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> stepAppendOnly(l, recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> stepObservationsAppendNothing(l, "recordRetirementBatch", recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> stepFrozenAcceptedWorkUnchanged(l, recordRetirementBatch(l, k)))
  ensures (inv(l) ==> canRecordRetirementBatch(l, k) ==> stepChained(l, recordRetirementBatch(l, k)))
{
  if inv(l) && canRecordRetirementBatch(l, k) {
    var prior := latest(l, k);
    var r := noRevision.(id := l.nextId, previous := prior.id, key := k, amount := 0, priorAmount := prior.amount, occurredAt := prior.occurredAt, recordedAt := l.now, rule := SourceRule.ScoreV2, sourceDigest := points__evaluations_retirementZeroDigest, decision := Decision(Basis.RetirementBatch, l.now, "retired evaluator batch", (0 - prior.amount)));
    var after := recordRetirementBatch(l, k);
    assert after == l.(revisions := l.revisions + [r], nextId := l.nextId + 1);
    assert |points__evaluations_retirementZeroDigest| > 0;
    assert r.sourceDigest != "";
    assert amountAllowed(r.key.category, r.amount);
    assert ruleAllowed(r.key.category, r.rule);
    assert unitAllocation(r);
    assert lastRevision(after) == r;
    assert r.previous < r.id by { assert prior.id < l.nextId; }
    assert r.recordedAt >= r.occurredAt;
    AppendKeeps(l, r);
  }
}

// Appending one revision that satisfies the per-revision rules keeps every per-revision invariant.
lemma AppendKeeps(l: Ledger, r: Revision)
  requires alwaysRevisionsWellFormed(l) && alwaysDecisionsReconcile(l) && alwaysNoUpheldDisputeCorrection(l)
  requires r.id == l.nextId && r.id > 0 && r.previous >= 0 && r.previous < r.id && validKey(r.key)
  requires amountAllowed(r.key.category, r.amount) && ruleAllowed(r.key.category, r.rule) && unitAllocation(r)
  requires r.recordedAt >= r.occurredAt && r.occurredAt >= 0 && r.recordedAt <= l.now && r.sourceDigest != ""
  requires (!(r.provisional) || (r.key.category.MergedWork? || r.key.category.Review?))
  requires (!(r.key.category.Penalty?) || (!(r.provisional) && (r.tableVersion > 0))) && (r.key.category.Penalty? || r.tableVersion == 0)
  requires (r.previous == 0 ==> r.priorAmount == 0) && (r.decision.basis.NoBasis? ==> r.decision == noDecision && r.previous == 0)
  requires (!r.decision.basis.NoBasis? ==> r.decision.delta == r.amount - r.priorAmount && r.decision.reason != "" && r.decision.effectiveAt <= r.recordedAt)
  requires !r.decision.basis.DisputeUpheld?
  ensures alwaysRevisionsWellFormed(l.(revisions := l.revisions + [r], nextId := l.nextId + 1))
  ensures alwaysDecisionsReconcile(l.(revisions := l.revisions + [r], nextId := l.nextId + 1))
  ensures alwaysNoUpheldDisputeCorrection(l.(revisions := l.revisions + [r], nextId := l.nextId + 1))
{
  var after := l.(revisions := l.revisions + [r], nextId := l.nextId + 1);
  forall x | x in after.revisions
    ensures x.id > 0 && x.id < after.nextId && x.recordedAt <= after.now
  {
    if x in l.revisions { } else { assert x == r; }
  }
}
