/**
 * A closed month with no recorded cycle gets a live view only while the
 * rolling snapshot window still covers the whole month. Once the window
 * slides past the 1st, a recompute would silently drop the month's early
 * work and present the truncated remainder as the closed record, so the
 * cycle page must fall back to its no-record state instead — the same state
 * a month fully outside the window already gets. The live month keeps its
 * partial view.
 */
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import type { LeaderboardInput } from "../src/lib/leaderboard-types";
import {
  createProjectView,
  projectCycleHasOpened,
} from "../src/lib/project-view";
import {
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

afterEach(() => setSystemTime());

const EARLY = "2026-12-02T00:00:00.000Z"; // window from 2026-10-28
const LATE = "2026-12-20T00:00:00.000Z"; // window from 2026-11-15
const MID_NOVEMBER = "2026-11-20T00:00:00.000Z"; // November still live

/** A Dec-20 census can only detail work inside its window: one Nov-20 merge. */
function lateInput(): LeaderboardInput {
  const input = penaltyScoreInput([], LATE);
  const source = structuredClone(
    input.mergedPullRequests.find((pull) => pull.id === "PR_november"),
  );
  if (!source) throw new Error("fixture PR missing");
  source.id = "PR_late_november";
  source.number = 21;
  source.url = source.url.replace(/\/pull\/\d+$/u, "/pull/21");
  source.createdAt = "2026-11-19T00:00:00.000Z";
  source.mergedAt = "2026-11-20T00:00:00.000Z";
  source.closedAt = "2026-11-20T00:00:00.000Z";
  source.updatedAt = "2026-11-20T00:00:00.000Z";
  source.author = structuredClone(PENALIZED_AUTHOR);
  input.mergedPullRequests = [source];
  input.mergedPullRequestOutcomes = input.mergedPullRequestOutcomes.filter(
    (outcome) => outcome.id === "PR_november",
  );
  for (const outcome of input.mergedPullRequestOutcomes) {
    outcome.id = source.id;
    outcome.number = source.number;
    outcome.url = source.url;
    outcome.createdAt = source.createdAt;
    outcome.updatedAt = source.updatedAt;
    outcome.mergedAt = source.mergedAt;
  }
  input.detailEligibleMergedPullRequestIds = [source.id];
  input.closedUnmergedPullRequests = [];
  input.source.counts.mergedPullRequests = 1;
  input.source.counts.detailedMergedPullRequests = 1;
  input.sourceUpdatedAt = source.closedAt;
  return input;
}

test("a fully covered closed month keeps its live view from the 1st", () => {
  setSystemTime(new Date(EARLY));
  const snapshot = createLeaderboardSnapshot(penaltyScoreInput([], EARLY));
  expect(projectCycleHasOpened(snapshot, "asi", "2026-11")).toBe(true);
  const view = createProjectView(snapshot, "asi", "2026-11");
  expect(view.cycle.from).toBe("2026-11-01T00:00:00.000Z");
  expect(view.cycle.to).toBe("2026-12-01T00:00:00.000Z");
  expect(view.cycle.status).toBe("closed");
  expect(view.leaders.map((leader) => leader.actor.login).sort()).toEqual([
    "author",
    "project-owner",
  ]);
});

test("a closed month the window only partly covers has no live view", () => {
  setSystemTime(new Date(LATE));
  const snapshot = createLeaderboardSnapshot(lateInput());
  // November closed on Dec 1; by Dec 20 the window starts Nov 15, so a live
  // recompute would keep only the Nov-20 merge and date the cycle from
  // Nov 15. The month must report no live view, like October already does.
  expect(projectCycleHasOpened(snapshot, "asi", "2026-11")).toBe(false);
  expect(projectCycleHasOpened(snapshot, "asi", "2026-10")).toBe(false);
});

test("a partly covered October has no live view either", () => {
  setSystemTime(new Date(EARLY));
  const snapshot = createLeaderboardSnapshot(penaltyScoreInput([], EARLY));
  // The Dec-2 window starts Oct 28, before October closed but after it
  // began: October work from Oct 1-27 can no longer be recomputed.
  expect(projectCycleHasOpened(snapshot, "asi", "2026-10")).toBe(false);
});

test("the live month keeps its partial view", () => {
  setSystemTime(new Date(LATE));
  const snapshot = createLeaderboardSnapshot(lateInput());
  expect(projectCycleHasOpened(snapshot, "asi")).toBe(true);
  expect(projectCycleHasOpened(snapshot, "asi", "2026-12")).toBe(true);
  setSystemTime(new Date(MID_NOVEMBER));
  const live = createLeaderboardSnapshot(penaltyScoreInput([], MID_NOVEMBER));
  expect(projectCycleHasOpened(live, "asi", "2026-11")).toBe(true);
});
