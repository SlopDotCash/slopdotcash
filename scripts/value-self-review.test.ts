/**
 * Self-review in the value review path (PRD section 7): an author already
 * credited for a merge earns no review credit on that pull request, even when
 * the assessment places the review in a unit whose own claims name someone
 * else.
 */
import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  AFTER_NOVEMBER,
  GENERATED_AT,
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

beforeAll(() => setSystemTime(new Date(AFTER_NOVEMBER)));
afterAll(() => setSystemTime());

const CLAIM = "a".repeat(64);
const REVIEW_ID = "PRR_credited_author";

function snapshotWithReviewBy(reviewer: typeof PROJECT_OWNER) {
  const input = penaltyScoreInput([], GENERATED_AT);
  const pull = input.mergedPullRequests.find(
    (record) => record.id === "PR_november",
  );
  if (!pull?.mergedAt) throw new Error("fixture pull request missing");
  const review = {
    id: REVIEW_ID,
    body: "Checked the fix against the failing case.",
    state: "APPROVED" as const,
    submittedAt: "2026-11-04T12:00:00.000Z",
    url: `${pull.url}#pullrequestreview-1`,
    author: reviewer,
    inlineCommentCount: 0,
  };
  pull.reviews = [review];
  input.detailEligibleMergedPullRequestIds = [];
  input.valueActors = new Map([
    [PENALIZED_AUTHOR.id, PENALIZED_AUTHOR],
    [PROJECT_OWNER.id, PROJECT_OWNER],
  ]);
  const decision = {
    status: "assessed",
    latestDigest: "d".repeat(64),
    history: [{ recorded_at: "2026-11-05T01:00:00.000Z" }],
    record: {
      sources: [{ pullRequestNodeId: pull.id, headSha: pull.headRefOid }],
      units: [
        {
          workUnitId: "wu_implementation",
          claimIds: [CLAIM],
          assessment: {
            status: "assessed",
            tier: "micro",
            rationale: "Fixture unit.",
            reviews: [],
          },
        },
        {
          workUnitId: "wu_review",
          claimIds: [],
          assessment: {
            status: "assessed",
            tier: null,
            rationale: "Fixture review unit.",
            reviews: [
              {
                sourceId: REVIEW_ID,
                tier: "standard",
                finding: "confirms the fix",
                outcome: "useful validation",
              },
            ],
          },
        },
      ],
    },
    evidence: {
      claims: [
        {
          id: CLAIM,
          carrierPullRequestIds: [pull.id],
          creditPullRequestId: pull.id,
          implementationActorNodeIds: [PROJECT_OWNER.id],
        },
      ],
      sources: [
        {
          evidence: {
            repository: "SlopDotCash/asi",
            pull: {
              node_id: pull.id,
              number: pull.number,
              title: pull.title,
              html_url: pull.url,
              head: { sha: pull.headRefOid },
              updated_at: pull.updatedAt,
              merged_at: pull.mergedAt,
              closed_at: pull.closedAt,
              user: { node_id: PENALIZED_AUTHOR.id },
            },
            comments: [],
            reviews: [
              {
                node_id: review.id,
                body: review.body,
                user: { node_id: reviewer.id },
                submitted_at: review.submittedAt,
              },
            ],
          },
        },
      ],
    },
  };
  input.jointValueDecisions = new Map([[pull.id, decision as never]]);
  return createLeaderboardSnapshot(input);
}

test("a review by an author already credited for the merge is self-review", () => {
  const snapshot = snapshotWithReviewBy(PROJECT_OWNER);
  expect(
    snapshot.ledger
      .filter((event) => event.source.id === "PR_november")
      .map((event) => [event.category, event.actor.id]),
  ).toEqual([["merged-pull-request", PROJECT_OWNER.id]]);
  expect(
    (snapshot.reviewExclusions ?? [])
      .filter((exclusion) => JSON.stringify(exclusion).includes(REVIEW_ID))
      .map((exclusion) => exclusion.reason),
  ).toEqual(["self-review"]);
});
