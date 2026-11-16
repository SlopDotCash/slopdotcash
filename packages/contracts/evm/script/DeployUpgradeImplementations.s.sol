// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface ImplementationVm {
    function getCode(string calldata artifactPath) external view returns (bytes memory);
    function startBroadcast() external;
    function stopBroadcast() external;
}

interface Proxiable {
    function proxiableUUID() external view returns (bytes32);
}

/// @notice Deploys replacement ProjectEscrow and EscrowFactory implementations for the existing mainnet
/// factory proxies on Base (8453), Ethereum (1) and Robinhood Chain (4663). It only deploys logic contracts.
/// It never upgrades a proxy and never selects an implementation: the upgrade authority signs those calls
/// separately (contracts/DEPLOY-MAINNET.md, "EVM monthly reserve V2 upgrade").
/// @dev Each implementation is created through the deterministic CREATE2 deployer with a fixed salt, so its
/// address and runtime code (which embeds that address as the UUPS self-reference) are the same on every
/// chain and known before signing. A CREATE2 address commits to the exact creation code, so code already
/// present at the predicted address is this implementation, whoever deployed it; the script then skips it.
contract DeployUpgradeImplementations {
    ImplementationVm internal constant vm = ImplementationVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    /// @dev The deterministic deployment proxy (Arachnid), present on all three chains.
    address public constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 public constant SALT = keccak256("slop.escrow.implementation");
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    event ImplementationsDeployed(uint256 indexed chainId, address vaultImplementation, address factoryImplementation);

    function run() external returns (address vaultImplementation, address factoryImplementation) {
        require(block.chainid == 8453 || block.chainid == 1 || block.chainid == 4663, "wrong chain");
        require(CREATE2_DEPLOYER.code.length != 0, "deterministic deployer missing");
        bytes memory vaultCode = vm.getCode("ProjectEscrow.sol:ProjectEscrow");
        bytes memory factoryCode = vm.getCode("ProjectEscrow.sol:EscrowFactory");
        vm.startBroadcast();
        vaultImplementation = deploy(vaultCode);
        factoryImplementation = deploy(factoryCode);
        vm.stopBroadcast();
        require(
            Proxiable(vaultImplementation).proxiableUUID() == IMPLEMENTATION_SLOT
                && Proxiable(factoryImplementation).proxiableUUID() == IMPLEMENTATION_SLOT,
            "not a UUPS implementation"
        );
        emit ImplementationsDeployed(block.chainid, vaultImplementation, factoryImplementation);
    }

    function deploy(bytes memory creationCode) private returns (address implementation) {
        implementation = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, SALT, keccak256(creationCode)))))
        );
        if (implementation.code.length != 0) return implementation;
        (bool ok, bytes memory created) = CREATE2_DEPLOYER.call(abi.encodePacked(SALT, creationCode));
        require(
            ok && created.length == 20 && address(bytes20(created)) == implementation
                && implementation.code.length != 0,
            "implementation deployment failed"
        );
    }
}
