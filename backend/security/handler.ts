import { paymentDeploymentRecord } from "../../src/lib/escrow-policy.mjs";
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
import type { GithubActor as Actor } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import {
  type SecurityBountyTerms,
  securityBountySplit,
} from "../../src/lib/security-bounty.mjs";
import { type ApiError, fail } from "../api-error";
import { pathParts } from "../api-path";
import type {
  D1Result,
  D1QueryStatement as D1Statement,
  D1TransactionalDatabase,
} from "../d1";
import { notifySecurityCase } from "../notifications/events";
import {
  hasParticipationBan,
  PARTICIPATION_BAN_QUERY,
} from "../projects/account-bans";
import { cachedPublicResponse, type EdgeCache } from "../projects/edge-cache";
import { readJsonObject } from "../trace/validation";
import type { AdvisoryReader, GithubPrivateReport } from "./advisories";
import {
  ANALYSIS_TIMEOUT_MS,
  analysisMayStart,
  appealTriageMayStart,
  BACKGROUND_ANALYSIS_TIMEOUT_MS,
  latestAppealTriage,
  latestCaseAnalysis,
  runAppealTriage,
  runCaseAnalysis,
  type SecurityAnalysisReport,
  type SecurityAnalyzer,
} from "./analysis";
import type { IntakeConfig } from "./intake-grant";
import { prepareSecuritySettlement, securitySettlementView } from "./payments";
import {
  OUTSTANDING_RESERVATIONS,
  readSecurityProgramFunds,
} from "./program-funds";
import { handleSubmissionRoute } from "./submissions";
export type SecurityD1Database = D1TransactionalDatabase<D1Statement>;

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
  /**
   * Reads the program repository's private vulnerability reports so receipt
   * is verified from GitHub, never typed in. Absent means receipt checks are
   * unavailable: nothing is verified and nothing is rejected.
   */
  advisories?: AdvisoryReader | null;
  /**
   * The Surplus analyzer with the operator account key
   * (PRD section 8); absent = unavailable.
   */
  analyzer?: SecurityAnalyzer | null;
  /**
   * Slop moderators (`PROJECT_MODERATOR_GITHUB_IDS`). PRD section 10 has two
   * authorities: the project owner or maintainer decides technical, award
   * and disclosure questions, and a moderator decides escalated appeals and
   * related-party award reviews (the `dispute` role).
   */
  moderatorGithubIds?: ReadonlySet<string>;
  cache?: EdgeCache;
  waitUntil?: (promise: Promise<unknown>) => void;
  /**
   * Automatic private intake through the reporter's own GitHub
   * authorization. Absent or `mode: "off"` (the default) keeps every
   * submission route closed and the manual claim flow unchanged.
   */
  intake?: IntakeConfig;
};

export type Role =
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
  received_at_source: "maintainer-attested" | "github-verified" | null;
  receipt_evidence_digest: string | null;
  award_gross_minor: string | null;
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

export type FrozenTerms = {
  grossMinor: string;
  researcherMinor: string;
  slopMinor: string;
  currency: SecurityBountyTerms["amount"]["currency"];
  decimals: number;
  network: SecurityBountyTerms["amount"]["network"];
  capacityAwards: number;
};

export const PROJECT_ID = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;
const CASE_ID = /^sc_[A-Za-z0-9_-]{8,72}$/u;
export const GHSA =
  /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/u;
const GITHUB_ID = /^[1-9]\d{0,19}$/u;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,80}$/u;
const ROOT_CAUSE = /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const GROSS_MINOR = /^[1-9]\d{0,15}$/u;
/**
 * `verified_by_github_id` of a receipt that Slop verified from GitHub's own
 * private vulnerability report, rather than a person (migration 0061).
 */
const GITHUB_VERIFIER = "github";
const RECEIVED_AT_SOURCE = "maintainer-attested";
/** A browser that kept an older readiness answer must check again. */
export const INTAKE_READINESS_TTL_SECONDS = 30;

export function json(
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

export function stringField(
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

export function exactKeys(
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

export async function requireActor(
  request: Request,
  deps: SecurityApiDependencies,
): Promise<Actor> {
  const actor = await deps.sessionActor(request);
  if (actor === null) fail(401, "unauthorized", "Sign in with GitHub");
  return actor;
}

export async function currentProgram(
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
  moderators: ReadonlySet<string>,
): Set<Role> {
  const roles = new Set<Role>();
  if (terms === undefined) return roles;
  if (terms.approvers.technical.some((entry) => entry.githubId === githubId))
    roles.add("security-maintainer");
  if (terms.approvers.financial.some((entry) => entry.githubId === githubId))
    roles.add("financial");
  // The program names a dispute contact; a Slop moderator decides.
  if (moderators.has(githubId)) roles.add("dispute");
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
  deps: Pick<SecurityApiDependencies, "db" | "moderatorGithubIds">,
  row: CaseRow,
  actor: Actor,
  terms: SecurityBountyTerms | undefined,
): Promise<Set<Role>> {
  const roles = programRoles(
    terms,
    actor.githubId,
    deps.moderatorGithubIds ?? new Set(),
  );
  // A moderator reads only cases with an appeal or a related-party award
  // review.
  if (
    row.appeal_state === "none" &&
    row.related_party_review === "not-applicable"
  )
    roles.delete("dispute");
  // Finance needs nothing before the owner approved an award.
  if (!["reserved", "approved"].includes(row.award_state))
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
  moderatorGithubIds: ReadonlySet<string> = new Set(),
): Promise<{ allowed: boolean; acknowledgeHours: number }> {
  const row = await loadCase({ db }, caseId);
  if (row === null) return { allowed: false, acknowledgeHours: 0 };
  const program = await currentProgram({ db }, row.project_id);
  const roles = await caseRoles(
    { db, moderatorGithubIds },
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
  // Kinds that older cases still carry stay visible to their reporter.
  "claim",
  "submit",
  "submit-direct",
  "record",
  "verify-link",
  "reject-link",
  "triage",
  "reserve-award",
  "approve-award",
  "receive",
  "receipt-mismatch",
  "request-information",
  "decide",
  "award",
  "remediation",
  "consent-payment",
  "prepare-payment",
  "appeal",
  "decide-appeal",
  "decide-related-party",
  "disclosure",
  "recognition",
]);

const OPEN_RECEIPT = ["received", "needs-information", "triaging"];

/**
 * The owner may still choose an award: a confirmed finding with paid terms
 * frozen at receipt, no award chosen yet, no related-party review or appeal
 * in progress. A case that waited for capacity, or held a reservation before
 * discretionary awards, can be awarded the same way (PRD section 8).
 */
function awardOpen(row: CaseRow): boolean {
  return (
    row.receipt_state === "confirmed" &&
    row.terms !== null &&
    row.appeal_state !== "open" &&
    row.related_party_review !== "pending" &&
    ["pending", "capacity-exhausted", "reserved"].includes(row.award_state)
  );
}

function allowedActions(row: CaseRow, roles: Set<Role>): string[] {
  const actions: string[] = [];
  if (row.submission_state !== "verified") {
    // Preserve manual verification for legacy links when GitHub intake is unavailable.
    if (row.submission_state === "claimed" && roles.has("security-maintainer"))
      actions.push("verify-link", "reject-link");
    // A link from before automatic receipt is settled against GitHub.
    if (
      row.submission_state === "claimed" &&
      (roles.has("reporter") || roles.has("security-maintainer"))
    )
      actions.push("check-receipt");
    return actions;
  }
  const open = OPEN_RECEIPT.includes(row.receipt_state);
  if (roles.has("reporter")) {
    if (row.award_state === "approved") actions.push("consent-payment");
    actions.push("recognition");
    // An award the program withheld stays appealable: the shortage or a
    // refusal is an award exception, not a finding change (SEC-12), and a
    // separate reviewer resolves it (SEC-04, SEC-18).
    if (
      row.appeal_state !== "open" &&
      (["duplicate", "out-of-scope", "rejected"].includes(row.receipt_state) ||
        (row.receipt_state === "confirmed" &&
          ["ineligible", "capacity-exhausted"].includes(row.award_state)))
    )
      actions.push("appeal");
  }
  if (roles.has("security-maintainer")) {
    if (open) actions.push("request-information", "decide");
    if (awardOpen(row)) actions.push("award");
    actions.push("remediation", "disclosure", "assign-triager");
    actions.push("revoke-triager");
  } else if (roles.has("triager")) {
    if (open) actions.push("request-information");
    actions.push("remediation");
  }
  if (
    (roles.has("security-maintainer") || roles.has("financial")) &&
    row.award_state === "approved"
  )
    actions.push("prepare-payment");
  if (roles.has("dispute") && row.appeal_state === "open")
    actions.push("decide-appeal");
  if (
    roles.has("dispute") &&
    row.related_party_review === "pending" &&
    row.receipt_state === "confirmed" &&
    row.award_state === "pending"
  )
    actions.push("decide-related-party");
  return actions;
}

/**
 * The one next step for this viewer, derived from the case state, so nobody
 * maintains a separate task field. The first response is due within the
 * program's published acknowledgement target after GitHub's receipt.
 */
function nextStep(
  row: CaseRow,
  roles: Set<Role>,
  settlementState: string | null,
  acknowledgeHours: number | null,
  railAvailable: boolean,
): { text: string; dueAt: string | null } {
  const owner = roles.has("security-maintainer") || roles.has("triager");
  const reporter = roles.has("reporter");
  if (row.submission_state === "claimed")
    return {
      text: "Slop is confirming this report with GitHub.",
      dueAt: null,
    };
  if (row.submission_state === "link-rejected")
    return {
      text: "GitHub does not show this report as a private report from this account.",
      dueAt: null,
    };
  if (row.appeal_state === "open")
    return {
      text: roles.has("dispute")
        ? "Decide the appeal."
        : "An independent reviewer is deciding the appeal.",
      dueAt: null,
    };
  if (row.receipt_state === "received" || row.receipt_state === "triaging")
    return {
      text: owner
        ? "Review the report and the AI summary, then decide or ask the reporter for information."
        : "Waiting for the project owner's response.",
      dueAt:
        row.receipt_state === "received" &&
        row.received_at !== null &&
        acknowledgeHours !== null
          ? new Date(
              Date.parse(row.received_at) + acknowledgeHours * 3_600_000,
            ).toISOString()
          : null,
    };
  if (row.receipt_state === "needs-information")
    return {
      text: reporter
        ? "Answer the owner's question in the GitHub advisory."
        : "Waiting for the reporter's answer in the GitHub advisory; decide when ready.",
      dueAt: null,
    };
  if (row.related_party_review === "pending" && row.award_state === "pending")
    return {
      text: roles.has("dispute")
        ? "Review the proposed related-party award."
        : "An independent reviewer is reviewing the proposed award.",
      dueAt: null,
    };
  if (awardOpen(row))
    return {
      text: roles.has("security-maintainer")
        ? "Choose an award amount or no award."
        : "Waiting for the owner's award decision.",
      dueAt: null,
    };
  if (row.award_state === "approved" && settlementState !== "paid") {
    // Without a reviewed private payment rail nobody can act yet.
    if (settlementState === null && !railAvailable)
      return {
        text: "The award is approved and reserved. Payment waits for the program's reviewed private payment rail.",
        dueAt: row.payment_deadline,
      };
    if (settlementState === null)
      return {
        text: reporter
          ? "Accept payment visibility so the payer can prepare your payment."
          : roles.has("security-maintainer") || roles.has("financial")
            ? "Prepare the private payment after the reporter accepts visibility."
            : "Waiting for payment preparation.",
        dueAt: row.payment_deadline,
      };
    return {
      text: "The payment is in progress.",
      dueAt: row.payment_deadline,
    };
  }
  if (
    owner &&
    row.receipt_state === "confirmed" &&
    !["resolved", "mitigation-verified"].includes(row.remediation_state)
  )
    return { text: "Fix the issue and record remediation.", dueAt: null };
  return { text: "No action needed.", dueAt: null };
}

async function programFunds(
  deps: Pick<SecurityApiDependencies, "db" | "now">,
  projectId: string,
  snapshotGuards: { sql: string; values: unknown[] }[] = [],
) {
  const program = (await currentProgram(deps, projectId))?.manifest
    .securityBounty;
  if (program === undefined || program.funding.state !== "verified-available")
    return null;
  return readSecurityProgramFunds(deps, projectId, program, snapshotGuards);
}

/** The chosen award and its exact 75/25 split, once an amount exists. */
function awardAmount(
  row: CaseRow,
  reservation: ReservationRow | null,
): ReturnType<typeof securityBountySplit> | null {
  const gross = reservation?.gross_minor ?? row.award_gross_minor;
  return gross === null ? null : securityBountySplit(gross);
}

/**
 * Shapes a case for the caller's strongest role. Finance receives only the
 * award and payment fields; a reporter sees the receipt, the owner's
 * response and the payout, never another report, the root cause key,
 * triagers, the AI analysis or evidence references (SEC-04, SEC-08).
 */
async function caseView(
  deps: SecurityApiDependencies,
  row: CaseRow,
  roles: Set<Role>,
  includeHistory: boolean,
): Promise<Record<string, unknown>> {
  const terms = frozenTerms(row);
  const settlement = await securitySettlementView(deps.db, row.id);
  const current = await currentProgram(deps, row.project_id);
  const reservation = await deps.db
    .prepare(
      "SELECT root_cause_key, policy_revision, gross_minor, currency, reserved_at FROM security_award_reservations WHERE case_id = ?",
    )
    .bind(row.id)
    .first<ReservationRow>();
  const railAvailable =
    (current?.manifest.securityBounty?.settlement?.deployments.length ?? 0) > 0;
  const step = nextStep(
    row,
    roles,
    settlement?.state ?? null,
    current?.manifest.securityBounty?.responseTargets?.acknowledgeHours ?? null,
    railAvailable,
  );
  const base = {
    id: row.id,
    projectId: row.project_id,
    revision: row.revision,
    viewerRoles: [...roles].sort(),
    allowedActions: allowedActions(row, roles).filter(
      (action) =>
        !["prepare-payment", "consent-payment"].includes(action) ||
        (!settlement && railAvailable),
    ),
    nextStep: step.text,
    nextStepDueAt: step.dueAt,
    submissionState: row.submission_state,
    receivedAt: row.received_at,
    receivedAtSource:
      row.received_at === null
        ? null
        : (row.received_at_source ?? RECEIVED_AT_SOURCE),
    policyRevision: row.policy_revision,
    terms,
    awardState: row.award_state,
    award: awardAmount(row, reservation),
    relatedParty: row.related_party,
    relatedPartyReview: row.related_party_review,
    paymentState: settlement?.state ?? row.payment_state,
    paymentRail: settlement ? "escrow" : "unavailable",
    settlement,
    paymentNetworks:
      current?.manifest.securityBounty?.settlement?.deployments.map(
        (d) => d.network,
      ) ?? [],
    paymentDeadline: row.payment_deadline,
  };
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
  const analysis =
    includeHistory && row.submission_state === "verified"
      ? await latestCaseAnalysis(deps, row.id)
      : null;
  const maintainer = roles.has("security-maintainer");
  // Slopbot's drafted resolution of the open appeal (PRD section 8).
  const appealTriage =
    includeHistory && row.appeal_state === "open"
      ? await latestAppealTriage(deps, row.id)
      : null;
  return {
    ...shared,
    allowedActions: [
      ...shared.allowedActions,
      // The owner or a triager may run a missing, failed or lost analysis.
      ...((maintainer || roles.has("triager")) &&
      includeHistory &&
      row.submission_state === "verified" &&
      (analysis === null || analysis.retryable)
        ? ["analyze"]
        : []),
      // A dispute reviewer may run a missing, failed or lost appeal triage.
      ...(roles.has("dispute") &&
      includeHistory &&
      row.appeal_state === "open" &&
      (appealTriage === null || appealTriage.retryable)
        ? ["triage-appeal"]
        : []),
    ],
    appealTriage,
    view: "restricted",
    reporter: {
      githubId: row.reporter_github_id,
      githubLogin: row.reporter_github_login,
    },
    analysis,
    awardFunds:
      maintainer && includeHistory
        ? await programFunds(deps, row.project_id)
        : null,
    verifiedAt: row.verified_at,
    evidenceDigest: row.evidence_digest,
    receiptEvidenceDigest: row.receipt_evidence_digest,
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
  "id, project_id, advisory_repository, advisory_ghsa, reporter_github_id, reporter_github_login, submission_state, received_at, verified_at, verified_by_github_id, policy_revision, terms, evidence_digest, receipt_state, remediation_state, award_state, payment_state, disclosure_state, recognition, severity, loss_finding, root_cause_key, duplicate_of, technical_decider_github_id, appeal_state, appeal_from_state, owner_github_id, next_action, next_action_due_at, payment_deadline, related_party, related_party_review, related_party_reviewer_github_id, received_at_source, receipt_evidence_digest, award_gross_minor, revision, created_at, updated_at";

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
    .filter(
      ([, terms]) =>
        programRoles(
          terms,
          actor.githubId,
          deps.moderatorGithubIds ?? new Set(),
        ).size > 0,
    )
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
  const reads: D1Statement[] = [];
  for (const row of result.results ?? []) {
    const roles = await caseRoles(deps, row, actor, all.get(row.project_id));
    if (roles.size === 0) continue;
    cases.push(await caseView(deps, row, roles, false));
    reads.push(accessLog(deps, row.id, actor, roles, "read"));
  }
  // The list discloses private case fields too. Persist its read audit before
  // returning any cases, just as the individual case route does.
  if (reads.length > 0) await deps.db.batch(reads);
  const programsForActor = projectIds.map((id) => ({
    projectId: id,
    roles: [
      ...programRoles(
        all.get(id),
        actor.githubId,
        deps.moderatorGithubIds ?? new Set(),
      ),
    ].sort(),
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
export async function termsAtReceipt(
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

export function eventStatement(
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

/**
 * Inbox rows for one case event (NOT-01, SEC-09): the reporter for every
 * event their own view shows, the security maintainers for a verified
 * receipt, the moderators for an appeal or a proposed related-party award, the assigned triager, and the financial approvers when an award was
 * approved and reserved. The actor is never notified of their own action.
 */
export function inboxStatements(
  deps: SecurityApiDependencies,
  input: {
    caseId: string;
    revision: number;
    kind: string;
    idempotencyKey: string;
    reporterGithubId: string;
    detail: Record<string, unknown>;
    terms: SecurityBountyTerms | undefined;
    /** The change proposes a related-party award for independent review. */
    relatedReview?: boolean;
  },
): D1Statement[] {
  const ids = (role: "technical" | "financial") =>
    (input.terms?.approvers[role] ?? []).map((entry) => entry.githubId);
  const event = {
    caseId: input.caseId,
    revision: input.revision,
    idempotencyKey: input.idempotencyKey,
  };
  const recipients = [
    ...(REPORTER_EVENT_KINDS.has(input.kind) ? [input.reporterGithubId] : []),
    ...(input.kind === "receive" ||
    input.kind === "claim" ||
    input.kind === "submit" ||
    input.kind === "submit-direct"
      ? ids("technical")
      : []),
    ...(input.kind === "appeal" || input.relatedReview
      ? [...(deps.moderatorGithubIds ?? [])]
      : []),
    ...(input.kind === "assign-triager" &&
    typeof input.detail.githubId === "string"
      ? [input.detail.githubId]
      : []),
  ];
  return [
    notifySecurityCase(deps.db, { ...event, recipients }),
    // Only an award that this batch approved and reserved reaches finance.
    ...(AWARDING_KINDS.has(input.kind)
      ? [
          notifySecurityCase(deps.db, {
            ...event,
            recipients: ids("financial"),
            awardState: "approved",
          }),
        ]
      : []),
  ];
}

/** Case events that can approve and reserve an award in their batch. */
const AWARDING_KINDS = new Set(["decide", "award", "decide-related-party"]);

function constraintError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function handoffUrl(terms: SecurityBountyTerms): string {
  return `https://github.com/${terms.intake.repository}/security/advisories/new`;
}

/**
 * Inserts a new case at revision 1. A verified case freezes its receipt
 * time, the terms in force then, and the source of that time. `guard` is an
 * SQL condition (with its values) that must hold for the row to be written,
 * so an automatic receipt commits only with its own submission transition.
 */
export function caseInsertStatement(
  deps: Pick<SecurityApiDependencies, "db">,
  input: {
    id: string;
    projectId: string;
    repository: string;
    advisory: string;
    reporter: Actor;
    verified: {
      receivedAt: string;
      verifiedBy: string;
      policyRevision: number | null;
      terms: FrozenTerms | null;
      source?: "github-verified";
      receiptEvidenceDigest?: string;
    } | null;
    ownerGithubId: string | null;
    nextAction?: string;
    nextActionDueAt?: string | null;
    at: string;
    guard?: { sql: string; values: unknown[] };
  },
): D1Statement {
  const { verified } = input;
  return deps.db
    .prepare(
      `INSERT INTO security_cases (id, project_id, advisory_repository, advisory_ghsa, reporter_github_id, reporter_github_login, submission_state, received_at, verified_at, verified_by_github_id, policy_revision, terms, evidence_digest, receipt_state, remediation_state, award_state, payment_state, disclosure_state, recognition, appeal_state, owner_github_id, next_action, next_action_due_at, received_at_source, receipt_evidence_digest, revision, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'received', 'not-started', ?, 'not-applicable', 'embargoed', 'private', 'none', ?, ?, ?, ?, ?, 1, ?, ?${
         input.guard ? ` WHERE ${input.guard.sql}` : ""
}`,
    )
    .bind(
      input.id,
      input.projectId,
      input.repository,
      input.advisory,
      input.reporter.githubId,
      input.reporter.githubLogin,
      verified ? "verified" : "claimed",
      verified?.receivedAt ?? null,
      verified ? input.at : null,
      verified?.verifiedBy ?? null,
      verified?.policyRevision ?? null,
      verified?.terms ? JSON.stringify(verified.terms) : null,
      verified?.terms ? "pending" : "not-applicable",
      input.ownerGithubId,
      input.nextAction ?? null,
      input.nextActionDueAt ?? null,
      verified?.source ?? null,
      verified?.receiptEvidenceDigest ?? null,
      input.at,
      input.at,
      ...(input.guard?.values ?? []),
    );
}

/**
 * Starts the private analysis of a newly verified case. It runs after the
 * response where the platform allows it, within the background time limit,
 * and inline otherwise. `report` is the advisory content that receipt
 * verification already read from GitHub; it stays in memory. Without it, the
 * analysis reads the advisory again.
 */
export async function scheduleAnalysis(
  deps: SecurityApiDependencies,
  caseId: string,
  report: SecurityAnalysisReport | null,
): Promise<void> {
  const run = (timeoutMs: number) =>
    runCaseAnalysis(analysisDependencies(deps), caseId, report, timeoutMs);
  if (deps.waitUntil) deps.waitUntil(run(BACKGROUND_ANALYSIS_TIMEOUT_MS));
  else await run(ANALYSIS_TIMEOUT_MS);
}

/**
 * Starts Slopbot's triage of a newly opened appeal, after the response where
 * the platform allows it and inline otherwise, like the report analysis.
 */
async function scheduleAppealTriage(
  deps: SecurityApiDependencies,
  caseId: string,
): Promise<void> {
  const run = (timeoutMs: number) =>
    runAppealTriage(analysisDependencies(deps), caseId, timeoutMs);
  if (deps.waitUntil) deps.waitUntil(run(BACKGROUND_ANALYSIS_TIMEOUT_MS));
  else await run(ANALYSIS_TIMEOUT_MS);
}

function analysisDependencies(deps: SecurityApiDependencies) {
  return {
    db: deps.db,
    now: deps.now,
    advisories: deps.advisories ?? null,
    analyzer: deps.analyzer ?? null,
  };
}

/**
 * Records GitHub private vulnerability reports as verified cases. GitHub's
 * report names its author and creation time, so the receipt needs no human
 * check: the case belongs to that GitHub account, and the receipt time and
 * the program terms in force then are frozen (PRD section 8). A pending link
 * from before automatic receipt by the same author becomes that case. A
 * report that already has a case is left as it is. Returns the newly
 * verified cases; each one gets a private analysis.
 */
async function recordPrivateReports(
  deps: SecurityApiDependencies,
  input: {
    projectId: string;
    terms: SecurityBountyTerms;
    reports: GithubPrivateReport[];
    actor: Actor;
  },
): Promise<string[]> {
  const received: { caseId: string; report: GithubPrivateReport }[] = [];
  for (const report of input.reports) {
    const at = deps.now().toISOString();
    const recorded = await deps.db
      .prepare(
        "SELECT id FROM security_cases WHERE project_id = ? AND advisory_ghsa = ? AND submission_state = 'verified'",
      )
      .bind(input.projectId, report.ghsa)
      .first<{ id: string }>();
    if (recorded !== null) continue;
    const frozen = await termsAtReceipt(
      deps,
      input.projectId,
      report.createdAt,
    );
    const claim = await deps.db
      .prepare(
        `SELECT ${CASE_COLUMNS} FROM security_cases WHERE project_id = ? AND advisory_ghsa = ? AND reporter_github_id = ? AND submission_state = 'claimed'`,
      )
      .bind(input.projectId, report.ghsa, report.author.githubId)
      .first<CaseRow>();
    const role: Role =
      input.actor.githubId === report.author.githubId
        ? "reporter"
        : "security-maintainer";
    const idempotencyKey = `receipt-${deps.randomId().replaceAll("-", "")}`;
    const caseId = claim?.id ?? `sc_${deps.randomId().replaceAll("-", "")}`;
    const revision = (claim?.revision ?? 0) + 1;
    const values = [
      report.createdAt,
      at,
      GITHUB_VERIFIER,
      frozen.revision,
      frozen.terms ? JSON.stringify(frozen.terms) : null,
      frozen.terms ? "pending" : "not-applicable",
    ];
    const write =
      claim === null
        ? deps.db
            .prepare(
              `INSERT INTO security_cases (id, project_id, advisory_repository, advisory_ghsa, reporter_github_id, reporter_github_login, submission_state, received_at, received_at_source, verified_at, verified_by_github_id, policy_revision, terms, evidence_digest, receipt_state, remediation_state, award_state, payment_state, disclosure_state, recognition, appeal_state, owner_github_id, revision, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'verified', ?, 'github-verified', ?, ?, ?, ?, NULL, 'received', 'not-started', ?, 'not-applicable', 'embargoed', 'private', 'none', NULL, 1, ?, ?)`,
            )
            .bind(
              caseId,
              input.projectId,
              input.terms.intake.repository,
              report.ghsa,
              report.author.githubId,
              report.author.githubLogin,
              ...values,
              at,
              at,
            )
        : deps.db
            .prepare(
              "UPDATE security_cases SET submission_state = 'verified', received_at = ?, received_at_source = 'github-verified', verified_at = ?, verified_by_github_id = ?, policy_revision = ?, terms = ?, award_state = ?, reporter_github_login = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND submission_state = 'claimed'",
            )
            .bind(
              ...values,
              report.author.githubLogin,
              at,
              claim.id,
              claim.revision,
            );
    try {
      await deps.db.batch([
        write,
        eventStatement(deps, {
          caseId,
          revision,
          kind: "receive",
          actor: input.actor,
          role,
          idempotencyKey,
          reason: null,
          evidenceReference: null,
          detail: {
            advisory: report.ghsa,
            receivedAt: report.createdAt,
            receivedAtSource: "github-verified",
            policyRevision: frozen.revision,
          },
          at,
          guard: claim !== null,
        }),
        accessLog(deps, caseId, input.actor, new Set([role]), "write"),
        ...inboxStatements(deps, {
          caseId,
          revision,
          kind: "receive",
          idempotencyKey,
          reporterGithubId: report.author.githubId,
          detail: {},
          terms: input.terms,
        }),
      ]);
    } catch (error) {
      // A concurrent check recorded this report first.
      if (/UNIQUE/iu.test(constraintError(error))) continue;
      throw error;
    }
    const written = await loadCase(deps, caseId);
    if (
      written?.submission_state === "verified" &&
      written.revision === revision
    )
      received.push({ caseId, report });
  }
  // Each new case's analysis reads the report this import already holds.
  for (const entry of received)
    await scheduleAnalysis(deps, entry.caseId, {
      summary: entry.report.summary,
      description: entry.report.description,
      severity: entry.report.severity,
      cvss: null,
      cweIds: entry.report.cweIds,
      packages: entry.report.packages,
    });
  return received.map((entry) => entry.caseId);
}

/**
 * Settles links from before automatic receipt that GitHub does not confirm:
 * the advisory is not a private report in the program repository, or it
 * names another account. The list it compares with is complete, so this is
 * a verified answer, not a guess. `claimant` limits it to one reporter.
 */
async function rejectUnconfirmedClaims(
  deps: SecurityApiDependencies,
  input: {
    projectId: string;
    terms: SecurityBountyTerms;
    reports: GithubPrivateReport[];
    actor: Actor;
    claimant: string | null;
  },
): Promise<void> {
  const claims =
    (
      await deps.db
        .prepare(
          `SELECT ${CASE_COLUMNS} FROM security_cases WHERE project_id = ? AND submission_state = 'claimed' AND (? IS NULL OR reporter_github_id = ?)`,
        )
        .bind(input.projectId, input.claimant, input.claimant)
        .all<CaseRow>()
    ).results ?? [];
  for (const claim of claims) {
    if (
      input.reports.some(
        (report) =>
          report.ghsa === claim.advisory_ghsa &&
          report.author.githubId === claim.reporter_github_id,
      )
    )
      continue;
    const at = deps.now().toISOString();
    const role: Role =
      input.actor.githubId === claim.reporter_github_id
        ? "reporter"
        : "security-maintainer";
    const idempotencyKey = `receipt-${deps.randomId().replaceAll("-", "")}`;
    const revision = claim.revision + 1;
    await deps.db.batch([
      deps.db
        .prepare(
          "UPDATE security_cases SET submission_state = 'link-rejected', revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND submission_state = 'claimed'",
        )
        .bind(at, claim.id, claim.revision),
      eventStatement(deps, {
        caseId: claim.id,
        revision,
        kind: "receipt-mismatch",
        actor: input.actor,
        role,
        idempotencyKey,
        reason: null,
        evidenceReference: null,
        detail: { advisory: claim.advisory_ghsa },
        at,
        guard: true,
      }),
      ...inboxStatements(deps, {
        caseId: claim.id,
        revision,
        kind: "receipt-mismatch",
        idempotencyKey,
        reporterGithubId: claim.reporter_github_id,
        detail: {},
        terms: input.terms,
      }),
    ]);
  }
}

/**
 * Reconciles a program with GitHub: records the private reports that have no
 * case yet and settles older unconfirmed links. `own` limits it to the
 * signed-in reporter's reports. `unavailable` writes nothing and never means
 * that no report exists.
 */
async function reconcileProgram(
  deps: SecurityApiDependencies,
  projectId: string,
  terms: SecurityBountyTerms,
  actor: Actor,
  scope: "own" | "all",
): Promise<
  | { state: "unavailable" }
  | { state: "ok"; received: string[]; reports: GithubPrivateReport[] }
> {
  if (!deps.advisories) return { state: "unavailable" };
  const list = await deps.advisories.privateReports(terms.intake.repository);
  if (list.state !== "ok") return { state: "unavailable" };
  const reports =
    scope === "own"
      ? list.reports.filter(
          (report) => report.author.githubId === actor.githubId,
        )
      : list.reports;
  const received = await recordPrivateReports(deps, {
    projectId,
    terms,
    reports,
    actor,
  });
  await rejectUnconfirmedClaims(deps, {
    projectId,
    terms,
    reports: list.reports,
    actor,
    claimant: scope === "own" ? actor.githubId : null,
  });
  return { state: "ok", received, reports };
}

async function programOrNotFound(
  deps: SecurityApiDependencies,
  projectId: string,
): Promise<SecurityBountyTerms> {
  const program = await currentProgram(deps, projectId);
  if (program === null || program.manifest.listingTier === "retired")
    fail(404, "program_not_found", "This project has no security program");
  return program.manifest.securityBounty as SecurityBountyTerms;
}

/**
 * Starts a private report (PRD section 8, Intake). The signed-in reporter
 * gets one submission per project: a record of who reports where and since
 * when, never report content. Private reporting must be on at GitHub now;
 * otherwise nothing is created and there is no public fallback. An open
 * submission is returned again, so an interrupted report is reconciled
 * before the reporter submits a second time.
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
    if (
      !programRoles(
        terms,
        actor.githubId,
        deps.moderatorGithubIds ?? new Set(),
      ).has("security-maintainer")
    )
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
  const insert = caseInsertStatement(deps, {
    id,
    projectId,
    repository: terms.intake.repository,
    advisory,
    reporter,
    verified: verified
      ? {
          receivedAt: verified.receivedAt,
          verifiedBy: actor.githubId,
          policyRevision: verified.revision,
          terms: verified.terms,
        }
      : null,
    ownerGithubId: verified ? actor.githubId : null,
    at,
  });
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

async function importReports(
  request: Request,
  deps: SecurityApiDependencies,
): Promise<Response> {
  const actor = await requireActor(request, deps);
  const body = await readJsonObject(request);
  exactKeys(body, ["mode", "projectId"]);
  if (body.mode !== "import") fail(400, "invalid_request", "Invalid mode");
  const projectId = stringField(body, "projectId", PROJECT_ID);
  const terms = await programOrNotFound(deps, projectId);
  if (
    !programRoles(
      terms,
      actor.githubId,
      deps.moderatorGithubIds ?? new Set(),
    ).has("security-maintainer")
  )
    fail(403, "forbidden", "Only a security maintainer can import reports");
  const result = await reconcileProgram(deps, projectId, terms, actor, "all");
  return json(200, {
    state: result.state,
    received: result.state === "ok" ? result.received.length : 0,
  });
}

type Change = {
  kind: string;
  role: Role;
  reason: string | null;
  evidenceReference: string | null;
  detail: Record<string, unknown>;
  set: Record<string, string | number | null>;
  before?: D1Statement[];
  /** Runs after the event; each must be guarded by {@link triagerEvent}. */
  after?: D1Statement[];
  /**
   * An extra SQL condition on the case update. When the revision still
   * matches but this condition fails, the request returns `unmet`.
   */
  requireSql?: string;
  requireValues?: unknown[];
  unmet?: { code: string; message: string };
  /** The change proposes a related-party award for independent review. */
  relatedReview?: boolean;
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
    case "request-information": {
      exactKeys(body, [...common, "reason"]);
      requireAction(row, roles, action);
      return {
        kind: action,
        role: actingRole(["security-maintainer", "triager"]),
        reason: textField(body, "reason", 8, 2000),
        evidenceReference: null,
        detail: {},
        set: { receipt_state: "needs-information" },
      };
    }
    case "decide":
      return planDecision(deps, row, roles, actor, body);
    case "award": {
      exactKeys(
        body,
        [...common, "decision", "reason"],
        ["grossMinor", "paymentDeadline", "confirmation"],
      );
      requireRole(roles, "security-maintainer", "The project owner decides");
      requireAction(row, roles, action);
      return {
        kind: action,
        role: "security-maintainer",
        reason: textField(body, "reason", 8, 2000),
        evidenceReference: null,
        ...(await planAward(deps, row, actor, body, now)),
      };
    }
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
      exactKeys(
        body,
        [...common, "disclosureState", "reason", "evidenceReference"],
        ["redactedContentDigest", "embargoChange"],
      );
      requireRole(roles, "security-maintainer", "Security maintainers decide");
      requireAction(row, roles, action);
      const disclosureState = choice(body, "disclosureState", [
        "embargoed",
        "redaction-approved",
        "disclosed",
      ] as const);
      const redactedContentDigest =
        body.redactedContentDigest === undefined
          ? null
          : stringField(body, "redactedContentDigest", SHA256);
      if (disclosureState !== "embargoed" && redactedContentDigest === null)
        fail(
          400,
          "evidence_required",
          "Bind the exact approved redacted content digest",
        );
      let approvalRevision: number | null = null;
      if (disclosureState === "disclosed") {
        const approval = await deps.db
          .prepare(
            "SELECT case_revision, detail FROM security_case_events WHERE case_id = ? AND kind = 'disclosure' ORDER BY case_revision DESC LIMIT 1",
          )
          .bind(row.id)
          .first<{ case_revision: number; detail: string }>();
        const approved = approval ? JSON.parse(approval.detail) : null;
        if (
          approval === null ||
          row.disclosure_state !== "redaction-approved" ||
          approved?.disclosureState !== "redaction-approved" ||
          approved?.redactedContentDigest !== redactedContentDigest
        )
          fail(
            409,
            "disclosure_approval_required",
            "Approve these exact redacted bytes before recording disclosure",
          );
        approvalRevision = approval.case_revision;
      }
      return {
        kind: action,
        role: "security-maintainer",
        reason: textField(body, "reason", 8, 2000),
        evidenceReference: textField(body, "evidenceReference", 3, 500),
        detail: {
          disclosureState,
          redactedContentDigest,
          approvalRevision,
          embargoChange: optionalText(body, "embargoChange", 2000),
        },
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
      // A later appeal must not erase an earlier reviewer's conflict. The
      // immutable journal retains every related-party and appeal decision.
      const priorReview = await deps.db
        .prepare(
          "SELECT 1 AS found FROM security_case_events WHERE case_id = ? AND actor_github_id = ? AND kind IN ('decide-related-party', 'decide-appeal') LIMIT 1",
        )
        .bind(row.id, actor.githubId)
        .first<{ found: number }>();
      if (
        row.technical_decider_github_id === actor.githubId ||
        row.related_party_reviewer_github_id === actor.githubId ||
        priorReview !== null
      )
        fail(
          403,
          "conflicted",
          "You already reviewed this case; another reviewer must",
        );
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
      // An approval reserves the proposed amount now, if funds exist. A
      // review from before discretionary awards reserves the program amount.
      const reservation = await awardReservation(
        deps,
        row,
        row.award_gross_minor ?? (frozenTerms(row) as FrozenTerms).grossMinor,
        at,
        actor,
      );
      return {
        kind: action,
        role: "dispute",
        reason,
        evidenceReference: null,
        detail: { outcome },
        ...reservation,
        set: { ...reviewed, ...reservation.set },
      };
    }
    case "consent-payment": {
      exactKeys(body, [...common, "network", "confirmation"]);
      requireAction(row, roles, action);
      if (body.confirmation !== true)
        fail(
          400,
          "confirmation_required",
          "Accept public chain visibility before payment",
        );
      const program = await currentProgram(deps, row.project_id);
      const deployment =
        program?.manifest.securityBounty?.settlement?.deployments.find(
          (d) => d.network === body.network,
        );
      if (!deployment)
        fail(
          409,
          "rail_unavailable",
          "The program has no reviewed settlement on this network",
        );
      const approved = {
        ...paymentDeploymentRecord(row.project_id, deployment),
        payoutPolicy: "security-bounty",
      };
      return {
        kind: action,
        role: "reporter",
        reason: null,
        evidenceReference: null,
        detail: {
          network: deployment.network,
          publicChainVisibilityAccepted: true,
        },
        set: {},
        after: [
          deps.db
            .prepare(`INSERT INTO security_payment_consents
          SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM security_case_events WHERE case_id=? AND case_revision=? AND idempotency_key=?)`)
            .bind(
              row.id,
              JSON.stringify(approved),
              actor.githubId,
              at,
              row.revision + 1,
              row.id,
              row.revision + 1,
              idempotencyKey,
            ),
        ],
      };
    }
    case "prepare-payment": {
      exactKeys(body, [...common, "network", "confirmation"]);
      requireAction(row, roles, action);
      if (body.confirmation !== true)
        fail(
          400,
          "confirmation_required",
          "Confirm the exact 75/25 payout and public chain visibility",
        );
      const program = await currentProgram(deps, row.project_id);
      const deployment =
        program?.manifest.securityBounty?.settlement?.deployments.find(
          (d) => d.network === body.network,
        );
      const terms = frozenTerms(row);
      const reserved = await deps.db
        .prepare(
          "SELECT gross_minor FROM security_award_reservations WHERE case_id = ?",
        )
        .bind(row.id)
        .first<{ gross_minor: string }>();
      if (!deployment || !terms || !reserved)
        fail(
          409,
          "rail_unavailable",
          "The program has no reviewed settlement on this network",
        );
      const statement = await prepareSecuritySettlement(deps.db, {
        caseId: row.id,
        idempotencyKey,
        projectId: row.project_id,
        reporterId: row.reporter_github_id,
        approverId: actor.githubId,
        revision: row.revision + 1,
        // The owner-approved, reserved gross amount.
        grossMinor: reserved.gross_minor,
        decimals: terms.decimals,
        currency: terms.currency,
        chain: terms.network,
        deployment,
        at,
      });
      return {
        kind: action,
        role: actingRole(["security-maintainer", "financial"]),
        reason: null,
        evidenceReference: null,
        detail: {
          network: deployment.network,
          publicChainVisibilityAccepted: true,
        },
        set: {},
        after: [statement],
      };
    }
  }
  fail(400, "invalid_request", "Unknown action");
}

/**
 * Records the owner's technical decision (PRD section 8). Severity and loss
 * of funds are recorded as priority guidance only: critical bugs and
 * potential loss of funds are priorities, never an automatic entitlement or
 * an absolute bar. A confirmed finding with paid terms waits for the owner's
 * award decision, which may come with this decision (`award`) or later. The
 * decision binds the digest of the advisory text the AI analysis read, when
 * the owner supplies no other evidence digest.
 */
async function planDecision(
  deps: SecurityApiDependencies,
  row: CaseRow,
  roles: Set<Role>,
  actor: Actor,
  body: Record<string, unknown>,
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
      "relatedParty",
    ],
    [
      "rootCauseKey",
      "duplicateOf",
      "evidenceReference",
      "evidenceDigest",
      "award",
    ],
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
  const relatedParty =
    body.relatedParty || (await reporterIsRelated(deps, row));
  const reason = textField(body, "reason", 8, 2000);
  const evidenceReference = optionalText(body, "evidenceReference", 500);
  const rootCauseKey =
    body.rootCauseKey === undefined
      ? null
      : stringField(body, "rootCauseKey", ROOT_CAUSE);
  const analysis = await latestCaseAnalysis(deps, row.id);
  const evidenceDigest =
    body.evidenceDigest === undefined
      ? analysis?.state === "complete"
        ? analysis.advisoryDigest
        : null
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
  const terms = frozenTerms(row);
  // The first verified report of a finding holds its award; a later report of
  // a root cause that already holds an award or a pending review is recorded
  // as a duplicate instead (PRD section 8).
  if (outcome === "confirmed" && terms !== null)
    await assertRootCauseFree(
      deps,
      row.project_id,
      row.id,
      rootCauseKey as string,
    );
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
    award_state:
      terms === null
        ? "not-applicable"
        : outcome === "confirmed"
          ? "pending"
          : "ineligible",
  };
  const detail: Record<string, unknown> = {
    outcome,
    severity,
    loss,
    inScope,
    relatedParty,
    // Priority guidance for the owner, not eligibility (PRD section 8).
    priority:
      severity === "critical" ||
      loss === "verified-potential" ||
      loss === "verified-actual",
  };
  const change: Change = {
    kind: "decide",
    role: "security-maintainer",
    reason,
    evidenceReference,
    detail,
    set,
  };
  if (body.award === undefined) return change;
  if (
    typeof body.award !== "object" ||
    body.award === null ||
    Array.isArray(body.award)
  )
    fail(400, "invalid_request", "Invalid award");
  if (outcome !== "confirmed" || terms === null)
    fail(
      400,
      "invalid_request",
      "An award needs a confirmed finding with paid terms",
    );
  const award = body.award as Record<string, unknown>;
  exactKeys(
    award,
    ["decision"],
    ["grossMinor", "paymentDeadline", "confirmation"],
  );
  const plan = await planAward(
    deps,
    {
      ...row,
      receipt_state: "confirmed",
      root_cause_key: rootCauseKey,
      related_party: relatedParty ? "related" : "unrelated",
      related_party_review: "not-applicable",
      award_state: "pending",
    },
    actor,
    award,
    deps.now(),
  );
  return {
    ...change,
    ...plan,
    detail: { ...detail, award: plan.detail },
    set: { ...set, ...plan.set },
  };
}

/** Program approvers and the sponsor account are always related parties. */
async function reporterIsRelated(
  deps: SecurityApiDependencies,
  row: CaseRow,
): Promise<boolean> {
  if (row.related_party === "related") return true;
  const program = (await currentProgram(deps, row.project_id))?.manifest
    .securityBounty;
  return (
    programRoles(program, row.reporter_github_id, new Set()).size > 0 ||
    program?.approvers.dispute.some(
      (entry) => entry.githubId === row.reporter_github_id,
    ) ||
    program?.sponsor.githubId === row.reporter_github_id
  );
}

/**
 * The owner's discretionary award (PRD section 8): no award, or an amount.
 * Approving an amount reserves exactly that gross amount in the same batch,
 * if the program's verified funds still cover it; otherwise nothing is
 * written. A related-party award is proposed for an independent reviewer and
 * reserves nothing until that reviewer approves it. The 75/25 split must be
 * exact, so the gross is divisible by four minor units.
 */
async function planAward(
  deps: SecurityApiDependencies,
  row: CaseRow,
  actor: Actor,
  body: Record<string, unknown>,
  now: Date,
): Promise<Omit<Change, "kind" | "role" | "reason" | "evidenceReference">> {
  const decision = choice(body, "decision", ["none", "amount"] as const);
  if (frozenTerms(row) === null)
    fail(409, "action_not_allowed", "No paid terms were in force at receipt");
  const reserved = await deps.db
    .prepare(
      "SELECT gross_minor FROM security_award_reservations WHERE case_id = ?",
    )
    .bind(row.id)
    .first<{ gross_minor: string }>();
  if (decision === "none") {
    if (
      body.grossMinor !== undefined ||
      body.paymentDeadline !== undefined ||
      body.confirmation !== undefined
    )
      fail(400, "invalid_request", "No award takes no amount");
    if (reserved !== null)
      fail(
        409,
        "award_obligation_exists",
        "This case already holds an award obligation",
      );
    return {
      detail: { decision },
      set: { award_state: "ineligible", award_gross_minor: null },
    };
  }
  const grossMinor = stringField(body, "grossMinor", GROSS_MINOR);
  let split: ReturnType<typeof securityBountySplit>;
  try {
    split = securityBountySplit(grossMinor);
  } catch (error) {
    fail(
      400,
      "invalid_amount",
      error instanceof Error ? error.message : "Invalid award amount",
    );
  }
  const paymentDeadline = timestampField(body, "paymentDeadline", now, {
    past: false,
  });
  if (body.confirmation !== true)
    fail(
      400,
      "confirmation_required",
      "Confirm the award: gross, both shares, payee and reservation",
    );
  const detail = { decision, ...split };
  // A reservation from before discretionary awards: approve that amount.
  if (reserved !== null) {
    if (reserved.gross_minor !== grossMinor)
      fail(
        409,
        "award_obligation_exists",
        "This case already reserved a different amount; approve that amount",
      );
    return {
      detail,
      set: {
        award_state: "approved",
        payment_state: "rail-unavailable",
        payment_deadline: paymentDeadline,
        award_gross_minor: grossMinor,
      },
    };
  }
  if (await reporterIsRelated(deps, row)) {
    await assertNewAwardParticipation(deps, row, actor);
    await assertRootCauseFree(
      deps,
      row.project_id,
      row.id,
      row.root_cause_key as string,
    );
    return {
      detail: { ...detail, relatedPartyReview: "pending" },
      set: {
        related_party: "related",
        related_party_review: "pending",
        award_state: "pending",
        award_gross_minor: grossMinor,
        payment_deadline: paymentDeadline,
      },
      relatedReview: true,
      requireSql: `NOT EXISTS (${PARTICIPATION_BAN_QUERY}) AND NOT EXISTS (${PARTICIPATION_BAN_QUERY})`,
      requireValues: [row.reporter_github_id, actor.githubId],
      unmet: {
        code: "participation_banned",
        message: "The award participants can no longer start a new Slop award.",
      },
    };
  }
  const reservation = await awardReservation(
    deps,
    row,
    grossMinor,
    now.toISOString(),
    actor,
  );
  return {
    detail,
    ...reservation,
    set: { ...reservation.set, payment_deadline: paymentDeadline },
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

async function assertRootCauseFree(
  deps: SecurityApiDependencies,
  projectId: string,
  caseId: string,
  rootCauseKey: string,
): Promise<void> {
  // One root cause reserves once; the unique index and the reservation
  // insert guard also stop a race.
  if (
    (await deps.db
      .prepare(
        `SELECT 1 AS taken FROM security_award_reservations WHERE project_id = ? AND root_cause_key = ? UNION ALL ${ROOT_CAUSE_PENDING_REVIEW} LIMIT 1`,
      )
      .bind(projectId, rootCauseKey, projectId, caseId, rootCauseKey)
      .first<{ taken: number }>()) !== null
  )
    fail(
      409,
      "root_cause_reserved",
      "This root cause already holds an award or a pending review; record a duplicate instead",
    );
}

async function assertNewAwardParticipation(
  deps: SecurityApiDependencies,
  row: CaseRow,
  actor: Actor,
): Promise<void> {
  if (
    (await hasParticipationBan(deps.db, row.reporter_github_id)) ||
    (await hasParticipationBan(deps.db, actor.githubId))
  )
    fail(
      403,
      "participation_banned",
      "A banned account cannot approve or receive a new Slop award. Funded awards and appeals remain available.",
    );
}

/**
 * Reserves the approved gross amount for the case's root cause in the same
 * batch as the revision-checked case update (PRD section 10, Capacity: only
 * approved awards reserve, once per finding). The insert itself checks that
 * the program's verified funds still cover it; when they do not, nothing is
 * reserved and the case update does not apply (`insufficient_funds`).
 */
async function awardReservation(
  deps: SecurityApiDependencies,
  row: CaseRow,
  grossMinor: string,
  at: string,
  actor: Actor,
): Promise<Required<Pick<Change, "before" | "set" | "requireSql" | "unmet">>> {
  await assertNewAwardParticipation(deps, row, actor);
  const terms = frozenTerms(row);
  const rootCauseKey = row.root_cause_key;
  if (terms === null || rootCauseKey === null)
    fail(409, "action_not_allowed", "The case has no paid terms to reserve");
  // Approved awards stay owed through a quarantine or a ban, but a
  // restricted program starts no new commitment (PRD section 11, Restricted
  // projects).
  const program = await currentProgram(deps, row.project_id);
  if (program === null || program.manifest.listingTier === "retired")
    fail(
      409,
      "program_restricted",
      "A quarantined, banned, or retired program cannot approve a new award",
    );
  await assertRootCauseFree(deps, row.project_id, row.id, rootCauseKey);
  const snapshotGuards: { sql: string; values: unknown[] }[] = [];
  const funds = await programFunds(deps, row.project_id, snapshotGuards);
  if (
    funds === null ||
    funds.currency !== terms.currency ||
    funds.decimals !== terms.decimals ||
    funds.network !== terms.network
  )
    fail(
      409,
      "funds_unavailable",
      "The program's bounty vault has no current finalized balance in this award's asset",
    );
  if (BigInt(grossMinor) > BigInt(funds.availableMinor))
    fail(
      409,
      "insufficient_funds",
      "The bounty vault's unreserved finalized balance does not cover this award",
    );
  return {
    before: [
      deps.db
        .prepare(
          `INSERT INTO security_award_reservations (case_id, project_id, root_cause_key, policy_revision, gross_minor, currency, reserved_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT revision FROM security_cases WHERE id = ?) = ? AND (${OUTSTANDING_RESERVATIONS}) + CAST(? AS INTEGER) <= CAST(? AS INTEGER) AND ${snapshotGuards.map((guard) => guard.sql).join(" AND ")} AND NOT EXISTS (${ROOT_CAUSE_PENDING_REVIEW}) AND NOT EXISTS (${PARTICIPATION_BAN_QUERY}) AND NOT EXISTS (${PARTICIPATION_BAN_QUERY})`,
        )
        .bind(
          row.id,
          row.project_id,
          rootCauseKey,
          row.policy_revision,
          grossMinor,
          terms.currency,
          at,
          row.id,
          row.revision,
          row.project_id,
          terms.currency,
          funds.snapshotAt,
          grossMinor,
          funds.freeMinor,
          ...snapshotGuards.flatMap((guard) => guard.values),
          row.project_id,
          row.id,
          rootCauseKey,
          row.reporter_github_id,
          actor.githubId,
        ),
    ],
    set: {
      award_state: "approved",
      payment_state: "rail-unavailable",
      award_gross_minor: grossMinor,
    },
    requireSql:
      "EXISTS (SELECT 1 FROM security_award_reservations WHERE case_id = security_cases.id)",
    unmet: {
      code: "insufficient_funds",
      message:
        "The award can no longer be reserved. Check the available funds and the recipient’s participation status.",
    },
  };
}

/**
 * Actions that ask Slop to do automatic work again, not human decisions:
 * settle an older advisory link against GitHub, or run a missing, failed or
 * lost private analysis or appeal triage. None changes a decision or an
 * award.
 */
async function automaticAction(
  deps: SecurityApiDependencies,
  row: CaseRow,
  roles: Set<Role>,
  actor: Actor,
  action: "check-receipt" | "analyze" | "triage-appeal",
  body: Record<string, unknown>,
): Promise<Response> {
  exactKeys(body, ["action", "expectedRevision", "idempotencyKey"]);
  const terms = await programOrNotFound(deps, row.project_id);
  if (action === "check-receipt") {
    requireAction(row, roles, action);
    const result = await reconcileProgram(
      deps,
      row.project_id,
      terms,
      actor,
      roles.has("security-maintainer") ? "all" : "own",
    );
    if (result.state !== "ok")
      fail(
        503,
        "receipt_check_unavailable",
        "Slop could not read GitHub. Do not submit again; check later.",
      );
  } else if (action === "triage-appeal") {
    if (!roles.has("dispute") || row.appeal_state !== "open")
      fail(
        409,
        "action_not_allowed",
        "The case does not allow triage-appeal in its current state",
      );
    if (!(await appealTriageMayStart(deps, row.id)))
      fail(409, "analysis_running", "The appeal triage is already running");
    // The reviewer asked for it and waits for the full provider time limit.
    await runAppealTriage(
      analysisDependencies(deps),
      row.id,
      ANALYSIS_TIMEOUT_MS,
    );
  } else {
    if (
      row.submission_state !== "verified" ||
      !(roles.has("security-maintainer") || roles.has("triager"))
    )
      fail(
        409,
        "action_not_allowed",
        "The case does not allow analyze in its current state",
      );
    if (!(await analysisMayStart(deps, row.id)))
      fail(409, "analysis_running", "The analysis is already running");
    // The owner asked for it and waits, so the request keeps the analysis
    // alive for the full provider time limit.
    await runCaseAnalysis(
      analysisDependencies(deps),
      row.id,
      null,
      ANALYSIS_TIMEOUT_MS,
    );
  }
  const updated = (await loadCase(deps, row.id)) as CaseRow;
  const nextRoles = await caseRoles(deps, updated, actor, terms);
  if (nextRoles.size === 0) notFound();
  await accessLog(deps, row.id, actor, nextRoles, "read").run();
  return json(200, { case: await caseView(deps, updated, nextRoles, true) });
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
    action === "check-receipt" ||
    action === "analyze" ||
    action === "triage-appeal"
  )
    return await automaticAction(deps, row, roles, actor, action, body);
  if (row.submission_state !== "verified")
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
      ...(change.requireValues ?? []),
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
        relatedReview: change.relatedReview,
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
  // Slopbot triages every appeal first; a moderator still decides it.
  if (change.kind === "appeal") await scheduleAppealTriage(deps, row.id);
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

export type PvrState = "ready" | "disabled" | "forbidden" | "unavailable";
export type AutomaticIntake =
  | "ready"
  | "app-not-installed"
  | "unavailable"
  | "off";

/** GitHub private vulnerability reporting status for one repository. */
export async function pvrState(
  deps: Pick<SecurityApiDependencies, "github">,
  repository: string,
): Promise<PvrState> {
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
    if (response.status === 401 || response.status === 403) return "forbidden";
    if (!response.ok) return "unavailable";
    const body = (await response.json()) as { enabled?: unknown };
    return body.enabled === true
      ? "ready"
      : body.enabled === false
        ? "disabled"
        : "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * Whether Slop can file a private report as the reporter: intake mode on,
 * private vulnerability reporting ready, and the intake App installed on
 * the program repository. Every other answer keeps the existing GitHub
 * handoff and manual verification; there is never a public fallback.
 */
export async function automaticIntake(
  deps: Pick<SecurityApiDependencies, "intake">,
  repository: string,
  state: PvrState,
): Promise<AutomaticIntake> {
  if (deps.intake?.mode !== "on") return "off";
  if (state !== "ready") return "unavailable";
  const installed = await deps.intake.installation.installed(repository);
  return installed === "yes"
    ? "ready"
    : installed === "no"
      ? "app-not-installed"
      : "unavailable";
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
  const state = await pvrState(deps, repository);
  const closed =
    terms.capacity.closesAt !== null &&
    Date.parse(terms.capacity.closesAt) <= Date.parse(checkedAt);
  return json(
    200,
    {
      projectId,
      repository,
      state,
      automatic: await automaticIntake(deps, repository, state),
      checkedAt,
      maxAgeSeconds: INTAKE_READINESS_TTL_SECONDS,
      programStatus: terms.status,
      // Pause or closure stops new paid research, never the private route.
      paidParticipation: terms.status === "open" && !closed ? "open" : "closed",
      handoffUrl: state === "ready" ? handoffUrl(terms) : null,
    },
    `public, max-age=0, s-maxage=${INTAKE_READINESS_TTL_SECONDS}`,
  );
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
    deps.moderatorGithubIds,
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
  if (
    parts[0] !== "security-cases" &&
    parts[0] !== "security-programs" &&
    parts[0] !== "security-submissions"
  )
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
    if (parts[0] === "security-submissions")
      return await handleSubmissionRoute(request, deps, parts);
    if (parts[0] === "security-cases") {
      if (
        request.method === "POST" &&
        parts.length === 3 &&
        parts[2] === "acknowledge"
      )
        return await acknowledgeNotice(request, deps, parts[1]);
      if (request.method === "GET" && parts.length === 1)
        return await listCases(request, deps);
      if (request.method === "POST" && parts.length === 1) {
        const body = await readJsonObject(request.clone());
        return body.mode === "import"
          ? await importReports(request, deps)
          : await createCase(request, deps);
      }
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
