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
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

beforeAll(() => setSystemTime(new Date(AFTER_NOVEMBER)));
afterAll(() => setSystemTime());

const HUMAN_CLAIM = "a".repeat(64);
const BOT_CLAIM = "b".repeat(64);

function snapshotWithJointUnits(botClaimActors: string[]) {
  const input = penaltyScoreInput([], GENERATED_AT);
  const pull = input.mergedPullRequests.find(
    (record) => record.id === "PR_november",
  );
  if (!pull) throw new Error("fixture pull request missing");
  input.valueActors = new Map([[PENALIZED_AUTHOR.id, PENALIZED_AUTHOR]]);
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
    carrierPullRequestIds: [pull.id],
    creditPullRequestId: pull.id,
    implementationActorNodeIds,
  });
  const decision = {
    status: "assessed",
    latestDigest: "d".repeat(64),
    history: [{ recorded_at: "2026-11-05T01:00:00.000Z" }],
    record: {
      sources: [{ pullRequestNodeId: pull.id, headSha: pull.headRefOid }],
      units: [
        unit("wu_human", HUMAN_CLAIM),
        unit("wu_dependency_bot", BOT_CLAIM),
      ],
    },
    evidence: {
      claims: [
        claim(HUMAN_CLAIM, [PENALIZED_AUTHOR.id]),
        claim(BOT_CLAIM, botClaimActors),
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
            reviews: [],
          },
        },
      ],
    },
  };
  input.jointValueDecisions = new Map([[pull.id, decision as never]]);
  return createLeaderboardSnapshot(input);
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
