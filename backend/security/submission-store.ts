/** Private report submission rows and their compare-and-set transitions (SEC-07, SEC-16). */
import type { D1QueryStatement as D1Statement } from "../d1";
import { PARTICIPATION_BAN_QUERY } from "../projects/account-bans";
import type { SecurityApiDependencies } from "./case-store";
import type { FailureCode } from "./github-advisories";
import type { IntakeScreeningState } from "./verified-intake";

type SubmissionState =
  | "draft"
  | "submitting"
  | "uncertain"
  | "submitted"
  | "receipt-verified"
  | "failed"
  | "abandoned";

export type SubmissionRow = {
  id: string;
  project_id: string;
  repository: string;
  reporter_github_id: string;
  reporter_github_login: string;
  origin: "slop" | "direct";
  idempotency_key: string;
  marker: string;
  state: SubmissionState;
  attempt: number;
  attempt_started_at: string | null;
  advisory_ghsa: string | null;
  github_created_at: string | null;
  evidence_digest: string | null;
  failure_code: FailureCode | null;
  case_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

export const SUBMISSION_ID = /^ss_[A-Za-z0-9_-]{8,72}$/u;

/** A `submitting` row older than this is treated as interrupted. */
const SUBMITTING_TIMEOUT_MS = 60_000;

/** A draft or failed submission idle this long is abandoned. */
const IDLE_MS = 24 * 60 * 60 * 1000;

/**
 * An empty listing reopens an uncertain send only this long after the
 * attempt began: well past the 10 second request timeout and GitHub's
 * listing lag, so a send that was cut off but still lands is found first.
 */
export const RECONCILE_QUIET_MS = 5 * 60 * 1000;

/**
 * A `submitted` row GitHub has not let Slop verify for this long fails as
 * `unverifiable`, so it no longer blocks a new submission for the program.
 */
export const SUBMITTED_LIMIT_MS = 24 * 60 * 60 * 1000;

/** The reporter's view: state and identifiers, never report content. */
export function submissionView(row: SubmissionRow): Record<string, unknown> {
  return {
    id: row.id,
    projectId: row.project_id,
    repository: row.repository,
    origin: row.origin,
    state: row.state,
    revision: row.revision,
    attempt: row.attempt,
    advisory:
      row.advisory_ghsa === null
        ? null
        : {
            ghsa: row.advisory_ghsa,
            url: `https://github.com/${row.repository}/security/advisories/${row.advisory_ghsa}`,
          },
    githubCreatedAt: row.github_created_at,
    failureCode: row.failure_code,
    caseId: row.case_id,
    retryAllowed: row.state === "draft" && row.attempt > 0,
    // An empty listing before this time keeps the send uncertain.
    reconcileAfter:
      row.state === "uncertain" &&
      row.advisory_ghsa === null &&
      row.attempt_started_at !== null
        ? new Date(
            Date.parse(row.attempt_started_at) + RECONCILE_QUIET_MS,
          ).toISOString()
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const COLUMNS =
  "id, project_id, repository, reporter_github_id, reporter_github_login, origin, idempotency_key, marker, state, attempt, attempt_started_at, advisory_ghsa, github_created_at, evidence_digest, failure_code, case_id, revision, created_at, updated_at";

export async function loadSubmission(
  deps: SecurityApiDependencies,
  id: string,
): Promise<SubmissionRow | null> {
  if (!SUBMISSION_ID.test(id)) return null;
  return deps.db
    .prepare(`SELECT ${COLUMNS} FROM security_submissions WHERE id = ?`)
    .bind(id)
    .first<SubmissionRow>();
}

type Transition = {
  state: SubmissionState;
  set?: Partial<
    Pick<
      SubmissionRow,
      | "attempt"
      | "attempt_started_at"
      | "advisory_ghsa"
      | "github_created_at"
      | "evidence_digest"
      | "failure_code"
      | "case_id"
    >
  >;
  kind: string;
  detail?: Record<string, unknown>;
  actorGithubId: string | null;
  guard?: { sql: string; values: unknown[] };
};

/**
 * One compare-and-set transition: the row moves only from the exact state
 * and revision that was read, and its event lands at the next revision in
 * the same batch. `before` statements run first in the batch.
 */
export function transitionStatements(
  deps: SecurityApiDependencies,
  row: SubmissionRow,
  next: Transition,
  at: string,
): D1Statement[] {
  const set: Record<string, unknown> = {
    ...(next.state === "failed" ? {} : { failure_code: null }),
    ...next.set,
  };
  const columns = Object.keys(set);
  return [
    deps.db
      .prepare(
        `UPDATE security_submissions SET state = ?, ${columns
          .map((column) => `${column} = ?, `)
          .join(
            "",
          )}revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND state = ?${next.kind === "send" ? ` AND NOT EXISTS (${PARTICIPATION_BAN_QUERY})` : ""}${next.guard ? ` AND (${next.guard.sql})` : ""}`,
      )
      .bind(
        next.state,
        ...columns.map((column) => set[column]),
        at,
        row.id,
        row.revision,
        row.state,
        ...(next.kind === "send" ? [row.reporter_github_id] : []),
        ...(next.guard?.values ?? []),
      ),
    deps.db
      .prepare(
        "INSERT INTO security_submission_events (submission_id, revision, kind, detail, actor_github_id, at) SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT revision FROM security_submissions WHERE id = ?) = ? AND (SELECT state FROM security_submissions WHERE id = ?) = ?",
      )
      .bind(
        row.id,
        row.revision + 1,
        next.kind,
        next.detail === undefined ? null : JSON.stringify(next.detail),
        next.actorGithubId,
        at,
        row.id,
        row.revision + 1,
        row.id,
        next.state,
      ),
  ];
}

/** Commits a transition; returns only its exact row, or null when it was stale. */
export async function transition(
  deps: SecurityApiDependencies,
  row: SubmissionRow,
  next: Transition,
): Promise<SubmissionRow | null> {
  let results: Awaited<ReturnType<typeof deps.db.batch>>;
  try {
    results = await deps.db.batch(
      transitionStatements(deps, row, next, deps.now().toISOString()),
    );
  } catch (error) {
    // A concurrent writer took this revision: the batch rolled back whole.
    if (
      error instanceof Error &&
      /UNIQUE/iu.test(error.message) &&
      /security_submission_events/iu.test(error.message)
    )
      return null;
    throw error;
  }
  if ((results[0]?.meta?.changes ?? 0) !== 1) return null;
  const updated = await loadSubmission(deps, row.id);
  // A later transition may win while this readback waits. Its revision is not
  // this caller's authority, especially when the caller is about to send.
  return updated?.revision === row.revision + 1 && updated.state === next.state
    ? updated
    : null;
}

/**
 * Applies time-based moves before any decision: an interrupted send becomes
 * `uncertain` and is never resent, a `submitted` row GitHub never let Slop
 * verify fails as `unverifiable` (it holds a GitHub advisory, so it is never
 * resent), and an idle draft or failure is abandoned. A verified receipt
 * awaiting a current triager remains recoverable with fresh reporter consent.
 */
export async function settle(
  deps: SecurityApiDependencies,
  row: SubmissionRow,
): Promise<SubmissionRow> {
  const now = deps.now().getTime();
  // A saved Slop report and its receipt do not expire with an optional GitHub
  // draft. Only an idle draft or failure can expire, so only it needs the read.
  if (
    (row.state === "draft" || row.state === "failed") &&
    now - Date.parse(row.updated_at) > IDLE_MS &&
    (await storedIntake(deps, row.id))
  )
    return row;
  let next: Transition | null = null;
  if (
    row.state === "submitting" &&
    row.attempt_started_at !== null &&
    now - Date.parse(row.attempt_started_at) > SUBMITTING_TIMEOUT_MS
  )
    next = { state: "uncertain", kind: "interrupted", actorGithubId: null };
  else if (
    row.state === "submitted" &&
    now - Date.parse(row.attempt_started_at ?? row.updated_at) >
      SUBMITTED_LIMIT_MS
  )
    next = {
      state: "failed",
      set: { failure_code: "unverifiable" },
      kind: "verify-expired",
      detail: { code: "unverifiable" },
      actorGithubId: null,
    };
  else if (
    (row.state === "draft" || row.state === "failed") &&
    now - Date.parse(row.updated_at) > IDLE_MS
  )
    next = { state: "abandoned", kind: "abandoned", actorGithubId: null };
  if (next === null) return row;
  if (
    (row.state === "submitted" || row.state === "draft") &&
    row.advisory_ghsa !== null &&
    (await deps.db
      .prepare(
        "SELECT 1 AS verified FROM security_submission_events WHERE submission_id = ? AND revision <= ? AND kind = 'contacts-unavailable' LIMIT 1",
      )
      .bind(row.id, row.revision)
      .first()) !== null
  )
    // This event is written only after GitHub receipt identity checks pass.
    // Missing routing contacts do not make that delivered report unverifiable.
    return row;
  return (
    (await transition(deps, row, next)) ??
    ((await loadSubmission(deps, row.id)) as SubmissionRow)
  );
}

export type IntakeState = IntakeScreeningState;

export type StoredIntake = {
  submission_id: string;
  case_id: string;
  received_at: string;
  report_version: number;
  screening_state: IntakeState;
  screening_started_at: string | null;
  screening_finished_at: string | null;
  screening_reason: string | null;
  routed_at: string | null;
  screening_provider: string | null;
  screening_model: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_decision: "forward" | "request-information" | null;
  review_reason: string | null;
  revision: number;
};

export async function storedIntake(
  deps: Pick<SecurityApiDependencies, "db">,
  id: string,
): Promise<StoredIntake | null> {
  return deps.db
    .prepare("SELECT * FROM security_submission_intake WHERE submission_id = ?")
    .bind(id)
    .first<StoredIntake>();
}
