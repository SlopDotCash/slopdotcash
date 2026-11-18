lemma lawHiddenOrIncompleteRowOmitted_ensures(row: Registration)
  ensures (lawHiddenOrIncompleteRowOmitted(row) == true)
{
  ProofLib.FilterCons((r: Registration) => visibleReferral(r), [row]);
  ProofLib.FilterNil((r: Registration) => visibleReferral(r), [row][1..]);
}

lemma lawPublicRegistrationAppears_ensures(row: Registration)
  ensures (lawPublicRegistrationAppears(row) == true)
{
  if visibleReferral(row) {
    ProofLib.FilterCons((r: Registration) => visibleReferral(r), [row]);
    ProofLib.FilterNil((r: Registration) => visibleReferral(r), [row][1..]);
    var projection := referredProjects([row]);
    assert |projection| == 1;
    assert projection[0] == projectProjection(row);
    assert projection == [projectProjection(row)];
  }
}

lemma lawFilterPreservesOrder_ensures(first: Registration, second: Registration)
  ensures (lawFilterPreservesOrder(first, second) == true)
{
  var p := (row: Registration) => visibleReferral(row);
  assert [first, second][1..] == [second];
  assert [second][1..] == [];
  ProofLib.FilterCons(p, [first, second]);
  ProofLib.FilterCons(p, [second]);
  ProofLib.FilterNil(p, []);
}

lemma lawRetiredRowWithAttributionAppears_ensures(row: Registration)
  ensures (lawRetiredRowWithAttributionAppears(row) == true)
{
  lawPublicRegistrationAppears_ensures(row);
}
