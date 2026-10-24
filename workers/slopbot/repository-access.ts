// Repository access for self-service project setup (PRD section 4). The site
// asks, over its service binding only, whether Slopbot is installed on one
// repository and what base permission one GitHub account has there. The
// answer comes from GitHub through the App, never from installation records
// alone, and it carries no token.
import type { RepositoryAccess } from "../../src/lib/project-contracts";
import { appJwt } from "./github";

export const REPOSITORY_ACCESS_URL =
  "https://slopbot.internal/v1/repository-access";

const REPOSITORY = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/u;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const PERMISSIONS = new Set(["admin", "write", "read", "none"]);

type AccessEnv = { SLOPBOT_APP_ID: string; SLOPBOT_APP_PRIVATE_KEY: string };

/** Reads installation and permission from GitHub; throws when unavailable. */
export async function readRepositoryAccess(
  env: AccessEnv,
  query: {
    owner: string;
    repo: string;
    repositoryId: string;
    login: string;
    githubId: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<RepositoryAccess> {
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
  const found = await call(
    `/repos/${query.owner}/${query.repo}/installation`,
    jwt,
  );
  if (found.status === 404) return { installation: "missing" };
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
    return { installation: "suspended", installationId: installation.id };
  const issued = await call(
    `/app/installations/${installation.id}/access_tokens`,
    jwt,
    "POST",
  );
  if (!issued.ok) throw new Error("Installation token request failed");
  const { token } = (await issued.json()) as { token?: unknown };
  if (typeof token !== "string" || token.length < 16)
    throw new Error("Installation token is invalid");
  const repository = await call(`/repos/${query.owner}/${query.repo}`, token);
  // A renamed or recreated repository must never inherit another's answer.
  if (
    !repository.ok ||
    String(((await repository.json()) as { id?: unknown }).id) !==
      query.repositoryId
  )
    throw new Error("Repository identity does not match");
  const answer = await call(
    `/repos/${query.owner}/${query.repo}/collaborators/${query.login}/permission`,
    token,
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
    installationId: installation.id,
    permission: level,
    roleName,
  };
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
        { owner: match[1], repo: match[2], repositoryId, login, githubId },
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
