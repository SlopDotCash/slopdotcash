/**
 * A bot or post-merge review takes no review-credit share, but it must not
 * fail the whole snapshot. The published qualification (PRD section 7) says
 * those reviews do not qualify; the legacy review path excludes them with a
 * reason, while the value path threw and aborted generation.
 */
import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import type {
  GitHubActor,
  LeaderboardInput,
} from "../src/lib/leaderboard-types";
import {
  AFTER_NOVEMBER,
  GENERATED_AT,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

beforeAll(() => setSystemTime(new Date(AFTER_NOVEMBER)));
afterAll(() => setSystemTime());

const REVIEWED_AT = "2026-11-04T12:00:00.000Z";
const bot: GitHubActor = {
  id: "BOT_copilot",
  login: "copilot-pull-request-reviewer[bot]",
  avatarUrl: "https://avatars.githubusercontent.com/in/946600?v=4",
  url: "https://github.com/apps/copilot-pull-request-reviewer",
  kind: "Bot",
};
const human: GitHubActor = {
  id: "MDQ6VXNlcjQ0",
  login: "reviewer",
  avatarUrl: "https://avatars.githubusercontent.com/u/44?v=4",
  url: "https://github.com/reviewer",
  kind: "User",
};

function build(input: {
  author: GitHubActor;
  submittedAt: string;
  assessedReview?: boolean;
}) {
  const census = penaltyScoreInput([], GENERATED_AT);
  const pull = census.mergedPullRequests.find(
    (row) => row.id === "PR_november",
  );
  if (!pull?.mergedAt) throw new Error("missing fixture pull request");
  const reviewId = "PRR_fixture";
  pull.reviews = [
    {
      id: reviewId,
      body: "Looks good.",
      state: "APPROVED",
      submittedAt: input.submittedAt,
      url: `${pull.url}#pullrequestreview-1`,
      author: input.author,
      inlineCommentCount: 0,
    },
  ];
  census.detailEligibleMergedPullRequestIds = [];
  // Only the fields the review allocation reads; the journal record itself
  // is validated by readValueDecision before a snapshot is generated.
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
      reviews:
        input.assessedReview === false
          ? []
          : [
              {
                sourceId: reviewId,
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
  return createLeaderboardSnapshot(census);
}

test("a bot review is excluded instead of failing value review scoring", () => {
  const snapshot = build({ author: bot, submittedAt: REVIEWED_AT });
  expect(
    (snapshot.reviewExclusions ?? []).map((entry) => entry.reason),
  ).toEqual(["bot-reviewer"]);
  expect(
    snapshot.ledger.filter((event) => event.category === "substantive-review"),
  ).toEqual([]);
});

test("a bot review the assessment omits is still excluded", () => {
  const snapshot = build({
    author: bot,
    submittedAt: REVIEWED_AT,
    assessedReview: false,
  });
  expect(
    (snapshot.reviewExclusions ?? []).map((entry) => entry.reason),
  ).toEqual(["bot-reviewer"]);
});

test("a review submitted after the merge is excluded", () => {
  const snapshot = build({
    author: human,
    submittedAt: "2026-11-06T00:00:00.000Z",
  });
  expect(
    (snapshot.reviewExclusions ?? []).map((entry) => entry.reason),
  ).toEqual(["post-merge"]);
});

test("a qualifying human review keeps its credit", () => {
  const snapshot = build({ author: human, submittedAt: REVIEWED_AT });
  expect(snapshot.reviewExclusions ?? []).toEqual([]);
  const reviews = snapshot.ledger.filter(
    (event) => event.category === "substantive-review",
  );
  expect(reviews.map((event) => event.actor.login)).toEqual(["reviewer"]);
  expect(reviews[0]?.scoreThirds).toBeGreaterThan(0);
});
