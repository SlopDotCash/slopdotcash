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
// A strict total order over unique positions has each rank from zero to length minus one.
lemma RankedCountPartition<T>(before: T -> bool, after: T -> bool, xs: seq<T>)
  requires forall x :: x in xs ==> before(x) || after(x)
  requires forall x :: x in xs ==> !(before(x) && after(x))
  ensures |ProofLib.Filter(before, xs)| + |ProofLib.Filter(after, xs)| == |xs|
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(before, xs);
    ProofLib.FilterNil(after, xs);
  } else {
    assert xs[0] in xs;
    assert forall x :: x in xs[1..] ==> x in xs;
    ProofLib.FilterCons(before, xs);
    ProofLib.FilterCons(after, xs);
    RankedCountPartition(before, after, xs[1..]);
  }
}

lemma RankStrict(less: (Portion, Portion) -> bool, xs: seq<Portion>, smaller: Portion, larger: Portion)
  requires forall x, y, z :: less(x,y) && less(y,z) ==> less(x,z)
  requires forall x :: !less(x,x)
  requires smaller in xs && less(smaller, larger)
  ensures |ProofLib.Filter((x: Portion) => less(x,smaller), xs)| < |ProofLib.Filter((x: Portion) => less(x,larger), xs)|
{
  assert forall i :: 0 <= i < |xs| && less(xs[i], smaller) ==> less(xs[i], larger);
  var i :| 0 <= i < |xs| && xs[i] == smaller;
  assert less(xs[i], larger) && !less(xs[i], smaller);
  ProofLib.FilterImpLength((x: Portion) => less(x,smaller), (x: Portion) => less(x,larger), xs);
}

lemma RankSet(less: (Portion, Portion) -> bool, xs: seq<Portion>)
  requires forall x, y, z :: less(x,y) && less(y,z) ==> less(x,z)
  requires forall x :: !less(x,x)
  requires forall x, y :: x in xs && y in xs && x != y ==> less(x,y) || less(y,x)
  ensures forall r :: r in xs ==> 0 <= |ProofLib.Filter((x: Portion) => less(x,r), xs)| < |xs|
  ensures forall r, s :: r in xs && s in xs && r != s ==>
    |ProofLib.Filter((x: Portion) => less(x,r), xs)| != |ProofLib.Filter((x: Portion) => less(x,s), xs)|
{
  forall r | r in xs ensures |ProofLib.Filter((x: Portion) => less(x,r), xs)| < |xs| {
    var i :| 0 <= i < |xs| && xs[i] == r;
    assert !less(xs[i], r);
    ProofLib.FilterImpLength((x: Portion) => less(x,r), (x: Portion) => true, xs);
    RankedCountPartition((x: Portion) => true, (x: Portion) => false, xs);
    ProofLib.FilterNone((x: Portion) => false, xs);
  }
  forall r, s | r in xs && s in xs && r != s
    ensures |ProofLib.Filter((x: Portion) => less(x,r), xs)| != |ProofLib.Filter((x: Portion) => less(x,s), xs)|
  {
    if less(r,s) { RankStrict(less,xs,r,s); }
    else { RankStrict(less,xs,s,r); }
  }
}

lemma RankCountBelowDistinct(xs: seq<int>, bound: int, count: int)
  requires ProofLib.Distinct(xs)
  requires forall x :: x in xs ==> 0 <= x < bound
  requires |xs| == bound && 0 <= count <= bound
  ensures |ProofLib.Filter((x: int) => x < count, xs)| == count
{
  var members := set x {:trigger x in xs} | 0 <= x < bound;
  var contents := set x | x in xs;
  assert contents <= members;
  RankIntervalCard(bound);
  RankDistinctCard(xs);
  assert |contents| == |members|;
  if contents != members {
    var missing :| missing in members && missing !in contents;
    assert contents <= members - {missing};
    ProofLib.SubsetCard(contents, members - {missing});
    assert false;
  }
  var below := ProofLib.Filter((x: int) => x < count, xs);
  var prefix := set x {:trigger x in xs} | 0 <= x < count;
  RankFilterDistinct((x: int) => x < count, xs);
  RankDistinctCard(below);
  RankIntervalCard(count);
  assert (set x | x in below) == prefix by {
    forall x | x in below || x in prefix ensures (x in below) == (x in prefix) {
      ProofLib.FilterMember((x: int) => x < count, xs, x);
      assert (x in below) == (x in xs && x < count);
      assert (x in xs) == (x in contents);
      assert (x in contents) == (x in members);
      assert (x in prefix) == (0 <= x < count);
      assert (x in members) == (0 <= x < bound);
    }
  }

}

lemma RankIntervalCard(n: int)
  requires n >= 0
  ensures |set x {:trigger x in [x]} | 0 <= x < n| == n
  decreases n
{
  if n > 0 {
    RankIntervalCard(n - 1);
    assert (set x {:trigger x in [x]} | 0 <= x < n) == (set x {:trigger x in [x]} | 0 <= x < n - 1) + {n - 1};
  } else {
    assert (set x {:trigger x in [x]} | 0 <= x < n) == {};
  }
}

lemma RankDistinctCard(xs: seq<int>)
  requires ProofLib.Distinct(xs)
  ensures |set x | x in xs| == |xs|
  decreases |xs|
{
  if |xs| > 0 {
    var first := xs[0];
    var tail := xs[1..];
    assert forall i, j :: 0 <= i < j < |tail| ==> tail[i] != tail[j] by {
      forall i,j | 0 <= i < j < |tail| ensures tail[i] != tail[j] {
        assert tail[i] == xs[i+1] && tail[j] == xs[j+1];
      }
    }
    assert first !in tail by {
      if first in tail {
        var i :| 0 <= i < |tail| && tail[i] == first;
        assert xs[i+1] == tail[i];
        assert false;
      }
    }
    RankDistinctCard(tail);
    assert (set x | x in xs) == (set x | x in tail) + {first};
  } else {
    assert (set x | x in xs) == {};
  }
}

lemma RankFilterDistinct(p: int -> bool, xs: seq<int>)
  requires ProofLib.Distinct(xs)
  ensures ProofLib.Distinct(ProofLib.Filter(p, xs))
{
  assert ProofLib.DistinctBy(xs, (x: int) => x);
  ProofLib.FilterKeepsDistinctBy(p, xs, (x: int) => x);
}

lemma RankIndexCount(less: (Portion, Portion) -> bool, xs: seq<Portion>, count: int, ranked: Portion -> bool)
  requires ProofLib.Distinct(xs)
  requires 0 <= count <= |xs|
  requires forall x :: !less(x,x)
  requires forall x,y,z :: less(x,y) && less(y,z) ==> less(x,z)
  requires forall x,y :: x in xs && y in xs && x != y ==> less(x,y) || less(y,x)
  requires forall r :: ranked(r) == (|ProofLib.Filter((other: Portion) => less(other,r),xs)| < count)
  ensures |ProofLib.Filter(ranked,xs)| == count
{
  RankSet(less, xs);
  var ranks := seq(|xs|, i requires 0 <= i < |xs| => |ProofLib.Filter((other: Portion) => less(other,xs[i]), xs)|);
  forall rank | rank in ranks ensures 0 <= rank < |xs| {
    var i :| 0 <= i < |ranks| && ranks[i] == rank;
    var recipient := xs[i];
    assert recipient in xs;
    var predecessors := (other: Portion) => less(other,recipient);
    assert rank == |ProofLib.Filter(predecessors,xs)|;
    assert |ProofLib.Filter(predecessors,xs)| < |xs|;
  }
  forall i,j | 0 <= i < j < |ranks| ensures ranks[i] != ranks[j] {
    var first := xs[i];
    var second := xs[j];
    assert first in xs && second in xs && first != second;
    var firstPredecessors := (other: Portion) => less(other,first);
    var secondPredecessors := (other: Portion) => less(other,second);
    assert ranks[i] == |ProofLib.Filter(firstPredecessors,xs)|;
    assert ranks[j] == |ProofLib.Filter(secondPredecessors,xs)|;
    assert |ProofLib.Filter(firstPredecessors,xs)| != |ProofLib.Filter(secondPredecessors,xs)|;
  }
  RankCountBelowDistinct(ranks, |xs|, count);
  forall i | 0 <= i < |xs| ensures ranked(xs[i]) == (ranks[i] < count) {
    var r := xs[i];
    assert ranked(r) == (|ProofLib.Filter((other: Portion) => less(other,r),xs)| < count);
  }
  ProofLib.FilterLengthPointwise(ranked,(rank: int) => rank < count,xs,ranks);
}
lemma PortionOrderTransitive(a: Portion, b: Portion, c: Portion)
  requires settlement__money_validAmount(a.remainder) && settlement__money_validAmount(b.remainder) && settlement__money_validAmount(c.remainder)
  requires portionBefore(a,b) && portionBefore(b,c)
  ensures portionBefore(a,c)
{
  settlement__money_lawNumericOrderTotal_ensures(a.remainder, b.remainder);
  settlement__money_lawNumericOrderTotal_ensures(b.remainder, c.remainder);
  settlement__money_lawNumericOrderTotal_ensures(c.remainder, a.remainder);
  settlement__money_lawNumericOrderTransitive_ensures(c.remainder, b.remainder, a.remainder);
}

lemma PortionOrderTotal(a: Portion, b: Portion)
  requires settlement__money_validAmount(a.remainder) && settlement__money_validAmount(b.remainder)
  requires a.actor != b.actor
  ensures portionBefore(a,b) == !portionBefore(b,a)
{
  settlement__money_lawNumericOrderTotal_ensures(a.remainder, b.remainder);
}

// Exact rank increments agree with counting the ordered predecessors in the list.
lemma ExactRankDigits(portions: seq<Portion>, ranked: Portion, before: seq<int>)
  requires settlement__money_validAmount(before)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((rank: settlement__money_Amount, other: Portion) => (if portionBefore(other, ranked) then settlement__money_addAmounts(rank, [1]) else rank), before, portions))
  ensures var less := (other: Portion) => portionBefore(other, ranked);
    var stepRank := (rank: settlement__money_Amount, other: Portion) => (if portionBefore(other, ranked) then settlement__money_addAmounts(rank, [1]) else rank);
    Std.Collections.Seq.FoldLeft(stepRank,before,portions) ==
      Std.Collections.Seq.FoldLeft((rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]),before,ProofLib.Filter(less,portions))
  decreases |portions|
{
  var less := (other: Portion) => portionBefore(other, ranked);
  if |portions| > 0 {
    var r := portions[0];
    var kept := ProofLib.Filter(less, portions);
    ProofLib.FilterCons(less, portions);
    if portionBefore(r,ranked) {
      var next := settlement__money_addAmounts(before, [1]);
      settlement__money_lawAdditionValid_ensures(before,[1]);
      ExactRankDigits(portions[1..],ranked,next);
      assert |kept| > 0 && kept[0] == r;
      assert kept[1..] == ProofLib.Filter(less,portions[1..]);
    } else {
      ExactRankDigits(portions[1..],ranked,before);
      assert kept == ProofLib.Filter(less,portions[1..]);
    }
  } else {
    ProofLib.FilterNil(less, portions);
  }
}

lemma UnitCountsOrder(a: seq<Portion>, b: seq<Portion>, first: seq<int>, second: seq<int>)
  requires settlement__money_validAmount(first) && settlement__money_validAmount(second)
  requires |a| == |b|
  ensures var next := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]);
    settlement__money_compareAmounts(Std.Collections.Seq.FoldLeft(next, first, a), Std.Collections.Seq.FoldLeft(next, second, b)) ==
      settlement__money_compareAmounts(first, second)
  decreases |a|
{
  if |a| > 0 {
    settlement__money_lawAdditionValid_ensures(first, [1]);
    settlement__money_lawAdditionValid_ensures(second, [1]);
    settlement__money_lawAddOrder_ensures(first, second, [1]);
    UnitCountsOrder(a[1..], b[1..], settlement__money_addAmounts(first, [1]), settlement__money_addAmounts(second, [1]));
  }
}

lemma UnitCountValidity(xs: seq<Portion>, start: seq<int>)
  requires settlement__money_validAmount(start)
  ensures settlement__money_validAmount(Std.Collections.Seq.FoldLeft((rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]), start, xs))
  decreases |xs|
{
  if |xs| > 0 {
    settlement__money_lawAdditionValid_ensures(start, [1]);
    UnitCountValidity(xs[1..], settlement__money_addAmounts(start, [1]));
  }
}

lemma MoreThanZeroUnitSteps(xs: seq<Portion>, start: seq<int>)
  requires settlement__money_validAmount(start) && |xs| > 0
  ensures settlement__money_compareAmounts(start, Std.Collections.Seq.FoldLeft((rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]), start, xs)) < 0
  decreases |xs|
{
  var next := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]);
  var advanced := settlement__money_addAmounts(start,[1]);
  IncrementLimbOrder(start);
  settlement__money_lawAdditionValid_ensures(start,[1]);
  var tail := xs[1..];
  var after := Std.Collections.Seq.FoldLeft(next, advanced, tail);
  assert Std.Collections.Seq.FoldLeft(next, start, xs) == after;
  if |tail| > 0 {
    MoreThanZeroUnitSteps(tail, advanced);
    UnitCountValidity(tail, advanced);
    settlement__money_lawNumericOrderTransitive_ensures(start, advanced, after);
  }
}

lemma IncrementLimbOrder(start: seq<int>)
  requires settlement__money_validAmount(start)
  ensures settlement__money_compareAmounts(start,settlement__money_addAmounts(start,[1])) < 0
{
  settlement__money_lawAddCommutative_ensures(start,[1]);
  settlement__money_lawAddCommutative_ensures(settlement__money_zero,start);
  settlement__money_lawZeroIdentity_ensures(start);
  settlement__money_lawAddOrder_ensures(settlement__money_zero,[1],start);
  assert settlement__money_compareAmounts(settlement__money_zero,[1]) == -1;
  settlement__money_lawEqualOrder_ensures(settlement__money_addAmounts(start,settlement__money_zero),start,settlement__money_addAmounts(start,[1]));
}

lemma {:induction false} UnitCountsStrict(a: seq<Portion>, b: seq<Portion>, start: seq<int>)
  requires settlement__money_validAmount(start)
  requires |a| < |b|
  ensures var next := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]);
    settlement__money_compareAmounts(Std.Collections.Seq.FoldLeft(next, start, a), Std.Collections.Seq.FoldLeft(next, start, b)) < 0
  decreases |a|
{
  var next := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]);
  if |a| == 0 {
    MoreThanZeroUnitSteps(b,start);
  } else {
    var advanced := settlement__money_addAmounts(start,[1]);
    settlement__money_lawAdditionValid_ensures(start,[1]);
    var tailA := a[1..];
    var tailB := b[1..];
    assert |tailA| < |tailB|;
    UnitCountsStrict(tailA,tailB,advanced);
    assert Std.Collections.Seq.FoldLeft(next,start,a) == Std.Collections.Seq.FoldLeft(next,advanced,tailA);
    assert Std.Collections.Seq.FoldLeft(next,start,b) == Std.Collections.Seq.FoldLeft(next,advanced,tailB);
  }
}

lemma RankBeforeCount(portions: seq<Portion>, thresholdSites: seq<Portion>, threshold: seq<int>, ranked: Portion)
  requires var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]);
    settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(inc,settlement__money_zero,thresholdSites),threshold)
  ensures (settlement__money_compareAmounts(remainderRank(ranked,portions), threshold) < 0) ==
    (|ProofLib.Filter((other: Portion) => portionBefore(other,ranked), portions)| < |thresholdSites|)
{
  var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]);
  var kept := ProofLib.Filter((other: Portion) => portionBefore(other,ranked), portions);
  var bound := Std.Collections.Seq.FoldLeft(inc,settlement__money_zero,thresholdSites);
  var rankedAmount := remainderRank(ranked,portions);
  ExactRankDigits(portions, ranked, settlement__money_zero);
  settlement__money_lawEqualOrder_ensures(bound,threshold,rankedAmount);
  if |kept| < |thresholdSites| {
    UnitCountsStrict(kept,thresholdSites,settlement__money_zero);
  } else if |kept| == |thresholdSites| {
    UnitCountsOrder(kept,thresholdSites,settlement__money_zero,settlement__money_zero);
    settlement__money_lawEqualReflexive_ensures(settlement__money_zero);
  } else {
    UnitCountsStrict(thresholdSites,kept,settlement__money_zero);
    UnitCountValidity(thresholdSites,settlement__money_zero);
    settlement__money_lawNumericOrderTotal_ensures(bound,rankedAmount);
  }
}

lemma PortionOrderProperties(portions: seq<Portion>, less: (Portion, Portion) -> bool)
  requires ProofLib.DistinctBy(portions, (r: Portion) => r.actor)
  requires forall r :: r in portions ==> settlement__money_validAmount(r.remainder)
  requires forall r,s :: less(r,s) == (settlement__money_validAmount(r.remainder) && settlement__money_validAmount(s.remainder) && portionBefore(r,s))
  ensures forall a,b,c :: less(a,b) && less(b,c) ==> less(a,c)
  ensures forall r :: !less(r,r)
  ensures forall a,b :: a in portions && b in portions && a != b ==> less(a,b) || less(b,a)
{
  forall a,b,c | less(a,b) && less(b,c) ensures less(a,c) { PortionOrderTransitive(a,b,c); }
  forall r | true ensures !less(r,r) { settlement__money_lawEqualReflexive_ensures(r.remainder); }
  forall a,b | a in portions && b in portions && a != b ensures less(a,b) || less(b,a) {
    var i :| 0 <= i < |portions| && a == portions[i];
    var j :| 0 <= j < |portions| && b == portions[j];
    PortionOrderTotal(a,b);
  }
}

lemma PortionRankPredicate(portions: seq<Portion>, r: Portion, thresholdSites: seq<Portion>, threshold: seq<int>, less: (Portion, Portion) -> bool)
  requires r in portions
  requires forall other :: other in portions ==> less(other,r) == portionBefore(other,r)
  requires var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]);
    settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(inc,settlement__money_zero,thresholdSites),threshold)
  ensures (settlement__money_compareAmounts(remainderRank(r,portions),threshold) < 0) ==
    (|ProofLib.Filter((other: Portion) => less(other,r),portions)| < |thresholdSites|)
{
  forall i | 0 <= i < |portions| ensures less(portions[i],r) == portionBefore(portions[i],r) { assert portions[i] in portions; }
  ProofLib.FilterSamePredicate((other: Portion) => portionBefore(other,r),(other: Portion) => less(other,r),portions);
  RankBeforeCount(portions,thresholdSites,threshold,r);
}

lemma CountRemainderRecipients(portions: seq<Portion>, thresholdSites: seq<Portion>, threshold: seq<int>)
  requires ProofLib.DistinctBy(portions, (r: Portion) => r.actor)
  requires forall r :: r in portions ==> settlement__money_validAmount(r.remainder)
  requires |thresholdSites| <= |portions|
  requires var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]);
    settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(inc,settlement__money_zero,thresholdSites),threshold)
  ensures |ProofLib.Filter((r: Portion) => settlement__money_compareAmounts(remainderRank(r,portions),threshold) < 0,portions)| == |thresholdSites|
{
  var less := (a: Portion, b: Portion) => settlement__money_validAmount(a.remainder) && settlement__money_validAmount(b.remainder) && portionBefore(a,b);
  var ranked := (r: Portion) => |ProofLib.Filter((other: Portion) => less(other,r),portions)| < |thresholdSites|;
  var selected := (r: Portion) => settlement__money_compareAmounts(remainderRank(r,portions),threshold) < 0;
  RankPortionsByRemainder(portions,less,|thresholdSites|,ranked);
  IdentifyRemainderRecipients(portions,thresholdSites,threshold,less,ranked,selected);
}

lemma RankPortionsByRemainder(portions: seq<Portion>, less: (Portion, Portion) -> bool, count: int, ranked: Portion -> bool)
  requires ProofLib.DistinctBy(portions, (r: Portion) => r.actor)
  requires forall r :: r in portions ==> settlement__money_validAmount(r.remainder)
  requires forall r,s :: less(r,s) == (settlement__money_validAmount(r.remainder) && settlement__money_validAmount(s.remainder) && portionBefore(r,s))
  requires forall r :: ranked(r) == (|ProofLib.Filter((other: Portion) => less(other,r),portions)| < count)
  requires 0 <= count <= |portions|
  ensures |ProofLib.Filter(ranked,portions)| == count
{
  assert ProofLib.Distinct(portions);
  PortionOrderProperties(portions,less);
  RankIndexCount(less,portions,count,ranked);
}

lemma IdentifyRemainderRecipients(portions: seq<Portion>, thresholdSites: seq<Portion>, threshold: seq<int>, less: (Portion, Portion) -> bool, ranked: Portion -> bool, selected: Portion -> bool)
  requires forall r :: r in portions ==> settlement__money_validAmount(r.remainder)
  requires forall r,s :: less(r,s) == (settlement__money_validAmount(r.remainder) && settlement__money_validAmount(s.remainder) && portionBefore(r,s))
  requires forall r :: ranked(r) == (|ProofLib.Filter((other: Portion) => less(other,r),portions)| < |thresholdSites|)
  requires forall r :: selected(r) == (settlement__money_compareAmounts(remainderRank(r,portions),threshold) < 0)
  requires var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]);
    settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(inc,settlement__money_zero,thresholdSites),threshold)
  ensures ProofLib.Filter(ranked,portions) == ProofLib.Filter(selected,portions)
{
  forall i | 0 <= i < |portions| ensures ranked(portions[i]) == selected(portions[i]) {
    var r := portions[i];
    assert r in portions;
    PortionRankPredicate(portions,r,thresholdSites,threshold,less);
  }
  ProofLib.FilterSamePredicate(ranked,selected,portions);
}

lemma EqualAllocationAmount(a: seq<int>, b: seq<int>, c: seq<int>)
  requires settlement__money_equalAmounts(a,b) && settlement__money_equalAmounts(b,c)
  ensures settlement__money_equalAmounts(a,c)
{
  settlement__money_lawEqualSubstitution_ensures(a,b,c);
}

lemma AllocationAppendUnit(a: seq<int>, b: seq<int>, c: seq<int>)
  requires settlement__money_validAmount(a) && settlement__money_validAmount(b) && settlement__money_validAmount(c)
  ensures settlement__money_equalAmounts(settlement__money_addAmounts(settlement__money_addAmounts(a,b),c), settlement__money_addAmounts(settlement__money_addAmounts(a,c),b))
{
  settlement__money_lawAddCommutative_ensures(b,c);
  settlement__money_lawAddAssociative_ensures(a,b,c);
  settlement__money_lawAddAssociative_ensures(a,c,b);
  settlement__money_lawEqualSymmetric_ensures(settlement__money_addAmounts(a,settlement__money_addAmounts(b,c)),settlement__money_addAmounts(settlement__money_addAmounts(a,c),b));
  EqualAllocationAmount(settlement__money_addAmounts(settlement__money_addAmounts(a,b),c),settlement__money_addAmounts(a,settlement__money_addAmounts(b,c)),settlement__money_addAmounts(settlement__money_addAmounts(a,c),b));
}

// Each selected recipient adds one base unit to the sum of floors.
lemma SumRemainderShares(portions: seq<Portion>, receives: Portion -> bool, floorBase: seq<int>, extraBase: seq<int>, shareBase: seq<int>)
  requires settlement__money_validAmount(floorBase) && settlement__money_validAmount(extraBase) && settlement__money_validAmount(shareBase)
  requires forall p :: p in portions ==> settlement__money_validAmount(p.floor)
  requires settlement__money_equalAmounts(shareBase,settlement__money_addAmounts(floorBase,extraBase))
  ensures var floors := (sum: settlement__money_Amount, p: Portion) => settlement__money_addAmounts(sum,p.floor);
    var increment := (sum: settlement__money_Amount, p: Portion) => settlement__money_addAmounts(sum,[1]);
    var shares := (sum: settlement__money_Amount, p: Portion) => settlement__money_addAmounts(sum,settlement__money_addAmounts(p.floor,if receives(p) then [1] else settlement__money_zero));
    settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(shares,shareBase,portions),
      settlement__money_addAmounts(Std.Collections.Seq.FoldLeft(floors,floorBase,portions),Std.Collections.Seq.FoldLeft(increment,extraBase,ProofLib.Filter(receives,portions))))
  decreases |portions|
{
  if |portions| > 0 {
    var p := portions[0];
    var bonus := if receives(p) then [1] else settlement__money_zero;
    var plusFloor := settlement__money_addAmounts(floorBase,p.floor);
    var plusExtra := if receives(p) then settlement__money_addAmounts(extraBase,[1]) else extraBase;
    var plusShare := settlement__money_addAmounts(shareBase,settlement__money_addAmounts(p.floor,bonus));
    assert p in portions;
    settlement__money_lawAdditionValid_ensures(floorBase,p.floor);
    settlement__money_lawAdditionValid_ensures(extraBase,[1]);
    settlement__money_lawAdditionValid_ensures(p.floor,bonus);
    settlement__money_lawAdditionValid_ensures(shareBase,settlement__money_addAmounts(p.floor,bonus));
    BonusAccumulation(p.floor,floorBase,extraBase,shareBase,receives(p));
    ProofLib.FilterCons(receives,portions);
    var tail := portions[1..];
    var kept := ProofLib.Filter(receives,portions);
    var tailKept := ProofLib.Filter(receives,tail);
    SumRemainderShares(tail,receives,plusFloor,plusExtra,plusShare);
    var floors := (sum: settlement__money_Amount, p: Portion) => settlement__money_addAmounts(sum,p.floor);
    var increment := (sum: settlement__money_Amount, p: Portion) => settlement__money_addAmounts(sum,[1]);
    var shares := (sum: settlement__money_Amount, p: Portion) => settlement__money_addAmounts(sum,settlement__money_addAmounts(p.floor,if receives(p) then [1] else settlement__money_zero));
    assert Std.Collections.Seq.FoldLeft(floors,floorBase,portions) == Std.Collections.Seq.FoldLeft(floors,plusFloor,tail);
    assert Std.Collections.Seq.FoldLeft(shares,shareBase,portions) == Std.Collections.Seq.FoldLeft(shares,plusShare,tail);
    if receives(p) {
      assert |kept| > 0 && kept[0] == p && kept[1..] == tailKept;
      assert Std.Collections.Seq.FoldLeft(increment,extraBase,kept) == Std.Collections.Seq.FoldLeft(increment,plusExtra,tailKept);
    } else {
      assert kept == tailKept && plusExtra == extraBase;
    }
  } else {
    ProofLib.FilterNil(receives,portions);
  }
}

lemma BonusAccumulation(floor: seq<int>, floorBase: seq<int>, extraBase: seq<int>, shareBase: seq<int>, receives: bool)
  requires settlement__money_validAmount(floor) && settlement__money_validAmount(floorBase) && settlement__money_validAmount(extraBase) && settlement__money_validAmount(shareBase)
  requires settlement__money_equalAmounts(shareBase, settlement__money_addAmounts(floorBase,extraBase))
  ensures settlement__money_equalAmounts(
    settlement__money_addAmounts(shareBase,settlement__money_addAmounts(floor,if receives then [1] else settlement__money_zero)),
    settlement__money_addAmounts(settlement__money_addAmounts(floorBase,floor),if receives then settlement__money_addAmounts(extraBase,[1]) else extraBase))
{
  var bonus := if receives then [1] else settlement__money_zero;
  var expanded := settlement__money_addAmounts(floorBase,extraBase);
  var newShare := settlement__money_addAmounts(floor,bonus);
  var sum := settlement__money_addAmounts(shareBase,newShare);
  var x := settlement__money_addAmounts(expanded,newShare);
  var y := settlement__money_addAmounts(settlement__money_addAmounts(expanded,floor),bonus);
  var z := settlement__money_addAmounts(settlement__money_addAmounts(settlement__money_addAmounts(floorBase,floor),extraBase),bonus);
  var base := settlement__money_addAmounts(floorBase,floor);
  var target := settlement__money_addAmounts(base,settlement__money_addAmounts(extraBase,bonus));
  settlement__money_lawAdditionValid_ensures(floorBase,extraBase);
  settlement__money_lawAdditionValid_ensures(floor,bonus);
  settlement__money_lawAddCongruence_ensures(shareBase,expanded,newShare);
  settlement__money_lawAddAssociative_ensures(expanded,floor,bonus);
  settlement__money_lawEqualSymmetric_ensures(x,y);
  EqualAllocationAmount(sum,x,y);
  AllocationAppendUnit(floorBase,extraBase,floor);
  settlement__money_lawAdditionValid_ensures(expanded,floor);
  settlement__money_lawAdditionValid_ensures(floorBase,floor);
  settlement__money_lawAdditionValid_ensures(base,extraBase);
  settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(expanded,floor),settlement__money_addAmounts(base,extraBase),bonus);
  EqualAllocationAmount(sum,y,z);
  settlement__money_lawAddAssociative_ensures(base,extraBase,bonus);
  EqualAllocationAmount(sum,z,target);
  if !receives {
    settlement__money_lawZeroIdentity_ensures(extraBase);
    settlement__money_lawAdditionValid_ensures(extraBase,bonus);
    settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(extraBase,bonus),extraBase,base);
    EqualAllocationAmount(sum,target,settlement__money_addAmounts(base,extraBase));
  }
}

lemma UnitCountCoversBound(portions: seq<Portion>, total: seq<int>, accumulator: seq<int>)
  requires settlement__money_validAmount(total) && settlement__money_validAmount(accumulator)
  requires settlement__money_compareAmounts(accumulator,total) <= 0
  requires var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank,[1]);
    settlement__money_compareAmounts(Std.Collections.Seq.FoldLeft(inc,accumulator,portions),total) >= 0
  ensures var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank,[1]);
    exists count {:trigger Std.Collections.Seq.FoldLeft(inc,accumulator,portions[..count])} ::
      (0 <= count <= |portions| && settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(inc,accumulator,portions[..count]),total))
  decreases |portions|
{
  var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank,[1]);
  if settlement__money_equalAmounts(accumulator,total) {
    assert portions[..0] == [];
    assert settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(inc,accumulator,portions[..0]),total);
  } else {
    assert |portions| > 0;
    var next := settlement__money_addAmounts(accumulator,[1]);
    settlement__money_lawAdditionValid_ensures(accumulator,[1]);
    settlement__money_lawUnitGap_ensures(accumulator,total);
    assert settlement__money_compareAmounts(next,total) <= 0;
    UnitCountCoversBound(portions[1..],total,next);
    var n :| 0 <= n <= |portions[1..]| && settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(inc,next,portions[1..][..n]),total);
    assert portions[..n + 1] == [portions[0]] + portions[1..][..n];
    assert (portions[..n + 1])[0] == portions[0] && (portions[..n+1])[1..] == portions[1..][..n];
    assert settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(inc,accumulator,portions[..n+1]),total);
  }
}

// Sum each division identity. The remainders bound the unallocated base units.
lemma PortionDivisionAccounting(total: seq<int>, weight: Weight, denominator: seq<int>)
  requires settlement__money_validAmount(total) && settlement__money_validAmount(weight.weight)
  requires settlement__money_validAmount(denominator) && settlement__money_positiveAmount(denominator)
  ensures var part := weightedPortion(total,weight,denominator);
    settlement__money_validAmount(part.floor) && settlement__money_validAmount(part.remainder) &&
    settlement__money_compareAmounts(part.remainder,denominator) < 0 &&
    settlement__money_equalAmounts(settlement__money_addAmounts(settlement__money_multiplyAmounts(part.floor,denominator),part.remainder),
      settlement__money_multiplyAmounts(total,weight.weight))
{
  var product := settlement__money_multiplyAmounts(total,weight.weight);
  settlement__money_lawMultiplyValid_ensures(total,weight.weight);
  settlement__money_lawDivisionValid_ensures(product,denominator);
  settlement__money_lawDivisionRemainder_ensures(product,denominator);
  settlement__money_lawDivisionReconstructs_ensures(product,denominator);
}

lemma SumTotalsProduct(total: seq<int>, denominator: seq<int>, weights: seq<Weight>, remaining: seq<Portion>,
  weightBase: seq<int>, floorBase: seq<int>, remainderBase: seq<int>)
  requires settlement__money_validAmount(total)
  requires settlement__money_validAmount(denominator) && settlement__money_positiveAmount(denominator)
  requires settlement__money_validAmount(weightBase) && settlement__money_validAmount(floorBase) && settlement__money_validAmount(remainderBase)
  requires forall w :: w in weights ==> settlement__money_validAmount(w.weight)
  requires |weights| == |remaining|
  requires forall i :: 0 <= i < |weights| ==> remaining[i] == weightedPortion(total,weights[i],denominator)
  requires settlement__money_equalAmounts(settlement__money_multiplyAmounts(total,weightBase),
    settlement__money_addAmounts(settlement__money_multiplyAmounts(floorBase,denominator),remainderBase))
  ensures var weightsStep := (sum: settlement__money_Amount, w: Weight) => settlement__money_addAmounts(sum,w.weight);
    var floorStep := (sum: settlement__money_Amount, p: Portion) => settlement__money_addAmounts(sum,p.floor);
    var remainderStep := (sum: settlement__money_Amount, p: Portion) => settlement__money_addAmounts(sum,p.remainder);
    var ws := Std.Collections.Seq.FoldLeft(weightsStep,weightBase,weights);
    var fs := Std.Collections.Seq.FoldLeft(floorStep,floorBase,remaining);
    var rs := Std.Collections.Seq.FoldLeft(remainderStep,remainderBase,remaining);
    settlement__money_validAmount(ws) && settlement__money_validAmount(fs) && settlement__money_validAmount(rs) &&
      settlement__money_equalAmounts(settlement__money_multiplyAmounts(total,ws),settlement__money_addAmounts(settlement__money_multiplyAmounts(fs,denominator),rs))
  decreases |weights|
{
  if |weights| > 0 {
    var w := weights[0];
    var portion := remaining[0];
    assert w in weights;
    PortionDivisionAccounting(total,w,denominator);
    SumProductOne(total,denominator,w.weight,portion,weightBase,floorBase,remainderBase);
    settlement__money_lawAdditionValid_ensures(weightBase,w.weight);
    settlement__money_lawAdditionValid_ensures(floorBase,portion.floor);
    settlement__money_lawAdditionValid_ensures(remainderBase,portion.remainder);
    assert forall i :: 0 <= i < |weights[1..]| ==> weights[1..][i] == weights[i+1] && remaining[1..][i] == remaining[i+1];
    SumTotalsProduct(total,denominator,weights[1..],remaining[1..],settlement__money_addAmounts(weightBase,w.weight),
      settlement__money_addAmounts(floorBase,portion.floor),settlement__money_addAmounts(remainderBase,portion.remainder));
  }
}

lemma SumProductOne(total: seq<int>, denominator: seq<int>, weight: seq<int>, portion: Portion,
  weightBase: seq<int>, floorBase: seq<int>, remainderBase: seq<int>)
  requires settlement__money_validAmount(total) && settlement__money_validAmount(denominator) && settlement__money_validAmount(weight)
  requires settlement__money_validAmount(weightBase) && settlement__money_validAmount(floorBase) && settlement__money_validAmount(remainderBase)
  requires settlement__money_validAmount(portion.floor) && settlement__money_validAmount(portion.remainder)
  requires settlement__money_equalAmounts(settlement__money_multiplyAmounts(total,weightBase),
    settlement__money_addAmounts(settlement__money_multiplyAmounts(floorBase,denominator),remainderBase))
  requires settlement__money_equalAmounts(settlement__money_addAmounts(settlement__money_multiplyAmounts(portion.floor,denominator),portion.remainder),
    settlement__money_multiplyAmounts(total,weight))
  ensures settlement__money_equalAmounts(settlement__money_multiplyAmounts(total,settlement__money_addAmounts(weightBase,weight)),
    settlement__money_addAmounts(settlement__money_multiplyAmounts(settlement__money_addAmounts(floorBase,portion.floor),denominator),
      settlement__money_addAmounts(remainderBase,portion.remainder)))
{
  var a := settlement__money_multiplyAmounts(floorBase,denominator);
  var b := settlement__money_multiplyAmounts(portion.floor,denominator);
  var covered := settlement__money_addAmounts(a,remainderBase);
  var piece := settlement__money_addAmounts(b,portion.remainder);
  var prior := settlement__money_multiplyAmounts(total,weightBase);
  var newWeight := settlement__money_multiplyAmounts(total,weight);
  var wide := settlement__money_multiplyAmounts(total,settlement__money_addAmounts(weightBase,weight));
  settlement__money_lawMultiplyValid_ensures(floorBase,denominator);
  settlement__money_lawMultiplyValid_ensures(portion.floor,denominator);
  settlement__money_lawMultiplyValid_ensures(total,weightBase);
  settlement__money_lawMultiplyValid_ensures(total,weight);
  settlement__money_lawAdditionValid_ensures(a,remainderBase);
  settlement__money_lawAdditionValid_ensures(b,portion.remainder);
  settlement__money_lawEqualSymmetric_ensures(newWeight,piece);
  settlement__money_lawMultiplyAddition_ensures(total,weightBase,weight);
  settlement__money_lawAddCongruence_ensures(prior,covered,newWeight);
  settlement__money_lawAddCongruence_ensures(newWeight,piece,covered);
  EqualAllocationAmount(wide,settlement__money_addAmounts(prior,newWeight),settlement__money_addAmounts(covered,newWeight));
  EqualAllocationAmount(wide,settlement__money_addAmounts(covered,newWeight),settlement__money_addAmounts(covered,piece));
  JoinAllocationPairs(a,remainderBase,b,portion.remainder);
  var composite := settlement__money_addAmounts(settlement__money_addAmounts(a,b),settlement__money_addAmounts(remainderBase,portion.remainder));
  EqualAllocationAmount(wide,settlement__money_addAmounts(covered,piece),composite);
  var newFloor := settlement__money_addAmounts(floorBase,portion.floor);
  var newFloorProduct := settlement__money_multiplyAmounts(newFloor,denominator);
  var combinedFloorProduct := settlement__money_addAmounts(a,b);
  var newRemainders := settlement__money_addAmounts(remainderBase,portion.remainder);
  MultiplyLeftSum(floorBase,portion.floor,denominator);
  settlement__money_lawAdditionValid_ensures(floorBase,portion.floor);
  settlement__money_lawMultiplyValid_ensures(newFloor,denominator);
  settlement__money_lawAdditionValid_ensures(a,b);
  settlement__money_lawAdditionValid_ensures(remainderBase,portion.remainder);
  settlement__money_lawAddCongruence_ensures(newFloorProduct,combinedFloorProduct,newRemainders);
  var expected := settlement__money_addAmounts(newFloorProduct,newRemainders);
  settlement__money_lawEqualSymmetric_ensures(composite,expected);
  EqualAllocationAmount(wide,composite,expected);
}

lemma MultiplyLeftSum(a: seq<int>, b: seq<int>, c: seq<int>)
  requires settlement__money_validAmount(a) && settlement__money_validAmount(b) && settlement__money_validAmount(c)
  ensures settlement__money_equalAmounts(settlement__money_multiplyAmounts(settlement__money_addAmounts(a,b),c),
    settlement__money_addAmounts(settlement__money_multiplyAmounts(a,c),settlement__money_multiplyAmounts(b,c)))
{
  var combined := settlement__money_addAmounts(a,b);
  var ca := settlement__money_multiplyAmounts(c,a);
  var cb := settlement__money_multiplyAmounts(c,b);
  var ac := settlement__money_multiplyAmounts(a,c);
  var bc := settlement__money_multiplyAmounts(b,c);
  var initial := settlement__money_multiplyAmounts(combined,c);
  settlement__money_lawAdditionValid_ensures(a,b);
  settlement__money_lawMultiplyValid_ensures(c,a);
  settlement__money_lawMultiplyValid_ensures(c,b);
  settlement__money_lawMultiplyValid_ensures(a,c);
  settlement__money_lawMultiplyValid_ensures(b,c);
  settlement__money_lawMultiplyCommutative_ensures(combined,c);
  settlement__money_lawMultiplyCommutative_ensures(c,a);
  settlement__money_lawMultiplyCommutative_ensures(c,b);
  settlement__money_lawMultiplyAddition_ensures(c,a,b);
  settlement__money_lawAddCongruence_ensures(ca,ac,cb);
  settlement__money_lawAddCongruence_ensures(cb,bc,ac);
  EqualAllocationAmount(initial,settlement__money_multiplyAmounts(c,combined),settlement__money_addAmounts(ca,cb));
  EqualAllocationAmount(initial,settlement__money_addAmounts(ca,cb),settlement__money_addAmounts(ac,cb));
  EqualAllocationAmount(initial,settlement__money_addAmounts(ac,cb),settlement__money_addAmounts(ac,bc));
}

lemma JoinAllocationPairs(a: seq<int>, b: seq<int>, c: seq<int>, d: seq<int>)
  requires settlement__money_validAmount(a) && settlement__money_validAmount(b) && settlement__money_validAmount(c) && settlement__money_validAmount(d)
  ensures settlement__money_equalAmounts(settlement__money_addAmounts(settlement__money_addAmounts(a,b),settlement__money_addAmounts(c,d)),
    settlement__money_addAmounts(settlement__money_addAmounts(a,c),settlement__money_addAmounts(b,d)))
{
  var ab := settlement__money_addAmounts(a,b);
  var ac := settlement__money_addAmounts(a,c);
  var abc := settlement__money_addAmounts(ab,c);
  var acb := settlement__money_addAmounts(ac,b);
  var left := settlement__money_addAmounts(ab,settlement__money_addAmounts(c,d));
  var middle := settlement__money_addAmounts(abc,d);
  var swapped := settlement__money_addAmounts(acb,d);
  var right := settlement__money_addAmounts(ac,settlement__money_addAmounts(b,d));
  settlement__money_lawAdditionValid_ensures(a,b);
  settlement__money_lawAdditionValid_ensures(a,c);
  settlement__money_lawAdditionValid_ensures(ab,c);
  settlement__money_lawAdditionValid_ensures(ac,b);
  settlement__money_lawAddAssociative_ensures(ab,c,d);
  settlement__money_lawEqualSymmetric_ensures(left,middle);
  AllocationAppendUnit(a,b,c);
  settlement__money_lawAddCongruence_ensures(abc,acb,d);
  settlement__money_lawAddAssociative_ensures(ac,b,d);
  EqualAllocationAmount(left,middle,swapped);
  EqualAllocationAmount(left,swapped,right);
}

lemma RemainderSumBound(portions: seq<Portion>, denominator: seq<int>, leftoverBase: seq<int>, units: seq<int>)
  requires settlement__money_validAmount(denominator) && settlement__money_positiveAmount(denominator)
  requires settlement__money_validAmount(leftoverBase) && settlement__money_validAmount(units)
  requires forall p :: p in portions ==> settlement__money_validAmount(p.remainder) && settlement__money_compareAmounts(p.remainder,denominator) < 0
  requires settlement__money_compareAmounts(leftoverBase,settlement__money_multiplyAmounts(units,denominator)) <= 0
  ensures var plusRemainder := (sum: settlement__money_Amount, p: Portion) => settlement__money_addAmounts(sum,p.remainder);
    var inc := (sum: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(sum,[1]);
    var fullRemainders := Std.Collections.Seq.FoldLeft(plusRemainder,leftoverBase,portions);
    var limit := settlement__money_multiplyAmounts(Std.Collections.Seq.FoldLeft(inc,units,portions),denominator);
    settlement__money_compareAmounts(fullRemainders,limit) <= 0
  decreases |portions|
{
  if |portions| > 0 {
    var p := portions[0];
    assert p in portions;
    var next := settlement__money_addAmounts(leftoverBase,p.remainder);
    var nextUnits := settlement__money_addAmounts(units,[1]);
    var beforeBound := settlement__money_multiplyAmounts(units,denominator);
    var afterBound := settlement__money_multiplyAmounts(nextUnits,denominator);
    var sumBound := settlement__money_addAmounts(beforeBound,denominator);
    settlement__money_lawMultiplyValid_ensures(units,denominator);
    settlement__money_lawAdditionValid_ensures(units,[1]);
    settlement__money_lawMultiplyValid_ensures(nextUnits,denominator);
    settlement__money_lawAdditionValid_ensures(beforeBound,denominator);
    settlement__money_lawAdditionValid_ensures(leftoverBase,p.remainder);
    settlement__money_lawAdditionValid_ensures(units,[1]);
    MultiplyLeftSum(units,[1],denominator);
    settlement__money_lawMultiplyOne_ensures(denominator);
    settlement__money_lawMultiplyCommutative_ensures([1],denominator);
    var oneProduct := settlement__money_multiplyAmounts([1],denominator);
    EqualAllocationAmount(oneProduct,settlement__money_multiplyAmounts(denominator,[1]),denominator);
    settlement__money_lawMultiplyValid_ensures([1],denominator);
    settlement__money_lawAddCongruence_ensures(oneProduct,denominator,beforeBound);
    EqualAllocationAmount(afterBound,settlement__money_addAmounts(beforeBound,oneProduct),sumBound);
    AddBothComparisons(leftoverBase,beforeBound,p.remainder,denominator);
    settlement__money_lawEqualOrder_ensures(afterBound,sumBound,next);
    RemainderSumBound(portions[1..],denominator,next,nextUnits);
  }
}

lemma AddBothComparisons(a: seq<int>, b: seq<int>, c: seq<int>, d: seq<int>)
  requires settlement__money_validAmount(a) && settlement__money_validAmount(b) && settlement__money_validAmount(c) && settlement__money_validAmount(d)
  requires settlement__money_compareAmounts(a,b) <= 0 && settlement__money_compareAmounts(c,d) <= 0
  ensures settlement__money_compareAmounts(settlement__money_addAmounts(a,c),settlement__money_addAmounts(b,d)) <= 0
{
  settlement__money_lawAdditionValid_ensures(a,c);
  settlement__money_lawAdditionValid_ensures(b,c);
  settlement__money_lawAdditionValid_ensures(b,d);
  settlement__money_lawAddOrder_ensures(a,b,c);
  settlement__money_lawAddOrder_ensures(c,d,b);
  settlement__money_lawAddCommutative_ensures(b,c);
  settlement__money_lawAddCommutative_ensures(b,d);
  settlement__money_lawNumericOrderTransitive_ensures(settlement__money_addAmounts(a,c),settlement__money_addAmounts(b,c),settlement__money_addAmounts(b,d));
}

lemma LeftoverFromDivision(total: seq<int>, floor: seq<int>, denominator: seq<int>, remainders: seq<int>)
  requires settlement__money_validAmount(total) && settlement__money_validAmount(floor)
  requires settlement__money_validAmount(remainders) && settlement__money_validAmount(denominator) && settlement__money_positiveAmount(denominator)
  requires settlement__money_equalAmounts(settlement__money_multiplyAmounts(total,denominator),
    settlement__money_addAmounts(settlement__money_multiplyAmounts(floor,denominator),remainders))
  ensures settlement__money_compareAmounts(total,floor) >= 0
  ensures settlement__money_equalAmounts(settlement__money_multiplyAmounts(settlement__money_subtractAmounts(total,floor),denominator),remainders)
{
  var all := settlement__money_multiplyAmounts(total,denominator);
  var used := settlement__money_multiplyAmounts(floor,denominator);
  var recombined := settlement__money_addAmounts(used,remainders);
  settlement__money_lawMultiplyValid_ensures(total,denominator);
  settlement__money_lawMultiplyValid_ensures(floor,denominator);
  settlement__money_lawAddMonotone_ensures(used,remainders);
  settlement__money_lawEqualOrder_ensures(all,recombined,used);
  settlement__money_lawMultiplyCancellation_ensures(total,floor,denominator);
  var rest := settlement__money_subtractAmounts(total,floor);
  var combined := settlement__money_addAmounts(rest,floor);
  var restProduct := settlement__money_multiplyAmounts(rest,denominator);
  var combinedProduct := settlement__money_multiplyAmounts(combined,denominator);
  var reconstructed := settlement__money_addAmounts(restProduct,used);
  var expected := settlement__money_addAmounts(remainders,used);
  settlement__money_lawSubtractionValid_ensures(total,floor);
  settlement__money_lawAdditionValid_ensures(rest,floor);
  settlement__money_lawSubtractionReconstructs_ensures(total,floor);
  settlement__money_lawMultiplyValid_ensures(rest,denominator);
  settlement__money_lawMultiplyCongruence_ensures(combined,total,denominator);
  MultiplyLeftSum(rest,floor,denominator);
  settlement__money_lawAddCommutative_ensures(used,remainders);
  settlement__money_lawEqualSymmetric_ensures(reconstructed,combinedProduct);
  EqualAllocationAmount(reconstructed,combinedProduct,all);
  EqualAllocationAmount(reconstructed,all,expected);
  settlement__money_lawAddOrder_ensures(restProduct,remainders,used);
}

lemma LeftoverAtMostCount(total: seq<int>, floor: seq<int>, denominator: seq<int>, portions: seq<Portion>, remainders: seq<int>)
  requires settlement__money_validAmount(total) && settlement__money_validAmount(floor)
  requires settlement__money_validAmount(remainders) && settlement__money_validAmount(denominator) && settlement__money_positiveAmount(denominator)
  requires forall p :: p in portions ==> settlement__money_validAmount(p.remainder) && settlement__money_compareAmounts(p.remainder,denominator) < 0
  requires remainders == Std.Collections.Seq.FoldLeft((sum: settlement__money_Amount,p: Portion) => settlement__money_addAmounts(sum,p.remainder),settlement__money_zero,portions)
  requires settlement__money_equalAmounts(settlement__money_multiplyAmounts(total,denominator),
    settlement__money_addAmounts(settlement__money_multiplyAmounts(floor,denominator),remainders))
  ensures settlement__money_compareAmounts(total,floor) >= 0
  ensures var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank,[1]);
    settlement__money_compareAmounts(settlement__money_subtractAmounts(total,floor),Std.Collections.Seq.FoldLeft(inc,settlement__money_zero,portions)) <= 0
{
  LeftoverFromDivision(total,floor,denominator,remainders);
  var rest := settlement__money_subtractAmounts(total,floor);
  var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank,[1]);
  var bound := Std.Collections.Seq.FoldLeft(inc,settlement__money_zero,portions);
  var boundProduct := settlement__money_multiplyAmounts(bound,denominator);
  settlement__money_lawMultiplyValid_ensures(settlement__money_zero,denominator);
  settlement__money_lawZeroOrder_ensures(settlement__money_multiplyAmounts(settlement__money_zero,denominator));
  RemainderSumBound(portions,denominator,settlement__money_zero,settlement__money_zero);
  settlement__money_lawEqualOrder_ensures(settlement__money_multiplyAmounts(rest,denominator),remainders,boundProduct);
  UnitCountValidity(portions,settlement__money_zero);
  settlement__money_lawSubtractionValid_ensures(total,floor);
  settlement__money_lawMultiplyCancellation_ensures(rest,bound,denominator);
}

lemma lawAllocationConserves_ensures(total: seq<int>, weights: seq<Weight>)
  ensures (lawAllocationConserves(total, weights) == true)
{
  if canAllocate(total,weights) {
    if |weights| == 0 {
      assert allocateAmounts(total,weights) == [];
      assert allocatedTotal([]) == settlement__money_zero;
      settlement__money_lawEqualSymmetric_ensures(total,settlement__money_zero);
    } else if |weights| == 1 {
      var w := weights[0];
      var entry := Share(w.actor,total);
      var combine := (sum: settlement__money_Amount, s: Share) => settlement__money_addAmounts(sum,s.amount);
      assert allocateAmounts(total,weights) == [entry];
      ProofLib.FoldLeftAppend(combine,settlement__money_zero,[],entry);
      assert Std.Collections.Seq.FoldLeft(combine,settlement__money_zero,[]) == settlement__money_zero;
      assert allocatedTotal([entry]) == Std.Collections.Seq.FoldLeft(combine,settlement__money_zero,[entry]);
      assert Std.Collections.Seq.FoldLeft(combine,settlement__money_zero,[entry]) == combine(settlement__money_zero,entry);
      assert (if |[entry]| > 0 then [entry][0] else entry) == entry;
      assert allocatedTotal([entry]) == settlement__money_addAmounts(settlement__money_zero,total);
      settlement__money_lawAddCommutative_ensures(settlement__money_zero,total);
      settlement__money_lawZeroIdentity_ensures(total);
    } else {
      FullWeightedAllocation(weights,total);
    }
  }
}

lemma FullWeightedAllocation(weights: seq<Weight>, total: seq<int>)
  requires canAllocate(total,weights) && |weights| > 1
  ensures settlement__money_equalAmounts(allocatedTotal(allocateAmounts(total,weights)),total)
{
  var denom := totalWeight(weights);
  var portions := seq(|weights|, i_map requires 0 <= i_map < |weights| => var recipient := weights[i_map]; weightedPortion(total,recipient,denom));
  var floor := portionTotal(portions);
  var remaining := settlement__money_subtractAmounts(total,floor);
  ValidWeightedPortions(weights,total,denom,portions);
  WeightedPortionActors(weights,total,denom,portions);
  WeightedAllocationFloorBound(weights,total,denom,portions);
  AllocatedPortionsConserve(total,portions);
  AllocationSharesMatchPortions(weights,total,portions,remaining);
}

lemma ValidWeightedPortions(weights: seq<Weight>, total: seq<int>, denom: seq<int>, portions: seq<Portion>)
  requires canAllocate(total,weights) && |weights| > 1
  requires denom == totalWeight(weights) && |portions| == |weights|
  requires forall i :: 0 <= i < |weights| ==> portions[i] == weightedPortion(total,weights[i],denom)
  ensures settlement__money_validAmount(denom) && settlement__money_positiveAmount(denom)
  ensures forall p :: p in portions ==> settlement__money_validAmount(p.floor) && settlement__money_validAmount(p.remainder) && settlement__money_compareAmounts(p.remainder,denom) < 0
{
  ValidWeightSum(weights,settlement__money_zero);
  forall p | p in portions ensures settlement__money_validAmount(p.floor) && settlement__money_validAmount(p.remainder) && settlement__money_compareAmounts(p.remainder,denom) < 0 {
    var i :| 0 <= i < |portions| && p == portions[i];
    assert weights[i] in weights;
    PortionDivisionAccounting(total,weights[i],denom);
  }
}

lemma InitializeProductConservation(total: seq<int>, denom: seq<int>)
  requires settlement__money_validAmount(total) && settlement__money_validAmount(denom)
  ensures var none := settlement__money_zero;
    settlement__money_equalAmounts(settlement__money_multiplyAmounts(total,none),settlement__money_addAmounts(settlement__money_multiplyAmounts(none,denom),none))
{
  var none := settlement__money_zero;
  var product := settlement__money_multiplyAmounts(none,denom);
  var nullsum := settlement__money_addAmounts(product,none);
  settlement__money_lawMultiplyZero_ensures(total);
  settlement__money_lawMultiplyZero_ensures(denom);
  settlement__money_lawMultiplyValid_ensures(none,denom);
  settlement__money_lawZeroIdentity_ensures(product);
  settlement__money_lawEqualSymmetric_ensures(none,product);
  settlement__money_lawEqualSymmetric_ensures(product,nullsum);
  EqualAllocationAmount(none,product,nullsum);
  EqualAllocationAmount(settlement__money_multiplyAmounts(total,none),none,nullsum);
}

lemma WeightedAllocationFloorBound(weights: seq<Weight>, total: seq<int>, denom: seq<int>, portions: seq<Portion>)
  requires canAllocate(total,weights) && |weights| > 1
  requires denom == totalWeight(weights) && |portions| == |weights|
  requires forall i :: 0 <= i < |weights| ==> portions[i] == weightedPortion(total,weights[i],denom)
  requires settlement__money_validAmount(denom) && settlement__money_positiveAmount(denom)
  requires forall p :: p in portions ==> settlement__money_validAmount(p.floor) && settlement__money_validAmount(p.remainder) && settlement__money_compareAmounts(p.remainder,denom) < 0
  ensures settlement__money_validAmount(portionTotal(portions))
  ensures settlement__money_compareAmounts(total,portionTotal(portions)) >= 0
  ensures var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]);
    settlement__money_compareAmounts(settlement__money_subtractAmounts(total,portionTotal(portions)),Std.Collections.Seq.FoldLeft(inc,settlement__money_zero,portions)) <= 0
{
  var none := settlement__money_zero;
  var sumRemainder := (sum: settlement__money_Amount,p: Portion) => settlement__money_addAmounts(sum,p.remainder);
  var floor := portionTotal(portions);
  var remainders := Std.Collections.Seq.FoldLeft(sumRemainder,none,portions);
  InitializeProductConservation(total,denom);
  SumTotalsProduct(total,denom,weights,portions,none,none,none);
  LeftoverAtMostCount(total,floor,denom,portions,remainders);
}

lemma SelectedRemainderSum(portions: seq<Portion>, remaining: seq<int>)
  requires ProofLib.DistinctBy(portions, (r: Portion) => r.actor)
  requires forall p :: p in portions ==> settlement__money_validAmount(p.remainder)
  requires settlement__money_validAmount(remaining)
  requires var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]);
    settlement__money_compareAmounts(remaining,Std.Collections.Seq.FoldLeft(inc,settlement__money_zero,portions)) <= 0
  ensures var selected := ProofLib.Filter((p: Portion) => settlement__money_compareAmounts(remainderRank(p,portions),remaining) < 0,portions);
    var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]);
    settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(inc,settlement__money_zero,selected),remaining)
{
  var none := settlement__money_zero;
  var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]);
  settlement__money_lawZeroOrder_ensures(remaining);
  UnitCountValidity(portions,none);
  settlement__money_lawNumericOrderTotal_ensures(remaining,Std.Collections.Seq.FoldLeft(inc,none,portions));
  UnitCountCoversBound(portions,remaining,none);
  var count :| 0 <= count <= |portions| && settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(inc,none,portions[..count]),remaining);
  var sites := portions[..count];
  CountRemainderRecipients(portions,sites,remaining);
  var receives := (p: Portion) => settlement__money_compareAmounts(remainderRank(p,portions),remaining) < 0;
  var selected := ProofLib.Filter(receives,portions);
  assert |selected| == |sites|;
  UnitCountsOrder(selected,sites,none,none);
  var sumBonus := Std.Collections.Seq.FoldLeft(inc,none,selected);
  var equivalent := Std.Collections.Seq.FoldLeft(inc,none,sites);
  settlement__money_lawEqualReflexive_ensures(none);
  EqualAllocationAmount(sumBonus,equivalent,remaining);
}

lemma AllocatedPortionsConserve(total: seq<int>, portions: seq<Portion>)
  requires settlement__money_validAmount(total) && settlement__money_validAmount(portionTotal(portions))
  requires settlement__money_compareAmounts(total,portionTotal(portions)) >= 0
  requires ProofLib.DistinctBy(portions, (r: Portion) => r.actor)
  requires forall p :: p in portions ==> settlement__money_validAmount(p.floor) && settlement__money_validAmount(p.remainder)
  requires var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]);
    settlement__money_compareAmounts(settlement__money_subtractAmounts(total,portionTotal(portions)),Std.Collections.Seq.FoldLeft(inc,settlement__money_zero,portions)) <= 0
  ensures var remaining := settlement__money_subtractAmounts(total,portionTotal(portions));
    var sumShares := (sum: settlement__money_Amount,p: Portion) => settlement__money_addAmounts(sum,settlement__money_addAmounts(p.floor,
      if settlement__money_compareAmounts(remainderRank(p,portions),remaining) < 0 then [1] else settlement__money_zero));
    settlement__money_equalAmounts(Std.Collections.Seq.FoldLeft(sumShares,settlement__money_zero,portions),total)
{
  var none := settlement__money_zero;
  var floor := portionTotal(portions);
  var remaining := settlement__money_subtractAmounts(total,floor);
  settlement__money_lawSubtractionValid_ensures(total,floor);
  SelectedRemainderSum(portions,remaining);
  var inc := (rank: settlement__money_Amount, ignored: Portion) => settlement__money_addAmounts(rank, [1]);
  var receives := (p: Portion) => settlement__money_compareAmounts(remainderRank(p,portions),remaining) < 0;
  var selected := ProofLib.Filter(receives,portions);
  var sumBonus := Std.Collections.Seq.FoldLeft(inc,none,selected);
  var sumShares := (sum: settlement__money_Amount,p: Portion) => settlement__money_addAmounts(sum,settlement__money_addAmounts(p.floor,
    if settlement__money_compareAmounts(remainderRank(p,portions),remaining) < 0 then [1] else settlement__money_zero));
  var byReceipt := (sum: settlement__money_Amount,p: Portion) => settlement__money_addAmounts(sum,settlement__money_addAmounts(p.floor,
    if receives(p) then [1] else settlement__money_zero));
  ProofLib.FoldLeftPointwise(sumShares,byReceipt,none,portions,portions);
  var actual := Std.Collections.Seq.FoldLeft(sumShares,none,portions);
  settlement__money_lawZeroIdentity_ensures(none);
  settlement__money_lawEqualSymmetric_ensures(none,settlement__money_addAmounts(none,none));
  SumRemainderShares(portions,receives,none,none,none);
  UnitCountValidity(selected,none);
  settlement__money_lawAddCongruence_ensures(sumBonus,remaining,floor);
  settlement__money_lawSubtractionReconstructs_ensures(total,floor);
  settlement__money_lawAddCommutative_ensures(floor,remaining);
  EqualAllocationAmount(actual,settlement__money_addAmounts(floor,sumBonus),settlement__money_addAmounts(floor,remaining));
  EqualAllocationAmount(actual,settlement__money_addAmounts(floor,remaining),total);
}

lemma AllocationSharesMatchPortions(weights: seq<Weight>, total: seq<int>, portions: seq<Portion>, remaining: seq<int>)
  requires canAllocate(total,weights) && |weights| > 1
  requires portions == seq(|weights|, i_map requires 0 <= i_map < |weights| => var recipient := weights[i_map]; weightedPortion(total,recipient,totalWeight(weights)))
  requires remaining == settlement__money_subtractAmounts(total,portionTotal(portions))
  ensures var sumShares := (sum: settlement__money_Amount,p: Portion) => settlement__money_addAmounts(sum,settlement__money_addAmounts(p.floor,
    if settlement__money_compareAmounts(remainderRank(p,portions),remaining) < 0 then [1] else settlement__money_zero));
    allocatedTotal(allocateAmounts(total,weights)) == Std.Collections.Seq.FoldLeft(sumShares,settlement__money_zero,portions)
{
  AllocationMapSum(portions,portions,remaining,settlement__money_zero);
}

lemma WeightedPortionActors(weights: seq<Weight>, total: seq<int>, denominator: seq<int>, portions: seq<Portion>)
  requires validWeights(weights) && |weights| == |portions|
  requires forall i :: 0 <= i < |weights| ==> portions[i] == weightedPortion(total,weights[i],denominator)
  ensures ProofLib.DistinctBy(portions,(p: Portion) => p.actor)
{
  forall i,j | 0 <= i < |portions| && 0 <= j < |portions| && i != j
    ensures portions[i].actor != portions[j].actor
  {
    var w := weights[i];
    assert w in weights;
    WeightListActorCount(weights,w);
    ProofLib.FilterCountOneIffUnique((other: Weight) => other.actor == w.actor,weights,(other: Weight) => other.actor,i);
  }
}

lemma WeightListActorCount(weights: seq<Weight>, w: Weight)
  requires validWeights(weights) && w in weights
  ensures |ProofLib.Filter((other: Weight) => (other.actor == w.actor),weights)| == 1
{
}

lemma AllocationMapSum(portions: seq<Portion>, rankSource: seq<Portion>, remaining: seq<int>, start: seq<int>)
  ensures var shares := seq(|portions|, i_map requires 0 <= i_map < |portions| => var recipient := portions[i_map];
      Share(recipient.actor, settlement__money_addAmounts(recipient.floor,
        (if settlement__money_compareAmounts(remainderRank(recipient,rankSource),remaining) < 0 then [1] else settlement__money_zero))));
    var sum := (sum: settlement__money_Amount, share: Share) => settlement__money_addAmounts(sum,share.amount);
    var byPortion := (sum: settlement__money_Amount, p: Portion) => settlement__money_addAmounts(sum,
      settlement__money_addAmounts(p.floor,if settlement__money_compareAmounts(remainderRank(p,rankSource),remaining) < 0 then [1] else settlement__money_zero));
    Std.Collections.Seq.FoldLeft(sum,start,shares) == Std.Collections.Seq.FoldLeft(byPortion,start,portions)
{
  var shares := seq(|portions|, i_map requires 0 <= i_map < |portions| => var recipient := portions[i_map];
    Share(recipient.actor, settlement__money_addAmounts(recipient.floor,
      (if settlement__money_compareAmounts(remainderRank(recipient,rankSource),remaining) < 0 then [1] else settlement__money_zero))));
  var sum := (sum: settlement__money_Amount, share: Share) => settlement__money_addAmounts(sum,share.amount);
  var byPortion := (sum: settlement__money_Amount, p: Portion) => settlement__money_addAmounts(sum,
    settlement__money_addAmounts(p.floor,if settlement__money_compareAmounts(remainderRank(p,rankSource),remaining) < 0 then [1] else settlement__money_zero));
  ProofLib.FoldLeftPointwise(sum,byPortion,start,shares,portions);
}
