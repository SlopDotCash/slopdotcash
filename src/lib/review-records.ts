import {
  isExactClientIdentifier,
  isExactModelIdentifier,
  isExactProviderIdentifier,
} from "./model-identity";
import { findProject, type ProjectId } from "./projects.mjs";
import type { ProjectRunReceipt } from "./run-receipts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const RUN_ID_PATTERN = /^run_[0-9A-HJKMNP-TV-Z]{26}$/u;

export interface ReviewRecord {
  schemaVersion: "1";
  projectId: ProjectId;
  artifactUrl: string;
  headSha: string;
  provider: string;
  model: string;
  client: string;
  runId: string;
  traceSha256: string;
  recommendation: "accept" | "partial" | "reject" | "hold";
  reproduced: boolean;
  securityRisk: "none" | "suspected" | "confirmed";
  duplicateRisk: "none" | "suspected" | "confirmed";
  usefulArtifacts: string[];
  commands: string[];
  evidenceUrls: string[];
  summary: string;
}

export interface ReviewRecordContext {
  artifactUrl: string;
  headSha: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedStrings(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 64 ||
    value.some(
      (item) =>
        typeof item !== "string" || item.length < 1 || item.length > 2048,
    )
  ) {
    throw new TypeError(`${field} must be a bounded string array`);
  }
  return [...value] as string[];
}

/** Validates the exact machine record emitted by project reviewer skills. */
export function assertReviewRecord(value: unknown): ReviewRecord {
  if (!isRecord(value)) throw new TypeError("review record must be an object");
  const expected = [
    "artifactUrl",
    "client",
    "commands",
    "duplicateRisk",
    "evidenceUrls",
    "headSha",
    "model",
    "projectId",
    "provider",
    "recommendation",
    "reproduced",
    "runId",
    "schemaVersion",
    "securityRisk",
    "summary",
    "traceSha256",
    "usefulArtifacts",
  ].sort();
  if (Object.keys(value).sort().join("\0") !== expected.join("\0")) {
    throw new TypeError("review record has unexpected or missing fields");
  }
  if (value.schemaVersion !== "1") {
    throw new TypeError("review record schemaVersion is unsupported");
  }
  const project =
    typeof value.projectId === "string" ? findProject(value.projectId) : null;
  if (!project) throw new TypeError("review record project is not registered");
  let artifact: URL;
  try {
    artifact = new URL(String(value.artifactUrl));
  } catch {
    throw new TypeError("review record artifactUrl is invalid");
  }
  if (
    artifact.protocol !== "https:" ||
    artifact.hostname !== "github.com" ||
    !project.repositories.some(({ githubUrl }) =>
      artifact.href.startsWith(`${githubUrl}/`),
    )
  ) {
    throw new TypeError("review record artifactUrl is outside the project");
  }
  if (!isExactProviderIdentifier(value.provider)) {
    throw new TypeError("review record provider is not exact");
  }
  if (!isExactModelIdentifier(value.model)) {
    throw new TypeError("review record model is not exact");
  }
  if (!isExactClientIdentifier(value.client)) {
    throw new TypeError("review record client is not exact");
  }
  if (
    typeof value.headSha !== "string" ||
    !GIT_SHA_PATTERN.test(value.headSha)
  ) {
    throw new TypeError("review record headSha is invalid");
  }
  if (typeof value.runId !== "string" || !RUN_ID_PATTERN.test(value.runId)) {
    throw new TypeError("review record runId is invalid");
  }
  if (
    typeof value.traceSha256 !== "string" ||
    !SHA256_PATTERN.test(value.traceSha256)
  ) {
    throw new TypeError("review record traceSha256 is invalid");
  }
  if (
    !(["accept", "partial", "reject", "hold"] as const).includes(
      value.recommendation as never,
    )
  ) {
    throw new TypeError("review record recommendation is invalid");
  }
  if (typeof value.reproduced !== "boolean") {
    throw new TypeError("review record reproduced must be boolean");
  }
  for (const field of ["securityRisk", "duplicateRisk"] as const) {
    if (
      !(["none", "suspected", "confirmed"] as const).includes(
        value[field] as never,
      )
    ) {
      throw new TypeError(`review record ${field} is invalid`);
    }
  }
  if (
    typeof value.summary !== "string" ||
    value.summary.length < 1 ||
    value.summary.length > 4096
  ) {
    throw new TypeError("review record summary is invalid");
  }
  return {
    schemaVersion: "1",
    projectId: project.id,
    artifactUrl: artifact.href,
    headSha: value.headSha,
    provider: value.provider,
    model: value.model,
    client: value.client,
    runId: value.runId,
    traceSha256: value.traceSha256,
    recommendation: value.recommendation as ReviewRecord["recommendation"],
    reproduced: value.reproduced,
    securityRisk: value.securityRisk as ReviewRecord["securityRisk"],
    duplicateRisk: value.duplicateRisk as ReviewRecord["duplicateRisk"],
    usefulArtifacts: boundedStrings(value.usefulArtifacts, "usefulArtifacts"),
    commands: boundedStrings(value.commands, "commands"),
    evidenceUrls: boundedStrings(value.evidenceUrls, "evidenceUrls"),
    summary: value.summary,
  };
}

/** Parses at most one unquoted, one-line fenced review record from a source. */
export function parseReviewRecordBlock(body: string): unknown | null {
  const matches = [
    ...body.matchAll(
      /^ {0,3}```slop-review[\t ]*\r?\n([^\r\n]{1,32768})\r?\n {0,3}```[\t ]*$/gmu,
    ),
  ];
  if (matches.length > 1) {
    throw new TypeError("source must contain at most one slop-review record");
  }
  if (matches.length === 0) return null;
  try {
    return JSON.parse(matches[0][1]);
  } catch {
    throw new TypeError("slop-review record JSON is malformed");
  }
}

/** Joins a review record to its terminal finalized run receipt and PR head. */
export function assertReviewRecordReceiptJoin(
  value: unknown,
  receipt: ProjectRunReceipt | null,
  context: ReviewRecordContext | null,
): ReviewRecord {
  const record = assertReviewRecord(value);
  if (receipt === null) {
    throw new TypeError("slop-review requires a terminal signed run receipt");
  }
  if (receipt.traceUpload === null) {
    throw new TypeError(
      "slop-review receipt requires finalized private trace upload evidence",
    );
  }
  if (
    record.projectId !== receipt.projectId ||
    record.runId !== receipt.runId ||
    record.traceSha256 !== receipt.traceUpload.sha256 ||
    record.provider !== receipt.provider ||
    record.model !== receipt.model ||
    record.client !== receipt.client
  ) {
    throw new TypeError("slop-review record does not match its run receipt");
  }
  if (context === null) {
    throw new TypeError("slop-review record lacks immutable artifact context");
  }
  const artifactUrl = new URL(context.artifactUrl).href;
  if (
    record.artifactUrl !== artifactUrl ||
    record.headSha !== context.headSha.toLowerCase()
  ) {
    throw new TypeError("slop-review record does not match its artifact head");
  }
  return record;
}
