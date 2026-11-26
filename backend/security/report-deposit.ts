/**
 * The refundable SLOP deposit on a private security report (operator
 * decision, 21 November 2026; PRD section 8, "Report deposit").
 *
 * This module asks, releases and decides. It moves no money and holds no
 * key: the submission-fee Worker records the payment and signs the refund or
 * the burn that a row here says is due.
 *
 * Ask. When a report is accepted, one row is written in the same batch as
 * its case, with the SLOP amount fixed at that moment. `live` writes `asked`;
 * `dry_run` writes `recorded`, which asks nobody and holds nothing. Nobody is
 * asked while no SLOP rate is in force, when the project turned the deposit
 * off, or when the reporter is the project's owner, a maintainer, a Slop
 * moderator or an admin. A case that exists already can never get a row: the
 * insert requires the case to have been created at the ask instant.
 *
 * Hold. An `asked` row with no payment and no outcome holds the report
 * (`report-deposit-hold.ts`). Screening, the owner's notice, the owner's
 * lists, the routine pass and GitHub forwarding all check that one
 * condition.
 *
 * Release. A bounded sweep behind security API requests starts the held
 * work of a report whose deposit was recorded, and turns unpaid `asked` rows
 * back into `recorded` when the server mode is not `live` or the project
 * turned the deposit off.
 *
 * Outcome. The same sweep sets `refund_due` or `kept_due` on a paid row from
 * the report's stored state (`reportDepositOutcome`). Only a close recorded
 * by the routine pass's published rules or by a person keeps a deposit; a
 * model's screening verdict never does.
 */
import type { GithubActor as Actor } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import {
  REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS,
  REPORT_DEPOSIT_REFUND_SILENT_DAYS,
  reportDepositAmount,
  reportDepositItem,
  reportDepositOn,
} from "../../src/lib/security-report-deposit.mjs";
import { slopRatesAt } from "../../src/lib/submission-fee.mjs";
import type { D1QueryStatement as D1Statement } from "../d1";
import { chunked } from "../http";
import { notifySecurityCase } from "../notifications/events";
import { readRepositoryAccess, setupAuthority } from "../projects/setup";
import {
  currentReportingProject,
  reportingContext,
  type SecurityApiDependencies,
} from "./case-store";
import { reportingAuthorityUnavailable } from "./project-access";
import { depositHeldSql } from "./report-deposit-hold";
import { ROUTINE_ACTOR, ROUTINE_PROOF_NEXT_ACTION } from "./routine-decisions";

export type ReportDepositMode = "off" | "dry_run" | "live";

/** Anything but an exact `dry_run` or `live` is off. */
export function reportDepositMode(
  value: string | undefined,
): ReportDepositMode {
  return value === "dry_run" || value === "live" ? value : "off";
}

type DepositDependencies = Pick<
  SecurityApiDependencies,
  | "db"
  | "now"
  | "moderatorGithubIds"
  | "repositoryAccess"
  | "reportDeposit"
  | "reportingProjects"
>;

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Reports whose held work one sweep starts. A sweep runs after a response,
 * where the platform stops work after about 30 seconds, and each start is a
 * model call, so the number stays small; the next sweep takes the next ones.
 */
const RELEASE_LIMIT = 3;
/** Paid deposits one sweep reads for an outcome. */
const OUTCOME_LIMIT = 500;

/** The SLOP rate in force now, or null. */
async function rateInForce(
  deps: Pick<DepositDependencies, "db">,
  at: string,
): Promise<string | null> {
  const { results } = await deps.db
    .prepare(
      "SELECT effective_at, slop_per_usd FROM submission_fee_rates ORDER BY effective_at",
    )
    .all<{ effective_at: string; slop_per_usd: string }>();
  return (
    slopRatesAt(
      results.map((row) => ({
        effectiveAt: row.effective_at,
        slopPerUsd: row.slop_per_usd,
      })),
      at,
    ).current?.slopPerUsd ?? null
  );
}

/**
 * Whether the reporter is never asked on this project: a Slop moderator or
 * admin, the project's steward, a named security approver, an account that
 * published a revision of the project or applied for it, or an account with
 * current write, maintain or admin access to its repository. When GitHub
 * cannot be read, the last check counts as no access: the registry's own
 * owners stay exempt, and anyone else is asked.
 */
export async function reportDepositExempt(
  deps: DepositDependencies,
  manifest: ProjectDefinition,
  actor: Actor,
): Promise<boolean> {
  if (
    deps.moderatorGithubIds?.has(actor.githubId) ||
    deps.reportDeposit?.adminGithubIds.has(actor.githubId)
  )
    return true;
  const steward = manifest.steward.github;
  if (steward.type === "User" && steward.actorId === actor.githubId)
    return true;
  const program = manifest.securityBounty;
  if (
    program &&
    [
      ...program.approvers.technical,
      ...program.approvers.financial,
      ...program.approvers.dispute,
    ].some((entry) => entry.githubId === actor.githubId)
  )
    return true;
  const registry = await deps.db
    .prepare(
      "SELECT 1 AS found WHERE EXISTS (SELECT 1 FROM project_revisions WHERE project_id = ?1 AND actor_github_id = ?2) OR EXISTS (SELECT 1 FROM projects p JOIN project_applications a ON a.id = p.source_application_id WHERE p.id = ?1 AND a.applicant_github_id = ?2)",
    )
    .bind(manifest.id, actor.githubId)
    .first<{ found: number }>();
  if (registry !== null) return true;
  const access = await readRepositoryAccess(
    deps.repositoryAccess,
    manifest,
    actor,
  );
  return (
    setupAuthority(access, actor, manifest.repositories[0]).state === "verified"
  );
}

/**
 * The deposit row of a case being created now, or nothing. The statement
 * belongs in the batch that inserts the case: it writes only when that case
 * exists with `created_at` equal to `at`, so a case from any earlier moment
 * can never be asked, and a case that already has a row is never asked
 * again.
 */
export async function reportDepositAsk(
  deps: DepositDependencies,
  input: { caseId: string; projectId: string; reporter: Actor; at: string },
): Promise<D1Statement[]> {
  try {
    return await depositAsk(deps, input);
  } catch (error) {
    // The report is accepted and stored whatever happens here: a failed
    // read of the rate or the project asks nobody. Never log the report.
    console.error(
      "security report deposit ask failed",
      error instanceof Error ? error.name : "unknown",
    );
    return [];
  }
}

async function depositAsk(
  deps: DepositDependencies,
  input: { caseId: string; projectId: string; reporter: Actor; at: string },
): Promise<D1Statement[]> {
  const mode = deps.reportDeposit?.mode ?? "off";
  if (mode === "off") return [];
  const project = await currentReportingProject(deps, input.projectId);
  if (project === null || !reportDepositOn(project.manifest)) return [];
  const rate = await rateInForce(deps, input.at);
  // No rate in force: nobody is asked and the report proceeds as today.
  if (rate === null) return [];
  if (await reportDepositExempt(deps, project.manifest, input.reporter))
    return [];
  const amount = reportDepositAmount(rate);
  if (amount === null) return [];
  return [
    deps.db
      .prepare(
        `INSERT INTO security_report_deposits (case_id, project_id, item, mode, slop_amount, slop_per_usd, asked_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
          WHERE EXISTS (SELECT 1 FROM security_cases c
                         WHERE c.id = ?1 AND c.project_id = ?2 AND c.created_at = ?7)
            AND NOT EXISTS (SELECT 1 FROM security_report_deposits d WHERE d.case_id = ?1)`,
      )
      .bind(
        input.caseId,
        input.projectId,
        reportDepositItem(input.caseId),
        mode === "live" ? "asked" : "recorded",
        amount,
        rate,
        input.at,
      ),
  ];
}

export type ReportDepositReason =
  | "responded"
  | "silent"
  | "turned-off"
  | "spam"
  | "duplicate"
  | "out-of-scope";

/** Everything the outcome of one paid deposit is decided from. */
export type ReportDepositFacts = {
  /** The server switch now. */
  mode: ReportDepositMode;
  /** The project still has the deposit on. */
  projectOn: boolean;
  paidAt: string;
  /** `security_cases.receipt_state`. */
  receiptState: string;
  /** `security_cases.appeal_state`: none, open, upheld or returned. */
  appealState: string;
  /** The open request for proof is the routine pass's own, with its clock. */
  routineRequest: boolean;
  /** A maintainer approved the saved report for routing. */
  routedByMaintainer: boolean;
  /** The reporter added a version after a person's latest request. */
  requestAnswered: boolean;
  /** When the latest `decide` or `decide-appeal` event was recorded. */
  closedAt: string | null;
  /** The latest `decide` event was a person's and marks the report as spam. */
  spamByPerson: boolean;
};

/**
 * The outcome of a paid deposit, or null while it waits (PRD section 8).
 *
 * Sent back: the server mode is not `live` or the project turned the deposit
 * off; the report got a first response that is not a keeping close
 * (acknowledged or in triage, accepted, a person's request the reporter
 * answered, a maintainer's routing approval, or a rejection that is not
 * marked spam, which includes "no proof received"); or 14 days passed after
 * payment with the report still unanswered.
 *
 * Kept: the report is closed as a duplicate (`duplicate`), as out of scope
 * (`out-of-scope`), or rejected by a person who marked it spam, the latest
 * decision on it is 7 days old, and no appeal is open. An open appeal
 * (`disputed`) and a report an appeal returned to the owner (`triaging` with
 * `appeal_state = 'returned'`) wait for the final decision.
 */
export function reportDepositOutcome(
  facts: ReportDepositFacts,
  now: Date,
): { outcome: "refund_due" | "kept_due"; reason: ReportDepositReason } | null {
  const refund = (reason: ReportDepositReason) => ({
    outcome: "refund_due" as const,
    reason,
  });
  if (facts.mode !== "live" || !facts.projectOn) return refund("turned-off");
  const stood = (reason: ReportDepositReason) => {
    if (facts.appealState === "open" || facts.closedAt === null) return null;
    const closed = Date.parse(facts.closedAt);
    if (!Number.isFinite(closed)) return null;
    return now.getTime() >=
      closed + REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS * DAY_MS
      ? { outcome: "kept_due" as const, reason }
      : null;
  };
  switch (facts.receiptState) {
    case "received": {
      if (facts.routedByMaintainer) return refund("responded");
      const paid = Date.parse(facts.paidAt);
      return Number.isFinite(paid) &&
        now.getTime() >= paid + REPORT_DEPOSIT_REFUND_SILENT_DAYS * DAY_MS
        ? refund("silent")
        : null;
    }
    case "needs-information":
      // The routine request closes by its own clock or is read again when a
      // new version arrives; its result decides. A person's request counts
      // once the reporter answered it.
      return !facts.routineRequest && facts.requestAnswered
        ? refund("responded")
        : null;
    case "triaging":
      // A returned appeal waits for the owner's final decision.
      return facts.appealState === "returned" ? null : refund("responded");
    case "confirmed":
      return refund("responded");
    case "duplicate":
      return stood("duplicate");
    case "out-of-scope":
      return stood("out-of-scope");
    case "rejected":
      // "No proof received" and every other rejection is sent back. Only a
      // person's rejection marked spam keeps the deposit.
      return facts.spamByPerson ? stood("spam") : refund("responded");
    default:
      // `disputed`: an appeal is open.
      return null;
  }
}

type OutcomeRow = {
  case_id: string;
  project_id: string;
  paid_at: string;
  receipt_state: string;
  appeal_state: string;
  next_action: string | null;
  case_revision: number;
  project_off: number | null;
  review_decision: string | null;
  closed_at: string | null;
  decide_actor: string | null;
  decide_detail: string | null;
  request_revision: number | null;
  revised_revision: number | null;
};

function factsOf(row: OutcomeRow, mode: ReportDepositMode): ReportDepositFacts {
  let spam = false;
  if (row.decide_detail !== null && row.decide_actor !== null)
    try {
      spam =
        row.decide_actor !== ROUTINE_ACTOR.githubId &&
        (JSON.parse(row.decide_detail) as { spam?: unknown }).spam === true;
    } catch {
      spam = false;
    }
  return {
    mode,
    projectOn: row.project_off !== 1,
    paidAt: row.paid_at,
    receiptState: row.receipt_state,
    appealState: row.appeal_state,
    routineRequest: row.next_action === ROUTINE_PROOF_NEXT_ACTION,
    routedByMaintainer: row.review_decision === "forward",
    requestAnswered:
      row.request_revision !== null &&
      row.revised_revision !== null &&
      row.revised_revision > row.request_revision,
    closedAt: row.closed_at,
    spamByPerson: spam,
  };
}

/**
 * Sets `refund_due` or `kept_due` on paid deposits whose report's stored
 * state decides it. A kept outcome is written only while the case is still
 * at the revision that was read, so a concurrent appeal always wins.
 */
async function decideOutcomes(
  deps: DepositDependencies,
  mode: ReportDepositMode,
  now: Date,
): Promise<number> {
  const { results } = await deps.db
    .prepare(
      `SELECT d.case_id, d.project_id, d.paid_at, c.receipt_state, c.appeal_state,
              c.next_action, c.revision AS case_revision,
              (SELECT json_extract(p.manifest, '$.security.reportDeposit') = 0
                 FROM projects p WHERE p.id = d.project_id) AS project_off,
              (SELECT i.review_decision FROM security_submission_intake i
                WHERE i.case_id = d.case_id) AS review_decision,
              (SELECT e.at FROM security_case_events e
                WHERE e.case_id = d.case_id AND e.kind IN ('decide', 'decide-appeal')
                ORDER BY e.case_revision DESC LIMIT 1) AS closed_at,
              (SELECT e.actor_github_id FROM security_case_events e
                WHERE e.case_id = d.case_id AND e.kind = 'decide'
                ORDER BY e.case_revision DESC LIMIT 1) AS decide_actor,
              (SELECT e.detail FROM security_case_events e
                WHERE e.case_id = d.case_id AND e.kind = 'decide'
                ORDER BY e.case_revision DESC LIMIT 1) AS decide_detail,
              (SELECT MAX(e.case_revision) FROM security_case_events e
                WHERE e.case_id = d.case_id AND e.kind = 'request-information'
                  AND e.actor_github_id <> ?1) AS request_revision,
              (SELECT MAX(e.case_revision) FROM security_case_events e
                WHERE e.case_id = d.case_id AND e.kind = 'report-revised') AS revised_revision
         FROM security_report_deposits d
         JOIN security_cases c ON c.id = d.case_id
        WHERE d.mode = 'asked' AND d.paid_at IS NOT NULL AND d.outcome IS NULL
        ORDER BY d.paid_at ASC, d.case_id ASC LIMIT ?2`,
    )
    .bind(ROUTINE_ACTOR.githubId, OUTCOME_LIMIT)
    .all<OutcomeRow>();
  const at = now.toISOString();
  let decided = 0;
  for (const row of results) {
    const result = reportDepositOutcome(factsOf(row, mode), now);
    if (result === null) continue;
    const written = await deps.db
      .prepare(
        `UPDATE security_report_deposits SET outcome = ?1, outcome_reason = ?2, outcome_at = ?3
          WHERE case_id = ?4 AND mode = 'asked' AND paid_at IS NOT NULL AND outcome IS NULL
            AND (?1 = 'refund_due' OR EXISTS (
              SELECT 1 FROM security_cases c
               WHERE c.id = ?4 AND c.revision = ?5 AND c.receipt_state = ?6
                 AND c.appeal_state <> 'open'))`,
      )
      .bind(
        result.outcome,
        result.reason,
        at,
        row.case_id,
        row.case_revision,
        row.receipt_state,
      )
      .run();
    decided += written.meta?.changes ?? 0;
  }
  return decided;
}

/**
 * Turns unpaid asks back into `recorded` rows, which hold nothing: every one
 * of them when the server mode is not `live`, and otherwise those of a
 * project whose owner turned the deposit off. The row keeps the reason
 * `turned-off` and the time, with no outcome, so a released ask stays
 * distinguishable from a row that record-only mode wrote. A row the Worker
 * marked paid in the same moment keeps `asked` and is sent back by the
 * outcome rule.
 */
async function releaseUnpaid(
  deps: DepositDependencies,
  mode: ReportDepositMode,
  now: Date,
): Promise<number> {
  const released = await deps.db
    .prepare(
      `UPDATE security_report_deposits
          SET mode = 'recorded', outcome_reason = 'turned-off', outcome_at = ?2
        WHERE mode = 'asked' AND paid_at IS NULL AND outcome IS NULL
          AND (?1 <> 'live' OR project_id IN (
            SELECT p.id FROM projects p
             WHERE json_extract(p.manifest, '$.security.reportDeposit') = 0))`,
    )
    .bind(mode, now.toISOString())
    .run();
  return released.meta?.changes ?? 0;
}

export type ReportDepositWork = {
  /** Starts the screening of a saved report. */
  screen(submissionId: string): Promise<void>;
  /** Starts the private analysis of a report that lives on GitHub. */
  analyze(caseId: string): Promise<void>;
};

/**
 * Starts the work a deposit held back, once the row no longer holds: the
 * screening of a saved report still `queued`, or the owner's notice and the
 * analysis of a report linked from GitHub that has neither yet. Each start
 * is safe to repeat: screening claims its intake revision, the analysis
 * claims its attempt, and the notice is keyed by the case event.
 *
 * Only a paid ask and a released ask are looked at. A row that record-only
 * mode wrote is never touched: that report proceeds exactly as it would
 * without a deposit.
 */
async function startReleasedWork(
  deps: DepositDependencies,
  work: ReportDepositWork,
): Promise<number> {
  const ready =
    "(d.paid_at IS NOT NULL OR (d.mode = 'recorded' AND d.outcome_reason = 'turned-off'))";
  const saved = await deps.db
    .prepare(
      `SELECT i.submission_id FROM security_report_deposits d
         JOIN security_submission_intake i ON i.case_id = d.case_id
        WHERE ${ready} AND NOT ${depositHeldSql("d.case_id")}
          AND i.screening_state = 'queued' AND i.review_decision IS NULL
        ORDER BY d.asked_at ASC, d.case_id ASC LIMIT ?1`,
    )
    .bind(RELEASE_LIMIT)
    .all<{ submission_id: string }>();
  const linked = await deps.db
    .prepare(
      `SELECT c.id, c.project_id, c.reporter_github_id FROM security_report_deposits d
         JOIN security_cases c ON c.id = d.case_id
        WHERE ${ready} AND NOT ${depositHeldSql("d.case_id")}
          AND c.submission_state = 'verified' AND c.receipt_state = 'received'
          AND NOT EXISTS (SELECT 1 FROM security_submission_intake i WHERE i.case_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM security_case_analyses a WHERE a.case_id = c.id)
        ORDER BY d.asked_at ASC, d.case_id ASC LIMIT ?1`,
    )
    .bind(RELEASE_LIMIT)
    .all<{ id: string; project_id: string; reporter_github_id: string }>();
  // An older-style link that GitHub has not confirmed yet has no analysis to
  // start, but its owner's notice of the claim waited too. It is tried once:
  // `claim_notice_at` is set after a try that wrote the notice or found
  // nobody to tell (no recipient, or a retired project), so a claim nobody
  // can be told about never takes these slots again. A claim whose try
  // failed, on a GitHub outage or on any other error, keeps waiting, but
  // behind every claim not tried yet and behind claims retried longer ago
  // (`claim_retry_at`), so a failure that lasts cannot hold the slots.
  const claimed = await deps.db
    .prepare(
      `SELECT c.id, c.project_id FROM security_report_deposits d
         JOIN security_cases c ON c.id = d.case_id
        WHERE ${ready} AND NOT ${depositHeldSql("d.case_id")}
          AND c.submission_state = 'claimed' AND d.claim_notice_at IS NULL
        ORDER BY d.claim_retry_at IS NOT NULL, d.claim_retry_at ASC,
                 d.asked_at ASC, d.case_id ASC LIMIT ?1`,
    )
    .bind(RELEASE_LIMIT)
    .all<{ id: string; project_id: string }>();
  let started = 0;
  for (const row of saved.results) {
    await work.screen(row.submission_id);
    started++;
  }
  for (const row of linked.results) {
    await ownerNotice(deps, row.id, row.project_id).catch(() => undefined);
    await work.analyze(row.id);
    started++;
  }
  for (const row of claimed.results) {
    // Only a try that ended is recorded. A failed one leaves the claim for a
    // later sweep; an error that is not a permission-provider outage is
    // logged by name, and never stops the claims after it.
    let failed = false;
    await ownerNotice(deps, row.id, row.project_id).catch((error: unknown) => {
      if (projectRetired(error)) return;
      failed = true;
      if (!reportingAuthorityUnavailable(error))
        console.error(
          "security report deposit claim notice failed",
          error instanceof Error ? error.name : "unknown",
        );
    });
    if (failed) {
      await deps.db
        .prepare(
          "UPDATE security_report_deposits SET claim_retry_at = ?1 WHERE case_id = ?2 AND claim_notice_at IS NULL",
        )
        .bind(deps.now().toISOString(), row.id)
        .run();
      continue;
    }
    await deps.db
      .prepare(
        "UPDATE security_report_deposits SET claim_notice_at = ?1 WHERE case_id = ?2 AND claim_notice_at IS NULL",
      )
      .bind(deps.now().toISOString(), row.id)
      .run();
    started++;
  }
  return started;
}

/** `reportingContext` refuses a retired or unknown project: nobody to tell. */
function projectRetired(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "project_not_found"
  );
}

/**
 * The owner's notice that a held report was withheld: the same Inbox row its
 * receipt would have written, keyed by the case's receipt event, so sending
 * it twice writes one row.
 */
async function ownerNotice(
  deps: DepositDependencies,
  caseId: string,
  projectId: string,
): Promise<void> {
  const event = await deps.db
    .prepare(
      "SELECT case_revision, idempotency_key FROM security_case_events WHERE case_id = ? AND kind IN ('submit', 'submit-direct', 'receive', 'verify-link', 'claim') ORDER BY case_revision DESC LIMIT 1",
    )
    .bind(caseId)
    .first<{ case_revision: number; idempotency_key: string }>();
  if (event === null) return;
  const context = await reportingContext(deps, projectId, true, true);
  const recipients = context.approvers.technical.map((entry) => entry.githubId);
  if (recipients.length === 0) return;
  for (const part of chunked(recipients))
    await notifySecurityCase(deps.db, {
      caseId,
      revision: event.case_revision,
      idempotencyKey: event.idempotency_key,
      recipients: part,
    }).run();
}

export type ReportDepositSweep = {
  released: number;
  decided: number;
  started: number;
};

/**
 * One bounded pass: release unpaid asks that no longer apply, decide paid
 * deposits, then start the work of reports that no longer wait. Safe to
 * repeat and to run concurrently: every write is guarded by the row state
 * it read.
 */
export async function runReportDepositSweep(
  deps: DepositDependencies,
  work: ReportDepositWork,
): Promise<ReportDepositSweep> {
  const mode = deps.reportDeposit?.mode ?? "off";
  const now = deps.now();
  const released = await releaseUnpaid(deps, mode, now);
  const decided = await decideOutcomes(deps, mode, now);
  const started = await startReleasedWork(deps, work);
  return { released, decided, started };
}

/** When this isolate next runs a sweep. Tests reset it. */
export const reportDepositSweep = { nextAt: 0 };
const SWEEP_MS = 30_000;

/**
 * Runs a sweep behind a security API request, at most once every 30 seconds
 * per isolate. A new deployment starts new isolates, so a mode change is
 * applied by the first security API request after it. A failure is logged by
 * name and never reaches the response.
 */
export function sweepReportDeposits(
  deps: DepositDependencies & Pick<SecurityApiDependencies, "waitUntil">,
  work: ReportDepositWork,
): void {
  if (!deps.waitUntil || !deps.reportDeposit) return;
  const now = Date.now();
  if (now < reportDepositSweep.nextAt) return;
  reportDepositSweep.nextAt = now + SWEEP_MS;
  deps.waitUntil(
    runReportDepositSweep(deps, work).catch((error: unknown) =>
      console.error(
        "security report deposit sweep failed",
        error instanceof Error ? error.name : "unknown",
      ),
    ),
  );
}

export type ReportDepositView = {
  state: "needed" | "paid" | "refund_due" | "refunded" | "kept_due" | "kept";
  /** SLOP base units due, fixed when the report was accepted. */
  amount: string;
  payPath: string;
};

type ViewRow = {
  case_id: string;
  slop_amount: string;
  paid_at: string | null;
  outcome: string | null;
};

function viewOf(row: ViewRow): ReportDepositView {
  const state =
    row.outcome === "refunded" ||
    row.outcome === "kept" ||
    row.outcome === "refund_due" ||
    row.outcome === "kept_due"
      ? row.outcome
      : row.paid_at !== null
        ? "paid"
        : "needed";
  return {
    state,
    amount: row.slop_amount,
    payPath: `/fee/report/${row.case_id}`,
  };
}

/** The reporter's deposit state per case; a `recorded` row shows nothing. */
export async function reportDepositViews(
  deps: Pick<SecurityApiDependencies, "db">,
  caseIds: readonly string[],
): Promise<Map<string, ReportDepositView>> {
  const views = new Map<string, ReportDepositView>();
  for (const part of chunked([...new Set(caseIds)])) {
    const rows = await deps.db
      .prepare(
        `SELECT case_id, slop_amount, paid_at, outcome FROM security_report_deposits WHERE mode = 'asked' AND case_id IN (${part
          .map(() => "?")
          .join(",")})`,
      )
      .bind(...part)
      .all<ViewRow>();
    for (const row of rows.results) views.set(row.case_id, viewOf(row));
  }
  return views;
}

export async function reportDepositView(
  deps: Pick<SecurityApiDependencies, "db">,
  caseId: string,
): Promise<ReportDepositView | null> {
  return (await reportDepositViews(deps, [caseId])).get(caseId) ?? null;
}

/** "395 SLOP" for a base-unit amount; a deposit is always whole SLOP. */
export function depositAmountText(baseUnits: string): string {
  const one = 10n ** 18n;
  const value = BigInt(baseUnits);
  const whole = value / one;
  const fraction = (value % one)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/u, "");
  return `${whole}${fraction ? `.${fraction}` : ""} SLOP`;
}
