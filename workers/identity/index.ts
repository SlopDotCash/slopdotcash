import { randomToken } from "./crypto";
import { handleIdentityRequest } from "./handler";
import { type D1Database, D1IdentityPersistence } from "./persistence";

type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

type Env = {
  IDENTITY_DB: D1Database;
  IDENTITY_START_LIMITER: RateLimitBinding;
  IDENTITY_POLL_LIMITER: RateLimitBinding;
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_APP_CLIENT_SECRET: string;
  IDENTITY_STATE_KEY: string;
  IDENTITY_ASSERTION_KEY: string;
};

function rateLimitKey(request: Request): string {
  const connectingIp = request.headers.get("cf-connecting-ip");
  return connectingIp !== null && connectingIp.length <= 64
    ? connectingIp
    : "unattributed";
}

function rateLimitResponse(): Response {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: "Too many requests. Try again later.",
    }),
    {
      status: 429,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "referrer-policy": "no-referrer",
        "retry-after": "60",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function limiterUnavailableResponse(): Response {
  return new Response(
    JSON.stringify({
      error: "service_unavailable",
      message: "Identity service is temporarily unavailable.",
    }),
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "referrer-policy": "no-referrer",
        "retry-after": "60",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export async function applyIdentityRateLimit(
  request: Request,
  env: Pick<Env, "IDENTITY_START_LIMITER" | "IDENTITY_POLL_LIMITER">,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "identity.slop.cash" ||
    request.method !== "POST"
  ) {
    return null;
  }
  const limiter =
    url.pathname === "/v1/oauth/start"
      ? env.IDENTITY_START_LIMITER
      : url.pathname === "/v1/oauth/poll"
        ? env.IDENTITY_POLL_LIMITER
        : null;
  if (limiter === null) return null;
  try {
    const result = await limiter.limit({ key: rateLimitKey(request) });
    return result.success ? null : rateLimitResponse();
  } catch {
    console.error("slop identity rate limiter failed");
    return limiterUnavailableResponse();
  }
}

async function resolveGithubIdentity(
  code: string,
  pkceVerifier: string,
  env: Env,
): Promise<{ githubActorId: string; githubLogin: string } | null> {
  let accessToken = "";
  try {
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "slop-identity",
        },
        body: new URLSearchParams({
          client_id: env.GITHUB_APP_CLIENT_ID,
          client_secret: env.GITHUB_APP_CLIENT_SECRET,
          code,
          code_verifier: pkceVerifier,
          redirect_uri: "https://identity.slop.cash/v1/oauth/callback",
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!tokenResponse.ok) return null;
    const tokenBody: unknown = await tokenResponse.json();
    if (typeof tokenBody !== "object" || tokenBody === null) return null;
    const candidate = (tokenBody as { access_token?: unknown }).access_token;
    const tokenType = (tokenBody as { token_type?: unknown }).token_type;
    if (
      typeof candidate !== "string" ||
      candidate.length < 16 ||
      candidate.length > 512 ||
      (tokenType !== "bearer" && tokenType !== "Bearer")
    ) {
      return null;
    }
    accessToken = candidate;
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "user-agent": "slop-identity",
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    });
    accessToken = "";
    if (!userResponse.ok) return null;
    const user: unknown = await userResponse.json();
    if (typeof user !== "object" || user === null) return null;
    const id = (user as { id?: unknown }).id;
    const login = (user as { login?: unknown }).login;
    if (
      !Number.isSafeInteger(id) ||
      Number(id) <= 0 ||
      typeof login !== "string" ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(login)
    ) {
      return null;
    }
    return { githubActorId: String(id), githubLogin: login };
  } finally {
    accessToken = "";
  }
}

function dependencies(env: Env) {
  return {
    persistence: new D1IdentityPersistence(env.IDENTITY_DB),
    stateEncryptionSecret: env.IDENTITY_STATE_KEY,
    assertionSecret: env.IDENTITY_ASSERTION_KEY,
    githubClientId: env.GITHUB_APP_CLIENT_ID,
    now: () => new Date(),
    randomToken,
    resolveGithubIdentity: (code: string, pkceVerifier: string) =>
      resolveGithubIdentity(code, pkceVerifier, env),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const limited = await applyIdentityRateLimit(request, env);
    if (limited !== null) return limited;
    return handleIdentityRequest(request, dependencies(env));
  },
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await new D1IdentityPersistence(env.IDENTITY_DB).deleteExpired(
      new Date().toISOString(),
    );
  },
};
