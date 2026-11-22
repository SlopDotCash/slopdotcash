// spec/security/admission.md, "Synthesis decides the repository result and confirmed malice needs trusted evidence"; spec/security/admission.md, "The primary review decides and an ambiguous or high-risk finding needs the specialist"; spec/security/admission.md, "Evidence durability precedes a clean or malicious publication"
import { dispositionProven, reusableInventory, sameEvidence } from "./gates.ts";
import { scanNeedsSpecialist } from "./specialist.ts";

export const scanSchema = "slop-vetting-result-v2";
const legacySchema = "slop-vetting-result-v1";
export const maxResultBytes = 256 * 1024;
export const templatePrefix = "slop-skill-template";

export const dispositions = ["clean", "incomplete", "malicious"] as const;
export type Disposition = (typeof dispositions)[number];

export const scanSurfaces = ["source", "manifests", "dependencies", "installScripts", "downloads", "agentInstructions"] as const;
export type ScanSurface = (typeof scanSurfaces)[number];

export const scanThreats = ["wallet-drainer", "credential-theft", "secret-exfiltration", "unsafe-execution", "prompt-injection"] as const;
export type ScanThreat = (typeof scanThreats)[number];

const telemetryChannels = ["process", "file", "memoryMap", "blockDevice", "privilege", "dynamicLoading", "dns", "network", "http", "artifactDiff", "canary"] as const;
type TelemetryChannel = (typeof telemetryChannels)[number];
const telemetryCoverage = ["complete", "partial", "missing"] as const;
const artifactTypes = ["binary", "archive", "obfuscated-script", "native-module", "wasm", "bytecode", "second-stage", "other"] as const;
const artifactStates = ["quarantined", "released", "blocked"] as const;
const artifactAnalyses = ["pending", "static-clean", "detonation-clean", "suspicious", "malicious"] as const;
const reviewers = ["astra", "opus"] as const;
const reviewStatuses = ["completed", "unavailable", "failed"] as const;
const reviewVerdicts = ["no-findings", "findings", "malicious-suspected"] as const;
const severities = ["info", "low", "medium", "high", "critical"] as const;
const confirmationBases = ["reproducible-behavior", "verified-source-evidence"] as const;
const surfaceStates = ["complete", "partial", "unsupported"] as const;
const scanReviewStatuses = [...reviewStatuses, "not-started"] as const;
const checkStates = ["passed", "flagged", "not-run"] as const;
const risks = ["low", "ambiguous", "high"] as const;
const findingCategories = [...scanThreats, "other"] as const;
const isolations = ["hardware-vm", "microvm", "sandbox"] as const;

const assessmentIdPattern = /^vet_[a-f0-9]{32}$/u;
const projectIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,41}[a-z0-9])?$/u;
const labelPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,127}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export interface Artifact {
  readonly sha256: string;
  readonly parentSha256: string | null;
  readonly origin: string;
  readonly path: string;
  readonly type: (typeof artifactTypes)[number];
  readonly state: (typeof artifactStates)[number];
  readonly analysis: (typeof artifactAnalyses)[number];
  readonly requestedExecution: boolean;
}

export interface Lock {
  readonly path: string;
  readonly sha256: string;
}

export interface Confirmation {
  readonly basis: (typeof confirmationBases)[number];
  readonly rule: string;
  readonly evidence: ReadonlyArray<string>;
}

export interface Finding<C extends string> {
  readonly severity: (typeof severities)[number];
  readonly category: C;
  readonly summary: string;
  readonly evidence: string;
}

export interface ModelReview {
  readonly reviewer: (typeof reviewers)[number];
  readonly provider: string;
  readonly model: string;
  readonly promptPolicyRevision: string;
  readonly inputManifestSha256: string;
  readonly runId: string;
  readonly status: (typeof reviewStatuses)[number];
  readonly verdict: (typeof reviewVerdicts)[number] | null;
  readonly findingCount: number;
}

export interface ScanReview {
  readonly provider: string;
  readonly model: string;
  readonly promptPolicyRevision: string;
  readonly inputManifestSha256: string;
  readonly runId: string;
  readonly status: (typeof scanReviewStatuses)[number];
  readonly verdict: (typeof reviewVerdicts)[number] | null;
  readonly risk: (typeof risks)[number] | null;
  readonly findingCount: number;
}

export interface Execution {
  readonly isolation: (typeof isolations)[number];
  readonly imageSha256: string;
  readonly runId: string;
  readonly reason: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly secretsProvided: false;
  readonly egress: "default-deny";
}

export interface Assessed {
  readonly repository: string;
  readonly commitSha: string;
  readonly templateSha256: string;
  readonly inputManifestSha256: string;
  readonly sourceInventorySha256?: string;
  readonly dependencyLocks: ReadonlyArray<Lock>;
}

export interface ScanResult {
  readonly schemaVersion: typeof scanSchema;
  readonly assessmentId: string;
  readonly projectId: string;
  readonly revision: number;
  readonly manifestSha256: string;
  readonly disposition: Disposition;
  readonly policyVersion: string;
  readonly assessed: Assessed;
  readonly scan: { readonly runId: string; readonly startedAt: string; readonly completedAt: string; readonly reportSha256: string };
  readonly coverage: Readonly<Record<ScanSurface, { readonly state: (typeof surfaceStates)[number]; readonly items: number }>>;
  readonly checks: Readonly<Record<ScanThreat, (typeof checkStates)[number]>>;
  readonly visibilityGaps: ReadonlyArray<string>;
  readonly execution: Execution | null;
  readonly reusedAssessmentId: string | null;
  readonly primaryReview: ScanReview;
  readonly specialistReview: ScanReview | null;
  readonly artifacts: ReadonlyArray<Artifact>;
  readonly findings: ReadonlyArray<Finding<(typeof findingCategories)[number]>>;
  readonly confirmation: Confirmation | null;
}

export interface LegacyResult {
  readonly schemaVersion: typeof legacySchema;
  readonly assessmentId: string;
  readonly projectId: string;
  readonly revision: number;
  readonly manifestSha256: string;
  readonly disposition: Disposition;
  readonly policyVersion: string;
  readonly assessed: Assessed;
  readonly environment: {
    readonly vmProvider: string;
    readonly isolation: "hardware-vm" | "microvm";
    readonly imageSha256: string;
    readonly collectorId: string;
    readonly runId: string;
    readonly startedAt: string;
    readonly completedAt: string;
  };
  readonly telemetry: {
    readonly coverage: Readonly<Record<TelemetryChannel, (typeof telemetryCoverage)[number]>>;
    readonly visibilityGaps: ReadonlyArray<string>;
    readonly tamperDetected: boolean;
    readonly canaryAccessAttempts: number;
    readonly egress: "default-deny";
  };
  readonly traceSha256: string;
  readonly modelReviews: ReadonlyArray<ModelReview>;
  readonly artifacts: ReadonlyArray<Artifact>;
  readonly findings: ReadonlyArray<Finding<string>>;
  readonly confirmation: Confirmation | null;
}

export type RecordedResult = ScanResult | LegacyResult;

export type Parsed = { readonly kind: "parsed"; readonly result: RecordedResult } | { readonly kind: "invalid"; readonly message: string };

class ResultRefusal extends Error {}

function reject(message: string): never {
  throw new ResultRefusal(message);
}

type Shape = Record<string, unknown>;

function object(value: unknown, name: string, keys: ReadonlyArray<string>): Shape {
  if (typeof value !== "object" || value === null || Array.isArray(value)) reject(`${name} must be an object`);
  const record = value as Shape;
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) if (!allowed.has(key)) reject(`${name}.${key} is not allowed`);
  for (const key of keys) if (!Object.hasOwn(record, key)) reject(`${name}.${key} is required`);
  return record;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value.trim() !== value || /\p{Cc}/u.test(value)) reject(`${name} must be 1 to ${max} printable characters`);
  return value;
}

function label(value: unknown, name: string): string {
  if (typeof value !== "string" || !labelPattern.test(value)) reject(`${name} must be an exact identifier`);
  return value;
}

function digest(value: unknown, name: string): string {
  if (typeof value !== "string" || !digestPattern.test(value)) reject(`${name} must be a lowercase SHA-256`);
  return value;
}

function gitSha(value: unknown, name: string): string {
  if (typeof value !== "string" || !commitPattern.test(value)) reject(`${name} must be a full lowercase commit SHA`);
  return value;
}

function oneOf<T extends string>(value: unknown, name: string, options: ReadonlyArray<T>): T {
  const found = options.find((option) => option === value);
  if (found === undefined) reject(`${name} must be one of ${options.join(", ")}`);
  return found;
}

function list<T>(value: unknown, name: string, max: number, read: (item: unknown, itemName: string) => T): T[] {
  if (!Array.isArray(value) || value.length > max) reject(`${name} must be a list of at most ${max} items`);
  return value.map((item: unknown, index) => read(item, `${name}[${index}]`));
}

function count(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) reject(`${name} must be a non-negative integer`);
  return value;
}

/** @throws {never} */
export function isInstant(value: unknown): value is string {
  if (typeof value !== "string" || !instantPattern.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const canonical = value.endsWith(".000Z") ? value : value.endsWith("Z") && !value.includes(".") ? `${value.slice(0, -1)}.000Z` : value;
  return new Date(milliseconds).toISOString() === canonical;
}

function timestamp(value: unknown, name: string): string {
  if (!isInstant(value)) reject(`${name} must be an ISO UTC time`);
  return value;
}

function ordered(startedAt: string, completedAt: string, name: string) {
  if (Date.parse(completedAt) < Date.parse(startedAt)) reject(`${name}.completedAt is before startedAt`);
}

function positiveRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) reject("revision must be a positive integer");
  return value;
}

function identity(body: Shape) {
  if (typeof body.assessmentId !== "string" || !assessmentIdPattern.test(body.assessmentId)) reject("assessmentId is invalid");
  if (typeof body.projectId !== "string" || !projectIdPattern.test(body.projectId)) reject("projectId is invalid");
  return { assessmentId: body.assessmentId, projectId: body.projectId, revision: positiveRevision(body.revision) };
}

function confirmationOf(value: unknown): Confirmation | null {
  if (value === null) return null;
  const confirmation = object(value, "confirmation", ["basis", "rule", "evidence"]);
  const evidence = list(confirmation.evidence, "confirmation.evidence", 20, (item, name) => text(item, name, 300));
  if (evidence.length === 0) reject("confirmation.evidence needs at least one reference");
  return { basis: oneOf(confirmation.basis, "confirmation.basis", confirmationBases), rule: label(confirmation.rule, "confirmation.rule"), evidence };
}

function locksOf(value: unknown): Lock[] {
  return list(value, "assessed.dependencyLocks", 200, (item, name) => {
    const lock = object(item, name, ["path", "sha256"]);
    return { path: text(lock.path, `${name}.path`, 500), sha256: digest(lock.sha256, `${name}.sha256`) };
  });
}

function artifactOf(item: unknown, name: string): Artifact {
  const artifact = object(item, name, ["sha256", "parentSha256", "origin", "path", "type", "state", "analysis", "requestedExecution"]);
  if (typeof artifact.requestedExecution !== "boolean") reject(`${name}.requestedExecution must be a boolean`);
  return {
    sha256: digest(artifact.sha256, `${name}.sha256`),
    parentSha256: artifact.parentSha256 === null ? null : digest(artifact.parentSha256, `${name}.parentSha256`),
    origin: text(artifact.origin, `${name}.origin`, 500),
    path: text(artifact.path, `${name}.path`, 500),
    type: oneOf(artifact.type, `${name}.type`, artifactTypes),
    state: oneOf(artifact.state, `${name}.state`, artifactStates),
    analysis: oneOf(artifact.analysis, `${name}.analysis`, artifactAnalyses),
    requestedExecution: artifact.requestedExecution,
  };
}

function findingOf<C extends string>(item: unknown, name: string, category: (value: unknown, name: string) => C): Finding<C> {
  const finding = object(item, name, ["severity", "category", "summary", "evidence"]);
  return {
    severity: oneOf(finding.severity, `${name}.severity`, severities),
    category: category(finding.category, `${name}.category`),
    summary: text(finding.summary, `${name}.summary`, 500),
    evidence: text(finding.evidence, `${name}.evidence`, 300),
  };
}

function releasedOnlyWhenClean(artifact: Artifact) {
  if (artifact.state === "released" && artifact.analysis !== "static-clean" && artifact.analysis !== "detonation-clean") reject("An artifact leaves quarantine only with a clean analysis");
  return artifact;
}

function scanReviewOf(value: unknown, name: string): ScanReview {
  const item = object(value, name, ["provider", "model", "promptPolicyRevision", "inputManifestSha256", "runId", "status", "verdict", "risk", "findingCount"]);
  const status = oneOf(item.status, `${name}.status`, scanReviewStatuses);
  const completed = status === "completed";
  if (!completed && (item.verdict !== null || item.risk !== null)) reject(`${name}.verdict and risk must be null when the review did not run`);
  return {
    provider: label(item.provider, `${name}.provider`),
    model: label(item.model, `${name}.model`),
    promptPolicyRevision: label(item.promptPolicyRevision, `${name}.promptPolicyRevision`),
    inputManifestSha256: digest(item.inputManifestSha256, `${name}.inputManifestSha256`),
    runId: label(item.runId, `${name}.runId`),
    status,
    verdict: completed ? oneOf(item.verdict, `${name}.verdict`, reviewVerdicts) : null,
    risk: completed ? oneOf(item.risk, `${name}.risk`, risks) : null,
    findingCount: count(item.findingCount, `${name}.findingCount`),
  };
}

function executionOf(value: unknown): Execution | null {
  if (value === null) return null;
  const execution = object(value, "execution", ["isolation", "imageSha256", "runId", "reason", "startedAt", "completedAt", "secretsProvided", "egress"]);
  if (execution.secretsProvided !== false) reject("execution.secretsProvided must be false");
  if (execution.egress !== "default-deny") reject("execution.egress must be default-deny");
  const startedAt = timestamp(execution.startedAt, "execution.startedAt");
  const completedAt = timestamp(execution.completedAt, "execution.completedAt");
  ordered(startedAt, completedAt, "execution");
  return {
    isolation: oneOf(execution.isolation, "execution.isolation", isolations),
    imageSha256: digest(execution.imageSha256, "execution.imageSha256"),
    runId: label(execution.runId, "execution.runId"),
    reason: text(execution.reason, "execution.reason", 300),
    startedAt,
    completedAt,
    secretsProvided: false,
    egress: "default-deny",
  };
}

function coverageOf(value: Shape): ScanResult["coverage"] {
  const read = (surface: ScanSurface) => {
    const entry = object(value[surface], `coverage.${surface}`, ["state", "items"]);
    return { state: oneOf(entry.state, `coverage.${surface}.state`, surfaceStates), items: count(entry.items, `coverage.${surface}.items`) };
  };
  return { source: read("source"), manifests: read("manifests"), dependencies: read("dependencies"), installScripts: read("installScripts"), downloads: read("downloads"), agentInstructions: read("agentInstructions") };
}

function checksOf(value: Shape): ScanResult["checks"] {
  const read = (threat: ScanThreat) => oneOf(value[threat], `checks.${threat}`, checkStates);
  return { "wallet-drainer": read("wallet-drainer"), "credential-theft": read("credential-theft"), "secret-exfiltration": read("secret-exfiltration"), "unsafe-execution": read("unsafe-execution"), "prompt-injection": read("prompt-injection") };
}

function scanResultOf(value: unknown): ScanResult {
  const body = object(value, "result", ["schemaVersion", "assessmentId", "projectId", "revision", "manifestSha256", "disposition", "policyVersion", "assessed", "scan", "coverage", "checks", "visibilityGaps", "execution", "reusedAssessmentId", "primaryReview", "specialistReview", "artifacts", "findings", "confirmation"]);
  if (body.schemaVersion !== scanSchema) reject(`schemaVersion must be ${scanSchema}`);
  const named = identity(body);
  const hasSourceInventory = typeof body.assessed === "object" && body.assessed !== null && Object.hasOwn(body.assessed, "sourceInventorySha256");
  const assessed = object(body.assessed, "assessed", ["repository", "commitSha", "templateSha256", "inputManifestSha256", ...(hasSourceInventory ? ["sourceInventorySha256"] : []), "dependencyLocks"]);
  const commitSha = gitSha(assessed.commitSha, "assessed.commitSha");
  const scan = object(body.scan, "scan", ["runId", "startedAt", "completedAt", "reportSha256"]);
  const coverage = object(body.coverage, "coverage", scanSurfaces);
  const checks = object(body.checks, "checks", scanThreats);
  const execution = executionOf(body.execution);
  const reused = body.reusedAssessmentId;
  if (reused !== null && (typeof reused !== "string" || !assessmentIdPattern.test(reused) || reused === named.assessmentId)) reject("reusedAssessmentId must name another assessment or be null");
  const confirmation = confirmationOf(body.confirmation);
  const primaryReview = scanReviewOf(body.primaryReview, "primaryReview");
  const specialistReview = body.specialistReview === null ? null : scanReviewOf(body.specialistReview, "specialistReview");
  if (specialistReview !== null && specialistReview.runId === primaryReview.runId) reject("The specialist review must be a separate run");
  const scanStartedAt = timestamp(scan.startedAt, "scan.startedAt");
  const scanCompletedAt = timestamp(scan.completedAt, "scan.completedAt");
  ordered(scanStartedAt, scanCompletedAt, "scan");
  return {
    schemaVersion: scanSchema,
    ...named,
    manifestSha256: digest(body.manifestSha256, "manifestSha256"),
    disposition: oneOf(body.disposition, "disposition", dispositions),
    policyVersion: label(body.policyVersion, "policyVersion"),
    assessed: {
      repository: text(assessed.repository, "assessed.repository", 201),
      commitSha,
      templateSha256: digest(assessed.templateSha256, "assessed.templateSha256"),
      inputManifestSha256: digest(assessed.inputManifestSha256, "assessed.inputManifestSha256"),
      ...(hasSourceInventory ? { sourceInventorySha256: digest(assessed.sourceInventorySha256, "assessed.sourceInventorySha256") } : {}),
      dependencyLocks: locksOf(assessed.dependencyLocks),
    },
    scan: { runId: label(scan.runId, "scan.runId"), startedAt: scanStartedAt, completedAt: scanCompletedAt, reportSha256: digest(scan.reportSha256, "scan.reportSha256") },
    coverage: coverageOf(coverage),
    checks: checksOf(checks),
    visibilityGaps: list(body.visibilityGaps, "visibilityGaps", 50, (item, name) => text(item, name, 300)),
    execution,
    reusedAssessmentId: reused === null ? null : (reused as string),
    primaryReview,
    specialistReview,
    artifacts: list(body.artifacts, "artifacts", 500, (item, name) => releasedOnlyWhenClean(artifactOf(item, name))),
    findings: list(body.findings, "findings", 200, (item, name) => findingOf(item, name, (category, field) => oneOf(category, field, findingCategories))),
    confirmation,
  };
}

function modelReviewOf(item: unknown, name: string): ModelReview {
  const review = object(item, name, ["reviewer", "provider", "model", "promptPolicyRevision", "inputManifestSha256", "runId", "status", "verdict", "findingCount"]);
  const status = oneOf(review.status, `${name}.status`, reviewStatuses);
  const verdict = status === "completed" ? oneOf(review.verdict, `${name}.verdict`, reviewVerdicts) : review.verdict === null ? null : reject(`${name}.verdict must be null when the review did not run`);
  return {
    reviewer: oneOf(review.reviewer, `${name}.reviewer`, reviewers),
    provider: label(review.provider, `${name}.provider`),
    model: label(review.model, `${name}.model`),
    promptPolicyRevision: label(review.promptPolicyRevision, `${name}.promptPolicyRevision`),
    inputManifestSha256: digest(review.inputManifestSha256, `${name}.inputManifestSha256`),
    runId: label(review.runId, `${name}.runId`),
    status,
    verdict,
    findingCount: count(review.findingCount, `${name}.findingCount`),
  };
}

function legacyCoverageOf(value: Shape): LegacyResult["telemetry"]["coverage"] {
  const entries = telemetryChannels.map((channel) => [channel, oneOf(value[channel], `telemetry.coverage.${channel}`, telemetryCoverage)] as const);
  return Object.fromEntries(entries) as LegacyResult["telemetry"]["coverage"];
}

function legacyResultOf(value: unknown): LegacyResult {
  const body = object(value, "result", ["schemaVersion", "assessmentId", "projectId", "revision", "manifestSha256", "disposition", "policyVersion", "assessed", "environment", "telemetry", "traceSha256", "modelReviews", "artifacts", "findings", "confirmation"]);
  if (body.schemaVersion !== legacySchema) reject(`schemaVersion must be ${legacySchema}`);
  const named = identity(body);
  const assessed = object(body.assessed, "assessed", ["repository", "commitSha", "templateSha256", "inputManifestSha256", "dependencyLocks"]);
  const environment = object(body.environment, "environment", ["vmProvider", "isolation", "imageSha256", "collectorId", "runId", "startedAt", "completedAt"]);
  const telemetry = object(body.telemetry, "telemetry", ["coverage", "visibilityGaps", "tamperDetected", "canaryAccessAttempts", "egress"]);
  const coverage = object(telemetry.coverage, "telemetry.coverage", telemetryChannels);
  if (typeof telemetry.tamperDetected !== "boolean") reject("telemetry.tamperDetected must be a boolean");
  if (telemetry.egress !== "default-deny") reject("telemetry.egress must be default-deny");
  const reviews = list(body.modelReviews, "modelReviews", 2, modelReviewOf);
  const [first, second] = reviews;
  if (first === undefined || second === undefined || first.reviewer === second.reviewer) reject("modelReviews must hold one astra and one opus review");
  if (first.runId === second.runId) reject("The two model reviews must be separate runs");
  const confirmation = confirmationOf(body.confirmation);
  const result: LegacyResult = {
    schemaVersion: legacySchema,
    ...named,
    manifestSha256: digest(body.manifestSha256, "manifestSha256"),
    disposition: oneOf(body.disposition, "disposition", dispositions),
    policyVersion: label(body.policyVersion, "policyVersion"),
    assessed: {
      repository: text(assessed.repository, "assessed.repository", 201),
      commitSha: gitSha(assessed.commitSha, "assessed.commitSha"),
      templateSha256: digest(assessed.templateSha256, "assessed.templateSha256"),
      inputManifestSha256: digest(assessed.inputManifestSha256, "assessed.inputManifestSha256"),
      dependencyLocks: locksOf(assessed.dependencyLocks),
    },
    environment: {
      vmProvider: label(environment.vmProvider, "environment.vmProvider"),
      isolation: oneOf(environment.isolation, "environment.isolation", ["hardware-vm", "microvm"] as const),
      imageSha256: digest(environment.imageSha256, "environment.imageSha256"),
      collectorId: label(environment.collectorId, "environment.collectorId"),
      runId: label(environment.runId, "environment.runId"),
      startedAt: timestamp(environment.startedAt, "environment.startedAt"),
      completedAt: timestamp(environment.completedAt, "environment.completedAt"),
    },
    telemetry: {
      coverage: legacyCoverageOf(coverage),
      visibilityGaps: list(telemetry.visibilityGaps, "telemetry.visibilityGaps", 50, (item, name) => text(item, name, 300)),
      tamperDetected: telemetry.tamperDetected,
      canaryAccessAttempts: count(telemetry.canaryAccessAttempts, "telemetry.canaryAccessAttempts"),
      egress: "default-deny",
    },
    traceSha256: digest(body.traceSha256, "traceSha256"),
    modelReviews: reviews,
    artifacts: list(body.artifacts, "artifacts", 500, artifactOf),
    findings: list(body.findings, "findings", 200, (item, name) => findingOf(item, name, label)),
    confirmation,
  };
  if (Date.parse(result.environment.completedAt) < Date.parse(result.environment.startedAt)) reject("environment.completedAt is before startedAt");
  for (const artifact of result.artifacts) releasedOnlyWhenClean(artifact);
  return result;
}

/** @throws {never} */
export function parseResult(value: unknown): Parsed {
  try {
    const declared = typeof value === "object" && value !== null ? (value as { readonly schemaVersion?: unknown }).schemaVersion : undefined;
    return { kind: "parsed", result: declared === scanSchema ? scanResultOf(value) : legacyResultOf(value) };
  } catch (error) {
    if (error instanceof ResultRefusal) return { kind: "invalid", message: error.message };
    return { kind: "invalid", message: "result must be an object" };
  }
}

/** @throws {never} */
export function isScanResult(result: RecordedResult): result is ScanResult {
  return result.schemaVersion === scanSchema;
}

const serious = new Set(["medium", "high", "critical"]);
const advisoryGap = new RegExp(`^(?:${reviewers.join("|")}):(?:${scanThreats.join("|")}):outside-revision$`, "u");

/** @throws {never} */
export function advisoryReviewGap(gap: string): boolean {
  return advisoryGap.test(gap);
}
const open = new Set(["high", "critical"]);

/** @throws {never} */
export function specialistRequired(result: ScanResult): boolean {
  const primary = result.primaryReview;
  return scanNeedsSpecialist(
    primary.verdict ?? "",
    primary.risk ?? "",
    scanThreats.some((threat) => result.checks[threat] === "flagged"),
    result.findings.some((finding) => serious.has(finding.severity)),
    result.artifacts.some((artifact) => artifact.state !== "released"),
  );
}

function scanProblems(result: ScanResult): string[] {
  const problems: string[] = [];
  if (result.disposition === "malicious") {
    if (result.confirmation === null) problems.push("A malicious disposition needs reproducible behavior or verified source evidence");
    return problems;
  }
  if (result.confirmation !== null) problems.push("Only a malicious disposition carries a confirmation");
  if (result.disposition === "incomplete") return problems;
  for (const surface of scanSurfaces) if (result.coverage[surface].state !== "complete") problems.push(`The ${surface} surface was not read completely`);
  if (result.visibilityGaps.some((gap) => !advisoryReviewGap(gap))) problems.push("The scan reported visibility gaps");
  const inventory = result.assessed.inputManifestSha256;
  const reviewProblems = (review: ScanReview, name: string) => {
    if (review.status !== "completed") problems.push(`The ${name} review did not complete`);
    else if (review.verdict === "malicious-suspected") problems.push(`The ${name} review suspects malice`);
    if (review.inputManifestSha256 !== inventory) problems.push(`The ${name} review did not read the assessed inventory`);
  };
  reviewProblems(result.primaryReview, "primary");
  const escalated = specialistRequired(result);
  const specialist = result.specialistReview;
  if (specialist !== null) {
    reviewProblems(specialist, "specialist");
    if (escalated && specialist.risk === "high") problems.push("The specialist review did not clear the escalated result");
  } else if (escalated) problems.push("An ambiguous or high-risk result needs a specialist review");
  if (result.primaryReview.risk === "high") problems.push("The primary review reported a high or critical finding");
  for (const threat of scanThreats) if (result.checks[threat] === "not-run") problems.push(`The ${threat} check did not run`);
  if (result.artifacts.some((artifact) => artifact.state !== "released")) problems.push("An artifact is still quarantined or blocked");
  if (result.findings.some((finding) => open.has(finding.severity))) problems.push("A high or critical finding is open");
  return problems;
}

function legacyProblems(result: LegacyResult): string[] {
  const problems: string[] = [];
  if (result.disposition === "malicious") {
    if (result.confirmation === null) problems.push("A malicious disposition needs reproducible behavior or verified source evidence");
    return problems;
  }
  if (result.confirmation !== null) problems.push("Only a malicious disposition carries a confirmation");
  if (result.disposition === "incomplete") return problems;
  for (const channel of telemetryChannels) if (result.telemetry.coverage[channel] !== "complete") problems.push(`Telemetry channel ${channel} is not complete`);
  if (result.telemetry.visibilityGaps.length > 0) problems.push("The run reported visibility gaps");
  if (result.telemetry.tamperDetected) problems.push("The run detected telemetry tampering");
  if (result.telemetry.canaryAccessAttempts > 0) problems.push("The run touched canary secrets");
  for (const review of result.modelReviews) {
    if (review.status !== "completed") problems.push(`The ${review.reviewer} review did not complete`);
    else if (review.verdict === "malicious-suspected") problems.push(`The ${review.reviewer} review suspects malice`);
    if (review.inputManifestSha256 !== result.assessed.inputManifestSha256) problems.push(`The ${review.reviewer} review did not read the assessed inventory`);
  }
  if (result.artifacts.some((artifact) => artifact.state !== "released")) problems.push("An artifact is still quarantined or blocked");
  if (result.findings.some((finding) => open.has(finding.severity))) problems.push("A high or critical finding is open");
  return problems;
}

/** @throws {never} */
export function resultProblems(result: RecordedResult): ReadonlyArray<string> {
  return isScanResult(result) ? scanProblems(result) : legacyProblems(result);
}

/** @throws {never} */
export function resultReviewers(result: RecordedResult): ReadonlyArray<{ readonly reviewer: string; readonly provider: string; readonly model: string }> {
  if (!isScanResult(result)) return result.modelReviews.map((review) => ({ reviewer: review.reviewer, provider: review.provider, model: review.model }));
  const runs = [{ ...result.primaryReview, reviewer: "primary" }, ...(result.specialistReview === null ? [] : [{ ...result.specialistReview, reviewer: "specialist" }])];
  return runs.filter((review) => review.status !== "not-started").map(({ reviewer, provider, model }) => ({ reviewer, provider, model }));
}

function evidenceOf(result: ScanResult) {
  return {
    inputManifestSha256: result.assessed.inputManifestSha256,
    sourceInventorySha256: result.assessed.sourceInventorySha256 ?? null,
    templateSha256: result.assessed.templateSha256,
    hasExecution: result.execution !== null,
    artifactCount: result.artifacts.length,
    policyVersion: result.policyVersion,
    runId: result.scan.runId,
    reportSha256: result.scan.reportSha256,
  };
}

/** @throws {never} */
export function sourceInventory(result: ScanResult): string | null {
  return reusableInventory(evidenceOf(result));
}

/** @throws {never} */
export function sameScanEvidence(prior: ScanResult, candidate: ScanResult): boolean {
  return sameEvidence(evidenceOf(prior), evidenceOf(candidate), prior.assessed.repository.toLowerCase(), candidate.assessed.repository.toLowerCase());
}

/** @throws {never} */
export function resultProven(result: RecordedResult): boolean {
  if (resultProblems(result).length > 0) return false;
  if (isScanResult(result)) return dispositionProven(result.disposition, result.confirmation !== null, scanSurfaces.map((surface) => result.coverage[surface].state), scanThreats.map((threat) => result.checks[threat]));
  return dispositionProven(result.disposition, result.confirmation !== null, telemetryChannels.map((channel) => result.telemetry.coverage[channel]), []);
}

/** @throws {never} */
export function storedResult(text: string): RecordedResult | undefined {
  try {
    const parsed = parseResult(JSON.parse(text));
    return parsed.kind === "parsed" ? parsed.result : undefined;
  } catch {
    return undefined;
  }
}
