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

function snapshotWithRoundedOutAuthor(joint: boolean) {
  const input = penaltyScoreInput([], GENERATED_AT);
  const pull = input.mergedPullRequests.find((row) => row.id === "PR_november");
  const outcome = input.mergedPullRequestOutcomes.find(
    (row) => row.id === pull?.id,
  );
  if (!pull?.mergedAt || !outcome)
    throw new Error("fixture pull request missing");
  pull.author = PROJECT_OWNER;
  outcome.author = PROJECT_OWNER;
  if (!outcome.headRefOid) throw new Error("fixture outcome head missing");
  const commits = [
    {
      oid: "a".repeat(40),
      author: PENALIZED_AUTHOR,
      parentCount: 1,
      additions: 1,
      deletions: 0,
    },
    {
      oid: outcome.headRefOid,
      author: PROJECT_OWNER,
      parentCount: 1,
      additions: 10_000,
      deletions: 0,
    },
  ];
  outcome.commits = commits;
  const review = {
    id: REVIEW_ID,
    body: "Checked the fix against the failing case.",
    state: "APPROVED" as const,
    submittedAt: "2026-11-04T12:00:00.000Z",
    url: `${pull.url}#pullrequestreview-1`,
    author: PENALIZED_AUTHOR,
    inlineCommentCount: 0,
  };
  pull.reviews = [review];
  input.detailEligibleMergedPullRequestIds = [];
  input.valueActors = new Map([
    [PENALIZED_AUTHOR.id, PENALIZED_AUTHOR],
    [PROJECT_OWNER.id, PROJECT_OWNER],
  ]);
  const assessment = {
    status: "assessed",
    tier: "micro",
    rationale: "Retained outcome value.",
    reviews: [
      {
        sourceId: review.id,
        tier: "standard",
        finding: "confirms the fix",
        outcome: "useful validation",
      },
    ],
  };
  const history = [{ recorded_at: "2026-11-05T01:00:00.000Z" }];
  const decision = joint
    ? {
        status: "assessed",
        latestDigest: "d".repeat(64),
        history,
        record: {
          sources: [{ pullRequestNodeId: pull.id, headSha: pull.headRefOid }],
          units: [
            {
              workUnitId: "wu_shared",
              claimIds: [CLAIM, "b".repeat(64)],
              assessment,
            },
          ],
        },
        evidence: {
          claims: commits.map((commit, index) => ({
            id: index === 0 ? CLAIM : "b".repeat(64),
            commitSha: commit.oid,
            path: `src/${index}.ts`,
            carrierPullRequestIds: [pull.id],
            creditPullRequestId: pull.id,
            implementationActorNodeIds: [PROJECT_OWNER.id],
          })),
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
                  user: { node_id: PROJECT_OWNER.id, type: "User" },
                },
                commits: commits.map((commit) => ({
                  sha: commit.oid,
                  parents: [{ sha: "c".repeat(40) }],
                  author: { node_id: commit.author.id, type: "User" },
                })),
                commitAttribution: commits.map((commit, index) => ({
                  sha: commit.oid,
                  limitations: [],
                  files: [
                    {
                      filename: `src/${index}.ts`,
                      status: "modified",
                      additions: commit.additions,
                      deletions: 0,
                    },
                  ],
                })),
                comments: [],
                reviews: [
                  {
                    node_id: review.id,
                    body: review.body,
                    user: { node_id: review.author.id },
                    submitted_at: review.submittedAt,
                  },
                ],
              },
            },
          ],
        },
      }
    : {
        status: "assessed",
        latestDigest: "d".repeat(64),
        history,
        implementationActorNodeIds: [PROJECT_OWNER.id],
        assessment,
        record: {
          pullRequestNodeId: pull.id,
          repository: "elizaOS/asi",
          headSha: pull.headRefOid,
          occurredAt: pull.mergedAt,
          assessment,
        },
      };
  if (joint)
    input.jointValueDecisions = new Map([[pull.id, decision as never]]);
  else input.valueDecisions = new Map([[pull.id, decision as never]]);
  const before = JSON.stringify(decision);
  const snapshot = createLeaderboardSnapshot(input);
  expect(JSON.stringify(decision)).toBe(before);
  return snapshot;
}

for (const joint of [false, true]) {
  test(`${joint ? "joint" : "single"} author rounded to zero cannot earn Points for reviewing their own work`, () => {
    const snapshot = snapshotWithRoundedOutAuthor(joint);
    expect(
      snapshot.ledger.some(
        (event) =>
          event.category === "merged-pull-request" &&
          event.source.id === "PR_november" &&
          event.actor.id === PENALIZED_AUTHOR.id,
      ),
    ).toBe(false);
    expect(
      snapshot.ledger.some(
        (event) =>
          event.category === "substantive-review" &&
          event.actor.id === PENALIZED_AUTHOR.id,
      ),
    ).toBe(false);
    expect(
      snapshot.reviewExclusions?.find((row) => row.reviewId === REVIEW_ID)
        ?.reason,
    ).toBe("self-review");
  });
}
