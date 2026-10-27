/** Signed runner client. Returned bytes must remain in private evidence storage. */

import { readLimitedBody } from "../../backend/trace/validation";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  type ArtifactInterpreter,
  type IsolatedArtifactEvidence,
  parseIsolatedArtifactEvidence,
} from "./isolated-evidence";
import type { QueueConnection } from "./queue";
import { serviceOrigin, signedVettingFetch } from "./service";

export type {
  ArtifactInterpreter,
  IsolatedArtifactEvidence,
} from "./isolated-evidence";

export async function runIsolatedArtifact(input: {
  connection: QueueConnection;
  bytes: Uint8Array;
  interpreter: ArtifactInterpreter;
}): Promise<{ evidence: IsolatedArtifactEvidence; bytes: Uint8Array }> {
  const { connection, interpreter } = input;
  serviceOrigin(connection.origin, true);
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
  const response = await signedVettingFetch(connection, {
    method: "POST",
    path: "/api/v1/vetting/sandbox",
    body,
    contentType: "application/json",
    timeoutMs: 120_000,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Isolated execution unavailable (${response.status})`);
  }
  const bytes = await readLimitedBody(response, 180 * 1024);
  const evidence = parseIsolatedArtifactEvidence(bytes, {
    artifactSha256s: new Set([artifactSha256]),
    interpreter,
  });
  return { evidence, bytes };
}
