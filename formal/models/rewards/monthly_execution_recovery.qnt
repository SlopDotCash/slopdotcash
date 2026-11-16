// @source migrations/0073_monthly_authorizations.sql
// @source migrations/0083_monthly_execution_attempts.sql
// @source scripts/payment-keeper/keeper.ts
// @source workers/payment-executor/monthly.ts
// @source workers/payment-executor/core.ts
// @source workers/payment-executor/solana-monthly.ts
// @source workers/payment-executor/solana.ts
// New execution attempts cannot alter the frozen allocation. Any retained attempt may win admission.
module monthly_execution_recovery {
  type S={frozenRoot:int,sequence:int,attempts:Set[int],admitted:int,leafDone:bool,enabled:bool}
  var s:S
  action init=s'={frozenRoot:1,sequence:0,attempts:Set(),admitted:0,leafDone:false,enabled:true}
  action publish(root:int):bool=all{s.admitted==0,root==s.frozenRoot,s.sequence<2,
    s'=s.with("sequence",s.sequence+1).with("attempts",s.attempts.union(Set(s.sequence+1)))}
  action admit(attempt:int):bool=all{s.admitted==0,s.enabled,s.attempts.contains(attempt),s'=s.with("admitted",attempt)}
  action disable=s'=s.with("enabled",false)
  action materialize=all{s.admitted>0,s'=s.with("leafDone",true)}
  action step=any{publish(1),admit(1),admit(2),disable,materialize,s'=s}
  val invariant=all{s.frozenRoot==1,s.admitted>0 implies s.attempts.contains(s.admitted),s.leafDone implies s.admitted>0}
  run oldAttemptWinsTest=init.then(publish(1)).then(publish(1)).then(admit(1)).then(disable).then(materialize).expect(invariant)
  run rootMutationRejectedTest=init.then(publish(1)).then(publish(2).fail())
  run alreadyAdmittedNoReplacementTest=init.then(publish(1)).then(admit(1)).then(publish(1).fail())
}
