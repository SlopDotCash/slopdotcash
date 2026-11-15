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
  block_time: string;
  observed_at: string;
};

function isTestnetNetwork(network: string): boolean {
  return (
    (ESCROW_NETWORKS as Record<string, { testnet: boolean } | undefined>)[
      network
    ]?.testnet === true
  );
}

export async function handlePoolFundingApi(
  request: Request,
  deps: { db: Database; tier: "production" | "staging" | string },
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
        `SELECT project_id, network, vault, free_balance, block_time, observed_at
           FROM vault_snapshots
          ORDER BY project_id, network, vault`,
      )
      .all<StoredRow>();
    const projects = new Map<string, unknown[]>();
    for (const row of results ?? []) {
      if (deps.tier !== "staging" && isTestnetNetwork(row.network)) continue;
      const list = projects.get(row.project_id) ?? [];
      list.push({
        network: row.network,
        vault: row.vault,
        freeBalance: row.free_balance,
        blockTime: row.block_time,
        observedAt: row.observed_at,
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
