import {
  afterEach,
  beforeAll,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  AFTER_NOVEMBER,
  GENERATED_AT,
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

beforeAll(() => {
  setSystemTime(new Date(AFTER_NOVEMBER));
});

afterEach(() => {
  setSystemTime(new Date(AFTER_NOVEMBER));
});

const CLAIM_ID = "a".repeat(64);
const WORK_UNIT_ID = `wu_${"e".repeat(64)}`;

function snapshot(bans: Map<string, string>) {
  const input = penaltyScoreInput([], GENERATED_AT);
  const pullRequest = input.mergedPullRequests.find(
    (record) => record.id === "PR_november",
  );
  if (!pullRequest) throw new Error("Penalty fixture lost its November merge");
  input.valueActors = new Map([
    [PENALIZED_AUTHOR.id, PENALIZED_AUTHOR],
    [PROJECT_OWNER.id, PROJECT_OWNER],
  ]);
  input.participationBans = bans;
  const decision = {
    status: "assessed",
    latestDigest: "d".repeat(64),
    history: [{ recorded_at: "2026-11-05T01:00:00.000Z" }],
    record: {
      sources: [
        { pullRequestNodeId: pullRequest.id, headSha: pullRequest.headRefOid },
      ],
      units: [
        {
          workUnitId: WORK_UNIT_ID,
          claimIds: [CLAIM_ID],
          assessment: {
            status: "assessed",
            tier: "medium",
            rationale: "Two-author implementation.",
            reviews: [],
          },
        },
      ],
    },
    evidence: {
      claims: [
        {
          id: CLAIM_ID,
          carrierPullRequestIds: [pullRequest.id],
          creditPullRequestId: pullRequest.id,
          implementationActorNodeIds: [PENALIZED_AUTHOR.id, PROJECT_OWNER.id],
        },
      ],
      sources: [
        {
          evidence: {
            repository: "SlopDotCash/asi",
            pull: {
              node_id: pullRequest.id,
              number: pullRequest.number,
              title: pullRequest.title,
              html_url: pullRequest.url,
              head: { sha: pullRequest.headRefOid },
              updated_at: pullRequest.updatedAt,
              merged_at: pullRequest.mergedAt,
              closed_at: pullRequest.closedAt,
              user: { node_id: PENALIZED_AUTHOR.id },
            },
            comments: [],
            reviews: [],
          },
        },
      ],
    },
  };
  input.jointValueDecisions = new Map([[pullRequest.id, decision as never]]);
  return createLeaderboardSnapshot(input);
}

function jointThirds(snap: ReturnType<typeof createLeaderboardSnapshot>) {
  return new Map(
    snap.ledger
      .filter((event) => event.id.includes(":joint:"))
      .map((event) => [event.actor.id, event.scoreThirds]),
  );
}

// PR_november merged at 2026-11-05T00:00:00.000Z, so a ban recorded on
// 2026-11-01 is already in force when the joint unit completes.
const BANNED_BEFORE = "2026-11-01T00:00:00.000Z";
const BANNED_AFTER = "2026-11-06T00:00:00.000Z";

describe("joint split with a participation-banned co-author", () => {
  test("a banned co-author takes no share of the unit's credit", () => {
    const thirds = jointThirds(
      snapshot(new Map([[PROJECT_OWNER.id, BANNED_BEFORE]])),
    );
    // Medium is 9 thirds. Divided as if the banned actor had not taken
    // part, the eligible author keeps the whole assessed total.
    expect(thirds.get(PENALIZED_AUTHOR.id)).toBe(9);
    expect(thirds.has(PROJECT_OWNER.id)).toBe(false);
  });

  test("a banned primary author leaves the full total to the co-author", () => {
    const thirds = jointThirds(
      snapshot(new Map([[PENALIZED_AUTHOR.id, BANNED_BEFORE]])),
    );
    expect(thirds.get(PROJECT_OWNER.id)).toBe(9);
    expect(thirds.has(PENALIZED_AUTHOR.id)).toBe(false);
  });

  test("a unit whose actors are all banned credits nobody", () => {
    const thirds = jointThirds(
      snapshot(
        new Map([
          [PENALIZED_AUTHOR.id, BANNED_BEFORE],
          [PROJECT_OWNER.id, BANNED_BEFORE],
        ]),
      ),
    );
    expect(thirds.size).toBe(0);
  });

  test("a ban recorded after completion does not change the split", () => {
    const thirds = jointThirds(
      snapshot(new Map([[PROJECT_OWNER.id, BANNED_AFTER]])),
    );
    expect(thirds.get(PENALIZED_AUTHOR.id)).toBe(5);
    expect(thirds.get(PROJECT_OWNER.id)).toBe(4);
  });
});
