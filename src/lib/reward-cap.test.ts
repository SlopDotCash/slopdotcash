import { afterEach, describe, expect, it, vi } from "vitest";
import delta from "../../projects/delta-star/project.json";
import eliza from "../../projects/eliza/project.json";
import { snapshotFixture } from "../../tests/fixtures";
import { deriveAllocationFundingBasis } from "./allocation-funding-basis.mjs";
import { assertProjectDefinition } from "./project-schema.mjs";
import { createProjectView } from "./project-view";
import * as projects from "./projects.mjs";
import { resolveRewardCapMinor } from "./reward-cap.mjs";
import { createRewardCycleProposal } from "./reward-cycle";

const synthetic = structuredClone(eliza);
const project = assertProjectDefinition({
  ...synthetic,
  reward: {
    ...synthetic.reward,
    cycleCaps: [
      { cycleId: "2026-08", monthlyCapMinor: "10000000000" },
      { cycleId: "2026-09", monthlyCapMinor: "5000000000" },
    ],
  },
});
afterEach(() => vi.restoreAllMocks());
function snapshotFor(cycleId: string, next: string) {
  const snapshot = snapshotFixture(`${next}-02T00:00:00.000Z`);
  snapshot.window = {
    days: 35,
    from: `${cycleId}-01T00:00:00.000Z`,
    to: `${next}-02T00:00:00.000Z`,
  };
  snapshot.source.verificationWindow = { ...snapshot.window };
  snapshot.ledger = snapshot.ledger.map((event) => ({
    ...event,
    occurredAt: event.occurredAt.replace("2026-07", cycleId),
  }));
  return snapshot;
}

describe("manifest cycle caps", () => {
  it.each([
    ["2026-08", "2026-09", "10000000000"],
    ["2026-09", "2026-10", "5000000000"],
  ])(
    "resolves %s in funding, simulation, and generated proposals",
    (cycleId, next, cap) => {
      vi.spyOn(projects, "findProject").mockReturnValue(project);
      expect(resolveRewardCapMinor(project, cycleId)).toBe(cap);
      expect(
        deriveAllocationFundingBasis(project, cycleId).monthlyCapMinor,
      ).toBe(cap);
      const snapshot = snapshotFor(cycleId, next);
      const view = createProjectView(snapshot, project.id, cycleId);
      expect(view.reward).toMatchObject({
        capMinor: cap,
        projectedPrincipalMinor: "0",
      });
      expect(
        view.leaders
          .reduce((sum, row) => sum + BigInt(row.simulatedMinor ?? "0"), 0n)
          .toString(),
      ).toBe(cap);
      expect(
        view.leaders
          .reduce(
            (sum, row) => sum + BigInt(row.simulatedDisplayMinor ?? "0"),
            0n,
          )
          .toString(),
      ).toBe(cap);
      const proposal = createRewardCycleProposal({
        projectId: project.id,
        cycleId,
        snapshot,
        generatedAt: `${next}-02T00:00:00.000Z`,
        sourceSnapshotSha256: "a".repeat(64),
      });
      expect(proposal).toMatchObject({
        capMinor: "0",
        fundingBasis: { monthlyCapMinor: cap },
      });
    },
  );

  it("preserves frozen proposal funding bases", () => {
    vi.spyOn(projects, "findProject").mockReturnValue(project);
    const cycleId = "2026-08";
    const snapshot = snapshotFor(cycleId, "2026-09");
    const fundingBasis = {
      ...deriveAllocationFundingBasis(project, cycleId),
      monthlyCapMinor: "3000000000",
    };
    const proposal = createRewardCycleProposal({
      projectId: project.id,
      cycleId,
      snapshot,
      fundingBasis,
      generatedAt: "2026-09-02T00:00:00.000Z",
      sourceSnapshotSha256: "a".repeat(64),
    });
    expect(proposal).toMatchObject({ capMinor: "0", fundingBasis });
    expect(
      createProjectView(snapshot, project.id, cycleId, fundingBasis).reward,
    ).toMatchObject({ capMinor: "3000000000" });
  });

  it("uses manifest defaults for unlisted cycles and unfamiliar project identities", () => {
    const { cycleCaps: _history, ...reward } = project.reward;
    const unknown = {
      ...project,
      id: "future-project",
      reward: { ...reward, monthlyCapMinor: "123000000" },
    };
    expect(resolveRewardCapMinor(unknown, "2026-08")).toBe("123000000");
    expect(
      deriveAllocationFundingBasis(unknown, "2026-09").monthlyCapMinor,
    ).toBe("123000000");
    expect(resolveRewardCapMinor(project, "2026-07")).toBe("5000000000");
    expect(resolveRewardCapMinor(project, "2026-10")).toBe("5000000000");
    expect(
      resolveRewardCapMinor(assertProjectDefinition(delta), "2026-08"),
    ).toBe("0");
    expect(() => resolveRewardCapMinor(project, "2026-13")).toThrow();
  });

  it.each(
    [
      [],
      null,
      {},
      [{ cycleId: "2026-8", monthlyCapMinor: "1000000" }],
      [{ cycleId: "2026-13", monthlyCapMinor: "1000000" }],
      [{ cycleId: "2026-08", monthlyCapMinor: "01" }],
      [{ cycleId: "2026-08", monthlyCapMinor: 1000000 }],
      [{ cycleId: "2026-08", monthlyCapMinor: "-1" }],
      [{ cycleId: "2026-08", monthlyCapMinor: "1000001" }],
      [{ cycleId: "2026-08", monthlyCapMinor: "1000000000010000" }],
      [{ cycleId: "2026-08", monthlyCapMinor: "1000000", extra: true }],
      [{ cycleId: "2026-08" }],
      [
        { cycleId: "2026-08", monthlyCapMinor: "1000000" },
        { cycleId: "2026-08", monthlyCapMinor: "2000000" },
      ],
      [
        { cycleId: "2026-09", monthlyCapMinor: "1000000" },
        { cycleId: "2026-08", monthlyCapMinor: "2000000" },
      ],
    ].map((cycleCaps) => ({ cycleCaps })),
  )("rejects malformed or ambiguous cap history %#", ({ cycleCaps }) => {
    expect(() =>
      assertProjectDefinition({
        ...eliza,
        reward: { ...eliza.reward, cycleCaps },
      }),
    ).toThrow();
  });

  it("rejects cap history on external prizes", () => {
    expect(() =>
      assertProjectDefinition({
        ...delta,
        reward: { ...delta.reward, cycleCaps: project.reward.cycleCaps },
      }),
    ).toThrow();
  });
});
