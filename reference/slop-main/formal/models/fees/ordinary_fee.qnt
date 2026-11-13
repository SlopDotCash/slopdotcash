// @source src/lib/payments/contracts.ts
// Exact ordinary fee formula including its splitting and legacy-history boundaries.
module ordinary_fee {
  var a: int
  var b: int
  pure def fee(n: int): int = (n+49)/50
  action init = all { a' = 1, b' = 1 }
  action step = { nondet x = 1.to(100).oneOf() nondet y = 1.to(100).oneOf()
    all { a' = x, b' = y } }
  val invariant = all { fee(a) >= 1, fee(a) <= a, fee(a)+fee(b) >= fee(a+b),
    fee(a) == a/50 or fee(a) == a/50+1 }
  run oneUnitTest = init.expect(fee(a)==1 and invariant)
  run boundaryTest = init.then(all { a'=50,b'=51 }).expect(fee(a)==1 and fee(b)==2 and invariant)
}
