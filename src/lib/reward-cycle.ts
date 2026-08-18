/**
 * Converts a complete, immutable project snapshot into the public proposal for
 * one closed reward cycle. This layer proposes deterministic amounts or shares;
 * human review and on-chain settlement remain separate, auditable transitions.
 */

import type { LeaderboardSnapshot } from "./leaderboard";
import { createProjectView } from "./project-view";
import type { ProjectId } from "./projects.mjs";
import {
  assertExternalContributionShareManifest,
  assertRewardAllocationManifest,
  type ExternalContributionShareManifest,
  feeForPrincipal,
  REVIEW_WINDOW_DAYS,
  type RewardAllocationManifest,
  type WalletProof,
} from "./rewards";

export type RewardCycleProposal =
  | ExternalContributionShareManifest
  | RewardAllocationManifest;

export interface CreateRewardCycleProposalInput {
  cycleId: string;
  generatedAt: string;
  projectId: ProjectId;
  relatedPartyActorIds?: ReadonlySet<string>;
  snapshot: LeaderboardSnapshot;
  sourceSnapshotSha256: string;
  wallets?: ReadonlyMap<string, WalletProof>;
}

function cycleBounds(cycleId: string): { from: number; to: number } {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cycleId)) {
    throw new TypeError(`Invalid reward cycle id: ${cycleId}`);
  }
  const [yearText, monthText] = cycleId.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  return {
    from: Date.UTC(year, monthIndex, 1),
    to: Date.UTC(year, monthIndex + 1, 1),
  };
}

function validTimestamp(value: string, field: string): number {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(`${field} must be an exact UTC timestamp`);
  }
  return Date.parse(value);
}

function intentComponent(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 48);
}

function ensureCompleteCycle(
  input: CreateRewardCycleProposalInput,
  view: ReturnType<typeof createProjectView>,
): void {
  const calendar = cycleBounds(input.cycleId);
  const expectedFrom = Math.max(
    calendar.from,
    Date.parse(view.project.reward.rewardStartAt),
  );
  const generatedAt = validTimestamp(input.generatedAt, "generatedAt");
  if (
    view.cycle.from !== new Date(expectedFrom).toISOString() ||
    view.cycle.to !== new Date(calendar.to).toISOString() ||
    view.cycle.status !== "closed" ||
    generatedAt < calendar.to
  ) {
    throw new RangeError(
      `Cycle ${input.cycleId} does not have complete closed-window evidence`,
    );
  }
  if (
    input.snapshot.source.verificationWindow.from !==
      input.snapshot.window.from ||
    input.snapshot.source.verificationWindow.to !== input.snapshot.window.to ||
    input.snapshot.source.evidenceVerification.status !== "complete"
  ) {
    throw new RangeError(
      `Cycle ${input.cycleId} cannot be proposed from incomplete verification coverage`,
    );
  }
  if (!/^[0-9a-f]{64}$/u.test(input.sourceSnapshotSha256)) {
    throw new TypeError(
      "sourceSnapshotSha256 must be a lowercase SHA-256 digest",
    );
  }
}

/** Creates a deterministic review proposal; it never approves or pays anyone. */
export function createRewardCycleProposal(
  input: CreateRewardCycleProposalInput,
): RewardCycleProposal {
  const view = createProjectView(
    input.snapshot,
    input.projectId,
    input.cycleId,
  );
  ensureCompleteCycle(input, view);

  if (view.project.reward.kind === "external-prize-share") {
    return assertExternalContributionShareManifest({
      schemaVersion: "1",
      kind: "external-contribution-share",
      projectId: input.projectId,
      cycleId: input.cycleId,
      status: "provisional",
      generatedAt: input.generatedAt,
      contributionWindow: {
        from: view.cycle.from,
        to: view.cycle.to,
      },
      scoringRuleVersion: input.snapshot.ruleVersion,
      sourceSnapshotSha256: input.sourceSnapshotSha256,
      entries: view.leaders.map((leader) => ({
        actor: { id: leader.actor.id, login: leader.actor.login },
        score: leader.score,
        sharePartsPerMillion: leader.projectedSharePartsPerMillion ?? 0,
        evidenceEventIds: leader.evidenceEventIds,
      })),
    });
  }

  const suggestedMinor = view.leaders
    .reduce((total, leader) => total + BigInt(leader.projectedMinor ?? "0"), 0n)
    .toString();
  const reviewEndsAt = new Date(
    Date.parse(input.generatedAt) + REVIEW_WINDOW_DAYS * 86_400_000,
  ).toISOString();
  const cycleComponent = input.cycleId.replace("-", "_");
  return assertRewardAllocationManifest({
    schemaVersion: "1",
    kind: "reward-allocation",
    projectId: input.projectId,
    cycleId: input.cycleId,
    status: "proposed",
    generatedAt: input.generatedAt,
    approvedAt: null,
    contributionWindow: {
      from: view.cycle.from,
      to: view.cycle.to,
    },
    review: {
      days: REVIEW_WINDOW_DAYS,
      lastMaterialChangeAt: input.generatedAt,
      endsAt: reviewEndsAt,
    },
    currency: "USDC",
    chain: "solana",
    capMinor: view.project.reward.monthlyCapMinor,
    feeBasisPoints: view.project.reward.feeBasisPoints,
    scoringRuleVersion: input.snapshot.ruleVersion,
    sourceSnapshotSha256: input.sourceSnapshotSha256,
    allocations: view.leaders.map((leader, index) => {
      const wallet = input.wallets?.get(leader.actor.id) ?? null;
      return {
        intentId: `pay_${intentComponent(input.projectId)}_${cycleComponent}_${String(index + 1).padStart(4, "0")}_${intentComponent(leader.actor.id)}`,
        actor: { id: leader.actor.id, login: leader.actor.login },
        score: leader.score,
        suggestedMinor: leader.projectedMinor ?? "0",
        approvedMinor: "0",
        state: wallet ? "proposed" : "unclaimed",
        wallet,
        evidenceEventIds: leader.evidenceEventIds,
        adjustmentReason: null,
        relatedParty: input.relatedPartyActorIds?.has(leader.actor.id) ?? false,
        platformApproval: null,
      };
    }),
    totals: {
      suggestedMinor,
      approvedMinor: "0",
      feeMinor: feeForPrincipal("0", view.project.reward.feeBasisPoints),
    },
  });
}
