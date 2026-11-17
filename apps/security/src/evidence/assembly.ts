// spec/security/evidence.md, "Successful admission stays permanent and ordinary evidence waits ninety days"

export type AssemblyRecord = Record<string, unknown>;

export interface QueuedAssessment {
  readonly assessmentId: string;
  readonly projectId: string;
  readonly revision: number;
  readonly manifestSha256: string;
  readonly commitSha: string;
  readonly templateSha256: string;
}

export interface AssemblyFile {
  readonly role: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface AssemblyManifest {
  readonly schema: "slop-evidence-assembly-v1";
  readonly assessment: QueuedAssessment;
  readonly queuedInputsSha256: string;
  readonly reviewInputSha256: string;
  readonly files: ReadonlyArray<AssemblyFile>;
  readonly runtimeOverlaySha256: string;
  readonly state: "incomplete";
  readonly providerCallsAuthorized: false;
  readonly publicationAuthorized: false;
  readonly visibilityGaps: ReadonlyArray<string>;
}

export interface ProvenanceFile {
  readonly sha256: string;
  readonly bytes: number;
  readonly executable: boolean | null;
}

export interface ProvenanceReport {
  readonly source: { readonly repository: string; readonly commitSha: string; readonly treeSha: string };
  readonly inputs: ReadonlyArray<{ readonly role: string; readonly sha256: string; readonly bytes: number }>;
  readonly changes: ReadonlyArray<{ readonly path: string; readonly disposition: string; readonly source: ProvenanceFile | null; readonly release: ProvenanceFile | null }>;
  readonly visibilityGaps: ReadonlyArray<string>;
  readonly sourceVisibilityGaps: ReadonlyArray<string>;
}

const hex = /^[a-f0-9]{64}$/u;

/** @throws {Error} */
export function assemblyRecord(value: unknown): AssemblyRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid canonical assembly record");
  return value as AssemblyRecord;
}

/** @throws {Error} */
function fields(value: AssemblyRecord, keys: ReadonlyArray<string>): void {
  if (Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error("Unexpected canonical assembly fields");
}

/** @throws {Error} */
function digest(value: unknown): string {
  if (typeof value !== "string" || !hex.test(value)) throw new Error("Invalid canonical assembly digest");
  return value;
}

/** @throws {Error} */
export function assemblyAssessment(value: unknown): QueuedAssessment {
  const a = assemblyRecord(value);
  fields(a, ["assessmentId", "projectId", "revision", "manifestSha256", "commitSha", "templateSha256"]);
  if (
    typeof a.assessmentId !== "string" || !/^vet_[a-f0-9]{32}$/u.test(a.assessmentId) ||
    typeof a.projectId !== "string" || !/^[a-z0-9][a-z0-9-]{0,47}$/u.test(a.projectId) ||
    !Number.isSafeInteger(a.revision) || Number(a.revision) < 1 ||
    typeof a.commitSha !== "string" || !/^[a-f0-9]{40}$/u.test(a.commitSha)
  ) throw new Error("Invalid canonical assessment binding");
  return {
    assessmentId: a.assessmentId,
    projectId: a.projectId,
    revision: Number(a.revision),
    manifestSha256: digest(a.manifestSha256),
    commitSha: a.commitSha,
    templateSha256: digest(a.templateSha256),
  };
}

/** @throws {Error} */
export function parseAssemblyManifest(value: unknown): AssemblyManifest {
  const m = assemblyRecord(value);
  fields(m, ["schema", "assessment", "queuedInputsSha256", "reviewInputSha256", "files", "runtimeOverlaySha256", "state", "providerCallsAuthorized", "publicationAuthorized", "visibilityGaps"]);
  if (
    m.schema !== "slop-evidence-assembly-v1" || m.state !== "incomplete" ||
    m.providerCallsAuthorized !== false || m.publicationAuthorized !== false ||
    !Array.isArray(m.files) || m.files.length === 0 || m.files.length > 4096 ||
    !Array.isArray(m.visibilityGaps) || m.visibilityGaps.length > 100 ||
    m.visibilityGaps.some((gap) => typeof gap !== "string" || !gap || gap.length > 512)
  ) throw new Error("Unsupported canonical assembly state or authority");
  const roles = new Set<string>();
  const files = m.files.map((entry): AssemblyFile => {
    const file = assemblyRecord(entry);
    fields(file, ["role", "sha256", "bytes"]);
    if (typeof file.role !== "string" || !file.role || file.role.length > 200 || roles.has(file.role) || !Number.isSafeInteger(file.bytes) || Number(file.bytes) < 0)
      throw new Error("Invalid canonical assembly file");
    roles.add(file.role);
    return { role: file.role, sha256: digest(file.sha256), bytes: Number(file.bytes) };
  });
  return {
    schema: "slop-evidence-assembly-v1",
    assessment: assemblyAssessment(m.assessment),
    queuedInputsSha256: digest(m.queuedInputsSha256),
    reviewInputSha256: digest(m.reviewInputSha256),
    files,
    runtimeOverlaySha256: digest(m.runtimeOverlaySha256),
    state: "incomplete",
    providerCallsAuthorized: false,
    publicationAuthorized: false,
    visibilityGaps: m.visibilityGaps as string[],
  };
}

/** @throws {Error} */
function provenanceDigest(value: unknown): string {
  if (typeof value !== "string" || !hex.test(value)) throw new Error("Invalid provenance digest");
  return value;
}

/** @throws {Error} */
function provenanceSize(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("Invalid provenance size");
  return Number(value);
}

/** @throws {Error} */
function gaps(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1024 || value.some((item) => typeof item !== "string" || item.length > 256))
    throw new Error("Invalid provenance coverage");
  return value as string[];
}

/** @throws {Error} */
function provenanceFile(value: unknown): ProvenanceFile | null {
  if (value === null) return null;
  const row = assemblyRecord(value);
  if (row.executable !== null && typeof row.executable !== "boolean") throw new Error("Invalid provenance mode");
  return { sha256: provenanceDigest(row.sha256), bytes: provenanceSize(row.bytes), executable: row.executable as boolean | null };
}

/** @throws {never} */
function unsafePath(path: string, forbidden: ReadonlyArray<string>): boolean {
  return Array.from(path).some((character) => forbidden.includes(character) || character.charCodeAt(0) < 32) ||
    path.split("/").some((part) => !part || part === "." || part === "..");
}

/** @throws {Error} */
export function parseProvenanceReport(value: unknown): ProvenanceReport {
  const report = assemblyRecord(value);
  const source = assemblyRecord(report.source);
  if (
    report.schema !== "slop-provenance-comparison-v1" || report.state !== "quarantined" ||
    report.executionAuthorized !== false || report.publicationAuthorized !== false ||
    typeof source.repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(source.repository) ||
    typeof source.commitSha !== "string" || !/^[a-f0-9]{40}$/u.test(source.commitSha) ||
    typeof source.treeSha !== "string" || !/^[a-f0-9]{40}$/u.test(source.treeSha) ||
    !Array.isArray(report.inputs) || report.inputs.length !== 3 ||
    !Array.isArray(report.changes) || report.changes.length > 2048
  ) throw new Error("Unsupported provenance report");
  const roles = ["source-inventory", "source-archive", "release-archive"];
  const inputs = report.inputs.map((entry, index) => {
    const input = assemblyRecord(entry);
    if (input.role !== roles[index]) throw new Error("Invalid provenance input role");
    const bytes = provenanceSize(input.bytes);
    if (bytes > (index === 0 ? 2 : 32) * 1024 * 1024) throw new Error("Provenance input exceeds bound");
    return { role: roles[index] ?? "", sha256: provenanceDigest(input.sha256), bytes };
  });
  const paths = new Set<string>();
  const changes = report.changes.map((entry) => {
    const change = assemblyRecord(entry);
    const path = change.path;
    if (typeof path !== "string" || !path || path.length > 1024 || unsafePath(path, ["\\", ":"]) || paths.has(path))
      throw new Error("Invalid provenance path");
    paths.add(path);
    const before = provenanceFile(change.source);
    const after = provenanceFile(change.release);
    if ((!before && !after) || (before && before.executable === null)) throw new Error("Invalid provenance comparison");
    const disposition = !before ? "added"
      : !after ? "removed"
      : before.sha256 !== after.sha256 ? "changed"
      : after.executable === null ? "metadata-unavailable"
      : before.executable !== after.executable ? "mode-changed"
      : "identical-bytes-and-executable-bit";
    if (change.disposition !== disposition || (before && after && before.sha256 === after.sha256 && before.bytes !== after.bytes))
      throw new Error("Provenance disposition mismatch");
    return { path, disposition, source: before, release: after };
  });
  return {
    source: { repository: source.repository, commitSha: source.commitSha, treeSha: source.treeSha },
    inputs,
    changes,
    visibilityGaps: gaps(report.visibilityGaps),
    sourceVisibilityGaps: gaps(report.sourceVisibilityGaps),
  };
}

/** @throws {Error} */
export function bindProvenanceSource(report: ProvenanceReport, sourceValue: unknown, inventorySha256: string): void {
  const source = assemblyRecord(sourceValue);
  if (
    source.schema !== "slop-source-inventory-v1" || source.state !== "quarantined" ||
    source.repository !== report.source.repository || source.commitSha !== report.source.commitSha ||
    source.treeSha !== report.source.treeSha || report.inputs[0]?.sha256 !== inventorySha256 ||
    !Array.isArray(source.records) ||
    JSON.stringify(gaps(source.visibilityGaps)) !== JSON.stringify(report.sourceVisibilityGaps)
  ) throw new Error("Provenance source identity mismatch");
  const compared = new Map(report.changes.flatMap((change) => change.source ? [[change.path, change.source] as const] : []));
  if (source.records.length !== compared.size) throw new Error("Provenance source inventory mismatch");
  for (const entry of source.records) {
    const record = assemblyRecord(entry);
    const observed = compared.get(String(record.path));
    if (
      !observed || record.type !== "blob" || record.state !== "quarantined" ||
      (record.mode !== "100644" && record.mode !== "100755") ||
      record.sha256 !== observed.sha256 || record.bytes !== observed.bytes ||
      (record.mode === "100755") !== observed.executable
    ) throw new Error("Provenance source bytes or mode mismatch");
    compared.delete(String(record.path));
  }
  if (compared.size) throw new Error("Provenance source inventory mismatch");
}

/** @throws {Error} */
export function assertFilesystemReferences(document: AssemblyRecord, sizes: ReadonlyMap<string, number>): void {
  if (
    !Array.isArray(document.phases) ||
    JSON.stringify(document.phases.map((phase) => assemblyRecord(phase).phase)) !== JSON.stringify(["before-command", "after-traced-command", "after-post-collector-probe"])
  ) throw new Error("Missing filesystem phases");
  for (const value of document.phases) {
    const phase = assemblyRecord(value);
    if (!Array.isArray(phase.entries) || phase.entries.length > 256) throw new Error("Invalid filesystem entries");
    const names = new Set<string>();
    for (const item of phase.entries) {
      const entry = assemblyRecord(item);
      if (typeof entry.path !== "string" || !entry.path || new TextEncoder().encode(entry.path).length > 2048 || unsafePath(entry.path, ["\\"]) || names.has(entry.path))
        throw new Error("Invalid filesystem entry path");
      names.add(entry.path);
      if (
        (entry.sha256 !== undefined || entry.capturedBytes !== undefined || entry.stable === true) &&
        (entry.kind !== "file" || typeof entry.sha256 !== "string" || !sizes.has(entry.sha256) || sizes.get(entry.sha256) !== entry.capturedBytes)
      ) throw new Error("Filesystem entry refers to missing content");
    }
  }
}

export type Base64Content = { readonly kind: "invalid" } | { readonly kind: "noncanonical" } | { readonly kind: "decoded"; readonly bytes: Uint8Array };

/** @throws {never} */
export function base64Content(encoded: string): Base64Content {
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return { kind: "invalid" };
  }
  if (btoa(binary) !== encoded) return { kind: "noncanonical" };
  return { kind: "decoded", bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)) };
}

/** @throws {Error} */
export function decodedJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
