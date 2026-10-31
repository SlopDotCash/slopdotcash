/**
 * Policy and window omissions preserve a prior review award, while a genuine
 * zero-share allocation exclusion corrects it to zero. These tests pin the
 * distinction in the Points layer (PRD section 7) for value reviews.
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
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import {
  AFTER_NOVEMBER,
  GENERATED_AT,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

beforeAll(() => setSystemTime(new Date("2026-12-08T00:00:00.000Z")));
afterAll(() => setSystemTime());

const reviewer1: GitHubActor = {
  id: "MDQ6VXNlcjQ0",
  login: "reviewer-1",
  avatarUrl: "https://avatars.githubusercontent.com/u/48?v=4",
  url: "https://github.com/reviewer-1",
  kind: "User",
};
const reviewer2: GitHubActor = {
  id: "MDQ6VXNlcjQx",
  login: "reviewer-2",
  avatarUrl: "https://avatars.githubusercontent.com/u/49?v=4",
  url: "https://github.com/reviewer-2",
  kind: "User",
};

function build(
  reviews: {
    id: string;
    author: GitHubActor;
    submittedAt: string;
    tier: "triage" | "specialist";
  }[],
  generatedAt = GENERATED_AT,
) {
  const census = penaltyScoreInput([], generatedAt);
  // Synthetic fixture snapshots still need the registry inventory that Points
  // uses when deciding whether an adverse exclusion can correct a prior award.
  census.repositories = [...TARGET_REPOSITORIES];
  if (generatedAt !== GENERATED_AT) {
    // The reusable fixture has October work that the later window omits.
    census.mergedPullRequests = census.mergedPullRequests.filter(
      (row) => row.id === "PR_november",
    );
  }
  const pull = census.mergedPullRequests.find(
    (row) => row.id === "PR_november",
  );
  if (!pull?.mergedAt) throw new Error("missing fixture pull request");
  pull.reviews = reviews.map((review, index) => ({
    id: review.id,
    body: "Looks good.",
    state: "APPROVED" as const,
    submittedAt: review.submittedAt,
    url: `${pull.url}#pullrequestreview-${index + 1}`,
    author: review.author,
    inlineCommentCount: 0,
  }));
  census.detailEligibleMergedPullRequestIds = [];
  // Only the fields review allocation reads; readValueDecision validates the
  // stored journal record before a snapshot is generated.
  const decision = {
    status: "assessed",
    implementationActorNodeIds: [],
    record: {
      pullRequestNodeId: pull.id,
      repository: "elizaOS/asi",
      headSha: pull.headRefOid,
      occurredAt: pull.mergedAt,
      assessment: { tier: "medium", reviews: [] },
    },
    assessment: {
      status: "assessed",
      tier: "medium",
      reviews: reviews.map((review) => ({
        sourceId: review.id,
        tier: review.tier,
        finding: "confirms the fix",
        outcome: "useful validation",
      })),
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

function journalWithPriorReview(
  reviewId: string,
  sourceUrl: string,
  occurredAt: string,
) {
  const award = {
    key: pointKey("asi", reviewer1.id, "substantive-review", reviewId),
    actor: { id: reviewer1.id, login: reviewer1.login },
    projectId: "asi",
    category: "substantive-review" as const,
    amount: 10,
    occurredAt,
    sourceId: reviewId,
    sourceUrl,
    workUnitId: `wu_value_review_${reviewId.toLowerCase()}`,
    provisional: true,
  };
  return appendPointAwards(
    {
      schemaVersion: "1",
      ruleVersion: "slop-points-v1",
      generatedAt: GENERATED_AT,
      coverage: [
        {
          repository: "elizaOS/asi",
          from: "2026-11-01T00:00:00.000Z",
          to: GENERATED_AT,
          digest: "a".repeat(64),
        },
      ],
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
  const snapshot = build([
    {
      id: "PRR_points",
      author: reviewer1,
      submittedAt: "2026-10-31T12:00:00.000Z",
      tier: "triage",
    },
  ]);
  const prior = journalWithPriorReview(
    "PRR_points",
    sourceUrl,
    "2026-10-31T12:00:00.000Z",
  );
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
  // The December run starts scoring on 2 November. This review is under the
  // value policy but before the current scoring window; Points must keep its
  // prior award unchanged.
  const sourceUrl =
    "https://github.com/SlopDotCash/asi/pull/8#pullrequestreview-1";
  const snapshot = build(
    [
      {
        id: "PRR_points",
        author: reviewer1,
        submittedAt: "2026-11-01T12:00:00.000Z",
        tier: "specialist",
      },
    ],
    "2026-12-08T00:00:00.000Z",
  );
  const prior = journalWithPriorReview(
    "PRR_points",
    sourceUrl,
    "2026-11-01T12:00:00.000Z",
  );
  expect(snapshot.reviewExclusions?.map((entry) => entry.reason)).toEqual([
    "review-credit-outside-window",
  ]);
  expect(snapshot.reviewExclusions?.[0]?.reviewId).toBe("PRR_points");
  const updated = applyPointsSnapshot(
    prior,
    snapshot,
    "b".repeat(64),
    "2026-12-08T00:00:00.000Z",
  );
  expect(
    latestPoints(updated).get(prior.revisions[0]?.award.key)?.award,
  ).toEqual(prior.revisions[0]?.award);
});

test("a zero-share exclusion corrects its prior in-window review award", () => {
  // A medium pull request has only nine review-credit thirds. The specialist
  // consumes the whole pool, so the triage reviewer receives a zero share.
  // The prior journal carries recorded coverage, so it is not a retained batch.
  const triageUrl =
    "https://github.com/SlopDotCash/asi/pull/8#pullrequestreview-2";
  const snapshot = build([
    {
      id: "PRR_specialist",
      author: reviewer1,
      submittedAt: "2026-11-01T12:00:00.000Z",
      tier: "specialist",
    },
    {
      id: "PRR_triage",
      author: reviewer2,
      submittedAt: "2026-11-02T12:00:00.000Z",
      tier: "triage",
    },
  ]);
  const prior = journalWithPriorReview(
    "PRR_triage",
    triageUrl,
    "2026-11-02T12:00:00.000Z",
  );
  expect(snapshot.reviewExclusions?.map((entry) => entry.reason)).toEqual([
    "review-credit-zero-share",
  ]);
  expect(snapshot.reviewExclusions?.[0]?.reviewId).toBe("PRR_triage");
  const reviewEvents = snapshot.ledger.filter(
    (event) => event.category === "substantive-review",
  );
  expect(reviewEvents.map((event) => event.source.id)).toEqual([
    "PRR_specialist",
  ]);
  expect(reviewEvents[0]?.scoreThirds).toBe(9);
  expect(reviewEvents[0]?.reason).toContain(
    "reviewer 1 of 2 credited, 9 of 9 review-credit thirds",
  );
  const updated = applyPointsSnapshot(
    prior,
    snapshot,
    "b".repeat(64),
    AFTER_NOVEMBER,
  );
  expect(
    latestPoints(updated).get(prior.revisions[0]?.award.key)?.award,
  ).toEqual({
    ...prior.revisions[0]?.award,
    amount: 0,
  });
});
