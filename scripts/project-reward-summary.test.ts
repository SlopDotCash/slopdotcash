import { expect, test } from "bun:test";
import {
  currentMonthlyCapDisplay,
  monthlyPoolPointsOnly,
  projectRewardSummaries,
} from "../src/lib/project-reward-summary";
import type { ProjectDefinition } from "../src/lib/projects.mjs";

const now = new Date("2026-11-03T12:00:00Z");

function project(
  cycleCaps: { cycleId: string; monthlyCapMinor: string }[],
  rewardAsset?: object,
) {
  return {
    reward: {
      kind: "monthly-pool",
      monthlyCapMinor: "500000000",
      monthlyCapDisplay: "$500",
      cycleCaps,
    },
    rewardAsset,
  } as unknown as ProjectDefinition;
}

test("the open month uses its pinned cap, not the default effective next month", () => {
  const raised = project([
    { cycleId: "2026-10", monthlyCapMinor: "1000000000" },
    { cycleId: "2026-11", monthlyCapMinor: "1000000000" },
  ]);
  expect(currentMonthlyCapDisplay(raised, now)).toBe("$1,000");
  expect(projectRewardSummaries(raised, now)).toEqual([
    { kind: "monthly-pool", amount: "$1,000" },
  ]);
});

test("a zero cap for the open month is points only", () => {
  const paused = project([{ cycleId: "2026-11", monthlyCapMinor: "0" }]);
  expect(monthlyPoolPointsOnly(paused, now)).toBe(true);
  expect(projectRewardSummaries(paused, now)).toEqual([
    { kind: "points-only" },
  ]);
});

test("a month without an override keeps the default amount", () => {
  const pinnedElsewhere = project([
    { cycleId: "2026-10", monthlyCapMinor: "0" },
  ]);
  expect(currentMonthlyCapDisplay(pinnedElsewhere, now)).toBe("$500");
  expect(monthlyPoolPointsOnly(pinnedElsewhere, now)).toBe(false);
  expect(projectRewardSummaries(pinnedElsewhere, now)).toEqual([
    { kind: "monthly-pool", amount: "$500" },
  ]);
});

test("a token override is formatted in the token, not dollars", () => {
  const token = project([{ cycleId: "2026-11", monthlyCapMinor: "2000000" }], {
    kind: "token",
    decimals: 6,
    symbol: "OPEN",
  });
  expect(currentMonthlyCapDisplay(token, now)).toBe("2 OPEN");
});
