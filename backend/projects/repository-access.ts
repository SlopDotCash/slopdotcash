/** Shared private Slopbot repository identity and permission read. */

import { readBoundedJson } from "../../src/lib/browser-json";
import type { GithubActor } from "../../src/lib/project-contracts";
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
