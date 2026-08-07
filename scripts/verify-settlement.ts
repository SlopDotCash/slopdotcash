/**
 * Converts public transaction signatures into a paid settlement only after a
 * finalized Solana RPC response proves exact USDC debits and credits for every
 * approved contributor intent and the platform fee.
 */

import { createHash } from "node:crypto";
import { link, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findProject, type ProjectId } from "../src/lib/projects.mjs";
import {
  assertRewardAllocationManifest,
  assertRewardSettlementManifest,
} from "../src/lib/rewards";
import { assertSettlementExecutionPlan } from "../src/lib/settlement-plan";
import { verifyRewardSettlementOnchain } from "../src/lib/solana-settlement";
import {
  DEFAULT_SOLANA_RPC_URL,
  fetchFinalizedSolanaTransaction,
} from "./solana-rpc";
import { validateCycleTransition } from "./sync-cycle-index";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CYCLES_ROOT = resolve(REPOSITORY_ROOT, "cycles");
const MAX_FILE_BYTES = 8 * 1024 * 1024;

interface SettlementEvidence {
  schemaVersion: "1";
  kind: "solana-settlement-evidence";
  cycleId: string;
  attempts: Array<{
    attemptId: string;
    intentIds: string[];
    signature: string;
  }>;
  platformFeeSignature: string | null;
}

interface VerifyArguments {
  allocationPath: string;
  cycleId: string;
  evidencePath: string;
  outputPath: string;
  planPath: string;
  projectId: ProjectId;
  rpcUrl: string;
  settledAt: string;
}

function next(values: string[], index: number, flag: string): string {
  const value = values[index + 1];
  if (!value || value.startsWith("--"))
    throw new TypeError(`${flag} requires a value`);
  return value;
}

export function parseVerifySettlementArguments(
  values: string[],
  defaults: { now?: string; rpcUrl?: string } = {},
): VerifyArguments {
  let cycleId: string | null = null;
  let rpcUrl = defaults.rpcUrl?.trim() || DEFAULT_SOLANA_RPC_URL;
  let projectId: ProjectId | null = null;
  let settledAt = defaults.now ?? new Date().toISOString();
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    const value = next(values, index, flag);
    if (flag === "--cycle") cycleId = value;
    else if (flag === "--project") {
      const project = findProject(value);
      if (project?.reward.kind !== "monthly-pool") {
        throw new TypeError(`Project ${value} has no platform monthly pool`);
      }
      projectId = project.id;
    } else if (flag === "--rpc-url") rpcUrl = value;
    else if (flag === "--settled-at") settledAt = value;
    else
      throw new TypeError(`Unknown settlement verification argument: ${flag}`);
    index += 1;
  }
  if (!cycleId || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cycleId)) {
    throw new TypeError("--cycle must be YYYY-MM");
  }
  if (!projectId) throw new TypeError("--project is required");
  const rpc = new URL(rpcUrl);
  if (rpc.protocol !== "https:" || rpc.username || rpc.password || rpc.hash) {
    throw new TypeError(
      "Solana RPC URL must be HTTPS without embedded credentials or a fragment",
    );
  }
  const directory = resolve(CYCLES_ROOT, projectId, cycleId);
  return {
    allocationPath: resolve(directory, "allocation.json"),
    cycleId,
    evidencePath: resolve(directory, "transactions.json"),
    outputPath: resolve(directory, "settlement.json"),
    planPath: resolve(directory, "execution-plan.json"),
    projectId,
    rpcUrl: rpc.toString(),
    settledAt,
  };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
  field: string,
) {
  if (Object.keys(value).sort().join("\0") !== keys.sort().join("\0")) {
    throw new TypeError(`${field} has unexpected or missing fields`);
  }
}

function parseEvidence(value: unknown, cycleId: string): SettlementEvidence {
  const evidence = record(value, "settlement evidence");
  exactKeys(
    evidence,
    ["attempts", "cycleId", "kind", "platformFeeSignature", "schemaVersion"],
    "settlement evidence",
  );
  if (
    evidence.schemaVersion !== "1" ||
    evidence.kind !== "solana-settlement-evidence" ||
    evidence.cycleId !== cycleId ||
    !Array.isArray(evidence.attempts)
  ) {
    throw new TypeError("Settlement evidence protocol header is invalid");
  }
  const signatures = new Set<string>();
  const attempts = evidence.attempts.map((value, index) => {
    const attempt = record(value, `settlement evidence attempts[${index}]`);
    exactKeys(
      attempt,
      ["attemptId", "intentIds", "signature"],
      `settlement evidence attempts[${index}]`,
    );
    if (
      typeof attempt.attemptId !== "string" ||
      !/^attempt_[a-z0-9][a-z0-9_-]+$/u.test(attempt.attemptId) ||
      !Array.isArray(attempt.intentIds) ||
      attempt.intentIds.length === 0 ||
      !attempt.intentIds.every((id) => typeof id === "string") ||
      new Set(attempt.intentIds).size !== attempt.intentIds.length ||
      typeof attempt.signature !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,128}$/u.test(attempt.signature)
    ) {
      throw new TypeError(`Settlement evidence attempt ${index} is invalid`);
    }
    if (signatures.has(attempt.signature)) {
      throw new TypeError("Settlement evidence reuses a transaction signature");
    }
    signatures.add(attempt.signature);
    return {
      attemptId: attempt.attemptId,
      intentIds: attempt.intentIds as string[],
      signature: attempt.signature,
    };
  });
  const platformFeeSignature = evidence.platformFeeSignature;
  if (
    platformFeeSignature !== null &&
    (typeof platformFeeSignature !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,128}$/u.test(platformFeeSignature) ||
      signatures.has(platformFeeSignature))
  ) {
    throw new TypeError(
      "Settlement platform fee signature is invalid or reused",
    );
  }
  return {
    schemaVersion: "1",
    kind: "solana-settlement-evidence",
    cycleId,
    attempts,
    platformFeeSignature,
  };
}

async function readJson(
  path: string,
): Promise<{ bytes: Buffer; value: unknown }> {
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_FILE_BYTES)
    throw new RangeError(`${path} is oversized`);
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    throw new TypeError(`${path} is not valid JSON`, { cause: error });
  }
}

async function writeNewFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await Bun.write(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    try {
      await link(temporaryPath, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`Refusing to replace settlement ${path}`, {
          cause: error,
        });
      }
      throw error;
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function verifySettlement(
  arguments_: VerifyArguments,
  options: {
    getTransaction?: (signature: string) => Promise<unknown>;
    now?: number;
    validate?: (
      projectId: string,
      cycleId: string,
      options: { allowPendingTransactionEvidence: true },
    ) => Promise<{ state: string }>;
    write?: (path: string, value: unknown) => Promise<void>;
  } = {},
) {
  const cycle = await (options.validate ?? validateCycleTransition)(
    arguments_.projectId,
    arguments_.cycleId,
    { allowPendingTransactionEvidence: true },
  );
  if (cycle.state !== "settlement-planned") {
    throw new TypeError(
      "Only a verified execution plan can enter settlement verification",
    );
  }
  const [allocationFile, planFile, evidenceFile] = await Promise.all([
    readJson(arguments_.allocationPath),
    readJson(arguments_.planPath),
    readJson(arguments_.evidencePath),
  ]);
  const allocation = assertRewardAllocationManifest(allocationFile.value);
  if (allocation.projectId !== arguments_.projectId) {
    throw new TypeError("Allocation project does not match its cycle path");
  }
  const allocationSha256 = createHash("sha256")
    .update(allocationFile.bytes)
    .digest("hex");
  const plan = assertSettlementExecutionPlan(planFile.value, allocation);
  if (plan.allocationSha256 !== allocationSha256) {
    throw new TypeError("Settlement plan does not match allocation file bytes");
  }
  const evidence = parseEvidence(evidenceFile.value, arguments_.cycleId);
  if (!Number.isFinite(Date.parse(arguments_.settledAt))) {
    throw new TypeError("Settlement time is invalid");
  }
  const now = options.now ?? Date.now();
  if (Date.parse(arguments_.settledAt) > now + 5 * 60_000) {
    throw new RangeError("Settlement time cannot be in the future");
  }
  const feeTransfer = plan.transfers.find(
    (transfer) => transfer.kind === "platform-fee",
  );
  const settlement = assertRewardSettlementManifest(
    {
      schemaVersion: "1",
      kind: "reward-settlement",
      projectId: arguments_.projectId,
      cycleId: arguments_.cycleId,
      allocationSha256,
      settledAt: arguments_.settledAt,
      currency: "USDC",
      chain: "solana",
      status: "paid",
      recipients: allocation.allocations
        .filter((row) => row.state === "approved")
        .map((row) => ({
          intentId: row.intentId,
          approvedMinor: row.approvedMinor,
          paidMinor: row.approvedMinor,
          state: "paid",
        })),
      attempts: evidence.attempts.map((attempt) => ({
        ...attempt,
        state: "finalized",
      })),
      platformFee: feeTransfer
        ? {
            recipient: feeTransfer.recipientOwner,
            dueMinor: feeTransfer.amountMinor,
            paidMinor: feeTransfer.amountMinor,
            signature: evidence.platformFeeSignature,
            state: "paid",
          }
        : {
            recipient: null,
            dueMinor: "0",
            paidMinor: "0",
            signature: null,
            state: "not-applicable",
          },
      totals: {
        approvedMinor: allocation.totals.approvedMinor,
        paidMinor: allocation.totals.approvedMinor,
        feeMinor: allocation.totals.feeMinor,
      },
    },
    allocation,
  );
  const transactions = await verifyRewardSettlementOnchain({
    allocation,
    expectedAllocationSha256: allocationSha256,
    getTransaction:
      options.getTransaction ??
      ((signature) =>
        fetchFinalizedSolanaTransaction(arguments_.rpcUrl, signature)),
    plan,
    settlement,
  });
  await (options.write ?? writeNewFile)(arguments_.outputPath, settlement);
  return { settlement, transactions };
}

if (import.meta.main) {
  try {
    const arguments_ = parseVerifySettlementArguments(process.argv.slice(2), {
      rpcUrl: process.env.SOLANA_RPC_URL,
    });
    const result = await verifySettlement(arguments_);
    process.stdout.write(
      `[Open Work] verified ${result.transactions.length} finalized Solana transaction(s) and wrote ${arguments_.outputPath}\n`,
    );
  } catch (error) {
    // error-policy:J1 command boundary exposes a non-zero, actionable failure.
    process.stderr.write(
      `[Open Work] settlement verification refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
