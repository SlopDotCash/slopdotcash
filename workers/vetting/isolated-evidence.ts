/** Shared validation of the original bounded runner bytes; never executes them. */
import { isRecord } from "../../backend/trace/validation";

export type ArtifactInterpreter = "python" | "node" | "binary";
export type IsolatedArtifactEvidence = {
  schema: "slop-isolated-artifact-v1";
  runId: string;
  startedAt: string;
  completedAt: string;
  imageSha256: string | null;
  sourceSha: string | null;
  artifactSha256: string;
  interpreter: ArtifactInterpreter;
  internetEnabled: false;
  status: "exited" | "timeout" | "output-limit" | "not-executable";
  exitCode: number;
  stdoutBase64: string;
  stderrBase64: string;
  outputComplete: boolean;
};

export function parseIsolatedArtifactEvidence(
  bytes: Uint8Array,
  expected: {
    artifactSha256s: ReadonlySet<string>;
    interpreter: ArtifactInterpreter;
  },
): IsolatedArtifactEvidence {
  if (bytes.byteLength > 180 * 1024)
    throw new Error("Isolated execution evidence exceeds the limit");
  const evidence: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    !isRecord(evidence) ||
    evidence.schema !== "slop-isolated-artifact-v1" ||
    typeof evidence.runId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(evidence.runId) ||
    typeof evidence.startedAt !== "string" ||
    typeof evidence.completedAt !== "string" ||
    !Number.isFinite(Date.parse(evidence.startedAt)) ||
    !Number.isFinite(Date.parse(evidence.completedAt)) ||
    Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt) ||
    !(
      evidence.imageSha256 === null ||
      (typeof evidence.imageSha256 === "string" &&
        /^[a-f0-9]{64}$/.test(evidence.imageSha256))
    ) ||
    !(
      evidence.sourceSha === null ||
      (typeof evidence.sourceSha === "string" &&
        /^[a-f0-9]{40}$/.test(evidence.sourceSha))
    ) ||
    typeof evidence.artifactSha256 !== "string" ||
    !expected.artifactSha256s.has(evidence.artifactSha256) ||
    evidence.interpreter !== expected.interpreter ||
    evidence.internetEnabled !== false ||
    !["exited", "timeout", "output-limit", "not-executable"].includes(
      String(evidence.status),
    ) ||
    !Number.isSafeInteger(evidence.exitCode) ||
    evidence.outputComplete !== (evidence.status === "exited") ||
    typeof evidence.stdoutBase64 !== "string" ||
    typeof evidence.stderrBase64 !== "string"
  )
    throw new Error("Invalid isolated execution evidence");
  for (const output of [evidence.stdoutBase64, evidence.stderrBase64]) {
    const decoded = atob(output);
    if (decoded.length > 65536 || btoa(decoded) !== output)
      throw new Error("Invalid isolated execution output");
  }
  return evidence as IsolatedArtifactEvidence;
}
