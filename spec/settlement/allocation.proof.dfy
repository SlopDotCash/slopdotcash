lemma lawSingleRecipient_ensures(total: seq<int>, actor: int)
  ensures (lawSingleRecipient(total, actor) == true)
{
  if settlement__money_validAmount(total) && actor > 0 {
    var entry := Weight(actor, [1]);
    var weights := [entry];
    assert settlement__money_validAmount(entry.weight) && settlement__money_positiveAmount(entry.weight);
    WeightAdmittedAlone(entry);
    var shares := allocateAmounts(total, weights);
    assert shares == [Share(actor, total)];
    settlement__money_lawEqualReflexive_ensures(total);
  }
}

lemma WeightAdmittedAlone(w: Weight)
  requires w.actor > 0 && settlement__money_validAmount(w.weight) && settlement__money_positiveAmount(w.weight)
  ensures validWeights([w])
{
  ProofLib.FilterCons((other: Weight) => (other.actor == w.actor), [w]);
  ProofLib.FilterNil((other: Weight) => (other.actor == w.actor), []);
  UnitWeightMeaning(w);
}

lemma UnitWeightMeaning(w: Weight)
  requires |ProofLib.Filter((other: Weight) => (other.actor == w.actor), [w])| == 1
  requires w.actor > 0 && settlement__money_validAmount(w.weight) && settlement__money_positiveAmount(totalWeight([w]))
  ensures validWeights([w])
{
}
