// spec/settlement/monthly.md, "The owner may finalize early; the coordinator freezes at the cutoff unless the default is off"; spec/settlement/monthly.md, "The trusted workflow proposes in the first three days for an active, funded, verified project"
import { cutoffSeconds, firstAutomaticPeriod, monthEnd, monthStart, proposalWindowSeconds, validPeriod } from "../../gen/settlement__monthly.ts";

export type Period = number & { readonly __brand: "Period" };

const PERIOD_TEXT = /^(\d{4})-(0[1-9]|1[0-2])$/u;

/** @throws {never} */
export function isPeriod(value: number): value is Period {
  return Number.isSafeInteger(value) && validPeriod(value);
}

/** @throws {RangeError} */
function period(value: number): Period {
  if (!isPeriod(value)) throw new RangeError(`${value} is not a calendar month from 2000-01 through 9999-12`);
  return value;
}

export const FIRST_PERIOD = period(firstAutomaticPeriod);

/** @throws {never} */
export function parsePeriod(text: string): Period | undefined {
  const match = PERIOD_TEXT.exec(text);
  const value = match ? Number(match[1]) * 100 + Number(match[2]) : 0;
  return isPeriod(value) ? value : undefined;
}

/** @throws {never} */
export function formatPeriod(value: Period): string {
  return `${Math.trunc(value / 100)}-${String(value % 100).padStart(2, "0")}`;
}

/** @throws {never} */
export function periodStartSeconds(value: Period): number {
  return monthStart(value);
}

/** @throws {never} */
export function periodEndSeconds(value: Period): number {
  return monthEnd(value);
}

/** @throws {never} */
export function cutoffAt(value: Period): number {
  return monthEnd(value) + cutoffSeconds;
}

/** @throws {never} */
export function automaticCutoffAt(value: Period): number | undefined {
  return value >= FIRST_PERIOD ? cutoffAt(value) : undefined;
}

/** @throws {never} */
export function proposalWindow(value: Period): { readonly opensAt: number; readonly closesAt: number } {
  const opensAt = monthEnd(value);
  return { opensAt, closesAt: opensAt + proposalWindowSeconds };
}

/** @throws {RangeError} */
export function periodContaining(epochSeconds: number): Period {
  const date = new Date(epochSeconds * 1000);
  return period(date.getUTCFullYear() * 100 + date.getUTCMonth() + 1);
}

/** @throws {RangeError} */
export function shiftPeriod(value: Period, months: number): Period {
  const index = Math.trunc(value / 100) * 12 + (value % 100) - 1 + months;
  return period(Math.floor(index / 12) * 100 + (index % 12) + 1);
}
