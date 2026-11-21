/**
 * A private list of the project months whose Points are frozen (operator
 * decision, 21 November 2026; PRD section 7). The Points of a project month
 * that has a recorded payment never change, and the atomic Points import
 * refuses a batch that changes one. The release's points generator holds
 * those candidate revisions first, and reads this route to learn which months
 * are protected, so the committed list no longer has to be edited by hand.
 *
 * `GET /api/v1/operator/protected-point-months` answers only a request that
 * carries `Authorization: Bearer <POINTS_PROTECTION_TOKEN>`. Without the Pages
 * secret, or with any other token, this handler returns null and the request
 * falls through to the API's ordinary not-found answer, so the route cannot be
 * told apart from a path that does not exist.
 *
 * Both lists come from the statements in `scripts/points-protection-sql.ts`,
 * which are built from the same tables and clauses as the import's own
 * predicate. The answer names project months and projects only. It never
 * carries an amount, a recipient, a wallet, a vault, a transaction or which
 * kind of record protects a month. It is read-only and changes no state.
 */

import {
  protectedPointMonthsQuery,
  protectedPointProjectsQuery,
} from "../../scripts/points-protection-sql";
import type { D1Database, D1QueryStatement } from "../d1";
import { apiErrorResponse, json } from "../http";
import { bearerTokenAuthorized } from "./reserved-awards-feed";

type Database = D1Database<D1QueryStatement>;

export const PROTECTED_POINT_MONTHS_PATH =
  "/api/v1/operator/protected-point-months";
export const PROTECTED_POINT_MONTHS_SCHEMA = "slop-protected-point-months-v1";
const CACHE_CONTROL = "no-store";
const PERIOD = /^\d{4}-(?:0[1-9]|1[0-2])$/u;

export type ProtectedPointMonths = {
  /** Project months that a payment record of their own protects. */
  months: { projectId: string; period: string }[];
  /** Projects protected in every month. */
  everyMonthProjects: string[];
};

/** A project id an award can carry: non-empty text. */
function isProjectId(value: unknown): value is string {
  return typeof value === "string" && value !== "" && !value.includes("\0");
}

/**
 * The protected project months and the projects protected in every month.
 * An award's month is always `YYYY-MM`, so the import's predicate can never
 * match a record whose month is written any other way: such a record protects
 * nothing there, and is left out here too. These tables are permanent, so a
 * refusal would close the route for good.
 */
export async function readProtectedPointMonths(
  db: Database,
): Promise<ProtectedPointMonths> {
  const [months, projects] = await Promise.all([
    db
      .prepare(protectedPointMonthsQuery())
      .all<{ project_id: unknown; period: unknown }>(),
    db.prepare(protectedPointProjectsQuery()).all<{ project_id: unknown }>(),
  ]);
  return {
    months: (months.results ?? []).flatMap((row) =>
      isProjectId(row.project_id) &&
      typeof row.period === "string" &&
      PERIOD.test(row.period)
        ? [{ projectId: row.project_id, period: row.period }]
        : [],
    ),
    everyMonthProjects: (projects.results ?? []).flatMap((row) =>
      isProjectId(row.project_id) ? [row.project_id] : [],
    ),
  };
}

/**
 * `GET /api/v1/operator/protected-point-months`. Null means "not this route":
 * the path differs, the secret is unset, or the token is missing or wrong.
 */
export async function handleProtectedPointMonths(
  request: Request,
  deps: {
    db: Database;
    /** The Pages secret `POINTS_PROTECTION_TOKEN`; unset closes the route. */
    token: string | undefined;
    now?: () => Date;
  },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.pathname !== PROTECTED_POINT_MONTHS_PATH &&
    url.pathname !== `${PROTECTED_POINT_MONTHS_PATH}/`
  )
    return null;
  if (!bearerTokenAuthorized(request, deps.token)) return null;
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
        schema: PROTECTED_POINT_MONTHS_SCHEMA,
        generatedAt: (deps.now?.() ?? new Date()).toISOString(),
        ...(await readProtectedPointMonths(deps.db)),
      },
      { cacheControl: CACHE_CONTROL },
    );
  } catch (caught) {
    return apiErrorResponse(caught, {
      label: "protected point months failure",
    });
  }
}
