/**
 * Community project security vetting API (PRD VET-01 to VET-08, MVP-12).
 *
 * Slop queues scans of exact project revisions automatically when their
 * executable content changes (the signed refresh), after a flag pause, or
 * when an admin asks. The external scanner service reads the queue and posts
 * bounded malicious-code scan results; its routes need an Ed25519 signature
 * from a key in VETTING_RESULT_PUBLIC_KEYS. Without a configured key every
 * vetting route that depends on the service reports it unavailable, and no
 * revision can be cleared.
 */

import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import type {
  GithubActor,
  ProjectRecord,
  ProjectSetupStatus,
  WebSession,
} from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import {
  type ApiError,
  apiErrorResponse,
  fail,
  isSameOriginJsonWrite,
  json as jsonResponse,
  PROJECT_ID,
  pathParts,
} from "../http";
import type { ProjectPersistence } from "../projects/contracts";
import { type EdgeCache, purgeProjectCache } from "../projects/edge-cache";
import { pausedByFlagsOnly, projectRestriction } from "../projects/enforcement";
import type { ScanRequester } from "../projects/setup";
import { isRecord, readJsonObject, readLimitedBody } from "../trace/validation";
import type { VettingEvidence } from "./evidence";
import type { ProjectFlagStore } from "./flags";
import {
  type CloudflareVettingPersistence,
  summarize,
  type VettingAssessment,
  type VettingPin,
  vettedContentSha256,
} from "./persistence";
import { MAX_VETTING_RESULT_BYTES } from "./result";
import { reusableCleanScan } from "./reuse";
import {
  isScanResult,
  parseRecordedVettingResult,
  recordedResultProblems,
  scanSourceInventory,
} from "./scan-result";

const VETTING_SIGNATURE_CONTEXT = "slop-vetting:v1";
/** Signed requests older or newer than this are refused. */
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

export type VettingApiDependencies = {
  vetting: CloudflareVettingPersistence;
  evidence?: VettingEvidence;
  /** Private disposable runner; receives no credentials or session headers. */
  sandbox?: { fetch(request: Request): Promise<Response> };
  projects: Pick<
    ProjectPersistence,
    "getProject" | "listProjects" | "enforcementGeneration" | "listEnforcements"
  >;
  /** Contributor flags, shown to administrators beside each project. */
  flags?: Pick<ProjectFlagStore, "activeFlags">;
  /** Raw 32-byte Ed25519 public keys of the vetting service, base64. */
  resultPublicKeys: string | undefined;
  /** Configured administrators and project moderators; never inferred from scan content. */
  operatorGithubIds?: readonly string[];
  /**
   * Reads the live pin of a project: its integration-branch head on GitHub
   * and the deployed skill template digest. Throws when either is unreadable
   * or the project has more than one repository.
   */
  livePin: (manifest: ProjectDefinition) => Promise<VettingPin>;
  /** Resolves the site session; null when signed out. */
  session: (request: Request) => Promise<WebSession | null>;
  now: () => Date;
  randomId: () => string;
  cache?: EdgeCache;
  refreshSetup?: (projectId: string) => Promise<ProjectSetupStatus | null>;
};

function json(status: number, body: Record<string, unknown>): Response {
  return jsonResponse(status, body, { cacheControl: "no-store" });
}

function base64Bytes(value: string): Uint8Array | null {
  const normal = value.trim().replaceAll("-", "+").replaceAll("_", "/");
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(normal)) return null;
  try {
    return Uint8Array.from(atob(normal), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

type ServiceKey = { sha256: string; key: CryptoKey };

function invalidServiceKeys(): ServiceKey[] {
  console.error("VETTING_RESULT_PUBLIC_KEYS holds an invalid key");
  return [];
}

/** The configured service keys; an empty list means the service is unavailable. */
async function serviceKeys(value: string | undefined): Promise<ServiceKey[]> {
  const keys: ServiceKey[] = [];
  for (const entry of (value ?? "").split(",")) {
    if (entry.trim() === "") continue;
    const raw = base64Bytes(entry);
    // A malformed key makes the whole configuration unusable, never partly trusted.
    if (raw === null || raw.length !== 32) return invalidServiceKeys();
    try {
      keys.push({
        sha256: await sha256Hex(raw),
        key: await crypto.subtle.importKey(
          "raw",
          raw as Uint8Array<ArrayBuffer>,
          { name: "Ed25519" },
          false,
          ["verify"],
        ),
      });
    } catch {
      return invalidServiceKeys();
    }
  }
  return keys;
}

export async function vettingServiceAvailable(
  value: string | undefined,
): Promise<boolean> {
  return (await serviceKeys(value)).length > 0;
}

/** The exact bytes the vetting service signs for one request. */
export function vettingSignedMessage(
  method: string,
  pathAndQuery: string,
  timestamp: string,
  bodySha256: string,
): Uint8Array {
  return new TextEncoder().encode(
    [
      VETTING_SIGNATURE_CONTEXT,
      method,
      pathAndQuery,
      timestamp,
      bodySha256,
    ].join("\n"),
  );
}

/** Verifies the service signature and returns the body bytes and key digest. */
export async function signedVettingRequest(
  request: Request,
  deps: Pick<VettingApiDependencies, "resultPublicKeys" | "now">,
  maximum = MAX_VETTING_RESULT_BYTES,
): Promise<{ body: Uint8Array; keySha256: string }> {
  const keys = await serviceKeys(deps.resultPublicKeys);
  if (keys.length === 0)
    fail(503, "vetting_unavailable", "The vetting service is not configured");
  const timestamp = request.headers.get("x-slop-vetting-timestamp") ?? "";
  const keyId = request.headers.get("x-slop-vetting-key") ?? "";
  const signature = base64Bytes(
    request.headers.get("x-slop-vetting-signature") ?? "",
  );
  const at = Date.parse(timestamp);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(timestamp) ||
    !Number.isFinite(at) ||
    Math.abs(deps.now().getTime() - at) > SIGNATURE_WINDOW_MS
  )
    fail(401, "invalid_signature", "The signed timestamp is missing or stale");
  const key = keys.find((candidate) => candidate.sha256 === keyId);
  if (key === undefined || signature === null || signature.length !== 64)
    fail(401, "invalid_signature", "The vetting signature is not valid");
  const body = await readLimitedBody(request, maximum);
  const url = new URL(request.url);
  const valid = await crypto.subtle.verify(
    "Ed25519",
    key.key,
    signature as Uint8Array<ArrayBuffer>,
    vettingSignedMessage(
      request.method,
      `${url.pathname}${url.search}`,
      timestamp,
      await sha256Hex(body),
    ) as Uint8Array<ArrayBuffer>,
  );
  if (!valid)
    fail(401, "invalid_signature", "The vetting signature is not valid");
  return { body, keySha256: key.sha256 };
}

async function requireAdmin(
  request: Request,
  deps: VettingApiDependencies,
): Promise<WebSession> {
  const session = await deps.session(request);
  if (session === null) fail(401, "unauthorized", "Sign in with GitHub");
  if (!session.admin) fail(403, "forbidden", "Admin access is required");
  return session;
}

/** The restricted operator view: full result, findings and quarantine records. */
function adminAssessment(assessment: VettingAssessment) {
  return {
    ...summarize(assessment),
    projectId: assessment.projectId,
    manifestSha256: assessment.manifestSha256,
    requestedBy: assessment.requestedBy,
    requestReason: assessment.requestReason,
    resultSha256: assessment.resultSha256,
    signingKeySha256: assessment.signingKeySha256,
    result: assessment.result,
  };
}

async function adminOverview(
  request: Request,
  deps: VettingApiDependencies,
): Promise<Response> {
  await requireAdmin(request, deps);
  const assessments = await deps.vetting.listAssessments();
  const projects = await Promise.all(
    (await deps.projects.listProjects()).map(async (project) => ({
      id: project.id,
      name: project.manifest.name,
      status: project.status,
      revision: project.revision,
      clearance: await deps.vetting.manifestClearance(
        project.id,
        project.manifest,
        project.revision,
        () => deps.livePin(project.manifest),
      ),
    })),
  );
  const queueRegistrationAvailable = await vettingServiceAvailable(
    deps.resultPublicKeys,
  );
  return json(200, {
    projects,
    service:
      queueRegistrationAvailable && deps.evidence?.ready()
        ? { state: "available", queueRegistrationAvailable }
        : {
            state: "unavailable",
            queueRegistrationAvailable,
            reason: queueRegistrationAvailable
              ? "Private evidence storage is not bound. You may queue a scan, but acquisition and clean clearance must wait."
              : "The vetting service key is unavailable. New scans cannot be queued, acquired or recorded. Existing decisions still require current retained evidence.",
          },
    assessments: assessments.map(adminAssessment),
    // Moderators read flag evidence here; a flag needs no approval to count.
    flags: (await deps.flags?.activeFlags(deps.now())) ?? [],
  });
}

async function requestAssessment(
  request: Request,
  deps: VettingApiDependencies,
): Promise<Response> {
  const session = await requireAdmin(request, deps);
  const body = await readJsonObject(request);
  const keys = Object.keys(body).sort().join(",");
  if (keys !== "projectId,reason,revision")
    fail(400, "invalid_request", "Send projectId, revision and reason");
  if (typeof body.projectId !== "string" || !PROJECT_ID.test(body.projectId))
    fail(400, "invalid_request", "Invalid projectId");
  if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1)
    fail(400, "invalid_request", "Invalid revision");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 1 || reason.length > 1000)
    fail(400, "invalid_request", "reason must be 1 to 1000 characters");
  if (!(await vettingServiceAvailable(deps.resultPublicKeys)))
    fail(
      503,
      "vetting_unavailable",
      "The vetting service is not configured, so a scan cannot be queued",
    );
  const project = await deps.projects.getProject(body.projectId);
  if (project === null) fail(404, "not_found", "Project not found");
  // New scan requests must pin the current revision. A completed admission
  // remains evidence for its original revision when routine changes follow.
  if (project.revision !== body.revision)
    fail(409, "stale_revision", "Scan the project's current revision");
  const queued = await queueAssessment(
    deps,
    project,
    { githubId: session.githubId, githubLogin: session.githubLogin },
    reason,
  );
  if (queued === "conflict")
    fail(409, "assessment_queued", "This revision already has a queued scan");
  return json(201, { assessment: adminAssessment(queued) });
}

/**
 * Queues one scan of a project's current revision at its live pin. The
 * queue assigns the exact commit and template digest (VET-07); the service
 * cannot choose them, and a result for any other commit is refused. Returns
 * "conflict" when this pin and active flag set already have a queued scan. Throws
 * `pin_unavailable` when the live pin cannot be read.
 */
async function queueAssessment(
  deps: Pick<VettingApiDependencies, "livePin" | "now" | "randomId"> & {
    vetting: Pick<
      CloudflareVettingPersistence,
      "createAssessment" | "getAssessment"
    >;
  },
  project: ProjectRecord,
  requestedBy: GithubActor,
  reason: string,
) {
  let pin: VettingPin;
  try {
    pin = await deps.livePin(project.manifest);
  } catch (error) {
    fail(
      503,
      "pin_unavailable",
      `Slop could not read the integration-branch head or the skill template digest, so a scan cannot be queued. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }
  const assessment = {
    id: `vet_${deps.randomId().replaceAll("-", "").toLowerCase()}`,
    projectId: project.id,
    revision: project.revision,
    manifestSha256: project.manifestSha256,
    contentSha256: await vettedContentSha256(project.manifest),
    commitSha: pin.commitSha,
    templateSha256: pin.templateSha256,
    requestedBy,
    requestedAt: deps.now().toISOString(),
    requestReason: reason.slice(0, 1000),
  };
  if (!/^vet_[a-f0-9]{32}$/u.test(assessment.id))
    fail(500, "internal_error", "Assessment id is invalid");
  if ((await deps.vetting.createAssessment(assessment)) === "conflict")
    return "conflict" as const;
  const stored = await deps.vetting.getAssessment(assessment.id);
  if (stored === null) fail(500, "internal_error", "Assessment vanished");
  return stored;
}

/**
 * The steward on whose behalf an automatic scan runs. The requester fields
 * of an automatic scan name the project steward, and its reason says it was
 * automatic; no person pressed a button.
 */
function stewardActor(manifest: ProjectDefinition): GithubActor {
  return {
    githubId: manifest.steward.github.actorId,
    githubLogin: manifest.steward.github.login,
  };
}

/**
 * Queues an automatic scan for the project steward, when the vetting service
 * is configured. A failure leaves the scan to the next signed refresh, so it
 * never undoes the change that asked for it.
 */
export async function queueAutomaticScan(
  deps: Pick<
    VettingApiDependencies,
    "vetting" | "livePin" | "now" | "randomId" | "resultPublicKeys"
  >,
  project: ProjectRecord,
  reason: string,
): Promise<"queued" | "already_queued" | "unavailable"> {
  if (!(await vettingServiceAvailable(deps.resultPublicKeys)))
    return "unavailable";
  try {
    return (await queueAssessment(
      deps,
      project,
      stewardActor(project.manifest),
      reason,
    )) === "conflict"
      ? "already_queued"
      : "queued";
  } catch {
    return "unavailable";
  }
}

/**
 * Queues an owner's setup scan through the same assessment row, live pin and
 * service-key gate as the operator route.
 */
export function vettingScanRequester(input: {
  vetting: Pick<
    CloudflareVettingPersistence,
    "createAssessment" | "getAssessment"
  >;
  serviceAvailable: () => Promise<boolean>;
  livePin: (manifest: ProjectDefinition) => Promise<VettingPin>;
  now: () => Date;
  randomId: () => string;
}): ScanRequester {
  return async (project, actor, reason) => {
    if (!(await input.serviceAvailable()))
      return {
        state: "unavailable",
        message: "The scan service is unavailable. Check again later.",
      };
    let queued: Awaited<ReturnType<typeof queueAssessment>>;
    try {
      queued = await queueAssessment(input, project, actor, reason);
    } catch (error) {
      if ((error as Partial<ApiError> | null)?.code !== "pin_unavailable")
        throw error;
      return {
        state: "unavailable",
        message:
          "Slop could not read the repository or skill template. Check again later.",
      };
    }
    return { state: queued === "conflict" ? "already_queued" : "queued" };
  };
}

/** Automatic scans one signed refresh may queue. */
const MAX_AUTOMATIC_SCANS = 25;

/**
 * Queues initial repository admission without an admin (PRD sections 4 and 8),
 * and a project that flags alone paused and that has no
 * scan requested since the pause. A fresh clean scan at the live pin that
 * could not reinstate when it landed reinstates here. Banned and
 * moderator-restricted projects wait for a moderator. The signed scanner
 * service calls this before it reads the queue.
 */
async function refreshQueue(
  request: Request,
  deps: VettingApiDependencies,
): Promise<Response> {
  const { body } = await signedVettingRequest(request, deps, 1024);
  if (new TextDecoder().decode(body) !== "{}")
    fail(400, "invalid_request", "Send an empty JSON object");
  const [projects, records] = await Promise.all([
    deps.projects.listProjects(),
    deps.projects.listEnforcements(),
  ]);
  const queued: string[] = [];
  const reinstated: string[] = [];
  const skipped: { projectId: string; reason: string }[] = [];
  for (const project of projects) {
    if (queued.length >= MAX_AUTOMATIC_SCANS) break;
    const restriction = projectRestriction(project.id, records);
    const flagPaused = pausedByFlagsOnly(restriction);
    if (restriction.state !== "clear" && !flagPaused) continue;
    if (!flagPaused && project.manifest.listingTier === "retired") continue;
    let reason: string | null = null;
    if (flagPaused) {
      // A fresh scan must cover the live pin and every active flag. New
      // evidence queues another scan even when the source did not change.
      const since = restriction.since ?? "";
      let live: VettingPin;
      try {
        live = await deps.livePin(project.manifest);
      } catch {
        skipped.push({ projectId: project.id, reason: "pin_unavailable" });
        continue;
      }
      const assessments = await deps.vetting.projectAssessments(project.id);
      const fresh: VettingAssessment[] = [];
      for (const assessment of assessments)
        if (
          assessment.revision === project.revision &&
          assessment.requestedAt >= since &&
          assessment.commitSha === live.commitSha &&
          assessment.templateSha256 === live.templateSha256 &&
          (await deps.vetting.assessmentCoversActiveFlags(assessment.id))
        )
          fresh.push(assessment);
      // A fresh clean scan whose reinstatement could not be written when it
      // landed, such as during a live-pin outage, reinstates now.
      const clean = fresh.filter((assessment) => assessment.state === "clean");
      for (const assessment of clean.reverse())
        if (
          await deps.vetting.reinstateFromRecordedScan(
            assessment.id,
            live,
            deps.now().toISOString(),
          )
        ) {
          reinstated.push(assessment.id);
          await purgeProjectCache(
            deps.cache,
            new URL(request.url).origin,
            await deps.projects.enforcementGeneration(),
          );
          break;
        }
      if (fresh.length === 0)
        reason =
          "Automatic fresh scan after two contributor flags paused the project";
    } else {
      const clearance = await deps.vetting.manifestClearance(
        project.id,
        project.manifest,
        project.revision,
        () => deps.livePin(project.manifest),
      );
      if (clearance.state === "unscanned")
        reason = "Automatic scan of new project content";
    }
    if (reason === null) continue;
    try {
      const assessment = await queueAssessment(
        deps,
        project,
        stewardActor(project.manifest),
        reason,
      );
      if (assessment !== "conflict") queued.push(assessment.id);
    } catch (error) {
      skipped.push({
        projectId: project.id,
        reason:
          typeof error === "object" && error !== null && "code" in error
            ? String((error as ApiError).code)
            : "queue_failed",
      });
    }
  }
  return json(200, { queued, reinstated, skipped });
}

/**
 * The service's work queue: exact revisions waiting for a scan, each with the
 * repository commit and skill template digest the service must scan.
 */
async function serviceQueue(
  request: Request,
  deps: VettingApiDependencies,
): Promise<Response> {
  await signedVettingRequest(request, deps);
  if (!deps.evidence?.ready())
    fail(
      503,
      "evidence_unavailable",
      "Private evidence storage is required before acquisition",
    );
  const origin = new URL(request.url).origin;
  const pending = await deps.vetting.pendingAssessments();
  return json(200, {
    schemaVersion: "slop-vetting-queue-v1",
    assessments: pending.map((assessment) => ({
      assessmentId: assessment.id,
      projectId: assessment.projectId,
      revision: assessment.revision,
      manifestSha256: assessment.manifestSha256,
      commitSha: assessment.commitSha,
      templateSha256: assessment.templateSha256,
      manifestUrl: `${origin}/api/v1/project-revisions/${assessment.projectId}/${assessment.revision}`,
      templateIndexUrl: `${origin}/skill-templates/index.json`,
      requestedAt: assessment.requestedAt,
    })),
  });
}

async function serviceResult(
  request: Request,
  deps: VettingApiDependencies,
): Promise<Response> {
  const { body, keySha256 } = await signedVettingRequest(request, deps);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    fail(400, "invalid_request", "The result must be UTF-8 JSON");
  }
  if (!isRecord(value))
    fail(400, "invalid_request", "The result must be an object");
  const result = parseRecordedVettingResult(value);
  const problems = recordedResultProblems(result);
  if (problems.length > 0)
    fail(
      422,
      "disposition_not_proven",
      `The ${result.disposition} disposition is not proven: ${problems.join("; ")}`,
    );
  const assessment = await deps.vetting.getAssessment(result.assessmentId);
  if (assessment === null) fail(404, "not_found", "Assessment not found");
  if (
    assessment.projectId !== result.projectId ||
    assessment.revision !== result.revision ||
    assessment.manifestSha256 !== result.manifestSha256
  )
    fail(
      422,
      "revision_mismatch",
      "The result does not describe the queued project revision",
    );
  if (assessment.state !== "pending")
    fail(409, "already_recorded", "This assessment already has a result");
  const project = await deps.projects.getProject(assessment.projectId);
  if (project === null) fail(404, "not_found", "Project not found");
  const repository = project.manifest.repositories[0]?.id ?? "";
  if (result.assessed.repository.toLowerCase() !== repository.toLowerCase())
    fail(422, "revision_mismatch", "The result scanned another repository");
  if (
    result.assessed.commitSha !== assessment.commitSha ||
    result.assessed.templateSha256 !== assessment.templateSha256
  )
    fail(
      422,
      "commit_mismatch",
      `The result must scan commit ${assessment.commitSha} with skill template ${assessment.templateSha256}, which the queue assigned`,
    );
  if (isScanResult(result) && result.reusedAssessmentId !== null) {
    // A cached clean scan stands in only for byte-identical executable
    // content of the same repository under the same policy and template.
    // Reinstatement after a contributor-flag pause requires a fresh clean scan
    // requested on or after the pause (PRD sections 1, 8, 11).
    const [cached, enforcements] = await Promise.all([
      deps.vetting.getAssessment(result.reusedAssessmentId),
      deps.projects.listEnforcements(),
    ]);
    const restriction = projectRestriction(project.id, enforcements);
    if (!reusableCleanScan(cached, result, restriction))
      fail(
        422,
        "reuse_mismatch",
        "A reused scan must cite an original clean scan of the same repository, executable inventory, template, policy and report",
      );
  }
  if (
    result.disposition === "clean" &&
    !(await deps.evidence
      ?.retained(result)
      .catch(() =>
        fail(
          503,
          "evidence_unavailable",
          "Slop could not read the retained evidence. Retry later.",
        ),
      ))
  )
    fail(
      422,
      "evidence_incomplete",
      isScanResult(result)
        ? "Clean scan results require the exact retained report, inventory, dependency locks and artifacts"
        : "Clean results require a complete authorized canonical assembly and its exact retained evidence",
    );
  const livePin =
    result.disposition === "clean"
      ? await deps.livePin(project.manifest).catch(() => null)
      : undefined;
  const resultText = JSON.stringify(result);
  const recorded = await deps.vetting.recordResult({
    result,
    resultText,
    resultSha256: await sha256Hex(new TextEncoder().encode(resultText)),
    signingKeySha256: keySha256,
    operatorGithubIds: deps.operatorGithubIds,
    livePin,
    at: deps.now().toISOString(),
  });
  if (recorded === "conflict") {
    const current = await deps.vetting.getAssessment(result.assessmentId);
    if (current?.state === "pending")
      fail(
        409,
        "stale_project",
        "The project changed while the result was recorded. Read the queued scan and retry.",
      );
    fail(409, "already_recorded", "This assessment already has a result");
  }
  // Skills and discovery change with the clearance, so drop cached copies.
  // Cache keys carry the enforcement generation (ADM-06), so purge that scope.
  await purgeProjectCache(
    deps.cache,
    new URL(request.url).origin,
    await deps.projects.enforcementGeneration(),
  );
  // Accept the scan even if a separate GitHub readiness check is unavailable.
  // Report that retry explicitly; the owner can rerun the same setup check.
  let setup: ProjectSetupStatus | { state: "retry"; message: string } | null =
    null;
  if (result.disposition === "clean" && deps.refreshSetup) {
    try {
      setup = await deps.refreshSetup(project.id);
    } catch {
      setup = {
        state: "retry",
        message: "Scan recorded. Project setup must be checked again.",
      };
    }
  }
  const stored = await deps.vetting.getAssessment(result.assessmentId);
  if (stored === null) fail(500, "internal_error", "Assessment vanished");
  return json(200, {
    setup,
    assessment: {
      ...summarize(stored),
      resultSha256: stored.resultSha256,
    },
  });
}

/** Private cache lookup after the scanner has finished its exact inventory. */
async function serviceReuse(
  request: Request,
  deps: VettingApiDependencies,
): Promise<Response> {
  const { body } = await signedVettingRequest(request, deps, 1024);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    fail(400, "invalid_request", "The lookup must be UTF-8 JSON");
  }
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join() !==
      "assessmentId,inputManifestSha256,policyVersion" ||
    typeof value.assessmentId !== "string" ||
    !/^vet_[a-f0-9]{32}$/u.test(value.assessmentId) ||
    typeof value.inputManifestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.inputManifestSha256) ||
    typeof value.policyVersion !== "string" ||
    !value.policyVersion.trim() ||
    value.policyVersion.length > 200
  )
    fail(400, "invalid_request", "Invalid scan reuse lookup");
  const assessment = await deps.vetting.getAssessment(value.assessmentId);
  if (!assessment) fail(404, "not_found", "Assessment not found");
  if (assessment.state !== "pending")
    fail(409, "already_recorded", "This assessment already has a result");
  const project = await deps.projects.getProject(assessment.projectId);
  if (!project) fail(404, "not_found", "Project not found");
  const restriction = projectRestriction(
    project.id,
    await deps.projects.listEnforcements(),
  );
  const candidates = await deps.vetting.projectAssessments(project.id);
  for (const cached of candidates.reverse()) {
    const prior = cached.result;
    if (!prior || !isScanResult(prior)) continue;
    const result = {
      ...prior,
      assessmentId: assessment.id,
      projectId: assessment.projectId,
      revision: assessment.revision,
      manifestSha256: assessment.manifestSha256,
      policyVersion: value.policyVersion,
      assessed: {
        ...prior.assessed,
        repository: project.manifest.repositories[0]?.id ?? "",
        commitSha: assessment.commitSha,
        templateSha256: assessment.templateSha256,
      },
      reusedAssessmentId: cached.id,
    };
    if (scanSourceInventory(result) !== value.inputManifestSha256) continue;
    if (!reusableCleanScan(cached, result, restriction)) continue;
    if (recordedResultProblems(result).length > 0) continue;
    if (!(await deps.evidence?.retained(result))) continue;
    return json(200, { schemaVersion: "slop-vetting-reuse-v1", result });
  }
  return json(200, { schemaVersion: "slop-vetting-reuse-v1", result: null });
}

/** Returns null when the path belongs to another API module. */
export async function handleVettingApi(
  request: Request,
  deps: VettingApiDependencies,
): Promise<Response | null> {
  const parts = pathParts(request);
  const admin = parts[0] === "admin" && parts[1] === "vetting";
  if (!admin && parts[0] !== "vetting") return null;
  const route = `${request.method} ${parts.join("/")}`;
  try {
    // Admin writes ride the session cookie, so they must come from this site.
    if (admin && request.method !== "GET" && !isSameOriginJsonWrite(request))
      fail(403, "origin_forbidden", "Requests must come from this site");
    switch (route) {
      case "GET admin/vetting":
        return await adminOverview(request, deps);
      case "POST admin/vetting/assessments":
        return await requestAssessment(request, deps);
      case "GET vetting/sandbox":
      case "POST vetting/sandbox": {
        const signed = await signedVettingRequest(
          request,
          deps,
          3 * 1024 * 1024,
        );
        if (!deps.sandbox)
          fail(
            503,
            "sandbox_unavailable",
            "The isolated runner is not configured",
          );
        const response = await deps.sandbox.fetch(
          new Request(
            `https://vetting-sandbox.internal/${request.method === "GET" ? "health" : "run"}`,
            {
              method: request.method,
              headers: { "content-type": "application/json" },
              ...(request.method === "POST"
                ? { body: new Uint8Array(signed.body) }
                : {}),
            },
          ),
        );
        return new Response(response.body, {
          status: response.status,
          headers: {
            "content-type":
              response.headers.get("content-type") ?? "text/plain",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
          },
        });
      }
      case "GET vetting/requests":
        return await serviceQueue(request, deps);
      case "POST vetting/results":
        return await serviceResult(request, deps);
      case "POST vetting/reuse":
        return await serviceReuse(request, deps);
      case "POST vetting/refresh":
        return await refreshQueue(request, deps);
    }
    return json(404, { error: "not_found" });
  } catch (caught) {
    return apiErrorResponse(caught, {
      label: "vetting API failure",
      respond: json,
      // Unavailable-service refusals tell the caller to retry later.
      publicMessage: (status) => status === 503,
    });
  }
}
