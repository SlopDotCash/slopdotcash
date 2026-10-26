import {
  ESCROW_PAYOUT_FEE_BASIS_POINTS,
  MAX_BASE_UNITS,
} from "../escrow-policy.mjs";
import { assertLeaderboardSnapshot } from "../leaderboard";
import { assertProjectDefinition } from "../project-schema.mjs";
import {
  allocateIntegerTotal,
  createPaymentProjectView,
} from "../project-view";
import {
  additiveReviewBudgetWeights,
  allocateReviewBudgetMinor,
  ensureCompleteCycle,
} from "../reward-cycle";
import { sha256Hex as digest } from "../sha256";
import { ordinaryFee } from "./contracts";
export interface EscrowIdentity {
  nodeId: string;
  githubUserId: string;
  login: string;
}
const text = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);

/** Origin excludes amount, wallet, snapshot and network so revisions cannot pay twice. */
export function escrowAwardOrigin(
  projectId: string,
  cycleId: string,
  actorId: string,
) {
  if (!/^[1-9][0-9]*$/.test(actorId) || BigInt(actorId) > (1n << 64n) - 1n)
    throw new Error("GitHub actor ID must fit uint64");
  return digest(
    JSON.stringify(["slop-escrow-origin-v2", projectId, cycleId, actorId]),
  );
}

export function buildEscrowCycle(
  input: {
    projectId: string;
    cycleId: string;
    generatedAt: string;
  },
  bytes: Uint8Array,
  identityBytes: Uint8Array,
  policyBytes: Uint8Array,
) {
  const project = assertProjectDefinition(JSON.parse(text(policyBytes)));
  if (project.id !== input.projectId)
    throw new Error("Archived project is not canonical");
  if (
    !project?.escrow ||
    input.cycleId < project.escrow.effectiveCycle ||
    project.reward.kind !== "monthly-pool"
  )
    throw new Error("Project must adopt the reviewed escrow policy first");
  const snapshot = JSON.parse(text(bytes));
  assertLeaderboardSnapshot(snapshot);
  const generatedAt = input.generatedAt;
  const sourceSnapshotSha256 = digest(bytes);
  const view = createPaymentProjectView(
    snapshot,
    project.id,
    input.cycleId,
    undefined,
    project,
  );
  ensureCompleteCycle(
    {
      projectId: project.id,
      cycleId: input.cycleId,
      generatedAt,
      sourceSnapshotSha256,
      snapshot,
    },
    view,
  );
  if (view.reward.kind !== "monthly-pool")
    throw new Error("Expected monthly pool");
  const cap = BigInt(view.reward.capMinor);
  const reviewPolicy = project.reward.reviewBudget;
  const reviewCap =
    reviewPolicy?.fundingState === "committed" &&
    reviewPolicy.paymentMode === "enabled" &&
    Date.parse(reviewPolicy.effectiveAt) <= Date.parse(view.cycle.from)
      ? BigInt(reviewPolicy.committedMinor) <
        BigInt(reviewPolicy.monthlyCapMinor)
        ? BigInt(reviewPolicy.committedMinor)
        : BigInt(reviewPolicy.monthlyCapMinor)
      : 0n;
  if (cap < 0n || cap + reviewCap > MAX_BASE_UNITS)
    throw new Error("Gross cap exceeds supported range");
  const reviewAllocations = allocateReviewBudgetMinor(
    reviewCap,
    additiveReviewBudgetWeights(
      view.ledger.filter((event) =>
        view.leaders.some(
          (leader) =>
            leader.actor.id === event.actor.id &&
            leader.payoutExclusion === null,
        ),
      ),
    ),
  );
  const allocations = allocateIntegerTotal(cap, view.leaders);
  const identities = JSON.parse(text(identityBytes)) as EscrowIdentity[];
  if (
    !Array.isArray(identities) ||
    identities.length !== view.leaders.length ||
    new Set(identities.map((actor) => actor.nodeId)).size !==
      identities.length ||
    new Set(identities.map((actor) => actor.githubUserId)).size !==
      identities.length
  )
    throw new Error("Actor identity coverage differs from proposal");
  const awards = view.leaders
    .map((leader) => {
      const identity = identities.find(
        (actor) => actor.nodeId === leader.actor.id,
      );
      if (!identity) throw new Error("Missing numeric GitHub identity");
      const gross =
        (allocations.get(leader.actor.id) ?? 0n) +
        (reviewAllocations.get(leader.actor.id) ?? 0n);
      const fee = ordinaryFee(gross);
      return {
        githubUserId: identity.githubUserId,
        githubNodeId: leader.actor.id,
        login: leader.actor.login,
        sourceDigest: escrowAwardOrigin(
          project.id,
          input.cycleId,
          identity.githubUserId,
        ),
        grossMicro: gross.toString(),
        feeMicro: fee.toString(),
        netMicro: (gross - fee).toString(),
        evidenceEventIds: [...leader.evidenceEventIds].sort(),
      };
    })
    .sort((a, b) => a.githubUserId.localeCompare(b.githubUserId));
  const proposal = {
    schemaVersion: "2",
    kind: "escrow-gross-proposal",
    projectId: project.id,
    cycleId: input.cycleId,
    chain: project.escrow.chain,
    status: "under-review",
    generatedAt,
    reviewEndsAt: new Date(
      Date.parse(generatedAt) + 14 * 86400000,
    ).toISOString(),
    sourceSnapshotSha256,
    githubIdentitiesSha256: digest(identityBytes),
    projectPolicySha256: digest(policyBytes),
    scoringRuleVersion: snapshot.ruleVersion,
    contributionWindow: { from: view.cycle.from, to: view.cycle.to },
    grossCapMicro: (cap + reviewCap).toString(),
    sharedPoolCapMicro: cap.toString(),
    reviewBudgetCapMicro: reviewCap.toString(),
    feeBasisPoints: ESCROW_PAYOUT_FEE_BASIS_POINTS,
    feeMode: "deduct-from-gross",
    awards,
  };
  return proposal;
}

/** Exact reconstruction rejects amount changes, omitted actors, and edited review dates. */
export async function validateEscrowCycle(
  readArchive: (name: string) => Promise<Uint8Array>,
  projectId: string,
  cycleId: string,
) {
  const bytes = await readArchive("source-snapshot.json");
  const proposalBytes = await readArchive("proposal.json");
  const value = JSON.parse(text(proposalBytes));
  if (typeof value.generatedAt !== "string")
    throw new Error("Missing review start");
  const identityBytes = await readArchive("github-identities.json");
  const policyBytes = await readArchive("project.json");
  const baseline = buildEscrowCycle(
    { projectId, cycleId, generatedAt: value.generatedAt },
    bytes,
    identityBytes,
    policyBytes,
  );
  if (JSON.stringify(value) !== JSON.stringify(baseline))
    throw new Error(
      "Escrow proposal differs from its complete frozen source or current policy",
    );
  return {
    proposal: baseline,
    bytes: proposalBytes,
    digest: digest(proposalBytes),
  };
}
