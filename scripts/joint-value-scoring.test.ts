/**
 * Joint work-unit scoring (PRD section 7). The work-unit producer gives a claim
 * no implementation actor when a bot opened the pull request and no
 * credit-eligible person authored the commit. A unit made only of such claims
 * has nobody to credit. The single pull request path skips that merge; the
 * joint path must do the same instead of failing the whole leaderboard.
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

const HUMAN_CLAIM = "a".repeat(64);
const BOT_CLAIM = "b".repeat(64);
const MERGE_CLAIM = "c".repeat(64);

function snapshotWithJointUnits(
  botClaimActors: string[],
  changedLines?: [number | undefined, number | undefined],
  options: {
    historicalCarrier?: boolean;
    missingCommit?: boolean;
    syncMerge?: boolean;
  } = {},
) {
  const input = penaltyScoreInput([], GENERATED_AT);
  const pull = input.mergedPullRequests.find(
    (record) => record.id === "PR_november",
  );
  if (!pull) throw new Error("fixture pull request missing");
  input.valueActors = new Map([
    [PENALIZED_AUTHOR.id, PENALIZED_AUTHOR],
    [PROJECT_OWNER.id, PROJECT_OWNER],
  ]);
  const unit = (workUnitId: string, claimId: string) => ({
    workUnitId,
    claimIds: [claimId],
    assessment: {
      status: "assessed",
      tier: "micro",
      rationale: "Fixture unit.",
      reviews: [],
    },
  });
  const claim = (id: string, implementationActorNodeIds: string[]) => ({
    id,
    commitSha: id.slice(0, 40),
    path: `src/${id[0]}.ts`,
    carrierPullRequestIds: [pull.id],
    creditPullRequestId: pull.id,
    implementationActorNodeIds: options.historicalCarrier
      ? [PROJECT_OWNER.id]
      : implementationActorNodeIds,
  });
  const decision = {
    status: "assessed",
    latestDigest: "d".repeat(64),
    history: [{ recorded_at: "2026-11-05T01:00:00.000Z" }],
    record: {
      sources: [{ pullRequestNodeId: pull.id, headSha: pull.headRefOid }],
      units: changedLines
        ? [
            {
              ...unit("wu_shared", HUMAN_CLAIM),
              claimIds: options.syncMerge
                ? [HUMAN_CLAIM, BOT_CLAIM, MERGE_CLAIM]
                : [HUMAN_CLAIM, BOT_CLAIM],
              assessment: {
                status: "assessed",
                tier: "large",
                rationale: "Fixture shared unit.",
                reviews: [],
              },
            },
          ]
        : [unit("wu_human", HUMAN_CLAIM), unit("wu_dependency_bot", BOT_CLAIM)],
    },
    evidence: {
      claims: [
        claim(HUMAN_CLAIM, [PENALIZED_AUTHOR.id]),
        claim(BOT_CLAIM, botClaimActors),
        // The producer keeps a verified conflict resolution of a sync merge
        // as a claim carrying the PR author (value-work-unit.ts).
        ...(options.syncMerge
          ? [claim(MERGE_CLAIM, [PENALIZED_AUTHOR.id])]
          : []),
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
              user: {
                node_id: options.historicalCarrier
                  ? PROJECT_OWNER.id
                  : PENALIZED_AUTHOR.id,
                type: "User",
              },
              base: { ref: "release" },
            },
            comments: [],
            reviews: [],
            ...(options.historicalCarrier || options.missingCommit
              ? {
                  implementationActorNodeIds: [PROJECT_OWNER.id],
                  commits: [HUMAN_CLAIM, BOT_CLAIM].map((id, index) => ({
                    sha:
                      options.missingCommit && index === 0
                        ? "f".repeat(40)
                        : id.slice(0, 40),
                    parents: [{ sha: "0".repeat(40) }],
                    author: {
                      node_id:
                        index === 0 ? PENALIZED_AUTHOR.id : PROJECT_OWNER.id,
                      type: "User",
                    },
                  })),
                }
              : {}),
            ...(options.syncMerge
              ? {
                  commits: [
                    ...[HUMAN_CLAIM, BOT_CLAIM].map((id, index) => ({
                      sha: id.slice(0, 40),
                      parents: [{ sha: "0".repeat(40) }],
                      author: {
                        node_id:
                          index === 0 ? PENALIZED_AUTHOR.id : PROJECT_OWNER.id,
                        type: "User",
                      },
                    })),
                    {
                      sha: MERGE_CLAIM.slice(0, 40),
                      parents: [
                        { sha: HUMAN_CLAIM.slice(0, 40) },
                        { sha: "9".repeat(40) },
                      ],
                      author: { node_id: PENALIZED_AUTHOR.id, type: "User" },
                    },
                  ],
                }
              : {}),
            ...(changedLines
              ? {
                  commitAttribution: [HUMAN_CLAIM, BOT_CLAIM].map(
                    (id, index) => ({
                      sha: id.slice(0, 40),
                      limitations: [],
                      files: [
                        {
                          filename: `src/${id[0]}.ts`,
                          status: "modified",
                          additions: changedLines[index],
                          deletions: 0,
                        },
                      ],
                    }),
                  ),
                }
              : {}),
          },
        },
      ],
    },
  };
  input.jointValueDecisions = new Map([[pull.id, decision as never]]);
  const retainedValueEvidence = JSON.stringify(decision);
  const snapshot = createLeaderboardSnapshot(input);
  expect(JSON.stringify(decision)).toBe(retainedValueEvidence);
  return snapshot;
}

const jointMerges = (snapshot: ReturnType<typeof createLeaderboardSnapshot>) =>
  snapshot.ledger
    .filter(
      (event) =>
        event.category === "merged-pull-request" &&
        event.source.id === "PR_november",
    )
    .map((event) => [event.workUnitId, event.actor.id, event.scoreThirds]);

test("a joint unit with only bot-authored claims scores nobody and keeps the other units", () => {
  expect(jointMerges(snapshotWithJointUnits([]))).toEqual([
    ["wu_human", PENALIZED_AUTHOR.id, 1],
  ]);
});

test("a joint unit with a verified implementation actor still scores", () => {
  expect(
    jointMerges(snapshotWithJointUnits([PENALIZED_AUTHOR.id])).sort(),
  ).toEqual([
    ["wu_dependency_bot", PENALIZED_AUTHOR.id, 1],
    ["wu_human", PENALIZED_AUTHOR.id, 1],
  ]);
});

test("a joint unit keeps its value and splits it by each author's claimed lines", () => {
  expect(
    jointMerges(snapshotWithJointUnits([PROJECT_OWNER.id], [90, 10])),
  ).toEqual([
    ["wu_shared", PENALIZED_AUTHOR.id, 21.6],
    ["wu_shared", PROJECT_OWNER.id, 2.4],
  ]);
});

test("a sync merge's conflict resolution claim does not hold the line split", () => {
  // PRD section 7: the split uses the unique accepted, non-merge commits and
  // excludes synchronization merges, as the single pull request path does.
  const snapshot = snapshotWithJointUnits([PROJECT_OWNER.id], [90, 10], {
    syncMerge: true,
  });
  expect(jointMerges(snapshot)).toEqual([
    ["wu_shared", PENALIZED_AUTHOR.id, 21.6],
    ["wu_shared", PROJECT_OWNER.id, 2.4],
  ]);
  expect(
    snapshot.valueAssessmentCoverage?.find(
      (item) => item.pullRequestId === "PR_november",
    )?.status,
  ).not.toBe("incomplete");
});

test("a shared joint unit with missing line evidence holds its sources", () => {
  const snapshot = snapshotWithJointUnits([PROJECT_OWNER.id], [90, undefined]);
  expect(jointMerges(snapshot)).toEqual([]);
  expect(
    snapshot.valueAssessmentCoverage?.find(
      (item) => item.pullRequestId === "PR_november",
    ),
  ).toMatchObject({ status: "incomplete", recordDigest: null });
});

test("cross-branch primary authors replace historical carrier recipients without rewriting valuation", () => {
  expect(
    jointMerges(
      snapshotWithJointUnits([PROJECT_OWNER.id], [90, 10], {
        historicalCarrier: true,
      }),
    ),
  ).toEqual([
    ["wu_shared", PENALIZED_AUTHOR.id, 21.6],
    ["wu_shared", PROJECT_OWNER.id, 2.4],
  ]);
});

test("a historical claim with a missing source commit cannot reuse its carrier as recipient", () => {
  const snapshot = snapshotWithJointUnits([PROJECT_OWNER.id], [90, 10], {
    historicalCarrier: true,
    missingCommit: true,
  });
  expect(jointMerges(snapshot)).toEqual([]);
  expect(
    snapshot.valueAssessmentCoverage?.find(
      (item) => item.pullRequestId === "PR_november",
    ),
  ).toMatchObject({ status: "incomplete", recordDigest: null });
});
