lemma HoldsWellFormedFilter(h: Holds)
  ensures alwaysHoldsWellFormed(h) == ((h.now > 0) && !((exists r :: r in h.rows && !(((((((((((r.id > 0) && (r.project > 0)) && (r.actor > 0)) && validReason(r.reasonLength)) && (r.createdAt > 0)) && (r.createdAt <= h.now)) && (r.lifted == validReason(r.liftReasonLength))) && (r.lifted == (r.liftedAt > 0))) && (!(r.lifted) || ((r.liftedAt >= r.createdAt) && (r.liftedAt <= h.now)))) && (|ProofLib.Filter((o: Hold) => (o.id == r.id), h.rows)| == 1))))))
{
}

lemma placeHold_ensures(h: Holds, id: int, project: int, reasonLength: int, actor: int, by_: string)
  ensures (inv(h) ==> canPlaceHold(h, id, project, reasonLength, actor, by_) ==> alwaysHoldsWellFormed(placeHold(h, id, project, reasonLength, actor, by_)))
  ensures (inv(h) ==> canPlaceHold(h, id, project, reasonLength, actor, by_) ==> stepHoldsPermanent(h, placeHold(h, id, project, reasonLength, actor, by_)))
{
  if inv(h) && canPlaceHold(h, id, project, reasonLength, actor, by_) {
    var after := placeHold(h, id, project, reasonLength, actor, by_);
    var added := noHold.(id := id, project := project, reasonLength := reasonLength, actor := actor, createdAt := h.now);
    HoldsWellFormedFilter(h);
    HoldsWellFormedFilter(after);
    forall r | r in after.rows
      ensures |ProofLib.Filter((o: Hold) => (o.id == r.id), after.rows)| == 1
    {
      var pred := (o: Hold) => (o.id == r.id);
      ProofLib.FilterAppend(pred, h.rows, added);
      if r == added {
        ProofLib.FilterNone(pred, h.rows);
      } else {
        assert r in h.rows;
        assert r.id != added.id;
      }
    }
  }
}

lemma liftHold_ensures(h: Holds, id: int, liftReasonLength: int, by_: string)
  ensures (inv(h) ==> canLiftHold(h, id, liftReasonLength, by_) ==> alwaysHoldsWellFormed(liftHold(h, id, liftReasonLength, by_)))
  ensures (inv(h) ==> canLiftHold(h, id, liftReasonLength, by_) ==> stepHoldsPermanent(h, liftHold(h, id, liftReasonLength, by_)))
{
  if inv(h) && canLiftHold(h, id, liftReasonLength, by_) {
    var after := liftHold(h, id, liftReasonLength, by_);
    HoldsWellFormedFilter(h);
    HoldsWellFormedFilter(after);
    var u :| 0 <= u < |h.rows| && h.rows[u].id == id && !h.rows[u].lifted;
    forall i | 0 <= i < |h.rows| && h.rows[i].id == id
      ensures i == u
    {
      if i != u {
        assert h.rows[u] in h.rows;
        ProofLib.FilterTwo((o: Hold) => (o.id == h.rows[u].id), h.rows, u, i);
      }
    }
    forall r | r in h.rows
      ensures exists n :: n in after.rows && n.id == r.id && n.project == r.project && n.reasonLength == r.reasonLength && n.actor == r.actor && n.createdAt == r.createdAt && (!r.lifted || n == r)
    {
      var i :| 0 <= i < |h.rows| && h.rows[i] == r;
      assert after.rows[i] in after.rows;
    }
    forall r | r in after.rows
      ensures |ProofLib.Filter((o: Hold) => (o.id == r.id), after.rows)| == 1
    {
      var i :| 0 <= i < |after.rows| && after.rows[i] == r;
      assert h.rows[i] in h.rows;
      assert after.rows[i].id == h.rows[i].id;
      ProofLib.FilterLengthPointwise((o: Hold) => (o.id == r.id), (o: Hold) => (o.id == h.rows[i].id), after.rows, h.rows);
    }
  }
}
