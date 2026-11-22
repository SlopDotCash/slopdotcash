// The places are the numbers 0 to 36 in order.
lemma PresentationPlaces()
  ensures |decimalPlaces| == 37
  ensures forall i :: 0 <= i < 37 ==> decimalPlaces[i] == i
{
}

// From a place at or above the power on, the fold behind tenTo leaves its start unchanged.
lemma PresentationTenFoldRest(power: int, a: int, k: int)
  requires 0 <= k <= 37 && power <= k
  ensures Std.Collections.Seq.FoldLeft((product: int, place: int) => (if (place < power) then (product * 10) else product), a, decimalPlaces[k..]) == a
  decreases 37 - k
{
  PresentationPlaces();
  if k == 37 {
    assert decimalPlaces[k..] == [];
  } else {
    var s := decimalPlaces[k..];
    assert s[0] == k;
    assert s[1..] == decimalPlaces[k + 1..];
    PresentationTenFoldRest(power, a, k + 1);
  }
}

// From any place up to p on, raising the power from p to p + 1 multiplies the fold by ten.
lemma PresentationTenFoldStep(p: int, a: int, k: int)
  requires 0 <= k <= p < 36
  ensures Std.Collections.Seq.FoldLeft((product: int, place: int) => (if (place < (p + 1)) then (product * 10) else product), a, decimalPlaces[k..])
    == 10 * Std.Collections.Seq.FoldLeft((product: int, place: int) => (if (place < p) then (product * 10) else product), a, decimalPlaces[k..])
  decreases p - k
{
  PresentationPlaces();
  var s := decimalPlaces[k..];
  assert s[0] == k;
  assert s[1..] == decimalPlaces[k + 1..];
  if k == p {
    PresentationTenFoldRest(p + 1, a * 10, k + 1);
    PresentationTenFoldRest(p, a, k + 1);
  } else {
    PresentationTenFoldStep(p, a * 10, k + 1);
  }
}

lemma PresentationTenToZero()
  ensures tenTo(0) == 1
{
  PresentationTenFoldRest(0, 1, 0);
  assert decimalPlaces[0..] == decimalPlaces;
}

lemma PresentationTenToStep(p: int)
  requires 0 <= p < 36
  ensures tenTo(p + 1) == 10 * tenTo(p)
{
  PresentationTenFoldStep(p, 1, 0);
  assert decimalPlaces[0..] == decimalPlaces;
}

lemma PresentationTenToPositive(p: int)
  requires 0 <= p <= 36
  ensures tenTo(p) > 0
  decreases p
{
  if p == 0 {
    PresentationTenToZero();
  } else {
    PresentationTenToPositive(p - 1);
    PresentationTenToStep(p - 1);
  }
}

// Exact division: a multiple of x divides back to its factor with nothing left over.
lemma PresentationDivExact(x: int, m: int)
  requires x > 0 && m >= 0
  ensures (x * m) / x == m && (x * m) % x == 0
{
  var q := (x * m) / x;
  var rem := (x * m) % x;
  assert x * m == x * q + rem;
  assert x * (m - q) == rem;
  if m - q >= 1 {
    assert x * (m - q) >= x * 1;
  } else if m - q <= -1 {
    assert x * (m - q) <= x * -1;
  }
}

lemma PresentationQuotient(a: int, b: int)
  requires a >= 0 && b > 0
  ensures quotient_frontend__presentation(a, b) == a / b
  ensures remainder_frontend__presentation(a, b) == a % b
{
}

// The fold behind trailingZeros keeps the largest place, at most the decimals, at which the remainder is a multiple of that power.
lemma PresentationZerosFold(r: int, d: int, z0: int, k: int)
  requires 0 <= k <= 37 && 0 <= z0 && (k == 0 ==> z0 == 0) && (k > 0 ==> z0 < k)
  requires z0 <= d && belowScale(r, z0) == 0
  ensures var z := Std.Collections.Seq.FoldLeft((zeros: int, place: int) => (if ((place <= d) && (belowScale(r, place) == 0)) then place else zeros), z0, decimalPlaces[k..]);
    z >= z0 && z <= d && belowScale(r, z) == 0 &&
    forall x :: k <= x < 37 && x <= d && belowScale(r, x) == 0 ==> x <= z
  decreases 37 - k
{
  PresentationPlaces();
  if k == 37 {
    assert decimalPlaces[k..] == [];
  } else {
    var s := decimalPlaces[k..];
    assert s[0] == k;
    assert s[1..] == decimalPlaces[k + 1..];
    var next := if ((k <= d) && (belowScale(r, k) == 0)) then k else z0;
    PresentationZerosFold(r, d, next, k + 1);
  }
}

// For a nonzero remainder below ten to the decimals, the trailing zeros are fewer than the decimals,
// the remainder is a multiple of ten to them, and not of ten to one more.
lemma PresentationTrailingZeros(r: int, d: int)
  requires 0 <= d <= 36 && 0 < r < tenTo(d)
  ensures var z := trailingZeros(r, d);
    0 <= z < d && r % tenTo(z) == 0 && r % tenTo(z + 1) != 0
{
  PresentationTenToZero();
  PresentationQuotient(r, 1);
  PresentationZerosFold(r, d, 0, 0);
  assert decimalPlaces[0..] == decimalPlaces;
  var z := trailingZeros(r, d);
  PresentationTenToPositive(z);
  PresentationTenToPositive(d);
  PresentationQuotient(r, tenTo(z));
  PresentationQuotient(r, tenTo(d));
  assert r % tenTo(d) == r;
  assert z != d;
  PresentationTenToPositive(z + 1);
  PresentationQuotient(r, tenTo(z + 1));
  assert !(belowScale(r, z + 1) == 0);
}

// Every remainder and quotient is taken with a positive power of ten.
lemma PresentationShown(units: int, decimals: int)
  requires units >= 0 && validDecimals(decimals)
  ensures var T := tenTo(decimals);
    var r := units % T;
    var s := showAmount(units, decimals);
    s.whole == units / T &&
    (r == 0 ==> s.fraction == 0 && s.fractionDigits == 0) &&
    (r != 0 ==> var z := trailingZeros(r, decimals);
      0 <= z < decimals && s.fractionDigits == decimals - z &&
      s.fraction == r / tenTo(z) && r % tenTo(z) == 0 && r % tenTo(z + 1) != 0)
{
  var T := tenTo(decimals);
  PresentationTenToPositive(decimals);
  PresentationQuotient(units, T);
  var r := units % T;
  assert belowScale(units, decimals) == r;
  if r == 0 {
    PresentationQuotient(0, T);
  } else {
    PresentationTrailingZeros(r, decimals);
    var z := trailingZeros(r, decimals);
    PresentationTenToPositive(z);
    PresentationQuotient(r, tenTo(z));
  }
}

// Whole part times the scale plus fraction times its own scale gives back the units.
lemma lawShownAmountRoundTrips_ensures(units: int, decimals: int)
  ensures (lawShownAmountRoundTrips(units, decimals) == true)
{
  if units >= 0 && validDecimals(decimals) {
    PresentationShown(units, decimals);
    var T := tenTo(decimals);
    var r := units % T;
    var s := showAmount(units, decimals);
    PresentationTenToPositive(decimals);
    assert units == T * (units / T) + r;
    if r == 0 {
      PresentationTenToZero();
      assert tenTo(decimals - s.fractionDigits) == tenTo(decimals);
    } else {
      var z := trailingZeros(r, decimals);
      PresentationTenToPositive(z);
      assert decimals - s.fractionDigits == z;
      var P := tenTo(z);
      assert r == P * (r / P) + r % P;
      assert s.fraction * P == r;
    }
  }
}

// A shown fraction with digits never ends in zero: one more trailing zero would divide the remainder.
lemma lawNoTrailingFractionZero_ensures(units: int, decimals: int)
  ensures (lawNoTrailingFractionZero(units, decimals) == true)
{
  if units >= 0 && validDecimals(decimals) && showAmount(units, decimals).fractionDigits > 0 {
    PresentationShown(units, decimals);
    var T := tenTo(decimals);
    var r := units % T;
    var s := showAmount(units, decimals);
    var z := trailingZeros(r, decimals);
    var P := tenTo(z);
    PresentationTenToPositive(z);
    PresentationTenToPositive(decimals);
    assert r != 0;
    assert s.fraction >= 0;
    PresentationQuotient(s.fraction, 10);
    if s.fraction % 10 == 0 {
      var m := s.fraction / 10;
      assert s.fraction == 10 * m;
      assert r == P * s.fraction;
      assert r == (10 * P) * m;
      assert m >= 0;
      PresentationDivExact(10 * P, m);
      PresentationTenToStep(z);
      assert tenTo(z + 1) == 10 * P;
      assert false;
    }
  }
}
