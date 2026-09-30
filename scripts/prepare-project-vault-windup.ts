/**
 * Prepares the public windup record for a project vault cycle whose creator
 * returned the vault after binding the proposal (RFC #500 section 10). It
 * reads only canonical files and verified funding records, observes the vault
 * balance through the fixed public authorities, and prints `windup.json`.
 * Writing the file is left to the reviewing pull request, so this command
 * holds no credentials and changes nothing on its own. It never approves,
 * releases, retires, or carries anything.
 */

import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertProjectCommitmentLedger,
  type ProjectCommitmentRecord,
} from "../src/lib/funding-commitment";
import { assertFundingCommitments } from "../src/lib/funding-instruments.mjs";
import { deriveProjectVaultWindup } from "../src/lib/project-vault-windup";
import { findProject, type ProjectId } from "../src/lib/projects.mjs";
import { assertRewardAllocationManifest } from "../src/lib/rewards";
import { squadsInstrumentId } from "../src/lib/settlement-plan";
import { deriveVaultUsdcTokenAccount } from "../src/lib/squads-funding";
import { verifyProjectVaultSquads } from "./verify-commitment-squads";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_RECORD_BYTES = 64 * 1024;

export interface WindupArguments {
  cycleId: string;
  projectId: ProjectId;
  recordedAt: string;
}

function valueAfter(values: string[], index: number, flag: string): string {
  const value = values[index + 1];
  if (!value || value.startsWith("--"))
    throw new TypeError(`${flag} requires a value`);
  return value;
}

export function parseWindupArguments(
  values: string[],
  now = new Date().toISOString(),
): WindupArguments {
  let cycleId: string | null = null;
  let projectId: ProjectId | null = null;
  let recordedAt = now;
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (seen.has(flag))
      throw new TypeError(`Repeated windup argument: ${flag}`);
    seen.add(flag);
    if (flag === "--cycle") {
      cycleId = valueAfter(values, index, "--cycle");
      index += 1;
    } else if (flag === "--project") {
      const value = valueAfter(values, index, "--project");
      const project = findProject(value);
      if (project?.reward.kind !== "monthly-pool")
        throw new TypeError(`Project ${value} has no platform monthly pool`);
      projectId = project.id;
      index += 1;
    } else if (flag === "--recorded-at") {
      recordedAt = valueAfter(values, index, "--recorded-at");
      index += 1;
    } else {
      throw new TypeError(`Unknown windup argument: ${flag}`);
    }
  }
  if (!cycleId || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cycleId))
    throw new TypeError("--cycle must be YYYY-MM");
  if (!projectId) throw new TypeError("--project is required");
  if (
    !Number.isFinite(Date.parse(recordedAt)) ||
    new Date(recordedAt).toISOString() !== recordedAt ||
    Date.parse(recordedAt) > Date.parse(now) + 5 * 60_000
  )
    throw new TypeError("--recorded-at must be a current exact UTC timestamp");
  return { cycleId, projectId, recordedAt };
}

async function boundedFile(path: string, maxBytes: number): Promise<Buffer> {
  const stats = await lstat(path);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size <= 0 ||
    stats.size > maxBytes
  )
    throw new TypeError(`${path} is not a bounded regular file`);
  return readFile(path);
}

function json(bytes: Buffer, path: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new TypeError(`${path} is not valid JSON`, { cause: error });
  }
}

/** Every verified funding record of the project, structurally validated
 * against the reviewed instruments. Authentication of the records is the
 * trusted funding gate's job; this reader only refuses malformed evidence. */
async function fundingRecords(
  projectId: string,
  instruments: Parameters<typeof assertProjectCommitmentLedger>[1],
): Promise<readonly ProjectCommitmentRecord[]> {
  const root = join(REPOSITORY_ROOT, "funding", projectId, "commitments");
  const rootStats = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!rootStats) return [];
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink())
    throw new TypeError("Funding records root must be a real directory");
  const names = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter(
      (entry) => entry.isFile() && /^cmt_[a-z0-9_-]+\.json$/u.test(entry.name),
    )
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  const records: unknown[] = [];
  for (const path of names)
    records.push(json(await boundedFile(path, MAX_RECORD_BYTES), path));
  return assertProjectCommitmentLedger(records, instruments);
}

export async function prepareProjectVaultWindup(arguments_: WindupArguments) {
  const project = findProject(arguments_.projectId);
  if (!project) throw new TypeError("Unknown project");
  const directory = join(
    REPOSITORY_ROOT,
    "cycles",
    arguments_.projectId,
    arguments_.cycleId,
  );
  const allocationBytes = await boundedFile(
    join(directory, "allocation.json"),
    MAX_JSON_BYTES,
  );
  const allocation = assertRewardAllocationManifest(
    json(allocationBytes, "allocation.json"),
  );
  if (
    allocation.projectId !== arguments_.projectId ||
    allocation.cycleId !== arguments_.cycleId
  )
    throw new TypeError("Allocation does not match its cycle path");
  const instruments = assertFundingCommitments(
    project.funding.commitments ?? [],
  );
  const instrument = instruments.find(
    (candidate) =>
      candidate.kind === "squads-project-vault" &&
      squadsInstrumentId(candidate) === allocation.fundingBasis?.instrumentId,
  );
  if (!instrument || instrument.kind !== "squads-project-vault")
    throw new TypeError(
      "A windup is recorded only for a cycle funded by a reviewed project vault",
    );
  const planBytes = await boundedFile(
    join(directory, "execution-plan.json"),
    MAX_JSON_BYTES,
  );
  const ledgerPath = join(REPOSITORY_ROOT, "funding/executions/ledger.json");
  const ledger = json(
    await boundedFile(ledgerPath, MAX_JSON_BYTES),
    ledgerPath,
  );
  const records = await fundingRecords(arguments_.projectId, instruments);
  const observation = await verifyProjectVaultSquads({
    mode: "state",
    multisig: instrument.multisig,
    vault: instrument.vault,
    vaultIndex: instrument.vaultIndex,
    tokenAccount: await deriveVaultUsdcTokenAccount(instrument.vault),
    creatorMember: instrument.creatorMember,
    slopMember: instrument.slopMember,
    independentMember: instrument.independentMember,
  });
  if (observation.mode !== "state")
    throw new TypeError("Vault observation did not return a state");
  const observedAt = new Date().toISOString();
  return deriveProjectVaultWindup({
    allocation,
    allocationSha256: createHash("sha256")
      .update(allocationBytes)
      .digest("hex"),
    planBytes,
    ledger,
    fundingRecords: records,
    vaultBalanceMinor: observation.balanceMinor,
    observedAt,
    recordedAt:
      Date.parse(arguments_.recordedAt) < Date.parse(observedAt)
        ? observedAt
        : arguments_.recordedAt,
  });
}

if (import.meta.main) {
  try {
    const arguments_ = parseWindupArguments(process.argv.slice(2));
    const windup = await prepareProjectVaultWindup(arguments_);
    process.stdout.write(`${JSON.stringify(windup, null, 2)}\n`);
    process.stderr.write(
      `[Slop] prepared windup record holding ${windup.rows.length} approved rows for ${windup.projectId}/${windup.cycleId}; review and commit it as cycles/${windup.projectId}/${windup.cycleId}/windup.json\n`,
    );
  } catch (error) {
    process.stderr.write(
      `[Slop] windup preparation refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
