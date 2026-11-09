// @source src/OwnerBountyVault.tsx
// @source src/ProjectSecuritySettings.tsx
// @source src/App.tsx
// @source src/lib/project-api.ts
// @source src/VaultActions.tsx
// @source backend/projects/handler.ts
// @source backend/security/program-funds.ts
// @source src/lib/escrow-policy.mjs
// @source src/lib/security-bounty.mjs
// @evidence tests/e2e/vault-actions.spec.ts
// @evidence tests/e2e/solana-vault-actions.spec.ts
// Parent projection only: two project/actor identities, two deployment keys,
// three private reads. An existing deployment is immutable; a revision may
// append a second network without replacing the first keyed child. Wallet
// child memory abstracts each pending/finalized UI;
// no balance response grants signing authority or proves a transaction.
// App project keys and SecuritySettingsEditor project:actor keys remount the
// owner subtree. The compact page also unmounts it during maintainer recheck.
// Pre/post session observations and detached callbacks: ui_owner_private_requests.
module ui_owner_bounty_funds {
  var s:{project:int,actor:int,gate:bool,deployed:bool,status:str,
    reads:int,active:int,pending:Set[int],balance:int,balanceKey:int,
    canSetup:bool,stale:bool,childEpoch:int,childMemory:int,deploymentCount:int,extraEpoch:int,extraMemory:int}
  action init=s'={project:1,actor:1,gate:false,deployed:true,status:"absent",
    reads:0,active:0,pending:Set(),balance:0,balanceKey:0,
    canSetup:false,stale:false,childEpoch:0,childMemory:0,deploymentCount:1,extraEpoch:0,extraMemory:0}
  val identity=s.project*10+s.actor
  val childMounted=s.gate and s.deployed and s.status=="ready"
  val extraMounted=childMounted and s.deploymentCount==2
  val depositAllowed=childMounted and s.canSetup
  val withdrawalPresented=childMounted
  action allowOwner=all{not(s.gate),s.deployed,
    s'=s.with("gate",true).with("status","loading")}
  // Ordinary rerender/effect refresh retains the same-key wallet child.
  // Cleanup invalidates the old request; its later completion is ignored.
  action refresh=all{s.gate,s.deployed,s.reads<3,
    s'=s.with("reads",s.reads+1).with("active",s.reads+1)
      .with("pending",s.pending.union(Set(s.reads+1)))
      .with("status",if(s.status=="ready")"ready" else "loading")}
  action success(id:int,funds:int,setup:bool):bool=all{s.pending.contains(id),
    s'=if(id==s.active and s.gate and s.deployed)
      s.with("pending",s.pending.exclude(Set(id))).with("active",0).with("status","ready")
        .with("balance",funds).with("balanceKey",identity).with("canSetup",setup).with("stale",false)
        .with("childEpoch",if(childMounted)s.childEpoch else s.childEpoch+1)
        .with("childMemory",if(childMounted)s.childMemory else 0)
        .with("extraEpoch",if(s.deploymentCount==2 and not(childMounted))s.extraEpoch+1 else s.extraEpoch)
        .with("extraMemory",if(extraMounted)s.extraMemory else 0)
      else s.with("pending",s.pending.exclude(Set(id)))}
  action failure(id:int,temporary:bool):bool=all{s.pending.contains(id),
    s'=if(id==s.active and s.gate and s.deployed)
      (if(temporary and s.status=="ready")
        s.with("pending",s.pending.exclude(Set(id))).with("active",0).with("canSetup",false).with("stale",true)
      else s.with("pending",s.pending.exclude(Set(id))).with("active",0).with("status","error")
        .with("balance",0).with("balanceKey",0).with("canSetup",false).with("stale",false).with("childMemory",0).with("extraMemory",0))
      else s.with("pending",s.pending.exclude(Set(id)))}
  action authorityRecheck=s'=s.with("gate",false).with("status","absent").with("active",0)
    .with("balance",0).with("balanceKey",0).with("canSetup",false).with("stale",false).with("childMemory",0).with("extraMemory",0)
  action identityChanges(project:int,actor:int):bool=all{project!=s.project or actor!=s.actor,
    s'=s.with("project",project).with("actor",actor).with("gate",false).with("status","absent").with("active",0)
      .with("balance",0).with("balanceKey",0).with("canSetup",false).with("stale",false).with("childMemory",0).with("extraMemory",0)}
  // Historical network/vault identities cannot be replaced by a valid revision.
  // Appending another network mounts only its fresh keyed child. The aggregate
  // last verified balance/capability remain cached until the new read returns.
  action appendDeployment=all{s.deploymentCount==1,s.deployed,
    s'=s.with("deploymentCount",2).with("extraEpoch",if(childMounted)s.extraEpoch+1 else s.extraEpoch)
      .with("extraMemory",0)}
  // Leaving the owner funding route unmounts it; this is not permission to
  // remove a historical deployment from a valid manifest.
  action leaveFundingView=all{s.deployed,
    s'=s.with("deployed",false).with("status","absent").with("active",0).with("balance",0)
      .with("balanceKey",0).with("canSetup",false).with("stale",false).with("childMemory",0).with("extraMemory",0)}
  action walletPending=all{depositAllowed,s'=s.with("childMemory",1)}
  action walletFinalized=all{childMounted,s.childMemory==1,s'=s.with("childMemory",2)}
  action extraWalletPending=all{extraMounted,s.canSetup,s'=s.with("extraMemory",1)}
  action extraWalletFinalized=all{extraMounted,s.extraMemory==1,s'=s.with("extraMemory",2)}
  action step={nondet id=Set(1,2,3).oneOf() nondet funds=Set(0,1).oneOf() nondet setup=Set(true,false).oneOf()
    any{allowOwner,refresh,success(id,funds,setup),failure(id,true),failure(id,false),authorityRecheck,
      identityChanges(1,1),identityChanges(1,2),identityChanges(2,1),identityChanges(2,2),appendDeployment,
      leaveFundingView,walletPending,walletFinalized,extraWalletPending,extraWalletFinalized,s'=s}}
  val invariant=all{s.reads<=3,s.childEpoch<=4,s.extraEpoch<=4,
    s.deploymentCount>=1,s.deploymentCount<=2,
    s.extraMemory>0 implies extraMounted,
    s.balance>0 implies(childMounted and s.balanceKey==identity),
    s.childMemory>0 implies childMounted,
    s.stale implies(childMounted and not(s.canSetup)),
    s.status=="error" implies(not(childMounted) and s.balance==0),
    not(s.gate) implies(not(childMounted) and s.balance==0 and s.childMemory==0 and s.extraMemory==0),
    depositAllowed implies withdrawalPresented}
  run initialPrivateReadFailureDoesNotInventBalanceTest=init.then(allowOwner).then(refresh).then(failure(1,true))
    .expect(s.status=="error" and s.balance==0 and not(childMounted))
  run nullBalanceStillMountsExistingWalletTest=init.then(allowOwner).then(refresh).then(success(1,0,true))
    .expect(childMounted and depositAllowed and s.balance==0 and not(s.stale))
  run temporaryNullBalanceKeepsVaultInformationTest=init.then(allowOwner).then(refresh).then(success(1,0,true))
    .then(refresh).then(failure(2,true)).expect(childMounted and s.balance==0 and s.stale and not(depositAllowed))
  run temporaryRefreshKeepsPendingChildAndDisablesDepositsTest=init.then(allowOwner).then(refresh).then(success(1,1,true))
    .then(walletPending).then(refresh).then(failure(2,true))
    .expect(s.balance==1 and s.childMemory==1 and s.stale and not(depositAllowed) and withdrawalPresented)
  run successfulRefreshRestoresWithoutRemountingTest=init.then(allowOwner).then(refresh).then(success(1,1,true))
    .then(walletPending).then(walletFinalized).then(refresh).then(failure(2,true)).then(refresh).then(success(3,1,true))
    .expect(s.childEpoch==1 and s.childMemory==2 and depositAllowed and not(s.stale))
  run authorityRefusalClearsPrivateStateTest=init.then(allowOwner).then(refresh).then(success(1,1,true))
    .then(walletPending).then(refresh).then(failure(2,false))
    .expect(s.status=="error" and s.balance==0 and s.childMemory==0 and not(withdrawalPresented))
  run projectKeyChangeRejectsOldPrivateResponseTest=init.then(allowOwner).then(refresh).then(identityChanges(2,1))
    .then(allowOwner).then(refresh).then(success(1,1,true))
    .expect(s.status=="loading" and s.balance==0).then(success(2,1,true)).expect(s.balanceKey==21)
  run actorKeyChangeDropsPriorWalletMemoryTest=init.then(allowOwner).then(refresh).then(success(1,1,true))
    .then(walletPending).then(identityChanges(1,2)).expect(not(childMounted) and s.childMemory==0 and s.balance==0)
  run newerRefreshWinsOverLateOldCompletionTest=init.then(allowOwner).then(refresh).then(refresh).then(success(2,0,false))
    .then(success(1,1,true)).expect(s.balance==0 and not(depositAllowed) and withdrawalPresented)
  run maintainerRecheckUnmountsUntilConfirmedTest=init.then(allowOwner).then(refresh).then(success(1,1,true))
    .then(walletPending).then(authorityRecheck).expect(not(childMounted)).then(allowOwner).then(refresh).then(success(2,1,true))
    .expect(s.childEpoch==2 and s.childMemory==0)
  run appendedDeploymentKeepsExistingWalletChildTest=init.then(allowOwner).then(refresh).then(success(1,1,true))
    .then(walletPending).then(appendDeployment)
    .expect(s.childEpoch==1 and s.childMemory==1 and extraMounted and s.extraEpoch==1 and s.extraMemory==0 and s.balance==1)
  run appendedDeploymentBeforeReadMountsBothChildrenTest=init.then(allowOwner).then(refresh).then(appendDeployment)
    .expect(not(childMounted) and not(extraMounted)).then(success(1,1,true))
    .expect(s.childEpoch==1 and s.extraEpoch==1 and extraMounted)
  run sameProjectRefreshKeepsTimestampedBalanceAndCapabilityTest=init.then(allowOwner).then(refresh).then(success(1,1,true))
    .then(walletPending).then(appendDeployment).then(extraWalletPending).then(refresh)
    .expect(s.balance==1 and depositAllowed and not(s.stale) and s.childMemory==1 and s.extraMemory==1)
  run appendedWalletMemoryClearsWithAuthorityRefusalTest=init.then(allowOwner).then(refresh).then(success(1,1,true))
    .then(appendDeployment).then(extraWalletPending).then(refresh).then(failure(2,false))
    .expect(s.childMemory==0 and s.extraMemory==0 and not(extraMounted))
  run leavingFundingViewUnmountsPrivateViewTest=init.then(allowOwner).then(refresh).then(success(1,1,true))
    .then(leaveFundingView).expect(not(childMounted) and s.balance==0)
}
