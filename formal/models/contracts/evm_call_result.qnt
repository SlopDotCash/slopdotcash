// @source contracts/evm/vendor/openzeppelin/contracts/utils/Address.sol
// @source contracts/evm/vendor/openzeppelin/contracts/utils/LowLevelCall.sol
// Return-data and failure boundary of the used low-level EVM calls. External
// callee mutations and EVM rollback are contract/environment assumptions.
module evm_call_result {
  var s: {phase:str,success:bool,code:bool,data:bool,returned:bool,error:str}
  action init = s'={phase:"new",success:false,code:false,data:false,returned:false,error:"none"}
  action call(success,code,data) = all {s.phase=="new",
    s'=s.with("phase","called").with("success",success).with("code",code).with("data",data)}
  action check = all {s.phase=="called",s'=s.with("phase","complete")
    .with("returned",s.success and (s.code or s.data))
    .with("error",if(s.success and (s.code or s.data)) "none"
      else if(s.success) "empty-code" else if(s.data) "callee-revert" else "failed-call")}
  action step = {nondet a=Set(false,true).oneOf() nondet b=Set(false,true).oneOf()
    nondet c=Set(false,true).oneOf() any {call(a,b,c),check,s'=s}}
  val invariant = all {s.returned implies (s.success and (s.code or s.data)),
    s.error=="callee-revert" implies (not(s.success) and s.data)}
  run emptyCodeRefusedTest = init.then(call(true,false,false)).then(check).expect(s.error=="empty-code")
  run failedCalleeBubblesTest = init.then(call(false,true,true)).then(check).expect(s.error=="callee-revert")
  run precompileDataAcceptedTest = init.then(call(true,false,true)).then(check).expect(s.returned and invariant)
}
