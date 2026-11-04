/**
 * Copyright 2026 The Slop Authors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The profile Penalty history renders PENALTY_CATEGORY_LABELS from
 * src/lib/penalty-labels.ts and falls back to the raw category key for any
 * category missing from the map. This test pins the map to the canonical
 * PENALTY_TABLE in workers/slopbot/penalties.ts: every category must have
 * a non-empty display label that is not its raw key, so a future category
 * cannot silently render as an internal key on a contributor profile.
 */
import { describe, expect, test } from "bun:test";
import { PENALTY_CATEGORY_LABELS } from "../src/lib/penalty-labels";
import { PENALTY_TABLE } from "../workers/slopbot/penalties";

// The names the published penalty table (PRD section 7) gives its rows.
// The bot's `empty` and `missing_evidence` categories are not published
// rows and have no published name, so they are not pinned here.
const PUBLISHED_LABELS: Record<string, string> = {
  spam: "Spam",
  scam: "Scam or malicious",
  busywork: "Clear violation of a quoted project rule",
  gaming: "Clear violation of a quoted project rule",
  low_quality: "Low quality",
  duplicate: "Duplicate",
  out_of_scope: "Out of scope",
};

describe("profile penalty category labels", () => {
  test("covers every category in the canonical penalty table", () => {
    expect(Object.keys(PENALTY_CATEGORY_LABELS).sort()).toEqual(
      Object.keys(PENALTY_TABLE).sort(),
    );
  });

  test("no category falls back to its raw key", () => {
    for (const category of Object.keys(PENALTY_TABLE)) {
      const label =
        PENALTY_CATEGORY_LABELS[
          category as keyof typeof PENALTY_CATEGORY_LABELS
        ];
      expect(label).toBeString();
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(category);
    }
  });

  test("published rows carry their published names", () => {
    for (const [category, label] of Object.entries(PUBLISHED_LABELS)) {
      expect(
        PENALTY_CATEGORY_LABELS[
          category as keyof typeof PENALTY_CATEGORY_LABELS
        ],
      ).toBe(label);
    }
  });
});
