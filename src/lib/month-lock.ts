/**
 * Month locks (operator decision, 15 November 2026): which months a lock
 * covers and when an unreserved one can be released. Shared by the browser
 * and the Solana lock route.
 */

export const LOCK_MONTH_COUNTS = [1, 3, 6, 12] as const;

/** `from` ("2026-12") and the next `count - 1` months. */
export function lockPeriods(from: string, count: number): string[] {
  const [year, month] = from.split("-").map(Number);
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(year, month - 1 + index, 1)).toISOString().slice(0, 7),
  );
}

/**
 * When a month's lock can be released at the latest: its commit window
 * closes at 00:00 UTC on the 4th of the second month after it. From then a
 * month that was never reserved for payout can be released by a transaction
 * anyone may send; until it is sent the funds stay locked. A month reserved
 * for payout before then leaves the lock earlier.
 */
export function lockEnds(period: string): Date {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month + 1, 4));
}

/** True when an open lock's month was never reserved and its window closed. */
export function lockReleasable(period: string, now: Date): boolean {
  return now.getTime() >= lockEnds(period).getTime();
}

/** 202612 for "2026-12". */
export function chainMonth(period: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(period))
    throw new Error("Invalid month");
  return Number(period.replace("-", ""));
}
