/**
 * A policy or window omission preserves a prior review award, while an adverse
 * allocation exclusion can correct it to zero. These tests pin the distinction
 * in the Points layer (PRD section 7) for value reviews.
 */

import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import type {
  GitHubActor,
  LeaderboardInput,
} from "../src/lib/leaderboard-types";
import {
  appendPointAwards,
  applyPointsSnapshot,
  latestPoints,
  pointKey,
} from "../src/lib/points";
import {
  AFTER_NOVEMBER,
  GENERATED_AT,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

beforeAll(() => setSystemTime(new Date(GENERATED_AT)));
afterAll(() => setSystemTime());
const reviewer: GitHubActor = {
  id: "MDQ6VXNlcjQ0",
  login: "reviewer",
  avatarUrl: "https://avatars.githubusercontent.com/u/44?v=4",
  url: "https://github.com/reviewer",
  kind: "User",
};

function build(submittedAt: string) {
  const census = penaltyScoreInput([], GENERATED_AT);
  const pull = census.mergedPullRequests.find(
    (row) => row.id === "PR_november",
  );
  if (!pull?.mergedAt) throw new Error("missing fixture pull request");
  pull.reviews = [
    {
      id: "PRR_points",
      body: "Looks good.",
      state: "APPROVED",
      submittedAt,
      url: `${pull.url}#pullrequestreview-1`,
      author: reviewer,
      inlineCommentCount: 0,
    },
  ];

  const decision = {
    status: "assessed",
    implementationActorNodeIds: [],
    record: {
      pullRequestNodeId: pull.id,
      repository: "elizaOS/asi",
      headSha: pull.headRefOid,
      occurredAt: pull.mergedAt,
      assessment: {
        tier: "micro",
        reviews: [
          {
            sourceId: "PRR_points",
            tier: "triage",
            finding: "validates the fix",
            outcome: "useful validation",
          },
        ],
      },
    },
    assessment: {
      status: "assessed",
      tier: "medium",
      reviews: [
        {
          sourceId: "PRR_points",
          tier: "triage",
          finding: "confirms the fix",
          outcome: "useful validation",
        },
      ],
    },
    history: [
      {
        sequence: 1,
        record_digest: "e".repeat(64),
        record_json: "{}",
        recorded_at: "2026-11-05T01:00:00.000Z",
      },
    ],
    latestDigest: "d".repeat(64),
  };
  census.valueDecisions = new Map([
    [
      pull.id,
      decision as unknown as NonNullable<
        LeaderboardInput["valueDecisions"]
      > extends ReadonlyMap<string, infer V>
        ? V
        : never,
    ],
  ]);
  return createLeaderboardSnapshot(census);
}

function journalWithPriorReview(sourceUrl: string, occurredAt: string) {
  const award = {
    key: pointKey("asi", reviewer.id, "substantive-review", "PRR_points"),
    actor: { id: reviewer.id, login: reviewer.login },
    projectId: "asi",
    category: "substantive-review" as const,
    amount: 10,
    occurredAt,
    sourceId: "PRR_points",
    sourceUrl,
    workUnitId: "wu_value_review_prr_points",
    provisional: true,
  };
  return appendPointAwards(
    {
      schemaVersion: "1",
      ruleVersion: "slop-points-v1",
      generatedAt: GENERATED_AT,
      coverage: [],
      revisions: [],
    },
    [award],
    "a".repeat(64),
    "slop-score-v2",
    GENERATED_AT,
  );
}

test("a before-policy review omission keeps its prior review award", () => {
  const sourceUrl =
    "https://github.com/SlopDotCash/asi/pull/8#pullrequestreview-1";
  const snapshot = build("2026-10-31T12:00:00.000Z");
  const prior = journalWithPriorReview(sourceUrl, "2026-10-31T12:00:00.000Z");
  expect(snapshot.reviewExclusions?.map((entry) => entry.reason)).toEqual([
    "review-credit-before-policy",
  ]);
  const updated = applyPointsSnapshot(
    prior,
    snapshot,
    "b".repeat(64),
    AFTER_NOVEMBER,
  );
  expect(
    latestPoints(updated).get(prior.revisions[0]?.award.key)?.award,
  ).toEqual(prior.revisions[0]?.award);
});

test("an outside-window review omission keeps its prior review award", () => {
  const sourceUrl =
    "https://github.com/SlopDotCash/asi/pull/8#pullrequestreview-1";
  const snapshot = build("2026-10-25T12:00:00.000Z");
  const prior = journalWithPriorReview(sourceUrl, "2026-10-25T12:00:00.000Z");
  expect(snapshot.reviewExclusions?.map((entry) => entry.reason)).toEqual([
    "review-credit-before-policy",
  ]);
  const updated = applyPointsSnapshot(
    prior,
    snapshot,
    "b".repeat(64),
    AFTER_NOVEMBER,
  );
  expect(
    latestPoints(updated).get(prior.revisions[0]?.award.key)?.award,
  ).toEqual(prior.revisions[0]?.award);
});
test("a zero-share exclusion corrects its prior in-window review award", () => {
  const sourceUrl =
    "https://github.com/SlopDotCash/asi/pull/8#pullrequestreview-1";
  const snapshot = build("2026-11-04T12:00:00.000Z");
  const prior = journalWithPriorReview(sourceUrl, "2026-11-04T12:00:00.000Z");
  const updated = applyPointsSnapshot(
    prior,
    snapshot,
    "b".repeat(64),
    AFTER_NOVEMBER,
  );
  expect(
    latestPoints(updated).get(prior.revisions[0]?.award.key)?.award,
  ).toEqual(prior.revisions[0]?.award);
});
