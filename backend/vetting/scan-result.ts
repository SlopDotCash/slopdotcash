/**
 * The bounded malicious-code scan contract (PRD section 8, VET-01 to VET-07,
 * audit finding 8). It replaces the secure-VM clearance contract for new
 * results. A scan examines a fixed set of surfaces for a fixed set of
 * threats; "clean" means exactly that those defined checks passed on the
 * exact assessed revision, never that the code is free of all malware.
 *
 * Historical `slop-vetting-result-v1` results keep their own parser and
 * rules in `result.ts`; an old incomplete scan is never reread as clean.
 */

import {
  VETTING_DISPOSITIONS,
  type VettingDisposition,
} from "../../src/lib/vetting-contracts";
import { PROJECT_ID } from "../http";
import {
  ARTIFACT_ANALYSES,
  ARTIFACT_STATES,
  ARTIFACT_TYPES,
  CONFIRMATION_BASES,
  count,
  digest,
  dispositionProblems,
  label,
  list,
  object,
  oneOf,
  parseVettingResult,
  REVIEW_STATUSES,
  REVIEW_VERDICTS,
  reject,
  SEVERITIES,
  text,
  timestamp,
  type VettingArtifact,
  type VettingResult,
} from "./result";

export const VETTING_SCAN_SCHEMA = "slop-vetting-result-v2";

/** What a scan must read. Each surface must be complete for "clean". */
export const SCAN_SURFACES = [
  "source",
  "manifests",
  "dependencies",
  "installScripts",
  "downloads",
  "agentInstructions",
] as const;
export type ScanSurface = (typeof SCAN_SURFACES)[number];

/** What a scan looks for on every surface. Each check must pass for "clean". */
export const SCAN_THREATS = [
  "wallet-drainer",
  "credential-theft",
  "secret-exfiltration",
  "unsafe-execution",
  "prompt-injection",
] as const;
export type ScanThreat = (typeof SCAN_THREATS)[number];

const SURFACE_STATES = ["complete", "partial", "unsupported"] as const;
const SCAN_REVIEW_STATUSES = [...REVIEW_STATUSES, "not-started"] as const;
const CHECK_STATES = ["passed", "flagged", "not-run"] as const;
const RISKS = ["low", "ambiguous", "high"] as const;
const FINDING_CATEGORIES = [...SCAN_THREATS, "other"] as const;
const ISOLATION = ["hardware-vm", "microvm", "sandbox"] as const;

export type ScanReview = {
  provider: string;
  model: string;
  promptPolicyRevision: string;
  inputManifestSha256: string;
  runId: string;
  status: (typeof SCAN_REVIEW_STATUSES)[number];
  verdict: (typeof REVIEW_VERDICTS)[number] | null;
  /** The reviewer's own risk call; null when the review did not run. */
  risk: (typeof RISKS)[number] | null;
  findingCount: number;
};

export type VettingScanResult = {
  schemaVersion: typeof VETTING_SCAN_SCHEMA;
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
    /** SHA-256 of the exact executable inventory the scan read. */
    inputManifestSha256: string;
    dependencyLocks: { path: string; sha256: string }[];
  };
  scan: {
    runId: string;
    startedAt: string;
    completedAt: string;
    /** SHA-256 of the private scan report retained in the evidence store. */
    reportSha256: string;
  };
  coverage: Record<
    ScanSurface,
    { state: (typeof SURFACE_STATES)[number]; items: number }
  >;
  checks: Record<ScanThreat, (typeof CHECK_STATES)[number]>;
  visibilityGaps: string[];
  /**
   * Isolated execution, used only when a surface cannot be judged from its
   * bytes (an install hook or a download). It never receives secrets.
   */
  execution: {
    isolation: (typeof ISOLATION)[number];
    imageSha256: string;
    runId: string;
    reason: string;
    startedAt: string;
    completedAt: string;
    secretsProvided: false;
    egress: "default-deny";
  } | null;
  /**
   * A clean scan of the same project whose executable inventory and policy
   * are byte-identical. Its retained report stands in for a repeated run.
   */
  reusedAssessmentId: string | null;
  primaryReview: ScanReview;
  /** A second model or specialist; required only for escalated results. */
  specialistReview: ScanReview | null;
  artifacts: VettingArtifact[];
  findings: {
    severity: (typeof SEVERITIES)[number];
    category: (typeof FINDING_CATEGORIES)[number];
    summary: string;
    evidence: string;
  }[];
  confirmation: {
    basis: (typeof CONFIRMATION_BASES)[number];
    rule: string;
    evidence: string[];
  } | null;
};

/** Either recorded result schema: historical v1 or the bounded scan. */
export type RecordedVettingResult = VettingResult | VettingScanResult;

function ordered(startedAt: string, completedAt: string, name: string) {
  if (Date.parse(completedAt) < Date.parse(startedAt))
    reject(`${name}.completedAt is before startedAt`);
}

const ASSESSMENT_ID = /^vet_[a-f0-9]{32}$/u;

function review(value: unknown, name: string): ScanReview {
  const item = object(value, name, [
    "provider",
    "model",
    "promptPolicyRevision",
    "inputManifestSha256",
    "runId",
    "status",
    "verdict",
    "risk",
    "findingCount",
  ]);
  const status = oneOf(item.status, `${name}.status`, SCAN_REVIEW_STATUSES);
  const completed = status === "completed";
  if (!completed && (item.verdict !== null || item.risk !== null))
    reject(`${name}.verdict and risk must be null when the review did not run`);
  return {
    provider: label(item.provider, `${name}.provider`),
    model: label(item.model, `${name}.model`),
    promptPolicyRevision: label(
      item.promptPolicyRevision,
      `${name}.promptPolicyRevision`,
    ),
    inputManifestSha256: digest(
      item.inputManifestSha256,
      `${name}.inputManifestSha256`,
    ),
    runId: label(item.runId, `${name}.runId`),
    status,
    verdict: completed
      ? oneOf(item.verdict, `${name}.verdict`, REVIEW_VERDICTS)
      : null,
    risk: completed ? oneOf(item.risk, `${name}.risk`, RISKS) : null,
    findingCount: count(item.findingCount, `${name}.findingCount`),
  };
}

/** Parses a bounded scan result exactly; unknown or missing fields refuse it. */
export function parseVettingScanResult(value: unknown): VettingScanResult {
  const body = object(value, "result", [
    "schemaVersion",
    "assessmentId",
    "projectId",
    "revision",
    "manifestSha256",
    "disposition",
    "policyVersion",
    "assessed",
    "scan",
    "coverage",
    "checks",
    "visibilityGaps",
    "execution",
    "reusedAssessmentId",
    "primaryReview",
    "specialistReview",
    "artifacts",
    "findings",
    "confirmation",
  ]);
  if (body.schemaVersion !== VETTING_SCAN_SCHEMA)
    reject(`schemaVersion must be ${VETTING_SCAN_SCHEMA}`);
  if (
    typeof body.assessmentId !== "string" ||
    !ASSESSMENT_ID.test(body.assessmentId)
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
  if (
    typeof assessed.commitSha !== "string" ||
    !/^[0-9a-f]{40}$/u.test(assessed.commitSha)
  )
    reject("assessed.commitSha must be a full lowercase commit SHA");
  const scan = object(body.scan, "scan", [
    "runId",
    "startedAt",
    "completedAt",
    "reportSha256",
  ]);
  const coverage = object(body.coverage, "coverage", SCAN_SURFACES);
  const checks = object(body.checks, "checks", SCAN_THREATS);
  const execution =
    body.execution === null
      ? null
      : (() => {
          const value = object(body.execution, "execution", [
            "isolation",
            "imageSha256",
            "runId",
            "reason",
            "startedAt",
            "completedAt",
            "secretsProvided",
            "egress",
          ]);
          // No secret may reach untrusted execution; the contract has no
          // field that could say otherwise.
          if (value.secretsProvided !== false)
            reject("execution.secretsProvided must be false");
          if (value.egress !== "default-deny")
            reject("execution.egress must be default-deny");
          const startedAt = timestamp(value.startedAt, "execution.startedAt");
          const completedAt = timestamp(
            value.completedAt,
            "execution.completedAt",
          );
          ordered(startedAt, completedAt, "execution");
          return {
            isolation: oneOf(value.isolation, "execution.isolation", ISOLATION),
            imageSha256: digest(value.imageSha256, "execution.imageSha256"),
            runId: label(value.runId, "execution.runId"),
            reason: text(value.reason, "execution.reason", 300),
            startedAt,
            completedAt,
            secretsProvided: false as const,
            egress: "default-deny" as const,
          };
        })();
  if (
    body.reusedAssessmentId !== null &&
    (typeof body.reusedAssessmentId !== "string" ||
      !ASSESSMENT_ID.test(body.reusedAssessmentId) ||
      body.reusedAssessmentId === body.assessmentId)
  )
    reject("reusedAssessmentId must name another assessment or be null");
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
  const primaryReview = review(body.primaryReview, "primaryReview");
  const specialistReview =
    body.specialistReview === null
      ? null
      : review(body.specialistReview, "specialistReview");
  if (specialistReview && specialistReview.runId === primaryReview.runId)
    reject("The specialist review must be a separate run");
  const scanStartedAt = timestamp(scan.startedAt, "scan.startedAt");
  const scanCompletedAt = timestamp(scan.completedAt, "scan.completedAt");
  ordered(scanStartedAt, scanCompletedAt, "scan");
  const result: VettingScanResult = {
    schemaVersion: VETTING_SCAN_SCHEMA,
    assessmentId: body.assessmentId as string,
    projectId: body.projectId as string,
    revision: body.revision as number,
    manifestSha256: digest(body.manifestSha256, "manifestSha256"),
    disposition: oneOf(body.disposition, "disposition", VETTING_DISPOSITIONS),
    policyVersion: label(body.policyVersion, "policyVersion"),
    assessed: {
      repository: text(assessed.repository, "assessed.repository", 201),
      commitSha: assessed.commitSha as string,
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
    scan: {
      runId: label(scan.runId, "scan.runId"),
      startedAt: scanStartedAt,
      completedAt: scanCompletedAt,
      reportSha256: digest(scan.reportSha256, "scan.reportSha256"),
    },
    coverage: Object.fromEntries(
      SCAN_SURFACES.map((surface) => {
        const entry = object(coverage[surface], `coverage.${surface}`, [
          "state",
          "items",
        ]);
        return [
          surface,
          {
            state: oneOf(
              entry.state,
              `coverage.${surface}.state`,
              SURFACE_STATES,
            ),
            items: count(entry.items, `coverage.${surface}.items`),
          },
        ];
      }),
    ) as VettingScanResult["coverage"],
    checks: Object.fromEntries(
      SCAN_THREATS.map((threat) => [
        threat,
        oneOf(checks[threat], `checks.${threat}`, CHECK_STATES),
      ]),
    ) as VettingScanResult["checks"],
    visibilityGaps: list(
      body.visibilityGaps,
      "visibilityGaps",
      50,
      (item, name) => text(item, name, 300),
    ),
    execution,
    reusedAssessmentId: body.reusedAssessmentId as string | null,
    primaryReview,
    specialistReview,
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
      const parsed: VettingArtifact = {
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
      if (
        parsed.state === "released" &&
        !["static-clean", "detonation-clean"].includes(parsed.analysis)
      )
        reject("An artifact leaves quarantine only with a clean analysis");
      return parsed;
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
        category: oneOf(
          finding.category,
          `${name}.category`,
          FINDING_CATEGORIES,
        ),
        summary: text(finding.summary, `${name}.summary`, 500),
        evidence: text(finding.evidence, `${name}.evidence`, 300),
      };
    }),
    confirmation,
  };
  return result;
}

/**
 * True when the result is ambiguous or high risk and so needs a second model
 * or specialist before it can be clean. An ordinary clean project does not.
 */
export function specialistRequired(result: VettingScanResult): boolean {
  const primary = result.primaryReview;
  return (
    primary.verdict !== "no-findings" ||
    primary.risk !== "low" ||
    SCAN_THREATS.some((threat) => result.checks[threat] === "flagged") ||
    result.findings.some((finding) =>
      ["medium", "high", "critical"].includes(finding.severity),
    ) ||
    // A binary or download that is not yet released after a clean analysis
    // needs a specialist to analyze it.
    result.artifacts.some((artifact) => artifact.state !== "released")
  );
}

/**
 * Reasons a bounded scan cannot carry its claimed disposition. An empty list
 * means the disposition is consistent with its own evidence. "clean" needs
 * every defined surface read completely, every defined check passed (or
 * cleared by a completed specialist), every artifact released after a clean
 * analysis and no high or critical finding.
 */
export function scanProblems(result: VettingScanResult): string[] {
  const problems: string[] = [];
  if (result.disposition === "malicious") {
    if (result.confirmation === null)
      problems.push(
        "A malicious disposition needs reproducible behavior or verified source evidence",
      );
    return problems;
  }
  if (result.confirmation !== null)
    problems.push("Only a malicious disposition carries a confirmation");
  if (result.disposition === "incomplete") return problems;
  for (const surface of SCAN_SURFACES)
    if (result.coverage[surface].state !== "complete")
      problems.push(`The ${surface} surface was not read completely`);
  if (result.visibilityGaps.length > 0)
    problems.push("The scan reported visibility gaps");
  const inventory = result.assessed.inputManifestSha256;
  const reviewProblems = (review: ScanReview, name: string) => {
    if (review.status !== "completed")
      problems.push(`The ${name} review did not complete`);
    else if (review.verdict === "malicious-suspected")
      problems.push(`The ${name} review suspects malice`);
    if (review.inputManifestSha256 !== inventory)
      problems.push(`The ${name} review did not read the assessed inventory`);
  };
  reviewProblems(result.primaryReview, "primary");
  const escalated = specialistRequired(result);
  const specialist = result.specialistReview;
  if (specialist) {
    reviewProblems(specialist, "specialist");
    if (
      escalated &&
      (specialist.verdict !== "no-findings" || specialist.risk !== "low")
    )
      problems.push("The specialist review did not clear the escalated result");
  } else if (escalated)
    problems.push("An ambiguous or high-risk result needs a specialist review");
  for (const threat of SCAN_THREATS)
    if (result.checks[threat] === "not-run")
      problems.push(`The ${threat} check did not run`);
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

/** Parses either recorded schema by its declared version. */
export function parseRecordedVettingResult(
  value: unknown,
): RecordedVettingResult {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion === VETTING_SCAN_SCHEMA
  )
    return parseVettingScanResult(value);
  return parseVettingResult(value);
}

export function isScanResult(
  result: RecordedVettingResult,
): result is VettingScanResult {
  return result.schemaVersion === VETTING_SCAN_SCHEMA;
}

/** The disposition rules of the result's own schema. */
export function recordedResultProblems(
  result: RecordedVettingResult,
): string[] {
  return isScanResult(result)
    ? scanProblems(result)
    : dispositionProblems(result);
}

/** The model or specialist runs a result names, for safe summaries. */
export function resultReviewers(
  result: RecordedVettingResult,
): { reviewer: string; provider: string; model: string }[] {
  if (!isScanResult(result))
    return result.modelReviews.map((review) => ({
      reviewer: review.reviewer,
      provider: review.provider,
      model: review.model,
    }));
  return [
    { ...result.primaryReview, reviewer: "primary" },
    ...(result.specialistReview
      ? [{ ...result.specialistReview, reviewer: "specialist" }]
      : []),
  ]
    .filter((review) => review.status !== "not-started")
    .map(({ reviewer, provider, model }) => ({ reviewer, provider, model }));
}
