// Three sequential attempts. Receipt values are abstract nonnegative 0 or 1;
// total and last observed values are separate. Missing receipts add no amount.
module retry {
  var s: {attempt: int, knownUsage: bool, knownCost: bool, usage: int, cost: int,
    usageReceipts: List[int], costReceipts: List[int], ended: bool}
  action init = s' = {attempt:0,knownUsage:false,knownCost:false,usage:0,cost:0,
    usageReceipts:List(),costReceipts:List(),ended:false}
  action attempt(hasUsage: bool, hasCost: bool, succeeds: bool): bool = all {
    not(s.ended),s.attempt < 3,
    s' = s.with("attempt",s.attempt + 1)
      .with("knownUsage",s.knownUsage or hasUsage)
      .with("knownCost",s.knownCost or hasCost)
      .with("usage",s.usage + (if(hasUsage) 1 else 0))
      .with("cost",s.cost + (if(hasCost) 1 else 0))
      .with("usageReceipts",if(hasUsage) s.usageReceipts.append(1) else s.usageReceipts)
      .with("costReceipts",if(hasCost) s.costReceipts.append(1) else s.costReceipts)
      .with("ended",succeeds or s.attempt == 2) }
  action step = {
    nondet usage = Set(true,false).oneOf()
    nondet cost = Set(true,false).oneOf()
    nondet succeeds = Set(true,false).oneOf()
    any {attempt(usage,cost,succeeds),s'=s}
  }
  val invariant = all {s.attempt <= 3, s.usage <= s.attempt, s.cost <= s.attempt,
    s.usage == s.usageReceipts.length(),s.cost == s.costReceipts.length(),
    s.knownUsage iff s.usageReceipts.length() > 0,
    s.knownCost iff s.costReceipts.length() > 0}
  run missingFinalReceiptTest = init.then(attempt(true,true,false))
    .then(attempt(false,false,false)).then(attempt(false,false,false))
    .expect(s.ended and s.knownUsage and s.knownCost and s.usage == 1 and s.cost == 1)
  run unknownTest = init.then(attempt(false,false,true))
    .expect(s.ended and not(s.knownUsage) and not(s.knownCost))
}
