/**
 * The bounded malicious-code scan service (PRD section 8; issue #909). One
 * pass asks Slop to queue changed content, reads the signed queue, and for
 * each pending assessment: acquires the exact queued inputs, inspects them,
 * reuses an original retained clean scan of identical inspected content or
 * runs the primary model review, runs the specialist review only when the
 * result is ambiguous or high risk, retains the private evidence and
 * publishes the result once.
 *
 * A service failure (an unavailable queue, source or provider) publishes
 * nothing and leaves the assessment pending, so the next pass retries it.
 * A bound acquisition-policy refusal publishes an incomplete result instead;
 * no source inspection or model review is claimed.
 * A clean result is never published without its retained evidence. An
 * incomplete result records quarantine even when evidence storage fails.
 * A published attempt is journaled and never sent again; an uncertain or
 * rejected attempt waits for an operator. The service executes acquired
 * native artifacts only through the private disposable sandbox, never on
 * the controller host. It never confirms malice or releases a
 * quarantined artifact: moderators decide those (owner decision D3).
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { EVIDENCE_CHUNK_BYTES } from "../../backend/vetting/evidence-chunks";
import { MAX_VETTING_RESULT_BYTES } from "../../backend/vetting/result";
import {
  isScanResult,
  parseRecordedVettingResult,
  recordedResultProblems,
  scanSourceInventory,
  type VettingScanResult,
} from "../../backend/vetting/scan-result";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { readBoundedJson } from "../../src/lib/browser-json";
import {
  composeAcquisitionRefusal,
  composeScanResult,
  inspectRepository,
  readAcquiredObject,
  readAcquiredSource,
  type ScanInputFile,
} from "./bounded-scan";
import { inspectIsolatedArtifacts } from "./isolated-inspection";
import { publishResult } from "./publication";
import {
  filePublicationJournal,
  type PublicationJournal,
} from "./publication-journal";
import {
  acquireQueuedAssessment,
  type QueueConnection,
  QueuedAcquisitionRefusal,
  type QueuedAssessment,
  readPendingAssessments,
} from "./queue";
import { type ReviewCache, reviewInventory } from "./review-plan";
import {
  PINNED_SCANNER_PROFILES,
  type ScannerProfile,
  validateProfile,
} from "./scanners";
import { signedVettingFetch, vettingServiceSigner } from "./service";

/**
 * Source-inventory gaps of the historical secure-VM contract that the
 * bounded scan covers itself: it reads the queued skill template, checks
 * dependency manifests and lockfiles, and runs its own model review. A full
 * runtime is not required (PRD section 8). Every other acquisition gap
 * (submodules, links, LFS objects) still keeps the source surface partial.
 */
const COVERED_BY_BOUNDED_SCAN = new Set([
  "execution-dependencies-and-release-assets-not-acquired",
  "skill-template-inputs-not-acquired",
  "runtime-and-model-review-not-performed",
]);
/** Template inputs are scanned under this prefix, apart from repository paths. */
export const TEMPLATE_PREFIX = "slop-skill-template";

/**
 * Fails closed unless the primary is the pinned Surplus `claude-opus-5.5`
 * profile and the specialist the pinned Surplus `gpt-6.1-sol` profile, so
 * `SURPLUS_API_KEY` reaches only the approved Surplus endpoints.
 */
export function assertPinnedProfiles(
  primary: ScannerProfile,
  specialist: ScannerProfile,
) {
  if (
    primary.transport !== "anthropic-messages" ||
    specialist.transport !== "openai-responses" ||
    primary.model !== PINNED_SCANNER_PROFILES["anthropic-messages"].model ||
    specialist.model !== PINNED_SCANNER_PROFILES["openai-responses"].model
  )
    throw new Error(
      "The primary review must be Surplus claude-opus-5.5 and the specialist Surplus gpt-6.1-sol",
    );
  validateProfile(primary);
  validateProfile(specialist);
}

export type ScanServiceConfig = {
  connection: QueueConnection;
  /** Read-only GitHub credential, used only while acquiring public source. */
  githubToken?: string;
  /** Surplus `claude-opus-5.5`: every fresh scan (owner decision D16). */
  primary: ScannerProfile;
  /** Surplus `gpt-6.1-sol`: only ambiguous or high-risk results. */
  specialist: ScannerProfile;
  policyVersion: string;
  /** Operator-private scratch space for acquired bytes. */
  workDirectory: string;
  /** Operator-private publication journal (publication.ts). */
  journalDirectory: string;
  journal?: PublicationJournal;
  randomId?: () => string;
  /**
   * Batched review of a large inventory (`review-plan.ts`): the input budget
   * of one call, parallel calls, and an optional operator-private cache that
   * lets a review larger than one pass's call budget resume next pass.
   */
  review?: {
    batchTokens?: number;
    concurrency?: number;
    cache?: ReviewCache;
  };
};

export type AssessmentOutcome =
  | {
      assessmentId: string;
      state: "published";
      disposition: string;
      outcome: "accepted" | "rejected" | "unknown";
      specialist: boolean;
      evidence: "retained" | "failed";
    }
  | {
      assessmentId: string;
      /** Left pending; the next pass tries again. */
      state: "retry";
      step:
        | "acquire"
        | "isolated-execution"
        | "reuse"
        | "primary-review"
        | "specialist-review"
        | "review-batches"
        | "evidence";
      /** The error name of a step that threw, never its message. */
      reason?: string;
    }
  | {
      assessmentId: string;
      /** A journaled attempt exists; an operator reconciles it. */
      state: "journaled";
    };

export type ScanPassReport = {
  refreshed: boolean;
  assessments: AssessmentOutcome[];
};

const encoder = new TextEncoder();

async function signedRequest(
  connection: QueueConnection,
  method: "POST" | "PUT",
  path: string,
  body: Uint8Array,
  contentType: string,
): Promise<Response> {
  return signedVettingFetch(connection, {
    method,
    path,
    body,
    contentType,
    timeoutMs: 30_000,
  });
}
/** A retry for a step that threw. It names the error, never the message,
 * which can carry source or provider text. A bound policy refusal takes the
 * incomplete-publication path; outages and changed inputs remain retryable.
 */
function retry(
  assessmentId: string,
  step: "acquire" | "isolated-execution" | "reuse",
  error: unknown,
): AssessmentOutcome {
  return {
    assessmentId,
    state: "retry",
    step,
    reason: error instanceof Error ? error.name : "unknown",
  };
}

/** POST /api/v1/vetting/refresh: Slop queues every changed project. */
async function refresh(connection: QueueConnection): Promise<boolean> {
  try {
    const response = await signedRequest(
      connection,
      "POST",
      "/api/v1/vetting/refresh",
      encoder.encode("{}"),
      "application/json",
    );
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * The repository source and the queued skill-template inputs, each reread
 * by its SHA-256. Template inputs keep their queued paths under
 * `TEMPLATE_PREFIX`, so agent instructions in the template are scanned.
 */
async function acquiredInputs(directory: string) {
  const source = await readAcquiredSource(directory);
  const queued = JSON.parse(
    await readFile(join(directory, "queued-inputs.json"), "utf8"),
  ) as {
    schema: string;
    manifestText: string;
    inputs: { path: string; sha256: string }[];
  };
  if (queued.schema !== "slop-queued-inputs-v1")
    throw new Error("Unknown queued input bundle");
  const templates: ScanInputFile[] = [];
  for (const input of queued.inputs)
    templates.push({
      path: `${TEMPLATE_PREFIX}/${input.path}`,
      bytes: await readAcquiredObject(directory, input.sha256),
    });
  return {
    // The result names the registered repository id, as the intake and an
    // acquisition refusal do. A recorded rename is acquired under its current
    // GitHub name, which differs from that id.
    repository: (
      JSON.parse(queued.manifestText) as { repositories: { id: string }[] }
    ).repositories[0].id,
    files: [...source.files, ...templates],
    acquisitionGaps: source.acquisitionGaps.filter(
      (gap) => !COVERED_BY_BOUNDED_SCAN.has(gap),
    ),
  };
}

/**
 * Registers and uploads the private report, the inventory the reviews read,
 * every dependency lock and every named artifact under the scan run, as the
 * signed intake requires before it records the result.
 */
async function retainEvidence(
  connection: QueueConnection,
  assessmentId: string,
  runId: string,
  objects: {
    bytes: Uint8Array;
    kind: "trace" | "manifest" | "artifact";
    label: string;
    contentType: string;
  }[],
): Promise<boolean> {
  const unique = new Map<string, (typeof objects)[number]>();
  for (const object of objects)
    unique.set(await sha256Hex(object.bytes), object);
  const trace = [...unique].find(([, object]) => object.kind === "trace");
  if (!trace) throw new Error("The scan report is required");
  // An object above one part is declared and sent as ordered 8 MiB parts,
  // so no request carries more than one part whatever the evidence size.
  const parts = new Map<
    string,
    { offset: number; size: number; sha256: string }[]
  >();
  for (const [sha256, object] of unique)
    if (object.bytes.byteLength > EVIDENCE_CHUNK_BYTES) {
      const layout = [];
      for (
        let offset = 0;
        offset < object.bytes.byteLength;
        offset += EVIDENCE_CHUNK_BYTES
      ) {
        const size = Math.min(
          EVIDENCE_CHUNK_BYTES,
          object.bytes.byteLength - offset,
        );
        layout.push({
          offset,
          size,
          sha256: await sha256Hex(object.bytes.subarray(offset, offset + size)),
        });
      }
      parts.set(sha256, layout);
    }
  const path = `/api/v1/vetting/evidence/${assessmentId}/${runId}`;
  const register = await signedRequest(
    connection,
    "POST",
    path,
    encoder.encode(
      JSON.stringify({
        traceSha256: trace[0],
        objects: [...unique].map(([sha256, object]) => ({
          sha256,
          sizeBytes: object.bytes.byteLength,
          kind: object.kind,
          label: object.label.slice(0, 200),
          contentType: object.contentType,
          ...(parts.has(sha256)
            ? {
                chunks: (parts.get(sha256) ?? []).map((part, index) => ({
                  index,
                  sha256: part.sha256,
                  sizeBytes: part.size,
                })),
              }
            : {}),
        })),
      }),
    ),
    "application/json",
  );
  if (!register.ok) {
    await register.body?.cancel();
    return false;
  }
  // Bytes already stored under the same digest are referenced, not resent.
  const registered = (await readBoundedJson(
    register,
    256 * 1024,
    "evidence registration",
  ).catch(() => null)) as { stored?: unknown } | null;
  const stored = new Set(
    Array.isArray(registered?.stored)
      ? registered.stored.filter((sha) => typeof sha === "string")
      : [],
  );
  const send = async (
    method: "POST" | "PUT",
    target: string,
    body: Uint8Array,
    type: string,
  ) => {
    const response = await signedRequest(
      connection,
      method,
      target,
      body,
      type,
    );
    await response.body?.cancel();
    return response.ok;
  };
  for (const [sha256, object] of unique) {
    const layout = parts.get(sha256);
    if (!layout) {
      if (
        !stored.has(sha256) &&
        !(await send(
          "PUT",
          `${path}/${sha256}`,
          object.bytes,
          object.contentType,
        ))
      )
        return false;
      continue;
    }
    if (!stored.has(sha256))
      for (const [index, part] of layout.entries())
        if (
          !(await send(
            "PUT",
            `${path}/${sha256}/chunks/${index}`,
            object.bytes.subarray(part.offset, part.offset + part.size),
            "application/octet-stream",
          ))
        )
          return false;
    // Finalization rereads every part and the whole digest for this run.
    if (
      !(await send(
        "POST",
        `${path}/${sha256}/finalize`,
        encoder.encode("{}"),
        "application/json",
      ))
    )
      return false;
  }
  return true;
}

/** A policy refusal completes the assignment as incomplete and notifies its owner. */
async function publishAcquisitionRefusal(
  config: ScanServiceConfig,
  refusal: QueuedAcquisitionRefusal,
  startedAt: string,
): Promise<AssessmentOutcome> {
  const { connection } = config;
  const { assessmentId } = refusal.assessment;
  const runId = `scan_${(config.randomId ?? randomUUID)().replaceAll("-", "")}`;
  const composed = composeAcquisitionRefusal({
    queued: { ...refusal.assessment, repository: refusal.repository },
    reason: refusal.summary,
    primaryModel: config.primary.model,
    policyVersion: config.policyVersion,
    runId,
    startedAt,
    completedAt: (connection.now?.() ?? new Date()).toISOString(),
  });
  const retained = await retainEvidence(connection, assessmentId, runId, [
    {
      bytes: composed.report,
      kind: "trace",
      label: "Acquisition refusal report",
      contentType: "application/json",
    },
    {
      bytes: composed.inventory,
      kind: "manifest",
      label: "Uninspected source coverage",
      contentType: "application/json",
    },
  ]).catch(() => false);
  const body = JSON.stringify(composed.result);
  const receipt = await publishResult({
    origin: connection.origin,
    body,
    approvedSha256: await sha256Hex(encoder.encode(body)),
    signer: connection,
    journalDirectory: config.journalDirectory,
    journal: config.journal,
    at: connection.now?.(),
    fetch: connection.fetch,
  });
  return {
    assessmentId,
    state: "published",
    disposition: "incomplete",
    outcome: receipt.outcome,
    specialist: false,
    evidence: retained ? "retained" : "failed",
  };
}

async function scanOne(
  config: ScanServiceConfig,
  assessment: Awaited<ReturnType<typeof readPendingAssessments>>[number],
): Promise<AssessmentOutcome> {
  const { assessmentId } = assessment;
  const { connection } = config;
  const now = () => connection.now?.() ?? new Date();
  let directory: string;
  const acquisitionStartedAt = now().toISOString();
  try {
    directory = (
      await acquireQueuedAssessment(
        connection,
        assessmentId,
        config.workDirectory,
        config.githubToken,
      )
    ).directory;
  } catch (error) {
    if (error instanceof QueuedAcquisitionRefusal)
      return publishAcquisitionRefusal(config, error, acquisitionStartedAt);
    return retry(assessmentId, "acquire", error);
  }
  try {
    const startedAt = now().toISOString();
    let inputs: Awaited<ReturnType<typeof acquiredInputs>>;
    try {
      inputs = await acquiredInputs(directory);
    } catch (error) {
      return retry(assessmentId, "acquire", error);
    }
    const inspection = inspectRepository(inputs);
    // Retain the exact deterministic input separately from the final inventory
    // that includes execution IDs, timestamps and output. Neither is normalized.
    const sourceInventory = inspection.inventory;
    const sourceInventorySha256 = inspection.inventorySha256;
    let reused: VettingScanResult | null;
    try {
      reused = await reusableResult(
        config,
        assessment,
        inputs.repository,
        sourceInventorySha256,
      );
    } catch (error) {
      return retry(assessmentId, "reuse", error);
    }
    if (reused) {
      const body = JSON.stringify(reused);
      const receipt = await publishResult({
        origin: connection.origin,
        body,
        approvedSha256: await sha256Hex(encoder.encode(body)),
        signer: connection,
        journalDirectory: config.journalDirectory,
        journal: config.journal,
        at: connection.now?.(),
        fetch: connection.fetch,
      });
      return {
        assessmentId,
        state: "published",
        disposition: "clean",
        outcome: receipt.outcome,
        specialist: false,
        evidence: "retained",
      };
    }
    let isolated: Awaited<ReturnType<typeof inspectIsolatedArtifacts>>;
    try {
      isolated = await inspectIsolatedArtifacts({
        connection,
        files: inputs.files,
        inspection,
      });
    } catch (error) {
      return retry(assessmentId, "isolated-execution", error);
    }
    const executionEvidenceSha256s = await Promise.all(
      isolated.reports.map(sha256Hex),
    );
    // One call for an inventory within the single-call envelope; otherwise
    // token-budgeted batches and a repository-level synthesis.
    const review = async (profile: ScannerProfile) =>
      (
        await reviewInventory({
          inspection,
          profile,
          fetch: connection.fetch,
          batchTokens: config.review?.batchTokens,
          concurrency: config.review?.concurrency,
          cache: config.review?.cache,
        })
      ).evidence;
    // A failed review is a service failure, never an incomplete scan. A
    // batched review that ran out of its per-pass budget resumes next pass.
    const primary = await review(config.primary);
    if (primary === null)
      return { assessmentId, state: "retry", step: "review-batches" };
    if (primary.review.status !== "completed")
      return { assessmentId, state: "retry", step: "primary-review" };
    const runId = `scan_${(config.randomId ?? randomUUID)().replaceAll("-", "")}`;
    const queued = { ...assessment, repository: inputs.repository };
    const compose = (specialist: typeof primary | null) =>
      composeScanResult({
        queued,
        inspection,
        policyVersion: config.policyVersion,
        runId,
        startedAt,
        completedAt: now().toISOString(),
        primary,
        specialist,
        execution: isolated.execution,
        executionEvidenceSha256s,
        sourceInventorySha256,
      });
    let composed = compose(null);
    let specialist = false;
    if (composed.needsSpecialist) {
      const second = await review(config.specialist);
      if (second === null)
        return { assessmentId, state: "retry", step: "review-batches" };
      if (second.review.status !== "completed")
        return { assessmentId, state: "retry", step: "specialist-review" };
      composed = compose(second);
      specialist = true;
    }
    const bySha = new Map<string, ScanInputFile>();
    for (const file of inputs.files)
      bySha.set(await sha256Hex(file.bytes), file);
    const named = [
      ...composed.result.assessed.dependencyLocks.map((lock) => lock.sha256),
      ...composed.result.artifacts.map((artifact) => artifact.sha256),
    ];
    const retained = await retainEvidence(connection, assessmentId, runId, [
      {
        bytes: composed.report,
        kind: "trace",
        label: "Bounded scan report",
        contentType: "application/json",
      },
      {
        bytes: sourceInventory,
        kind: "manifest",
        label: "Acquired scan input inventory",
        contentType: "application/json",
      },
      {
        bytes: inspection.inventory,
        kind: "manifest",
        label: "Reviewed scan inventory",
        contentType: "application/json",
      },
      ...isolated.reports.map((bytes, index) => ({
        bytes,
        kind: "trace" as const,
        label: `Isolated artifact execution ${index + 1}`,
        contentType: "application/json",
      })),
      ...named.map((sha256) => {
        const file = bySha.get(sha256);
        if (!file) throw new Error("A named object was not acquired");
        return {
          bytes: file.bytes,
          kind: "artifact" as const,
          label: file.path,
          contentType: "application/octet-stream",
        };
      }),
    ]).catch(() => false);
    // The intake refuses a clean result without its evidence; retry it.
    if (!retained && composed.result.disposition === "clean")
      return { assessmentId, state: "retry", step: "evidence" };
    const body = JSON.stringify(composed.result);
    const receipt = await publishResult({
      origin: connection.origin,
      body,
      approvedSha256: await sha256Hex(encoder.encode(body)),
      signer: connection,
      journalDirectory: config.journalDirectory,
      journal: config.journal,
      at: connection.now?.(),
      fetch: connection.fetch,
    });
    return {
      assessmentId,
      state: "published",
      disposition: composed.result.disposition,
      outcome: receipt.outcome,
      specialist,
      evidence: retained ? "retained" : "failed",
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Lookup only the final inspected inventory, never a commit or path shortcut. */
async function reusableResult(
  config: ScanServiceConfig,
  assessment: QueuedAssessment,
  repository: string,
  inventorySha256: string,
): Promise<VettingScanResult | null> {
  const response = await signedRequest(
    config.connection,
    "POST",
    "/api/v1/vetting/reuse",
    encoder.encode(
      JSON.stringify({
        assessmentId: assessment.assessmentId,
        inputManifestSha256: inventorySha256,
        policyVersion: config.policyVersion,
      }),
    ),
    "application/json",
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Scan reuse lookup failed");
  }
  const value = (await readBoundedJson(
    response,
    // Transport adds a fixed schema/result wrapper; the result's own limit
    // remains the normal publication limit checked below.
    MAX_VETTING_RESULT_BYTES + 128,
    "scan reuse",
  )) as { schemaVersion?: unknown; result?: unknown };
  if (value?.schemaVersion !== "slop-vetting-reuse-v1")
    throw new Error("Invalid scan reuse response");
  if (value.result === null) return null;
  if (
    encoder.encode(JSON.stringify(value.result)).byteLength >
    MAX_VETTING_RESULT_BYTES
  )
    throw new Error("Scan reuse result exceeds the publication limit");
  const result = parseRecordedVettingResult(value.result);
  if (
    !isScanResult(result) ||
    result.disposition !== "clean" ||
    result.reusedAssessmentId === null ||
    result.assessmentId !== assessment.assessmentId ||
    result.projectId !== assessment.projectId ||
    result.revision !== assessment.revision ||
    result.manifestSha256 !== assessment.manifestSha256 ||
    result.assessed.repository.toLowerCase() !== repository.toLowerCase() ||
    result.assessed.commitSha !== assessment.commitSha ||
    result.assessed.templateSha256 !== assessment.templateSha256 ||
    scanSourceInventory(result) !== inventorySha256 ||
    result.policyVersion !== config.policyVersion ||
    recordedResultProblems(result).length > 0
  )
    throw new Error("Scan reuse response does not match the queued inventory");
  return result;
}

/** One scan pass. Assessments run one at a time, in queue order. */
export async function runScanPass(
  config: ScanServiceConfig,
): Promise<ScanPassReport> {
  // Before the queue or any provider is contacted.
  assertPinnedProfiles(config.primary, config.specialist);
  await mkdir(config.workDirectory, { recursive: true, mode: 0o700 });
  await mkdir(config.journalDirectory, { recursive: true, mode: 0o700 });
  const refreshed = await refresh(config.connection);
  const pending = await readPendingAssessments(config.connection);
  const assessments: AssessmentOutcome[] = [];
  const journal =
    config.journal ?? filePublicationJournal(config.journalDirectory);
  for (const assessment of pending) {
    if (await journal.has(assessment.assessmentId)) {
      assessments.push({
        assessmentId: assessment.assessmentId,
        state: "journaled",
      });
      continue;
    }
    assessments.push(await scanOne(config, assessment));
  }
  return { refreshed, assessments };
}

type ProfileConfig = Omit<ScannerProfile, "apiKey">;

/**
 * Reads the operator configuration: a private JSON file that names the
 * service origin, policy version, directories and both pinned profiles
 * without keys; the Ed25519 signing key as a JWK in
 * `SLOP_VETTING_SIGNING_JWK`; and the Surplus key in `SURPLUS_API_KEY`.
 */
export async function serviceConfigFrom(
  path: string,
  env: Record<string, string | undefined>,
): Promise<ScanServiceConfig> {
  const file = JSON.parse(await readFile(path, "utf8")) as {
    origin: string;
    policyVersion: string;
    workDirectory: string;
    journalDirectory: string;
    primary: ProfileConfig;
    specialist: ProfileConfig;
  };
  const apiKey = env.SURPLUS_API_KEY?.trim();
  const jwk = env.SLOP_VETTING_SIGNING_JWK;
  if (!apiKey || !jwk)
    throw new Error(
      "SURPLUS_API_KEY and SLOP_VETTING_SIGNING_JWK are required",
    );
  const { privateKey, publicKey } = await vettingServiceSigner(jwk);
  const primary = { ...file.primary, apiKey };
  const specialist = { ...file.specialist, apiKey };
  assertPinnedProfiles(primary, specialist);
  return {
    connection: { origin: file.origin, privateKey, publicKey },
    githubToken: env.GITHUB_TOKEN,
    primary,
    specialist,
    policyVersion: file.policyVersion,
    workDirectory: file.workDirectory,
    journalDirectory: file.journalDirectory,
  };
}

if (import.meta.main) {
  const [configPath, mode, seconds] = process.argv.slice(2);
  if (!configPath || (mode !== undefined && mode !== "--every"))
    throw new Error(
      "Usage: bun workers/vetting/run.ts CONFIG.json [--every SECONDS]",
    );
  const interval = mode === "--every" ? Number(seconds) : 0;
  if (mode === "--every" && (!Number.isSafeInteger(interval) || interval < 60))
    throw new Error("--every needs a whole number of seconds, at least 60");
  const config = await serviceConfigFrom(configPath, process.env);
  do {
    try {
      // Safe identities and states only: no source, prompt or key.
      console.log(JSON.stringify(await runScanPass(config)));
    } catch {
      console.error("Scan pass failed; pending assessments stay queued.");
      process.exitCode = 1;
    }
    if (interval > 0) await Bun.sleep(interval * 1000);
  } while (interval > 0);
}
