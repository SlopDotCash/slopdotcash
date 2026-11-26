// spec/backend/backlogRule.md, "Fifty or more waiting pull requests take a project out of rotation"; spec/backend/backlogRule.md, "Work waiting with no merge in fourteen days is dormant"

lemma lawSingleRepoOverLimitHolds_ensures(r: BacklogRead, now: int)
  ensures (lawSingleRepoOverLimitHolds(r, now) == true)
{
  var f := (total: int, r: BacklogRead) => (total + (if (r.read && ((now - r.observedAt) <= readMaxAgeHours)) then r.waiting else 0));
  assert [] + [r] == [r];
  ProofLib.FoldLeftAppend(f, 0, [], r);
}

lemma lawSingleRepoDormantHolds_ensures(r: BacklogRead, now: int)
  ensures (lawSingleRepoDormantHolds(r, now) == true)
{
  var fw := (total: int, r: BacklogRead) => (total + (if (r.read && ((now - r.observedAt) <= readMaxAgeHours)) then r.waiting else 0));
  var fm := (latest: int, r: BacklogRead) => (if ((r.read && ((now - r.observedAt) <= readMaxAgeHours)) && (r.lastMergedAt > latest)) then r.lastMergedAt else latest);
  assert [] + [r] == [r];
  ProofLib.FoldLeftAppend(fw, 0, [], r);
  ProofLib.FoldLeftAppend(fm, 0, [], r);
}
