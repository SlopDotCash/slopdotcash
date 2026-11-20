import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { publicRestrictionOf } from "../backend/projects/enforcement";
import { ASI_NOVEMBER_CLOSEOUT as approved } from "../src/lib/payments/asi-november-closeout";
import { sha256Hex } from "../src/lib/sha256";
import { downloadLeaderboard } from "./download-leaderboard";
import { prepareAsiNovemberCloseout } from "./prepare-asi-november-closeout";
import {
  currentOwnerVerifier,
  octoberQueryRows,
  privateD1,
  readOnlyDatabase,
} from "./run-october-rewards";

const execute = promisify(execFile);
const encoder = new TextEncoder();
const sha256 = /^[a-f0-9]{64}$/u;
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
    while (remaining.length && selects.length < 200) {
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
  try {
    const env = process.env;
    const source = env.GITHUB_SHA;
    const reviewedPacketSha256 = env.REVIEWED_PACKET_SHA256;
    const reviewedPacket = env.ASI_CLOSEOUT_REVIEWED_PACKET;
    const expectedPreview =
      env.ASI_CLOSEOUT_APPLY === "true"
        ? (env.ASI_CLOSEOUT_PREVIEW_SHA256 ?? "")
        : null;
    if (
      env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      env.GITHUB_REPOSITORY !== "SlopDotCash/slopdotcash" ||
      env.GITHUB_REF !== "refs/heads/main" ||
      !source ||
      !/^[a-f0-9]{40}$/u.test(source) ||
      !reviewedPacketSha256 ||
      !sha256.test(reviewedPacketSha256) ||
      !reviewedPacket ||
      !env.RUNNER_TEMP ||
      !["true", "false"].includes(env.ASI_CLOSEOUT_APPLY ?? "") ||
      (expectedPreview !== null && !sha256.test(expectedPreview))
    )
      throw new Error("Untrusted ASI invocation.");
    await assertCurrentMain(source);
    stage = "published snapshot";
    const directory = await mkdtemp(join(env.RUNNER_TEMP, "asi-closeout-"));
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
      typeof row.manifest !== "string"
    )
      throw new Error("The ASI registry revision changed.");
    const now = new Date();
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
      snapshot: await readFile(ledger),
      now,
    });
    stage = "current reviewer authority";
    await currentOwnerVerifier()(
      project.manifest,
      plan.review.reviewerGithubId,
    );
    stage = "bound preview or import";
    const mode = await executeAsiCloseout(
      plan,
      query,
      expectedPreview,
      async () => {
        await assertCurrentMain(source);
        const sql = join(directory, "proposal.sql");
        await writeFile(sql, plan.sql, { flag: "wx", mode: 0o600 });
        await privateD1(["--file", sql]);
      },
    );
    console.log(
      JSON.stringify({
        schemaVersion: "1",
        period: approved.period,
        mode,
        reviewedPacketSha256,
        previewSha256: asiCloseoutPreviewDigest(plan),
        recipients: plan.review.monthlyBase.rows.length,
      }),
    );
  } catch {
    throw new Error(`ASI closeout refused during ${stage}.`);
  }
}

if (import.meta.main) {
  runAsiCloseout().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
