// @source workers/fee-converter/core.ts
// @source workers/fee-converter/config.ts
// @source workers/fee-converter/jupiter-route.ts
// Finite quote-policy truth table; chain quote authenticity is a separate boundary.
module fee_quote_policy {
  type S = { state: str, capacity: bool, priced: bool, dust: bool, gas: bool,
    impact: bool, slippage: bool }
  var s: S
  action init = s' = { state: "new", capacity: false, priced: false, dust: false, gas: false, impact: false, slippage: false }
  action quote(capacity: bool, priced: bool, dust: bool, gas: bool, impact: bool, slippage: bool): bool =
    s' = { state: "quoted", capacity: capacity, priced: priced, dust: dust, gas: gas, impact: impact, slippage: slippage }
  action decide = all { s.state == "quoted",
    s' = s.with("state", if (not(s.capacity) or not(s.priced)) "skipped"
      else if (not(s.dust) or not(s.gas)) "pending"
      else if (not(s.impact) or not(s.slippage)) "skipped" else "ready") }
  action chooseQuote = { nondet a = Set(true,false).oneOf()
    nondet b = Set(true,false).oneOf()
    nondet c = Set(true,false).oneOf()
    nondet d = Set(true,false).oneOf()
    nondet e = Set(true,false).oneOf()
    nondet f = Set(true,false).oneOf()
    quote(a,b,c,d,e,f) }
  action step = any { chooseQuote, decide, s' = s }
  val invariant = s.state == "ready" implies all { s.capacity,s.priced,s.dust,s.gas,s.impact,s.slippage }
  run routeRefusedTest = init.then(quote(true,true,true,true,false,true)).then(decide).expect(s.state == "skipped" and invariant)
  run dustPendingTest = init.then(quote(true,true,false,true,true,true)).then(decide).expect(s.state == "pending" and invariant)
  run acceptableTest = init.then(quote(true,true,true,true,true,true)).then(decide).expect(s.state == "ready" and invariant)
}
