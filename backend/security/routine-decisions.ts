/**
 * Routine decisions on private security reports (PRD section 8, operator
 * decision of 17 November 2026).
 *
 * A bounded, repeatable pass reads the oldest reports nobody has decided and
 * records one of four results for each:
 *
 * 1. Duplicate: the same bytes as an earlier report in the program, or two
 *    independent model calls name the same earlier report.
 * 2. Does not qualify: two independent model calls name the same published
 *    line and neither finds a plausible theft or permanent freeze of funds.
 * 3. Needs proof: no reproduction steps or runnable proof. The reporter is
 *    asked for it with a 14-day clock; the report closes only when the clock
 *    runs out with no new report version. A report version that carries a
 *    proof-of-concept file always has proof present (operator decision,
 *    20 November 2026), whatever the calls answer.
 * 4. Everything else: acknowledged and ranked for the program owner.
 *
 * It never closes a report when a call finds loss of funds plausible, when a
 * call failed or the calls disagree, when an appeal exists, or when the
 * report is on GitHub, where a maintainer may already be discussing it. It
 * never confirms a finding and never touches an award or a payment.
 *
 * `dry_run` stores the decision the pass would make and changes nothing
 * else. `live` writes the case change, its journal event, the reporter's
 * Inbox notice and the decision record in one batch, guarded by the case
 * revision, so a concurrent human action always wins.
 */
import type { GithubActor as Actor } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { routineClosingExclusions } from "../../src/lib/security-bounty.mjs";
import {
  type D1QueryStatement as D1Statement,
  isConstraintFailure,
} from "../d1";
import { exactKeys, fail, requireActor, requireJsonObject } from "../http";
import { notifySecurityCase } from "../notifications/events";
import {
  ROUTINE_DECISION_PROMPT_REVISION,
  ROUTINE_MISSING_EVIDENCE,
  type SecurityAnalysisReport,
  type SecurityRoutineInput,
  type SecurityRoutineProposal,
} from "./analysis";
import {
  CASE_COLUMNS,
  type CaseRow,
  eventStatement,
  json,
  type SecurityApiDependencies,
} from "./case-store";
import { depositHeldSql } from "./report-deposit-hold";

export type RoutineMode = "off" | "dry_run" | "live";

/** Anything but an exact `dry_run` or `live` is off. */
export function routineMode(value: string | undefined): RoutineMode {
  return value === "dry_run" || value === "live" ? value : "off";
}

/**
 * The journal actor of a routine decision. Case events accept the five human
 * roles only, so the screening agent records as `triager` under this fixed
 * name, which no GitHub account can hold (a GitHub ID is numeric).
 */
export const ROUTINE_ACTOR: Actor = { githubId: "slop", githubLogin: "slop" };
const ROUTINE_ROLE = "triager" as const;

/** Marks a request for proof that the routine pass made, with its clock. */
export const ROUTINE_PROOF_NEXT_ACTION =
  "Add reproduction steps or a runnable proof";
export const ROUTINE_PROOF_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** A report revision that is still being screened waits this long at most. */
const SCREENING_WAIT_MS = 15 * 60 * 1000;
/** A failed model attempt waits before the next one. */
const UNAVAILABLE_RETRY_MS = 6 * 60 * 60 * 1000;
/** After this many failed attempts the report goes to the owner undecided. */
const MAX_UNAVAILABLE_ATTEMPTS = 3;
const EARLIER_REPORT_LIMIT = 25;
const EARLIER_SUMMARY_CHARS = 1200;
/** How many ranked reports lead the owner's list. */
export const ROUTINE_OWNER_LIST_LIMIT = 20;

export type RoutineLimits = {
  /** Candidate cases read per pass. */
  casesPerRun: number;
  /** Cases that may use model calls per pass, and per UTC day. */
  modelCasesPerRun: number;
  modelCasesPerDay: number;
  /** A new pass starts only this long after the previous one began. */
  minIntervalMs: number;
  /** Provider time limit of one call. */
  timeoutMs: number;
};

/**
 * A pass behind an API request runs after the response, where the platform
 * stops work after about 30 seconds: one model-read report per pass.
 */
export const BACKGROUND_ROUTINE_LIMITS: RoutineLimits = {
  casesPerRun: 25,
  modelCasesPerRun: 1,
  modelCasesPerDay: 120,
  minIntervalMs: 3 * 60 * 1000,
  timeoutMs: 22_000,
};

/**
 * A pass an admin starts waits inside the request. Three reports at this
 * time limit end inside the minimum interval, so passes do not overlap.
 */
export const ADMIN_ROUTINE_LIMITS: RoutineLimits = {
  ...BACKGROUND_ROUTINE_LIMITS,
  modelCasesPerRun: 3,
  timeoutMs: 50_000,
};

export type RoutineDependencies = Pick<
  SecurityApiDependencies,
  "db" | "now" | "analyzer"
> & {
  /** The exact retained report version; null when none is stored. */
  readReport(
    caseId: string,
    reportVersion: number,
  ): Promise<SecurityAnalysisReport | null>;
};

type Outcome =
  | "duplicate"
  | "does-not-qualify"
  | "needs-proof"
  | "no-proof-received"
  | "acknowledged"
  | "unavailable";
type Basis = "digest" | "two-calls" | "clock" | "hold";
type HoldReason =
  | "loss-plausible"
  | "calls-disagreed"
  | "analysis-unavailable"
  | "github-advisory"
  | "report-not-stored"
  | "proof-still-missing";
type Severity = SecurityRoutineProposal["severity"];
type Missing = (typeof ROUTINE_MISSING_EVIDENCE)[number];

type Decision = {
  outcome: Outcome;
  basis: Basis;
  holdReason: HoldReason | null;
  exclusionLine: string | null;
  duplicateOf: string | null;
  proofDueAt: string | null;
  lossPlausible: boolean | null;
  severity: Severity | null;
  proofPresent: boolean | null;
  missing: Missing[];
  calls: {
    provider: string;
    model: string;
    promptRevision: string;
    state: "answered" | "failed";
  }[];
};

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  informational: 1,
  unresolved: 0,
};

const MISSING_WORDS: Record<Missing, string> = {
  "reproduction-steps": "reproduction steps",
  "runnable-proof": "a runnable proof (a test, a script or exact commands)",
  "affected-code": "the affected code",
  "source-revision": "the source revision you tested",
};

const APPEAL_SENTENCE =
  "If you think this is wrong, you can appeal once and the project owner will review the report.";

/** The plain reason the reporter reads. Fixed text and published lines only. */
export function routineReason(
  decision: Pick<
    Decision,
    "outcome" | "exclusionLine" | "proofDueAt" | "missing"
  >,
): string {
  switch (decision.outcome) {
    case "duplicate":
      return `Slop's screening closed this report as a duplicate of an earlier report to the same program. Only the first report of a finding is considered. ${APPEAL_SENTENCE}`;
    case "does-not-qualify":
      return `Slop's screening closed this report because it matches the program's published "Does not qualify" list: "${decision.exclusionLine}". ${APPEAL_SENTENCE}`;
    case "needs-proof": {
      const words = decision.missing.map((word) => MISSING_WORDS[word]);
      const missing =
        words.length === 0
          ? "reproduction steps or a runnable proof"
          : words.length === 1
            ? words[0]
            : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
      return `Slop's screening did not find ${missing} in this report. Add this to your saved report by ${decision.proofDueAt?.slice(0, 10)} (UTC). If no new version arrives by then, the report closes as no proof received.`;
    }
    case "no-proof-received":
      return `No new version of this report arrived within 14 days of the request for proof, so it is closed as no proof received. ${APPEAL_SENTENCE}`;
    default:
      return "Slop's screening read this report and passed it to the project owner for review.";
  }
}

type IntakeFacts = {
  submission_id: string;
  report_version: number;
  advisory_ghsa: string | null;
  digest: string | null;
};

type Evaluation = { decision: Decision; reportVersion: number | null };

const held = (
  holdReason: HoldReason,
  rank: Pick<Decision, "lossPlausible" | "severity" | "proofPresent">,
  calls: Decision["calls"] = [],
): Decision => ({
  outcome: "acknowledged",
  basis: "hold",
  holdReason,
  exclusionLine: null,
  duplicateOf: null,
  proofDueAt: null,
  missing: [],
  calls,
  ...rank,
});

/** The stronger of two severity readings, so a ranking never understates. */
function higherSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * Combines two independent answers into one decision. Order matters: a
 * plausible loss of funds stops every close, then a duplicate, then a
 * published line, then missing proof. One call naming what the other does
 * not is a disagreement and goes to the owner.
 */
export function combineRoutineCalls(
  first: SecurityRoutineProposal,
  second: SecurityRoutineProposal,
  context: { now: Date; askedForProofBefore: boolean },
  calls: Decision["calls"],
): Decision {
  const rank = {
    lossPlausible: first.lossOfFundsPlausible || second.lossOfFundsPlausible,
    severity: higherSeverity(first.severity, second.severity),
    proofPresent: first.proof === "present" && second.proof === "present",
  };
  const base = {
    exclusionLine: null,
    duplicateOf: null,
    proofDueAt: null,
    missing: [] as Missing[],
    calls,
    ...rank,
  };
  if (rank.lossPlausible) return held("loss-plausible", rank, calls);
  if (first.duplicateOfCaseId !== null || second.duplicateOfCaseId !== null)
    return first.duplicateOfCaseId === second.duplicateOfCaseId
      ? {
          ...base,
          outcome: "duplicate",
          basis: "two-calls",
          holdReason: null,
          duplicateOf: first.duplicateOfCaseId,
        }
      : held("calls-disagreed", rank, calls);
  if (first.doesNotQualifyLine !== null || second.doesNotQualifyLine !== null)
    return first.doesNotQualifyLine === second.doesNotQualifyLine
      ? {
          ...base,
          outcome: "does-not-qualify",
          basis: "two-calls",
          holdReason: null,
          exclusionLine: first.doesNotQualifyLine,
        }
      : held("calls-disagreed", rank, calls);
  if (first.proof !== second.proof) return held("calls-disagreed", rank, calls);
  if (first.proof === "missing") {
    // One request for proof per report: a revision that still lacks it goes
    // to the owner instead of a second clock.
    if (context.askedForProofBefore)
      return held("proof-still-missing", rank, calls);
    return {
      ...base,
      outcome: "needs-proof",
      basis: "two-calls",
      holdReason: null,
      proofDueAt: new Date(
        context.now.getTime() + ROUTINE_PROOF_WINDOW_MS,
      ).toISOString(),
      missing: ROUTINE_MISSING_EVIDENCE.filter(
        (word) => first.missing.includes(word) || second.missing.includes(word),
      ),
    };
  }
  return {
    ...base,
    outcome: "acknowledged",
    basis: "two-calls",
    holdReason: null,
  };
}

/** The oldest undecided reports this pass may read, in receipt order. */
async function candidates(
  deps: RoutineDependencies,
  mode: "dry_run" | "live",
  now: Date,
  limit: number,
): Promise<CaseRow[]> {
  const result = await deps.db
    .prepare(
      `SELECT ${CASE_COLUMNS} FROM security_cases
        WHERE submission_state = 'verified'
          AND appeal_state = 'none'
          AND award_state NOT IN ('reserved', 'approved')
          AND related_party_review <> 'pending'
          AND NOT ${depositHeldSql("security_cases.id")}
          AND NOT EXISTS (
            SELECT 1 FROM security_case_events e
             WHERE e.case_id = security_cases.id
               AND e.kind IN ('appeal', 'decide-appeal'))
          AND (
            receipt_state = 'received'
            OR (receipt_state = 'needs-information' AND next_action = ?1 AND (
              next_action_due_at <= ?2
              OR EXISTS (
                SELECT 1 FROM security_submission_intake i
                 WHERE i.case_id = security_cases.id
                   AND i.report_version > COALESCE((
                     SELECT d.report_version FROM security_routine_decisions d
                      WHERE d.case_id = security_cases.id
                        AND d.outcome = 'needs-proof' AND d.applied = 1
                      ORDER BY d.id DESC LIMIT 1), 0))))
          )
          AND NOT EXISTS (
            SELECT 1 FROM security_submission_intake i
             WHERE i.case_id = security_cases.id
               AND i.screening_state IN ('queued', 'running')
               AND security_cases.updated_at > ?3)
          AND NOT EXISTS (
            SELECT 1 FROM security_routine_decisions d
             WHERE d.case_id = security_cases.id
               AND d.case_revision = security_cases.revision
               AND d.mode = ?4
               AND (d.outcome <> 'unavailable' OR d.decided_at > ?5))
        ORDER BY received_at ASC, rowid ASC LIMIT ?6`,
    )
    .bind(
      ROUTINE_PROOF_NEXT_ACTION,
      now.toISOString(),
      new Date(now.getTime() - SCREENING_WAIT_MS).toISOString(),
      mode,
      new Date(now.getTime() - UNAVAILABLE_RETRY_MS).toISOString(),
      limit,
    )
    .all<CaseRow>();
  return result.results ?? [];
}

/** The ranking fields of a report that no routine call read. */
async function analysisRank(
  deps: RoutineDependencies,
  caseId: string,
): Promise<Pick<Decision, "lossPlausible" | "severity" | "proofPresent">> {
  const row = await deps.db
    .prepare(
      "SELECT proposed_severity, potential_loss FROM security_case_analyses WHERE case_id = ? AND state = 'complete' ORDER BY attempt DESC LIMIT 1",
    )
    .bind(caseId)
    .first<{
      proposed_severity: Severity | null;
      potential_loss: string | null;
    }>();
  return {
    lossPlausible: row === null ? null : row.potential_loss === "likely",
    severity: row?.proposed_severity ?? null,
    proofPresent: null,
  };
}

/** The earliest earlier case of the program that holds the same report bytes. */
async function earlierSameDigest(
  deps: RoutineDependencies,
  row: CaseRow,
  digest: string,
): Promise<string | null> {
  const match = await deps.db
    .prepare(
      `SELECT c.id FROM security_cases c
        WHERE c.project_id = ?1 AND c.id <> ?2
          AND c.submission_state = 'verified'
          AND NOT ${depositHeldSql("c.id")}
          AND (c.received_at < ?3 OR (c.received_at = ?3 AND c.rowid <
            (SELECT rowid FROM security_cases WHERE id = ?2)))
          AND (c.receipt_evidence_digest = ?4 OR EXISTS (
            SELECT 1 FROM security_submission_intake i
              JOIN security_intake_reports r ON r.submission_id = i.submission_id
             WHERE i.case_id = c.id AND r.content_sha256 = ?4))
          AND NOT EXISTS (
            SELECT 1 FROM security_submissions s
             WHERE s.case_id = c.id AND s.state IN ('failed', 'abandoned'))
        ORDER BY c.received_at ASC, c.rowid ASC LIMIT 1`,
    )
    .bind(row.project_id, row.id, row.received_at, digest)
    .first<{ id: string }>();
  return match?.id ?? null;
}

/**
 * Slopbot's own summaries of earlier reports; never another report's text.
 * Excludes earlier reports still waiting on the routine pass's own proof clock
 * or closed by the routine pass as `no-proof-received`, so a refile with proof
 * is not closed as a duplicate of a report that never had proof. Human
 * decisions remain eligible duplicate targets.
 */
async function earlierReports(
  deps: RoutineDependencies,
  row: CaseRow,
): Promise<SecurityRoutineInput["earlierReports"]> {
  const result = await deps.db
    .prepare(
      `SELECT c.id, (SELECT a.summary FROM security_case_analyses a
              LEFT JOIN security_submission_intake i ON i.case_id = a.case_id
              WHERE a.case_id = c.id AND a.state = 'complete'
                AND a.report_version IS i.report_version
              ORDER BY a.attempt DESC LIMIT 1) AS summary
         FROM security_cases c
        WHERE c.project_id = ?1 AND c.id <> ?2
          AND c.submission_state = 'verified'
          AND NOT (c.receipt_state = 'needs-information' AND c.next_action IS ?5)
          AND NOT (
            c.receipt_state = 'rejected'
            AND c.technical_decider_github_id IS NULL
            AND EXISTS (
              SELECT 1 FROM security_routine_decisions d
               WHERE d.case_id = c.id
                 AND d.mode = 'live'
                 AND d.outcome = 'no-proof-received'
                 AND d.applied = 1
            )
          )
          AND (c.received_at < ?3 OR (c.received_at = ?3 AND c.rowid <
            (SELECT rowid FROM security_cases WHERE id = ?2)))
        ORDER BY c.received_at DESC, c.rowid DESC LIMIT ?4`,
    )
    .bind(
      row.project_id,
      row.id,
      row.received_at,
      EARLIER_REPORT_LIMIT,
      ROUTINE_PROOF_NEXT_ACTION,
    )
    .all<{ id: string; summary: string | null }>();
  return (result.results ?? [])
    .filter((entry): entry is { id: string; summary: string } =>
      Boolean(entry.summary),
    )
    .map((entry) => ({
      id: entry.id,
      summary: entry.summary.slice(0, EARLIER_SUMMARY_CHARS),
    }));
}

/** The program scope published at the report's receipt, if any. */
async function receiptScope(deps: RoutineDependencies, row: CaseRow) {
  if (row.policy_revision === null) return null;
  const revision = await deps.db
    .prepare(
      "SELECT manifest FROM project_revisions WHERE project_id = ? AND revision = ?",
    )
    .bind(row.project_id, row.policy_revision)
    .first<{ manifest: string }>();
  if (revision === null) return null;
  return (
    (JSON.parse(revision.manifest) as ProjectDefinition).securityBounty
      ?.scope ?? null
  );
}

/**
 * Decides one case without changing it. `allowModel` false means this pass
 * has no model budget left: a report that needs calls is left for a later
 * pass (null), while every rule that needs none still runs.
 */
async function evaluate(
  deps: RoutineDependencies,
  row: CaseRow,
  mode: "dry_run" | "live",
  now: Date,
  allowModel: boolean,
  timeoutMs: number,
): Promise<Evaluation | null> {
  const intake = await deps.db
    .prepare(
      `SELECT i.submission_id, i.report_version, s.advisory_ghsa,
              (SELECT r.content_sha256 FROM security_intake_reports r
                WHERE r.submission_id = i.submission_id
                  AND r.version = i.report_version) AS digest
         FROM security_submission_intake i
         JOIN security_submissions s ON s.id = i.submission_id
        WHERE i.case_id = ?`,
    )
    .bind(row.id)
    .first<IntakeFacts>();
  const reportVersion = intake?.report_version ?? null;
  const asked = await deps.db
    .prepare(
      "SELECT report_version FROM security_routine_decisions WHERE case_id = ? AND outcome = 'needs-proof' AND applied = 1 ORDER BY id DESC LIMIT 1",
    )
    .bind(row.id)
    .first<{ report_version: number | null }>();
  const onGithub = row.advisory_ghsa !== null || intake?.advisory_ghsa != null;
  if (
    row.receipt_state === "needs-information" &&
    (reportVersion ?? 0) <= (asked?.report_version ?? 0)
  ) {
    // Only a clock that has run out closes; the candidate query already
    // requires it, and this refuses to rely on that alone.
    if (
      row.next_action_due_at === null ||
      now.getTime() < Date.parse(row.next_action_due_at)
    )
      return null;
    // The clock ran out with no new version. No call found loss of funds
    // plausible, or the report would have gone to the owner instead of a
    // request for proof. A report that reached GitHub meanwhile goes to a
    // person.
    const rank = { lossPlausible: false, severity: null, proofPresent: false };
    if (onGithub)
      return { decision: held("github-advisory", rank), reportVersion };
    return {
      decision: {
        outcome: "no-proof-received",
        basis: "clock",
        holdReason: null,
        exclusionLine: null,
        duplicateOf: null,
        proofDueAt: null,
        missing: [],
        calls: [],
        ...rank,
      },
      reportVersion,
    };
  }
  // A report on GitHub may already have maintainer discussion there, which
  // Slop cannot read, so it is never closed here.
  if (onGithub)
    return {
      decision: held("github-advisory", await analysisRank(deps, row.id)),
      reportVersion,
    };
  if (intake === null || intake.digest === null)
    return {
      decision: held("report-not-stored", await analysisRank(deps, row.id)),
      reportVersion,
    };
  const sameBytes = await earlierSameDigest(deps, row, intake.digest);
  if (sameBytes !== null)
    return {
      decision: {
        outcome: "duplicate",
        basis: "digest",
        holdReason: null,
        exclusionLine: null,
        duplicateOf: sameBytes,
        proofDueAt: null,
        lossPlausible: null,
        severity: null,
        proofPresent: null,
        missing: [],
        calls: [],
      },
      reportVersion,
    };
  const failed = await deps.db
    .prepare(
      "SELECT COUNT(*) AS attempts FROM security_routine_decisions WHERE case_id = ? AND case_revision = ? AND mode = ? AND outcome = 'unavailable'",
    )
    .bind(row.id, row.revision, mode)
    .first<{ attempts: number }>();
  if ((failed?.attempts ?? 0) >= MAX_UNAVAILABLE_ATTEMPTS)
    return {
      decision: held("analysis-unavailable", await analysisRank(deps, row.id)),
      reportVersion,
    };
  if (!allowModel) return null;
  const decide = deps.analyzer?.decideRoutine?.bind(deps.analyzer) ?? null;
  const call = (state: "answered" | "failed") => ({
    provider: deps.analyzer?.provider ?? "none",
    model: deps.analyzer?.model ?? "none",
    promptRevision: ROUTINE_DECISION_PROMPT_REVISION,
    state,
  });
  const unavailable = (calls: Decision["calls"]): Evaluation => ({
    decision: {
      outcome: "unavailable",
      basis: "hold",
      holdReason: "analysis-unavailable",
      exclusionLine: null,
      duplicateOf: null,
      proofDueAt: null,
      lossPlausible: null,
      severity: null,
      proofPresent: null,
      missing: [],
      calls,
    },
    reportVersion,
  });
  // No provider, or no readable report: nothing was sent, so no call counts.
  if (decide === null) return unavailable([]);
  let input: SecurityRoutineInput;
  try {
    const report = await deps.readReport(row.id, intake.report_version);
    if (report === null) return unavailable([]);
    const scope = await receiptScope(deps, row);
    input = {
      report,
      scope: scope
        ? {
            includedAssets: [...scope.includedAssets],
            severityRubric: scope.severityRubric,
            lossDefinition: scope.lossDefinition,
          }
        : null,
      // Without published program terms no line was shown to the reporter.
      doesNotQualify: scope ? routineClosingExclusions(scope) : [],
      earlierReports: await earlierReports(deps, row),
    };
  } catch {
    // The retained report cannot be read or verified now.
    return unavailable([]);
  }
  // The retained report was read for this decision; audit it like any read.
  await deps.db
    .prepare(
      "INSERT INTO security_intake_access_log(submission_id, actor_github_id, action, at) VALUES (?, ?, 'read', ?)",
    )
    .bind(intake.submission_id, ROUTINE_ACTOR.githubId, now.toISOString())
    .run();
  // Two separate requests. The second lists the lines and the earlier
  // reports in the opposite order, so agreement is not a matter of position.
  const reversed: SecurityRoutineInput = {
    ...input,
    doesNotQualify: [...input.doesNotQualify].reverse(),
    earlierReports: [...input.earlierReports].reverse(),
  };
  const [first, second] = await Promise.allSettled([
    decide(input, timeoutMs),
    decide(reversed, timeoutMs),
  ]);
  const calls = [first, second].map((answer) =>
    call(answer.status === "fulfilled" ? "answered" : "failed"),
  );
  if (first.status !== "fulfilled" || second.status !== "fulfilled") {
    // Never log the report, the prompt or the provider response.
    console.error("security routine decision call failed");
    return unavailable(calls);
  }
  // A proof-of-concept file is proof present by rule, not by a reading.
  const withFile = (
    answer: SecurityRoutineProposal,
  ): SecurityRoutineProposal =>
    input.report.proofOfConcept
      ? { ...answer, proof: "present", missing: [] }
      : answer;
  return {
    decision: combineRoutineCalls(
      withFile(first.value),
      withFile(second.value),
      { now, askedForProofBefore: asked !== null },
      calls,
    ),
    reportVersion,
  };
}

function decisionInsert(
  deps: RoutineDependencies,
  input: {
    runId: number;
    row: CaseRow;
    mode: "dry_run" | "live";
    evaluation: Evaluation;
    applied: boolean;
    at: string;
    /**
     * Insert only when this batch wrote the journal event of the change.
     * Either way a case revision gets one final decision per mode, so two
     * overlapping passes cannot both record one.
     */
    eventKey: string | null;
  },
): D1Statement {
  const { decision, reportVersion } = input.evaluation;
  const flag = (value: boolean | null) =>
    value === null ? null : value ? 1 : 0;
  const modelCalls = decision.calls.length === 2 ? 2 : 0;
  return deps.db
    .prepare(
      `INSERT INTO security_routine_decisions (run_id, case_id, case_revision, report_version, mode, attempt, outcome, basis, hold_reason, exclusion_line, duplicate_of, proof_due_at, loss_plausible, plausible_severity, proof_present, prompt_revision, calls, model_calls, applied, applied_case_revision, decided_at)
       SELECT ?1, ?2, ?3, ?4, ?5,
              1 + (SELECT COUNT(*) FROM security_routine_decisions d
                    WHERE d.case_id = ?2 AND d.case_revision = ?3 AND d.mode = ?5),
              ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20
        WHERE (?21 IS NULL OR EXISTS (
          SELECT 1 FROM security_case_events e
           WHERE e.case_id = ?2 AND e.case_revision = ?19
             AND e.idempotency_key = ?21))
          AND (?6 = 'unavailable' OR NOT EXISTS (
            SELECT 1 FROM security_routine_decisions f
             WHERE f.case_id = ?2 AND f.case_revision = ?3 AND f.mode = ?5
               AND f.outcome <> 'unavailable'))`,
    )
    .bind(
      input.runId,
      input.row.id,
      input.row.revision,
      reportVersion,
      input.mode,
      decision.outcome,
      decision.basis,
      decision.holdReason,
      decision.exclusionLine,
      decision.duplicateOf,
      decision.proofDueAt,
      flag(decision.lossPlausible),
      decision.severity,
      flag(decision.proofPresent),
      modelCalls === 2 ? ROUTINE_DECISION_PROMPT_REVISION : null,
      JSON.stringify(decision.calls),
      modelCalls,
      input.applied ? 1 : 0,
      input.applied ? input.row.revision + 1 : null,
      input.at,
      input.eventKey,
    );
}

/** The case change, journal kind and columns of one live decision. */
function caseChange(
  row: CaseRow,
  decision: Decision,
): { kind: string; set: Record<string, string | null> } {
  const closedAward = row.terms === null ? "not-applicable" : "ineligible";
  switch (decision.outcome) {
    case "duplicate":
      return {
        kind: "decide",
        set: {
          receipt_state: "duplicate",
          duplicate_of: decision.duplicateOf,
          award_state: closedAward,
          next_action: null,
          next_action_due_at: null,
        },
      };
    case "does-not-qualify":
      return {
        kind: "decide",
        set: {
          receipt_state: "out-of-scope",
          award_state: closedAward,
          next_action: null,
          next_action_due_at: null,
        },
      };
    case "no-proof-received":
      return {
        kind: "decide",
        set: {
          receipt_state: "rejected",
          award_state: closedAward,
          next_action: null,
          next_action_due_at: null,
        },
      };
    case "needs-proof":
      return {
        kind: "request-information",
        set: {
          receipt_state: "needs-information",
          next_action: ROUTINE_PROOF_NEXT_ACTION,
          next_action_due_at: decision.proofDueAt,
        },
      };
    default:
      // A real status change, so the reporter sees the report was read.
      return {
        kind: "triage",
        set: {
          receipt_state: "triaging",
          next_action: null,
          next_action_due_at: null,
        },
      };
  }
}

const RECEIPT_OUTCOME: Partial<Record<Outcome, string>> = {
  duplicate: "duplicate",
  "does-not-qualify": "out-of-scope",
  "no-proof-received": "rejected",
};

/**
 * Stores one decision. `dry_run` and a failed attempt write the record
 * alone. `live` writes the case change, its event, the reporter's notice and
 * the record together, only while the case is still at the revision that was
 * read. Returns false when another writer changed the case first.
 */
async function record(
  deps: RoutineDependencies,
  runId: number,
  row: CaseRow,
  mode: "dry_run" | "live",
  evaluation: Evaluation,
  at: string,
): Promise<boolean> {
  const { decision } = evaluation;
  try {
    if (mode === "dry_run" || decision.outcome === "unavailable") {
      const result = await deps.db.batch([
        decisionInsert(deps, {
          runId,
          row,
          mode,
          evaluation,
          applied: false,
          at,
          eventKey: null,
        }),
      ]);
      return (result[0]?.meta?.changes ?? 0) === 1;
    }
    const change = caseChange(row, decision);
    const columns = Object.keys(change.set);
    const eventKey = `routine-decision-r${row.revision}`;
    const results = await deps.db.batch([
      deps.db
        .prepare(
          `UPDATE security_cases SET ${columns
            .map((column) => `${column} = ?`)
            .join(
              ", ",
            )}, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND receipt_state = ? AND appeal_state = 'none' AND award_state NOT IN ('reserved', 'approved') AND NOT ${depositHeldSql("security_cases.id")}`,
        )
        .bind(
          ...columns.map((column) => change.set[column]),
          at,
          row.id,
          row.revision,
          row.receipt_state,
        ),
      eventStatement(deps, {
        caseId: row.id,
        revision: row.revision + 1,
        kind: change.kind,
        actor: ROUTINE_ACTOR,
        role: ROUTINE_ROLE,
        idempotencyKey: eventKey,
        reason: routineReason(decision),
        evidenceReference: null,
        detail: {
          automatic: true,
          ...(RECEIPT_OUTCOME[decision.outcome]
            ? { outcome: RECEIPT_OUTCOME[decision.outcome] }
            : {}),
          routine: {
            outcome: decision.outcome,
            basis: decision.basis,
            holdReason: decision.holdReason,
            exclusionLine: decision.exclusionLine,
            duplicateOf: decision.duplicateOf,
            proofDueAt: decision.proofDueAt,
            promptRevision:
              decision.calls.length > 0
                ? ROUTINE_DECISION_PROMPT_REVISION
                : null,
            calls: decision.calls,
          },
        },
        at,
        guard: true,
      }),
      decisionInsert(deps, {
        runId,
        row,
        mode,
        evaluation,
        applied: true,
        at,
        eventKey,
      }),
      // The reporter's Inbox notice; it exists only with the event above.
      notifySecurityCase(deps.db, {
        caseId: row.id,
        revision: row.revision + 1,
        idempotencyKey: eventKey,
        recipients: [row.reporter_github_id],
      }),
    ]);
    return (results[0]?.meta?.changes ?? 0) === 1;
  } catch (error) {
    // Another writer took this revision or this attempt first.
    if (isConstraintFailure(error)) return false;
    throw error;
  }
}

export type RoutineRun = {
  runId: number;
  mode: "dry_run" | "live";
  examined: number;
  recorded: number;
};

/**
 * One bounded pass. Returns null when another pass began within the minimum
 * interval. Safe to repeat: every case revision gets one decision per mode,
 * and a live decision applies only to the revision it read.
 */
export async function runRoutineDecisions(
  deps: RoutineDependencies,
  options: {
    mode: "dry_run" | "live";
    source: "request" | "admin";
    limits: RoutineLimits;
  },
): Promise<RoutineRun | null> {
  const { mode, source, limits } = options;
  const now = deps.now();
  const startedAt = now.toISOString();
  const lease = await deps.db
    .prepare(
      "INSERT INTO security_routine_runs (mode, source, started_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM security_routine_runs WHERE started_at > ?)",
    )
    .bind(
      mode,
      source,
      startedAt,
      new Date(now.getTime() - limits.minIntervalMs).toISOString(),
    )
    .run();
  if ((lease.meta?.changes ?? 0) !== 1) return null;
  const run = await deps.db
    .prepare(
      "SELECT id FROM security_routine_runs WHERE started_at = ? AND mode = ? AND source = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(startedAt, mode, source)
    .first<{ id: number }>();
  if (run === null) return null;
  const used = await deps.db
    .prepare(
      "SELECT COALESCE(SUM(model_calls), 0) AS calls FROM security_routine_decisions WHERE decided_at >= ?",
    )
    .bind(`${startedAt.slice(0, 10)}T00:00:00.000Z`)
    .first<{ calls: number }>();
  let modelLeft = Math.min(
    limits.modelCasesPerRun,
    limits.modelCasesPerDay - Math.floor((used?.calls ?? 0) / 2),
  );
  let examined = 0;
  let recorded = 0;
  try {
    for (const row of await candidates(deps, mode, now, limits.casesPerRun)) {
      examined++;
      const evaluation = await evaluate(
        deps,
        row,
        mode,
        now,
        modelLeft > 0,
        limits.timeoutMs,
      );
      if (evaluation === null) continue;
      if (evaluation.decision.calls.length > 0) modelLeft--;
      if (
        await record(
          deps,
          run.id,
          row,
          mode,
          evaluation,
          deps.now().toISOString(),
        )
      )
        recorded++;
    }
  } finally {
    await deps.db
      .prepare(
        "UPDATE security_routine_runs SET finished_at = ?, examined = ?, recorded = ? WHERE id = ? AND finished_at IS NULL",
      )
      .bind(deps.now().toISOString(), examined, recorded, run.id)
      .run();
  }
  return { runId: run.id, mode, examined, recorded };
}

/**
 * The owner's short ranked list: acknowledged reports that still wait for
 * the owner, plausible severity first, then proof present, then age.
 */
export async function routineOwnerRanking(
  deps: Pick<SecurityApiDependencies, "db">,
  projectIds: readonly string[],
): Promise<string[]> {
  if (projectIds.length === 0) return [];
  const result = await deps.db
    .prepare(
      `SELECT d.case_id FROM security_routine_decisions d
         JOIN security_cases c ON c.id = d.case_id
        WHERE d.mode = 'live' AND d.applied = 1 AND d.outcome = 'acknowledged'
          AND c.receipt_state = 'triaging' AND c.appeal_state = 'none'
          AND c.project_id IN (SELECT value FROM json_each(?))
          AND d.id = (SELECT MAX(x.id) FROM security_routine_decisions x
                       WHERE x.case_id = d.case_id AND x.applied = 1)
        ORDER BY CASE d.plausible_severity
                   WHEN 'critical' THEN 5 WHEN 'high' THEN 4
                   WHEN 'medium' THEN 3 WHEN 'low' THEN 2
                   WHEN 'informational' THEN 1 ELSE 0 END DESC,
                 COALESCE(d.proof_present, 0) DESC,
                 c.received_at ASC, c.rowid ASC
        LIMIT ?`,
    )
    .bind(JSON.stringify(projectIds), ROUTINE_OWNER_LIST_LIMIT)
    .all<{ case_id: string }>();
  return (result.results ?? []).map((row) => row.case_id);
}

/**
 * True when the latest decision on a closed case is a routine one that no
 * person has reviewed. Its appeal returns the report to the program owner.
 */
export async function routineClosed(
  deps: Pick<SecurityApiDependencies, "db">,
  row: CaseRow,
): Promise<boolean> {
  if (
    !["duplicate", "out-of-scope", "rejected"].includes(row.receipt_state) ||
    row.technical_decider_github_id !== null
  )
    return false;
  const latest = await deps.db
    .prepare(
      "SELECT actor_github_id FROM security_case_events WHERE case_id = ? AND kind IN ('decide', 'decide-appeal') ORDER BY case_revision DESC LIMIT 1",
    )
    .bind(row.id)
    .first<{ actor_github_id: string }>();
  return latest?.actor_github_id === ROUTINE_ACTOR.githubId;
}

/** Aggregate counts only: never a case, a reporter or report text. */
async function routineSummary(deps: Pick<SecurityApiDependencies, "db">) {
  const [latest, runs] = await Promise.all([
    deps.db
      .prepare(
        `SELECT d.mode, d.outcome, d.basis, d.hold_reason AS holdReason,
                COUNT(*) AS cases
           FROM security_routine_decisions d
          WHERE d.id = (SELECT MAX(x.id) FROM security_routine_decisions x
                         WHERE x.case_id = d.case_id AND x.mode = d.mode)
          GROUP BY d.mode, d.outcome, d.basis, d.hold_reason
          ORDER BY d.mode, cases DESC`,
      )
      .all<Record<string, unknown>>(),
    deps.db
      .prepare(
        "SELECT mode, source, started_at AS startedAt, finished_at AS finishedAt, examined, recorded FROM security_routine_runs ORDER BY id DESC LIMIT 10",
      )
      .all<Record<string, unknown>>(),
  ]);
  const waiting = await deps.db
    .prepare(
      `SELECT COUNT(*) AS cases FROM security_cases WHERE submission_state = 'verified' AND receipt_state = 'received' AND NOT ${depositHeldSql("security_cases.id")}`,
    )
    .first<{ cases: number }>();
  return {
    received: waiting?.cases ?? 0,
    decisions: latest.results ?? [],
    runs: runs.results ?? [],
  };
}

export type RoutineConfiguration = NonNullable<
  SecurityApiDependencies["routineDecisions"]
>;

/** When this isolate next asks for a pass. Tests reset it. */
export const routineDecisionSweep = { nextAt: 0 };
const ROUTINE_SWEEP_MS = 60_000;

/**
 * Starts a pass behind a security API request, at most once a minute per
 * isolate; the run table's lease keeps passes at least the minimum interval
 * apart across isolates. The request only supplies the moment. A failure is
 * logged by name and never reaches the response.
 */
export function sweepRoutineDecisions(
  deps: RoutineDependencies & Pick<SecurityApiDependencies, "waitUntil">,
  configuration: RoutineConfiguration | undefined,
): void {
  if (!deps.waitUntil || !configuration || configuration.mode === "off") return;
  const now = Date.now();
  if (now < routineDecisionSweep.nextAt) return;
  routineDecisionSweep.nextAt = now + ROUTINE_SWEEP_MS;
  deps.waitUntil(
    runRoutineDecisions(deps, {
      mode: configuration.mode,
      source: "request",
      limits: BACKGROUND_ROUTINE_LIMITS,
    }).catch((error: unknown) =>
      console.error(
        "security routine decision pass failed",
        error instanceof Error ? error.name : "unknown",
      ),
    ),
  );
}

/**
 * `GET /api/v1/security-routine`: the mode and aggregate counts.
 * `POST /api/v1/security-routine`: one pass inside the request.
 * Platform admins only; everyone else gets the same 404 as a missing route.
 */
export async function handleRoutineApi(
  request: Request,
  deps: RoutineDependencies & Pick<SecurityApiDependencies, "sessionActor">,
  configuration: RoutineConfiguration | undefined,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  if (!configuration?.adminGithubIds.has(actor.githubId))
    fail(404, "not_found", "Not found");
  if (request.method === "GET")
    return json(200, {
      mode: configuration.mode,
      limits: BACKGROUND_ROUTINE_LIMITS,
      ...(await routineSummary(deps)),
    });
  if (request.method !== "POST") fail(404, "not_found", "Not found");
  exactKeys(await requireJsonObject(request, 1024, "Routine decision"), [
    "action",
  ]);
  if (configuration.mode === "off")
    fail(409, "routine_decisions_off", "Routine decisions are off");
  const run = await runRoutineDecisions(deps, {
    mode: configuration.mode,
    source: "admin",
    limits: ADMIN_ROUTINE_LIMITS,
  });
  if (run === null)
    fail(
      409,
      "routine_pass_recent",
      "A pass started in the last three minutes. Try again shortly.",
    );
  return json(200, {
    mode: run.mode,
    examined: run.examined,
    recorded: run.recorded,
    ...(await routineSummary(deps)),
  });
}
