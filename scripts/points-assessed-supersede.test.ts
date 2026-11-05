/**
 * A source-bound assessment that credits nobody (its evidence names no
 * eligible implementation actor) supersedes the pull request's previously
 * reflected Points. protocol/points-v1.md ("Persistence and publication")
 * requires that revision to record the decision source, effective time,
 * reason, and exact signed change, like every other superseding revision.
 */
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import type { LeaderboardInput } from "../src/lib/leaderboard-types";
import {
  applyPointsSnapshot,
  latestPoints,
  type PointsJournal,
  pointMembers,
} from "../src/lib/points";
import {
  GENERATED_AT,
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

afterEach(() => setSystemTime());

type ValueDecision =
  NonNullable<LeaderboardInput["valueDecisions"]> extends ReadonlyMap<
    string,
    infer V
  >
    ? V
    : never;

const DIGEST = "d".repeat(64);

function assessedSnapshot(implementationActors: string[]) {
  const input = penaltyScoreInput([]);
  const pull = input.mergedPullRequests.find((r) => r.id === "PR_november");
  if (!pull) throw new Error("fixture pull missing");
  if (implementationActors.length)
    input.valueActors = new Map([[PENALIZED_AUTHOR.id, PENALIZED_AUTHOR]]);
  const decision = {
    status: "assessed",
    implementationActorNodeIds: implementationActors,
    record: {
      pullRequestNodeId: pull.id,
      repository: "elizaOS/asi",
      headSha: pull.headRefOid,
      occurredAt: pull.mergedAt,
      assessment: { tier: "medium", reviews: [] },
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
    latestDigest: DIGEST,
  };
  input.valueDecisions = new Map([
    [pull.id, decision as unknown as ValueDecision],
  ]);
  return createLeaderboardSnapshot(input);
}

const novemberRevisions = (journal: PointsJournal) =>
  journal.revisions.filter((r) => r.award.sourceId === "PR_november");

test("a superseding assessment with no credited actor records its decision", () => {
  setSystemTime(new Date(GENERATED_AT));
  const history = JSON.parse(
    readFileSync("data/points/history.json", "utf8"),
  ) as PointsJournal;

  const credited = applyPointsSnapshot(
    history,
    assessedSnapshot([PENALIZED_AUTHOR.id]),
    "a".repeat(64),
    GENERATED_AT,
  );
  const first = novemberRevisions(credited);
  expect(first).toHaveLength(1);
  expect(first[0]?.award.amount).toBe(90);
  const key = first[0]?.award.key;
  if (!key) throw new Error("assessed revision missing");
  const totalBefore = pointMembers(credited).find(
    (m) => m.actor.login === "author",
  )?.total;

  const orphaned = assessedSnapshot([]);
  expect(
    orphaned.ledger.filter((e) => e.source.id === "PR_november"),
  ).toHaveLength(0);
  expect(
    orphaned.valueAssessmentCoverage?.find(
      (c) => c.pullRequestId === "PR_november",
    )?.status,
  ).toBe("assessed");

  const superseded = applyPointsSnapshot(
    credited,
    orphaned,
    "b".repeat(64),
    GENERATED_AT,
  );
  const revisions = novemberRevisions(superseded);
  expect(revisions).toHaveLength(2);
  const latest = latestPoints(superseded).get(key);
  expect(latest?.award.amount).toBe(0);
  expect(latest?.decision?.sourceId).toBe(`value:${DIGEST}`);
  expect(latest?.decision?.delta).toBe(-90);
  expect(latest?.decision?.reason).toContain(
    "Prior credit was superseded by the current source-bound scoring decision.",
  );
  expect(latest?.decision?.effectiveAt).toBe(GENERATED_AT);
  const totalAfter = pointMembers(superseded).find(
    (m) => m.actor.login === "author",
  )?.total;
  expect(totalAfter).toBe((totalBefore ?? 0) - 90);

  // Replaying the same snapshot appends no further revision.
  const replayed = applyPointsSnapshot(
    superseded,
    orphaned,
    "b".repeat(64),
    GENERATED_AT,
  );
  expect(novemberRevisions(replayed)).toHaveLength(2);
});
