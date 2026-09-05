/** Validates append-only direct-funding records and writes the public index. */

import { execFileSync } from "node:child_process";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertProjectFundingAddresses,
  assertProjectFundingIndex,
  assertProjectFundingRecord,
  FUNDING_PROTOCOL_VERSION,
} from "../src/lib/funding";
import {
  assertCommittedFundingBound,
  assertFundingCommitments,
  assertProjectCommitmentRecord,
} from "../src/lib/funding-commitment";
import { PROJECTS } from "../src/lib/projects.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(ROOT, "public", "data", "funding.json");
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const MAX_DIRECTORY_ENTRIES = 100_000;
const MAX_RECORD_FILE_BYTES = 64 * 1024;
const COMMITMENTS_DIRECTORY = "commitments";

interface FundingIndexProject {
  readonly id: string;
  readonly funding: {
    readonly recordsPath: string;
    readonly addresses: readonly unknown[];
    readonly commitments?: readonly unknown[];
  };
  readonly reward: {
    readonly committedMinor: string;
    readonly fundingState: string;
    readonly reviewBudget?: {
      readonly committedMinor: string;
      readonly fundingState: string;
    };
  };
}

function manifestFundingAtRevision(
  projectId: string,
  revision: unknown,
  repositoryRoot: string,
): Record<string, unknown> {
  if (typeof revision !== "string" || !SHA_PATTERN.test(revision)) {
    throw new TypeError("funding record manifest revision is invalid");
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", revision, "HEAD"], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
  } catch (error) {
    throw new TypeError(
      `funding record manifest revision ${revision} is not an ancestor of the current tree`,
      { cause: error },
    );
  }
  let source: string;
  try {
    source = execFileSync(
      "git",
      ["show", `${revision}:projects/${projectId}/project.json`],
      { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
  } catch (error) {
    throw new TypeError(
      `funding record cannot load project manifest ${projectId}@${revision}`,
      { cause: error },
    );
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    throw new TypeError(
      `funding record project manifest ${projectId}@${revision} is invalid JSON`,
      { cause: error },
    );
  }
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    (manifest as Record<string, unknown>).id !== projectId
  ) {
    throw new TypeError("funding record manifest project id changed");
  }
  const funding = (manifest as Record<string, unknown>).funding;
  if (typeof funding !== "object" || funding === null) {
    throw new TypeError("funding record historical manifest has no policy");
  }
  return funding as Record<string, unknown>;
}

export function fundingAddressesAtRevision(
  projectId: string,
  revision: unknown,
  repositoryRoot = ROOT,
) {
  return assertProjectFundingAddresses(
    manifestFundingAtRevision(projectId, revision, repositoryRoot).addresses,
  );
}

export function fundingCommitmentsAtRevision(
  projectId: string,
  revision: unknown,
  repositoryRoot = ROOT,
) {
  return assertFundingCommitments(
    manifestFundingAtRevision(projectId, revision, repositoryRoot)
      .commitments ?? [],
  );
}

async function directories(
  path: string,
  ignoredFiles: readonly string[] = [],
  ignoredDirectories: readonly string[] = [],
): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.length > MAX_DIRECTORY_ENTRIES) {
    throw new RangeError(`${path} has too many entries`);
  }
  const ignored = new Set(ignoredFiles);
  const skipped = new Set(ignoredDirectories);
  const result: string[] = [];
  for (const entry of entries) {
    if (ignored.has(entry.name) && entry.isFile()) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new TypeError(`${join(path, entry.name)} is not a real directory`);
    }
    if (skipped.has(entry.name)) continue;
    result.push(entry.name);
  }
  return result.sort();
}

async function recordFiles(root: string, pattern: RegExp): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.length > MAX_DIRECTORY_ENTRIES) {
    throw new RangeError(`${root} has too many records`);
  }
  const files = entries
    .map((entry) => {
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !pattern.test(entry.name)
      ) {
        throw new TypeError(
          `${join(root, entry.name)} is not a canonical record file`,
        );
      }
      return entry.name;
    })
    .sort();
  if (files.length === 0) {
    throw new TypeError(`${root} has no funding records`);
  }
  return files;
}

async function readRecordFile(
  path: string,
  expectations: Record<string, string>,
): Promise<Record<string, unknown>> {
  const stats = await lstat(path);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size <= 0 ||
    stats.size > MAX_RECORD_FILE_BYTES
  ) {
    throw new TypeError(`${path} has invalid record bytes`);
  }
  const source = await readFile(path, "utf8");
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(source) as Record<string, unknown>;
  } catch (error) {
    throw new TypeError(`${path} is invalid JSON`, { cause: error });
  }
  for (const [field, expected] of Object.entries(expectations)) {
    if (record[field] !== expected) {
      throw new TypeError(`${path} does not match its path`);
    }
  }
  return record;
}

function latestObservedAt(
  values: readonly unknown[],
  initial: string | null,
): string | null {
  return values.reduce<string | null>((latest, candidate) => {
    const record = candidate as { observedAt?: string };
    return typeof record.observedAt === "string" &&
      (latest === null || record.observedAt > latest)
      ? record.observedAt
      : latest;
  }, initial);
}

function sortByObservation(values: unknown[]): void {
  values.sort((left, right) => {
    const a = left as { observedAt?: string; recordId?: string };
    const b = right as { observedAt?: string; recordId?: string };
    return `${a.observedAt ?? ""}:${a.recordId ?? ""}`.localeCompare(
      `${b.observedAt ?? ""}:${b.recordId ?? ""}`,
    );
  });
}

export async function buildFundingIndex(
  options: {
    projects?: readonly FundingIndexProject[];
    repositoryRoot?: string;
  } = {},
) {
  const repositoryRoot = options.repositoryRoot ?? ROOT;
  const projects: readonly FundingIndexProject[] = options.projects ?? PROJECTS;
  const fundingRoot = join(repositoryRoot, "funding");
  const records: unknown[] = [];
  const commitments: unknown[] = [];
  for (const projectId of await directories(fundingRoot, ["README.md"])) {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project || project.funding.recordsPath !== `funding/${projectId}`) {
      throw new TypeError(
        `funding/${projectId} is not a registered project path`,
      );
    }
    for (const network of await directories(
      join(fundingRoot, projectId),
      [],
      [COMMITMENTS_DIRECTORY],
    )) {
      for (const transactionId of await directories(
        join(fundingRoot, projectId, network),
      )) {
        const root = join(fundingRoot, projectId, network, transactionId);
        for (const file of await recordFiles(
          root,
          /^fund_[a-z0-9][a-z0-9_-]{6,79}\.json$/u,
        )) {
          const path = join(root, file);
          const record = await readRecordFile(path, {
            projectId,
            network,
            transactionId,
          });
          if (`${record.recordId}.json` !== file) {
            throw new TypeError(`${path} does not match its path`);
          }
          assertProjectFundingRecord(
            record,
            fundingAddressesAtRevision(
              projectId,
              record.manifestRevision,
              repositoryRoot,
            ),
          );
          records.push(record);
        }
      }
    }
    let commitmentNetworks: string[] = [];
    try {
      commitmentNetworks = await directories(
        join(fundingRoot, projectId, COMMITMENTS_DIRECTORY),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const network of commitmentNetworks) {
      for (const transactionId of await directories(
        join(fundingRoot, projectId, COMMITMENTS_DIRECTORY, network),
      )) {
        const root = join(
          fundingRoot,
          projectId,
          COMMITMENTS_DIRECTORY,
          network,
          transactionId,
        );
        for (const file of await recordFiles(
          root,
          /^cmt_[a-z0-9][a-z0-9_-]{6,79}\.json$/u,
        )) {
          const path = join(root, file);
          const record = await readRecordFile(path, {
            projectId,
            network,
            transactionId,
          });
          if (`${record.recordId}.json` !== file) {
            throw new TypeError(`${path} does not match its path`);
          }
          assertProjectCommitmentRecord(
            record,
            fundingCommitmentsAtRevision(
              projectId,
              record.manifestRevision,
              repositoryRoot,
            ),
          );
          commitments.push(record);
        }
      }
    }
  }
  sortByObservation(records);
  sortByObservation(commitments);
  const addresses = new Map(
    projects.map(
      (project) =>
        [
          project.id,
          assertProjectFundingAddresses(project.funding.addresses),
        ] as const,
    ),
  );
  const instruments = new Map(
    projects.map(
      (project) =>
        [
          project.id,
          assertFundingCommitments(project.funding.commitments ?? []),
        ] as const,
    ),
  );
  const generatedAt = latestObservedAt(
    commitments,
    latestObservedAt(records, null),
  );
  const index = assertProjectFundingIndex(
    {
      schemaVersion: FUNDING_PROTOCOL_VERSION,
      generatedAt,
      records,
      commitments,
    },
    addresses,
    instruments,
  );
  for (const project of projects) {
    assertCommittedFundingBound(
      project.id,
      {
        fundingState:
          project.reward.fundingState === "committed" ||
          project.reward.reviewBudget?.fundingState === "committed"
            ? "committed"
            : project.reward.fundingState,
        committedMinor: (
          BigInt(project.reward.committedMinor) +
          BigInt(project.reward.reviewBudget?.committedMinor ?? "0")
        ).toString(),
      },
      project.funding.commitments ?? [],
      index.commitments.filter((record) => record.projectId === project.id),
    );
  }
  return index;
}

export async function syncFundingIndex(checkOnly = false): Promise<void> {
  const index = await buildFundingIndex();
  if (checkOnly) return;
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

if (import.meta.main) {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== "--check") || flags.length > 1) {
    throw new TypeError("Usage: sync-funding-index.ts [--check]");
  }
  await syncFundingIndex(flags[0] === "--check");
  process.stdout.write(
    flags[0] === "--check"
      ? "[Slop] funding records are valid\n"
      : "[Slop] synchronized funding index\n",
  );
}
