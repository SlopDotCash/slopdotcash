// @source contracts/evm/vendor/openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol
// @source contracts/evm/vendor/openzeppelin/contracts/proxy/utils/Initializable.sol
// @source contracts/evm/vendor/openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol
// @source contracts/evm/vendor/openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol
// @source contracts/evm/vendor/openzeppelin/contracts/proxy/Proxy.sol
// @source contracts/evm/src/ProjectEscrow.sol
// @source contracts/evm/script/DeployEscrowFactory.sol
// @source contracts/evm/script/DeployBase.s.sol
// @source contracts/evm/script/DeployBaseSepolia.s.sol
// @source contracts/evm/script/DeployEthereum.s.sol
// @source contracts/evm/script/DeployEthereumSepolia.s.sol
// @source contracts/evm/script/DeployRobinhood.s.sol
// @source contracts/evm/script/DeployRobinhoodTestnet.s.sol
// @source contracts/evm/script/DeployUpgradeImplementations.s.sol
// Two implementation versions. External calls are atomic: a failed delegated
// initializer rolls back the implementation-slot write in the same transaction.
// Constructor-only repeat initialization and beacon/admin utility branches are
// unused by the application and not claimed by this UUPS instantiation.
module evm_proxy_lifecycle {
  var s: { phase: str, chain: bool, implementation: int, initialized: int,
    implementationLocked: bool, upgradeAuthority: int, vaultOwner: int, storedBalance: int }
  action init = s'={phase:"new",chain:false,implementation:0,initialized:0,
    implementationLocked:false,upgradeAuthority:0,vaultOwner:0,storedBalance:0}
  action deploy(chain, initializerOk) = all { s.phase=="new",chain,initializerOk,
    s'=s.with("phase","active").with("chain",true).with("implementation",1)
      .with("initialized",1).with("upgradeAuthority",1).with("vaultOwner",2).with("implementationLocked",true) }
  action credit = all {s.phase=="active",s.storedBalance<2,
    s'=s.with("storedBalance",s.storedBalance+1)}
  action upgrade(actor, delegated, activeTarget, code, uuid, initializerOk) = all {
    s.phase=="active",actor==s.upgradeAuthority,delegated,activeTarget,code,uuid,initializerOk,
    s'=s.with("implementation",2) }
  action initializeAgain = all {s.phase=="active",s.initialized==0,s'=s.with("initialized",1)}
  action step = { nondet actor=Set(1,2).oneOf()
    nondet a=Set(false,true).oneOf() nondet b=Set(false,true).oneOf()
    nondet c=Set(false,true).oneOf() nondet d=Set(false,true).oneOf()
    nondet e=Set(false,true).oneOf()
    any {deploy(a,b),credit,upgrade(actor,a,b,c,d,e),initializeAgain,s'=s} }
  val invariant = all {
    s.phase=="active" implies (s.chain and s.implementationLocked and s.upgradeAuthority==1 and s.vaultOwner==2),
    s.implementation==2 implies s.initialized==1,
    s.storedBalance>=0,s.storedBalance<=2,
  }
  run nonOwnerRefusedTest = init.then(deploy(true,true)).then(upgrade(2,true,true,true,true,true).fail())
  run directImplementationRefusedTest = init.then(deploy(true,true)).then(upgrade(1,false,true,true,true,true).fail())
  run failedInitializationRefusedTest = init.then(deploy(true,true)).then(credit)
    .then(upgrade(1,true,true,true,true,false).fail())
  run storageSurvivesUpgradeTest = init.then(deploy(true,true)).then(credit)
    .then(upgrade(1,true,true,true,true,true)).expect(s.implementation==2 and s.storedBalance==1 and invariant)
  run initializationCannotReplayTest = init.then(deploy(true,true)).then(initializeAgain.fail())
  run vaultOwnerCannotUpgradeTest = init.then(deploy(true,true)).then(upgrade(s.vaultOwner,true,true,true,true,true).fail())
}
