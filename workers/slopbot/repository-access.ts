// Repository access for self-service project setup (PRD section 4). The site
// asks, over its service binding only, whether Slopbot is installed on one
// repository and what base permission one GitHub account has there. The
// answer comes from GitHub through the App, never from installation records
// alone, and it carries no token.
import {
  parseRepositoryIdentity,
  REPOSITORY_READ_HEADER,
  REPOSITORY_READ_PATH,
  REPOSITORY_READ_URL,
  type RepositoryAccess,
} from "../../src/lib/project-contracts";
import { appJwt } from "./github";

export { REPOSITORY_READ_URL };

export const REPOSITORY_ACCESS_URL =
  "https://slopbot.internal/v1/repository-access";

const REPOSITORY = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/u;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const PERMISSIONS = new Set(["admin", "write", "read", "none"]);

type AccessEnv = { SLOPBOT_APP_ID: string; SLOPBOT_APP_PRIVATE_KEY: string };

type Installation =
  | { state: "missing" }
  | { state: "suspended"; installationId: number }
  | {
      state: "installed";
      installationId: number;
      read: (path: string) => Promise<Response>;
    };

/**
 * Finds one repository's Slopbot installation with the App JWT and, when it
 * is active, issues an installation token for GitHub reads. Throws when
 * GitHub is unavailable or answers out of contract.
 */
async function repositoryInstallation(
  env: AccessEnv,
  owner: string,
  repo: string,
  fetcher: typeof fetch,
): Promise<Installation> {
  const jwt = await appJwt(env.SLOPBOT_APP_ID, env.SLOPBOT_APP_PRIVATE_KEY);
  const call = (path: string, token: string, method = "GET") =>
    fetcher(`https://api.github.com${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "slopbot",
        "x-github-api-version": "2022-11-28",
      },
      redirect: "manual",
    });
  const found = await call(`/repos/${owner}/${repo}/installation`, jwt);
  if (found.status === 404) return { state: "missing" };
  if (!found.ok)
    throw new Error(`GitHub installation lookup returned ${found.status}`);
  const installation = (await found.json()) as {
    id?: unknown;
    suspended_at?: unknown;
  };
  if (
    typeof installation.id !== "number" ||
    !Number.isSafeInteger(installation.id) ||
    installation.id < 1
  )
    throw new Error("GitHub installation id is invalid");
  if (
    installation.suspended_at !== null &&
    installation.suspended_at !== undefined
  )
    return { state: "suspended", installationId: installation.id };
  const issued = await call(
    `/app/installations/${installation.id}/access_tokens`,
    jwt,
    "POST",
  );
  if (!issued.ok) throw new Error("Installation token request failed");
  const { token } = (await issued.json()) as { token?: unknown };
  if (typeof token !== "string" || token.length < 16)
    throw new Error("Installation token is invalid");
  return {
    state: "installed",
    installationId: installation.id,
    read: (path) => call(path, token),
  };
}

/** Reads installation and permission from GitHub; throws when unavailable. */
export async function readRepositoryAccess(
  env: AccessEnv,
  query: {
    owner: string;
    repo: string;
    repositoryId: string;
    login: string;
    githubId: string;
    includeRepository?: boolean;
  },
  fetcher: typeof fetch = fetch,
): Promise<RepositoryAccess> {
  const installation = await repositoryInstallation(
    env,
    query.owner,
    query.repo,
    fetcher,
  );
  if (installation.state === "missing") return { installation: "missing" };
  if (installation.state === "suspended")
    return {
      installation: "suspended",
      installationId: installation.installationId,
    };
  const repository = await installation.read(
    `/repos/${query.owner}/${query.repo}`,
  );
  const facts = repository.ok ? await repository.json() : null;
  // A renamed or recreated repository must never inherit another's answer.
  if (
    !repository.ok ||
    String((facts as { id?: unknown } | null)?.id) !== query.repositoryId
  )
    throw new Error("Repository identity does not match");
  const answer = await installation.read(
    `/repos/${query.owner}/${query.repo}/collaborators/${query.login}/permission`,
  );
  if (answer.status !== 404 && !answer.ok)
    throw new Error(`GitHub permission lookup returned ${answer.status}`);
  const permission =
    answer.status === 404
      ? null
      : ((await answer.json()) as {
          permission?: unknown;
          role_name?: unknown;
          user?: { id?: unknown };
        });
  // A session can retain a login after GitHub renames or reuses it.
  // Only the permanent account ID can bind this permission to that session.
  if (permission !== null && String(permission.user?.id) !== query.githubId)
    throw new Error("GitHub account identity does not match");
  // GitHub maps maintain to write; custom role names are not access levels.
  const level =
    permission === null
      ? "none"
      : typeof permission.permission === "string" &&
          PERMISSIONS.has(permission.permission)
        ? (permission.permission as "admin" | "write" | "read" | "none")
        : null;
  if (level === null) throw new Error("GitHub permission is invalid");
  const roleName =
    typeof permission?.role_name === "string" &&
    /^[A-Za-z0-9 _-]{1,64}$/u.test(permission.role_name)
      ? permission.role_name
      : null;
  return {
    installation: "installed",
    installationId: installation.installationId,
    permission: level,
    roleName,
    ...(query.includeRepository
      ? { repository: parseRepositoryIdentity(facts) }
      : {}),
  };
}

/** The internal repository routes, or null for any other request. Public
 * hosts never match their origin.
 */
export function routeRepositoryAccess(
  request: Request,
  env: AccessEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const route = `${url.origin}${url.pathname}`;
  if (route === REPOSITORY_ACCESS_URL)
    return handleRepositoryAccess(request, env, fetcher);
  if (route === REPOSITORY_READ_URL)
    return handleRepositoryRead(request, env, fetcher);
  return null;
}

/** Serves the internal route; public hosts never match its origin. */
export async function handleRepositoryAccess(
  request: Request,
  env: AccessEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const match = REPOSITORY.exec(url.searchParams.get("repository") ?? "");
  const repositoryId = url.searchParams.get("repositoryId") ?? "";
  const login = url.searchParams.get("login") ?? "";
  const githubId = url.searchParams.get("githubId") ?? "";
  if (
    match === null ||
    !/^[1-9][0-9]{0,19}$/u.test(repositoryId) ||
    !/^[1-9][0-9]{0,19}$/u.test(githubId) ||
    !LOGIN.test(login)
  )
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  try {
    return Response.json(
      await readRepositoryAccess(
        env,
        {
          owner: match[1],
          repo: match[2],
          repositoryId,
          login,
          githubId,
          includeRepository: url.searchParams.get("includeRepository") === "1",
        },
        fetcher,
      ),
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

/**
 * Reads one public repository resource with that repository's own Slopbot
 * installation, so setup does not depend on the anonymous rate limit of a
 * shared Pages address. Without an installation the answer is 404 without
 * the read header, and the caller makes its ordinary read; a private or
 * missing repository answers the same way. Only GitHub's 200 and 404
 * answers for a public repository pass through; the token never leaves the
 * Worker.
 */
export async function handleRepositoryRead(
  request: Request,
  env: AccessEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const path = new URL(request.url).searchParams.get("path") ?? "";
  const match = REPOSITORY_READ_PATH.exec(path);
  const headers = { "cache-control": "no-store" };
  // Dot segments, including encoded ones, would name a different resource.
  // Git branch names never contain "..", so a decoded one is also refused.
  const target = new URL(`https://api.github.com${path}`);
  let decoded = "";
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // error-policy:J3 a malformed escape is an invalid request below.
  }
  if (
    match === null ||
    `${target.pathname}${target.search}` !== path ||
    decoded === "" ||
    /\/branches\/.*\.\./u.test(decoded)
  )
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers },
    );
  try {
    const installation = await repositoryInstallation(
      env,
      match[1],
      match[2],
      fetcher,
    );
    if (installation.state !== "installed")
      return Response.json(
        { installation: installation.state },
        { status: 404, headers },
      );
    // The installation token can read private repositories. Only a public
    // repository passes through; any other answers like an uninstalled one,
    // so the caller's ordinary anonymous read decides, as before.
    const factsPath = `/repos/${match[1]}/${match[2]}`;
    const facts = await installation.read(factsPath);
    if (facts.status !== 200 && facts.status !== 404)
      throw new Error(`GitHub repository read returned ${facts.status}`);
    const repository =
      facts.status === 200
        ? ((await facts.json()) as { private?: unknown; visibility?: unknown })
        : null;
    if (
      repository === null ||
      repository.private !== false ||
      (repository.visibility !== undefined &&
        repository.visibility !== "public")
    )
      return Response.json(
        { installation: "unavailable" },
        { status: 404, headers },
      );
    const answer =
      path === factsPath
        ? Response.json(repository)
        : await installation.read(path);
    if (answer.status !== 200 && answer.status !== 404)
      throw new Error(`GitHub repository read returned ${answer.status}`);
    const link = answer.headers.get("link");
    return new Response(answer.body, {
      status: answer.status,
      headers: {
        ...headers,
        "content-type": "application/json",
        [REPOSITORY_READ_HEADER]: "github",
        ...(link === null ? {} : { link }),
      },
    });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
