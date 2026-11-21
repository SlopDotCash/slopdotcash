// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice The cumulative-claim arithmetic of ReferralDistributor, loop-free so that the solc SMTChecker proves it
/// free of overflow and underflow, and test/smt/ReferralLemmas.sol proves its properties, for every input
/// (packages/contracts/README.md, "Money invariants").
library ReferralClaims {
    /// @notice Nothing: the cumulative is not above what the account already claimed. Payable: the difference
    /// fits within the total. Exceeded: it does not. Overflow: what was claimed plus the difference is not a
    /// uint256, which the distributor's checked addition refuses.
    enum Outcome {
        Nothing,
        Payable,
        Exceeded,
        Overflow
    }

    /// @notice What an account that already claimed `already` may claim against a leaf of `cumulative`, when
    /// `totalClaimed` of the root's declared `total` is claimed.
    function next(uint256 cumulative, uint256 already, uint256 totalClaimed, uint256 total)
        internal
        pure
        returns (Outcome outcome, uint256 amount)
    {
        if (cumulative <= already) return (Outcome.Nothing, 0);
        amount = cumulative - already;
        if (amount > type(uint256).max - totalClaimed) return (Outcome.Overflow, amount);
        outcome = totalClaimed + amount > total ? Outcome.Exceeded : Outcome.Payable;
    }
}
