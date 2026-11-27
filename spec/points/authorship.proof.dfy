lemma FoldOneTally(f: (LineTally, PathClaim) -> LineTally, z: LineTally, a: PathClaim)
  ensures Std.Collections.Seq.FoldLeft(f, z, [a]) == f(z, a)
{
  ProofLib.FoldLeftAppend(f, z, [], a);
}

lemma FoldTwoTally(f: (LineTally, PathClaim) -> LineTally, z: LineTally, a: PathClaim, b: PathClaim)
  ensures Std.Collections.Seq.FoldLeft(f, z, [a, b]) == f(f(z, a), b)
{
  ProofLib.FoldLeftAppend(f, z, [], a);
  ProofLib.FoldLeftAppend(f, z, [a], b);
}

lemma FoldOneScan(f: (points__corrections_ZeroLineScan, points__corrections_CensusCommit) -> points__corrections_ZeroLineScan, z: points__corrections_ZeroLineScan, a: points__corrections_CensusCommit)
  ensures Std.Collections.Seq.FoldLeft(f, z, [a]) == f(z, a)
{
  ProofLib.FoldLeftAppend(f, z, [], a);
}

lemma ClaimsCompleteMeaning(claims: seq<PathClaim>)
  ensures claimsComplete(claims) == !((exists c :: c in claims && !((claimUsable(c) && (|ProofLib.Filter((o: PathClaim) => (o.claim == c.claim), claims)| == 1)))))
{
}

lemma ScoredDigestsMeaning(scored: seq<string>, digest: string, credited: bool)
  ensures scoredDigestsAfter(scored, digest, credited) == (if (credited && (digest != "")) then (scored + ProofLib.Filter((set_x: string) => !((set_x in scored)), [digest])) else scored)
{
}

lemma lawLinesAreAdditionsPlusDeletions_ensures(additions: int, deletions: int)
  ensures (lawLinesAreAdditionsPlusDeletions(additions, deletions) == true)
{
  var c := plainClaim.(additions := additions, deletions := deletions);
  FoldOneTally((t: LineTally, c: PathClaim) => tallyClaim(t, c, 1), LineTally([], 0), c);
}

lemma lawRenamedFileCountsOnce_ensures(additions: int, deletions: int)
  ensures (lawRenamedFileCountsOnce(additions, deletions) == true)
{
  var c1 := plainClaim.(additions := additions, deletions := deletions);
  var c2 := plainClaim.(claim := 2, additions := additions, deletions := deletions);
  FoldTwoTally((t: LineTally, c: PathClaim) => tallyClaim(t, c, 1), LineTally([], 0), c1, c2);
}

lemma lawMergeResolutionCounted_ensures(additions: int, deletions: int)
  ensures (lawMergeResolutionCounted(additions, deletions) == true)
{
  var c := plainClaim.(merge := true, resolutions := 1, attributed := false, additions := additions, deletions := deletions);
  FoldOneTally((t: LineTally, c: PathClaim) => tallyClaim(t, c, 1), LineTally([], 0), c);
}

lemma lawRepeatedClaimHolds_ensures(additions: int)
  ensures (lawRepeatedClaimHolds(additions) == true)
{
  var c1 := plainClaim;
  var c2 := plainClaim.(additions := additions);
  var xs := [c1, c2];
  ClaimsCompleteMeaning(xs);
  ProofLib.FilterTwo((o: PathClaim) => (o.claim == c1.claim), xs, 0, 1);
  assert c1 in xs && |ProofLib.Filter((o: PathClaim) => (o.claim == c1.claim), xs)| >= 2;
}

lemma lawScoredDigestHoldsItsRepeat_ensures(selection: CreditSelection, digest: string)
  ensures (lawScoredDigestHoldsItsRepeat(selection, digest) == true)
{
  if selection.v2 && selection.valueInput && !selection.ratified && !selection.valueRecord && digest != "" {
    var empty: seq<string> := [];
    ScoredDigestsMeaning(empty, digest, true);
    ProofLib.FilterMember((set_x: string) => !((set_x in empty)), [digest], digest);
  }
}

lemma lawHistoricalScoringHasNoRollingHolds_ensures(selection: CreditSelection)
  ensures (lawHistoricalScoringHasNoRollingHolds(selection) == true)
{
  if !selection.rolling {
    var z := points__corrections_ZeroLineScan(false, false, false, false);
    FoldOneScan((acc: points__corrections_ZeroLineScan, row: points__corrections_CensusCommit) => points__corrections_scanCommit(acc, row), z, ownedChangeRow);
    assert !points__corrections_unprovedZeroLinePromotion([]);
    assert !points__corrections_unprovedZeroLinePromotion([ownedChangeRow]);
  }
}
