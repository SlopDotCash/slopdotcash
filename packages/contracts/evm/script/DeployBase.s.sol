// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowFactory} from "../src/ProjectEscrow.sol";
import {DeployEscrowFactory} from "./DeployEscrowFactory.sol";

/// @notice Base mainnet (8453) factory deployment. See DeployEscrowFactory for the required environment.
contract DeployBase is DeployEscrowFactory {
    function run() external returns (EscrowFactory) {
        return deploy(8453, true);
    }
}
