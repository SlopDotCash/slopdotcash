// @source scripts/payment-keeper/run.ts
// @source scripts/payment-keeper/signer.ts
// @source scripts/payment-keeper/store.ts
// @source workers/operator-keeper/index.ts
// @source workers/operator-keeper/storage.ts
// @source scripts/payment-keeper/keeper.ts
// @source scripts/payment-keeper/budget.ts
// @source scripts/payment-keeper/storage.ts
// One Durable Object coalesces ticks; persistent journal survives instance restart.
module operator_keeper {
  type S = {mode: str,running:bool,requests:int,rows:int,pending:bool,finalized:bool}
  var s:S
  action init=s'={mode:"off",running:false,requests:0,rows:0,pending:false,finalized:false}
  action configure(mode:str):bool=all{not(s.running),s'=s.with("mode",mode)}
  action tick=all{s.requests<3,s'=s.with("requests",s.requests+1).with("running",s.mode!="off")}
  action journal=all{s.running,s.mode=="execute",s.rows==0,s'=s.with("rows",1).with("pending",true)}
  action restart=s'=s.with("running",false)
  action finality=all{s.pending,s'=s.with("pending",false).with("finalized",true)}
  action step=any{configure("off"),configure("dry_run"),configure("execute"),tick,journal,restart,finality,s'=s}
  val invariant=all{s.rows<=1,s.pending implies s.rows==1,s.finalized implies s.rows==1}
  run offNoWorkTest=init.then(tick).expect(not(s.running) and s.rows==0 and invariant)
  run dryRunNoSignTest=init.then(configure("dry_run")).then(tick).then(journal.fail())
  run restartRetainsLiabilityTest=init.then(configure("execute")).then(tick).then(journal).then(restart).expect(s.pending and invariant)
  run overlapNoSecondJournalTest=init.then(configure("execute")).then(tick).then(journal).then(tick).then(journal.fail())
}
