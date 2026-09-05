/** Loads the immediately preceding reviewed cycle state for deterministic carry. */

import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  allocationFundingMinor,
  LAST_LEGACY_CAP_CYCLE,
} from "../src/lib/allocation-funding";
import type { ProjectId } from "../src/lib/projects.mjs";
import {
  assertRewardAllocationManifest,
  type RewardAllocationManifest,
} from "../src/lib/rewards";

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

export interface PriorCycleAccrual {
  actorLogins: ReadonlyMap<string, string>;
  accruedMinor: ReadonlyMap<string, string>;
}

export type PriorCycleNotReadyReason = "under-review" | "unresolved-proposals";

export class PriorCycleNotReadyError extends Error {
  readonly cycleId: string;
  readonly projectId: ProjectId;
  readonly reason: PriorCycleNotReadyReason;

  constructor(input: {
    cycleId: string;
    message: string;
    projectId: ProjectId;
    reason: PriorCycleNotReadyReason;
  }) {
    super(input.message);
    this.name = "PriorCycleNotReadyError";
    this.cycleId = input.cycleId;
    this.projectId = input.projectId;
    this.reason = input.reason;
  }
}

export function previousCycleId(cycleId: string): string {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cycleId)) {
    throw new TypeError("Cycle id must be YYYY-MM");
  }
  const [year, month] = cycleId.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function readManifest(
  path: string,
): Promise<RewardAllocationManifest | null> {
  const stats = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stats) return null;
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size <= 0 ||
    stats.size > MAX_MANIFEST_BYTES
  ) {
    throw new TypeError(`${path} is not a bounded regular cycle manifest`);
  }
  const bytes = await readFile(path);
  try {
    return assertRewardAllocationManifest(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    throw new TypeError(`${path} is not a valid reward allocation manifest`, {
      cause: error,
    });
  }
}

/**
 * Carries only reviewed, unpaid accrual states. Approved payout intents remain
 * attached to their original cycle, while exclusions and manual holds never
 * become new payment proposals automatically.
 */
export async function loadPriorCycleAccrual(input: {
  asOf: string;
  cycleId: string;
  cyclesRoot: string;
  projectId: ProjectId;
}): Promise<PriorCycleAccrual> {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.asOf) ||
    !Number.isFinite(Date.parse(input.asOf)) ||
    new Date(input.asOf).toISOString() !== input.asOf
  ) {
    throw new TypeError("Prior accrual asOf must be an exact UTC timestamp");
  }
  const priorId = previousCycleId(input.cycleId);
  const directory = join(input.cyclesRoot, input.projectId, priorId);
  const directoryStats = await lstat(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (!directoryStats) {
    return { actorLogins: new Map(), accruedMinor: new Map() };
  }
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new TypeError(`${directory} is not a real cycle directory`);
  }
  const reviewedProposal = await readManifest(join(directory, "proposal.json"));
  if (!reviewedProposal) {
    throw new TypeError(`Prior cycle ${input.projectId}/${priorId} is partial`);
  }
  const allocation = await readManifest(join(directory, "allocation.json"));
  if (allocation?.status === "proposed") {
    throw new TypeError(
      `Prior cycle ${input.projectId}/${priorId} allocation is not approved`,
    );
  }
  const proposal = allocation ?? reviewedProposal;
  if (proposal.projectId !== input.projectId || proposal.cycleId !== priorId) {
    throw new TypeError(
      `Prior accrual manifest does not match ${input.projectId}/${priorId}`,
    );
  }
  if (
    Date.parse(proposal.review.lastMaterialChangeAt) > Date.parse(input.asOf) ||
    (proposal.approvedAt !== null &&
      Date.parse(proposal.approvedAt) > Date.parse(input.asOf))
  ) {
    throw new RangeError(
      `Prior cycle ${input.projectId}/${priorId} contains future review state`,
    );
  }
  if (!allocation) {
    // An unfunded score record has no reviewed monetary balance to carry.
    // This also excludes the grandfathered cap-only trial suggestion.
    if (
      (proposal.fundingBasis &&
        allocationFundingMinor(proposal.fundingBasis) === 0n &&
        BigInt(proposal.carriedMinor ?? "0") === 0n) ||
      (!proposal.fundingBasis && proposal.cycleId <= LAST_LEGACY_CAP_CYCLE)
    ) {
      return { actorLogins: new Map(), accruedMinor: new Map() };
    }
    if (Date.parse(input.asOf) < Date.parse(proposal.review.endsAt)) {
      throw new PriorCycleNotReadyError({
        cycleId: priorId,
        message: `Prior cycle ${input.projectId}/${priorId} is still under review`,
        projectId: input.projectId,
        reason: "under-review",
      });
    }
    if (proposal.allocations.some((row) => row.state === "proposed")) {
      throw new PriorCycleNotReadyError({
        cycleId: priorId,
        message: `Prior cycle ${input.projectId}/${priorId} has unresolved proposals`,
        projectId: input.projectId,
        reason: "unresolved-proposals",
      });
    }
  }

  const accruedMinor = new Map<string, string>();
  const actorLogins = new Map<string, string>();
  for (const row of proposal.allocations) {
    if (row.state !== "held-below-minimum" && row.state !== "unclaimed") {
      continue;
    }
    const amount = row.accruedMinor ?? row.suggestedMinor;
    if (BigInt(amount) === 0n) continue;
    accruedMinor.set(row.actor.id, amount);
    actorLogins.set(row.actor.id, row.actor.login);
  }
  return { actorLogins, accruedMinor };
}
