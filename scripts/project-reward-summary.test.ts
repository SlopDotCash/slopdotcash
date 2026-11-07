import { describe, expect, test } from "bun:test";
import { projectRewardSummaries } from "../src/lib/project-reward-summary";
import { findProject, type ProjectDefinition } from "../src/lib/projects.mjs";

function fixture(id: string) {
  const project = findProject(id);
  if (!project) throw new Error(`fixture project missing: ${id}`);
  return project;
}

describe("projectRewardSummaries", () => {
  test("an unfunded monthly pool is marked not funded (eliza: $1,000 cap, $0 committed, pledged)", () => {
    expect(projectRewardSummaries(fixture("eliza"))).toEqual([
      { kind: "monthly-pool", amount: "$1,000", funded: false },
    ]);
  });

  test("a funded monthly pool is marked funded", () => {
    const eliza = fixture("eliza");
    // The summary reads only the reward policy; a committed reward state is
    // what monthlyPoolUnfunded checks (escrow validation lives in the schema).
    const fundedProject: ProjectDefinition = {
      ...eliza,
      reward: {
        ...eliza.reward,
        committedMinor: eliza.reward.monthlyCapMinor,
        fundingState: "committed",
      },
    };
    expect(projectRewardSummaries(fundedProject)).toEqual([
      { kind: "monthly-pool", amount: "$1,000", funded: true },
    ]);
  });

  test("a $0-cap pool stays points-only", () => {
    expect(projectRewardSummaries(fixture("canonry"))).toEqual([
      { kind: "points-only" },
    ]);
  });

  test("an external prize share is unchanged", () => {
    expect(projectRewardSummaries(fixture("delta-star"))).toEqual([
      { kind: "external-prize", amount: "$1,000,000" },
    ]);
  });
});
