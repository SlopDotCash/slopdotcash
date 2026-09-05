import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ProjectId } from "../src/lib/projects.mjs";
import { finalizeRewardAllocation } from "../src/lib/reward-finalization";
import {
  type AllocationState,
  assertRewardAllocationManifest,
} from "../src/lib/rewards";
import { loadPriorCycleAccrual } from "./prior-cycle-accrual";

vi.mock("../src/lib/projects.mjs", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/lib/projects.mjs")>();
  return {
    ...original,
    findProject(id: ProjectId) {
      const project = original.findProject(id);
      return (
        project && {
          ...project,
          reward: {
            ...project.reward,
            reviewBudget: {
              effectiveAt: "2026-07-01T00:00:00.000Z",
              monthlyCapMinor: "1000000",
              monthlyCapDisplay: "$1",
              committedMinor: "1000000",
              paymentMode: "enabled",
              unusedFunds: "rollover-without-cap-increase",
              fundingState: "committed",
            },
          },
        }
      );
    },
  };
});

function proposal(state: AllocationState) {
  const wallet = {
    address: "11111111111111111111111111111111",
    chain: "solana",
    observedAt: "2026-08-02T00:00:00.000Z",
    sourceActorId: "U_fixture",
    sourceClaimId: "claim_original",
    sourceRecordSha256: "b".repeat(64),
    sourceUrl: "https://api.slop.cash/api/v1/wallet-claims/claim_original",
  };
  const report = {
    kind: "unsafe-destination",
    projectId: "eliza",
    cycleId: "2026-07",
    intentId: "pay_eliza_2026_07_fixture",
    suggestedMinor: "1500000",
    reportedAt: "2026-08-03T00:00:00.000Z",
    verifiedAt: "2026-08-03T01:00:00.000Z",
    wallet,
    sourceRepository: "finish-line/reports",
    sourceCommit: "c".repeat(40),
  };
  return assertRewardAllocationManifest({
    schemaVersion: "1",
    kind: "reward-allocation",
    projectId: "eliza",
    cycleId: "2026-07",
    status: "proposed",
    generatedAt: "2026-08-02T00:00:00.000Z",
    approvedAt: null,
    contributionWindow: {
      from: "2026-07-07T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    },
    review: {
      days: 14,
      lastMaterialChangeAt: "2026-08-02T00:00:00.000Z",
      endsAt: "2026-08-16T00:00:00.000Z",
    },
    currency: "USDC",
    chain: "solana",
    capMinor: "10000000000",
    carriedMinor: "0",
    minimumTransferMinor: "2000000",
    feeBasisPoints: 100,
    scoringRuleVersion: "gitarmy-v1",
    sourceSnapshotSha256: "a".repeat(64),
    allocations: [
      {
        intentId: report.intentId,
        actor: { id: "U_fixture", login: "finish-line" },
        score: 1,
        suggestedMinor: "1500000",
        accruedMinor: "1500000",
        approvedMinor: "0",
        state,
        wallet: state === "unclaimed" ? null : wallet,
        evidenceEventIds: ["review_1"],
        adjustmentReason:
          state === "held"
            ? "Maintainer held the authenticated unsafe destination."
            : null,
        relatedParty: false,
        platformApproval: null,
        lines: {
          sharedPool: { suggestedMinor: "1000000", approvedMinor: "0" },
          reviewBudget: {
            suggestedMinor: "500000",
            approvedMinor: "0",
            evidenceEventIds: ["review_1"],
          },
        },
        ...(state === "held"
          ? {
              unsafeDestinationReports: [report],
              hold: {
                kind: "unsafe-destination",
                sourceCommit: report.sourceCommit,
              },
            }
          : {}),
      },
    ],
    rewardLines: {
      sharedPool: {
        capMinor: "10000000000",
        suggestedMinor: "1000000",
        approvedMinor: "0",
      },
      reviewBudget: {
        capMinor: "1000000",
        committedMinor: "1000000",
        suggestedMinor: "500000",
        approvedMinor: "0",
      },
    },
    totals: { suggestedMinor: "1500000", approvedMinor: "0", feeMinor: "0" },
  });
}

describe("review lines never enter carry", () => {
  it.each(["unclaimed", "held-below-minimum", "held"] as const)(
    "carries only the shared-pool line from %s",
    async (state) => {
      const root = await mkdtemp(join(tmpdir(), "slop-review-line-carry-"));
      const directory = join(root, "eliza", "2026-07");
      await mkdir(directory, { recursive: true });
      const reviewed = proposal(state);
      const approved = finalizeRewardAllocation(
        reviewed,
        reviewed.review.endsAt,
        Date.parse(reviewed.review.endsAt),
      );
      expect(approved.totals).toEqual({
        suggestedMinor: "1500000",
        approvedMinor: "0",
        feeMinor: "0",
      });
      expect(approved.rewardLines?.reviewBudget.suggestedMinor).toBe("500000");
      await writeFile(
        join(directory, "proposal.json"),
        JSON.stringify(reviewed),
      );
      await writeFile(
        join(directory, "allocation.json"),
        JSON.stringify(approved),
      );
      const prior = await loadPriorCycleAccrual({
        asOf: "2026-09-05T00:00:00.000Z",
        cycleId: "2026-08",
        cyclesRoot: root,
        projectId: "eliza",
      });
      expect([...prior.accruedMinor]).toEqual([["U_fixture", "1000000"]]);
    },
  );
});
