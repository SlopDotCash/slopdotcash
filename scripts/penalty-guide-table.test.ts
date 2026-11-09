/**
 * Copyright 2026 The Slop Authors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The guide's penalty table (PENALTY_ROWS in src/lib/penalty-guide.ts,
 * rendered by src/PointsRules.tsx) derives its debits and actions from
 * PENALTY_TABLE in workers/slopbot/penalties.ts.
 * This test pins category coverage and each row's debit in points to the
 * PRD section 7 values, so a change in the bot table fails here instead of
 * drifting silently.
 */
import { describe, expect, test } from "bun:test";
import { PENALTY_ROWS } from "../src/lib/penalty-guide";
import { POINTS_PER_THIRD } from "../src/lib/points";
import { PENALTY_TABLE } from "../workers/slopbot/penalties";

// The points the guide publishes today (PRD section 7), per row label.
const PUBLISHED_POINTS: Record<string, number> = {
  Spam: 30,
  "Scam or malicious": 240,
  "Clear violation of a quoted project rule": 10,
  "Low quality": 0,
  Duplicate: 0,
  "Out of scope": 0,
};

describe("guide penalty table", () => {
  test("publishes the six PRD section 7 rows with their point debits", () => {
    expect(
      Object.fromEntries(
        PENALTY_ROWS.map((row) => [
          row.category,
          row.debitThirds * POINTS_PER_THIRD,
        ]),
      ),
    ).toEqual(PUBLISHED_POINTS);
    expect(PENALTY_ROWS.map((row) => row.category)).toEqual(
      Object.keys(PUBLISHED_POINTS),
    );
  });

  test("covers each published category exactly once", () => {
    const covered: string[] = PENALTY_ROWS.flatMap((row) => [
      ...row.slopbotCategories,
    ]).sort();
    expect(covered).toEqual(
      [
        "busywork",
        "duplicate",
        "gaming",
        "low_quality",
        "out_of_scope",
        "scam",
        "spam",
      ].sort(),
    );
    // Categories the bot defines but the guide does not publish stay out.
    for (const unpublished of ["empty", "missing_evidence"] as const) {
      expect(PENALTY_TABLE[unpublished].debitThirds).toBe(0);
      expect(covered).not.toContain(unpublished);
    }
  });

  test("the quoted-rule row covers busywork and gaming, one shared rule", () => {
    const row = PENALTY_ROWS.find(
      (entry) => entry.category === "Clear violation of a quoted project rule",
    );
    expect(row?.slopbotCategories).toEqual(["busywork", "gaming"]);
    expect(PENALTY_TABLE.busywork).toEqual(PENALTY_TABLE.gaming);
  });
});
