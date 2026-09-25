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
 * authority is checked separately from collection status.
 * Gating on authority here would silently drop a collected repository.
 *
 * `role` is positional over the collected projects, so pausing the
 * highest-capped project promotes the next active one to `primary` rather
 * than leaving the registry without a primary.
 */
function flattenRepositories(projects) {
  return projects.flatMap((project, projectIndex) =>
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

export function collectTargetRepositories(projects) {
  return flattenRepositories(
    projects.filter((project) => project.status === "active"),
  );
}

export const TARGET_REPOSITORIES = Object.freeze(
  collectTargetRepositories(PROJECTS),
);

/** Registered identities remain available to validate immutable history after retirement. */
export const REGISTERED_REPOSITORIES = Object.freeze(
  flattenRepositories(PROJECTS).map((repository) =>
    Object.freeze({
      ...repository,
      role: repository.id === TARGET_REPOSITORIES[0]?.id ? "primary" : "member",
    }),
  ),
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

/** Historical lookup never authorizes collection of a paused repository. */
export function findRegisteredRepositoryById(id) {
  if (typeof id !== "string") return null;
  return (
    REGISTERED_REPOSITORIES.find((repository) =>
      [repository.id, ...repository.aliases].some(
        (alias) => alias.toLowerCase() === id.toLowerCase(),
      ),
    ) ?? null
  );
}

export function findRegisteredRepository(owner, name) {
  if (typeof owner !== "string" || typeof name !== "string") return null;
  return findRegisteredRepositoryById(`${owner}/${name}`);
}
