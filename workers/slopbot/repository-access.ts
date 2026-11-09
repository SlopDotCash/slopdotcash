// Repository access for self-service project setup (PRD section 4). The site
// asks, over its service binding only, whether Slopbot is installed on one
// repository and what base permission one GitHub account has there. The
// answer comes from GitHub through the App, never from installation records
// alone, and it carries no token.
import { githubHeaders } from "../../backend/github";
import {
  parseRepositoryIdentity,
  type RepositoryAccess,
} from "../../src/lib/project-contracts";
import { appJwt } from "./github";

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
 * is active, issues a repository-scoped metadata token for authority reads.
 * Throws when GitHub is unavailable or answers out of contract.
 */
async function repositoryInstallation(
  env: AccessEnv,
  owner: string,
  repo: string,
  fetcher: typeof fetch,
  expectedRepositoryId: number,
): Promise<Installation> {
  if (!Number.isSafeInteger(expectedRepositoryId) || expectedRepositoryId < 1)
    throw new Error("Repository id is invalid");
  const jwt = await appJwt(env.SLOPBOT_APP_ID, env.SLOPBOT_APP_PRIVATE_KEY);
  const call = (
    path: string,
    token: string,
    method = "GET",
    body?: Record<string, unknown>,
  ) =>
    fetcher(`https://api.github.com${path}`, {
      method,
      headers: {
        ...githubHeaders(token, "slopbot"),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
  // Authority reads bind every later path lookup to the expected immutable
  // repository. A rename/reused path cannot borrow another installed repo's
  // permissions. Public content uses its separate public-only credential.
  const issued = await call(
    `/app/installations/${installation.id}/access_tokens`,
    jwt,
    "POST",
    {
      repository_ids: [expectedRepositoryId],
      permissions: { metadata: "read" },
    },
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
    Number(query.repositoryId),
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

/** The internal authority route, or null for any other request. Public
 * hosts never match its origin.
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
  return null;
}

/** Serves the internal route; public hosts never match its origin. */
async function handleRepositoryAccess(
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
