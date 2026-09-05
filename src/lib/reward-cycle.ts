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
  MINIMUM_TRANSFER_MINOR,
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
  priorAccruedMinor?: ReadonlyMap<string, string>;
  priorActorLogins?: ReadonlyMap<string, string>;
}

export function allocateReviewBudgetMinor(
  totalMinor: bigint,
  contributors: readonly { actorId: string; scoreThirds: number }[],
): Map<string, bigint> {
  if (totalMinor < 0n) throw new RangeError("review budget cannot be negative");
  if (
    contributors.some(
      ({ actorId, scoreThirds }) =>
        actorId.length === 0 ||
        !Number.isSafeInteger(scoreThirds) ||
        scoreThirds < 0,
    ) ||
    new Set(contributors.map(({ actorId }) => actorId)).size !==
      contributors.length
  ) {
    throw new TypeError("review weights must be unique non-negative integers");
  }
  const eligible = contributors
    .filter(
      ({ scoreThirds }) => Number.isSafeInteger(scoreThirds) && scoreThirds > 0,
    )
    .sort((left, right) => left.actorId.localeCompare(right.actorId));
  if (eligible.length === 0 || totalMinor === 0n) return new Map();
  const totalWeight = eligible.reduce(
    (total, contributor) => total + BigInt(contributor.scoreThirds),
    0n,
  );
  const allocations = new Map<string, bigint>();
  const remainders = eligible.map((contributor) => {
    const numerator = totalMinor * BigInt(contributor.scoreThirds);
    const amount = numerator / totalWeight;
    allocations.set(contributor.actorId, amount);
    return { actorId: contributor.actorId, remainder: numerator % totalWeight };
  });
  let unallocated =
    totalMinor -
    [...allocations.values()].reduce((total, amount) => total + amount, 0n);
  remainders.sort((left, right) =>
    left.remainder === right.remainder
      ? left.actorId.localeCompare(right.actorId)
      : left.remainder > right.remainder
        ? -1
        : 1,
  );
  for (let index = 0; unallocated > 0n; index += 1) {
    const actorId = remainders[index % remainders.length].actorId;
    allocations.set(actorId, (allocations.get(actorId) ?? 0n) + 1n);
    unallocated -= 1n;
  }
  return allocations;
}

/**
 * The additive review line is tier-only: finalized-trace weight remains part
 * of the shared-pool score and does not change this second allocation.
 */
export function additiveReviewBudgetWeights(
  events: readonly LeaderboardSnapshot["ledger"][number][],
): Array<{ actorId: string; scoreThirds: number }> {
  const weights = new Map<string, number>();
  for (const event of events) {
    if (event.category !== "substantive-review") continue;
    weights.set(
      event.actor.id,
      (weights.get(event.actor.id) ?? 0) +
        (event.scoreThirds ?? Math.round(event.points * 3)),
    );
  }
  return [...weights].map(([actorId, scoreThirds]) => ({
    actorId,
    scoreThirds,
  }));
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
      platformSharePartsPerMillion:
        view.reward.kind === "external-prize-share"
          ? view.reward.platformSharePartsPerMillion
          : 0,
      entries: view.leaders.map((leader) => ({
        actor: { id: leader.actor.id, login: leader.actor.login },
        score: leader.score,
        sharePartsPerMillion: leader.projectedSharePartsPerMillion ?? 0,
        evidenceEventIds: leader.evidenceEventIds,
      })),
    });
  }

  // Accrual is a debt to the actor, not a reward for this cycle's activity:
  // a positive prior balance must survive a quiet month, so carried-only
  // actors get their own allocation rows after the leaders.
  const leaderIds = new Set(view.leaders.map((leader) => leader.actor.id));
  const carriedOnly = [...(input.priorAccruedMinor ?? [])]
    .filter(([actorId, minor]) => !leaderIds.has(actorId) && BigInt(minor) > 0n)
    .sort(([left], [right]) => left.localeCompare(right));
  const carriedOnlyMinor = carriedOnly.reduce(
    (total, [, minor]) => total + BigInt(minor),
    0n,
  );
  const carriedMinor = (
    view.leaders.reduce(
      (total, leader) =>
        total + BigInt(input.priorAccruedMinor?.get(leader.actor.id) ?? "0"),
      0n,
    ) + carriedOnlyMinor
  ).toString();
  const suggestedMinor = (
    view.leaders.reduce(
      (total, leader) =>
        total +
        BigInt(leader.projectedMinor ?? "0") +
        BigInt(input.priorAccruedMinor?.get(leader.actor.id) ?? "0"),
      0n,
    ) + carriedOnlyMinor
  ).toString();
  const reviewPolicy = view.project.reward.reviewBudget;
  const reviewBudgetTotal =
    reviewPolicy?.fundingState === "committed" &&
    reviewPolicy.paymentMode === "enabled" &&
    Date.parse(reviewPolicy.effectiveAt) <= Date.parse(view.cycle.from)
      ? BigInt(reviewPolicy.committedMinor) <
        BigInt(reviewPolicy.monthlyCapMinor)
        ? BigInt(reviewPolicy.committedMinor)
        : BigInt(reviewPolicy.monthlyCapMinor)
      : 0n;
  const reviewEvents = view.ledger.filter(
    (event) => event.category === "substantive-review",
  );
  const reviewAllocations = allocateReviewBudgetMinor(
    reviewBudgetTotal,
    additiveReviewBudgetWeights(reviewEvents),
  );
  const reviewSuggestedTotal = [...reviewAllocations.values()].reduce(
    (total, amount) => total + amount,
    0n,
  );
  const combinedSuggestedMinor = (
    BigInt(suggestedMinor) + reviewSuggestedTotal
  ).toString();
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
    carriedMinor,
    minimumTransferMinor: MINIMUM_TRANSFER_MINOR,
    feeBasisPoints: view.project.reward.feeBasisPoints,
    scoringRuleVersion: input.snapshot.ruleVersion,
    sourceSnapshotSha256: input.sourceSnapshotSha256,
    allocations: view.leaders
      .map((leader, index) => {
        const wallet = input.wallets?.get(leader.actor.id) ?? null;
        const sharedPoolMinor =
          BigInt(input.priorAccruedMinor?.get(leader.actor.id) ?? "0") +
          BigInt(leader.projectedMinor ?? "0");
        const reviewMinor = reviewAllocations.get(leader.actor.id) ?? 0n;
        const accruedMinor = (sharedPoolMinor + reviewMinor).toString();
        return {
          intentId: `pay_${intentComponent(input.projectId)}_${cycleComponent}_${String(index + 1).padStart(4, "0")}_${intentComponent(leader.actor.id)}`,
          actor: { id: leader.actor.id, login: leader.actor.login },
          score: leader.score,
          suggestedMinor: accruedMinor,
          accruedMinor,
          approvedMinor: "0",
          state: wallet
            ? BigInt(accruedMinor) < BigInt(MINIMUM_TRANSFER_MINOR)
              ? "held-below-minimum"
              : "proposed"
            : "unclaimed",
          wallet,
          evidenceEventIds: leader.evidenceEventIds,
          adjustmentReason: null,
          relatedParty:
            input.relatedPartyActorIds?.has(leader.actor.id) ?? false,
          platformApproval: null,
          ...(reviewBudgetTotal > 0n
            ? {
                lines: {
                  sharedPool: {
                    suggestedMinor: sharedPoolMinor.toString(),
                    approvedMinor: "0",
                  },
                  reviewBudget: {
                    suggestedMinor: reviewMinor.toString(),
                    approvedMinor: "0",
                    evidenceEventIds: reviewEvents
                      .filter((event) => event.actor.id === leader.actor.id)
                      .map((event) => event.id),
                  },
                },
              }
            : {}),
        };
      })
      .concat(
        carriedOnly.map(([actorId, minor], offset) => {
          const login = input.priorActorLogins?.get(actorId);
          if (!login) {
            throw new TypeError(
              `carried accrual for ${actorId} has no prior login; pass priorActorLogins from the prior manifest`,
            );
          }
          const wallet = input.wallets?.get(actorId) ?? null;
          const index = view.leaders.length + offset;
          return {
            intentId: `pay_${intentComponent(input.projectId)}_${cycleComponent}_${String(index + 1).padStart(4, "0")}_${intentComponent(actorId)}`,
            actor: { id: actorId, login },
            score: 0,
            suggestedMinor: minor,
            accruedMinor: minor,
            approvedMinor: "0",
            state: wallet
              ? BigInt(minor) < BigInt(MINIMUM_TRANSFER_MINOR)
                ? ("held-below-minimum" as const)
                : ("proposed" as const)
              : ("unclaimed" as const),
            wallet,
            evidenceEventIds: [],
            adjustmentReason: null,
            relatedParty: input.relatedPartyActorIds?.has(actorId) ?? false,
            platformApproval: null,
            ...(reviewBudgetTotal > 0n
              ? {
                  lines: {
                    sharedPool: { suggestedMinor: minor, approvedMinor: "0" },
                    reviewBudget: {
                      suggestedMinor: "0",
                      approvedMinor: "0",
                      evidenceEventIds: [],
                    },
                  },
                }
              : {}),
          };
        }),
      ),
    ...(reviewBudgetTotal > 0n && reviewPolicy
      ? {
          rewardLines: {
            sharedPool: {
              capMinor: view.project.reward.monthlyCapMinor,
              suggestedMinor,
              approvedMinor: "0",
            },
            reviewBudget: {
              capMinor: reviewPolicy.monthlyCapMinor,
              committedMinor: reviewPolicy.committedMinor,
              suggestedMinor: reviewSuggestedTotal.toString(),
              approvedMinor: "0",
            },
          },
        }
      : {}),
    totals: {
      suggestedMinor: combinedSuggestedMinor,
      approvedMinor: "0",
      feeMinor: feeForPrincipal("0", view.project.reward.feeBasisPoints),
    },
  });
}
