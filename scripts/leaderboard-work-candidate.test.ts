import { afterEach, expect, setSystemTime, test } from "bun:test";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
} from "../src/lib/leaderboard";
import type { IssueRecord } from "../src/lib/leaderboard-types";
import {
  AFTER_NOVEMBER,
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

// `selectionFor` freezes the clock; reset after each test so the frozen
// December time does not leak into other test files in a multi-file run
// (same pattern as scripts/leaderboard-locale.test.ts).
afterEach(() => setSystemTime());

const label = (name: string) => ({ id: name, name, color: "" });

function openIssue(labels: string[]): IssueRecord {
  return {
    id: "I_mission_ready",
    number: 100,
    title: "Fix the broken thing",
    url: "https://github.com/SlopDotCash/asi/issues/100",
    body: "A defect.",
    createdAt: "2026-11-14T00:00:00.000Z",
    updatedAt: "2026-11-15T00:00:00.000Z",
    closedAt: null,
    stateReason: null,
    author: PENALIZED_AUTHOR,
    assignees: [],
    labels: labels.map(label),
    comments: [],
    closedByPullRequests: [],
  };
}

function selectionFor(labels: string[]) {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = penaltyScoreInput([]);
  input.openIssues = [openIssue(labels)];
  const snapshot = createLeaderboardSnapshot(input);
  assertLeaderboardSnapshot(snapshot);
  return snapshot.workQueue.issues[0].selection;
}

// The contributor skill's default ready-label list
// (skills/project-contributor-template/scripts/live-report.mjs,
// DEFAULT_CONTRIBUTOR_READY_LABELS) treats `mission-ready` as
// contributor-ready, and elizaOS/eliza carries the label for exactly
// that maintainer signal. The snapshot the project page reads must
// agree: a mission-ready issue is eligible work, not untriaged.
test("a mission-ready issue is a work candidate", () => {
  expect(selectionFor(["mission-ready"])).toEqual({
    status: "candidate",
    reasons: [],
  });
});

test("mission-ready does not lift the fail-closed exclusions", () => {
  expect(selectionFor(["mission-ready", "security"])).toEqual({
    status: "excluded",
    reasons: ["security-sensitive"],
  });
  expect(selectionFor(["mission-ready", "blocked"])).toEqual({
    status: "excluded",
    reasons: ["blocked"],
  });
});

test("an issue with no ready label stays untriaged", () => {
  expect(selectionFor(["website"])).toEqual({
    status: "excluded",
    reasons: ["untriaged"],
  });
});
