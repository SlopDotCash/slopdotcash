import { PARTICIPATION_BAN_QUERY } from "../backend/projects/account-bans";
import { pointProtectionQuery } from "./points-protection-sql";
import {
  type MonthlyBaseWithShare,
  monthlyBasesSql,
} from "./prepare-monthly-rewards";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const exists = (sql: string) => `EXISTS (${sql})`;

/** SQLite RAISE is available only in a trigger. A false assertion violates an
 * existing NOT NULL constraint, aborting the D1 file import. A true assertion
 * attempts zero inserts. Do not use OR IGNORE or run statements individually. */
function requireSql(condition: string): string {
  return `INSERT INTO monthly_reward_bases(project_id) SELECT NULL WHERE NOT COALESCE((${condition}),0);`;
}

interface GuardedMonthlyImport {
  capturedAt: string;
  enforcementGeneration: number;
  pointsBatch: string;
  projects: readonly {
    monthlyBase: MonthlyBaseWithShare;
    manifest: string;
    revision: number;
    coverage?: readonly {
      repository: string;
      from: string;
      cutoff: string;
      snapshotSha256: string;
    }[];
  }[];
}

export function guardedMonthlyImportSql(reviews: GuardedMonthlyImport): string {
  const pointsBatch = quote(reviews.pointsBatch);
  const registryReady = `(SELECT COALESCE(MAX(rowid),0) FROM project_enforcements)=${reviews.enforcementGeneration}`;
  const currentPoints = `(SELECT digest FROM points_batches ORDER BY revision_count DESC,generated_at DESC,digest DESC LIMIT 1)=${pointsBatch}`;
  const sql: string[] = [];
  for (const {
    monthlyBase: base,
    manifest,
    revision,
    coverage,
  } of reviews.projects) {
    if (base.earlyCloseAt && !coverage?.length)
      throw new Error("An early closeout must bind verified Points coverage.");
    const id = quote(base.projectId);
    const period = quote(base.period);
    const manifestText = quote(manifest);
    const manifestDigest = quote(base.manifestSha256);
    const key = `project_id=${id} AND period=${period}`;
    const header = `SELECT 1 FROM monthly_reward_bases WHERE ${key}`;
    const hasBase = exists(header);
    const exactHeader = exists(
      `${header} AND manifest=${manifestText} AND manifest_sha256=${manifestDigest} AND source_snapshot_sha256=${quote(base.sourceSnapshotSha256)} AND cap_base=${quote(base.capBase)} AND recipient_count=${base.rows.length}${base.earlyCloseAt ? ` AND early_close_at=${quote(base.earlyCloseAt)}` : ""}`,
    );
    const exactCount = `(SELECT COUNT(*) FROM monthly_reward_base_rows WHERE ${key})=${base.rows.length}`;
    const project = exists(
      `SELECT 1 FROM projects WHERE id=${id} AND revision=${revision} AND manifest=${manifestText} AND manifest_sha256=${manifestDigest} AND status='active'`,
    );
    const protection = pointProtectionQuery([
      { projectId: base.projectId, period: base.period },
    ]).replace(/;$/u, "");
    const unprotected = `(SELECT protected FROM (${protection}))=0`;
    // Refuse stale financial or source evidence before creating a new base. A
    // fully matching replay remains a no-op after the live month changes.
    for (const condition of [
      project,
      currentPoints,
      registryReady,
      unprotected,
    ])
      sql.push(requireSql(`${hasBase} OR ${condition}`));
    for (const entry of coverage ?? []) {
      const covered = exists(
        `SELECT 1 FROM points_batches b,json_each(b.coverage) c WHERE b.digest=${pointsBatch} AND lower(json_extract(c.value,'$.repository'))=lower(${quote(entry.repository)}) AND json_extract(c.value,'$.from')<=${quote(entry.from)} AND json_extract(c.value,'$.to')>=${quote(entry.cutoff)} AND json_extract(c.value,'$.digest')=${quote(entry.snapshotSha256)}`,
      );
      sql.push(requireSql(`${hasBase} OR ${covered}`));
    }
    sql.push(requireSql(`NOT ${hasBase} OR ${exactHeader}`));
    sql.push(requireSql(`NOT ${hasBase} OR ${exactCount}`));
    // An unexpected orphan can never be reattached to new reviewed terms.
    sql.push(
      requireSql(
        `${hasBase} OR NOT ${exists(`SELECT 1 FROM monthly_reward_base_rows WHERE ${key}`)}`,
      ),
    );
    const exactRows = base.rows.map((row) =>
      exists(
        `SELECT 1 FROM monthly_reward_base_rows WHERE ${key} AND github_user_id=${quote(row.githubUserId)} AND github_login=${quote(row.login)} AND gross_base=${quote(row.grossBase)} AND source_digest=${quote(row.sourceDigest)}`,
      ),
    );
    for (const condition of exactRows)
      sql.push(requireSql(`NOT ${hasBase} OR ${condition}`));
    for (const { githubUserId } of base.rows) {
      const banned = exists(
        PARTICIPATION_BAN_QUERY.replace(/\s+/gu, " ")
          .trim()
          .replace("?", quote(githubUserId)),
      );
      sql.push(requireSql(`${hasBase} OR NOT ${banned}`));
    }
    sql.push(
      monthlyBasesSql(
        { period: base.period, bases: [{ ...base, manifest }], skipped: [] },
        reviews.capturedAt,
      ).trimEnd(),
    );
    // Independent exact readback is still inside the import. If the writer
    // silently skipped a row or a later guard fails, none of the bases commit.
    for (const condition of [exactHeader, exactCount, ...exactRows])
      sql.push(requireSql(condition));
  }
  const text = `${sql.join("\n")}\n`;
  // The canonical writer serializes a statement per line. Detect a statement
  // above the current D1 limit before creating an importable file.
  if (text.split("\n").some((line) => Buffer.byteLength(line) > 100_000))
    throw new Error(
      "A proposal import SQL statement exceeds D1's 100 KB limit",
    );
  return text;
}
