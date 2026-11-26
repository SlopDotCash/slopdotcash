// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MonthlyCalendar} from "../../src/MonthlyCalendar.sol";

/// @notice Properties that ProjectEscrow relies on when it calls MonthlyCalendar, as entry points for the
/// SMTChecker's BMC engine (packages/contracts/README.md, "Money invariants"). The functions are loop-free, so
/// BMC inlines every call and decides each property for every input. CHC is not used here: it must summarise
/// periodAt and window, and their uint32 and uint64 conversions, which solc encodes with int2bv, leave z3's
/// Horn solver without an answer. Never deployed.
contract CalendarLemmas {
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
