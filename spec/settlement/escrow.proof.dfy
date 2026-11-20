// Generic limb-amount rearrangements used by the escrow conservation proofs.

lemma EscChain(a: seq<int>, b: seq<int>, c: seq<int>)
  requires settlement__money_equalAmounts(a, b) && settlement__money_equalAmounts(b, c)
  ensures settlement__money_equalAmounts(a, c)
{
  settlement__money_lawEqualSubstitution_ensures(a, b, c);
}

lemma EscSym(a: seq<int>, b: seq<int>)
  requires settlement__money_equalAmounts(a, b)
  ensures settlement__money_equalAmounts(b, a)
{
  settlement__money_lawEqualSymmetric_ensures(a, b);
}

lemma EscMove(t: seq<int>, a: seq<int>, b: seq<int>, x: seq<int>)
  requires settlement__money_validAmount(t) && settlement__money_validAmount(a) && settlement__money_validAmount(b) && settlement__money_validAmount(x)
  requires settlement__money_compareAmounts(a, x) >= 0
  requires settlement__money_equalAmounts(t, settlement__money_addAmounts(a, b))
  ensures settlement__money_equalAmounts(t, settlement__money_addAmounts(settlement__money_subtractAmounts(a, x), settlement__money_addAmounts(b, x)))
  ensures settlement__money_equalAmounts(t, settlement__money_addAmounts(settlement__money_addAmounts(b, x), settlement__money_subtractAmounts(a, x)))
{
  var rest := settlement__money_subtractAmounts(a, x);
  var reconstructed := settlement__money_addAmounts(rest, x);
  settlement__money_lawSubtractionValid_ensures(a, x);
  settlement__money_lawAdditionValid_ensures(rest, x);
  settlement__money_lawAdditionValid_ensures(b, x);
  settlement__money_lawSubtractionReconstructs_ensures(a, x);
  settlement__money_lawAddCongruence_ensures(reconstructed, a, b);
  settlement__money_lawAddAssociative_ensures(rest, x, b);
  settlement__money_lawAddCommutative_ensures(x, b);
  var sum := settlement__money_addAmounts(a, b);
  var equivalent := settlement__money_addAmounts(reconstructed, b);
  EscSym(equivalent, sum);
  EscChain(sum, equivalent, settlement__money_addAmounts(rest, settlement__money_addAmounts(b, x)));
  EscChain(t, sum, settlement__money_addAmounts(rest, settlement__money_addAmounts(b, x)));
  settlement__money_lawAddCommutative_ensures(rest, settlement__money_addAmounts(b, x));
}

lemma EscAddLeft(t: seq<int>, a: seq<int>, b: seq<int>, x: seq<int>)
  requires settlement__money_validAmount(t) && settlement__money_validAmount(a) && settlement__money_validAmount(b) && settlement__money_validAmount(x)
  requires settlement__money_equalAmounts(t, settlement__money_addAmounts(a, b))
  ensures settlement__money_equalAmounts(settlement__money_addAmounts(t, x), settlement__money_addAmounts(settlement__money_addAmounts(a, x), b))
  ensures settlement__money_equalAmounts(settlement__money_addAmounts(t, x), settlement__money_addAmounts(a, settlement__money_addAmounts(b, x)))
{
  var ab := settlement__money_addAmounts(a, b);
  settlement__money_lawAdditionValid_ensures(a, b);
  settlement__money_lawAdditionValid_ensures(a, x);
  settlement__money_lawAdditionValid_ensures(b, x);
  settlement__money_lawAddCongruence_ensures(t, ab, x);
  settlement__money_lawAddAssociative_ensures(a, b, x);
  EscChain(settlement__money_addAmounts(t, x), settlement__money_addAmounts(ab, x), settlement__money_addAmounts(a, settlement__money_addAmounts(b, x)));
  settlement__money_lawAddCommutative_ensures(b, x);
  settlement__money_lawAddAssociative_ensures(a, x, b);
  EscSym(settlement__money_addAmounts(settlement__money_addAmounts(a, x), b), settlement__money_addAmounts(a, settlement__money_addAmounts(x, b)));
  EscChain(settlement__money_addAmounts(t, x), settlement__money_addAmounts(a, settlement__money_addAmounts(x, b)), settlement__money_addAmounts(settlement__money_addAmounts(a, x), b));
}

lemma EscCancel(y: seq<int>, x: seq<int>)
  requires settlement__money_validAmount(y) && settlement__money_validAmount(x)
  ensures settlement__money_compareAmounts(settlement__money_addAmounts(y, x), x) >= 0
  ensures settlement__money_equalAmounts(settlement__money_subtractAmounts(settlement__money_addAmounts(y, x), x), y)
{
  var yx := settlement__money_addAmounts(y, x);
  settlement__money_lawAdditionValid_ensures(y, x);
  settlement__money_lawAddCommutative_ensures(y, x);
  settlement__money_lawAddMonotone_ensures(x, y);
  settlement__money_lawSubtractionValid_ensures(yx, x);
  settlement__money_lawSubtractionReconstructs_ensures(yx, x);
  var r := settlement__money_subtractAmounts(yx, x);
  settlement__money_lawAddOrder_ensures(r, y, x);
}

lemma EscSubLeft(t: seq<int>, a: seq<int>, b: seq<int>, x: seq<int>)
  requires settlement__money_validAmount(t) && settlement__money_validAmount(a) && settlement__money_validAmount(b) && settlement__money_validAmount(x)
  requires settlement__money_compareAmounts(a, x) >= 0 && settlement__money_compareAmounts(t, x) >= 0
  requires settlement__money_equalAmounts(t, settlement__money_addAmounts(a, b))
  ensures settlement__money_equalAmounts(settlement__money_subtractAmounts(t, x), settlement__money_addAmounts(settlement__money_subtractAmounts(a, x), b))
{
  var rest := settlement__money_subtractAmounts(a, x);
  var y := settlement__money_addAmounts(rest, b);
  settlement__money_lawSubtractionValid_ensures(a, x);
  settlement__money_lawAdditionValid_ensures(rest, b);
  settlement__money_lawAdditionValid_ensures(rest, x);
  settlement__money_lawSubtractionReconstructs_ensures(a, x);
  // t = a + b = (rest + x) + b = (rest + b) + x
  settlement__money_lawAddCongruence_ensures(settlement__money_addAmounts(rest, x), a, b);
  EscSym(settlement__money_addAmounts(settlement__money_addAmounts(rest, x), b), settlement__money_addAmounts(a, b));
  EscChain(t, settlement__money_addAmounts(a, b), settlement__money_addAmounts(settlement__money_addAmounts(rest, x), b));
  EscAddLeft(y, rest, b, x);
  settlement__money_lawEqualReflexive_ensures(y);
  EscSym(settlement__money_addAmounts(y, x), settlement__money_addAmounts(settlement__money_addAmounts(rest, x), b));
  EscChain(t, settlement__money_addAmounts(settlement__money_addAmounts(rest, x), b), settlement__money_addAmounts(y, x));
  settlement__money_lawAdditionValid_ensures(y, x);
  settlement__money_lawSubtractCongruence_ensures(t, settlement__money_addAmounts(y, x), x);
  EscCancel(y, x);
  EscChain(settlement__money_subtractAmounts(t, x), settlement__money_subtractAmounts(settlement__money_addAmounts(y, x), x), y);
}

lemma EscSubRight(t: seq<int>, a: seq<int>, b: seq<int>, x: seq<int>)
  requires settlement__money_validAmount(t) && settlement__money_validAmount(a) && settlement__money_validAmount(b) && settlement__money_validAmount(x)
  requires settlement__money_compareAmounts(b, x) >= 0 && settlement__money_compareAmounts(t, x) >= 0
  requires settlement__money_equalAmounts(t, settlement__money_addAmounts(a, b))
  ensures settlement__money_equalAmounts(settlement__money_subtractAmounts(t, x), settlement__money_addAmounts(a, settlement__money_subtractAmounts(b, x)))
{
  settlement__money_lawAddCommutative_ensures(a, b);
  EscSubLeft(t, b, a, x);
  settlement__money_lawAddCommutative_ensures(settlement__money_subtractAmounts(b, x), a);
}
