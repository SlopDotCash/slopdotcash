// @source workers/payment-executor/core.ts
// @source workers/payment-executor/binding-recovery.ts
// @source workers/payment-executor/index.ts
// @source workers/payment-executor/binding-shared.ts
// Only obsolete binding self-cancellation; original may win until canonical finality.
// binding-recovery.ts Outcome mapping: observeOriginal(true) is
// "original_finalized" (canonical receipt status 0x1; the stored attempt keeps
// its active binding pointer), observeOriginal(false) is "original_reverted"
// and observeCancellation is "superseded" (the inert same-nonce self-transfer
// won). Reconciliation clears the pointer for every outcome except
// original_finalized. `activeBinding` is true only when a finalized original
// made the binding live.
module binding_cancellation {
  type S={obsolete:bool,plainAccount:bool,gasAllowed:bool,journaled:bool,broadcast:bool,winner:str,held:bool,activeBinding:bool}
  var s:S
  action init=s'={obsolete:false,plainAccount:true,gasAllowed:true,journaled:false,broadcast:false,winner:"none",held:true,activeBinding:false}
  action expireOrSupersede=s'=s.with("obsolete",true)
  action codeAccount=s'=s.with("plainAccount",false)
  action costly=s'=s.with("gasAllowed",false)
  action prepare=all{s.obsolete,s.plainAccount,s.gasAllowed,not(s.journaled),s.winner=="none",s'=s.with("journaled",true)}
  action broadcast=all{s.journaled,s.plainAccount,s.winner=="none",s'=s.with("broadcast",true)}
  action observeOriginal(success:bool):bool=all{s.winner=="none",s'=s.with("winner","original").with("held",false).with("activeBinding",success)}
  action observeCancellation=all{s.winner=="none",s.broadcast,s'=s.with("winner","cancel").with("held",false).with("activeBinding",false)}
  action step=any{expireOrSupersede,codeAccount,costly,prepare,broadcast,observeOriginal(true),observeOriginal(false),observeCancellation,s'=s}
  val invariant=all{s.broadcast implies s.journaled,s.winner=="cancel" implies s.broadcast,s.winner=="none" implies s.held,
    s.winner=="cancel" implies not(s.activeBinding),s.winner=="none" implies not(s.activeBinding)}
  run originalWinsAfterCancelTest=init.then(expireOrSupersede).then(prepare).then(broadcast).then(observeOriginal(true)).expect(s.winner=="original" and s.activeBinding and invariant)
  run originalRevertedClearsPointerTest=init.then(expireOrSupersede).then(prepare).then(broadcast).then(observeOriginal(false)).expect(not(s.activeBinding) and s.winner=="original" and invariant)
  run supersededClearsPointerTest=init.then(expireOrSupersede).then(prepare).then(broadcast).then(observeCancellation).expect(not(s.activeBinding) and s.winner=="cancel" and invariant)
  run obsoleteOnlyTest=init.then(prepare.fail())
  run codeAccountRefusedTest=init.then(expireOrSupersede).then(codeAccount).then(prepare.fail())
  run noReceiptStillHeldTest=init.then(expireOrSupersede).then(prepare).then(broadcast).expect(s.held and not(s.activeBinding) and invariant)
}
