// @source workers/vetting/review-plan.ts
// Three sequential attempts. Receipt values are abstract nonnegative 0 or 1;
// observed subtotals and complete totals are separate. A failed terminal
// outcome may show its known subtotal; a successful retry exposes a total only
// if every corresponding receipt is present. -1 means unknown, not zero.
module retry {
  var s: {attempt: int, knownUsage: bool, knownCost: bool, usage: int, cost: int,
    usageReceipts: List[int], costReceipts: List[int], ended: bool, succeeded: bool}
  action init = s' = {attempt:0,knownUsage:false,knownCost:false,usage:0,cost:0,
    usageReceipts:List(),costReceipts:List(),ended:false,succeeded:false}
  action attempt(hasUsage: bool, hasCost: bool, succeeds: bool): bool = all {
    not(s.ended),s.attempt < 3,
    s' = s.with("attempt",s.attempt + 1)
      .with("knownUsage",s.knownUsage or hasUsage)
      .with("knownCost",s.knownCost or hasCost)
      .with("usage",s.usage + (if(hasUsage) 1 else 0))
      .with("cost",s.cost + (if(hasCost) 1 else 0))
      .with("usageReceipts",if(hasUsage) s.usageReceipts.append(1) else s.usageReceipts)
      .with("costReceipts",if(hasCost) s.costReceipts.append(1) else s.costReceipts)
      .with("ended",succeeds or s.attempt == 2).with("succeeded",succeeds) }
  action stopFailed = all {not(s.ended),s.attempt > 0,s'=s.with("ended",true)}
  val completeUsage = s.usageReceipts.length() == s.attempt
  val completeCost = s.costReceipts.length() == s.attempt
  val visibleUsage = if(s.ended and s.knownUsage and (not(s.succeeded) or completeUsage)) s.usage else -1
  val visibleCost = if(s.ended and s.knownCost and (not(s.succeeded) or completeCost)) s.cost else -1
  action step = {
    nondet usage = Set(true,false).oneOf()
    nondet cost = Set(true,false).oneOf()
    nondet succeeds = Set(true,false).oneOf()
    any {attempt(usage,cost,succeeds),stopFailed,s'=s}
  }
  val invariant = all {s.attempt <= 3, s.usage <= s.attempt, s.cost <= s.attempt,
    s.usage == s.usageReceipts.length(),s.cost == s.costReceipts.length(),
    s.knownUsage iff s.usageReceipts.length() > 0,
    s.knownCost iff s.costReceipts.length() > 0,
    s.succeeded and visibleUsage >= 0 implies completeUsage,
    s.succeeded and visibleCost >= 0 implies completeCost,
    s.ended and not(s.succeeded) and s.knownUsage implies visibleUsage == s.usage,
    s.ended and not(s.succeeded) and s.knownCost implies visibleCost == s.cost}
  run missingFinalReceiptTest = init.then(attempt(true,true,false))
    .then(attempt(false,false,false)).then(attempt(false,false,false))
    .expect(s.ended and not(s.succeeded) and visibleUsage == 1 and visibleCost == 1)
  run unknownTest = init.then(attempt(false,false,true))
    .expect(s.ended and not(s.knownUsage) and not(s.knownCost) and visibleUsage == -1 and visibleCost == -1)
  run successAfterUnknownAttemptKeepsUnknownTotalTest = init.then(attempt(false,false,false))
    .then(attempt(true,true,true)).expect(s.succeeded and s.knownUsage and s.knownCost and visibleUsage == -1 and visibleCost == -1)
  run successWithAllReceiptsHasCompleteTotalTest = init.then(attempt(true,true,false))
    .then(attempt(true,true,true)).expect(s.succeeded and visibleUsage == 2 and visibleCost == 2)
  run failureWithKnownSubtotalEndsEarlyTest = init.then(attempt(true,true,false)).then(stopFailed)
    .expect(s.ended and visibleUsage == 1 and visibleCost == 1)
}
