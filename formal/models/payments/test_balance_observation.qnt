// @source scripts/check-payout-test-funding.mjs
// A read-only test-network observation is not funding authority or permission
// to sign. Exact finalized balance is reportable only after network identity.
module test_balance_observation {
  type S = { input: bool, identity: bool, finalized: bool, exact: bool, amount: int, reported: bool, signed: bool }
  var s: S
  action init = s' = { input: false, identity: false, finalized: false, exact: false, amount: 0, reported: false, signed: false }
  action input = s' = s.with("input", true)
  action identify(matches: bool): bool = all { s.input, matches, s' = s.with("identity", true) }
  action read(finalized: bool, exact: bool, amount: int): bool = all { s.identity,not(s.reported),
    s'=s.with("finalized",finalized).with("exact",exact).with("amount",amount) }
  action report = all { s.finalized,s.exact,s'=s.with("reported",true) }
  action step = any { input,identify(true),read(true,true,0),read(true,true,2),read(true,false,2),report,s'=s }
  val invariant = all { not(s.signed),s.reported implies s.identity and s.finalized and s.exact }
  run wrongNetworkRefusedTest = init.then(input).then(identify(false).fail())
  run impreciseNumberRefusedTest = init.then(input).then(identify(true)).then(read(true,false,2)).then(report.fail())
  run zeroIsValidObservationTest = init.then(input).then(identify(true)).then(read(true,true,0)).then(report).expect(s.amount==0 and invariant)
}
