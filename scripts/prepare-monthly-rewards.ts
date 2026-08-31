/**
 * Freezes the previous closed UTC month for every active project and creates
 * review proposals at canonical Git-backed paths. Existing complete cycles are
 * left untouched; partial cycles fail closed for maintainer repair.
 */

import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { PROJECTS, type ProjectDefinition } from "../src/lib/projects.mjs";
import {
  type PrepareRewardCycleArguments,
  parsePrepareRewardCycleArguments,
  prepareRewardCycle,
} from "./prepare-reward-cycle";
import {
  PriorCycleNotReadyError,
  type PriorCycleNotReadyReason,
} from "./prior-cycle-accrual";
import { syncCycleIndex } from "./sync-cycle-index";

type ExistingPath = "file" | "missing";

export interface MonthlyRewardResult {
  cycleId: string;
  prepared: string[];
  refused: Array<{
    message: string;
    priorCycleId: string;
    projectId: string;
    reason: PriorCycleNotReadyReason;
  }>;
  skippedExisting: string[];
  skippedPrelaunch: string[];
}

interface MonthlyDependencies {
  inspectPath: (path: string) => Promise<ExistingPath>;
  prepare: (
    arguments_: PrepareRewardCycleArguments,
    options: { generatedAt: string; githubToken?: string },
  ) => Promise<unknown>;
  projects: readonly ProjectDefinition[];
  validateCycles: () => Promise<unknown>;
}

function exactDate(value: Date, field: string): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError(`${field} must be a valid date`);
  }
  return value;
}

function cycleEnd(cycleId: string): number {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cycleId)) {
    throw new TypeError("cycle must be YYYY-MM");
  }
  const [yearText, monthText] = cycleId.split("-");
  return Date.UTC(Number(yearText), Number(monthText), 1);
}

/** Returns the last fully closed UTC calendar month. */
export function previousUtcCycleId(now = new Date()): string {
  const validNow = exactDate(now, "now");
  const previous = new Date(
    Date.UTC(validNow.getUTCFullYear(), validNow.getUTCMonth() - 1, 1),
  );
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function inspectRegularPath(path: string): Promise<ExistingPath> {
  const stats = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stats) return "missing";
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new TypeError(`${path} must be a regular file`);
  }
  return "file";
}

const DEFAULT_DEPENDENCIES: MonthlyDependencies = {
  inspectPath: inspectRegularPath,
  prepare: prepareRewardCycle,
  projects: PROJECTS,
  validateCycles: () => syncCycleIndex({ checkOnly: true }),
};

export async function prepareMonthlyRewards(
  options: {
    cycleId?: string;
    generatedAt?: string;
    githubToken?: string;
    snapshotPath?: string;
  } = {},
  dependencies: MonthlyDependencies = DEFAULT_DEPENDENCIES,
): Promise<MonthlyRewardResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const generatedTime = Date.parse(generatedAt);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(generatedAt) ||
    !Number.isFinite(generatedTime)
  ) {
    throw new TypeError("generatedAt must be an exact UTC timestamp");
  }
  const cycleId = options.cycleId ?? previousUtcCycleId(new Date(generatedAt));
  const end = cycleEnd(cycleId);
  if (generatedTime < end) {
    throw new RangeError(`Cycle ${cycleId} has not closed`);
  }

  const result: MonthlyRewardResult = {
    cycleId,
    prepared: [],
    refused: [],
    skippedExisting: [],
    skippedPrelaunch: [],
  };
  for (const project of dependencies.projects) {
    if (
      project.status !== "active" ||
      project.authority.state !== "verified" ||
      project.terms.receiptPolicy.state !== "active" ||
      Date.parse(project.reward.rewardStartAt) >= end
    ) {
      result.skippedPrelaunch.push(project.id);
      continue;
    }
    const arguments_ = parsePrepareRewardCycleArguments([
      "--project",
      project.id,
      "--cycle",
      cycleId,
      ...(options.snapshotPath
        ? ["--snapshot", resolve(options.snapshotPath)]
        : []),
    ]);
    const [proposalState, snapshotState] = await Promise.all([
      dependencies.inspectPath(arguments_.outputPath),
      dependencies.inspectPath(arguments_.snapshotArchivePath),
    ]);
    if (proposalState !== snapshotState) {
      throw new Error(
        `Cycle ${project.id}/${cycleId} is partial; proposal and source snapshot must exist together`,
      );
    }
    if (proposalState === "file") {
      result.skippedExisting.push(project.id);
      continue;
    }
    try {
      await dependencies.prepare(arguments_, {
        generatedAt,
        githubToken: options.githubToken,
      });
    } catch (error) {
      if (!(error instanceof PriorCycleNotReadyError)) throw error;
      if (error.projectId !== project.id) {
        throw new TypeError(
          `Prior-cycle refusal project ${error.projectId} does not match ${project.id}`,
          { cause: error },
        );
      }
      result.refused.push({
        message: error.message,
        priorCycleId: error.cycleId,
        projectId: error.projectId,
        reason: error.reason,
      });
      continue;
    }
    result.prepared.push(project.id);
  }
  await dependencies.validateCycles();
  return result;
}

function parseArguments(values: string[]): {
  cycleId?: string;
  snapshotPath?: string;
} {
  let cycleId: string | undefined;
  let snapshotPath: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (seen.has(flag)) {
      throw new TypeError(`Repeated monthly reward argument: ${flag}`);
    }
    seen.add(flag);
    const next = values[index + 1];
    if (flag === "--cycle" || flag === "--snapshot") {
      if (!next || next.startsWith("--")) {
        throw new TypeError(`${flag} requires a value`);
      }
      if (flag === "--cycle") cycleId = next;
      else snapshotPath = next;
      index += 1;
    } else {
      throw new TypeError(`Unknown monthly reward argument: ${flag}`);
    }
  }
  return { cycleId, snapshotPath };
}

if (import.meta.main) {
  try {
    const result = await prepareMonthlyRewards({
      ...parseArguments(process.argv.slice(2)),
      githubToken: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
    });
    process.stdout.write(
      `[Slop] closed ${result.cycleId}: prepared ${result.prepared.join(", ") || "none"}; already present ${result.skippedExisting.join(", ") || "none"}; refused ${result.refused.map((entry) => `${entry.projectId} (${entry.reason}: ${entry.message})`).join(", ") || "none"}\n`,
    );
  } catch (error) {
    // error-policy:J1 command boundary exposes a non-zero, actionable failure.
    process.stderr.write(
      `[Slop] monthly close refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
