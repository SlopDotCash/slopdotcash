// @source .github/workflows/unsafe-destination-transitions.yml
// @source scripts/check-unsafe-destination-transitions.ts
// pull_request_target executes immutable base code and reads only proposal Git
// objects. A moved head or altered accepted history cannot become a green gate.
module trusted_base_gate {
  var s: {phase:str,baseExact:bool,headExact:bool,historyPreserved:bool,
    proposalExecuted:bool,passed:bool}
  action init = s'={phase:"new",baseExact:false,headExact:false,historyPreserved:false,
    proposalExecuted:false,passed:false}
  action checkout(exact) = all {s.phase=="new",exact,s'=s.with("phase","base").with("baseExact",true)}
  action fetchHead(exact) = all {s.phase=="base",exact,s'=s.with("phase","read").with("headExact",true)}
  action check(history) = all {s.phase=="read",history,s'=s.with("phase","passed")
    .with("historyPreserved",true).with("passed",true)}
  action step = {nondet a=Set(false,true).oneOf() any {checkout(a),fetchHead(a),check(a),s'=s}}
  val invariant = all {not(s.proposalExecuted),s.passed implies(s.baseExact and s.headExact and s.historyPreserved)}
  run movedHeadRefusedTest = init.then(checkout(true)).then(fetchHead(false).fail())
  run rewrittenHistoryRefusedTest = init.then(checkout(true)).then(fetchHead(true)).then(check(false).fail())
  run preservedHistoryPassesTest = init.then(checkout(true)).then(fetchHead(true)).then(check(true)).expect(s.passed and invariant)
}
