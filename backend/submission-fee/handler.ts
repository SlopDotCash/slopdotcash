/**
 * Public reads of the refundable submission fee (PRD section 6, "Submission
 * fee deposits"):
 *
 *   GET /api/v1/submission-fee/rate
 *   GET /api/v1/submission-fee/items/<repositoryId>/<pullNumber>
 *   GET /api/v1/submission-fee/reports/<caseId>
 *
 * All serve stored D1 rows only: the SLOP rate the rate job wrote, the pull
 * request's row Slopbot wrote, the report deposit row the security API wrote
 * (PRD section 8, "Report deposit"), and the payment the submission-fee
 * Worker recorded. None reads a chain or GitHub, and none changes anything.
 * The report read names no project, reporter, title or report text.
 */

import { REPORT_DEPOSIT_NETWORK } from "../../src/lib/security-report-deposit.mjs";
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_CHAIN_IDS,
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_SLOP_DECIMALS,
  SUBMISSION_FEE_SLOP_SHARE_BPS,
  SUBMISSION_FEE_TOKENS,
  slopRatesAt,
  submissionFeeOptions,
} from "../../src/lib/submission-fee.mjs";
import type { D1Database, D1QueryStatement } from "../d1";
import { apiErrorResponse, json } from "../http";

type Database = D1Database<D1QueryStatement>;

export const SUBMISSION_FEE_PATH = "/api/v1/submission-fee";
const CACHE_CONTROL = "public, max-age=60";
const ID = /^[1-9][0-9]{0,15}$/u;
const CASE_ID = /^sc_[A-Za-z0-9_-]{8,72}$/u;

/** Every published SLOP rate, as the rate job wrote them; also read by the standing deposit API. */
export async function publishedSlopRates(db: Database) {
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

/** A table arrives with its own migration; before it, nothing is known. */
async function hasTable(db: Database, name: string) {
  const row = await db
    .prepare(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(name)
    .first<{ found: number }>();
  return row?.found === 1;
}

/**
 * The deposit asked for one private report, by its case id. Public, with no
 * sign-in, and never cached: it answers only for a row that asks (`asked`),
 * and returns the item, the amount and the payment, nothing about the
 * report.
 */
async function reportDeposit(db: Database, caseId: string) {
  if (!(await hasTable(db, "security_report_deposits"))) return null;
  const row = await db
    .prepare(
      `SELECT r.case_id, r.item, r.slop_amount, r.asked_at, r.paid_at,
              r.paid_network, r.paid_deposit_id, r.outcome, r.outcome_reason,
              r.outcome_at,
              d.token AS paid_token, d.amount AS paid_amount,
              d.tx_hash AS paid_transaction, d.finalized_at AS paid_finalized_at,
              d.resolve_tx AS resolve_transaction
         FROM security_report_deposits r
         LEFT JOIN submission_fee_deposits d
           ON d.network = r.paid_network AND d.deposit_id = r.paid_deposit_id
        WHERE r.case_id = ? AND r.mode = 'asked'`,
    )
    .bind(caseId)
    .first<{
      case_id: string;
      item: string;
      slop_amount: string;
      asked_at: string;
      paid_at: string | null;
      paid_network: string | null;
      paid_deposit_id: number | null;
      outcome: string | null;
      outcome_reason: string | null;
      outcome_at: string | null;
      paid_token: string | null;
      paid_amount: string | null;
      paid_transaction: string | null;
      paid_finalized_at: string | null;
      resolve_transaction: string | null;
    }>();
  // No asking row: Slop has not asked a deposit for this report.
  if (!row) return null;
  const paid = row.paid_at !== null && row.paid_deposit_id !== null;
  return {
    schema: "slop-report-deposit-v1",
    caseId: row.case_id,
    item: row.item,
    askedAt: row.asked_at,
    // The one way to pay: SLOP on Robinhood Chain, kept deposits burned.
    // Nothing more is due once the report is paid or decided.
    due:
      paid || row.outcome !== null
        ? []
        : [
            {
              network: REPORT_DEPOSIT_NETWORK,
              chainId: SUBMISSION_FEE_CHAIN_IDS[REPORT_DEPOSIT_NETWORK],
              token: SUBMISSION_FEE_TOKENS[REPORT_DEPOSIT_NETWORK].slop,
              symbol: "SLOP",
              decimals: SUBMISSION_FEE_SLOP_DECIMALS,
              amount: row.slop_amount,
              contract: SUBMISSION_FEE_CONTRACTS[REPORT_DEPOSIT_NETWORK],
              keptTo: SUBMISSION_FEE_BURN,
            },
          ],
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
    outcomeReason: row.outcome_reason,
    outcomeAt: row.outcome_at,
    resolveTransaction: row.resolve_transaction,
  };
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
      const { current, previous } = slopRatesAt(
        await publishedSlopRates(deps.db),
        at,
      );
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
      if (!(await hasTable(deps.db, "submission_fee_items")))
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
          : submissionFeeOptions(
              row.stable_minor,
              await publishedSlopRates(deps.db),
              at,
            ),
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
    if (parts.length === 2 && parts[0] === "reports") {
      // Never cached: the reporter reloads this while the deposit confirms.
      const body = CASE_ID.test(parts[1])
        ? await reportDeposit(deps.db, parts[1])
        : null;
      return json(body === null ? 404 : 200, body ?? { error: "not_found" }, {
        cacheControl: "no-store",
      });
    }
    return respond(404, { error: "not_found" });
  } catch (caught) {
    return apiErrorResponse(caught, { label: "submission fee API failure" });
  }
}
