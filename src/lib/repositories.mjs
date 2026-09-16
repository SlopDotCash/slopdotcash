/**
 * Flattens the project registry into the GitHub repositories consumed by the
 * existing ingestion pipeline. Repository identity stays canonical while each
 * row now carries the project that owns its scoring and reward policy.
 */

import { PROJECTS } from "./projects.mjs";

/**
 * Builds the ingestion target rows for a project list.
 *
 * Only `active` projects contribute rows. A `paused` project stays registered
 * and publicly listed, but none of its repositories is collected, so no
 * activity on them can reach the ledger or the leaderboard.
 *
 * Authority is deliberately not part of this gate. An active project may hold
 * `authority.state: "unverified"` while its receipts stay pending and its
 * payments stay disabled, which `project-schema.mjs` already enforces, and
 * `heir-elements-sdk` is a registered project in exactly that state today.
 * Gating on authority here would silently drop a collected repository.
 *
 * `role` is positional over the collected projects, so pausing the
 * highest-capped project promotes the next active one to `primary` rather
 * than leaving the registry without a primary.
 */
export function collectTargetRepositories(projects) {
  return projects
    .filter((project) => project.status === "active")
    .flatMap((project, projectIndex) =>
      project.repositories.map((metadata, repositoryIndex) => {
        const canonicalUrl = new URL(metadata.githubUrl);
        const [owner, name] = canonicalUrl.pathname.split("/").filter(Boolean);
        const currentIdentity = `${owner}/${name}`;
        return Object.freeze({
          ...metadata,
          aliases: metadata.aliases ?? [],
          owner,
          name,
          expectedNodeId:
            currentIdentity.toLowerCase() === metadata.id.toLowerCase()
              ? null
              : project.authority.repositoryNodeId,
          projectId: project.id,
          role:
            projectIndex === 0 && repositoryIndex === 0 ? "primary" : "member",
        });
      }),
    );
}

export const TARGET_REPOSITORIES = Object.freeze(
  collectTargetRepositories(PROJECTS),
);

export const PRIMARY_REPOSITORY = TARGET_REPOSITORIES[0];

const REPOSITORIES_BY_LOWERCASE_ID = new Map(
  TARGET_REPOSITORIES.flatMap((repository) =>
    [repository.id, ...(repository.aliases ?? [])].map((repositoryId) => [
      repositoryId.toLowerCase(),
      repository,
    ]),
  ),
);

/**
 * Returns the registry entry for an owner/name pair, matching GitHub's
 * case-insensitive repository identity, or null when the pair is not a
 * registered target repository.
 */
export function findTargetRepository(owner, name) {
  if (typeof owner !== "string" || typeof name !== "string") {
    return null;
  }
  return (
    REPOSITORIES_BY_LOWERCASE_ID.get(`${owner}/${name}`.toLowerCase()) ?? null
  );
}

/** Returns the registry entry whose id matches, or null. */
export function findTargetRepositoryById(id) {
  if (typeof id !== "string") {
    return null;
  }
  return REPOSITORIES_BY_LOWERCASE_ID.get(id.toLowerCase()) ?? null;
}
