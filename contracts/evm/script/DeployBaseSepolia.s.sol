// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowFactory, IERC20} from "../src/ProjectEscrow.sol";

interface DeploymentVm {
    function envAddress(string calldata key) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Test-only deployment. Signing comes from Foundry's external signer/account configuration.
contract DeployBaseSepolia {
    DeploymentVm private constant vm = DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address public constant TEST_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    /// @dev Policy delay before a new or rotated destination binding can pay.
    uint64 public constant BINDING_DELAY = 48 hours;
    event TestFactoryDeployed(
        address indexed factory, address token, address registrar, address identityAuthority, address feeRecipient
    );

    function run() external returns (EscrowFactory factory) {
        require(block.chainid == 84532, "Base Sepolia only");
        address feeRecipient = vm.envAddress("TEST_FEE_RECIPIENT");
        address identityAuthority = vm.envAddress("TEST_IDENTITY_AUTHORITY");
        vm.startBroadcast();
        factory = new EscrowFactory(IERC20(TEST_USDC), feeRecipient, identityAuthority, BINDING_DELAY);
        vm.stopBroadcast();
        emit TestFactoryDeployed(address(factory), TEST_USDC, factory.registrar(), identityAuthority, feeRecipient);
    }
}
