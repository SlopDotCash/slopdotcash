import { assertProjectPolicyTransition } from "../../src/lib/project-policy.mjs";
import {
  assertProjectDefinition,
  assertProjectRegistry,
  PROJECT_SKILL_TEMPLATES,
} from "../../src/lib/project-schema.mjs";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { readJsonObject, sha256Hex } from "../trace/validation";
import {
  type ApplicationStatus,
  type GithubActor,
  MAX_DAILY_SUBMISSIONS_PER_APPLICANT,
  MAX_PENDING_APPLICATIONS_PER_APPLICANT,
  PROJECT_API_CONTRACT_VERSION,
  type ProjectApplication,
  type ProjectPersistence,
  type ProjectRecord,
  type RepositoryControl,
  type WebSession,
} from "./contracts";

export type AdminApplicationNotice = {
  applicationId: string;
  projectId: string;
  projectName: string;
  repository: string;
  applicantLogin: string;
  submittedAt: string;
  reviewUrl: string;
};

export type ProjectApiDependencies = {
  persistence: ProjectPersistence;
  adminGithubIds: ReadonlySet<string>;
  now: () => Date;
  randomId: () => string;
  /** Resolves the GitHub account behind the site sign-in session cookie. */
  sessionActor: (request: Request) => Promise<GithubActor | null>;
  /** Resolves true only when every admin was emailed. */
  notifyAdmins: (notice: AdminApplicationNotice) => Promise<boolean>;
  /** Resolves whether a skill directory exists on the reviewed development branch. */
  skillPublished: (sourcePath: string) => Promise<boolean>;
  /** Asks GitHub whether the applicant controls the manifest's repository. */
  repositoryControl: (
    manifest: ProjectDefinition,
    actor: GithubActor,
  ) => Promise<RepositoryControl>;
  /** Starts the trusted site build; resolves false when it is not configured. */
  requestPublication: () => Promise<boolean>;
};

type ApiError = Error & { status?: number; code?: string };

const APPLICATION_ID = /^app_[A-Za-z0-9_-]{8,72}$/u;
const PROJECT_ID = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;
const ADMIN_REVIEW_URL = "https://slop.cash/admin";

function fail(status: number, code: string, message: string): never {
  const error: ApiError = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function json(
  status: number,
  body: Record<string, unknown>,
  cacheControl = "no-store",
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": cacheControl,
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-slop-project-api-contract": PROJECT_API_CONTRACT_VERSION,
    },
  });
}

function boundedText(
  value: unknown,
  name: string,
  min: number,
  max: number,
): string {
  if (typeof value !== "string")
    fail(400, "invalid_request", `Invalid ${name}`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    fail(400, "invalid_request", `${name} must be ${min} to ${max} characters`);
  }
  return trimmed;
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
  ) {
    fail(400, "invalid_request", "Request body has unexpected fields");
  }
}

function invalidManifest(error: unknown): never {
  fail(
    422,
    "invalid_manifest",
    error instanceof Error ? error.message : "Project manifest is invalid",
  );
}

function canonicalManifest(value: unknown): {
  manifest: ProjectDefinition;
  text: string;
} {
  let manifest: ProjectDefinition;
  try {
    manifest = assertProjectDefinition(value) as ProjectDefinition;
  } catch (error) {
    invalidManifest(error);
  }
  return { manifest, text: JSON.stringify(manifest) };
}

/**
 * A new application may only describe an unverified, paused, unfunded
 * community project. Authority, terms, listing tier, skills, and money arrive
 * later through admin revisions.
 */
function assertApplicationManifest(manifest: ProjectDefinition): void {
  const reward = manifest.reward;
  const reviewBudget =
    reward.kind === "monthly-pool" ? reward.reviewBudget : undefined;
  const rules: [boolean, string][] = [
    [manifest.status === "paused", "New projects must start paused"],
    [
      manifest.listingTier === "community",
      "New projects are listed in the community tier",
    ],
    [
      manifest.skill.publishAtRoot === false,
      "Only an admin can publish a project skill at the site root",
    ],
    [
      manifest.skill.sourcePath === PROJECT_SKILL_TEMPLATES.contributor &&
        manifest.reviewSkill.sourcePath === PROJECT_SKILL_TEMPLATES.reviewer,
      "New projects use generated skills from the canonical templates",
    ],
    [
      manifest.authority.state === "unverified" &&
        manifest.authority.proof === null,
      "Repository authority is verified after approval",
    ],
    [
      manifest.terms.receiptPolicy.state === "pending-authority-activation",
      "Receipt policy activates only after authority verification",
    ],
    [manifest.terms.externalPrize === null, "External prizes need admin setup"],
    [
      reward.kind === "monthly-pool" &&
        reward.paymentMode === "disabled" &&
        reward.committedMinor === "0" &&
        reward.fundingState === "pledged" &&
        (reviewBudget === undefined ||
          (reviewBudget.paymentMode === "disabled" &&
            reviewBudget.committedMinor === "0" &&
            reviewBudget.fundingState === "pledged")),
      "Applications may only pledge a monthly pool with payments disabled",
    ],
    [
      (manifest.funding.commitments ?? []).length === 0 &&
        (manifest.funding.addresses ?? []).length === 0 &&
        (manifest.escrow?.deployments ?? []).length === 0,
      "Funding addresses and commitments need admin verification",
    ],
  ];
  for (const [valid, message] of rules) {
    if (!valid) fail(422, "invalid_manifest", message);
  }
}

/**
 * A review budget added or newly funded may not shrink the contributor pool
 * or reach back into an open or closed cycle.
 */
function assertReviewBudgetTransition(
  prior: ProjectDefinition,
  next: ProjectDefinition,
  now: Date,
): void {
  if (
    prior.reward.kind !== "monthly-pool" ||
    next.reward.kind !== "monthly-pool"
  )
    return;
  const priorBudget = prior.reward.reviewBudget;
  const nextBudget = next.reward.reviewBudget;
  if (!nextBudget) return;
  const changesBudget =
    !priorBudget ||
    (priorBudget.fundingState !== "committed" &&
      nextBudget.fundingState === "committed");
  if (!changesBudget) return;
  if (
    BigInt(next.reward.monthlyCapMinor) < BigInt(prior.reward.monthlyCapMinor)
  ) {
    fail(
      422,
      "invalid_manifest",
      "A review budget cannot be added or funded while the contributor pool cap shrinks",
    );
  }
  const nextCycle = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  if (Date.parse(nextBudget.effectiveAt) < nextCycle) {
    fail(
      422,
      "invalid_manifest",
      "A review budget cannot affect an open or past cycle",
    );
  }
}

function assertRegistryWith(
  projects: ProjectRecord[],
  candidate: ProjectDefinition,
): void {
  try {
    assertProjectRegistry([
      ...projects
        .filter((project) => project.id !== candidate.id)
        .map((project) => project.manifest),
      candidate,
    ]);
  } catch (error) {
    fail(
      409,
      "registry_conflict",
      error instanceof Error ? error.message : "Project conflicts",
    );
  }
}

function publicApplication(
  application: ProjectApplication,
): Record<string, unknown> {
  return {
    id: application.id,
    projectId: application.projectId,
    repository: application.manifest.repositories[0]?.id ?? null,
    manifest: application.manifest,
    manifestSha256: application.manifestSha256,
    acceptanceCriteria: application.acceptanceCriteria,
    applicant: application.applicant,
    submittedAt: application.submittedAt,
    status: application.status,
    adminNotification: application.adminNotification,
    adminNotificationAt: application.adminNotificationAt,
    decidedAt: application.decidedAt,
    decidedBy: application.decidedBy,
    decisionReason: application.decisionReason,
    githubCheck: application.githubCheck,
  };
}

function adminProject(project: ProjectRecord): Record<string, unknown> {
  return {
    id: project.id,
    status: project.status,
    revision: project.revision,
    manifestSha256: project.manifestSha256,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    sourceApplicationId: project.sourceApplicationId,
    manifest: project.manifest,
  };
}

function sessionBody(
  actor: GithubActor,
  deps: ProjectApiDependencies,
): WebSession {
  return { ...actor, admin: deps.adminGithubIds.has(actor.githubId) };
}

async function requireSession(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<WebSession> {
  const actor = await deps.sessionActor(request);
  if (actor === null) fail(401, "unauthorized", "Sign in with GitHub");
  return sessionBody(actor, deps);
}

async function requireAdmin(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<WebSession> {
  const session = await requireSession(request, deps);
  if (!session.admin) fail(403, "forbidden", "Admin access is required");
  return session;
}

/** Publication never blocks a stored registry change. */
async function requestPublication(deps: ProjectApiDependencies) {
  try {
    return (await deps.requestPublication()) ? "requested" : "not-configured";
  } catch {
    console.error("project registry publication request failed");
    return "failed";
  }
}

async function repositoryControl(
  deps: ProjectApiDependencies,
  manifest: ProjectDefinition,
  actor: GithubActor,
): Promise<RepositoryControl> {
  try {
    return await deps.repositoryControl(manifest, actor);
  } catch {
    // An unavailable lookup never lists a project; an admin decides instead.
    return { state: "unproven", reason: "GitHub could not be checked" };
  }
}

async function submitApplication(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<Response> {
  const session = await requireSession(request, deps);
  const body = await readJsonObject(request);
  exactKeys(body, ["manifest"]);
  const { manifest, text } = canonicalManifest(body.manifest);
  assertApplicationManifest(manifest);
  const actor = {
    githubId: session.githubId,
    githubLogin: session.githubLogin,
  };
  if (
    (await deps.persistence.countPendingApplications(session.githubId)) >=
    MAX_PENDING_APPLICATIONS_PER_APPLICANT
  ) {
    fail(
      429,
      "too_many_pending",
      `You already have ${MAX_PENDING_APPLICATIONS_PER_APPLICANT} applications awaiting review`,
    );
  }
  const dayAgo = new Date(deps.now().getTime() - 24 * 60 * 60 * 1000);
  if (
    (await deps.persistence.countApplicationsSince(
      session.githubId,
      dayAgo.toISOString(),
    )) >= MAX_DAILY_SUBMISSIONS_PER_APPLICANT
  ) {
    fail(
      429,
      "too_many_submissions",
      `You can submit ${MAX_DAILY_SUBMISSIONS_PER_APPLICANT} projects per day`,
    );
  }
  assertRegistryWith(await deps.persistence.listProjects(), manifest);
  const control = await repositoryControl(deps, manifest, actor);
  if (control.state === "mismatch")
    fail(422, "invalid_manifest", control.reason);
  const repository = manifest.repositories[0].id;
  const application: ProjectApplication & { manifestText: string } = {
    id: `app_${deps.randomId().replaceAll("-", "")}`,
    projectId: manifest.id,
    repositoryKey: repository.toLowerCase(),
    manifest,
    manifestText: text,
    manifestSha256: await sha256Hex(new TextEncoder().encode(text)),
    acceptanceCriteria: (manifest.contribution?.approvedScope ?? "").slice(
      0,
      1000,
    ),
    applicant: actor,
    submittedAt: deps.now().toISOString(),
    status: "pending",
    adminNotification: "pending",
    adminNotificationAt: null,
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    // Every application waits for an admin; the check informs that review.
    githubCheck:
      `${control.state === "proven" ? "Proven" : "Not proven"}: ${control.reason}`.slice(
        0,
        300,
      ),
  };
  if ((await deps.persistence.createApplication(application)) === "conflict") {
    fail(
      409,
      "application_exists",
      "This project or repository already has an application awaiting review",
    );
  }
  let notified = false;
  try {
    notified = await deps.notifyAdmins({
      applicationId: application.id,
      projectId: application.projectId,
      projectName: manifest.name,
      repository,
      applicantLogin: session.githubLogin,
      submittedAt: application.submittedAt,
      reviewUrl: `${ADMIN_REVIEW_URL}/applications/${application.id}`,
    });
  } catch {
    // The application is already stored; the failed email stays visible to
    // admins in the review queue instead of failing the submission.
    console.error("project application admin notification failed");
  }
  await deps.persistence.recordAdminNotification(
    application.id,
    notified ? "sent" : "failed",
    deps.now().toISOString(),
  );
  const stored = await deps.persistence.getApplication(application.id);
  if (stored === null) fail(500, "internal_error", "Application vanished");
  return json(201, {
    application: publicApplication(stored),
  });
}

async function listMyApplications(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<Response> {
  const session = await requireSession(request, deps);
  const applications = await deps.persistence.listApplicantApplications(
    session.githubId,
  );
  return json(200, { applications: applications.map(publicApplication) });
}

async function listAdminApplications(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<Response> {
  await requireAdmin(request, deps);
  const status = new URL(request.url).searchParams.get("status") ?? "pending";
  if (!["pending", "approved", "rejected"].includes(status)) {
    fail(400, "invalid_request", "Invalid application status");
  }
  const applications = await deps.persistence.listApplications(
    status as ApplicationStatus,
  );
  return json(200, { applications: applications.map(publicApplication) });
}

async function decideApplication(
  request: Request,
  deps: ProjectApiDependencies,
  applicationId: string,
  decision: "approve" | "reject",
): Promise<Response> {
  const session = await requireAdmin(request, deps);
  if (!APPLICATION_ID.test(applicationId)) {
    fail(404, "not_found", "Application not found");
  }
  const body = await readJsonObject(request);
  exactKeys(body, decision === "reject" ? ["reason"] : [], ["reason"]);
  const reason =
    decision === "reject" || (body.reason !== undefined && body.reason !== "")
      ? boundedText(body.reason, "reason", 1, 1000)
      : null;
  const application = await deps.persistence.getApplication(applicationId);
  if (application === null) fail(404, "not_found", "Application not found");
  if (application.status !== "pending") {
    fail(
      409,
      "already_decided",
      `Application was already ${application.status}`,
    );
  }
  const actor = {
    githubId: session.githubId,
    githubLogin: session.githubLogin,
  };
  const at = deps.now().toISOString();
  if (decision === "reject") {
    const result = await deps.persistence.rejectApplication({
      applicationId,
      actor,
      reason: reason as string,
      at,
    });
    if (result === "conflict") {
      fail(409, "already_decided", "Application was already decided");
    }
  } else {
    // Re-check against the live registry: another approval may have claimed
    // the id or repository since this application was submitted.
    canonicalManifest(application.manifest);
    assertRegistryWith(
      await deps.persistence.listProjects(),
      application.manifest,
    );
    const result = await deps.persistence.approveApplication({
      applicationId,
      actor,
      reason,
      at,
    });
    if (result === "conflict") {
      fail(
        409,
        "registry_conflict",
        "The project id or repository is already listed, or the application was decided",
      );
    }
  }
  const updated = await deps.persistence.getApplication(applicationId);
  if (updated === null) fail(500, "internal_error", "Application vanished");
  return json(200, {
    application: publicApplication(updated),
    publication: decision === "approve" ? await requestPublication(deps) : null,
  });
}

async function listAdminProjects(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<Response> {
  await requireAdmin(request, deps);
  const projects = await deps.persistence.listProjects();
  return json(200, { projects: projects.map(adminProject) });
}

async function replaceProjectManifest(
  request: Request,
  deps: ProjectApiDependencies,
  projectId: string,
): Promise<Response> {
  const session = await requireAdmin(request, deps);
  if (!PROJECT_ID.test(projectId)) fail(404, "not_found", "Project not found");
  const body = await readJsonObject(request);
  exactKeys(body, ["manifest", "expectedRevision", "reason"]);
  if (
    typeof body.expectedRevision !== "number" ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 1
  ) {
    fail(400, "invalid_request", "Invalid expectedRevision");
  }
  const reason = boundedText(body.reason, "reason", 1, 1000);
  const projects = await deps.persistence.listProjects();
  const current = projects.find((project) => project.id === projectId);
  if (current === undefined) fail(404, "not_found", "Project not found");
  if (current.revision !== body.expectedRevision) {
    fail(409, "stale_revision", "The project changed since you loaded it");
  }
  const { manifest, text } = canonicalManifest(body.manifest);
  if (manifest.id !== projectId) {
    fail(422, "invalid_manifest", "Project id cannot change");
  }
  try {
    assertProjectPolicyTransition(current.manifest, manifest);
  } catch (error) {
    invalidManifest(error);
  }
  assertReviewBudgetTransition(current.manifest, manifest, deps.now());
  assertRegistryWith(projects, manifest);
  // A project goes live only after both reviewed skills are on development.
  if (manifest.status === "active") {
    for (const skill of [manifest.skill, manifest.reviewSkill]) {
      if (!(await deps.skillPublished(skill.sourcePath))) {
        fail(
          422,
          "skill_not_published",
          `${skill.sourcePath} is not on the reviewed development branch`,
        );
      }
    }
  }
  const result = await deps.persistence.appendProjectRevision({
    projectId,
    expectedRevision: current.revision,
    manifest,
    manifestText: text,
    manifestSha256: await sha256Hex(new TextEncoder().encode(text)),
    reason,
    actor: { githubId: session.githubId, githubLogin: session.githubLogin },
    at: deps.now().toISOString(),
  });
  if (result === "conflict") {
    fail(409, "stale_revision", "The project changed since you loaded it");
  }
  const updated = await deps.persistence.getProject(projectId);
  if (updated === null) fail(500, "internal_error", "Project vanished");
  return json(200, {
    project: adminProject(updated),
    publication: await requestPublication(deps),
  });
}

async function listPublicProjects(
  deps: ProjectApiDependencies,
): Promise<Response> {
  const projects = await deps.persistence.listProjects();
  return json(
    200,
    {
      schemaVersion: "1",
      projects: projects.map((project) => project.manifest),
    },
    "public, max-age=60",
  );
}

/**
 * One approved revision with its exact stored bytes. A generated skill's
 * installer hashes these bytes against the digest bound in its provenance.
 */
async function getPublicRevision(
  deps: ProjectApiDependencies,
  projectId: string,
  revisionText: string,
): Promise<Response> {
  const revision = Number(revisionText);
  if (
    !PROJECT_ID.test(projectId) ||
    !/^[1-9][0-9]{0,8}$/u.test(revisionText) ||
    !Number.isSafeInteger(revision)
  )
    fail(404, "not_found", "Revision not found");
  const stored = await deps.persistence.getRevisionText(projectId, revision);
  if (stored === null) fail(404, "not_found", "Revision not found");
  return json(
    200,
    {
      schemaVersion: "1",
      projectId,
      revision,
      manifestSha256: stored.manifestSha256,
      manifestText: stored.manifestText,
    },
    "public, max-age=31536000, immutable",
  );
}

async function listPublicRevisions(
  deps: ProjectApiDependencies,
): Promise<Response> {
  const revisions = await deps.persistence.listRevisions();
  return json(200, { schemaVersion: "1", revisions }, "public, max-age=60");
}

function isProjectRoute(parts: string[]): boolean {
  return (
    // Deeper /projects/:id/... paths belong to the trace API.
    (parts[0] === "projects" && parts.length === 1) ||
    parts[0] === "project-revisions" ||
    parts[0] === "project-session" ||
    parts[0] === "project-applications" ||
    (parts[0] === "admin" &&
      (parts[1] === "projects" || parts[1] === "project-applications"))
  );
}

function pathParts(request: Request): string[] {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/v1/")) return [];
  return path.slice("/api/v1/".length).split("/").filter(Boolean);
}

/** Returns null when the path belongs to another API module. */
export async function handleProjectApi(
  request: Request,
  deps: ProjectApiDependencies,
): Promise<Response | null> {
  const parts = pathParts(request);
  const route = `${request.method} ${parts
    .map((part, index) => (parts[0] === "admin" && index === 2 ? ":id" : part))
    .join("/")}`;
  try {
    // Writes ride the SameSite session cookie, so they must come from this
    // origin as JSON; a cross-site form can never submit one.
    if (
      request.method !== "GET" &&
      parts.length > 0 &&
      isProjectRoute(parts) &&
      (request.headers.get("origin") !== new URL(request.url).origin ||
        request.headers.get("content-type")?.split(";")[0] !==
          "application/json")
    ) {
      fail(403, "origin_forbidden", "Requests must come from this site");
    }
    if (
      request.method === "GET" &&
      parts[0] === "project-revisions" &&
      parts.length === 3
    )
      return await getPublicRevision(deps, parts[1], parts[2]);
    switch (route) {
      case "GET projects":
        return await listPublicProjects(deps);
      case "GET project-revisions":
        return await listPublicRevisions(deps);
      case "GET project-session": {
        // Signed out is an ordinary state, not an error the browser logs.
        const actor = await deps.sessionActor(request);
        return json(200, {
          session: actor === null ? null : sessionBody(actor, deps),
        });
      }
      case "POST project-applications":
        return await submitApplication(request, deps);
      case "GET project-applications/mine":
        return await listMyApplications(request, deps);
      case "GET admin/project-applications":
        return await listAdminApplications(request, deps);
      case "POST admin/project-applications/:id/approve":
        return await decideApplication(request, deps, parts[2], "approve");
      case "POST admin/project-applications/:id/reject":
        return await decideApplication(request, deps, parts[2], "reject");
      case "GET admin/projects":
        return await listAdminProjects(request, deps);
      case "PUT admin/projects/:id/manifest":
        return await replaceProjectManifest(request, deps, parts[2]);
    }
    if (isProjectRoute(parts)) return json(404, { error: "not_found" });
    return null;
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
    if (status >= 500) console.error("project API failure");
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
