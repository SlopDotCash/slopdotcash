/** Proves rolling accepted events and closed reward cycles form one exact leaderboard. */

import { describe, expect, it } from "vitest";
import { cycleIndexFixture, snapshotFixture } from "../../tests/fixtures";
import type { CycleIndexEntry } from "./cycle-index";
import { createGlobalLeaders } from "./global-leaderboard";
import { createProjectView, projectCycleHasOpened } from "./project-view";
import { PROJECTS } from "./projects.mjs";

function archivedElizaCycle(
  cycleId: string,
  score: number,
  paidMinor = "0",
): CycleIndexEntry {
  return {
    projectId: "eliza",
    cycleId,
    kind: "monthly-pool",
    state: paidMinor === "0" ? "review" : "paid",
    generatedAt: "2026-08-01T00:00:00.000Z",
    contributionWindow: {
      from: `${cycleId}-01T00:00:00.000Z`,
      to: "2026-08-01T00:00:00.000Z",
    },
    reviewEndsAt: "2026-08-15T00:00:00.000Z",
    approvedAt: paidMinor === "0" ? null : "2026-08-16T00:00:00.000Z",
    settledAt: paidMinor === "0" ? null : "2026-08-17T00:00:00.000Z",
    reward: {
      currency: "USDC",
      capMinor: "10000000000",
      suggestedMinor: paidMinor,
      approvedMinor: paidMinor,
      paidMinor,
      feeMinor: "0",
      sharePartsPerMillion: null,
    },
    contributors: [
      {
        actor: { id: "U_fixture", login: "finish-line" },
        score,
        state: paidMinor === "0" ? "proposed" : "paid",
        suggestedMinor: paidMinor,
        approvedMinor: paidMinor,
        paidMinor,
        sharePartsPerMillion: null,
        wallet: null,
      },
    ],
    files: {
      sourceSnapshot: {
        sha256: "a".repeat(64),
        url: `/data/cycles/eliza/${cycleId}/source-snapshot.json`,
      },
      proposal: {
        sha256: "b".repeat(64),
        url: `/data/cycles/eliza/${cycleId}/proposal.json`,
      },
      allocation: null,
      executionPlan: null,
      settlement: null,
    },
  };
}

function projectViews() {
  const snapshot = snapshotFixture();
  return {
    snapshot,
    views: PROJECTS.filter((project) =>
      projectCycleHasOpened(snapshot, project.id),
    ).map((project) => createProjectView(snapshot, project.id)),
  };
}

describe("createGlobalLeaders", () => {
  it("uses the complete accepted snapshot instead of only the current project cycle", () => {
    const { snapshot, views } = projectViews();

    const [leader] = createGlobalLeaders(snapshot, views, cycleIndexFixture());

    expect(leader.actor.login).toBe("finish-line");
    expect(leader.score).toBe(snapshot.leaders[0].score);
    expect(leader.projects).toBe(2);
    expect(leader.cycles).toBe(2);
  });

  it("adds older closed cycles without double-counting an overlapping cycle", () => {
    const { snapshot, views } = projectViews();
    const cycleIndex = cycleIndexFixture();
    cycleIndex.cycles = [
      archivedElizaCycle("2026-06", 7, "1000000"),
      archivedElizaCycle("2026-07", 70),
    ];

    const [leader] = createGlobalLeaders(snapshot, views, cycleIndex);

    // The July archive replaces 24 Eliza points in the rolling ledger while
    // the separate arklib project contributes its remaining 10 points.
    expect(leader.score).toBe(87);
    expect(leader.paidMinor).toBe(1_000_000n);
    expect(leader.projects).toBe(2);
    expect(leader.cycles).toBe(3);
  });
});
