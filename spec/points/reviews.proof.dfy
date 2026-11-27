// Preserve immutable reviewer identities and the positive useful-review pool.
lemma recordReview_ensures(r: Reviews, evidence: ReviewEvidence)
  ensures (inv(r) ==> canRecordReview(r, evidence) ==> alwaysAssessmentValid(recordReview(r, evidence)))
  ensures (inv(r) ==> canRecordReview(r, evidence) ==> alwaysAtMostFive(recordReview(r, evidence)))
  ensures (inv(r) ==> canRecordReview(r, evidence) ==> alwaysUsefulBands(recordReview(r, evidence)))
  ensures (inv(r) ==> canRecordReview(r, evidence) ==> alwaysDistinctReviewers(recordReview(r, evidence)))
  ensures (inv(r) ==> canRecordReview(r, evidence) ==> alwaysCreditOnlyAfterMerge(recordReview(r, evidence)))
  ensures (inv(r) ==> canRecordReview(r, evidence) ==> alwaysCorrectionsOnlyAfterJournal(recordReview(r, evidence)))
  ensures (inv(r) ==> canRecordReview(r, evidence) ==> alwaysPoolBound(recordReview(r, evidence)))
  ensures (inv(r) ==> canRecordReview(r, evidence) ==> stepMergeAndAuthorFixed(r, recordReview(r, evidence)))
{
  if inv(r) && canRecordReview(r, evidence) {
    var after := recordReview(r, evidence);
    ReviewerUniquenessMeaning(r);
    if exists v :: v in r.reviewers && v.actor == evidence.actor {
      assert |r.reviewers| == |after.reviewers|;
      assert forall i :: 0 <= i < |r.reviewers| ==> r.reviewers[i].actor == after.reviewers[i].actor;
      PreserveReviewerActors(r.reviewers, after.reviewers);
    } else {
      AppendUniqueReviewer(r.reviewers, Reviewer(evidence.actor, evidence.band, evidence.at, evidence.reviewId));
    }
    ReviewerUniquenessMeaning(after);
    assert alwaysUsefulBands(after);
    SumUsefulBands(after.reviewers, 0);
  }
}

lemma ReviewerUniquenessMeaning(r: Reviews)
  ensures alwaysDistinctReviewers(r) == !(exists v :: v in r.reviewers && !(|ProofLib.Filter((other: Reviewer) => other.actor == v.actor, r.reviewers)| == 1))
{
}

lemma AppendUniqueReviewer(xs: seq<Reviewer>, added: Reviewer)
  requires forall value :: value in xs ==> |ProofLib.Filter((other: Reviewer) => other.actor == value.actor, xs)| == 1
  requires forall value :: value in xs ==> value.actor != added.actor
  ensures forall value :: value in xs + [added] ==> |ProofLib.Filter((other: Reviewer) => other.actor == value.actor, xs + [added])| == 1
{
  forall value | value in xs + [added]
    ensures |ProofLib.Filter((other: Reviewer) => other.actor == value.actor, xs + [added])| == 1
  {
    ProofLib.FilterAppend((other: Reviewer) => other.actor == value.actor, xs, added);
    if value.actor == added.actor {
      ProofLib.FilterNone((other: Reviewer) => other.actor == value.actor, xs);
    }
  }
}

lemma PreserveReviewerActors(before: seq<Reviewer>, after: seq<Reviewer>)
  requires |before| == |after|
  requires forall i :: 0 <= i < |before| ==> before[i].actor == after[i].actor
  requires forall v :: v in before ==> |ProofLib.Filter((other: Reviewer) => other.actor == v.actor, before)| == 1
  ensures forall v :: v in after ==> |ProofLib.Filter((other: Reviewer) => other.actor == v.actor, after)| == 1
{
  forall v | v in after
    ensures |ProofLib.Filter((other: Reviewer) => other.actor == v.actor, after)| == 1
  {
    var i :| 0 <= i < |after| && after[i] == v;
    ProofLib.FilterLengthPointwise((other: Reviewer) => other.actor == v.actor, (other: Reviewer) => other.actor == v.actor, before, after);
  }
}

lemma SumUsefulBands(xs: seq<Reviewer>, acc: int)
  requires forall v :: v in xs ==> validBand(v.band)
  ensures Std.Collections.Seq.FoldLeft((a: int, v: Reviewer) => a + v.band, acc, xs) >= acc
  ensures |xs| > 0 ==> Std.Collections.Seq.FoldLeft((a: int, v: Reviewer) => a + v.band, acc, xs) >= acc + 10
  decreases |xs|
{
  if |xs| > 0 {
    SumUsefulBands(xs[1..], acc + xs[0].band);
  }
}
