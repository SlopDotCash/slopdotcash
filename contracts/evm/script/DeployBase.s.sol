// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowFactory, IERC20} from "../src/ProjectEscrow.sol";

interface DeploymentVm {
    function envAddress(string calldata key) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Base mainnet deployment. Signing comes from Foundry's external signer/account configuration.
contract DeployBase {
    DeploymentVm private constant vm = DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    /// @dev Circle's native USDC on Base mainnet.
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    /// @dev Slop's published Base platform-fee recipient (src/lib/fresh-cycle-policy.mjs).
    address public constant FEE_RECIPIENT = 0x8f77C37D8650776bFe73c9b12B15209eE15D9b86;
    /// @dev Production delay before a new or rotated destination binding can pay.
    uint64 public constant BINDING_DELAY = 48 hours;
    event FactoryDeployed(
        address indexed factory, address token, address registrar, address identityAuthority, address feeRecipient
    );

    function run() external returns (EscrowFactory factory) {
        require(block.chainid == 8453, "Base mainnet only");
        address identityAuthority = vm.envAddress("IDENTITY_AUTHORITY");
        vm.startBroadcast();
        factory = new EscrowFactory(IERC20(USDC), FEE_RECIPIENT, identityAuthority, BINDING_DELAY);
        vm.stopBroadcast();
        emit FactoryDeployed(address(factory), USDC, factory.registrar(), identityAuthority, FEE_RECIPIENT);
    }
}
