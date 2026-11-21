/**
 * A private feed of reserved awards for one operator service (operator
 * decision, 17 November 2026; PRD section 9). When a month is paid from a
 * project vault, an award stays reserved while its contributor has no
 * confirmed payout wallet on the vault's network or has not authorized the
 * payout. Nothing else tells that contributor. An operator service reads this
 * feed to remind them.
 *
 * `GET /api/v1/operator/reserved-awards` answers only a request that carries
 * `Authorization: Bearer <OPERATOR_FEED_TOKEN>`. Without the Pages secret, or
 * with any other token, this handler returns null and the request falls
 * through to the API's ordinary not-found answer, so the route cannot be told
 * apart from a path that does not exist.
 *
 * The answer names accounts only: one row per contributor and project, with
 * the network and what the contributor still has to do. It never carries an
 * amount, a wallet address, an award id or a month. Team accounts and closed
 * accounts are left out. It is read-only and changes no payment state.
 */

import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import { constantTimeEqual } from "../../workers/identity/crypto";
import type { D1Database, D1QueryStatement } from "../d1";
import { apiErrorResponse, json } from "../http";

type Database = D1Database<D1QueryStatement>;

export const RESERVED_AWARDS_PATH = "/api/v1/operator/reserved-awards";
export const RESERVED_AWARDS_SCHEMA = "slop-reserved-awards-v1";
/** A shorter secret is treated as unset, so a weak value never opens the feed. */
export const MINIMUM_FEED_TOKEN_LENGTH = 32;
const CACHE_CONTROL = "no-store";

/** What the contributor still has to do before the award can be paid. */
export type ReservedAwardNeed = "wallet" | "authorize";

export type ReservedAward = {
  githubId: number;
  /** Null when no record names this account's login. */
  login: string | null;
  projectId: string;
  /** Null when the project record is unavailable. */
  projectName: string | null;
  network: string;
  needs: ReservedAwardNeed;
};

type Row = {
  github_user_id: string;
  project_id: string;
  network: string;
  member_login: string | null;
  award_login: string | null;
  wallet_login: string | null;
  project_name: string | null;
  confirmed: number;
  bound: number;
};

/**
 * One row per reserved award. `confirmed`: the contributor's current wallet
 * on the award's chain is authorized, by the same join the dispatcher uses.
 * `bound`: a payout binding is on record for that wallet and vault, either
 * the signed EVM binding authorization or a Solana binding attempt that did
 * not fail. A binding in progress needs nothing more from the contributor.
 */
const RESERVED_AWARDS_QUERY = `
SELECT o.github_user_id, o.project_id, o.network,
  (SELECT m.login FROM points_members m WHERE m.github_id = o.github_user_id) AS member_login,
  (SELECT a.github_login FROM monthly_payment_obligations a
    WHERE a.project_id = o.project_id AND a.github_user_id = o.github_user_id
    ORDER BY a.period DESC LIMIT 1) AS award_login,
  (SELECT c.github_login FROM wallet_claims c
    WHERE c.github_user_id = o.github_user_id
    ORDER BY c.created_at DESC LIMIT 1) AS wallet_login,
  (SELECT json_extract(p.manifest, '$.name') FROM projects p WHERE p.id = o.project_id) AS project_name,
  (w.id IS NOT NULL) AS confirmed,
  (w.id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM payment_binding_authorizations b
      WHERE b.claim_id = w.id AND b.network = o.network
        AND lower(b.vault) = lower(o.vault))
    OR EXISTS (SELECT 1 FROM payment_attempts t
      JOIN payment_obligations bound ON bound.id = t.obligation_id
      WHERE t.claim_id = w.id AND t.state <> 'failed'
        AND bound.github_user_id = o.github_user_id
        AND bound.network = o.network AND bound.vault = o.vault)
  )) AS bound
FROM payment_obligations o
LEFT JOIN (
  SELECT claim.id, claim.github_user_id, claim.chain
  FROM effective_payment_wallet_claims claim
  JOIN payment_wallet_authorizations authorized
    ON authorized.claim_id = claim.id
   AND authorized.github_user_id = claim.github_user_id
) w ON w.github_user_id = o.github_user_id AND w.chain = o.chain
WHERE o.state = 'reserved'
  AND NOT EXISTS (SELECT 1 FROM points_members closed
    WHERE closed.github_id = o.github_user_id AND closed.closed_at IS NOT NULL)
ORDER BY o.project_id, length(o.github_user_id), o.github_user_id`;

function isTestnetNetwork(network: string): boolean {
  return (
    (ESCROW_NETWORKS as Record<string, { testnet: boolean } | undefined>)[
      network
    ]?.testnet === true
  );
}

/**
 * The accounts with a funded award still reserved that the contributor can
 * release: `wallet` when no confirmed wallet exists on the award's network,
 * `authorize` when one exists but no payout binding does. An award whose
 * wallet is confirmed and bound is being paid and is left out. Production
 * leaves test networks out, as the other payment reads do.
 */
export async function readReservedAwards(
  db: Database,
  options: {
    tier: "production" | "staging" | string;
    teamGithubIds: ReadonlySet<string>;
  },
): Promise<ReservedAward[]> {
  const { results } = await db.prepare(RESERVED_AWARDS_QUERY).all<Row>();
  const awards = new Map<string, ReservedAward>();
  for (const row of results ?? []) {
    if (options.teamGithubIds.has(row.github_user_id)) continue;
    if (options.tier !== "staging" && isTestnetNetwork(row.network)) continue;
    const need: ReservedAwardNeed | null =
      row.confirmed !== 1 ? "wallet" : row.bound !== 1 ? "authorize" : null;
    if (need === null) continue;
    const githubId = Number(row.github_user_id);
    if (!Number.isSafeInteger(githubId) || githubId <= 0)
      throw new Error("Reserved award names an invalid GitHub account");
    const key = `${row.project_id}\n${row.github_user_id}`;
    const existing = awards.get(key);
    // Several months of one contributor and project are one row. A missing
    // wallet comes first: nothing can be authorized without it.
    if (existing) {
      if (need === "wallet") existing.needs = "wallet";
      continue;
    }
    awards.set(key, {
      githubId,
      login: row.member_login ?? row.award_login ?? row.wallet_login,
      projectId: row.project_id,
      projectName: row.project_name,
      network: row.network,
      needs: need,
    });
  }
  return [...awards.values()];
}

/** True only for the exact bearer token of a configured, long enough secret. */
function authorized(request: Request, token: string | undefined): boolean {
  const presented = request.headers.get("authorization") ?? "";
  const configured =
    typeof token === "string" && token.length >= MINIMUM_FEED_TOKEN_LENGTH;
  // Compare against the configured value or a same-shaped stand-in, so the
  // time taken does not show whether the secret exists.
  const expected = `Bearer ${configured ? token : "x".repeat(MINIMUM_FEED_TOKEN_LENGTH)}`;
  return constantTimeEqual(presented, expected) && configured;
}

/**
 * `GET /api/v1/operator/reserved-awards`. Null means "not this route": the
 * path differs, the secret is unset, or the token is missing or wrong.
 */
export async function handleReservedAwardsFeed(
  request: Request,
  deps: {
    db: Database;
    /** The Pages secret `OPERATOR_FEED_TOKEN`; unset closes the route. */
    token: string | undefined;
    tier: "production" | "staging" | string;
    /** Administrators and moderators, left out of the feed. */
    teamGithubIds: ReadonlySet<string>;
    now?: () => Date;
  },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.pathname !== RESERVED_AWARDS_PATH &&
    url.pathname !== `${RESERVED_AWARDS_PATH}/`
  )
    return null;
  if (!authorized(request, deps.token)) return null;
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
        schema: RESERVED_AWARDS_SCHEMA,
        generatedAt: (deps.now?.() ?? new Date()).toISOString(),
        awards: await readReservedAwards(deps.db, deps),
      },
      { cacheControl: CACHE_CONTROL },
    );
  } catch (caught) {
    return apiErrorResponse(caught, { label: "reserved awards feed failure" });
  }
}
