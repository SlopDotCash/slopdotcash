/**
 * Private security bounty cases (PRD SEC-02 to SEC-14, SEC-17, MVP-13).
 *
 * Program terms are public and live in the project's D1 manifest revision.
 * Cases are restricted: every read and write resolves the caller's current
 * roles from the session and the current project revision, and a caller
 * without a role receives the same 404 as for a case that does not exist.
 * Platform admins have no implicit access. No route here is cached, listed
 * publicly, or exported to builds, leaderboards, points or cycles.
 */
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import {
  type SecurityBountyTerms,
  securityBountySplit,
} from "../../src/lib/security-bounty.mjs";
import { notifySecurityCase } from "../notifications/events";
import { cachedPublicResponse, type EdgeCache } from "../projects/edge-cache";
import { readJsonObject } from "../trace/validation";

type D1Result<T = unknown> = {
  success: boolean;
  results?: T[];
  meta?: { changes?: number };
};
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
};
export type SecurityD1Database = {
  batch(statements: D1Statement[]): Promise<D1Result[]>;
  prepare(query: string): D1Statement;
};

type Actor = { githubId: string; githubLogin: string };

export type SecurityApiDependencies = {
  db: SecurityD1Database;
  now: () => Date;
  randomId: () => string;
  sessionActor: (request: Request) => Promise<Actor | null>;
  /** Public GitHub reads for the intake readiness check. */
  github: {
    fetch: (url: string, init: RequestInit) => Promise<Response>;
    token?: string;
    apiOrigin: string;
  };
  cache?: EdgeCache;
  waitUntil?: (promise: Promise<unknown>) => void;
};

type Role =
  | "reporter"
  | "security-maintainer"
  | "triager"
  | "financial"
  | "dispute";

type CaseRow = {
  id: string;
  project_id: string;
  advisory_repository: string;
  advisory_ghsa: string;
  reporter_github_id: string;
  reporter_github_login: string;
  submission_state: "claimed" | "verified" | "link-rejected";
  received_at: string | null;
  verified_at: string | null;
  verified_by_github_id: string | null;
  policy_revision: number | null;
  terms: string | null;
  evidence_digest: string | null;
  receipt_state: string;
  remediation_state: string;
  award_state: string;
  payment_state: string;
  disclosure_state: string;
  recognition: string;
  severity: string | null;
  loss_finding: string | null;
  root_cause_key: string | null;
  duplicate_of: string | null;
  technical_decider_github_id: string | null;
  appeal_state: string;
  appeal_from_state: string | null;
  owner_github_id: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  payment_deadline: string | null;
  related_party: "not-assessed" | "unrelated" | "related";
  related_party_review: "not-applicable" | "pending" | "approved" | "refused";
  related_party_reviewer_github_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  case_revision: number;
  kind: string;
  actor_github_id: string;
  actor_role: Role;
  reason: string | null;
  evidence_reference: string | null;
  detail: string;
  at: string;
  idempotency_key: string;
};

type MemberRow = {
  github_id: string;
  github_login: string;
  added_at: string;
  revoked_at: string | null;
};

type ReservationRow = {
  root_cause_key: string;
  policy_revision: number;
  gross_minor: string;
  currency: string;
  reserved_at: string;
};

type FrozenTerms = {
  grossMinor: string;
  researcherMinor: string;
  slopMinor: string;
  currency: SecurityBountyTerms["amount"]["currency"];
  decimals: number;
  network: SecurityBountyTerms["amount"]["network"];
  capacityAwards: number;
};

type ApiError = Error & { status?: number; code?: string };

const PROJECT_ID = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;
const CASE_ID = /^sc_[A-Za-z0-9_-]{8,72}$/u;
const GHSA =
  /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/u;
const GITHUB_ID = /^[1-9]\d{0,19}$/u;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,80}$/u;
const ROOT_CAUSE = /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
/**
 * Slop does not read private advisories, so the receipt time is the time a
 * security maintainer reads on GitHub and enters by hand (SEC-07, SEC-17).
 */
const RECEIVED_AT_SOURCE = "maintainer-attested";
/** A browser that kept an older readiness answer must check again. */
export const INTAKE_READINESS_TTL_SECONDS = 30;

function fail(status: number, code: string, message: string): never {
  const error: ApiError = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function json(
  status: number,
  body: Record<string, unknown>,
  cacheControl = "private, no-store",
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": cacheControl,
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    },
  });
}

/** The same answer for "does not exist" and "not yours" (SEC-08). */
function notFound(): never {
  fail(404, "not_found", "Case not found");
}

function stringField(
  body: Record<string, unknown>,
  key: string,
  pattern: RegExp,
): string {
  const value = body[key];
  if (typeof value !== "string" || !pattern.test(value))
    fail(400, "invalid_request", `Invalid ${key}`);
  return value;
}

function textField(
  body: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): string {
  const value = body[key];
  if (typeof value !== "string") fail(400, "invalid_request", `Invalid ${key}`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max)
    fail(400, "invalid_request", `${key} must be ${min} to ${max} characters`);
  return trimmed;
}

function optionalText(
  body: Record<string, unknown>,
  key: string,
  max: number,
): string | null {
  if (body[key] === undefined || body[key] === null || body[key] === "")
    return null;
  return textField(body, key, 1, max);
}

function choice<T extends string>(
  body: Record<string, unknown>,
  key: string,
  options: readonly T[],
): T {
  const value = body[key];
  if (typeof value !== "string" || !options.includes(value as T))
    fail(400, "invalid_request", `Invalid ${key}`);
  return value as T;
}

function timestampField(
  body: Record<string, unknown>,
  key: string,
  now: Date,
  { past }: { past: boolean },
): string {
  const value = stringField(body, key, TIMESTAMP);
  const time = Date.parse(value);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString() !== value ||
    (past ? time > now.getTime() : time <= now.getTime())
  )
    fail(
      400,
      "invalid_request",
      `${key} must be a ${past ? "past" : "future"} UTC time`,
    );
  return value;
}

function exactKeys(
  body: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(body, key)) ||
    Object.keys(body).some((key) => !allowed.has(key))
  )
    fail(400, "invalid_request", "Request body has unexpected fields");
}

async function requireActor(
  request: Request,
  deps: SecurityApiDependencies,
): Promise<Actor> {
  const actor = await deps.sessionActor(request);
  if (actor === null) fail(401, "unauthorized", "Sign in with GitHub");
  return actor;
}

async function currentProgram(
  deps: Pick<SecurityApiDependencies, "db">,
  projectId: string,
): Promise<{ manifest: ProjectDefinition; revision: number } | null> {
  const row = await deps.db
    .prepare("SELECT manifest, revision FROM projects WHERE id = ?")
    .bind(projectId)
    .first<{ manifest: string; revision: number }>();
  if (row === null) return null;
  const manifest = JSON.parse(row.manifest) as ProjectDefinition;
  return manifest.securityBounty === undefined
    ? null
    : { manifest, revision: row.revision };
}

/** Every project that runs a program, keyed by id, from current revisions. */
async function programs(
  deps: SecurityApiDependencies,
): Promise<Map<string, SecurityBountyTerms>> {
  const result = await deps.db
    .prepare(
      "SELECT manifest FROM projects WHERE json_type(manifest, '$.securityBounty') = 'object'",
    )
    .all<{ manifest: string }>();
  const map = new Map<string, SecurityBountyTerms>();
  for (const row of result.results ?? []) {
    const manifest = JSON.parse(row.manifest) as ProjectDefinition;
    if (manifest.securityBounty) map.set(manifest.id, manifest.securityBounty);
  }
  return map;
}

function programRoles(
  terms: SecurityBountyTerms | undefined,
  githubId: string,
): Set<Role> {
  const roles = new Set<Role>();
  if (terms === undefined) return roles;
  if (terms.approvers.technical.some((entry) => entry.githubId === githubId))
    roles.add("security-maintainer");
  if (terms.approvers.financial.some((entry) => entry.githubId === githubId))
    roles.add("financial");
  if (terms.approvers.dispute.some((entry) => entry.githubId === githubId))
    roles.add("dispute");
  return roles;
}

async function activeTriager(
  deps: Pick<SecurityApiDependencies, "db">,
  caseId: string,
  githubId: string,
): Promise<boolean> {
  return (
    (await deps.db
      .prepare(
        "SELECT 1 AS ok FROM security_case_members WHERE case_id = ? AND github_id = ? AND revoked_at IS NULL",
      )
      .bind(caseId, githubId)
      .first<{ ok: number }>()) !== null
  );
}

/** Current roles; recomputed on every request so revocation is immediate. */
async function caseRoles(
  deps: Pick<SecurityApiDependencies, "db">,
  row: CaseRow,
  actor: Actor,
  terms: SecurityBountyTerms | undefined,
): Promise<Set<Role>> {
  const roles = programRoles(terms, actor.githubId);
  // A dispute reviewer reads only cases with an appeal or a related-party
  // award review.
  if (
    row.appeal_state === "none" &&
    row.related_party_review === "not-applicable"
  )
    roles.delete("dispute");
  // Finance needs nothing before an award exists.
  if (!["reserved", "capacity-exhausted", "approved"].includes(row.award_state))
    roles.delete("financial");
  if (row.reporter_github_id === actor.githubId) {
    // A reporter never decides their own case.
    roles.clear();
    roles.add("reporter");
  } else if (await activeTriager(deps, row.id, actor.githubId)) {
    roles.add("triager");
  }
  return roles;
}

/** Shared live authorization for the private mail dispatcher (SEC-16). */
export async function securityNotificationAccess(
  db: SecurityD1Database,
  caseId: string,
  githubId: string,
): Promise<{ allowed: boolean; acknowledgeHours: number }> {
  const row = await loadCase({ db }, caseId);
  if (row === null) return { allowed: false, acknowledgeHours: 0 };
  const program = await currentProgram({ db }, row.project_id);
  const roles = await caseRoles(
    { db },
    row,
    { githubId, githubLogin: "" },
    program?.manifest.securityBounty,
  );
  return {
    allowed: roles.size > 0,
    acknowledgeHours:
      program?.manifest.securityBounty?.responseTargets?.acknowledgeHours ?? 0,
  };
}

function frozenTerms(row: CaseRow): FrozenTerms | null {
  return row.terms === null ? null : (JSON.parse(row.terms) as FrozenTerms);
}

function advisoryUrl(row: CaseRow): string {
  return `https://github.com/${row.advisory_repository}/security/advisories/${row.advisory_ghsa}`;
}

const REPORTER_EVENT_KINDS = new Set([
  "claim",
  "record",
  "verify-link",
  "reject-link",
  "triage",
  "decide",
  "remediation",
  "approve-award",
  "appeal",
  "decide-appeal",
  "decide-related-party",
  "reserve-award",
  "disclosure",
  "recognition",
]);

function allowedActions(row: CaseRow, roles: Set<Role>): string[] {
  const actions: string[] = [];
  const verified = row.submission_state === "verified";
  const open = ["received", "needs-information", "triaging"].includes(
    row.receipt_state,
  );
  if (roles.has("security-maintainer")) {
    if (row.submission_state === "claimed")
      actions.push("verify-link", "reject-link");
    if (verified) {
      actions.push("assign-triager", "revoke-triager", "next-action");
      actions.push("remediation", "disclosure");
      if (open) actions.push("triage", "decide");
    }
  } else if (roles.has("triager") && verified) {
    actions.push("next-action", "remediation");
    if (open) actions.push("triage");
  }
  if (
    roles.has("financial") &&
    verified &&
    row.award_state === "reserved" &&
    row.technical_decider_github_id !== null
  )
    actions.push("approve-award");
  // Raised capacity can fund a confirmed finding that found none (SEC-06).
  if (
    roles.has("financial") &&
    verified &&
    row.receipt_state === "confirmed" &&
    row.award_state === "capacity-exhausted"
  )
    actions.push("reserve-award");
  if (roles.has("dispute") && row.appeal_state === "open")
    actions.push("decide-appeal");
  if (
    roles.has("dispute") &&
    row.related_party_review === "pending" &&
    row.receipt_state === "confirmed" &&
    row.award_state === "pending"
  )
    actions.push("decide-related-party");
  if (roles.has("reporter") && verified) {
    actions.push("recognition");
    // An award the program withheld for a funding shortage stays appealable:
    // the shortage is a financial exception, not a finding change (SEC-12),
    // and a separate reviewer resolves it (SEC-04, SEC-18).
    if (
      row.appeal_state !== "open" &&
      (["duplicate", "out-of-scope", "rejected"].includes(row.receipt_state) ||
        (row.receipt_state === "confirmed" &&
          ["ineligible", "capacity-exhausted"].includes(row.award_state)))
    )
      actions.push("appeal");
  }
  return actions;
}

function overdue(row: CaseRow, now: Date): boolean {
  return (
    row.next_action_due_at !== null &&
    Date.parse(row.next_action_due_at) < now.getTime()
  );
}

/**
 * Shapes a case for the caller's strongest role. Finance receives only the
 * award and payment fields; a reporter never sees another report, the root
 * cause key, triagers, or evidence references (SEC-04, SEC-08).
 */
async function caseView(
  deps: SecurityApiDependencies,
  row: CaseRow,
  roles: Set<Role>,
  includeHistory: boolean,
): Promise<Record<string, unknown>> {
  const now = deps.now();
  const terms = frozenTerms(row);
  const base = {
    id: row.id,
    projectId: row.project_id,
    revision: row.revision,
    viewerRoles: [...roles].sort(),
    allowedActions: allowedActions(row, roles),
    submissionState: row.submission_state,
    receivedAt: row.received_at,
    receivedAtSource: row.received_at === null ? null : RECEIVED_AT_SOURCE,
    policyRevision: row.policy_revision,
    terms,
    awardState: row.award_state,
    relatedParty: row.related_party,
    relatedPartyReview: row.related_party_review,
    paymentState: row.payment_state,
    paymentRail: "unavailable",
    paymentDeadline: row.payment_deadline,
  };
  const reservation = includeHistory
    ? await deps.db
        .prepare(
          "SELECT root_cause_key, policy_revision, gross_minor, currency, reserved_at FROM security_award_reservations WHERE case_id = ?",
        )
        .bind(row.id)
        .first<ReservationRow>()
    : null;
  const full =
    roles.has("security-maintainer") ||
    roles.has("triager") ||
    roles.has("dispute");
  if (!full && !roles.has("reporter")) {
    // Finance: minimum award and payment fields only.
    return {
      ...base,
      view: "financial",
      payee: { githubLogin: row.reporter_github_login },
      technicalDeciderGithubId: row.technical_decider_github_id,
      reservation:
        reservation === null
          ? null
          : {
              grossMinor: reservation.gross_minor,
              currency: reservation.currency,
              policyRevision: reservation.policy_revision,
              reservedAt: reservation.reserved_at,
            },
    };
  }
  const shared = {
    ...base,
    advisory: {
      repository: row.advisory_repository,
      ghsa: row.advisory_ghsa,
      url: advisoryUrl(row),
    },
    receiptState: row.receipt_state,
    remediationState: row.remediation_state,
    disclosureState: row.disclosure_state,
    recognition: row.recognition,
    severity: row.severity,
    lossFinding: row.loss_finding,
    appealState: row.appeal_state,
    nextAction: row.next_action,
    nextActionDueAt: row.next_action_due_at,
    overdue: overdue(row, now),
  };
  const events = includeHistory
    ? ((
        await deps.db
          .prepare(
            "SELECT case_revision, kind, actor_github_id, actor_role, reason, evidence_reference, detail, at, idempotency_key FROM security_case_events WHERE case_id = ? ORDER BY case_revision",
          )
          .bind(row.id)
          .all<EventRow>()
      ).results ?? [])
    : [];
  if (!full) {
    return {
      ...shared,
      view: "reporter",
      events: events
        .filter((event) => REPORTER_EVENT_KINDS.has(event.kind))
        .map((event) => ({
          revision: event.case_revision,
          kind: event.kind,
          at: event.at,
          reason: event.reason,
        })),
    };
  }
  const members = includeHistory
    ? ((
        await deps.db
          .prepare(
            "SELECT github_id, github_login, added_at, revoked_at FROM security_case_members WHERE case_id = ? ORDER BY added_at",
          )
          .bind(row.id)
          .all<MemberRow>()
      ).results ?? [])
    : [];
  return {
    ...shared,
    view: "restricted",
    reporter: {
      githubId: row.reporter_github_id,
      githubLogin: row.reporter_github_login,
    },
    verifiedAt: row.verified_at,
    evidenceDigest: row.evidence_digest,
    rootCauseKey: row.root_cause_key,
    duplicateOf: row.duplicate_of,
    technicalDeciderGithubId: row.technical_decider_github_id,
    appealFromState: row.appeal_from_state,
    relatedPartyReviewerGithubId: row.related_party_reviewer_github_id,
    ownerGithubId: row.owner_github_id,
    reservation:
      reservation === null
        ? null
        : {
            rootCauseKey: reservation.root_cause_key,
            grossMinor: reservation.gross_minor,
            currency: reservation.currency,
            policyRevision: reservation.policy_revision,
            reservedAt: reservation.reserved_at,
          },
    triagers: members.map((member) => ({
      githubId: member.github_id,
      githubLogin: member.github_login,
      addedAt: member.added_at,
      revokedAt: member.revoked_at,
    })),
    events: events.map((event) => ({
      revision: event.case_revision,
      kind: event.kind,
      actorGithubId: event.actor_github_id,
      actorRole: event.actor_role,
      at: event.at,
      reason: event.reason,
      evidenceReference: event.evidence_reference,
      detail: JSON.parse(event.detail),
    })),
  };
}

const CASE_COLUMNS =
  "id, project_id, advisory_repository, advisory_ghsa, reporter_github_id, reporter_github_login, submission_state, received_at, verified_at, verified_by_github_id, policy_revision, terms, evidence_digest, receipt_state, remediation_state, award_state, payment_state, disclosure_state, recognition, severity, loss_finding, root_cause_key, duplicate_of, technical_decider_github_id, appeal_state, appeal_from_state, owner_github_id, next_action, next_action_due_at, payment_deadline, related_party, related_party_review, related_party_reviewer_github_id, revision, created_at, updated_at";

async function loadCase(
  deps: Pick<SecurityApiDependencies, "db">,
  caseId: string,
): Promise<CaseRow | null> {
  if (!CASE_ID.test(caseId)) return null;
  return deps.db
    .prepare(`SELECT ${CASE_COLUMNS} FROM security_cases WHERE id = ?`)
    .bind(caseId)
    .first<CaseRow>();
}

function accessLog(
  deps: SecurityApiDependencies,
  caseId: string,
  actor: Actor,
  roles: Set<Role>,
  action: "read" | "write",
): D1Statement {
  return deps.db
    .prepare(
      "INSERT INTO security_case_access_log (case_id, actor_github_id, actor_role, action, at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(
      caseId,
      actor.githubId,
      [...roles].sort().join(","),
      action,
      deps.now().toISOString(),
    );
}

async function listCases(
  request: Request,
  deps: SecurityApiDependencies,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  const all = await programs(deps);
  const projectIds = [...all.entries()]
    .filter(([, terms]) => programRoles(terms, actor.githubId).size > 0)
    .map(([id]) => id);
  const placeholders = projectIds.map(() => "?").join(", ");
  const result = await deps.db
    .prepare(
      `SELECT ${CASE_COLUMNS} FROM security_cases WHERE reporter_github_id = ? OR id IN (SELECT case_id FROM security_case_members WHERE github_id = ? AND revoked_at IS NULL)${
        projectIds.length > 0 ? ` OR project_id IN (${placeholders})` : ""
      } ORDER BY created_at DESC LIMIT 500`,
    )
    .bind(actor.githubId, actor.githubId, ...projectIds)
    .all<CaseRow>();
  const cases: Record<string, unknown>[] = [];
  for (const row of result.results ?? []) {
    const roles = await caseRoles(deps, row, actor, all.get(row.project_id));
    if (roles.size === 0) continue;
    cases.push(await caseView(deps, row, roles, false));
  }
  const programsForActor = projectIds.map((id) => ({
    projectId: id,
    roles: [...programRoles(all.get(id), actor.githubId)].sort(),
  }));
  return json(200, {
    viewer: { githubId: actor.githubId, githubLogin: actor.githubLogin },
    programs: programsForActor,
    cases,
  });
}

async function readCase(
  request: Request,
  deps: SecurityApiDependencies,
  caseId: string,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  const row = await loadCase(deps, caseId);
  if (row === null) notFound();
  const program = await currentProgram(deps, row.project_id);
  const roles = await caseRoles(
    deps,
    row,
    actor,
    program?.manifest.securityBounty,
  );
  if (roles.size === 0) notFound();
  await accessLog(deps, row.id, actor, roles, "read").run();
  return json(200, { case: await caseView(deps, row, roles, true) });
}

/** The program terms in force at the receipt time, frozen into the case. */
async function termsAtReceipt(
  deps: SecurityApiDependencies,
  projectId: string,
  receivedAt: string,
): Promise<{ revision: number | null; terms: FrozenTerms | null }> {
  const row = await deps.db
    .prepare(
      "SELECT revision, manifest FROM project_revisions WHERE project_id = ? AND created_at <= ? ORDER BY revision DESC LIMIT 1",
    )
    .bind(projectId, receivedAt)
    .first<{ revision: number; manifest: string }>();
  if (row === null) return { revision: null, terms: null };
  const program = (JSON.parse(row.manifest) as ProjectDefinition)
    .securityBounty;
  if (
    program === undefined ||
    program.status !== "open" ||
    (program.capacity.closesAt !== null &&
      Date.parse(program.capacity.closesAt) <= Date.parse(receivedAt))
  )
    return { revision: row.revision, terms: null };
  const split = securityBountySplit(program.amount.grossMinor);
  return {
    revision: row.revision,
    terms: {
      ...split,
      currency: program.amount.currency,
      decimals: program.amount.decimals,
      network: program.amount.network,
      capacityAwards: program.capacity.awards,
    },
  };
}

function eventStatement(
  deps: SecurityApiDependencies,
  input: {
    caseId: string;
    revision: number;
    kind: string;
    actor: Actor;
    role: Role;
    idempotencyKey: string;
    reason: string | null;
    evidenceReference: string | null;
    detail: Record<string, unknown>;
    at: string;
    /** Insert only when the case reached `revision` in this batch. */
    guard: boolean;
  },
): D1Statement {
  const values = [
    input.caseId,
    input.revision,
    input.kind,
    input.actor.githubId,
    input.role,
    input.idempotencyKey,
    input.reason,
    input.evidenceReference,
    JSON.stringify(input.detail),
    input.at,
  ];
  return input.guard
    ? deps.db
        .prepare(
          "INSERT INTO security_case_events (case_id, case_revision, kind, actor_github_id, actor_role, idempotency_key, reason, evidence_reference, detail, at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT revision FROM security_cases WHERE id = ?) = ?",
        )
        .bind(...values, input.caseId, input.revision)
    : deps.db
        .prepare(
          "INSERT INTO security_case_events (case_id, case_revision, kind, actor_github_id, actor_role, idempotency_key, reason, evidence_reference, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(...values);
}

/** Case events that can reserve an award in their batch. */
const RESERVING_KINDS = new Set([
  "decide",
  "decide-related-party",
  "reserve-award",
]);

/**
 * Inbox rows for one case event (NOT-01, SEC-09): the reporter for every
 * event their own view shows, the security maintainers for a new claim to
 * verify, the dispute reviewers for an appeal or for a decision that leaves
 * a related-party review pending, the assigned triager, and the financial
 * approvers when a decision, a related-party approval or `reserve-award`
 * reserved an award. The actor is never notified of their own action.
 */
function inboxStatements(
  deps: SecurityApiDependencies,
  input: {
    caseId: string;
    revision: number;
    kind: string;
    idempotencyKey: string;
    reporterGithubId: string;
    detail: Record<string, unknown>;
    terms: SecurityBountyTerms | undefined;
  },
): D1Statement[] {
  const ids = (role: keyof SecurityBountyTerms["approvers"]) =>
    (input.terms?.approvers[role] ?? []).map((entry) => entry.githubId);
  const event = {
    caseId: input.caseId,
    revision: input.revision,
    idempotencyKey: input.idempotencyKey,
  };
  const recipients = [
    ...(REPORTER_EVENT_KINDS.has(input.kind) ? [input.reporterGithubId] : []),
    ...(input.kind === "claim" ? ids("technical") : []),
    ...(input.kind === "appeal" ? ids("dispute") : []),
    ...(input.kind === "assign-triager" &&
    typeof input.detail.githubId === "string"
      ? [input.detail.githubId]
      : []),
  ];
  return [
    notifySecurityCase(deps.db, { ...event, recipients }),
    ...(RESERVING_KINDS.has(input.kind)
      ? [
          notifySecurityCase(deps.db, {
            ...event,
            recipients: ids("financial"),
            awardState: "reserved",
          }),
        ]
      : []),
    // After a decision, `pending` means only an eligible related-party award
    // that waits for its independent review.
    ...(input.kind === "decide"
      ? [
          notifySecurityCase(deps.db, {
            ...event,
            recipients: ids("dispute"),
            awardState: "pending",
          }),
        ]
      : []),
  ];
}

function constraintError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Creates a case. A reporter's `claim` links a GitHub advisory they already
 * submitted; it is not a receipt until a security maintainer verifies it. A
 * security maintainer's `record` registers a verified advisory directly,
 * for reporters who used GitHub without Slop (SEC-07).
 */
async function createCase(
  request: Request,
  deps: SecurityApiDependencies,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  const body = await readJsonObject(request);
  const mode = choice(body, "mode", ["claim", "record"] as const);
  if (mode === "claim")
    exactKeys(body, ["mode", "projectId", "advisory", "idempotencyKey"]);
  else
    exactKeys(body, [
      "mode",
      "projectId",
      "advisory",
      "idempotencyKey",
      "reporterGithubId",
      "reporterGithubLogin",
      "receivedAt",
      "confirmation",
    ]);
  const projectId = stringField(body, "projectId", PROJECT_ID);
  const advisory = stringField(body, "advisory", GHSA);
  const idempotencyKey = stringField(body, "idempotencyKey", IDEMPOTENCY_KEY);
  const program = await currentProgram(deps, projectId);
  if (program === null)
    fail(404, "program_not_found", "This project has no security program");
  const terms = program.manifest.securityBounty as SecurityBountyTerms;
  const now = deps.now();
  const at = now.toISOString();
  const id = `sc_${deps.randomId().replaceAll("-", "")}`;
  let reporter: Actor;
  let role: Role;
  let verified: {
    receivedAt: string;
    revision: number | null;
    terms: FrozenTerms | null;
  } | null = null;
  if (mode === "claim") {
    reporter = actor;
    role = "reporter";
  } else {
    if (!programRoles(terms, actor.githubId).has("security-maintainer"))
      fail(403, "forbidden", "Only a security maintainer can record a case");
    if (body.confirmation !== true)
      fail(
        400,
        "confirmation_required",
        "Confirm that you checked the GitHub advisory and its reporter",
      );
    reporter = {
      githubId: stringField(body, "reporterGithubId", GITHUB_ID),
      githubLogin: stringField(body, "reporterGithubLogin", GITHUB_LOGIN),
    };
    if (reporter.githubId === actor.githubId)
      fail(403, "conflicted", "You cannot record your own report");
    role = "security-maintainer";
    const receivedAt = timestampField(body, "receivedAt", now, { past: true });
    verified = {
      receivedAt,
      ...(await termsAtReceipt(deps, projectId, receivedAt)),
    };
  }
  const insert = deps.db
    .prepare(
      `INSERT INTO security_cases (id, project_id, advisory_repository, advisory_ghsa, reporter_github_id, reporter_github_login, submission_state, received_at, verified_at, verified_by_github_id, policy_revision, terms, evidence_digest, receipt_state, remediation_state, award_state, payment_state, disclosure_state, recognition, appeal_state, owner_github_id, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'received', 'not-started', ?, 'not-applicable', 'embargoed', 'private', 'none', ?, 1, ?, ?)`,
    )
    .bind(
      id,
      projectId,
      terms.intake.repository,
      advisory,
      reporter.githubId,
      reporter.githubLogin,
      verified ? "verified" : "claimed",
      verified?.receivedAt ?? null,
      verified ? at : null,
      verified ? actor.githubId : null,
      verified?.revision ?? null,
      verified?.terms ? JSON.stringify(verified.terms) : null,
      verified?.terms ? "pending" : "not-applicable",
      verified ? actor.githubId : null,
      at,
      at,
    );
  try {
    await deps.db.batch([
      insert,
      eventStatement(deps, {
        caseId: id,
        revision: 1,
        kind: mode,
        actor,
        role,
        idempotencyKey,
        reason: null,
        evidenceReference: null,
        detail: verified
          ? {
              advisory,
              receivedAt: verified.receivedAt,
              receivedAtSource: RECEIVED_AT_SOURCE,
            }
          : { advisory },
        at,
        guard: false,
      }),
      accessLog(deps, id, actor, new Set([role]), "write"),
      ...inboxStatements(deps, {
        caseId: id,
        revision: 1,
        kind: mode,
        idempotencyKey,
        reporterGithubId: reporter.githubId,
        detail: {},
        terms,
      }),
    ]);
  } catch (error) {
    if (!/UNIQUE/iu.test(constraintError(error))) throw error;
    // A rejected link is history; only a live case for this reporter and
    // advisory can answer the request.
    const existing = await deps.db
      .prepare(
        `SELECT ${CASE_COLUMNS} FROM security_cases WHERE project_id = ? AND advisory_ghsa = ? AND reporter_github_id = ? AND submission_state <> 'link-rejected'`,
      )
      .bind(projectId, advisory, reporter.githubId)
      .first<CaseRow>();
    if (existing !== null) {
      // A claim is idempotent by reporter and advisory. A record is a replay
      // only when this exact request created the verified case; otherwise it
      // wrote nothing and must not report success.
      const replayed =
        mode === "claim" ||
        (existing.submission_state === "verified" &&
          (await deps.db
            .prepare(
              "SELECT 1 AS ok FROM security_case_events WHERE case_id = ? AND case_revision = 1 AND kind = 'record' AND idempotency_key = ? AND actor_github_id = ?",
            )
            .bind(existing.id, idempotencyKey, actor.githubId)
            .first<{ ok: number }>()) !== null);
      if (replayed) {
        const roles = await caseRoles(deps, existing, actor, terms);
        if (roles.size > 0)
          return json(200, {
            replayed: true,
            case: await caseView(deps, existing, roles, true),
          });
      } else if (existing.submission_state === "claimed") {
        fail(
          409,
          "claim_pending",
          "The reporter already linked this advisory; verify or reject that claim",
        );
      }
    }
    fail(
      409,
      "advisory_already_recorded",
      "This advisory already has a verified case",
    );
  }
  const row = (await loadCase(deps, id)) as CaseRow;
  const roles = await caseRoles(deps, row, actor, terms);
  return json(201, { case: await caseView(deps, row, roles, true) });
}

type Change = {
  kind: string;
  role: Role;
  reason: string | null;
  evidenceReference: string | null;
  detail: Record<string, unknown>;
  set: Record<string, string | number | null>;
  /** Raw SQL for award_state when it depends on a reservation in this batch. */
  awardStateSql?: string;
  before?: D1Statement[];
  /** Runs after the event; each must be guarded by {@link triagerEvent}. */
  after?: D1Statement[];
  /**
   * An extra SQL condition on the case update. When the revision still
   * matches but this condition fails, the request returns `unmet`.
   */
  requireSql?: string;
  unmet?: { code: string; message: string };
};

/**
 * Guards a triager membership write so it commits only when this request's
 * own audit event landed at the next case revision for the same account.
 * That event is written only when the revision-checked case update matched,
 * so a stale request can never grant or revoke access without an audit
 * event (SEC-08, SEC-10).
 */
function triagerEvent(
  row: CaseRow,
  idempotencyKey: string,
  kind: "assign-triager" | "revoke-triager",
  githubId: string,
): { sql: string; values: unknown[] } {
  return {
    sql: "EXISTS (SELECT 1 FROM security_case_events WHERE case_id = ? AND case_revision = ? AND idempotency_key = ? AND kind = ? AND json_extract(detail, '$.githubId') = ?)",
    values: [row.id, row.revision + 1, idempotencyKey, kind, githubId],
  };
}

function requireRole(roles: Set<Role>, role: Role, message: string): void {
  if (!roles.has(role)) fail(403, "forbidden", message);
}

function requireAction(row: CaseRow, roles: Set<Role>, action: string): void {
  if (!allowedActions(row, roles).includes(action))
    fail(
      409,
      "action_not_allowed",
      `The case does not allow ${action} in its current state`,
    );
}

/** Computes one human decision; nothing here is automatic (SEC-10). */
async function planChange(
  deps: SecurityApiDependencies,
  row: CaseRow,
  roles: Set<Role>,
  actor: Actor,
  action: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<Change> {
  const now = deps.now();
  const at = now.toISOString();
  const common = ["action", "expectedRevision", "idempotencyKey"];
  const actingRole = (preferred: Role[]): Role =>
    preferred.find((role) => roles.has(role)) ?? preferred[0];
  switch (action) {
    case "verify-link": {
      exactKeys(body, [...common, "receivedAt", "confirmation"]);
      requireRole(roles, "security-maintainer", "Security maintainers verify");
      requireAction(row, roles, action);
      if (body.confirmation !== true)
        fail(
          400,
          "confirmation_required",
          "Confirm that the GitHub advisory exists and names this reporter",
        );
      const receivedAt = timestampField(body, "receivedAt", now, {
        past: true,
      });
      const frozen = await termsAtReceipt(deps, row.project_id, receivedAt);
      return {
        kind: action,
        role: "security-maintainer",
        reason: null,
        evidenceReference: null,
        detail: {
          receivedAt,
          receivedAtSource: RECEIVED_AT_SOURCE,
          policyRevision: frozen.revision,
        },
        set: {
          submission_state: "verified",
          received_at: receivedAt,
          verified_at: at,
          verified_by_github_id: actor.githubId,
          policy_revision: frozen.revision,
          terms: frozen.terms ? JSON.stringify(frozen.terms) : null,
          award_state: frozen.terms ? "pending" : "not-applicable",
          owner_github_id: actor.githubId,
        },
      };
    }
    case "reject-link": {
      exactKeys(body, [...common, "reason"]);
      requireRole(roles, "security-maintainer", "Security maintainers verify");
      requireAction(row, roles, action);
      return {
        kind: action,
        role: "security-maintainer",
        reason: textField(body, "reason", 8, 2000),
        evidenceReference: null,
        detail: {},
        set: { submission_state: "link-rejected" },
      };
    }
    case "assign-triager":
    case "revoke-triager": {
      exactKeys(
        body,
        [...common, "githubId"],
        action === "assign-triager" ? ["githubLogin"] : [],
      );
      requireRole(roles, "security-maintainer", "Security maintainers assign");
      requireAction(row, roles, action);
      const githubId = stringField(body, "githubId", GITHUB_ID);
      if (githubId === row.reporter_github_id)
        fail(409, "conflicted", "The reporter cannot triage their own case");
      const guard = triagerEvent(row, idempotencyKey, action, githubId);
      if (action === "assign-triager") {
        const githubLogin = stringField(body, "githubLogin", GITHUB_LOGIN);
        return {
          kind: action,
          role: "security-maintainer",
          reason: null,
          evidenceReference: null,
          detail: { githubId, githubLogin },
          set: {},
          after: [
            deps.db
              .prepare(
                `INSERT INTO security_case_members (case_id, github_id, github_login, role, added_by_github_id, added_at) SELECT ?, ?, ?, 'triager', ?, ? WHERE ${guard.sql}`,
              )
              .bind(
                row.id,
                githubId,
                githubLogin,
                actor.githubId,
                at,
                ...guard.values,
              ),
          ],
        };
      }
      if (!(await activeTriager(deps, row.id, githubId)))
        fail(409, "not_assigned", "That account is not an active triager");
      return {
        kind: action,
        role: "security-maintainer",
        reason: null,
        evidenceReference: null,
        detail: { githubId },
        set: {},
        after: [
          deps.db
            .prepare(
              `UPDATE security_case_members SET revoked_at = ?, revoked_by_github_id = ? WHERE case_id = ? AND github_id = ? AND revoked_at IS NULL AND ${guard.sql}`,
            )
            .bind(at, actor.githubId, row.id, githubId, ...guard.values),
        ],
      };
    }
    case "triage": {
      exactKeys(body, [...common, "receiptState"], ["reason"]);
      requireAction(row, roles, action);
      const receiptState = choice(body, "receiptState", [
        "needs-information",
        "triaging",
      ] as const);
      return {
        kind: action,
        role: actingRole(["security-maintainer", "triager"]),
        reason: optionalText(body, "reason", 2000),
        evidenceReference: null,
        detail: { receiptState },
        set: { receipt_state: receiptState },
      };
    }
    case "next-action": {
      exactKeys(body, [...common, "nextAction", "dueAt"]);
      requireAction(row, roles, action);
      return {
        kind: action,
        role: actingRole(["security-maintainer", "triager"]),
        reason: null,
        evidenceReference: null,
        detail: {},
        set: {
          next_action: textField(body, "nextAction", 3, 500),
          next_action_due_at: timestampField(body, "dueAt", now, {
            past: false,
          }),
          owner_github_id: actor.githubId,
        },
      };
    }
    case "decide":
      return planDecision(deps, row, roles, actor, body, at);
    case "remediation": {
      exactKeys(
        body,
        [...common, "remediationState"],
        ["reason", "evidenceReference"],
      );
      requireAction(row, roles, action);
      const remediationState = choice(body, "remediationState", [
        "investigating",
        "fixing",
        "retest",
        "resolved",
        "mitigation-verified",
        "reopened",
      ] as const);
      const evidenceReference = optionalText(body, "evidenceReference", 500);
      // A merge needs independently recorded exact-head test results, and
      // deployed mitigation is verified separately from the merge (SEC-11).
      if (
        (remediationState === "resolved" ||
          remediationState === "mitigation-verified") &&
        evidenceReference === null
      )
        fail(
          400,
          "evidence_required",
          "Record the private exact-head test or deployment evidence",
        );
      if (
        remediationState === "mitigation-verified" &&
        row.remediation_state !== "resolved"
      )
        fail(
          409,
          "action_not_allowed",
          "Verify deployed mitigation only after the fix is resolved",
        );
      return {
        kind: action,
        role: actingRole(["security-maintainer", "triager"]),
        reason: optionalText(body, "reason", 2000),
        evidenceReference,
        detail: { remediationState },
        set: { remediation_state: remediationState },
      };
    }
    case "disclosure": {
      exactKeys(body, [...common, "disclosureState", "reason"]);
      requireRole(roles, "security-maintainer", "Security maintainers decide");
      requireAction(row, roles, action);
      const disclosureState = choice(body, "disclosureState", [
        "embargoed",
        "redaction-approved",
        "disclosed",
      ] as const);
      return {
        kind: action,
        role: "security-maintainer",
        reason: textField(body, "reason", 8, 2000),
        evidenceReference: null,
        detail: { disclosureState },
        set: { disclosure_state: disclosureState },
      };
    }
    case "recognition": {
      exactKeys(body, [...common, "recognition"]);
      requireAction(row, roles, action);
      const recognition = choice(body, "recognition", [
        "private",
        "opt-in",
      ] as const);
      return {
        kind: action,
        role: "reporter",
        reason: null,
        evidenceReference: null,
        detail: { recognition },
        set: { recognition },
      };
    }
    case "appeal": {
      exactKeys(body, [...common, "reason"]);
      requireAction(row, roles, action);
      return {
        kind: action,
        role: "reporter",
        reason: textField(body, "reason", 20, 2000),
        evidenceReference: null,
        detail: { from: row.receipt_state },
        set: {
          appeal_state: "open",
          appeal_from_state: row.receipt_state,
          receipt_state: "disputed",
        },
      };
    }
    case "decide-appeal": {
      exactKeys(body, [...common, "outcome", "reason"]);
      requireAction(row, roles, action);
      // The independent reviewer never decided the original outcome.
      if (
        row.technical_decider_github_id === actor.githubId ||
        row.related_party_reviewer_github_id === actor.githubId
      )
        fail(403, "conflicted", "You decided this case; another reviewer must");
      const outcome = choice(body, "outcome", ["uphold", "return"] as const);
      return {
        kind: action,
        role: "dispute",
        reason: textField(body, "reason", 8, 2000),
        evidenceReference: null,
        detail: { outcome },
        set:
          outcome === "uphold"
            ? {
                appeal_state: "upheld",
                receipt_state: row.appeal_from_state ?? "rejected",
              }
            : {
                appeal_state: "returned",
                receipt_state: "triaging",
                // A reserved obligation survives; only a refusal reopens.
                award_state:
                  row.award_state === "ineligible"
                    ? "pending"
                    : row.award_state,
              },
      };
    }
    case "decide-related-party": {
      exactKeys(body, [...common, "outcome", "reason"]);
      requireAction(row, roles, action);
      // The reviewer is independent of the technical decision (SEC-12).
      if (row.technical_decider_github_id === actor.githubId)
        fail(403, "conflicted", "You decided this case; another reviewer must");
      const outcome = choice(body, "outcome", ["approve", "refuse"] as const);
      const reason = textField(body, "reason", 8, 2000);
      const reviewed = {
        related_party_review: outcome === "approve" ? "approved" : "refused",
        related_party_reviewer_github_id: actor.githubId,
      };
      if (outcome === "refuse")
        return {
          kind: action,
          role: "dispute",
          reason,
          evidenceReference: null,
          detail: { outcome },
          set: { ...reviewed, award_state: "ineligible" },
        };
      return {
        kind: action,
        role: "dispute",
        reason,
        evidenceReference: null,
        detail: { outcome },
        set: reviewed,
        ...(await reservationChange(deps, row, at)).change,
      };
    }
    case "reserve-award": {
      exactKeys(body, [...common, "reason"]);
      requireAction(row, roles, action);
      const reason = textField(body, "reason", 8, 2000);
      const { earlierWaiting, change } = await reservationChange(deps, row, at);
      if (earlierWaiting)
        fail(
          409,
          "earlier_receipt_waiting",
          "A report received earlier waits for capacity; reserve that one first",
        );
      return {
        kind: action,
        role: "financial",
        reason,
        evidenceReference: null,
        detail: {},
        set: {},
        ...change,
        // Without capacity nothing is written; the case stays as it was.
        awardStateSql: "'reserved'",
        requireSql:
          "EXISTS (SELECT 1 FROM security_award_reservations WHERE case_id = security_cases.id)",
        unmet: {
          code: "capacity_exhausted",
          message:
            "The program has no unreserved capacity. Raise capacity by a project revision first",
        },
      };
    }
    case "approve-award": {
      exactKeys(body, [...common, "paymentDeadline", "confirmation"]);
      requireAction(row, roles, action);
      if (actor.githubId === row.technical_decider_github_id)
        fail(
          403,
          "conflicted",
          "The technical decider cannot also approve the award",
        );
      if (body.confirmation !== true)
        fail(
          400,
          "confirmation_required",
          "Confirm the award preview: gross, both shares, payee and reserve",
        );
      return {
        kind: action,
        role: "financial",
        reason: null,
        evidenceReference: null,
        detail: { terms: frozenTerms(row) },
        set: {
          award_state: "approved",
          payment_state: "rail-unavailable",
          payment_deadline: timestampField(body, "paymentDeadline", now, {
            past: false,
          }),
        },
      };
    }
  }
  fail(400, "invalid_request", "Unknown action");
}

/**
 * Records the human technical decision. Only critical severity with verified
 * actual or potential loss on an in-scope asset is eligible (SEC-03); an
 * eligible case under paid terms reserves its gross award once per root
 * cause, within the program's current award capacity (SEC-06, SEC-10).
 */
async function planDecision(
  deps: SecurityApiDependencies,
  row: CaseRow,
  roles: Set<Role>,
  actor: Actor,
  body: Record<string, unknown>,
  at: string,
): Promise<Change> {
  exactKeys(
    body,
    [
      "action",
      "expectedRevision",
      "idempotencyKey",
      "outcome",
      "severity",
      "loss",
      "inScope",
      "reason",
      "evidenceReference",
      "relatedParty",
    ],
    ["rootCauseKey", "duplicateOf", "evidenceDigest"],
  );
  requireRole(roles, "security-maintainer", "Security maintainers decide");
  requireAction(row, roles, "decide");
  // An accepted obligation is never reduced by a later decision (SEC-12).
  if (row.award_state === "reserved" || row.award_state === "approved")
    fail(
      409,
      "award_obligation_exists",
      "This case already holds an award obligation",
    );
  const outcome = choice(body, "outcome", [
    "confirmed",
    "duplicate",
    "out-of-scope",
    "rejected",
  ] as const);
  const severity = choice(body, "severity", [
    "critical",
    "high",
    "medium",
    "low",
    "informational",
    "unresolved",
  ] as const);
  const loss = choice(body, "loss", [
    "verified-potential",
    "verified-actual",
    "not-verified",
    "unresolved",
  ] as const);
  if (typeof body.inScope !== "boolean")
    fail(400, "invalid_request", "Invalid inScope");
  const inScope = body.inScope;
  // The decider declares a related party; program approvers and the sponsor
  // account always are one (SEC-04, SEC-12). Once related, a case stays
  // related, so a redecision after an appeal cannot skip the review.
  if (typeof body.relatedParty !== "boolean")
    fail(400, "invalid_request", "Invalid relatedParty");
  const program = (await currentProgram(deps, row.project_id))?.manifest
    .securityBounty;
  const relatedParty =
    body.relatedParty ||
    row.related_party === "related" ||
    programRoles(program, row.reporter_github_id).size > 0 ||
    program?.sponsor.githubId === row.reporter_github_id;
  const reason = textField(body, "reason", 8, 2000);
  const evidenceReference = textField(body, "evidenceReference", 3, 500);
  const rootCauseKey =
    body.rootCauseKey === undefined
      ? null
      : stringField(body, "rootCauseKey", ROOT_CAUSE);
  const evidenceDigest =
    body.evidenceDigest === undefined
      ? null
      : stringField(body, "evidenceDigest", SHA256);
  let duplicateOf: string | null = null;
  if (outcome === "duplicate") {
    duplicateOf = stringField(body, "duplicateOf", CASE_ID);
    const original = await loadCase(deps, duplicateOf);
    if (
      original === null ||
      original.project_id !== row.project_id ||
      original.id === row.id ||
      original.submission_state !== "verified"
    )
      fail(
        409,
        "invalid_duplicate",
        "The original case is not in this project",
      );
  } else if (body.duplicateOf !== undefined) {
    fail(400, "invalid_request", "duplicateOf applies only to duplicates");
  }
  if ((outcome === "confirmed" || outcome === "duplicate") && !rootCauseKey)
    fail(400, "invalid_request", "Record the root cause key");
  // The decision binds a restricted evidence snapshot before ratification.
  if (outcome === "confirmed" && evidenceDigest === null)
    fail(400, "evidence_required", "Record the decision-evidence digest");
  const terms = frozenTerms(row);
  const eligible =
    outcome === "confirmed" &&
    inScope &&
    severity === "critical" &&
    (loss === "verified-potential" || loss === "verified-actual");
  const set: Record<string, string | number | null> = {
    receipt_state: outcome,
    severity,
    loss_finding: loss,
    root_cause_key: rootCauseKey,
    duplicate_of: duplicateOf,
    evidence_digest: evidenceDigest,
    technical_decider_github_id: actor.githubId,
    related_party: relatedParty ? "related" : "unrelated",
    related_party_review: "not-applicable",
    // The earlier reviewer stays recorded; it cannot decide a later appeal.
    related_party_reviewer_github_id: row.related_party_reviewer_github_id,
  };
  const change: Change = {
    kind: "decide",
    role: "security-maintainer",
    reason,
    evidenceReference,
    detail: { outcome, severity, loss, inScope, eligible, relatedParty },
    set,
  };
  if (terms === null) {
    set.award_state = "not-applicable";
    return change;
  }
  if (!eligible) {
    set.award_state = "ineligible";
    return change;
  }
  if (relatedParty) {
    // Nothing is reserved until an independent reviewer approves it.
    await assertRootCauseFree(deps, row, rootCauseKey as string);
    set.award_state = "pending";
    set.related_party_review = "pending";
    return change;
  }
  return {
    ...change,
    ...(
      await reservationChange(
        deps,
        { ...row, root_cause_key: rootCauseKey },
        at,
      )
    ).change,
  };
}

/**
 * Another case of the same project and root cause that waits for its
 * independent related-party review. It holds the root cause, so a later
 * report cannot reserve it first (SEC-04, SEC-12). Binds: project id, case
 * id, root cause key.
 */
const ROOT_CAUSE_PENDING_REVIEW =
  "SELECT 1 FROM security_cases o WHERE o.project_id = ? AND o.id <> ? AND o.root_cause_key = ? AND o.receipt_state = 'confirmed' AND o.award_state = 'pending' AND o.related_party_review = 'pending'";

/**
 * A confirmed case of the same project and root cause, received before the
 * given one, that waits for capacity (also while its appeal is open). It
 * holds the root cause like a pending review: once it reserves, a later case
 * of that root cause could never reserve, so the later report is refused as
 * a duplicate instead of waiting forever (SEC-04, SEC-06). Binds: project id,
 * case id, root cause key, received at, received at, case id.
 */
const ROOT_CAUSE_EARLIER_WAITING =
  "SELECT 1 FROM security_cases w WHERE w.project_id = ? AND w.id <> ? AND w.root_cause_key = ? AND w.award_state = 'capacity-exhausted' AND (w.receipt_state = 'confirmed' OR (w.receipt_state = 'disputed' AND w.appeal_from_state = 'confirmed')) AND (w.received_at < ? OR (w.received_at = ? AND w.id < ?))";

async function assertRootCauseFree(
  deps: SecurityApiDependencies,
  row: Pick<CaseRow, "project_id" | "id" | "received_at">,
  rootCauseKey: string,
): Promise<void> {
  const { project_id: projectId, id: caseId, received_at: receivedAt } = row;
  // One root cause reserves once; the unique index and the reservation
  // insert guard also stop a race.
  if (
    (await deps.db
      .prepare(
        `SELECT 1 AS taken FROM security_award_reservations WHERE project_id = ? AND root_cause_key = ? UNION ALL ${ROOT_CAUSE_PENDING_REVIEW} UNION ALL ${ROOT_CAUSE_EARLIER_WAITING} LIMIT 1`,
      )
      .bind(
        projectId,
        rootCauseKey,
        projectId,
        caseId,
        rootCauseKey,
        projectId,
        caseId,
        rootCauseKey,
        receivedAt,
        receivedAt,
        caseId,
      )
      .first<{ taken: number }>()) !== null
  )
    fail(
      409,
      "root_cause_reserved",
      "This root cause already holds an award or a pending review; record a duplicate instead",
    );
}

/**
 * A confirmed case received before the given one that waits for capacity or
 * for its independent related-party review, and whose root cause holds no
 * reservation. An appeal keeps the place: it carries the confirmed receipt
 * into `disputed` and `uphold` restores it unchanged, so the receipt is still
 * confirmed for funding order. While that report is disputed nothing else may
 * reserve, so a later report cannot take its root cause or its turn (SEC-04).
 * Binds: project id, case id, received at, received at, case id.
 */
const EARLIER_RECEIPT_WAITING =
  "SELECT 1 FROM security_cases c WHERE c.project_id = ? AND c.id <> ? AND (c.award_state = 'capacity-exhausted' OR (c.award_state = 'pending' AND c.related_party_review = 'pending')) AND (c.receipt_state = 'confirmed' OR (c.receipt_state = 'disputed' AND c.appeal_from_state = 'confirmed')) AND (c.received_at < ? OR (c.received_at = ? AND c.id < ?)) AND NOT EXISTS (SELECT 1 FROM security_award_reservations r WHERE r.project_id = c.project_id AND r.root_cause_key = c.root_cause_key)";

/**
 * Reserves the case's frozen gross amount for its root cause when the current
 * program revision still has capacity, in the same batch as the revision-
 * checked case update. Every reserving path (decide, related-party approval,
 * reserve-award) uses it. Capacity goes to the earliest receipt first: while
 * an earlier confirmed case waits for capacity, nothing is reserved, so the
 * order of requests never chooses who is funded (SEC-04, SEC-06). Without a
 * reservation the award is `capacity-exhausted`; the finding stays confirmed
 * (SEC-06, SEC-10). `earlierWaiting` reports the ordering state at read time
 * for a clear refusal; the insert guard decides it again in the batch.
 */
async function reservationChange(
  deps: SecurityApiDependencies,
  row: CaseRow,
  at: string,
): Promise<{
  earlierWaiting: boolean;
  change: Pick<Change, "before" | "awardStateSql">;
}> {
  const terms = frozenTerms(row);
  const rootCauseKey = row.root_cause_key;
  if (terms === null || rootCauseKey === null)
    fail(409, "action_not_allowed", "The case has no paid terms to reserve");
  await assertRootCauseFree(deps, row, rootCauseKey);
  // Capacity comes from the current program revision, so an owner can raise
  // it by revision; the frozen terms keep the receipt-time amount.
  const program = await currentProgram(deps, row.project_id);
  const capacity =
    program?.manifest.securityBounty?.capacity.awards ?? terms.capacityAwards;
  const order = [
    row.project_id,
    row.id,
    row.received_at,
    row.received_at,
    row.id,
  ];
  const earlierWaiting =
    (await deps.db
      .prepare(`${EARLIER_RECEIPT_WAITING} LIMIT 1`)
      .bind(...order)
      .first()) !== null;
  const before = [
    deps.db
      .prepare(
        `INSERT INTO security_award_reservations (case_id, project_id, root_cause_key, policy_revision, gross_minor, currency, reserved_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM security_award_reservations WHERE project_id = ?) < ? AND (SELECT revision FROM security_cases WHERE id = ?) = ? AND NOT EXISTS (${EARLIER_RECEIPT_WAITING}) AND NOT EXISTS (${ROOT_CAUSE_PENDING_REVIEW})`,
      )
      .bind(
        row.id,
        row.project_id,
        rootCauseKey,
        row.policy_revision,
        terms.grossMinor,
        terms.currency,
        at,
        row.project_id,
        capacity,
        row.id,
        row.revision,
        ...order,
        row.project_id,
        row.id,
        rootCauseKey,
      ),
  ];
  return {
    earlierWaiting,
    change: {
      before,
      awardStateSql:
        "CASE WHEN EXISTS (SELECT 1 FROM security_award_reservations WHERE case_id = security_cases.id) THEN 'reserved' ELSE 'capacity-exhausted' END",
    },
  };
}

async function actOnCase(
  request: Request,
  deps: SecurityApiDependencies,
  caseId: string,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  const body = await readJsonObject(request);
  const row = await loadCase(deps, caseId);
  if (row === null) notFound();
  const program = await currentProgram(deps, row.project_id);
  const roles = await caseRoles(
    deps,
    row,
    actor,
    program?.manifest.securityBounty,
  );
  if (roles.size === 0) notFound();
  const action = typeof body.action === "string" ? body.action : "";
  const idempotencyKey = stringField(body, "idempotencyKey", IDEMPOTENCY_KEY);
  const replay = await deps.db
    .prepare(
      "SELECT kind, actor_github_id FROM security_case_events WHERE case_id = ? AND idempotency_key = ?",
    )
    .bind(row.id, idempotencyKey)
    .first<{ kind: string; actor_github_id: string }>();
  if (replay !== null) {
    if (replay.kind !== action || replay.actor_github_id !== actor.githubId)
      fail(409, "idempotency_conflict", "That request key was already used");
    return json(200, {
      replayed: true,
      case: await caseView(deps, row, roles, true),
    });
  }
  if (
    typeof body.expectedRevision !== "number" ||
    !Number.isSafeInteger(body.expectedRevision)
  )
    fail(400, "invalid_request", "Invalid expectedRevision");
  if (body.expectedRevision !== row.revision)
    fail(409, "stale_revision", "The case changed since you loaded it");
  if (
    row.submission_state !== "verified" &&
    action !== "verify-link" &&
    action !== "reject-link"
  )
    fail(409, "not_verified", "The case is not verified yet");
  const change = await planChange(
    deps,
    row,
    roles,
    actor,
    action,
    body,
    idempotencyKey,
  );
  const at = deps.now().toISOString();
  const columns = Object.keys(change.set);
  const assignments = [
    ...columns.map((column) => `${column} = ?`),
    ...(change.awardStateSql ? [`award_state = ${change.awardStateSql}`] : []),
    "revision = revision + 1",
    "updated_at = ?",
  ];
  const update = deps.db
    .prepare(
      `UPDATE security_cases SET ${assignments.join(", ")} WHERE id = ? AND revision = ?${
        change.requireSql ? ` AND ${change.requireSql}` : ""
      }`,
    )
    .bind(
      ...columns.map((column) => change.set[column]),
      at,
      row.id,
      row.revision,
    );
  let results: D1Result[];
  try {
    results = await deps.db.batch([
      ...(change.before ?? []),
      update,
      eventStatement(deps, {
        caseId: row.id,
        revision: row.revision + 1,
        kind: change.kind,
        actor,
        role: change.role,
        idempotencyKey,
        reason: change.reason,
        evidenceReference: change.evidenceReference,
        detail: change.detail,
        at,
        guard: true,
      }),
      ...(change.after ?? []),
      accessLog(deps, row.id, actor, roles, "write"),
      ...inboxStatements(deps, {
        caseId: row.id,
        revision: row.revision + 1,
        kind: change.kind,
        idempotencyKey,
        reporterGithubId: row.reporter_github_id,
        detail: change.detail,
        terms: program?.manifest.securityBounty,
      }),
    ]);
  } catch (error) {
    const message = constraintError(error);
    if (/security_award_reservations/iu.test(message))
      fail(
        409,
        "root_cause_reserved",
        "This root cause already reserved an award; record a duplicate instead",
      );
    if (/security_case_members/iu.test(message))
      fail(409, "already_assigned", "That account is already a triager");
    if (/security_cases\.advisory_ghsa/iu.test(message))
      fail(
        409,
        "advisory_already_recorded",
        "This advisory already has a verified case",
      );
    if (/UNIQUE/iu.test(message))
      fail(409, "stale_revision", "The case changed since you loaded it");
    throw error;
  }
  const updateResult = results[(change.before ?? []).length];
  if ((updateResult?.meta?.changes ?? 0) !== 1) {
    const current = await loadCase(deps, row.id);
    if (change.unmet && current?.revision === row.revision)
      fail(409, change.unmet.code, change.unmet.message);
    fail(409, "stale_revision", "The case changed since you loaded it");
  }
  const updated = (await loadCase(deps, row.id)) as CaseRow;
  const nextRoles = await caseRoles(
    deps,
    updated,
    actor,
    program?.manifest.securityBounty,
  );
  return json(200, {
    case:
      nextRoles.size === 0
        ? { id: updated.id, revision: updated.revision }
        : await caseView(deps, updated, nextRoles, true),
  });
}

/**
 * Checks that the program's GitHub private vulnerability reporting is on
 * before the site hands a researcher to it (SEC-07). Every other answer
 * blocks the handoff; there is no public fallback.
 */
async function intakeReadiness(
  deps: SecurityApiDependencies,
  projectId: string,
): Promise<Response> {
  if (!PROJECT_ID.test(projectId))
    fail(404, "program_not_found", "No security program");
  const program = await currentProgram(deps, projectId);
  if (program === null || program.manifest.listingTier === "retired")
    fail(404, "program_not_found", "No security program");
  const terms = program.manifest.securityBounty as SecurityBountyTerms;
  const checkedAt = deps.now().toISOString();
  const repository = terms.intake.repository;
  let state: "ready" | "disabled" | "forbidden" | "unavailable";
  try {
    const response = await deps.github.fetch(
      `${deps.github.apiOrigin}/repos/${repository}/private-vulnerability-reporting`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "slop.cash-security-intake",
          "x-github-api-version": "2022-11-28",
          ...(deps.github.token
            ? { authorization: `Bearer ${deps.github.token}` }
            : {}),
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 401 || response.status === 403) state = "forbidden";
    else if (!response.ok) state = "unavailable";
    else {
      const body = (await response.json()) as { enabled?: unknown };
      state =
        body.enabled === true
          ? "ready"
          : body.enabled === false
            ? "disabled"
            : "unavailable";
    }
  } catch {
    state = "unavailable";
  }
  const closed =
    terms.capacity.closesAt !== null &&
    Date.parse(terms.capacity.closesAt) <= Date.parse(checkedAt);
  return json(
    200,
    {
      projectId,
      repository,
      state,
      checkedAt,
      maxAgeSeconds: INTAKE_READINESS_TTL_SECONDS,
      programStatus: terms.status,
      // Pause or closure stops new paid research, never the private route.
      paidParticipation: terms.status === "open" && !closed ? "open" : "closed",
      handoffUrl:
        state === "ready"
          ? `https://github.com/${repository}/security/advisories/new`
          : null,
    },
    `public, max-age=0, s-maxage=${INTAKE_READINESS_TTL_SECONDS}`,
  );
}

function pathParts(request: Request): string[] {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/v1/")) return [];
  return path.slice("/api/v1/".length).split("/").filter(Boolean);
}

/** Returns null when the path belongs to another API module. */
async function acknowledgeNotice(
  request: Request,
  deps: SecurityApiDependencies,
  caseId: string,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  const access = await securityNotificationAccess(
    deps.db,
    caseId,
    actor.githubId,
  );
  if (!access.allowed) notFound();
  const body = await readJsonObject(request);
  exactKeys(body, ["eventKey"]);
  if (typeof body.eventKey !== "string")
    fail(400, "invalid_request", "An inbox event key is required");
  const at = deps.now().toISOString();
  const results = await deps.db.batch([
    deps.db
      .prepare(`UPDATE security_notification_outbox SET acknowledged_at = ?, updated_at = ?
      WHERE case_id = ? AND event_key = ? AND recipient_github_id = ? AND acknowledged_at IS NULL`)
      .bind(at, at, caseId, body.eventKey, actor.githubId),
    deps.db
      .prepare(`INSERT INTO security_notification_delivery_events(delivery_id, state, at)
      SELECT id, 'acknowledged', ? FROM security_notification_outbox
      WHERE case_id = ? AND event_key = ? AND recipient_github_id = ? AND acknowledged_at = ?
      AND NOT EXISTS (SELECT 1 FROM security_notification_delivery_events e WHERE e.delivery_id = security_notification_outbox.id AND e.state = 'acknowledged')`)
      .bind(at, caseId, body.eventKey, actor.githubId, at),
  ]);
  if (!results[0].meta?.changes) {
    const existing = await deps.db
      .prepare(
        `SELECT acknowledged_at FROM security_notification_outbox WHERE case_id = ? AND event_key = ? AND recipient_github_id = ?`,
      )
      .bind(caseId, body.eventKey, actor.githubId)
      .first<{ acknowledged_at: string | null }>();
    if (existing === null) notFound();
  }
  return json(200, { acknowledged: true });
}

export async function handleSecurityApi(
  request: Request,
  deps: SecurityApiDependencies,
): Promise<Response | null> {
  const parts = pathParts(request);
  if (parts[0] !== "security-cases" && parts[0] !== "security-programs")
    return null;
  try {
    if (
      request.method !== "GET" &&
      (request.headers.get("origin") !== new URL(request.url).origin ||
        request.headers.get("content-type")?.split(";")[0] !==
          "application/json")
    )
      fail(403, "origin_forbidden", "Requests must come from this site");
    if (
      request.method === "GET" &&
      parts[0] === "security-programs" &&
      parts.length === 3 &&
      parts[2] === "intake"
    )
      return await cachedPublicResponse(
        deps.cache,
        request,
        () => intakeReadiness(deps, parts[1]),
        deps.waitUntil,
      );
    if (parts[0] === "security-cases") {
      if (
        request.method === "POST" &&
        parts.length === 3 &&
        parts[2] === "acknowledge"
      )
        return await acknowledgeNotice(request, deps, parts[1]);
      if (request.method === "GET" && parts.length === 1)
        return await listCases(request, deps);
      if (request.method === "POST" && parts.length === 1)
        return await createCase(request, deps);
      if (request.method === "GET" && parts.length === 2)
        return await readCase(request, deps, parts[1]);
      if (
        request.method === "POST" &&
        parts.length === 3 &&
        parts[2] === "actions"
      )
        return await actOnCase(request, deps, parts[1]);
    }
    return json(404, { error: "not_found" });
  } catch (caught) {
    const error =
      typeof caught === "object" && caught !== null
        ? (caught as Partial<ApiError>)
        : {};
    const status =
      Number.isSafeInteger(error.status) &&
      Number(error.status) >= 400 &&
      Number(error.status) <= 599
        ? Number(error.status)
        : 500;
    // Never log case content, identifiers or the request body.
    if (status >= 500) console.error("security case API failure");
    return json(status, {
      error:
        typeof error.code === "string" &&
        /^[a-z][a-z0-9_]{1,63}$/u.test(error.code)
          ? error.code
          : "internal_error",
      message:
        status >= 500 || typeof error.message !== "string"
          ? "Internal error"
          : error.message,
    });
  }
}
