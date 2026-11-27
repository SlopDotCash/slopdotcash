lemma slopPriceOf_ensures(scaled: int)
  requires (scaled > 0)
  ensures (slopPriceOf(scaled) >= 0)
  ensures ((slopPriceOf(scaled) * scaled) <= 1000000000000000000000000000000000000)
  ensures (1000000000000000000000000000000000000 < ((slopPriceOf(scaled) + 1) * scaled))
{
  DivisionBounds(1000000000000000000000000000000000000, scaled);
  assert slopPriceOf(scaled) == 1000000000000000000000000000000000000 / scaled;
}

lemma harmonicRate_ensures(count: int, prices: int)
  requires (count > 0)
  requires (prices > 0)
  ensures (harmonicRate(count, prices) >= 0)
  ensures ((harmonicRate(count, prices) * prices) <= (1000000000000000000000000000000000000 * count))
  ensures ((1000000000000000000000000000000000000 * count) < ((harmonicRate(count, prices) + 1) * prices))
{
  var numerator := 1000000000000000000000000000000000000 * count;
  assert numerator > 0;
  DivisionBounds(numerator, prices);
  assert harmonicRate(count, prices) == numerator / prices;
}

lemma feeShareBps_ensures(shareBps: int, rateInForce: int, market: int)
  requires (shareBps >= 0)
  requires (rateInForce > 0)
  requires (market > 0)
  ensures (feeShareBps(shareBps, rateInForce, market) >= 0)
  ensures ((feeShareBps(shareBps, rateInForce, market) * market) <= (shareBps * rateInForce))
  ensures ((shareBps * rateInForce) < ((feeShareBps(shareBps, rateInForce, market) + 1) * market))
{
  var numerator := shareBps * rateInForce;
  assert numerator >= 0;
  DivisionBounds(numerator, market);
  assert feeShareBps(shareBps, rateInForce, market) == numerator / market;
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
