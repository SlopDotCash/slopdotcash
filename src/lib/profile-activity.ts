import type { DailyPoints } from "./points-members";

/** The points of each of the last `days` UTC days, today included. */
export function dailyPoints(
  awarded: readonly DailyPoints[],
  today: Date,
  days: number,
): DailyPoints[] {
  const entries = Array.from({ length: days }, (_, index) => ({
    day: new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - (days - 1 - index),
      ),
    )
      .toISOString()
      .slice(0, 10),
    points: 0,
  }));
  const byDay = new Map(entries.map((entry) => [entry.day, entry]));
  for (const award of awarded) {
    const entry = byDay.get(award.day);
    if (entry) entry.points += award.points;
  }
  return entries;
}

/** Points awarded over the last `days` UTC days, today included. */
export function recentPoints(
  awarded: readonly DailyPoints[],
  today: Date,
  days: number,
): number {
  return dailyPoints(awarded, today, days).reduce(
    (total, entry) => total + entry.points,
    0,
  );
}
