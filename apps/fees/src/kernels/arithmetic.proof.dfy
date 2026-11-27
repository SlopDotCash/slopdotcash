// Each rounded quotient is the Euclidean quotient of a nonnegative numerator, so its remainder bounds both directions.

lemma roundedDivision_ensures(numerator: int, denominator: int, up: bool)
  requires (numerator >= 0)
  requires (denominator > 0)
  ensures (roundedDivision(numerator, denominator, up) >= 0)
  ensures (!(up) ==> (((roundedDivision(numerator, denominator, up) * denominator) <= numerator) && (numerator < ((roundedDivision(numerator, denominator, up) + 1) * denominator))))
  ensures (up ==> ((((roundedDivision(numerator, denominator, up) - 1) * denominator) < numerator) && (numerator <= (roundedDivision(numerator, denominator, up) * denominator))))
{
  if up {
    var adjusted := numerator + denominator - 1;
    assert adjusted >= 0;
    DivisionBounds(adjusted, denominator);
    var quotient := adjusted / denominator;
    var remainder := adjusted % denominator;
    assert 0 <= remainder < denominator;
    assert adjusted == quotient * denominator + remainder;
    assert roundedDivision(numerator, denominator, up) == quotient;
    assert (quotient - 1) * denominator == quotient * denominator - denominator;
  } else {
    DivisionBounds(numerator, denominator);
    var quotient := numerator / denominator;
    var remainder := numerator % denominator;
    assert 0 <= remainder < denominator;
    assert numerator == quotient * denominator + remainder;
    assert roundedDivision(numerator, denominator, up) == quotient;
  }
}

lemma minimumOutput_ensures(amountOut: int, slippageBps: int)
  requires (amountOut >= 0)
  requires (slippageBps >= 0)
  requires (slippageBps <= 10000)
  ensures (0 <= minimumOutput(amountOut, slippageBps))
  ensures (minimumOutput(amountOut, slippageBps) <= amountOut)
  ensures ((minimumOutput(amountOut, slippageBps) * 10000) <= (amountOut * (10000 - slippageBps)))
  ensures ((amountOut * (10000 - slippageBps)) < ((minimumOutput(amountOut, slippageBps) + 1) * 10000))
{
  var factor := 10000 - slippageBps;
  assert 0 <= factor <= 10000;
  MultiplyMonotone(0, factor, amountOut);
  MultiplyMonotone(factor, 10000, amountOut);
  var numerator := amountOut * factor;
  assert 0 <= numerator <= amountOut * 10000;
  DivisionBounds(numerator, 10000);
  var quotient := numerator / 10000;
  var remainder := numerator % 10000;
  assert 0 <= remainder < 10000;
  assert numerator == quotient * 10000 + remainder;
  assert minimumOutput(amountOut, slippageBps) == quotient;
}

lemma rescaleInput_ensures(amount: int, remaining: int, quotedOut: int)
  requires (amount > 0)
  requires (remaining > 0)
  requires (quotedOut > remaining)
  ensures (0 <= rescaleInput(amount, remaining, quotedOut))
  ensures (rescaleInput(amount, remaining, quotedOut) < amount)
  ensures (((rescaleInput(amount, remaining, quotedOut) * quotedOut) * 100) <= ((amount * remaining) * 98))
  ensures (((amount * remaining) * 98) < (((rescaleInput(amount, remaining, quotedOut) + 1) * quotedOut) * 100))
{
  var numerator := amount * remaining * 98;
  var denominator := quotedOut * 100;
  assert numerator > 0 && denominator > 0;
  DivisionBounds(numerator, denominator);
  var quotient := numerator / denominator;
  var remainder := numerator % denominator;
  assert 0 <= remainder < denominator;
  assert numerator == quotient * denominator + remainder;
  assert rescaleInput(amount, remaining, quotedOut) == quotient;
  assert remaining * 98 < quotedOut * 100;
  MultiplyMonotone(remaining * 98 + 1, quotedOut * 100, amount);
  assert amount * (remaining * 98) < amount * (quotedOut * 100);
  assert numerator < amount * denominator;
  assert quotient * denominator <= numerator;
  if quotient >= amount {
    MultiplyMonotone(amount, quotient, denominator);
    assert quotient * denominator >= amount * denominator;
    assert false;
  }
}

lemma priceImpactCeiling_ensures(inputValue: int, outputValue: int)
  requires (inputValue > 0)
  requires (outputValue >= 0)
  ensures (0 <= priceImpactCeiling(inputValue, outputValue))
  ensures (priceImpactCeiling(inputValue, outputValue) <= 10000)
  ensures ((outputValue >= inputValue) ==> (priceImpactCeiling(inputValue, outputValue) == 0))
  ensures ((outputValue < inputValue) ==> ((((priceImpactCeiling(inputValue, outputValue) - 1) * inputValue) < ((inputValue - outputValue) * 10000)) && (((inputValue - outputValue) * 10000) <= (priceImpactCeiling(inputValue, outputValue) * inputValue))))
{
  if inputValue > outputValue {
    var loss := inputValue - outputValue;
    var adjusted := loss * 10000 + inputValue - 1;
    assert 0 < loss <= inputValue;
    assert adjusted >= 0;
    DivisionBounds(adjusted, inputValue);
    var quotient := adjusted / inputValue;
    var remainder := adjusted % inputValue;
    assert 0 <= remainder < inputValue;
    assert adjusted == quotient * inputValue + remainder;
    assert priceImpactCeiling(inputValue, outputValue) == quotient;
    assert (quotient - 1) * inputValue == quotient * inputValue - inputValue;
    assert adjusted <= inputValue * 10000 + inputValue - 1;
    assert inputValue * 10000 + inputValue == 10001 * inputValue;
    assert adjusted < 10001 * inputValue;
    if quotient > 10000 {
      MultiplyMonotone(10001, quotient, inputValue);
      assert quotient * inputValue >= 10001 * inputValue;
      assert false;
    }
  }
}

lemma MultiplyMonotone(lower: int, upper: int, factor: int)
  requires lower <= upper
  requires factor >= 0
  ensures lower * factor <= upper * factor
{
  assert (upper - lower) * factor >= 0;
  assert upper * factor - lower * factor == (upper - lower) * factor;
}

lemma DivisionBounds(n: int, d: int)
  requires n >= 0
  requires d > 0
  ensures JSTruncDiv(n, d) == n / d
  ensures JSTruncDiv(n, d) >= 0
  ensures JSTruncDiv(n, d) * d <= n
  ensures n < (JSTruncDiv(n, d) + 1) * d
{
  assert n / d >= 0;
  assert JSTruncDiv(n, d) == n / d;
  assert n == (n / d) * d + n % d;
  assert 0 <= n % d < d;
}
