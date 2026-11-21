import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { publicRestrictionOf } from "../backend/projects/enforcement";
import { assertLeaderboardSnapshot } from "../src/lib/leaderboard";
import type { AsiHeldWorkUnitRecord } from "../src/lib/payments/asi-november-closeout";
import { ASI_NOVEMBER_CLOSEOUT as approved } from "../src/lib/payments/asi-november-closeout";
import { sha256Hex } from "../src/lib/sha256";
import { downloadLeaderboard } from "./download-leaderboard";
import {
  currentPointsBatchSql,
  type MonthlyImportCoverage,
  monthlyImportCoverageSql,
} from "./guarded-monthly-import";
import {
  asiCloseoutCoverage,
  buildAsiCloseoutCycle,
  prepareAsiNovemberCloseout,
} from "./prepare-asi-november-closeout";
import {
  currentOwnerVerifier,
  octoberQueryRows,
  privateD1,
  readOnlyDatabase,
} from "./run-october-rewards";

const execute = promisify(execFile);
const encoder = new TextEncoder();
const sha256 = /^[a-f0-9]{64}$/u;
const D1_MAX_COMPOUND_SELECT_TERMS = 5;
type Plan = ReturnType<typeof prepareAsiNovemberCloseout>;
type Query = (sql: string) => Promise<Record<string, unknown>[]>;

export async function checkAsiCloseout(
  plan: Plan,
  query: Query,
  mode: "preflight" | "readback",
): Promise<boolean> {
  const remaining = [...plan[mode]];
  while (remaining.length) {
    const selects: string[] = [];
    let size = 0;
    while (remaining.length && selects.length < D1_MAX_COMPOUND_SELECT_TERMS) {
      const select = `SELECT COALESCE((${remaining[0]}), 0) AS ok`;
      const bytes = Buffer.byteLength(select) + 12;
      if (selects.length && size + bytes > 95_000) break;
      selects.push(select);
      size += bytes;
      remaining.shift();
    }
    const result = await query(
      `SELECT MIN(ok) AS ok FROM (${selects.join(" UNION ALL ")})`,
    );
    if (result.length !== 1 || result[0].ok !== 1) return false;
  }
  return true;
}

export function asiCloseoutPreviewDigest(plan: Plan): string {
  const { capturedAt: _capturedAt, ...review } = plan.review;
  return sha256Hex(JSON.stringify(review));
}

export async function readAsiPointsBatch(
  query: Query,
  coverage: readonly MonthlyImportCoverage[],
): Promise<string> {
  const [{ digest } = {}] = await query(currentPointsBatchSql);
  if (typeof digest !== "string" || !sha256.test(digest) || !coverage.length)
    throw new Error("No canonical Points batch for the ASI closeout.");
  const covered = coverage
    .map((entry) => monthlyImportCoverageSql(digest, entry))
    .join(" AND ");
  const rows = await query(
    `SELECT digest FROM (${currentPointsBatchSql}) WHERE digest='${digest}' AND ${covered}`,
  );
  if (rows.length !== 1 || rows[0].digest !== digest)
    throw new Error("Points do not cover the published ASI cutoff snapshot.");
  return digest;
}

export async function readAsiHeldWorkUnitRecords(
  query: Query,
  snapshotBytes: Uint8Array,
): Promise<AsiHeldWorkUnitRecord[]> {
  const snapshot: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(snapshotBytes),
  );
  assertLeaderboardSnapshot(snapshot);
  const records: AsiHeldWorkUnitRecord[] = [];
  for (const { recordDigest } of snapshot.source.heldWorkUnits ?? []) {
    if (!sha256.test(recordDigest))
      throw new Error("Invalid held work digest.");
    const rows = await query(
      `SELECT j.record_digest AS recordDigest, j.project_id AS projectId,
        j.record_json AS recordJson,
        (SELECT json_group_array(json_array(repository_node_id, pull_request_node_id))
         FROM slopbot_work_unit_sources WHERE record_digest = j.record_digest) AS sourceKeys
       FROM slopbot_work_unit_journal j WHERE j.record_digest='${recordDigest}'`,
    );
    const [row] = rows;
    if (
      rows.length !== 1 ||
      row?.recordDigest !== recordDigest ||
      typeof row.projectId !== "string" ||
      typeof row.recordJson !== "string" ||
      typeof row.sourceKeys !== "string"
    )
      throw new Error("A held work unit has no exact canonical journal row.");
    records.push({
      recordDigest,
      projectId: row.projectId,
      recordJson: row.recordJson,
      sourceKeys: row.sourceKeys,
    });
  }
  return records;
}

export async function executeAsiCloseout(
  plan: Plan,
  query: Query,
  expectedPreview: string | null,
  apply: () => Promise<unknown>,
): Promise<"preview" | "already-imported" | "applied"> {
  const digest = asiCloseoutPreviewDigest(plan);
  if (expectedPreview !== null && expectedPreview !== digest)
    throw new Error("The current closeout differs from the approved preview.");
  if (!(await checkAsiCloseout(plan, query, "preflight")))
    throw new Error("The current closeout does not pass its import guards.");
  if (await checkAsiCloseout(plan, query, "readback"))
    return "already-imported";
  if (expectedPreview === null) return "preview";
  try {
    await apply();
  } catch {
    if (await checkAsiCloseout(plan, query, "readback")) return "applied";
    throw new Error("The import was not confirmed.");
  }
  if (!(await checkAsiCloseout(plan, query, "readback")))
    throw new Error("The import readback differs from the approved preview.");
  return "applied";
}

async function assertCurrentMain(source: string) {
  const [checkout, remote] = await Promise.all([
    execute("git", ["rev-parse", "HEAD"]),
    execute("git", ["ls-remote", "origin", "refs/heads/main"]),
  ]);
  if (
    checkout.stdout.trim() !== source ||
    remote.stdout.split(/\s/u)[0] !== source
  )
    throw new Error("Main changed during closeout.");
}

async function runAsiCloseout() {
  let stage = "trusted invocation";
  let directory: string | undefined;
  try {
    const env = process.env;
    const source = env.GITHUB_SHA;
    const reviewedPacketSha256 = env.REVIEWED_PACKET_SHA256;
    const reviewedPacket = env.ASI_CLOSEOUT_REVIEWED_PACKET;
    const mode = env.ASI_CLOSEOUT_MODE;
    const expectedPreview =
      mode === "apply" ? (env.ASI_CLOSEOUT_PREVIEW_SHA256 ?? "") : null;
    if (
      env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      env.GITHUB_REPOSITORY !== "SlopDotCash/slopdotcash" ||
      env.GITHUB_REF !== "refs/heads/main" ||
      !source ||
      !/^[a-f0-9]{40}$/u.test(source) ||
      !env.RUNNER_TEMP ||
      (mode !== "inspect" && mode !== "preview" && mode !== "apply") ||
      (expectedPreview !== null && !sha256.test(expectedPreview))
    )
      throw new Error("Untrusted ASI invocation.");
    await assertCurrentMain(source);
    stage = "published snapshot";
    directory = await mkdtemp(join(env.RUNNER_TEMP, "asi-closeout-"));
    const sql = join(directory, "proposal.sql");
    const ledger = join(directory, "leaderboard.json");
    await downloadLeaderboard(
      "https://slop.cash/data/leaderboard.json",
      ledger,
    );
    stage = "current private registry";
    const query: Query = async (sql) =>
      octoberQueryRows(await privateD1(["--json", "--command", sql]));
    const persistence = new CloudflareProjectPersistence(
      readOnlyDatabase(query),
    );
    const generation = await persistence.enforcementGeneration();
    const project = await persistence.getProject(approved.projectId);
    const enforcements = await persistence.listEnforcements();
    if (
      !project ||
      publicRestrictionOf(project, enforcements).state !== "clear" ||
      (await persistence.enforcementGeneration()) !== generation
    )
      throw new Error("ASI registry authority is unavailable.");
    const [row] = await query(
      "SELECT manifest,manifest_sha256,revision FROM projects WHERE id='asi'",
    );
    if (
      row?.revision !== project.revision ||
      row?.manifest_sha256 !== project.manifestSha256 ||
      typeof row.manifest !== "string" ||
      sha256Hex(encoder.encode(row.manifest)) !== project.manifestSha256
    )
      throw new Error("The ASI registry revision changed.");
    const now = new Date();
    const snapshot = await readFile(ledger);
    stage = "canonical held work source provenance";
    const heldWorkUnitRecords = await readAsiHeldWorkUnitRecords(
      query,
      snapshot,
    );
    if (mode === "inspect") {
      stage = "published cutoff and canonical Points coverage";
      buildAsiCloseoutCycle(
        snapshot,
        row.manifest,
        now.toISOString(),
        heldWorkUnitRecords,
      );
      const snapshotSha256 = sha256Hex(snapshot);
      const pointsBatch = await readAsiPointsBatch(
        query,
        asiCloseoutCoverage(project.manifest, snapshotSha256),
      );
      if ((await persistence.enforcementGeneration()) !== generation)
        throw new Error("The registry enforcement state changed.");
      console.log(
        JSON.stringify({
          schemaVersion: "1",
          period: approved.period,
          mode,
          snapshotSha256,
          pointsBatch,
          manifestSha256: project.manifestSha256,
          revision: project.revision,
          enforcementGeneration: generation,
        }),
      );
      return;
    }
    stage = "reviewed packet";
    if (
      !reviewedPacket ||
      !reviewedPacketSha256 ||
      !sha256.test(reviewedPacketSha256)
    )
      throw new Error("The exact reviewed packet is required.");
    const plan = prepareAsiNovemberCloseout({
      reviewedPacket: encoder.encode(reviewedPacket),
      reviewedPacketSha256,
      currentRegistry: encoder.encode(
        JSON.stringify({
          schemaVersion: "1",
          origin: "https://slop.cash",
          capturedAt: now.toISOString(),
          enforcementGeneration: generation,
          projects: [
            {
              id: approved.projectId,
              revision: row.revision,
              manifestSha256: row.manifest_sha256,
              manifestText: row.manifest,
              restriction: "clear",
            },
          ],
        }),
      ),
      snapshot,
      heldWorkUnitRecords,
      now,
    });
    stage = "current reviewer authority";
    await currentOwnerVerifier()(
      project.manifest,
      plan.review.reviewerGithubId,
    );
    stage = "bound preview or import";
    const result = await executeAsiCloseout(
      plan,
      query,
      expectedPreview,
      async () => {
        await assertCurrentMain(source);
        await writeFile(sql, plan.sql, { flag: "wx", mode: 0o600 });
        await privateD1(["--file", sql]);
      },
    );
    console.log(
      JSON.stringify({
        schemaVersion: "1",
        period: approved.period,
        mode: result,
        reviewedPacketSha256,
        previewSha256: asiCloseoutPreviewDigest(plan),
        recipients: plan.review.monthlyBase.rows.length,
      }),
    );
  } catch {
    throw new Error(`ASI closeout refused during ${stage}.`);
  } finally {
    if (directory) await rm(directory, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  runAsiCloseout().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
