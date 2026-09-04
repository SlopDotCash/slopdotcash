import {
  ASSERTION_TTL_SECONDS,
  IDENTITY_AUDIENCE,
  IDENTITY_INTERNAL_HOST,
  IDENTITY_PUBLIC_ORIGIN,
  type IdentityPersistence,
  OAUTH_FLOW_TTL_SECONDS,
  POLL_AFTER_SECONDS,
} from "./contracts";
import {
  constantTimeEqual,
  decryptPkceVerifier,
  deriveAssertionToken,
  encryptPkceVerifier,
  pkceChallenge,
  sha256Hex,
} from "./crypto";

export type IdentityWorkerDependencies = {
  persistence: IdentityPersistence;
  stateEncryptionSecret: string;
  assertionSecret: string;
  githubClientId: string;
  now: () => Date;
  randomToken: (bytes?: number) => string;
  resolveGithubIdentity: (
    code: string,
    pkceVerifier: string,
  ) => Promise<{ githubActorId: string; githubLogin: string } | null>;
};

type ApiError = Error & { status?: number; code?: string };

function fail(status: number, code: string, message: string): never {
  const error: ApiError = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function securityHeaders(contentType: string): Headers {
  return new Headers({
    "cache-control": "no-store",
    "content-type": contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: securityHeaders("application/json; charset=utf-8"),
  });
}

function html(status: number, title: string, message: string): Response {
  const headers = securityHeaders("text/html; charset=utf-8");
  headers.set(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font:16px system-ui;max-width:36rem;margin:15vh auto;padding:2rem;line-height:1.5}h1{font-size:2rem}</style><main><h1>${title}</h1><p>${message}</p></main></html>`,
    { status, headers },
  );
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > 4096)
  ) {
    fail(413, "request_too_large", "Request body is too large");
  }
  if (request.body === null) {
    fail(400, "invalid_request", "Request body is required");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 4096) {
        await reader.cancel("request body too large");
        fail(413, "request_too_large", "Request body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(400, "invalid_request", "Request body must be UTF-8 JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(400, "invalid_request", "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function clearStateCookie(headers: Headers): void {
  headers.append(
    "set-cookie",
    "__Host-slop_oauth_state=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax",
  );
}

function validFlowId(value: unknown): value is string {
  return (
    typeof value === "string" && /^flow_[A-Za-z0-9_-]{20,64}$/u.test(value)
  );
}

function validCapability(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,128}$/u.test(value);
}

async function startFlow(
  request: Request,
  deps: IdentityWorkerDependencies,
): Promise<Response> {
  const body = await readJson(request);
  if (body.audience !== IDENTITY_AUDIENCE || Object.keys(body).length !== 1) {
    fail(400, "invalid_request", "Invalid identity audience");
  }
  const flowId = `flow_${deps.randomToken(18)}`;
  const state = deps.randomToken(32);
  const pollCapability = deps.randomToken(32);
  const pkceVerifier = deps.randomToken(64);
  const encrypted = await encryptPkceVerifier(
    pkceVerifier,
    flowId,
    deps.stateEncryptionSecret,
  );
  const createdAt = deps.now();
  const expiresAt = new Date(
    createdAt.getTime() + OAUTH_FLOW_TTL_SECONDS * 1000,
  );
  const created = await deps.persistence.createFlow({
    id: flowId,
    stateHash: await sha256Hex(state),
    pollCapabilityHash: await sha256Hex(pollCapability),
    encryptedPkceVerifier: encrypted.ciphertext,
    pkceIv: encrypted.iv,
    audience: IDENTITY_AUDIENCE,
    status: "pending",
    githubActorId: null,
    githubLogin: null,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    callbackCompletedAt: null,
    assertionIssuedAt: null,
  });
  if (!created) fail(503, "flow_unavailable", "Could not create identity flow");

  const authorizationUrl = new URL(
    "/v1/oauth/authorize",
    IDENTITY_PUBLIC_ORIGIN,
  );
  authorizationUrl.searchParams.set("flow_id", flowId);
  authorizationUrl.searchParams.set("state", state);
  return json(201, {
    flowId,
    authorizationUrl: authorizationUrl.toString(),
    pollCapability,
    expiresAt: expiresAt.toISOString(),
    pollAfterSeconds: POLL_AFTER_SECONDS,
  });
}

async function authorizeBrowser(
  request: Request,
  deps: IdentityWorkerDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  const flowId = url.searchParams.get("flow_id");
  const state = url.searchParams.get("state");
  if (!validFlowId(flowId) || !validCapability(state)) {
    fail(400, "invalid_request", "Invalid authorization link");
  }
  const flow = await deps.persistence.findAuthorizableFlow(
    flowId,
    await sha256Hex(state),
    deps.now().toISOString(),
  );
  if (
    flow === null ||
    flow.encryptedPkceVerifier === null ||
    flow.pkceIv === null
  ) {
    fail(410, "flow_expired", "Authorization flow is unavailable");
  }
  const verifier = await decryptPkceVerifier(
    flow.encryptedPkceVerifier,
    flow.pkceIv,
    flow.id,
    deps.stateEncryptionSecret,
  );
  const githubUrl = new URL("https://github.com/login/oauth/authorize");
  githubUrl.searchParams.set("client_id", deps.githubClientId);
  githubUrl.searchParams.set(
    "redirect_uri",
    `${IDENTITY_PUBLIC_ORIGIN}/v1/oauth/callback`,
  );
  githubUrl.searchParams.set("state", state);
  githubUrl.searchParams.set("code_challenge", await pkceChallenge(verifier));
  githubUrl.searchParams.set("code_challenge_method", "S256");

  const headers = securityHeaders("text/plain; charset=utf-8");
  headers.set("location", githubUrl.toString());
  headers.append(
    "set-cookie",
    `__Host-slop_oauth_state=${state}; Path=/; Max-Age=${OAUTH_FLOW_TTL_SECONDS}; Secure; HttpOnly; SameSite=Lax`,
  );
  return new Response(null, { status: 302, headers });
}

async function oauthCallback(
  request: Request,
  deps: IdentityWorkerDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const cookieState = cookieValue(request, "__Host-slop_oauth_state");
  if (
    !validCapability(state) ||
    cookieState === null ||
    !constantTimeEqual(state, cookieState) ||
    typeof code !== "string" ||
    !/^[A-Za-z0-9_./-]{8,512}$/u.test(code)
  ) {
    return html(
      400,
      "Sign-in failed",
      "The sign-in response was invalid or expired.",
    );
  }
  const flow = await deps.persistence.claimCallback(
    await sha256Hex(state),
    deps.now().toISOString(),
  );
  if (
    flow === null ||
    flow.encryptedPkceVerifier === null ||
    flow.pkceIv === null
  ) {
    return html(
      410,
      "Sign-in expired",
      "Start sign-in again from your terminal.",
    );
  }
  let verifier = "";
  try {
    verifier = await decryptPkceVerifier(
      flow.encryptedPkceVerifier,
      flow.pkceIv,
      flow.id,
      deps.stateEncryptionSecret,
    );
    const identity = await deps.resolveGithubIdentity(code, verifier);
    verifier = "";
    if (identity === null) {
      return html(
        502,
        "Sign-in failed",
        "GitHub identity could not be verified.",
      );
    }
    const completed = await deps.persistence.completeCallback(
      flow.id,
      identity.githubActorId,
      identity.githubLogin,
      deps.now().toISOString(),
    );
    if (!completed) {
      return html(
        409,
        "Sign-in failed",
        "The sign-in flow was already completed.",
      );
    }
    const response = html(
      200,
      "Signed in",
      "Return to your terminal. You may close this window.",
    );
    clearStateCookie(response.headers);
    return response;
  } finally {
    verifier = "";
  }
}

async function pollFlow(
  request: Request,
  deps: IdentityWorkerDependencies,
): Promise<Response> {
  const body = await readJson(request);
  const flowId = body.flowId;
  const pollCapability = body.pollCapability;
  if (
    !validFlowId(flowId) ||
    !validCapability(pollCapability) ||
    body.audience !== IDENTITY_AUDIENCE ||
    Object.keys(body).length !== 3
  ) {
    fail(400, "invalid_request", "Invalid poll request");
  }
  const now = deps.now();
  const flow = await deps.persistence.findPollableFlow(
    flowId,
    await sha256Hex(pollCapability),
    now.toISOString(),
  );
  if (flow === null)
    fail(410, "flow_unavailable", "Identity flow is unavailable");
  if (flow.status === "pending" || flow.status === "callback_processing") {
    const response = json(202, {
      status: "pending",
      retryAfterSeconds: POLL_AFTER_SECONDS,
    });
    response.headers.set("retry-after", String(POLL_AFTER_SECONDS));
    return response;
  }
  if (
    flow.status !== "callback_complete" ||
    flow.githubActorId === null ||
    flow.githubLogin === null
  ) {
    fail(410, "flow_consumed", "Identity flow was already consumed");
  }
  const assertion = await deriveAssertionToken(
    flow.id,
    pollCapability,
    flow.githubActorId,
    deps.assertionSecret,
  );
  const expiresAt = new Date(now.getTime() + ASSERTION_TTL_SECONDS * 1000);
  const created = await deps.persistence.createAssertion({
    tokenHash: await sha256Hex(assertion),
    githubActorId: flow.githubActorId,
    githubLogin: flow.githubLogin,
    audience: IDENTITY_AUDIENCE,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    consumedAt: null,
  });
  if (!created) {
    fail(503, "assertion_unavailable", "Could not create identity assertion");
  }
  const issued = await deps.persistence.markAssertionIssued(
    flow.id,
    now.toISOString(),
  );
  if (!issued) fail(410, "flow_consumed", "Identity flow was already consumed");
  return json(200, {
    status: "complete",
    assertion,
    assertionType: "SlopIdentity",
    expiresAt: expiresAt.toISOString(),
  });
}

async function consumeAssertion(
  request: Request,
  deps: IdentityWorkerDependencies,
): Promise<Response> {
  const match = /^Bearer (slop_assert_v1_[A-Za-z0-9_-]{40,128})$/u.exec(
    request.headers.get("authorization") ?? "",
  );
  if (match === null)
    fail(401, "unauthorized", "Identity assertion is invalid");
  const body = await readJson(request);
  if (body.audience !== IDENTITY_AUDIENCE || Object.keys(body).length !== 1) {
    fail(400, "invalid_request", "Invalid assertion audience");
  }
  const assertion = await deps.persistence.consumeAssertion(
    await sha256Hex(match[1]),
    IDENTITY_AUDIENCE,
    deps.now().toISOString(),
  );
  if (assertion === null) {
    fail(
      401,
      "unauthorized",
      "Identity assertion is invalid, used, or expired",
    );
  }
  return json(200, {
    githubActorId: assertion.githubActorId,
    githubLogin: assertion.githubLogin,
    audience: assertion.audience,
  });
}

export async function handleIdentityRequest(
  request: Request,
  deps: IdentityWorkerDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.protocol !== "https:") return json(400, { error: "https_required" });
  try {
    if (
      url.host === IDENTITY_INTERNAL_HOST &&
      request.method === "POST" &&
      url.pathname === "/v1/assertions/consume"
    ) {
      return await consumeAssertion(request, deps);
    }
    if (url.host !== new URL(IDENTITY_PUBLIC_ORIGIN).host) {
      return json(404, { error: "not_found" });
    }
    if (request.method === "POST" && url.pathname === "/v1/oauth/start") {
      return await startFlow(request, deps);
    }
    if (request.method === "GET" && url.pathname === "/v1/oauth/authorize") {
      return await authorizeBrowser(request, deps);
    }
    if (request.method === "GET" && url.pathname === "/v1/oauth/callback") {
      return await oauthCallback(request, deps);
    }
    if (request.method === "POST" && url.pathname === "/v1/oauth/poll") {
      return await pollFlow(request, deps);
    }
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
    const code =
      typeof error.code === "string" &&
      /^[a-z][a-z0-9_]{1,63}$/u.test(error.code)
        ? error.code
        : "internal_error";
    if (status >= 500) console.error("slop identity request failed");
    return json(status, {
      error: code,
      message:
        status >= 500 || typeof error.message !== "string"
          ? "Internal error"
          : error.message,
    });
  }
}
