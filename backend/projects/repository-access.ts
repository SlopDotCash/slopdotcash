/** Shared private Slopbot repository identity and permission read. */

import { readBoundedJson } from "../../src/lib/browser-json";
import {
  type GithubActor,
  REPOSITORY_READ_HEADER,
  REPOSITORY_READ_PATH,
  REPOSITORY_READ_URL,
} from "../../src/lib/project-contracts";
import type { GithubFetch } from "./github-lookup";
import { parseRepositoryAccess } from "./setup";

export type SlopbotBinding = { fetch(request: Request): Promise<Response> };

export async function slopbotRepositoryAccess(
  slopbot: SlopbotBinding | undefined,
  repository: { path: string; githubId: string },
  actor: GithubActor,
) {
  if (slopbot === undefined) throw new Error("Slopbot is not connected");
  const url = new URL("https://slopbot.internal/v1/repository-access");
  url.searchParams.set("repository", repository.path);
  url.searchParams.set("repositoryId", repository.githubId);
  url.searchParams.set("login", actor.githubLogin);
  url.searchParams.set("githubId", actor.githubId);
  url.searchParams.set("includeRepository", "1");
  const response = await slopbot.fetch(
    new Request(url, { headers: { accept: "application/json" } }),
  );
  if (!response.ok) throw new Error(`Slopbot returned ${response.status}`);
  return parseRepositoryAccess(
    await readBoundedJson(response, 4 * 1024, "repository access"),
  );
}

/**
 * Sends the repository-scoped public reads of setup and vetting (facts,
 * branch head, LICENSE) through that repository's Slopbot installation, so
 * they do not spend the anonymous rate limit of a shared Pages address.
 * Any other read, an uninstalled repository, or an unavailable Slopbot
 * answer makes the ordinary read.
 */
export function slopbotGithubFetch(
  slopbot: SlopbotBinding | undefined,
  apiOrigin: string,
  ordinary: GithubFetch,
): GithubFetch {
  if (slopbot === undefined) return ordinary;
  return async (url, init) => {
    const target = new URL(url);
    const path = `${target.pathname}${target.search}`;
    if (target.origin === apiOrigin && REPOSITORY_READ_PATH.test(path)) {
      const read = new URL(REPOSITORY_READ_URL);
      read.searchParams.set("path", path);
      try {
        const response = await slopbot.fetch(
          new Request(read, { signal: init.signal }),
        );
        if (response.headers.get(REPOSITORY_READ_HEADER) === "github")
          return response;
      } catch {
        // error-policy:J3 an unavailable Slopbot read means the ordinary read.
      }
    }
    return ordinary(url, init);
  };
}
