/**
 * Private admin route for fee-wallet conversions (workers/fee-converter,
 * PRD MVP-07c). Admins only; there is no public page or route. Signed
 * transaction bytes stay in D1 and are never returned. The only write closes
 * an open vault fee claim that the Worker marked for operator review.
 */

import {
  NETWORK_DEFINITIONS,
  NETWORKS,
} from "../../workers/fee-converter/config";
import { OPERATOR_REVIEW } from "../../workers/fee-converter/core";

export interface FeeConversionsDependencies {
  db: {
    prepare(query: string): {
      bind(...values: (string | number)[]): {
        all<T>(): Promise<{ results: T[] }>;
        run(): Promise<{ meta?: { changes?: number } }>;
      };
    };
  };
  adminGithubIds: ReadonlySet<string>;
  sessionActor(request: Request): Promise<{ githubId: string } | null>;
}

export const FEE_CONVERSIONS_PATH = "/api/v1/admin/fee-conversions";
export const FEE_CLAIM_RESOLVE_PATH = `${FEE_CONVERSIONS_PATH}/claims/resolve`;
const RECENT_LIMIT = 100;

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

interface RecentRow {
  id: string;
  network: string;
  mode: string;
  token: string;
  target_token: string;
  amount_in: string;
  route: string | null;
  quote_amount_out: string | null;
  min_amount_out: string | null;
  price_impact_bps: number | null;
  approval_tx_id: string | null;
  tx_id: string | null;
  amount_out: string | null;
  token_balance_before: string | null;
  target_balance_before: string | null;
  target_balance_after: string | null;
  state: string;
  reason: string | null;
  created_at: string;
  submitted_at: string | null;
  finalized_at: string | null;
}

interface OpenClaimRow {
  id: string;
  network: string;
  token: string;
  amount_in: string;
  tx_id: string | null;
  evm_nonce: number | null;
  state: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

interface SettledRow {
  network: string;
  token: string;
  target_token: string;
  amount_in: string;
  amount_out: string;
}

export interface FeeConversionTotal {
  network: string;
  token: string;
  targetToken: string;
  conversions: number;
  /** Exact base-unit sums as decimal strings; money is never a float. */
  amountIn: string;
  amountOut: string;
}

/** Sums finalized live conversions per network and token in exact integers. */
export function totalsPerToken(rows: SettledRow[]): FeeConversionTotal[] {
  const totals = new Map<
    string,
    {
      network: string;
      token: string;
      targetToken: string;
      n: number;
      in: bigint;
      out: bigint;
    }
  >();
  for (const row of rows) {
    const key = `${row.network}:${row.token}`;
    const total = totals.get(key) ?? {
      network: row.network,
      token: row.token,
      targetToken: row.target_token,
      n: 0,
      in: 0n,
      out: 0n,
    };
    total.n += 1;
    total.in += BigInt(row.amount_in);
    total.out += BigInt(row.amount_out);
    totals.set(key, total);
  }
  return [...totals.values()]
    .sort((a, b) => (a.network + a.token < b.network + b.token ? -1 : 1))
    .map((t) => ({
      network: t.network,
      token: t.token,
      targetToken: t.targetToken,
      conversions: t.n,
      amountIn: t.in.toString(),
      amountOut: t.out.toString(),
    }));
}

export interface FeeConversionRoute {
  network: string;
  /** Circle USDC on the network, or null while no address is verified. */
  targetToken: string | null;
  /** `pending`: received fees stay in the fee wallet; nothing converts. */
  status: "usdc" | "pending";
}

/** The conversion target of every network, so a pending route is visible. */
export function conversionRoutes(): FeeConversionRoute[] {
  return NETWORKS.map((network) => {
    const usdc = NETWORK_DEFINITIONS[network].usdc;
    return {
      network,
      targetToken: usdc,
      status: usdc === null ? "pending" : "usdc",
    };
  });
}

/** Returns null when the request is not for this route. */
export async function handleFeeConversionsApi(
  request: Request,
  deps: FeeConversionsDependencies,
): Promise<Response | null> {
  const url = new URL(request.url);
  const resolve = url.pathname === FEE_CLAIM_RESOLVE_PATH;
  if (url.pathname !== FEE_CONVERSIONS_PATH && !resolve) return null;
  if (request.method !== (resolve ? "POST" : "GET"))
    return json(405, { error: "method_not_allowed" });
  // A cross-site form cannot send this site's origin with a JSON body.
  if (
    resolve &&
    (request.headers.get("origin") !== url.origin ||
      request.headers.get("content-type")?.split(";")[0] !== "application/json")
  )
    return json(403, {
      error: "origin_forbidden",
      message: "Requests must come from this site",
    });
  try {
    const actor = await deps.sessionActor(request);
    if (actor === null)
      return json(401, {
        error: "unauthorized",
        message: "Sign in with GitHub",
      });
    if (!deps.adminGithubIds.has(actor.githubId))
      return json(403, {
        error: "forbidden",
        message: "Admin access is required",
      });
    if (resolve) return await resolveClaim(request, actor.githubId, deps);
    const [recent, settled, states, openClaims] = await Promise.all([
      deps.db
        .prepare(
          `SELECT id, network, mode, token, target_token, amount_in, route, quote_amount_out,
                  min_amount_out, price_impact_bps, approval_tx_id, tx_id, amount_out,
                  token_balance_before, target_balance_before, target_balance_after, state,
                  reason, created_at, submitted_at, finalized_at
             FROM fee_conversions WHERE kind = 'conversion'
             ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        )
        .bind(RECENT_LIMIT)
        .all<RecentRow>(),
      deps.db
        .prepare(
          `SELECT network, token, target_token, amount_in, amount_out FROM fee_conversions
            WHERE mode = ? AND state = 'finalized' AND kind = 'conversion'`,
        )
        .bind("live")
        .all<SettledRow>(),
      deps.db
        .prepare(
          `SELECT network, mode, state, COUNT(*) AS count FROM fee_conversions
            WHERE created_at >= ? AND kind = 'conversion'
            GROUP BY network, mode, state ORDER BY network, mode, state`,
        )
        .bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .all<{ network: string; mode: string; state: string; count: number }>(),
      // Claims are not conversions, but an open claim blocks conversion of
      // its token. Show every one, with the reason it is still open.
      deps.db
        .prepare(
          `SELECT id, network, token, amount_in, tx_id, evm_nonce, state, reason,
                  created_at, updated_at
             FROM fee_conversions
            WHERE kind = 'claim' AND state IN ('submitted', 'unknown')
            ORDER BY created_at, rowid LIMIT ?`,
        )
        .bind(RECENT_LIMIT)
        .all<OpenClaimRow>(),
    ]);
    return json(200, {
      schemaVersion: "1",
      recent: recent.results.map((row) => ({
        id: row.id,
        network: row.network,
        mode: row.mode,
        token: row.token,
        targetToken: row.target_token,
        amountIn: row.amount_in,
        route: row.route,
        quoteAmountOut: row.quote_amount_out,
        minAmountOut: row.min_amount_out,
        priceImpactBps: row.price_impact_bps,
        approvalTxId: row.approval_tx_id,
        txId: row.tx_id,
        amountOut: row.amount_out,
        tokenBalanceBefore: row.token_balance_before,
        targetBalanceBefore: row.target_balance_before,
        targetBalanceAfter: row.target_balance_after,
        state: row.state,
        reason: row.reason,
        createdAt: row.created_at,
        submittedAt: row.submitted_at,
        finalizedAt: row.finalized_at,
      })),
      openClaims: openClaims.results.map((row) => ({
        id: row.id,
        network: row.network,
        token: row.token,
        expectedAmount: row.amount_in,
        txId: row.tx_id,
        evmNonce: row.evm_nonce,
        state: row.state,
        reason: row.reason,
        operatorReview: row.reason?.startsWith(OPERATOR_REVIEW) ?? false,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      routes: conversionRoutes(),
      totals: totalsPerToken(settled.results),
      last24Hours: states.results,
    });
  } catch {
    console.error("fee conversions API failure");
    return json(500, { error: "internal_error", message: "Internal error" });
  }
}

/**
 * Closes one open claim that the Worker marked for operator review: no chain
 * read can settle it, and it blocks conversion of its token. The operator
 * checks the transaction in another source first. The row becomes `failed`
 * with the operator's GitHub ID and reason. Its signed bytes, amount and
 * vault record stay unchanged. Only the claim's journal state changes here;
 * nothing is signed, sent or converted.
 */
async function resolveClaim(
  request: Request,
  githubId: string,
  deps: FeeConversionsDependencies,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    reason?: unknown;
  } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!/^[A-Za-z0-9-]{8,80}$/u.test(id) || reason.length < 10)
    return json(400, {
      error: "invalid_request",
      message: "Send the claim id and a reason of at least 10 characters",
    });
  const recorded = `operator ${githubId}: ${reason}`.slice(0, 500);
  const result = await deps.db
    .prepare(
      `UPDATE fee_conversions SET state = 'failed', reason = ?, updated_at = ?
        WHERE id = ? AND kind = 'claim' AND state IN ('submitted', 'unknown')
          AND substr(reason, 1, ?) = ?`,
    )
    .bind(
      recorded,
      new Date().toISOString(),
      id,
      OPERATOR_REVIEW.length,
      OPERATOR_REVIEW,
    )
    .run();
  if (result.meta?.changes !== 1)
    return json(409, {
      error: "not_resolvable",
      message: "Only an open claim marked for operator review can be closed",
    });
  return json(200, { id, state: "failed", reason: recorded });
}
