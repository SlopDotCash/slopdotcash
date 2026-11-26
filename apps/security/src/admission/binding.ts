// spec/security/admission.md, "Evidence durability precedes a clean or malicious publication"; spec/security/evidence.md, "Successful admission stays permanent and ordinary evidence waits ninety days"; spec/security/admission.md, "Risky artifacts run in an isolated sandbox without network or secrets"; spec/security/admission.md, "An assessment is bound to its queued revision, commit and template"
import { type ScanResult, scanSurfaces } from "./result.ts";

const hex = /^[a-f0-9]{64}$/u;
const runPattern = /^[a-f0-9-]{36}$/u;
const sourceShaPattern = /^[a-f0-9]{40}$/u;
const executableFields = ["id", "repositories", "skill", "reviewSkill", "contribution"] as const;
const inventoryBase = ["schemaVersion", "items", "artifacts", "visibilityGaps"] as const;
const reportKeys = ["schemaVersion", "assessmentId", "sourceInventorySha256", "inventorySha256", "findings", "downloads", "execution", "executionEvidenceSha256s", "visibilityGaps", "reviews"];
const surfaceNames: ReadonlyArray<string> = scanSurfaces;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasKeys(value: Record<string, unknown>, keys: ReadonlyArray<string>): boolean {
  return Object.keys(value).sort().join() === [...keys].sort().join();
}

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

/** @throws {never} */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** @throws {never} */
export function executableContent(manifest: Record<string, unknown>): string {
  return canonicalJson(Object.fromEntries(executableFields.filter((field) => Object.hasOwn(manifest, field)).map((field) => [field, manifest[field]])));
}

/** @throws {never} */
export function jsonDocument(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function reportEvidence(report: unknown, result: ScanResult, assessmentId: string): ReadonlyArray<string> | undefined {
  if (!isRecord(report) || !hasKeys(report, reportKeys)) return undefined;
  const listed = report.executionEvidenceSha256s;
  if (
    report.schemaVersion !== "slop-scan-report-v2"
    || report.assessmentId !== assessmentId
    || report.sourceInventorySha256 !== result.assessed.sourceInventorySha256
    || report.inventorySha256 !== result.assessed.inputManifestSha256
    || JSON.stringify(report.execution) !== JSON.stringify(result.execution)
    || !Array.isArray(listed)
    || listed.length > 500
    || (result.execution !== null && listed.length === 0)
  ) return undefined;
  const digests: string[] = [];
  for (const sha of listed as ReadonlyArray<unknown>) {
    if (typeof sha !== "string" || !hex.test(sha) || digests.includes(sha)) return undefined;
    digests.push(sha);
  }
  return digests;
}

export interface ExecutionItem {
  readonly artifactSha256: string;
  readonly runId: string;
  readonly text: string;
}

function decodedOutput(value: string): string | undefined {
  try {
    const binary = atob(value);
    if (binary.length > 65536 || btoa(binary) !== value) return undefined;
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function executionItem(bytes: Uint8Array, requested: ReadonlySet<string>, result: ScanResult): ExecutionItem | undefined {
  if (bytes.byteLength > 180 * 1024 || result.execution === null) return undefined;
  const evidence = jsonDocument(bytes);
  if (
    !isRecord(evidence)
    || evidence.schema !== "slop-isolated-artifact-v1"
    || typeof evidence.runId !== "string" || !runPattern.test(evidence.runId)
    || typeof evidence.startedAt !== "string" || typeof evidence.completedAt !== "string"
    || !Number.isFinite(Date.parse(evidence.startedAt)) || !Number.isFinite(Date.parse(evidence.completedAt))
    || Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt)
    || !(evidence.imageSha256 === null || (typeof evidence.imageSha256 === "string" && hex.test(evidence.imageSha256)))
    || !(evidence.sourceSha === null || (typeof evidence.sourceSha === "string" && sourceShaPattern.test(evidence.sourceSha)))
    || typeof evidence.artifactSha256 !== "string" || !requested.has(evidence.artifactSha256)
    || evidence.interpreter !== "binary"
    || evidence.internetEnabled !== false
    || !["exited", "timeout", "output-limit", "not-executable"].includes(String(evidence.status))
    || typeof evidence.exitCode !== "number" || !Number.isSafeInteger(evidence.exitCode)
    || evidence.outputComplete !== (evidence.status === "exited")
    || typeof evidence.stdoutBase64 !== "string" || typeof evidence.stderrBase64 !== "string"
  ) return undefined;
  const stdout = decodedOutput(evidence.stdoutBase64);
  const stderr = decodedOutput(evidence.stderrBase64);
  if (
    stdout === undefined || stderr === undefined
    || evidence.imageSha256 !== result.execution.imageSha256
    || evidence.sourceSha === null
    || evidence.outputComplete !== true
    || evidence.exitCode !== 0
    || Date.parse(evidence.startedAt) < Date.parse(result.execution.startedAt)
    || Date.parse(evidence.completedAt) > Date.parse(result.execution.completedAt)
  ) return undefined;
  return { artifactSha256: evidence.artifactSha256, runId: evidence.runId, text: JSON.stringify({ ...evidence, stdout, stderr }) };
}

function validClassifications(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  let previousPath = "";
  for (const row of value as ReadonlyArray<unknown>) {
    if (!isRecord(row) || !hasKeys(row, ["path", "surfaces"]) || !isText(row.path, 1024) || row.path <= previousPath || !Array.isArray(row.surfaces)) return false;
    const surfaces = row.surfaces as ReadonlyArray<unknown>;
    if (surfaces.length === 0 || surfaces.some((surface, index) => typeof surface !== "string" || !surfaceNames.includes(surface) || (index > 0 && surface <= String(surfaces[index - 1])))) return false;
    previousPath = row.path;
  }
  return true;
}

const artifactFields = ["sha256", "parentSha256", "origin", "path", "type"] as const;

/** @throws {never} */
export function inventoryBinds(source: unknown, final: unknown, result: Pick<ScanResult, "artifacts">, items: ReadonlyArray<{ readonly id: string; readonly text: string; readonly sha256: string }>): boolean {
  if (!isRecord(source) || !isRecord(final)) return false;
  const classified = Object.hasOwn(source, "classifications");
  const policyBound = Object.hasOwn(source, "rulePolicySha256");
  const imaged = Object.hasOwn(source, "media");
  const keys = [...inventoryBase, ...(classified ? ["classifications"] : []), ...(policyBound ? ["rulePolicySha256"] : []), ...(imaged ? ["media"] : [])];
  if (!hasKeys(source, keys) || !hasKeys(final, keys)) return false;
  if (classified && (!validClassifications(source.classifications) || JSON.stringify(source.classifications) !== JSON.stringify(final.classifications))) return false;
  if (policyBound && (!classified || typeof source.rulePolicySha256 !== "string" || !hex.test(source.rulePolicySha256) || source.rulePolicySha256 !== final.rulePolicySha256)) return false;
  if (imaged && (!Array.isArray(source.media) || source.media.length === 0 || JSON.stringify(source.media) !== JSON.stringify(final.media))) return false;
  if (source.schemaVersion !== "slop-scan-inventory-v2" || final.schemaVersion !== source.schemaVersion) return false;
  if (!Array.isArray(source.items) || !Array.isArray(final.items) || JSON.stringify(final.items) !== JSON.stringify([...(source.items as ReadonlyArray<unknown>), ...items])) return false;
  const sourceArtifacts = source.artifacts;
  if (!Array.isArray(sourceArtifacts) || !Array.isArray(final.artifacts) || sourceArtifacts.length !== result.artifacts.length) return false;
  const listed = sourceArtifacts as ReadonlyArray<unknown>;
  if (listed.some((artifact, index) => !isRecord(artifact) || artifactFields.some((field) => artifact[field] !== result.artifacts[index]?.[field]))) return false;
  if (JSON.stringify(sourceArtifacts) !== JSON.stringify(final.artifacts)) return false;
  if (!Array.isArray(source.visibilityGaps) || !Array.isArray(final.visibilityGaps) || final.visibilityGaps.length !== 0) return false;
  return JSON.stringify((final.visibilityGaps as ReadonlyArray<unknown>).slice(0, source.visibilityGaps.length)) === JSON.stringify(source.visibilityGaps);
}
