// @source workers/payment-executor/assert-fresh-test-stack.mjs
// Existence, authentication failure, wrong resource, and network failure all
// refuse mutation. Only the exact account/name 10007 absence response qualifies.
module fresh_stack_admission {
  type S = { namesValid: bool, accountValid: bool, checked: int, refused: bool, admitted: bool }
  var s: S
  action init = s' = { namesValid: false, accountValid: false, checked: 0, refused: false, admitted: false }
  action inputs(names: bool, account: bool): bool = all { s.checked == 0,
    s' = s.with("namesValid", names).with("accountValid", account) }
  action inspect(present: bool, exactAbsent: bool): bool = all { s.namesValid, s.accountValid, s.checked < 3, not(s.refused),
    s' = if(not(present) and exactAbsent) s.with("checked", s.checked + 1) else s.with("refused", true) }
  action admit = all { s.checked == 3, not(s.refused), s' = s.with("admitted", true) }
  action step = any { inputs(true,true),inputs(false,true),inputs(true,false),inspect(false,true),inspect(true,false),inspect(false,false),admit,s'=s }
  val invariant = s.admitted implies s.checked == 3 and s.namesValid and s.accountValid and not(s.refused)
  run noReapplyToExistingTest = init.then(inputs(true,true)).then(inspect(true,false)).then(admit.fail())
  run authenticationNotAbsenceTest = init.then(inputs(true,true)).then(inspect(false,false)).then(admit.fail())
  run allThreeAbsentTest = init.then(inputs(true,true)).then(inspect(false,true)).then(inspect(false,true)).then(inspect(false,true)).then(admit).expect(invariant)
}
