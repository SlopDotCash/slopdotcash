// D1 access for Slopbot (migrations/0013_slopbot.sql and
// 0018_slopbot_delivery_processing.sql). Provider cost rows are append-only.

import type {
  D1Database,
  D1Statement,
  D1TransactionalDatabase,
} from "../../backend/d1";
import { notifySlopbotInstallationLost } from "../../backend/notifications/events";
import { PRICE_VERSION, priceUsage } from "./contracts";
import type { CallRecord } from "./models";

export type { D1Database, D1TransactionalDatabase } from "../../backend/d1";

const now = () => new Date().toISOString();

export async function recordDelivery(
  db: D1Database,
  deliveryId: string,
  event: string,
): Promise<boolean> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO slopbot_deliveries (delivery_id, event, received_at) VALUES (?, ?, ?)",
    )
    .bind(deliveryId, event, now())
    .run();
  const row = await db
    .prepare(
      "SELECT processed_at FROM slopbot_deliveries WHERE delivery_id = ?",
    )
    .bind(deliveryId)
    .first<{ processed_at: string | null }>();
  if (!row) throw new Error("Webhook receipt was not stored");
  return row.processed_at === null;
}

export async function completeDelivery(db: D1Database, deliveryId: string) {
  await db
    .prepare(
      "UPDATE slopbot_deliveries SET processed_at = ? WHERE delivery_id = ? AND processed_at IS NULL",
    )
    .bind(now(), deliveryId)
    .run();
}

export async function releaseDelivery(db: D1Database, deliveryId: string) {
  await db
    // A queue send may have succeeded before its response was lost. Preserve
    // the original reopen source across redelivery and reject changed payloads.
    .prepare(
      "DELETE FROM slopbot_deliveries WHERE delivery_id = ? AND reopen_source IS NULL",
    )
    .bind(deliveryId)
    .run();
}

export async function claimInstallationDelivery(
  db: D1Database,
  deliveryId: string,
  event: string,
): Promise<boolean> {
  const inserted = await db
    .prepare(
      "INSERT OR IGNORE INTO slopbot_deliveries (delivery_id, event, received_at) VALUES (?, ?, ?)",
    )
    .bind(deliveryId, event, now())
    .run();
  if ((inserted.meta?.changes ?? 0) === 1) return true;
  const existing = await db
    .prepare(
      "SELECT event, installation_processed_at FROM slopbot_deliveries WHERE delivery_id = ?",
    )
    .bind(deliveryId)
    .first<{ event: string; installation_processed_at: string | null }>();
  return (
    existing?.event === event && existing.installation_processed_at === null
  );
}

type InstallationUpdate =
  | {
      kind: "upsert";
      installation: {
        id: number;
        account: { id: number; login: string; type: string };
      };
      sourceUpdatedAt: number;
    }
  | {
      kind: "state";
      installation: {
        id: number;
        account: { id: number; login: string; type: string };
      };
      state: "removed" | "suspended" | "active";
      sourceUpdatedAt: number;
    };

export async function completeInstallationDelivery(
  db: D1TransactionalDatabase,
  deliveryId: string,
  update: InstallationUpdate | null,
) {
  const statements: D1Statement[] = [];
  if (update?.kind === "upsert") {
    statements.push(
      db
        .prepare(
          `INSERT INTO slopbot_installations (installation_id, account_id, account_login, account_type, created_at, source_updated_at)
           VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(installation_id) DO UPDATE SET
             removed_at = NULL,
             account_login = excluded.account_login,
             source_updated_at = excluded.source_updated_at
           WHERE slopbot_installations.source_updated_at IS NULL
             OR slopbot_installations.source_updated_at < excluded.source_updated_at`,
        )
        .bind(
          update.installation.id,
          update.installation.account.id,
          update.installation.account.login,
          update.installation.account.type,
          now(),
          update.sourceUpdatedAt,
        ),
    );
  } else if (update?.kind === "state") {
    const column = update.state === "removed" ? "removed_at" : "suspended_at";
    const changedAt = update.state === "active" ? null : now();
    const equalTimestampGuard =
      update.state === "removed"
        ? "slopbot_installations.removed_at IS NULL"
        : update.state === "suspended"
          ? "slopbot_installations.removed_at IS NULL AND slopbot_installations.suspended_at IS NULL"
          : "0";
    statements.push(
      db
        .prepare(
          `INSERT INTO slopbot_installations
             (installation_id, account_id, account_login, account_type, created_at, suspended_at, removed_at, source_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(installation_id) DO UPDATE SET
             ${column} = excluded.${column},
             account_login = excluded.account_login,
             source_updated_at = excluded.source_updated_at
           WHERE slopbot_installations.source_updated_at IS NULL
             OR slopbot_installations.source_updated_at < excluded.source_updated_at
             OR (slopbot_installations.source_updated_at = excluded.source_updated_at
                 AND ${equalTimestampGuard})`,
        )
        .bind(
          update.installation.id,
          update.installation.account.id,
          update.installation.account.login,
          update.installation.account.type,
          now(),
          update.state === "suspended" ? changedAt : null,
          update.state === "removed" ? changedAt : null,
          update.sourceUpdatedAt,
        ),
    );
    if (changedAt !== null) {
      statements.push(
        notifySlopbotInstallationLost(db, update.installation.id, changedAt),
      );
    }
  }
  statements.push(
    db
      .prepare(
        "UPDATE slopbot_deliveries SET installation_processed_at = ? WHERE delivery_id = ? AND installation_processed_at IS NULL",
      )
      .bind(now(), deliveryId),
  );
  await db.batch(statements);
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

/** True while the installation is neither removed nor suspended. */
export async function installationActive(
  db: D1Database,
  installationId: number,
): Promise<boolean> {
  const state = await installation(db, installationId);
  return (
    state !== null && state.removed_at === null && state.suspended_at === null
  );
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
      "SELECT 1 AS ok FROM slopbot_reviews WHERE review_key = ? AND status = 'completed'",
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

// Longer than Cloudflare's 15-minute queue consumer wall limit. Contended
// deliveries wait for this lease instead of exhausting short retries or acking.
export const REVIEW_LEASE_SECONDS = 20 * 60;
export class ReviewBusyError extends Error {
  constructor(readonly delaySeconds: number) {
    super("Review is still claimed by another attempt");
  }
}
export class ReviewLeaseLostError extends Error {
  constructor() {
    super("Review attempt no longer owns its lease");
  }
}
export type ReviewClaim = { reviewKey: string; token: string };

export async function ownsReviewClaim(
  db: D1Database,
  claim: ReviewClaim,
): Promise<boolean> {
  return (
    (await db
      .prepare(
        "SELECT 1 AS ok FROM slopbot_reviews WHERE review_key = ? AND claim_token = ? AND status = 'running' AND lease_expires_at > ?",
      )
      .bind(claim.reviewKey, claim.token, now())
      .first()) !== null
  );
}
export async function assertReviewClaim(db: D1Database, claim: ReviewClaim) {
  if (!(await ownsReviewClaim(db, claim))) throw new ReviewLeaseLostError();
}

// A skipped item has never reached inference. A failed or interrupted attempt
// resumes unbilled. Each transition atomically replaces the attempt token.
export async function startReview(
  db: D1Database,
  row: ReviewRow,
  token: string,
): Promise<"new" | "retry" | "exists"> {
  const at = now();
  const expires = new Date(
    Date.parse(at) + REVIEW_LEASE_SECONDS * 1000,
  ).toISOString();
  // Eligibility skips are not completed reviews. Claim the same revision
  // again when its draft/installation/budget state permits review. A skip
  // before any model call is still a first attempt; prior calls retain their
  // original timestamp and identify retries. All new calls are free.
  const resumed = await db
    .prepare(
      `UPDATE slopbot_reviews SET status = 'running', content_digest = ?,
        created_at = CASE WHEN EXISTS (SELECT 1 FROM slopbot_costs WHERE review_key = ?)
          THEN created_at ELSE ? END, skip_reason = NULL, completed_at = NULL, claim_token = ?, lease_expires_at = ?
       WHERE review_key = ? AND status = 'skipped'
       RETURNING EXISTS (SELECT 1 FROM slopbot_costs WHERE review_key = ?) AS retry`,
    )
    .bind(
      row.contentDigest,
      row.reviewKey,
      at,
      token,
      expires,
      row.reviewKey,
      row.reviewKey,
    )
    .first<{ retry: number }>();
  if (resumed !== null) return resumed.retry === 1 ? "retry" : "new";
  const retried = await db
    .prepare(
      "UPDATE slopbot_reviews SET status = 'running', skip_reason = NULL, completed_at = NULL, claim_token = ?, lease_expires_at = ? WHERE review_key = ? AND (status = 'failed' OR (status = 'running' AND lease_expires_at <= ?))",
    )
    .bind(token, expires, row.reviewKey, at)
    .run();
  if ((retried.meta?.changes ?? 0) === 1) return "retry";
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO slopbot_reviews (review_key, installation_id, repository_id, item_kind, item_number,
      item_node_id, author_id, revision, content_digest, policy_digest, status, created_at, claim_token, lease_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
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
      at,
      token,
      expires,
    )
    .run();
  if ((result.meta?.changes ?? 0) === 1) return "new";
  const current = await db
    .prepare(
      "SELECT status, lease_expires_at FROM slopbot_reviews WHERE review_key = ?",
    )
    .bind(row.reviewKey)
    .first<{ status: string; lease_expires_at: string | null }>();
  if (current?.status === "completed") return "exists";
  const until = Date.parse(current?.lease_expires_at ?? "");
  throw new ReviewBusyError(
    Number.isFinite(until)
      ? Math.max(
          1,
          Math.min(
            REVIEW_LEASE_SECONDS,
            Math.ceil((until - Date.now()) / 1000),
          ),
        )
      : REVIEW_LEASE_SECONDS,
  );
}

export async function finishReview(
  db: D1Database,
  reviewKey: string,
  token: string,
  status: "completed" | "failed" | "skipped",
  detail: { skipReason?: string; verdict?: unknown; action?: string },
) {
  const at = now();
  const result = await db
    .prepare(
      "UPDATE slopbot_reviews SET status = ?, skip_reason = ?, verdict = ?, action = ?, completed_at = ?, lease_expires_at = NULL WHERE review_key = ? AND claim_token = ? AND status = 'running' AND lease_expires_at > ?",
    )
    .bind(
      status,
      detail.skipReason ?? null,
      detail.verdict === undefined ? null : JSON.stringify(detail.verdict),
      detail.action ?? null,
      at,
      reviewKey,
      token,
      at,
    )
    .run();
  if ((result.meta?.changes ?? 0) !== 1) throw new ReviewLeaseLostError();
}

// Keep provider costs for operational budgets and alerts. Slopbot is free:
// new calls never charge projects, including retries of historically billed reviews.
// Existing call-v1/review-v2 rows retain their original amounts.
export async function recordCalls(
  db: D1Database,
  reviewKey: string,
  installationId: number,
  callKind: "triage" | "confirm",
  calls: CallRecord[],
): Promise<void> {
  for (const call of calls) {
    const price = priceUsage(call.priceKey, call.usage);
    if (price === null) throw new Error(`no price for ${call.priceKey}`);
    const substituted =
      call.servedModel !== null &&
      !call.priceKey.endsWith(`/${call.servedModel}`);
    const recorded = await db
      .prepare(
        `INSERT INTO slopbot_costs (review_key, installation_id, call_kind, route_step, provider, requested_model,
          served_model, outcome, failure, input_tokens, cache_write_tokens, cache_read_tokens, output_tokens,
          price_version, cost_micro_usd, billed_micro_usdc, reconciliation, created_at, provider_cost_micro_usd,
          provider_request_id, billing_rule, billable_cost_micro_usd)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'review-v2', 0)
        RETURNING id`,
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
        substituted ? "estimated" : price.reconciliation,
        now(),
        call.providerCostMicroUsd ?? null,
        call.providerRequestId ?? null,
      )
      .first<{ id: number }>();
    if (!recorded) throw new Error("Provider cost was not recorded");
  }
}

export async function hasRecordedAction(
  db: D1Database,
  reviewKey: string,
  action: "label" | "comment",
): Promise<boolean> {
  return (
    (await db
      .prepare(
        "SELECT id FROM slopbot_actions WHERE review_key = ? AND action = ?",
      )
      .bind(reviewKey, action)
      .first()) !== null
  );
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
