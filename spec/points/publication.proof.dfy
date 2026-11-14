// The fold compares each canonical record at its original position.
lemma observeCanonical_ensures(p: Publication, snapshot: seq<PublishedRecord>, verified: bool)
  ensures (inv(p) ==> canObserveCanonical(p, snapshot, verified) ==> alwaysUniqueVisible(observeCanonical(p, snapshot, verified)))
  ensures (inv(p) ==> canObserveCanonical(p, snapshot, verified) ==> alwaysCanonicalVisible(observeCanonical(p, snapshot, verified)))
  ensures (inv(p) ==> canObserveCanonical(p, snapshot, verified) ==> stepCanonicalObservationsOnly(p, "observeCanonical", observeCanonical(p, snapshot, verified)))
  ensures (inv(p) ==> canObserveCanonical(p, snapshot, verified) ==> stepOnlyPublicationChangesHistory(p, "observeCanonical", observeCanonical(p, snapshot, verified)))
  ensures (inv(p) ==> canObserveCanonical(p, snapshot, verified) ==> stepExactHistory(p, observeCanonical(p, snapshot, verified)))
{
  if inv(p) && canObserveCanonical(p, snapshot, verified) {
    PrefixTransitive(p.visible, p.canonical, snapshot);
    PrefixAgreesWithSlice(p.visible, p.visible);
  }
}

lemma PrefixTransitive(a: seq<PublishedRecord>, b: seq<PublishedRecord>, c: seq<PublishedRecord>)
  requires exactPrefix(a, b) && exactPrefix(b, c)
  ensures exactPrefix(a, c)
{
  PrefixAgreesWithSlice(a, b);
  PrefixAgreesWithSlice(b, c);
  PrefixAgreesWithSlice(a, c);
  assert b[..|a|] == c[..|b|][..|a|];
  assert c[..|b|][..|a|] == c[..|a|];
}

lemma PrefixAgreesWithSlice(prefix: seq<PublishedRecord>, full: seq<PublishedRecord>)
  requires |prefix| <= |full|
  ensures exactPrefix(prefix, full) == (prefix == full[..|prefix|])
{
  var f := (acc: PrefixCheck, row: PublishedRecord) => PrefixCheck((acc.offset + 1), (acc.exact && (row == (if ((0 <= acc.offset) && (acc.offset < |full|)) then full[acc.offset] else absentRecord))));
  if |prefix| > 0 {
    var smaller := prefix[..|prefix|-1];
    var last := prefix[|prefix|-1];
    assert prefix == smaller + [last];
    PrefixAgreesWithSlice(smaller, full);
    PrefixFoldLength(smaller, full);
    ProofLib.FoldLeftAppend(f, PrefixCheck(0, true), smaller, last);
    assert full[..|prefix|] == full[..|smaller|] + [full[|smaller|]];
  }
}

lemma PrefixFoldLength(prefix: seq<PublishedRecord>, full: seq<PublishedRecord>)
  ensures Std.Collections.Seq.FoldLeft((acc: PrefixCheck, row: PublishedRecord) => PrefixCheck((acc.offset + 1), (acc.exact && (row == (if ((0 <= acc.offset) && (acc.offset < |full|)) then full[acc.offset] else absentRecord)))), PrefixCheck(0, true), prefix).offset == |prefix|
{
  var f := (acc: PrefixCheck, row: PublishedRecord) => PrefixCheck((acc.offset + 1), (acc.exact && (row == (if ((0 <= acc.offset) && (acc.offset < |full|)) then full[acc.offset] else absentRecord))));
  if |prefix| > 0 {
    var smaller := prefix[..|prefix|-1];
    var last := prefix[|prefix|-1];
    assert prefix == smaller + [last];
    PrefixFoldLength(smaller, full);
    ProofLib.FoldLeftAppend(f, PrefixCheck(0, true), smaller, last);
  }
}

lemma stage_ensures(p: Publication, candidate: seq<PublishedRecord>)
  ensures (inv(p) ==> canStage(p) ==> alwaysUniqueVisible(stage(p, candidate)))
  ensures (inv(p) ==> canStage(p) ==> alwaysCanonicalVisible(stage(p, candidate)))
  ensures (inv(p) ==> canStage(p) ==> stepCanonicalObservationsOnly(p, "stage", stage(p, candidate)))
  ensures (inv(p) ==> canStage(p) ==> stepOnlyPublicationChangesHistory(p, "stage", stage(p, candidate)))
  ensures (inv(p) ==> canStage(p) ==> stepExactHistory(p, stage(p, candidate)))
{
  if inv(p) && canStage(p) {
    PrefixAgreesWithSlice(p.visible, p.visible);
  }
}

lemma reject_ensures(p: Publication)
  ensures (inv(p) ==> canReject(p) ==> alwaysUniqueVisible(reject(p)))
  ensures (inv(p) ==> canReject(p) ==> alwaysCanonicalVisible(reject(p)))
  ensures (inv(p) ==> canReject(p) ==> stepCanonicalObservationsOnly(p, "reject", reject(p)))
  ensures (inv(p) ==> canReject(p) ==> stepOnlyPublicationChangesHistory(p, "reject", reject(p)))
  ensures (inv(p) ==> canReject(p) ==> stepExactHistory(p, reject(p)))
{
  if inv(p) && canReject(p) {
    PrefixAgreesWithSlice(p.visible, p.visible);
  }
}

lemma interrupt_ensures(p: Publication)
  ensures (inv(p) ==> canInterrupt(p) ==> alwaysUniqueVisible(interrupt(p)))
  ensures (inv(p) ==> canInterrupt(p) ==> alwaysCanonicalVisible(interrupt(p)))
  ensures (inv(p) ==> canInterrupt(p) ==> stepCanonicalObservationsOnly(p, "interrupt", interrupt(p)))
  ensures (inv(p) ==> canInterrupt(p) ==> stepOnlyPublicationChangesHistory(p, "interrupt", interrupt(p)))
  ensures (inv(p) ==> canInterrupt(p) ==> stepExactHistory(p, interrupt(p)))
{
  if inv(p) && canInterrupt(p) {
    PrefixAgreesWithSlice(p.visible, p.visible);
  }
}

lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  PrefixAgreesWithSlice(initial.visible, initial.canonical);
  var only := initial.visible;
  var good := (other: PublishedRecord) => (other.id == firstRecord.id);
  reveal ProofLib.Filter();
  reveal Std.Collections.Seq.Filter();
  ProofLib.FilterAppend(good, [], firstRecord);
  ProofLib.FilterNil(good, []);
  assert |Std.Collections.Seq.Filter(good, only)| == 1;
  assert forall row :: row in only ==> row == firstRecord;
  assert uniqueRecords(initial.visible);
}
