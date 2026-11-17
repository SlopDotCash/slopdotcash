// spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
import type { WorkItem } from "@repo/points/client";
import type { CycleIndexEntry, DirectTransfer, PublicVaultPayment } from "@repo/settlement/client";
import { periodContaining } from "@repo/settlement/kernels/calendar";
import type { PoolFunding } from "../../kernels/poolFunding.ts";
import type { Shown } from "../home/listing.ts";
import type { ShownProject } from "./project.schema.ts";
import { projectFunding } from "./summary.ts";

export const origin = "https://slop.cash";

export const copied = (): Promise<void> => Promise.resolve();

export const project: ShownProject = {
  id: "slop",
  slug: "slop",
  name: "Slop",
  description: "Paid open source work, scored by accepted outcomes.",
  status: "active",
  listingTier: "featured",
  steward: { displayName: "Slop Labs", github: { profileUrl: "https://github.com/slopdotcash" } },
  repositoryUrl: "https://github.com/slopdotcash/slop",
  repositories: [{ id: "slopdotcash/slop" }],
  reward: { kind: "monthly-pool", monthlyCapMinor: 500_000_000n, monthlyCapDisplay: "$500", cycleCaps: [] },
  deployments: [{ network: "base-mainnet", vault: "0x5e1f0000000000000000000000000000000000aa" }],
  record: {},
};

export const reviewedProject: ShownProject = {
  ...project,
  reward: { ...project.reward, reviewBudget: { committedMinor: 100_000_000n, fundingState: "committed", monthlyCapDisplay: "$200" } },
};

export const prizeProject: ShownProject = {
  ...project,
  id: "prize",
  slug: "prize",
  name: "Prize",
  reward: { kind: "external-prize-share", monthlyCapMinor: 0n, monthlyCapDisplay: "$0", cycleCaps: [], externalOpportunity: { advertisedAmountDisplay: "$25,000" } },
  deployments: [],
};

export const bountyProject: ShownProject = {
  ...project,
  securityBounty: {
    rewardMode: "separate",
    status: "open",
    eligibility: "critical-loss-of-funds",
    amount: { grossMinor: 10_000_000_000n, decimals: 6 },
    funding: { state: "verified-available" },
  },
};

export const pausedProject: ShownProject = { ...project, status: "paused" };

export const archivedProject: ShownProject = { ...project, participation: { state: "archived", successorProjectId: "slop-next" } };

export const permissionProject: ShownProject = { ...project, participation: { state: "permission-required" } };

const payingEverywhere = () => true;

const december = periodContaining(Date.parse("2026-12-01T00:00:00.000Z") / 1000);

const vault = { network: "base-mainnet", vault: "0x5e1f0000000000000000000000000000000000aa" };

export const funded: PoolFunding = projectFunding({
  project,
  read: { status: "Current", vaults: [{ ...vault, freeBalance: 900_000_000n, totalGrossWithdrawn: 0n, monthStarts: [] }] },
  networkPays: payingEverywhere,
  nowMs: Date.parse("2026-11-17T12:00:00.000Z"),
});

export const withdrawn: PoolFunding = projectFunding({
  project,
  read: {
    status: "Current",
    vaults: [
      {
        ...vault,
        freeBalance: 300_000_000n,
        totalGrossWithdrawn: 700_000_000n,
        monthStarts: [{ period: december, freeBalance: 1_000_000_000n, totalGrossWithdrawn: 0n, blockTime: Date.parse("2026-12-01T00:10:00.000Z") / 1000 }],
      },
    ],
  },
  networkPays: payingEverywhere,
  nowMs: Date.parse("2026-12-10T12:00:00.000Z"),
});

export const unread: PoolFunding = projectFunding({ project, read: { status: "Loading", vaults: undefined }, networkPays: payingEverywhere, nowMs: Date.parse("2026-11-17T12:00:00.000Z") });

const author = { id: "583231", login: "octocat", avatarUrl: "https://avatars.githubusercontent.com/u/583231", url: "https://github.com/octocat", kind: "User" };

function item(number: number, kind: "issue" | "pull_request"): WorkItem {
  return {
    id: `slopdotcash/slop#${number}`,
    kind,
    number,
    title: kind === "issue" ? `Document the payout check ${number}` : `Tighten the vault review ${number}`,
    url: `https://github.com/slopdotcash/slop/${kind === "issue" ? "issues" : "pull"}/${number}`,
    repository: "slopdotcash/slop",
    author,
    createdAt: "2026-11-10T10:00:00.000Z",
    updatedAt: "2026-11-16T10:00:00.000Z",
    labels: [],
    priority: "normal",
    actionability: "ready",
    isDraft: kind === "issue" ? null : false,
    reviewDecision: null,
    activeReviewRequestCount: null,
    commentCount: 2,
    claim: { status: "unclaimed", source: "github", kind: null, actors: [], claimedAt: null },
    selection: { status: "candidate", reasons: [] },
    evidence: { status: "none", points: 0, maxPoints: 0, categories: [] },
    model: {
      status: "none",
      identifiers: [],
      machineMarkerCount: 0,
      invalidMarkerCount: 0,
      eligibleSourceCount: 0,
      validSourceCount: 0,
      missingSourceCount: 0,
      invalidSourceCount: 0,
      humanOnlySourceCount: 0,
      provenance: "none",
    },
  };
}

export const workItems: ReadonlyArray<WorkItem> = Array.from({ length: 12 }, (_, index) => item(100 + index, index % 3 === 0 ? "pull_request" : "issue"));

export const generatedAt = "2026-11-17T06:00:00.000Z";

function file(cycleId: string, name: string) {
  return { sha256: "0".repeat(64), url: `/data/cycles/slop/${cycleId}/${name}.json` };
}

function cycle(cycleId: string, state: CycleIndexEntry["state"]): CycleIndexEntry {
  return {
    projectId: "slop",
    cycleId,
    kind: "monthly-pool",
    state,
    generatedAt: `${cycleId}-28T00:00:00.000Z`,
    contributionWindow: { from: `${cycleId}-01T00:00:00.000Z`, to: `${cycleId}-28T00:00:00.000Z` },
    reviewEndsAt: null,
    approvedAt: null,
    settledAt: null,
    reward: { currency: "USDC", capMinor: "500000000", suggestedMinor: "490000000", approvedMinor: "490000000", paidMinor: state === "paid" ? "480200000" : "0", feeMinor: "9800000", sharePartsPerMillion: null },
    contributors: [],
    files: { sourceSnapshot: file(cycleId, "snapshot"), proposal: file(cycleId, "proposal"), allocation: null, executionPlan: null, settlement: null, windup: null },
  };
}

export const cycles: ReadonlyArray<CycleIndexEntry> = [cycle("2026-10", "paid"), cycle("2026-09", "paid"), cycle("2026-08", "paid"), cycle("2026-07", "closed-no-awards")];

const transfer: DirectTransfer = {
  projectId: "slop",
  contributionMonth: "2026-10",
  githubUserId: "583231",
  login: "octocat",
  network: "base-mainnet",
  chain: "base",
  recipient: "0x00000000000000000000000000000000000000b0",
  amountMicro: "125000000",
  transactionId: "0x01",
  blockTime: "2026-11-03T15:00:00.000Z",
};

export const transfers: Shown<ReadonlyArray<DirectTransfer>> = {
  status: "Current",
  value: [transfer, { ...transfer, amountMicro: "75500000", transactionId: "0x02", blockTime: "2026-11-04T09:00:00.000Z" }],
};

export const noTransfers: Shown<ReadonlyArray<DirectTransfer>> = { status: "Empty", value: undefined };

export const failedTransfers: Shown<ReadonlyArray<DirectTransfer>> = { status: "Failed", value: undefined, onRetry: () => undefined };

export const vaultPayment: PublicVaultPayment = {
  id: "base-mainnet:0x0a:3",
  projectId: "slop",
  network: "base-mainnet",
  chain: "base",
  contributionMonth: "2026-10",
  assetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  assetDecimals: 6,
  netBase: "98000000",
  transactionId: "0x0a",
  indexedAt: "2026-11-02T00:00:00.000Z",
};

export const vaultPayments: Shown<ReadonlyArray<PublicVaultPayment>> = {
  status: "Current",
  value: Array.from({ length: 7 }, (_, index) => ({ ...vaultPayment, id: `${vaultPayment.id}${index}`, contributionMonth: index === 6 ? null : vaultPayment.contributionMonth })),
};

export const names = (projectId: string): string | undefined => (projectId === "slop" ? "Slop" : undefined);
