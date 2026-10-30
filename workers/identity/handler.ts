import { type ApiError, cookieValue, fail } from "../../backend/http";
import { readLimitedBody } from "../../backend/trace/validation";
import brand from "../../brand/tokens.json" with { type: "json" };
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  type DeploymentTier,
  deploymentOrigins,
  isLocalDevelopmentOrigin,
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
  /** Local development only: accept a plain-HTTP local origin as the public origin. */
  allowLoopback?: boolean;
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

type OriginDependencies = {
  tier?: DeploymentTier;
  publicOrigin?: string;
  allowLoopback?: boolean;
};
function publicOriginOf(deps: OriginDependencies): string {
  return identityPublicOrigin(deps.publicOrigin, deps.tier, {
    loopback: deps.allowLoopback,
  });
}
/**
 * Where the sign-in page links back to. For a local identity origin that is
 * the dev server's sign-in page, which finishes a same-tab sign-in.
 */
function siteOf(deps: OriginDependencies): string {
  return deps.allowLoopback === true &&
    isLocalDevelopmentOrigin(deps.publicOrigin)
    ? `${deps.publicOrigin}/login`
    : deploymentOrigins(deps.tier).site;
}

function html(
  status: number,
  title: string,
  message: string,
  site: string,
): Response {
  const headers = securityHeaders("text/html; charset=utf-8");
  const signedIn = status === 200;
  const nonce = crypto.randomUUID();
  headers.set(
    "content-security-policy",
    `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  );
  if (signedIn) {
    // The originating tab polls the completed flow; the popup has no UI.
    // Local development can use same-tab login when popups are unavailable.
    const resumeLocal =
      new URL(site).protocol === "http:"
        ? `window.setTimeout(() => window.location.replace(${JSON.stringify(site)}), 100);`
        : "";
    return new Response(
      `<!doctype html><html><head><meta charset="utf-8"><title></title></head><body><script nonce="${nonce}">window.close();${resumeLocal}</script></body></html>`,
      { status, headers },
    );
  }
  // All content is fixed by this handler. No callback parameter or identity is rendered.
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>${title} · slop.cash</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100svh;background:${brand.color.bg};color:${brand.color.ink};font:16px/1.5 system-ui,sans-serif;display:grid;grid-template-rows:auto 1fr}header{padding:24px 32px;border-bottom:1px solid ${brand.color.line};font-weight:800;letter-spacing:-.04em;font-size:24px}header span{color:${brand.color.accent}}main{width:min(100%,480px);margin:auto;padding:48px 28px;text-align:center}h1{font-size:clamp(28px,6vw,36px);line-height:1.15;letter-spacing:-.035em;margin:0 0 16px}p{margin:0 0 28px;color:${brand.color.muted};text-wrap:pretty}a,button{font:inherit;display:flex;align-items:center;justify-content:center;min-height:48px;padding:12px 20px;border-radius:${brand.radius.medium};background:${brand.color.accent};color:${brand.color.onAccent};font-weight:700;text-decoration:none;border:0;width:100%;cursor:pointer}a:hover,button:hover{background:${brand.color.accentHover}}a:focus-visible,button:focus-visible{outline:3px solid ${brand.color.ink};outline-offset:4px}.note{font-size:14px;margin:20px 0 0}.status{width:52px;height:52px;display:grid;place-items:center;border:1px solid ${brand.color.lineStrong};border-radius:50%;margin:0 auto 24px;color:${brand.color.accent};font-size:28px}
</style></head><body><header>slop<span>.</span>cash</header><main><div class="status" aria-hidden="true">!</div><h1>${title}</h1><p>${message}</p><a href="${site}">Return to Slop</a></main></body></html>`,
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

/** Loopback destination is bound to the immutable random flow id, never a callback query. */
function localFlowOrigin(id: string): string | null {
  const match = /^flow_local_([il])_([0-9]{4,5})_[A-Za-z0-9_-]{32}$/u.exec(id);
  if (!match) return null;
  const origin = `http://${match[1] === "i" ? "127.0.0.1" : "localhost"}:${match[2]}`;
  return isLocalDevelopmentOrigin(origin) ? origin : null;
}

async function startFlow(
  request: Request,
  deps: IdentityWorkerDependencies,
  local = false,
): Promise<Response> {
  const body = await readJson(request);
  if (
    local &&
    (!isLocalDevelopmentOrigin(body.returnOrigin) ||
      body.audience !== POINTS_AUDIENCE)
  )
    fail(400, "invalid_request", "Invalid local return origin");
  if (
    !isIdentityAudience(body.audience) ||
    Object.keys(body).sort().join() !==
      (local ? "audience,returnOrigin" : "audience")
  ) {
    fail(400, "invalid_request", "Invalid identity audience");
  }
  const returnUrl = local ? new URL(body.returnOrigin as string) : null;
  const flowId = returnUrl
    ? `flow_local_${returnUrl.hostname === "127.0.0.1" ? "i" : "l"}_${returnUrl.port}_${deps.randomToken(24)}`
    : `flow_${deps.randomToken(18)}`;
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

  const authorizationUrl = new URL("/v1/oauth/authorize", publicOriginOf(deps));
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
    `${publicOriginOf(deps)}/v1/oauth/callback`,
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
      siteOf(deps),
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
      siteOf(deps),
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
    let identity: Awaited<ReturnType<typeof deps.resolveGithubIdentity>>;
    try {
      identity = await deps.resolveGithubIdentity(code, verifier);
    } catch (error) {
      await deps.persistence.failCallback(flow.id);
      throw error;
    }
    verifier = "";
    if (identity === null) {
      await deps.persistence.failCallback(flow.id);
      return html(
        502,
        "Sign-in failed",
        "GitHub identity could not be verified.",
        siteOf(deps),
      );
    }
    if (flow.audience === POINTS_AUDIENCE && !identity.githubNodeId) {
      await deps.persistence.failCallback(flow.id);
      return html(
        502,
        "Sign-in failed",
        "GitHub account identity is incomplete.",
        siteOf(deps),
      );
    }
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
        siteOf(deps),
      );
    }
    const response = html(
      200,
      "Signed in",
      "You can return to your original tab or terminal. This window will try to close automatically.",
      localFlowOrigin(flow.id)
        ? `${localFlowOrigin(flow.id)}/login`
        : siteOf(deps),
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
  local = false,
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
  const returnOrigin = localFlowOrigin(flow.id);
  if (Boolean(returnOrigin) !== local)
    fail(
      403,
      "wrong_flow",
      "This authorization belongs to another sign-in mode",
    );
  if (flow.status === "pending" || flow.status === "callback_processing") {
    const response = json(202, {
      status: "pending",
      retryAfterSeconds: POLL_AFTER_SECONDS,
    });
    response.headers.set("retry-after", String(POLL_AFTER_SECONDS));
    return response;
  }
  if (flow.status === "callback_failed")
    fail(410, "callback_failed", "Identity sign-in failed; start again");
  if (
    flow.status !== "callback_complete" ||
    flow.githubActorId === null ||
    flow.githubLogin === null
  ) {
    fail(410, "flow_consumed", "Identity flow was already consumed");
  }
  if (local) {
    if (!flow.githubNodeId)
      fail(502, "identity_incomplete", "GitHub identity is incomplete");
    if (
      !(await deps.persistence.markAssertionIssued(flow.id, now.toISOString()))
    )
      fail(410, "flow_consumed", "Identity flow was already consumed");
    return json(200, {
      status: "complete",
      returnOrigin,
      githubActorId: flow.githubActorId,
      githubLogin: flow.githubLogin,
      githubNodeId: flow.githubNodeId,
    });
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
  // Plain HTTP is allowed only for the local development origin, and only
  // when the dependencies enable it.
  if (
    url.protocol !== "https:" &&
    !(deps.allowLoopback === true && url.origin === publicOriginOf(deps))
  )
    return json(400, { error: "https_required" });
  try {
    if (
      url.host === IDENTITY_INTERNAL_HOST &&
      request.method === "POST" &&
      url.pathname === "/v1/assertions/consume"
    ) {
      return await consumeAssertion(request, deps);
    }
    if (url.host !== new URL(publicOriginOf(deps)).host) {
      return json(404, { error: "not_found" });
    }
    if (request.method === "POST" && url.pathname === "/v1/local/start")
      return await startFlow(request, deps, true);
    if (request.method === "POST" && url.pathname === "/v1/local/poll")
      return await pollFlow(request, deps, true);
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
  deps: OriginDependencies,
): boolean {
  const url = new URL(request.url);
  return (
    url.origin === publicOriginOf(deps) &&
    ["/v1/oauth/start", "/v1/oauth/poll"].includes(url.pathname)
  );
}
function browserOrigins(deps: OriginDependencies): Set<string> {
  if (
    deps.allowLoopback === true &&
    isLocalDevelopmentOrigin(deps.publicOrigin)
  )
    return new Set([deps.publicOrigin]);
  return publicOriginOf(deps) === deploymentOrigins(deps.tier).identity
    ? deploymentOrigins(deps.tier).browserOrigins
    : new Set(["https://staging.slop.cash", "https://slop-staging.pages.dev"]);
}
/** Also used by the entrypoint for rate-limit responses before core dispatch. */
export function identityBrowserResponse(
  request: Request,
  response: Response,
  deps: OriginDependencies = {},
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
