// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice The fee arithmetic of ProjectEscrow, loop-free so that the solc SMTChecker proves it free of overflow,
/// underflow and division by zero, and test/smt/EscrowLemmas.sol proves its properties, for every input
/// (packages/contracts/README.md, "Money invariants"). Its proofs live there, not in asserts, so they add nothing to deployed bytecode.
library EscrowMath {
    /// @notice 2% of a gross amount rounded up once (PRD section 6): 50 * fee is the least multiple of 50 that is at
    /// least gross, so splitting an amount never lowers the fee.
    function payoutFee(uint128 gross) internal pure returns (uint128 fee) {
        fee = gross / 50 + (gross % 50 == 0 ? 0 : 1);
    }

    /// @notice Slop's 25% of a private bounty (PRD section 8). For a gross divisible by 4, the only kind a bounty
    /// vault commits, the researcher's principal is exactly 75%.
    function bountyFee(uint128 gross) internal pure returns (uint128 fee) {
        fee = gross / 4;
    }
}
