// The published penalty table (PRD section 7) and the contributor profile
// both state a penalty debit in points (POINTS_PER_THIRD = 10 per score
// third). The Slopbot close notice must state the same figure in the same
// unit, or the contributor cannot reconcile the notice with their profile.
import { expect, test } from "bun:test";
import { commentBody } from "./review";

function closeBody(
  penalty: {
    category: string;
    debit_thirds: number;
    moderator_review: 0 | 1;
  } | null,
): string {
  return commentBody({
    verdict: {
      category: penalty?.category ?? "low_quality",
      summary: "s",
      rule_refs: [],
      evidence: [],
      limitations: [],
      objective_defect: null,
      confidence: 1,
    } as never,
    action: "close",
    blockedClose: null,
    context: {
      limitations: [],
      quality: [],
      revision: "abc",
      policyDigest: "d",
      registration: { scope: "contributor" },
    } as never,
    triage: null,
    confirm: null,
    penalty: penalty
      ? ({
          item_node_id: "x",
          author_github_id: "1",
          category: penalty.category,
          debit_thirds: penalty.debit_thirds,
          period: "2026-09",
          moderator_review: penalty.moderator_review,
          reversed_at: null,
        } as never)
      : null,
  });
}

test("penalty notice states the debit in published points", () => {
  expect(
    closeBody({ category: "spam", debit_thirds: 3, moderator_review: 0 }),
  ).toContain("removes 30 points from the author's 2026-09 Slop Score");
  expect(
    closeBody({ category: "scam", debit_thirds: 24, moderator_review: 1 }),
  ).toContain("removes 240 points from the author's 2026-09 Slop Score");
  expect(
    closeBody({ category: "busywork", debit_thirds: 1, moderator_review: 0 }),
  ).toContain("removes 10 points from the author's 2026-09 Slop Score");
  expect(
    closeBody({ category: "gaming", debit_thirds: 1, moderator_review: 0 }),
  ).toContain("removes 10 points from the author's 2026-09 Slop Score");
});

test("penalty notice never denominates the debit in thirds", () => {
  for (const [category, debit_thirds] of [
    ["spam", 3],
    ["scam", 24],
    ["busywork", 1],
    ["gaming", 1],
  ] as const) {
    expect(
      closeBody({ category, debit_thirds, moderator_review: 0 }),
    ).not.toContain("thirds of a point");
  }
});

test("a close without a penalty carries no penalty sentence", () => {
  expect(closeBody(null)).not.toContain("published penalty table");
});
