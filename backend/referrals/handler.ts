/**
 * Public read route for the referral accrual files (workers/referral-accrual;
 * PRD section 11, "Referral program", proposed). The files are the exact bytes
 * the job filed, so anyone can recompute an epoch from the public payment
 * record. There is no page, link or copy for this route yet: it is the data
 * surface a later terms page would cite. Nothing here reads a session or a
 * key, and there is no write route.
 */

import { isPeriod } from "../../workers/referral-accrual/config";

export interface ReferralsDependencies {
  db: {
    prepare(query: string): {
      bind(...values: (string | number)[]): {
        all<T>(): Promise<{ results: T[] }>;
      };
    };
  };
}

export const REFERRAL_ACCRUALS_PATH = "/api/v1/referrals/accruals";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=300",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

interface FileRow {
  period: string;
  epoch: number;
  mode: string;
  body_sha256: string;
  merkle_root: string | null;
  tree_total_base: string;
  leaf_count: number;
  created_at: string;
}

export async function handleReferralsApi(
  request: Request,
  deps: ReferralsDependencies,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.pathname !== REFERRAL_ACCRUALS_PATH &&
    !url.pathname.startsWith(`${REFERRAL_ACCRUALS_PATH}/`)
  )
    return null;
  if (request.method !== "GET" && request.method !== "HEAD")
    return json(405, { error: "method_not_allowed" });
  const rest = url.pathname.slice(REFERRAL_ACCRUALS_PATH.length);
  if (rest === "" || rest === "/") {
    const { results } = await deps.db
      .prepare(
        `SELECT period, epoch, mode, body_sha256, merkle_root, tree_total_base,
                leaf_count, created_at
           FROM referral_accrual_files ORDER BY epoch`,
      )
      .bind()
      .all<FileRow>();
    return json(200, {
      schema: "slop-referral-accrual-index-v1",
      files: results.map((row) => ({
        period: row.period,
        epoch: row.epoch,
        mode: row.mode,
        bodySha256: row.body_sha256,
        merkleRoot: row.merkle_root,
        treeTotalBase: row.tree_total_base,
        leafCount: row.leaf_count,
        createdAt: row.created_at,
        url: `${REFERRAL_ACCRUALS_PATH}/${row.period}`,
      })),
    });
  }
  const period = rest.slice(1).replace(/\.json$/u, "");
  if (!isPeriod(period)) return json(404, { error: "not_found" });
  const { results } = await deps.db
    .prepare(
      "SELECT body, body_sha256 FROM referral_accrual_files WHERE period = ?",
    )
    .bind(period)
    .all<{ body: string; body_sha256: string }>();
  const row = results[0];
  if (row === undefined) return json(404, { error: "not_found" });
  return new Response(request.method === "HEAD" ? null : row.body, {
    status: 200,
    headers: { ...JSON_HEADERS, "x-slop-sha256": row.body_sha256 },
  });
}
