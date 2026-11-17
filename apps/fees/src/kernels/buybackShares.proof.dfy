// A share is the Euclidean quotient of a nonnegative product, so it stays within the income and its remainder bounds it.

lemma shareOf_ensures(income: int, shareBps: int)
  requires (income >= 0)
  requires (shareBps >= 0)
  requires (shareBps <= 10000)
  ensures (0 <= shareOf(income, shareBps))
  ensures (shareOf(income, shareBps) <= income)
  ensures ((shareOf(income, shareBps) * 10000) <= (income * shareBps))
  ensures ((income * shareBps) < ((shareOf(income, shareBps) + 1) * 10000))
{
  MultiplyMonotone(0, shareBps, income);
  MultiplyMonotone(shareBps, 10000, income);
  var numerator := income * shareBps;
  assert 0 <= numerator <= income * 10000;
  DivisionBounds(numerator, 10000);
  var quotient := numerator / 10000;
  var remainder := numerator % 10000;
  assert 0 <= remainder < 10000;
  assert numerator == quotient * 10000 + remainder;
  assert shareOf(income, shareBps) == quotient;
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
