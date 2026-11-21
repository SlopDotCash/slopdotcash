// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {DeploySubmissionDeposits} from "./DeploySubmissionDeposits.sol";

/// @notice Base mainnet (8453) deployment of the submission deposit contract. See DeploySubmissionDeposits for
/// the required environment. This script must never run on any other chain.
contract DeploySubmissionDepositsBase is DeploySubmissionDeposits {
    function chainId() public pure override returns (uint256) {
        return 8453;
    }
}
