// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {EscrowFactory} from "../src/ProjectEscrow.sol";
import {DeployEscrowFactory} from "./DeployEscrowFactory.sol";

/// @notice Ethereum Sepolia test (11155111) factory deployment. See DeployEscrowFactory for the required environment.
contract DeployEthereumSepolia is DeployEscrowFactory {
    function run() external returns (EscrowFactory) {
        return deploy(11155111, false);
    }
}
