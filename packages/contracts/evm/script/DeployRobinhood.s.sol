// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowFactory} from "../src/ProjectEscrow.sol";
import {DeployEscrowFactory} from "./DeployEscrowFactory.sol";

/// @notice Robinhood Chain mainnet (4663) factory deployment. See DeployEscrowFactory for the required environment.
contract DeployRobinhood is DeployEscrowFactory {
    function run() external returns (EscrowFactory) {
        return deploy(4663, false);
    }
}
