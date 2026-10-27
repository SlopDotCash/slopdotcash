/**
 * Validates the Git-backed reward cycles and publishes the static cycle index.
 * Escrow cycles are validated in place. Historical monthly-pool cycles keep
 * their proposal and approved allocation, each bound to a frozen source
 * snapshot; the retired settlement rail adds no files and reads no chain.
 */

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LAST_LEGACY_CAP_CYCLE } from "../src/lib/allocation-funding";
import { canonicalJson as canonical } from "../src/lib/canonical-json";
import {
  assertCycleIndex,
  CYCLE_INDEX_SCHEMA_VERSION,
  type CycleFileReference,
  type CycleIndex,
  type CycleIndexEntry,
} from "../src/lib/cycle-index";
import {
  assertLeaderboardSnapshot,
  type LeaderboardSnapshot,
} from "../src/lib/leaderboard";
import { assertEscrowDecisions } from "../src/lib/payments/escrow-review";
import { createProjectView } from "../src/lib/project-view";
import { findHistoricalProject, type ProjectId } from "../src/lib/projects.mjs";
import { createRewardCycleProposal } from "../src/lib/reward-cycle";
import { finalizeRewardAllocation } from "../src/lib/reward-finalization";
import {
  assertExternalContributionShareManifest,
  assertRewardAllocationManifest,
  type ProfileReadmeWalletProof,
  type RewardAllocation,
  type RewardAllocationManifest,
} from "../src/lib/rewards";
import { validateEscrowCycle } from "./prepare-escrow-cycle";
import { loadPriorCycleAccrual } from "./prior-cycle-accrual";
import {
  isReadmeProof,
  unboundReadmeProofReason,
} from "./readme-proof-binding";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CYCLES_ROOT = resolve(REPOSITORY_ROOT, "cycles");
export const PUBLIC_CYCLES_ROOT = resolve(
  REPOSITORY_ROOT,
  "public/data/cycles",
);
const ALLOWED_FILES = new Set([
  "allocation.json",
  "proposal.json",
  "source-snapshot.json",
]);
const REQUIRED_FILES = ["proposal.json", "source-snapshot.json"] as const;
const MAX_CYCLES = 240;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

interface JsonFile {
  bytes: Buffer;
  digest: string;
  value: unknown;
}

interface CycleBuild {
  entry: CycleIndexEntry;
  files: Map<string, Buffer>;
  allocation: RewardAllocationManifest | null;
}

function reference(
  projectId: string,
  cycleId: string,
  name: string,
  file: JsonFile,
): CycleFileReference {
  return {
    sha256: file.digest,
    url: `/data/cycles/${projectId}/${cycleId}/${name}`,
  };
}

async function jsonFile(
  path: string,
  maxBytes = MAX_JSON_BYTES,
): Promise<JsonFile> {
  const stats = await lstat(path);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size <= 0 ||
    stats.size > maxBytes
  ) {
    throw new TypeError(
      `${relative(REPOSITORY_ROOT, path)} is not a bounded regular file`,
    );
  }
  const bytes = await readFile(path);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new TypeError(
      `${relative(REPOSITORY_ROOT, path)} is not valid JSON`,
      {
        cause: error,
      },
    );
  }
  return {
    bytes,
    digest: createHash("sha256").update(bytes).digest("hex"),
    value,
  };
}

type Allocation = RewardAllocationManifest["allocations"][number];

/**
 * The amount fields of a row whose reviewed total is `amountMinor`. A retained
 * review-budget line keeps its amount unless the row is excluded, and the
 * shared-pool line takes the rest.
 */
function reviewedAllocationAmounts(
  row: Pick<RewardAllocation, "accruedMinor" | "lines">,
  amountMinor: string,
  excluded: boolean,
): Pick<RewardAllocation, "accruedMinor" | "lines" | "suggestedMinor"> {
  const amount = BigInt(amountMinor);
  const reviewMinor = excluded
    ? 0n
    : BigInt(row.lines?.reviewBudget.suggestedMinor ?? "0");
  if (amount < reviewMinor)
    throw new RangeError(
      "Included amount cannot reduce the separate review-budget line",
    );
  return {
    suggestedMinor: amountMinor,
    ...(row.accruedMinor === undefined ? {} : { accruedMinor: amountMinor }),
    ...(row.lines
      ? {
          lines: {
            sharedPool: {
              ...row.lines.sharedPool,
              suggestedMinor: (amount - reviewMinor).toString(),
            },
            reviewBudget: {
              ...row.lines.reviewBudget,
              suggestedMinor: reviewMinor.toString(),
            },
          },
        }
      : {}),
  };
}

/** The fields of a row that a funding review may change. */
function amounts(allocation: Allocation): string {
  return canonical({
    accruedMinor: allocation.accruedMinor ?? null,
    lines: allocation.lines
      ? {
          sharedPool: {
            suggestedMinor: allocation.lines.sharedPool.suggestedMinor,
          },
          reviewBudget: {
            suggestedMinor: allocation.lines.reviewBudget.suggestedMinor,
            evidenceEventIds: allocation.lines.reviewBudget.evidenceEventIds,
          },
        }
      : null,
    suggestedMinor: allocation.suggestedMinor,
  });
}

/**
 * During the public review a creator may exclude, reduce or increase a row
 * (cycles/README.md). The funding review writes the new total with a public
 * reason, an excluded row at zero, and lines derived by
 * reviewedAllocationAmounts. A row whose amounts differ from the frozen
 * regeneration is accepted only in that shape.
 */
function isReviewedAmount(allocation: Allocation, expected: Allocation) {
  const excluded = allocation.state === "excluded";
  if (
    !allocation.adjustmentReason ||
    (excluded && allocation.suggestedMinor !== "0")
  )
    return false;
  try {
    return (
      amounts(allocation) ===
      amounts({
        ...expected,
        ...reviewedAllocationAmounts(
          expected,
          allocation.suggestedMinor,
          excluded,
        ),
      })
    );
  } catch {
    return false;
  }
}

/**
 * Compares each proposal row with the row regenerated from the frozen inputs.
 * The login must be the exact login of the regenerated row: the snapshot
 * login for a scored row, the prior-manifest login for a carried row. A README
 * proof has no actor id and is bound to that login, so a login that this check
 * cannot bind to the immutable actor id is never accepted. A README proof is
 * accepted only when a reviewed record binds it to the actor id
 * (readme-proof-binding.ts). Else the row stays unclaimed (ACC-01).
 * Returns whether a row holds an amount changed by the public review.
 */
export function assertAllocationsMatchBaseline(
  proposal: RewardAllocationManifest,
  baseline: { allocations: readonly Allocation[] },
  priorReadmeProofs: ReadonlyMap<string, ProfileReadmeWalletProof>,
): boolean {
  const byIntent = new Map(
    baseline.allocations.map((allocation) => [allocation.intentId, allocation]),
  );
  if (proposal.allocations.length !== baseline.allocations.length) {
    throw new TypeError("Reward proposal adds or removes a scored contributor");
  }
  let reviewed = false;
  for (const allocation of proposal.allocations) {
    const expected = byIntent.get(allocation.intentId);
    const frozenAmounts =
      expected !== undefined && amounts(allocation) === amounts(expected);
    if (
      !expected ||
      allocation.actor.id !== expected.actor.id ||
      allocation.actor.login !== expected.actor.login ||
      allocation.score !== expected.score ||
      (!frozenAmounts && !isReviewedAmount(allocation, expected)) ||
      (expected.unsafeDestinationReports ?? []).some(
        (report) =>
          !(allocation.unsafeDestinationReports ?? []).some(
            (candidate) => canonical(candidate) === canonical(report),
          ),
      ) ||
      canonical(allocation.evidenceEventIds) !==
        canonical(expected.evidenceEventIds)
    ) {
      throw new TypeError(
        `Reward proposal intent ${allocation.intentId} differs from its frozen snapshot`,
      );
    }
    if (!frozenAmounts) reviewed = true;
    // A README proof names a login, not an actor id, and the login of a row
    // can now belong to another account (rename, then reuse), for scored and
    // carried rows alike. So a row may hold a README proof only if a reviewed
    // record outside this proposal binds it to the actor id: the exact proof
    // of the prior manifest, or a pinned legacy proof. Registry and issue
    // proofs carry the actor id (assertRewardAllocationManifest).
    if (isReadmeProof(allocation.wallet)) {
      const reason = unboundReadmeProofReason({
        projectId: proposal.projectId,
        cycleId: proposal.cycleId,
        actorId: allocation.actor.id,
        wallet: allocation.wallet,
        priorProof: priorReadmeProofs.get(allocation.actor.id),
      });
      if (reason)
        throw new TypeError(
          `Reward proposal intent ${allocation.intentId}: ${reason}`,
        );
    }
  }
  return reviewed;
}

/**
 * Totals of a proposal that holds reviewed amounts.
 * assertRewardAllocationManifest already reconciles the totals and line totals
 * with the rows, so this checks what the funding review enforces besides: the
 * shared pool stays within the cap plus carry, the line caps stay frozen, and
 * the review window restarted after generation, because an amount change
 * resets the review.
 */
function isReviewedTotal(
  proposal: RewardAllocationManifest,
  baseline: RewardAllocationManifest,
): boolean {
  const frozenLines = (manifest: RewardAllocationManifest) =>
    manifest.rewardLines
      ? canonical({
          reviewBudget: {
            ...manifest.rewardLines.reviewBudget,
            suggestedMinor: null,
          },
          sharedPool: {
            ...manifest.rewardLines.sharedPool,
            suggestedMinor: null,
          },
        })
      : null;
  const sharedMinor = proposal.allocations.reduce(
    (sum, row) =>
      sum + BigInt(row.lines?.sharedPool.suggestedMinor ?? row.suggestedMinor),
    0n,
  );
  return (
    sharedMinor <=
      BigInt(proposal.capMinor) + BigInt(proposal.carriedMinor ?? "0") &&
    frozenLines(proposal) === frozenLines(baseline) &&
    Date.parse(proposal.review.lastMaterialChangeAt) >
      Date.parse(baseline.review.lastMaterialChangeAt)
  );
}

export async function verifyProposalAgainstSnapshot(
  proposal: RewardAllocationManifest,
  snapshot: LeaderboardSnapshot,
  snapshotDigest: string,
): Promise<void> {
  if (!proposal.fundingBasis && proposal.cycleId > LAST_LEGACY_CAP_CYCLE) {
    throw new TypeError(
      "New cycle proposals must freeze their committed funding basis",
    );
  }
  const priorAccrual = await loadPriorCycleAccrual({
    asOf: proposal.generatedAt,
    cycleId: proposal.cycleId,
    cyclesRoot: CYCLES_ROOT,
    projectId: proposal.projectId as ProjectId,
  });
  const baseline = createRewardCycleProposal({
    archivedProject: findHistoricalProject(proposal.projectId) ?? undefined,
    ...(proposal.fundingBasis
      ? { fundingBasis: proposal.fundingBasis }
      : { legacyCapMinor: proposal.capMinor }),
    frozenChain: proposal.chain,
    cycleId: proposal.cycleId,
    generatedAt: proposal.generatedAt,
    projectId: proposal.projectId,
    snapshot,
    sourceSnapshotSha256: snapshotDigest,
    priorAccruedMinor: priorAccrual.accruedMinor,
    priorActorLogins: priorAccrual.actorLogins,
    priorUnsafeDestinationReports: priorAccrual.unsafeDestinationReports,
  });
  if (baseline.kind !== "reward-allocation") {
    throw new TypeError("Monthly proposal regenerated as an external share");
  }
  const reviewed = assertAllocationsMatchBaseline(
    proposal,
    baseline,
    priorAccrual.actorReadmeProofs ?? new Map(),
  );
  if (
    proposal.sourceSnapshotSha256 !== snapshotDigest ||
    proposal.scoringRuleVersion !== snapshot.ruleVersion ||
    proposal.contributionWindow.from !== baseline.contributionWindow.from ||
    proposal.contributionWindow.to !== baseline.contributionWindow.to ||
    proposal.capMinor !== baseline.capMinor ||
    proposal.carriedMinor !== baseline.carriedMinor ||
    (reviewed
      ? !isReviewedTotal(proposal, baseline)
      : canonical(proposal.rewardLines) !== canonical(baseline.rewardLines) ||
        proposal.totals.suggestedMinor !== baseline.totals.suggestedMinor)
  ) {
    throw new TypeError(
      "Reward proposal metadata differs from its frozen snapshot",
    );
  }
}

async function buildCycle(
  projectId: string,
  cycleId: string,
  directory: string,
): Promise<CycleBuild> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !ALLOWED_FILES.has(entry.name)
    ) {
      throw new TypeError(
        `${relative(REPOSITORY_ROOT, join(directory, entry.name))} is not an allowed cycle file`,
      );
    }
  }
  for (const required of REQUIRED_FILES) {
    if (!names.includes(required)) {
      throw new TypeError(`${projectId}/${cycleId} is missing ${required}`);
    }
  }
  const loaded = new Map<string, JsonFile>();
  await Promise.all(
    names.map(async (name) => {
      loaded.set(
        name,
        await jsonFile(
          join(directory, name),
          name === "source-snapshot.json" ? MAX_SNAPSHOT_BYTES : MAX_JSON_BYTES,
        ),
      );
    }),
  );
  const snapshotFile = loaded.get("source-snapshot.json");
  const proposalFile = loaded.get("proposal.json");
  if (!snapshotFile || !proposalFile)
    throw new Error("required cycle files vanished");
  assertLeaderboardSnapshot(snapshotFile.value);
  const snapshot = snapshotFile.value;
  const exactScores = new Map(
    createProjectView(
      snapshot,
      projectId,
      cycleId,
      undefined,
      findHistoricalProject(projectId) ?? undefined,
    ).leaders.map((leader) => [leader.actor.id, leader.scoreThirds]),
  );
  const rawProposal = proposalFile.value as { kind?: unknown };
  const files = new Map(
    [...loaded.entries()].map(([name, file]) => [name, file.bytes]),
  );

  if (rawProposal.kind === "external-contribution-share") {
    if (
      names.some(
        (name) =>
          !REQUIRED_FILES.includes(name as (typeof REQUIRED_FILES)[number]),
      )
    ) {
      throw new TypeError(
        "External contribution shares cannot contain payment files",
      );
    }
    const proposal = assertExternalContributionShareManifest(
      proposalFile.value,
    );
    if (proposal.projectId !== projectId || proposal.cycleId !== cycleId) {
      throw new TypeError("External share does not match its cycle path");
    }
    const expected = createRewardCycleProposal({
      archivedProject: findHistoricalProject(projectId) ?? undefined,
      cycleId,
      generatedAt: proposal.generatedAt,
      projectId,
      snapshot,
      sourceSnapshotSha256: snapshotFile.digest,
    });
    if (canonical(expected) !== canonical(proposal)) {
      throw new TypeError("External share differs from its frozen snapshot");
    }
    return {
      entry: {
        projectId,
        cycleId,
        kind: "external-prize-share",
        state:
          proposal.entries.length === 0
            ? "closed-no-awards"
            : "external-provisional",
        generatedAt: proposal.generatedAt,
        contributionWindow: proposal.contributionWindow,
        reviewEndsAt: null,
        approvedAt: null,
        settledAt: null,
        reward: {
          currency: null,
          capMinor: "0",
          suggestedMinor: "0",
          approvedMinor: "0",
          paidMinor: "0",
          feeMinor: "0",
          sharePartsPerMillion: proposal.entries.reduce(
            (total, entry) => total + entry.sharePartsPerMillion,
            0,
          ),
        },
        contributors: proposal.entries.map((entry) => ({
          actor: entry.actor,
          score: Math.floor((exactScores.get(entry.actor.id) ?? 0) / 3),
          scoreThirds: exactScores.get(entry.actor.id) ?? 0,
          state: "external-share",
          suggestedMinor: "0",
          approvedMinor: "0",
          paidMinor: "0",
          sharePartsPerMillion: entry.sharePartsPerMillion,
          wallet: null,
        })),
        files: {
          sourceSnapshot: reference(
            projectId,
            cycleId,
            "source-snapshot.json",
            snapshotFile,
          ),
          proposal: reference(
            projectId,
            cycleId,
            "proposal.json",
            proposalFile,
          ),
          allocation: null,
          executionPlan: null,
          settlement: null,
          windup: null,
        },
      },
      files,
      allocation: null,
    };
  }

  const proposal = assertRewardAllocationManifest(proposalFile.value);
  if (
    proposal.projectId !== projectId ||
    proposal.cycleId !== cycleId ||
    proposal.status !== "proposed"
  ) {
    throw new TypeError(
      "Reward proposal does not match its cycle path or state",
    );
  }
  await verifyProposalAgainstSnapshot(proposal, snapshot, snapshotFile.digest);

  const allocationFile = loaded.get("allocation.json") ?? null;
  let allocation: RewardAllocationManifest | null = null;
  if (allocationFile) {
    allocation = assertRewardAllocationManifest(allocationFile.value);
    if (!allocation.approvedAt) {
      throw new TypeError("Cycle allocation is not approved");
    }
    const expected = finalizeRewardAllocation(
      proposal,
      allocation.approvedAt,
      Date.parse(allocation.approvedAt),
    );
    if (canonical(expected) !== canonical(allocation)) {
      throw new TypeError(
        "Approved allocation differs from its reviewed proposal",
      );
    }
  }

  const state =
    proposal.allocations.length === 0
      ? "closed-no-awards"
      : allocation
        ? "payment-ready"
        : "review";
  const allocationByIntent = new Map(
    allocation?.allocations.map((entry) => [entry.intentId, entry]) ?? [],
  );
  return {
    entry: {
      projectId,
      cycleId,
      kind: "monthly-pool",
      state,
      generatedAt: proposal.generatedAt,
      contributionWindow: proposal.contributionWindow,
      reviewEndsAt: proposal.review.endsAt,
      approvedAt: allocation?.approvedAt ?? null,
      settledAt: null,
      reward: {
        currency: "USDC",
        carriedMinor: proposal.carriedMinor ?? "0",
        ...(proposal.fundingBasis
          ? { fundingBasis: proposal.fundingBasis }
          : {}),
        capMinor: proposal.capMinor,
        suggestedMinor: proposal.totals.suggestedMinor,
        approvedMinor: allocation?.totals.approvedMinor ?? "0",
        paidMinor: "0",
        feeMinor: allocation?.totals.feeMinor ?? "0",
        sharePartsPerMillion: null,
        ...(proposal.rewardLines
          ? {
              reviewBudgetCapMinor: (BigInt(
                proposal.rewardLines.reviewBudget.capMinor,
              ) < BigInt(proposal.rewardLines.reviewBudget.committedMinor)
                ? BigInt(proposal.rewardLines.reviewBudget.capMinor)
                : BigInt(proposal.rewardLines.reviewBudget.committedMinor)
              ).toString(),
              lines: {
                sharedPool: {
                  suggestedMinor:
                    proposal.rewardLines.sharedPool.suggestedMinor,
                  approvedMinor:
                    allocation?.rewardLines?.sharedPool.approvedMinor ?? "0",
                  paidMinor: "0",
                },
                reviewBudget: {
                  suggestedMinor:
                    proposal.rewardLines.reviewBudget.suggestedMinor,
                  approvedMinor:
                    allocation?.rewardLines?.reviewBudget.approvedMinor ?? "0",
                  paidMinor: "0",
                },
              },
            }
          : {}),
      },
      contributors: proposal.allocations.map((entry) => {
        const approved = allocationByIntent.get(entry.intentId);
        return {
          actor: entry.actor,
          score: Math.floor((exactScores.get(entry.actor.id) ?? 0) / 3),
          scoreThirds: exactScores.get(entry.actor.id) ?? 0,
          state: approved?.state ?? entry.state,
          suggestedMinor: entry.suggestedMinor,
          approvedMinor: approved?.approvedMinor ?? "0",
          paidMinor: "0",
          sharePartsPerMillion: null,
          wallet: approved?.wallet ?? entry.wallet,
          ...(entry.lines
            ? {
                lines: {
                  sharedPool: {
                    suggestedMinor: entry.lines.sharedPool.suggestedMinor,
                    approvedMinor:
                      approved?.lines?.sharedPool.approvedMinor ?? "0",
                    paidMinor: "0",
                  },
                  reviewBudget: {
                    suggestedMinor: entry.lines.reviewBudget.suggestedMinor,
                    approvedMinor:
                      approved?.lines?.reviewBudget.approvedMinor ?? "0",
                    paidMinor: "0",
                  },
                },
              }
            : {}),
        };
      }),
      files: {
        sourceSnapshot: reference(
          projectId,
          cycleId,
          "source-snapshot.json",
          snapshotFile,
        ),
        proposal: reference(projectId, cycleId, "proposal.json", proposalFile),
        allocation: allocationFile
          ? reference(projectId, cycleId, "allocation.json", allocationFile)
          : null,
        executionPlan: null,
        settlement: null,
        windup: null,
      },
    },
    files,
    allocation,
  };
}

async function collectCycles(): Promise<CycleBuild[]> {
  const rootStats = await lstat(CYCLES_ROOT).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (!rootStats) return [];
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new TypeError("cycles root must be a real directory");
  }
  const builds: CycleBuild[] = [];
  const projectEntries = await readdir(CYCLES_ROOT, { withFileTypes: true });
  for (const projectEntry of projectEntries) {
    if (projectEntry.name === "README.md") continue;
    if (
      !projectEntry.isDirectory() ||
      projectEntry.isSymbolicLink() ||
      !findHistoricalProject(projectEntry.name)
    ) {
      throw new TypeError(
        `cycles/${projectEntry.name} is not a registered project directory`,
      );
    }
    const projectDirectory = join(CYCLES_ROOT, projectEntry.name);
    const cycleEntries = await readdir(projectDirectory, {
      withFileTypes: true,
    });
    for (const cycleEntry of cycleEntries) {
      if (
        !cycleEntry.isDirectory() ||
        cycleEntry.isSymbolicLink() ||
        !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cycleEntry.name)
      ) {
        throw new TypeError(
          `cycles/${projectEntry.name}/${cycleEntry.name} is not a canonical cycle directory`,
        );
      }
      const versioned = join(projectDirectory, cycleEntry.name, "escrow-v2");
      const versionedStat = await lstat(versioned).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        },
      );
      if (versionedStat) {
        if (!versionedStat.isDirectory() || versionedStat.isSymbolicLink())
          throw new Error("Invalid escrow cycle directory");
        const files = await readdir(versioned);
        const required = [
          "github-identities.json",
          "project.json",
          "proposal.json",
          "source-snapshot.json",
        ];
        const allowed = new Set([
          ...required,
          "decisions.json",
          "platform-approvals.json",
        ]);
        if (
          required.some((name) => !files.includes(name)) ||
          files.some((name) => !allowed.has(name))
        )
          throw new Error("Unknown or missing escrow cycle artifact");
        const siblings = await readdir(join(projectDirectory, cycleEntry.name));
        if (siblings.length !== 1)
          throw new Error("Legacy and escrow cycles cannot share a cycle");
        const verified = await validateEscrowCycle(
          versioned,
          projectEntry.name,
          cycleEntry.name,
        );
        if (files.includes("decisions.json")) {
          const policy = JSON.parse(
            await readFile(join(versioned, "project.json"), "utf8"),
          );
          assertEscrowDecisions(
            JSON.parse(
              await readFile(join(versioned, "decisions.json"), "utf8"),
            ),
            verified.proposal,
            verified.digest,
            policy.steward.github.actorId,
          );
        }
        if (files.includes("platform-approvals.json")) {
          if (!files.includes("decisions.json"))
            throw new Error("Platform approval requires exact decisions");
          const approval = JSON.parse(
            await readFile(join(versioned, "platform-approvals.json"), "utf8"),
          );
          const decisionDigest = createHash("sha256")
            .update(await readFile(join(versioned, "decisions.json")))
            .digest("hex");
          if (
            approval.schemaVersion !== "1" ||
            approval.proposalSha256 !== verified.digest ||
            approval.decisionsSha256 !== decisionDigest ||
            !Array.isArray(approval.approvals)
          )
            throw new Error("Platform approval source mismatch");
        }
        continue;
      }
      builds.push(
        await buildCycle(
          projectEntry.name,
          cycleEntry.name,
          join(projectDirectory, cycleEntry.name),
        ),
      );
      if (builds.length > MAX_CYCLES)
        throw new RangeError("cycle limit exceeded");
    }
  }
  return builds.sort(
    (left, right) =>
      right.entry.cycleId.localeCompare(left.entry.cycleId) ||
      left.entry.projectId.localeCompare(right.entry.projectId),
  );
}

export async function syncCycleIndex(
  options: { checkOnly?: boolean; generatedAt?: string } = {},
): Promise<CycleIndex> {
  const builds = await collectCycles();
  const index: CycleIndex = {
    schemaVersion: CYCLE_INDEX_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    cycles: builds.map((build) => build.entry),
  };
  assertCycleIndex(index);
  // Only committed cycle history belongs in the application bundle. Exclude
  // refresh timestamps and snapshots so data-only refreshes do not change
  // JavaScript assets.
  const promotionPath = join(
    REPOSITORY_ROOT,
    "src/lib/project-promotion.generated.json",
  );
  const promotionBytes = `${JSON.stringify(
    index.cycles.map(({ projectId, cycleId, kind, reward }) => ({
      projectId,
      cycleId,
      kind,
      reward: { fundingBasis: reward.fundingBasis },
    })),
    null,
    2,
  )}\n`;
  if (options.checkOnly) {
    if ((await readFile(promotionPath, "utf8")) !== promotionBytes) {
      throw new Error(
        "Bundled project history is stale; run bun run cycles:sync",
      );
    }
  } else {
    await writeFile(promotionPath, promotionBytes);
  }
  if (!options.checkOnly) {
    const temporaryRoot = `${PUBLIC_CYCLES_ROOT}.${process.pid}.${Date.now()}.tmp`;
    await rm(temporaryRoot, { force: true, recursive: true });
    try {
      await mkdir(temporaryRoot, { recursive: true });
      for (const build of builds) {
        const destination = join(
          temporaryRoot,
          build.entry.projectId,
          build.entry.cycleId,
        );
        await mkdir(destination, { recursive: true });
        await Promise.all(
          [...build.files.entries()].map(([name, bytes]) =>
            writeFile(join(destination, name), bytes),
          ),
        );
      }
      await writeFile(
        join(temporaryRoot, "index.json"),
        `${JSON.stringify(index, null, 2)}\n`,
      );
      await rm(PUBLIC_CYCLES_ROOT, { force: true, recursive: true });
      await mkdir(dirname(PUBLIC_CYCLES_ROOT), { recursive: true });
      await rename(temporaryRoot, PUBLIC_CYCLES_ROOT);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }
  return index;
}

function parseArguments(values: string[]): { checkOnly: boolean } {
  let checkOnly = false;
  for (const value of values) {
    if (value === "--check") checkOnly = true;
    else throw new TypeError(`Unknown cycle-index argument: ${value}`);
  }
  return { checkOnly };
}

if (import.meta.main) {
  try {
    const index = await syncCycleIndex(parseArguments(process.argv.slice(2)));
    process.stdout.write(
      `[Slop] validated ${index.cycles.length} reward cycle${index.cycles.length === 1 ? "" : "s"}\n`,
    );
  } catch (error) {
    // error-policy:J1 command boundary exposes a non-zero, actionable failure.
    process.stderr.write(
      `[Slop] cycle validation refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
