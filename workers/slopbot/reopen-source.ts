import { validGitSha, validIsoTimestamp } from "../../backend/trace/validation";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import type { Job } from "./contracts";
import type { D1Database } from "./persistence";

type ReopenJob = Extract<Job, { kind: "human_reopen" | "appeal" }>;
export type ReopenItem = {
  node_id?: string;
  updated_at?: string;
  title?: string;
  body?: string | null;
  head?: { sha: string };
};
export type ReopenSource = {
  installationId: number;
  repositoryId: number;
  itemKind: "issue" | "pull_request";
  number: number;
  senderId: number;
  itemNodeId: string;
  revision: string;
  occurredAt: string;
};

/** Called only after webhook signature verification. No source text is stored. */
export async function recordReopenSource(
  db: D1Database,
  job: ReopenJob,
  item: ReopenItem | undefined,
): Promise<boolean> {
  if (
    !item ||
    typeof item.node_id !== "string" ||
    !item.node_id ||
    item.node_id.length > 200 ||
    !validIsoTimestamp(item.updated_at) ||
    (job.itemKind === "pull_request"
      ? !validGitSha(item.head?.sha)
      : typeof item.title !== "string" ||
        (item.body !== null && typeof item.body !== "string"))
  )
    return false;
  const source: ReopenSource = {
    installationId: job.installationId,
    repositoryId: job.repositoryId,
    itemKind: job.itemKind,
    number: job.number,
    senderId: job.senderId,
    itemNodeId: item.node_id,
    revision:
      job.itemKind === "pull_request"
        ? (item.head?.sha as string)
        : await sha256Hex(`${item.title}\n${item.body ?? ""}`),
    occurredAt: item.updated_at,
  };
  const serialized = JSON.stringify(source);
  await db
    .prepare(
      "UPDATE slopbot_deliveries SET reopen_source = ? WHERE delivery_id = ? AND reopen_source IS NULL",
    )
    .bind(serialized, job.deliveryId)
    .run();
  const recorded = await db
    .prepare(
      "SELECT reopen_source FROM slopbot_deliveries WHERE delivery_id = ?",
    )
    .bind(job.deliveryId)
    .first<{ reopen_source: string | null }>();
  if (recorded?.reopen_source !== serialized)
    throw new Error("Reopen delivery source differs");
  return true;
}

export async function reopenSource(db: D1Database, job: ReopenJob) {
  const row = await db
    .prepare(
      "SELECT reopen_source FROM slopbot_deliveries WHERE delivery_id = ?",
    )
    .bind(job.deliveryId)
    .first<{ reopen_source: string | null }>();
  if (!row?.reopen_source) return null;
  const source = JSON.parse(row.reopen_source) as ReopenSource;
  if (
    source.installationId !== job.installationId ||
    source.repositoryId !== job.repositoryId ||
    source.itemKind !== job.itemKind ||
    source.number !== job.number ||
    source.senderId !== job.senderId
  )
    return null;
  return source;
}

/** Current GitHub maintainer authority is checked before this durable decision. */
export async function confirmReopen(db: D1Database, deliveryId: string) {
  await db
    .prepare(
      "UPDATE slopbot_deliveries SET reopen_confirmed_at = ? WHERE delivery_id = ? AND reopen_source IS NOT NULL AND reopen_confirmed_at IS NULL",
    )
    .bind(new Date().toISOString(), deliveryId)
    .run();
}

export async function confirmedReopenFor(
  db: D1Database,
  itemNodeId: string,
  revision: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS n FROM slopbot_deliveries
       WHERE reopen_confirmed_at IS NOT NULL
         AND json_extract(reopen_source, '$.itemNodeId') = ?
         AND json_extract(reopen_source, '$.revision') = ? LIMIT 1`,
    )
    .bind(itemNodeId, revision)
    .first<{ n: number }>();
  return row !== null;
}
