// spec/settlement/monthly.md, "Only a current owner, steward or repository administrator changes another recipient's amount"; spec/frontend/ownerMonthly.md, "Only a current manager edits, and the editor closes at the cutoff"
import type { MonthlyOwnerView } from "@repo/settlement/client";
import { initial, type OwnerMonthly } from "../../../../gen/frontend__ownerMonthly.ts";
import type { BountyProject } from "./bounty.schema.ts";
import { secondsOf } from "./month.ts";

const cutoffAt = "2026-12-04T00:00:00.000Z";

export const proposedMonth: MonthlyOwnerView = {
  projectId: "slop",
  period: "2026-11",
  manifestSha256: "a".repeat(64),
  automatic: true,
  canManage: true,
  cutoffAt,
  deployment: { network: "base-mainnet", vault: "0x5e1f0000000000000000000000000000000000aa", owner: "0x0000000000000000000000000000000000000b0b", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  asset: { network: "base-mainnet", assetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", assetDecimals: 6, symbol: "USDC" },
  proposal: {
    capBase: "1000000000",
    allocationSequence: 3,
    latestCutAt: null,
    allocations: [
      { githubUserId: "101", login: "octocat", grossBase: "600000000", sourceDigest: "b".repeat(64), proposedGrossBase: "600000000" },
      { githubUserId: "102", login: "hubot", grossBase: "400000000", sourceDigest: "c".repeat(64), proposedGrossBase: "400000000" },
    ],
  },
  run: null,
};

export const viewOnlyMonth: MonthlyOwnerView = { ...proposedMonth, canManage: false };

export const frozenMonth: MonthlyOwnerView = {
  ...proposedMonth,
  proposal: null,
  run: {
    trigger: "automatic",
    frozenAt: "2026-12-04T00:05:00.000Z",
    snapshotSha256: "d".repeat(64),
    totalGrossBase: "1000000000",
    network: "base-mainnet",
    vault: "0x5e1f0000000000000000000000000000000000aa",
    funded: true,
    awards: [
      { githubUserId: "101", login: "octocat", grossBase: "600000000", feeBase: "12000000", netBase: "588000000", state: "awaiting-reservation" },
      { githubUserId: "102", login: "hubot", grossBase: "400000000", feeBase: "8000000", netBase: "392000000", state: "paid" },
    ],
  },
};

export const underfundedMonth: MonthlyOwnerView = {
  ...frozenMonth,
  run: {
    trigger: "owner",
    frozenAt: "2026-12-02T09:30:00.000Z",
    snapshotSha256: "e".repeat(64),
    totalGrossBase: "1000000000",
    network: "base-mainnet",
    vault: "0x5e1f0000000000000000000000000000000000aa",
    funded: false,
    awards: [
      { githubUserId: "101", login: "octocat", grossBase: "600000000", feeBase: "12000000", netBase: "588000000", state: "underfunded" },
      { githubUserId: "102", login: "hubot", grossBase: "300000000", feeBase: "6000000", netBase: "294000000", state: "excluded" },
      { githubUserId: "103", login: "monalisa", grossBase: "100000000", feeBase: "2000000", netBase: "98000000", state: "conflict" },
    ],
  },
};

export const managing: OwnerMonthly = {
  ...initial,
  owner: 101,
  manages: true,
  lifetime: 1,
  now: secondsOf("2026-12-02T12:00:00.000Z"),
  loaded: true,
  month: { sequence: 3, automatic: true, cutoffAt: secondsOf(cutoffAt), latestCutAt: 0, frozen: false, fixed: false },
};

export const cutsClosed: OwnerMonthly = { ...managing, now: secondsOf("2026-12-03T06:00:00.000Z") };

export const reading: OwnerMonthly = { ...managing, owner: 202, manages: false };

export const frozen: OwnerMonthly = { ...managing, month: { ...managing.month, frozen: true } };

export const reviewedCommitment: OwnerMonthly = { ...frozen, commitment: { ...frozen.commitment, phase: "Reviewed" } };

export const bountyProject: BountyProject = {
  id: "vault-guard",
  slug: "vault-guard",
  securityBounty: {
    amount: { network: "base" },
    intake: { repository: "example/vault-guard" },
    settlement: { chain: "base", deployments: [{ network: "base-mainnet", vault: "0x7a11000000000000000000000000000000000c0d" }] },
  },
};
