lemma LatestDecisionsSubset(acc: seq<PullReview>, reviews: seq<PullReview>)
  ensures forall r :: r in Std.Collections.Seq.FoldLeft((kept: seq<PullReview>, r: PullReview) => (if decisive(r) then (Std.Collections.Seq.Filter((k: PullReview) => (k.reviewer != r.reviewer), kept) + [r]) else kept), acc, reviews) ==> r in acc || r in reviews
  decreases |reviews|
{
  if |reviews| > 0 {
    var f := (kept: seq<PullReview>, r: PullReview) => (if decisive(r) then (Std.Collections.Seq.Filter((k: PullReview) => (k.reviewer != r.reviewer), kept) + [r]) else kept);
    var next := f(acc, reviews[0]);
    LatestDecisionsSubset(next, reviews[1..]);
    assert Std.Collections.Seq.FoldLeft(f, acc, reviews) == Std.Collections.Seq.FoldLeft(f, next, reviews[1..]);
    forall r | r in next
      ensures r in acc || r in reviews
    {
      if decisive(reviews[0]) && r != reviews[0] {
        ProofLib.FilterMember((k: PullReview) => (k.reviewer != reviews[0].reviewer), acc, r);
      }
    }
    assert forall r :: r in reviews[1..] ==> r in reviews;
  }
}

lemma lawReadOnlyApprovalNeverCounts_ensures(fetched: ReviewRead, author: int)
  ensures (lawReadOnlyApprovalNeverCounts(fetched, author) == true)
{
  if !(exists r :: r in fetched.reviews && !(!(r.writeAccess))) {
    LatestDecisionsSubset([], fetched.reviews);
    ProofLib.FilterNone((r: PullReview) => (approvesAtHead(r, author) && r.writeAccess), latestDecisions(fetched.reviews));
  }
}

lemma lawAuthorNeverApprovesTheirOwnPull_ensures(fetched: ReviewRead, author: int)
  ensures (lawAuthorNeverApprovesTheirOwnPull(fetched, author) == true)
{
  if !(exists r :: r in fetched.reviews && !((r.reviewer == author))) {
    LatestDecisionsSubset([], fetched.reviews);
    ProofLib.FilterNone((r: PullReview) => (approvesAtHead(r, author) && r.writeAccess), latestDecisions(fetched.reviews));
  }
}
