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

const AUTHOR_COMMIT = "a".repeat(40);
const COAUTHOR_COMMIT = "b".repeat(40);
const OCTOBER_COAUTHOR_COMMIT = "c".repeat(40);
// PR_november merged at 2026-11-05T00:00:00.000Z and PR_october at
// 2026-10-29T12:00:00.000Z, so these bans are in force at completion.
const BANNED_BEFORE_NOVEMBER = "2026-11-01T00:00:00.000Z";
const BANNED_AFTER_NOVEMBER = "2026-11-06T00:00:00.000Z";
const BANNED_BEFORE_OCTOBER = "2026-10-01T00:00:00.000Z";

function snapshot(bans: Map<string, string>, assessed: boolean) {
  const input = penaltyScoreInput([], GENERATED_AT);
  const november = input.mergedPullRequestOutcomes.find(
    (record) => record.id === "PR_november",
  );
  if (!november) throw new Error("Penalty fixture lost its November merge");
  november.commits = [
    { oid: AUTHOR_COMMIT, author: PENALIZED_AUTHOR },
    { oid: COAUTHOR_COMMIT, author: PROJECT_OWNER },
  ];
  const october = input.mergedPullRequestOutcomes.find(
    (record) => record.id === "PR_october",
  );
  if (!october) throw new Error("Penalty fixture lost its October merge");
  october.commits = [
    {
      oid: october.commits?.[0]?.oid ?? "7".repeat(40),
      author: PENALIZED_AUTHOR,
    },
    { oid: OCTOBER_COAUTHOR_COMMIT, author: PROJECT_OWNER },
  ];
  input.valueActors = new Map([
    [PENALIZED_AUTHOR.id, PENALIZED_AUTHOR],
    [PROJECT_OWNER.id, PROJECT_OWNER],
  ]);
  input.participationBans = bans;
  if (assessed) {
    const pull = input.mergedPullRequests.find(
      (record) => record.id === "PR_november",
    );
    if (!pull?.mergedAt)
      throw new Error("Penalty fixture lost its November PR");
    const decision = {
      status: "assessed",
      implementationActorNodeIds: [PENALIZED_AUTHOR.id, PROJECT_OWNER.id],
      record: {
        pullRequestNodeId: pull.id,
        repository: "elizaOS/asi",
        headSha: pull.headRefOid,
        occurredAt: pull.mergedAt,
        assessment: {
          tier: "medium",
          rationale: "Two-author implementation.",
          reviews: [],
        },
      },
      assessment: { status: "assessed", tier: "medium", reviews: [] },
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
    input.valueDecisions = new Map([[pull.id, decision as never]]);
  }
  return createLeaderboardSnapshot(input);
}

function mergeThirds(
  snap: ReturnType<typeof createLeaderboardSnapshot>,
  pullRequestId: string,
) {
  return new Map(
    snap.ledger
      .filter(
        (event) =>
          event.source.id === pullRequestId &&
          event.category === "merged-pull-request",
      )
      .map((event) => [event.actor.id, event.scoreThirds]),
  );
}

describe("single pull request split with a participation-banned commit author", () => {
  test("a banned commit co-author takes no share of the assessed credit", () => {
    const snap = snapshot(
      new Map([[PROJECT_OWNER.id, BANNED_BEFORE_NOVEMBER]]),
      true,
    );
    const thirds = mergeThirds(snap, "PR_november");
    // Medium is 9 thirds. Divided as if the banned actor had not taken
    // part, the eligible author keeps the whole assessed total.
    expect(thirds.get(PENALIZED_AUTHOR.id)).toBe(9);
    expect(thirds.has(PROJECT_OWNER.id)).toBe(false);
    const event = snap.ledger.find(
      (entry) =>
        entry.source.id === "PR_november" &&
        entry.category === "merged-pull-request",
    );
    expect(event?.reason).not.toContain("Shared equally among");
  });

  test("a banned author leaves the full assessed total to the co-author", () => {
    const thirds = mergeThirds(
      snapshot(new Map([[PENALIZED_AUTHOR.id, BANNED_BEFORE_NOVEMBER]]), true),
      "PR_november",
    );
    expect(thirds.get(PROJECT_OWNER.id)).toBe(9);
    expect(thirds.has(PENALIZED_AUTHOR.id)).toBe(false);
  });

  test("a merge whose credit actors are all banned credits nobody", () => {
    const thirds = mergeThirds(
      snapshot(
        new Map([
          [PENALIZED_AUTHOR.id, BANNED_BEFORE_NOVEMBER],
          [PROJECT_OWNER.id, BANNED_BEFORE_NOVEMBER],
        ]),
        true,
      ),
      "PR_november",
    );
    expect(thirds.size).toBe(0);
  });

  test("a ban recorded after the merge does not change the split", () => {
    const thirds = mergeThirds(
      snapshot(new Map([[PROJECT_OWNER.id, BANNED_AFTER_NOVEMBER]]), true),
      "PR_november",
    );
    expect(thirds.get(PENALIZED_AUTHOR.id)).toBe(5);
    expect(thirds.get(PROJECT_OWNER.id)).toBe(4);
  });

  test("an unbanned assessed merge still splits between both authors", () => {
    const thirds = mergeThirds(snapshot(new Map(), true), "PR_november");
    expect(thirds.get(PENALIZED_AUTHOR.id)).toBe(5);
    expect(thirds.get(PROJECT_OWNER.id)).toBe(4);
  });

  test("a banned commit co-author takes no share of unratified credit", () => {
    const thirds = mergeThirds(
      snapshot(new Map([[PROJECT_OWNER.id, BANNED_BEFORE_OCTOBER]]), false),
      "PR_october",
    );
    // The October merge carries 3 unratified thirds; split as if the
    // banned co-author had not taken part, the author keeps all 3.
    expect(thirds.get(PENALIZED_AUTHOR.id)).toBe(3);
    expect(thirds.has(PROJECT_OWNER.id)).toBe(false);
  });

  test("an unbanned unratified merge still splits between both authors", () => {
    const thirds = mergeThirds(snapshot(new Map(), false), "PR_october");
    expect(thirds.get(PENALIZED_AUTHOR.id)).toBe(2);
    expect(thirds.get(PROJECT_OWNER.id)).toBe(1);
  });
});
