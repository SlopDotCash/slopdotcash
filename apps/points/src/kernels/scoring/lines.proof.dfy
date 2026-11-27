// spec/points/authorship.md, "Recipient line weights sum additions plus deletions over claimed commit paths"
lemma lineWeight_ensures(additions: int, deletions: int)
  requires (additions >= 0)
  requires (deletions >= 0)
  ensures (lineWeight(additions, deletions) == (additions + deletions))
  ensures (lineWeight(additions, deletions) == linesFor([PathClaim(1, 1, 1, true, 7, false, 0, true, false, true, additions, deletions)], 1))
{
  var c := PathClaim(1, 1, 1, true, 7, false, 0, true, false, true, additions, deletions);
  var f := (t: LineTally, c: PathClaim) => tallyClaim(t, c, 1);
  ProofLib.FoldLeftAppend(f, LineTally([], 0), [], c);
  assert [] + [c] == [c];
  assert Std.Collections.Seq.FoldLeft(f, LineTally([], 0), []) == LineTally([], 0);
  assert tallyClaim(LineTally([], 0), c, 1) == LineTally([7], additions + deletions);
}
