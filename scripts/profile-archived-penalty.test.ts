// A contributor profile lists each penalty with the points it debited. A
// month with a closed cycle record keeps its retained ledger, and its record
// already nets the debit, so the profile must still show the applied amount.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import type { CycleIndex, CycleIndexEntry } from "../src/lib/cycle-index";
import {
  appliedPenaltyThirds,
  openMonthScores,
} from "../src/lib/global-leaderboard";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  GENERATED_AT,
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

afterEach(() => {
  setSystemTime();
});

function penalizedSnapshot() {
  setSystemTime(new Date(GENERATED_AT));
  return createLeaderboardSnapshot(
    penaltyScoreInput([
      {
        itemNodeId: "PR_local",
        authorGithubId: "42",
        category: "spam",
        tableVersion: "slopbot-penalties-v1",
        debitThirds: 3,
        period: "2026-11",
        recordedAt: "2026-11-10T00:00:00.000Z",
      },
    ]),
  );
}

/** A closed ASI November record; only its project and month matter here. */
function archivedNovember(): CycleIndex {
  return {
    schemaVersion: "1",
    generatedAt: GENERATED_AT,
    cycles: [
      {
        projectId: "asi",
        cycleId: "2026-11",
        contributors: [],
      } as unknown as CycleIndexEntry,
    ],
  };
}

// The author earned one third in November, so the 3-third debit applies 1.
test("a penalty in an open month shows its applied debit", () => {
  const snapshot = penalizedSnapshot();
  const [penalty] = snapshot.penalties ?? [];
  expect(penalty?.debitThirds).toBe(3);
  const applied = appliedPenaltyThirds(snapshot);
  expect(applied.get(penalty.id)).toBe(1);
});

test("a penalty in an archived month still shows the debit its month applied", () => {
  const snapshot = penalizedSnapshot();
  const [penalty] = snapshot.penalties ?? [];
  // The snapshot, and so the month's closed record, nets the debit.
  const leader = snapshot.leaders.find(
    (entry) => entry.actor.id === PENALIZED_AUTHOR.id,
  );
  expect(leader?.penaltyThirds).toBe(1);
  // November is archived, so the open-month ranking leaves it to the record.
  expect(
    openMonthScores(snapshot, archivedNovember()).deductions.byPenalty.has(
      penalty.id,
    ),
  ).toBe(false);
  expect(appliedPenaltyThirds(snapshot).get(penalty.id) ?? 0).toBe(1);
});
