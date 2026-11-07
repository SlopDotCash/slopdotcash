// @source scripts/sync-cycle-index.ts
// The promotion module is written before staging the public directory. The
// destination is removed before rename; a failed rename can leave it absent.
// Check-only validates source/promotion, not existence of the public tree.
module cycle_snapshot_publication {
  var s: {phase:str,promotion:int,tree:str,temporary:bool,checkPassed:bool,success:bool}
  action init = s'={phase:"source",promotion:1,tree:"old",temporary:false,checkPassed:false,success:false}
  action validateSources = all {s.phase=="source",s'=s.with("phase","validated")}
  action writePromotion = all {s.phase=="validated",s'=s.with("phase","staging").with("promotion",2)}
  action stageTree = all {s.phase=="staging",s'=s.with("phase","staged").with("temporary",true)}
  action removeOld = all {s.phase=="staged",s'=s.with("phase","removed").with("tree","absent")}
  action activate = all {s.phase=="removed",s.temporary,s'=s.with("phase","done").with("tree","new").with("temporary",false).with("success",true)}
  action failWrite = all {Set("staging","staged","removed").contains(s.phase),s'=s.with("phase","failed").with("temporary",false)}
  action checkOnly = all {s.promotion==2,s'=s.with("checkPassed",true)}
  action step = any {validateSources,writePromotion,stageTree,removeOld,activate,failWrite,checkOnly,s'=s}
  val invariant = all {s.success implies(s.tree=="new" and s.promotion==2),
    s.phase=="failed" implies not(s.success) and not(s.temporary)}
  run successfulTreeSwapTest = init.then(validateSources).then(writePromotion).then(stageTree).then(removeOld).then(activate).expect(s.success)
  run failedRenameCanRemoveOldTreeTest = init.then(validateSources).then(writePromotion).then(stageTree).then(removeOld).then(failWrite).expect(s.tree=="absent" and not(s.success))
  run checkOnlyDoesNotAttestPublicTreeTest = init.then(validateSources).then(writePromotion).then(stageTree).then(removeOld).then(failWrite).then(checkOnly).expect(s.checkPassed and s.tree=="absent")
}
