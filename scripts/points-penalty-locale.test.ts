// Same-time penalty application in the Points journal must not depend on
// the host locale: reconcilePointPenalties applies same-time debits from
// one shared month bucket in work-unit order, so the order decides which
// penalty is recorded as applied when the bucket covers only one debit.
import { expect, setSystemTime, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  applyPointsSnapshot,
  type PointsJournal,
  reconcilePointPenalties,
} from "../src/lib/points";
import {
  GENERATED_AT,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

function checkpoint(): PointsJournal {
  return JSON.parse(readFileSync("data/points/history.json", "utf8"));
}

// Two scam penalties (24 thirds = 240 Points each) for one author, project
// and month, recorded at the identical instant. The author's November
// bucket holds 10 Points, so only the first penalty in application order
// is debited. The work-unit IDs are `${PR node ID}:penalty`; "PR_T" and
// "PR_Z" order T-first under English collation and Z-first under Estonian.
function build() {
  const feed = ["PR_Z", "PR_T"].map((itemNodeId) => ({
    itemNodeId,
    authorGithubId: "42",
    category: "scam",
    tableVersion: "slopbot-penalties-v1",
    debitThirds: 24,
    period: "2026-11",
    recordedAt: "2026-11-10T00:00:00.000Z",
  }));
  const input = penaltyScoreInput(feed as never);
  const closed = input.closedUnmergedPullRequests?.[0];
  if (!closed) throw new Error("Missing closed-source fixture");
  input.closedUnmergedPullRequests = feed.map((row, index) => ({
    ...closed,
    id: row.itemNodeId,
    number: 31000 + index,
    url: `https://github.com/SlopDotCash/asi/pull/${31000 + index}`,
  }));
  const snapshot = createLeaderboardSnapshot(input);
  const work = applyPointsSnapshot(
    checkpoint(),
    createLeaderboardSnapshot({ ...input, penalties: [] }),
    "b".repeat(64),
    GENERATED_AT,
  );
  return { snapshot, work };
}

function debits(journal: PointsJournal, work: PointsJournal) {
  return Object.fromEntries(
    journal.revisions
      .slice(work.revisions.length)
      .map((r) => [r.award.workUnitId, r.award.amount]),
  );
}

test("same-time penalty split in the journal is host-locale independent", () => {
  let compare: { mockRestore: () => void } | undefined;
  try {
    setSystemTime(new Date(GENERATED_AT));
    const { snapshot, work } = build();
    const english = debits(
      reconcilePointPenalties(work, "a".repeat(64), GENERATED_AT, snapshot),
      work,
    );
    expect(english).toEqual({ "PR_T:penalty": -10, "PR_Z:penalty": 0 });

    const originalCompare = String.prototype.localeCompare;
    compare = spyOn(String.prototype, "localeCompare").mockImplementation(
      function (
        this: string,
        other: string,
        locales?: Intl.LocalesArgument,
        options?: Intl.CollatorOptions,
      ) {
        return originalCompare.call(this, other, locales ?? "et", options);
      },
    );
    const estonian = debits(
      reconcilePointPenalties(work, "a".repeat(64), GENERATED_AT, snapshot),
      work,
    );
    expect(estonian).toEqual(english);
  } finally {
    compare?.mockRestore();
    setSystemTime();
  }
});
