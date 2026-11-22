// Powers of ten by recursion, the closed form of the folds behind tenTo.
function PresentationPow10(n: nat): int
{
  if n == 0 then 1 else 10 * PresentationPow10(n - 1)
}

lemma PresentationPow10Positive(n: nat)
  ensures PresentationPow10(n) > 0
{
  if n > 0 {
    PresentationPow10Positive(n - 1);
  }
}

lemma PresentationPlaces()
  ensures |decimalPlaces| == 37
  ensures forall i :: 0 <= i < 37 ==> decimalPlaces[i] == i
{
}

// From place k on, the fold multiplies by ten once for each remaining place below the power.
lemma PresentationTenFold(power: int, a: int, k: int)
  requires 0 <= k <= 37 && 0 <= power <= 37
  ensures Std.Collections.Seq.FoldLeft((product: int, place: int) => (if (place < power) then (product * 10) else product), a, decimalPlaces[k..])
    == a * PresentationPow10(if power > k then power - k else 0)
  decreases 37 - k
{
  PresentationPlaces();
  if k == 37 {
    assert decimalPlaces[k..] == [];
  } else {
    var s := decimalPlaces[k..];
    assert s[0] == k;
    assert s[1..] == decimalPlaces[k + 1..];
    var next := if k < power then a * 10 else a;
    PresentationTenFold(power, next, k + 1);
    if k < power {
      var n := power - k - 1;
      calc {
        a * PresentationPow10(power - k);
        a * (10 * PresentationPow10(n));
        (a * 10) * PresentationPow10(n);
      }
    }
  }
}

lemma PresentationTenTo(power: int)
  requires 0 <= power <= 36
  ensures tenTo(power) == PresentationPow10(power)
  ensures tenTo(power) > 0
{
  PresentationTenFold(power, 1, 0);
  assert decimalPlaces[0..] == decimalPlaces;
  PresentationPow10Positive(power);
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
  requires 0 <= d <= 36 && 0 < r < PresentationPow10(d)
  ensures var z := trailingZeros(r, d);
    0 <= z < d && r % PresentationPow10(z) == 0 && r % PresentationPow10(z + 1) != 0
{
  PresentationTenTo(0);
  PresentationQuotient(r, 1);
  PresentationZerosFold(r, d, 0, 0);
  assert decimalPlaces[0..] == decimalPlaces;
  var z := trailingZeros(r, d);
  PresentationTenTo(z);
  PresentationTenTo(d);
  PresentationQuotient(r, PresentationPow10(z));
  PresentationQuotient(r, PresentationPow10(d));
  assert r % PresentationPow10(d) == r;
  assert z != d;
  PresentationTenTo(z + 1);
  PresentationQuotient(r, PresentationPow10(z + 1));
  assert !(belowScale(r, z + 1) == 0);
}

// Every remainder and quotient is taken with a positive power of ten.
lemma PresentationShown(units: int, decimals: int)
  requires units >= 0 && validDecimals(decimals)
  ensures var T := PresentationPow10(decimals);
    var r := units % T;
    var s := showAmount(units, decimals);
    s.whole == units / T &&
    (r == 0 ==> s.fraction == 0 && s.fractionDigits == 0) &&
    (r != 0 ==> var z := trailingZeros(r, decimals);
      0 <= z < decimals && s.fractionDigits == decimals - z &&
      s.fraction == r / PresentationPow10(z) && r % PresentationPow10(z) == 0 && r % PresentationPow10(z + 1) != 0)
{
  var T := PresentationPow10(decimals);
  PresentationTenTo(decimals);
  PresentationQuotient(units, T);
  var r := units % T;
  assert belowScale(units, decimals) == r;
  if r == 0 {
    PresentationQuotient(0, T);
  } else {
    PresentationTrailingZeros(r, decimals);
    var z := trailingZeros(r, decimals);
    PresentationTenTo(z);
    PresentationQuotient(r, PresentationPow10(z));
  }
}

// Whole part times the scale plus fraction times its own scale gives back the units.
lemma lawShownAmountRoundTrips_ensures(units: int, decimals: int)
  ensures (lawShownAmountRoundTrips(units, decimals) == true)
{
  if units >= 0 && validDecimals(decimals) {
    PresentationShown(units, decimals);
    var T := PresentationPow10(decimals);
    var r := units % T;
    var s := showAmount(units, decimals);
    PresentationTenTo(decimals);
    assert units == T * (units / T) + r;
    if r == 0 {
      PresentationTenTo(0);
      assert tenTo(decimals - s.fractionDigits) == tenTo(decimals);
    } else {
      var z := trailingZeros(r, decimals);
      PresentationTenTo(z);
      assert decimals - s.fractionDigits == z;
      var P := PresentationPow10(z);
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
    var T := PresentationPow10(decimals);
    var r := units % T;
    var s := showAmount(units, decimals);
    var z := trailingZeros(r, decimals);
    var P := PresentationPow10(z);
    PresentationPow10Positive(z);
    PresentationPow10Positive(decimals);
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
      assert PresentationPow10(z + 1) == 10 * P;
      assert false;
    }
  }
}
