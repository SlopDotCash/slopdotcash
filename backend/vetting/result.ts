/**
 * The strict contract for a result the external secure-VM vetting service
 * signs (PRD VET-02 to VET-06), and the disposition rules the API enforces.
 * The API never upgrades a result: a claimed "clean" that lacks complete
 * telemetry, both model reviews, or released artifacts is refused, and
 * "malicious" needs concrete confirmation evidence, not a model label.
 */

import {
  VETTING_DISPOSITIONS,
  type VettingDisposition,
} from "../../src/lib/vetting-contracts";
import { PROJECT_ID } from "../http";
import { validIsoTimestamp, validSha256 } from "../trace/validation";

const VETTING_RESULT_SCHEMA = "slop-vetting-result-v1";
/** Results carry summaries and digests; the full trace stays with the VM operator. */
export const MAX_VETTING_RESULT_BYTES = 256 * 1024;

export {
  VETTING_DISPOSITIONS,
  type VettingDisposition,
} from "../../src/lib/vetting-contracts";

/** Telemetry channels VET-03 requires; each must be complete for "clean". */
export const TELEMETRY_CHANNELS = [
  "process",
  "file",
  "memoryMap",
  "blockDevice",
  "privilege",
  "dynamicLoading",
  "dns",
  "network",
  "http",
  "artifactDiff",
  "canary",
] as const;
type TelemetryChannel = (typeof TELEMETRY_CHANNELS)[number];
const COVERAGE = ["complete", "partial", "missing"] as const;

export const ARTIFACT_TYPES = [
  "binary",
  "archive",
  "obfuscated-script",
  "native-module",
  "wasm",
  "bytecode",
  "second-stage",
  "other",
] as const;
export const ARTIFACT_STATES = ["quarantined", "released", "blocked"] as const;
export const ARTIFACT_ANALYSES = [
  "pending",
  "static-clean",
  "detonation-clean",
  "suspicious",
  "malicious",
] as const;
const REVIEWERS = ["astra", "opus"] as const;
export const REVIEW_STATUSES = ["completed", "unavailable", "failed"] as const;
export const REVIEW_VERDICTS = [
  "no-findings",
  "findings",
  "malicious-suspected",
] as const;
export const SEVERITIES = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
] as const;
export const CONFIRMATION_BASES = [
  "reproducible-behavior",
  "verified-source-evidence",
] as const;

export type VettingArtifact = {
  sha256: string;
  parentSha256: string | null;
  origin: string;
  path: string;
  type: (typeof ARTIFACT_TYPES)[number];
  state: (typeof ARTIFACT_STATES)[number];
  analysis: (typeof ARTIFACT_ANALYSES)[number];
  requestedExecution: boolean;
};

export type ModelReview = {
  reviewer: (typeof REVIEWERS)[number];
  provider: string;
  model: string;
  promptPolicyRevision: string;
  inputManifestSha256: string;
  runId: string;
  status: (typeof REVIEW_STATUSES)[number];
  verdict: (typeof REVIEW_VERDICTS)[number] | null;
  findingCount: number;
};

export type VettingResult = {
  schemaVersion: typeof VETTING_RESULT_SCHEMA;
  assessmentId: string;
  projectId: string;
  revision: number;
  manifestSha256: string;
  disposition: VettingDisposition;
  policyVersion: string;
  assessed: {
    repository: string;
    commitSha: string;
    templateSha256: string;
    inputManifestSha256: string;
    dependencyLocks: { path: string; sha256: string }[];
  };
  environment: {
    vmProvider: string;
    isolation: "hardware-vm" | "microvm";
    imageSha256: string;
    collectorId: string;
    runId: string;
    startedAt: string;
    completedAt: string;
  };
  telemetry: {
    coverage: Record<TelemetryChannel, (typeof COVERAGE)[number]>;
    visibilityGaps: string[];
    tamperDetected: boolean;
    canaryAccessAttempts: number;
    egress: "default-deny";
  };
  traceSha256: string;
  modelReviews: ModelReview[];
  artifacts: VettingArtifact[];
  findings: {
    severity: (typeof SEVERITIES)[number];
    category: string;
    summary: string;
    evidence: string;
  }[];
  confirmation: {
    basis: (typeof CONFIRMATION_BASES)[number];
    rule: string;
    evidence: string[];
  } | null;
};

export class VettingResultError extends Error {
  readonly status = 422;
  readonly code = "invalid_vetting_result";
}

// Exact field readers shared by the v1 and v2 result parsers.
export function reject(message: string): never {
  throw new VettingResultError(message);
}

type Shape = Record<string, unknown>;

export function object(
  value: unknown,
  name: string,
  keys: readonly string[],
): Shape {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    reject(`${name} must be an object`);
  const record = value as Shape;
  const allowed = new Set(keys);
  for (const key of Object.keys(record))
    if (!allowed.has(key)) reject(`${name}.${key} is not allowed`);
  for (const key of keys)
    if (!Object.hasOwn(record, key)) reject(`${name}.${key} is required`);
  return record;
}

export function text(value: unknown, name: string, max: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  )
    reject(`${name} must be 1 to ${max} printable characters`);
  return value;
}

const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,127}$/u;
export function label(value: unknown, name: string): string {
  if (typeof value !== "string" || !LABEL.test(value))
    reject(`${name} must be an exact identifier`);
  return value;
}

export function digest(value: unknown, name: string): string {
  if (!validSha256(value)) reject(`${name} must be a lowercase SHA-256`);
  return value as string;
}

function gitSha(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value))
    reject(`${name} must be a full lowercase commit SHA`);
  return value;
}

export function oneOf<T extends string>(
  value: unknown,
  name: string,
  options: readonly T[],
): T {
  if (!options.includes(value as T))
    reject(`${name} must be one of ${options.join(", ")}`);
  return value as T;
}

export function list<T>(
  value: unknown,
  name: string,
  max: number,
  read: (item: unknown, itemName: string) => T,
): T[] {
  if (!Array.isArray(value) || value.length > max)
    reject(`${name} must be a list of at most ${max} items`);
  return value.map((item, index) => read(item, `${name}[${index}]`));
}

export function count(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    reject(`${name} must be a non-negative integer`);
  return value as number;
}

export function timestamp(value: unknown, name: string): string {
  if (!validIsoTimestamp(value)) reject(`${name} must be an ISO UTC time`);
  return value as string;
}

/** Parses a result exactly; unknown, missing or malformed fields refuse it. */
export function parseVettingResult(value: unknown): VettingResult {
  const body = object(value, "result", [
    "schemaVersion",
    "assessmentId",
    "projectId",
    "revision",
    "manifestSha256",
    "disposition",
    "policyVersion",
    "assessed",
    "environment",
    "telemetry",
    "traceSha256",
    "modelReviews",
    "artifacts",
    "findings",
    "confirmation",
  ]);
  if (body.schemaVersion !== VETTING_RESULT_SCHEMA)
    reject(`schemaVersion must be ${VETTING_RESULT_SCHEMA}`);
  if (
    typeof body.assessmentId !== "string" ||
    !/^vet_[a-f0-9]{32}$/u.test(body.assessmentId)
  )
    reject("assessmentId is invalid");
  if (typeof body.projectId !== "string" || !PROJECT_ID.test(body.projectId))
    reject("projectId is invalid");
  if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1)
    reject("revision must be a positive integer");
  const assessed = object(body.assessed, "assessed", [
    "repository",
    "commitSha",
    "templateSha256",
    "inputManifestSha256",
    "dependencyLocks",
  ]);
  const environment = object(body.environment, "environment", [
    "vmProvider",
    "isolation",
    "imageSha256",
    "collectorId",
    "runId",
    "startedAt",
    "completedAt",
  ]);
  const telemetry = object(body.telemetry, "telemetry", [
    "coverage",
    "visibilityGaps",
    "tamperDetected",
    "canaryAccessAttempts",
    "egress",
  ]);
  const coverage = object(telemetry.coverage, "telemetry.coverage", [
    ...TELEMETRY_CHANNELS,
  ]);
  if (typeof telemetry.tamperDetected !== "boolean")
    reject("telemetry.tamperDetected must be a boolean");
  if (telemetry.egress !== "default-deny")
    reject("telemetry.egress must be default-deny");
  const reviews = list(body.modelReviews, "modelReviews", 2, (item, name) => {
    const review = object(item, name, [
      "reviewer",
      "provider",
      "model",
      "promptPolicyRevision",
      "inputManifestSha256",
      "runId",
      "status",
      "verdict",
      "findingCount",
    ]);
    const status = oneOf(review.status, `${name}.status`, REVIEW_STATUSES);
    const verdict =
      status === "completed"
        ? (oneOf(
            review.verdict,
            `${name}.verdict`,
            REVIEW_VERDICTS,
          ) as ModelReview["verdict"])
        : review.verdict === null
          ? null
          : reject(`${name}.verdict must be null when the review did not run`);
    return {
      reviewer: oneOf(review.reviewer, `${name}.reviewer`, REVIEWERS),
      provider: label(review.provider, `${name}.provider`),
      model: label(review.model, `${name}.model`),
      promptPolicyRevision: label(
        review.promptPolicyRevision,
        `${name}.promptPolicyRevision`,
      ),
      inputManifestSha256: digest(
        review.inputManifestSha256,
        `${name}.inputManifestSha256`,
      ),
      runId: label(review.runId, `${name}.runId`),
      status,
      verdict,
      findingCount: count(review.findingCount, `${name}.findingCount`),
    };
  });
  // Exactly one Astra-class and one Opus-class review, run independently.
  if (
    reviews.length !== 2 ||
    new Set(reviews.map((review) => review.reviewer)).size !== 2
  )
    reject("modelReviews must hold one astra and one opus review");
  if (reviews[0].runId === reviews[1].runId)
    reject("The two model reviews must be separate runs");
  const confirmation =
    body.confirmation === null
      ? null
      : (() => {
          const value = object(body.confirmation, "confirmation", [
            "basis",
            "rule",
            "evidence",
          ]);
          const evidence = list(
            value.evidence,
            "confirmation.evidence",
            20,
            (item, name) => text(item, name, 300),
          );
          if (evidence.length === 0)
            reject("confirmation.evidence needs at least one reference");
          return {
            basis: oneOf(value.basis, "confirmation.basis", CONFIRMATION_BASES),
            rule: label(value.rule, "confirmation.rule"),
            evidence,
          };
        })();
  const result: VettingResult = {
    schemaVersion: VETTING_RESULT_SCHEMA,
    assessmentId: body.assessmentId as string,
    projectId: body.projectId as string,
    revision: body.revision as number,
    manifestSha256: digest(body.manifestSha256, "manifestSha256"),
    disposition: oneOf(body.disposition, "disposition", VETTING_DISPOSITIONS),
    policyVersion: label(body.policyVersion, "policyVersion"),
    assessed: {
      repository: text(assessed.repository, "assessed.repository", 201),
      commitSha: gitSha(assessed.commitSha, "assessed.commitSha"),
      templateSha256: digest(
        assessed.templateSha256,
        "assessed.templateSha256",
      ),
      inputManifestSha256: digest(
        assessed.inputManifestSha256,
        "assessed.inputManifestSha256",
      ),
      dependencyLocks: list(
        assessed.dependencyLocks,
        "assessed.dependencyLocks",
        200,
        (item, name) => {
          const lock = object(item, name, ["path", "sha256"]);
          return {
            path: text(lock.path, `${name}.path`, 500),
            sha256: digest(lock.sha256, `${name}.sha256`),
          };
        },
      ),
    },
    environment: {
      vmProvider: label(environment.vmProvider, "environment.vmProvider"),
      isolation: oneOf(environment.isolation, "environment.isolation", [
        "hardware-vm",
        "microvm",
      ] as const),
      imageSha256: digest(environment.imageSha256, "environment.imageSha256"),
      collectorId: label(environment.collectorId, "environment.collectorId"),
      runId: label(environment.runId, "environment.runId"),
      startedAt: timestamp(environment.startedAt, "environment.startedAt"),
      completedAt: timestamp(
        environment.completedAt,
        "environment.completedAt",
      ),
    },
    telemetry: {
      coverage: Object.fromEntries(
        TELEMETRY_CHANNELS.map((channel) => [
          channel,
          oneOf(coverage[channel], `telemetry.coverage.${channel}`, COVERAGE),
        ]),
      ) as VettingResult["telemetry"]["coverage"],
      visibilityGaps: list(
        telemetry.visibilityGaps,
        "telemetry.visibilityGaps",
        50,
        (item, name) => text(item, name, 300),
      ),
      tamperDetected: telemetry.tamperDetected as boolean,
      canaryAccessAttempts: count(
        telemetry.canaryAccessAttempts,
        "telemetry.canaryAccessAttempts",
      ),
      egress: "default-deny",
    },
    traceSha256: digest(body.traceSha256, "traceSha256"),
    modelReviews: reviews,
    artifacts: list(body.artifacts, "artifacts", 500, (item, name) => {
      const artifact = object(item, name, [
        "sha256",
        "parentSha256",
        "origin",
        "path",
        "type",
        "state",
        "analysis",
        "requestedExecution",
      ]);
      if (typeof artifact.requestedExecution !== "boolean")
        reject(`${name}.requestedExecution must be a boolean`);
      return {
        sha256: digest(artifact.sha256, `${name}.sha256`),
        parentSha256:
          artifact.parentSha256 === null
            ? null
            : digest(artifact.parentSha256, `${name}.parentSha256`),
        origin: text(artifact.origin, `${name}.origin`, 500),
        path: text(artifact.path, `${name}.path`, 500),
        type: oneOf(artifact.type, `${name}.type`, ARTIFACT_TYPES),
        state: oneOf(artifact.state, `${name}.state`, ARTIFACT_STATES),
        analysis: oneOf(
          artifact.analysis,
          `${name}.analysis`,
          ARTIFACT_ANALYSES,
        ),
        requestedExecution: artifact.requestedExecution as boolean,
      };
    }),
    findings: list(body.findings, "findings", 200, (item, name) => {
      const finding = object(item, name, [
        "severity",
        "category",
        "summary",
        "evidence",
      ]);
      return {
        severity: oneOf(finding.severity, `${name}.severity`, SEVERITIES),
        category: label(finding.category, `${name}.category`),
        summary: text(finding.summary, `${name}.summary`, 500),
        evidence: text(finding.evidence, `${name}.evidence`, 300),
      };
    }),
    confirmation,
  };
  if (
    Date.parse(result.environment.completedAt) <
    Date.parse(result.environment.startedAt)
  )
    reject("environment.completedAt is before startedAt");
  for (const artifact of result.artifacts)
    if (
      artifact.state === "released" &&
      !["static-clean", "detonation-clean"].includes(artifact.analysis)
    )
      reject("An artifact leaves quarantine only with a clean analysis");
  return result;
}

/**
 * Reasons a result cannot carry its claimed disposition. An empty list means
 * the disposition is consistent with its own evidence.
 */
export function dispositionProblems(result: VettingResult): string[] {
  const problems: string[] = [];
  if (result.disposition === "malicious") {
    // VET-06: a model label alone never confirms malice.
    if (result.confirmation === null)
      problems.push(
        "A malicious disposition needs reproducible behavior or verified source evidence",
      );
    return problems;
  }
  if (result.confirmation !== null)
    problems.push("Only a malicious disposition carries a confirmation");
  if (result.disposition === "incomplete") return problems;
  for (const channel of TELEMETRY_CHANNELS)
    if (result.telemetry.coverage[channel] !== "complete")
      problems.push(`Telemetry channel ${channel} is not complete`);
  if (result.telemetry.visibilityGaps.length > 0)
    problems.push("The run reported visibility gaps");
  if (result.telemetry.tamperDetected)
    problems.push("The run detected telemetry tampering");
  if (result.telemetry.canaryAccessAttempts > 0)
    problems.push("The run touched canary secrets");
  for (const review of result.modelReviews) {
    if (review.status !== "completed")
      problems.push(`The ${review.reviewer} review did not complete`);
    else if (review.verdict === "malicious-suspected")
      problems.push(`The ${review.reviewer} review suspects malice`);
    if (review.inputManifestSha256 !== result.assessed.inputManifestSha256)
      problems.push(
        `The ${review.reviewer} review did not read the assessed inventory`,
      );
  }
  if (result.artifacts.some((artifact) => artifact.state !== "released"))
    problems.push("An artifact is still quarantined or blocked");
  if (
    result.findings.some((finding) =>
      ["high", "critical"].includes(finding.severity),
    )
  )
    problems.push("A high or critical finding is open");
  return problems;
}
