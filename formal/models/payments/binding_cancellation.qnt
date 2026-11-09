// @source workers/payment-executor/core.ts
// @source workers/payment-executor/binding-recovery.ts
// @source workers/payment-executor/index.ts
// Only obsolete binding self-cancellation; original may win until canonical finality.
module binding_cancellation {
  type S={obsolete:bool,plainAccount:bool,gasAllowed:bool,journaled:bool,broadcast:bool,winner:str,held:bool}
  var s:S
  action init=s'={obsolete:false,plainAccount:true,gasAllowed:true,journaled:false,broadcast:false,winner:"none",held:true}
  action expireOrSupersede=s'=s.with("obsolete",true)
  action codeAccount=s'=s.with("plainAccount",false)
  action costly=s'=s.with("gasAllowed",false)
  action prepare=all{s.obsolete,s.plainAccount,s.gasAllowed,not(s.journaled),s.winner=="none",s'=s.with("journaled",true)}
  action broadcast=all{s.journaled,s.plainAccount,s.winner=="none",s'=s.with("broadcast",true)}
  action observeOriginal=all{s.winner=="none",s'=s.with("winner","original").with("held",false)}
  action observeCancellation=all{s.winner=="none",s.broadcast,s'=s.with("winner","cancel").with("held",false)}
  action step=any{expireOrSupersede,codeAccount,costly,prepare,broadcast,observeOriginal,observeCancellation,s'=s}
  val invariant=all{s.broadcast implies s.journaled,s.winner=="cancel" implies s.broadcast,s.winner=="none" implies s.held}
  run originalWinsAfterCancelTest=init.then(expireOrSupersede).then(prepare).then(broadcast).then(observeOriginal).expect(s.winner=="original" and invariant)
  run obsoleteOnlyTest=init.then(prepare.fail())
  run codeAccountRefusedTest=init.then(expireOrSupersede).then(codeAccount).then(prepare.fail())
  run noReceiptStillHeldTest=init.then(expireOrSupersede).then(prepare).then(broadcast).expect(s.held and invariant)
}
