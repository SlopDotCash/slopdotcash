// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowFactory, ERC1967Proxy} from "../src/ProjectEscrow.sol";

interface DeploymentVm {
    function envAddress(string calldata key) external returns (address);
    function envOr(string calldata key, address defaultValue) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
    function getCode(string calldata artifactPath) external view returns (bytes memory);
}

/// @notice Shared factory deployment. Signing comes from Foundry's external signer/account configuration; the
/// signer pays gas. Upgrade authority is explicitly set by ESCROW_UPGRADE_AUTHORITY. The factory serves every standard ERC-20 on its chain, so no token is
/// fixed here. The registrar, fee recipient and identity authority are repository-owner decisions recorded at
/// deployment and read from the environment as public addresses:
///   ESCROW_REGISTRAR, ESCROW_FEE_RECIPIENT, ESCROW_IDENTITY_AUTHORITY.
/// Each is required, except that Base mainnet uses Slop's published Base fee recipient when
/// ESCROW_FEE_RECIPIENT is not set.
abstract contract DeployEscrowFactory {
    DeploymentVm internal constant vm = DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    /// @dev Production and test deployments permit immediate award payment.
    uint64 public constant BINDING_DELAY = 0;
    /// @dev Slop's published Base platform-fee recipient, chosen by the repository owner on 9 October 2026 (RFC #472). Default on Base only.
    address public constant BASE_PUBLISHED_FEE_RECIPIENT = 0x8f77C37D8650776bFe73c9b12B15209eE15D9b86;

    event FactoryDeployed(
        uint256 indexed chainId,
        address indexed factory,
        address registrar,
        address identityAuthority,
        address feeRecipient,
        uint64 bindingDelay
    );

    function deploy(uint256 chainId, bool baseFeeDefault) internal returns (EscrowFactory factory) {
        require(block.chainid == chainId, "wrong chain");
        address registrar = vm.envAddress("ESCROW_REGISTRAR");
        address identityAuthority = vm.envAddress("ESCROW_IDENTITY_AUTHORITY");
        address feeRecipient = baseFeeDefault
            ? vm.envOr("ESCROW_FEE_RECIPIENT", BASE_PUBLISHED_FEE_RECIPIENT)
            : vm.envAddress("ESCROW_FEE_RECIPIENT");
        address upgradeAuthority = vm.envAddress("ESCROW_UPGRADE_AUTHORITY");
        // Load the vault creation code from its artifact. Embedding it with `new` puts the vault, factory and
        // proxy creation code in one script contract, which exceeds the EIP-170 size check in CI.
        bytes memory vaultCreationCode = vm.getCode("ProjectEscrow.sol:ProjectEscrow");
        vm.startBroadcast();
        address vaultImplementation;
        assembly ("memory-safe") {
            vaultImplementation := create(0, add(vaultCreationCode, 0x20), mload(vaultCreationCode))
        }
        require(vaultImplementation != address(0), "vault implementation deployment failed");
        EscrowFactory factoryImplementation = new EscrowFactory();
        factory = EscrowFactory(
            address(
                new ERC1967Proxy(
                    address(factoryImplementation),
                    abi.encodeCall(
                        EscrowFactory.initialize,
                        (
                            registrar,
                            feeRecipient,
                            identityAuthority,
                            BINDING_DELAY,
                            upgradeAuthority,
                            vaultImplementation
                        )
                    )
                )
            )
        );
        vm.stopBroadcast();
        emit FactoryDeployed(chainId, address(factory), registrar, identityAuthority, feeRecipient, BINDING_DELAY);
    }
}
