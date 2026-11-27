lemma AnswersDistinctView(r: MemoRun)
  ensures alwaysAnswersDistinct(r) == !((exists a :: a in r.answers && !(((a.outcomeId > 0) && (|ProofLib.Filter((o: Answer) => (o.outcomeId == a.outcomeId), r.answers)| == 1)))))
{
}

lemma PriorDistinctView(r: MemoRun)
  ensures alwaysPriorDistinct(r) == !((exists p :: p in r.prior && !((((p.outcomeId > 0) && (p.result >= 0)) && (|ProofLib.Filter((o: PriorAnswer) => (o.outcomeId == p.outcomeId), r.prior)| == 1)))))
{
}

lemma RecordedFilterView(answers: seq<Answer>)
  ensures recordedOf(answers) == (var s_map := ProofLib.Filter((a: Answer) => a.recorded, answers); seq(|s_map|, i_map requires 0 <= i_map < |s_map| => var a := s_map[i_map]; PriorAnswer(a.outcomeId, a.version, a.result, false)))
{
}

lemma WithAnswerKeeps(r: MemoRun, a: Answer)
  requires alwaysAnswersDistinct(r)
  requires alwaysNextMemoIsRecorded(r)
  requires a.outcomeId > 0
  requires !answered(r, a.outcomeId)
  ensures alwaysAnswersDistinct(withAnswer(a, r))
  ensures alwaysNextMemoIsRecorded(withAnswer(a, r))
{
  var after := withAnswer(a, r);
  AnswersDistinctView(r);
  AnswersDistinctView(after);
  forall x | x in after.answers
    ensures x.outcomeId > 0 && |ProofLib.Filter((o: Answer) => (o.outcomeId == x.outcomeId), after.answers)| == 1
  {
    var pred := (o: Answer) => (o.outcomeId == x.outcomeId);
    ProofLib.FilterAppend(pred, r.answers, a);
    if x in r.answers {
      assert x.outcomeId != a.outcomeId;
      assert !pred(a);
    } else {
      assert x == a;
      ProofLib.FilterNone(pred, r.answers);
      assert pred(a);
    }
  }
  RecordedFilterView(r.answers);
  RecordedFilterView(after.answers);
  ProofLib.FilterAppend((x: Answer) => x.recorded, r.answers, a);
  var beforeF := ProofLib.Filter((x: Answer) => x.recorded, r.answers);
  var afterF := ProofLib.Filter((x: Answer) => x.recorded, after.answers);
  if a.recorded {
    assert afterF == beforeF + [a];
  } else {
    assert afterF == beforeF;
  }
}

lemma UniquePriorMatch(xs: seq<PriorAnswer>, p: PriorAnswer, q: PriorAnswer)
  requires p in xs && q in xs && p.outcomeId == q.outcomeId
  requires |ProofLib.Filter((o: PriorAnswer) => (o.outcomeId == p.outcomeId), xs)| == 1
  ensures p == q
{
  var pred := (o: PriorAnswer) => (o.outcomeId == p.outcomeId);
  var i :| 0 <= i < |xs| && xs[i] == p;
  var j :| 0 <= j < |xs| && xs[j] == q;
  if i != j {
    if i < j {
      ProofLib.FilterTwo(pred, xs, i, j);
    } else {
      ProofLib.FilterTwo(pred, xs, j, i);
    }
    assert false;
  }
}

lemma FoldLeftPrior(xs: seq<PriorAnswer>, outcomeId: int, expected: int, acc: int)
  requires exists p :: p in xs && p.outcomeId == outcomeId && p.result == expected
  requires forall q :: q in xs && q.outcomeId == outcomeId ==> q.result == expected
  ensures Std.Collections.Seq.FoldLeft((acc: int, p: PriorAnswer) => (if (p.outcomeId == outcomeId) then p.result else acc), acc, xs) == expected
  decreases |xs|
{
  var f := (acc: int, p: PriorAnswer) => (if (p.outcomeId == outcomeId) then p.result else acc);
  var init := xs[..|xs| - 1];
  var last := xs[|xs| - 1];
  assert xs == init + [last];
  ProofLib.FoldLeftAppend(f, acc, init, last);
  if last.outcomeId == outcomeId {
    assert last.result == expected;
  } else {
    var p :| p in xs && p.outcomeId == outcomeId && p.result == expected;
    assert p in init;
    FoldLeftPrior(init, outcomeId, expected, acc);
  }
}

lemma reuse_ensures(r: MemoRun, outcomeId: int, version: int, sample: int)
  ensures (inv(r) ==> canReuse(r, outcomeId, version, sample) ==> alwaysRefusedOnlyWithReason(reuse(r, outcomeId, version, sample)))
  ensures (inv(r) ==> canReuse(r, outcomeId, version, sample) ==> alwaysFullNeverReuses(reuse(r, outcomeId, version, sample)))
  ensures (inv(r) ==> canReuse(r, outcomeId, version, sample) ==> alwaysPriorDistinct(reuse(r, outcomeId, version, sample)))
  ensures (inv(r) ==> canReuse(r, outcomeId, version, sample) ==> alwaysAnswersDistinct(reuse(r, outcomeId, version, sample)))
  ensures (inv(r) ==> canReuse(r, outcomeId, version, sample) ==> alwaysReuseWithinFence(reuse(r, outcomeId, version, sample)))
  ensures (inv(r) ==> canReuse(r, outcomeId, version, sample) ==> alwaysAuditsPrecedeReuse(reuse(r, outcomeId, version, sample)))
  ensures (inv(r) ==> canReuse(r, outcomeId, version, sample) ==> alwaysAuditedIsRecomputed(reuse(r, outcomeId, version, sample)))
  ensures (inv(r) ==> canReuse(r, outcomeId, version, sample) ==> alwaysNextMemoIsRecorded(reuse(r, outcomeId, version, sample)))
  ensures (inv(r) ==> canReuse(r, outcomeId, version, sample) ==> alwaysHoldNeverRecorded(reuse(r, outcomeId, version, sample)))
  ensures (inv(r) ==> canReuse(r, outcomeId, version, sample) ==> alwaysFullRunRestartsWeek(reuse(r, outcomeId, version, sample)))
  ensures (inv(r) ==> canReuse(r, outcomeId, version, sample) ==> alwaysLastFullNotAfterOpen(reuse(r, outcomeId, version, sample)))
  ensures (inv(r) ==> canReuse(r, outcomeId, version, sample) ==> alwaysNothingAnsweredUnopened(reuse(r, outcomeId, version, sample)))
  ensures (inv(r) ==> canReuse(r, outcomeId, version, sample) ==> stepRefusalIsFinal(r, reuse(r, outcomeId, version, sample)))
  ensures (inv(r) ==> canReuse(r, outcomeId, version, sample) ==> stepMemoOnlyAfterSnapshot(r, reuse(r, outcomeId, version, sample)))
{
  if inv(r) && canReuse(r, outcomeId, version, sample) {
    PriorDistinctView(r);
    var p :| p in r.prior && p.outcomeId == outcomeId && p.version == version && !p.expired;
    forall q | q in r.prior && q.outcomeId == outcomeId
      ensures q.result == p.result
    {
      UniquePriorMatch(r.prior, p, q);
    }
    FoldLeftPrior(r.prior, outcomeId, p.result, -1);
    assert priorResult(r, outcomeId) == p.result;
    var a := Answer(outcomeId, version, priorResult(r, outcomeId), false, true, false, true);
    WithAnswerKeeps(r, a);
  }
}

lemma audit_ensures(r: MemoRun, outcomeId: int, version: int, sample: int, result: int, held: bool, fenced: bool)
  ensures (inv(r) ==> canAudit(r, outcomeId, version, sample, result, held, fenced) ==> alwaysRefusedOnlyWithReason(audit(r, outcomeId, version, sample, result, held, fenced)))
  ensures (inv(r) ==> canAudit(r, outcomeId, version, sample, result, held, fenced) ==> alwaysFullNeverReuses(audit(r, outcomeId, version, sample, result, held, fenced)))
  ensures (inv(r) ==> canAudit(r, outcomeId, version, sample, result, held, fenced) ==> alwaysPriorDistinct(audit(r, outcomeId, version, sample, result, held, fenced)))
  ensures (inv(r) ==> canAudit(r, outcomeId, version, sample, result, held, fenced) ==> alwaysAnswersDistinct(audit(r, outcomeId, version, sample, result, held, fenced)))
  ensures (inv(r) ==> canAudit(r, outcomeId, version, sample, result, held, fenced) ==> alwaysReuseWithinFence(audit(r, outcomeId, version, sample, result, held, fenced)))
  ensures (inv(r) ==> canAudit(r, outcomeId, version, sample, result, held, fenced) ==> alwaysAuditsPrecedeReuse(audit(r, outcomeId, version, sample, result, held, fenced)))
  ensures (inv(r) ==> canAudit(r, outcomeId, version, sample, result, held, fenced) ==> alwaysAuditedIsRecomputed(audit(r, outcomeId, version, sample, result, held, fenced)))
  ensures (inv(r) ==> canAudit(r, outcomeId, version, sample, result, held, fenced) ==> alwaysNextMemoIsRecorded(audit(r, outcomeId, version, sample, result, held, fenced)))
  ensures (inv(r) ==> canAudit(r, outcomeId, version, sample, result, held, fenced) ==> alwaysHoldNeverRecorded(audit(r, outcomeId, version, sample, result, held, fenced)))
  ensures (inv(r) ==> canAudit(r, outcomeId, version, sample, result, held, fenced) ==> alwaysFullRunRestartsWeek(audit(r, outcomeId, version, sample, result, held, fenced)))
  ensures (inv(r) ==> canAudit(r, outcomeId, version, sample, result, held, fenced) ==> alwaysLastFullNotAfterOpen(audit(r, outcomeId, version, sample, result, held, fenced)))
  ensures (inv(r) ==> canAudit(r, outcomeId, version, sample, result, held, fenced) ==> alwaysNothingAnsweredUnopened(audit(r, outcomeId, version, sample, result, held, fenced)))
  ensures (inv(r) ==> canAudit(r, outcomeId, version, sample, result, held, fenced) ==> stepRefusalIsFinal(r, audit(r, outcomeId, version, sample, result, held, fenced)))
  ensures (inv(r) ==> canAudit(r, outcomeId, version, sample, result, held, fenced) ==> stepMemoOnlyAfterSnapshot(r, audit(r, outcomeId, version, sample, result, held, fenced)))
{
  if inv(r) && canAudit(r, outcomeId, version, sample, result, held, fenced) {
    PriorDistinctView(r);
    var p :| p in r.prior && p.outcomeId == outcomeId && p.version == version && !p.expired;
    var a := Answer(outcomeId, version, result, held, false, true, fenced && !held);
    WithAnswerKeeps(r, a);
  }
}

lemma computeLive_ensures(r: MemoRun, outcomeId: int, version: int, result: int, held: bool, fenced: bool)
  ensures (inv(r) ==> canComputeLive(r, outcomeId, version, result, held, fenced) ==> alwaysRefusedOnlyWithReason(computeLive(r, outcomeId, version, result, held, fenced)))
  ensures (inv(r) ==> canComputeLive(r, outcomeId, version, result, held, fenced) ==> alwaysFullNeverReuses(computeLive(r, outcomeId, version, result, held, fenced)))
  ensures (inv(r) ==> canComputeLive(r, outcomeId, version, result, held, fenced) ==> alwaysPriorDistinct(computeLive(r, outcomeId, version, result, held, fenced)))
  ensures (inv(r) ==> canComputeLive(r, outcomeId, version, result, held, fenced) ==> alwaysAnswersDistinct(computeLive(r, outcomeId, version, result, held, fenced)))
  ensures (inv(r) ==> canComputeLive(r, outcomeId, version, result, held, fenced) ==> alwaysReuseWithinFence(computeLive(r, outcomeId, version, result, held, fenced)))
  ensures (inv(r) ==> canComputeLive(r, outcomeId, version, result, held, fenced) ==> alwaysAuditsPrecedeReuse(computeLive(r, outcomeId, version, result, held, fenced)))
  ensures (inv(r) ==> canComputeLive(r, outcomeId, version, result, held, fenced) ==> alwaysAuditedIsRecomputed(computeLive(r, outcomeId, version, result, held, fenced)))
  ensures (inv(r) ==> canComputeLive(r, outcomeId, version, result, held, fenced) ==> alwaysNextMemoIsRecorded(computeLive(r, outcomeId, version, result, held, fenced)))
  ensures (inv(r) ==> canComputeLive(r, outcomeId, version, result, held, fenced) ==> alwaysHoldNeverRecorded(computeLive(r, outcomeId, version, result, held, fenced)))
  ensures (inv(r) ==> canComputeLive(r, outcomeId, version, result, held, fenced) ==> alwaysFullRunRestartsWeek(computeLive(r, outcomeId, version, result, held, fenced)))
  ensures (inv(r) ==> canComputeLive(r, outcomeId, version, result, held, fenced) ==> alwaysLastFullNotAfterOpen(computeLive(r, outcomeId, version, result, held, fenced)))
  ensures (inv(r) ==> canComputeLive(r, outcomeId, version, result, held, fenced) ==> alwaysNothingAnsweredUnopened(computeLive(r, outcomeId, version, result, held, fenced)))
  ensures (inv(r) ==> canComputeLive(r, outcomeId, version, result, held, fenced) ==> stepRefusalIsFinal(r, computeLive(r, outcomeId, version, result, held, fenced)))
  ensures (inv(r) ==> canComputeLive(r, outcomeId, version, result, held, fenced) ==> stepMemoOnlyAfterSnapshot(r, computeLive(r, outcomeId, version, result, held, fenced)))
{
  if inv(r) && canComputeLive(r, outcomeId, version, result, held, fenced) {
    var a := Answer(outcomeId, version, result, held, false, false, fenced && !held);
    WithAnswerKeeps(r, a);
  }
}
