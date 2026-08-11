/**
 * Finalizes one reviewed Eliza proposal into an approved payout-intent file.
 * Canonical paths and no-replace writes prevent this transition from mutating
 * earlier review evidence or a previously approved allocation.
 */

import { link, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findProject, type ProjectId } from "../src/lib/projects.mjs";
import { finalizeRewardAllocation } from "../src/lib/reward-finalization";
import { validateCycleTransition } from "./sync-cycle-index";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CYCLES_ROOT = resolve(REPOSITORY_ROOT, "cycles");
const MAX_PROPOSAL_BYTES = 8 * 1024 * 1024;

interface FinalizeArguments {
  approvedAt: string;
  cycleId: string;
  inputPath: string;
  outputPath: string;
  projectId: ProjectId;
}

function valueAfter(values: string[], index: number, flag: string): string {
  const value = values[index + 1];
  if (!value || value.startsWith("--")) {
    throw new TypeError(`${flag} requires a value`);
  }
  return value;
}

export function parseFinalizeArguments(
  values: string[],
  now = new Date().toISOString(),
): FinalizeArguments {
  let cycleId: string | null = null;
  let projectId: ProjectId | null = null;
  let approvedAt = now;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--cycle") {
      cycleId = valueAfter(values, index, "--cycle");
      index += 1;
    } else if (values[index] === "--project") {
      const value = valueAfter(values, index, "--project");
      const project = findProject(value);
      if (project?.reward.kind !== "monthly-pool") {
        throw new TypeError(`Project ${value} has no platform monthly pool`);
      }
      projectId = project.id;
      index += 1;
    } else if (values[index] === "--approved-at") {
      approvedAt = valueAfter(values, index, "--approved-at");
      index += 1;
    } else {
      throw new TypeError(`Unknown finalize argument: ${values[index]}`);
    }
  }
  if (!cycleId || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cycleId)) {
    throw new TypeError("--cycle must be YYYY-MM");
  }
  if (!projectId) throw new TypeError("--project is required");
  return {
    cycleId,
    approvedAt,
    inputPath: resolve(CYCLES_ROOT, projectId, cycleId, "proposal.json"),
    outputPath: resolve(CYCLES_ROOT, projectId, cycleId, "allocation.json"),
    projectId,
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
        throw new Error(`Refusing to replace approved allocation ${path}`, {
          cause: error,
        });
      }
      throw error;
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function finalizeRewardCycle(
  arguments_: FinalizeArguments,
  options: {
    now?: number;
    validate?: (
      projectId: string,
      cycleId: string,
    ) => Promise<{ state: string }>;
    write?: (path: string, value: unknown) => Promise<void>;
  } = {},
) {
  const expectedInput = resolve(
    CYCLES_ROOT,
    arguments_.projectId,
    arguments_.cycleId,
    "proposal.json",
  );
  const expectedOutput = resolve(
    CYCLES_ROOT,
    arguments_.projectId,
    arguments_.cycleId,
    "allocation.json",
  );
  if (
    arguments_.inputPath !== expectedInput ||
    arguments_.outputPath !== expectedOutput
  ) {
    throw new TypeError("Reward finalization paths are not canonical");
  }
  const cycle = await (options.validate ?? validateCycleTransition)(
    arguments_.projectId,
    arguments_.cycleId,
  );
  if (cycle.state !== "review") {
    throw new TypeError("Only a fully verified review cycle can be approved");
  }
  const source = await readFile(arguments_.inputPath);
  if (source.byteLength > MAX_PROPOSAL_BYTES) {
    throw new RangeError("Reward proposal exceeds its size limit");
  }
  let untrusted: unknown;
  try {
    untrusted = JSON.parse(source.toString("utf8"));
  } catch (error) {
    throw new TypeError("Reward proposal is not valid JSON", { cause: error });
  }
  const allocation = finalizeRewardAllocation(
    untrusted,
    arguments_.approvedAt,
    options.now,
  );
  if (allocation.projectId !== arguments_.projectId) {
    throw new TypeError(
      "Reward proposal project does not match its cycle path",
    );
  }
  await (options.write ?? writeNewFile)(arguments_.outputPath, allocation);
  return allocation;
}

if (import.meta.main) {
  try {
    const arguments_ = parseFinalizeArguments(process.argv.slice(2));
    const allocation = await finalizeRewardCycle(arguments_);
    process.stdout.write(
      `[Slop] approved ${allocation.allocations.filter((row) => row.state === "approved").length} payout intents for ${allocation.cycleId}\n`,
    );
  } catch (error) {
    // error-policy:J1 command boundary exposes a non-zero, actionable failure.
    process.stderr.write(
      `[Slop] allocation approval refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
