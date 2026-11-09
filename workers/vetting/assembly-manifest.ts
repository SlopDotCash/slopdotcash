/** The existing assembler's private output contract; retention grants no authority. */

type RecordValue = Record<string, unknown>;
export function assemblyRecord(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid canonical assembly record");
  return value as RecordValue;
}
function fields(value: RecordValue, keys: string[]) {
  if (Object.keys(value).sort().join() !== keys.sort().join())
    throw new Error("Unexpected canonical assembly fields");
}
function digest(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    throw new Error("Invalid canonical assembly digest");
  return value;
}
export function assemblyAssessment(value: unknown): QueuedAssessment {
  const a = assemblyRecord(value);
  fields(a, [
    "assessmentId",
    "projectId",
    "revision",
    "manifestSha256",
    "commitSha",
    "templateSha256",
  ]);
  if (
    typeof a.assessmentId !== "string" ||
    !/^vet_[a-f0-9]{32}$/u.test(a.assessmentId) ||
    typeof a.projectId !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,47}$/u.test(a.projectId) ||
    !Number.isSafeInteger(a.revision) ||
    Number(a.revision) < 1 ||
    typeof a.commitSha !== "string" ||
    !/^[a-f0-9]{40}$/u.test(a.commitSha)
  )
    throw new Error("Invalid canonical assessment binding");
  return {
    assessmentId: a.assessmentId,
    projectId: a.projectId,
    revision: Number(a.revision),
    manifestSha256: digest(a.manifestSha256),
    commitSha: a.commitSha,
    templateSha256: digest(a.templateSha256),
  };
}
export function parseAssemblyManifest(value: unknown) {
  const m = assemblyRecord(value);
  fields(m, [
    "schema",
    "assessment",
    "queuedInputsSha256",
    "reviewInputSha256",
    "files",
    "runtimeOverlaySha256",
    "state",
    "providerCallsAuthorized",
    "publicationAuthorized",
    "visibilityGaps",
  ]);
  if (
    m.schema !== "slop-evidence-assembly-v1" ||
    m.state !== "incomplete" ||
    m.providerCallsAuthorized !== false ||
    m.publicationAuthorized !== false ||
    !Array.isArray(m.files) ||
    m.files.length === 0 ||
    m.files.length > 4096 ||
    !Array.isArray(m.visibilityGaps) ||
    m.visibilityGaps.length > 100 ||
    m.visibilityGaps.some((g) => typeof g !== "string" || !g || g.length > 512)
  )
    throw new Error("Unsupported canonical assembly state or authority");
  const roles = new Set<string>();
  const files = m.files.map((value) => {
    const file = assemblyRecord(value);
    fields(file, ["role", "sha256", "bytes"]);
    if (
      typeof file.role !== "string" ||
      !file.role ||
      file.role.length > 200 ||
      roles.has(file.role) ||
      !Number.isSafeInteger(file.bytes) ||
      Number(file.bytes) < 0
    )
      throw new Error("Invalid canonical assembly file");
    roles.add(file.role);
    return {
      role: file.role,
      sha256: digest(file.sha256),
      bytes: Number(file.bytes),
    };
  });
  return {
    schema: "slop-evidence-assembly-v1" as const,
    assessment: assemblyAssessment(m.assessment),
    queuedInputsSha256: digest(m.queuedInputsSha256),
    reviewInputSha256: digest(m.reviewInputSha256),
    files,
    runtimeOverlaySha256: digest(m.runtimeOverlaySha256),
    state: "incomplete" as const,
    providerCallsAuthorized: false as const,
    publicationAuthorized: false as const,
    visibilityGaps: m.visibilityGaps as string[],
  };
}

export type QueuedAssessment = {
  assessmentId: string;
  projectId: string;
  revision: number;
  manifestSha256: string;
  commitSha: string;
  templateSha256: string;
};
