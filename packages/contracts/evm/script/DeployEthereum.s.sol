// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowFactory} from "../src/ProjectEscrow.sol";
import {DeployEscrowFactory} from "./DeployEscrowFactory.sol";

/// @notice Ethereum mainnet (1) factory deployment. See DeployEscrowFactory for the required environment.
contract DeployEthereum is DeployEscrowFactory {
    function run() external returns (EscrowFactory) {
        return deploy(1, false);
    }
}
