import {
  type GithubActor,
  type OwnedRepository,
  type RepositoryLookup,
  validRepositoryPath,
} from "../../src/lib/project-contracts";
/**
 * Server-side GitHub reads for the project setup form. The browser calls the
 * same-origin API with its site session; this module reads public GitHub
 * facts with an optional server token, and the API caches the result briefly.
 * A failed or partial lookup never fills a fact.
 */

import { readBoundedJson } from "../../src/lib/browser-json";
import { sha256Hex } from "../../src/lib/sha256";
import {
  GITHUB_API,
  GITHUB_LOGIN,
  githubHeaders,
  loopbackOrigin,
  nextLink,
} from "../github";

export type GithubFetch = (url: string, init: RequestInit) => Promise<Response>;

export class GithubLookupError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MAX_OWNED_REPOSITORY_PAGES = 20;
const REQUEST_TIMEOUT_MS = 10_000;

export function validGithubLogin(value: string): boolean {
  return GITHUB_LOGIN.test(value);
}

export function requestInit(token: string | undefined): RequestInit {
  return {
    headers: githubHeaders(token, "slop.cash-project-setup"),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

function limited(response: Response): boolean {
  return (
    response.status === 429 ||
    (response.status === 403 &&
      response.headers.get("x-ratelimit-remaining") === "0")
  );
}

export async function githubJson(
  fetcher: GithubFetch,
  token: string | undefined,
  path: string,
  apiOrigin: string,
): Promise<Record<string, unknown> | null> {
  const response = await fetcher(`${apiOrigin}${path}`, requestInit(token));
  if (response.status === 404) return null;
  if (limited(response))
    throw new GithubLookupError(
      503,
      "github_rate_limited",
      "GitHub limited lookups.",
    );
  if (!response.ok)
    throw new GithubLookupError(
      502,
      "github_unavailable",
      `GitHub returned ${response.status}.`,
    );
  const value = await readBoundedJson(response, 512 * 1024, "GitHub lookup");
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new GithubLookupError(
      502,
      "github_unavailable",
      "GitHub returned an unexpected response.",
    );
  return value as Record<string, unknown>;
}

/** Resolve the current owner of a login before recording permanent attribution. */
export async function lookupGitHubActor(
  fetcher: GithubFetch,
  token: string | undefined,
  login: string,
  apiOrigin = GITHUB_API,
): Promise<GithubActor | null> {
  if (!validGithubLogin(login)) return null;
  const user = await githubJson(fetcher, token, `/users/${login}`, apiOrigin);
  if (!user) return null;
  // An organization or bot account exists, but it is not a person's account.
  if (typeof user.type === "string" && user.type !== "User")
    throw new GithubLookupError(
      422,
      "personal_account_required",
      `@${login} is a GitHub ${user.type} account. Enter a person's GitHub account.`,
    );
  if (
    user.type !== "User" ||
    !Number.isSafeInteger(user.id) ||
    Number(user.id) <= 0 ||
    typeof user.login !== "string" ||
    !validGithubLogin(user.login) ||
    user.login.toLowerCase() !== login.toLowerCase()
  )
    throw new GithubLookupError(
      502,
      "github_unavailable",
      "GitHub returned incomplete account facts.",
    );
  return { githubId: String(user.id), githubLogin: user.login };
}

function repositoryDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > 0 && text.length <= 600 ? text : null;
}

function nextOwnedRepositoryPage(
  response: Response,
  currentPage: number,
  apiOrigin: string,
): number | null {
  const invalid = () =>
    new GithubLookupError(
      502,
      "github_unavailable",
      "GitHub returned an invalid repository page link.",
    );
  let url: URL | null;
  try {
    const target = nextLink(response.headers.get("link"));
    url = target === null ? null : new URL(target);
  } catch {
    throw invalid();
  }
  if (url === null) return null;
  const page = Number(url.searchParams.get("page"));
  if (
    url.origin !== apiOrigin ||
    !Number.isSafeInteger(page) ||
    page !== currentPage + 1
  )
    throw invalid();
  return page;
}

/**
 * Lists the public, non-fork, non-archived repositories a GitHub account
 * owns, most recently pushed first.
 */
export async function listOwnedRepositories(
  fetcher: GithubFetch,
  token: string | undefined,
  login: string,
  apiOrigin = GITHUB_API,
): Promise<OwnedRepository[]> {
  if (!GITHUB_LOGIN.test(login))
    throw new GithubLookupError(
      400,
      "invalid_request",
      "The signed-in GitHub login is not valid.",
    );
  const repositories = new Map<string, OwnedRepository>();
  let page = 1;
  for (;;) {
    const response = await fetcher(
      `${apiOrigin}/users/${login}/repos?type=owner&sort=pushed&per_page=100&page=${page}`,
      requestInit(token),
    );
    if (limited(response))
      throw new GithubLookupError(
        503,
        "github_rate_limited",
        "GitHub limited lookups.",
      );
    if (!response.ok)
      throw new GithubLookupError(
        502,
        "github_unavailable",
        `GitHub returned ${response.status}.`,
      );
    const value = await readBoundedJson(
      response,
      2 * 1024 * 1024,
      "GitHub repositories",
    );
    if (!Array.isArray(value))
      throw new GithubLookupError(
        502,
        "github_unavailable",
        "GitHub returned an unexpected response.",
      );
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const repo = entry as Record<string, unknown>;
      if (
        repo.private !== false ||
        repo.fork !== false ||
        repo.archived !== false ||
        typeof repo.full_name !== "string" ||
        !validRepositoryPath(repo.full_name)
      )
        continue;
      if (!repositories.has(repo.full_name))
        repositories.set(repo.full_name, {
          repository: repo.full_name,
          description: repositoryDescription(repo.description),
        });
    }
    const nextPage = nextOwnedRepositoryPage(response, page, apiOrigin);
    if (nextPage === null) return [...repositories.values()];
    if (page >= MAX_OWNED_REPOSITORY_PAGES)
      throw new GithubLookupError(
        502,
        "github_unavailable",
        "GitHub returned too many repository pages.",
      );
    page = nextPage;
  }
}

function unknownLicense(
  facts: Omit<RepositoryLookup, "license">,
  reason: string,
): RepositoryLookup {
  return { ...facts, license: { state: "unknown", reason } };
}

/**
 * Reads public repository facts. Unknown license terms stay unknown.
 */
export async function lookupGitHubRepository(
  fetcher: GithubFetch,
  token: string | undefined,
  repository: string,
  apiOrigin = GITHUB_API,
): Promise<RepositoryLookup> {
  if (!validRepositoryPath(repository))
    throw new GithubLookupError(
      400,
      "invalid_request",
      "Enter the repository as owner/name.",
    );
  const repo = await githubJson(
    fetcher,
    token,
    `/repos/${repository}`,
    apiOrigin,
  );
  if (!repo)
    throw new GithubLookupError(
      404,
      "not_found",
      "GitHub has no public repository with that name.",
    );
  const owner = repo.owner as Record<string, unknown> | undefined;
  if (
    repo.private !== false ||
    !Number.isSafeInteger(repo.id) ||
    typeof repo.node_id !== "string" ||
    !/^[A-Za-z0-9_=-]{1,100}$/u.test(repo.node_id) ||
    typeof repo.full_name !== "string" ||
    !validRepositoryPath(repo.full_name) ||
    typeof repo.default_branch !== "string" ||
    !owner ||
    !Number.isSafeInteger(owner.id) ||
    typeof owner.login !== "string" ||
    typeof owner.node_id !== "string" ||
    (owner.type !== "User" && owner.type !== "Organization")
  )
    throw new GithubLookupError(
      502,
      "github_unavailable",
      "GitHub returned incomplete repository facts.",
    );
  const facts: Omit<RepositoryLookup, "license"> = {
    repository: repo.full_name,
    description: repositoryDescription(repo.description),
    numericId: String(repo.id),
    nodeId: repo.node_id,
    defaultBranch: repo.default_branch,
    owner: {
      login: owner.login,
      actorId: String(owner.id),
      nodeId: owner.node_id,
      kind: owner.type === "User" ? "individual" : "organization",
    },
  };
  try {
    const branch = await githubJson(
      fetcher,
      token,
      `/repos/${repo.full_name}/branches/${encodeURIComponent(repo.default_branch)}`,
      apiOrigin,
    );
    const commitSha = (branch?.commit as Record<string, unknown> | undefined)
      ?.sha;
    if (typeof commitSha !== "string" || !/^[0-9a-f]{40}$/u.test(commitSha))
      return unknownLicense(facts, "The default branch could not be read.");
    const license = await githubJson(
      fetcher,
      token,
      `/repos/${repo.full_name}/license?ref=${commitSha}`,
      apiOrigin,
    );
    if (!license) return unknownLicense(facts, "GitHub found no license file.");
    if (license.path !== "LICENSE")
      return unknownLicense(
        facts,
        `The license file is ${String(license.path)}. A manifest records only a root LICENSE file.`,
      );
    const spdx = (license.license as Record<string, unknown> | undefined)
      ?.spdx_id;
    if (
      typeof spdx !== "string" ||
      spdx === "NOASSERTION" ||
      !/^[A-Za-z0-9-.+]{1,80}$/u.test(spdx)
    )
      return unknownLicense(facts, "GitHub could not identify the license.");
    if (license.encoding !== "base64" || typeof license.content !== "string")
      return unknownLicense(facts, "GitHub did not return the license bytes.");
    const binary = atob(license.content.replace(/\s/gu, ""));
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return {
      ...facts,
      license: {
        state: "verified",
        spdx,
        commitSha,
        fileSha256: sha256Hex(bytes),
      },
    };
  } catch (error: unknown) {
    return unknownLicense(
      facts,
      `License facts could not be read. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }
}

const BRANCH = /^[A-Za-z0-9._/-]{1,255}$/u;

/**
 * Reads the current head commit of one branch. Security vetting binds an
 * assessment to this exact commit (PRD VET-07), so every failure throws and
 * never returns a guessed commit.
 */
export async function readBranchHead(
  fetcher: GithubFetch,
  token: string | undefined,
  repository: string,
  branch: string,
  apiOrigin = GITHUB_API,
): Promise<string> {
  if (!validRepositoryPath(repository) || !BRANCH.test(branch))
    throw new GithubLookupError(
      400,
      "invalid_request",
      "The repository or integration branch is not valid.",
    );
  const value = await githubJson(
    fetcher,
    token,
    `/repos/${repository}/branches/${encodeURIComponent(branch)}`,
    apiOrigin,
  );
  const commitSha = (value?.commit as Record<string, unknown> | undefined)?.sha;
  if (typeof commitSha !== "string" || !/^[0-9a-f]{40}$/u.test(commitSha))
    throw new GithubLookupError(
      502,
      "github_unavailable",
      `GitHub returned no head commit for ${repository} ${branch}.`,
    );
  return commitSha;
}

/** The GitHub API origin: a loopback fixture in local browser tests only. */
export function githubApiOrigin(value: string | undefined): string {
  return loopbackOrigin(value, GITHUB_API);
}
