// @source src/lib/escrow-policy.mjs
// Deployment evidence and old implementation reviews survive policy revisions.
module escrow_policy_history {
  type S={deployed:bool,chain:int,fee:int,implementation:int,history:List[int],limit:int}
  var s:S
  action init=s'={deployed:false,chain:1,fee:2,implementation:1,history:List(),limit:3}
  action deploy=all{not(s.deployed),s'=s.with("deployed",true)}
  action changeChain(chain:int):bool=all{not(s.deployed),s'=s.with("chain",chain)}
  action upgrade(successor:int):bool=all{s.deployed,s.history.length()<2,successor!=s.implementation,
    s'=s.with("history",s.history.append(s.implementation)).with("implementation",successor)}
  action executionLimit(limit:int):bool=s'=s.with("limit",limit)
  action remove=all{not(s.deployed),s'=s}
  action step=any{deploy,changeChain(1),changeChain(2),upgrade(1),upgrade(2),upgrade(3),executionLimit(1),executionLimit(3),s'=s}
  val invariant=all{s.fee==2,s.history.length()<=2,s.limit>0}
  run deployedChainFixedTest=init.then(deploy).then(changeChain(2).fail())
  run upgradedHistoryTest=init.then(deploy).then(upgrade(2)).then(upgrade(3)).expect(s.history==List(1,2) and invariant)
  run offchainLimitDoesNotRewriteReviewTest=init.then(deploy).then(upgrade(2)).then(executionLimit(1)).expect(s.history==List(1) and invariant)
  run deploymentRemovalRefusedTest=init.then(deploy).then(remove.fail())
}
