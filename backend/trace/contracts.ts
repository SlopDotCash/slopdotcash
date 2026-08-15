export const TRACE_CONTENT_TYPES = [
  "text/plain",
  "application/x-ndjson",
] as const;

export const MAX_TRACE_BYTES = 8 * 1024 * 1024;
export const MAX_JSON_BYTES = 64 * 1024;
export const OPERATOR_GRANT_TTL_SECONDS = 60;

export type TraceContentType = (typeof TRACE_CONTENT_TYPES)[number];

export type ApiRole = "contributor" | "project_owner" | "operator";

export type AuthenticatedActor = {
  githubId: string;
  githubLogin: string;
  roles: readonly ApiRole[];
  tokenId: string;
};

export type RunState = "awaiting_trace" | "trace_uploaded" | "finalized";

export type TraceRun = {
  id: string;
  clientRunId: string;
  githubId: string;
  githubLogin: string;
  projectId: string;
  repository: string;
  projectPolicyRevision: string;
  provider: string;
  model: string;
  client: string;
  clientVersion: string;
  state: RunState;
  traceSha256: string | null;
  createdAt: string;
  finalizedAt: string | null;
};

export type TraceObject = {
  sha256: string;
  key: string;
  sizeBytes: number;
  contentType: TraceContentType;
  createdByGithubId: string;
  createdAt: string;
};

export const RUN_EVENT_KINDS = [
  "run_started",
  "task_selected",
  "work_started",
  "checkpoint",
  "pull_request_opened",
  "review_requested",
  "merged",
  "run_completed",
  "run_failed",
] as const;

export type RunEventKind = (typeof RUN_EVENT_KINDS)[number];

export type RunProgressEvent = {
  id: string;
  runId: string;
  githubId: string;
  kind: RunEventKind;
  occurredAt: string;
  source: "agent" | "github";
  githubObjectId: string | null;
  githubUrl: string | null;
  headSha: string | null;
  createdAt: string;
};

export type CreateRunInput = Omit<
  TraceRun,
  "id" | "state" | "traceSha256" | "createdAt" | "finalizedAt"
> & {
  id: string;
  idempotencyKey: string;
  createdAt: string;
};

export type AttachTraceInput = {
  runId: string;
  githubId: string;
  idempotencyKey: string;
  object: TraceObject;
};

export type TraceUploadIntent = {
  tokenHash: string;
  runId: string;
  githubId: string;
  sha256: string;
  sizeBytes: number;
  contentType: TraceContentType;
  idempotencyKey: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

export type CreateGrantInput = {
  tokenHash: string;
  traceSha256: string;
  operatorGithubId: string;
  reason: string;
  requestId: string;
  createdAt: string;
  expiresAt: string;
};

export type AuditInput = {
  id: string;
  actorGithubId: string;
  action: string;
  target: string;
  requestId: string;
  createdAt: string;
  details: Record<string, string | number | boolean | null>;
};

export type WalletClaim = {
  id: string;
  githubId: string;
  githubLogin: string;
  walletAddress: string;
  source: "github_issue" | "profile_readme" | "d1_fallback";
  issueRepository: string | null;
  issueNumber: number | null;
  sourceBodySha256: string;
  observedAt: string;
  recordSha256: string;
  supersedesClaimId: string | null;
  createdAt: string;
};

export type PersistenceResult<T> =
  | { status: "created"; value: T }
  | { status: "existing"; value: T }
  | { status: "conflict" };

export interface TracePersistence {
  createRun(input: CreateRunInput): Promise<PersistenceResult<TraceRun>>;
  getRun(runId: string): Promise<TraceRun | null>;
  attachTrace(input: AttachTraceInput): Promise<PersistenceResult<TraceRun>>;
  finalizeRun(
    runId: string,
    githubId: string,
    finalizedAt: string,
  ): Promise<TraceRun | null>;
  appendEvent(
    event: RunProgressEvent & { idempotencyKey: string },
  ): Promise<PersistenceResult<RunProgressEvent>>;
  getTraceObject(sha256: string): Promise<TraceObject | null>;
  createUploadIntent(
    intent: TraceUploadIntent,
  ): Promise<PersistenceResult<TraceUploadIntent>>;
  consumeUploadIntent(
    tokenHash: string,
    now: string,
  ): Promise<TraceUploadIntent | null>;
  putTraceBytes(object: TraceObject, bytes: Uint8Array): Promise<void>;
  createReadGrant(input: CreateGrantInput): Promise<void>;
  consumeReadGrant(
    tokenHash: string,
    traceSha256: string,
    operatorGithubId: string,
    now: string,
  ): Promise<boolean>;
  readTraceBytes(
    object: TraceObject,
  ): Promise<ReadableStream<Uint8Array> | Uint8Array | null>;
  writeAudit(input: AuditInput): Promise<void>;
  createWalletClaim(
    claim: WalletClaim,
  ): Promise<PersistenceResult<WalletClaim>>;
  getWalletClaim(claimId: string): Promise<WalletClaim | null>;
}
