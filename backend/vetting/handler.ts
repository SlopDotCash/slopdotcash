import { pathParts } from "../api-path";
/**
 * Community project security vetting API (PRD VET-01 to VET-08, MVP-12).
 *
 * Admins queue a scan of one exact project revision. The external secure-VM
 * vetting service reads the queue and posts results; both service routes
 * need an Ed25519 signature from a key in VETTING_RESULT_PUBLIC_KEYS. Without
 * a configured key every vetting route that depends on the service reports
 * it unavailable, and no revision can be cleared.
 */

import type { ProjectSetupStatus } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { type ApiError, fail } from "../api-error";
import type { ProjectPersistence, WebSession } from "../projects/contracts";
import { type EdgeCache, purgeProjectCache } from "../projects/edge-cache";
import {
  isRecord,
  readJsonObject,
  readLimitedBody,
  sha256Hex,
} from "../trace/validation";
import type { VettingEvidence } from "./evidence";
import {
  type CloudflareVettingPersistence,
  summarize,
  type VettingAssessment,
  type VettingPin,
  vettedContentSha256,
} from "./persistence";
import {
  dispositionProblems,
  MAX_VETTING_RESULT_BYTES,
  parseVettingResult,
  VettingResultError,
} from "./result";

export const VETTING_SIGNATURE_CONTEXT = "slop-vetting:v1";
/** Signed requests older or newer than this are refused. */
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
const PROJECT_ID = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;

export type VettingApiDependencies = {
  vetting: CloudflareVettingPersistence;
  evidence?: VettingEvidence;
  projects: Pick<
    ProjectPersistence,
    "getProject" | "listProjects" | "enforcementGeneration"
  >;
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
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
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

/** The configured service keys; an empty list means the service is unavailable. */
async function serviceKeys(value: string | undefined): Promise<ServiceKey[]> {
  const keys: ServiceKey[] = [];
  for (const entry of (value ?? "").split(",")) {
    if (entry.trim() === "") continue;
    const raw = base64Bytes(entry);
    // A malformed key makes the whole configuration unusable, never partly trusted.
    if (raw === null || raw.length !== 32) return [];
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
      return [];
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
    fail(
      503,
      "vetting_unavailable",
      "The secure-VM vetting service is not configured",
    );
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
              ? "Private evidence storage or policy is unavailable. You may queue a scan, but acquisition and clean clearance must wait."
              : "The secure-VM service key is unavailable. New scans cannot be queued, acquired or recorded. Existing decisions still require current retained evidence.",
          },
    assessments: assessments.map(adminAssessment),
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
      "The secure-VM vetting service is not configured, so a scan cannot be queued",
    );
  const project = await deps.projects.getProject(body.projectId);
  if (project === null) fail(404, "not_found", "Project not found");
  // Only the current revision is scanned: an older one can never be served.
  if (project.revision !== body.revision)
    fail(409, "stale_revision", "Scan the project's current revision");
  // The queue assigns the exact commits to scan (VET-07); the service cannot
  // choose them, and a result for any other commit is refused.
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
    requestedBy: {
      githubId: session.githubId,
      githubLogin: session.githubLogin,
    },
    requestedAt: deps.now().toISOString(),
    requestReason: reason,
  };
  if (!/^vet_[a-f0-9]{32}$/u.test(assessment.id))
    fail(500, "internal_error", "Assessment id is invalid");
  if ((await deps.vetting.createAssessment(assessment)) === "conflict")
    fail(409, "assessment_queued", "This revision already has a queued scan");
  const stored = await deps.vetting.getAssessment(assessment.id);
  if (stored === null) fail(500, "internal_error", "Assessment vanished");
  return json(201, { assessment: adminAssessment(stored) });
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
      "Private evidence storage, access policy and current external-control attestation are required before acquisition",
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
  const result = parseVettingResult(value);
  const problems = dispositionProblems(result);
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
  if (
    result.disposition === "clean" &&
    !(await deps.evidence?.complete(result))
  )
    fail(
      422,
      "evidence_incomplete",
      "Clean results require a complete authorized canonical assembly and its exact retained evidence",
    );
  const resultText = JSON.stringify(result);
  const recorded = await deps.vetting.recordResult({
    result,
    resultText,
    resultSha256: await sha256Hex(new TextEncoder().encode(resultText)),
    signingKeySha256: keySha256,
    operatorGithubIds: deps.operatorGithubIds,
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
    project.id,
    [project.manifest.skill.id, project.manifest.reviewSkill.id],
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
    if (
      admin &&
      request.method !== "GET" &&
      (request.headers.get("origin") !== new URL(request.url).origin ||
        request.headers.get("content-type")?.split(";")[0] !==
          "application/json")
    )
      fail(403, "origin_forbidden", "Requests must come from this site");
    switch (route) {
      case "GET admin/vetting":
        return await adminOverview(request, deps);
      case "POST admin/vetting/assessments":
        return await requestAssessment(request, deps);
      case "GET vetting/requests":
        return await serviceQueue(request, deps);
      case "POST vetting/results":
        return await serviceResult(request, deps);
    }
    return json(404, { error: "not_found" });
  } catch (caught) {
    const error =
      caught instanceof VettingResultError
        ? caught
        : typeof caught === "object" && caught !== null
          ? (caught as Partial<ApiError>)
          : {};
    const status =
      Number.isSafeInteger(error.status) &&
      Number(error.status) >= 400 &&
      Number(error.status) <= 599
        ? Number(error.status)
        : 500;
    if (status >= 500 && status !== 503) console.error("vetting API failure");
    return json(status, {
      error:
        typeof error.code === "string" &&
        /^[a-z][a-z0-9_]{1,63}$/u.test(error.code)
          ? error.code
          : "internal_error",
      message:
        status >= 500 && status !== 503
          ? "Internal error"
          : typeof error.message === "string"
            ? error.message
            : "Request failed",
    });
  }
}
