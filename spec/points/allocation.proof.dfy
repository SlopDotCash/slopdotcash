// The allocator's literal laws use integer division and explicit sequence witnesses.
lemma lawSingleRecipient_ensures(total: int, actor: int, lines: int)
  ensures (lawSingleRecipient(total, actor, lines) == true)
{
  if total >= 0 && actor > 0 && lines >= 0 {
    var r := Recipient(actor, lines);
    var xs := [r];
    FoldOne((acc: int, item: Recipient) => acc + item.lines, 0, r);
    assert lineTotal(xs) == lines;
    var d := if lines == 0 then 1 else lines;
    assert weightTotal(xs) == d && allocationWeight(r, xs) == d && d > 0;
    DivideExact(total, d);
    assert floorShare(total, r, xs) == total;
    RankMeaning(total, r, xs);
    FilterOneValue((other: Recipient) => pointRemainder(total, other, xs) > pointRemainder(total, r, xs) || (pointRemainder(total, other, xs) == pointRemainder(total, r, xs) && other.actor < r.actor), r);
    assert remainderRank(total, r, xs) == 0;
    FoldOne((acc: int, item: Recipient) => acc + floorShare(total, item, xs), 0, r);
    assert floorTotal(total, xs) == total;
    assert |allocatePoints(total, xs)| == 1;
    assert allocatePoints(total, xs)[0] == PointShare(actor, total);
    assert allocatePoints(total, xs) == [PointShare(actor, total)];
  }
}

lemma lawEqualTwo_ensures(total: int)
  ensures (lawEqualTwo(total) == true)
{
  if total >= 0 {
    var a := Recipient(1, 0);
    var b := Recipient(2, 0);
    var xs := [a, b];
    FoldTwo((acc: int, item: Recipient) => acc + item.lines, 0, a, b);
    assert lineTotal(xs) == 0 && weightTotal(xs) == 2;
    var q := quotient_points__allocation(total, 2);
    var rem := remainder_points__allocation(total, 2);
    DivideTwo(total);
    assert 0 <= rem < 2 && total == 2 * q + rem;
    assert floorShare(total, a, xs) == q && floorShare(total, b, xs) == q;
    assert pointRemainder(total, a, xs) == rem && pointRemainder(total, b, xs) == rem;
    RankMeaning(total, a, xs);
    RankMeaning(total, b, xs);
    FilterTwoValues((other: Recipient) => pointRemainder(total, other, xs) > pointRemainder(total, a, xs) || (pointRemainder(total, other, xs) == pointRemainder(total, a, xs) && other.actor < a.actor), a, b);
    FilterTwoValues((other: Recipient) => pointRemainder(total, other, xs) > pointRemainder(total, b, xs) || (pointRemainder(total, other, xs) == pointRemainder(total, b, xs) && other.actor < b.actor), a, b);
    assert remainderRank(total, a, xs) == 0 && remainderRank(total, b, xs) == 1;
    FoldTwo((acc: int, item: Recipient) => acc + floorShare(total, item, xs), 0, a, b);
    assert floorTotal(total, xs) == 2 * q;
    assert |allocatePoints(total, xs)| == 2;
    assert allocatePoints(total, xs)[0] == PointShare(1, q + rem);
    assert allocatePoints(total, xs)[1] == PointShare(2, q);
    assert allocatePoints(total, xs) == [PointShare(1, q + rem), PointShare(2, q)];
  }
}

lemma lawTenPointSplit_ensures(total: int)
  ensures (lawTenPointSplit(total) == true)
{
  if total == 10 {
    var a := Recipient(1, 1);
    var b := Recipient(2, 3);
    var xs := [a, b];
    FoldTwo((acc: int, item: Recipient) => acc + item.lines, 0, a, b);
    assert lineTotal(xs) == 4 && weightTotal(xs) == 4;
    assert floorShare(total, a, xs) == 2 && floorShare(total, b, xs) == 7;
    assert pointRemainder(total, a, xs) == 2 && pointRemainder(total, b, xs) == 2;
    RankMeaning(total, a, xs);
    RankMeaning(total, b, xs);
    FilterTwoValues((other: Recipient) => pointRemainder(total, other, xs) > pointRemainder(total, a, xs) || (pointRemainder(total, other, xs) == pointRemainder(total, a, xs) && other.actor < a.actor), a, b);
    FilterTwoValues((other: Recipient) => pointRemainder(total, other, xs) > pointRemainder(total, b, xs) || (pointRemainder(total, other, xs) == pointRemainder(total, b, xs) && other.actor < b.actor), a, b);
    assert remainderRank(total, a, xs) == 0 && remainderRank(total, b, xs) == 1;
    FoldTwo((acc: int, item: Recipient) => acc + floorShare(total, item, xs), 0, a, b);
    assert floorTotal(total, xs) == 9;
    assert |allocatePoints(total, xs)| == 2;
    assert allocatePoints(total, xs)[0] == PointShare(1, 3);
    assert allocatePoints(total, xs)[1] == PointShare(2, 7);
    assert allocatePoints(total, xs) == [PointShare(1, 3), PointShare(2, 7)];
  }
}

lemma DivideExact(total: int, d: int)
  requires total >= 0 && d > 0
  ensures quotient_points__allocation(total * d, d) == total
  ensures remainder_points__allocation(total * d, d) == 0
{
  var product := total * d;
  var q := product / d;
  var r := product % d;
  assert product == q * d + r;
  assert 0 <= r < d;
  if q < total {
    assert q <= total - 1;
    assert q * d <= (total - 1) * d;
    assert q * d + r < total * d;
  } else if q > total {
    assert q >= total + 1;
    assert q * d >= (total + 1) * d;
    assert q * d + r > total * d;
  }
  assert q == total;
  assert product >= 0;
  assert MathAbs(product) == product;
  assert MathAbs(d) == d;
  assert JSFloorDiv(product, d) == q;
  assert quotient_points__allocation(product, d) == q;
}

lemma DivideTwo(total: int)
  requires total >= 0
  ensures 0 <= remainder_points__allocation(total, 2) < 2
  ensures total == 2 * quotient_points__allocation(total, 2) + remainder_points__allocation(total, 2)
{
}

lemma FoldOne<T, A>(f: (A, T) -> A, z: A, a: T)
  ensures Std.Collections.Seq.FoldLeft(f, z, [a]) == f(z, a)
{
  ProofLib.FoldLeftAppend(f, z, [], a);
}

lemma FoldTwo<T, A>(f: (A, T) -> A, z: A, a: T, b: T)
  ensures Std.Collections.Seq.FoldLeft(f, z, [a, b]) == f(f(z, a), b)
{
  FoldOne(f, z, a);
  ProofLib.FoldLeftAppend(f, z, [a], b);
}

lemma RankMeaning(total: int, r: Recipient, xs: seq<Recipient>)
  ensures remainderRank(total, r, xs) == |ProofLib.Filter((other: Recipient) => pointRemainder(total, other, xs) > pointRemainder(total, r, xs) || (pointRemainder(total, other, xs) == pointRemainder(total, r, xs) && other.actor < r.actor), xs)|
{
}

lemma FilterOneValue<T>(p: T -> bool, a: T)
  ensures |ProofLib.Filter(p, [a])| == (if p(a) then 1 else 0)
{
  reveal ProofLib.Filter();
  reveal Std.Collections.Seq.Filter();
  ProofLib.FilterAppend(p, [], a);
  ProofLib.FilterNil(p, []);
}

lemma FilterTwoValues<T>(p: T -> bool, a: T, b: T)
  ensures |ProofLib.Filter(p, [a, b])| == (if p(a) then 1 else 0) + (if p(b) then 1 else 0)
{
  reveal ProofLib.Filter();
  reveal Std.Collections.Seq.Filter();
  FilterOneValue(p, a);
  ProofLib.FilterAppend(p, [a], b);
}
