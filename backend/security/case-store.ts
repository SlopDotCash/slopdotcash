/**
 * Shared private security case records, roles and statements (PRD section 8,
 * SEC-02 to SEC-17). The case handler, durable report intake and GitHub
 * forwarding all build on these; this module imports none of them.
 */
import type { GithubActor as Actor } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type { RewardAsset } from "../../src/lib/reward-asset.mjs";
import {
  isFullAwardSplit,
  SECURITY_FULL_AWARD_SPLIT,
  SECURITY_SPLIT,
  type SecurityBountyTerms,
  securityBountySplit,
} from "../../src/lib/security-bounty.mjs";
import type {
  D1QueryStatement as D1Statement,
  D1TransactionalDatabase,
} from "../d1";
import { fail, json as jsonResponse } from "../http";
import { notifySecurityCase } from "../notifications/events";
import { CloudflareProjectPersistence } from "../projects/cloudflare-persistence";
import type { EdgeCache } from "../projects/edge-cache";
import { retiredByRestriction } from "../projects/enforcement";
import type { RepositoryAccessReader } from "../projects/setup";
import type { R2Bucket } from "../trace/cloudflare-persistence";
import type { AdvisoryReader } from "./advisories";
import type { SecurityAnalyzer } from "./analysis";
import type { DirectPaymentConfiguration } from "./direct-payments";
import type { IntakeConfig } from "./intake-grant";
import { repositoryReportingAuthority } from "./project-access";
import {
  type ReportingReader,
  refreshReportingObservation,
  reportingTarget,
} from "./reporting-readiness";

export type SecurityD1Database = D1TransactionalDatabase<D1Statement>;

export type SecurityApiDependencies = {
  db: SecurityD1Database;
  directPayments?: DirectPaymentConfiguration;
  /** Private security-report prefix, distinct from contributor trace objects. */
  reportStorage?: R2Bucket;
  /** Disables new intake while preserving authorized historical body reads. */
  reportIntakeEnabled?: boolean;
  now: () => Date;
  randomId: () => string;
  sessionActor: (request: Request) => Promise<Actor | null>;
  /** Fresh App-authenticated repository facts for sensitive submissions. */
  reportingRead: ReportingReader;
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
  repositoryAccess?: RepositoryAccessReader;
  /**
   * Per-request memo of `currentReportingProject`. A list read sets it so
   * the viewer's cases share one project read instead of one per case; a
   * project's manifest does not change inside one request.
   */
  reportingProjects?: Map<string, Promise<ReportingProject>>;
};

type ReportingProject = {
  manifest: ProjectDefinition;
  revision: number;
} | null;

export type Role =
  | "reporter"
  | "security-maintainer"
  | "triager"
  | "financial"
  | "dispute";

export type CaseRow = {
  id: string;
  project_id: string;
  advisory_repository: string;
  advisory_ghsa: string | null;
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
  received_at_source:
    | "maintainer-attested"
    | "github-verified"
    | "slop-received"
    | null;
  receipt_evidence_digest: string | null;
  award_gross_minor: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type FrozenTerms = {
  /** Verified asset identity at receipt; legacy USD/USDC cases omit it. */
  asset?: RewardAsset;
  grossMinor: string;
  researcherMinor: string;
  slopMinor: string;
  currency: SecurityBountyTerms["amount"]["currency"];
  decimals: number;
  network: SecurityBountyTerms["amount"]["network"];
  capacityAwards: number | null;
  fundingPolicy?: "after-approval";
  /** Older receipts retain their original critical-loss-of-funds restriction. */
  eligibility?: SecurityBountyTerms["eligibility"];
  /** Present for an approved full-award program; older cases are 75/25. */
  split?: typeof SECURITY_FULL_AWARD_SPLIT;
};

export const CASE_ID = /^sc_[A-Za-z0-9_-]{8,72}$/u;

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,80}$/u;

export function json(
  status: number,
  body: Record<string, unknown>,
  cacheControl = "private, no-store",
): Response {
  return jsonResponse(status, body, {
    cacheControl,
    headers: { "x-robots-tag": "noindex" },
  });
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

export async function currentReportingProject(
  deps: Pick<SecurityApiDependencies, "db" | "reportingProjects">,
  projectId: string,
): Promise<ReportingProject> {
  const memo = deps.reportingProjects?.get(projectId);
  if (memo !== undefined) return memo;
  // Store the in-flight read too: concurrent cases must not each issue it.
  const pending = (async (): Promise<ReportingProject> => {
    const row = await deps.db
      .prepare("SELECT manifest, revision FROM projects WHERE id = ?")
      .bind(projectId)
      .first<{ manifest: string; revision: number }>();
    return row === null
      ? null
      : {
          manifest: JSON.parse(row.manifest) as ProjectDefinition,
          revision: row.revision,
        };
  })();
  deps.reportingProjects?.set(projectId, pending);
  return pending;
}

/**
 * A moderator quarantine or ban applies a paused, retired revision. The
 * project stays registered, so its existing private cases keep their
 * analysis and appeal triage (PRD section 8). The retained before
 * and after revisions must prove that enforcement caused retirement; an
 * owner's earlier retirement or an unapplied restriction cannot grant it.
 */
async function restrictionRetired(
  deps: Pick<SecurityApiDependencies, "db">,
  projectId: string,
): Promise<boolean> {
  const retired = await retiredByRestriction(
    new CloudflareProjectPersistence(deps.db),
    projectId,
  );
  if (retired === null)
    fail(500, "internal_error", "The restriction revision evidence is missing");
  return retired;
}

/** Reporting needs a registered repository, not financial terms. */
export type ReportingContext = Pick<
  SecurityBountyTerms,
  "intake" | "approvers"
> &
  Partial<Pick<SecurityBountyTerms, "responseTargets">>;

export async function reportingContext(
  deps: Pick<SecurityApiDependencies, "db" | "repositoryAccess">,
  projectId: string,
  contacts = false,
  existingCase = false,
): Promise<ReportingContext> {
  const project = await currentReportingProject(deps, projectId);
  if (
    project === null ||
    (project.manifest.listingTier === "retired" &&
      !(existingCase && (await restrictionRetired(deps, projectId))))
  )
    fail(
      404,
      "project_not_found",
      "This project is not available for private reporting",
    );
  const { manifest } = project;
  // After a recorded rename or transfer the repository id keeps the original
  // path, which GitHub redirects; intake follows no redirect. Use the current
  // name that the reporting readiness check verifies by numeric id. A manifest
  // without repositories keeps its configured intake name.
  const repository = manifest.repositories?.length
    ? reportingTarget(manifest, project.revision).repository
    : (manifest.securityBounty?.intake.repository ??
      manifest.repositories[0].id);
  if (manifest.securityBounty)
    return {
      ...manifest.securityBounty,
      intake: { ...manifest.securityBounty.intake, repository },
    };
  const technical: Actor[] = [];
  if (contacts) {
    // Registry actors are candidates only. Each needs current GitHub authority.
    const rows = await deps.db
      .prepare(
        "SELECT actor_github_id AS githubId, actor_github_login AS githubLogin FROM project_revisions WHERE project_id = ? AND actor_github_id IS NOT NULL UNION SELECT a.applicant_github_id, a.applicant_github_login FROM projects p JOIN project_applications a ON a.id = p.source_application_id WHERE p.id = ?",
      )
      .bind(projectId, projectId)
      .all<Actor>();
    const candidates = new Map(
      (rows.results ?? []).map((actor) => [actor.githubId, actor]),
    );
    const steward = manifest.steward.github;
    if (steward.type === "User")
      candidates.set(steward.actorId, {
        githubId: steward.actorId,
        githubLogin: steward.login,
      });
    for (const actor of candidates.values()) {
      if (
        await repositoryReportingAuthority(
          deps.repositoryAccess,
          manifest,
          actor,
        )
      )
        technical.push(actor);
    }
  }
  return {
    intake: {
      kind: "github-private-vulnerability-reporting",
      repository,
    },
    approvers: { technical, financial: [], dispute: [] },
  };
}

export function programRoles(
  terms: ReportingContext | undefined,
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

export async function activeTriager(
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
export async function caseRoles(
  deps: Pick<
    SecurityApiDependencies,
    "db" | "moderatorGithubIds" | "repositoryAccess"
  >,
  row: CaseRow,
  actor: Actor,
  preloaded?: {
    project: Awaited<ReturnType<typeof currentReportingProject>>;
    triager: boolean;
    /** The project's repository authority, read once per list. */
    authority: () => Promise<boolean>;
  },
): Promise<Set<Role>> {
  const project = preloaded
    ? preloaded.project
    : await currentReportingProject(deps, row.project_id);
  const terms = project?.manifest.securityBounty;
  const roles = programRoles(
    terms,
    actor.githubId,
    deps.moderatorGithubIds ?? new Set(),
  );
  if (deps.moderatorGithubIds?.has(actor.githubId)) roles.add("dispute");
  const triager =
    row.reporter_github_id !== actor.githubId &&
    (preloaded
      ? preloaded.triager
      : await activeTriager(deps, row.id, actor.githubId));
  // A moderator reads only cases with an appeal or a related-party award
  // review.
  if (
    row.appeal_state === "none" &&
    row.related_party_review === "not-applicable"
  )
    roles.delete("dispute");
  if (
    terms === undefined &&
    row.reporter_github_id !== actor.githubId &&
    !triager &&
    !roles.has("dispute")
  ) {
    if (
      project &&
      (preloaded
        ? await preloaded.authority()
        : await repositoryReportingAuthority(
            deps.repositoryAccess,
            project.manifest,
            actor,
          ))
    )
      roles.add("security-maintainer");
  }
  // Finance needs nothing before the owner approved an award.
  if (!["reserved", "approved"].includes(row.award_state))
    roles.delete("financial");
  if (row.reporter_github_id === actor.githubId) {
    // A reporter never decides their own case.
    roles.clear();
    roles.add("reporter");
  } else if (triager) {
    roles.add("triager");
  }
  return roles;
}

export const REPORTER_EVENT_KINDS = new Set([
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
  "verify-payment",
  "recover-payment",
  "appeal",
  "decide-appeal",
  "decide-related-party",
  "disclosure",
  "recognition",
]);

export const CASE_COLUMNS =
  "id, project_id, advisory_repository, advisory_ghsa, reporter_github_id, reporter_github_login, submission_state, received_at, verified_at, verified_by_github_id, policy_revision, terms, evidence_digest, receipt_state, remediation_state, award_state, payment_state, disclosure_state, recognition, severity, loss_finding, root_cause_key, duplicate_of, technical_decider_github_id, appeal_state, appeal_from_state, owner_github_id, next_action, next_action_due_at, payment_deadline, related_party, related_party_review, related_party_reviewer_github_id, received_at_source, receipt_evidence_digest, COALESCE(award_gross_base,award_gross_minor) AS award_gross_minor, revision, created_at, updated_at";

export async function loadCase(
  deps: Pick<SecurityApiDependencies, "db">,
  caseId: string,
): Promise<CaseRow | null> {
  if (!CASE_ID.test(caseId)) return null;
  return deps.db
    .prepare(`SELECT ${CASE_COLUMNS} FROM security_cases WHERE id = ?`)
    .bind(caseId)
    .first<CaseRow>();
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
  const fullAward = isFullAwardSplit(program.split);
  const split = securityBountySplit(
    program.amount.grossMinor,
    fullAward ? SECURITY_FULL_AWARD_SPLIT : SECURITY_SPLIT,
  );
  return {
    revision: row.revision,
    terms: {
      ...split,
      ...(fullAward ? { split: SECURITY_FULL_AWARD_SPLIT } : {}),
      currency: program.amount.currency,
      decimals: program.amount.decimals,
      network: program.amount.network,
      ...(program.amount.asset ? { asset: program.amount.asset } : {}),
      capacityAwards: program.capacity.awards,
      ...(program.eligibility === "in-scope-security"
        ? { eligibility: program.eligibility }
        : {}),
      ...(program.fundingPolicy
        ? { fundingPolicy: program.fundingPolicy }
        : {}),
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
    terms: ReportingContext | undefined;
    /** The change proposes a related-party award for independent review. */
    relatedReview?: boolean;
  },
): D1Statement[] {
  // History pages are audited case events, not new actions for recipients.
  // Notify when recovery creates its successor, not for each polling attempt.
  if (
    input.kind === "recover-payment" &&
    typeof input.detail.state === "string"
  )
    return [];
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
    input.kind === "submit-direct" ||
    input.kind === "verify-payment" ||
    input.kind === "recover-payment"
      ? ids("technical")
      : []),
    ...(["verify-payment", "recover-payment"].includes(input.kind)
      ? ids("financial")
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
    advisory: string | null;
    reporter: Actor;
    verified: {
      receivedAt: string;
      verifiedBy: string;
      policyRevision: number | null;
      terms: FrozenTerms | null;
      source?: "github-verified" | "slop-received";
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

type PvrState = "ready" | "disabled" | "forbidden" | "unavailable";

type AutomaticIntake = "ready" | "app-not-installed" | "unavailable" | "off";

/** Sensitive requests recheck GitHub even when public observations are stale. */
export async function pvrState(
  deps: Pick<SecurityApiDependencies, "db" | "reportingRead" | "now">,
  projectId: string,
): Promise<PvrState> {
  const project = await currentReportingProject(deps, projectId);
  if (project === null || project.manifest.listingTier === "retired")
    return "unavailable";
  const result = await refreshReportingObservation(
    deps.db,
    reportingTarget(project.manifest, project.revision),
    deps.reportingRead,
    deps.now(),
  );
  return result.kind === "verified"
    ? result.enabled
      ? "ready"
      : "disabled"
    : "unavailable";
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
