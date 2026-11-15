// A manifest that duplicates no identity, source or work key keeps each key counted once.
lemma admitManifest_ensures(s: RetiredAwards, m: Manifest)
  ensures (inv(s) ==> canAdmitManifest(s, m) ==> alwaysAdmittedWellFormed(admitManifest(s, m)))
  ensures (inv(s) ==> canAdmitManifest(s, m) ==> alwaysRetainedPositive(admitManifest(s, m)))
  ensures (inv(s) ==> canAdmitManifest(s, m) ==> stepAdmittedPermanent(s, admitManifest(s, m)))
  ensures (inv(s) ==> canAdmitManifest(s, m) ==> stepAmountsRetained(s, admitManifest(s, m)))
  ensures (inv(s) ==> canAdmitManifest(s, m) ==> stepProtectionEndsForever(s, admitManifest(s, m)))
{
  if inv(s) && canAdmitManifest(s, m) {
    var xs := s.evaluations.admitted;
    UniqueMeaning(s.evaluations);
    AppendUniqueManifest(xs, m);
    UniqueMeaning(admitManifest(s, m).evaluations);
  }
}

lemma UniqueMeaning(e: Evaluations)
  ensures admittedUnique(e) == !((exists m :: m in e.admitted && !((wellFormed(m) && (|ProofLib.Filter((o: Manifest) => (((o.id == m.id) || (o.source == m.source)) || (o.workKey == m.workKey)), e.admitted)| == 1)))))
{
}

lemma AppendUniqueManifest(xs: seq<Manifest>, n: Manifest)
  requires forall m :: m in xs ==> wellFormed(m) && |ProofLib.Filter((o: Manifest) => (((o.id == m.id) || (o.source == m.source)) || (o.workKey == m.workKey)), xs)| == 1
  requires wellFormed(n)
  requires forall o :: o in xs ==> o.id != n.id && o.source != n.source && o.workKey != n.workKey
  ensures forall m :: m in xs + [n] ==> wellFormed(m) && |ProofLib.Filter((o: Manifest) => (((o.id == m.id) || (o.source == m.source)) || (o.workKey == m.workKey)), xs + [n])| == 1
{
  forall m | m in xs + [n]
    ensures wellFormed(m) && |ProofLib.Filter((o: Manifest) => (((o.id == m.id) || (o.source == m.source)) || (o.workKey == m.workKey)), xs + [n])| == 1
  {
    ProofLib.FilterAppend((o: Manifest) => (((o.id == m.id) || (o.source == m.source)) || (o.workKey == m.workKey)), xs, n);
    if m == n {
      ProofLib.FilterNone((o: Manifest) => (((o.id == m.id) || (o.source == m.source)) || (o.workKey == m.workKey)), xs);
    }
  }
}
