/**
 * The signed-in contributor's standing deposit (operator decision,
 * 23 November 2026; PRD section 5, "Standing deposit", and section 6,
 * FEE-08):
 *
 *   GET  /api/v1/standing-deposit           the caller's deposit and covers
 *   POST /api/v1/standing-deposit           asks one, or refreshes an unpaid one
 *   POST /api/v1/standing-deposit/withdraw  cancels an unpaid one, or asks a paid one back
 *
 * Every route needs the member session; a contributor reads and changes only
 * their own row. The amount is 10 US dollars of SLOP at the rate in force when
 * it is asked, read exactly as the per pull request fee reads it. This API
 * moves no money and never writes `paid_*` or an outcome: the submission-fee
 * Worker records payments and sends what Slopbot found due. While the
 * contract is not deployed it creates no row, so nothing can be paid.
 */

import {
  STANDING_DEPOSIT_CONTRACT,
  STANDING_DEPOSIT_NETWORK,
  STANDING_DEPOSIT_START_BLOCK,
  standingDepositAmount,
  standingDepositDeployed,
  standingDepositItem,
} from "../../src/lib/standing-deposit.mjs";
import {
  STANDING_DEPOSIT_API,
  STANDING_DEPOSIT_COVER_LIMIT,
  STANDING_DEPOSIT_WITHDRAW_API,
} from "../../src/lib/standing-deposit-page";
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_CHAIN_IDS,
  SUBMISSION_FEE_SLOP_DECIMALS,
  SUBMISSION_FEE_TOKENS,
  slopRatesAt,
} from "../../src/lib/submission-fee.mjs";
import {
  type D1QueryStatement,
  type D1TransactionalDatabase,
  isConstraintFailure,
} from "../d1";
import {
  apiErrorResponse,
  exactKeys,
  fail,
  isSameOriginJsonWrite,
  json,
  requireActor,
  requireJsonObject,
} from "../http";
import { publishedSlopRates } from "../submission-fee/handler";

const MAX_BODY_BYTES = 256;

export type StandingDepositDependencies = {
  db: D1TransactionalDatabase<D1QueryStatement>;
  sessionActor(request: Request): Promise<{ githubId: string } | null>;
  now: () => Date;
  randomId: () => string;
  /** The recorded deployment; tests name a local one. */
  deployment?: { contract: string | null; startBlock: number | null };
};

type Row = {
  id: string;
  round: number;
  item: string;
  slop_amount: string;
  asked_at: string;
  paid_at: string | null;
  paid_deposit_id: number | null;
  withdraw_requested_at: string | null;
  outcome: string | null;
  outcome_reason: string | null;
  outcome_at: string | null;
  paid_token: string | null;
  paid_amount: string | null;
  paid_transaction: string | null;
  paid_finalized_at: string | null;
  resolve_transaction: string | null;
};

const ROW_COLUMNS = `r.id, r.round, r.item, r.slop_amount, r.asked_at, r.paid_at,
  r.paid_deposit_id, r.withdraw_requested_at, r.outcome, r.outcome_reason,
  r.outcome_at,
  d.token AS paid_token, d.amount AS paid_amount, d.tx_hash AS paid_transaction,
  d.finalized_at AS paid_finalized_at, d.resolve_tx AS resolve_transaction`;
const ROW_JOIN = `standing_deposits r
  LEFT JOIN submission_fee_deposits d
    ON d.network = r.paid_network AND d.deposit_id = r.paid_deposit_id`;
/** The one row the unique index allows per account. */
const CURRENT = `r.cancelled_at IS NULL
  AND (r.outcome IS NULL OR r.outcome IN ('refund_due', 'kept_due'))`;

function deployment(deps: StandingDepositDependencies) {
  const recorded = deps.deployment ?? {
    contract: STANDING_DEPOSIT_CONTRACT,
    startBlock: STANDING_DEPOSIT_START_BLOCK,
  };
  return standingDepositDeployed(recorded.contract, recorded.startBlock)
    ? recorded.contract
    : null;
}

/** The latest deposit an account has not cancelled: current, or finished. */
function latestRow(deps: StandingDepositDependencies, githubId: number) {
  return deps.db
    .prepare(
      `SELECT ${ROW_COLUMNS} FROM ${ROW_JOIN}
        WHERE r.github_id = ? AND r.cancelled_at IS NULL
        ORDER BY r.round DESC LIMIT 1`,
    )
    .bind(githubId)
    .first<Row>();
}

function currentRow(deps: StandingDepositDependencies, githubId: number) {
  return deps.db
    .prepare(
      `SELECT ${ROW_COLUMNS} FROM ${ROW_JOIN}
        WHERE r.github_id = ? AND ${CURRENT}`,
    )
    .bind(githubId)
    .first<Row>();
}

/** The SLOP amount at the rate in force now, or null before the first rate. */
async function quote(deps: StandingDepositDependencies) {
  const { current } = slopRatesAt(
    await publishedSlopRates(deps.db),
    deps.now().toISOString(),
  );
  return current === null
    ? null
    : { amount: standingDepositAmount(current.slopPerUsd), rate: current };
}

function deposit(row: Row) {
  const paid = row.paid_at !== null && row.paid_deposit_id !== null;
  // The Worker records the deposit before it marks the row; a row it marked
  // without its deposit record cannot be shown as paid.
  if (paid && (row.paid_token === null || row.paid_transaction === null))
    fail(503, "record_unavailable", "The deposit record is unavailable.");
  return {
    round: row.round,
    item: row.item,
    amount: row.slop_amount,
    askedAt: row.asked_at,
    paid: paid
      ? {
          at: row.paid_at,
          // The chain the deposit is on, as the pay page names networks.
          network: STANDING_DEPOSIT_NETWORK,
          depositId: row.paid_deposit_id,
          token: row.paid_token,
          amount: row.paid_amount,
          transaction: row.paid_transaction,
          finalized: row.paid_finalized_at !== null,
        }
      : null,
    withdrawRequestedAt: row.withdraw_requested_at,
    outcome: row.outcome,
    outcomeReason: row.outcome_reason,
    outcomeAt: row.outcome_at,
    resolveTransaction: row.resolve_transaction,
  };
}

async function state(deps: StandingDepositDependencies, githubId: number) {
  const contract = deployment(deps);
  const row = await latestRow(deps, githubId);
  const covers =
    row === null
      ? []
      : (
          await deps.db
            .prepare(
              `SELECT owner, repo, pull_number, state, pr_open
                 FROM standing_deposit_covers
                WHERE deposit_id = ?
                ORDER BY covered_at DESC, repository_id, pull_number
                LIMIT ?`,
            )
            .bind(row.id, STANDING_DEPOSIT_COVER_LIMIT)
            .all<{
              owner: string;
              repo: string;
              pull_number: number;
              state: string;
              pr_open: number;
            }>()
        ).results;
  return {
    schema: "slop-standing-deposit-v1",
    deployed: contract !== null,
    network: STANDING_DEPOSIT_NETWORK,
    chainId: SUBMISSION_FEE_CHAIN_IDS[STANDING_DEPOSIT_NETWORK],
    contract,
    token: SUBMISSION_FEE_TOKENS[STANDING_DEPOSIT_NETWORK].slop,
    symbol: "SLOP",
    decimals: SUBMISSION_FEE_SLOP_DECIMALS,
    keptTo: SUBMISSION_FEE_BURN,
    // What a new deposit would be now; null before the first rate.
    quote: contract === null ? null : ((await quote(deps))?.amount ?? null),
    deposit: row === null ? null : deposit(row),
    covers: covers.map((cover) => ({
      repository: `${cover.owner}/${cover.repo}`,
      pullNumber: cover.pull_number,
      state: cover.state,
      open: cover.pr_open === 1,
    })),
  };
}

/** Asks a deposit, or refreshes the amount of the caller's unpaid one. */
async function ask(deps: StandingDepositDependencies, githubId: number) {
  if (deployment(deps) === null)
    fail(
      409,
      "standing_deposit_not_deployed",
      "Standing deposits are not available yet.",
    );
  const priced = await quote(deps);
  if (priced === null || priced.amount === null)
    fail(
      409,
      "no_rate",
      "Slop has no published SLOP rate yet, so a standing deposit cannot be asked. Try again later.",
    );
  const current = await currentRow(deps, githubId);
  // A paid deposit is never repriced or replaced.
  if (current !== null && current.paid_at !== null) return;
  if (current !== null) {
    await deps.db
      .prepare(
        `UPDATE standing_deposits SET slop_amount = ?, slop_per_usd = ?
          WHERE id = ? AND paid_at IS NULL AND cancelled_at IS NULL`,
      )
      .bind(priced.amount, priced.rate.slopPerUsd, current.id)
      .run();
    return;
  }
  const last = await deps.db
    .prepare(
      "SELECT COALESCE(MAX(round), 0) AS round FROM standing_deposits WHERE github_id = ?",
    )
    .bind(githubId)
    .first<{ round: number }>();
  const round = (last?.round ?? 0) + 1;
  try {
    await deps.db
      .prepare(
        `INSERT INTO standing_deposits
           (id, github_id, round, item, slop_amount, slop_per_usd, asked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `sd_${deps.randomId().replace(/-/gu, "")}`,
        githubId,
        round,
        standingDepositItem(githubId, round),
        priced.amount,
        priced.rate.slopPerUsd,
        deps.now().toISOString(),
      )
      .run();
  } catch (error) {
    // Another request asked one first; the caller sees that one.
    if (!isConstraintFailure(error)) throw error;
  }
}

/**
 * An unpaid deposit is cancelled; a paid one is asked back once, which stops
 * it covering new pull requests at once. Anything else refuses.
 */
async function withdraw(deps: StandingDepositDependencies, githubId: number) {
  const current = await currentRow(deps, githubId);
  if (current === null)
    fail(409, "no_deposit", "You have no standing deposit to withdraw.");
  const now = deps.now().toISOString();
  if (current.paid_at === null) {
    const result = await deps.db
      .prepare(
        `UPDATE standing_deposits SET cancelled_at = ?
          WHERE id = ? AND paid_at IS NULL AND cancelled_at IS NULL`,
      )
      .bind(now, current.id)
      .run();
    if ((result.meta?.changes ?? 0) !== 1)
      fail(
        409,
        "deposit_changed",
        "Your deposit was just recorded as paid. Reload the page and withdraw it again.",
      );
    return;
  }
  if (current.outcome !== null)
    fail(
      409,
      "already_settling",
      "This deposit is already being sent back or kept.",
    );
  if (current.withdraw_requested_at !== null)
    fail(409, "already_requested", "A withdrawal is already requested.");
  const result = await deps.db
    .prepare(
      `UPDATE standing_deposits SET withdraw_requested_at = ?
        WHERE id = ? AND paid_at IS NOT NULL AND outcome IS NULL
          AND withdraw_requested_at IS NULL`,
    )
    .bind(now, current.id)
    .run();
  if ((result.meta?.changes ?? 0) !== 1)
    fail(
      409,
      "deposit_changed",
      "This deposit changed. Reload the page to see it.",
    );
}

export async function handleStandingDeposit(
  request: Request,
  deps: StandingDepositDependencies,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  const path = pathname.replace(/\/$/u, "");
  if (path !== STANDING_DEPOSIT_API && path !== STANDING_DEPOSIT_WITHDRAW_API)
    return null;
  const read = path === STANDING_DEPOSIT_API && request.method === "GET";
  if (!read) {
    if (request.method !== "POST")
      return json(405, { error: "method_not_allowed" });
    if (!isSameOriginJsonWrite(request))
      return json(403, { error: "origin_forbidden" });
  }
  try {
    const actor = await requireActor(request, deps);
    const githubId = Number(actor.githubId);
    if (!Number.isSafeInteger(githubId) || githubId <= 0)
      fail(401, "unauthorized", "Sign in with GitHub");
    if (!read) {
      exactKeys(
        await requireJsonObject(request, MAX_BODY_BYTES, "Standing deposit"),
        [],
      );
      if (path === STANDING_DEPOSIT_WITHDRAW_API)
        await withdraw(deps, githubId);
      else await ask(deps, githubId);
    }
    return json(200, await state(deps, githubId));
  } catch (caught) {
    return apiErrorResponse(caught, { label: "standing deposit API failure" });
  }
}
