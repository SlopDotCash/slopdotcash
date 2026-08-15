/**
 * Defines the public, device-signed project-run receipt embedded in a GitHub
 * contribution footer. The receipt proves stable bytes and device continuity;
 * its local usage figures remain supporting evidence rather than provider proof.
 */

import {
  findProject,
  findProjectByRepositoryId,
  type ProjectId,
} from "./projects.mjs";
import type { RepositoryId } from "./repositories.mjs";

export const RUN_RECEIPT_SCHEMA_VERSION = "1" as const;
export const RUN_MARKER_VERSION = "v1" as const;
export const RUN_MARKER_NAME = "slop-contribution-attribution" as const;

const RUN_ID_PATTERN = /^run_[0-9A-HJKMNP-TV-Z]{26}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const FULL_SKILL_REVISION_PATTERN =
  /^[a-z0-9_.-]+\/[a-z0-9_.-]+@[0-9a-f]{40}:[^\s`]+$/iu;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export type UsageConfidence = "bounded" | "exact" | "unavailable";

export interface ProjectRunUsage {
  source: "ccusage-session-v20" | "none";
  confidence: UsageConfidence;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costMicroUsd: string;
  sessionCount: number;
}

export interface ProjectRunReceipt {
  schemaVersion: typeof RUN_RECEIPT_SCHEMA_VERSION;
  runId: string;
  projectId: ProjectId;
  repositoryId: RepositoryId;
  startedAt: string;
  completedAt: string;
  provider: string;
  model: string;
  client: string;
  skillRevision: string;
  skillSha256: string;
  usage: ProjectRunUsage;
  trajectorySha256: string | null;
  traceUpload: {
    authority: "https://api.slop.cash";
    serverRunId: string;
    objectId: string;
    sha256: string;
  } | null;
  signatureAlgorithm: "ed25519";
  devicePublicKey: string;
  deviceKeyId: string;
  deviceSignature: string;
}

export interface RunReceiptMarker {
  provider: string;
  model: string;
  client: ProjectRunReceipt["client"];
  skill_revision: string;
  run: {
    schema_version: typeof RUN_RECEIPT_SCHEMA_VERSION;
    run_id: string;
    project: ProjectId;
    repository: RepositoryId;
    started_at: string;
    completed_at: string;
    skill_sha256: string;
    usage: {
      source: ProjectRunUsage["source"];
      confidence: UsageConfidence;
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
      total_tokens: number;
      cost_micro_usd: string;
      session_count: number;
    };
    trajectory_sha256: string | null;
    trace_upload?: {
      authority: "https://api.slop.cash";
      server_run_id: string;
      object_id: string;
      sha256: string;
    };
    signature_algorithm: "ed25519";
    device_public_key: string;
    device_key_id: string;
    device_signature: string;
  };
}

/** Validates the camel-case receipt shape published in leaderboard snapshots. */
export function assertProjectRunReceipt(value: unknown): ProjectRunReceipt {
  if (!isRecord(value)) throw new TypeError("run receipt must be an object");
  const hasTraceUpload = Object.hasOwn(value, "traceUpload");
  exactKeys(
    value,
    [
      "client",
      "completedAt",
      "deviceKeyId",
      "devicePublicKey",
      "deviceSignature",
      "model",
      "projectId",
      "provider",
      "repositoryId",
      "runId",
      "schemaVersion",
      "signatureAlgorithm",
      "skillRevision",
      "skillSha256",
      "startedAt",
      "trajectorySha256",
      ...(hasTraceUpload ? ["traceUpload"] : []),
      "usage",
    ],
    "run receipt",
  );
  if (!isRecord(value.usage))
    throw new TypeError("run receipt.usage must be an object");
  exactKeys(
    value.usage,
    [
      "cacheCreationTokens",
      "cacheReadTokens",
      "confidence",
      "costMicroUsd",
      "inputTokens",
      "outputTokens",
      "sessionCount",
      "source",
      "totalTokens",
    ],
    "run receipt.usage",
  );
  return assertRunReceiptMarker({
    provider: value.provider,
    model: value.model,
    client: value.client,
    skill_revision: value.skillRevision,
    run: {
      schema_version: value.schemaVersion,
      run_id: value.runId,
      project: value.projectId,
      repository: value.repositoryId,
      started_at: value.startedAt,
      completed_at: value.completedAt,
      skill_sha256: value.skillSha256,
      usage: {
        source: value.usage.source,
        confidence: value.usage.confidence,
        input_tokens: value.usage.inputTokens,
        output_tokens: value.usage.outputTokens,
        cache_creation_tokens: value.usage.cacheCreationTokens,
        cache_read_tokens: value.usage.cacheReadTokens,
        total_tokens: value.usage.totalTokens,
        cost_micro_usd: value.usage.costMicroUsd,
        session_count: value.usage.sessionCount,
      },
      trajectory_sha256: value.trajectorySha256,
      ...(hasTraceUpload && isRecord(value.traceUpload)
        ? {
            trace_upload: {
              authority: value.traceUpload.authority,
              server_run_id: value.traceUpload.serverRunId,
              object_id: value.traceUpload.objectId,
              sha256: value.traceUpload.sha256,
            },
          }
        : {}),
      signature_algorithm: value.signatureAlgorithm,
      device_public_key: value.devicePublicKey,
      device_key_id: value.deviceKeyId,
      device_signature: value.deviceSignature,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.join("\0") !== canonical.join("\0")) {
    throw new TypeError(`${path} has unexpected or missing fields`);
  }
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`);
  }
  return Number(value);
}

function isoTimestamp(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError(`${path} must be a canonical UTC ISO timestamp`);
  }
  return value;
}

function identifier(value: unknown, path: string, maxLength = 128): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength ||
    /^n\/a$/iu.test(value) ||
    !/^[a-z0-9][a-z0-9._:/+-]*$/iu.test(value)
  ) {
    throw new TypeError(`${path} must be a concrete identifier`);
  }
  return value;
}

function digest(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function optionalDigest(value: unknown, path: string): string | null {
  return value === null ? null : digest(value, path);
}

function base64url(
  value: unknown,
  path: string,
  minimumLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < minimumLength ||
    value.length > 4096 ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new TypeError(`${path} must be unpadded base64url`);
  }
  return value;
}

function minorUnits(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new TypeError(`${path} must be canonical integer minor units`);
  }
  BigInt(value);
  return value;
}

/** Converts the compact GitHub marker payload into the canonical receipt. */
export function assertRunReceiptMarker(value: unknown): ProjectRunReceipt {
  if (!isRecord(value)) throw new TypeError("run marker must be an object");
  exactKeys(
    value,
    ["client", "model", "provider", "run", "skill_revision"],
    "run marker",
  );
  if (!isRecord(value.run))
    throw new TypeError("run marker.run must be an object");
  const hasTraceUpload = Object.hasOwn(value.run, "trace_upload");
  exactKeys(
    value.run,
    [
      "completed_at",
      "device_key_id",
      "device_public_key",
      "device_signature",
      "project",
      "repository",
      "run_id",
      "schema_version",
      "signature_algorithm",
      "skill_sha256",
      "started_at",
      "trajectory_sha256",
      ...(hasTraceUpload ? ["trace_upload"] : []),
      "usage",
    ],
    "run marker.run",
  );
  if (!isRecord(value.run.usage)) {
    throw new TypeError("run marker.run.usage must be an object");
  }
  exactKeys(
    value.run.usage,
    [
      "cache_creation_tokens",
      "cache_read_tokens",
      "confidence",
      "cost_micro_usd",
      "input_tokens",
      "output_tokens",
      "session_count",
      "source",
      "total_tokens",
    ],
    "run marker.run.usage",
  );

  const project =
    typeof value.run.project === "string"
      ? findProject(value.run.project)
      : null;
  if (!project) throw new TypeError("run marker project is not registered");
  const repositoryProject =
    typeof value.run.repository === "string"
      ? findProjectByRepositoryId(value.run.repository)
      : null;
  if (!repositoryProject || repositoryProject.id !== project.id) {
    throw new TypeError("run marker repository does not belong to the project");
  }
  if (value.run.schema_version !== RUN_RECEIPT_SCHEMA_VERSION) {
    throw new TypeError("run marker schema_version is unsupported");
  }
  if (
    typeof value.run.run_id !== "string" ||
    !RUN_ID_PATTERN.test(value.run.run_id)
  ) {
    throw new TypeError("run marker run_id is invalid");
  }
  const startedAt = isoTimestamp(value.run.started_at, "run marker.started_at");
  const completedAt = isoTimestamp(
    value.run.completed_at,
    "run marker.completed_at",
  );
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new TypeError("run marker completed_at precedes started_at");
  }
  const client = identifier(value.client, "run marker.client", 64);
  const provider = identifier(value.provider, "run marker.provider", 64);
  const model = identifier(value.model, "run marker.model");
  if (
    typeof value.skill_revision !== "string" ||
    !FULL_SKILL_REVISION_PATTERN.test(value.skill_revision) ||
    !value.skill_revision.endsWith(`:${project.skill.sourcePath}`)
  ) {
    throw new TypeError("run marker skill_revision is not the project skill");
  }
  if (
    value.run.usage.source !== "ccusage-session-v20" &&
    value.run.usage.source !== "none"
  ) {
    throw new TypeError("run marker usage source is unsupported");
  }
  const confidence = value.run.usage.confidence;
  if (
    !(["bounded", "exact", "unavailable"] as const).includes(
      confidence as UsageConfidence,
    )
  ) {
    throw new TypeError("run marker usage confidence is invalid");
  }
  if (value.run.signature_algorithm !== "ed25519") {
    throw new TypeError("run marker signature algorithm is unsupported");
  }
  const usage: ProjectRunUsage = {
    source: value.run.usage.source,
    confidence: confidence as UsageConfidence,
    inputTokens: nonNegativeInteger(
      value.run.usage.input_tokens,
      "run marker.usage.input_tokens",
    ),
    outputTokens: nonNegativeInteger(
      value.run.usage.output_tokens,
      "run marker.usage.output_tokens",
    ),
    cacheCreationTokens: nonNegativeInteger(
      value.run.usage.cache_creation_tokens,
      "run marker.usage.cache_creation_tokens",
    ),
    cacheReadTokens: nonNegativeInteger(
      value.run.usage.cache_read_tokens,
      "run marker.usage.cache_read_tokens",
    ),
    totalTokens: nonNegativeInteger(
      value.run.usage.total_tokens,
      "run marker.usage.total_tokens",
    ),
    costMicroUsd: minorUnits(
      value.run.usage.cost_micro_usd,
      "run marker.usage.cost_micro_usd",
    ),
    sessionCount: nonNegativeInteger(
      value.run.usage.session_count,
      "run marker.usage.session_count",
    ),
  };
  if (usage.confidence === "unavailable") {
    if (
      usage.inputTokens !== 0 ||
      usage.outputTokens !== 0 ||
      usage.cacheCreationTokens !== 0 ||
      usage.cacheReadTokens !== 0 ||
      usage.totalTokens !== 0 ||
      usage.costMicroUsd !== "0" ||
      usage.sessionCount !== 0
    ) {
      throw new TypeError("unavailable usage must contain zero values");
    }
  } else if (
    usage.source !== "ccusage-session-v20" ||
    usage.totalTokens === 0 ||
    usage.sessionCount === 0
  ) {
    throw new TypeError("available usage must contain tokens and sessions");
  }
  if (usage.source === "none" && usage.confidence !== "unavailable") {
    throw new TypeError("usage without an adapter must be unavailable");
  }

  const trajectorySha256 = optionalDigest(
    value.run.trajectory_sha256,
    "run marker.trajectory_sha256",
  );
  let traceUpload: ProjectRunReceipt["traceUpload"] = null;
  if (hasTraceUpload) {
    if (!isRecord(value.run.trace_upload)) {
      throw new TypeError("run marker.trace_upload must be an object");
    }
    exactKeys(
      value.run.trace_upload,
      ["authority", "object_id", "server_run_id", "sha256"],
      "run marker.trace_upload",
    );
    const sha256 = digest(
      value.run.trace_upload.sha256,
      "run marker.trace_upload.sha256",
    );
    const serverRunId = identifier(
      value.run.trace_upload.server_run_id,
      "run marker.trace_upload.server_run_id",
      160,
    );
    if (
      value.run.trace_upload.authority !== "https://api.slop.cash" ||
      value.run.trace_upload.object_id !== `sha256:${sha256}` ||
      trajectorySha256 !== sha256
    ) {
      throw new TypeError("run marker trace upload evidence does not match");
    }
    traceUpload = {
      authority: "https://api.slop.cash",
      serverRunId,
      objectId: value.run.trace_upload.object_id,
      sha256,
    };
  }

  return {
    schemaVersion: RUN_RECEIPT_SCHEMA_VERSION,
    runId: value.run.run_id,
    projectId: project.id,
    repositoryId: value.run.repository as RepositoryId,
    startedAt,
    completedAt,
    provider,
    model,
    client,
    skillRevision: value.skill_revision,
    skillSha256: digest(value.run.skill_sha256, "run marker.skill_sha256"),
    usage,
    trajectorySha256,
    traceUpload,
    signatureAlgorithm: "ed25519",
    devicePublicKey: base64url(
      value.run.device_public_key,
      "run marker.device_public_key",
      40,
    ),
    deviceKeyId: digest(value.run.device_key_id, "run marker.device_key_id"),
    deviceSignature: base64url(
      value.run.device_signature,
      "run marker.device_signature",
      64,
    ),
  };
}

/** Builds the exact marker object from a validated receipt. */
export function runReceiptMarker(receipt: ProjectRunReceipt): RunReceiptMarker {
  const project = findProject(receipt.projectId);
  if (!project) throw new TypeError("receipt project is not registered");
  return {
    provider: receipt.provider,
    model: receipt.model,
    client: receipt.client,
    skill_revision: receipt.skillRevision,
    run: {
      schema_version: RUN_RECEIPT_SCHEMA_VERSION,
      run_id: receipt.runId,
      project: receipt.projectId,
      repository: receipt.repositoryId,
      started_at: receipt.startedAt,
      completed_at: receipt.completedAt,
      skill_sha256: receipt.skillSha256,
      usage: {
        source: receipt.usage.source,
        confidence: receipt.usage.confidence,
        input_tokens: receipt.usage.inputTokens,
        output_tokens: receipt.usage.outputTokens,
        cache_creation_tokens: receipt.usage.cacheCreationTokens,
        cache_read_tokens: receipt.usage.cacheReadTokens,
        total_tokens: receipt.usage.totalTokens,
        cost_micro_usd: receipt.usage.costMicroUsd,
        session_count: receipt.usage.sessionCount,
      },
      trajectory_sha256: receipt.trajectorySha256,
      ...(receipt.traceUpload
        ? {
            trace_upload: {
              authority: receipt.traceUpload.authority,
              server_run_id: receipt.traceUpload.serverRunId,
              object_id: receipt.traceUpload.objectId,
              sha256: receipt.traceUpload.sha256,
            },
          }
        : {}),
      signature_algorithm: receipt.signatureAlgorithm,
      device_public_key: receipt.devicePublicKey,
      device_key_id: receipt.deviceKeyId,
      device_signature: receipt.deviceSignature,
    },
  };
}

/** Returns the stable bytes signed by the receipt device key. */
export function runReceiptSigningPayload(receipt: ProjectRunReceipt): string {
  const marker = runReceiptMarker(receipt);
  const { device_signature: _signature, ...unsignedRun } = marker.run;
  return JSON.stringify({
    provider: marker.provider,
    model: marker.model,
    client: marker.client,
    skill_revision: marker.skill_revision,
    run: unsignedRun,
  });
}

/** Serializes the machine marker that must remain the final source line. */
export function serializeRunMarker(receipt: ProjectRunReceipt): string {
  return `<!-- ${RUN_MARKER_NAME}:${RUN_MARKER_VERSION} ${JSON.stringify(runReceiptMarker(receipt))} -->`;
}

/** Parses one current Slop marker or an immutable pre-activation marker. */
export function parseRunMarker(line: string): ProjectRunReceipt {
  const match = line
    .trim()
    .match(
      /^<!--\s*(?:slop-contribution-attribution:v1|elizaos-contribution-attribution:v2)\s+([\s\S]+?)\s*-->$/u,
    );
  if (!match) throw new TypeError("run marker line is malformed");
  let payload: unknown;
  try {
    payload = JSON.parse(match[1]);
  } catch (cause) {
    throw new TypeError("run marker JSON is malformed", { cause });
  }
  return assertRunReceiptMarker(payload);
}
