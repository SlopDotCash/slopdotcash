// The scaled price is the Euclidean quotient of a nonnegative square times 10^6 by 2^192, so its remainder bounds it on both sides.

lemma slopPerStableScaled_ensures(sqrtPriceX96: int)
  requires (sqrtPriceX96 >= 0)
  ensures (slopPerStableScaled(sqrtPriceX96) >= 0)
  ensures ((slopPerStableScaled(sqrtPriceX96) * 6277101735386680763835789423207666416102355444464034512896) <= ((sqrtPriceX96 * sqrtPriceX96) * 1000000))
  ensures (((sqrtPriceX96 * sqrtPriceX96) * 1000000) < ((slopPerStableScaled(sqrtPriceX96) + 1) * 6277101735386680763835789423207666416102355444464034512896))
{
  var square := sqrtPriceX96 * sqrtPriceX96;
  assert square >= 0;
  var numerator := square * 1000000;
  assert numerator >= 0;
  DivisionBounds(numerator, 6277101735386680763835789423207666416102355444464034512896);
  var quotient := numerator / 6277101735386680763835789423207666416102355444464034512896;
  var remainder := numerator % 6277101735386680763835789423207666416102355444464034512896;
  assert 0 <= remainder < 6277101735386680763835789423207666416102355444464034512896;
  assert numerator == quotient * 6277101735386680763835789423207666416102355444464034512896 + remainder;
  assert slopPerStableScaled(sqrtPriceX96) == quotient;
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
