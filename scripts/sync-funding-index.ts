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
import { PROJECTS } from "../src/lib/projects.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FUNDING_ROOT = join(ROOT, "funding");
const OUTPUT = join(ROOT, "public", "data", "funding.json");
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const MAX_DIRECTORY_ENTRIES = 100_000;
const MAX_RECORD_FILE_BYTES = 64 * 1024;

export function fundingAddressesAtRevision(
  projectId: string,
  revision: unknown,
  repositoryRoot = ROOT,
) {
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
  return assertProjectFundingAddresses(
    (funding as Record<string, unknown>).addresses,
  );
}

async function directories(
  path: string,
  ignoredFiles: readonly string[] = [],
): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.length > MAX_DIRECTORY_ENTRIES) {
    throw new RangeError(`${path} has too many entries`);
  }
  const ignored = new Set(ignoredFiles);
  const result: string[] = [];
  for (const entry of entries) {
    if (ignored.has(entry.name) && entry.isFile()) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new TypeError(`${join(path, entry.name)} is not a real directory`);
    }
    result.push(entry.name);
  }
  return result.sort();
}

export async function buildFundingIndex() {
  const records: unknown[] = [];
  for (const projectId of await directories(FUNDING_ROOT, ["README.md"])) {
    const project = PROJECTS.find((candidate) => candidate.id === projectId);
    if (!project || project.funding.recordsPath !== `funding/${projectId}`) {
      throw new TypeError(
        `funding/${projectId} is not a registered project path`,
      );
    }
    for (const network of await directories(join(FUNDING_ROOT, projectId))) {
      for (const transactionId of await directories(
        join(FUNDING_ROOT, projectId, network),
      )) {
        const root = join(FUNDING_ROOT, projectId, network, transactionId);
        const entries = await readdir(root, { withFileTypes: true });
        if (entries.length > MAX_DIRECTORY_ENTRIES) {
          throw new RangeError(`${root} has too many records`);
        }
        const files = entries
          .map((entry) => {
            if (
              !entry.isFile() ||
              entry.isSymbolicLink() ||
              !/^fund_[a-z0-9][a-z0-9_-]{6,79}\.json$/u.test(entry.name)
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
        for (const file of files) {
          const path = join(root, file);
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
            throw new TypeError(`${path} is invalid JSON`, {
              cause: error,
            });
          }
          if (
            record.projectId !== projectId ||
            record.network !== network ||
            record.transactionId !== transactionId ||
            `${record.recordId}.json` !== file
          ) {
            throw new TypeError(`${path} does not match its path`);
          }
          assertProjectFundingRecord(
            record,
            fundingAddressesAtRevision(projectId, record.manifestRevision),
          );
          records.push(record);
        }
      }
    }
  }
  records.sort((left, right) => {
    const a = left as { observedAt?: string; recordId?: string };
    const b = right as { observedAt?: string; recordId?: string };
    return `${a.observedAt ?? ""}:${a.recordId ?? ""}`.localeCompare(
      `${b.observedAt ?? ""}:${b.recordId ?? ""}`,
    );
  });
  const addresses = new Map(
    PROJECTS.map((project) => [project.id, project.funding.addresses] as const),
  );
  const generatedAt = records.reduce<string | null>((latest, candidate) => {
    const record = candidate as { observedAt?: string };
    return typeof record.observedAt === "string" &&
      (latest === null || record.observedAt > latest)
      ? record.observedAt
      : latest;
  }, null);
  return assertProjectFundingIndex(
    { schemaVersion: FUNDING_PROTOCOL_VERSION, generatedAt, records },
    addresses,
  );
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
