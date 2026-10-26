/**
 * Who may file a contributor flag (owner decision D3, issue #911).
 *
 * A flagger is a signed-in member whose GitHub account is at least 30 days
 * old and who has at least one accepted contribution: a merged pull request
 * that the member authored in a repository of a registered Slop project.
 * Both facts come from GitHub at filing time, starting from the member's
 * immutable account ID. A failed or incomplete read refuses the flag; it
 * never admits one. The project's own maintainers are refused separately,
 * through the same repository authority check that project setup uses.
 */

import { readBoundedJson } from "../../src/lib/browser-json";
import type { GithubActor } from "../../src/lib/project-contracts";
import {
  type GithubFetch,
  GithubLookupError,
  githubJson,
  requestInit,
  validGithubLogin,
} from "../projects/github-lookup";

export type FlaggerStanding = {
  accountCreatedAt: string;
  hasAcceptedContribution: boolean;
};

export type FlaggerStandingReader = (
  actor: GithubActor,
) => Promise<FlaggerStanding>;

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
/** Pages of the member's issues and pull requests read per repository. */
const MAX_PAGES = 10;
const PAGE_SIZE = 100;

function unavailable(detail: string): never {
  throw new GithubLookupError(502, "github_unavailable", detail);
}

export function githubFlaggerStanding(input: {
  fetch: GithubFetch;
  token?: string;
  apiOrigin: string;
  /** Repositories of every registered Slop project. */
  registryRepositories: () => Promise<string[]>;
}): FlaggerStandingReader {
  return async (actor) => {
    // The immutable account ID names the current login and creation time.
    const user = await githubJson(
      input.fetch,
      input.token,
      `/user/${actor.githubId}`,
      input.apiOrigin,
    );
    if (
      user === null ||
      user.type !== "User" ||
      String(user.id) !== actor.githubId ||
      typeof user.login !== "string" ||
      !validGithubLogin(user.login) ||
      typeof user.created_at !== "string" ||
      !Number.isFinite(Date.parse(user.created_at))
    )
      unavailable("GitHub returned incomplete account facts.");
    const login = user.login;
    const accountCreatedAt = new Date(user.created_at).toISOString();

    for (const repository of new Set(await input.registryRepositories())) {
      if (!REPOSITORY.test(repository))
        unavailable("A registered repository name is invalid.");
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const response = await input.fetch(
          `${input.apiOrigin}/repos/${repository}/issues?creator=${encodeURIComponent(login)}&state=closed&per_page=${PAGE_SIZE}&page=${page}`,
          requestInit(input.token),
        );
        // A renamed or removed repository has nothing to read.
        if (response.status === 404) break;
        if (!response.ok) unavailable(`GitHub returned ${response.status}.`);
        const items = await readBoundedJson(
          response,
          4 * 1024 * 1024,
          "GitHub issues",
        );
        if (!Array.isArray(items))
          unavailable("GitHub returned an unexpected issue list.");
        if (
          items.some((item) => {
            const entry = item as {
              user?: { id?: unknown };
              pull_request?: { merged_at?: unknown };
            };
            return (
              String(entry.user?.id) === actor.githubId &&
              typeof entry.pull_request?.merged_at === "string"
            );
          })
        )
          return { accountCreatedAt, hasAcceptedContribution: true };
        if (items.length < PAGE_SIZE) break;
        if (page === MAX_PAGES)
          unavailable("The member has too many closed items to read.");
      }
    }
    return { accountCreatedAt, hasAcceptedContribution: false };
  };
}
