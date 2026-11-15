/**
 * Which monthly pools have their money in a vault (operator decision,
 * 15 November 2026). A project's monthly amount is shown as money only when
 * a recorded vault on a paying network holds at least that amount; every
 * other pool is shown as points only.
 *
 * `GET /api/v1/pool-funding` serves the free balance of every recorded vault
 * from the finalized counters the payments Worker caches in `vault_snapshots`
 * (PRD section 9: no chain read per page view). The browser compares the
 * balance with the project's current monthly amount from the registry.
 * Production leaves testnet vaults out, as the per-project vault route does.
 *
 * Each vault also carries its first finalized read of this UTC month and the
 * one before (`vault_month_starts`, migration 0127), so a page can tell
 * whether a month was funded on the 1st and whether money was withdrawn
 * since.
 *
 * A vault whose contract supports month pledges (migration 0128) also carries
 * its open pledged total and its pledge for each month from the previous one
 * on, and every pledge still open, so an owner can see and release a lapsed
 * one; `openPledgedGross` is null for a vault without pledge support.
 */

import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import type { D1Database, D1QueryStatement } from "../d1";
import { apiErrorResponse, json } from "../http";

type Database = D1Database<D1QueryStatement>;

export const POOL_FUNDING_PATH = "/api/v1/pool-funding";
const CACHE_CONTROL = "public, max-age=60, s-maxage=60";

type StoredRow = {
  project_id: string;
  network: string;
  vault: string;
  free_balance: string | null;
  total_gross_withdrawn: string;
  block_time: string;
  observed_at: string;
  open_pledged_gross: string | null;
};

type PledgeRow = {
  project_id: string;
  network: string;
  vault: string;
  period: string;
  amount: string;
  open: number;
};

type StartRow = {
  project_id: string;
  network: string;
  vault: string;
  period: string;
  free_balance: string;
  total_gross_withdrawn: string;
  block_time: string;
};

/** This UTC month and the one before, as YYYY-MM. */
export function recentPeriods(now: Date): [string, string] {
  const current = now.toISOString().slice(0, 7);
  const previous = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  )
    .toISOString()
    .slice(0, 7);
  return [previous, current];
}

function isTestnetNetwork(network: string): boolean {
  return (
    (ESCROW_NETWORKS as Record<string, { testnet: boolean } | undefined>)[
      network
    ]?.testnet === true
  );
}

export async function handlePoolFundingApi(
  request: Request,
  deps: {
    db: Database;
    tier: "production" | "staging" | string;
    now?: () => Date;
  },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.pathname !== POOL_FUNDING_PATH &&
    url.pathname !== `${POOL_FUNDING_PATH}/`
  )
    return null;
  if (request.method !== "GET" && request.method !== "HEAD")
    return json(
      405,
      { error: "method_not_allowed" },
      { cacheControl: CACHE_CONTROL },
    );
  try {
    const { results } = await deps.db
      .prepare(
        `SELECT project_id, network, vault, free_balance, total_gross_withdrawn,
                block_time, observed_at, open_pledged_gross
           FROM vault_snapshots
          ORDER BY project_id, network, vault`,
      )
      .all<StoredRow>();
    const [previous, current] = recentPeriods(deps.now?.() ?? new Date());
    const { results: startRows } = await deps.db
      .prepare(
        `SELECT project_id, network, vault, period, free_balance,
                total_gross_withdrawn, block_time
           FROM vault_month_starts
          WHERE period IN (?, ?)
          ORDER BY period`,
      )
      .bind(previous, current)
      .all<StartRow>();
    const starts = new Map<string, unknown[]>();
    for (const row of startRows ?? []) {
      const key = `${row.project_id}\n${row.network}\n${row.vault}`;
      const list = starts.get(key) ?? [];
      list.push({
        period: row.period,
        freeBalance: row.free_balance,
        totalGrossWithdrawn: row.total_gross_withdrawn,
        blockTime: row.block_time,
      });
      starts.set(key, list);
    }
    const { results: pledgeRows } = await deps.db
      .prepare(
        `SELECT project_id, network, vault, period, amount, open
           FROM vault_month_pledges
          WHERE (period >= ? OR open = 1) AND amount <> '0'
          ORDER BY period`,
      )
      .bind(previous)
      .all<PledgeRow>();
    const pledges = new Map<string, unknown[]>();
    for (const row of pledgeRows ?? []) {
      const key = `${row.project_id}\n${row.network}\n${row.vault}`;
      const list = pledges.get(key) ?? [];
      list.push({
        period: row.period,
        amount: row.amount,
        open: row.open === 1,
      });
      pledges.set(key, list);
    }
    const projects = new Map<string, unknown[]>();
    for (const row of results ?? []) {
      if (deps.tier !== "staging" && isTestnetNetwork(row.network)) continue;
      const list = projects.get(row.project_id) ?? [];
      list.push({
        network: row.network,
        vault: row.vault,
        freeBalance: row.free_balance,
        totalGrossWithdrawn: row.total_gross_withdrawn,
        blockTime: row.block_time,
        observedAt: row.observed_at,
        monthStarts:
          starts.get(`${row.project_id}\n${row.network}\n${row.vault}`) ?? [],
        openPledgedGross: row.open_pledged_gross,
        pledges:
          row.open_pledged_gross === null
            ? []
            : (pledges.get(`${row.project_id}\n${row.network}\n${row.vault}`) ??
              []),
      });
      projects.set(row.project_id, list);
    }
    return json(
      200,
      {
        schema: "slop-pool-funding-v1",
        projects: [...projects].map(([projectId, vaults]) => ({
          projectId,
          vaults,
        })),
      },
      { cacheControl: CACHE_CONTROL },
    );
  } catch (caught) {
    return apiErrorResponse(caught, { label: "pool funding API failure" });
  }
}
