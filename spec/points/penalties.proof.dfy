// One row per item survives append and reversal; reversal changes only reversal fields.
lemma recordPenalty_ensures(p: Penalties, close: ConfirmedClose)
  ensures (inv(p) ==> canRecordPenalty(p, close) ==> alwaysCreditsValid(recordPenalty(p, close)))
  ensures (inv(p) ==> canRecordPenalty(p, close) ==> alwaysOnePenaltyPerItem(recordPenalty(p, close)))
  ensures (inv(p) ==> canRecordPenalty(p, close) ==> alwaysPublishedDebit(recordPenalty(p, close)))
  ensures (inv(p) ==> canRecordPenalty(p, close) ==> alwaysFrozenWeightsNonNegative(recordPenalty(p, close)))
  ensures (inv(p) ==> canRecordPenalty(p, close) ==> stepRowsRetained(p, recordPenalty(p, close)))
  ensures (inv(p) ==> canRecordPenalty(p, close) ==> stepReopensAppendOnly(p, recordPenalty(p, close)))
  ensures (inv(p) ==> canRecordPenalty(p, close) ==> stepFrozenRetained(p, recordPenalty(p, close)))
{
  if inv(p) && canRecordPenalty(p, close) {
    var after := recordPenalty(p, close);
    var added := after.rows[|after.rows| - 1];
    assert after.rows == p.rows + [added];
    OneRowMeaning(p);
    assert forall r :: r in p.rows ==> r.item != added.item;
    AppendUniqueRows(p.rows, added);
    OneRowMeaning(after);
    forall r | r in p.rows
      ensures exists x :: x in after.rows && (sameDebit(x, r) && (!(r.reversed) || (x == r)))
    {
      assert r in after.rows && sameDebit(r, r);
    }
  }
}

lemma reversePenalty_ensures(p: Penalties, authority: ReversalAuthority)
  ensures (inv(p) ==> canReversePenalty(p, authority) ==> alwaysCreditsValid(reversePenalty(p, authority)))
  ensures (inv(p) ==> canReversePenalty(p, authority) ==> alwaysOnePenaltyPerItem(reversePenalty(p, authority)))
  ensures (inv(p) ==> canReversePenalty(p, authority) ==> alwaysPublishedDebit(reversePenalty(p, authority)))
  ensures (inv(p) ==> canReversePenalty(p, authority) ==> alwaysFrozenWeightsNonNegative(reversePenalty(p, authority)))
  ensures (inv(p) ==> canReversePenalty(p, authority) ==> stepRowsRetained(p, reversePenalty(p, authority)))
  ensures (inv(p) ==> canReversePenalty(p, authority) ==> stepReopensAppendOnly(p, reversePenalty(p, authority)))
  ensures (inv(p) ==> canReversePenalty(p, authority) ==> stepFrozenRetained(p, reversePenalty(p, authority)))
{
  if inv(p) && canReversePenalty(p, authority) {
    var after := reversePenalty(p, authority);
    assert |p.rows| == |after.rows|;
    assert forall i :: 0 <= i < |p.rows| ==> p.rows[i].item == after.rows[i].item;
    assert forall i :: 0 <= i < |p.rows| ==> sameDebit(after.rows[i], p.rows[i]);
    assert forall i :: 0 <= i < |p.rows| ==> p.rows[i].reversed ==> after.rows[i] == p.rows[i];
    OneRowMeaning(p);
    PreserveRowItems(p.rows, after.rows);
    OneRowMeaning(after);
    forall r | r in p.rows
      ensures exists x :: x in after.rows && (sameDebit(x, r) && (!(r.reversed) || (x == r)))
    {
      var i :| 0 <= i < |p.rows| && p.rows[i] == r;
      assert after.rows[i] in after.rows;
    }
  }
}

lemma OneRowMeaning(p: Penalties)
  ensures alwaysOnePenaltyPerItem(p) == !(exists r :: r in p.rows && !(|ProofLib.Filter((o: PenaltyRow) => (o.item == r.item), p.rows)| == 1))
{
}

lemma AppendUniqueRows(xs: seq<PenaltyRow>, added: PenaltyRow)
  requires forall value :: value in xs ==> |ProofLib.Filter((o: PenaltyRow) => (o.item == value.item), xs)| == 1
  requires forall value :: value in xs ==> value.item != added.item
  ensures forall value :: value in xs + [added] ==> |ProofLib.Filter((o: PenaltyRow) => (o.item == value.item), xs + [added])| == 1
{
  forall value | value in xs + [added]
    ensures |ProofLib.Filter((o: PenaltyRow) => (o.item == value.item), xs + [added])| == 1
  {
    ProofLib.FilterAppend((o: PenaltyRow) => (o.item == value.item), xs, added);
    if value.item == added.item {
      ProofLib.FilterNone((o: PenaltyRow) => (o.item == value.item), xs);
    }
  }
}

lemma PreserveRowItems(before: seq<PenaltyRow>, after: seq<PenaltyRow>)
  requires |before| == |after|
  requires forall i :: 0 <= i < |before| ==> before[i].item == after[i].item
  requires forall r :: r in before ==> |ProofLib.Filter((o: PenaltyRow) => (o.item == r.item), before)| == 1
  ensures forall r :: r in after ==> |ProofLib.Filter((o: PenaltyRow) => (o.item == r.item), after)| == 1
{
  forall r | r in after
    ensures |ProofLib.Filter((o: PenaltyRow) => (o.item == r.item), after)| == 1
  {
    var i :| 0 <= i < |after| && after[i] == r;
    assert before[i] in before;
    ProofLib.FilterLengthPointwise((o: PenaltyRow) => (o.item == r.item), (o: PenaltyRow) => (o.item == r.item), before, after);
  }
}
