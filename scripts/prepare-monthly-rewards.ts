/**
 * Proposes the private monthly allocation of the last closed UTC month for
 * every funded monthly project and writes it as idempotent D1 SQL. The
 * trusted monthly workflow applies the file to the project's private
 * database; nothing is committed, published or opened as a review PR.
 *
 * A month's proposal is written once: a later run with a different ledger
 * leaves the stored proposal and its rows unchanged. The owner then changes
 * amounts privately, and the payments coordinator freezes the current
 * allocations at the configured cutoff (backend/payments/monthly.ts). This
 * script reads no chain and authorizes, reserves or pays nothing.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import { assertPublishableLeaderboardSnapshot } from "../src/lib/leaderboard";
import { buildEscrowCycle } from "../src/lib/payments/escrow-cycle";
import type { MonthlyBase } from "../src/lib/payments/monthly-allocation";
import { createPaymentProjectView } from "../src/lib/project-view";
import {
  findHistoricalProject,
  type ProjectDefinition,
} from "../src/lib/projects.mjs";
import { sha256Hex } from "../src/lib/sha256";
import { currentProjectPolicies } from "./project-revision-policy.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SNAPSHOT_PATH = resolve(
  REPOSITORY_ROOT,
  "public/data/leaderboard.json",
);

export interface MonthlyBasesResult {
  period: string;
  bases: (MonthlyBase & { manifest: string })[];
  skipped: string[];
}

function exactDate(value: Date, field: string): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError(`${field} must be a valid date`);
  }
  return value;
}

function periodEndTime(period: string): number {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(period)) {
    throw new TypeError("cycle must be YYYY-MM");
  }
  const [yearText, monthText] = period.split("-");
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

/**
 * Only an active, verified monthly-pool project with a registered vault and
 * an escrow policy effective for the month has an automatic monthly
 * allocation, and only when its monthly amount is positive. Unfunded projects
 * and private bounty programs never do. Vault creation turns on the monthly
 * commitment (PRD section 11). A stored proposal never changes, and the
 * coordinator freezes a month only into the vault that the proposal's
 * manifest names, so a vaultless proposal could never be paid; a later run
 * proposes the month once the vault exists.
 */
export function hasMonthlyAllocation(
  project: ProjectDefinition,
  period: string,
): boolean {
  return (
    project.status === "active" &&
    project.authority.state === "verified" &&
    project.terms.receiptPolicy.state === "active" &&
    project.reward.kind === "monthly-pool" &&
    Date.parse(project.reward.rewardStartAt) < periodEndTime(period) &&
    project.escrow !== undefined &&
    project.escrow.deployments.length > 0 &&
    period >= project.escrow.effectiveCycle
  );
}

/** The proposal of one month from the complete ledger and the exact D1 revision bytes. */
export function buildMonthlyBase(
  input: { projectId: string; period: string; generatedAt: string },
  snapshotBytes: Uint8Array,
  policyBytes: Uint8Array,
  project: ProjectDefinition,
): MonthlyBase {
  const snapshot = JSON.parse(new TextDecoder().decode(snapshotBytes));
  const view = createPaymentProjectView(
    snapshot,
    project.id,
    input.period,
    undefined,
    project,
  );
  // Numeric actor IDs come from the immutable node IDs; no lookup is needed.
  const identities = view.leaders.map((leader) => {
    const githubUserId = githubUserIdFromNodeId(leader.actor.id);
    if (!githubUserId)
      throw new Error(`No numeric GitHub identity for ${leader.actor.login}`);
    return { nodeId: leader.actor.id, githubUserId, login: leader.actor.login };
  });
  const proposal = buildEscrowCycle(
    {
      projectId: input.projectId,
      cycleId: input.period,
      generatedAt: input.generatedAt,
    },
    snapshotBytes,
    new TextEncoder().encode(JSON.stringify(identities)),
    policyBytes,
  );
  return {
    projectId: proposal.projectId,
    period: proposal.cycleId,
    manifestSha256: sha256Hex(policyBytes),
    sourceSnapshotSha256: proposal.sourceSnapshotSha256,
    capBase: proposal.grossCapMicro,
    rows: proposal.awards.map((award) => ({
      githubUserId: award.githubUserId,
      login: award.login,
      grossBase: award.grossMicro,
      sourceDigest: award.sourceDigest,
    })),
  };
}

export async function prepareMonthlyBases(options: {
  period?: string;
  generatedAt?: string;
  snapshotPath?: string;
  root?: string;
}): Promise<MonthlyBasesResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(generatedAt) ||
    !Number.isFinite(Date.parse(generatedAt))
  )
    throw new TypeError("generatedAt must be an exact UTC timestamp");
  const period = options.period ?? previousUtcCycleId(new Date(generatedAt));
  if (Date.parse(generatedAt) < periodEndTime(period))
    throw new RangeError(`Cycle ${period} has not closed`);
  const snapshotBytes = await readFile(
    options.snapshotPath
      ? resolve(options.snapshotPath)
      : DEFAULT_SNAPSHOT_PATH,
  );
  assertPublishableLeaderboardSnapshot(
    JSON.parse(snapshotBytes.toString("utf8")),
  );
  const result: MonthlyBasesResult = { period, bases: [], skipped: [] };
  for (const policy of await currentProjectPolicies(
    options.root ?? REPOSITORY_ROOT,
  )) {
    // While the paused, retired revision of a Quarantine or Ban is pending,
    // as after a contributor-flag pause of an active project, projects:sync
    // stores the project paused but its newest revision still says active.
    // The ledger collected nothing for it, and a restricted project starts no
    // new commitment (PRD section 11, Restricted projects).
    const registered = findHistoricalProject(policy.project.id);
    if (!registered)
      throw new TypeError(
        `Project ${policy.project.id} has revisions but no registry entry`,
      );
    if (
      registered.status !== "active" ||
      !hasMonthlyAllocation(policy.project, period)
    ) {
      result.skipped.push(policy.project.id);
      continue;
    }
    const base = buildMonthlyBase(
      { projectId: policy.project.id, period, generatedAt },
      snapshotBytes,
      policy.bytes,
      policy.project,
    );
    if (BigInt(base.capBase) === 0n) {
      result.skipped.push(policy.project.id);
      continue;
    }
    result.bases.push({ ...base, manifest: policy.bytes.toString("utf8") });
  }
  return result;
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * Idempotent SQL: the proposal row is inserted once per project month, and
 * each recipient row only next to the exact proposal digest already stored.
 * A file is applied as one D1 import, which rolls back on failure.
 */
export function monthlyBasesSql(
  result: MonthlyBasesResult,
  createdAt: string,
): string {
  const statements: string[] = [];
  for (const base of result.bases) {
    statements.push(
      `INSERT INTO monthly_reward_bases(project_id,period,manifest,manifest_sha256,source_snapshot_sha256,cap_base,recipient_count,created_at) VALUES(${[
        base.projectId,
        base.period,
        base.manifest,
        base.manifestSha256,
        base.sourceSnapshotSha256,
        base.capBase,
      ]
        .map(quote)
        .join(
          ",",
        )},${base.rows.length},${quote(createdAt)}) ON CONFLICT(project_id,period) DO NOTHING;`,
    );
    for (const row of base.rows)
      statements.push(
        `INSERT INTO monthly_reward_base_rows(project_id,period,github_user_id,github_login,gross_base,source_digest) SELECT ${[
          base.projectId,
          base.period,
          row.githubUserId,
          row.login,
          row.grossBase,
          row.sourceDigest,
        ]
          .map(quote)
          .join(
            ",",
          )} WHERE EXISTS(SELECT 1 FROM monthly_reward_bases WHERE project_id=${quote(base.projectId)} AND period=${quote(base.period)} AND source_snapshot_sha256=${quote(base.sourceSnapshotSha256)} AND manifest_sha256=${quote(base.manifestSha256)}) ON CONFLICT(project_id,period,github_user_id) DO NOTHING;`,
      );
  }
  return statements.length ? `${statements.join("\n")}\n` : "";
}

function parseArguments(values: string[]): {
  period?: string;
  snapshotPath?: string;
  sqlPath: string;
} {
  const parsed: { period?: string; snapshotPath?: string; sqlPath?: string } =
    {};
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const next = values[index + 1];
    if (seen.has(flag))
      throw new TypeError(`Repeated monthly reward argument: ${flag}`);
    seen.add(flag);
    if (!next || next.startsWith("--"))
      throw new TypeError(`${flag} requires a value`);
    if (flag === "--cycle") parsed.period = next;
    else if (flag === "--snapshot") parsed.snapshotPath = next;
    else if (flag === "--sql") parsed.sqlPath = next;
    else throw new TypeError(`Unknown monthly reward argument: ${flag}`);
  }
  if (!parsed.sqlPath) throw new TypeError("--sql is required");
  return { ...parsed, sqlPath: parsed.sqlPath };
}

if (import.meta.main) {
  try {
    const { sqlPath, ...options } = parseArguments(process.argv.slice(2));
    const createdAt = new Date().toISOString();
    const result = await prepareMonthlyBases({
      ...options,
      generatedAt: createdAt,
    });
    await writeFile(sqlPath, monthlyBasesSql(result, createdAt));
    process.stdout.write(
      `[Slop] proposed ${result.period} allocations: ${result.bases.map((base) => base.projectId).join(", ") || "none"}\n`,
    );
  } catch (error) {
    // error-policy:J1 command boundary exposes a non-zero, actionable failure.
    process.stderr.write(
      `[Slop] monthly allocation proposal refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
