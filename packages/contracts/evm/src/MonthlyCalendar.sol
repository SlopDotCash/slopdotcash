// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev A monthly allocation for calendar UTC month M can be committed from MONTHLY_CUTOFF_DELAY after M ends
/// until MONTHLY_CUTOFF_DELAY after the next month ends (owner decision D1: 00:00 UTC on the 4th).
uint64 constant MONTHLY_CUTOFF_DELAY = 72 hours;

/// @notice The calendar arithmetic of ProjectEscrow's monthly windows, loop-free so that the solc SMTChecker
/// proves every checked step free of overflow and underflow, and test/smt/EscrowLemmas.sol proves its
/// properties, for every input (packages/contracts/README.md, "Money invariants"). Steps are unchecked only
/// where they divide, or add and multiply values that their uint64 and uint8 inputs keep below 2^100: checking
/// them would put ProjectEscrow over the EIP-170 limit.
library MonthlyCalendar {
    /// @dev 00:00 UTC on 1 January 1970, counted as monthStart counts.
    uint256 private constant UNIX_EPOCH = 865_565 days;

    /// @notice When a period's allocation may be committed: from MONTHLY_CUTOFF_DELAY after the month ends
    /// until MONTHLY_CUTOFF_DELAY after the next month ends. A period is YYYYMM in UTC, year 2000 to 9999;
    /// any other period has no window, and both times are zero.
    function window(uint32 period) internal pure returns (uint64 opensAt, uint64 closesAt) {
        uint256 year = period / 100;
        uint256 month = period % 100;
        if (year < 2000 || year > 9999 || month == 0 || month > 12) return (0, 0);
        (uint256 nextYear, uint256 nextMonth) = month == 12 ? (year + 1, uint256(1)) : (year, month + 1);
        (uint256 afterYear, uint256 afterMonth) =
            nextMonth == 12 ? (nextYear + 1, uint256(1)) : (nextYear, nextMonth + 1);
        opensAt = uint64(monthStart(uint64(nextYear), uint8(nextMonth)) - UNIX_EPOCH) + MONTHLY_CUTOFF_DELAY;
        closesAt = uint64(monthStart(uint64(afterYear), uint8(afterMonth)) - UNIX_EPOCH) + MONTHLY_CUTOFF_DELAY;
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

    /// @dev Seconds from 00:00 UTC on 1 March of year -400 to 00:00 UTC on the first day of a month (days from
    /// civil, one era early so that no year underflows).
    function monthStart(uint64 year, uint8 month) private pure returns (uint256) {
        uint256 y;
        uint256 dayOfYear;
        uint256 yearOfEra;
        uint256 leapDays;
        unchecked {
            y = uint256(year) + (month <= 2 ? 399 : 400);
            dayOfYear = (153 * (month > 2 ? uint256(month) - 3 : uint256(month) + 9) + 2) / 5;
            yearOfEra = y % 400;
            leapDays = yearOfEra / 4;
        }
        leapDays -= yearOfEra / 100;
        unchecked {
            return ((y / 400) * 146097 + yearOfEra * 365 + leapDays + dayOfYear) * 1 days;
        }
    }
}
