/** Signed runner client. Returned bytes must remain in private evidence storage. */

import { isRecord, readLimitedBody } from "../../backend/trace/validation";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import type { QueueConnection } from "./queue";
import { signedServiceHeaders } from "./service";

export type ArtifactInterpreter = "shell" | "python" | "node" | "binary";
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

export async function runIsolatedArtifact(input: {
  connection: QueueConnection;
  bytes: Uint8Array;
  interpreter: ArtifactInterpreter;
}): Promise<{ evidence: IsolatedArtifactEvidence; bytes: Uint8Array }> {
  const { connection, interpreter } = input;
  const origin = new URL(connection.origin);
  if (
    origin.origin !== connection.origin ||
    origin.username ||
    origin.password ||
    (origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && origin.hostname === "127.0.0.1"))
  )
    throw new Error("An HTTPS service origin is required");
  if (!input.bytes.length || input.bytes.length > 2 * 1024 * 1024)
    throw new Error("Artifact size is outside the execution limit");
  const artifactSha256 = await sha256Hex(input.bytes);
  const body = new TextEncoder().encode(
    JSON.stringify({
      artifactBase64: Buffer.from(input.bytes).toString("base64"),
      artifactSha256,
      interpreter,
    }),
  );
  const path = "/api/v1/vetting/sandbox";
  const response = await (connection.fetch ?? fetch)(
    `${origin.origin}${path}`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
      headers: {
        "content-type": "application/json",
        ...(await signedServiceHeaders({
          signer: connection,
          method: "POST",
          pathAndQuery: path,
          body,
          at: connection.now?.(),
        })),
      },
      body,
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Isolated execution unavailable (${response.status})`);
  }
  const bytes = await readLimitedBody(response, 180 * 1024);
  const evidence: unknown = JSON.parse(new TextDecoder().decode(bytes));
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
    evidence.artifactSha256 !== artifactSha256 ||
    evidence.interpreter !== interpreter ||
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
    const decoded = Buffer.from(output, "base64");
    if (decoded.length > 65536 || decoded.toString("base64") !== output)
      throw new Error("Invalid isolated execution output");
  }
  return { evidence: evidence as IsolatedArtifactEvidence, bytes };
}
