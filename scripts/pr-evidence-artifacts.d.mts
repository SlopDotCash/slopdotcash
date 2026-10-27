/** Types for artifact planning and verification consumed by ingestion. */

export interface EvidenceRow {
  id: string;
  label: string;
}

export interface ArtifactVerificationFinding {
  artifactKind: string;
  contentSha256?: string;
  detail?: string;
  /** Numeric response status, set only for `artifact-http-error`. */
  httpStatus?: number;
  id: string;
  label: string;
  status: string;
  url: string;
}

export interface ArtifactVerificationOptions {
  allowedArtifactKinds?: readonly string[];
  concurrency?: number;
  contentDigestLimitBytes?: number;
  fetchImpl?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  timeoutMs?: number;
  token?: string;
  /** Extra fetches of one artifact after a transport failure (0 to 5). */
  transientRetries?: number;
  /** Linear backoff unit between those fetches, in milliseconds. */
  transientRetryDelayMs?: number;
}

export interface ArtifactPlanOptions {
  allowedArtifactKinds?: readonly string[];
}

export function planReferencedArtifacts(
  body: string,
  requiredRows?: readonly EvidenceRow[],
  options?: ArtifactPlanOptions,
): { referenceCount: number; uniqueArtifactCount: number };

/** True for a timeout, a network error, or HTTP 408, 429 or 5xx. */
export function isTransientArtifactFailure(result: {
  status: string;
  httpStatus?: number;
}): boolean;

export function verifyReferencedArtifacts(
  body: string,
  requiredRows?: readonly EvidenceRow[],
  options?: ArtifactVerificationOptions,
): Promise<{ ok: boolean; findings: ArtifactVerificationFinding[] }>;
