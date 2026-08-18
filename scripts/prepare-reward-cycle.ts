/**
 * Creates a closed-cycle reward proposal from one published leaderboard
 * snapshot and immutable GitHub profile wallet observations. It writes only a
 * new review file and cannot approve an allocation or initiate a transaction.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublishableLeaderboardSnapshot } from "../src/lib/leaderboard";
import { createProjectView } from "../src/lib/project-view";
import { findProject, type ProjectId } from "../src/lib/projects.mjs";
import { createRewardCycleProposal } from "../src/lib/reward-cycle";
import type { WalletProof } from "../src/lib/rewards";
import { fetchPublishedGithubWallet } from "./github-wallets";
import type { PriorCycleAccrual } from "./prior-cycle-accrual";
import { loadPriorCycleAccrual } from "./prior-cycle-accrual";
import {
  ExistingFileError,
  writeNewFile,
  writeNewJsonFile,
} from "./write-new-file";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SNAPSHOT_PATH = resolve(
  REPOSITORY_ROOT,
  "public/data/leaderboard.json",
);
const CYCLES_ROOT = resolve(REPOSITORY_ROOT, "cycles");
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const MAX_WALLET_LOOKUPS = 200;
const WALLET_LOOKUP_CONCURRENCY = 4;

export interface PrepareRewardCycleArguments {
  cycleId: string;
  outputPath: string;
  projectId: ProjectId;
  snapshotArchivePath: string;
  snapshotPath: string;
}

function requiredValue(
  arguments_: string[],
  index: number,
  flag: string,
): string {
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) {
    throw new TypeError(`${flag} requires a value`);
  }
  return value;
}

export function parsePrepareRewardCycleArguments(
  arguments_: string[],
): PrepareRewardCycleArguments {
  let projectId: ProjectId | null = null;
  let cycleId: string | null = null;
  let snapshotPath = DEFAULT_SNAPSHOT_PATH;
  const seen = new Set<string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index];
    if (seen.has(flag))
      throw new TypeError(`Repeated reward-cycle argument: ${flag}`);
    seen.add(flag);
    if (flag === "--project") {
      const value = requiredValue(arguments_, index, flag);
      const project = findProject(value);
      if (!project) throw new TypeError(`Unknown project: ${value}`);
      projectId = project.id;
      index += 1;
    } else if (flag === "--cycle") {
      cycleId = requiredValue(arguments_, index, flag);
      index += 1;
    } else if (flag === "--snapshot") {
      snapshotPath = resolve(requiredValue(arguments_, index, flag));
      index += 1;
    } else {
      throw new TypeError(`Unknown reward-cycle argument: ${flag}`);
    }
  }
  if (!projectId) throw new TypeError("--project is required");
  if (!cycleId || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cycleId)) {
    throw new TypeError("--cycle must be YYYY-MM");
  }
  return {
    projectId,
    cycleId,
    snapshotPath,
    outputPath: resolve(CYCLES_ROOT, projectId, cycleId, "proposal.json"),
    snapshotArchivePath: resolve(
      CYCLES_ROOT,
      projectId,
      cycleId,
      "source-snapshot.json",
    ),
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  transform: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await transform(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      worker(),
    ),
  );
  return results;
}

async function writeNewFileAtomically(
  path: string,
  value: unknown,
): Promise<void> {
  await writeNewJsonFile(
    path,
    value,
    `Refusing to replace ${path}; update the existing proposal through review`,
  );
}

async function writeImmutableBytes(path: string, bytes: Buffer): Promise<void> {
  try {
    await writeNewFile(
      path,
      bytes,
      `Refusing to replace immutable source snapshot ${path}`,
    );
  } catch (error) {
    if (error instanceof ExistingFileError) {
      const existing = await readFile(path);
      if (existing.equals(bytes)) return;
    }
    throw error;
  }
}

export async function prepareRewardCycle(
  arguments_: PrepareRewardCycleArguments,
  options: {
    generatedAt?: string;
    githubToken?: string;
    loadPriorAccrual?: (input: {
      asOf: string;
      cycleId: string;
      cyclesRoot: string;
      projectId: ProjectId;
    }) => Promise<PriorCycleAccrual>;
    observeWallet?: (
      actorId: string,
      login: string,
      observedAt: string,
    ) => Promise<WalletProof | null>;
    write?: (path: string, value: unknown) => Promise<void>;
    writeSnapshot?: (path: string, bytes: Buffer) => Promise<void>;
  } = {},
) {
  const expectedOutputPath = resolve(
    CYCLES_ROOT,
    arguments_.projectId,
    arguments_.cycleId,
    "proposal.json",
  );
  const expectedSnapshotArchivePath = resolve(
    CYCLES_ROOT,
    arguments_.projectId,
    arguments_.cycleId,
    "source-snapshot.json",
  );
  if (arguments_.outputPath !== expectedOutputPath) {
    throw new TypeError(
      "Reward proposals may be written only to their canonical cycle path",
    );
  }
  if (arguments_.snapshotArchivePath !== expectedSnapshotArchivePath) {
    throw new TypeError(
      "Reward source snapshots may be written only to their canonical cycle path",
    );
  }
  const sourceBytes = await readFile(arguments_.snapshotPath);
  if (sourceBytes.byteLength > MAX_SNAPSHOT_BYTES) {
    throw new RangeError("Leaderboard snapshot exceeds its size limit");
  }
  let untrustedSnapshot: unknown;
  try {
    untrustedSnapshot = JSON.parse(sourceBytes.toString("utf8"));
  } catch (error) {
    throw new TypeError("Leaderboard snapshot is not valid JSON", {
      cause: error,
    });
  }
  assertPublishableLeaderboardSnapshot(untrustedSnapshot);
  const snapshot = untrustedSnapshot;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const project = findProject(arguments_.projectId);
  if (!project) throw new TypeError(`Unknown project: ${arguments_.projectId}`);

  const priorAccrual =
    project.reward.kind === "monthly-pool"
      ? await (options.loadPriorAccrual ?? loadPriorCycleAccrual)({
          asOf: generatedAt,
          cycleId: arguments_.cycleId,
          cyclesRoot: CYCLES_ROOT,
          projectId: arguments_.projectId,
        })
      : {
          actorLogins: new Map<string, string>(),
          accruedMinor: new Map<string, string>(),
        };

  const wallets = new Map<string, WalletProof>();
  if (project.reward.kind === "monthly-pool") {
    const projectLeaders = createProjectView(
      snapshot,
      arguments_.projectId,
      arguments_.cycleId,
    ).leaders;
    const actors = new Map(
      projectLeaders.map((leader) => [leader.actor.id, leader.actor.login]),
    );
    for (const [actorId, login] of priorAccrual.actorLogins) {
      if (!actors.has(actorId)) actors.set(actorId, login);
    }
    if (actors.size > MAX_WALLET_LOOKUPS) {
      throw new RangeError(
        "Reward cycle exceeds the bounded wallet lookup limit",
      );
    }
    const observe =
      options.observeWallet ??
      ((actorId: string, login: string, observedAt: string) =>
        fetchPublishedGithubWallet(actorId, login, observedAt, {
          token: options.githubToken,
        }));
    const observations = await mapWithConcurrency(
      [...actors],
      WALLET_LOOKUP_CONCURRENCY,
      async ([actorId, login]) => ({
        actorId,
        wallet: await observe(actorId, login, generatedAt),
      }),
    );
    for (const observation of observations) {
      if (observation.wallet)
        wallets.set(observation.actorId, observation.wallet);
    }
  }

  const proposal = createRewardCycleProposal({
    cycleId: arguments_.cycleId,
    generatedAt,
    projectId: arguments_.projectId,
    snapshot,
    sourceSnapshotSha256: createHash("sha256")
      .update(sourceBytes)
      .digest("hex"),
    wallets,
    priorAccruedMinor: priorAccrual.accruedMinor,
    priorActorLogins: priorAccrual.actorLogins,
  });
  await (options.writeSnapshot ?? writeImmutableBytes)(
    arguments_.snapshotArchivePath,
    sourceBytes,
  );
  await (options.write ?? writeNewFileAtomically)(
    arguments_.outputPath,
    proposal,
  );
  return proposal;
}

if (import.meta.main) {
  try {
    const arguments_ = parsePrepareRewardCycleArguments(process.argv.slice(2));
    const proposal = await prepareRewardCycle(arguments_, {
      githubToken: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
    });
    process.stdout.write(
      `[Slop] wrote ${arguments_.outputPath} (${proposal.kind}, ${proposal.cycleId})\n`,
    );
  } catch (error) {
    // error-policy:J1 command boundary exposes a non-zero, actionable failure.
    process.stderr.write(
      `[Slop] reward proposal refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
