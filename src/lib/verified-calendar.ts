/** Integer proleptic Gregorian UTC calendar for monthly reward periods. */

//@ verify
//@ requires 1 <= month && month <= 12 && year >= 0 && year <= 9999
//@ ensures \result >= 28 && \result <= 31
//@ ensures month == 2 ==> (\result == 29 <==> (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)))
//@ ensures month != 2 ==> (\result == 30 <==> (month == 4 || month == 6 || month == 9 || month == 11))
export function daysInMonth(year: number, month: number): number {
  if (month === 2)
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Days from 1970-01-01 to the first day of (year, month), after Hinnant's days_from_civil. */
//@ verify
//@ requires 1 <= month && month <= 12 && year >= 0 && year <= 10000
//@ ensures year == 1970 && month == 1 ==> \result == 0
//@ ensures month < 12 && year <= 9999 ==> monthStartDay(year, month + 1) - \result == daysInMonth(year, month)
//@ ensures month == 12 && year < 10000 ==> monthStartDay(year + 1, 1) - \result == 31
export function monthStartDay(year: number, month: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * mp + 2) / 5);
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Seconds since the epoch of 00:00 UTC on the first day after the month, plus a delay. */
//@ verify
//@ requires 1 <= month && month <= 12 && year >= 0 && year <= 9999 && delaySeconds >= 0
//@ ensures \result == (month == 12 ? monthStartDay(year + 1, 1) : monthStartDay(year, month + 1)) * 86400 + delaySeconds
//@ ensures \result - monthStartDay(year, month) * 86400 == daysInMonth(year, month) * 86400 + delaySeconds
export function monthlyCutoffSeconds(
  year: number,
  month: number,
  delaySeconds: number,
): number {
  const next =
    month === 12 ? monthStartDay(year + 1, 1) : monthStartDay(year, month + 1);
  return next * 86400 + delaySeconds;
}
