/** Compiles one private October proposal import for the existing D1 file-import path. */
import { readFile, writeFile } from "node:fs/promises";
import { PARTICIPATION_BAN_QUERY } from "../backend/projects/account-bans";
import { prepareOctoberPreview } from "./october-reward-review";
import { pointProtectionQuery } from "./points-protection-sql";
import { monthlyBasesSql } from "./prepare-monthly-rewards";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const exists = (sql: string) => `EXISTS (${sql})`;

/** SQLite RAISE is available only in a trigger. A false assertion violates an
 * existing NOT NULL constraint, aborting the D1 file import. A true assertion
 * attempts zero inserts. Do not use OR IGNORE or run statements individually. */
function requireSql(condition: string): string {
  return `INSERT INTO monthly_reward_bases(project_id) SELECT NULL WHERE NOT COALESCE((${condition}),0);`;
}

export function prepareGuardedOctoberImport(
  input: Parameters<typeof prepareOctoberPreview>[0],
): { sql: string; reviews: ReturnType<typeof prepareOctoberPreview> } {
  // Recompute from pinned raw terms, packet and registry bytes. No CLI path
  // accepts emitted preview rows or a supplied import SQL template.
  const reviews = prepareOctoberPreview(input);
  const pointsBatch = quote(String(reviews.evidence.pointsBatch));
  const registryReady = `(SELECT COALESCE(MAX(rowid),0) FROM project_enforcements)=${reviews.enforcementGeneration}`;
  const currentPoints = `(SELECT digest FROM points_batches ORDER BY revision_count DESC,generated_at DESC,digest DESC LIMIT 1)=${pointsBatch}`;
  const sql: string[] = [];
  for (const { monthlyBase: base, manifest, revision } of reviews.projects) {
    const id = quote(base.projectId);
    const period = quote(base.period);
    const manifestText = quote(manifest);
    const manifestDigest = quote(base.manifestSha256);
    const key = `project_id=${id} AND period=${period}`;
    const header = `SELECT 1 FROM monthly_reward_bases WHERE ${key}`;
    const hasBase = exists(header);
    const exactHeader = exists(
      `${header} AND manifest=${manifestText} AND manifest_sha256=${manifestDigest} AND source_snapshot_sha256=${quote(base.sourceSnapshotSha256)} AND cap_base=${quote(base.capBase)} AND recipient_count=${base.rows.length}`,
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
      "An October import SQL statement exceeds D1's 100 KB limit",
    );
  return { sql: text, reviews };
}

if (import.meta.main) {
  try {
    const [
      mode,
      termsFile,
      packetFile,
      reviewedPacketSha256,
      registryFile,
      output,
    ] = process.argv.slice(2);
    if (
      process.argv.length !== 8 ||
      (mode !== "preview" && mode !== "guarded-sql") ||
      !termsFile ||
      !packetFile ||
      !reviewedPacketSha256 ||
      !registryFile ||
      !output
    )
      throw new Error(
        "Usage: prepare-october-rewards.ts preview|guarded-sql OWNER_TERMS REVIEWED_PACKET REVIEWER_SHA256 CURRENT_REGISTRY NEW_PRIVATE_FILE",
      );
    const [approvedTerms, reviewedPacket, currentRegistry] = await Promise.all([
      readFile(termsFile),
      readFile(packetFile),
      readFile(registryFile),
    ]);
    const { sql, reviews } = prepareGuardedOctoberImport({
      approvedTerms,
      reviewedPacket,
      reviewedPacketSha256,
      currentRegistry,
    });
    const report = {
      ...reviews,
      projects: reviews.projects.map(
        ({ manifest: _manifest, ...project }) => project,
      ),
    };
    await writeFile(
      output,
      mode === "guarded-sql" ? sql : `${JSON.stringify(report, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    process.stderr.write(
      `October proposal preparation refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
