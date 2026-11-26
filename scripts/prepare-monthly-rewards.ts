/**
 * Proposes the private monthly allocation of the last closed UTC month for
 * every funded monthly project and writes it as idempotent D1 SQL. The
 * trusted monthly workflow applies the file to the project's private
 * database; nothing is committed, published or opened as a review PR.
 *
 * A month's proposal is written once: a later run with a different ledger
 * leaves the stored proposal and its rows unchanged. The owner then changes
 * amounts (a cut below the proposal needs a public reason), and the payments
 * coordinator freezes the current
 * allocations at the configured cutoff (backend/payments/monthly.ts). This
 * script reads no chain and authorizes, reserves or pays nothing.
 */

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublishableLeaderboardSnapshot } from "../src/lib/leaderboard";
import { maintainerShareBasisPoints } from "../src/lib/maintainer-share.mjs";
import type { ASI_NOVEMBER_CLOSEOUT } from "../src/lib/payments/asi-november-closeout";
import { buildEscrowCycle } from "../src/lib/payments/escrow-cycle";
import {
  type MonthlyBase,
  periodBounds,
  shiftPeriod,
  utcPeriodOf,
} from "../src/lib/payments/monthly-allocation";
import {
  findHistoricalProject,
  type ProjectDefinition,
} from "../src/lib/projects.mjs";
import { sha256Hex } from "../src/lib/sha256";
import { installGitHubAppTokenRefresh } from "./github-app-token-refresh";
import { readLeaderboardFile } from "./leaderboard-files.mjs";
import {
  collectMaintainerDecisions,
  type GraphqlRequest,
  githubGraphql,
  maintainerDecisionBytes,
} from "./maintainer-decisions";
import { currentProjectPolicies } from "./project-revision-policy.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SNAPSHOT_PATH = resolve(
  REPOSITORY_ROOT,
  "public/data/leaderboard.json",
);

/** The stored record of a month's maintainer share. */
export interface MonthlyMaintainerShare {
  basisPoints: number;
  poolBase: string;
  /** The exact decision record the split was computed from. */
  decisions: string;
  decisionsSha256: string;
  rows: {
    githubUserId: string;
    login: string;
    decisions: number;
    grossBase: string;
  }[];
}

export type MonthlyBaseWithShare = MonthlyBase & {
  maintainerShare?: MonthlyMaintainerShare;
  earlyCloseAt?: typeof ASI_NOVEMBER_CLOSEOUT.cutoff;
};

export interface MonthlyBasesResult {
  period: string;
  bases: (MonthlyBaseWithShare & { manifest: string })[];
  skipped: string[];
  /** Projects whose month could not be proposed, with the reason. */
  failed?: { projectId: string; reason: string }[];
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
  return periodBounds(period).to;
}

/** Returns the last fully closed UTC calendar month. */
export function previousUtcCycleId(now = new Date()): string {
  return shiftPeriod(utcPeriodOf(exactDate(now, "now")), -1);
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
  /** Required exactly when the revision sets a maintainer share for the month. */
  decisionBytes: Uint8Array | null = null,
): MonthlyBaseWithShare {
  const proposal = buildEscrowCycle(
    {
      projectId: input.projectId,
      cycleId: input.period,
      generatedAt: input.generatedAt,
    },
    snapshotBytes,
    null,
    policyBytes,
    decisionBytes,
  );
  return {
    ...(proposal.maintainerShare && decisionBytes
      ? {
          maintainerShare: {
            basisPoints: proposal.maintainerShare.basisPoints,
            poolBase: proposal.maintainerShare.poolMicro,
            decisions: new TextDecoder("utf-8", { fatal: true }).decode(
              decisionBytes,
            ),
            decisionsSha256: proposal.maintainerShare.decisionsSha256,
            rows: proposal.maintainerShare.rows.map((row) => ({
              githubUserId: row.githubUserId,
              login: row.login,
              decisions: row.decisions,
              grossBase: row.grossMicro,
            })),
          },
        }
      : {}),
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
  /**
   * Reads GitHub for a project with a maintainer share. Without it such a
   * project's month is not proposed and is reported as failed.
   */
  graphql?: GraphqlRequest;
}): Promise<MonthlyBasesResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(generatedAt) ||
    !Number.isFinite(Date.parse(generatedAt)) ||
    new Date(generatedAt).toISOString() !== generatedAt
  )
    throw new TypeError("generatedAt must be an exact UTC timestamp");
  const period = options.period ?? previousUtcCycleId(new Date(generatedAt));
  if (Date.parse(generatedAt) < periodEndTime(period))
    throw new RangeError(`Cycle ${period} has not closed`);
  const snapshotBytes = await readLeaderboardFile(
    options.snapshotPath
      ? resolve(options.snapshotPath)
      : DEFAULT_SNAPSHOT_PATH,
  );
  assertPublishableLeaderboardSnapshot(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshotBytes)),
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
    let decisionBytes: Uint8Array | null = null;
    if (maintainerShareBasisPoints(policy.project, period) > 0) {
      // The split needs who decided each outside pull request. A failed read
      // leaves this one project's month unproposed; a later run of the same
      // month proposes it. Other projects are not held back.
      try {
        if (!options.graphql)
          throw new Error("no GitHub reader was configured");
        decisionBytes = maintainerDecisionBytes(
          await collectMaintainerDecisions(
            policy.project,
            period,
            options.graphql,
          ),
        );
      } catch (error) {
        // error-policy:J2 one project's month is refused and reported; the run exits non-zero.
        // Present only when a month was refused, so an ordinary result
        // keeps its shape.
        result.failed ??= [];
        result.failed.push({
          projectId: policy.project.id,
          reason: error instanceof Error ? error.message : "unknown error",
        });
        continue;
      }
    }
    const base = buildMonthlyBase(
      { projectId: policy.project.id, period, generatedAt },
      snapshotBytes,
      policy.bytes,
      decisionBytes,
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
 * Text cut at code points into parts of at most 50 KB once quoted, so each
 * part's statement stays under D1's 100 KB statement limit.
 */
function recordParts(text: string): string[] {
  const parts: string[] = [];
  let part = "";
  let bytes = 0;
  for (const character of text) {
    const size = character === "'" ? 2 : Buffer.byteLength(character);
    if (bytes + size > 50_000) {
      parts.push(part);
      part = "";
      bytes = 0;
    }
    part += character;
    bytes += size;
  }
  parts.push(part);
  return parts;
}

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
    const key = `project_id=${quote(base.projectId)} AND period=${quote(base.period)}`;
    const header = `${key} AND source_snapshot_sha256=${quote(base.sourceSnapshotSha256)} AND manifest_sha256=${quote(base.manifestSha256)} AND cap_base=${quote(base.capBase)}`;
    const closeAt = base.earlyCloseAt ? quote(base.earlyCloseAt) : null;
    const closeoutColumn = closeAt === null ? "" : ",early_close_at";
    const closeoutValue = closeAt === null ? "" : `,${closeAt}`;
    const closeoutBinding =
      closeAt === null ? "" : ` AND early_close_at=${closeAt}`;
    const stored = `EXISTS(SELECT 1 FROM monthly_reward_bases WHERE ${header}${closeoutBinding})`;
    const columns = [
      base.projectId,
      base.period,
      base.manifest,
      base.manifestSha256,
      base.sourceSnapshotSha256,
      base.capBase,
    ].map(quote);
    statements.push(
      `INSERT INTO monthly_reward_bases(project_id,period,manifest,manifest_sha256,source_snapshot_sha256,cap_base,recipient_count,created_at${closeoutColumn}) VALUES(${columns.join(",")},${base.rows.length},${quote(createdAt)}${closeoutValue}) ON CONFLICT(project_id,period) DO NOTHING;`,
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
          )} WHERE ${stored} ON CONFLICT(project_id,period,github_user_id) DO NOTHING;`,
      );
    const share = base.maintainerShare;
    if (share) {
      // A busy month's decision record is larger than one statement D1
      // accepts, so its exact text is staged in parts. A missing part leaves
      // the record NULL and fails the import. The order belongs inside
      // group_concat: SQLite does not promise the order of its input
      // otherwise.
      const parts = recordParts(share.decisions);
      statements.push(
        `DELETE FROM monthly_maintainer_share_parts WHERE ${key};`,
      );
      for (const [sequence, part] of parts.entries())
        statements.push(
          `INSERT INTO monthly_maintainer_share_parts(project_id,period,sequence,part) VALUES(${quote(base.projectId)},${quote(base.period)},${sequence},${quote(part)});`,
        );
      statements.push(
        `INSERT INTO monthly_maintainer_shares(project_id,period,basis_points,pool_base,decisions,decisions_sha256,created_at) SELECT ${[base.projectId, base.period].map(quote).join(",")},${share.basisPoints},${quote(share.poolBase)},(SELECT CASE WHEN COUNT(*)=${parts.length} THEN group_concat(part,'' ORDER BY sequence) END FROM monthly_maintainer_share_parts WHERE ${key}),${[share.decisionsSha256, createdAt].map(quote).join(",")} WHERE ${stored} ON CONFLICT(project_id,period) DO NOTHING;`,
        `DELETE FROM monthly_maintainer_share_parts WHERE ${key};`,
      );
      for (const row of share.rows)
        statements.push(
          `INSERT INTO monthly_maintainer_share_rows(project_id,period,github_user_id,github_login,decisions,gross_base) SELECT ${[base.projectId, base.period, row.githubUserId, row.login].map(quote).join(",")},${row.decisions},${quote(row.grossBase)} WHERE EXISTS(SELECT 1 FROM monthly_maintainer_shares WHERE project_id=${quote(base.projectId)} AND period=${quote(base.period)} AND decisions_sha256=${quote(share.decisionsSha256)}) ON CONFLICT(project_id,period,github_user_id) DO NOTHING;`,
        );
    }
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
    const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
    // The collector App token is minted before a three-hour ledger step.
    installGitHubAppTokenRefresh(process.env);
    const result = await prepareMonthlyBases({
      ...options,
      generatedAt: createdAt,
      ...(token ? { graphql: githubGraphql(token) } : {}),
    });
    await writeFile(sqlPath, monthlyBasesSql(result, createdAt));
    process.stdout.write(
      `[Slop] proposed ${result.period} allocations: ${result.bases.map((base) => base.projectId).join(", ") || "none"}\n`,
    );
    // The other projects' proposals are written above and can be stored; the
    // non-zero exit makes the run report the months that still need a retry.
    const failed = result.failed ?? [];
    for (const failure of failed)
      process.stderr.write(
        `::error::[Slop] ${result.period} allocation of ${failure.projectId} was not proposed: its maintainer decisions could not be read (${failure.reason})\n`,
      );
    if (failed.length > 0) process.exitCode = 1;
  } catch (error) {
    // error-policy:J1 command boundary exposes a non-zero, actionable failure.
    process.stderr.write(
      `[Slop] monthly allocation proposal refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
