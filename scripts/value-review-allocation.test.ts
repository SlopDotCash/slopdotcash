/**
 * PRD section 7 allocates one review pool per pull request: at most five
 * distinct eligible reviewers, each credited by its highest assessed band,
 * with the pool capped by the pull request's assessed size. These tests cover
 * the published exclusions around that allocation and the resulting ledger.
 */
import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import type {
  GitHubActor,
  LeaderboardInput,
  ReviewExclusionReason,
} from "../src/lib/leaderboard-types";
import {
  GENERATED_AT,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

const NOW = "2026-12-08T00:00:00.000Z";
beforeAll(() => setSystemTime(new Date(NOW)));
afterAll(() => setSystemTime());

const REVIEW_TIERS = {
  none: 0,
  triage: 1,
  standard: 3,
  deep: 9,
  specialist: 24,
} as const;
type ReviewTier = keyof typeof REVIEW_TIERS;

const reviewer = (index: number): GitHubActor => ({
  id: `MDQ6VXNlcjQ${40 + index}`,
  login: `reviewer-${index}`,
  avatarUrl: `https://avatars.githubusercontent.com/u/${40 + index}?v=4`,
  url: `https://github.com/reviewer-${index}`,
  kind: "User",
});

function build(
  reviews: {
    id: string;
    author: GitHubActor;
    submittedAt: string;
    tier: ReviewTier;
  }[],
  generatedAt = GENERATED_AT,
) {
  const census = penaltyScoreInput([], generatedAt);
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

const reviewEvents = (snapshot: ReturnType<typeof createLeaderboardSnapshot>) =>
  snapshot.ledger.filter((event) => event.category === "substantive-review");
const exclusionReasons = (
  snapshot: ReturnType<typeof createLeaderboardSnapshot>,
): ReviewExclusionReason[] =>
  (snapshot.reviewExclusions ?? []).map((entry) => entry.reason);

test("credits only the first five distinct qualifying reviewers", () => {
  const snapshot = build([
    {
      id: "PRR_1",
      author: reviewer(1),
      submittedAt: "2026-11-01T12:00:00.000Z",
      tier: "standard",
    },
    {
      id: "PRR_2",
      author: reviewer(2),
      submittedAt: "2026-11-02T12:00:00.000Z",
      tier: "standard",
    },
    {
      id: "PRR_3",
      author: reviewer(3),
      submittedAt: "2026-11-03T12:00:00.000Z",
      tier: "standard",
    },
    {
      id: "PRR_4",
      author: reviewer(4),
      submittedAt: "2026-11-04T10:00:00.000Z",
      tier: "standard",
    },
    {
      id: "PRR_5",
      author: reviewer(5),
      submittedAt: "2026-11-04T11:00:00.000Z",
      tier: "standard",
    },
    {
      id: "PRR_6",
      author: reviewer(6),
      submittedAt: "2026-11-04T12:00:00.000Z",
      tier: "standard",
    },
  ]);
  expect(exclusionReasons(snapshot)).toEqual(["review-credit-reviewer-limit"]);
  expect(reviewEvents(snapshot).map((event) => event.actor.login)).toEqual([
    "reviewer-1",
    "reviewer-2",
    "reviewer-3",
    "reviewer-4",
    "reviewer-5",
  ]);
  // Five equal standard bands in a medium pool use largest remainders.
  expect(reviewEvents(snapshot).map((event) => event.scoreThirds)).toEqual([
    2, 2, 2, 2, 1,
  ]);
  expect(snapshot.reviewExclusions?.[0]?.reviewId).toBe("PRR_6");
});

test("credits a repeated reviewer once at its highest band", () => {
  const snapshot = build([
    {
      id: "PRR_low",
      author: reviewer(1),
      submittedAt: "2026-11-02T12:00:00.000Z",
      tier: "triage",
    },
    {
      id: "PRR_high",
      author: reviewer(1),
      submittedAt: "2026-11-03T12:00:00.000Z",
      tier: "specialist" as ReviewTier,
    },
  ]);
  expect(exclusionReasons(snapshot)).toEqual(["already-awarded-reviewer"]);
  expect(snapshot.reviewExclusions?.[0]?.reviewId).toBe("PRR_low");
  const events = reviewEvents(snapshot);
  expect(events.map((event) => event.source.id)).toEqual(["PRR_high"]);
  // The specialist band is capped by the medium pull request's assessed size.
  expect(events[0]?.scoreThirds).toBe(9);
});

test("excludes an early policy review without consuming a reviewer slot", () => {
  const snapshot = build([
    {
      id: "PRR_early_policy",
      author: reviewer(1),
      submittedAt: "2026-10-25T12:00:00.000Z",
      tier: "specialist" as ReviewTier,
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `PRR_${index + 1}`,
      author: reviewer(index + 2),
      submittedAt:
        index < 3
          ? `2026-11-0${index + 1}T10:00:00.000Z`
          : `2026-11-04T${10 + index - 3}:00:00.000Z`,
      tier: "standard" as ReviewTier,
    })),
  ]);
  expect(exclusionReasons(snapshot)).toEqual(["review-credit-before-policy"]);
  const events = reviewEvents(snapshot);
  expect(events.map((event) => event.actor.login)).toEqual([
    "reviewer-2",
    "reviewer-3",
    "reviewer-4",
    "reviewer-5",
    "reviewer-6",
  ]);
  expect(events.map((event) => event.source.id)).toEqual([
    "PRR_1",
    "PRR_2",
    "PRR_3",
    "PRR_4",
    "PRR_5",
  ]);
});

test("omits an allocated review submitted before the scoring window", () => {
  // The December run starts scoring on 2 December. This review is under the
  // November value policy, inside the acceptance allocation, but before the
  // current scoring window; Points must keep any prior award unchanged.
  const snapshot = build(
    [
      {
        id: "PRR_before_window",
        author: reviewer(1),
        submittedAt: "2026-11-01T12:00:00.000Z",
        tier: "specialist" as ReviewTier,
      },
      {
        id: "PRR_in_window",
        author: reviewer(2),
        submittedAt: "2026-11-02T12:00:00.000Z",
        tier: "standard",
      },
    ],
    "2026-12-07T00:00:00.000Z",
  );
  expect(exclusionReasons(snapshot)).toEqual(["review-credit-outside-window"]);
  expect(snapshot.reviewExclusions?.[0]?.reviewId).toBe("PRR_before_window");
  const events = reviewEvents(snapshot);
  expect(events.map((event) => event.source.id)).toEqual(["PRR_in_window"]);
  expect(events[0]?.occurredAt).toBe("2026-11-02T12:00:00.000Z");
});

test("publishes a zero share when the size cap exhausts the pool", () => {
  const snapshot = build([
    {
      id: "PRR_specialist",
      author: reviewer(1),
      submittedAt: "2026-11-01T12:00:00.000Z",
      tier: "specialist" as ReviewTier,
    },
    {
      id: "PRR_triage",
      author: reviewer(2),
      submittedAt: "2026-11-02T12:00:00.000Z",
      tier: "triage",
    },
  ]);
  expect(exclusionReasons(snapshot)).toEqual(["review-credit-zero-share"]);
  expect(snapshot.reviewExclusions?.[0]?.reviewId).toBe("PRR_triage");
  const events = reviewEvents(snapshot);
  expect(events.map((event) => event.source.id)).toEqual(["PRR_specialist"]);
  expect(events[0]?.scoreThirds).toBe(9);
  expect(events[0]?.reason).toContain(
    "reviewer 1 of 2 credited, 9 of 9 review-credit thirds",
  );
});

function buildBanned() {
  const census = penaltyScoreInput([], GENERATED_AT);
  const author = reviewer(1);
  const pull = census.mergedPullRequests.find(
    (row) => row.id === "PR_november",
  );
  if (!pull?.mergedAt) throw new Error("missing fixture pull request");
  pull.reviews = [
    {
      id: "PRR_banned",
      body: "Looks good.",
      state: "APPROVED",
      submittedAt: "2026-11-01T12:00:00.000Z",
      url: `${pull.url}#pullrequestreview-1`,
      author,
      inlineCommentCount: 0,
    },
  ];
  census.detailEligibleMergedPullRequestIds = [];
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
      reviews: [
        {
          sourceId: "PRR_banned",
          tier: "standard",
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
  census.participationBans = new Map([[author.id, "2026-10-01T00:00:00.000Z"]]);
  return createLeaderboardSnapshot(census);
}

test("excludes a banned reviewer before selecting credited reviewers", () => {
  const snapshot = buildBanned();
  expect(exclusionReasons(snapshot)).toEqual(["review-credit-account-banned"]);
  expect(reviewEvents(snapshot)).toEqual([]);
});

test("excludes a review collected before the value policy boundary", () => {
  const snapshot = build([
    {
      id: "PRR_before_policy",
      author: reviewer(1),
      submittedAt: "2026-10-20T12:00:00.000Z",
      tier: "specialist" as ReviewTier,
    },
  ]);
  expect(exclusionReasons(snapshot)).toEqual(["review-credit-before-policy"]);
  expect(reviewEvents(snapshot)).toEqual([]);
});

test("excludes an assessed zero-band review from review credit", () => {
  const snapshot = build([
    {
      id: "PRR_none",
      author: reviewer(1),
      submittedAt: "2026-11-01T12:00:00.000Z",
      tier: "none" as ReviewTier,
    },
  ]);
  expect(exclusionReasons(snapshot)).toEqual(["review-credit-zero-share"]);
  expect(reviewEvents(snapshot)).toEqual([]);
});
