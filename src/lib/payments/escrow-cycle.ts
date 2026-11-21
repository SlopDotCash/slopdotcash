import { deriveAllocationFundingBasis } from "../allocation-funding-basis.mjs";
import {
  ESCROW_PAYOUT_FEE_BASIS_POINTS,
  MAX_BASE_UNITS,
} from "../escrow-policy.mjs";
import { githubUserIdFromNodeId } from "../github-actor";
import { assertLeaderboardSnapshot } from "../leaderboard";
import { maintainerShareBasisPoints } from "../maintainer-share.mjs";
import { payoutExcludedGithubUserIds } from "../payout-exclusions.mjs";
import { repositoriesCountedFor } from "../project-repositories.mjs";
import { assertProjectDefinition } from "../project-schema.mjs";
import {
  allocateIntegerTotal,
  createPaymentProjectView,
} from "../project-view";
import {
  activeReviewBudgetCap,
  additiveReviewBudgetWeights,
  allocateReviewBudgetMinor,
  ensureCompleteCycle,
} from "../reward-cycle";
import { sha256Hex as digest } from "../sha256";
import { combineAwards } from "../verified-money";
import {
  ASI_NOVEMBER_CLOSEOUT,
  type AsiHeldWorkUnitRecord,
  asiHeldSourcesAreDisjoint,
} from "./asi-november-closeout";
import {
  assertMaintainerDecisionRecord,
  maintainerShare,
} from "./maintainer-share";

interface EscrowIdentity {
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
    earlyCloseAt?: typeof ASI_NOVEMBER_CLOSEOUT.cutoff;
    asiHeldWorkUnitRecords?: readonly AsiHeldWorkUnitRecord[];
  },
  bytes: Uint8Array,
  identityBytes: Uint8Array | null,
  policyBytes: Uint8Array,
  /**
   * The month's maintainer decision record. Required exactly when the
   * project's revision sets a maintainer share for the month.
   */
  decisionBytes: Uint8Array | null = null,
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
  const closeout =
    input.earlyCloseAt === ASI_NOVEMBER_CLOSEOUT.cutoff
      ? ASI_NOVEMBER_CLOSEOUT
      : undefined;
  if (
    closeout &&
    (project.id !== closeout.projectId ||
      input.cycleId !== closeout.period ||
      project.rewardAsset?.network !== closeout.chain ||
      project.rewardAsset.symbol !== closeout.assetSymbol ||
      project.rewardAsset.decimals !== closeout.assetDecimals ||
      snapshot.window.to < closeout.cutoff ||
      snapshot.source.cutoffAt !== snapshot.window.to ||
      snapshot.source.verificationWindow.from !== snapshot.window.from ||
      snapshot.source.verificationWindow.to !== snapshot.window.to ||
      snapshot.source.evidenceVerification.status !== "complete" ||
      !asiHeldSourcesAreDisjoint(
        snapshot,
        project,
        input.asiHeldWorkUnitRecords ?? [],
      ) ||
      snapshot.generatedAt < closeout.cutoff ||
      snapshot.generatedAt > generatedAt ||
      new Date(generatedAt).toISOString() !== generatedAt)
  )
    throw new Error(
      "ASI's November closeout requires complete verified coverage through the approved cutoff.",
    );
  const view = createPaymentProjectView(
    closeout
      ? { ...snapshot, window: { ...snapshot.window, to: closeout.cutoff } }
      : snapshot,
    project.id,
    input.cycleId,
    closeout && {
      ...deriveAllocationFundingBasis(project, input.cycleId),
      monthlyCapMinor: closeout.grossBase,
    },
    project,
  );
  if (closeout) {
    if (view.cycle.from !== `${closeout.period}-01T00:00:00.000Z`)
      throw new Error(
        "ASI's November closeout requires the entire approved earning period.",
      );
  } else {
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
  }
  if (view.reward.kind !== "monthly-pool")
    throw new Error("Expected monthly pool");
  const cap = BigInt(view.reward.capMinor);
  const reviewCap = activeReviewBudgetCap(
    project.reward.reviewBudget,
    view.cycle.from,
  );
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
  // The maintainer share comes out of the monthly amount before the points
  // split, so the month never distributes more than `cap`.
  const shareBasisPoints = maintainerShareBasisPoints(project, input.cycleId);
  if (closeout && (shareBasisPoints !== 0 || reviewCap !== 0n))
    throw new Error(
      "ASI's November closeout only covers the approved ordinary pool.",
    );
  if (shareBasisPoints > 0 !== (decisionBytes !== null))
    throw new Error(
      shareBasisPoints > 0
        ? "A month with a maintainer share needs its maintainer decision record"
        : "A month without a maintainer share takes no maintainer decision record",
    );
  const decisionRecord: unknown =
    decisionBytes === null ? null : JSON.parse(text(decisionBytes));
  if (decisionRecord !== null) {
    assertMaintainerDecisionRecord(decisionRecord, project.id, input.cycleId);
    // The record must cover exactly the repositories that count this month.
    const counted = repositoriesCountedFor(
      project,
      Date.parse(`${input.cycleId}-01T00:00:00.000Z`),
    )
      .map((repository) => repository.id)
      .sort();
    if (JSON.stringify(counted) !== JSON.stringify(decisionRecord.repositories))
      throw new Error(
        "Maintainer decision record does not cover the project's repositories",
      );
  }
  const share = maintainerShare({
    cap,
    basisPoints: shareBasisPoints,
    decisions: decisionRecord?.decisions ?? [],
    excludedGithubUserIds: payoutExcludedGithubUserIds(project, input.cycleId),
  });
  const allocations = allocateIntegerTotal(cap - share.pool, view.leaders);
  // Monthly proposals derive identities from this already computed view.
  // Archive reconstruction still uses its exact retained identity bytes.
  const resolvedIdentityBytes =
    identityBytes ??
    new TextEncoder().encode(
      JSON.stringify(
        view.leaders.map((leader) => {
          const githubUserId = githubUserIdFromNodeId(leader.actor.id);
          if (!githubUserId)
            throw new Error(
              `No numeric GitHub identity for ${leader.actor.login}`,
            );
          return {
            nodeId: leader.actor.id,
            githubUserId,
            login: leader.actor.login,
          };
        }),
      ),
    );
  const identities = JSON.parse(
    text(resolvedIdentityBytes),
  ) as EscrowIdentity[];
  if (
    !Array.isArray(identities) ||
    identities.length !== view.leaders.length ||
    new Set(identities.map((actor) => actor.nodeId)).size !==
      identities.length ||
    new Set(identities.map((actor) => actor.githubUserId)).size !==
      identities.length
  )
    throw new Error("Actor identity coverage differs from proposal");
  // One row per account: a maintainer who also scored gets both parts in
  // one award, because an account has one award origin per project month.
  const maintainerAmount = new Map(
    share.rows.map((row) => [row.githubUserId, row.amount]),
  );
  const recipients = view.leaders.map((leader) => {
    const identity = identities.find(
      (actor) => actor.nodeId === leader.actor.id,
    );
    if (!identity) throw new Error("Missing numeric GitHub identity");
    return {
      githubUserId: identity.githubUserId,
      githubNodeId: leader.actor.id,
      login: leader.actor.login,
      shared: allocations.get(leader.actor.id) ?? 0n,
      review: reviewAllocations.get(leader.actor.id) ?? 0n,
      evidenceEventIds: [...leader.evidenceEventIds].sort(),
    };
  });
  const scored = new Set(recipients.map((entry) => entry.githubUserId));
  for (const row of share.rows)
    if (!scored.has(row.githubUserId))
      recipients.push({
        githubUserId: row.githubUserId,
        githubNodeId: row.nodeId,
        login: row.login,
        shared: 0n,
        review: 0n,
        evidenceEventIds: [],
      });
  const combined = combineAwards(
    recipients.map(
      (entry) =>
        entry.shared + (maintainerAmount.get(entry.githubUserId) ?? 0n),
    ),
    recipients.map((entry) => entry.review),
    cap,
    reviewCap,
  );
  if (!combined.ok)
    throw new Error("Award allocations exceed their monthly caps");
  const awards = recipients
    .map((entry, index) => {
      const { gross, fee, net } = combined.awards[index];
      return {
        githubUserId: entry.githubUserId,
        githubNodeId: entry.githubNodeId,
        login: entry.login,
        sourceDigest: escrowAwardOrigin(
          project.id,
          input.cycleId,
          entry.githubUserId,
        ),
        grossMicro: gross.toString(),
        feeMicro: fee.toString(),
        netMicro: net.toString(),
        evidenceEventIds: entry.evidenceEventIds,
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
    githubIdentitiesSha256: digest(resolvedIdentityBytes),
    projectPolicySha256: digest(policyBytes),
    scoringRuleVersion: snapshot.ruleVersion,
    contributionWindow: { from: view.cycle.from, to: view.cycle.to },
    grossCapMicro: (cap + reviewCap).toString(),
    sharedPoolCapMicro: cap.toString(),
    reviewBudgetCapMicro: reviewCap.toString(),
    feeBasisPoints: ESCROW_PAYOUT_FEE_BASIS_POINTS,
    feeMode: "deduct-from-gross",
    // Present only for a month with a maintainer share, so the proposal of
    // every other month keeps its exact bytes.
    ...(decisionBytes === null
      ? {}
      : {
          maintainerShare: {
            basisPoints: shareBasisPoints,
            poolMicro: share.pool.toString(),
            decisionsSha256: digest(decisionBytes),
            rows: share.rows.map((row) => ({
              githubUserId: row.githubUserId,
              login: row.login,
              decisions: row.decisions,
              grossMicro: row.amount.toString(),
            })),
          },
        }),
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
  // An archive holds the decision record exactly when its proposal names a
  // maintainer share; the rebuild refuses a record the policy does not call for.
  const decisionBytes =
    value.maintainerShare === undefined
      ? null
      : await readArchive("maintainer-decisions.json");
  const baseline = buildEscrowCycle(
    { projectId, cycleId, generatedAt: value.generatedAt },
    bytes,
    identityBytes,
    policyBytes,
    decisionBytes,
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
