// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowFactory} from "../src/ProjectEscrow.sol";
import {DeployEscrowFactory} from "./DeployEscrowFactory.sol";

/// @notice Base Sepolia test (84532) factory deployment. See DeployEscrowFactory for the required environment.
contract DeployBaseSepolia is DeployEscrowFactory {
    function run() external returns (EscrowFactory) {
        return deploy(84532, false);
    }
}
