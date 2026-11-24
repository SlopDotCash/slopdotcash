/**
 * A private view of the security report queue and a retry of missing or
 * failed report analyses, for one operator job (operator decision,
 * 24 November 2026; PRD section 8).
 *
 * A new report gets one automatic analysis behind the request that filed it.
 * The platform stops that background work about 30 seconds after the
 * response, so it runs with `BACKGROUND_ANALYSIS_TIMEOUT_MS` and is never
 * retried by itself: only an owner pressing Analyze runs it again. Reports
 * whose owner never pressed it kept no analysis for weeks.
 *
 * `/api/v1/operator/security-queue` answers only a request that carries
 * `Authorization: Bearer <OPERATOR_FEED_TOKEN>`. Without the Pages secret, or
 * with any other token, this handler returns null and the request falls
 * through to the API's ordinary not-found answer, as the other operator
 * routes do.
 *
 * - `GET` returns per-project counts only. It never carries a case id, a
 *   reporter, report text or an advisory id.
 * - `POST` runs at most one analysis inside the request, with the full
 *   `ANALYSIS_TIMEOUT_MS`, on the oldest open report that the owner's
 *   Analyze would accept. A report gets at most four attempts per report
 *   version, at least 30 minutes apart, and the route starts no attempt once
 *   150 attempts (of any origin) started in the current UTC day.
 *
 * "Open" means a verified report with no decision yet: `receipt_state` is
 * `received` or `triaging`, and the report does not wait for its deposit.
 * `needs-information` waits on the reporter, and every other state records
 * a decision, so neither counts.
 */

import type { D1Database, D1QueryStatement } from "../d1";
import { apiErrorResponse, json } from "../http";
import { bearerTokenAuthorized } from "../payments/reserved-awards-feed";
import {
  ANALYSIS_TIMEOUT_MS,
  type AnalysisDependencies,
  analysisMayStart,
  retryable,
  runCaseAnalysis,
} from "./analysis";
import { depositHeld, depositHeldSql } from "./report-deposit-hold";

type Database = D1Database<D1QueryStatement>;

export const SECURITY_QUEUE_PATH = "/api/v1/operator/security-queue";
export const SECURITY_QUEUE_SCHEMA = "slop-security-queue-v1";
/** Receipt states that mean no decision has been recorded yet. */
export const OPEN_RECEIPT_STATES = ["received", "triaging"] as const;
/** Attempts per report version before the operator job stops retrying. */
export const RETRY_ATTEMPT_LIMIT = 4;
/** The least time between two attempts on one report. */
export const RETRY_SPACING_MS = 30 * 60 * 1000;
/** Attempts of any origin started in one UTC day before the job stops. */
export const DAILY_ATTEMPT_LIMIT = 150;
const UNDECIDED_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_CONTROL = "no-store";

export type SecurityQueueProject = {
  projectId: string;
  /** Verified reports with no decision yet. */
  open: number;
  /** Open reports that may be analyzed and have no attempt for their version. */
  withoutAnalysis: number;
  /** Open reports whose latest attempt failed, was unavailable, or was lost. */
  analysisFailed: number;
  /** Open reports received more than seven days ago. */
  undecidedOver7Days: number;
  oldestOpenAt: string;
};

type OpenRow = {
  id: string;
  project_id: string;
  created_at: string;
  analyzable: number;
  attempts: number;
  latest_state: AttemptState | null;
  latest_started_at: string | null;
};

/**
 * Every open report, oldest first, with its analysis attempts for the
 * current report version. A report with no intake row (linked from GitHub)
 * has no report version; its attempts carry none either. `analyzable` is the
 * owner's Analyze rule in `analysisMayStart`: no intake row, or an intake
 * forwarded by its reviewer or screened legitimate with no review.
 */
const OPEN_REPORTS_QUERY = `
SELECT c.id, c.project_id, c.created_at,
  (i.case_id IS NULL OR i.review_decision = 'forward'
    OR (i.review_decision IS NULL AND i.screening_state = 'legitimate')) AS analyzable,
  (SELECT COUNT(*) FROM security_case_analyses a
    WHERE a.case_id = c.id AND a.report_version IS i.report_version) AS attempts,
  (SELECT a.state FROM security_case_analyses a
    WHERE a.case_id = c.id AND a.report_version IS i.report_version
    ORDER BY a.attempt DESC LIMIT 1) AS latest_state,
  (SELECT a.started_at FROM security_case_analyses a
    WHERE a.case_id = c.id AND a.report_version IS i.report_version
    ORDER BY a.attempt DESC LIMIT 1) AS latest_started_at
FROM security_cases c
LEFT JOIN security_submission_intake i ON i.case_id = c.id
WHERE c.submission_state = 'verified'
  AND c.receipt_state IN (${OPEN_RECEIPT_STATES.map((state) => `'${state}'`).join(", ")})
  AND NOT ${depositHeldSql("c.id")}
ORDER BY c.created_at, c.id`;

async function openReports(db: Database): Promise<OpenRow[]> {
  return (await db.prepare(OPEN_REPORTS_QUERY).all<OpenRow>()).results ?? [];
}

/** The latest attempt ended without an answer, or was lost while running. */
function failedAttempt(row: OpenRow, now: Date): boolean {
  return (
    row.latest_state !== null &&
    row.latest_started_at !== null &&
    retryable(
      { state: row.latest_state, started_at: row.latest_started_at },
      now,
    )
  );
}

/** Whether the operator job may start an attempt on this report now. */
function retryEligible(row: OpenRow, now: Date): boolean {
  if (row.analyzable !== 1) return false;
  if (row.latest_state === null) return true;
  if (!failedAttempt(row, now)) return false;
  if (row.attempts >= RETRY_ATTEMPT_LIMIT) return false;
  const started = Date.parse(row.latest_started_at ?? "");
  return Number.isFinite(started) && now.getTime() - started > RETRY_SPACING_MS;
}

/** Per-project counts of open reports. Aggregates only. */
export async function readSecurityQueue(
  db: Database,
  now: Date,
): Promise<SecurityQueueProject[]> {
  const projects = new Map<string, SecurityQueueProject>();
  for (const row of await openReports(db)) {
    let entry = projects.get(row.project_id);
    if (!entry) {
      // Rows come oldest first, so the first one per project is its oldest.
      entry = {
        projectId: row.project_id,
        open: 0,
        withoutAnalysis: 0,
        analysisFailed: 0,
        undecidedOver7Days: 0,
        oldestOpenAt: row.created_at,
      };
      projects.set(row.project_id, entry);
    }
    entry.open += 1;
    if (row.analyzable === 1 && row.latest_state === null)
      entry.withoutAnalysis += 1;
    if (row.analyzable === 1 && failedAttempt(row, now))
      entry.analysisFailed += 1;
    if (now.getTime() - Date.parse(row.created_at) > UNDECIDED_AFTER_MS)
      entry.undecidedOver7Days += 1;
  }
  return [...projects.values()].sort((a, b) =>
    a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0,
  );
}

type AttemptState = "running" | "complete" | "failed" | "unavailable";

export type SecurityQueueRun =
  | {
      ran: true;
      state: AttemptState;
      remainingEligible: number;
    }
  | { ran: false; reason: "daily-limit" | "none-eligible" | "not-started" };

function utcDayStart(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

async function latestAttempt(db: Database, caseId: string): Promise<number> {
  const row = await db
    .prepare(
      "SELECT MAX(attempt) AS attempt FROM security_case_analyses WHERE case_id = ?",
    )
    .bind(caseId)
    .first<{ attempt: number | null }>();
  return row?.attempt ?? 0;
}

/**
 * Runs at most one analysis: the oldest open report the owner's Analyze
 * would accept, within the attempt, spacing and daily limits. The attempt
 * row's primary key already makes a concurrent claim of the same attempt
 * fail; the 30-minute spacing also keeps a second caller off a report whose
 * attempt is still running.
 */
export async function runSecurityQueueRetry(
  analysis: AnalysisDependencies,
): Promise<SecurityQueueRun> {
  const now = analysis.now();
  const started = await analysis.db
    .prepare(
      "SELECT COUNT(*) AS n FROM security_case_analyses WHERE started_at >= ?",
    )
    .bind(utcDayStart(now))
    .first<{ n: number }>();
  if ((started?.n ?? 0) >= DAILY_ATTEMPT_LIMIT)
    return { ran: false, reason: "daily-limit" };
  for (const row of await openReports(analysis.db)) {
    if (!retryEligible(row, now)) continue;
    // The same checks as the owner's Analyze, read again just before it runs.
    if (await depositHeld(analysis, row.id)) continue;
    if (!(await analysisMayStart(analysis, row.id))) continue;
    const before = await latestAttempt(analysis.db, row.id);
    await runCaseAnalysis(analysis, row.id, null, ANALYSIS_TIMEOUT_MS);
    const attempt = await analysis.db
      .prepare(
        "SELECT state FROM security_case_analyses WHERE case_id = ? AND attempt > ? ORDER BY attempt LIMIT 1",
      )
      .bind(row.id, before)
      .first<{ state: AttemptState }>();
    if (attempt === null) return { ran: false, reason: "not-started" };
    const after = analysis.now();
    const remaining = (await openReports(analysis.db)).filter((entry) =>
      retryEligible(entry, after),
    ).length;
    return {
      ran: true,
      state: attempt.state,
      remainingEligible: remaining,
    };
  }
  return { ran: false, reason: "none-eligible" };
}

/**
 * `GET` and `POST /api/v1/operator/security-queue`. Null means "not this
 * route": the path differs, the secret is unset, or the token is missing or
 * wrong.
 */
export async function handleSecurityQueue(
  request: Request,
  deps: {
    /** The Pages secret `OPERATOR_FEED_TOKEN`; unset closes the route. */
    token: string | undefined;
    /** The same dependencies as the owner's Analyze. */
    analysis: AnalysisDependencies;
  },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.pathname !== SECURITY_QUEUE_PATH &&
    url.pathname !== `${SECURITY_QUEUE_PATH}/`
  )
    return null;
  if (!bearerTokenAuthorized(request, deps.token)) return null;
  try {
    if (request.method === "GET" || request.method === "HEAD")
      return json(
        200,
        {
          schema: SECURITY_QUEUE_SCHEMA,
          generatedAt: deps.analysis.now().toISOString(),
          projects: await readSecurityQueue(
            deps.analysis.db,
            deps.analysis.now(),
          ),
        },
        { cacheControl: CACHE_CONTROL },
      );
    if (request.method === "POST")
      return json(200, await runSecurityQueueRetry(deps.analysis), {
        cacheControl: CACHE_CONTROL,
      });
    return json(
      405,
      { error: "method_not_allowed" },
      { cacheControl: CACHE_CONTROL },
    );
  } catch (caught) {
    return apiErrorResponse(caught, { label: "security queue failure" });
  }
}
