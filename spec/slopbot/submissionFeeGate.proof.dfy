lemma lawLabelAfterOpeningDoesNotInvite_ensures(e: LabelEvent, opened_: int)
  ensures (lawLabelAfterOpeningDoesNotInvite(e, opened_) == true)
{
  var f := (acc: LabelScan, ev: LabelEvent) => (if ((((ev.label_ == backend__mergeActivity_wantedLabelName) && (ev.at >= 0)) && (ev.at <= opened_)) && (ev.at >= acc.latest)) then LabelScan(ev.at, ev.added) else acc);
  assert [e] == [] + [e];
  ProofLib.FoldLeftAppend(f, LabelScan(-1, false), [], e);
}

lemma lawOtherLabelDoesNotInvite_ensures(e: LabelEvent, opened_: int)
  ensures (lawOtherLabelDoesNotInvite(e, opened_) == true)
{
  var f := (acc: LabelScan, ev: LabelEvent) => (if ((((ev.label_ == backend__mergeActivity_wantedLabelName) && (ev.at >= 0)) && (ev.at <= opened_)) && (ev.at >= acc.latest)) then LabelScan(ev.at, ev.added) else acc);
  assert [e] == [] + [e];
  ProofLib.FoldLeftAppend(f, LabelScan(-1, false), [], e);
}

lemma lawLatestLabelEventDecides_ensures(e: LabelEvent, opened_: int)
  ensures (lawLatestLabelEventDecides(e, opened_) == true)
{
  var f := (acc: LabelScan, ev: LabelEvent) => (if ((((ev.label_ == backend__mergeActivity_wantedLabelName) && (ev.at >= 0)) && (ev.at <= opened_)) && (ev.at >= acc.latest)) then LabelScan(ev.at, ev.added) else acc);
  assert [e] == [] + [e];
  ProofLib.FoldLeftAppend(f, LabelScan(-1, false), [], e);
  var e1 := e.(added := true);
  var e2 := e.(added := false);
  assert [e1] == [] + [e1];
  ProofLib.FoldLeftAppend(f, LabelScan(-1, false), [], e1);
  assert [e1, e2] == [e1] + [e2];
  ProofLib.FoldLeftAppend(f, LabelScan(-1, false), [e1], e2);
}
