lemma lawAllocatedSharesValid_ensures(total: seq<int>, weights: seq<Weight>)
  ensures (lawAllocatedSharesValid(total, weights) == true)
{
  if canAllocate(total, weights) && |weights| > 1 {
    var denominator := totalWeight(weights);
    assert forall w :: w in weights ==> settlement__money_validAmount(w.weight);
    ValidWeightSum(weights, settlement__money_zero);
    assert |weights| > 1;
    assert settlement__money_validAmount(denominator);
    var portions := seq(|weights|, i_map requires 0 <= i_map < |weights| => var recipient := weights[i_map]; weightedPortion(total, recipient, denominator));
    var remaining := settlement__money_subtractAmounts(total, portionTotal(portions));
    var shares := allocateAmounts(total, weights);
    assert |shares| == |weights|;
    forall share | share in shares ensures settlement__money_validAmount(share.amount)
    {
      var i :| 0 <= i < |shares| && shares[i] == share;
      var part := portions[i];
      var w := weights[i];
      assert w in weights;
      assert part == weightedPortion(total, w, denominator);
      settlement__money_lawMultiplyValid_ensures(total, w.weight);
      settlement__money_lawDivisionValid_ensures(settlement__money_multiplyAmounts(total, w.weight), denominator);
      var extra := if settlement__money_compareAmounts(remainderRank(part, portions), remaining) < 0 then [1] else settlement__money_zero;
      assert settlement__money_validAmount(extra);
      assert share.amount == settlement__money_addAmounts(part.floor, extra);
      settlement__money_lawAdditionValid_ensures(part.floor, extra);
    }
  }
}

lemma ValidWeightSum(weights: seq<Weight>, start: seq<int>)
  requires settlement__money_validAmount(start)
  requires forall w :: w in weights ==> settlement__money_validAmount(w.weight)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((total: settlement__money_Amount, recipient: Weight) => settlement__money_addAmounts(total, recipient.weight), start, weights))
  decreases |weights|
{
  if |weights| > 0 {
    assert weights[0] in weights;
    settlement__money_lawAdditionValid_ensures(start, weights[0].weight);
    ValidWeightSum(weights[1..], settlement__money_addAmounts(start, weights[0].weight));
  }
}

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
