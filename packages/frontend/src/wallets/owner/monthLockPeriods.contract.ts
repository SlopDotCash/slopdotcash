// spec/frontend/vaultLocks.md, "A lock covers its count of months from the vault's current month, and an unreserved month is releasable from 00:00 UTC on the 4th of the second month after it"
import { lockPeriod } from "../../../gen/frontend__vaultLocks.ts";
import { vectors } from "../../kernels/vectors.ts";
import { chainMonth, isChainMonth, monthName, releaseDay, siteMonth } from "./monthLockPeriods.ts";

const chainOf = (text: string) => {
  try {
    return chainMonth(text);
  } catch (caught) {
    return caught instanceof RangeError ? caught.message : "unexpected";
  }
};

export const aSiteMonthBecomesItsChainMonthAndBack = vectors<string, number | string>([
  ["2026-12", 202612],
  ["2027-01", 202701],
  ["2026-13", "Invalid month"],
  ["2026-1", "Invalid month"],
  ["202612", "Invalid month"],
], chainOf);

export const aChainMonthReadsAsItsSiteMonth = vectors<number, string>([
  [202612, "2026-12"],
  [202701, "2027-01"],
], siteMonth);

export const onlyAYearAndAMonthIsAChainMonth = vectors<number, boolean>([
  [202612, true],
  [202600, false],
  [202613, false],
  [20261, false],
], isChainMonth);

export const aLockRollsDecemberIntoJanuary = vectors<readonly [number, number], number>([
  [[202612, 0], 202612],
  [[202612, 1], 202701],
  [[202611, 11], 202710],
], ([first, index]) => lockPeriod(first, index));

export const aMonthIsNamedInWords = vectors<number, string>([
  [202612, "December 2026"],
  [202701, "January 2027"],
], monthName);

export const anUnreservedMonthIsReleasableFromTheFourthOfTheSecondMonthAfterIt = vectors<number, string>([
  [202612, "February 4, 2027"],
  [202611, "January 4, 2027"],
], releaseDay);
