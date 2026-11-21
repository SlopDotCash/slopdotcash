lemma lawDraftsMaintainersAndBotsNeverCount_ensures(p: backend__mergeActivity_OpenPull)
  ensures (lawDraftsMaintainersAndBotsNeverCount(p) == true)
{
  OneOpenPullCount(p);
}

lemma lawAnsweredPullStillCounts_ensures(p: backend__mergeActivity_OpenPull)
  ensures (lawAnsweredPullStillCounts(p) == true)
{
  OneOpenPullCount(p.(maintainerResponded := true));
}

// One open pull request counts once exactly when an outside author opened it ready for review.
lemma OneOpenPullCount(p: backend__mergeActivity_OpenPull)
  ensures openOutsideCount([p], 0) == (if backend__mergeActivity_outsideAuthor(p.association, p.bot) && !(p.draft) then 1 else 0)
{
  var outside := (p: backend__mergeActivity_OpenPull) => (backend__mergeActivity_outsideAuthor(p.association, p.bot) && !(p.draft));
  OpenOutsideCountFilter([p], 0);
  ProofLib.FilterCons(outside, [p]);
  ProofLib.FilterNil(outside, [p][1..]);
}

// The outside count, through the library's filter view.
lemma OpenOutsideCountFilter(open: seq<backend__mergeActivity_OpenPull>, countedBeyondPages: int)
  ensures openOutsideCount(open, countedBeyondPages) == |ProofLib.Filter((p: backend__mergeActivity_OpenPull) => (backend__mergeActivity_outsideAuthor(p.association, p.bot) && !(p.draft)), open)| + countedBeyondPages
{
}
