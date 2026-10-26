/**
 * Public read route for the referral accrual files (workers/referral-accrual;
 * PRD section 11, "Referral program", proposed). The files are the exact bytes
 * the job filed, so anyone can recompute an epoch from the public payment
 * record. There is no page, link or copy for this route yet: it is the data
 * surface a later terms page would cite. Nothing here reads a session or a
 * key, and there is no write route.
 */

import { isPeriod } from "../../workers/referral-accrual/config";
import { apiErrorResponse, JSON_HEADERS, json } from "../http";

interface ReferralsDependencies {
  db: {
    prepare(query: string): {
      bind(...values: (string | number)[]): {
        all<T>(): Promise<{ results: T[] }>;
      };
    };
  };
}

export const REFERRAL_ACCRUALS_PATH = "/api/v1/referrals/accruals";

const CACHE_CONTROL = "public, max-age=300";

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
    return json(
      405,
      { error: "method_not_allowed" },
      { cacheControl: CACHE_CONTROL },
    );
  try {
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
      return json(
        200,
        {
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
        },
        { cacheControl: CACHE_CONTROL },
      );
    }
    const period = rest.slice(1).replace(/\.json$/u, "");
    if (!isPeriod(period))
      return json(404, { error: "not_found" }, { cacheControl: CACHE_CONTROL });
    const { results } = await deps.db
      .prepare(
        "SELECT body, body_sha256 FROM referral_accrual_files WHERE period = ?",
      )
      .bind(period)
      .all<{ body: string; body_sha256: string }>();
    const row = results[0];
    if (row === undefined)
      return json(404, { error: "not_found" }, { cacheControl: CACHE_CONTROL });
    return new Response(request.method === "HEAD" ? null : row.body, {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        "cache-control": CACHE_CONTROL,
        "x-slop-sha256": row.body_sha256,
      },
    });
  } catch (caught) {
    return apiErrorResponse(caught, { label: "referral accruals API failure" });
  }
}
