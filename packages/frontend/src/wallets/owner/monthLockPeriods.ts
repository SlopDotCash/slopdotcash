// spec/frontend/vaultLocks.md, "A lock covers its count of months from the vault's current month, and an unreserved month is releasable from 00:00 UTC on the 4th of the second month after it"
import { closesAt } from "../../../gen/contracts__ledger.ts";

const sitePattern = /^\d{4}-(0[1-9]|1[0-2])$/u;
const chainPattern = /^\d{4}(0[1-9]|1[0-2])$/u;
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** @throws {never} */
export function isChainMonth(value: number): boolean {
  return Number.isSafeInteger(value) && chainPattern.test(String(value));
}

/** @throws {RangeError} */
export function chainMonth(text: string): number {
  if (!sitePattern.test(text)) throw new RangeError("Invalid month");
  return Number(text.replace("-", ""));
}

/** @throws {never} */
export function siteMonth(period: number): string {
  const text = String(period);
  return `${text.slice(0, 4)}-${text.slice(4)}`;
}

/** @throws {never} */
export function monthName(period: number): string {
  return monthFormat.format(new Date(`${siteMonth(period)}-01T00:00:00Z`));
}

/** @throws {never} */
export function releaseDay(period: number): string {
  return dayFormat.format(new Date(closesAt(period) * 1000));
}
