/**
 * Reads a project's verified funding commitment records from
 * `funding/<project>/commitments/**` and validates them structurally against
 * the project's reviewed instruments. Authentication of the records is the
 * trusted funding gate's job at acceptance time; this reader only refuses
 * malformed evidence. It holds no credentials and reads nothing remote.
 */

import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFundingCommitments,
  assertProjectCommitmentLedger,
  type ProjectCommitmentRecord,
} from "../src/lib/funding-commitment";
import { findProject } from "../src/lib/projects.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_RECORDS = 100_000;

async function boundedJson(path: string): Promise<unknown> {
  const stats = await lstat(path);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size <= 0 ||
    stats.size > MAX_RECORD_BYTES
  )
    throw new TypeError(`${path} is not a bounded regular file`);
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path)),
    );
  } catch (error) {
    throw new TypeError(`${path} is not valid JSON`, { cause: error });
  }
}

/** Every verified funding commitment record of one project, validated. */
export async function loadProjectCommitmentRecords(
  projectId: string,
  repositoryRoot = REPOSITORY_ROOT,
): Promise<readonly ProjectCommitmentRecord[]> {
  const project = findProject(projectId);
  if (!project) throw new TypeError(`Unknown project ${projectId}`);
  const instruments = assertFundingCommitments(
    project.funding.commitments ?? [],
  );
  const root = join(repositoryRoot, "funding", projectId, "commitments");
  const rootStats = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!rootStats) return [];
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink())
    throw new TypeError("Funding records root must be a real directory");
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  if (entries.length > MAX_RECORDS)
    throw new RangeError(`${root} has too many entries`);
  const paths = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        /^cmt_[a-z0-9][a-z0-9_-]{6,79}\.json$/u.test(entry.name),
    )
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  const records: unknown[] = [];
  for (const path of paths) records.push(await boundedJson(path));
  return assertProjectCommitmentLedger(records, instruments);
}
