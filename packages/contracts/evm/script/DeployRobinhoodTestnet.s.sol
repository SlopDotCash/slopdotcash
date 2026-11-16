// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowFactory} from "../src/ProjectEscrow.sol";
import {DeployEscrowFactory} from "./DeployEscrowFactory.sol";

/// @notice Robinhood Chain Testnet (46630) factory deployment. See DeployEscrowFactory for the required environment.
contract DeployRobinhoodTestnet is DeployEscrowFactory {
    function run() external returns (EscrowFactory) {
        return deploy(46630, false);
    }
}
