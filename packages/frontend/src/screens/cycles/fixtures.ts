// spec/frontend/projections.md, "The cycle page lists public cuts with distinct loading, error, empty and list states"; spec/frontend/views.md, "Cycle archive filters keep only selections that a published cycle supports"
import type { CycleIndexEntry, MonthlyCut } from "@repo/settlement/client";

export const cuts: ReadonlyArray<MonthlyCut> = [
  { githubUserId: "1001", login: "alice", proposedGrossBase: "120000000", grossBase: "90000000", reason: "Duplicate of an earlier fix.", cutAt: "2026-12-02T09:30:00.000Z" },
];

const files = { sourceSnapshot: { sha256: "a".repeat(64), url: "/data/cycles/slop/2026-10/source.json" }, proposal: { sha256: "b".repeat(64), url: "/data/cycles/slop/2026-10/proposal.json" }, allocation: null, executionPlan: null, settlement: null, windup: null };

export const paidCycle: CycleIndexEntry = {
  projectId: "slop",
  cycleId: "2026-10",
  kind: "monthly-pool",
  state: "paid",
  generatedAt: "2026-11-10T00:00:00.000Z",
  contributionWindow: { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" },
  reviewEndsAt: "2026-11-15T00:00:00.000Z",
  approvedAt: "2026-11-05T00:00:00.000Z",
  settledAt: "2026-11-08T00:00:00.000Z",
  reward: { currency: "USDC", capMinor: "500000000", suggestedMinor: "300000000", approvedMinor: "300000000", paidMinor: "300000000", feeMinor: "15000000", sharePartsPerMillion: null },
  contributors: [
    { actor: { id: "U_kgDOAAAD6Q", login: "alice" }, score: 10, state: "paid", suggestedMinor: "200000000", approvedMinor: "200000000", paidMinor: "200000000", sharePartsPerMillion: null, wallet: null },
    { actor: { id: "U_kgDOAAAD6w", login: "carol" }, score: 5, state: "paid", suggestedMinor: "100000000", approvedMinor: "100000000", paidMinor: "100000000", sharePartsPerMillion: null, wallet: null },
  ],
  files,
};
