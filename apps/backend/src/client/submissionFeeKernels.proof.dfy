lemma significantUnit_ensures(value: int)
  requires (value > 0)
  ensures ((significantUnit(value) >= 1) && ((significantUnit(value) * 100) > value))
  ensures ((significantUnit(value) == 1) || ((significantUnit(value) * 10) <= value))
  decreases value
{
  if value >= 100 {
    assert JSTruncDiv(value, 10) == value / 10;
    assert value == (value / 10) * 10 + value % 10;
    significantUnit_ensures(value / 10);
  }
}

lemma twoSignificant_ensures(value: int)
  requires (value > 0)
  ensures (twoSignificant(value) > 0)
{
  significantUnit_ensures(value);
  var unit := significantUnit(value);
  assert unit >= 1;
  assert value >= unit;
  assert JSTruncDiv(unit, 2) == unit / 2;
  assert JSTruncDiv(value + unit / 2, unit) == (value + unit / 2) / unit;
  assert (value + unit / 2) / unit >= 1;
}

lemma slopFeeUnits_ensures(stableMinor: int, rateScaled: int, shareBps: int, stableUnit: int)
  requires ((((stableMinor > 0) && (rateScaled > 0)) && (shareBps > 0)) && (stableUnit > 0))
  ensures (slopFeeUnits(stableMinor, rateScaled, shareBps, stableUnit) >= 0)
  ensures ((slopFeeUnits(stableMinor, rateScaled, shareBps, stableUnit) == 0) <==> (((stableMinor * rateScaled) * shareBps) < (stableUnit * 10000)))
{
  var numerator := (stableMinor * rateScaled) * shareBps;
  var denominator := stableUnit * 10000;
  assert numerator > 0 && denominator > 0;
  assert JSTruncDiv(numerator, denominator) == numerator / denominator;
  assert (numerator / denominator > 0) <==> numerator >= denominator;
  if numerator / denominator > 0 {
    twoSignificant_ensures(numerator / denominator);
  }
}

lemma rateMicros_ensures(scaled: int)
  requires (scaled > 0)
  ensures (rateMicros(scaled) >= 0)
  ensures (((rateMicros(scaled) * 1000000000000) <= (scaled + 500000000000)) && ((scaled + 500000000000) < ((rateMicros(scaled) + 1) * 1000000000000)))
{
  assert JSTruncDiv(1000000000000, 2) == 500000000000;
  assert JSTruncDiv(scaled + 500000000000, 1000000000000) == (scaled + 500000000000) / 1000000000000;
}
