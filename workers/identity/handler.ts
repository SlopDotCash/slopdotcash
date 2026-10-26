import { type ApiError, fail } from "../../backend/http";
import { readLimitedBody } from "../../backend/trace/validation";
import brand from "../../brand/tokens.json" with { type: "json" };
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  type DeploymentTier,
  deploymentOrigins,
} from "../../src/lib/deployment";
import {
  ASSERTION_TTL_SECONDS,
  IDENTITY_INTERNAL_HOST,
  type IdentityPersistence,
  identityPublicOrigin,
  isIdentityAudience,
  OAUTH_FLOW_TTL_SECONDS,
  POINTS_AUDIENCE,
  POLL_AFTER_SECONDS,
} from "./contracts";
import {
  constantTimeEqual,
  decryptPkceVerifier,
  deriveAssertionToken,
  encryptPkceVerifier,
  pkceChallenge,
} from "./crypto";

export type IdentityWorkerDependencies = {
  tier?: DeploymentTier;
  persistence: IdentityPersistence;
  stateEncryptionSecret: string;
  assertionSecret: string;
  githubClientId: string;
  publicOrigin?: string;
  now: () => Date;
  randomToken: (bytes?: number) => string;
  resolveGithubIdentity: (
    code: string,
    pkceVerifier: string,
  ) => Promise<{
    githubActorId: string;
    githubLogin: string;
    githubNodeId?: string;
  } | null>;
};

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

function html(
  status: number,
  title: string,
  message: string,
  tier: DeploymentTier | undefined,
): Response {
  const headers = securityHeaders("text/html; charset=utf-8");
  const signedIn = status === 200;
  headers.set(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  // All content is fixed by this handler. No callback parameter or identity is rendered.
  const site = deploymentOrigins(tier).site;
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>${title} · slop.cash</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100svh;background:${brand.color.bg};color:${brand.color.ink};font:16px/1.5 system-ui,sans-serif;display:grid;grid-template-rows:auto 1fr}header{padding:24px 32px;border-bottom:1px solid ${brand.color.line};font-weight:800;letter-spacing:-.04em;font-size:24px}header span{color:${brand.color.accent}}main{width:min(100%,480px);margin:auto;padding:48px 28px;text-align:center}h1{font-size:clamp(28px,6vw,36px);line-height:1.15;letter-spacing:-.035em;margin:0 0 16px}p{margin:0 0 28px;color:${brand.color.muted};text-wrap:pretty}a{display:flex;align-items:center;justify-content:center;min-height:48px;padding:12px 20px;border-radius:${brand.radius.medium};background:${brand.color.accent};color:${brand.color.onAccent};font-weight:700;text-decoration:none}a:hover{background:${brand.color.accentHover}}a:focus-visible{outline:3px solid ${brand.color.ink};outline-offset:4px}.note{font-size:14px;margin:20px 0 0}.status{width:52px;height:52px;display:grid;place-items:center;border:1px solid ${brand.color.lineStrong};border-radius:50%;margin:0 auto 24px;color:${brand.color.accent};font-size:28px}
</style></head><body><header>slop<span>.</span>cash</header><main><div class="status" aria-hidden="true">${signedIn ? "✓" : "!"}</div><h1>${title}</h1><p>${message}</p><a href="${site}">Return to Slop</a>${signedIn ? '<p class="note">You can close this window and return to your original tab or terminal.</p>' : ""}</main></body></html>`,
    { status, headers },
  );
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.body === null) {
    fail(400, "invalid_request", "Request body is required");
  }
  let bytes: Uint8Array;
  try {
    bytes = await readLimitedBody(request, 4096);
  } catch {
    // An invalid or excessive declared length and an oversized stream.
    fail(413, "request_too_large", "Request body is too large");
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
  if (!isIdentityAudience(body.audience) || Object.keys(body).length !== 1) {
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
    audience: body.audience,
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
    identityPublicOrigin(deps.publicOrigin, deps.tier),
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
    `${identityPublicOrigin(deps.publicOrigin, deps.tier)}/v1/oauth/callback`,
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
      deps.tier,
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
      "Start sign-in again from Slop or your terminal.",
      deps.tier,
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
        deps.tier,
      );
    }
    if (flow.audience === POINTS_AUDIENCE && !identity.githubNodeId)
      return html(
        502,
        "Sign-in failed",
        "GitHub account identity is incomplete.",
        deps.tier,
      );
    const completed = await deps.persistence.completeCallback(
      flow.id,
      identity.githubActorId,
      identity.githubLogin,
      deps.now().toISOString(),
      identity.githubNodeId,
    );
    if (!completed) {
      return html(
        409,
        "Sign-in failed",
        "The sign-in flow was already completed.",
        deps.tier,
      );
    }
    const response = html(
      200,
      "Signed in",
      "Your GitHub sign-in is complete. Return to your original tab or terminal.",
      deps.tier,
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
    !isIdentityAudience(body.audience) ||
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
  if (flow === null || flow.audience !== body.audience)
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
  const storedAssertion = await deps.persistence.createAssertion({
    tokenHash: await sha256Hex(assertion),
    githubActorId: flow.githubActorId,
    githubLogin: flow.githubLogin,
    audience: flow.audience,
    ...(flow.githubNodeId ? { githubNodeId: flow.githubNodeId } : {}),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    consumedAt: null,
  });
  const storedCreatedAt = Date.parse(storedAssertion?.createdAt ?? "");
  const storedExpiresAt = Date.parse(storedAssertion?.expiresAt ?? "");
  if (
    storedAssertion === null ||
    !Number.isFinite(storedCreatedAt) ||
    !Number.isFinite(storedExpiresAt) ||
    new Date(storedCreatedAt).toISOString() !== storedAssertion.createdAt ||
    new Date(storedExpiresAt).toISOString() !== storedAssertion.expiresAt ||
    storedCreatedAt > now.getTime() ||
    storedExpiresAt <= now.getTime()
  ) {
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
    expiresAt: storedAssertion.expiresAt,
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
  if (!isIdentityAudience(body.audience) || Object.keys(body).length !== 1) {
    fail(400, "invalid_request", "Invalid assertion audience");
  }
  const assertion = await deps.persistence.consumeAssertion(
    await sha256Hex(match[1]),
    body.audience,
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
    ...(assertion.githubNodeId ? { githubNodeId: assertion.githubNodeId } : {}),
  });
}

async function handleIdentityRequestCore(
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
    if (
      url.host !==
      new URL(identityPublicOrigin(deps.publicOrigin, deps.tier)).host
    ) {
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

// Public product origins only. CLI requests without Origin retain their protocol.
function browserIdentityEndpoint(
  request: Request,
  deps: { tier?: DeploymentTier; publicOrigin?: string },
): boolean {
  const url = new URL(request.url);
  return (
    url.origin === identityPublicOrigin(deps.publicOrigin, deps.tier) &&
    ["/v1/oauth/start", "/v1/oauth/poll"].includes(url.pathname)
  );
}
function browserOrigins(deps: {
  tier?: DeploymentTier;
  publicOrigin?: string;
}): Set<string> {
  return identityPublicOrigin(deps.publicOrigin, deps.tier) ===
    deploymentOrigins(deps.tier).identity
    ? deploymentOrigins(deps.tier).browserOrigins
    : new Set(["https://staging.slop.cash", "https://slop-staging.pages.dev"]);
}
/** Also used by the entrypoint for rate-limit responses before core dispatch. */
export function identityBrowserResponse(
  request: Request,
  response: Response,
  deps: { tier?: DeploymentTier; publicOrigin?: string } = {},
): Response {
  const origin = request.headers.get("origin");
  if (
    !browserIdentityEndpoint(request, deps) ||
    !origin ||
    !browserOrigins(deps).has(origin)
  )
    return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.append("vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
export async function handleIdentityRequest(
  request: Request,
  deps: IdentityWorkerDependencies,
): Promise<Response> {
  const origin = request.headers.get("origin");
  if (browserIdentityEndpoint(request, deps) && origin) {
    if (!browserOrigins(deps).has(origin))
      return json(403, { error: "origin_forbidden" });
    if (request.method === "OPTIONS") {
      const requestedHeaders = (
        request.headers.get("access-control-request-headers") ?? ""
      )
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      if (
        request.headers.get("access-control-request-method") !== "POST" ||
        requestedHeaders.some((name) => name !== "content-type")
      )
        return identityBrowserResponse(
          request,
          json(403, { error: "preflight_forbidden" }),
          deps,
        );
      const headers = securityHeaders("text/plain; charset=utf-8");
      headers.set("access-control-allow-methods", "POST");
      headers.set("access-control-allow-headers", "Content-Type");
      headers.set(
        "vary",
        "Access-Control-Request-Method, Access-Control-Request-Headers",
      );
      return identityBrowserResponse(
        request,
        new Response(null, { status: 204, headers }),
        deps,
      );
    }
  }
  return identityBrowserResponse(
    request,
    await handleIdentityRequestCore(request, deps),
    deps,
  );
}
