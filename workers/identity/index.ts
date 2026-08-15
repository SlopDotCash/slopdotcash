import { randomToken } from "./crypto";
import { handleIdentityRequest } from "./handler";
import { type D1Database, D1IdentityPersistence } from "./persistence";

type Env = {
  IDENTITY_DB: D1Database;
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_APP_CLIENT_SECRET: string;
  IDENTITY_STATE_KEY: string;
  IDENTITY_ASSERTION_KEY: string;
};

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
  fetch(request: Request, env: Env): Promise<Response> {
    return handleIdentityRequest(request, dependencies(env));
  },
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await new D1IdentityPersistence(env.IDENTITY_DB).deleteExpired(
      new Date().toISOString(),
    );
  },
};
