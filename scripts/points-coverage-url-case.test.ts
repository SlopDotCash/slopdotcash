/**
 * A missing valuation must not zero an earlier award (PRD section 7). The
 * journal accepts the same case-folded GitHub pull path the manifest
 * validator accepts, including "/PULL/". The coverage lookup has to recognize
 * that path; otherwise the award is treated as absent from the census and
 * replaced with zero.
 */
import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  appendPointAwards,
  applyPointsSnapshot,
  emptyPointsJournal,
  latestPoints,
  pointKey,
} from "../src/lib/points";
import {
  GENERATED_AT,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

beforeAll(() => setSystemTime(new Date(GENERATED_AT)));
afterAll(() => setSystemTime());

const SOURCE_ID = "PR_november";

function retainedAmount(sourceUrl: string): number | undefined {
  const award = {
    key: pointKey("asi", PROJECT_OWNER.id, "merged-pull-request", SOURCE_ID),
    actor: { id: PROJECT_OWNER.id, login: PROJECT_OWNER.login },
    projectId: "asi",
    category: "merged-pull-request" as const,
    amount: 90,
    occurredAt: "2026-11-05T00:00:00.000Z",
    sourceId: SOURCE_ID,
    sourceUrl,
    workUnitId: "wu_prior_pull_8",
    provisional: false,
  };
  const journal = appendPointAwards(
    emptyPointsJournal(GENERATED_AT),
    [award],
    "a".repeat(64),
    "slop-score-v2",
    GENERATED_AT,
  );
  const snapshot = createLeaderboardSnapshot(penaltyScoreInput([]));
  const coverage = snapshot.valueAssessmentCoverage?.find(
    (row) => row.pullRequestNumber === 8,
  );
  expect(coverage?.status).toBe("missing");
  const next = applyPointsSnapshot(
    journal,
    snapshot,
    "b".repeat(64),
    GENERATED_AT,
  );
  return latestPoints(next).get(award.key)?.award.amount;
}

test("a missing valuation keeps an earlier award whose pull path is uppercase", () => {
  expect(retainedAmount("https://github.com/SlopDotCash/asi/pull/8")).toBe(90);
  expect(retainedAmount("https://github.com/SlopDotCash/asi/PULL/8")).toBe(90);
});
