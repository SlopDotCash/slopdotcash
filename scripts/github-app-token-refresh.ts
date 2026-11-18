/** Keep a GitHub App installation token fresh for a long collection.
 *
 * Installation tokens expire after one hour and a full collection takes about
 * three. When the workflow minted the collector App token, it also passes the
 * App's client ID, private key and installation ID. Requests to
 * api.github.com that carry the original token then carry a fresh one: a new
 * token is minted on first use and again ten minutes before each expiry. A
 * failed mint keeps the current token while it is still valid. Without those
 * settings nothing changes.
 */
import { createSign } from "node:crypto";

const REFRESH_BEFORE_MS = 10 * 60_000;
const RETRY_AFTER_MS = 60_000;
const MINT_TIMEOUT_MS = 30_000;
const WRAPPED = Symbol.for("slop.githubAppTokenRefresh");

type Fetch = typeof fetch;

export function githubAppJwt(
  clientId: string,
  privateKey: string,
  nowMs: number,
) {
  const now = Math.floor(nowMs / 1000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iat: now - 60,
    exp: now + 540,
    iss: clientId,
  })}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

/** Install the refreshing wrapper on globalThis.fetch. Returns an uninstall
 * function, or null when the App settings are absent. */
export function installGitHubAppTokenRefresh(
  environment: Record<string, string | undefined> = process.env,
  now: () => number = Date.now,
): (() => void) | null {
  const clientId = environment.COLLECTOR_APP_CLIENT_ID?.trim();
  const privateKey = environment.COLLECTOR_APP_PRIVATE_KEY;
  const installationId = environment.COLLECTOR_APP_INSTALLATION_ID?.trim();
  const repository = environment.COLLECTOR_APP_REPOSITORY?.trim();
  const initial =
    environment.GITHUB_TOKEN?.trim() || environment.GH_TOKEN?.trim();
  if (!clientId || !privateKey || !installationId || !initial) return null;
  if (!/^[1-9]\d{0,17}$/u.test(installationId))
    throw new Error("COLLECTOR_APP_INSTALLATION_ID must be a positive integer");
  if (repository && !/^[A-Za-z0-9_.-]+$/u.test(repository))
    throw new Error("COLLECTOR_APP_REPOSITORY must be a repository name");
  const base = globalThis.fetch as Fetch & { [WRAPPED]?: boolean };
  if (base[WRAPPED]) return null;

  let current = initial;
  // Unknown age: mint on first use.
  let expiresAt = 0;
  let nextAttempt = 0;
  let pending: Promise<void> | null = null;

  const mint = async () => {
    const response = await base(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubAppJwt(clientId, privateKey, now())}`,
          "Content-Type": "application/json",
          "User-Agent": "eliza-computer-leaderboard",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          ...(repository ? { repositories: [repository] } : {}),
          permissions: {
            contents: "read",
            issues: "read",
            pull_requests: "read",
          },
        }),
      },
    );
    if (response.status !== 201) {
      await response.body?.cancel();
      throw new Error(`GitHub App token mint returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      token?: unknown;
      expires_at?: unknown;
    };
    const expiry = Date.parse(String(body.expires_at));
    if (
      typeof body.token !== "string" ||
      !body.token ||
      !Number.isFinite(expiry)
    )
      throw new Error("GitHub App token mint returned an invalid token");
    current = body.token;
    expiresAt = expiry;
  };

  const token = async () => {
    const time = now();
    if (time < expiresAt - REFRESH_BEFORE_MS || time < nextAttempt)
      return current;
    pending ??= mint()
      .catch((error: unknown) => {
        nextAttempt = now() + RETRY_AFTER_MS;
        console.warn(
          JSON.stringify({
            event: "github_app_token_refresh_failed",
            message: error instanceof Error ? error.message : "unknown",
            currentValidUntil: expiresAt
              ? new Date(expiresAt).toISOString()
              : null,
          }),
        );
      })
      .finally(() => {
        pending = null;
      });
    await pending;
    return current;
  };

  const wrapped = async (
    input: Parameters<Fetch>[0],
    init?: Parameters<Fetch>[1],
  ) => {
    const request = input instanceof Request ? input : null;
    let origin: string;
    try {
      origin = new URL(request?.url ?? String(input)).origin;
    } catch {
      return base(input, init);
    }
    if (origin !== "https://api.github.com") return base(input, init);
    const headers = new Headers(init?.headers ?? request?.headers);
    const authorization = headers.get("authorization");
    const scheme =
      authorization === `Bearer ${initial}`
        ? "Bearer"
        : authorization === `token ${initial}`
          ? "token"
          : null;
    if (!scheme) return base(input, init);
    const fresh = await token();
    if (fresh === initial) return base(input, init);
    headers.set("authorization", `${scheme} ${fresh}`);
    return request
      ? base(new Request(request, { ...init, headers }))
      : base(input, { ...init, headers });
  };
  globalThis.fetch = Object.assign(wrapped, {
    preconnect: base.preconnect,
    [WRAPPED]: true,
  }) as Fetch;
  return () => {
    globalThis.fetch = base;
  };
}
