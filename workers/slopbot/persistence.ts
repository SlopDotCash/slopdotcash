// D1 access for Slopbot (migrations/0013_slopbot.sql). Cost and credit rows are
// append-only; the balance is always derived, never stored.
import { PRICE_VERSION, priceUsage } from "./contracts";
import type { CallRecord } from "./models";

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
};
export type D1Database = { prepare(query: string): D1Statement };

const now = () => new Date().toISOString();

export async function recordDelivery(
  db: D1Database,
  deliveryId: string,
  event: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      "INSERT OR IGNORE INTO slopbot_deliveries (delivery_id, event, received_at) VALUES (?, ?, ?)",
    )
    .bind(deliveryId, event, now())
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

export async function upsertInstallation(
  db: D1Database,
  installation: {
    id: number;
    account: { id: number; login: string; type: string };
  },
) {
  await db
    .prepare(
      `INSERT INTO slopbot_installations (installation_id, account_id, account_login, account_type, created_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(installation_id) DO UPDATE SET removed_at = NULL, account_login = excluded.account_login`,
    )
    .bind(
      installation.id,
      installation.account.id,
      installation.account.login,
      installation.account.type,
      now(),
    )
    .run();
}

export async function setInstallationState(
  db: D1Database,
  installationId: number,
  state: "removed" | "suspended" | "active",
) {
  const column = state === "removed" ? "removed_at" : "suspended_at";
  await db
    .prepare(
      `UPDATE slopbot_installations SET ${column} = ? WHERE installation_id = ?`,
    )
    .bind(state === "active" ? null : now(), installationId)
    .run();
}

export async function installation(db: D1Database, installationId: number) {
  return db
    .prepare(
      "SELECT created_at, suspended_at, removed_at FROM slopbot_installations WHERE installation_id = ?",
    )
    .bind(installationId)
    .first<{
      created_at: string;
      suspended_at: string | null;
      removed_at: string | null;
    }>();
}

export async function balance(
  db: D1Database,
  installationId: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT (SELECT COALESCE(SUM(amount_micro_usdc), 0) FROM slopbot_credits WHERE installation_id = ?1)
            - (SELECT COALESCE(SUM(billed_micro_usdc), 0) FROM slopbot_costs WHERE installation_id = ?1) AS balance`,
    )
    .bind(installationId)
    .first<{ balance: number }>();
  return row?.balance ?? 0;
}

export async function isParticipant(
  db: D1Database,
  githubId: number,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM points_members WHERE github_id = ?")
    .bind(String(githubId))
    .first();
  return row !== null;
}

export async function count(
  db: D1Database,
  sql: string,
  ...values: unknown[]
): Promise<number> {
  const row = await db
    .prepare(sql)
    .bind(...values)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function reviewExists(
  db: D1Database,
  reviewKey: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 AS ok FROM slopbot_reviews WHERE review_key = ? AND status != 'failed'",
    )
    .bind(reviewKey)
    .first();
  return row !== null;
}

export type ReviewRow = {
  reviewKey: string;
  installationId: number;
  repositoryId: number;
  itemKind: "issue" | "pull_request";
  itemNumber: number;
  itemNodeId: string;
  authorId: number;
  revision: string;
  contentDigest: string;
  policyDigest: string;
};

// "retry" resumes a review whose earlier attempt failed; its model calls are
// Slop-caused and recorded unbilled.
export async function startReview(
  db: D1Database,
  row: ReviewRow,
): Promise<"new" | "retry" | "exists"> {
  const retried = await db
    .prepare(
      "UPDATE slopbot_reviews SET status = 'running' WHERE review_key = ? AND status = 'failed'",
    )
    .bind(row.reviewKey)
    .run();
  if ((retried.meta?.changes ?? 0) === 1) return "retry";
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO slopbot_reviews (review_key, installation_id, repository_id, item_kind, item_number,
        item_node_id, author_id, revision, content_digest, policy_digest, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
    )
    .bind(
      row.reviewKey,
      row.installationId,
      row.repositoryId,
      row.itemKind,
      row.itemNumber,
      row.itemNodeId,
      row.authorId,
      row.revision,
      row.contentDigest,
      row.policyDigest,
      now(),
    )
    .run();
  return (result.meta?.changes ?? 0) === 1 ? "new" : "exists";
}

export async function finishReview(
  db: D1Database,
  reviewKey: string,
  status: "completed" | "failed" | "skipped",
  detail: { skipReason?: string; verdict?: unknown; action?: string },
) {
  await db
    .prepare(
      "UPDATE slopbot_reviews SET status = ?, skip_reason = ?, verdict = ?, action = ?, completed_at = ? WHERE review_key = ?",
    )
    .bind(
      status,
      detail.skipReason ?? null,
      detail.verdict === undefined ? null : JSON.stringify(detail.verdict),
      detail.action ?? null,
      now(),
      reviewKey,
    )
    .run();
}

// One immutable cost row per model call (BOT-10). Failed calls are recorded
// at cost but billed zero: Slop absorbs provider failures.
export async function recordCalls(
  db: D1Database,
  reviewKey: string,
  installationId: number,
  callKind: "triage" | "confirm",
  calls: CallRecord[],
  billable: boolean,
): Promise<number> {
  let billed = 0;
  for (const call of calls) {
    const price = priceUsage(call.priceKey, call.usage);
    if (price === null) throw new Error(`no price for ${call.priceKey}`);
    const substituted =
      call.servedModel !== null &&
      !call.priceKey.endsWith(`/${call.servedModel}`);
    const billedMicro =
      billable && call.outcome === "ok" ? price.billedMicroUsdc : 0;
    billed += billedMicro;
    await db
      .prepare(
        `INSERT INTO slopbot_costs (review_key, installation_id, call_kind, route_step, provider, requested_model,
          served_model, outcome, failure, input_tokens, cache_write_tokens, cache_read_tokens, output_tokens,
          price_version, cost_micro_usd, billed_micro_usdc, reconciliation, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        reviewKey,
        installationId,
        callKind,
        call.routeStep,
        call.provider,
        call.requestedModel,
        call.servedModel,
        call.outcome,
        call.failure,
        call.usage.input,
        call.usage.cacheWrite,
        call.usage.cacheRead,
        call.usage.output,
        PRICE_VERSION,
        price.costMicroUsd,
        billedMicro,
        substituted ? "estimated" : price.reconciliation,
        now(),
      )
      .run();
  }
  return billed;
}

export async function recordAction(
  db: D1Database,
  reviewKey: string,
  repositoryId: number,
  itemNodeId: string,
  action: "comment" | "label" | "close" | "appeal" | "human_reopen",
  detail: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO slopbot_actions (review_key, repository_id, item_node_id, action, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(reviewKey, repositoryId, itemNodeId, action, detail, now())
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

export async function commentId(
  db: D1Database,
  itemNodeId: string,
): Promise<number | null> {
  const row = await db
    .prepare(
      "SELECT comment_id FROM slopbot_item_comments WHERE item_node_id = ?",
    )
    .bind(itemNodeId)
    .first<{ comment_id: number }>();
  return row?.comment_id ?? null;
}

export async function saveCommentId(
  db: D1Database,
  itemNodeId: string,
  repositoryId: number,
  id: number,
) {
  await db
    .prepare(
      `INSERT INTO slopbot_item_comments (item_node_id, repository_id, comment_id) VALUES (?, ?, ?)
       ON CONFLICT(item_node_id) DO UPDATE SET comment_id = excluded.comment_id`,
    )
    .bind(itemNodeId, repositoryId, id)
    .run();
}
