// spec/settlement/referralAccrual.md, "A complete immutable source snapshot is filed in ordinal-month order"
import type { CalendarDate } from "../../gen/settlement__referralAccrual.ts";
import { type Period, parsePeriod, periodEndSeconds, periodStartSeconds, shiftPeriod } from "../kernels/calendar.ts";

export const FIRST_REFERRAL_PERIOD = "2026-11";

const DAY_MILLIS = 86_400_000;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;

/** @throws {never} */
export function ordinalOf(period: Period): number {
  return Math.trunc(period / 100) * 12 + (period % 100) - 1;
}

/** @throws {never} */
export function periodOf(ordinal: number): Period | undefined {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) return undefined;
  return parsePeriod(`${String(Math.floor(ordinal / 12)).padStart(4, "0")}-${String((ordinal % 12) + 1).padStart(2, "0")}`);
}

/** @throws {RangeError} */
export function periodBounds(period: Period): { readonly start: string; readonly end: string } {
  return {
    start: new Date(periodStartSeconds(period) * 1000).toISOString(),
    end: new Date(periodEndSeconds(period) * 1000).toISOString(),
  };
}

/** @throws {RangeError} */
export function pendingPeriods(next: Period, nowMillis: number): Period[] {
  const pending: Period[] = [];
  let period = next;
  while (periodEndSeconds(period) * 1000 <= nowMillis) {
    pending.push(period);
    period = shiftPeriod(period, 1);
  }
  return pending;
}

/** @throws {never} */
export function closedBy(period: Period, nowMillis: number): boolean {
  return periodEndSeconds(period) * 1000 <= nowMillis;
}

/** @throws {never} */
export function calendarDate(iso: string): CalendarDate | undefined {
  if (!INSTANT.test(iso)) return undefined;
  const millis = Date.parse(iso);
  if (!Number.isFinite(millis)) return undefined;
  const date = new Date(millis);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    millis: ((millis % DAY_MILLIS) + DAY_MILLIS) % DAY_MILLIS,
  };
}

/** @throws {RangeError} */
export function isoOfDate(date: CalendarDate): string {
  return new Date(Date.UTC(date.year, date.month - 1, date.day) + date.millis).toISOString();
}

/** @throws {never} */
export function periodOfInstant(iso: string): Period | undefined {
  const date = calendarDate(iso);
  return date === undefined ? undefined : parsePeriod(`${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}`);
}
