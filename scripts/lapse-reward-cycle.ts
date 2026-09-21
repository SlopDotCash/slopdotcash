/**
 * Applies the review deadline to one proposal the creator never acted on and
 * prints the lapsed manifest. Writing the result is left to the reviewing pull
 * request, so this command holds no credentials and changes nothing on its own.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findProject, type ProjectId } from "../src/lib/projects.mjs";
import { lapseRewardAllocation } from "../src/lib/review-lapse";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CYCLES_ROOT = resolve(REPOSITORY_ROOT, "cycles");
const MAX_PROPOSAL_BYTES = 8 * 1024 * 1024;

interface LapseArguments {
  cycleId: string;
  inputPath: string;
  lapsedAt: string;
  projectId: ProjectId;
}

function valueAfter(values: string[], index: number, flag: string): string {
  const value = values[index + 1];
  if (!value || value.startsWith("--")) {
    throw new TypeError(`${flag} requires a value`);
  }
  return value;
}

export function parseLapseArguments(
  values: string[],
  now = new Date().toISOString(),
): LapseArguments {
  let cycleId: string | null = null;
  let projectId: ProjectId | null = null;
  let lapsedAt = now;
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (seen.has(flag)) throw new TypeError(`Repeated lapse argument: ${flag}`);
    seen.add(flag);
    if (flag === "--cycle") {
      cycleId = valueAfter(values, index, "--cycle");
      index += 1;
    } else if (flag === "--project") {
      const value = valueAfter(values, index, "--project");
      const project = findProject(value);
      if (project?.reward.kind !== "monthly-pool") {
        throw new TypeError(`Project ${value} has no platform monthly pool`);
      }
      projectId = project.id;
      index += 1;
    } else if (flag === "--lapsed-at") {
      lapsedAt = valueAfter(values, index, "--lapsed-at");
      index += 1;
    } else {
      throw new TypeError(`Unknown lapse argument: ${flag}`);
    }
  }
  if (!cycleId || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cycleId)) {
    throw new TypeError("--cycle must be YYYY-MM");
  }
  if (!projectId) throw new TypeError("--project is required");
  return {
    cycleId,
    inputPath: resolve(CYCLES_ROOT, projectId, cycleId, "proposal.json"),
    lapsedAt,
    projectId,
  };
}

export async function lapseRewardCycle(
  arguments_: LapseArguments,
  options: { now?: number } = {},
) {
  const expectedInput = resolve(
    CYCLES_ROOT,
    arguments_.projectId,
    arguments_.cycleId,
    "proposal.json",
  );
  if (arguments_.inputPath !== expectedInput) {
    throw new TypeError("Reward lapse path is not canonical");
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
  const lapsed = lapseRewardAllocation(
    untrusted,
    arguments_.lapsedAt,
    options.now,
  );
  if (
    lapsed.projectId !== arguments_.projectId ||
    lapsed.cycleId !== arguments_.cycleId
  ) {
    throw new TypeError(
      "Reward proposal project does not match its cycle path",
    );
  }
  return lapsed;
}

if (import.meta.main) {
  try {
    const arguments_ = parseLapseArguments(process.argv.slice(2));
    const lapsed = await lapseRewardCycle(arguments_);
    process.stdout.write(`${JSON.stringify(lapsed, null, 2)}\n`);
    process.stderr.write(
      `[Slop] lapsed ${lapsed.allocations.filter((row) => row.hold?.kind === "review-lapsed").length} undecided rows for ${lapsed.cycleId}\n`,
    );
  } catch (error) {
    // error-policy:J1 command boundary exposes a non-zero, actionable failure.
    process.stderr.write(
      `[Slop] reward lapse refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
