// spec/contributor/publication.md, "Discovery leaves out a monthly pool configured at zero this month, a project paused at its intake cap or out of rotation, and a failed count read pauses nothing"

lemma lawOutOfRotationPauses_ensures(cap: int)
  ensures (lawOutOfRotationPauses(cap) == true)
{
  var r := backend__backlogRule_BacklogRead(true, 50, 0, backend__backlogRule_startsAtHours);
  var now := backend__backlogRule_startsAtHours;
  var f := (total: int, r: backend__backlogRule_BacklogRead) => (total + (if (r.read && ((now - r.observedAt) <= backend__backlogRule_readMaxAgeHours)) then r.waiting else 0));
  assert [] + [r] == [r];
  ProofLib.FoldLeftAppend(f, 0, [], r);
}
