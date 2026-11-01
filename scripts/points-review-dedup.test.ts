import { expect, test } from "bun:test";
import {
  canonicalReviewIdentity,
  POINTS_RULE,
  type PointAward,
  type PointRevision,
  type PointsJournal,
  pointMembers,
  pointRevisionId,
} from "../src/lib/points";

/**
 * The manifest validator (githubUrl in src/lib/evaluator-awards.ts) accepts a
 * review source URL by comparing the whole pathname case-folded, so an
 * evaluated-contribution award can legitimately carry an uppercase "/PULL/"
 * path. The dedup identity must accept the same forms; otherwise the
 * evaluated-review suppression (PRD section 14 anti-duplication rule) misses
 * the pair and the same review is counted twice.
 */

const CANONICAL = "https://github.com/owner/repo/pull/123#pullrequestreview-9";

test("URL variants the manifest validator accepts share one identity", () => {
  const variants = [
    "https://github.com/Owner/Repo/pull/123#pullrequestreview-9",
    "https://github.com/owner/repo/PULL/123#pullrequestreview-9",
    "https://github.com/owner/repo/pull/123#PullRequestReview-9",
    "https://github.com/owner/repo/pull/123#DISCUSSION_R9",
    "https://github.com:443/owner/repo/pull/123#pullrequestreview-9",
  ];
  const canonical = canonicalReviewIdentity(CANONICAL);
  expect(canonical).toBe("owner/repo/pull/123");
  for (const variant of variants) {
    expect(canonicalReviewIdentity(variant), variant).toBe(canonical);
  }
});

test("different PRs and rejected URLs keep distinct or no identity", () => {
  // A different PR number is a different review.
  expect(
    canonicalReviewIdentity(
      "https://github.com/owner/repo/pull/124#pullrequestreview-9",
    ),
  ).not.toBe(canonicalReviewIdentity(CANONICAL));
  // Different fragment spellings of the same reviewed PR collapse together:
  // the suppression is per reviewed pull request.
  expect(
    canonicalReviewIdentity(
      "https://github.com/owner/repo/pull/123#pullrequestreview-10",
    ),
  ).toBe(canonicalReviewIdentity(CANONICAL));
  expect(
    canonicalReviewIdentity(
      "https://github.com/owner/repo/pull/123#discussion_r10",
    ),
  ).toBe(canonicalReviewIdentity(CANONICAL));
  // Rejected by the manifest validator as well: no identity.
  for (const rejected of [
    "https://github.com/owner/repo/pull/123?ref=1#pullrequestreview-9",
    "https://github.com:8443/owner/repo/pull/123#pullrequestreview-9",
    "https://gitlab.com/owner/repo/pull/123#pullrequestreview-9",
    "https://github.com/owner/repo/issues/123#issuecomment-1",
    "https://github.com/owner/repo/pull/123",
    "https://github.com/owner/repo/pull/123#discussion_1",
  ])
    expect(canonicalReviewIdentity(rejected), rejected).toBeUndefined();
});

function award(
  category: PointAward["category"],
  sourceUrl: string,
  amount: number,
): PointAward {
  return {
    key: `key:${category}`,
    actor: { id: "A1", login: "alice" },
    projectId: "slopdotcash",
    category,
    amount,
    occurredAt: "2026-09-15T00:00:00.000Z",
    sourceId: `source:${category}`,
    sourceUrl,
    workUnitId: `wu:${category}`,
    provisional: false,
  };
}

function revision(aw: PointAward): PointRevision {
  const body = {
    previous: null,
    recordedAt: "2026-09-16T00:00:00.000Z",
    sourceDigest: "a".repeat(64),
    sourceRule: "slop-score-v2",
    award: aw,
  };
  return { id: pointRevisionId(body), ...body };
}

function journal(awards: PointAward[]): PointsJournal {
  return {
    schemaVersion: "1" as const,
    ruleVersion: POINTS_RULE,
    generatedAt: "2026-10-01T00:00:00.000Z",
    coverage: [],
    revisions: awards.map(revision),
  };
}

test("an evaluated award suppresses the matching substantive review across URL casing", () => {
  for (const evaluatedUrl of [
    "https://github.com/owner/repo/pull/123#pullrequestreview-9",
    "https://github.com/owner/repo/PULL/123#pullrequestreview-9",
    "https://github.com/Owner/Repo/pull/123#PullRequestReview-9",
  ]) {
    const members = pointMembers(
      journal([
        award("evaluated-contribution", evaluatedUrl, 100),
        award(
          "substantive-review",
          "https://github.com/owner/repo/pull/123#pullrequestreview-9",
          50,
        ),
      ]),
    ).filter((m) => m.actor.id === "A1");
    expect(members[0].total, evaluatedUrl).toBe(100);
  }
});

test("a substantive review without an evaluated award still counts", () => {
  const [member] = pointMembers(
    journal([
      award(
        "substantive-review",
        "https://github.com/owner/repo/pull/123#pullrequestreview-9",
        50,
      ),
    ]),
  ).filter((m) => m.actor.id === "A1");
  expect(member.total).toBe(50);
});
