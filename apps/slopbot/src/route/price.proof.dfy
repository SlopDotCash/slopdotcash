// The estimate is the ceiling of a nonnegative token cost in millionths, so its remainder bounds it from both sides.

lemma costMicroUsd_ensures(rate: Rate, usage: TokenUsage)
  requires (rate.input >= 0)
  requires (rate.cacheWrite >= 0)
  requires (rate.cacheRead >= 0)
  requires (rate.output >= 0)
  requires (usage.input >= 0)
  requires (usage.cacheWrite >= 0)
  requires (usage.cacheRead >= 0)
  requires (usage.output >= 0)
  ensures (costMicroUsd(rate, usage) >= 0)
  ensures (((costMicroUsd(rate, usage) - 1) * 1000000) < tokenCost(rate, usage))
  ensures (tokenCost(rate, usage) <= (costMicroUsd(rate, usage) * 1000000))
{
  NonnegativeProduct(usage.input, rate.input);
  NonnegativeProduct(usage.cacheWrite, rate.cacheWrite);
  NonnegativeProduct(usage.cacheRead, rate.cacheRead);
  NonnegativeProduct(usage.output, rate.output);
  var total := tokenCost(rate, usage);
  assert total >= 0;
  var adjusted := total + 999999;
  var quotient := adjusted / 1000000;
  var remainder := adjusted % 1000000;
  assert adjusted == quotient * 1000000 + remainder;
  assert 0 <= remainder < 1000000;
  assert costMicroUsd(rate, usage) == quotient;
  assert (quotient - 1) * 1000000 == quotient * 1000000 - 1000000;
}

lemma NonnegativeProduct(left: int, right: int)
  requires left >= 0
  requires right >= 0
  ensures left * right >= 0
{
}
