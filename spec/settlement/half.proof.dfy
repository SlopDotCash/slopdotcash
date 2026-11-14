// Reversal retains the exact limbs, only changing which one is read first.
lemma ReverseRetainsDigits(xs: seq<int>, initial: seq<int>)
  requires forall digit :: digit in xs ==> 0 <= digit < 1000
  requires forall digit :: digit in initial ==> 0 <= digit < 1000
  ensures |Std.Collections.Seq.FoldLeft((acc: seq<int>, digit: int) => ([digit] + acc), initial, xs)| == |initial| + |xs|
  ensures |xs| + |initial| > 0 ==> settlement__money_validAmount(Std.Collections.Seq.FoldLeft((acc: seq<int>, digit: int) => ([digit] + acc), initial, xs))
  decreases |xs|
{
  if |xs| > 0 {
    assert xs[0] in xs;
    assert forall digit :: digit in xs[1..] ==> digit in xs;
    ReverseRetainsDigits(xs[1..], [xs[0]] + initial);
  }
}

lemma HalfFoldKeepsDigits(xs: seq<int>, current: Half)
  requires 0 <= current.remainder < 2
  requires forall digit :: digit in xs ==> 0 <= digit < 1000
  requires forall digit :: digit in current.quotient ==> 0 <= digit < 1000
  ensures |Std.Collections.Seq.FoldLeft((acc: Half, limb: int) => halfStep(acc, limb), current, xs).quotient| == |current.quotient| + |xs|
  ensures 0 <= Std.Collections.Seq.FoldLeft((acc: Half, limb: int) => halfStep(acc, limb), current, xs).remainder < 2
  ensures |xs| + |current.quotient| > 0 ==> settlement__money_validAmount(Std.Collections.Seq.FoldLeft((acc: Half, limb: int) => halfStep(acc, limb), current, xs).quotient)
  decreases |xs|
{
  if |xs| > 0 {
    var limb := xs[0];
    assert limb in xs;
    var partial := 1000 * current.remainder + limb;
    assert 0 <= partial < 2000;
    assert quotient_settlement__half(partial, 2) == partial / 2;
    assert remainder_settlement__half(partial, 2) == partial % 2;
    var next := halfStep(current, limb);
    assert next.quotient == [partial / 2] + current.quotient;
    assert next.remainder == partial % 2;
    assert forall digit :: digit in xs[1..] ==> digit in xs;
    HalfFoldKeepsDigits(xs[1..], next);
  }
}

lemma lawHalfValid_ensures(amount: seq<int>)
  ensures (lawHalfValid(amount) == true)
{
  if settlement__money_validAmount(amount) {
    ReverseRetainsDigits(amount, []);
    HalfFoldKeepsDigits(settlement__money_reverseAmount(amount), Half([], 0));
    HalvingReconstructsAmount(amount);
  }
}

// Horner expansion of a little-endian amount after one limb is prepended.
lemma PrependingLimbUpdatesValue(xs: seq<int>, digit: int)
  ensures Std.Collections.Seq.FoldLeft((acc: int, limb: int) => 1000 * acc + limb, 0, settlement__money_reverseAmount([digit] + xs)) ==
    1000 * Std.Collections.Seq.FoldLeft((acc: int, limb: int) => 1000 * acc + limb, 0, settlement__money_reverseAmount(xs)) + digit
{
  var reverse := (acc: seq<int>, digit: int) => ([digit] + acc);
  assert |[digit] + xs| > 0 && ([digit] + xs)[0] == digit && ([digit] + xs)[1..] == xs;
  assert reverse([], digit) == [digit];
  assert settlement__money_reverseAmount([digit] + xs) == Std.Collections.Seq.FoldLeft(reverse, [digit], xs);
  ReverseOneAtEnd(reverse, xs, digit);
  assert settlement__money_reverseAmount([digit] + xs) == settlement__money_reverseAmount(xs) + [digit];
  ProofLib.FoldLeftAppend((acc: int, limb: int) => 1000 * acc + limb, 0, settlement__money_reverseAmount(xs), digit);
}

lemma ReverseOneAtEnd(reverse: (seq<int>, int) -> seq<int>, xs: seq<int>, digit: int)
  requires forall acc, limb :: reverse(acc, limb) == [limb] + acc
  ensures Std.Collections.Seq.FoldLeft(reverse, [digit], xs) == Std.Collections.Seq.FoldLeft(reverse, [], xs) + [digit]
{
  ReverseRetainsTail(reverse, [], [digit], xs);
  assert [] + [digit] == [digit];
}

lemma ReverseRetainsTail(reverse: (seq<int>, int) -> seq<int>, first: seq<int>, tail: seq<int>, xs: seq<int>)
  requires forall acc, limb :: reverse(acc, limb) == [limb] + acc
  ensures Std.Collections.Seq.FoldLeft(reverse, first + tail, xs) == Std.Collections.Seq.FoldLeft(reverse, first, xs) + tail
  decreases |xs|
{
  if |xs| > 0 {
    assert reverse(first + tail, xs[0]) == reverse(first, xs[0]) + tail;
    ReverseRetainsTail(reverse, reverse(first, xs[0]), tail, xs[1..]);
  }
}

lemma HalvesReconstructFold(xs: seq<int>, current: Half, original: int)
  requires 0 <= current.remainder < 2
  requires forall digit :: digit in xs ==> 0 <= digit < 1000
  requires original == 2 * Std.Collections.Seq.FoldLeft((acc: int, limb: int) => 1000 * acc + limb, 0, settlement__money_reverseAmount(current.quotient)) + current.remainder
  ensures Std.Collections.Seq.FoldLeft((acc: int, limb: int) => 1000 * acc + limb, original, xs) ==
    2 * Std.Collections.Seq.FoldLeft((acc: int, limb: int) => 1000 * acc + limb, 0,
      settlement__money_reverseAmount(Std.Collections.Seq.FoldLeft((acc: Half, limb: int) => halfStep(acc, limb), current, xs).quotient)) +
    Std.Collections.Seq.FoldLeft((acc: Half, limb: int) => halfStep(acc, limb), current, xs).remainder
  decreases |xs|
{
  if |xs| > 0 {
    var limb := xs[0];
    assert limb in xs;
    var partial := 1000 * current.remainder + limb;
    assert 0 <= partial < 2000;
    assert quotient_settlement__half(partial, 2) == partial / 2;
    assert remainder_settlement__half(partial, 2) == partial % 2;
    var next := halfStep(current, limb);
    PrependingLimbUpdatesValue(current.quotient, partial / 2);
    assert next.quotient == [partial / 2] + current.quotient;
    assert next.remainder == partial % 2;
    assert 1000 * original + limb == 2 * Std.Collections.Seq.FoldLeft((acc: int, limb: int) => 1000 * acc + limb, 0, settlement__money_reverseAmount(next.quotient)) + next.remainder;
    assert forall digit :: digit in xs[1..] ==> digit in xs;
    HalvesReconstructFold(xs[1..], next, 1000 * original + limb);
  }
}

lemma HalvingReconstructsAmount(amount: seq<int>)
  requires settlement__money_validAmount(amount)
  ensures Std.Collections.Seq.FoldLeft((acc: int, limb: int) => 1000 * acc + limb, 0, settlement__money_reverseAmount(amount)) ==
    2 * Std.Collections.Seq.FoldLeft((acc: int, limb: int) => 1000 * acc + limb, 0, settlement__money_reverseAmount(half(amount).quotient)) + half(amount).remainder
{
  ReverseRetainsDigits(amount, []);
  assert settlement__money_validAmount(settlement__money_reverseAmount(amount));
  HalvesReconstructFold(settlement__money_reverseAmount(amount), Half([], 0), 0);
}
