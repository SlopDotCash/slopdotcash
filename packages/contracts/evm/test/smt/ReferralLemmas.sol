// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReferralClaims} from "../../src/ReferralClaims.sol";

/// @notice Properties that ReferralDistributor relies on when it calls ReferralClaims, as entry points for the
/// SMTChecker's CHC engine, which proves them for every input (packages/contracts/README.md, "Money
/// invariants"). Never deployed.
contract ReferralLemmas {
    /// @notice A payable claim pays the cumulative less what the account already claimed, and what was claimed
    /// plus the payment never exceeds the root's declared total.
    function claimNeverExceedsTotal(uint256 cumulative, uint256 already, uint256 totalClaimed, uint256 total)
        external
        pure
    {
        (ReferralClaims.Outcome outcome, uint256 amount) = ReferralClaims.next(cumulative, already, totalClaimed, total);
        if (outcome != ReferralClaims.Outcome.Payable) return;
        assert(amount > 0 && already + amount == cumulative && totalClaimed + amount <= total);
    }

    /// @notice After a payable claim the root's unclaimed remainder, total - (totalClaimed + amount), never
    /// underflows: it is at least zero.
    function remainingIsNeverNegative(uint256 cumulative, uint256 already, uint256 totalClaimed, uint256 total)
        external
        pure
    {
        (ReferralClaims.Outcome outcome, uint256 amount) = ReferralClaims.next(cumulative, already, totalClaimed, total);
        if (outcome != ReferralClaims.Outcome.Payable) return;
        uint256 remaining = total - (totalClaimed + amount);
        assert(remaining + totalClaimed + amount == total);
    }

    /// @notice A claim is refused only when the cumulative is not above what was claimed, or the payment does
    /// not fit within the total, or what was claimed plus the payment is not a uint256.
    function refusesOnlyWhatDoesNotFit(uint256 cumulative, uint256 already, uint256 totalClaimed, uint256 total)
        external
        pure
    {
        (ReferralClaims.Outcome outcome, uint256 amount) = ReferralClaims.next(cumulative, already, totalClaimed, total);
        if (cumulative <= already) {
            assert(outcome == ReferralClaims.Outcome.Nothing && amount == 0);
        } else {
            assert(amount == cumulative - already);
            if (outcome == ReferralClaims.Outcome.Overflow) assert(amount > type(uint256).max - totalClaimed);
            else assert((outcome == ReferralClaims.Outcome.Exceeded) == (totalClaimed + amount > total));
        }
    }
}
