/**
 * Flattens the project registry into the GitHub repositories consumed by the
 * existing ingestion pipeline. Repository identity stays canonical while each
 * row now carries the project that owns its scoring and reward policy.
 */

import { PROJECTS } from "./projects.mjs";

export const TARGET_REPOSITORIES = Object.freeze(
  PROJECTS.flatMap((project, projectIndex) =>
    project.repositories.map((metadata, repositoryIndex) => {
      const [owner, name] = metadata.id.split("/");
      return Object.freeze({
        ...metadata,
        owner,
        name,
        projectId: project.id,
        role:
          projectIndex === 0 && repositoryIndex === 0 ? "primary" : "member",
      });
    }),
  ),
);

export const PRIMARY_REPOSITORY = TARGET_REPOSITORIES[0];

const REPOSITORIES_BY_LOWERCASE_ID = new Map(
  TARGET_REPOSITORIES.map((repository) => [
    repository.id.toLowerCase(),
    repository,
  ]),
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
