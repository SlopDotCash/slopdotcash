// A singleton set union keeps the old members and admits only its argument.
lemma SingletonUnionMembers(values: seq<int>, value: int)
  ensures forall x :: x in values + ProofLib.Filter((set_x: int) => !((set_x in values)), [value]) <==> x in values || x == value
{
  forall x: int
    ensures x in values + ProofLib.Filter((set_x: int) => !((set_x in values)), [value]) <==> x in values || x == value
  {
    ProofLib.FilterMember((set_x: int) => !((set_x in values)), [value], x);
  }
}

lemma markPermanent_ensures(e: Evidence, ref: int)
  ensures (inv(e) ==> canMarkPermanent(e, ref) ==> alwaysPermanentRetained(markPermanent(e, ref)))
  ensures (inv(e) ==> canMarkPermanent(e, ref) ==> alwaysReferenceHistory(markPermanent(e, ref)))
  ensures (inv(e) ==> canMarkPermanent(e, ref) ==> alwaysDeletionAuthorized(markPermanent(e, ref)))
  ensures (inv(e) ==> canMarkPermanent(e, ref) ==> stepRetainsReferences(e, markPermanent(e, ref)))
{
  if inv(e) && canMarkPermanent(e, ref) {
    SingletonUnionMembers(e.permanent, ref);
    var after := markPermanent(e, ref);
    assert after.permanent == e.permanent + ProofLib.Filter((set_x: int) => !((set_x in e.permanent)), [ref]);
    assert forall x :: x in after.permanent ==> x in e.permanent || x == ref;
    assert forall x :: x in after.permanent ==> !(x in e.expired) && x in e.refs;
  }
}

lemma expireReference_ensures(e: Evidence, ref: int)
  ensures (inv(e) ==> canExpireReference(e, ref) ==> alwaysPermanentRetained(expireReference(e, ref)))
  ensures (inv(e) ==> canExpireReference(e, ref) ==> alwaysReferenceHistory(expireReference(e, ref)))
  ensures (inv(e) ==> canExpireReference(e, ref) ==> alwaysDeletionAuthorized(expireReference(e, ref)))
  ensures (inv(e) ==> canExpireReference(e, ref) ==> stepRetainsReferences(e, expireReference(e, ref)))
{
  if inv(e) && canExpireReference(e, ref) {
    SingletonUnionMembers(e.expired, ref);
    var after := expireReference(e, ref);
    assert after.expired == e.expired + ProofLib.Filter((set_x: int) => !((set_x in e.expired)), [ref]);
    assert forall x :: x in after.expired ==> x in e.expired || x == ref;
    assert forall x :: x in e.permanent ==> !(x in after.expired) && x in e.refs;
    assert forall x :: x in after.expired ==> x in e.refs;
  }
}

lemma deleteBytes_ensures(e: Evidence)
  ensures (inv(e) ==> canDeleteBytes(e) ==> alwaysPermanentRetained(deleteBytes(e)))
  ensures (inv(e) ==> canDeleteBytes(e) ==> alwaysReferenceHistory(deleteBytes(e)))
  ensures (inv(e) ==> canDeleteBytes(e) ==> alwaysDeletionAuthorized(deleteBytes(e)))
  ensures (inv(e) ==> canDeleteBytes(e) ==> stepRetainsReferences(e, deleteBytes(e)))
{
  if inv(e) && canDeleteBytes(e) {
    if |e.permanent| > 0 {
      var ref := e.permanent[0];
      assert ref in e.permanent;
      assert ref in e.refs;
      assert ref in e.expired;
      assert !(ref in e.expired);
    }
    assert |e.permanent| == 0;
  }
}
