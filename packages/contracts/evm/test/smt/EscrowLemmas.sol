// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EscrowMath} from "../../src/EscrowMath.sol";

/// @notice Properties that ProjectEscrow relies on when it calls EscrowMath, as entry points for the SMTChecker's
/// CHC engine, which proves them for every input (packages/contracts/README.md, "Money invariants"). The library
/// functions are the internal ones ProjectEscrow inlines. Never deployed.
contract EscrowLemmas {
    /// @notice The 2% fee is ceil(gross / 50): the least multiple of 50 at least gross, over 50.
    function feeIsTheCeiling(uint128 gross) external pure {
        uint128 fee = EscrowMath.payoutFee(gross);
        assert(uint256(fee) * 50 >= gross && uint256(fee) * 50 < uint256(gross) + 50);
    }

    /// @notice A bounty vault commits only a gross divisible by 4; Slop's fee is then exactly 25% and the
    /// researcher's principal exactly 75%.
    function bountySplitsExactly(uint128 gross) external pure {
        uint128 fee = EscrowMath.bountyFee(gross);
        assert(gross % 4 != 0 || (uint256(fee) * 4 == gross && uint256(gross - fee) * 4 == uint256(gross) * 3));
    }

    /// @notice recordAward, pay and withdrawUnused compute gross - fee: neither fee exceeds its gross.
    function feeNeverExceedsGross(uint128 gross) external pure {
        assert(EscrowMath.payoutFee(gross) <= gross);
        assert(EscrowMath.bountyFee(gross) <= gross);
    }

    /// @notice commitMonthly accepts an award reserved before fees rounded up, which holds the floor fee
    /// gross / 50: the current fee is that floor fee or one more.
    function feeIsFloorFeeOrOneMore(uint128 gross) external pure {
        uint128 fee = EscrowMath.payoutFee(gross);
        assert(fee >= gross / 50 && fee - gross / 50 <= 1);
    }

    /// @notice Splitting an award or a withdrawal into two never lowers the total payoutFee.
    function splittingNeverLowersTheFee(uint128 a, uint128 b) external pure {
        if (uint256(a) + b > type(uint128).max) return;
        assert(uint256(EscrowMath.payoutFee(a)) + EscrowMath.payoutFee(b) >= EscrowMath.payoutFee(a + b));
    }
}
