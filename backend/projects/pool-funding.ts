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
 */

import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import type {
  MonthStart,
  PoolFundingIndex,
  VaultFreeBalance,
} from "../../src/lib/pool-funding";
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

/** The vault rows `GET /api/v1/pool-funding` serves, one entry per project. */
export async function readPoolFundingProjects(
  db: Database,
  tier: "production" | "staging" | string,
  now: Date,
): Promise<{ projectId: string; vaults: VaultFreeBalance[] }[]> {
  const { results } = await db
    .prepare(
      `SELECT project_id, network, vault, free_balance, total_gross_withdrawn,
              block_time, observed_at
         FROM vault_snapshots
        ORDER BY project_id, network, vault`,
    )
    .all<StoredRow>();
  const [previous, current] = recentPeriods(now);
  const { results: startRows } = await db
    .prepare(
      `SELECT project_id, network, vault, period, free_balance,
              total_gross_withdrawn, block_time
         FROM vault_month_starts
        WHERE period IN (?, ?)
        ORDER BY period`,
    )
    .bind(previous, current)
    .all<StartRow>();
  const starts = new Map<string, MonthStart[]>();
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
  const projects = new Map<string, VaultFreeBalance[]>();
  for (const row of results ?? []) {
    if (tier !== "staging" && isTestnetNetwork(row.network)) continue;
    const key = `${row.project_id}\n${row.network}\n${row.vault}`;
    const list = projects.get(row.project_id) ?? [];
    list.push({
      network: row.network,
      vault: row.vault,
      freeBalance: row.free_balance,
      totalGrossWithdrawn: row.total_gross_withdrawn,
      blockTime: row.block_time,
      observedAt: row.observed_at,
      monthStarts: starts.get(key) ?? [],
    });
    projects.set(row.project_id, list);
  }
  return [...projects].map(([projectId, vaults]) => ({ projectId, vaults }));
}

/**
 * The same vault rows as an index for the shared listing rule
 * (`listedThisMonth` in src/lib/pool-funding.ts). Throws when D1 cannot be
 * read; callers fail open.
 */
export async function readPoolFundingIndex(
  db: Database,
  tier: "production" | "staging" | string,
  now: Date,
): Promise<PoolFundingIndex> {
  const index: PoolFundingIndex = new Map();
  for (const { projectId, vaults } of await readPoolFundingProjects(
    db,
    tier,
    now,
  ))
    index.set(projectId, vaults);
  return index;
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
    return json(
      200,
      {
        schema: "slop-pool-funding-v1",
        projects: await readPoolFundingProjects(
          deps.db,
          deps.tier,
          deps.now?.() ?? new Date(),
        ),
      },
      { cacheControl: CACHE_CONTROL },
    );
  } catch (caught) {
    return apiErrorResponse(caught, { label: "pool funding API failure" });
  }
}
