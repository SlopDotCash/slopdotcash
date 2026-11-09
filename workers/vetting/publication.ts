/**
 * Trusted, operator-side reconciliation and one-attempt publication.
 * Never import this module into a guest or give a model its signing capability.
 */
import { MAX_VETTING_RESULT_BYTES } from "../../backend/vetting/result";
import {
  parseRecordedVettingResult,
  recordedResultProblems,
} from "../../backend/vetting/scan-result";
import { readBoundedJson } from "../../src/lib/browser-json";
import { sha256Hex as sha256 } from "../../src/lib/sha256";
import {
  filePublicationJournal,
  type PublicationJournal,
} from "./publication-journal";
import {
  serviceOrigin,
  signedServiceHeaders,
  type VettingServiceSigner,
} from "./service";

/**
 * Explicitly publish reviewed bytes once. A private journal prevents a blind
 * retry after a lost response. An operator must reconcile uncertain outcomes.
 */
export async function publishResult(input: {
  origin: string;
  body: string;
  approvedSha256: string;
  signer: VettingServiceSigner;
  /** Existing operator-private directory outside all guest/shared mounts. */
  journalDirectory: string;
  journal?: PublicationJournal;
  at?: Date;
  fetch?: typeof fetch;
}) {
  // The caller retains this configuration while signing, reservation and
  // response reads await. Bind every stage to one approved publication.
  const {
    body,
    approvedSha256,
    signer,
    journal: configuredJournal,
    journalDirectory,
    at,
  } = input;
  const origin = serviceOrigin(input.origin);
  const fetcher = input.fetch ?? fetch;
  const { privateKey, publicKey } = signer;
  const signedAt = at ? new Date(at.getTime()) : undefined;
  // Publishes either a bounded scan result or a historical v1 result.
  const result = parseRecordedVettingResult(JSON.parse(body));
  if (
    Buffer.byteLength(body) > MAX_VETTING_RESULT_BYTES ||
    sha256(body) !== approvedSha256 ||
    JSON.stringify(result) !== body ||
    recordedResultProblems(result).length > 0
  )
    throw new Error("Publication bytes do not match the approved result");
  const journal = configuredJournal ?? filePublicationJournal(journalDirectory);
  const reserve = journal.reserve.bind(journal);
  const complete = journal.complete.bind(journal);
  const path = "/api/v1/vetting/results";
  const headers = await signedServiceHeaders({
    signer: { privateKey, publicKey },
    method: "POST",
    pathAndQuery: path,
    body: new TextEncoder().encode(body),
    at: signedAt,
  });
  const intent = {
    assessmentId: result.assessmentId,
    resultSha256: approvedSha256,
    origin,
    disposition: result.disposition,
  };
  // Atomic durable reservation across processes. Never remove it on failure.
  await reserve({ ...intent });
  let outcome: "accepted" | "rejected" | "unknown" = "unknown";
  let httpStatus: number | null = null;
  try {
    const response = await fetcher(`${origin}${path}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    httpStatus = response.status;
    if (response.status !== 200) {
      // A server failure or conflict can follow a committed write. Only the
      // intake's definite pre-write client rejections prove no acceptance.
      if ([400, 401, 403, 404, 413, 422].includes(response.status))
        outcome = "rejected";
      await response.body?.cancel();
    } else {
      // Check the committed assessment receipt, not only an HTTP success code.
      const receipt = (await readBoundedJson(
        response,
        MAX_VETTING_RESULT_BYTES,
        "Intake receipt",
      )) as { assessment?: Record<string, unknown> };
      if (
        receipt.assessment?.id === result.assessmentId &&
        receipt.assessment?.revision === result.revision &&
        receipt.assessment?.state === result.disposition &&
        receipt.assessment?.commitSha === result.assessed.commitSha &&
        receipt.assessment?.templateSha256 === result.assessed.templateSha256 &&
        receipt.assessment?.policyVersion === result.policyVersion &&
        receipt.assessment?.resultSha256 === approvedSha256
      )
        outcome = "accepted";
    }
  } catch {
    // Do not leak transport errors, credentials or private result content.
  }
  const receipt = { ...intent, outcome, httpStatus };
  await complete({ ...receipt });
  return receipt;
}
