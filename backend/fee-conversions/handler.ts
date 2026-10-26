/**
 * Private admin read route for fee-wallet conversions (workers/fee-converter,
 * PRD MVP-07c). Admins only; there is no public page or route. Signed
 * transaction bytes stay in D1 and are never returned.
 */

import {
  NETWORK_DEFINITIONS,
  NETWORKS,
} from "../../workers/fee-converter/config";
import { apiErrorResponse, fail, json, requireActor } from "../http";

export interface FeeConversionsDependencies {
  db: {
    prepare(query: string): {
      bind(...values: (string | number)[]): {
        all<T>(): Promise<{ results: T[] }>;
      };
    };
  };
  adminGithubIds: ReadonlySet<string>;
  sessionActor(request: Request): Promise<{ githubId: string } | null>;
}

export const FEE_CONVERSIONS_PATH = "/api/v1/admin/fee-conversions";
const RECENT_LIMIT = 100;

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
  landed_tx_id: string | null;
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

interface SettledRow {
  network: string;
  token: string;
  target_token: string;
  amount_in: string;
  amount_out: string;
}

interface FeeConversionTotal {
  network: string;
  token: string;
  targetToken: string;
  conversions: number;
  /** Exact base-unit sums as decimal strings; money is never a float. */
  amountIn: string;
  amountOut: string;
}

/** Sums finalized live conversions per network and token in exact integers. */
function totalsPerToken(rows: SettledRow[]): FeeConversionTotal[] {
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

interface FeeConversionRoute {
  network: string;
  /** Circle USDC on the network, or null when received assets stay unconverted. */
  targetToken: string | null;
  /** `not_converted`: received assets stay unchanged in the fee wallet. */
  status: "usdc" | "not_converted";
}

/** The conversion target of every network, including explicit unconverted retention. */
function conversionRoutes(): FeeConversionRoute[] {
  return NETWORKS.map((network) => {
    const usdc = NETWORK_DEFINITIONS[network].usdc;
    return {
      network,
      targetToken: usdc,
      status: usdc === null ? "not_converted" : "usdc",
    };
  });
}

/** Returns null when the request is not for this route. */
export async function handleFeeConversionsApi(
  request: Request,
  deps: FeeConversionsDependencies,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== FEE_CONVERSIONS_PATH) return null;
  if (request.method !== "GET")
    return json(405, { error: "method_not_allowed" });
  try {
    const actor = await requireActor(request, deps);
    if (!deps.adminGithubIds.has(actor.githubId))
      fail(403, "forbidden", "Admin access is required");
    const [recent, settled, states] = await Promise.all([
      deps.db
        .prepare(
          `SELECT id, network, mode, token, target_token, amount_in, route, quote_amount_out,
                  min_amount_out, price_impact_bps, approval_tx_id, tx_id, landed_tx_id, amount_out,
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
        // The original send or the same-nonce replacement that landed.
        landedTxId: row.landed_tx_id,
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
      routes: conversionRoutes(),
      totals: totalsPerToken(settled.results),
      last24Hours: states.results,
    });
  } catch (caught) {
    return apiErrorResponse(caught, { label: "fee conversions API failure" });
  }
}
