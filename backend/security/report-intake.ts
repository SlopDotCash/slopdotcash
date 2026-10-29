/** Durable private reports. Slop's receipt is independent of GitHub delivery. */
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { readBoundedBytes, readBoundedJson } from "../../src/lib/browser-json";
import type { GithubActor } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type { D1QueryStatement } from "../d1";
import { chunked, exactKeys, fail, PROJECT_ID, requireActor } from "../http";
import { notifySecurityReportReceived } from "../notifications/events";
import { PARTICIPATION_BAN_QUERY } from "../projects/account-bans";
import {
  ANALYSIS_TIMEOUT_MS,
  BACKGROUND_ANALYSIS_TIMEOUT_MS,
  type SecurityAnalysisInput,
  type SecurityAnalysisReport,
  type SecurityScreeningProposal,
} from "./analysis";
import { parseReportInput, type ReportInput } from "./github-advisories";
import {
  type CaseRow,
  caseInsertStatement,
  caseRoles,
  eventStatement,
  IDEMPOTENCY_KEY,
  json,
  loadCase,
  type Role,
  reportingContext,
  type SecurityApiDependencies,
  stringField,
  termsAtReceipt,
} from "./handler";
import {
  reportingAuthorityUnavailable,
  repositoryReportingAuthority,
} from "./project-access";
import {
  COLUMNS,
  loadSubmission,
  type SubmissionRow,
  settle,
  submissionView,
} from "./submissions";

export type IntakeState =
  | "queued"
  | "running"
  | "legitimate"
  | "needs-information"
  | "spam"
  | "unavailable";
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
const MAX_REPORT_BYTES = 256 * 1024;
const LOST_SCREEN_MS = 15 * 60 * 1000;
const encoder = new TextEncoder();

/** Rolling admission precedes object writes and paid calls, including retries. */
async function admitPublicWork(
  deps: SecurityApiDependencies,
  actorId: string,
  id = `iw_${deps.randomId().replaceAll("-", "")}`,
) {
  const now = deps.now().getTime();
  const cutoff = now - 3_600_000;
  const result = await deps.db.batch([
    deps.db
      .prepare(
        "DELETE FROM security_intake_rate_admissions WHERE actor_github_id=? AND admitted_at<=?",
      )
      .bind(actorId, cutoff),
    deps.db
      .prepare(
        "INSERT INTO security_intake_rate_admissions(id,actor_github_id,admitted_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM security_intake_rate_admissions WHERE actor_github_id=?) + (SELECT COUNT(*) FROM security_submission_intake i JOIN security_submissions s ON s.id=i.submission_id WHERE s.reporter_github_id=? AND i.received_at>? AND NOT EXISTS(SELECT 1 FROM security_intake_rate_admissions a WHERE a.id=i.submission_id)) < 10",
      )
      .bind(id, actorId, now, actorId, actorId, new Date(cutoff).toISOString()),
  ]);
  if (result[1].meta?.changes !== 1)
    fail(
      429,
      "intake_rate_limited",
      "Please wait before requesting more private report work.",
    );
}

export async function storedIntake(
  deps: Pick<SecurityApiDependencies, "db">,
  id: string,
): Promise<StoredIntake | null> {
  return deps.db
    .prepare("SELECT * FROM security_submission_intake WHERE submission_id = ?")
    .bind(id)
    .first<StoredIntake>();
}
export function intakeQualified(row: StoredIntake): boolean {
  return (
    row.review_decision === "forward" ||
    (row.review_decision === null && row.screening_state === "legitimate")
  );
}
function screeningRecoverable(row: StoredIntake, now: Date): boolean {
  return (
    ["queued", "unavailable"].includes(row.screening_state) ||
    (row.screening_state === "running" &&
      now.getTime() - Date.parse(row.screening_started_at ?? row.received_at) >
        LOST_SCREEN_MS)
  );
}
function intakeView(
  row: StoredIntake,
  roles: Set<Role>,
  submission: SubmissionRow,
  now: Date,
) {
  const reporter = roles.has("reporter");
  return {
    state:
      row.review_decision === "request-information"
        ? "needs-information"
        : row.screening_state,
    receivedAt: row.received_at,
    revision: row.revision,
    reportVersion: row.report_version,
    routingState: row.routed_at ? "routed" : "pending",
    reason: row.review_reason ?? row.screening_reason,
    reviewedAt: row.reviewed_at,
    canReview: roles.has("security-maintainer"),
    canForward: intakeQualified(row),
    canRetryScreening: intakeQualified(row)
      ? row.routed_at === null
      : row.review_decision === null && screeningRecoverable(row, now),
    canAuthorize:
      reporter && intakeQualified(row) && submission.advisory_ghsa === null,
    canRevise:
      reporter &&
      (row.review_decision === "request-information" ||
        ["needs-information", "spam", "unavailable"].includes(
          row.screening_state,
        )) &&
      submission.advisory_ghsa === null,
  };
}
async function accessFor(
  deps: SecurityApiDependencies,
  row: StoredIntake,
  actor: GithubActor,
) {
  const record = await loadCase(deps, row.case_id);
  if (!record) fail(404, "not_found", "Report not found");
  return { record, roles: await caseRoles(deps, record, actor) };
}
function decorateStoredSubmission(
  row: SubmissionRow,
  stored: StoredIntake,
  record: CaseRow,
  roles: Set<Role>,
  now: Date,
) {
  const view = intakeView(stored, roles, row, now);
  view.canRevise =
    (view.canRevise || record.receipt_state === "needs-information") &&
    roles.has("reporter") &&
    ["draft", "failed"].includes(row.state) &&
    ["received", "needs-information", "triaging"].includes(
      record.receipt_state,
    ) &&
    !["approved", "reserved"].includes(record.award_state);
  return { ...submissionView(row), intake: view };
}
export async function decorateSubmission(
  deps: SecurityApiDependencies,
  row: SubmissionRow,
  actor: GithubActor,
) {
  const stored = await storedIntake(deps, row.id);
  if (!stored) return { ...submissionView(row), intake: null };
  const { record, roles } = await accessFor(deps, stored, actor);
  return decorateStoredSubmission(row, stored, record, roles, deps.now());
}
export async function storedIntakeViewForCase(
  deps: SecurityApiDependencies,
  caseId: string,
  roles: Set<Role>,
) {
  const stored = await deps.db
    .prepare("SELECT * FROM security_submission_intake WHERE case_id = ?")
    .bind(caseId)
    .first<StoredIntake>();
  if (!stored) return null;
  const row = await loadSubmission(deps, stored.submission_id);
  if (!row) return null;
  return {
    submissionId: row.id,
    ...intakeView(stored, roles, row, deps.now()),
  };
}

/**
 * The same intake view for many cases in a fixed number of statements. The
 * list route shapes up to 500 cases, so a per-case read would dominate it.
 */
export async function storedIntakeViewsForCases(
  deps: SecurityApiDependencies,
  rolesByCase: ReadonlyMap<string, Set<Role>>,
) {
  const views = new Map<
    string,
    Awaited<ReturnType<typeof storedIntakeViewForCase>>
  >();
  const caseIds = [...rolesByCase.keys()];
  for (const caseId of caseIds) views.set(caseId, null);
  const stored = new Map<string, StoredIntake>();
  for (const part of chunked(caseIds)) {
    const rows = await deps.db
      .prepare(
        `SELECT * FROM security_submission_intake WHERE case_id IN (${part
          .map(() => "?")
          .join(",")})`,
      )
      .bind(...part)
      .all<StoredIntake>();
    for (const row of rows.results ?? []) stored.set(row.case_id, row);
  }
  const submissions = new Map<string, SubmissionRow>();
  for (const part of chunked([
    ...new Set([...stored.values()].map((row) => row.submission_id)),
  ])) {
    const rows = await deps.db
      .prepare(
        `SELECT ${COLUMNS} FROM security_submissions WHERE id IN (${part
          .map(() => "?")
          .join(",")})`,
      )
      .bind(...part)
      .all<SubmissionRow>();
    for (const row of rows.results ?? []) submissions.set(row.id, row);
  }
  const now = deps.now();
  for (const [caseId, row] of stored) {
    const submission = submissions.get(row.submission_id);
    if (!submission) continue;
    views.set(caseId, {
      submissionId: submission.id,
      ...intakeView(row, rolesByCase.get(caseId) ?? new Set(), submission, now),
    });
  }
  return views;
}

async function reportVersion(
  deps: SecurityApiDependencies,
  row: StoredIntake,
): Promise<ReportInput> {
  const reference = await deps.db
    .prepare(
      "SELECT object_key,content_sha256,byte_count FROM security_intake_reports WHERE submission_id=? AND version=?",
    )
    .bind(row.submission_id, row.report_version)
    .first<{
      object_key: string;
      content_sha256: string;
      byte_count: number;
    }>();
  if (
    !reference ||
    !deps.reportStorage ||
    !reference.object_key.startsWith("security-reports/")
  )
    fail(
      503,
      "report_unavailable",
      "The private report is unavailable. Retry later.",
    );
  const object = await deps.reportStorage.get(reference.object_key);
  if (!object || object.size !== reference.byte_count)
    fail(
      503,
      "report_unavailable",
      "The private report is unavailable. Retry later.",
    );
  const bytes = await readBoundedBytes(
    new Response(object.body),
    MAX_REPORT_BYTES,
    "Private report",
  );
  if (
    bytes.byteLength !== reference.byte_count ||
    (await sha256Hex(bytes)) !== reference.content_sha256
  )
    fail(
      503,
      "report_unavailable",
      "The private report could not be verified.",
    );
  return parseReportInput(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
}
export async function readStoredReportByCase(
  deps: SecurityApiDependencies,
  caseId: string,
): Promise<SecurityAnalysisReport | null> {
  const stored = await deps.db
    .prepare("SELECT * FROM security_submission_intake WHERE case_id=?")
    .bind(caseId)
    .first<StoredIntake>();
  if (!stored) return null;
  const report = await reportVersion(deps, stored);
  return analysisReport(report);
}
function analysisReport(report: ReportInput): SecurityAnalysisReport {
  return {
    summary: report.summary,
    description: report.description,
    severity: report.severity ?? null,
    cvss: report.cvssVectorString ?? null,
    cweIds: [...(report.cweIds ?? [])],
    packages: [],
  };
}
async function storeReport(
  deps: SecurityApiDependencies,
  id: string,
  version: number,
  report: ReportInput,
) {
  if (!deps.reportStorage)
    fail(503, "intake_unavailable", "Private report storage is unavailable.");
  const bytes = encoder.encode(JSON.stringify(report));
  if (bytes.byteLength > MAX_REPORT_BYTES)
    fail(413, "report_too_large", "The private report is too large.");
  const digest = await sha256Hex(bytes);
  const key = `security-reports/${id}/${version}-${digest}.json`;
  await deps.reportStorage.put(key, bytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256: digest },
    onlyIf: { etagDoesNotMatch: "*" },
  });
  const head = await deps.reportStorage.head(key);
  if (
    !head ||
    head.size !== bytes.byteLength ||
    head.customMetadata?.sha256 !== digest
  )
    fail(
      503,
      "report_unavailable",
      "Private report storage did not confirm the upload.",
    );
  return { key, digest, bytes: bytes.byteLength };
}
function intakeEvent(
  deps: SecurityApiDependencies,
  row: StoredIntake,
  kind: string,
  actor: string | null,
  at: string,
): D1QueryStatement {
  return deps.db
    .prepare(
      "INSERT INTO security_intake_events(submission_id,revision,kind,actor_github_id,at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM security_submission_intake WHERE submission_id=? AND revision=?)",
    )
    .bind(
      row.submission_id,
      row.revision + 1,
      kind,
      actor,
      at,
      row.submission_id,
      row.revision + 1,
    );
}
async function routedNotice(
  deps: SecurityApiDependencies,
  row: StoredIntake,
  actorId: string | null,
): Promise<void> {
  if (!intakeQualified(row) || row.routed_at) return;
  const submission = await loadSubmission(deps, row.submission_id);
  if (!submission) return;
  const context = await reportingContext(
    deps,
    submission.project_id,
    true,
    true,
  );
  const at = deps.now().toISOString();
  // Private routing contains only a case reference. The worker rechecks roles.
  const recipients = context.approvers.technical.filter(
    (x) =>
      x.githubId !== actorId && x.githubId !== submission.reporter_github_id,
  );
  // The sole owner may have just reviewed the report here. That completes
  // routing without mailing their own action back to them. Missing contacts
  // still leave routing pending so it can recover when access returns.
  if (
    recipients.length === 0 &&
    !context.approvers.technical.some((x) => x.githubId === actorId)
  )
    return;
  await deps.db.batch([
    ...recipients.map((x) =>
      deps.db
        .prepare(
          "INSERT INTO notifications(event_key,recipient_github_id,kind,subject,detail,action_path,source_at,created_at) SELECT ?,?,'security_case',?,NULL,?, ?,? WHERE EXISTS(SELECT 1 FROM security_submission_intake WHERE submission_id=? AND revision=? AND (review_decision='forward' OR (review_decision IS NULL AND screening_state='legitimate'))) ON CONFLICT(event_key,recipient_github_id) DO NOTHING",
        )
        .bind(
          `security-route:${row.submission_id}:${row.report_version}`,
          x.githubId,
          row.case_id,
          `/inbox?submission=${row.submission_id}`,
          at,
          at,
          row.submission_id,
          row.revision,
        ),
    ),
    deps.db
      .prepare(
        "UPDATE security_submission_intake SET routed_at=?,revision=revision+1 WHERE submission_id=? AND revision=?",
      )
      .bind(at, row.submission_id, row.revision),
    intakeEvent(deps, row, "routed", null, at),
  ]);
}

/** Called only after persisted receipt; failures leave a visible, retryable state. */
export async function screenStoredReport(
  deps: SecurityApiDependencies,
  id: string,
  timeoutMs = ANALYSIS_TIMEOUT_MS,
): Promise<void> {
  let row = await storedIntake(deps, id);
  if (!row) return;
  if (intakeQualified(row)) {
    await routedNotice(deps, row, null);
    return;
  }
  if (row.review_decision !== null) return;
  if (!screeningRecoverable(row, deps.now())) return;
  const at = deps.now().toISOString();
  const claimed = await deps.db.batch([
    deps.db
      .prepare(
        "UPDATE security_submission_intake SET screening_state='running',screening_started_at=?,screening_finished_at=NULL,screening_reason=NULL,screening_provider=?,screening_model=?,revision=revision+1 WHERE submission_id=? AND revision=?",
      )
      .bind(
        at,
        deps.analyzer?.provider ?? null,
        deps.analyzer?.model ?? null,
        id,
        row.revision,
      ),
    intakeEvent(deps, row, "screen-start", null, at),
  ]);
  if (claimed[0].meta?.changes !== 1) return;
  row = (await storedIntake(deps, id)) as StoredIntake;
  let state: IntakeState = "unavailable";
  let reason =
    "Automatic screening is unavailable. Your report is saved for retry or private human review.";
  try {
    if (deps.analyzer?.screen) {
      const submission = (await loadSubmission(deps, id)) as SubmissionRow;
      const record = await loadCase(deps, row.case_id);
      const manifest =
        record?.policy_revision === null
          ? null
          : await deps.db
              .prepare(
                "SELECT manifest FROM project_revisions WHERE project_id=? AND revision=?",
              )
              .bind(submission.project_id, record?.policy_revision)
              .first<{ manifest: string }>();
      const scope = manifest
        ? JSON.parse(manifest.manifest).securityBounty?.scope
        : null;
      const input: SecurityAnalysisInput = {
        report: analysisReport(await reportVersion(deps, row)),
        scope: scope
          ? {
              includedAssets: scope.includedAssets,
              severityRubric: scope.severityRubric,
              lossDefinition: scope.lossDefinition,
            }
          : null,
        priorCases: [],
      };
      const proposal = await deps.analyzer.screen(input, timeoutMs);
      if (
        !["legitimate", "needs-information", "spam"].includes(
          proposal.decision,
        ) ||
        typeof proposal.reason !== "string" ||
        !proposal.reason.trim()
      )
        throw new Error("Invalid screening result");
      state = proposal.decision;
      reason = proposal.reason.trim().slice(0, 2000);
    }
  } catch {
    /* Do not expose provider errors or private evidence. */
  }
  const finished = deps.now().toISOString();
  await deps.db.batch([
    deps.db
      .prepare(
        "UPDATE security_submission_intake SET screening_state=?,screening_reason=?,screening_finished_at=?,revision=revision+1 WHERE submission_id=? AND revision=? AND screening_state='running'",
      )
      .bind(state, reason, finished, id, row.revision),
    intakeEvent(deps, row, "screen-finish", null, finished),
  ]);
  const updated = await storedIntake(deps, id);
  if (updated && intakeQualified(updated))
    await routedNotice(deps, updated, null);
}
async function scheduleScreen(deps: SecurityApiDependencies, id: string) {
  const run = screenStoredReport(
    deps,
    id,
    deps.waitUntil ? BACKGROUND_ANALYSIS_TIMEOUT_MS : ANALYSIS_TIMEOUT_MS,
  ).catch(() => undefined);
  if (deps.waitUntil) deps.waitUntil(run);
  else await run;
}

/** An unfinished legacy browser draft still passes the same screen before any forwarding. */
export async function screenLegacyReport(
  deps: SecurityApiDependencies,
  projectId: string,
  report: ReportInput,
  actorId: string,
) {
  if (!deps.analyzer?.screen)
    fail(
      503,
      "screening_unavailable",
      "Automatic screening is unavailable. Your draft is kept.",
    );
  const current = await deps.db
    .prepare("SELECT manifest FROM projects WHERE id=?")
    .bind(projectId)
    .first<{ manifest: string }>();
  const scope = current
    ? JSON.parse(current.manifest).securityBounty?.scope
    : null;
  await admitPublicWork(deps, actorId);
  let proposal: SecurityScreeningProposal;
  try {
    proposal = await deps.analyzer.screen(
      {
        report: analysisReport(report),
        scope: scope
          ? {
              includedAssets: scope.includedAssets,
              severityRubric: scope.severityRubric,
              lossDefinition: scope.lossDefinition,
            }
          : null,
        priorCases: [],
      },
      ANALYSIS_TIMEOUT_MS,
    );
  } catch {
    fail(
      503,
      "screening_unavailable",
      "Automatic screening is unavailable. Your draft is kept.",
    );
  }
  if (proposal.decision !== "legitimate")
    fail(
      409,
      "screening_required",
      "This draft needs more evidence or a private maintainer review before forwarding. Submit it through Slop to track that review.",
    );
}

export async function acceptStoredReport(
  request: Request,
  deps: SecurityApiDependencies,
  body: Record<string, unknown>,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  if (!deps.reportStorage || deps.reportIntakeEnabled === false)
    fail(
      503,
      "intake_unavailable",
      "New private report intake is unavailable. Existing reports are retained.",
    );
  exactKeys(
    body,
    ["projectId", "idempotencyKey", "origin", "report"],
    ["expectedReporterGithubId"],
  );
  if (
    body.expectedReporterGithubId !== undefined &&
    body.expectedReporterGithubId !== actor.githubId
  )
    fail(
      403,
      "reporter_changed",
      "Your account changed. Sign in again before submitting this report.",
    );
  if (body.origin !== "slop")
    fail(400, "invalid_request", "A Slop report must use the Slop origin.");
  const projectId = stringField(body, "projectId", PROJECT_ID);
  const idem = stringField(body, "idempotencyKey", IDEMPOTENCY_KEY);
  const report = parseReportInput(body.report);
  const digest = await sha256Hex(encoder.encode(JSON.stringify(report)));
  const prior = await deps.db
    .prepare(
      `SELECT ${COLUMNS} FROM security_submissions WHERE reporter_github_id=? AND idempotency_key=?`,
    )
    .bind(actor.githubId, idem)
    .first<SubmissionRow>();
  if (prior) {
    const version = await deps.db
      .prepare(
        "SELECT content_sha256 FROM security_intake_reports WHERE submission_id=? AND version=1",
      )
      .bind(prior.id)
      .first<{ content_sha256: string }>();
    if (prior.project_id !== projectId || version?.content_sha256 !== digest)
      fail(409, "idempotency_conflict", "That request key was already used.");
    return json(200, {
      replayed: true,
      submission: await decorateSubmission(deps, prior, actor),
    });
  }
  const context = await reportingContext(deps, projectId);
  const at = deps.now().toISOString();
  const banned = await deps.db
    .prepare(`SELECT 1 AS banned WHERE EXISTS(${PARTICIPATION_BAN_QUERY})`)
    .bind(actor.githubId)
    .first();
  if (banned)
    fail(
      403,
      "participation_banned",
      "This account cannot submit a new report.",
    );
  const id = `ss_${deps.randomId().replaceAll("-", "")}`;
  await admitPublicWork(deps, actor.githubId, id);
  const caseId = `sc_${deps.randomId().replaceAll("-", "")}`;
  const marker = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
  const stored = await storeReport(deps, id, 1, report);
  const frozen = await termsAtReceipt(deps, projectId, at);
  const guard = {
    sql: `NOT EXISTS (${PARTICIPATION_BAN_QUERY})`,
    values: [actor.githubId],
  };
  const statements = [
    caseInsertStatement(deps, {
      id: caseId,
      projectId,
      repository: context.intake.repository,
      advisory: null,
      reporter: actor,
      verified: {
        receivedAt: at,
        verifiedBy: "slop",
        policyRevision: frozen.revision,
        terms: frozen.terms,
        source: "slop-received",
        receiptEvidenceDigest: stored.digest,
      },
      ownerGithubId: context.approvers.technical[0]?.githubId ?? null,
      nextAction: "Review the saved private report",
      at,
      guard,
    }),
    deps.db
      .prepare(
        `INSERT INTO security_submissions (${COLUMNS}) SELECT ?,?,?,?,?,?,?,?,'draft',0,NULL,NULL,NULL,NULL,NULL,?,1,?,? WHERE EXISTS(SELECT 1 FROM security_cases WHERE id=?)`,
      )
      .bind(
        id,
        projectId,
        context.intake.repository,
        actor.githubId,
        actor.githubLogin,
        "slop",
        idem,
        marker,
        caseId,
        at,
        at,
        caseId,
      ),
    deps.db
      .prepare(
        "INSERT INTO security_submission_events(submission_id,revision,kind,detail,actor_github_id,at) SELECT ?,1,'create',?, ?,? WHERE EXISTS(SELECT 1 FROM security_submissions WHERE id=?)",
      )
      .bind(
        id,
        JSON.stringify({ origin: "slop", durable: true }),
        actor.githubId,
        at,
        id,
      ),
    deps.db
      .prepare(
        "INSERT INTO security_submission_intake(submission_id,case_id,received_at,screening_state) SELECT ?,?,?,'queued' WHERE EXISTS(SELECT 1 FROM security_submissions WHERE id=?)",
      )
      .bind(id, caseId, at, id),
    deps.db
      .prepare(
        "INSERT INTO security_intake_reports(submission_id,version,object_key,content_sha256,byte_count,created_at) SELECT ?,1,?,?,?,? WHERE EXISTS(SELECT 1 FROM security_submissions WHERE id=?)",
      )
      .bind(id, stored.key, stored.digest, stored.bytes, at, id),
    deps.db
      .prepare(
        "INSERT INTO security_intake_events(submission_id,revision,kind,actor_github_id,at) SELECT ?,1,'receive',?,? WHERE EXISTS(SELECT 1 FROM security_submissions WHERE id=?)",
      )
      .bind(id, actor.githubId, at, id),
    eventStatement(deps, {
      caseId,
      revision: 1,
      kind: "submit",
      actor,
      role: "reporter",
      idempotencyKey: idem,
      reason: null,
      evidenceReference: null,
      detail: {
        submissionId: id,
        receivedAt: at,
        receivedAtSource: "slop-received",
      },
      at,
      guard: true,
    }),
    notifySecurityReportReceived(deps.db, caseId),
  ];
  try {
    await deps.db.batch(statements);
  } catch (error) {
    if (error instanceof Error && /UNIQUE/iu.test(error.message)) {
      const existing = await deps.db
        .prepare(
          `SELECT ${COLUMNS} FROM security_submissions WHERE reporter_github_id=? AND idempotency_key=?`,
        )
        .bind(actor.githubId, idem)
        .first<SubmissionRow>();
      const original = existing
        ? await deps.db
            .prepare(
              "SELECT content_sha256 FROM security_intake_reports WHERE submission_id=? AND version=1",
            )
            .bind(existing.id)
            .first<{ content_sha256: string }>()
        : null;
      if (
        existing &&
        existing.project_id === projectId &&
        original?.content_sha256 === digest
      )
        return json(200, {
          replayed: true,
          submission: await decorateSubmission(deps, existing, actor),
        });
      if (existing)
        fail(409, "idempotency_conflict", "That request key was already used.");
    }
    throw error;
  }
  const saved = await loadSubmission(deps, id);
  if (!saved) {
    const nowBanned = await deps.db
      .prepare(`SELECT 1 AS banned WHERE EXISTS(${PARTICIPATION_BAN_QUERY})`)
      .bind(actor.githubId)
      .first();
    if (nowBanned)
      fail(
        403,
        "participation_banned",
        "This account cannot submit a new report.",
      );
    fail(
      503,
      "intake_unavailable",
      "The private receipt could not be saved. Retry later.",
    );
  }
  await scheduleScreen(deps, id);
  return json(201, {
    submission: await decorateSubmission(deps, saved, actor),
  });
}

export async function listStoredSubmissions(
  request: Request,
  deps: SecurityApiDependencies,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  const own = (
    await deps.db
      .prepare(
        `SELECT ${COLUMNS} FROM security_submissions WHERE reporter_github_id=? ORDER BY created_at DESC LIMIT 100`,
      )
      .bind(actor.githubId)
      .all<SubmissionRow>()
  ).results;
  // Resolve current project authority before the bounded report query.
  const manifests = (
    await deps.db
      .prepare(
        "SELECT manifest FROM projects WHERE id IN (SELECT project_id FROM security_cases)",
      )
      .all<{ manifest: string }>()
  ).results;
  const projects: string[] = [];
  let authorityUnavailable = false;
  for (const { manifest: raw } of manifests) {
    const manifest = JSON.parse(raw) as ProjectDefinition;
    try {
      if (
        manifest.securityBounty
          ? manifest.securityBounty.approvers.technical.some(
              (x) => x.githubId === actor.githubId,
            )
          : await repositoryReportingAuthority(
              deps.repositoryAccess,
              manifest,
              actor,
            )
      )
        projects.push(manifest.id);
    } catch (error) {
      if (!reportingAuthorityUnavailable(error)) throw error;
      authorityUnavailable = true;
    }
  }
  const candidates = (
    await deps.db
      .prepare(
        `SELECT s.* FROM security_submissions s JOIN security_submission_intake i ON i.submission_id=s.id JOIN security_cases c ON c.id=i.case_id WHERE s.reporter_github_id<>? AND (c.id IN (SELECT case_id FROM security_case_members WHERE github_id=? AND revoked_at IS NULL)${projects.length ? " OR c.project_id IN (SELECT value FROM json_each(?))" : ""}${deps.moderatorGithubIds?.has(actor.githubId) ? " OR c.appeal_state <> 'none' OR c.related_party_review <> 'not-applicable'" : ""}) ORDER BY s.created_at DESC LIMIT 100`,
      )
      .bind(
        actor.githubId,
        actor.githubId,
        ...(projects.length ? [JSON.stringify(projects)] : []),
      )
      .all<SubmissionRow>()
  ).results;
  const rows = await Promise.all(
    own.map(async (row) => ({
      createdAt: row.created_at,
      submission: await decorateSubmission(
        deps,
        // A failed settle shows the row as stored; the next read retries it.
        await settle(deps, row).catch(() => row),
        actor,
      ),
    })),
  );
  for (const candidate of candidates) {
    try {
      const stored = await storedIntake(deps, candidate.id);
      if (!stored) fail(404, "not_found", "Report not found");
      const { record, roles } = await accessFor(deps, stored, actor);
      if (
        roles.has("security-maintainer") ||
        roles.has("triager") ||
        roles.has("dispute")
      )
        rows.push({
          createdAt: candidate.created_at,
          submission: decorateStoredSubmission(
            candidate,
            stored,
            record,
            roles,
            deps.now(),
          ),
        });
    } catch (error) {
      if (!reportingAuthorityUnavailable(error)) throw error;
      authorityUnavailable = true;
    }
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json(200, {
    recipientGithubId: actor.githubId,
    automatic: deps.intake?.mode === "on",
    storedIntake:
      Boolean(deps.reportStorage) && deps.reportIntakeEnabled !== false,
    authorityUnavailable,
    submissions: rows.map((row) => row.submission),
  });
}
async function authorizedStored(
  request: Request,
  deps: SecurityApiDependencies,
  id: string,
) {
  const actor = await requireActor(request, deps);
  const stored = await storedIntake(deps, id);
  if (!stored) fail(404, "not_found", "Report not found");
  const row = await loadSubmission(deps, id);
  if (!row) fail(404, "not_found", "Report not found");
  const { roles } = await accessFor(deps, stored, actor);
  if (
    !["reporter", "security-maintainer", "triager", "dispute"].some((role) =>
      roles.has(role as Role),
    )
  )
    fail(404, "not_found", "Report not found");
  return { actor, stored, row, roles };
}
export async function readStoredIntake(
  request: Request,
  deps: SecurityApiDependencies,
  id: string,
): Promise<Response> {
  const { actor, stored, row } = await authorizedStored(request, deps, id);
  await deps.db
    .prepare(
      "INSERT INTO security_intake_access_log(submission_id,actor_github_id,action,at) VALUES(?,?,'read',?)",
    )
    .bind(id, actor.githubId, deps.now().toISOString())
    .run();
  const submission = await decorateSubmission(
    deps,
    await settle(deps, row),
    actor,
  );
  // A receipt deep link may be outside the recent list. Resolve its metadata
  // under the same live access check without reading the technical report.
  if (new URL(request.url).searchParams.get("view") === "receipt")
    return json(200, { recipientGithubId: actor.githubId, submission });
  return json(200, {
    submission,
    report: await reportVersion(deps, stored),
  });
}
function checkRevision(body: Record<string, unknown>, stored: StoredIntake) {
  if (body.expectedRevision !== stored.revision)
    fail(409, "stale_revision", "The report changed. Reload it before acting.");
}
export async function actStoredIntake(
  request: Request,
  deps: SecurityApiDependencies,
  id: string,
  action: string,
): Promise<Response> {
  const { actor, stored, row, roles } = await authorizedStored(
    request,
    deps,
    id,
  );
  let value: unknown;
  try {
    value = await readBoundedJson(request, MAX_REPORT_BYTES, "Private report");
  } catch {
    fail(400, "invalid_request", "Provide a valid private report request.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(400, "invalid_request", "Provide a valid private report request.");
  const body = value as Record<string, unknown>;
  checkRevision(body, stored);
  const at = deps.now().toISOString();
  if (action === "screen") {
    exactKeys(body, ["expectedRevision"]);
    if (
      !intakeQualified(stored) &&
      (!["queued", "unavailable", "running"].includes(stored.screening_state) ||
        stored.review_decision !== null)
    )
      fail(
        409,
        "screening_not_retryable",
        "This report is not waiting for automatic screening.",
      );
    if (!intakeQualified(stored) && screeningRecoverable(stored, deps.now()))
      await admitPublicWork(deps, actor.githubId);
    await scheduleScreen(deps, id);
  } else if (action === "review") {
    exactKeys(body, ["expectedRevision", "decision", "reason"]);
    if (!roles.has("security-maintainer"))
      fail(
        403,
        "forbidden",
        "Only a current security maintainer can review routing.",
      );
    if (
      !["forward", "request-information"].includes(String(body.decision)) ||
      typeof body.reason !== "string" ||
      !body.reason.trim() ||
      body.reason.length > 2000
    )
      fail(400, "invalid_request", "Provide a routing decision and reason.");
    const result = await deps.db.batch([
      deps.db
        .prepare(
          "UPDATE security_submission_intake SET review_decision=?,review_reason=?,reviewed_by=?,reviewed_at=?,revision=revision+1 WHERE submission_id=? AND revision=?",
        )
        .bind(
          body.decision,
          body.reason.trim(),
          actor.githubId,
          at,
          id,
          stored.revision,
        ),
      intakeEvent(deps, stored, "review", actor.githubId, at),
    ]);
    if (result[0].meta?.changes !== 1)
      fail(
        409,
        "stale_revision",
        "The report changed. Reload it before acting.",
      );
    const latest = (await storedIntake(deps, id)) as StoredIntake;
    await routedNotice(deps, latest, actor.githubId);
  } else if (action === "report") {
    exactKeys(body, ["expectedRevision", "report"]);
    if (
      !roles.has("reporter") ||
      !(["draft", "failed"] as string[]).includes(row.state) ||
      row.advisory_ghsa !== null ||
      !(
        stored.review_decision === "request-information" ||
        ["needs-information", "spam", "unavailable"].includes(
          stored.screening_state,
        ) ||
        (await loadCase(deps, stored.case_id))?.receipt_state ===
          "needs-information"
      )
    )
      fail(409, "report_not_editable", "This report cannot be revised now.");
    const record = await loadCase(deps, stored.case_id);
    if (
      !record ||
      !["received", "needs-information", "triaging"].includes(
        record.receipt_state,
      ) ||
      ["approved", "reserved"].includes(record.award_state)
    )
      fail(409, "report_not_editable", "The report already has a decision.");
    const report = parseReportInput(body.report);
    const version = stored.report_version + 1;
    await admitPublicWork(deps, actor.githubId);
    const object = await storeReport(deps, id, version, report);
    const result = await deps.db.batch([
      deps.db
        .prepare(
          "UPDATE security_submission_intake SET report_version=?,screening_state='queued',routed_at=NULL,screening_reason=NULL,screening_started_at=NULL,screening_finished_at=NULL,review_decision=NULL,review_reason=NULL,reviewed_at=NULL,reviewed_by=NULL,revision=revision+1 WHERE submission_id=? AND revision=? AND EXISTS(SELECT 1 FROM security_submissions s WHERE s.id=security_submission_intake.submission_id AND s.state IN ('draft','failed') AND s.advisory_ghsa IS NULL) AND EXISTS(SELECT 1 FROM security_cases c WHERE c.id=security_submission_intake.case_id AND c.receipt_state IN ('received','needs-information','triaging') AND c.award_state NOT IN ('approved','reserved'))",
        )
        .bind(version, id, stored.revision),
      deps.db
        .prepare(
          "INSERT INTO security_intake_reports(submission_id,version,object_key,content_sha256,byte_count,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM security_submission_intake WHERE submission_id=? AND revision=? AND report_version=?)",
        )
        .bind(
          id,
          version,
          object.key,
          object.digest,
          object.bytes,
          at,
          id,
          stored.revision + 1,
          version,
        ),
      intakeEvent(deps, stored, "report-revised", actor.githubId, at),
    ]);
    if (result[0].meta?.changes !== 1)
      fail(
        409,
        "stale_revision",
        "The report changed. Reload it before acting.",
      );
    await scheduleScreen(deps, id);
  } else fail(404, "not_found", "Action not found");
  return json(200, { submission: await decorateSubmission(deps, row, actor) });
}

export async function approvedReportForForward(
  deps: SecurityApiDependencies,
  id: string,
): Promise<ReportInput | null> {
  const stored = await storedIntake(deps, id);
  if (!stored) return null;
  if (!intakeQualified(stored))
    fail(
      409,
      "screening_required",
      "The saved report needs screening or an explicit private maintainer routing review.",
    );
  return reportVersion(deps, stored);
}
