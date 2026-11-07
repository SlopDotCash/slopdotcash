// @source src/lib/allocation-funding.ts
// @source src/lib/allocation-funding-basis.mjs
// @source src/lib/owner-commitment-actions.ts
// A pledge is not a spendable allocation; funding never increases the period cap.
module allocation_funding {
  type S = { state: str, committed: int, cap: int, projected: int }
  var s: S
  action init = s' = { state: "pledged", committed: 0, cap: 3, projected: 0 }
  action observe(committed: int, verified: bool): bool = s' = s.with("committed", committed)
    .with("state", if (verified) "committed" else "pledged").with("projected", 0)
  action project = s' = s.with("projected", if (s.state != "committed") 0 else if (s.committed < s.cap) s.committed else s.cap)
  action choose = { nondet amount = 0.to(5).oneOf() nondet verified = Set(true,false).oneOf() observe(amount,verified) }
  action step = any { choose, project, s' = s }
  val invariant = all { s.projected <= s.cap, s.projected <= s.committed,
    s.state != "committed" implies s.projected == 0 }
  run pledgeZeroTest = init.then(observe(5,false)).then(project).expect(s.projected == 0 and invariant)
  run capPreservedTest = init.then(observe(5,true)).then(project).expect(s.projected == 3 and invariant)
}
