import { expect, test } from "bun:test";
import { parsePreCensusReviewRecoveries } from "../src/lib/pre-census-review-recovery";

const actor = {
  id: "U_recovery",
  login: "reviewer",
  avatarUrl: "https://avatars.githubusercontent.com/u/1?v=1",
  url: "https://github.com/reviewer",
  kind: "User",
};

function recovery(decision = "award") {
  return {
    id: "recovery-1",
    decision,
    repository: "SlopDotCash/slopdotcash",
    pullRequestNumber: 730,
    pullRequestTitle: "fix(settlement): reject pre-plan replay",
    pullRequestUrl: "https://github.com/SlopDotCash/slopdotcash/pull/730",
    reviewedHeadOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    mergedHeadOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    mergeCommitOid: "cccccccccccccccccccccccccccccccccccccccc",
    mergedAt: "2026-10-14T16:00:00Z",
    responseCommitOids: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    actor,
    review: {
      id: "5514965110",
      url: "https://github.com/SlopDotCash/slopdotcash/pull/730#pullrequestreview-5514965110",
      state: "CHANGES_REQUESTED",
      submittedAt: "2026-10-14T08:00:00Z",
      commitId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      body: "The replay guard needs an executable regression and a positive control.",
      inlineCommentCount: 0,
    },
    lifecycleReviewIds: ["5514965110", "5514965111"],
    continuity: {
      sourceSnapshotSha256:
        "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      decisionUrl: "https://github.com/SlopDotCash/slopdotcash/issues/797",
    },
    ...(decision === "exclude"
      ? { exclusionReason: "pull-request-review-awarded" }
      : {}),
  };
}

test("materializes one bounded pre-census award", () => {
  const result = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [recovery()],
  });
  expect(result.events).toHaveLength(1);
  expect(result.exclusions).toHaveLength(0);
  expect(result.events[0]).toMatchObject({
    category: "substantive-review",
    scoreThirds: 1,
    points: 1 / 3,
    source: {
      id: "5514965110",
      number: 730,
    },
    continuity: {
      decisionUrl: "https://github.com/SlopDotCash/slopdotcash/issues/797",
    },
  });
});

test("publishes an explicit exclusion without creating score", () => {
  const result = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [recovery("exclude")],
  });
  expect(result.events).toEqual([]);
  expect(result.exclusions[0]).toMatchObject({
    reviewId: "5514965110",
    reason: "pull-request-review-awarded",
  });
});

test("rejects duplicate pull requests and uncausal review heads", () => {
  const first = recovery();
  expect(() =>
    parsePreCensusReviewRecoveries({
      schemaVersion: "1",
      recoveries: [first, { ...first, id: "recovery-2" }],
    }),
  ).toThrow("one decision per pull request");

  expect(() =>
    parsePreCensusReviewRecoveries({
      schemaVersion: "1",
      recoveries: [
        {
          ...first,
          reviewedHeadOid: first.mergedHeadOid,
          review: { ...first.review, commitId: first.mergedHeadOid },
        },
      ],
    }),
  ).toThrow("changed accepted outcome");
});

test("normalizes repository case and registry aliases to the canonical id", () => {
  const mixed = recovery();
  const canonical = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [
      {
        ...mixed,
        repository: "slopdotcash/slopDOTcash",
        pullRequestUrl: "https://github.com/slopdotcash/slopdotcash/pull/730",
        review: {
          ...mixed.review,
          url: "https://github.com/slopdotcash/slopdotcash/pull/730#pullrequestreview-5514965110",
        },
      },
    ],
  });
  expect(canonical.events[0]?.repository).toBe("SlopDotCash/slopdotcash");

  const alias = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [
      {
        ...mixed,
        repository: "SlopDotCash/asi",
        pullRequestNumber: 5,
        pullRequestUrl: "https://github.com/SlopDotCash/asi/pull/5",
        review: {
          ...mixed.review,
          id: "5514965120",
          url: "https://github.com/SlopDotCash/asi/pull/5#pullrequestreview-5514965120",
        },
        lifecycleReviewIds: ["5514965120"],
      },
    ],
  });
  expect(alias.events[0]?.repository).toBe("elizaOS/asi");

  const excluded = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [
      { ...mixed, decision: "exclude", exclusionReason: "post-merge" },
    ],
  });
  expect(excluded.exclusions[0]?.repository).toBe("SlopDotCash/slopdotcash");

  expect(() =>
    parsePreCensusReviewRecoveries({
      schemaVersion: "1",
      recoveries: [
        mixed,
        { ...mixed, id: "recovery-2", repository: "slopdotcash/slopdotcash" },
      ],
    }),
  ).toThrow("one decision per pull request");
});

test("rejects a URL that belongs to another repository", () => {
  const differentPullRequestUrl = recovery();
  expect(() =>
    parsePreCensusReviewRecoveries({
      schemaVersion: "1",
      recoveries: [
        {
          ...differentPullRequestUrl,
          pullRequestUrl: "https://github.com/elizaOS/eliza/pull/730",
        },
      ],
    }),
  ).toThrow("must belong to");

  const differentReviewUrl = recovery();
  expect(() =>
    parsePreCensusReviewRecoveries({
      schemaVersion: "1",
      recoveries: [
        {
          ...differentReviewUrl,
          review: {
            ...differentReviewUrl.review,
            url: "https://github.com/elizaOS/eliza/pull/730#pullrequestreview-5514965110",
          },
        },
      ],
    }),
  ).toThrow("must belong to");
});
