// @source workers/fee-converter/index.ts
// @source workers/fee-converter/wrangler.toml
// @source workers/fee-converter/wrangler.staging.toml
// @source workers/operator-keeper/wrangler.toml
// @source workers/payment-executor/entrypoint.ts
// @source workers/payment-executor/signer-stacks.mjs
// @source workers/payments/deployments.ts
// @source workers/payments/registry-database.mjs
// @source workers/referral-accrual/wrangler.toml
// Independent-network orchestration and explicit configuration/role gates.
module payment_worker_run {
  type S={mode:str,configured:bool,roleAllowed:bool,first:str,second:str,running:bool,reported:bool}
  var s:S
  action init=s'={mode:"off",configured:false,roleAllowed:false,first:"idle",second:"idle",running:false,reported:false}
  action configure(mode:str,valid:bool,role:bool):bool=all{not(s.running),not(s.reported),s'=s.with("mode",mode).with("configured",valid).with("roleAllowed",role)}
  action begin=all{s.mode!="off",s.configured,s.roleAllowed,s'=s.with("running",true)}
  action first(ok:bool):bool=all{s.running,s.first=="idle",s'=s.with("first",if(ok) "done" else "failed")}
  action second(ok:bool):bool=all{s.running,s.second=="idle",s'=s.with("second",if(ok) "done" else "failed")}
  action report=all{s.first!="idle",s.second!="idle",s'=s.with("reported",true).with("running",false)}
  action step=any{configure("off",false,false),configure("dry_run",true,true),configure("execute",true,true),configure("execute",false,true),configure("execute",true,false),begin,first(true),first(false),second(true),second(false),report,s'=s}
  val invariant=s.reported implies(s.first!="idle" and s.second!="idle")
  run offInertTest=init.then(begin.fail())
  run roleRefusedTest=init.then(configure("execute",true,false)).then(begin.fail())
  run isolatedFailureTest=init.then(configure("execute",true,true)).then(begin).then(first(false)).then(second(true)).then(report).expect(s.second=="done" and s.first=="failed" and invariant)
}
