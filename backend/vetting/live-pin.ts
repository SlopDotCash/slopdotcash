/**
 * Reads the live pin a scan request or fresh reinstatement must match (PRD VET-07): the head
 * commit of the project's integration branch on GitHub and the content
 * digest of the deployed skill template inputs. Every failure throws, so a
 * caller never compares a clearance with a guessed commit.
 */

import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import {
  type EdgeCache,
  edgeCache,
  PUBLIC_PROJECT_TTL_SECONDS,
} from "../projects/edge-cache";
import { type GithubFetch, readBranchHead } from "../projects/github-lookup";
import type { VettingPin } from "./persistence";

type VettingGithub = {
  fetch: GithubFetch;
  token?: string;
  apiOrigin: string;
  /**
   * The edge cache and the site origin its keys use. A branch head is read
   * from GitHub at most once per repository, branch, colo and TTL.
   */
  cache?: { store: EdgeCache; origin: string };
};

/** The Workers default cache, keyed under the requested site origin. */
export function vettingBranchCache(request: Request): VettingGithub["cache"] {
  const store = edgeCache();
  return store && { store, origin: new URL(request.url).origin };
}

const KEY_PREFIX = "/__slop-cache/branch-head-v1";

async function branchHead(
  github: VettingGithub,
  repository: string,
  branch: string,
): Promise<string> {
  const read = () =>
    readBranchHead(
      github.fetch,
      github.token,
      repository,
      branch,
      github.apiOrigin,
    );
  if (github.cache === undefined) return read();
  const { store, origin } = github.cache;
  const key = new Request(
    `${origin}${KEY_PREFIX}/${repository.toLowerCase()}/${encodeURIComponent(branch)}`,
    { method: "GET" },
  );
  try {
    const cached = await store.match(key);
    if (cached !== undefined) {
      const commitSha = await cached.text();
      if (/^[0-9a-f]{40}$/u.test(commitSha)) return commitSha;
    }
  } catch {
    // error-policy:J3 an unavailable edge cache only means a GitHub read.
  }
  const commitSha = await read();
  await store
    .put(
      key,
      new Response(commitSha, {
        headers: {
          "cache-control": `public, max-age=${PUBLIC_PROJECT_TTL_SECONDS}`,
          "content-type": "text/plain; charset=utf-8",
        },
      }),
    )
    .catch(() => {
      // error-policy:J3 a failed cache write leaves the next read on GitHub.
    });
  return commitSha;
}

/**
 * The live pin of one manifest repository: the head of its integration
 * branch and the template digest. A scan covers one repository at one
 * commit, so each repository of a project has its own pin. The default is
 * the project's first repository; an id that is neither a listed repository
 * id nor one of its aliases throws.
 */
export async function readVettingPin(
  github: VettingGithub,
  manifest: ProjectDefinition,
  templateSha256: string,
  repositoryId: string = manifest.repositories[0].id,
): Promise<VettingPin> {
  if (!/^[0-9a-f]{64}$/u.test(templateSha256))
    throw new Error("The skill template digest is not a SHA-256.");
  const wanted = repositoryId.toLowerCase();
  const repository = manifest.repositories.find((entry) =>
    [entry.id, ...(entry.aliases ?? [])].some(
      (name) => name.toLowerCase() === wanted,
    ),
  );
  if (repository === undefined)
    throw new Error(`The manifest does not list repository ${repositoryId}.`);
  return {
    commitSha: await branchHead(
      github,
      repository.id,
      repository.integrationBranch,
    ),
    templateSha256,
  };
}
