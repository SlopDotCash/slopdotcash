/**
 * The small all-time points summary that scripts/generate-points.ts publishes
 * at /data/points-summary.json beside the full journal. The home page reads
 * only this file; the leaderboard page still assembles the complete journal.
 */
export interface PointsSummary {
  schemaVersion: "1";
  ruleVersion: string;
  generatedAt: string;
  /** SHA-256 of the points index this summary was derived with. */
  indexDigest: string;
  totals: { contributors: number; points: number };
  /** Every contributor with points, all-time totals highest first. */
  contributors: { actor: { id: string; login: string }; total: number }[];
}

const count = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;

export function isPointsSummary(value: unknown): value is PointsSummary {
  const v = value as PointsSummary | null;
  if (
    v?.schemaVersion !== "1" ||
    typeof v.ruleVersion !== "string" ||
    typeof v.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(v.generatedAt)) ||
    !/^[a-f0-9]{64}$/u.test(v.indexDigest) ||
    !v.totals ||
    !count(v.totals.contributors) ||
    !count(v.totals.points) ||
    !Array.isArray(v.contributors) ||
    v.contributors.length !== v.totals.contributors
  )
    return false;
  let previous = Number.POSITIVE_INFINITY;
  const ids = new Set<string>();
  for (const c of v.contributors) {
    if (
      !c?.actor ||
      typeof c.actor.id !== "string" ||
      !c.actor.id ||
      typeof c.actor.login !== "string" ||
      !c.actor.login ||
      !count(c.total) ||
      c.total === 0 ||
      c.total > previous ||
      ids.has(c.actor.id)
    )
      return false;
    previous = c.total;
    ids.add(c.actor.id);
  }
  return (
    v.contributors.reduce((sum, c) => sum + c.total, 0) === v.totals.points
  );
}
