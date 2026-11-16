// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice The fee arithmetic of ProjectEscrow, loop-free so that the solc SMTChecker proves each assert for every
/// input (packages/contracts/README.md, "Money invariants").
library EscrowMath {
    /// @notice 2% of a gross amount rounded up once (PRD section 6): 50 * fee is the least multiple of 50 that is at
    /// least gross, so splitting an amount never lowers the fee.
    function payoutFee(uint128 gross) internal pure returns (uint128 fee) {
        fee = gross / 50 + (gross % 50 == 0 ? 0 : 1);
        assert(uint256(fee) * 50 >= gross && uint256(fee) * 50 < uint256(gross) + 50);
    }

    /// @notice Slop's 25% of a private bounty (PRD section 8). For a gross divisible by 4, the only kind a bounty
    /// vault commits, the researcher's principal is exactly 75%.
    function bountyFee(uint128 gross) internal pure returns (uint128 fee) {
        fee = gross / 4;
        assert(gross % 4 != 0 || (uint256(fee) * 4 == gross && uint256(gross - fee) * 4 == uint256(gross) * 3));
    }
}
