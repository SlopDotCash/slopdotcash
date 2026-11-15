lemma record_ensures(l: Ledger, by_: int, id: int, revision: int, result: EvidenceKind, bound: int)
  ensures (inv(l) ==> canRecord(l, by_, id, revision, result, bound) ==> alwaysEvidenceIdentity(record(l, by_, id, revision, result, bound)))
  ensures (inv(l) ==> canRecord(l, by_, id, revision, result, bound) ==> alwaysUniqueObligations(record(l, by_, id, revision, result, bound)))
  ensures (inv(l) ==> canRecord(l, by_, id, revision, result, bound) ==> alwaysPhaseNeedsCompletion(record(l, by_, id, revision, result, bound)))
  ensures (inv(l) ==> canRecord(l, by_, id, revision, result, bound) ==> alwaysCompletionWasEarned(record(l, by_, id, revision, result, bound)))
  ensures (inv(l) ==> canRecord(l, by_, id, revision, result, bound) ==> stepConfigurationFixed(l, record(l, by_, id, revision, result, bound)))
  ensures (inv(l) ==> canRecord(l, by_, id, revision, result, bound) ==> stepObligationsNeverRemoved(l, record(l, by_, id, revision, result, bound)))
{
  if inv(l) && canRecord(l, by_, id, revision, result, bound) {
    var next := record(l, by_, id, revision, result, bound);
    assert |next.obligations| == |l.obligations|;
    forall k | 0 <= k < |l.obligations|
      ensures next.obligations[k].id == l.obligations[k].id && next.obligations[k].obligationClass == l.obligations[k].obligationClass
    {
    }
    forall o | o in l.obligations
      ensures exists x :: x in next.obligations && x.id == o.id && x.obligationClass == o.obligationClass
    {
      var k :| 0 <= k < |l.obligations| && l.obligations[k] == o;
      assert next.obligations[k] in next.obligations;
    }
  }
}

lemma review_ensures(l: Ledger, by_: int, id: int)
  ensures (inv(l) ==> canReview(l, by_, id) ==> alwaysEvidenceIdentity(review(l, by_, id)))
  ensures (inv(l) ==> canReview(l, by_, id) ==> alwaysUniqueObligations(review(l, by_, id)))
  ensures (inv(l) ==> canReview(l, by_, id) ==> alwaysPhaseNeedsCompletion(review(l, by_, id)))
  ensures (inv(l) ==> canReview(l, by_, id) ==> alwaysCompletionWasEarned(review(l, by_, id)))
  ensures (inv(l) ==> canReview(l, by_, id) ==> stepConfigurationFixed(l, review(l, by_, id)))
  ensures (inv(l) ==> canReview(l, by_, id) ==> stepObligationsNeverRemoved(l, review(l, by_, id)))
{
  if inv(l) && canReview(l, by_, id) {
    var next := review(l, by_, id);
    assert |next.obligations| == |l.obligations|;
    forall k | 0 <= k < |l.obligations|
      ensures next.obligations[k].id == l.obligations[k].id && next.obligations[k].obligationClass == l.obligations[k].obligationClass
    {
    }
    forall o | o in l.obligations
      ensures exists x :: x in next.obligations && x.id == o.id && x.obligationClass == o.obligationClass
    {
      var k :| 0 <= k < |l.obligations| && l.obligations[k] == o;
      assert next.obligations[k] in next.obligations;
    }
  }
}

lemma changeRevision_ensures(l: Ledger, by_: int, revision: int)
  ensures (inv(l) ==> canChangeRevision(l, by_, revision) ==> alwaysEvidenceIdentity(changeRevision(l, by_, revision)))
  ensures (inv(l) ==> canChangeRevision(l, by_, revision) ==> alwaysUniqueObligations(changeRevision(l, by_, revision)))
  ensures (inv(l) ==> canChangeRevision(l, by_, revision) ==> alwaysPhaseNeedsCompletion(changeRevision(l, by_, revision)))
  ensures (inv(l) ==> canChangeRevision(l, by_, revision) ==> alwaysCompletionWasEarned(changeRevision(l, by_, revision)))
  ensures (inv(l) ==> canChangeRevision(l, by_, revision) ==> stepConfigurationFixed(l, changeRevision(l, by_, revision)))
  ensures (inv(l) ==> canChangeRevision(l, by_, revision) ==> stepObligationsNeverRemoved(l, changeRevision(l, by_, revision)))
{
  if inv(l) && canChangeRevision(l, by_, revision) {
    var next := changeRevision(l, by_, revision);
    assert |next.obligations| == |l.obligations|;
    forall k | 0 <= k < |l.obligations|
      ensures next.obligations[k].id == l.obligations[k].id && next.obligations[k].obligationClass == l.obligations[k].obligationClass
    {
    }
    forall o | o in l.obligations
      ensures exists x :: x in next.obligations && x.id == o.id && x.obligationClass == o.obligationClass
    {
      var k :| 0 <= k < |l.obligations| && l.obligations[k] == o;
      assert next.obligations[k] in next.obligations;
    }
  }
}

lemma waive_ensures(l: Ledger, by_: int, id: int, decision: int)
  ensures (inv(l) ==> canWaive(l, by_, id, decision) ==> alwaysEvidenceIdentity(waive(l, by_, id, decision)))
  ensures (inv(l) ==> canWaive(l, by_, id, decision) ==> alwaysUniqueObligations(waive(l, by_, id, decision)))
  ensures (inv(l) ==> canWaive(l, by_, id, decision) ==> alwaysPhaseNeedsCompletion(waive(l, by_, id, decision)))
  ensures (inv(l) ==> canWaive(l, by_, id, decision) ==> alwaysCompletionWasEarned(waive(l, by_, id, decision)))
  ensures (inv(l) ==> canWaive(l, by_, id, decision) ==> stepConfigurationFixed(l, waive(l, by_, id, decision)))
  ensures (inv(l) ==> canWaive(l, by_, id, decision) ==> stepObligationsNeverRemoved(l, waive(l, by_, id, decision)))
{
  if inv(l) && canWaive(l, by_, id, decision) {
    var next := waive(l, by_, id, decision);
    assert |next.obligations| == |l.obligations|;
    forall k | 0 <= k < |l.obligations|
      ensures next.obligations[k].id == l.obligations[k].id && next.obligations[k].obligationClass == l.obligations[k].obligationClass
    {
    }
    forall o | o in l.obligations
      ensures exists x :: x in next.obligations && x.id == o.id && x.obligationClass == o.obligationClass
    {
      var k :| 0 <= k < |l.obligations| && l.obligations[k] == o;
      assert next.obligations[k] in next.obligations;
    }
  }
}
