// @source src/lib/funding-review-data.ts
// @source src/lib/project-view.ts
// @source src/lib/contribution-quality.ts
// Integer largest remainder for two contributors, total0..5 and weights1..3.
module monthly_allocation {
  type S = { total: int, aWeight: int, bWeight: int, a: int, b: int, phase: str }
  var s: S
  action init = s' = { total: 0, aWeight: 1, bWeight: 1, a: 0, b: 0, phase: "choose" }
  action choose(total: int, aWeight: int, bWeight: int): bool = all { s.phase == "choose",
    s' = s.with("total", total).with("aWeight", aWeight).with("bWeight", bWeight).with("phase", "floor") }
  action floorShares = all { s.phase == "floor",
    s' = s.with("a", (s.total*s.aWeight)/(s.aWeight+s.bWeight)).with("b",(s.total*s.bWeight)/(s.aWeight+s.bWeight)).with("phase","remainder") }
  action remainder = all { s.phase == "remainder",
    val left = s.total-s.a-s.b
    s' = if ((s.total*s.aWeight)%(s.aWeight+s.bWeight) >= (s.total*s.bWeight)%(s.aWeight+s.bWeight))
      s.with("a",s.a+left).with("phase","done") else s.with("b",s.b+left).with("phase","done") }
  action chooseAny = { nondet total = 0.to(5).oneOf() nondet a = 1.to(3).oneOf() nondet b = 1.to(3).oneOf() choose(total,a,b) }
  action allocate = chooseAny.then(floorShares).then(remainder)
  action step = any { chooseAny, floorShares, remainder, s' = s }
  val invariant = all { s.a >= 0, s.b >= 0, s.a+s.b <= s.total, s.phase == "done" implies s.a+s.b == s.total }
  run conservedTest = init.then(choose(5,1,2)).then(floorShares).then(remainder).expect(s.a==2 and s.b==3 and invariant)
  run tieTest = init.then(choose(1,1,1)).then(floorShares).then(remainder).expect(s.a==1 and s.b==0 and invariant)
  run sampledAllocationTest = init.then(chooseAny).then(floorShares).then(remainder).expect(invariant)
}
