// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev A monthly allocation for calendar UTC month M can be committed from MONTHLY_CUTOFF_DELAY after M ends
/// until MONTHLY_CUTOFF_DELAY after the next month ends (owner decision D1: 00:00 UTC on the 4th).
uint64 constant MONTHLY_CUTOFF_DELAY = 72 hours;

/// @notice The calendar arithmetic of ProjectEscrow's monthly windows, loop-free so that the solc SMTChecker
/// proves every checked step free of overflow and underflow, and test/smt/CalendarLemmas.sol proves its
/// properties, for every input (packages/contracts/README.md, "Money invariants"). Steps are unchecked only
/// where they divide, or add and multiply values that their uint64 and uint32 inputs keep below 2^100:
/// checking them would put ProjectEscrow over the EIP-170 limit.
library MonthlyCalendar {
    /// @notice When a period's allocation may be committed: from MONTHLY_CUTOFF_DELAY after the month ends
    /// until MONTHLY_CUTOFF_DELAY after the next month ends. A period is YYYYMM in UTC, year 2000 to 9999;
    /// any other period has no window, and both times are zero.
    function window(uint32 period) internal pure returns (uint64 opensAt, uint64 closesAt) {
        uint256 year = period / 100;
        uint256 month = period % 100;
        if (year < 2000 || year > 9999 || month == 0 || month > 12) return (0, 0);
        uint32 next = uint32((year - 2000) * 12 + month);
        opensAt = uint64(monthStart(next)) + MONTHLY_CUTOFF_DELAY;
        closesAt = uint64(monthStart(next + 1)) + MONTHLY_CUTOFF_DELAY;
    }

    /// @notice The UTC calendar month (YYYYMM) containing a Unix time, which every EVM block header holds in
    /// 64 bits: civil from days, with March-based years, so that an era of 400 years is three centuries of
    /// 36524 days and one of 36525.
    function periodAt(uint64 time) internal pure returns (uint32) {
        unchecked {
            uint256 shiftedDays = time / 1 days + 719468;
            uint256 dayOfEra = shiftedDays % 146097;
            bool lastDayOfEra = dayOfEra == 146096;
            uint256 century = lastDayOfEra ? 3 : dayOfEra / 36524;
            uint256 dayOfCentury = lastDayOfEra ? 36524 : dayOfEra % 36524;
            uint256 dayOfCycle = dayOfCentury % 1461;
            bool lastDayOfCycle = dayOfCycle == 1460;
            uint256 marchMonth = (5 * (lastDayOfCycle ? 365 : dayOfCycle % 365) + 2) / 153;
            uint256 year = (shiftedDays / 146097) * 400 + century * 100 + (dayOfCentury / 1461) * 4
                + (lastDayOfCycle ? 3 : dayOfCycle / 365) + (marchMonth >= 10 ? 1 : 0);
            return uint32(year * 100 + (marchMonth + 2) % 12 + 1);
        }
    }

    /// @dev Unix time of 00:00 UTC on the first day of the month `monthsAfterJanuary2000` months after January
    /// 2000: days from civil with March-based years, 365 * year + 97 * era + leap days of the era + day of the
    /// year - 719468, with 365 * 2000 - 719468 = 10532 folded in so that no step subtracts.
    function monthStart(uint32 monthsAfterJanuary2000) private pure returns (uint256) {
        uint256 yearsAfter2000 = monthsAfterJanuary2000 / 12;
        uint256 month = monthsAfterJanuary2000 % 12 + 1;
        bool marchBased = month > 2;
        uint256 y;
        uint256 dayOfYear;
        unchecked {
            y = 1999 + yearsAfter2000 + (marchBased ? 1 : 0);
            dayOfYear = (153 * (marchBased ? month - 3 : month + 9) + 2) / 5;
        }
        uint256 yearOfEra = y % 400;
        uint256 leapDays = yearOfEra / 4 - yearOfEra / 100;
        unchecked {
            return
                (yearsAfter2000 * 365 + (marchBased ? 10532 : 10167) + (y / 400) * 97 + leapDays + dayOfYear) * 1 days;
        }
    }
}
