import { describe, expect, it } from "vitest";
import { snapshotFixture } from "../../tests/fixtures";
import {
  allocationFundingMinor,
  type PromotionCycle,
  projectPromotionEligible,
} from "./allocation-funding";
import { createProjectView } from "./project-view";
import { findProject } from "./projects.mjs";

const project = findProject("eliza");
if (!project) throw new Error("Missing Eliza fixture");
const unfunded = {
  fundingState: "pledged" as const,
  committedMinor: "0",
  monthlyCapMinor: "10000000000",
};
const cycle = (cycleId: string, committedMinor = "0"): PromotionCycle => ({
  projectId: project.id,
  kind: "monthly-pool",
  cycleId,
  reward: {
    fundingBasis: {
      ...unfunded,
      committedMinor,
      fundingState: committedMinor === "0" ? "pledged" : "committed",
    },
  },
});

describe("funding-backed allocation and promotion", () => {
  it("rejects malformed money before conversion", () => {
    expect(() =>
      allocationFundingMinor({
        ...unfunded,
        fundingState: "committed",
        committedMinor: "-1",
      }),
    ).toThrow(/invalid allocation funding basis/u);
    expect(() =>
      allocationFundingMinor({ ...unfunded, monthlyCapMinor: "1.5" }),
    ).toThrow(/invalid allocation funding basis/u);
  });
  it.each([
    ["pledged", "10000000", 0n],
    ["committed", "0", 0n],
    ["committed", "5000000", 5000000n],
    ["committed", "20000000000", 10000000000n],
  ])(
    "uses %s funding of %s without changing score",
    (fundingState, committedMinor, expected) => {
      const basis = {
        ...unfunded,
        fundingState: fundingState as "pledged" | "committed",
        committedMinor: String(committedMinor),
      };
      expect(allocationFundingMinor(basis)).toBe(expected);
      const snapshot = snapshotFixture();
      const before = createProjectView(snapshot, "eliza", "2026-07");
      const after = createProjectView(snapshot, "eliza", "2026-07", basis);
      expect(after.ledger).toEqual(before.ledger);
      expect(
        after.leaders.map(({ score, evidenceEventIds }) => ({
          score,
          evidenceEventIds,
        })),
      ).toEqual(
        before.leaders.map(({ score, evidenceEventIds }) => ({
          score,
          evidenceEventIds,
        })),
      );
      expect(
        after.leaders.reduce(
          (sum, leader) => sum + BigInt(leader.projectedMinor ?? "0"),
          0n,
        ),
      ).toBe(expected);
    },
  );

  it("allows a trial, pauses only after two adjacent unfunded cycles, and resumes when funded", () => {
    expect(projectPromotionEligible(project, null)).toBe(false);
    expect(projectPromotionEligible(project, [])).toBe(true);
    expect(projectPromotionEligible(project, [cycle("2026-07")])).toBe(true);
    expect(
      projectPromotionEligible(project, [cycle("2026-07"), cycle("2026-08")]),
    ).toBe(false);
    expect(
      projectPromotionEligible(project, [cycle("2026-07"), cycle("2026-09")]),
    ).toBe(true);
    expect(
      projectPromotionEligible(project, [
        cycle("2026-07"),
        cycle("2026-08", "10"),
        cycle("2026-09"),
      ]),
    ).toBe(true);
    expect(
      projectPromotionEligible(
        {
          ...project,
          reward: {
            ...project.reward,
            fundingState: "committed",
            committedMinor: "1",
          },
        },
        [cycle("2026-07"), cycle("2026-08")],
      ),
    ).toBe(true);
  });
});
