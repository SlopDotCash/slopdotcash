/** Types for the evidence-artifact functions consumed by leaderboard generation. */

export interface EvidenceRow {
  id: string;
  label: string;
}

export interface ArtifactVerificationFinding {
  artifactKind: string;
  contentSha256?: string;
  detail?: string;
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
}

export interface ArtifactPlanOptions {
  allowedArtifactKinds?: readonly string[];
}

export function planReferencedArtifacts(
  body: string,
  requiredRows?: readonly EvidenceRow[],
  options?: ArtifactPlanOptions,
): { referenceCount: number; uniqueArtifactCount: number };

export function verifyReferencedArtifacts(
  body: string,
  requiredRows?: readonly EvidenceRow[],
  options?: ArtifactVerificationOptions,
): Promise<{ ok: boolean; findings: ArtifactVerificationFinding[] }>;
