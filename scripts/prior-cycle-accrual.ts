/** Loads prior-cycle money and independent, persistent project safety history. */

import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  allocationFundingMinor,
  LAST_LEGACY_CAP_CYCLE,
} from "../src/lib/allocation-funding";
import type { ProjectId } from "../src/lib/projects.mjs";
import {
  assertRewardAllocationManifest,
  type RewardAllocationManifest,
  type UnsafeDestinationReport,
} from "../src/lib/rewards";

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_BYTES = 32 * 1024 * 1024;
const MAX_HISTORY_CYCLES = 1200;
const MAX_HISTORY_REPORTS = 4096;
const MAX_ACTOR_REPORTS = 32;

export interface PriorCycleAccrual {
  actorLogins: ReadonlyMap<string, string>;
  accruedMinor: ReadonlyMap<string, string>;
  unsafeDestinationReports?: ReadonlyMap<string, UnsafeDestinationReport[]>;
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
  budget?: { bytes: number },
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
  if (budget && budget.bytes + stats.size > MAX_HISTORY_BYTES)
    throw new RangeError("Unsafe destination history exceeds its byte limit");
  const bytes = await readFile(path);
  if (bytes.length > MAX_MANIFEST_BYTES)
    throw new RangeError(`${path} exceeds its cycle manifest byte limit`);
  if (budget) {
    budget.bytes += bytes.length;
    if (budget.bytes > MAX_HISTORY_BYTES)
      throw new RangeError("Unsafe destination history exceeds its byte limit");
  }
  try {
    return assertRewardAllocationManifest(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    throw new TypeError(`${path} is not a valid reward allocation manifest`, {
      cause: error,
    });
  }
}

/**
 * Safety evidence outlives payment and participation. Read every earlier
 * immutable cycle, never infer the history from the immediately prior balance.
 * Repeated reports must retain exact normalized bytes and an original held row.
 * Limits fail closed; dropping an old report could revive its unsafe address.
 */
export async function loadUnsafeDestinationHistory(input: {
  asOf: string;
  cycleId: string;
  cyclesRoot: string;
  projectId: ProjectId;
}): Promise<Map<string, UnsafeDestinationReport[]>> {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.asOf) ||
    !Number.isFinite(Date.parse(input.asOf)) ||
    new Date(input.asOf).toISOString() !== input.asOf
  ) {
    throw new TypeError("Prior accrual asOf must be an exact UTC timestamp");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/u.test(input.projectId))
    throw new TypeError("Prior accrual project id is invalid");
  previousCycleId(input.cycleId);
  const directory = join(input.cyclesRoot, input.projectId);
  const stats = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const result = new Map<string, UnsafeDestinationReport[]>();
  if (!stats) return result;
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new TypeError(
      "Unsafe destination history requires a real project directory",
    );
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > MAX_HISTORY_CYCLES)
    throw new RangeError("Unsafe destination history exceeds its cycle limit");
  const reports = new Map<
    string,
    {
      actorId: string;
      report: UnsafeDestinationReport;
      bytes: string;
      original: boolean;
    }
  >();
  const budget = { bytes: 0 };
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(entry.name)
    )
      throw new TypeError(
        "Unsafe destination history contains a non-canonical cycle directory",
      );
    if (entry.name >= input.cycleId) continue;
    const proposal = await readManifest(
      join(directory, entry.name, "proposal.json"),
      budget,
    );
    if (!proposal)
      throw new TypeError(
        `Prior cycle ${input.projectId}/${entry.name} is partial`,
      );
    const allocation = await readManifest(
      join(directory, entry.name, "allocation.json"),
      budget,
    );
    if (
      proposal.status !== "proposed" ||
      (allocation && allocation.status !== "approved")
    )
      throw new TypeError(
        "Unsafe destination history has an invalid lifecycle file status",
      );
    for (const manifest of allocation ? [proposal, allocation] : [proposal]) {
      if (
        manifest.projectId !== input.projectId ||
        manifest.cycleId !== entry.name
      )
        throw new TypeError(
          "Unsafe destination history manifest does not match its project and cycle",
        );
      for (const row of manifest.allocations) {
        for (const report of row.unsafeDestinationReports ?? []) {
          if (Date.parse(report.verifiedAt) > Date.parse(input.asOf))
            throw new RangeError(
              "Unsafe destination history contains future verification state",
            );
          const bytes = JSON.stringify(report);
          const prior = reports.get(report.sourceCommit);
          if (
            prior &&
            (prior.actorId !== row.actor.id || prior.bytes !== bytes)
          )
            throw new TypeError(
              "Unsafe destination history changes an immutable report",
            );
          const original = report.cycleId === entry.name;
          reports.set(report.sourceCommit, {
            actorId: row.actor.id,
            report,
            bytes,
            original: original || prior?.original === true,
          });
          if (reports.size > MAX_HISTORY_REPORTS)
            throw new RangeError(
              "Unsafe destination history exceeds its report limit",
            );
        }
      }
    }
  }
  for (const { actorId, report, original } of reports.values()) {
    if (!original)
      throw new TypeError(
        "Unsafe destination history is missing its original reviewed hold",
      );
    const actorReports = result.get(actorId) ?? [];
    actorReports.push(report);
    if (actorReports.length > MAX_ACTOR_REPORTS)
      throw new RangeError(
        "Unsafe destination history exceeds its per-actor report limit",
      );
    result.set(actorId, actorReports);
  }
  return result;
}

/**
 * Carries only reviewed, unpaid accrual states. Approved payout intents remain
 * attached to their original cycle, while exclusions and ordinary manual holds never
 * become new payment proposals automatically.
 */
export async function loadPriorCycleAccrual(input: {
  asOf: string;
  cycleId: string;
  cyclesRoot: string;
  projectId: ProjectId;
}): Promise<PriorCycleAccrual> {
  const priorId = previousCycleId(input.cycleId);
  const unsafeDestinationReports = await loadUnsafeDestinationHistory(input);
  const directory = join(input.cyclesRoot, input.projectId, priorId);
  const directoryStats = await lstat(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (!directoryStats) {
    return {
      actorLogins: new Map(),
      accruedMinor: new Map(),
      unsafeDestinationReports,
    };
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
  // The historical trial never creates a monetary balance, including when
  // a later reviewed allocation retains its original unclaimed suggestions.
  if (!proposal.fundingBasis && proposal.cycleId <= LAST_LEGACY_CAP_CYCLE) {
    return {
      actorLogins: new Map(),
      accruedMinor: new Map(),
      unsafeDestinationReports,
    };
  }
  if (!allocation) {
    // An unfunded score record has no reviewed monetary balance to carry.
    if (
      proposal.fundingBasis &&
      allocationFundingMinor(proposal.fundingBasis) === 0n &&
      BigInt(proposal.carriedMinor ?? "0") === 0n
    ) {
      return {
        actorLogins: new Map(),
        accruedMinor: new Map(),
        unsafeDestinationReports,
      };
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
    if (
      row.state !== "held-below-minimum" &&
      row.state !== "unclaimed" &&
      !(row.state === "held" && row.hold?.kind === "unsafe-destination")
    ) {
      continue;
    }
    // Unused review funding stays with its original cycle, never pool carry.
    const amount =
      row.lines?.sharedPool.suggestedMinor ??
      row.accruedMinor ??
      row.suggestedMinor;
    if (BigInt(amount) === 0n) continue;
    accruedMinor.set(row.actor.id, amount);
    actorLogins.set(row.actor.id, row.actor.login);
  }
  return { actorLogins, accruedMinor, unsafeDestinationReports };
}
