// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EscrowMath} from "../../src/EscrowMath.sol";
import {MonthlyCalendar} from "../../src/MonthlyCalendar.sol";

/// @notice Properties that ProjectEscrow relies on when it calls EscrowMath and MonthlyCalendar, as entry points for the SMTChecker's
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

    /// @notice monthlyWindow refuses a period exactly when the library gives it no window: a valid period's
    /// window never opens at zero.
    function onlyAnInvalidPeriodHasNoWindow(uint32 period) external pure {
        (uint64 opensAt, uint64 closesAt) = MonthlyCalendar.window(period);
        uint256 year = period / 100;
        uint256 month = period % 100;
        bool valid = year >= 2000 && year <= 9999 && month >= 1 && month <= 12;
        assert(valid ? opensAt != 0 : opensAt == 0 && closesAt == 0);
    }

    /// @notice A period's window opens before it closes, and the next period's window opens when it closes, so
    /// window starts strictly increase from one period to the next and only one window is open at a time.
    function windowStartIncreasesPerPeriod(uint32 period) external pure {
        (uint64 opensAt, uint64 closesAt) = MonthlyCalendar.window(period);
        if (opensAt == 0) return;
        uint32 next = period % 100 == 12 ? period + 89 : period + 1;
        (uint64 nextOpensAt,) = MonthlyCalendar.window(next);
        assert(opensAt < closesAt);
        assert(nextOpensAt == 0 || nextOpensAt == closesAt);
    }

    /// @notice currentPeriod is a calendar month, its last two digits 1 to 12, for every time before 00:00 UTC
    /// on 1 January of year 42949673, 1355298602169600. From then on YYYYMM exceeds 2^32 - 1 and periodAt's
    /// uint32 conversion truncates it: at type(uint64).max the period ends in 51.
    function periodIsACalendarMonth(uint64 time) external pure {
        if (time >= 1355298602169600) return;
        uint32 period = MonthlyCalendar.periodAt(time);
        assert(period % 100 >= 1 && period % 100 <= 12);
    }
}
