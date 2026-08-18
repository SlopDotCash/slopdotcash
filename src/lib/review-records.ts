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
  schemaVersion: "2";
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
  splitRisk: "none" | "suspected" | "confirmed";
  effortBand: "micro" | "small" | "medium" | "large" | "xl" | "exceptional";
  complexity: "low" | "moderate" | "high" | "specialist";
  impact: "narrow" | "meaningful" | "broad" | "critical";
  reviewLoad: "triage" | "standard" | "deep" | "specialist";
  recommendedTier:
    | "micro"
    | "small"
    | "medium"
    | "large"
    | "xl"
    | "exceptional";
  recommendedThirds: 1 | 3 | 9 | 24 | 45 | 75;
  workUnitId: string;
  confidenceBasisPoints: number;
  valueRationale: string;
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
  const v1Expected = [
    "artifactUrl",
    "commands",
    "duplicateRisk",
    "evidenceUrls",
    "headSha",
    "projectId",
    "recommendation",
    "reproduced",
    "schemaVersion",
    "securityRisk",
    "summary",
    "usefulArtifacts",
  ].sort();
  const expected = [
    "artifactUrl",
    "client",
    "commands",
    "duplicateRisk",
    "splitRisk",
    "effortBand",
    "complexity",
    "impact",
    "reviewLoad",
    "recommendedTier",
    "recommendedThirds",
    "workUnitId",
    "confidenceBasisPoints",
    "valueRationale",
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
  const legacy = value.schemaVersion === "1";
  const actualKeys = Object.keys(value).sort();
  if (
    (legacy && v1Expected.some((key) => !actualKeys.includes(key))) ||
    (!legacy && actualKeys.join("\0") !== expected.join("\0"))
  ) {
    throw new TypeError(
      `review record has unexpected or missing fields: ${actualKeys.join(",")}`,
    );
  }
  if (value.schemaVersion !== "2" && !legacy) {
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
  if (
    (!legacy || value.provider !== undefined) &&
    !isExactProviderIdentifier(value.provider)
  ) {
    throw new TypeError("review record provider is not exact");
  }
  if (
    (!legacy || value.model !== undefined) &&
    !isExactModelIdentifier(value.model)
  ) {
    throw new TypeError("review record model is not exact");
  }
  if (
    (!legacy || value.client !== undefined) &&
    !isExactClientIdentifier(value.client)
  ) {
    throw new TypeError("review record client is not exact");
  }
  if (
    typeof value.headSha !== "string" ||
    !GIT_SHA_PATTERN.test(value.headSha)
  ) {
    throw new TypeError("review record headSha is invalid");
  }
  if (
    (!legacy || value.runId !== undefined) &&
    (typeof value.runId !== "string" || !RUN_ID_PATTERN.test(value.runId))
  ) {
    throw new TypeError("review record runId is invalid");
  }
  if (
    ((!legacy || value.traceSha256 !== undefined) &&
      typeof value.traceSha256 !== "string") ||
    ((!legacy || value.traceSha256 !== undefined) &&
      !SHA256_PATTERN.test(String(value.traceSha256)))
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
    !legacy &&
    !(["none", "suspected", "confirmed"] as const).includes(
      value.splitRisk as never,
    )
  ) {
    throw new TypeError("review record splitRisk is invalid");
  }
  const tiers = [
    "micro",
    "small",
    "medium",
    "large",
    "xl",
    "exceptional",
  ] as const;
  if (
    !legacy &&
    (!tiers.includes(value.effortBand as never) ||
      !tiers.includes(value.recommendedTier as never))
  ) {
    throw new TypeError("review record effort tier is invalid");
  }
  const tierThirds = {
    micro: 1,
    small: 3,
    medium: 9,
    large: 24,
    xl: 45,
    exceptional: 75,
  } as const;
  if (
    !legacy &&
    value.recommendedThirds !==
      tierThirds[value.recommendedTier as keyof typeof tierThirds]
  ) {
    throw new TypeError(
      "review record recommendedThirds does not match its tier",
    );
  }
  if (
    !legacy &&
    !(["low", "moderate", "high", "specialist"] as const).includes(
      value.complexity as never,
    )
  ) {
    throw new TypeError("review record complexity is invalid");
  }
  if (
    !legacy &&
    !(["narrow", "meaningful", "broad", "critical"] as const).includes(
      value.impact as never,
    )
  ) {
    throw new TypeError("review record impact is invalid");
  }
  if (
    !legacy &&
    !(["triage", "standard", "deep", "specialist"] as const).includes(
      value.reviewLoad as never,
    )
  ) {
    throw new TypeError("review record reviewLoad is invalid");
  }
  if (
    !legacy &&
    (typeof value.workUnitId !== "string" ||
      !/^wu_[a-z0-9][a-z0-9_-]{2,127}$/u.test(value.workUnitId))
  ) {
    throw new TypeError("review record workUnitId is invalid");
  }
  if (
    !legacy &&
    (!Number.isSafeInteger(value.confidenceBasisPoints) ||
      Number(value.confidenceBasisPoints) < 0 ||
      Number(value.confidenceBasisPoints) > 10_000)
  ) {
    throw new TypeError("review record confidenceBasisPoints is invalid");
  }
  if (
    !legacy &&
    (typeof value.valueRationale !== "string" ||
      value.valueRationale.length < 12 ||
      value.valueRationale.length > 4096)
  ) {
    throw new TypeError("review record valueRationale is invalid");
  }
  if (
    typeof value.summary !== "string" ||
    value.summary.length < 1 ||
    value.summary.length > 4096
  ) {
    throw new TypeError("review record summary is invalid");
  }
  return {
    schemaVersion: "2",
    projectId: project.id,
    artifactUrl: artifact.href,
    headSha: value.headSha,
    provider: typeof value.provider === "string" ? value.provider : "",
    model: typeof value.model === "string" ? value.model : "",
    client: typeof value.client === "string" ? value.client : "",
    runId: typeof value.runId === "string" ? value.runId : "",
    traceSha256: typeof value.traceSha256 === "string" ? value.traceSha256 : "",
    recommendation: value.recommendation as ReviewRecord["recommendation"],
    reproduced: value.reproduced,
    securityRisk: value.securityRisk as ReviewRecord["securityRisk"],
    duplicateRisk: value.duplicateRisk as ReviewRecord["duplicateRisk"],
    splitRisk: legacy ? "none" : (value.splitRisk as ReviewRecord["splitRisk"]),
    effortBand: legacy
      ? "small"
      : (value.effortBand as ReviewRecord["effortBand"]),
    complexity: legacy
      ? "moderate"
      : (value.complexity as ReviewRecord["complexity"]),
    impact: legacy ? "meaningful" : (value.impact as ReviewRecord["impact"]),
    reviewLoad: legacy
      ? "standard"
      : (value.reviewLoad as ReviewRecord["reviewLoad"]),
    recommendedTier: legacy
      ? "small"
      : (value.recommendedTier as ReviewRecord["recommendedTier"]),
    recommendedThirds: legacy
      ? 3
      : (value.recommendedThirds as ReviewRecord["recommendedThirds"]),
    workUnitId: legacy
      ? `wu_${project.id}_legacy_${String(value.runId ?? artifact.pathname)
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/gu, "_")}`
      : String(value.workUnitId),
    confidenceBasisPoints: legacy ? 5000 : Number(value.confidenceBasisPoints),
    valueRationale: legacy
      ? String(value.summary)
      : String(value.valueRationale),
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
    (record.runId !== "" && record.runId !== receipt.runId) ||
    (record.traceSha256 !== "" &&
      record.traceSha256 !== receipt.traceUpload.sha256) ||
    (record.provider !== "" && record.provider !== receipt.provider) ||
    (record.model !== "" && record.model !== receipt.model) ||
    (record.client !== "" && record.client !== receipt.client)
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
  return {
    ...record,
    provider: receipt.provider,
    model: receipt.model,
    client: receipt.client,
    runId: receipt.runId,
    traceSha256: receipt.traceUpload.sha256,
  };
}
