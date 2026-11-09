/**
 * Automatic private intake (PRD section 8 "Private reporting is automatic",
 * SEC-07, SEC-10, SEC-16, SEC-17; issue #910).
 *
 * New reports use the durable Slop receipt in report-intake.ts. This module
 * preserves the reporter-authorized GitHub forwarding and legacy receipts.
 * A saved report must be screened or explicitly routed by its current
 * maintainer before forwarding. An unfinished legacy draft is screened on
 * its first send when durable storage is enabled.
 *
 * Report content never enters D1, logs or public responses. The transition
 * to `submitting` commits before GitHub is called. Unknown outcomes require
 * reconciliation against private advisory evidence before any retry. An
 * external service failure never destroys a saved Slop report or becomes a
 * public submission.
 */

import { bytesToHex } from "../../src/lib/byte-encoding";
import type { GithubActor as Actor } from "../../src/lib/project-contracts";
import type { D1QueryStatement as D1Statement } from "../d1";
import { GHSA } from "../github";
import {
  exactKeys,
  fail,
  PROJECT_ID,
  requireActor,
  requireJsonObject,
} from "../http";
import { notifySecurityReportReceived } from "../notifications/events";
import {
  hasParticipationBan,
  PARTICIPATION_BAN_QUERY,
} from "../projects/account-bans";
import {
  automaticIntake,
  caseInsertStatement,
  eventStatement,
  IDEMPOTENCY_KEY,
  inboxStatements,
  json,
  pvrState,
  type ReportingContext,
  reportingContext,
  type SecurityApiDependencies,
  stringField,
  termsAtReceipt,
} from "./case-store";
import {
  type AdvisoryFacts,
  type FailureCode,
  markerLine,
  parseReportInput,
  type ReporterGrant,
} from "./github-advisories";
import {
  beginAuthorization,
  clearGrantCookie,
  completeAuthorization,
  type IntakeConfig,
  readGrant,
} from "./intake-grant";
import { reportingAuthorityUnavailable } from "./project-access";
import { checkedAnalysis } from "./report-analysis";
import {
  acceptStoredReport,
  actStoredIntake,
  approvedReportForForward,
  decorateSubmission,
  listStoredSubmissions,
  readStoredIntake,
  scheduleAnalysis,
  screenLegacyReport,
} from "./report-intake";
import {
  COLUMNS,
  loadSubmission,
  RECONCILE_QUIET_MS,
  SUBMISSION_ID,
  type SubmissionRow,
  settle,
  storedIntake,
  submissionView,
  transition,
  transitionStatements,
} from "./submission-store";

/** How far before the attempt a GitHub listing looks for its copy. */
const RECONCILE_WINDOW_MS = 10 * 60 * 1000;
/** GitHub's clock may run slightly ahead of Slop's. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_SEND_BYTES = 256 * 1024;
/** Codes after which the same submission can never be sent again. */
const TERMINAL_FAILURES: readonly FailureCode[] = [
  "author-mismatch",
  "already-recorded",
  "not-private-report",
  "unverifiable",
];
/** Advisory states a direct report may be verified in. */
const DIRECT_STATES = new Set(["triage", "draft", "published"]);

function notFound(): never {
  fail(404, "not_found", "Submission not found");
}

function intakeOn(deps: SecurityApiDependencies): IntakeConfig {
  if (deps.intake?.mode !== "on") notFound();
  return deps.intake;
}

function withCookies(response: Response, cookies: string[]): Response {
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  return response;
}

function redirect(location: string, cookies: string[]): Response {
  const response = new Response(null, {
    status: 303,
    headers: {
      location,
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
    },
  });
  return withCookies(response, cookies);
}

/** Only the reporter sees a submission; everyone else gets the same 404. */
async function ownSubmission(
  deps: SecurityApiDependencies,
  id: string,
  actor: Actor,
): Promise<SubmissionRow> {
  const row = await loadSubmission(deps, id);
  if (row === null || row.reporter_github_id !== actor.githubId) notFound();
  return row;
}

function expectedRevision(body: Record<string, unknown>): number {
  if (
    typeof body.expectedRevision !== "number" ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 1
  )
    fail(400, "invalid_request", "Invalid expectedRevision");
  return body.expectedRevision;
}

function readBody(request: Request): Promise<Record<string, unknown>> {
  return requireJsonObject(request, MAX_SEND_BYTES, "Report request");
}

/** The caller's own submission, at exactly the revision the request names. */
async function ownSubmissionAtRevision(
  request: Request,
  deps: SecurityApiDependencies,
  id: string,
): Promise<{ actor: Actor; loaded: SubmissionRow }> {
  const actor = await requireActor(request, deps);
  const loaded = await ownSubmission(deps, id, actor);
  const body = await readBody(request);
  exactKeys(body, ["expectedRevision"]);
  const expected = expectedRevision(body);
  if (expected !== loaded.revision)
    fail(409, "stale_revision", "The submission changed since you loaded it");
  return { actor, loaded };
}

/**
 * A lost race for one advisory: answer with a concurrent winner's outcome for
 * this submission, otherwise fail it as already recorded without revealing
 * the other case.
 */
async function failAlreadyRecorded(
  deps: SecurityApiDependencies,
  row: SubmissionRow,
): Promise<{ status: number; row: SubmissionRow }> {
  const current = (await loadSubmission(deps, row.id)) as SubmissionRow;
  if (current.state === "receipt-verified")
    return { status: 200, row: current };
  if (current.revision !== row.revision || current.state !== row.state)
    fail(409, "stale_revision", "The submission changed since you loaded it");
  await transition(deps, current, {
    state: "failed",
    set: { failure_code: "already-recorded" },
    kind: "verify-failed",
    detail: { code: "already-recorded" },
    actorGithubId: null,
  });
  fail(
    409,
    "advisory_already_recorded",
    "This advisory already has a verified case",
  );
}

async function programTerms(
  deps: SecurityApiDependencies,
  projectId: string,
): Promise<ReportingContext> {
  return reportingContext(deps, projectId);
}

async function grantResponse(
  deps: SecurityApiDependencies,
  actor: Actor,
  status: number,
  row: SubmissionRow,
  extra: Record<string, unknown> = {},
  cookies: string[] = [],
): Promise<Response> {
  const done = row.state === "receipt-verified" || row.state === "abandoned";
  return withCookies(
    json(status, {
      submission: await decorateSubmission(deps, row, actor),
      ...extra,
    }),
    [...cookies, ...(done ? [clearGrantCookie()] : [])],
  );
}

async function requireGrant(
  request: Request,
  deps: SecurityApiDependencies,
  intake: IntakeConfig,
  row: SubmissionRow,
): Promise<ReporterGrant> {
  const grant = await readGrant(
    request,
    intake,
    row.id,
    row.reporter_github_id,
    deps.now(),
  );
  if (grant === null)
    fail(
      409,
      "grant_required",
      "Authorize GitHub to act for you on this submission first",
    );
  return grant;
}

async function requireNewParticipation(
  deps: SecurityApiDependencies,
  githubId: string,
): Promise<void> {
  if (await hasParticipationBan(deps.db, githubId))
    fail(
      403,
      "participation_banned",
      "This account cannot start new Slop work. Existing cases, funded awards and appeals remain available.",
    );
}

async function createSubmission(
  request: Request,
  deps: SecurityApiDependencies,
  intake: IntakeConfig,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  await requireNewParticipation(deps, actor.githubId);
  const body = await readBody(request);
  exactKeys(body, ["projectId", "idempotencyKey", "origin"], ["advisory"]);
  const projectId = stringField(body, "projectId", PROJECT_ID);
  const idempotencyKey = stringField(body, "idempotencyKey", IDEMPOTENCY_KEY);
  const origin = body.origin;
  if (origin !== "slop" && origin !== "direct")
    fail(400, "invalid_request", "Invalid origin");
  const advisory =
    origin === "direct" ? stringField(body, "advisory", GHSA) : null;
  if (origin === "slop" && body.advisory !== undefined)
    fail(400, "invalid_request", "A new report has no advisory yet");
  const authorize = async (row: SubmissionRow) => {
    const flow = await beginAuthorization(
      request,
      intake,
      {
        submissionId: row.id,
        githubId: actor.githubId,
        githubLogin: actor.githubLogin,
      },
      deps.now(),
    );
    if (flow === null) fail(401, "unauthorized", "Sign in with GitHub");
    return flow;
  };
  const existing = await deps.db
    .prepare(
      `SELECT ${COLUMNS} FROM security_submissions WHERE reporter_github_id = ? AND idempotency_key = ?`,
    )
    .bind(actor.githubId, idempotencyKey)
    .first<SubmissionRow>();
  if (existing !== null) {
    if (
      existing.project_id !== projectId ||
      existing.origin !== origin ||
      existing.advisory_ghsa !== advisory
    )
      fail(409, "idempotency_conflict", "That request key was already used");
    const row = await settle(deps, existing);
    // A replay is a new authorization request: finished submissions refuse
    // it, like the dedicated authorize route does below.
    if (row.state === "receipt-verified" || row.state === "abandoned")
      fail(409, "submission_closed", "This submission is finished");
    const flow = await authorize(row);
    return grantResponse(
      deps,
      actor,
      200,
      row,
      { replayed: true, authorizeUrl: flow.authorizeUrl },
      [flow.cookie],
    );
  }
  const terms = await programTerms(deps, projectId);
  const repository = terms.intake.repository;
  const state = await pvrState(deps, projectId);
  const automatic = await automaticIntake(deps, repository, state);
  // A direct report already exists on GitHub; it needs only the App.
  if (
    origin === "slop"
      ? automatic !== "ready"
      : (await intake.installation.installed(repository)) !== "yes"
  )
    fail(
      409,
      "intake_unavailable",
      "Automatic private intake is not available for this program",
    );
  const inFlight = await deps.db
    .prepare(
      "SELECT 1 AS found FROM security_submissions WHERE project_id = ? AND reporter_github_id = ? AND state IN ('submitting', 'uncertain', 'submitted')",
    )
    .bind(projectId, actor.githubId)
    .first<{ found: number }>();
  if (inFlight !== null)
    fail(
      409,
      "submission_in_flight",
      "Finish your submission in progress for this program first",
    );
  const at = deps.now().toISOString();
  const id = `ss_${deps.randomId().replaceAll("-", "")}`;
  const marker = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  try {
    await deps.db.batch([
      deps.db
        .prepare(
          `INSERT INTO security_submissions (${COLUMNS}) SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, NULL, ?, NULL, NULL, NULL, NULL, 1, ?, ? WHERE NOT EXISTS (${PARTICIPATION_BAN_QUERY})`,
        )
        .bind(
          id,
          projectId,
          repository,
          actor.githubId,
          actor.githubLogin,
          origin,
          idempotencyKey,
          marker,
          advisory,
          at,
          at,
          actor.githubId,
        ),
      deps.db
        .prepare(
          "INSERT INTO security_submission_events (submission_id, revision, kind, detail, actor_github_id, at) SELECT ?, 1, 'create', ?, ?, ? WHERE EXISTS (SELECT 1 FROM security_submissions WHERE id = ?)",
        )
        .bind(
          id,
          JSON.stringify(advisory === null ? { origin } : { origin, advisory }),
          actor.githubId,
          at,
          id,
        ),
    ]);
  } catch (error) {
    if (!/UNIQUE/iu.test(error instanceof Error ? error.message : ""))
      throw error;
    fail(409, "idempotency_conflict", "That request key was already used");
  }
  const row = await loadSubmission(deps, id);
  if (row === null) {
    await requireNewParticipation(deps, actor.githubId);
    fail(409, "submission_changed", "Start the submission again");
  }
  const flow = await authorize(row);
  return grantResponse(
    deps,
    actor,
    201,
    row,
    { authorizeUrl: flow.authorizeUrl },
    [flow.cookie],
  );
}

/** A new authorization for an existing submission, e.g. after expiry. */
async function authorizeSubmission(
  request: Request,
  deps: SecurityApiDependencies,
  intake: IntakeConfig,
  id: string,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  const owned = await ownSubmission(deps, id, actor);
  const body = await readBody(request);
  exactKeys(body, []);
  const row = await settle(deps, owned);
  if (row.state === "receipt-verified" || row.state === "abandoned")
    fail(409, "submission_closed", "This submission is finished");
  // A send in progress may still need reconciliation. Renew its read grant
  // without requiring the saved body or permission to send a new copy. Send
  // rechecks the current report and approval before claiming another attempt.
  if (!["submitting", "uncertain", "submitted"].includes(row.state))
    await approvedReportForForward(deps, id);
  const flow = await beginAuthorization(
    request,
    intake,
    {
      submissionId: row.id,
      githubId: actor.githubId,
      githubLogin: actor.githubLogin,
    },
    deps.now(),
  );
  if (flow === null) fail(401, "unauthorized", "Sign in with GitHub");
  return grantResponse(
    deps,
    actor,
    200,
    row,
    { authorizeUrl: flow.authorizeUrl },
    [flow.cookie],
  );
}

async function authorizationCallback(
  request: Request,
  deps: SecurityApiDependencies,
  intake: IntakeConfig,
): Promise<Response> {
  const session = await deps.sessionActor(request).catch(() => null);
  const result = await completeAuthorization(
    request,
    intake,
    deps.now(),
    session?.githubId ?? null,
  );
  const target = new URLSearchParams();
  if (result.submissionId !== null && SUBMISSION_ID.test(result.submissionId))
    target.set("submission", result.submissionId);
  if (!result.ok) target.set("intake", result.code);
  return redirect(`/security?${target.toString()}`, result.cookies);
}

/**
 * Checks GitHub's own record of the advisory (§6) and, when every check
 * holds, writes the verified case, its first event, routing, the access
 * log and the inbox rows in the same batch as the submission transition.
 */
async function verifyReceipt(
  deps: SecurityApiDependencies,
  intake: IntakeConfig,
  row: SubmissionRow,
  grant: ReporterGrant,
): Promise<{ status: number; row: SubmissionRow }> {
  const now = deps.now();
  const terms = await programTerms(deps, row.project_id);
  const ghsa = row.advisory_ghsa as string;
  const marker = row.origin === "slop" ? markerLine(row.marker) : undefined;
  const fetched = await intake.advisories.getAdvisory(
    grant,
    row.repository,
    ghsa,
    marker,
  );
  const stay = async (kind: string) => ({
    status: 202,
    row:
      (await transition(deps, row, {
        state: row.state,
        kind,
        actorGithubId: null,
      })) ?? row,
  });
  const failWith = async (code: FailureCode) => ({
    status: 200,
    row:
      (await transition(deps, row, {
        state: "failed",
        set: { failure_code: code },
        kind: "verify-failed",
        detail: { code },
        actorGithubId: null,
      })) ?? row,
  });
  if (fetched.kind === "error") return stay("verify-inconclusive");
  if (fetched.kind === "not-found")
    return row.origin === "direct"
      ? failWith("not-found")
      : stay("verify-inconclusive");
  const facts = fetched.facts;
  const reporter = row.reporter_github_id;
  if (
    facts.ghsa !== ghsa ||
    facts.repository.toLowerCase() !== row.repository.toLowerCase() ||
    row.repository.toLowerCase() !== terms.intake.repository.toLowerCase()
  )
    return failWith("invalid");
  // A pasted link never establishes authorship (SEC-17); GitHub's author
  // does. A reporter credit is editable by maintainers and collaborators,
  // so a credited non-author uses the manual claim that a security
  // maintainer verifies.
  if (facts.authorId !== reporter) return failWith("author-mismatch");
  // Only a private vulnerability report that is still live is a receipt. A
  // repository advisory a maintainer drafted, or a closed or withdrawn
  // report, goes to the manual claim path instead.
  if (
    row.origin === "direct" &&
    (!facts.privateReport || !DIRECT_STATES.has(facts.state))
  )
    return failWith("not-private-report");
  if (
    Date.parse(facts.createdAt) > now.getTime() + CLOCK_SKEW_MS ||
    (row.origin === "slop" && !facts.markerFound)
  )
    return failWith("invalid");
  let context: ReportingContext;
  try {
    context = await reportingContext(deps, row.project_id, true);
  } catch (error) {
    if (!reportingAuthorityUnavailable(error)) throw error;
    // GitHub already received it. Keep the journal and grant for reconciliation.
    return stay("contacts-unavailable");
  }
  // A verified case needs someone to triage it. When no candidate passes
  // the reporting-authority check, the approver list is empty and the case
  // would be created with a null owner, a reporter-only notice, and no due
  // date. Keep the submission for reconciliation instead of creating that
  // ownerless case, using the same stay the authority-outage path uses.
  if (context.approvers.technical.length === 0)
    return stay("contacts-unavailable");
  return writeVerifiedCase(deps, intake, row, context, facts);
}

async function writeVerifiedCase(
  deps: SecurityApiDependencies,
  intake: IntakeConfig,
  row: SubmissionRow,
  terms: ReportingContext,
  facts: AdvisoryFacts,
): Promise<{ status: number; row: SubmissionRow }> {
  const now = deps.now();
  const at = now.toISOString();
  const durable = await storedIntake(deps, row.id);
  if (durable) {
    const linked = await transition(deps, row, {
      state: "receipt-verified",
      set: {
        case_id: durable.case_id,
        advisory_ghsa: facts.ghsa,
        github_created_at: facts.createdAt,
        evidence_digest: facts.evidenceDigest,
      },
      guard: {
        sql: "NOT EXISTS (SELECT 1 FROM security_cases WHERE project_id = ? AND advisory_ghsa = ? AND submission_state = 'verified' AND id <> ?)",
        values: [row.project_id, facts.ghsa, durable.case_id],
      },
      kind: "github-linked",
      detail: { caseId: durable.case_id, advisory: facts.ghsa },
      actorGithubId: row.reporter_github_id,
    });
    if (linked !== null) return { status: 200, row: linked };
    return failAlreadyRecorded(deps, row);
  }
  const receivedAt = facts.createdAt;
  // Analysis runs in memory on the content GitHub returned; only enums leave.
  const analysis = checkedAnalysis(
    await intake.analyzer.analyze(facts.analysisInput).catch(() => null),
  );
  const frozen = await termsAtReceipt(deps, row.project_id, receivedAt);
  const duplicates = await deps.db
    .prepare(
      "SELECT detail FROM security_submission_events WHERE submission_id = ? AND kind = 'duplicate-advisories' ORDER BY revision DESC LIMIT 1",
    )
    .bind(row.id)
    .first<{ detail: string }>();
  const duplicateAdvisories = duplicates
    ? ((JSON.parse(duplicates.detail) as { ghsas?: string[] }).ghsas ?? [])
    : [];
  // The case's next action and due time are in the reporter's view, so they
  // never depend on the analysis: the priority stays in the restricted event
  // detail, and the due time is the program's published acknowledgement
  // target.
  const acknowledgeHours = terms.responseTargets?.acknowledgeHours;
  const dueAt =
    typeof acknowledgeHours === "number"
      ? new Date(
          now.getTime() + acknowledgeHours * 60 * 60 * 1000,
        ).toISOString()
      : null;
  const caseId = `sc_${deps.randomId().replaceAll("-", "")}`;
  // The reporter's own action: a send through Slop, or asking Slop to
  // verify a report they filed directly. GitHub's record, not the reporter,
  // verified the receipt (`verifiedBy` below and in the detail).
  const kind = row.origin === "slop" ? "submit" : "submit-direct";
  const reporter = {
    githubId: row.reporter_github_id,
    githubLogin: row.reporter_github_login,
  };
  const idempotencyKey = `intake-${row.id}`;
  // Every case write commits only if this submission is still where it was.
  const guard = {
    sql: "(SELECT revision FROM security_submissions WHERE id = ?) = ? AND (SELECT state FROM security_submissions WHERE id = ?) = ?",
    values: [row.id, row.revision, row.id, row.state],
  };
  const statements: D1Statement[] = [
    caseInsertStatement(deps, {
      id: caseId,
      projectId: row.project_id,
      repository: row.repository,
      advisory: facts.ghsa,
      reporter,
      verified: {
        receivedAt,
        // A sentinel, not a person: GitHub's record verified the receipt
        // (OPEN_QUESTION 7). It never matches an approver id.
        verifiedBy: "github",
        policyRevision: frozen.revision,
        terms: frozen.terms,
        source: "github-verified",
        receiptEvidenceDigest: facts.evidenceDigest,
      },
      ownerGithubId: terms.approvers.technical[0]?.githubId ?? null,
      nextAction: "Triage new private report",
      nextActionDueAt: dueAt,
      at,
      guard,
    }),
    eventStatement(deps, {
      caseId,
      revision: 1,
      kind,
      actor: reporter,
      role: "reporter",
      idempotencyKey,
      reason: null,
      evidenceReference: null,
      detail: {
        submissionId: row.id,
        advisory: facts.ghsa,
        receivedAt,
        receivedAtSource: "github-verified",
        verifiedBy: "github",
        policyRevision: frozen.revision,
        // Recommendations only; never severity, receipt or award (SEC-10).
        autoAnalysis: { ...analysis, analyzer: intake.analyzer.id },
        ...(duplicateAdvisories.length > 0 ? { duplicateAdvisories } : {}),
      },
      at,
      guard: true,
    }),
    deps.db
      .prepare(
        "INSERT INTO security_case_access_log (case_id, actor_github_id, actor_role, action, at) SELECT ?, ?, 'reporter', 'write', ? WHERE EXISTS (SELECT 1 FROM security_cases WHERE id = ?)",
      )
      .bind(caseId, reporter.githubId, at, caseId),
    // The reporter's receipt: generic, and it asks for no acknowledgment.
    notifySecurityReportReceived(deps.db, caseId),
    ...inboxStatements(deps, {
      caseId,
      revision: 1,
      kind,
      idempotencyKey,
      reporterGithubId: reporter.githubId,
      detail: {},
      terms,
    }),
    ...transitionStatements(
      deps,
      row,
      {
        state: "receipt-verified",
        set: {
          case_id: caseId,
          advisory_ghsa: facts.ghsa,
          github_created_at: receivedAt,
          evidence_digest: facts.evidenceDigest,
        },
        kind: "receipt-verified",
        detail: { caseId, advisory: facts.ghsa },
        actorGithubId: null,
      },
      at,
    ),
  ];
  let results: Awaited<ReturnType<typeof deps.db.batch>>;
  try {
    results = await deps.db.batch(statements);
  } catch (error) {
    if (!/UNIQUE/iu.test(error instanceof Error ? error.message : ""))
      throw error;
    // A concurrent request for this same submission won: its event took the
    // next revision. Answer with its outcome, never with already-recorded.
    return failAlreadyRecorded(deps, row);
  }
  const updated = (await loadSubmission(deps, row.id)) as SubmissionRow;
  // Another request may have verified the same receipt first.
  if (
    results[results.length - 2]?.meta?.changes !== 1 &&
    updated.state !== "receipt-verified"
  )
    fail(409, "stale_revision", "The submission changed since you loaded it");
  // The owner's private AI analysis reads the content GitHub returned to this
  // request, in memory; no second credential or read is needed.
  if (updated.case_id)
    await scheduleAnalysis(deps, updated.case_id, {
      summary: facts.analysisInput.summary,
      description: facts.analysisInput.description,
      severity: facts.analysisInput.severity ?? null,
      cvss: facts.analysisInput.cvss ?? null,
      cweIds: facts.analysisInput.cweIds ?? [],
      packages: [],
    });
  return { status: 200, row: updated };
}

/** §3: send one private report. Returns state only; never the content. */
async function sendSubmission(
  request: Request,
  deps: SecurityApiDependencies,
  intake: IntakeConfig,
  id: string,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  await requireNewParticipation(deps, actor.githubId);
  const loaded = await ownSubmission(deps, id, actor);
  const body = await readBody(request);
  exactKeys(body, ["expectedRevision"], ["report"]);
  const expected = expectedRevision(body);
  // A replay of a send already made from this revision returns the state.
  if (expected < loaded.revision) {
    const sent = await deps.db
      .prepare(
        "SELECT 1 AS found FROM security_submission_events WHERE submission_id = ? AND revision = ? AND kind = 'send'",
      )
      .bind(loaded.id, expected + 1)
      .first<{ found: number }>();
    const row = await settle(deps, loaded);
    if (sent !== null)
      return grantResponse(deps, actor, 200, row, { replayed: true });
    fail(409, "stale_revision", "The submission changed since you loaded it");
  }
  if (expected !== loaded.revision)
    fail(409, "stale_revision", "The submission changed since you loaded it");
  const row = await settle(deps, loaded);
  if (row.origin !== "slop")
    fail(409, "action_not_allowed", "Verify a direct report instead");
  if (row.state === "uncertain")
    fail(
      409,
      "reconcile_required",
      "Check GitHub for this submission before sending again",
    );
  if (row.state === "submitting")
    fail(409, "submission_in_progress", "This submission is being sent");
  if (row.state === "abandoned")
    fail(409, "submission_abandoned", "This submission expired; start again");
  if (
    row.state === "submitted" ||
    row.state === "receipt-verified" ||
    row.advisory_ghsa !== null
  )
    fail(409, "already_submitted", "GitHub already has this report");
  if (
    row.state === "failed" &&
    TERMINAL_FAILURES.includes(row.failure_code as FailureCode)
  )
    fail(409, "submission_closed", "This submission cannot be sent again");
  const gate = await storedIntake(deps, row.id);
  const storedReport = await approvedReportForForward(deps, row.id);
  if (storedReport && body.report !== undefined)
    fail(
      400,
      "invalid_request",
      "Forward the saved report without replacement text.",
    );
  const report = storedReport ?? parseReportInput(body.report);
  const terms = await programTerms(deps, row.project_id);
  if (terms.intake.repository.toLowerCase() !== row.repository.toLowerCase())
    fail(409, "intake_changed", "The program's intake changed; start again");
  const grant = await requireGrant(request, deps, intake, row);
  if ((await pvrState(deps, row.project_id)) !== "ready")
    fail(
      409,
      "intake_unavailable",
      "Private reporting could not be verified; your draft is kept",
    );
  if (!storedReport)
    await screenLegacyReport(deps, row.project_id, report, actor.githubId);
  // The send is recorded before GitHub is called; a lost answer is uncertain.
  let sending: SubmissionRow | null;
  try {
    sending = await transition(deps, row, {
      state: "submitting",
      set: {
        attempt: row.attempt + 1,
        attempt_started_at: deps.now().toISOString(),
      },
      kind: "send",
      ...(gate
        ? {
            guard: {
              sql: "EXISTS(SELECT 1 FROM security_submission_intake WHERE submission_id=? AND revision=? AND (review_decision='forward' OR (review_decision IS NULL AND screening_state='legitimate')))",
              values: [row.id, gate.revision],
            },
          }
        : {}),
      detail: { attempt: row.attempt + 1 },
      actorGithubId: actor.githubId,
    });
  } catch (error) {
    if (!/UNIQUE/iu.test(error instanceof Error ? error.message : ""))
      throw error;
    fail(
      409,
      "submission_in_flight",
      "Another submission for this program is being sent",
    );
  }
  if (sending === null) {
    await requireNewParticipation(deps, actor.githubId);
    fail(409, "stale_revision", "The submission changed since you loaded it");
  }
  const result = await intake.advisories.createReport(
    grant,
    sending.repository,
    report,
    markerLine(sending.marker),
  );
  if (result.kind === "rejected") {
    const failed = await transition(deps, sending, {
      state: "failed",
      set: { failure_code: result.code },
      kind: "rejected",
      detail: { code: result.code },
      actorGithubId: null,
    });
    return grantResponse(deps, actor, 200, failed ?? sending);
  }
  if (result.kind === "rate-limited") {
    // GitHub throttled the request and kept no copy. The draft reopens for a
    // later send; the reporter's rights are not in question.
    const throttled = await transition(deps, sending, {
      state: "draft",
      kind: "rate-limited",
      detail: { retryAfterSeconds: result.retryAfterSeconds },
      actorGithubId: null,
    });
    return grantResponse(deps, actor, 200, throttled ?? sending, {
      rateLimited: { retryAfterSeconds: result.retryAfterSeconds },
    });
  }
  if (result.kind === "uncertain") {
    const uncertain = await transition(deps, sending, {
      state: "uncertain",
      kind: "uncertain",
      actorGithubId: null,
    });
    return grantResponse(deps, actor, 202, uncertain ?? sending);
  }
  // A resend may race a copy from an earlier attempt that landed late; the
  // binding is set once, so the earliest copy is chosen before it is set.
  const copies =
    sending.attempt > 1
      ? await earlierCopies(deps, intake, sending, grant, result.facts)
      : [result.facts];
  const adopted = copies[0];
  let submitted: SubmissionRow | null = null;
  try {
    submitted = await transition(deps, sending, {
      state: "submitted",
      set: {
        advisory_ghsa: adopted.ghsa,
        github_created_at: adopted.createdAt,
        evidence_digest: adopted.evidenceDigest,
      },
      ...(copies.length > 1
        ? {
            kind: "duplicate-advisories",
            detail: {
              advisory: adopted.ghsa,
              ghsas: copies.slice(1).map((copy) => copy.ghsa),
            },
          }
        : { kind: "created", detail: { advisory: adopted.ghsa } }),
      actorGithubId: null,
    });
  } catch (error) {
    if (!/UNIQUE/iu.test(error instanceof Error ? error.message : ""))
      throw error;
  }
  if (submitted === null) {
    // Another writer moved the row (or holds the advisory): never resend.
    const current = (await loadSubmission(deps, sending.id)) as SubmissionRow;
    if (current.state === "submitting")
      await transition(deps, current, {
        state: "uncertain",
        kind: "uncertain",
        actorGithubId: null,
      });
    return grantResponse(
      deps,
      actor,
      202,
      (await loadSubmission(deps, sending.id)) as SubmissionRow,
    );
  }
  const verified = await verifyReceipt(deps, intake, submitted, grant);
  return grantResponse(deps, actor, verified.status, verified.row);
}

/** When the first send of this submission began; the listing starts there. */
async function firstAttemptAt(
  deps: SecurityApiDependencies,
  row: SubmissionRow,
): Promise<string> {
  const first = await deps.db
    .prepare(
      "SELECT MIN(at) AS at FROM security_submission_events WHERE submission_id = ? AND kind = 'send'",
    )
    .bind(row.id)
    .first<{ at: string | null }>();
  return first?.at ?? row.attempt_started_at ?? row.updated_at;
}

function sinceFirstAttempt(at: string): string {
  return new Date(Date.parse(at) - RECONCILE_WINDOW_MS).toISOString();
}

/**
 * After a resend that GitHub accepted, lists the reporter's copies since the
 * first attempt, earliest first, always including the accepted one. A late
 * copy from an earlier attempt then becomes the receipt and the rest are
 * recorded as duplicates for the technical approvers, as reconcile does. A
 * failed listing keeps only the accepted copy.
 */
async function earlierCopies(
  deps: SecurityApiDependencies,
  intake: IntakeConfig,
  row: SubmissionRow,
  grant: ReporterGrant,
  accepted: AdvisoryFacts,
): Promise<AdvisoryFacts[]> {
  const listing = await intake.advisories.findByMarker(
    grant,
    row.repository,
    markerLine(row.marker),
    sinceFirstAttempt(await firstAttemptAt(deps, row)),
  );
  if (listing.kind === "error") return [accepted];
  return earliestFirst([
    accepted,
    ...listing.matches.filter(
      (match) =>
        match.authorId === row.reporter_github_id &&
        match.ghsa !== accepted.ghsa,
    ),
  ]);
}

function earliestFirst(matches: AdvisoryFacts[]): AdvisoryFacts[] {
  return [...matches].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.ghsa.localeCompare(b.ghsa),
  );
}

/**
 * §5: find an uncertain submission on GitHub before any retry. Only a
 * complete listing with no copy reopens the draft for a second send.
 */
async function reconcileSubmission(
  request: Request,
  deps: SecurityApiDependencies,
  intake: IntakeConfig,
  id: string,
): Promise<Response> {
  const { actor, loaded } = await ownSubmissionAtRevision(request, deps, id);
  let row = await settle(deps, loaded);
  if (row.state === "submitting")
    fail(409, "submission_in_progress", "This submission is being sent");
  if (row.state !== "uncertain" && row.state !== "submitted")
    fail(409, "nothing_to_reconcile", "This submission is not uncertain");
  const grant = await requireGrant(request, deps, intake, row);
  if (row.state === "uncertain" && row.advisory_ghsa === null) {
    const listing = await intake.advisories.findByMarker(
      grant,
      row.repository,
      markerLine(row.marker),
      sinceFirstAttempt(await firstAttemptAt(deps, row)),
    );
    if (listing.kind === "error") {
      const unchanged = await transition(deps, row, {
        state: "uncertain",
        kind: "reconcile-inconclusive",
        actorGithubId: actor.githubId,
      });
      return grantResponse(deps, actor, 202, unchanged ?? row);
    }
    const matches = earliestFirst(
      listing.matches.filter(
        (match) => match.authorId === row.reporter_github_id,
      ),
    );
    if (
      matches.length === 0 &&
      deps.now().getTime() -
        Date.parse(row.attempt_started_at ?? row.updated_at) <
        RECONCILE_QUIET_MS
    ) {
      // Too soon to trust an empty listing: the send may still be landing.
      const unchanged = await transition(deps, row, {
        state: "uncertain",
        kind: "reconcile-too-early",
        actorGithubId: actor.githubId,
      });
      return grantResponse(deps, actor, 202, unchanged ?? row);
    }
    if (matches.length === 0) {
      const draft = await transition(deps, row, {
        state: "draft",
        kind: "reconcile-empty",
        actorGithubId: actor.githubId,
      });
      return grantResponse(deps, actor, 200, draft ?? row);
    }
    const adopted = matches[0];
    const next = await transition(deps, row, {
      state: "submitted",
      set: {
        advisory_ghsa: adopted.ghsa,
        github_created_at: adopted.createdAt,
        evidence_digest: adopted.evidenceDigest,
      },
      kind: matches.length > 1 ? "duplicate-advisories" : "reconcile-matched",
      detail:
        matches.length > 1
          ? {
              advisory: adopted.ghsa,
              ghsas: matches.slice(1).map((match) => match.ghsa),
            }
          : { advisory: adopted.ghsa },
      actorGithubId: actor.githubId,
    });
    if (next === null)
      fail(409, "stale_revision", "The submission changed since you loaded it");
    row = next;
  }
  const verified = await verifyReceipt(deps, intake, row, grant);
  return grantResponse(deps, actor, verified.status, verified.row);
}

/** §7: verify a report the reporter filed directly on GitHub. */
async function verifyDirect(
  request: Request,
  deps: SecurityApiDependencies,
  intake: IntakeConfig,
  id: string,
): Promise<Response> {
  const { actor, loaded } = await ownSubmissionAtRevision(request, deps, id);
  const row = await settle(deps, loaded);
  if (row.origin !== "direct" || row.state !== "draft")
    fail(409, "action_not_allowed", "This submission cannot be verified now");
  const grant = await requireGrant(request, deps, intake, row);
  const verified = await verifyReceipt(deps, intake, row, grant);
  return grantResponse(deps, actor, verified.status, verified.row);
}

async function listSubmissions(
  request: Request,
  deps: SecurityApiDependencies,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  const result = await deps.db
    .prepare(
      `SELECT ${COLUMNS} FROM security_submissions WHERE reporter_github_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
    .bind(actor.githubId)
    .all<SubmissionRow>();
  const rows: SubmissionRow[] = [];
  for (const row of result.results ?? []) rows.push(await settle(deps, row));
  return json(200, {
    recipientGithubId: actor.githubId,
    automatic: true,
    submissions: rows.map(submissionView),
  });
}

export async function handleSubmissionRoute(
  request: Request,
  deps: SecurityApiDependencies,
  parts: string[],
): Promise<Response> {
  if (request.method === "POST" && parts.length === 1) {
    const body = await readBody(request.clone());
    if (Object.hasOwn(body, "report")) {
      if (!deps.reportStorage || deps.reportIntakeEnabled === false)
        fail(
          503,
          "intake_unavailable",
          "Private report storage is unavailable.",
        );
      return acceptStoredReport(request, deps, body);
    }
    if (deps.reportStorage && body.origin === "slop")
      fail(
        400,
        "report_required",
        "Submit the complete private report through Slop.",
      );
  }
  if (request.method === "GET" && parts.length === 2)
    return readStoredIntake(request, deps, parts[1]);
  if (
    request.method === "POST" &&
    parts.length === 3 &&
    ["screen", "review", "report"].includes(parts[2])
  )
    return actStoredIntake(request, deps, parts[1], parts[2]);
  if (request.method === "GET" && parts.length === 1 && deps.reportStorage)
    return listStoredSubmissions(request, deps);
  // The signed-in list answers in every mode so the case page can tell
  // whether to offer automatic intake without a failed request. It never
  // reads submissions while intake is off.
  if (request.method === "GET" && parts.length === 1) {
    if (deps.intake?.mode !== "on") {
      const actor = await requireActor(request, deps);
      return json(200, {
        recipientGithubId: actor.githubId,
        automatic: false,
        submissions: [],
      });
    }
    return listSubmissions(request, deps);
  }
  const intake = intakeOn(deps);
  if (request.method === "POST" && parts.length === 1)
    return createSubmission(request, deps, intake);
  if (
    request.method === "GET" &&
    parts.length === 3 &&
    parts[1] === "authorize" &&
    parts[2] === "callback"
  )
    return authorizationCallback(request, deps, intake);
  if (request.method === "POST" && parts.length === 3) {
    if (parts[2] === "authorize")
      return authorizeSubmission(request, deps, intake, parts[1]);
    if (parts[2] === "send")
      return sendSubmission(request, deps, intake, parts[1]);
    if (parts[2] === "reconcile")
      return reconcileSubmission(request, deps, intake, parts[1]);
    if (parts[2] === "verify")
      return verifyDirect(request, deps, intake, parts[1]);
  }
  notFound();
}
