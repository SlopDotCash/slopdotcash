/**
 * Public reads of the refundable submission fee (PRD section 6, "Submission
 * fee deposits"):
 *
 *   GET /api/v1/submission-fee/rate
 *   GET /api/v1/submission-fee/items/<repositoryId>/<pullNumber>
 *
 * Both serve stored D1 rows only: the SLOP rate the rate job wrote, the pull
 * request's row Slopbot wrote, and the payment the submission-fee Worker
 * recorded. Neither reads a chain or GitHub, and neither changes anything.
 */

import {
  SUBMISSION_FEE_SLOP_SHARE_BPS,
  slopRatesAt,
  submissionFeeOptions,
} from "../../src/lib/submission-fee.mjs";
import type { D1Database, D1QueryStatement } from "../d1";
import { apiErrorResponse, json } from "../http";

type Database = D1Database<D1QueryStatement>;

export const SUBMISSION_FEE_PATH = "/api/v1/submission-fee";
const CACHE_CONTROL = "public, max-age=60";
const ID = /^[1-9][0-9]{0,15}$/u;

async function rates(db: Database) {
  const { results } = await db
    .prepare(
      "SELECT effective_at, slop_per_usd FROM submission_fee_rates ORDER BY effective_at",
    )
    .all<{ effective_at: string; slop_per_usd: string }>();
  return results.map((row) => ({
    effectiveAt: row.effective_at,
    slopPerUsd: row.slop_per_usd,
  }));
}

/** Slopbot's table arrives with its own migration; before it, nothing is known. */
async function hasItems(db: Database) {
  const row = await db
    .prepare(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'submission_fee_items'",
    )
    .first<{ found: number }>();
  return row?.found === 1;
}

export async function handleSubmissionFeeApi(
  request: Request,
  deps: { db: Database; now?: () => Date },
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (
    pathname !== SUBMISSION_FEE_PATH &&
    !pathname.startsWith(`${SUBMISSION_FEE_PATH}/`)
  )
    return null;
  const respond = (status: number, body: unknown) =>
    json(status, body, { cacheControl: CACHE_CONTROL });
  if (request.method !== "GET" && request.method !== "HEAD")
    return respond(405, { error: "method_not_allowed" });
  const at = (deps.now?.() ?? new Date()).toISOString();
  const parts = pathname
    .slice(SUBMISSION_FEE_PATH.length)
    .replace(/\/$/u, "")
    .split("/")
    .slice(1);
  try {
    if (parts.length === 1 && parts[0] === "rate") {
      const { current, previous } = slopRatesAt(await rates(deps.db), at);
      return respond(200, {
        schema: "slop-submission-fee-rate-v1",
        // The SLOP fee is this share of the stablecoin fee, at the rate.
        slopShareBps: SUBMISSION_FEE_SLOP_SHARE_BPS,
        // Null until the first rate is in force: SLOP is not accepted yet.
        rate: current,
        previous,
      });
    }
    if (
      parts.length === 3 &&
      parts[0] === "items" &&
      ID.test(parts[1]) &&
      ID.test(parts[2])
    ) {
      if (!(await hasItems(deps.db)))
        return respond(404, { error: "not_found" });
      const row = await deps.db
        .prepare(
          `SELECT i.repository_id, i.pull_number, i.project_id, i.item, i.stable_minor,
                  i.asked_at, i.paid_at, i.paid_network, i.paid_deposit_id,
                  i.outcome, i.outcome_at,
                  d.token AS paid_token, d.amount AS paid_amount,
                  d.tx_hash AS paid_transaction, d.finalized_at AS paid_finalized_at,
                  d.resolve_tx AS resolve_transaction
             FROM submission_fee_items i
             LEFT JOIN submission_fee_deposits d
               ON d.network = i.paid_network AND d.deposit_id = i.paid_deposit_id
            WHERE i.repository_id = ? AND i.pull_number = ?`,
        )
        .bind(Number(parts[1]), Number(parts[2]))
        .first<{
          repository_id: number;
          pull_number: number;
          project_id: string;
          item: string;
          stable_minor: string;
          asked_at: string;
          paid_at: string | null;
          paid_network: string | null;
          paid_deposit_id: number | null;
          outcome: string | null;
          outcome_at: string | null;
          paid_token: string | null;
          paid_amount: string | null;
          paid_transaction: string | null;
          paid_finalized_at: string | null;
          resolve_transaction: string | null;
        }>();
      // No row: Slop has not asked a fee for this pull request.
      if (!row) return respond(404, { error: "not_found" });
      const paid = row.paid_at !== null && row.paid_deposit_id !== null;
      return respond(200, {
        schema: "slop-submission-fee-item-v1",
        repositoryId: row.repository_id,
        pullNumber: row.pull_number,
        projectId: row.project_id,
        item: row.item,
        stableMinor: row.stable_minor,
        askedAt: row.asked_at,
        // Each accepted token with its amount, contract and where a kept
        // fee goes. Nothing more is due once the pull request is paid.
        due: paid
          ? []
          : submissionFeeOptions(row.stable_minor, await rates(deps.db), at),
        paid: paid
          ? {
              at: row.paid_at,
              network: row.paid_network,
              depositId: row.paid_deposit_id,
              token: row.paid_token,
              amount: row.paid_amount,
              transaction: row.paid_transaction,
              finalized: row.paid_finalized_at !== null,
            }
          : null,
        outcome: row.outcome,
        outcomeAt: row.outcome_at,
        resolveTransaction: row.resolve_transaction,
      });
    }
    return respond(404, { error: "not_found" });
  } catch (caught) {
    return apiErrorResponse(caught, { label: "submission fee API failure" });
  }
}
