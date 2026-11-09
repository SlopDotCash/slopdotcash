// @source contracts/evm/src/ProjectEscrow.sol
// @source contracts/evm/vendor/openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol
// @evidence contracts/evm/test/UpgradeLifecycle.t.sol
// @evidence contracts/evm/test/BoundedAttester.t.sol
// Post-initialization factory: six nonzero address identities, two compatible
// logic versions, two vaults, at most two upgrade-authority proposals.
// Initial roles are distinct as in DeployFactory; later registrar/upgrade or
// fee/identity overlap is permitted where the actual guards permit it.
// UUPS call/UUID and storage-compatible logic are external predicates. No
// timelock applies; identity proposal time is the current bounded block time.
module evm_factory_authority {
  var s:{upgrade:int,pendingUpgrade:int,identity:int,pendingIdentity:int,
    identityAt:int,now:int,template:int,factoryLogic:int,vaults:List[int],
    createdWith:List[int],proposals:List[int],accepted:List[int]}
  val registrar=2
  val fee=3
  action init=s'={upgrade:1,pendingUpgrade:0,identity:4,pendingIdentity:0,
    identityAt:0,now:0,template:1,factoryLogic:1,vaults:List(),createdWith:List(),
    proposals:List(),accepted:List()}
  action proposeUpgrade(actor:int,candidate:int):bool=all{actor==s.upgrade,s.proposals.length()<2,
    candidate>0,candidate<=6,candidate!=fee,candidate!=s.identity,candidate!=s.pendingIdentity,
    s'=s.with("pendingUpgrade",candidate).with("proposals",s.proposals.append(candidate))}
  action acceptUpgrade(actor:int):bool=all{actor>0,actor==s.pendingUpgrade,
    s'=s.with("upgrade",actor).with("pendingUpgrade",0).with("accepted",s.accepted.append(actor))}
  action proposeIdentity(actor:int,candidate:int):bool=all{actor==registrar,
    candidate>0,candidate<=6,candidate!=s.identity,candidate!=registrar,candidate!=s.upgrade,candidate!=s.pendingUpgrade,
    s.pendingIdentity==0,
    s'=s.with("pendingIdentity",candidate).with("identityAt",s.now)}
  action cancelIdentity(actor:int):bool=all{actor==registrar,s.pendingIdentity>0,
    s'=s.with("pendingIdentity",0).with("identityAt",0)}
  action executeIdentity(actor:int):bool=all{actor>0,actor<=6,s.pendingIdentity>0,s.now>=s.identityAt,
    s'=s.with("identity",s.pendingIdentity).with("pendingIdentity",0).with("identityAt",0)}
  action tick=all{s.now<1,s'=s.with("now",s.now+1)}
  action setTemplate(actor:int,candidate:int,callOk:bool,uuidOk:bool):bool=all{
    actor==s.upgrade,Set(1,2).contains(candidate),callOk,uuidOk,s'=s.with("template",candidate)}
  action createVault=all{s.vaults.length()<2,
    s'=s.with("vaults",s.vaults.append(s.template)).with("createdWith",s.createdWith.append(s.template))}
  action upgradeVault(actor:int,index:int,compatible:bool):bool=all{actor==s.upgrade,
    index>=0,index<s.vaults.length(),compatible,s'=s.with("vaults",s.vaults.replaceAt(index,2))}
  action upgradeFactory(actor:int,compatible:bool):bool=all{actor==s.upgrade,compatible,
    s'=s.with("factoryLogic",2)}
  action chooseAuthorityAction={nondet actor=1.to(6).oneOf() nondet candidate=0.to(6).oneOf()
    any{proposeUpgrade(actor,candidate),acceptUpgrade(actor),proposeIdentity(actor,candidate),cancelIdentity(actor),executeIdentity(actor)}}
  action chooseLogicAction={nondet actor=1.to(6).oneOf()
    any{setTemplate(actor,1,true,true),setTemplate(actor,2,true,true),
      upgradeVault(actor,0,true),upgradeVault(actor,1,true),upgradeFactory(actor,true)}}
  action step=any{chooseAuthorityAction,chooseLogicAction,createVault,tick,s'=s}
  val invariant=all{
    s.upgrade>0,s.upgrade!=fee,s.upgrade!=s.identity,
    s.pendingUpgrade>0 implies(s.pendingUpgrade!=fee and s.pendingUpgrade!=s.identity and s.pendingUpgrade!=s.pendingIdentity),
    s.pendingIdentity>0 implies(s.pendingIdentity!=registrar and s.pendingIdentity!=s.identity and s.pendingIdentity!=s.upgrade),
    s.proposals.length()<=2,s.accepted.length()<=s.proposals.length(),
    s.accepted.length()>0 implies s.upgrade==s.accepted[s.accepted.length()-1],
    s.vaults.length()<=2,s.vaults.length()==s.createdWith.length(),
    s.vaults.indices().forall(i=>Set(1,2).contains(s.vaults[i])),
    s.createdWith.indices().forall(i=>Set(1,2).contains(s.createdWith[i]))}
  run proposedRecipientHasNoPowerBeforeAcceptTest=init.then(proposeUpgrade(1,5))
    .then(setTemplate(5,2,true,true).fail())
  run acceptedRecipientRevokesOldFactoryPowerTest=init.then(createVault).then(proposeUpgrade(1,5)).then(acceptUpgrade(5))
    .then(upgradeFactory(1,true).fail())
  run acceptedRecipientRevokesOldVaultPowerTest=init.then(createVault).then(proposeUpgrade(1,5)).then(acceptUpgrade(5))
    .then(upgradeVault(1,0,true).fail())
  run acceptedRecipientRevokesOldTemplatePowerTest=init.then(proposeUpgrade(1,5)).then(acceptUpgrade(5))
    .then(setTemplate(1,2,true,true).fail())
  run onlyCurrentUpgradeAuthorityCanProposeTest=init.then(proposeUpgrade(6,5).fail())
  run acceptedRecipientCanUpgradeFactoryAndExistingVaultTest=init.then(createVault).then(proposeUpgrade(1,5)).then(acceptUpgrade(5))
    .then(upgradeFactory(5,true)).then(upgradeVault(5,0,true)).expect(s.factoryLogic==2 and s.vaults==List(2))
  run replacedProposalRevokesFormerCandidateTest=init.then(proposeUpgrade(1,5)).then(proposeUpgrade(1,6))
    .expect(s.pendingUpgrade==6 and s.proposals==List(5,6)).then(acceptUpgrade(5).fail())
  run lastProposalAcceptsImmediatelyTest=init.then(proposeUpgrade(1,5)).then(proposeUpgrade(1,6)).then(acceptUpgrade(6))
    .expect(s.upgrade==6 and s.pendingUpgrade==0 and s.now==0)
  run zeroUpgradeCandidateRefusedTest=init.then(proposeUpgrade(1,0).fail())
  run feeUpgradeCandidateRefusedTest=init.then(proposeUpgrade(1,3).fail())
  run identityUpgradeCandidateRefusedTest=init.then(proposeUpgrade(1,4).fail())
  run pendingIdentityExcludedFromUpgradeProposalTest=init.then(proposeIdentity(2,5)).then(proposeUpgrade(1,5).fail())
  run pendingUpgradeExcludedFromIdentityProposalTest=init.then(proposeUpgrade(1,5)).then(proposeIdentity(2,5).fail())
  run currentUpgradeCannotBecomeIdentityTest=init.then(proposeIdentity(2,1).fail())
  run identityRotationCannotReplacePendingProposalTest=init.then(proposeIdentity(2,5)).then(proposeIdentity(2,6).fail())
  run cancelledIdentityReleasesCandidateForUpgradeTest=init.then(proposeIdentity(2,5)).then(cancelIdentity(2))
    .then(proposeUpgrade(1,5)).then(acceptUpgrade(5)).expect(s.upgrade==5 and s.identity==4)
  run anyoneExecutesIdentityAtSameBlockTimeTest=init.then(proposeIdentity(2,5)).then(executeIdentity(6))
    .expect(s.identity==5 and s.pendingIdentity==0 and s.now==0)
  run concurrentDifferentRoleProposalsRemainSeparatedTest=init.then(proposeIdentity(2,5)).then(proposeUpgrade(1,6))
    .then(acceptUpgrade(6)).then(executeIdentity(3)).expect(s.upgrade==6 and s.identity==5 and invariant)
  run currentAuthorityCanReplaceTemplateDuringIdentityProposalTest=init.then(createVault).then(proposeIdentity(2,5))
    .then(setTemplate(1,2,true,true)).then(createVault).expect(s.vaults==List(1,2) and s.createdWith==List(1,2))
  run badImplementationCallDoesNotSetTemplateTest=init.then(setTemplate(1,2,false,true).fail())
  run badImplementationUuidDoesNotSetTemplateTest=init.then(setTemplate(1,2,true,false).fail())
  run templateChangeDoesNotUpgradeExistingVaultTest=init.then(createVault).then(setTemplate(1,2,true,true))
    .expect(s.template==2 and s.vaults==List(1)).then(createVault).expect(s.vaults==List(1,2))
  run selfAndRegistrarUpgradeProposalsArePermittedTest=init.then(proposeUpgrade(1,1)).then(acceptUpgrade(1))
    .then(proposeUpgrade(1,2)).then(acceptUpgrade(2)).expect(s.upgrade==registrar and invariant)
  run identityCandidateMayBeFeeRecipientTest=init.then(proposeIdentity(2,3)).then(executeIdentity(6))
    .expect(s.identity==fee and s.upgrade!=fee)
}
