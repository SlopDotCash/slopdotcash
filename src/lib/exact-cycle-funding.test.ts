import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateProposalFundingTransitions } from "../../scripts/check-project-transitions.mjs";
import { loadPriorCycleAccrual } from "../../scripts/prior-cycle-accrual";
import { snapshotFixture } from "../../tests/fixtures";
import {
  assertAllocationFundingBasis,
  deriveAllocationFundingBasis,
  projectPromotionEligible,
} from "./allocation-funding";
import { assertProjectDefinition } from "./project-schema.mjs";
import * as projects from "./projects.mjs";
import { createRewardCycleProposal } from "./reward-cycle";
import { finalizeRewardAllocation } from "./reward-finalization";
import { assertRewardAllocationManifest } from "./rewards";

const original = projects.findProject("eliza") as projects.ProjectDefinition;
function fundedProject() {
  return assertProjectDefinition({
    ...original,
    reward: {
      ...original.reward,
      fundingState: "committed",
      committedMinor: "5000000",
      paymentMode: "disabled",
    },
    funding: {
      ...original.funding,
      commitments: [
        {
          kind: "squads-v4-vault",
          network: "solana",
          asset: "USDC",
          multisig: "11111111111111111111111111111111",
          vault: "Vote111111111111111111111111111111111111111",
          vaultIndex: 0,
          funderMember: "Stake11111111111111111111111111111111111111",
          stewardMember: "SysvarRent111111111111111111111111111111111",
          funderActorId: "18633264",
          stewardGithub: {
            actorId: "42",
            nodeId: "U_fixture_42",
            login: "independent-fixture",
          },
          monthlyCommitment: {
            cycleId: "2026-08",
            amountMinor: "5000000",
            accessibility: "unknown",
          },
          effectiveAt: "2026-08-01T00:00:00.000Z",
          deadline: "2026-09-01T00:00:00.000Z",
          replacedAt: null,
        },
      ],
    },
  });
}
function proposal(cycleId: string) {
  const snapshot = snapshotFixture();
  const next = cycleId === "2026-07" ? "2026-08" : "2026-09";
  snapshot.window = {
    days: 35,
    from:
      cycleId === "2026-07"
        ? "2026-06-28T00:00:00.000Z"
        : "2026-07-28T00:00:00.000Z",
    to: `${next}-02T00:00:00.000Z`,
  };
  snapshot.source.verificationWindow = { ...snapshot.window };
  snapshot.ledger = snapshot.ledger.map((event) => ({
    ...event,
    occurredAt: event.occurredAt.replace("2026-07", cycleId),
  }));
  const result = createRewardCycleProposal({
    cycleId,
    generatedAt: `${next}-02T00:00:00.000Z`,
    projectId: "eliza",
    snapshot,
    sourceSnapshotSha256: "a".repeat(64),
  });
  if (result.kind !== "reward-allocation") throw new Error("wrong proposal");
  return result;
}
afterEach(() => vi.restoreAllMocks());
describe("exact-cycle reviewed funding", () => {
  it("keeps September promotion paused when only June was funded", () => {
    const project = fundedProject();
    const instrument = project.funding.commitments?.[0];
    if (!instrument?.monthlyCommitment) throw new Error("missing instrument");
    const june = assertProjectDefinition({
      ...project,
      funding: {
        ...project.funding,
        commitments: [
          {
            ...instrument,
            effectiveAt: "2026-06-01T00:00:00.000Z",
            deadline: "2026-07-01T00:00:00.000Z",
            monthlyCommitment: {
              ...instrument.monthlyCommitment,
              cycleId: "2026-06",
            },
          },
        ],
      },
    });
    const history = ["2026-07", "2026-08"].map((cycleId) => ({
      projectId: project.id,
      cycleId,
      kind: "monthly-pool" as const,
      reward: { fundingBasis: deriveAllocationFundingBasis(june, cycleId) },
    }));
    expect(projectPromotionEligible(june, history, "2026-09")).toBe(false);
    expect(projectPromotionEligible(june, history, null)).toBe(false);
    expect(projectPromotionEligible(june, [], "2026-06")).toBe(true);
    const september = assertProjectDefinition({
      ...project,
      funding: {
        ...project.funding,
        commitments: [
          {
            ...instrument,
            effectiveAt: "2026-09-01T00:00:00.000Z",
            deadline: "2026-10-01T00:00:00.000Z",
            monthlyCommitment: {
              ...instrument.monthlyCommitment,
              cycleId: "2026-09",
            },
          },
        ],
      },
    });
    expect(projectPromotionEligible(september, history, "2026-09")).toBe(true);
  });
  it("does not borrow a later month's instrument and freezes exact-month identity", () => {
    const project = fundedProject();
    vi.spyOn(projects, "findProject").mockReturnValue(project);
    expect(proposal("2026-07").capMinor).toBe("0");
    const august = proposal("2026-08");
    expect(august.capMinor).toBe("5000000");
    const unbound = structuredClone(august);
    delete unbound.fundingBasis;
    expect(() => assertRewardAllocationManifest(unbound)).toThrow(
      /exact-cycle funding basis/u,
    );
    expect(august.fundingBasis).toMatchObject({
      cycleId: "2026-08",
      instrumentId:
        "squads-v4-vault:solana:11111111111111111111111111111111:0:Vote111111111111111111111111111111111111111",
    });
    expect(
      deriveAllocationFundingBasis(project, "2026-09").committedMinor,
    ).toBe("0");
    const altered = structuredClone(august);
    if (!altered.fundingBasis) throw new Error("missing basis");
    altered.fundingBasis.cycleId = "2026-09";
    expect(() => assertRewardAllocationManifest(altered)).toThrow(
      /basis cycle/u,
    );
    expect(() =>
      finalizeRewardAllocation(
        altered,
        "2026-09-17T00:00:00.000Z",
        Date.parse("2026-09-17T00:00:00.000Z"),
      ),
    ).toThrow(/basis cycle/u);
    expect(() =>
      assertAllocationFundingBasis({
        ...august.fundingBasis,
        instrumentId: null,
      }),
    ).toThrow(/funding basis/u);
    const instrument = project.funding.commitments?.[0];
    if (!instrument) throw new Error("missing instrument");
    expect(
      deriveAllocationFundingBasis(
        {
          ...project,
          funding: {
            ...project.funding,
            commitments: [
              { ...instrument, replacedAt: "2026-09-01T00:00:00.000Z" },
            ],
          },
        },
        "2026-08",
      ).committedMinor,
    ).toBe("0");
    expect(() =>
      deriveAllocationFundingBasis(
        {
          ...project,
          funding: {
            ...project.funding,
            commitments: [instrument, instrument],
          },
        },
        "2026-08",
      ),
    ).toThrow(/ambiguous/u);
  });
  it("transition authority rejects month substitution, changed instruments and self-declared principal", () => {
    const project = fundedProject();
    const entry = (value: unknown): [string, string] => [
      "projects/eliza/project.json",
      JSON.stringify(value),
    ];
    const check = (cycleId: string, basis: unknown, next = project) =>
      validateProposalFundingTransitions(
        [entry(project)],
        [entry(next)],
        [],
        [
          [
            `cycles/eliza/${cycleId}/proposal.json`,
            JSON.stringify({
              kind: "reward-allocation",
              projectId: "eliza",
              cycleId,
              fundingBasis: basis,
            }),
          ],
        ],
      );
    const august = deriveAllocationFundingBasis(project, "2026-08");
    expect(() => check("2026-08", august)).not.toThrow();
    expect(() =>
      check("2026-07", deriveAllocationFundingBasis(project, "2026-07")),
    ).not.toThrow();
    expect(() => check("2026-07", { ...august, cycleId: "2026-07" })).toThrow(
      /immutable base/u,
    );
    expect(() =>
      check("2026-08", { ...august, instrumentId: `${august.instrumentId}1` }),
    ).toThrow(/immutable base/u);
    const instrument = project.funding.commitments?.[0];
    if (!instrument) throw new Error("missing instrument");
    const changed = {
      ...project,
      funding: {
        ...project.funding,
        commitments: [{ ...instrument, vaultIndex: 1 }],
      },
    };
    expect(() => check("2026-08", august, changed)).toThrow(
      /separate reviewed/u,
    );
  });
  it.each(["unclaimed", "held-below-minimum"] as const)(
    "carries only shared principal from %s additive rows",
    async (state) => {
      const funded = fundedProject();
      // Future reviewed accessibility authority is not available today. Inject only
      // a deterministic policy fixture to exercise the legacy line-aware reader.
      const project = {
        ...funded,
        reward: {
          ...funded.reward,
          reviewBudget: {
            effectiveAt: "2026-08-01T00:00:00.000Z",
            fundingState: "committed" as const,
            paymentMode: "enabled" as const,
            monthlyCapMinor: "1000000",
            monthlyCapDisplay: "$1",
            committedMinor: "1000000",
            unusedFunds: "rollover-without-cap-increase" as const,
          },
        },
      };
      vi.spyOn(projects, "findProject").mockReturnValue(project);
      const result = proposal("2026-08");
      const row = result.allocations[0];
      row.state = state;
      row.suggestedMinor = "1500000";
      row.accruedMinor = "1500000";
      row.lines = {
        sharedPool: { suggestedMinor: "1000000", approvedMinor: "0" },
        reviewBudget: {
          suggestedMinor: "500000",
          approvedMinor: "0",
          evidenceEventIds: row.evidenceEventIds,
        },
      };
      result.rewardLines = {
        sharedPool: {
          capMinor: "5000000",
          suggestedMinor: "1000000",
          approvedMinor: "0",
        },
        reviewBudget: {
          capMinor: "1000000",
          committedMinor: "1000000",
          suggestedMinor: "500000",
          approvedMinor: "0",
        },
      };
      result.totals.suggestedMinor = "1500000";
      const root = await mkdtemp(join(tmpdir(), "slop-shared-carry-"));
      const directory = join(root, "eliza", "2026-08");
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "proposal.json"), JSON.stringify(result));
      const carry = await loadPriorCycleAccrual({
        cyclesRoot: root,
        projectId: "eliza",
        cycleId: "2026-09",
        asOf: "2026-09-18T00:00:00.000Z",
      });
      expect([...carry.accruedMinor.values()]).toEqual(["1000000"]);
    },
  );
});
