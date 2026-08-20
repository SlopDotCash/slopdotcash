import { isSolanaAddress } from "../../src/lib/wallets";
import { signApiToken, verifyApiToken } from "./auth";
import {
  type ApiRole,
  type AuthenticatedActor,
  MAX_TRACE_BYTES,
  OPERATOR_GRANT_TTL_SECONDS,
  type TracePersistence,
  type TraceUploadIntent,
  type WalletClaim,
} from "./contracts";
import {
  isExactClientIdentifier,
  isExactClientVersion,
  isExactModelIdentifier,
  isExactProviderIdentifier,
  normalizedContentType,
  readJsonObject,
  readTraceBody,
  sha256Hex,
  validEventKind,
  validGitSha,
  validIdempotencyKey,
  validIdentifier,
  validIsoTimestamp,
  validRepository,
  validSha256,
} from "./validation";

export type TraceApiDependencies = {
  persistence: TracePersistence;
  authSecret: string;
  operatorGithubIds: ReadonlySet<string>;
  now: () => Date;
  randomId: () => string;
  verifyIdentityAssertion: (
    assertion: string,
  ) => Promise<{ githubId: string; githubLogin: string } | null>;
};

type ApiError = Error & { status?: number; code?: string };

export const TRACE_API_CONTRACT_VERSION = "private-trace-v1-opaque-hmac-v1";

function fail(status: number, code: string, message: string): never {
  const error: ApiError = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-slop-trace-api-contract": TRACE_API_CONTRACT_VERSION,
    },
  });
}

function requiredString(
  body: Record<string, unknown>,
  name: string,
  validator: (value: unknown) => value is string = validIdentifier,
): string {
  const value = body[name];
  if (!validator(value)) fail(400, "invalid_request", `Invalid ${name}`);
  return value;
}

function optionalString(
  body: Record<string, unknown>,
  name: string,
  validator: (value: unknown) => value is string,
): string | null {
  const value = body[name];
  if (value === undefined || value === null) return null;
  if (!validator(value)) fail(400, "invalid_request", `Invalid ${name}`);
  return value;
}

function idempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key");
  if (!validIdempotencyKey(value)) {
    fail(400, "invalid_idempotency_key", "A valid Idempotency-Key is required");
  }
  return value;
}

function assertWriter(actor: AuthenticatedActor): void {
  if (
    !actor.roles.includes("contributor") &&
    !actor.roles.includes("project_owner") &&
    !actor.roles.includes("operator")
  ) {
    fail(403, "forbidden", "Write access is not permitted");
  }
}

function assertOperator(actor: AuthenticatedActor): void {
  if (!actor.roles.includes("operator")) {
    fail(403, "forbidden", "Operator access is required");
  }
}

async function ensureOwner(
  persistence: TracePersistence,
  actor: AuthenticatedActor,
  runId: string,
) {
  const run = await persistence.getRun(runId);
  if (run === null) fail(404, "not_found", "Run not found");
  // Do not reveal whether another contributor's run exists.
  if (run.githubId !== actor.githubId) fail(404, "not_found", "Run not found");
  return run;
}

function pathParts(request: Request): string[] {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/v1/")) return [];
  return path.slice("/api/v1/".length).split("/").filter(Boolean);
}

function publicWalletClaim(claim: WalletClaim): Record<string, unknown> {
  return {
    schemaVersion: 1,
    claimId: claim.id,
    githubActorId: claim.githubId,
    githubLogin: claim.githubLogin,
    address: claim.walletAddress,
    source: claim.source,
    issueRepository: claim.issueRepository,
    issueNumber: claim.issueNumber,
    sourceBodySha256: claim.sourceBodySha256,
    observedAt: claim.observedAt,
    recordDigest: claim.recordSha256,
    supersedesClaimId: claim.supersedesClaimId,
  };
}

async function readPublicWalletClaim(
  deps: TraceApiDependencies,
  claimId: string,
): Promise<Response> {
  if (!validIdentifier(claimId))
    fail(400, "invalid_request", "Invalid claim id");
  const claim = await deps.persistence.getWalletClaim(claimId);
  if (claim === null) fail(404, "not_found", "Wallet claim not found");
  const response = json(200, publicWalletClaim(claim));
  response.headers.set("cache-control", "public, max-age=31536000, immutable");
  return response;
}

async function readCurrentWalletClaim(
  deps: TraceApiDependencies,
  githubId: string,
): Promise<Response> {
  if (!/^\d+$/u.test(githubId))
    fail(400, "invalid_request", "Invalid GitHub actor id");
  const claim = await deps.persistence.getCurrentWalletClaim(githubId);
  if (claim === null) fail(404, "not_found", "Wallet claim not found");
  const response = json(200, publicWalletClaim(claim));
  response.headers.set("cache-control", "public, max-age=60, must-revalidate");
  return response;
}

async function createContributorWalletClaim(
  request: Request,
  actor: AuthenticatedActor,
  deps: TraceApiDependencies,
): Promise<Response> {
  assertWriter(actor);
  const body = await readJsonObject(request);
  const walletAddress = body.address;
  if (!isSolanaAddress(walletAddress)) {
    fail(400, "invalid_request", "Invalid Solana address");
  }
  const requestedPredecessor = optionalString(
    body,
    "supersedesClaimId",
    validIdentifier,
  );
  const current = await deps.persistence.getCurrentWalletClaim(actor.githubId);
  if (
    (current === null && requestedPredecessor !== null) ||
    (current !== null && requestedPredecessor !== current.id)
  ) {
    fail(
      409,
      "stale_wallet_claim",
      "Wallet claim changed; reload the current claim before submitting",
    );
  }
  if (current?.walletAddress === walletAddress) {
    return json(200, publicWalletClaim(current));
  }

  const observedAt = deps.now().toISOString();
  const declaration = JSON.stringify({
    schemaVersion: 1,
    githubActorId: actor.githubId,
    address: walletAddress,
    supersedesClaimId: requestedPredecessor,
  });
  const sourceBodySha256 = await sha256Hex(
    new TextEncoder().encode(declaration),
  );
  const canonicalRecord = JSON.stringify({
    schemaVersion: 1,
    githubActorId: actor.githubId,
    githubLogin: actor.githubLogin,
    address: walletAddress,
    source: "d1_registry",
    issueRepository: null,
    issueNumber: null,
    sourceBodySha256,
    observedAt,
    supersedesClaimId: requestedPredecessor,
  });
  const claim: WalletClaim = {
    id: deps.randomId(),
    githubId: actor.githubId,
    githubLogin: actor.githubLogin,
    walletAddress,
    source: "d1_registry",
    issueRepository: null,
    issueNumber: null,
    sourceBodySha256,
    observedAt,
    recordSha256: await sha256Hex(new TextEncoder().encode(canonicalRecord)),
    supersedesClaimId: requestedPredecessor,
    createdAt: observedAt,
  };
  const result = await deps.persistence.createWalletClaim(claim);
  if (result.status === "conflict") {
    fail(
      409,
      "stale_wallet_claim",
      "Wallet claim changed; reload the current claim before submitting",
    );
  }
  await deps.persistence.writeAudit({
    id: deps.randomId(),
    actorGithubId: actor.githubId,
    action: "wallet_claim.created",
    target: `wallet-claim:${result.value.id}`,
    requestId: deps.randomId(),
    createdAt: observedAt,
    details: {
      recordDigest: result.value.recordSha256,
      supersedesClaimId: result.value.supersedesClaimId,
    },
  });
  return json(
    result.status === "created" ? 201 : 200,
    publicWalletClaim(result.value),
  );
}

async function createFallbackWalletClaim(
  request: Request,
  actor: AuthenticatedActor,
  deps: TraceApiDependencies,
): Promise<Response> {
  assertOperator(actor);
  const body = await readJsonObject(request);
  const githubId = body.githubActorId;
  const githubLogin = body.githubLogin;
  const walletAddress = body.address;
  if (typeof githubId !== "string" || !/^\d+$/u.test(githubId)) {
    fail(400, "invalid_request", "Invalid githubActorId");
  }
  if (
    typeof githubLogin !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(githubLogin)
  ) {
    fail(400, "invalid_request", "Invalid githubLogin");
  }
  if (typeof walletAddress !== "string" || !isSolanaAddress(walletAddress)) {
    fail(400, "invalid_request", "Invalid Solana address");
  }
  const observedAt = requiredString(body, "observedAt", validIsoTimestamp);
  const sourceBodySha256 = requiredString(
    body,
    "sourceBodySha256",
    validSha256,
  );
  const supersedesClaimId = optionalString(
    body,
    "supersedesClaimId",
    validIdentifier,
  );
  if (
    body.source !== undefined &&
    body.source !== "github_issue" &&
    body.source !== "d1_registry"
  ) {
    fail(400, "invalid_request", "Invalid wallet claim source");
  }
  const source =
    body.source === "github_issue" ? "github_issue" : "d1_registry";
  const issueRepository =
    source === "github_issue" &&
    body.issueRepository === "SlopDotCash/slopdotcash"
      ? body.issueRepository
      : null;
  const issueNumber =
    source === "github_issue" &&
    Number.isSafeInteger(body.issueNumber) &&
    Number(body.issueNumber) > 0
      ? Number(body.issueNumber)
      : null;
  if (
    source === "github_issue" &&
    (issueRepository === null || issueNumber === null)
  ) {
    fail(400, "invalid_request", "Invalid GitHub issue source");
  }
  const canonicalRecord = JSON.stringify({
    schemaVersion: 1,
    githubActorId: githubId,
    githubLogin,
    address: walletAddress,
    source,
    issueRepository,
    issueNumber,
    sourceBodySha256,
    observedAt,
    supersedesClaimId,
  });
  const claim: WalletClaim = {
    id: deps.randomId(),
    githubId,
    githubLogin,
    walletAddress,
    source,
    issueRepository,
    issueNumber,
    sourceBodySha256,
    observedAt,
    recordSha256: await sha256Hex(new TextEncoder().encode(canonicalRecord)),
    supersedesClaimId,
    createdAt: deps.now().toISOString(),
  };
  const result = await deps.persistence.createWalletClaim(claim);
  if (result.status === "conflict")
    fail(409, "claim_conflict", "Wallet claim conflicts");
  await deps.persistence.writeAudit({
    id: deps.randomId(),
    actorGithubId: actor.githubId,
    action:
      source === "github_issue"
        ? "wallet_claim.historical_issue_migrated"
        : "wallet_claim.operator_recovery_created",
    target: `wallet-claim:${result.value.id}`,
    requestId: deps.randomId(),
    createdAt: deps.now().toISOString(),
    details: {
      githubActorId: result.value.githubId,
      recordDigest: result.value.recordSha256,
    },
  });
  return json(
    result.status === "created" ? 201 : 200,
    publicWalletClaim(result.value),
  );
}

async function exchangeIdentityAssertion(
  request: Request,
  deps: TraceApiDependencies,
): Promise<Response> {
  const assertion = request.headers.get("x-slop-identity-assertion") ?? "";
  if (!/^[A-Za-z0-9._~-]{32,2048}$/u.test(assertion)) {
    fail(401, "unauthorized", "Identity authentication failed");
  }
  const identity = await deps.verifyIdentityAssertion(assertion);
  if (identity === null)
    fail(401, "unauthorized", "Identity authentication failed");
  const issuedAt = Math.floor(deps.now().getTime() / 1000);
  const expiresAt = issuedAt + 10 * 60;
  // Contributor OAuth assertions never confer operator authority. Operator
  // tokens belong to the separate operator identity path and are additionally
  // checked against operatorGithubIds when they are presented.
  const roles: ApiRole[] = ["contributor"];
  const token = await signApiToken(
    {
      iss: "slop.cash",
      aud: "private-trace-api",
      sub: `github:${identity.githubId}`,
      githubId: identity.githubId,
      githubLogin: identity.githubLogin,
      roles,
      iat: issuedAt,
      exp: expiresAt,
      jti: deps.randomId(),
    },
    deps.authSecret,
  );
  return json(200, {
    token,
    tokenType: "Bearer",
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  });
}

async function createRun(
  request: Request,
  actor: AuthenticatedActor,
  deps: TraceApiDependencies,
): Promise<Response> {
  assertWriter(actor);
  const body = await readJsonObject(request);
  const now = deps.now().toISOString();
  const result = await deps.persistence.createRun({
    id: deps.randomId(),
    clientRunId: requiredString(body, "clientRunId"),
    githubId: actor.githubId,
    githubLogin: actor.githubLogin,
    projectId: requiredString(body, "projectId"),
    repository: requiredString(body, "repository", validRepository),
    projectPolicyRevision: requiredString(
      body,
      "projectPolicyRevision",
      validGitSha,
    ),
    provider: requiredString(body, "provider", isExactProviderIdentifier),
    model: requiredString(body, "model", isExactModelIdentifier),
    client: requiredString(body, "client", isExactClientIdentifier),
    clientVersion: requiredString(body, "clientVersion", isExactClientVersion),
    idempotencyKey: idempotencyKey(request),
    createdAt: now,
  });
  if (result.status === "conflict") {
    fail(409, "idempotency_conflict", "Idempotency key was reused");
  }
  return json(result.status === "created" ? 201 : 200, {
    serverRunId: result.value.id,
    clientRunId: result.value.clientRunId,
    state: result.value.state,
  });
}

async function deriveUploadCapability(
  secret: string,
  actor: AuthenticatedActor,
  runId: string,
  idempotency: string,
  digest: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(
        `trace-upload:v1:${actor.githubId}:${runId}:${idempotency}:${digest}`,
      ),
    ),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function createTraceIntent(
  request: Request,
  actor: AuthenticatedActor,
  deps: TraceApiDependencies,
  runId: string,
): Promise<Response> {
  assertWriter(actor);
  const intentIdempotencyKey = idempotencyKey(request);
  const run = await ensureOwner(deps.persistence, actor, runId);
  if (run.state === "finalized") {
    fail(409, "run_finalized", "A finalized run cannot be changed");
  }
  const body = await readJsonObject(request);
  const sha256 = requiredString(body, "sha256", validSha256);
  const sizeBytes = body.sizeBytes;
  if (
    typeof sizeBytes !== "number" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 1 ||
    sizeBytes > MAX_TRACE_BYTES
  ) {
    fail(400, "invalid_request", `sizeBytes must be 1-${MAX_TRACE_BYTES}`);
  }
  if (typeof body.contentType !== "string") {
    fail(400, "invalid_request", "Invalid contentType");
  }
  let contentType: TraceUploadIntent["contentType"];
  try {
    contentType = normalizedContentType(body.contentType);
  } catch {
    fail(415, "unsupported_media_type", "Trace must be UTF-8 text or NDJSON");
  }
  const capability = await deriveUploadCapability(
    deps.authSecret,
    actor,
    runId,
    intentIdempotencyKey,
    sha256,
  );
  const tokenHash = await sha256Hex(new TextEncoder().encode(capability));
  const createdAt = deps.now();
  const result = await deps.persistence.createUploadIntent({
    tokenHash,
    runId,
    githubId: actor.githubId,
    sha256,
    sizeBytes,
    contentType,
    idempotencyKey: intentIdempotencyKey,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + 5 * 60 * 1000).toISOString(),
    consumedAt: null,
  });
  if (result.status === "conflict") {
    fail(409, "idempotency_conflict", "Idempotency key was reused");
  }
  return json(result.status === "created" ? 201 : 200, {
    serverRunId: runId,
    uploadUrl: `https://api.slop.cash/api/v1/trace-uploads/${capability}`,
    expiresAt: result.value.expiresAt,
    sha256: result.value.sha256,
    sizeBytes: result.value.sizeBytes,
    contentType: result.value.contentType,
  });
}

async function uploadTraceCapability(
  request: Request,
  deps: TraceApiDependencies,
  capability: string,
): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{40,128}$/u.test(capability)) {
    fail(404, "not_found", "Upload capability not found");
  }
  const tokenHash = await sha256Hex(new TextEncoder().encode(capability));
  const intent = await deps.persistence.getUploadIntent(
    tokenHash,
    deps.now().toISOString(),
  );
  if (intent === null) {
    fail(
      410,
      "upload_capability_invalid",
      "Upload capability is used or expired",
    );
  }
  const rawContentType = request.headers.get("content-type") ?? "";
  let contentType: TraceUploadIntent["contentType"];
  try {
    contentType = normalizedContentType(rawContentType);
  } catch {
    fail(415, "unsupported_media_type", "Trace must be UTF-8 text or NDJSON");
  }
  if (contentType !== intent.contentType) {
    fail(
      422,
      "intent_mismatch",
      "Trace content type does not match upload intent",
    );
  }
  const bytes = await readTraceBody(request);
  if (bytes.byteLength !== intent.sizeBytes) {
    fail(422, "intent_mismatch", "Trace size does not match upload intent");
  }
  const expectedDigest = request.headers
    .get("digest")
    ?.match(/^sha-256=([a-f0-9]{64})$/u)?.[1];
  if (expectedDigest === undefined) {
    fail(400, "invalid_digest", "Digest must be sha-256=<lowercase hex>");
  }
  const actualDigest = await sha256Hex(bytes);
  if (actualDigest !== expectedDigest || actualDigest !== intent.sha256) {
    fail(422, "digest_mismatch", "Trace digest does not match its bytes");
  }
  const existingObject = await deps.persistence.getTraceObject(actualDigest);
  if (
    existingObject !== null &&
    (existingObject.sizeBytes !== bytes.byteLength ||
      existingObject.contentType !== contentType)
  ) {
    fail(409, "object_integrity_conflict", "Trace object metadata conflicts");
  }
  const object =
    existingObject ??
    ({
      sha256: actualDigest,
      key: `traces/sha256/${actualDigest.slice(0, 2)}/${actualDigest}`,
      sizeBytes: bytes.byteLength,
      contentType,
      createdByGithubId: intent.githubId,
      createdAt: deps.now().toISOString(),
    } as const);
  await deps.persistence.putTraceBytes(object, bytes);
  const intentConsumedAt = deps.now().toISOString();
  const result = await deps.persistence.attachTrace({
    runId: intent.runId,
    githubId: intent.githubId,
    idempotencyKey: tokenHash,
    intentConsumedAt,
    object,
  });
  if (result.status === "conflict") {
    fail(409, "idempotency_conflict", "Idempotency key or trace was reused");
  }
  return json(result.status === "created" ? 201 : 200, {
    serverRunId: intent.runId,
    clientRunId: result.value.clientRunId,
    traceObjectId: `sha256:${actualDigest}`,
    traceSha256: actualDigest,
    sizeBytes: bytes.byteLength,
    state: result.value.state,
  });
}

async function finalizeRun(
  request: Request,
  actor: AuthenticatedActor,
  deps: TraceApiDependencies,
  runId: string,
): Promise<Response> {
  assertWriter(actor);
  idempotencyKey(request);
  const run = await ensureOwner(deps.persistence, actor, runId);
  if (run.traceSha256 === null) {
    fail(
      409,
      "trace_required",
      "Every run must upload a trace before finalizing",
    );
  }
  const finalized = await deps.persistence.finalizeRun(
    runId,
    actor.githubId,
    deps.now().toISOString(),
  );
  if (finalized === null)
    fail(409, "finalize_conflict", "Run could not be finalized");
  return json(200, {
    serverRunId: runId,
    clientRunId: finalized.clientRunId,
    traceObjectId: `sha256:${finalized.traceSha256}`,
    traceSha256: finalized.traceSha256,
    state: finalized.state,
  });
}

async function appendEvent(
  request: Request,
  actor: AuthenticatedActor,
  deps: TraceApiDependencies,
  runId: string,
): Promise<Response> {
  assertWriter(actor);
  const run = await ensureOwner(deps.persistence, actor, runId);
  if (run.state === "finalized") fail(409, "run_finalized", "Run is finalized");
  const body = await readJsonObject(request);
  const kind = body.kind;
  if (!validEventKind(kind)) fail(400, "invalid_request", "Invalid event kind");
  const occurredAt = requiredString(body, "occurredAt", validIsoTimestamp);
  const source = body.source;
  // GitHub-authoritative events are written only by the webhook processor,
  // never by this contributor endpoint.
  if (source !== "agent") {
    fail(400, "invalid_request", "Invalid event source");
  }
  const result = await deps.persistence.appendEvent({
    id: deps.randomId(),
    runId,
    githubId: actor.githubId,
    kind,
    occurredAt,
    source,
    githubObjectId: optionalString(body, "githubObjectId", validIdentifier),
    githubUrl: optionalString(body, "githubUrl", (value): value is string => {
      if (typeof value !== "string") return false;
      try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname === "github.com";
      } catch {
        return false;
      }
    }),
    headSha: optionalString(body, "headSha", validGitSha),
    idempotencyKey: idempotencyKey(request),
    createdAt: deps.now().toISOString(),
  });
  if (result.status === "conflict") {
    fail(409, "idempotency_conflict", "Idempotency key was reused");
  }
  return json(result.status === "created" ? 201 : 200, {
    eventId: result.value.id,
    runId,
    kind: result.value.kind,
  });
}

async function createReadGrant(
  request: Request,
  actor: AuthenticatedActor,
  deps: TraceApiDependencies,
  sha256: string,
): Promise<Response> {
  assertOperator(actor);
  if (!validSha256(sha256)) fail(400, "invalid_digest", "Invalid trace digest");
  const object = await deps.persistence.getTraceObject(sha256);
  if (object === null) fail(404, "not_found", "Trace not found");
  const body = await readJsonObject(request);
  const reason = body.reason;
  if (typeof reason !== "string" || reason.length < 8 || reason.length > 500) {
    fail(
      400,
      "invalid_request",
      "An access reason of 8-500 characters is required",
    );
  }
  const requestId = deps.randomId();
  const grant = `${deps.randomId()}.${deps.randomId()}`;
  const tokenHash = await sha256Hex(new TextEncoder().encode(grant));
  const createdAt = deps.now();
  const expiresAt = new Date(
    createdAt.getTime() + OPERATOR_GRANT_TTL_SECONDS * 1000,
  );
  await deps.persistence.createReadGrant({
    tokenHash,
    traceSha256: sha256,
    operatorGithubId: actor.githubId,
    reason,
    requestId,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  await deps.persistence.writeAudit({
    id: deps.randomId(),
    actorGithubId: actor.githubId,
    action: "trace.read_grant.created",
    target: `sha256:${sha256}`,
    requestId,
    createdAt: createdAt.toISOString(),
    details: { reason, expiresAt: expiresAt.toISOString() },
  });
  return json(201, {
    grant,
    expiresAt: expiresAt.toISOString(),
    traceObjectId: `sha256:${sha256}`,
  });
}

async function readTrace(
  request: Request,
  actor: AuthenticatedActor,
  deps: TraceApiDependencies,
  sha256: string,
): Promise<Response> {
  assertOperator(actor);
  if (!validSha256(sha256)) fail(400, "invalid_digest", "Invalid trace digest");
  const grant = request.headers.get("x-trace-read-grant");
  if (grant === null || grant.length < 20 || grant.length > 300) {
    fail(403, "read_grant_required", "A one-time trace read grant is required");
  }
  const tokenHash = await sha256Hex(new TextEncoder().encode(grant));
  const consumed = await deps.persistence.consumeReadGrant(
    tokenHash,
    sha256,
    actor.githubId,
    deps.now().toISOString(),
  );
  if (!consumed)
    fail(403, "invalid_read_grant", "Trace read grant is invalid or expired");
  const object = await deps.persistence.getTraceObject(sha256);
  if (object === null) fail(404, "not_found", "Trace not found");
  const bytes = await deps.persistence.readTraceBytes(object);
  if (bytes === null)
    fail(503, "object_unavailable", "Trace object is unavailable");
  const requestId = deps.randomId();
  await deps.persistence.writeAudit({
    id: deps.randomId(),
    actorGithubId: actor.githubId,
    action: "trace.read_grant.consumed",
    target: `sha256:${sha256}`,
    requestId,
    createdAt: deps.now().toISOString(),
    details: { sizeBytes: object.sizeBytes },
  });
  const responseBody =
    bytes instanceof Uint8Array ? bytes.slice().buffer : bytes;
  return new Response(responseBody, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="trace-${sha256}.txt"`,
      "content-length": String(object.sizeBytes),
      "content-security-policy": "default-src 'none'; sandbox",
      "content-type": object.contentType,
      "x-content-type-options": "nosniff",
      "x-trace-sha256": sha256,
    },
  });
}

export async function handleTraceApi(
  request: Request,
  deps: TraceApiDependencies,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const parts = pathParts(request);
  if (parts.length === 0) return json(404, { error: "not_found" });
  const isLocal = requestUrl.hostname === "localhost";
  if (requestUrl.protocol !== "https:" && !isLocal) {
    return json(400, { error: "https_required" });
  }
  if (requestUrl.host !== "api.slop.cash" && !isLocal) {
    return json(404, { error: "not_found" });
  }
  try {
    if (
      request.method === "GET" &&
      parts.length === 4 &&
      parts[0] === "wallet-claims" &&
      parts[1] === "actors" &&
      parts[3] === "current"
    ) {
      return await readCurrentWalletClaim(deps, parts[2]);
    }
    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "wallet-claims" &&
      parts[1] !== "current"
    ) {
      return await readPublicWalletClaim(deps, parts[1]);
    }
    if (
      request.method === "PUT" &&
      parts.length === 2 &&
      parts[0] === "trace-uploads"
    ) {
      return await uploadTraceCapability(request, deps, parts[1]);
    }
    if (
      request.method === "POST" &&
      parts.length === 2 &&
      parts[0] === "auth" &&
      parts[1] === "session"
    ) {
      return await exchangeIdentityAssertion(request, deps);
    }
    const actor = await verifyApiToken({
      authorization: request.headers.get("authorization"),
      secret: deps.authSecret,
      operatorGithubIds: deps.operatorGithubIds,
      nowSeconds: Math.floor(deps.now().getTime() / 1000),
    });
    if (actor === null) fail(401, "unauthorized", "Authentication failed");

    if (
      request.method === "GET" &&
      parts.length === 2 &&
      parts[0] === "wallet-claims" &&
      parts[1] === "current"
    ) {
      const current = await deps.persistence.getCurrentWalletClaim(
        actor.githubId,
      );
      if (current === null) fail(404, "not_found", "Wallet claim not found");
      return json(200, publicWalletClaim(current));
    }
    if (
      request.method === "POST" &&
      parts.length === 1 &&
      parts[0] === "wallet-claims"
    ) {
      return await createContributorWalletClaim(request, actor, deps);
    }

    if (
      request.method === "POST" &&
      parts.length === 1 &&
      parts[0] === "runs"
    ) {
      return await createRun(request, actor, deps);
    }
    if (parts[0] === "runs" && parts.length === 3) {
      const runId = parts[1];
      if (!validIdentifier(runId))
        fail(400, "invalid_request", "Invalid run id");
      if (request.method === "POST" && parts[2] === "trace-intents") {
        return await createTraceIntent(request, actor, deps, runId);
      }
      if (request.method === "POST" && parts[2] === "finalize") {
        return await finalizeRun(request, actor, deps, runId);
      }
      if (request.method === "POST" && parts[2] === "events") {
        return await appendEvent(request, actor, deps, runId);
      }
    }
    if (
      parts[0] === "operator" &&
      parts[1] === "traces" &&
      parts.length === 4 &&
      parts[3] === "grant" &&
      request.method === "POST"
    ) {
      return await createReadGrant(request, actor, deps, parts[2]);
    }
    if (
      parts[0] === "operator" &&
      parts[1] === "traces" &&
      parts.length === 3 &&
      request.method === "GET"
    ) {
      return await readTrace(request, actor, deps, parts[2]);
    }
    if (
      request.method === "POST" &&
      parts.length === 2 &&
      parts[0] === "operator" &&
      parts[1] === "wallet-claims"
    ) {
      return await createFallbackWalletClaim(request, actor, deps);
    }
    // No contributor or project-owner read endpoint exists by design.
    return json(404, { error: "not_found" });
  } catch (caught) {
    const error =
      typeof caught === "object" && caught !== null
        ? (caught as Partial<ApiError>)
        : {};
    const status =
      Number.isSafeInteger(error.status) &&
      Number(error.status) >= 400 &&
      Number(error.status) <= 599
        ? Number(error.status)
        : 500;
    if (status >= 500) console.error("private trace API failure");
    return json(status, {
      error:
        typeof error.code === "string" &&
        /^[a-z][a-z0-9_]{1,63}$/u.test(error.code)
          ? error.code
          : "internal_error",
      message:
        status >= 500 || typeof error.message !== "string"
          ? "Internal error"
          : error.message,
    });
  }
}

export const traceLimits = { maxTraceBytes: MAX_TRACE_BYTES } as const;
