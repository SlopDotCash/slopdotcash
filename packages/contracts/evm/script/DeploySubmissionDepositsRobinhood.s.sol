// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DeploySubmissionDeposits} from "./DeploySubmissionDeposits.sol";

/// @notice Robinhood Chain mainnet (4663) deployment of the submission deposit contract. See
/// DeploySubmissionDeposits for the required environment. This script must never run on any other chain.
contract DeploySubmissionDepositsRobinhood is DeploySubmissionDeposits {
    function chainId() public pure override returns (uint256) {
        return 4663;
    }
}
