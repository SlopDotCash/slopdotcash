/**
 * Produces the canonical unsigned transfer plan for an approved Eliza cycle.
 * The creator signs it with an external Solana wallet; this process never reads
 * signing material or treats plan creation as payment.
 */

import { createHash } from "node:crypto";
import { link, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findProject, type ProjectId } from "../src/lib/projects.mjs";
import { createSettlementExecutionPlan } from "../src/lib/settlement-plan";
import { validateCycleTransition } from "./sync-cycle-index";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CYCLES_ROOT = resolve(REPOSITORY_ROOT, "cycles");
const MAX_ALLOCATION_BYTES = 8 * 1024 * 1024;

interface PlanArguments {
  allocationPath: string;
  createdAt: string;
  cycleId: string;
  feeRecipient: string;
  outputPath: string;
  projectId: ProjectId;
  sourceOwner: string;
}

function next(values: string[], index: number, flag: string): string {
  const value = values[index + 1];
  if (!value || value.startsWith("--"))
    throw new TypeError(`${flag} requires a value`);
  return value;
}

export function parseSettlementPlanArguments(
  values: string[],
  now = new Date().toISOString(),
): PlanArguments {
  let cycleId: string | null = null;
  let sourceOwner: string | null = null;
  let feeRecipient: string | null = null;
  let projectId: ProjectId | null = null;
  let createdAt = now;
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
    } else if (flag === "--source-wallet") sourceOwner = value;
    else if (flag === "--fee-wallet") feeRecipient = value;
    else if (flag === "--created-at") createdAt = value;
    else throw new TypeError(`Unknown settlement-plan argument: ${flag}`);
    index += 1;
  }
  if (!cycleId || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cycleId)) {
    throw new TypeError("--cycle must be YYYY-MM");
  }
  if (!sourceOwner) throw new TypeError("--source-wallet is required");
  if (!feeRecipient) throw new TypeError("--fee-wallet is required");
  if (!projectId) throw new TypeError("--project is required");
  const directory = resolve(CYCLES_ROOT, projectId, cycleId);
  return {
    allocationPath: resolve(directory, "allocation.json"),
    createdAt,
    cycleId,
    feeRecipient,
    outputPath: resolve(directory, "execution-plan.json"),
    projectId,
    sourceOwner,
  };
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
        throw new Error(`Refusing to replace settlement plan ${path}`, {
          cause: error,
        });
      }
      throw error;
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function prepareSettlementPlan(
  arguments_: PlanArguments,
  options: {
    validate?: (
      projectId: string,
      cycleId: string,
    ) => Promise<{ state: string }>;
    write?: (path: string, value: unknown) => Promise<void>;
  } = {},
) {
  const cycle = await (options.validate ?? validateCycleTransition)(
    arguments_.projectId,
    arguments_.cycleId,
  );
  if (cycle.state !== "payment-ready") {
    throw new TypeError(
      "Only a verified approved allocation can produce a settlement plan",
    );
  }
  const source = await readFile(arguments_.allocationPath);
  if (source.byteLength > MAX_ALLOCATION_BYTES) {
    throw new RangeError("Allocation exceeds its size limit");
  }
  let allocation: unknown;
  try {
    allocation = JSON.parse(source.toString("utf8"));
  } catch (error) {
    throw new TypeError("Allocation is not valid JSON", { cause: error });
  }
  const plan = createSettlementExecutionPlan({
    allocation,
    allocationSha256: createHash("sha256").update(source).digest("hex"),
    createdAt: arguments_.createdAt,
    feeRecipient: arguments_.feeRecipient,
    sourceOwner: arguments_.sourceOwner,
  });
  if (plan.projectId !== arguments_.projectId) {
    throw new TypeError("Allocation project does not match its cycle path");
  }
  await (options.write ?? writeNewFile)(arguments_.outputPath, plan);
  return plan;
}

if (import.meta.main) {
  try {
    const arguments_ = parseSettlementPlanArguments(process.argv.slice(2));
    const plan = await prepareSettlementPlan(arguments_);
    process.stdout.write(
      `[GitArmy] wrote unsigned ${plan.token.symbol} plan with ${plan.transfers.length} transfer(s); sign externally and publish transaction evidence\n`,
    );
  } catch (error) {
    // error-policy:J1 command boundary exposes a non-zero, actionable failure.
    process.stderr.write(
      `[GitArmy] settlement plan refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
